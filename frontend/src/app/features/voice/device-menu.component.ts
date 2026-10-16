/**
 * src/app/features/voice/device-menu.component.ts
 * The little arrow next to the microphone, headphones and camera buttons of a call (like in Discord): it opens a list of the
 * devices, the one in use is marked, and choosing one switches to it at once, without leaving the call. In the Android app
 * the arrow of the headphones chooses where the voice sounds (phone, speaker, headphones or Bluetooth).
 */
import {
  Component,
  ElementRef,
  computed,
  EnvironmentInjector,
  HostListener,
  inject,
  input,
  signal,
  type OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { CallService } from '../../core/services/call.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { openBackgroundPicker } from './background-picker.component';
import { closeOnBack } from '../../core/services/back.service';
import { listenWhile } from '../../shared/util/listen-while';
import { NativeCallService } from '../../core/services/native-call.service';
import type { AudioRoute } from '../../core/native-bridge';

/** One device of the list. */
interface Device {
  id: string;
  label: string;
}

/** Which devices the arrow offers: the microphones, the speakers, or the cameras. */
export type DeviceKind = 'mic' | 'speakers' | 'video';

/**
 * The one list that is open now, of all the arrows of the page (the call page and the floating panel have their own).
 * ! Only one at a time: opening the microphones closes the speakers. A press outside used to be the only thing that closed
 *   them, and a tap on a phone (or a press stopped by another element) could leave two lists open on top of each other.
 */
const openList = signal<object | null>(null);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-device-menu',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  host: { class: 'relative block' },
  template: `
    <button
      type="button"
      class="btn h-12 w-7 !rounded-l-[calc(var(--r)*.4)] !px-0 text-muted hover:text-fg"
      [class.btn-active]="open()"
      [attr.aria-label]="label() | t"
      [attr.aria-expanded]="open()"
      aria-haspopup="menu"
      (click)="toggle()"
    >
      <app-icon name="chevron-up" [size]="14" />
    </button>
    @if (open()) {
      <div
        role="menu"
        class="panel anim-pop absolute bottom-14 left-1/2 z-30 max-h-[60dvh] w-[19rem] -translate-x-1/2 overflow-y-auto !bg-ink-850 p-2 shadow-2xl max-md:fixed max-md:inset-x-3 max-md:bottom-28 max-md:left-3 max-md:w-auto max-md:translate-x-0"
      >
        @if (kind() === 'mic') {
          <div class="label px-2.5 pb-1 pt-1.5">{{ 'Microphone' | t }}</div>
          @for (device of inputs(); track device.id) {
            <button
              type="button"
              role="menuitemradio"
              class="device-item"
              [attr.aria-checked]="settings.inputDeviceId() === device.id"
              (click)="chooseInput(device.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ device.label | t }}</span>
              @if (settings.inputDeviceId() === device.id) {
                <app-icon name="check" [size]="15" class="text-accent" />
              }
            </button>
          }
        } @else if (kind() === 'speakers' && native.available) {
          <!-- Android: where the voice sounds (the phone at the ear, the speaker, a headset). -->
          <div class="label px-2.5 pb-1 pt-1.5">{{ 'Audio output' | t }}</div>
          @for (route of native.routes(); track route.id) {
            <button
              type="button"
              role="menuitemradio"
              class="device-item"
              [attr.aria-checked]="native.currentRoute() === route.id"
              (click)="chooseRoute(route)"
            >
              <app-icon [name]="routeIcon(route)" [size]="15" />
              <span class="min-w-0 flex-1 truncate">{{ native.routeLabel(route) }}</span>
              @if (native.currentRoute() === route.id) {
                <app-icon name="check" [size]="15" class="text-accent" />
              }
            </button>
          } @empty {
            <p class="px-2.5 pb-1 pt-1 text-[0.6875rem] text-dim">{{ 'No other output' | t }}</p>
          }
        } @else if (kind() === 'speakers') {
          <div class="label px-2.5 pb-1 pt-1.5">{{ 'Speakers' | t }}</div>
          @for (device of outputs(); track device.id) {
            <button
              type="button"
              role="menuitemradio"
              class="device-item"
              [attr.aria-checked]="settings.outputDeviceId() === device.id"
              (click)="settings.outputDeviceId.set(device.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ device.label | t }}</span>
              @if (settings.outputDeviceId() === device.id) {
                <app-icon name="check" [size]="15" class="text-accent" />
              }
            </button>
          }
          @if (outputs().length < 2) {
            <p class="px-2.5 pb-1 pt-1 text-[0.6875rem] text-dim">
              {{ 'This browser cannot choose the speakers.' | t }}
            </p>
          }
        } @else {
          <button
            type="button"
            role="menuitem"
            class="device-item device-bg"
            (click)="openBackground()"
          >
            <app-icon name="image" [size]="15" />
            <span class="min-w-0 flex-1 truncate">{{ 'Camera background' | t }}</span>
            <app-icon name="chevron-up" [size]="13" class="rotate-90 text-dim" />
          </button>
          <div class="label px-2.5 pb-1 pt-2">{{ 'Camera' | t }}</div>
          @for (device of cameras(); track device.id) {
            <button
              type="button"
              role="menuitemradio"
              class="device-item"
              [attr.aria-checked]="settings.cameraDeviceId() === device.id"
              (click)="chooseCamera(device.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ device.label | t }}</span>
              @if (settings.cameraDeviceId() === device.id) {
                <app-icon name="check" [size]="15" class="text-accent" />
              }
            </button>
          }
        }
      </div>
    }
  `,
  styles: `
    .device-item {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.65rem;
      border-radius: calc(var(--r) * 0.6);
      text-align: left;
      font-size: 0.8125rem;
    }
    .device-bg {
      margin-bottom: 0.2rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: calc(var(--r) * 0.6) calc(var(--r) * 0.6) 0 0;
    }
    .device-item {
      transition: background-color 0.22s var(--ease-suave);
    }
    .device-item:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .device-item[aria-checked='true'] {
      color: var(--accent);
      font-weight: 600;
    }
  `,
})
export class DeviceMenuComponent implements OnDestroy {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  /** Which devices to offer. */
  readonly kind = input.required<DeviceKind>();

