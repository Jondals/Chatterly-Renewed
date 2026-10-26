/**
 * src/app/layout/context-sidebar.component.ts
 * Side bar: friends, direct messages or the channels of the group, and the user panel with its menu.
 */
import { ChannelLabelPipe } from '../shared/util/channel-label.pipe';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { I18nService, TranslatePipe } from '../core/i18n/i18n.service';
import { ToastService } from '../core/services/toast.service';
import { describeError } from '../shared/util/errors';
import type { GuildChannel, SelfPresence, User } from '../core/models';
import { ContextMenuService, type MenuItem } from '../core/services/context-menu.service';
import { DialogService } from '../core/services/dialog.service';
import { AuthService } from '../core/services/auth.service';
import { CallService } from '../core/services/call.service';
import { DesktopUpdateService } from '../core/services/desktop-update.service';
import { AndroidUpdateService } from '../core/services/android-update.service';
import { DirectoryService } from '../core/services/directory.service';
import { UiService } from '../core/services/ui.service';
import { AvatarComponent } from '../shared/components/avatar.component';
import { NameColorDirective } from '../shared/util/name-color.directive';
import { IconComponent } from '../shared/components/icon.component';
import { GuildStore } from '../store/guild.store';
import { MessageStore } from '../store/message.store';
import { SocialStore } from '../store/social.store';

const STATUSES: { id: SelfPresence; label: string; color: string }[] = [
  { id: 'online', label: 'Online', color: '#2ef2b0' },
  { id: 'idle', label: 'Idle', color: '#fbbf24' },
  { id: 'dnd', label: 'Do not disturb', color: '#ef4444' },
  { id: 'invisible', label: 'Invisible', color: '#6b7280' },
];

