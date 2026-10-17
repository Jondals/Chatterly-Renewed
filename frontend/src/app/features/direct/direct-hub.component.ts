/**
 * src/app/features/direct/direct-hub.component.ts
 * Home: the friends list, requests and direct messages with their profile panel.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { User } from '../../core/models';
import { CallService } from '../../core/services/call.service';
import { ContextMenuService, type MenuItem } from '../../core/services/context-menu.service';
import { DialogService } from '../../core/services/dialog.service';
import { DirectoryService } from '../../core/services/directory.service';
import { ToastService } from '../../core/services/toast.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ProfileCardComponent } from '../../shared/components/profile-card.component';
import { describeError } from '../../shared/util/errors';
import { GuildStore } from '../../store/guild.store';
import { MessageStore } from '../../store/message.store';
import { SocialStore } from '../../store/social.store';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { SafetyModalComponent } from './safety-modal.component';
import { UiService } from '../../core/services/ui.service';
import { fontClassOf } from '../../shared/util/user-font.directive';

type Tab = 'online' | 'all' | 'pending';

import { GuildInviteCardComponent } from '../guild/guild-invite-card.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-direct-hub',
  standalone: true,
  imports: [
    GuildInviteCardComponent,
    NameColorDirective,
    UserFontDirective,
    NameFxDirective,
    AvatarComponent,
    IconComponent,
    ModalComponent,
    PageHeaderComponent,
    ProfileCardComponent,
    ChatPanelComponent,
    SafetyModalComponent,
    RouterLink,
    TranslatePipe,
  ],
  host: { class: 'page-enter block h-full min-h-0' },
  template: `
    <div class="flex h-full min-h-0 overflow-hidden">
      <section class="flex min-w-0 flex-1 flex-col">
        @if (peer(); as p) {
          <app-page-header
            [title]="p.displayName"
            [titleClass]="nameClass(p)"
            [titleColor]="p.profileColor"
            [subtitle]="statusWord(p.id) | t"
            [clickable]="true"
            (pressed)="ui.profileUserId.set(p.id)"
          >
            <app-avatar leading [user]="p" [size]="32" [status]="social.statusOf(p.id)" />
            <button
              class="btn btn-icon btn-ghost tip"
              data-tip-pos="bottom"
              [attr.data-tip]="'Voice call' | t"
              type="button"
              (click)="startCall()"
            >
              <app-icon name="phone" />
            </button>
            <button
              class="btn btn-icon btn-ghost tip relative"
              [class.shield-verified]="directory.isVerified(p.id)"
              data-tip-pos="bottom"
              [attr.data-tip]="
                (directory.isVerified(p.id)
                  ? 'End-to-end encrypted · verified contact'
                  : 'End-to-end encrypted · press to verify'
                ) | t
              "
              type="button"
              (click)="safetyOpen.set(true)"
            >
              <app-icon name="shield-check" />
              @if (directory.isVerified(p.id)) {
                <span
                  class="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-ink-850"
                ></span>
              }
            </button>
            <button
              class="btn btn-icon btn-ghost tip max-xl:hidden"
              data-tip-pos="bottom"
              [class.btn-active]="infoOpen()"
              [attr.data-tip]="'Profile' | t"
              type="button"
              (click)="infoOpen.set(!infoOpen())"
            >
              <app-icon name="user" />
            </button>
          </app-page-header>
          <app-chat-panel
            [channelId]="channelId()!"
            [peerId]="p.id"
            [placeholder]="placeholder()"
          />
        } @else {
          <app-page-header [title]="'Friends' | t" icon="users"> </app-page-header>

          <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
            <div class="mx-auto w-full max-w-5xl">
              <div class="friend-tabs mb-5" role="tablist">
                @for (t of tabs; track t.id) {
                  <button
                    type="button"
                    role="tab"
                    class="friend-tab"
                    [class.is-on]="tab() === t.id"
                    [attr.aria-selected]="tab() === t.id"
                    (click)="tab.set(t.id)"
                  >
                    @switch (t.id) {
                      @case ('online') {
                        <span class="friend-tab-dot"></span>
                      }
                      @case ('pending') {
                        <app-icon name="user-plus" [size]="15" />
                      }
                      @default {
                        <app-icon name="users" [size]="15" />
                      }
                    }
                    {{ t.label | t }}
                    @if (t.id === 'pending' && social.incoming().length) {
                      <span class="badge badge-red">{{ social.incoming().length }}</span>
                    } @else {
                      <span class="friend-tab-count">{{ tabCount(t.id) }}</span>
                    }
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-primary friend-add"
                  [attr.aria-label]="'Add friend' | t"
                  (click)="addOpen.set(true)"
                >
                  <app-icon name="user-plus" [size]="15" />
                  <span class="max-sm:hidden">{{ 'Add friend' | t }}</span>
                </button>
              </div>
            </div>
            @if (tab() === 'pending') {
              <div class="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-2">
                <app-guild-invites />
                <section class="pending-card">
                  <header class="pending-head">
                    <span class="pending-icon bg-accent/15 text-accent"
                      ><app-icon name="user-plus" [size]="16"
                    /></span>
                    <b class="flex-1">{{ 'Received' | t }}</b>
                    <span class="count-pill">{{ social.incomingUsers().length }}</span>
                  </header>
                  <div class="friend-list p-1.5">
                    @for (u of social.incomingUsers(); track u.id; let i = $index) {
                      <article class="friend-row anim-fade-up" [style.--d]="i * 30 + 'ms'">
                        <app-avatar [user]="u" [size]="42" />
                        <div class="min-w-0 flex-1 leading-tight">
                          <div
                            class="truncate text-[0.9375rem] font-semibold"
                            [appNameColor]="u.profileColor"
                            [appUserFont]="u.nameFont"
                            [nameFx]="u.nameFx"
                          >
                            {{ u.displayName }}
                          </div>
                          <div class="truncate text-xs text-muted">&#64;{{ u.username }}</div>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <button
                            class="friend-act friend-act-ok tip"
                            [attr.data-tip]="'Accept' | t"
                            type="button"
                            (click)="accept(u)"
                          >
                            <app-icon name="check" [size]="16" />
                          </button>
                          <button
                            class="friend-act friend-act-danger tip"
                            [attr.data-tip]="'Decline' | t"
                            type="button"
                            (click)="social.remove(u.id)"
                          >
                            <app-icon name="x" [size]="16" />
                          </button>
                        </div>
                      </article>
                    } @empty {
                      <div class="pending-empty">
                        <span class="pending-empty-icon"
                          ><app-icon name="user-plus" [size]="22"
                        /></span>
                        <b>{{ 'No incoming requests.' | t }}</b>
                        <span>{{ 'When someone adds you, it will show up here.' | t }}</span>
                      </div>
                    }
                  </div>
                </section>
                <section class="pending-card">
                  <header class="pending-head">
                    <span class="pending-icon bg-sky/15 text-sky"
                      ><app-icon name="send" [size]="16"
                    /></span>
                    <b class="flex-1">{{ 'Sent' | t }}</b>
                    <span class="count-pill">{{ social.outgoingUsers().length }}</span>
                  </header>
                  <div class="friend-list p-1.5">
                    @for (u of social.outgoingUsers(); track u.id; let i = $index) {
                      <article class="friend-row anim-fade-up" [style.--d]="i * 30 + 'ms'">
                        <app-avatar [user]="u" [size]="42" />
                        <div class="min-w-0 flex-1 leading-tight">
                          <div
                            class="truncate text-[0.9375rem] font-semibold"
                            [appNameColor]="u.profileColor"
                            [appUserFont]="u.nameFont"
                            [nameFx]="u.nameFx"
                          >
                            {{ u.displayName }}
                          </div>
                          <div class="truncate text-xs text-muted">
                            {{ 'Waiting for them…' | t }}
                          </div>
                        </div>
                        <button
                          class="friend-act friend-act-danger tip"
                          [attr.data-tip]="'Cancel' | t"
                          type="button"
                          (click)="social.remove(u.id)"
                        >
                          <app-icon name="x" [size]="16" />
                        </button>
                      </article>
                    } @empty {
                      <div class="pending-empty">
                        <span class="pending-empty-icon"><app-icon name="send" [size]="22" /></span>
                        <b>{{ 'Nothing pending.' | t }}</b>
                        <span>{{ 'The requests you send wait here until they answer.' | t }}</span>
                      </div>
                    }
                  </div>
                </section>
              </div>
            } @else {
              <div class="mx-auto w-full max-w-5xl">
                @if (social.friends().length) {
                  <label class="friend-search mb-6">
                    <app-icon name="search" [size]="16" class="text-dim" />
                    <input
                      class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
                      [placeholder]="'Search friends' | t"
                      [value]="query()"
                      (input)="query.set($any($event.target).value)"
                    />
                  </label>
                }
                @if (shownFriends().length) {
                  <div class="section-label">
                    <span>{{ (tab() === 'online' ? 'Online' : 'All friends') | t }}</span>
                    <span class="count-pill">{{ shownFriends().length }}</span>
                  </div>
                }
                <div class="friend-list">
                  @for (u of shownFriends(); track u.id; let i = $index) {
                    <article
                      class="friend-row anim-fade-up"
                      tabindex="0"
                      [style.--d]="i * 30 + 'ms'"
                      (click)="message(u)"
                      (keydown.enter)="message(u)"
                      (contextmenu)="openFriendMenu($event, u)"
                    >
                      <app-avatar [user]="u" [size]="42" [status]="social.statusOf(u.id)" />
                      <div class="min-w-0 flex-1 leading-tight">
                        <div
                          class="truncate text-[0.9375rem] font-semibold"
                          [class]="nameClass(u)"
                          [appNameColor]="u.profileColor"
                          [appUserFont]="u.nameFont"
                          [nameFx]="u.nameFx"
                        >
                          {{ u.displayName }}
                        </div>
                        <div class="truncate text-xs text-muted">
                          {{ u.statusText || (statusWord(u.id) | t) }}
                        </div>
                      </div>
                      <div
                        class="friend-actions flex items-center gap-1.5"
                        (click)="$event.stopPropagation()"
                        (keydown.enter)="$event.stopPropagation()"
                      >
                        <button
                          class="friend-act tip"
                          [attr.data-tip]="'Message' | t"
                          type="button"
                          (click)="message(u)"
                        >
                          <app-icon name="send" [size]="16" />
                        </button>
                        <button
                          class="friend-act tip"
                          [attr.data-tip]="'Call' | t"
                          type="button"
                          (click)="callFriend(u)"
                        >
                          <app-icon name="phone" [size]="16" />
                        </button>
                        <button
                          class="friend-act friend-act-danger tip"
                          [attr.data-tip]="'Remove friend' | t"
                          type="button"
                          (click)="removeFriend(u)"
                        >
                          <app-icon name="user-x" [size]="16" />
                        </button>
                      </div>
                    </article>
                  } @empty {
                    <div class="flex flex-col items-center gap-3 py-20 text-center">
                      <div class="animate-float text-6xl">
                        {{ query() ? '🔍' : tab() === 'online' ? '🌙' : '🫂' }}
                      </div>
                      <div class="text-lg font-bold">
                        {{
                          (query()
                            ? 'No friend matches your search'
                            : tab() === 'online'
                              ? 'Nobody is online right now'
                              : 'No friends yet'
                          ) | t
                        }}
                      </div>
                      <p class="max-w-sm text-sm text-muted">
                        {{
                          'Add someone by username to chat and call them, end-to-end encrypted.' | t
                        }}
                      </p>
                      <button class="btn btn-soft-accent" type="button" (click)="addOpen.set(true)">
                        <app-icon name="user-plus" [size]="16" /> {{ 'Add friend' | t }}
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </section>

      @if (peer() && infoOpen()) {
        <aside
          class="anim-slide-right hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/6 p-3 xl:flex"
        >
          <app-profile-card [user]="peer()" [status]="social.statusOf(peer()!.id)">
            @if (mutual().length) {
              <div class="mt-3 border-t border-white/6 pt-3">
                <div class="section-label !mb-2 !px-0">
                  <span>{{ 'Groups in common' | t }}</span>
                  <span class="count-pill">{{ mutual().length }}</span>
                </div>
                @for (g of mutual(); track g.id) {
                  <a [routerLink]="['/groups', g.id]" class="nav-item !px-1"
                    ><app-avatar
                      [imageId]="g.iconImage"
                      [name]="g.name"
                      shape="square"
                      [size]="26"
                    />
                    <span class="truncate">{{ g.name }}</span></a
                  >
                }
              </div>
            }
          </app-profile-card>

          @if (podParticipants() > 0) {
            <button class="btn btn-primary w-full" type="button" (click)="startCall()">
              <app-icon name="headphones" [size]="16" /> {{ 'Join the call' | t }}
            </button>
          }
        </aside>
      }
    </div>

    @if (addOpen()) {
      <app-modal
        [title]="'Add friend' | t"
        [subtitle]="'Enter an exact username, or search for one.' | t"
        (closed)="addOpen.set(false)"
      >
        <form (submit)="addFriend($event)" class="flex gap-2">
          <input
            class="input"
            [placeholder]="'username' | t"
            autocomplete="off"
            autocapitalize="off"
            [value]="addName()"
            (input)="onSearch($any($event.target).value)"
          />
          <button class="btn btn-primary" type="submit" [disabled]="!addName().trim() || adding()">
            {{ 'Send request' | t }}
          </button>
        </form>
        @if (addError()) {
          <p class="anim-fade-up mt-2 text-sm text-red-300">{{ addError() }}</p>
        }
        <div class="mt-4 max-h-60 space-y-1 overflow-y-auto">
          @for (u of suggestions(); track u.id) {
            <button
              class="nav-item !py-2"
              type="button"
              (click)="addName.set(u.username); addFriend()"
            >
              <app-avatar [user]="u" [size]="32" />
              <span
                class="min-w-0 flex-1 truncate"
                [appNameColor]="u.profileColor"
                [appUserFont]="u.nameFont"
                [nameFx]="u.nameFx"
                >{{ u.displayName }}
                <span class="text-xs text-muted">&#64;{{ u.username }}</span></span
              >
              <app-icon name="user-plus" [size]="16" class="text-accent" />
            </button>
          }
        </div>
      </app-modal>
    }

    @if (safetyOpen() && peer(); as p) {
      <app-safety-modal [userId]="p.id" (closed)="safetyOpen.set(false)" />
    }
  `,
})
export class DirectHubComponent {
  protected readonly social = inject(SocialStore);
  protected readonly ui = inject(UiService);
  protected readonly guilds = inject(GuildStore);
  protected readonly messages = inject(MessageStore);
  protected readonly directory = inject(DirectoryService);
  protected readonly call = inject(CallService);
  private readonly dialog = inject(DialogService);
  private readonly menu = inject(ContextMenuService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);

  protected readonly channelId = toSignal(
    this.route.paramMap.pipe(
      map(function (p) {
        return p.get('channelId');
      }),
    ),
    { initialValue: this.route.snapshot.paramMap.get('channelId') },
  );
  protected readonly tab = signal<Tab>('all');
  protected readonly infoOpen = signal(true);
  protected readonly addOpen = signal(false);
  protected readonly addName = signal('');
  protected readonly addError = signal('');
  protected readonly adding = signal(false);
  protected readonly suggestions = signal<User[]>([]);
  protected readonly safetyOpen = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly query = signal('');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'online', label: 'Online' },
    { id: 'pending', label: 'Pending' },
  ];
  protected readonly shownFriends = computed(this.filterFriends.bind(this));

  /** The friends of the open tab that match the search box. */
  private filterFriends(): User[] {
    const list = this.tab() === 'online' ? this.social.onlineFriends() : this.social.friendUsers();
    const text = this.query().trim().toLowerCase();
    if (!text) {
      return list;
    }
    return list.filter(function (user: User) {
      return (
        user.displayName.toLowerCase().includes(text) || user.username.toLowerCase().includes(text)
      );
    });
  }

  /** The number shown next to a tab. */
  protected tabCount(id: Tab): number {
    if (id === 'online') {
      return this.social.onlineFriends().length;
    }
    return id === 'all' ? this.social.friends().length : this.social.outgoingUsers().length;
  }
  protected readonly peer = computed(
    function (this: DirectHubComponent) {
      const id = this.channelId();
      const dm = id ? this.social.dmByChannel(id) : undefined;
      return dm ? this.directory.users().get(dm.userId) : undefined;
    }.bind(this),
  );
  protected readonly placeholder = computed(
    function (this: DirectHubComponent) {
      return this.i18n.t('Message {name}', { name: this.peer()?.displayName ?? '' });
    }.bind(this),
  );
  protected readonly mutual = computed(
    function (this: DirectHubComponent) {
      const p = this.peer();
      return p
        ? this.guilds.guilds().filter(function (g) {
            return g.members.some(function (m) {
              return m.userId === p.id;
            });
          })
        : [];
    }.bind(this),
  );
  protected readonly podParticipants = computed(
    function (this: DirectHubComponent) {
      return this.call.rooms()[this.channelId() ?? '']?.length ?? 0;
    }.bind(this),
  );
  constructor() {
    // A deep link to a DM that isn't loaded yet should resolve once the list arrives.
    effect(
      function (this: DirectHubComponent) {
        const id = this.channelId();
        if (id && this.social.loaded() && !this.social.dmByChannel(id)) {
          untracked(
            function (this: DirectHubComponent) {
              return void this.router.navigateByUrl('/direct');
            }.bind(this),
          );
        }
      }.bind(this),
    );
  }

  /** The class of the font a person chose for their name. */
  protected nameClass(u: User): string {
    return fontClassOf(u.nameFont);
  }

  /** The words for the presence of a person. */
  protected statusWord(id: string): string {
    const s = this.social.statusOf(id);
    return s === 'dnd'
      ? 'Do not disturb'
      : s === 'offline'
        ? 'Offline'
        : s === 'idle'
          ? 'Idle'
          : 'Online';
  }

  /** Opens the chat with a friend. */
  protected async message(user: User): Promise<void> {
    try {
      const channelId = await this.social.openDm(user.id);
      await this.router.navigate(['/direct', channelId]);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not open chat'), describeError(e));
    }
  }

  /** Right click on a friend: message, call, and set (or remove) a nickname. */
  protected openFriendMenu(event: MouseEvent, u: User): void {
    const items: MenuItem[] = [
      {
        label: 'Message',
        icon: 'send',
        action: function (this: DirectHubComponent) {
          return void this.message(u);
        }.bind(this),
      },
      {
        label: 'Call',
        icon: 'phone',
        action: function (this: DirectHubComponent) {
          return void this.callFriend(u);
        }.bind(this),
      },
      {
        label: 'View profile',
        icon: 'user',
        action: function (this: DirectHubComponent) {
          return this.ui.profileUserId.set(u.id);
        }.bind(this),
      },
      {
        label: 'Set nickname',
        icon: 'edit',
        separator: true,
        action: function (this: DirectHubComponent) {
          return void this.directory.askNickname(u);
        }.bind(this),
      },
    ];
    if (u.realName)
      items.push({
        label: 'Remove nickname',
        icon: 'x',
        action: function (this: DirectHubComponent) {
          return this.directory.setAlias(u.id, '');
        }.bind(this),
      });
    this.menu.open(event, items);
  }

  /** Calls a friend: the call page opens and the call starts. */
  protected async callFriend(user: User): Promise<void> {
    try {
      const channelId = await this.social.openDm(user.id);
      await this.router.navigateByUrl('/voice');
      await this.call.join(channelId);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not start the call'), describeError(e));
    }
  }

  /** Starts a call in the chat that is open. */
  protected async startCall(withVideo = false): Promise<void> {
    const id = this.channelId();
    if (!id) return;
    await this.router.navigateByUrl('/voice');
    await this.call.join(id);
    if (withVideo && this.call.inCall()) await this.call.toggleCamera();
  }

  /** Accepts a friend request. */
  protected async accept(user: User): Promise<void> {
    await this.social.accept(user.id);
    this.toast.success(this.i18n.t('Friend added'), user.displayName);
  }

  /** Asks to confirm and removes a friend. */
  protected async removeFriend(user: User): Promise<void> {
    const t = function (this: DirectHubComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      await this.dialog.confirm(
        t('Remove {name}?', { name: user.displayName }),
        t(
          'Your chat with them is deleted, they leave the groups you own (and their messages there are deleted) and they stop showing up for you. You can add them again later.',
        ),
        { danger: true, confirmLabel: t('Remove') },
      )
    ) {
      await this.social.remove(user.id);
    }
  }

  /** The person types in the box of friends: after a short pause the users that match are looked for. */
  protected onSearch(value: string): void {
    this.addName.set(value);
    this.addError.set('');
    clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.suggestions.set([]);
      return;
    }
    this.searchTimer = setTimeout(
      async function (this: DirectHubComponent) {
        try {
          this.suggestions.set(await this.social.searchUsers(value.trim()));
        } catch {
          this.suggestions.set([]);
        }
      }.bind(this),
      250,
    );
  }

  /** Sends a friend request to the name that was typed. */
  protected async addFriend(event?: Event): Promise<void> {
    event?.preventDefault();
    const name = this.addName().trim();
    if (!name) return;
    this.adding.set(true);
    this.addError.set('');
    try {
      const status = await this.social.sendRequest(name);
      this.toast.success(
        this.i18n.t(status === 'accepted' ? 'You are now friends!' : 'Request sent'),
        status === 'pending' ? name : undefined,
      );
      this.addOpen.set(false);
      this.addName.set('');
      this.suggestions.set([]);
    } catch (e) {
      this.addError.set(describeError(e));
    } finally {
      this.adding.set(false);
    }
  }
}
