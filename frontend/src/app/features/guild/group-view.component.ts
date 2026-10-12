/**
 * src/app/features/guild/group-view.component.ts
 * View of a group: header, channel chat and members list.
 */
import { ChannelLabelPipe, channelLabel } from '../../shared/util/channel-label.pipe';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ContextMenuService, type MenuItem } from '../../core/services/context-menu.service';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { Guild, GuildTag, User } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { CallService } from '../../core/services/call.service';
import { DialogService } from '../../core/services/dialog.service';
import { DirectoryService } from '../../core/services/directory.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { IconComponent } from '../../shared/components/icon.component';
import { ColorPickerComponent } from '../../shared/components/color-picker.component';
import { ToggleComponent } from '../../shared/components/controls.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { ProfileCardComponent } from '../../shared/components/profile-card.component';
import { describeError } from '../../shared/util/errors';
import { GuildStore } from '../../store/guild.store';
import { SocialStore } from '../../store/social.store';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { fontClassOf } from '../../shared/util/user-font.directive';
import { ServerTagComponent } from '../../shared/components/server-tag.component';

/** A member of the list, with the tags they have. */
interface MemberRow {
  user: User;
  role: 'owner' | 'member';
  tags: GuildTag[];
}

/** The tags (with name and color) a member has, from the ids the server sends. */
function tagsOf(all: GuildTag[], ids: string[]): GuildTag[] {
  return all.filter(function has(tag) {
    return ids.includes(tag.id);
  });
}

