/**
 * src/app/core/services/spinly.service.ts
 * Spinly inside Chatterly. The wheel and the tournament are native: they are made here, sent to a chat as a
 * message everybody can run once, or shared with a call where everybody can spin, edit and play as much as they
 * want. The separate Spinly app (the real one, with accounts, tournaments and themes) is still reachable in a frame
 * inside a panel, and linking its account brings its themes and presets in here. Chatterly only keeps the
 * colors and names of them, never the login.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { type SpinlyActivity } from '../../features/spinly/spinly-model';
import {
  freshSeed,
  isNewer,
  sanitizeCallState,
  sanitizeProfile,
  type CallSpinState,
} from '../../features/spinly/spinly-engine';
import type { SpinlyResult } from '../../features/spinly/spinly-result';
import { MessageStore } from '../../store/message.store';
import { describeError } from '../../shared/util/errors';
import { AuthService } from './auth.service';
import { CallService } from './call.service';
import { SettingsService } from './settings.service';
import { SoundService } from './sound.service';
import { ToastService } from './toast.service';

/** Where Spinly lives. */
const SPINLY_URL = 'https://spinly-psi.vercel.app/';
/** How long Spinly has to say hello inside the frame before the panel offers the separate window. */
const FRAME_TIMEOUT_MS = 3500;

/** What the panel is showing. */
export type FrameState = 'loading' | 'ready' | 'blocked';

/** A request to make a wheel or a tournament, and where it goes. */
export interface ComposeRequest {
  /** chat: the finished one is sent to the conversation. call: it is set up for everybody in the call. */
  purpose: 'chat' | 'call';
  channelId: string | null;
  /** What to start from when editing. */
  initial: SpinlyActivity | null;
}

/** Makes wheels and tournaments, shares them, and talks to the separate Spinly app. */
@Injectable({ providedIn: 'root' })
export class SpinlyService {
  private readonly settings = inject(SettingsService);
  private readonly messages = inject(MessageStore);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly call = inject(CallService);
  private readonly auth = inject(AuthService);
  private readonly sound = inject(SoundService);

  /** True while the panel with the real Spinly is open. */
  readonly panelOpen = signal(false);
  /** Whether the frame loaded, is still loading or was refused. */
  readonly frameState = signal<FrameState>('loading');
  /** The window where a wheel or a tournament is made, when it is open. */
  readonly composing = signal<ComposeRequest | null>(null);
  /** What the call is spinning right now (null before anyone starts). */
  readonly callState = signal<CallSpinState | null>(null);
  /** The wheel or tournament of the call, or null when there is none. */
  readonly callActivity = computed(this.pickCallActivity.bind(this));
  /** The linked account's themes and presets, or null. */
  readonly profile = this.settings.spinlyProfile;

  /** The address the frame loads (Spinly plus the origin of this app, so Spinly knows where to report to). */
  readonly frameUrl = SpinlyService.buildFrameUrl();
  /** Changes every time the frame has to be created again. */
  readonly frameNonce = signal(0);
  /** True while the panel was opened to link the account. */
  readonly linking = signal(false);

  /** The frame of the panel. */
  private frame: HTMLIFrameElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Starts listening to messages from Spinly and to the call. */
  constructor() {
    window.addEventListener('message', this.onMessage.bind(this));
    this.call.onSpinlyShared = this.onShared.bind(this);
    this.call.flushSpinly();
    this.call.spinlySnapshot = this.snapshot.bind(this);
    this.call.onSpinlyReset = this.resetCall.bind(this);
  }

  // ---- making wheels and tournaments ---------------------------------------------------------

  /** Opens the window to make a wheel or a tournament that will be sent to a conversation. */
  composeForChat(channelId: string): void {
    this.composing.set({ purpose: 'chat', channelId, initial: null });
  }

  /** Opens the window to set up (or edit) the wheel or tournament of the call. */
  composeForCall(): void {
    this.composing.set({ purpose: 'call', channelId: null, initial: this.callActivity() });
  }

  /** Closes the window without doing anything. */
  cancelCompose(): void {
    this.composing.set(null);
  }

  /** The window was confirmed: send it to the chat or set it up in the call. */
  finishCompose(activity: SpinlyActivity): void {
    const request = this.composing();
    this.composing.set(null);
    if (!request) {
      return;
    }
    if (request.purpose === 'call') {
      this.publish({ activity, spinSeq: 0, seed: 0, spins: [] });
      return;
    }
    if (request.channelId) {
      this.messages
        .sendSpinlyActivity(request.channelId, activity)
        .catch(this.showError.bind(this));
    }
  }

  // ---- the call ------------------------------------------------------------------------------

  /** The wheel or tournament of the call. */
  private pickCallActivity(): SpinlyActivity | null {
    return this.callState()?.activity ?? null;
  }

  /** Makes a change to what the call is spinning and tells everybody. */
  private publish(change: Partial<Omit<CallSpinState, 'rev' | 'by'>>): void {
    const held = this.callState();
    const next: CallSpinState = {
      activity: held?.activity ?? null,
      spinSeq: held?.spinSeq ?? 0,
      seed: held?.seed ?? 0,
      spins: held?.spins ?? [],
      ...change,
      rev: (held?.rev ?? 0) + 1,
      by: this.auth.userId,
    };
    this.callState.set(next);
    this.call.shareSpinly(next);
  }

  /** Spins the wheel of the call, or plays the next spin of the tournament, for everybody. */
  spinInCall(): void {
    const state = this.callState();
    if (!state?.activity) {
      return;
    }
    if (state.activity.kind === 'wheel') {
      this.publish({ spinSeq: state.spinSeq + 1, seed: freshSeed() });
    } else {
      this.publish({ spins: [...state.spins, { seed: freshSeed() }] });
    }
  }

