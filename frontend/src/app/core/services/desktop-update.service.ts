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
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import {
  desktopBridge,
  type DesktopUpdateSettings,
  type DesktopUpdates,
  type DesktopUpdateState,
} from '../desktop-bridge';
import { BetaService } from './beta.service';
import { ToastService } from './toast.service';

/** How often the token of the beta channel is renewed (it lasts two hours). */
const TOKEN_RENEW_MS = 30 * 60 * 1000;
/** After a failed token request: 5 s, then 10, 20... up to two minutes (the server allows 30 a minute). */
const TOKEN_RETRY_MS = 5000;
const TOKEN_RETRY_MAX_MS = 2 * 60 * 1000;

const INITIAL: DesktopUpdateState = {
  status: 'unavailable',
  version: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  error: '',
  lastCheck: 0,
  settings: { interval: '6h', notify: true, auto: false, beta: false },
};

export type {
  DesktopUpdateSettings,
  DesktopUpdateState,
  DesktopUpdateStatus,
  UpdateInterval,
} from '../desktop-bridge';

/** The update of the desktop app: its state and the things the person can do. */
@Injectable({ providedIn: 'root' })
export class DesktopUpdateService {
  private readonly bridge: DesktopUpdates | undefined = desktopBridge()?.updates;
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly betaProgram = inject(BetaService);
  private announced = '';
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Failed token requests in a row (the wait before the next one doubles). */
  private tokenFailures = 0;

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
  /** The shell needs the beta token: the account is a tester (or an administrator) and the beta channel is on. */
  private readonly wantsBetaToken = computed(
    function (this: DesktopUpdateService) {
      return (
        this.betaProgram.known() && this.betaProgram.canUseBeta() && this.state().settings.beta
      );
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
    effect(this.leaveBeta.bind(this));
    effect(this.syncBetaToken.bind(this));
    this.bridge.getState().then(this.apply.bind(this), this.ignore);
  }

  /** An account that is not (or no longer) a tester must not keep receiving the beta versions. */
  private leaveBeta(): void {
    if (this.betaProgram.known() && !this.betaProgram.canUseBeta() && this.state().settings.beta) {
      this.setSettings({ beta: false });
    }
  }

  /**
   * The beta channel needs the server to know who asks: while the account is a tester and the channel is on, the shell gets a token
   * of the account (renewed every half hour); otherwise it is told to forget it.
   * ! It follows `wantsBetaToken` (a boolean), never the whole state: every answer of the shell is a new state, and following it
   *   asked for a new token on each one, a loop that used up the limit of the server (429) and left the shell without a token.
   */
  private syncBetaToken(): void {
    const wanted = this.wantsBetaToken();
    untracked(this.followToken.bind(this, wanted));
  }

  private followToken(wanted: boolean): void {
    if (this.tokenTimer !== null) {
      clearTimeout(this.tokenTimer);
      this.tokenTimer = null;
    }
    this.tokenFailures = 0;
    if (!wanted) {
      this.bridge?.setBetaToken(null).catch(this.ignore);
      return;
    }
    this.sendToken();
  }

  private sendToken(): void {
    this.tokenTimer = null;
    this.betaProgram.feedToken().then(this.giveToken.bind(this), this.tokenFailed.bind(this));
  }

  private giveToken(answer: { token: string; expiresAt: number }): void {
    this.tokenFailures = 0;
    this.nextToken(TOKEN_RENEW_MS);
    this.run(this.bridge?.setBetaToken(answer));
  }

  /** The server did not give the token (offline, too many requests): tries again later, waiting longer each time. */
  private tokenFailed(): void {
    this.tokenFailures++;
    this.nextToken(Math.min(TOKEN_RETRY_MAX_MS, TOKEN_RETRY_MS * 2 ** (this.tokenFailures - 1)));
  }

  private nextToken(delay: number): void {
    if (this.tokenTimer !== null) clearTimeout(this.tokenTimer);
    if (!untracked(this.wantsBetaToken)) {
      this.tokenTimer = null;
      return;
    }
    this.tokenTimer = setTimeout(this.sendToken.bind(this), delay);
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
