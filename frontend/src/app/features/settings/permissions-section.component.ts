/**
 * src/app/features/settings/permissions-section.component.ts
 * Settings - Permissions (the Android and iOS apps): what Chatterly needs from the phone, whether each thing is allowed now, and a button to
 * allow it. When Android no longer shows its question (it was refused for good) the button opens the page of Android about the app.
 * On iPhone and iPad there is no plugin: the page reads the microphone and the camera with the Permissions API, asks with getUserMedia,
 * and a refused one can only be changed in Settings > Chatterly of the system (iOS asks once).
 */
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { IOS_APP } from '../../core/config';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { NativeCallService } from '../../core/services/native-call.service';
import { IconComponent } from '../../shared/components/icon.component';

/** One thing the app may need from the phone. */
interface PermissionRow {
  id: 'microphone' | 'camera' | 'notifications' | 'lockscreen' | 'battery';
  icon: string;
  title: string;
  hint: string;
}

/** The screen of permissions. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-permissions-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <p class="mb-4 text-sm text-muted">
      {{
        (ios
          ? 'These are the permissions Chatterly asks of this iPhone or iPad. Allow the ones you want to use: nothing is used without them.'
          : 'These are the permissions Chatterly asks of this phone. Allow the ones you want to use: nothing is used without them.'
        ) | t
      }}
    </p>
    <ul class="space-y-2">
      @for (row of rows; track row.id) {
        <li
          class="flex flex-wrap items-center gap-3 rounded-ui-lg border border-white/8 bg-black/15 px-4 py-3"
        >
          <span class="menu-icon !h-9 !w-9 bg-white/5 text-muted"
            ><app-icon [name]="row.icon" [size]="16"
          /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">{{ row.title | t }}</span>
            <span class="block text-xs text-muted">{{ row.hint | t }}</span>
          </span>
          @if (allowed(row.id)) {
            <span class="chip chip-accent"><app-icon name="check" [size]="12" /> {{ 'Allowed' | t }}</span>
          } @else {
            <button type="button" class="btn btn-sm btn-primary" (click)="allow(row.id)">
              {{ 'Allow' | t }}
            </button>
          }
        </li>
      }
    </ul>
    <div class="mt-5 flex items-center justify-between gap-3">
      <span class="text-xs text-dim">{{
        (ios
          ? 'iPhone and iPad ask only once: to change one you refused, open Settings > Chatterly in the system.'
          : 'Sharing the screen is asked by Android every time you start it.'
        ) | t
      }}</span>
      <button type="button" class="btn btn-sm" (click)="openSettings()">
        <app-icon name="settings" [size]="13" /> {{ 'Open the settings of the app' | t }}
      </button>
    </div>
  `,
})
export class PermissionsSectionComponent implements OnInit {
  protected readonly native = inject(NativeCallService);
  protected readonly ios = IOS_APP;
  /** What the web view says about the microphone and the camera on iOS (there is no plugin to ask the system). */
  private readonly webAllowed = signal<{ microphone: boolean; camera: boolean }>({
    microphone: false,
    camera: false,
  });
  protected readonly rows: PermissionRow[] = this.listRows();

  /** The rows of this phone: iOS only has the microphone and the camera (it has no lock screen or battery settings to offer). */
  private listRows(): PermissionRow[] {
    const all: PermissionRow[] = [
      {
        id: 'microphone',
        icon: 'mic',
        title: 'Microphone',
        hint: 'To talk in calls and record voice notes.',
      },
      { id: 'camera', icon: 'video', title: 'Camera', hint: 'To turn your camera on in a call.' },
      {
        id: 'notifications',
        icon: 'bell',
        title: 'Notifications',
        hint: 'Messages, the call in progress and calls that ring.',
      },
      {
        id: 'lockscreen',
        icon: 'phone',
        title: 'Calls over the lock screen',
        hint: 'So a call that rings fills the screen even with the phone locked.',
      },
      {
        id: 'battery',
        icon: 'activity',
        title: 'Keep calls when you clear the recent apps',
        hint: 'Run without battery limits: on some phones clearing the recent apps ends the call.',
      },
    ];
    if (!IOS_APP) return all;
    return all.filter(function onlyMedia(row) {
      return row.id === 'microphone' || row.id === 'camera';
    });
  }

  /** Reads what is allowed now (it is read again when the person comes back from the settings of the system). */
  ngOnInit(): void {
    if (this.ios) void this.readWeb();
    else void this.native.checkPermissions();
  }

  /** Whether a permission is allowed now. */
  protected allowed(id: PermissionRow['id']): boolean {
    if (this.ios) {
      return id === 'camera' ? this.webAllowed().camera : this.webAllowed().microphone;
    }
    switch (id) {
      case 'lockscreen':
        return this.native.fullScreenAllowed();
      case 'battery':
        return this.native.batteryUnrestricted();
      default:
        return this.native.permissions()[id];
    }
  }

  /** The button of a row: the system asks, or its page opens where the thing is allowed. */
  protected allow(id: PermissionRow['id']): void {
    if (this.ios) {
      void this.askWeb(id === 'camera' ? 'camera' : 'microphone');
      return;
    }
    if (id === 'lockscreen') this.native.openFullScreenSettings();
    else if (id === 'battery') this.native.openBatterySettings();
    else void this.native.askPermission(id);
  }

  /** The button of the settings: the page of Android about the app, or the one of iOS (best effort, the web view may not open it). */
  protected openSettings(): void {
    if (this.ios) {
      window.open('app-settings:', '_blank');
      return;
    }
    this.native.openAppSettings();
  }

  /** Reads the state of the microphone and the camera with the Permissions API (when the web view has it). */
  private async readWeb(): Promise<void> {
    const state = { microphone: false, camera: false };
    state.microphone = await this.queryWeb('microphone');
    state.camera = await this.queryWeb('camera');
    this.webAllowed.set(state);
  }

  /** True when the Permissions API says granted; false when it says anything else or does not know the name. */
  private async queryWeb(source: 'microphone' | 'camera'): Promise<boolean> {
    try {
      const status = await navigator.permissions.query({ name: source as PermissionName });
      return status.state === 'granted';
    } catch {
      return false;
    }
  }

  /** Asks the system through the web view (iOS shows its question the first time) and reads the state again. */
  private async askWeb(kind: 'microphone' | 'camera'): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'camera' ? { video: true } : { audio: true },
      );
      for (const track of stream.getTracks()) track.stop();
      this.webAllowed.update(function granted(now) {
        return { ...now, [kind]: true };
      });
    } catch {
      // Refused: iOS does not ask again, so the settings button is the way.
      this.openSettings();
    }
    await this.readWeb();
  }
}
