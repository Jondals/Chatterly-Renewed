/**
 * src/app/core/services/native-call.service.ts
 * The calls of the Android app on the side of the system (only in the Android app; elsewhere it does nothing):
 *   - the notification of the call in progress, in the pull-down of the phone: who, how long, and mute, deafen and hang
 *     up (it replaces the floating panel of the call, which the phone does not show);
 *   - a call that rings while the app is minimized or the screen is off becomes a call notification with Answer and
 *     Decline (over the lock screen, with the ringtone of the phone);
 *   - staying connected in the background so calls can ring (Settings > Appearance > Performance);
 *   - where the voice sounds: earpiece, speaker, headset or Bluetooth;
 *   - screenshots: blocked everywhere except a chat or a call with contacts the person verified.
 *
 * ! The notifications never get a message or anything secret: a name (shown only on an unlocked phone) and yes/no
 *   values. What the buttons ask comes back as plain commands (mute, hangup...) that do what the buttons of the page do.
 */
import {
  DestroyRef,
  Injectable,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { I18nService } from '../i18n/i18n.service';
import { callPlugin, type AudioRoute, type CallAction, type CallPlugin } from '../native-bridge';
import { AuthService } from './auth.service';
import { CallService } from './call.service';
import { DirectoryService } from './directory.service';
import { SettingsService } from './settings.service';
import { persisted } from './persisted';
import { GuildStore } from '../../store/guild.store';
import { SocialStore } from '../../store/social.store';

/** Calls of the Android app: notifications, ringing in the background, audio route and screenshots. */
declare global {
  interface Window {
    /** Called by the app on a kept page when a new page takes its call (see handOver). */
    chatterlyHandOver?: () => string;
  }
}

@Injectable({ providedIn: 'root' })
export class NativeCallService {
  private readonly call = inject(CallService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly directory = inject(DirectoryService);
  private readonly social = inject(SocialStore);
  private readonly guilds = inject(GuildStore);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly plugin: CallPlugin | null = callPlugin();

  /** True in the Android app (the only place where this service does something). */
  readonly available = this.plugin !== null;
  /** Where the voice of the call can sound now, and where it sounds. */
  readonly routes = signal<AudioRoute[]>([]);
  readonly currentRoute = signal<string>('');
  /** The kind of route the person chose last (the next call starts there when it is available). */
  private readonly preferredRoute = persisted<'speaker' | 'earpiece'>('pref.audioRoute', 'speaker');

  /** Whether a ringing call may fill the screen over the lock screen (Android 14+ asks the person). */
  readonly fullScreenAllowed = signal(true);

  /** The page is on screen (not minimized, screen on). */
  private readonly visible = signal(!document.hidden);
  /** The address of the page (to know which chat is open). */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter(function ended(event): event is NavigationEnd {
        return event instanceof NavigationEnd;
      }),
      map(function address(event: NavigationEnd) {
        return event.urlAfterRedirects;
      }),
    ),
    { initialValue: this.router.url },
  );
  /** The room whose notification is showing (null: none). */
  private shownRoom: string | null = null;
  private ringingRoom: string | null = null;
  private lastSecure: boolean | null = null;

  /** The name the notification of the call shows: the other person of a direct chat, or the voice channel. */
  private readonly callTitle = computed(
    function (this: NativeCallService) {
      return this.titleOf(this.call.roomId());
    }.bind(this),
  );

  /** Whether screenshots are blocked now (see secureNow). */
  private readonly secure = computed(this.secureNow.bind(this));

  /** Starts following the call (only in the Android app). */
  constructor() {
    if (!this.plugin) {
      return;
    }
    document.addEventListener('visibilitychange', this.onVisibility.bind(this));
    effect(this.followCall.bind(this));
    effect(this.followIncoming.bind(this));
    effect(this.followSecure.bind(this));
    void this.plugin.addListener('action', this.onActionOutside.bind(this));
    void this.plugin.takePendingAction().then(this.onActionOutside.bind(this));
    // Swiping the app away keeps the call (CallKeeper.java): that kept page hands it over here, and this page takes it.
    window.chatterlyHandOver = this.handOver.bind(this);
    void this.takeRejoin(0);
    void this.plugin.notifications().catch(this.ignore);
    void this.checkFullScreen();
    inject(DestroyRef).onDestroy(this.stopAll.bind(this));
  }

  /** The page was hidden or shown again (coming back from the settings of Android, the permission may have changed). */
  private onVisibility(): void {
    this.visible.set(!document.hidden);
    if (!document.hidden) {
      void this.checkFullScreen();
    }
  }

  /** Reads whether a ringing call may fill the screen. */
  async checkFullScreen(): Promise<void> {
    try {
      this.fullScreenAllowed.set((await this.plugin?.fullScreen())?.allowed ?? true);
    } catch {
      this.fullScreenAllowed.set(true);
    }
  }

  /** Opens the page of Android where the person allows calls to fill the screen. */
  openFullScreenSettings(): void {
    void this.plugin?.fullScreenSettings().catch(this.ignore);
  }

  /** The notification of the call follows the call: it appears when it connects, changes with mute and deafen, and goes. */
  private followCall(): void {
    const plugin = this.plugin!;
    const room = this.call.status() === 'connected' ? this.call.roomId() : null;
    const muted = this.call.muted();
    const deafened = this.call.deafened();
    const title = this.callTitle();
    untracked(
      function (this: NativeCallService) {
        if (room && this.shownRoom !== room) {
          this.shownRoom = room;
          void plugin
            .call({ title, startedAt: this.call.connectedSince() || Date.now(), muted, deafened })
            .then(this.applyPreferredRoute.bind(this))
            .catch(this.ignore);
        } else if (room) {
          void plugin.update({ title, muted, deafened }).catch(this.ignore);
        } else if (this.shownRoom) {
          this.shownRoom = null;
          this.routes.set([]);
          void plugin.end().catch(this.ignore);
        }
      }.bind(this),
    );
  }

  /** A call that rings while the page is hidden becomes a call notification; it goes when the ringing stops. */
  private followIncoming(): void {
    const plugin = this.plugin!;
    const incoming = this.call.incoming();
    const hidden = !this.visible();
    untracked(
      function (this: NativeCallService) {
        if (incoming && hidden) {
          if (this.ringingRoom !== incoming.roomId) {
            this.ringingRoom = incoming.roomId;
            const caller = this.directory.get(incoming.from)?.displayName ?? '';
            void plugin.ring({ roomId: incoming.roomId, caller }).catch(this.ignore);
          }
        } else if (this.ringingRoom) {
          this.ringingRoom = null;
          void plugin.cancelRing().catch(this.ignore);
        }
      }.bind(this),
    );
  }

  /**
   * ! Screenshots are blocked (FLAG_SECURE) everywhere except where every other person shown is a contact the person
   * verified: a direct chat with a verified contact, or the screen of a call where every other participant is verified.
   * Settings, groups and lists stay blocked.
   */
  private secureNow(): boolean {
    const url = (this.url() ?? '').split(/[?#(]/)[0]!;
    const me = this.auth.user()?.id;
    if (url.startsWith('/voice')) {
      const others = this.call.participants().filter(function notMe(p) {
        return p.userId !== me;
      });
      return (
        others.length === 0 ||
        !others.every(
          function verified(this: NativeCallService, p: { userId: string }) {
            return this.directory.isVerified(p.userId);
          }.bind(this),
        )
      );
    }
    const direct = /^\/direct\/([^/]+)$/.exec(url);
    if (direct) {
      const dm = this.social.dmByChannel(decodeURIComponent(direct[1]!));
      return !dm || !this.directory.isVerified(dm.userId);
    }
    return true;
  }

  /** Tells the system whether screenshots are blocked, when that changes. */
  private followSecure(): void {
    const secure = this.secure();
    if (secure === this.lastSecure) {
      return;
    }
    this.lastSecure = secure;
    void this.plugin!.setSecure({ secure }).catch(this.ignore);
  }

  /** A button of a notification (it arrives outside Angular). */
  private onActionOutside(action: CallAction): void {
    this.zone.run(this.onAction.bind(this, action));
  }

  /** Does what a button of a notification asked, like the same button of the page. */
  private onAction(event: CallAction): void {
    switch (event.action) {
      case 'mute':
        this.call.toggleMute();
        break;
      case 'deafen':
        this.call.toggleDeafen();
        break;
      case 'hangup':
        void this.call.leave();
        break;
      case 'answer':
        if (event.roomId) {
          void this.router.navigateByUrl('/voice').then(this.join.bind(this, event.roomId));
        }
        break;
      case 'decline':
        if (!event.roomId || this.call.incoming()?.roomId === event.roomId) {
          this.call.dismissIncoming();
        }
        break;
      case 'show':
        if (this.call.inCall()) {
          void this.router.navigateByUrl('/voice');
        }
        break;
    }
  }

  /**
   * This page is a kept one and a new page of the app starts (the person opened it again after swiping it away): it stops
   * renewing the session and gives the id of its call, which the new page joins (the server moves the place of the person
   * there without taking them out of the call).
   */
  private handOver(): string {
    this.auth.freeze();
    return this.call.inCall() ? (this.call.roomId() ?? '') : '';
  }

  /** Asks whether a kept page handed a call over, and joins it (a few tries while the kept page answers). */
  private async takeRejoin(attempt: number): Promise<void> {
    if (!this.plugin?.takeRejoin) return;
    try {
      const answer = await this.plugin.takeRejoin();
      if (answer.waiting && attempt < 10) {
        setTimeout(this.takeRejoinLater.bind(this, attempt + 1), 500);
        return;
      }
      if (answer.roomId) {
        await this.waitForSession();
        this.zone.run(this.rejoin.bind(this, answer.roomId));
      }
    } catch {
      /* an older app: nothing was handed over */
    }
  }

  private takeRejoinLater(attempt: number): void {
    void this.takeRejoin(attempt);
  }

  /** Waits (up to 20 s) until somebody is signed in: the call cannot be joined before. */
  private async waitForSession(): Promise<void> {
    for (let i = 0; i < 40 && !this.auth.isAuthenticated(); i++) {
      await new Promise(function wait(resolve) {
        setTimeout(resolve, 500);
      });
    }
  }

  /** Joins the call that was handed over and tells the app (the kept page goes). */
  private async rejoin(roomId: string): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    await this.router.navigateByUrl('/voice');
    await this.call.join(roomId);
    void this.plugin?.rejoined?.().catch(this.ignore);
  }

  /** Joins the call that was answered from the notification. */
  private join(roomId: string): void {
    void this.call.join(roomId);
  }

  /** Reads where the voice can sound now. */
  async refreshRoutes(): Promise<void> {
    if (!this.plugin || !this.call.inCall()) {
      return;
    }
    try {
      const answer = await this.plugin.audioRoutes();
      this.routes.set(answer.routes);
      this.currentRoute.set(answer.current);
    } catch {
      this.routes.set([]);
    }
  }

  /** Sends the voice of the call to a route, and remembers the speaker or earpiece choice for the next calls. */
  async setRoute(route: AudioRoute): Promise<void> {
    if (!this.plugin) {
      return;
    }
    try {
      await this.plugin.setAudioRoute({ id: route.id });
      this.currentRoute.set(route.id);
      if (route.kind === 'speaker' || route.kind === 'earpiece') {
        this.preferredRoute.set(route.kind);
      }
    } catch {
      await this.refreshRoutes();
    }
  }

  /** At the start of a call: a headset if one is connected, otherwise the speaker or the earpiece chosen last time. */
  private async applyPreferredRoute(): Promise<void> {
    await this.refreshRoutes();
    const routes = this.routes();
    const order = ['bluetooth', 'wired', this.preferredRoute()];
    for (const kind of order) {
      const route = routes.find(function sameKind(r) {
        return r.kind === kind;
      });
      if (route) {
        await this.setRoute(route);
        return;
      }
    }
  }

  /** The label of a route for the person. */
  routeLabel(route: AudioRoute): string {
    const names: Record<AudioRoute['kind'], string> = {
      earpiece: 'Phone',
      speaker: 'Speaker',
      wired: 'Headphones',
      bluetooth: 'Bluetooth',
    };
    const label = this.i18n.t(names[route.kind]);
    return route.kind === 'bluetooth' && route.name ? label + ' · ' + route.name : label;
  }

  /** The name of a call: the other person of a direct chat, or the voice channel of a group. */
  private titleOf(roomId: string | null): string {
    if (!roomId) {
      return '';
    }
    const dm = this.social.dmByChannel(roomId);
    if (dm) {
      return this.directory.get(dm.userId)?.displayName ?? '';
    }
    const guild = this.guilds.guildOfChannel(roomId);
    const channel = guild?.channels.find(function same(c) {
      return c.id === roomId;
    });
    return channel ? channel.name + (guild?.name ? ' · ' + guild.name : '') : '';
  }

  /** The page goes away: nothing stays connected or showing for it. */
  private stopAll(): void {
    void this.plugin?.end().catch(this.ignore);
  }

  /** A refusal of the system only means that part does not work on this phone. */
  private ignore(): void {
    return;
  }
}