/** The column next to the rail: Home (friends + DMs) or the channels of the selected group. */
import { UserFontDirective } from '../shared/util/user-font.directive';
import { NameFxDirective } from '../shared/util/name-fx.directive';
import { fontClassOf } from '../shared/util/user-font.directive';
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-context-sidebar',
  standalone: true,
  imports: [
    UserFontDirective,
    NameFxDirective,
    NameColorDirective,
    ChannelLabelPipe,
    RouterLink,
    RouterLinkActive,
    AvatarComponent,
    IconComponent,
    TranslatePipe,
  ],
  template: `
    <aside
      class="surface flex h-full w-[17.5rem] select-none flex-col overflow-hidden rounded-ui-lg border border-white/6"
    >
      @if (inGroup() && guilds.activeGuild(); as g) {
        <!-- Group header with menu -->
        <div class="side-head relative border-b border-white/6">
          <button
            type="button"
            class="flex h-14 w-full items-center gap-2.5 px-4 text-left hover:bg-white/5"
            (mousedown)="$event.stopPropagation()"
            (click)="groupMenu.set(!groupMenu())"
          >
            <span class="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{{ g.name }}</span>
            <app-icon
              name="chevron-down"
              [size]="16"
              class="text-muted transition-transform duration-300"
              [class.rotate-180]="groupMenu()"
            />
          </button>
          @if (groupMenu()) {
            <div
              class="panel menu-down absolute inset-x-2 top-12 z-30 p-1.5"
              (mousedown)="$event.stopPropagation()"
            >
              <button
                class="menu-card anim-fade-up"
                style="--d: 0ms"
                type="button"
                (click)="openInvite()"
              >
                <span class="menu-icon bg-accent/15 text-accent"
                  ><app-icon name="user-plus" [size]="17"
                /></span>
                <span class="min-w-0 flex-1"
                  ><b class="block text-sm">{{ 'Invite people' | t }}</b
                  ><span class="block text-[0.6875rem] text-muted">{{
                    'Friends get the group key' | t
                  }}</span></span
                >
              </button>
              @if (guilds.isOwner(g)) {
                <button
                  class="menu-card anim-fade-up"
                  style="--d: 35ms"
                  type="button"
                  (click)="openAddChannel('text')"
                >
                  <span class="menu-icon bg-sky/15 text-sky"
                    ><app-icon name="hash" [size]="17"
                  /></span>
                  <span class="min-w-0 flex-1"
                    ><b class="block text-sm">{{ 'Create text channel' | t }}</b
                    ><span class="block text-[0.6875rem] text-muted">{{
                      'Messages, files and GIFs' | t
                    }}</span></span
                  >
                </button>
                <button
                  class="menu-card anim-fade-up"
                  style="--d: 70ms"
                  type="button"
                  (click)="openAddChannel('voice')"
                >
                  <span class="menu-icon bg-coral/15 text-coral"
                    ><app-icon name="volume" [size]="17"
                  /></span>
                  <span class="min-w-0 flex-1"
                    ><b class="block text-sm">{{ 'Create voice channel' | t }}</b
                    ><span class="block text-[0.6875rem] text-muted">{{
                      'Talk, video and share your screen' | t
                    }}</span></span
                  >
                </button>
              }
              <button
                class="menu-card anim-fade-up"
                style="--d: 105ms"
                type="button"
                (click)="openGuildSettings()"
              >
                <span class="menu-icon bg-amber/15 text-amber"
                  ><app-icon name="settings" [size]="17"
                /></span>
                <span class="min-w-0 flex-1"
                  ><b class="block text-sm">{{ 'Group settings' | t }}</b
                  ><span class="block text-[0.6875rem] text-muted">{{
                    'Name, icon, channels and keys' | t
                  }}</span></span
                >
              </button>
            </div>
          }
        </div>

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-3">
          <section>
            <div class="mb-2.5 flex items-center justify-between px-2.5">
              <span class="section-title section-text"
                ><app-icon name="hash" [size]="13" /> {{ 'Text channels' | t }}</span
              >
              @if (guilds.isOwner(g)) {
                <button
                  class="tip text-dim hover:text-accent"
                  [attr.data-tip]="'Create text channel' | t"
                  type="button"
                  (click)="ui.addChannelOpen.set('text')"
                >
                  <app-icon name="plus" [size]="15" />
                </button>
              }
            </div>
            @for (c of textChannels(); track c.id) {
              <a
                [routerLink]="['/groups', g.id, c.id]"
                routerLinkActive="active"
                class="nav-item chan-item chan-text"
                [class.chan-drop]="dragOver() === c.id"
                [class.chan-drag]="dragging() === c.id"
                [attr.draggable]="guilds.isOwner(g) ? 'true' : null"
                (click)="ui.sidebarOpen.set(false)"
                (contextmenu)="openChannelMenu($event, g.id, c)"
                (dragstart)="startDrag($event, c)"
                (dragover)="overChannel($event, c)"
                (drop)="dropChannel($event, g.id, c)"
                (dragend)="endDrag()"
              >
                <app-icon name="hash" [size]="17" class="nav-icon" />
                <span
                  class="min-w-0 flex-1 truncate"
                  [class.font-semibold]="messages.unread()[c.id]"
                  [class.text-fg]="messages.unread()[c.id]"
                  >{{ c.name | channelLabel }}</span
                >
                @if (messages.unread()[c.id]; as n) {
                  <span class="badge badge-red">{{ n }}</span>
                }
              </a>
            }
          </section>

          <section>
            <div class="mb-2.5 flex items-center justify-between px-2.5">
              <span class="section-title section-voice"
                ><app-icon name="volume" [size]="13" /> {{ 'Voice channels' | t }}</span
              >
              @if (guilds.isOwner(g)) {
                <button
                  class="tip text-dim hover:text-accent"
                  [attr.data-tip]="'Create voice channel' | t"
                  type="button"
                  (click)="ui.addChannelOpen.set('voice')"
                >
                  <app-icon name="plus" [size]="15" />
                </button>
              }
            </div>
            @for (c of voiceChannels(); track c.id) {
              <button
                type="button"
                class="nav-item chan-item chan-voice"
                [class.active]="call.roomId() === c.id"
                [class.chan-drop]="dragOver() === c.id"
                [class.chan-drag]="dragging() === c.id"
                [attr.draggable]="guilds.isOwner(g) ? 'true' : null"
                (click)="joinVoice(c)"
                (contextmenu)="openChannelMenu($event, g.id, c)"
                (dragstart)="startDrag($event, c)"
                (dragover)="overChannel($event, c)"
                (drop)="dropChannel($event, g.id, c)"
                (dragend)="endDrag()"
              >
                <app-icon name="volume" [size]="17" class="nav-icon" />
                <span class="min-w-0 flex-1 truncate">{{ c.name | channelLabel }}</span>
                @if (occupants(c.id).length) {
                  <span class="text-[0.6875rem] text-muted">{{ occupants(c.id).length }}</span>
                }
              </button>
              @if (occupants(c.id).length) {
                <div class="mb-2 ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-white/8 pl-3">
                  @for (id of occupants(c.id); track id) {
                    <div
                      class="flex items-center gap-3 rounded-ui px-2.5 py-1.5 text-[0.8125rem] text-muted transition-colors hover:bg-white/5 hover:text-fg"
                    >
                      <app-avatar
                        [user]="directory.get(id)"
                        [size]="24"
                        [speaking]="call.speaking().has(id)"
                      />
                      <span
                        class="min-w-0 flex-1 truncate"
                        [appNameColor]="directory.get(id)?.profileColor"
                        [appUserFont]="directory.get(id)?.nameFont"
                        [nameFx]="directory.get(id)?.nameFx"
                        >{{ directory.get(id)?.displayName }}</span
                      >
                    </div>
                  }
                </div>
              }
            }
            @if (!voiceChannels().length) {
              <p class="px-3 py-1 text-xs text-dim">{{ 'No voice channels yet.' | t }}</p>
            }
          </section>
        </div>
      } @else {
        <!-- Home -->
        <div class="flex h-14 items-center justify-between border-b border-white/6 px-4">
          <span class="text-[0.9375rem] font-bold">{{ 'Home' | t }}</span>
          <div class="relative">
            <button
              type="button"
              class="btn btn-icon btn-sm btn-ghost relative tip"
              [attr.data-tip]="'Notifications' | t"
              (mousedown)="$event.stopPropagation()"
              (click)="toggleBell($event)"
            >
              <app-icon name="bell" [size]="17" />
              @if (notificationCount() > 0) {
                <span class="badge badge-red absolute -right-1 -top-1">{{
                  notificationCount()
                }}</span>
              }
            </button>
            @if (bell()) {
              <div
                class="panel anim-pop fixed z-[90] w-[min(18rem,calc(100vw-1.5rem))] p-2 shadow-2xl"
                [style.top.px]="bellPos().top"
                [style.left.px]="bellPos().left"
                (mousedown)="$event.stopPropagation()"
              >
                <div class="label px-2 py-1.5">{{ 'Notifications' | t }}</div>
                @if (desktopUpdate.bellCard()) {
                  <div class="mb-1 rounded-ui border border-white/8 bg-white/4 p-3">
                    <div class="flex items-center gap-3">
                      <span
                        class="grid h-9 w-9 shrink-0 place-items-center rounded-ui bg-accent/15 text-accent"
                      >
                        <app-icon name="download" [size]="18" />
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold">
                          {{ 'A new version is available' | t }}
                        </div>
                        <div class="text-xs text-muted">
                          {{ 'Chatterly {v}' | t: { v: desktopUpdate.state().version } }}
                          @if (desktopUpdate.state().total > 0) {
                            · {{ desktopUpdate.megabytes(desktopUpdate.state().total) }}
                          }
                        </div>
                      </div>
                    </div>
                    @switch (desktopUpdate.state().status) {
                      @case ('available') {
                        <div class="mt-3 flex gap-2">
                          <button
                            type="button"
                            class="btn btn-sm btn-primary flex-1"
                            (click)="desktopUpdate.download()"
                          >
                            <app-icon name="download" [size]="15" /> {{ 'Download' | t }}
                          </button>
                          <button
                            type="button"
                            class="btn btn-sm btn-ghost"
                            (click)="desktopUpdate.later()"
                          >
                            {{ 'Later' | t }}
                          </button>
                        </div>
                      }
                      @case ('downloading') {
                        <div
                          class="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
                          role="progressbar"
                          [attr.aria-valuenow]="desktopUpdate.state().percent"
                          aria-valuemin="0"
                          aria-valuemax="100"
                        >
                          <div
                            class="h-full rounded-full bg-accent transition-all"
                            [style.width.%]="desktopUpdate.state().percent"
                          ></div>
                        </div>
                        <div class="mt-1.5 flex justify-between text-xs text-muted">
                          <span>{{
                            'Downloading… {n}%' | t: { n: desktopUpdate.state().percent }
                          }}</span>
                          @if (desktopUpdate.state().total > 0) {
                            <span
                              >{{ desktopUpdate.megabytes(desktopUpdate.state().transferred) }} /
                              {{ desktopUpdate.megabytes(desktopUpdate.state().total) }}</span
                            >
                          }
                        </div>
                      }
                      @case ('ready') {
                        <button
                          type="button"
                          class="btn btn-sm btn-primary mt-3 w-full"
                          (click)="desktopUpdate.install()"
                        >
                          <app-icon name="spin" [size]="15" /> {{ desktopUpdate.installLabel | t }}
                        </button>
                        <div class="mt-1.5 text-xs text-muted">
                          {{ 'Chatterly will close and open again with the new version.' | t }}
                        </div>
                      }
                    }
                    <button
                      type="button"
                      class="mt-2 text-xs text-accent hover:underline"
                      (click)="openUpdateSettings()"
                    >
                      {{ 'Update settings' | t }}
                    </button>
                  </div>
                } @else if (desktopUpdate.bellError()) {
                  <div class="mb-1 rounded-ui border border-white/8 bg-white/4 p-3 text-sm">
                    <div class="font-semibold">{{ 'The update could not be downloaded' | t }}</div>
                    <button
                      type="button"
                      class="btn btn-sm mt-2 w-full"
                      (click)="desktopUpdate.download()"
                    >
                      {{ 'Try again' | t }}
                    </button>
                  </div>
                }
                @for (u of social.incomingUsers(); track u.id) {
                  <div class="flex items-center gap-3 rounded-ui p-2 hover:bg-white/5">
                    <app-avatar [user]="u" [size]="34" />
                    <div class="min-w-0 flex-1">
                      <div
                        class="truncate text-sm font-semibold"
                        [appNameColor]="u.profileColor"
                        [appUserFont]="u.nameFont"
                        [nameFx]="u.nameFx"
                      >
                        {{ u.displayName }}
                      </div>
                      <div class="text-xs text-muted">{{ 'wants to be your friend' | t }}</div>
                    </div>
                    <button
                      class="btn btn-icon btn-sm btn-primary"
                      type="button"
                      (click)="social.accept(u.id)"
                      [attr.aria-label]="'Accept' | t"
                    >
                      <app-icon name="check" [size]="15" />
                    </button>
                    <button
                      class="btn btn-icon btn-sm"
                      type="button"
                      (click)="social.remove(u.id)"
                      [attr.aria-label]="'Decline' | t"
                    >
                      <app-icon name="x" [size]="15" />
                    </button>
                  </div>
                }
                @if (unreadChats() > 0) {
                  <div class="rounded-ui p-2 text-sm text-muted">
                    💬 {{ '{n} unread messages' | t: { n: totalUnread() } }}
                  </div>
                }
                @if (notificationCount() === 0) {
                  <div class="p-6 text-center text-sm text-muted">
                    {{ 'You are all caught up' | t }}
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-3">
          <a
            routerLink="/direct"
            [routerLinkActiveOptions]="{ exact: true }"
            routerLinkActive="active"
            class="nav-item"
            (click)="ui.sidebarOpen.set(false)"
          >
            <app-icon name="users" [size]="18" class="nav-icon" />
            <span class="flex-1">{{ 'Friends' | t }}</span>
            @if (social.incoming().length) {
              <span class="badge badge-red">{{ social.incoming().length }}</span>
            } @else if (social.onlineFriends().length) {
              <span class="text-xs text-muted"
                >{{ social.onlineFriends().length }} {{ 'online' | t }}</span
              >
            }
          </a>

          <section>
            <div class="mb-2.5 flex items-center justify-between px-2.5">
              <span class="section-title"
                ><app-icon name="send" [size]="13" /> {{ 'Direct messages' | t }}</span
              >
            </div>
            @for (dm of dmList(); track dm.channelId; let i = $index) {
              <a
                [routerLink]="['/direct', dm.channelId]"
                routerLinkActive="active"
                class="nav-item anim-slide-left"
                [style.--d]="i * 30 + 'ms'"
                (click)="ui.sidebarOpen.set(false)"
                (contextmenu)="openFriendMenu($event, dm.user)"
              >
                <app-avatar [user]="dm.user" [size]="34" [status]="social.statusOf(dm.user.id)" />
                <span class="min-w-0 flex-1 leading-tight">
                  <span
                    class="block truncate"
                    [class.font-semibold]="messages.unread()[dm.channelId]"
                    [class.text-fg]="messages.unread()[dm.channelId]"
                    [appNameColor]="dm.user.profileColor"
                    [appUserFont]="dm.user.nameFont"
                    [nameFx]="dm.user.nameFx"
                    >{{ dm.user.displayName }}</span
                  >
                  @if (call.rooms()[dm.channelId]?.length) {
                    <span class="flex items-center gap-1.5 text-xs font-medium text-accent"
                      ><app-icon name="phone" [size]="13" /> {{ 'In a call' | t }}</span
                    >
                  }
                </span>
                @if (messages.unread()[dm.channelId]; as n) {
                  <span class="badge badge-red">{{ n }}</span>
                }
              </a>
            } @empty {
              <p class="px-3 py-2 text-xs leading-relaxed text-dim">
                {{ 'Start a chat from your friends list.' | t }}
              </p>
            }
          </section>
        </div>
      }

      <!-- Voice connection -->
      @if (call.inCall()) {
        <div
          class="anim-fade-up mx-2 mb-2 flex items-center gap-2.5 rounded-ui border border-accent/25 bg-accent/10 px-3 py-2"
        >
          <app-icon name="lock" [size]="14" class="text-accent" />
          <a routerLink="/voice" class="min-w-0 flex-1 leading-tight">
            <span class="block text-xs font-bold text-accent">{{
              'Secure voice connected' | t
            }}</span>
            <span class="block truncate text-[0.6875rem] text-muted"
              >{{ call.stats().rttMs ?? '—' }} ms · {{ roomLabel() }}</span
            >
          </a>
          <button
            class="btn btn-icon btn-sm btn-soft-danger tip"
            [attr.data-tip]="'Disconnect' | t"
            type="button"
            (click)="call.leave()"
          >
            <app-icon name="phone-off" [size]="15" />
          </button>
        </div>
      }

      <!-- You -->
      <div class="relative flex shrink-0 flex-col gap-2.5 border-t border-white/6 bg-black/20 p-3">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-3 rounded-ui px-2 py-1.5 text-left hover:bg-white/8"
          (mousedown)="$event.stopPropagation()"
          (click)="statusMenu.set(!statusMenu())"
          (contextmenu)="openOwnProfile($event)"
        >
          <app-avatar
            [user]="auth.user()"
            [size]="40"
            [aura]="true"
            [zoomable]="true"
            [status]="social.statusOf(auth.user()?.id ?? '')"
          />
          <span class="min-w-0 leading-snug">
            <span
              class="block truncate text-sm font-semibold"
              [class]="nameClass()"
              [appNameColor]="auth.user()?.profileColor"
              [appUserFont]="auth.user()?.nameFont"
              [nameFx]="auth.user()?.nameFx"
              >{{ auth.user()?.displayName }}</span
            >
            <span class="block truncate text-xs text-muted">{{ statusLabel() | t }}</span>
          </span>
        </button>
        <div class="grid grid-cols-3 gap-2">
          <button
            class="btn dock-btn h-9 w-full tip"
            [class.btn-soft-danger]="call.muted()"
            [attr.data-tip]="(call.muted() ? 'Unmute' : 'Mute') | t"
            type="button"
            (click)="toggleMic()"
          >
            <app-icon [name]="call.muted() ? 'mic-off' : 'mic'" [size]="18" />
          </button>
          <button
            class="btn dock-btn h-9 w-full tip"
            [class.btn-soft-danger]="call.deafened()"
            [attr.data-tip]="(call.deafened() ? 'Undeafen' : 'Deafen') | t"
            type="button"
            (click)="toggleDeafen()"
          >
            <app-icon [name]="call.deafened() ? 'headphones-off' : 'headphones'" [size]="18" />
          </button>
          <button
            class="btn dock-btn h-9 w-full tip"
            [attr.data-tip]="'Settings' | t"
            type="button"
            (click)="openSettings()"
          >
            <app-icon name="settings" [size]="18" />
          </button>
        </div>

        @if (statusMenu()) {
          <div
            class="panel menu-up absolute inset-x-3 bottom-full z-[90] mb-2 p-2.5 shadow-2xl"
            (mousedown)="$event.stopPropagation()"
          >
            @for (s of statuses; track s.id; let i = $index) {
              <button
                type="button"
                class="nav-item anim-fade-up !min-h-10"
                [style.--d]="i * 30 + 'ms'"
                [class.active]="social.selfStatus() === s.id"
                (click)="setStatus(s.id)"
              >
                <span class="h-2.5 w-2.5 rounded-full" [style.background]="s.color"></span>
                {{ s.label | t }}
              </button>
            }
          </div>
        }
      </div>
    </aside>
  `,
})
export class ContextSidebarComponent {
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly social = inject(SocialStore);
  protected readonly guilds = inject(GuildStore);
  protected readonly messages = inject(MessageStore);
  protected readonly directory = inject(DirectoryService);
  protected readonly call = inject(CallService);
  protected readonly desktopUpdate = inject(DesktopUpdateService);
  /** Android app: a quiet check for a new version a few seconds after signing in (a toast only if there is one). */
  private readonly androidUpdate = inject(AndroidUpdateService);