  protected readonly settings = inject(SettingsService);
  private readonly call = inject(CallService);
  /** Android: the outputs of the voice of a call. */
  protected readonly native = inject(NativeCallService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(EnvironmentInjector);

  /** True while this list is the open one. */
  protected readonly open = computed(this.isOpen.bind(this));
  protected readonly inputs = signal<Device[]>([]);
  protected readonly outputs = signal<Device[]>([]);
  protected readonly cameras = signal<Device[]>([]);
  private readonly onDeviceChange = this.refresh.bind(this);

  /** Keeps the list up to date when a device is plugged in or out. */
  constructor() {
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  /** Stops listening for devices (and closes the list if it was the open one). */
  ngOnDestroy(): void {
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.setOpen(false);
  }

  /** True while this list is the open one. */
  private isOpen(): boolean {
    return openList() === this;
  }

  /** Opens this list (closing any other one) or closes it. */
  private setOpen(on: boolean): void {
    if (on) openList.set(this);
    else if (openList() === this) openList.set(null);
  }

  /** While open, a press anywhere else closes the list. */
  private readonly outside = listenWhile(
    this.backOpen.bind(this),
    document,
    'mousedown',
    this.onOutside.bind(this),
  );

  /** A press anywhere else closes the list. */
  onOutside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.setOpen(false);
    }
  }

  /** Escape closes the list. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.setOpen(false);
  }

  /** The name of what the arrow opens (for screen readers). */
  protected label(): string {
    return this.kind() === 'mic'
      ? 'Microphone'
      : this.kind() === 'speakers'
        ? 'Speakers'
        : 'Camera';
  }

  /** Opens or closes the list (reading the devices when it opens). */
  protected toggle(): void {
    const next = !this.open();
    this.setOpen(next);
    if (next && this.kind() === 'speakers' && this.native.available) {
      // A headset may have been plugged in since the last look.
      void this.native.refreshRoutes();
    } else if (next) {
      void this.refresh();
    }
  }

  /** Android: sends the voice to an output and closes the list. */
  protected chooseRoute(route: AudioRoute): void {
    this.setOpen(false);
    void this.native.setRoute(route);
  }

  /** Android: the icon of an output of the voice. */
  protected routeIcon(route: AudioRoute): string {
    const icons: Record<AudioRoute['kind'], string> = {
      earpiece: 'smartphone',
      speaker: 'volume-2',
      wired: 'headphones',
      bluetooth: 'bluetooth',
    };
    return icons[route.kind];
  }

  /** Reads the devices. The names are empty until the browser has given permission, so they get a number then. */
  private async refresh(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.inputs.set(this.list(devices, 'audioinput', 'Microphone'));
      this.outputs.set(this.list(devices, 'audiooutput', 'Speakers'));
      this.cameras.set(this.list(devices, 'videoinput', 'Camera'));
    } catch {
      /* the browser gives no list: the arrow just shows the default */
    }
  }

  /** The devices of one kind, with the system default first. */
  private list(devices: MediaDeviceInfo[], kind: MediaDeviceKind, name: string): Device[] {
    const real = devices.filter(function ofKind(device) {
      return (
        device.kind === kind &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications'
      );
    });
    const out: Device[] = [{ id: 'default', label: 'Default' }];
    real.forEach(function add(device, index) {
      out.push({ id: device.deviceId, label: device.label || name + ' ' + (index + 1) });
    });
    return out;
  }

  /** Switches the microphone of the call. */
  protected chooseInput(id: string): void {
    this.settings.inputDeviceId.set(id);
    void this.call.changeInputDevice();
  }

  /** Closes the list and opens the window of the camera backgrounds. */
  protected openBackground(): void {
    this.setOpen(false);
    openBackgroundPicker(this.injector);
  }

  /** Switches the camera (when it is on, it restarts with the new one). */
  protected chooseCamera(id: string): void {
    this.settings.cameraDeviceId.set(id);
    void this.call.changeCamera();
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return this.open();
  }

  /** The back key closes it. */
  private backClose(): void {
    this.setOpen(false);
  }
}
