/**
 * src/app/core/services/desktop-update.service.ts
 * Updates of the desktop app (Windows), shown inside the web app. In a browser or on a phone it does nothing.
 *
 * * The desktop shell looks for a new version and only tells; here the person sees it in the notifications of the bell
 *   (if they want notices) and in Settings > Updates, downloads it (with a progress bar) and then restarts to apply it.
 *   Nothing happens by itself. How often it looks and whether it tells are chosen in Settings > Updates.
 * ! The shell gives the page a few fixed commands and one event (desktop/src/preload.cjs). There is no way to choose
 *   a file or an address from here.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { ToastService } from './toast.service';

/** 'unavailable': this build does not update itself (a browser, the Store version). 'none': already the latest. */
export type DesktopUpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'none'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

/** How often the app looks for a new version: every hour/6/12/24 hours, only when it starts, or only when asked. */
export type UpdateInterval = '1h' | '6h' | '12h' | '24h' | 'start' | 'never';

/** The two choices of the person. */
export interface DesktopUpdateSettings {
  interval: UpdateInterval;
  notify: boolean;
}

/** What the desktop shell tells the page about the update. */
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string;
  /** Download progress, 0 to 100. */
  percent: number;
  /** Bytes downloaded, bytes in all and bytes per second (0 when unknown). */
  transferred: number;
  total: number;
  bytesPerSecond: number;
  error: string;
  /** When the last check ended (milliseconds), or 0 if there has not been one. */
  lastCheck: number;
  settings: DesktopUpdateSettings;
}

/** The commands the desktop shell exposes (see desktop/src/preload.cjs). */
interface DesktopUpdates {
  getState(): Promise<DesktopUpdateState | null>;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  setSettings(settings: Partial<DesktopUpdateSettings>): Promise<DesktopUpdateState>;
  onState(callback: (state: DesktopUpdateState) => void): () => void;
}

declare global {
  interface Window {
    chatterlyDesktop?: { isDesktop: boolean; platform: string; updates?: DesktopUpdates };
  }
}

const INITIAL: DesktopUpdateState = {
  status: 'unavailable',
  version: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  error: '',
  lastCheck: 0,
  settings: { interval: '6h', notify: true },
};

/** The update of the desktop app: its state and the things the person can do. */
@Injectable({ providedIn: 'root' })
export class DesktopUpdateService {
  private readonly bridge: DesktopUpdates | undefined =
    typeof window === 'undefined' ? undefined : window.chatterlyDesktop?.updates;
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private announced = '';

  /** True inside the desktop app (and it can update itself). */
  readonly supported = Boolean(this.bridge);
  readonly state = signal<DesktopUpdateState>(INITIAL);
  /** The version the person pressed "Later" on: the bell card stays hidden until a newer one or until it is downloaded. */
  private readonly postponed = signal('');
  /** A new version to download, being downloaded, or ready to apply. */
  readonly pending = computed(
    function (this: DesktopUpdateService) {
      const status = this.state().status;
      return status === 'available' || status === 'downloading' || status === 'ready';
    }.bind(this),
  );
  /** The card of the bell: something is pending, the person wants notices, and it was not put off. */
  readonly bellCard = computed(
    function (this: DesktopUpdateService) {
      const state = this.state();
      if (!this.pending() || !state.settings.notify) {
        return false;
      }
      return state.status !== 'available' || this.postponed() !== state.version;
    }.bind(this),
  );
  /** A failed download, to show in the bell (only when the person wants notices). */
  readonly bellError = computed(
    function (this: DesktopUpdateService) {
      return this.state().status === 'error' && this.state().settings.notify;
    }.bind(this),
  );

  constructor() {
    if (!this.bridge) {
      return;
    }
    this.bridge.onState(this.apply.bind(this));
    this.bridge.getState().then(this.apply.bind(this), this.ignore);
  }

  /** Looks for a new version now. */
  check(): void {
    this.run(this.bridge?.check());
  }

  /** Downloads the new version. */
  download(): void {
    this.run(this.bridge?.download());
  }

  /** Closes the app, installs the downloaded version and opens it again. */
  install(): void {
    this.run(this.bridge?.install());
  }

  /** Hides the card of the bell for this version (it stays in Settings > Updates). */
  later(): void {
    this.postponed.set(this.state().version);
  }

  /** Changes how often it looks and whether it tells the person. */
  setSettings(patch: Partial<DesktopUpdateSettings>): void {
    this.run(this.bridge?.setSettings(patch));
  }

  /** "98 MB" for a number of bytes. */
  megabytes(bytes: number): string {
    return Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB';
  }

  private run(result: Promise<DesktopUpdateState> | undefined): void {
    if (result) {
      result.then(this.apply.bind(this), this.ignore);
    }
  }

  private apply(next: DesktopUpdateState | null): void {
    if (!next) {
      return;
    }
    this.state.set(next);
    // Once per version, a short notice that points to the bell (if the person wants notices).
    if (next.status === 'available' && next.version !== this.announced) {
      this.announced = next.version;
      if (next.settings.notify) {
        this.toast.show(
          {
            kind: 'info',
            icon: '⬆️',
            title: this.i18n.t('A new version is available'),
            body: this.i18n.t('Open the notifications (the bell) to update.'),
          },
          6000,
        );
      }
    }
  }

  private ignore(): void {
    // The shell did not answer: the page just keeps what it had.
  }
}
