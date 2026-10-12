/**
 * src/app/layout/main-layout.component.ts
 * Structure of the private area: side bars, content and the realtime services.
 */
import { Component, OnInit, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { I18nService } from '../core/i18n/i18n.service';
import { CallService } from '../core/services/call.service';
import { NameFontShareService } from '../core/services/name-font-share.service';
import { ShortcutsService } from '../core/services/shortcuts.service';
import { SocketService } from '../core/services/socket.service';
import { UiService } from '../core/services/ui.service';
import { SpinlyPanelComponent } from '../features/spinly/spinly-panel.component';
import { VoiceStageComponent } from '../features/voice/voice-stage.component';
import { GuildModalsComponent } from '../features/guild/guild-modals.component';
import { preloadEmojiData } from '../shared/util/emoji-data';
import { GuildStore } from '../store/guild.store';
import { MessageStore } from '../store/message.store';
import { SocialStore } from '../store/social.store';
import { CallDockComponent } from './call-dock.component';
import { ContextMenuComponent } from './context-menu.component';
import { ContextSidebarComponent } from './context-sidebar.component';
import { IncomingCallComponent } from './incoming-call.component';
import { ProfileModalComponent } from './profile-modal.component';
import { RailComponent } from './rail.component';
import { SoundboardDockComponent } from './soundboard-dock.component';

/** How long the app waits before it prepares the emoji list (ms). */
const EMOJI_WARM_UP_MS = 6000;

/**
 * The signed-in shell: group rail, context sidebar and the routed page. It also boots the realtime
 * layer (socket + stores) exactly once per session.
 */
@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RailComponent,
    ContextSidebarComponent,
    IncomingCallComponent,
    CallDockComponent,
    SoundboardDockComponent,
    ContextMenuComponent,
    ProfileModalComponent,
    GuildModalsComponent,
    SpinlyPanelComponent,
    VoiceStageComponent,
  ],
  template: `
    <div
      class="flex h-[var(--app-h,100dvh)] gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] max-sm:p-1 max-sm:pb-[max(0.125rem,calc(env(safe-area-inset-bottom)*0.45))] max-sm:pl-[max(0.25rem,env(safe-area-inset-left))] max-sm:pr-[max(0.25rem,env(safe-area-inset-right))] max-sm:pt-[max(0.25rem,env(safe-area-inset-top))]"
    >
      <!-- On narrow screens the navigation becomes a slide-in drawer -->
      @if (ui.sidebarOpen()) {
        <div
          class="anim-fade-in fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          (click)="ui.sidebarOpen.set(false)"
        ></div>
      }
      <div
        class="z-40 flex gap-2 transition-transform duration-300 max-lg:fixed max-lg:inset-y-2 max-lg:left-2"
        [class.max-lg:-translate-x-[120%]]="!ui.sidebarOpen()"
      >
        <app-rail />
        <app-context-sidebar />
      </div>
      <!-- The panel surface lives here, so there is never a moment without it while one page replaces another. -->
      <main class="panel panel-glass relative min-w-0 flex-1 overflow-hidden">
        <router-outlet />
        <!-- The call stays alive while its page is hidden, so the music, the video and Spinly never stop. -->
        @if (call.roomId() || onVoice()) {
          @defer (on immediate) {
            <app-voice-stage class="absolute inset-0" [style.display]="onVoice() ? null : 'none'" />
          }
        }
      </main>
    </div>
    <router-outlet name="settings" />
    <app-call-dock />
    <app-incoming-call />
    @defer (on idle) {
      <app-guild-modals />
    }
    <app-soundboard-dock />
    <app-context-menu />
    <app-profile-modal />
    @defer (on idle) {
      <app-spinly-panel />
    }
  `,
})
export class MainLayoutComponent implements OnInit {
  /** The keyboard shortcuts of the call work everywhere in the private area. */
  private readonly shortcuts = inject(ShortcutsService);
  /** Shares the own name font with friends and opens theirs (it works by itself once it exists). */
  private readonly nameFonts = inject(NameFontShareService);

  private readonly router = inject(Router);
  /** True while the page of the call is the one on screen. */
  protected readonly onVoice = toSignal(
    this.router.events.pipe(
      filter(function ended(event) {
        return event instanceof NavigationEnd;
      }),
      map(
        function isVoice(this: MainLayoutComponent) {
          return this.router.url.startsWith('/voice');
        }.bind(this),
      ),
    ),
    { initialValue: this.router.url.startsWith('/voice') },
  );

  protected readonly ui = inject(UiService);
  private readonly socket = inject(SocketService);
  private readonly social = inject(SocialStore);
  private readonly guilds = inject(GuildStore);
  private readonly messages = inject(MessageStore);
  protected readonly call = inject(CallService);
  private readonly i18n = inject(I18nService);

  /** Asks the emoji list in advance, when the browser has nothing else to do. */
  private warmEmoji(): void {
    const idle = (
      window as Window & {
        requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const task = preloadEmojiData.bind(null, this.i18n.lang());
    if (idle) {
      idle.call(window, task, { timeout: 20000 });
    } else {
      task();
    }
  }

  /**
   * Starts everything the signed-in app needs: friends, groups, messages, calls, shortcuts and the connection, and warms up the emoji list.
   */
  ngOnInit(): void {
    this.social.start();
    this.guilds.start();
    this.messages.start();
    this.call.start();
    this.shortcuts.start();
    // ! Not at the start: the list (and the font pieces it checks) is a big job, so it waits until the app has settled and the browser is idle.
    setTimeout(this.warmEmoji.bind(this), EMOJI_WARM_UP_MS);
    this.socket.connect();
    // Initial data in parallel with the socket handshake.
    void this.social.refresh().catch(function () {
      return undefined;
    });
    void this.guilds.refresh();
  }
}