  /** Starts the quiet update check of the Android app (it does nothing elsewhere). */
  constructor() {
    this.androidUpdate.checkOnStart();
  }
  private readonly router = inject(Router);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly statuses = STATUSES;
  protected readonly groupMenu = signal(false);
  protected readonly statusMenu = signal(false);
  protected readonly bell = signal(false);
  /** Where the panel of the bell goes: just under the button, wherever the button is (the title bar of the desktop app pushes it down). */
  protected readonly bellPos = signal({ top: 64, left: 12 });
  /** Channel being dragged and channel it is passing over (to mark where it will drop). */
  protected readonly dragging = signal<string | null>(null);
  protected readonly dragOver = signal<string | null>(null);

  /** On a group page, and also on the page of a call that was started from a group: the side bar stays on that group. */
  private isGroupContext(url: string): boolean {
    return (
      url.startsWith('/groups') ||
      (url.startsWith('/voice') && this.ui.lastRoute.startsWith('/groups'))
    );
  }

  protected readonly inGroup = toSignal(
    this.router.events.pipe(
      filter(function (e) {
        return e instanceof NavigationEnd;
      }),
      map(
        function (this: ContextSidebarComponent) {
          return this.isGroupContext(this.router.url);
        }.bind(this),
      ),
    ),
    { initialValue: this.isGroupContext(this.router.url) },
  );

