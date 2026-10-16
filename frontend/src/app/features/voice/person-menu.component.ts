/**
 * src/app/features/voice/person-menu.component.ts
 * The menu of a right click (or a long press on a phone) on a person of a call: their volume for this device (0 to
 * 200 %), the volume of the screen they share when it has sound, and hiding their tile. On the tile of a shared screen (a
 * stream) it is the menu of that stream: its volume first, without having to find the person.
 *
 * It opens right next to the cursor, in the top layer of the browser (so no container with a transform or a hidden
 * overflow can move or clip it), it can be dragged by its title and it closes with a press anywhere else, with Escape or
 * with the cross. The press outside is listened for in the capture phase, so nothing that stops events can keep it open.
 */
import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  type OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { CallService } from '../../core/services/call.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { closeOnBack } from '../../core/services/back.service';

/** How far from the cursor the menu appears (pixels). */
const CURSOR_GAP = 4;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-person-menu',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  host: {
    popover: 'manual',
    role: 'menu',
    '[style.left.px]': 'place().x',
    '[style.top.px]': 'place().y',
    '(mousedown)': '$event.stopPropagation()',
  },
  styles: `
    :host {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      width: 15.5rem;
      overflow: hidden;
      color: var(--fg);
      border: 1px solid var(--line);
      border-radius: var(--r-lg);
      background: color-mix(in oklab, var(--ink-850) 97%, black);
      box-shadow:
        0 24px 60px -16px rgba(0, 0, 0, 0.75),
        0 0 0 1px rgba(0, 0, 0, 0.3);
    }
    :host(:not(:popover-open)) {
      display: none;
    }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.45rem 0.4rem 0.45rem 0.85rem;
      cursor: var(--cur-grab, grab);
      touch-action: none;
      user-select: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .bar.is-moving {
      cursor: var(--cur-grabbing, grabbing);
    }
  `,
  template: `
    <div
      class="bar"
      [class.is-moving]="moving()"
      [attr.title]="'Drag to move' | t"
      (pointerdown)="startMove($event)"
      (pointermove)="move($event)"
      (pointerup)="endMove($event)"
      (pointercancel)="endMove($event)"
    >
      <span class="truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-dim">{{
        label()
      }}</span>
      <button
        type="button"
        class="btn btn-icon btn-sm btn-ghost"
        [attr.aria-label]="'Close' | t"
        (pointerdown)="$event.stopPropagation()"
        (click)="closed.emit()"
      >
        <app-icon name="x" [size]="14" />
      </button>
    </div>
    <div class="p-1.5">
      @if (canAdjust()) {
        <div class="px-2.5 pb-2 pt-1.5">
          <div class="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span class="flex items-center gap-1.5"
              ><app-icon name="volume-2" [size]="14" /> {{ 'Volume' | t }}</span
            >
            <b class="font-mono text-fg">{{ percent() }}%</b>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            class="w-full accent-[var(--accent)]"
            [attr.aria-label]="'Volume' | t"
            [value]="percent()"
            (input)="setVolume(+$any($event.target).value)"
            (dblclick)="setVolume(100)"
          />
          <div class="mt-0.5 flex justify-between text-[0.625rem] text-dim">
            <span>0%</span>
            <button type="button" class="hover:text-fg" (click)="setVolume(100)">
              {{ 'Reset' | t }} · 100%
            </button>
            <span>200%</span>
          </div>
        </div>
        <div class="my-1 h-px bg-white/8"></div>
      }
      @if (stream() && !canAdjust()) {
        <!-- The tile of a stream: its own volume is what a right click is for. -->
        <div class="px-2.5 pb-2 pt-1.5">
          <div class="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span class="flex items-center gap-1.5"
              ><app-icon name="monitor" [size]="14" /> {{ 'Stream volume' | t }}</span
            >
            <b class="font-mono text-fg">{{ streamPercent() }}%</b>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            class="w-full accent-[var(--accent)]"
            [attr.aria-label]="'Stream volume' | t"
            [disabled]="!call.screenSound()[userId()]"
            [value]="streamPercent()"
            (input)="call.setScreenVolume(userId(), +$any($event.target).value)"
            (dblclick)="call.setScreenVolume(userId(), 100)"
          />
          @if (call.screenSound()[userId()]) {
            <div class="mt-0.5 flex justify-between text-[0.625rem] text-dim">
              <span>0%</span>
              <button
                type="button"
                class="hover:text-fg"
                (click)="call.setScreenVolume(userId(), streamPercent() === 0 ? 100 : 0)"
              >
                {{ (streamPercent() === 0 ? 'Unmute the stream' : 'Mute the stream') | t }}
              </button>
              <span>200%</span>
            </div>
          } @else {
            <p class="mt-1 text-[0.6875rem] text-dim">{{ 'This stream has no sound.' | t }}</p>
          }
        </div>
        <div class="my-1 h-px bg-white/8"></div>
      }
      @if (canAdjust() && call.screenSound()[userId()]) {
        <!-- The sound of the screen they share (a stream, a game) has its own volume, apart from their voice. -->
        <div class="px-2.5 pb-2 pt-1.5">
          <div class="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span class="flex items-center gap-1.5"
              ><app-icon name="monitor" [size]="14" /> {{ 'Stream volume' | t }}</span
            >
            <b class="font-mono text-fg">{{ streamPercent() }}%</b>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            class="w-full accent-[var(--accent)]"
            [attr.aria-label]="'Stream volume' | t"
            [value]="streamPercent()"
            (input)="call.setScreenVolume(userId(), +$any($event.target).value)"
            (dblclick)="call.setScreenVolume(userId(), 100)"
          />
        </div>
        <div class="my-1 h-px bg-white/8"></div>
      }
      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-ui px-3 py-2 text-left text-sm hover:bg-white/8"
        (click)="hide.emit()"
      >
        <app-icon name="eye-off" [size]="15" /> {{ 'Hide for me' | t }}
      </button>
    </div>
  `,
})
export class PersonMenuComponent implements OnDestroy {
  /** The back key of the phone closes it (see BackService). */
  private readonly backKey = closeOnBack(this.backOpen.bind(this), this.backClose.bind(this));

