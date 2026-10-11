/**
 * src/app/core/services/desktop-update.service.ts
 * Updates of the desktop app (Windows), shown inside the web app. In a browser or on a phone it does nothing.
 *
 * * The desktop shell looks for a new version and only tells; here the person sees it in the notifications of the bell,
 *   downloads it (with a progress bar) and then restarts to apply it. Nothing happens by itself.
 * ! The shell gives the page four fixed commands and one event (desktop/src/preload.cjs). There is no way to choose
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

/** What the desktop shell tells the page about the update. */
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string;
  percent: number;
  error: string;
}

/** The commands the desktop shell exposes (see desktop/src/preload.cjs). */
interface DesktopUpdates {
  getState(): Promise<DesktopUpdateState | null>;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  onState(callback: (state: DesktopUpdateState) => void): () => void;
}

declare global {
  interface Window {
    chatterlyDesktop?: { isDesktop: boolean; platform: string; updates?: DesktopUpdates };
  }
}

const INITIAL: DesktopUpdateState = { status: 'unavailable', version: '', percent: 0, error: '' };

/** The update of the desktop app: its state and the three things the person can do. */
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
  /** There is something to show in the notifications: a new version to download, being downloaded, or ready to apply. */
  readonly pending = computed(
    function (this: DesktopUpdateService) {
      const status = this.state().status;
      return status === 'available' || status === 'downloading' || status === 'ready';
    }.bind(this),
  );

  constructor() {
    if (!this.bridge) {
      return;
    }
    this.bridge.onState(this.apply.bind(this));
    this.bridge.getState().then(this.apply.bind(this), this.ignore);
  }

  /** Looks for a new version now (the Settings button). */
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
    // Once per version, a short notice that points to the bell.
    if (next.status === 'available' && next.version !== this.announced) {
      this.announced = next.version;
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

  private ignore(): void {
    // The shell did not answer: the page just keeps what it had.
  }
}