  /** Starts the tournament of the call over, with a new draw. */
  restartInCall(): void {
    const state = this.callState();
    if (state?.activity?.kind !== 'tournament') {
      return;
    }
    const tournament = { ...state.activity.tournament, drawSeed: freshSeed() };
    this.publish({ activity: { kind: 'tournament', tournament }, spins: [] });
  }

  /** Takes the wheel or tournament off the call, for everybody. */
  closeInCall(): void {
    if (this.callState()?.activity) {
      this.publish({ activity: null, spinSeq: 0, seed: 0, spins: [] });
    }
  }

  /** Somebody in the call changed the wheel or tournament. */
  private onShared(_from: string, share: { state?: unknown; fresh?: boolean }): void {
    const incoming = sanitizeCallState(share.state);
    if (!incoming || !isNewer(incoming, this.callState())) {
      return;
    }
    const opened = !this.callState()?.activity && !!incoming.activity;
    this.callState.set(incoming);
    if (opened && share.fresh) {
      this.sound.play('open');
    }
  }

  /** What to tell somebody who just joined the call. */
  private snapshot(): unknown {
    const state = this.callState();
    return state?.activity ? state : null;
  }

  /** The call ended: the wheel is forgotten. */
  private resetCall(): void {
    this.callState.set(null);
    this.composing.update(function dropCall(request) {
      return request?.purpose === 'call' ? null : request;
    });
  }

  // ---- the real Spinly -----------------------------------------------------------------------

  /** The address of Spinly with the origin of Chatterly attached. */
  private static buildFrameUrl(): string {
    const url = new URL(SPINLY_URL);
    url.searchParams.set('chatterly', window.location.origin);
    url.searchParams.set('embed', '1');
    return url.toString();
  }

  /**
   * Opens the panel with the real Spinly (used to link the account).
   */
  open(): void {
    this.startLoading();
    this.panelOpen.set(true);
  }

  /** Starts waiting for Spinly to say hello inside the frame. */
  private startLoading(): void {
    this.frameState.set('loading');
    clearTimeout(this.timer);
    this.timer = setTimeout(this.onFrameTimeout.bind(this), FRAME_TIMEOUT_MS);
  }

  /** Loads the frame again (after it could not be shown). */
  reloadFrame(): void {
    this.startLoading();
    this.frameNonce.update(function next(n) {
      return n + 1;
    });
  }

  /** Closes the panel. */
  close(): void {
    this.panelOpen.set(false);
    this.linking.set(false);
    this.frame = null;
    clearTimeout(this.timer);
  }

  /** The panel hands over its frame, so messages can be checked against it. */
  attachFrame(frame: HTMLIFrameElement | null): void {
    this.frame = frame;
  }

  /** Spinly never said hello inside the frame: it refuses to be framed (or is not reachable). */
  private onFrameTimeout(): void {
    if (this.frameState() === 'loading') {
      this.frameState.set('blocked');
    }
  }

  // ---- linking the account -------------------------------------------------------------------

  /** Opens Spinly in the panel so the person can sign in and hand over their themes and presets. */
  linkAccount(): void {
    this.open();
    this.linking.set(true);
  }

  /** Asks the Spinly in the panel for the themes and presets of the person. */
  importProfile(): void {
    this.frame?.contentWindow?.postMessage(
      { source: 'chatterly', type: 'send-profile' },
      new URL(SPINLY_URL).origin,
    );
  }

  /** Forgets the themes and presets of the linked account. */
  unlinkAccount(): void {
    this.settings.spinlyProfile.set(null);
  }

  /** Handles a message from Spinly; anything from another window or origin is ignored. */
  private onMessage(event: MessageEvent): void {
    if (event.origin !== new URL(SPINLY_URL).origin) {
      return;
    }
    if (!this.frame || event.source !== this.frame.contentWindow) {
      return;
    }
    const data = event.data as {
      source?: string;
      type?: string;
      signedIn?: boolean;
      profile?: unknown;
    } | null;
    if (!data || data.source !== 'spinly') {
      return;
    }
    if (data.type === 'hello') {
      this.settings.spinlyAccount.set(data.signedIn ? 'in' : 'out');
      clearTimeout(this.timer);
      this.frameState.set('ready');
    } else if (data.type === 'profile') {
      this.onProfile(data.profile, !!data.signedIn);
    }
  }

  /** Spinly handed over the themes and presets of the account. */
  private onProfile(raw: unknown, signedIn: boolean): void {
    const profile = sanitizeProfile(raw, signedIn);
    if (!profile) {
      return;
    }
    this.settings.spinlyProfile.set(profile);
    this.settings.spinlyAccount.set(signedIn ? 'in' : 'out');
    this.toast.success(
      this.i18n.t('Spinly account linked'),
      this.i18n.t('{themes} themes and {presets} presets are ready to use.', {
        themes: profile.themes.length,
        presets: profile.presets.length,
      }),
    );
    if (this.linking()) {
      this.close();
    }
  }

  /** Posts a result of the call's wheel in the chat of the call. */
  sendCallResult(result: SpinlyResult): void {
    const roomId = this.call.roomId();
    if (!roomId) {
      return;
    }
    this.messages.sendSpinly(roomId, result).catch(this.showError.bind(this));
  }

  /** Tells the person that the result could not be sent. */
  private showError(error: unknown): void {
    this.toast.error(this.i18n.t('Could not send the result'), describeError(error));
  }
}
