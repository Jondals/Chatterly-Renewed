/**
 * src/app/features/settings/shortcuts-section.component.ts
 * Settings - Shortcuts: the keyboard combination of each action of the call, which the person can change.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { desktopBridge } from '../../core/desktop-bridge';
import { OverlayService } from '../../core/services/overlay.service';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import {
  SHORTCUT_ACTIONS,
  ShortcutsService,
  comboOf,
  type ShortcutAction,
} from '../../core/services/shortcuts.service';
import { IconComponent } from '../../shared/components/icon.component';

/** The list of shortcuts. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-shortcuts-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <p class="mb-5 text-sm text-muted">
      {{
        (desktop
          ? 'Press the key or the combination you want for each action. In a call they work even when Chatterly is not in front.'
          : 'Press the key or the combination you want for each action. They work while this tab is the one in front.'
        ) | t
      }}
    </p>
    <ul class="space-y-2">
      @for (entry of actions; track entry.id) {
        <li
          class="flex flex-wrap items-center gap-3 rounded-ui-lg border border-white/8 bg-black/15 px-4 py-3"
        >
          <span class="menu-icon !h-9 !w-9 bg-white/5 text-muted"
            ><app-icon [name]="entry.icon" [size]="16"
          /></span>
          <span class="min-w-0 flex-1 text-sm font-medium">{{ entry.label | t }}</span>
          <button
            type="button"
            class="keycap"
            [class.is-recording]="recording() === entry.id"
            (click)="record(entry.id)"
          >
            @if (recording() === entry.id) {
              {{ 'Press the keys…' | t }}
            } @else if (shortcuts.comboFor(entry.id)) {
              {{ shortcuts.comboFor(entry.id) }}
            } @else {
              <span class="text-muted">{{ 'No shortcut' | t }}</span>
            }
          </button>
          @if (shortcuts.comboFor(entry.id)) {
            <button
              type="button"
              class="btn btn-icon btn-sm btn-ghost"
              [attr.aria-label]="'Remove' | t"
              [attr.title]="'Remove' | t"
              (click)="shortcuts.assign(entry.id, '')"
            >
              <app-icon name="x" [size]="14" />
            </button>
          }
        </li>
      }
      @if (overlay.supported) {
        <li
          class="flex flex-wrap items-center gap-3 rounded-ui-lg border border-white/8 bg-black/15 px-4 py-3"
        >
          <span class="menu-icon !h-9 !w-9 bg-white/5 text-muted"
            ><app-icon name="monitor" [size]="16"
          /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">{{
              'Overlay: move and resize the panel' | t
            }}</span>
            <span class="block text-xs text-muted">{{
              'Press it to grab the panel with the mouse (and the controls of the call); Esc or the shortcut again gives the game its mouse back.'
                | t
            }}</span>
          </span>
          <button
            type="button"
            class="keycap"
            [class.is-recording]="recording() === 'overlay'"
            (click)="record('overlay')"
          >
            @if (recording() === 'overlay') {
              {{ 'Press the keys…' | t }}
            } @else {
              {{ overlayCombo() }}
            }
          </button>
        </li>
        @if (!overlay.state().hotkeyOk && overlay.state().settings.enabled) {
          <li class="px-1 text-xs text-red-300">
            {{ 'Another program is using that shortcut. Choose a different one.' | t }}
          </li>
        }
      }
    </ul>
    <div class="mt-5 flex items-center justify-between gap-3">
      <span class="text-xs text-dim">{{ 'Esc cancels, Backspace removes the shortcut.' | t }}</span>
      <button type="button" class="btn btn-sm" (click)="shortcuts.reset()">
        <app-icon name="refresh" [size]="13" /> {{ 'Reset all' | t }}
      </button>
    </div>
  `,
  styles: `
    .keycap {
      min-width: 9rem;
      padding: 0.45rem 0.8rem;
      border-radius: var(--r);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-bottom-width: 3px;
      background: rgba(255, 255, 255, 0.05);
      font-family: var(--font-mono);
      font-size: 0.78rem;
      font-weight: 700;
      transition:
        border-color 0.2s var(--ease-suave),
        background-color 0.2s var(--ease-suave);
    }
    .keycap:hover {
      border-color: rgba(255, 255, 255, 0.3);
    }
    .keycap.is-recording {
      border-color: var(--accent);
      background: color-mix(in oklab, var(--accent) 14%, transparent);
      color: var(--accent);
    }
  `,
})
export class ShortcutsSectionComponent {
  protected readonly shortcuts = inject(ShortcutsService);
  protected readonly overlay = inject(OverlayService);
  /** The shortcut of the overlay as the person reads it. */
  protected overlayCombo(): string {
    return this.overlay.state().settings.hotkey.replace('CommandOrControl', 'Ctrl');
  }
  protected readonly actions = SHORTCUT_ACTIONS;
  /** The desktop app holds them for the whole system during a call. */
  protected readonly desktop = !!desktopBridge()?.shortcuts;
  /** The action that is waiting for a new combination. */
  protected readonly recording = signal<ShortcutAction | 'overlay' | null>(null);

  private readonly keyHandler = this.onKey.bind(this);

  /** Stops waiting for a combination when the page goes away. */
  constructor() {
    inject(DestroyRef).onDestroy(this.finish.bind(this));
  }

  /** Starts waiting for the combination of an action. */
  protected record(action: ShortcutAction | 'overlay'): void {
    this.recording.set(action);
    this.shortcuts.recording = true;
    window.addEventListener('keydown', this.keyHandler, true);
  }

  /** While waiting, the next combination is the one of the action (Escape only cancels this, not the settings). */
  private onKey(event: KeyboardEvent): void {
    const action = this.recording();
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.finish();
      return;
    }
    if (action === 'overlay') {
      this.takeOverlayKey(event);
      return;
    }
    if (event.key === 'Backspace') {
      this.shortcuts.assign(action, '');
      this.finish();
      return;
    }
    const combo = comboOf(event);
    if (!combo) {
      return;
    }
    this.shortcuts.assign(action, combo);
    this.finish();
  }

  /** The shortcut of the overlay is an Electron accelerator: at least one of Ctrl, Alt or Shift and a letter, a digit or an F key. */
  private takeOverlayKey(event: KeyboardEvent): void {
    const key = event.key.toUpperCase();
    const modifiers: string[] = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (modifiers.length === 0 || !/^(?:[A-Z0-9]|F[1-9]|F1[0-2])$/.test(key)) {
      return;
    }
    this.overlay.set({ hotkey: [...modifiers, key].join('+') });
    this.finish();
  }

  /** Stops waiting. */
  private finish(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    this.recording.set(null);
    this.shortcuts.recording = false;
  }
}
