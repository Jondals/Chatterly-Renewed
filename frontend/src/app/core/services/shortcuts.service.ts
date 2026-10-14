/**
 * src/app/core/services/shortcuts.service.ts
 * Keyboard shortcuts for the call (mute, deafen, camera, screen, hang up, soundboard). The person can change each
 * combination in Settings. A web page only receives keys while it has the focus, so these work while the Chatterly
 * tab is the one in front.
 */
import { Injectable, inject } from '@angular/core';
import { CallService } from './call.service';
import { SettingsService } from './settings.service';
import { UiService } from './ui.service';

/** The actions that can have a shortcut. */
export type ShortcutAction = 'mute' | 'deafen' | 'camera' | 'screen' | 'hangup' | 'soundboard';

/** What each action is called in Settings, in order. */
export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; icon: string }[] = [
  { id: 'mute', label: 'Mute or unmute', icon: 'mic' },
  { id: 'deafen', label: 'Deafen or undeafen', icon: 'headphones' },
  { id: 'camera', label: 'Camera on or off', icon: 'video' },
  { id: 'screen', label: 'Start or stop sharing the screen', icon: 'monitor' },
  { id: 'soundboard', label: 'Open the soundboard', icon: 'waveform' },
  { id: 'hangup', label: 'Hang up', icon: 'phone' },
];

/** The combinations every action has until the person changes it. */
const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  mute: 'Alt+Shift+M',
  deafen: 'Alt+Shift+D',
  camera: 'Alt+Shift+C',
  screen: 'Alt+Shift+S',
  soundboard: 'Alt+Shift+B',
  hangup: 'Alt+Shift+H',
};

/** The combination a key press makes, written like "Ctrl+Alt+Shift+M" (empty for a press of a modifier alone). */
export function comboOf(event: KeyboardEvent): string {
  let key = event.code;
  if (/^Key[A-Z]$/.test(key)) {
    key = key.slice(3);
  } else if (/^Digit[0-9]$/.test(key)) {
    key = key.slice(5);
  } else if (
    [
      'ControlLeft',
      'ControlRight',
      'AltLeft',
      'AltRight',
      'ShiftLeft',
      'ShiftRight',
      'MetaLeft',
      'MetaRight',
    ].includes(key)
  ) {
    return '';
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** Listens to the keyboard and runs the action whose combination was pressed. */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly settings = inject(SettingsService);
  private readonly call = inject(CallService);
  private readonly ui = inject(UiService);
  private readonly handler = this.onKey.bind(this);
  /** True while Settings waits for a new combination, so the shortcuts do not fire meanwhile. */
  recording = false;

  /** Starts listening (once per session). */
  start(): void {
    window.removeEventListener('keydown', this.handler, true);
    window.addEventListener('keydown', this.handler, true);
  }

  /** The current combination of an action (empty when it has none). */
  comboFor(action: ShortcutAction): string {
    const own = this.settings.shortcuts()[action];
    return own === undefined ? DEFAULT_SHORTCUTS[action] : own;
  }

  /** Gives an action a combination; another action that had it loses it. */
  assign(action: ShortcutAction, combo: string): void {
    const next: Record<string, string> = {};
    for (const entry of SHORTCUT_ACTIONS) {
      next[entry.id] = this.comboFor(entry.id);
    }
    if (combo) {
      for (const entry of SHORTCUT_ACTIONS) {
        if (entry.id !== action && next[entry.id] === combo) {
          next[entry.id] = '';
        }
      }
    }
    next[action] = combo;
    this.settings.shortcuts.set(next);
  }

  /** Goes back to the combinations the actions had at the start. */
  reset(): void {
    this.settings.shortcuts.set({});
  }

  /** A key was pressed. */
  private onKey(event: KeyboardEvent): void {
    if (this.recording || event.repeat) {
      return;
    }
    const combo = comboOf(event);
    if (!combo) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    if (typing && !/^(Ctrl|Alt|Meta)/.test(combo) && !/^F\d+$/.test(combo)) {
      return;
    }
    // A bare Space or Enter on a button is the way to press that button, not a shortcut.
    if (
      !combo.includes('+') &&
      (combo === 'Space' || combo === 'Enter') &&
      target?.closest('button, a, [role="button"]')
    ) {
      return;
    }
    for (const entry of SHORTCUT_ACTIONS) {
      if (this.comboFor(entry.id) === combo) {
        event.preventDefault();
        event.stopPropagation();
        this.run(entry.id);
        return;
      }
    }
  }

  /** Does what an action says (call actions only do something during a call). */
  private run(action: ShortcutAction): void {
    if (action === 'soundboard') {
      this.ui.soundboardAnchor.set(null);
      this.ui.soundboardOpen.set(!this.ui.soundboardOpen());
      return;
    }
    if (!this.call.inCall()) {
      return;
    }
    switch (action) {
      case 'mute':
        this.call.toggleMute();
        break;
      case 'deafen':
        this.call.toggleDeafen();
        break;
      case 'camera':
        void this.call.toggleCamera();
        break;
      case 'screen':
        void this.call.toggleScreen();
        break;
      default:
        this.call.leave();
        break;
    }
  }
}