  /** Where the cursor was (the menu appears next to it). */
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  /** The name shown in the title. */
  readonly label = input('');
  /** The person the volume belongs to. */
  readonly userId = input('');
  /** Whether the volume of this person can be changed (not for yourself). */
  readonly canAdjust = input(false);
  /** The menu belongs to the tile of a screen someone else shares (its own volume). */
  readonly stream = input(false);
  /** The person chose to hide the tile. */
  readonly hide = output<void>();
  /** The menu should go away. */
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly settings = inject(SettingsService);
  protected readonly call = inject(CallService);

  /** Where the menu is now (it moves when it is dragged). */
  protected readonly place = signal({ x: -9999, y: -9999 });
  protected readonly moving = signal(false);
  private grab = { x: 0, y: 0 };
  private readonly onOutside = this.outside.bind(this);
  private readonly onKey = this.keydown.bind(this);

  /** Opens in the top layer, next to the cursor, and starts listening for a press outside. */
  constructor() {
    afterNextRender(this.open.bind(this));
  }

  /** The volume of the screen the person shares, in percent (100 when it was never changed). */
  protected streamPercent(): number {
    return this.settings.screenVolumes()[this.userId()] ?? 100;
  }

  /** The volume of the person in percent (100 when it was never changed). */
  protected percent(): number {
    return this.settings.peerVolumes()[this.userId()] ?? 100;
  }

  /** Changes the volume of the person (the call applies it at once and it is kept for the next calls). */
  protected setVolume(percent: number): void {
    this.call.setPeerVolume(this.userId(), percent);
  }

  /** Shows the menu, keeps it inside the screen and listens for what closes it. */
  private open(): void {
    const el = this.host.nativeElement as HTMLElement & { showPopover?: () => void };
    try {
      el.showPopover?.();
    } catch {
      /* it was already open */
    }
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let x = this.x() + CURSOR_GAP;
    let y = this.y() + CURSOR_GAP;
    if (x + width > window.innerWidth - 8) x = Math.max(8, this.x() - width - CURSOR_GAP);
    if (y + height > window.innerHeight - 8) y = Math.max(8, this.y() - height - CURSOR_GAP);
    this.place.set({ x, y });
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('contextmenu', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  /** Stops listening. */
  ngOnDestroy(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('contextmenu', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey, true);
  }

  /** A press (or another right click) anywhere outside the menu closes it. */
  private outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closed.emit();
    }
  }

  /** Escape closes it. */
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closed.emit();
    }
  }

  /** The title was pressed: the menu follows the pointer from now on. */
  protected startMove(event: PointerEvent): void {
    this.moving.set(true);
    this.grab = { x: event.clientX - this.place().x, y: event.clientY - this.place().y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  /** The menu moves with the pointer, never leaving the screen. */
  protected move(event: PointerEvent): void {
    if (!this.moving()) return;
    const el = this.host.nativeElement;
    this.place.set({
      x: Math.min(Math.max(0, event.clientX - this.grab.x), window.innerWidth - el.offsetWidth),
      y: Math.min(Math.max(0, event.clientY - this.grab.y), window.innerHeight - 40),
    });
  }

  /** The pointer is let go. */
  protected endMove(event: PointerEvent): void {
    this.moving.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** Whether it is open for the back key. */
  private backOpen(): boolean {
    return true;
  }

  /** The back key closes it. */
  private backClose(): void {
    this.closed.emit();
  }
}