@Component({
  selector: 'app-group-view',
  standalone: true,
  imports: [
    ServerTagComponent,
    ToggleComponent,
    ColorPickerComponent,
    NameColorDirective,
    UserFontDirective,
    NameFxDirective,
    ChannelLabelPipe,
    AvatarComponent,
    IconComponent,
    ModalComponent,
    PageHeaderComponent,
    ProfileCardComponent,
    ChatPanelComponent,
    TranslatePipe,
  ],
  host: { class: 'block h-full min-h-0' },
  template: `
    @for (key of [guildKey()]; track key) {
      <div class="page-enter block h-full min-h-0">
        @if (!guilds.loaded()) {
          <div class="flex h-full items-center justify-center">
            <div
              class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"
            ></div>
          </div>
        } @else if (!guild()) {
          <section class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <div class="animate-float text-6xl">🛰️</div>
            <h1 class="text-gradient text-3xl font-bold tracking-tight">{{ 'Groups' | t }}</h1>
            <p class="max-w-md text-muted">
              {{
                'Groups are shared spaces with text and voice channels. Each one has its own encryption key, known only to its members.'
                  | t
              }}
            </p>
            <button
              class="btn btn-primary h-11 px-6"
              type="button"
              (click)="ui.createGuildOpen.set(true)"
            >
              <app-icon name="plus" [size]="18" /> {{ 'Create your first group' | t }}
            </button>
          </section>
        } @else {
          <div class="flex h-full min-h-0 overflow-hidden">
            <section class="flex min-w-0 flex-1 flex-col">
              @if (channel(); as c) {
                <app-page-header
                  [title]="c.name | channelLabel"
                  [icon]="c.type === 'text' ? 'hash' : 'volume'"
                  [subtitle]="guild()!.name"
                >
                  <button
                    type="button"
                    class="btn btn-icon btn-ghost tip text-accent"
                    data-tip-pos="bottom"
                    (click)="ui.openSettings('security')"
                    [attr.data-tip]="'Encrypted · key v{n}' | t: { n: guild()!.keyVersion }"
                    [attr.aria-label]="'How end-to-end encryption works' | t"
                  >
                    <app-icon name="shield-check" [size]="18" />
                  </button>
                  <button
                    class="btn btn-icon btn-ghost tip"
                    data-tip-pos="bottom"
                    [attr.data-tip]="'Invite people' | t"
                    type="button"
                    (click)="ui.inviteOpen.set(true)"
                  >
                    <app-icon name="user-plus" />
                  </button>
                  <button
                    class="btn btn-icon btn-ghost tip max-xl:hidden"
                    data-tip-pos="bottom"
                    [class.btn-active]="membersOpen()"
                    [attr.data-tip]="'Members' | t"
                    type="button"
                    (click)="membersOpen.set(!membersOpen())"
                  >
                    <app-icon name="users" />
                  </button>
                </app-page-header>
                @if (c.type === 'text') {
                  <app-chat-panel
                    [channelId]="c.id"
                    [canModerate]="isOwner()"
                    [placeholder]="placeholder()"
                  />
                } @else {
                  <div
                    class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
                  >
                    <div class="animate-float text-6xl">🎙️</div>
                    <h2 class="text-xl font-bold">{{ c.name | channelLabel }}</h2>
                    <p class="max-w-sm text-sm text-muted">
                      {{
                        'Peer-to-peer voice. Audio and video are end-to-end encrypted — the server never touches them.'
                          | t
                      }}
                    </p>
                    <button class="btn btn-primary" type="button" (click)="joinVoice(c.id)">
                      <app-icon name="headphones" [size]="16" /> {{ 'Join voice' | t }}
                    </button>
                  </div>
                }
              }
            </section>

            @if (membersOpen()) {
              <aside
                class="anim-slide-right hidden w-60 shrink-0 flex-col overflow-hidden border-l border-white/6 px-2.5 pb-2.5 pt-5 xl:flex"
              >
                <div class="section-label !mb-3 !px-2">
                  <span>{{ 'Members' | t }}</span>
                  <span class="count-pill">{{ members().length }}</span>
                </div>
                <div class="member-list min-h-0 flex-1 overflow-y-auto">
                  @for (sec of memberSections(); track sec.id) {
                    @if (sec.label) {
                      <div class="member-section" [style.--tag]="sec.color">
                        <span class="member-section-dot"></span>
                        {{ sec.label }} · {{ sec.items.length }}
                      </div>
                    }
                    @for (m of sec.items; track m.user.id; let i = $index) {
                      <div
                        class="nav-item chan-item group anim-fade-in cursor-pointer"
                        role="button"
                        tabindex="0"
                        [style.--d]="i * 25 + 'ms'"
                        [class.opacity-50]="social.statusOf(m.user.id) === 'offline'"
                        [class.chan-drop]="dropOver() === m.user.id"
                        [class.chan-drag]="dragging() === m.user.id"
                        [attr.draggable]="isOwner() && m.role !== 'owner' ? 'true' : null"
                        (click)="selected.set(m.user)"
                        (keydown.enter)="selected.set(m.user)"
                        (dragstart)="startDrag($event, m.user.id)"
                        (dragover)="dragOverMember($event, m.user.id)"
                        (drop)="dropMember($event, m.user.id)"
                        (dragend)="endDrag()"
                        (contextmenu)="openMemberMenu($event, m.user.id)"
                      >
                        <app-avatar
                          [user]="m.user"
                          [size]="32"
                          [status]="social.statusOf(m.user.id)"
                        />
                        <span class="min-w-0 flex-1 leading-tight">
                          <span
                            class="flex items-center gap-1 truncate text-fg"
                            [class]="nameClass(m.user)"
                            [appNameColor]="m.user.profileColor"
                            [appUserFont]="m.user.nameFont"
                            [nameFx]="m.user.nameFx"
                            >{{ m.user.displayName }}
                            <app-server-tag [tag]="m.user.serverTag" />
                            @if (m.role === 'owner') {
                              <app-icon name="crown" [size]="12" class="text-amber" />
                            }
                          </span>
                          @if (m.user.statusText) {
                            <span class="block truncate text-[0.6875rem]">{{
                              m.user.statusText
                            }}</span>
                          }
                          @if (m.tags.length) {
                            <span class="mt-0.5 flex flex-wrap gap-1">
                              @for (tag of m.tags; track tag.id) {
                                <span class="guild-tag" [style.--tag]="tag.color">{{
                                  tag.name
                                }}</span>
                              }
                            </span>
                          }
                        </span>
                        @if (isOwner() && m.user.id !== me()) {
                          <button
                            class="btn btn-icon btn-sm btn-soft-danger hidden group-hover:inline-flex"
                            type="button"
                            (click)="kick($event, m.user)"
                            [attr.aria-label]="'Remove member' | t"
                          >
                            <app-icon name="user-x" [size]="13" />
                          </button>
                        }
                      </div>
                    }
                  }
                </div>
              </aside>
            }
          </div>

          @if (tagsFor(); as uid) {
            @if (guild(); as g) {
              <app-modal
                [title]="'Tags' | t"
                [subtitle]="
                  'Switch on the tags this person has. The order of the list is the order of the sections.'
                    | t
                "
                [width]="440"
                (closed)="tagsFor.set(null)"
              >
                <div class="space-y-4">
                  <div class="space-y-1.5">
                    @for (tag of g.tags; track tag.id; let first = $first; let last = $last) {
                      <div class="tag-row">
                        <span class="tag-dot" [style.background]="tag.color"></span>
                        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                          tag.name
                        }}</span>
                        <button
                          type="button"
                          class="btn btn-icon btn-sm btn-ghost"
                          [disabled]="first"
                          [attr.aria-label]="'Move up' | t"
                          (click)="moveTag(g, tag.id, -1)"
                        >
                          <app-icon name="chevron-up" [size]="14" />
                        </button>
                        <button
                          type="button"
                          class="btn btn-icon btn-sm btn-ghost"
                          [disabled]="last"
                          [attr.aria-label]="'Move down' | t"
                          (click)="moveTag(g, tag.id, 1)"
                        >
                          <app-icon name="chevron-down" [size]="14" />
                        </button>
                        <app-toggle
                          [checked]="memberHasTag(g, uid, tag.id)"
                          [label]="tag.name"
                          (checkedChange)="toggleTag(g.id, uid, tag.id)"
                        />
                        <button
                          type="button"
                          class="btn btn-icon btn-sm btn-ghost hover:!text-red-300"
                          [attr.aria-label]="'Delete' | t"
                          (click)="removeTag(g.id, tag.id)"
                        >
                          <app-icon name="trash" [size]="14" />
                        </button>
                      </div>
                    } @empty {
                      <p class="py-3 text-center text-sm text-muted">
                        {{ 'This group has no tags yet.' | t }}
                      </p>
                    }
                  </div>
                  <form class="tag-form" (submit)="addTag($event, g.id, uid)">
                    <app-color-picker
                      [value]="newTagColor()"
                      [size]="32"
                      label="Color"
                      (valueChange)="newTagColor.set($event)"
                    />
                    <input
                      class="input min-w-0 flex-1 !h-9"
                      maxlength="24"
                      [value]="newTagName()"
                      (input)="newTagName.set($any($event.target).value)"
                      [attr.placeholder]="'New tag for this person' | t"
                      [attr.aria-label]="'New tag for this person' | t"
                    />
                    <button
                      type="submit"
                      class="btn btn-sm btn-primary"
                      [disabled]="!newTagName().trim()"
                    >
                      {{ 'Add' | t }}
                    </button>
                  </form>
                </div>
              </app-modal>
            }
          }

          @if (selected(); as u) {
            <app-modal [title]="u.displayName" [width]="400" (closed)="selected.set(null)">
              <app-profile-card
                [user]="u"
                [status]="social.statusOf(u.id)"
                [tags]="tagsOfMember(u.id)"
                [showHandle]="false"
              />
            </app-modal>
          }
        }
      </div>
    }
  `,
})
export class GroupViewComponent {
  protected readonly guilds = inject(GuildStore);
  protected readonly social = inject(SocialStore);
  protected readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  private readonly call = inject(CallService);
  private readonly directory = inject(DirectoryService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly contextMenu = inject(ContextMenuService);

  private readonly guildId = toSignal(
    this.route.paramMap.pipe(
      map(function (p) {
        return p.get('guildId');
      }),
    ),
    { initialValue: this.route.snapshot.paramMap.get('guildId') },
  );
  private readonly channelId = toSignal(
    this.route.paramMap.pipe(
      map(function (p) {
        return p.get('channelId');
      }),
    ),
    { initialValue: this.route.snapshot.paramMap.get('channelId') },
  );

  protected readonly membersOpen = signal(true);
  protected readonly selected = signal<User | null>(null);
  protected readonly me = computed(
    function (this: GroupViewComponent) {
      return this.auth.user()?.id;
    }.bind(this),
  );
  protected readonly guild = computed(
    function (this: GroupViewComponent) {
      const id = this.guildId();
      return (id ? this.guilds.guild(id) : undefined) ?? this.guilds.activeGuild();
    }.bind(this),
  );
  /** Id of the group on screen, or empty while there is none (the page is redrawn with an animation when it changes). */
  protected readonly guildKey = computed(
    function (this: GroupViewComponent) {
      return this.guild()?.id ?? '';
    }.bind(this),
  );
  protected readonly isOwner = computed(
    function (this: GroupViewComponent) {
      return this.guilds.isOwner(this.guild());
    }.bind(this),
  );
  protected readonly channel = computed(
    function (this: GroupViewComponent) {
      const g = this.guild();
      if (!g) return undefined;
      const id = this.channelId();
      return (
        g.channels.find(function (c) {
          return c.id === id;
        }) ??
        g.channels.find(function (c) {
          return c.type === 'text';
        }) ??
        g.channels[0]
      );
    }.bind(this),
  );
  protected readonly placeholder = computed(
    function (this: GroupViewComponent) {
      return this.i18n.t('Message #{name}', { name: channelLabel(this.channel()?.name) });
    }.bind(this),
  );
  /**
   * The members as Discord shows them: a section for each tag (a person goes under the first tag of the group they
   * have) and the rest at the end. A group without tags is a single section with no title.
   */
  protected readonly memberSections = computed(this.buildSections.bind(this));

  /** Builds the sections of the members list. */
  private buildSections(): { id: string; label: string; color: string; items: MemberRow[] }[] {
    const guild = this.guild();
    const members = this.members();
    if (!guild) {
      return [{ id: 'all', label: '', color: '', items: members }];
    }
    const owners = members.filter(function owner(member) {
      return member.role === 'owner';
    });
    const others = members.filter(function other(member) {
      return member.role !== 'owner';
    });
    const sections = guild.tags.map(function start(tag) {
      return { id: tag.id, label: tag.name, color: tag.color, items: [] as MemberRow[] };
    });
    const rest: MemberRow[] = [];
    for (const member of others) {
      const section = sections.find(function has(candidate) {
        return member.tags.some(function same(tag) {
          return tag.id === candidate.id;
        });
      });
      (section ? section.items : rest).push(member);
    }
    const out = [
      { id: 'owner', label: this.i18n.t('Administrator'), color: '#fbbf24', items: owners },
      ...sections,
    ].filter(function used(section) {
      return section.items.length > 0;
    });
    if (rest.length) {
      out.push({ id: 'rest', label: this.i18n.t('Members'), color: '', items: rest });
    }
    return out;
  }

  /** The user whose tags are being edited in the window of tags (owner only). */
  protected readonly tagsFor = signal<string | null>(null);
  protected readonly newTagName = signal('');
  protected readonly newTagColor = signal('#38bdf8');
  protected readonly members = computed(
    function (this: GroupViewComponent) {
      const g = this.guild();
      if (!g) return [];
      const users = this.directory.users();
      return g.members
        .map(function (m) {
          return { user: users.get(m.userId)!, role: m.role, tags: tagsOf(g.tags, m.tags) };
        })
        .filter(function (m) {
          return !!m.user;
        });
    }.bind(this),
  );

  constructor() {
    effect(
      function (this: GroupViewComponent) {
        const g = this.guild();
        if (g)
          untracked(
            function (this: GroupViewComponent) {
              return this.guilds.setActive(g.id);
            }.bind(this),
          );
      }.bind(this),
    );
    // Normalise the URL to a concrete channel so reloads and links are stable.
    effect(
      function (this: GroupViewComponent) {
        const g = this.guild();
        const c = this.channel();
        if (g && c && (this.channelId() !== c.id || this.guildId() !== g.id)) {
          untracked(
            function (this: GroupViewComponent) {
              return void this.router.navigate(['/groups', g.id, c.id], { replaceUrl: true });
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

  /** Joins a voice channel: the call page opens and the call starts there. */
  protected async joinVoice(channelId: string): Promise<void> {
    await this.router.navigateByUrl('/voice');
    await this.call.join(channelId);
  }

  // ---- ordering the members (owner only) ----------------------------------------------------

  /** Member being dragged and member the drag is passing over (to mark where it will drop). */
  protected readonly dragging = signal<string | null>(null);
  protected readonly dropOver = signal<string | null>(null);

  /** Starts dragging a member to change the order (owner only). */
  protected startDrag(event: DragEvent, userId: string): void {
    this.dragging.set(userId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', userId);
    }
  }

  /**
   * A member is dragged over another: the place where it would fall is marked (the owner cannot be moved).
   */
  protected dragOverMember(event: DragEvent, userId: string): void {
    if (!this.dragging() || this.dragging() === userId || this.isOwnerId(userId)) {
      return;
    }
    event.preventDefault();
    this.dropOver.set(userId);
  }

  /** Ends the drag of a member. */
  protected endDrag(): void {
    this.dragging.set(null);
    this.dropOver.set(null);
  }

  /** Moves the dragged member to the place of the one it was dropped on. */
  protected dropMember(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const movedId = this.dragging();
    this.endDrag();
    if (!movedId || movedId === targetId || this.isOwnerId(targetId) || this.isOwnerId(movedId)) {
      return;
    }
    const ids = this.members().map(function (member) {
      return member.user.id;
    });
    const from = ids.indexOf(movedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      return;
    }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    this.saveOrder(ids);
  }

  /** Right click on a member (owner only): give or take their tags, manage the tags, and move them one place. */
  protected openMemberMenu(event: MouseEvent, userId: string): void {
    const guild = this.guild();
    if (!guild || !this.isOwner()) {
      return;
    }
    const items: MenuItem[] = [];
    for (const tag of guild.tags) {
      const has = this.memberHasTag(guild, userId, tag.id);
      items.push({
        label: tag.name,
        icon: has ? 'check' : 'tag',
        action: this.toggleTag.bind(this, guild.id, userId, tag.id),
      });
    }
    items.push({
      label: 'Manage tags',
      icon: 'settings',
      separator: guild.tags.length > 0,
      action: this.tagsFor.set.bind(this.tagsFor, userId),
    });
    if (!this.isOwnerId(userId)) {
      items.push(
        {
          label: 'Move member up',
          icon: 'chevron-up',
          separator: true,
          action: this.moveMember.bind(this, userId, -1),
        },
        {
          label: 'Move member down',
          icon: 'chevron-down',
          action: this.moveMember.bind(this, userId, 1),
        },
      );
    }
    this.contextMenu.open(event, items);
  }

  /** The tags a member has in this group. */
  protected tagsOfMember(userId: string): GuildTag[] {
    const guild = this.guild();
    const member = guild?.members.find(function same(item) {
      return item.userId === userId;
    });
    return guild && member ? tagsOf(guild.tags, member.tags) : [];
  }

  /** Whether a member has a tag. */
  protected memberHasTag(guild: Guild, userId: string, tagId: string): boolean {
    const member = guild.members.find(function same(item) {
      return item.userId === userId;
    });
    return !!member && member.tags.includes(tagId);
  }

  /** Gives a tag to a member or takes it away. */
  protected toggleTag(guildId: string, userId: string, tagId: string): void {
    const guild = this.guild();
    const member = guild?.members.find(function same(item) {
      return item.userId === userId;
    });
    if (!member) {
      return;
    }
    const next = member.tags.includes(tagId)
      ? member.tags.filter(function other(id) {
          return id !== tagId;
        })
      : [...member.tags, tagId];
    this.guilds.setMemberTags(guildId, userId, next).catch(this.showTagError.bind(this));
  }

  /** Creates a tag from the form and gives it to the person the window is open for. */
  protected async addTag(event: Event, guildId: string, userId: string): Promise<void> {
    event.preventDefault();
    const name = this.newTagName().trim();
    if (!name) {
      return;
    }
    this.newTagName.set('');
    try {
      const id = await this.guilds.createTag(guildId, name, this.newTagColor());
      const guild = this.guild();
      const member = guild?.members.find(function same(item) {
        return item.userId === userId;
      });
      if (member) {
        await this.guilds.setMemberTags(guildId, userId, [...member.tags, id]);
      }
    } catch (error) {
      this.showTagError(error);
    }
  }

  /** Moves a tag one place up or down (the sections follow). */
  protected moveTag(guild: Guild, tagId: string, step: number): void {
    const ids = guild.tags.map(function id(tag) {
      return tag.id;
    });
    const from = ids.indexOf(tagId);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) {
      return;
    }
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    this.guilds.reorderTags(guild.id, ids).catch(this.showTagError.bind(this));
  }

  /** Deletes a tag of the group. */
  protected removeTag(guildId: string, tagId: string): void {
    this.guilds.deleteTag(guildId, tagId).catch(this.showTagError.bind(this));
  }

  /** Shows why the tags could not be changed. */
  private showTagError(error: unknown): void {
    this.toast.error(this.i18n.t('Could not change the tags'), describeError(error));
  }

  /** True when the member is the owner of the group (who always stays at the top). */
  private isOwnerId(userId: string): boolean {
    for (const member of this.members()) {
      if (member.user.id === userId) {
        return member.role === 'owner';
      }
    }
    return false;
  }

  /** Moves a member one place up or down (the owner stays first). */
  private moveMember(userId: string, step: number): void {
    const ids = this.members().map(function (member) {
      return member.user.id;
    });
    const from = ids.indexOf(userId);
    const to = from + step;
    // The owner always stays first: nobody can be moved above them.
    const first = this.isOwnerId(ids[0] ?? '') ? 1 : 0;
    if (from < 0 || to < first || to >= ids.length) {
      return;
    }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    this.saveOrder(ids);
  }

  /** Stores the new order of the members. */
  private saveOrder(ids: string[]): void {
    const guild = this.guild();
    if (!guild) {
      return;
    }
    this.guilds.reorderMembers(guild.id, ids).catch(this.showOrderError.bind(this));
  }

  /** Shows why the order could not be saved. */
  private showOrderError(error: unknown): void {
    this.toast.error(this.i18n.t('Could not reorder the members'), describeError(error));
  }

  /** Asks to confirm and removes a member. */
  protected async kick(event: Event, user: User): Promise<void> {
    event.stopPropagation();
    const g = this.guild();
    const t = function (this: GroupViewComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !g ||
      !(await this.dialog.confirm(
        t('Remove {name}?', { name: user.displayName }),
        t(
          'They lose access immediately and the group key is replaced so they cannot read new messages.',
        ),
        { danger: true, confirmLabel: t('Remove') },
      ))
    )
      return;
    try {
      await this.guilds.removeMember(g.id, user.id);
      this.toast.success(t('Member removed'), t('The group key will be rotated.'));
    } catch (e) {
      this.toast.error(t('Could not remove member'), describeError(e));
    }
  }
}