  protected readonly dmList = computed(
    function (this: ContextSidebarComponent) {
      const users = this.directory.users();
      return this.social
        .dms()
        .map(function (dm) {
          return { ...dm, user: users.get(dm.userId)! };
        })
        .filter(function (dm) {
          return !!dm.user;
        });
    }.bind(this),
  );
  protected readonly textChannels = computed(
    function (this: ContextSidebarComponent) {
      return (
        this.guilds.activeGuild()?.channels.filter(function (c) {
          return c.type === 'text';
        }) ?? []
      );
    }.bind(this),
  );
  protected readonly voiceChannels = computed(
    function (this: ContextSidebarComponent) {
      return (
        this.guilds.activeGuild()?.channels.filter(function (c) {
          return c.type === 'voice';
        }) ?? []
      );
    }.bind(this),
  );
  protected readonly totalUnread = computed(
    function (this: ContextSidebarComponent) {
      return Object.values(this.messages.unread()).reduce(function (a, b) {
        return a + b;
      }, 0);
    }.bind(this),
  );
  protected readonly unreadChats = computed(
    function (this: ContextSidebarComponent) {
      return Object.keys(this.messages.unread()).length;
    }.bind(this),
  );
  protected readonly notificationCount = computed(
    function (this: ContextSidebarComponent) {
      return (
        this.social.incoming().length +
        this.unreadChats() +
        (this.desktopUpdate.bellCard() || this.desktopUpdate.bellError() ? 1 : 0)
      );
    }.bind(this),
  );
  /** Opens Settings > Updates from the card of the bell. */
  protected openUpdateSettings(): void {
    this.bell.set(false);
    this.ui.openSettings('updates');
  }

  /** A right click on the own panel opens the profile of the person, big. */
  protected openOwnProfile(event: Event): void {
    event.preventDefault();
    const id = this.auth.user()?.id;
    if (id) {
      this.ui.profileUserId.set(id);
    }
  }

  protected readonly nameClass = computed(
    function (this: ContextSidebarComponent) {
      const f = this.auth.user()?.nameFont;
      return fontClassOf(f);
    }.bind(this),
  );
  protected readonly statusLabel = computed(
    function (this: ContextSidebarComponent) {
      return (
        STATUSES.find(
          function (
            this: ContextSidebarComponent,
            s: { id: SelfPresence; label: string; color: string },
          ) {
            return s.id === this.social.selfStatus();
          }.bind(this),
        )?.label ?? 'Online'
      );
    }.bind(this),
  );
  protected readonly roomLabel = computed(
    function (this: ContextSidebarComponent) {
      const id = this.call.roomId();
      if (!id) return '';
      const dm = this.social.dmByChannel(id);
      if (dm) return this.directory.get(dm.userId)?.displayName ?? '';
      return this.guilds.channel(id)?.name ?? '';
    }.bind(this),
  );

  /** Opens or closes the panel of the bell; it opens right under the button (never over it, so the button can close it again). */
  protected toggleBell(event: Event): void {
    if (!this.bell()) {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 24);
      this.bellPos.set({
        top: Math.round(box.bottom + 8),
        left: Math.round(Math.max(12, Math.min(box.left, window.innerWidth - width - 12))),
      });
    }
    this.bell.set(!this.bell());
  }

  @HostListener('document:mousedown') closeMenus() {
    this.groupMenu.set(false);
    this.statusMenu.set(false);
    this.bell.set(false);
  }

  /** The ids of the people in the call of a voice channel. */
  protected occupants(channelId: string): string[] {
    return (this.call.rooms()[channelId] ?? []).map(function (p) {
      return p.userId;
    });
  }

  /** Closes the group menu and opens the invite window. */
  protected openInvite(): void {
    this.groupMenu.set(false);
    this.ui.inviteOpen.set(true);
  }

  /** Closes the group menu and opens the window that creates a text or voice channel. */
  protected openAddChannel(type: 'text' | 'voice'): void {
    this.groupMenu.set(false);
    this.ui.addChannelOpen.set(type);
  }

  /** Closes the group menu and opens the group settings window. */
  protected openGuildSettings(): void {
    this.groupMenu.set(false);
    this.ui.guildSettingsOpen.set(true);
  }

  /** Changes the state of the person (online, away, do not disturb, invisible). */
  protected setStatus(status: SelfPresence): void {
    this.social.setSelfStatus(status);
    this.statusMenu.set(false);
  }

  /** Joins a voice channel: the call page opens and the call starts there. */
  protected async joinVoice(channel: GuildChannel): Promise<void> {
    this.ui.sidebarOpen.set(false);
    await this.router.navigateByUrl('/voice');
    await this.call.join(channel.id);
  }

  /** Right click on a channel (text or voice): rename, move or delete it, only for the owner of the group. */
  protected openChannelMenu(event: MouseEvent, guildId: string, channel: GuildChannel): void {
    const group = this.guilds.guild(guildId);
    if (!group || !this.guilds.isOwner(group)) return;
    const items: MenuItem[] = [
      {
        label: 'Move channel up',
        icon: 'chevron-up',
        action: function (this: ContextSidebarComponent) {
          return void this.moveChannel(guildId, channel, -1);
        }.bind(this),
      },
      {
        label: 'Move channel down',
        icon: 'chevron-down',
        action: function (this: ContextSidebarComponent) {
          return void this.moveChannel(guildId, channel, 1);
        }.bind(this),
      },
      {
        label: 'Rename channel',
        icon: 'edit',
        separator: true,
        action: function (this: ContextSidebarComponent) {
          return void this.renameChannel(guildId, channel);
        }.bind(this),
      },
      {
        label: 'Delete channel',
        icon: 'trash',
        danger: true,
        separator: true,
        action: function (this: ContextSidebarComponent) {
          return void this.deleteChannel(guildId, channel);
        }.bind(this),
      },
    ];
    this.contextMenu.open(event, items);
  }

  /** Channels of the same type as `channel`, in the current order. */
  private siblings(channel: GuildChannel): GuildChannel[] {
    return channel.type === 'text' ? this.textChannels() : this.voiceChannels();
  }

  /** Saves a new order: text and voice channels are ordered apart, but the server receives the whole list. */
  private async saveOrder(
    guildId: string,
    channel: GuildChannel,
    reordered: GuildChannel[],
  ): Promise<void> {
    const textList = channel.type === 'text' ? reordered : this.textChannels();
    const voiceList = channel.type === 'voice' ? reordered : this.voiceChannels();
    try {
      await this.guilds.reorderChannels(
        guildId,
        [...textList, ...voiceList].map(function (c) {
          return c.id;
        }),
      );
    } catch (e) {
      this.toast.error('Could not reorder the channels', describeError(e));
    }
  }

  /** Moves a channel one place up or down (an alternative to dragging, also for keyboard and mobile). */
  private async moveChannel(guildId: string, channel: GuildChannel, step: number): Promise<void> {
    const list = this.siblings(channel).slice();
    const i = list.findIndex(function (c) {
      return c.id === channel.id;
    });
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(j, 0, list.splice(i, 1)[0]!);
    await this.saveOrder(guildId, channel, list);
  }

  /** Starts dragging a channel to change its order (owner only). */
  protected startDrag(event: DragEvent, channel: GuildChannel): void {
    this.dragging.set(channel.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', channel.id);
    }
  }

  /** A channel can only be dropped over channels of the same type (text with text, voice with voice). */
  protected overChannel(event: DragEvent, channel: GuildChannel): void {
    const source = this.channelById(this.dragging());
    if (!source || source.type !== channel.type) return;
    event.preventDefault();
    this.dragOver.set(channel.id);
  }

  /** Drops the channel on another one of the same kind: it takes its place. */
  protected dropChannel(event: DragEvent, guildId: string, target: GuildChannel): void {
    event.preventDefault();
    const source = this.channelById(this.dragging());
    this.endDrag();
    if (!source || source.id === target.id || source.type !== target.type) return;
    const list = this.siblings(source).filter(function (c) {
      return c.id !== source.id;
    });
    const position = this.siblings(source).findIndex(function (c) {
      return c.id === target.id;
    });
    // Once the dragged channel is removed, the index of the target already falls after it (moving down) or before it (moving up).
    list.splice(position, 0, source);
    void this.saveOrder(guildId, source, list);
  }

  /** Ends the drag of a channel. */
  protected endDrag(): void {
    this.dragging.set(null);
    this.dragOver.set(null);
  }

  /** A channel of the group in view by its id. */
  private channelById(id: string | null): GuildChannel | undefined {
    return id
      ? this.guilds.activeGuild()?.channels.find(function (c) {
          return c.id === id;
        })
      : undefined;
  }

  /** Asks for a new name and renames the channel. */
  private async renameChannel(guildId: string, channel: GuildChannel): Promise<void> {
    const name = await this.dialog.prompt(
      'Rename channel',
      'Pick a new name for this channel.',
      channel.name.replace(/-/g, ' '),
      channel.name,
    );
    if (name === null || !name.trim()) return;
    try {
      await this.guilds.renameChannel(guildId, channel.id, name);
    } catch (e) {
      this.toast.error('Could not rename the channel', describeError(e));
    }
  }

  /** Asks to confirm and deletes a channel for everybody. */
  private async deleteChannel(guildId: string, channel: GuildChannel): Promise<void> {
    const t = function (this: ContextSidebarComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !(await this.dialog.confirm(
        t('Delete #{name}?', { name: channel.name }),
        t('All its messages and files are removed for everyone.'),
        { danger: true, confirmLabel: t('Delete') },
      ))
    )
      return;
    try {
      await this.guilds.deleteChannel(guildId, channel.id);
    } catch (e) {
      this.toast.error(t('Could not delete the channel'), describeError(e));
    }
  }

  /** Right click on a friend in the messages list: nickname. */
  protected openFriendMenu(event: MouseEvent, u: User): void {
    const items: MenuItem[] = [
      {
        label: 'View profile',
        icon: 'user',
        action: function (this: ContextSidebarComponent) {
          return this.ui.profileUserId.set(u.id);
        }.bind(this),
      },
      {
        label: 'Set nickname',
        icon: 'edit',
        separator: true,
        action: function (this: ContextSidebarComponent) {
          return void this.directory.askNickname(u);
        }.bind(this),
      },
    ];
    if (u.realName)
      items.push({
        label: 'Remove nickname',
        icon: 'x',
        action: function (this: ContextSidebarComponent) {
          return this.directory.setAlias(u.id, '');
        }.bind(this),
      });
    this.contextMenu.open(event, items);
  }

  /** Opens the settings. */
  protected openSettings(): void {
    this.ui.openSettings();
  }

  /** Mutes or unmutes the microphone. */
  protected toggleMic(): void {
    this.call.toggleMute();
  }

  /** Deafens or undeafens. */
  protected toggleDeafen(): void {
    this.call.toggleDeafen();
  }
}
