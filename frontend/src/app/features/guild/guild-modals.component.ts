/**
 * src/app/features/guild/guild-modals.component.ts
 * Group dialogs: create, invite, settings, members and channels.
 */
import {
  Component,
  EnvironmentInjector,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DialogService } from '../../core/services/dialog.service';
import { IMAGE_PRESETS, ImageService } from '../../core/services/image.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { NameColorDirective } from '../../shared/util/name-color.directive';
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../../shared/util/name-fx.directive';
import { IconComponent } from '../../shared/components/icon.component';
import {
  ServerTagComponent,
  TAG_COLORS,
  TAG_ICONS,
} from '../../shared/components/server-tag.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { describeError } from '../../shared/util/errors';
import { ChannelLabelPipe } from '../../shared/util/channel-label.pipe';
import { GuildStore } from '../../store/guild.store';
import { SocialStore } from '../../store/social.store';

/** All group-related dialogs, opened through UiService from anywhere in the app. */
@Component({
  selector: 'app-guild-modals',
  standalone: true,
  imports: [
    ServerTagComponent,
    NameColorDirective,
    UserFontDirective,
    NameFxDirective,
    ModalComponent,
    IconComponent,
    AvatarComponent,
    TranslatePipe,
    ChannelLabelPipe,
  ],
  template: `
    @if (ui.createGuildOpen()) {
      <app-modal
        [title]="'Create a group' | t"
        [subtitle]="'A private space with its own end-to-end encryption key.' | t"
        (closed)="closeCreate()"
      >
        <form class="space-y-5" (submit)="create($event)">
          <div class="flex items-center gap-4">
            <button
              type="button"
              class="group relative h-20 w-20 shrink-0 overflow-hidden border-2 border-dashed border-white/20 hover:border-accent"
              style="border-radius: var(--r-lg)"
              (click)="pickCreateImage()"
              [attr.aria-label]="'Upload an icon' | t"
            >
              @if (createPreview(); as src) {
                <img [src]="src" alt="" class="h-full w-full object-cover" />
              } @else {
                <span
                  class="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted group-hover:text-accent"
                  ><app-icon name="upload" [size]="20" /> {{ 'Icon' | t }}
                  <span class="text-[0.625rem] text-dim">{{ 'Up to 8 MB' | t }}</span></span
                >
              }
            </button>
            <label class="block flex-1">
              <span class="label">{{ 'Group name' | t }}</span>
              <input
                class="input mt-1.5"
                maxlength="48"
                [placeholder]="'e.g. Game night' | t"
                [value]="name()"
                (input)="name.set($any($event.target).value)"
                required
              />
            </label>
          </div>
          <p class="panel-flat flex gap-2 p-3 text-xs text-muted">
            <app-icon name="key" [size]="15" class="mt-0.5 shrink-0 text-accent" />
            {{
              'A fresh AES-256 key is generated in your browser and shared only with members, wrapped for each of their keys.'
                | t
            }}
          </p>
          <div class="flex justify-end gap-2">
            <button class="btn" type="button" (click)="closeCreate()">{{ 'Cancel' | t }}</button>
            <button class="btn btn-primary" type="submit" [disabled]="!name().trim() || busy()">
              @if (busy()) {
                {{ 'Creating…' | t }}
              } @else {
                <app-icon name="plus" [size]="16" /> {{ 'Create group' | t }}
              }
            </button>
          </div>
        </form>
      </app-modal>
    }

    @if (ui.inviteOpen() && guild(); as g) {
      <app-modal
        [title]="'Invite to {name}' | t: { name: g.name }"
        [subtitle]="'Friends get the group key wrapped just for them.' | t"
        (closed)="ui.inviteOpen.set(false)"
      >
        <div class="max-h-80 space-y-1 overflow-y-auto">
          @for (u of invitable(); track u.id) {
            <div class="nav-item cursor-default !py-2">
              <app-avatar [user]="u" [size]="34" [status]="social.statusOf(u.id)" />
              <span class="min-w-0 flex-1"
                ><span
                  class="block truncate font-semibold text-fg"
                  [appNameColor]="u.profileColor"
                  [appUserFont]="u.nameFont"
                  [nameFx]="u.nameFx"
                  >{{ u.displayName }}</span
                ><span class="text-xs">&#64;{{ u.username }}</span></span
              >
              <button
                class="btn btn-sm btn-primary"
                type="button"
                (click)="invite(u.id)"
                [disabled]="inviting() === u.id"
              >
                @if (inviting() === u.id) {
                  …
                } @else {
                  {{ 'Invite' | t }}
                }
              </button>
            </div>
          } @empty {
            <p class="p-6 text-center text-sm text-muted">
              {{ 'All your friends are already here — or you have not added any yet.' | t }}
            </p>
          }
        </div>
      </app-modal>
    }

    @if (ui.guildSettingsOpen() && guild(); as g) {
      <app-modal
        [title]="'Group settings' | t"
        [subtitle]="g.name"
        [width]="560"
        (closed)="ui.guildSettingsOpen.set(false)"
      >
        <div class="space-y-6">
          @if (isOwner()) {
            <section class="flex items-center gap-4">
              <button
                type="button"
                class="group relative shrink-0"
                (click)="changeIcon()"
                [attr.aria-label]="'Change icon' | t"
              >
                <app-avatar [imageId]="g.iconImage" [name]="g.name" shape="square" [size]="72" />
                <span
                  class="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 group-hover:opacity-100"
                  style="border-radius: var(--r-lg)"
                  ><app-icon name="upload" [size]="20"
                /></span>
              </button>
              <div class="min-w-0 flex-1 space-y-2">
                <span class="label">{{ 'Group name' | t }}</span>
                <div class="flex gap-2">
                  <input
                    class="input min-w-0 flex-1"
                    maxlength="48"
                    [value]="editName() || g.name"
                    (input)="editName.set($any($event.target).value)"
                    [attr.aria-label]="'Group name' | t"
                  />
                  <button
                    class="btn btn-primary"
                    type="button"
                    (click)="saveName()"
                    [disabled]="!editName() || editName() === g.name"
                  >
                    {{ 'Save' | t }}
                  </button>
                </div>
                @if (g.iconImage) {
                  <button class="btn btn-sm" type="button" (click)="removeIcon()">
                    {{ 'Remove icon' | t }}
                  </button>
                }
              </div>
            </section>
          }

          @if (isOwner()) {
            <section class="panel-flat p-3.5">
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="label">{{ 'Group tag' | t }}</span>
                <app-server-tag [tag]="{ text: tagText(), color: tagColor(), icon: tagIcon() }" />
              </div>
              <p class="mb-2.5 text-xs text-muted">
                {{
                  'A short mark of up to four letters or numbers. The members who want it show it next to their name.'
                    | t
                }}
              </p>
              <div class="flex gap-2">
                <input
                  class="input min-w-0 flex-1 uppercase"
                  maxlength="4"
                  [value]="tagText()"
                  [placeholder]="'TAG' | t"
                  [attr.aria-label]="'Group tag' | t"
                  (input)="tagText.set($any($event.target).value.replace(/[^A-Za-z0-9]/g, ''))"
                />
                <button
                  class="btn btn-primary"
                  type="button"
                  (click)="saveTag()"
                  [disabled]="!tagChanged()"
                >
                  {{ 'Save' | t }}
                </button>
              </div>
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                @for (color of tagColors; track color) {
                  <button
                    type="button"
                    class="h-6 w-6 rounded-full border-2"
                    [style.background]="color"
                    [class]="tagColor() === color ? 'border-white' : 'border-transparent'"
                    [attr.aria-label]="color"
                    (click)="tagColor.set(color)"
                  ></button>
                }
              </div>
              <div class="mt-2.5 flex flex-wrap gap-1">
                <button
                  type="button"
                  class="choice-card !min-h-0 px-2 py-1 text-xs"
                  [class.is-on]="!tagIcon()"
                  (click)="tagIcon.set('')"
                >
                  {{ 'No icon' | t }}
                </button>
                @for (icon of tagIcons; track icon) {
                  <button
                    type="button"
                    class="choice-card !min-h-0 px-2 py-1 text-base"
                    [class.is-on]="tagIcon() === icon"
                    (click)="tagIcon.set(icon)"
                  >
                    {{ icon }}
                  </button>
                }
              </div>
            </section>
          }

          <section>
            <div class="mb-2 flex items-center justify-between">
              <span class="label">{{ 'Channels' | t }}</span>
              @if (isOwner()) {
                <span class="flex gap-1"
                  ><button class="btn btn-sm" type="button" (click)="ui.addChannelOpen.set('text')">
                    <app-icon name="hash" [size]="13" /> {{ 'Text' | t }}</button
                  ><button
                    class="btn btn-sm"
                    type="button"
                    (click)="ui.addChannelOpen.set('voice')"
                  >
                    <app-icon name="volume" [size]="13" /> {{ 'Voice' | t }}
                  </button></span
                >
              }
            </div>
            @for (c of g.channels; track c.id) {
              <div class="flex items-center gap-2 rounded-ui px-2 py-1.5 hover:bg-white/5">
                <app-icon
                  [name]="c.type === 'text' ? 'hash' : 'volume'"
                  [size]="15"
                  class="text-dim"
                />
                <span class="flex-1 truncate">{{ c.name | channelLabel }}</span>
                @if (isOwner()) {
                  <button
                    class="btn btn-icon btn-sm btn-soft-danger"
                    type="button"
                    (click)="deleteChannel(c.id, c.name)"
                    [attr.aria-label]="'Delete channel' | t"
                  >
                    <app-icon name="trash" [size]="13" />
                  </button>
                }
              </div>
            }
          </section>

          <section class="panel-flat p-3 text-xs text-muted">
            <div class="mb-1 flex items-center gap-2 font-semibold text-fg">
              <app-icon name="key" [size]="14" class="text-accent" /> {{ 'Encryption' | t }}
            </div>
            {{
              'Group key version {v} · {n} members. The key is replaced whenever someone leaves or is removed, so they cannot read anything new.'
                | t: { v: g.keyVersion, n: g.members.length }
            }}
            @if (g.needsRotation) {
              <span class="chip chip-amber ml-1">{{ 'rotation pending' | t }}</span>
            }
          </section>

          <section class="flex flex-wrap justify-end gap-2 border-t border-white/6 pt-4">
            @if (isOwner()) {
              <button class="btn btn-danger" type="button" (click)="deleteGuild()">
                <app-icon name="trash" [size]="15" /> {{ 'Delete group' | t }}
              </button>
            } @else {
              <button class="btn btn-soft-danger" type="button" (click)="leaveGuild()">
                <app-icon name="logout" [size]="15" /> {{ 'Leave group' | t }}
              </button>
            }
          </section>
        </div>
      </app-modal>
    }

    @if (ui.addChannelOpen()) {
      <app-modal [title]="'Create channel' | t" (closed)="ui.addChannelOpen.set(null)">
        <form class="space-y-4" (submit)="addChannel($event)">
          <div class="grid grid-cols-2 gap-2">
            @for (type of types; track type.id) {
              <button
                type="button"
                class="flex items-center gap-3 rounded-ui border p-3 text-left"
                [class.border-accent]="channelType() === type.id"
                [class.bg-accent/10]="channelType() === type.id"
                [class.border-white/10]="channelType() !== type.id"
                (click)="channelType.set(type.id)"
              >
                <app-icon
                  [name]="type.icon"
                  [size]="20"
                  [class]="channelType() === type.id ? 'text-accent' : 'text-muted'"
                />
                <span class="leading-tight"
                  ><b class="block text-sm">{{ type.label | t }}</b
                  ><span class="text-[0.6875rem] text-muted">{{ type.hint | t }}</span></span
                >
              </button>
            }
          </div>
          <label class="block"
            ><span class="label">{{ 'Channel name' | t }}</span>
            <input
              class="input mt-1.5"
              maxlength="32"
              [placeholder]="(channelType() === 'text' ? 'General chat' : 'Lounge') | t"
              [value]="channelName()"
              (input)="channelName.set($any($event.target).value)"
            />
          </label>
          <div class="flex justify-end gap-2">
            <button class="btn" type="button" (click)="ui.addChannelOpen.set(null)">
              {{ 'Cancel' | t }}</button
            ><button class="btn btn-primary" type="submit" [disabled]="!channelName().trim()">
              {{ 'Create channel' | t }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class GuildModalsComponent {
  protected readonly ui = inject(UiService);
  protected readonly guilds = inject(GuildStore);
  protected readonly social = inject(SocialStore);
  private readonly images = inject(ImageService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  protected readonly types = [
    { id: 'text' as const, icon: 'hash', label: 'Text channel', hint: 'Messages, files, GIFs' },
    { id: 'voice' as const, icon: 'volume', label: 'Voice channel', hint: 'Voice, video, screen' },
  ];
  protected readonly name = signal('');
  protected readonly createBlob = signal<Blob | null>(null);
  protected readonly createPreview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly inviting = signal<string | null>(null);
  protected readonly channelName = signal('');
  protected readonly channelType = signal<'text' | 'voice'>('text');
  protected readonly editName = signal('');
  protected readonly tagColors = TAG_COLORS;
  protected readonly tagIcons = TAG_ICONS;
  /** What is typed for the tag of the group (it starts as the saved tag, see the effect in the constructor). */
  protected readonly tagText = signal('');
  protected readonly tagColor = signal(TAG_COLORS[0]!);
  protected readonly tagIcon = signal('');
  /** Whether the tag on the screen is not the one that is saved. */
  protected readonly tagChanged = computed(this.hasTagChanged.bind(this));

  protected readonly guild = computed(
    function (this: GuildModalsComponent) {
      return this.guilds.activeGuild();
    }.bind(this),
  );
  protected readonly isOwner = computed(
    function (this: GuildModalsComponent) {
      return this.guilds.isOwner(this.guild());
    }.bind(this),
  );
  protected readonly invitable = computed(
    function (this: GuildModalsComponent) {
      const g = this.guild();
      if (!g) return [];
      const members = new Set(
        g.members.map(function (m) {
          return m.userId;
        }),
      );
      return this.social.friendUsers().filter(function (u) {
        return !members.has(u.id);
      });
    }.bind(this),
  );

  constructor() {
    // The fields of the tag start from the tag of the group that is open.
    effect(
      function (this: GuildModalsComponent) {
        const g = this.guild();
        untracked(
          function (this: GuildModalsComponent) {
            this.tagText.set(g?.tag?.text ?? '');
            this.tagColor.set(g?.tag?.color || TAG_COLORS[0]!);
            this.tagIcon.set(g?.tag?.icon ?? '');
          }.bind(this),
        );
      }.bind(this),
    );
    // When the "create channel" dialog opens, preselect the type the user asked for.
    effect(
      function (this: GuildModalsComponent) {
        const kind = this.ui.addChannelOpen();
        if (kind)
          untracked(
            function (this: GuildModalsComponent) {
              return this.channelType.set(kind);
            }.bind(this),
          );
      }.bind(this),
    );
  }

  /** Whether what is typed for the tag differs from the saved tag. */
  private hasTagChanged(): boolean {
    const saved = this.guild()?.tag;
    return (
      this.tagText().toUpperCase() !== (saved?.text ?? '') ||
      this.tagColor() !== (saved?.color || TAG_COLORS[0]) ||
      this.tagIcon() !== (saved?.icon ?? '')
    );
  }

  /** Saves the tag of the group. */
  protected async saveTag(): Promise<void> {
    const g = this.guild();
    if (!g) return;
    try {
      await this.guilds.update(g.id, {
        tag: this.tagText().toUpperCase(),
        tagColor: this.tagColor(),
        tagIcon: this.tagIcon(),
      });
      this.toast.success(this.i18n.t('Tag saved'));
    } catch (e) {
      this.toast.error(this.i18n.t('Could not save the tag'), describeError(e));
    }
  }

  /** Closes the window to create a group and forgets what was typed. */
  protected closeCreate(): void {
    this.ui.createGuildOpen.set(false);
    this.name.set('');
    this.createBlob.set(null);
    const preview = this.createPreview();
    if (preview) URL.revokeObjectURL(preview);
    this.createPreview.set(null);
  }

  /** Chooses the picture of the new group (a moving GIF is kept as it is). */
  protected async pickCreateImage(): Promise<void> {
    const file = await this.images.pickFile();
    if (!file) return;
    try {
      const adjuster = await import('../../shared/components/image-adjust.component');
      const blob = await adjuster.prepareImage(this.injector, file, IMAGE_PRESETS.group);
      if (!blob) return;
      this.createBlob.set(blob);
      this.createPreview.set(URL.createObjectURL(blob));
    } catch {
      this.toast.error(this.i18n.t('That image could not be read'));
    }
  }

  /** Creates the group: key, channels and picture. */
  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    try {
      const guild = await this.guilds.create(this.name().trim(), '');
      const blob = this.createBlob();
      if (blob) {
        await this.guilds.setIcon(guild.id, blob);
      }
      this.closeCreate();
      this.toast.success(
        this.i18n.t('Group created'),
        this.i18n.t("Its encryption key lives only on members' devices."),
      );
      await this.router.navigate(['/groups', guild.id]);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not create the group'), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Invites a friend to the group. */
  protected async invite(userId: string): Promise<void> {
    const g = this.guild();
    if (!g) return;
    this.inviting.set(userId);
    try {
      await this.guilds.invite(g.id, userId);
      this.toast.success(this.i18n.t('Invited'));
    } catch (e) {
      this.toast.error(this.i18n.t('Invite failed'), describeError(e));
    } finally {
      this.inviting.set(null);
    }
  }

  /** Adds a text or voice channel. */
  protected async addChannel(event: Event): Promise<void> {
    event.preventDefault();
    const g = this.guild();
    if (!g) return;
    try {
      const channel = await this.guilds.addChannel(
        g.id,
        this.channelName().trim(),
        this.channelType(),
      );
      this.channelName.set('');
      this.ui.addChannelOpen.set(null);
      if (channel.type === 'text') await this.router.navigate(['/groups', g.id, channel.id]);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not create the channel'), describeError(e));
    }
  }

  /** Saves the new name of the group. */
  protected async saveName(): Promise<void> {
    const g = this.guild();
    if (!g) return;
    try {
      await this.guilds.update(g.id, { name: this.editName() });
      this.editName.set('');
      this.toast.success(this.i18n.t('Saved'));
    } catch (e) {
      this.toast.error(this.i18n.t('Could not save'), describeError(e));
    }
  }

  /** Changes the picture of the group. */
  protected async changeIcon(): Promise<void> {
    const g = this.guild();
    if (!g) return;
    try {
      const adjuster = await import('../../shared/components/image-adjust.component');
      const blob = await adjuster.pickAndPrepareImage(this.images, this.injector, 'group');
      if (blob) await this.guilds.setIcon(g.id, blob);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not upload the image'), describeError(e));
    }
  }

  /** Removes the picture of the group. */
  protected async removeIcon(): Promise<void> {
    const g = this.guild();
    if (g) await this.guilds.update(g.id, { iconImage: null });
  }

  /** Asks to confirm and deletes a channel. */
  protected async deleteChannel(id: string, name: string): Promise<void> {
    const g = this.guild();
    const t = function (this: GuildModalsComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !g ||
      !(await this.dialog.confirm(
        t('Delete #{name}?', { name }),
        t('All its messages and files are removed for everyone.'),
        { danger: true, confirmLabel: t('Delete') },
      ))
    )
      return;
    try {
      await this.guilds.deleteChannel(g.id, id);
    } catch (e) {
      this.toast.error(t('Could not delete the channel'), describeError(e));
    }
  }

  /** Asks to confirm and leaves the group. */
  protected async leaveGuild(): Promise<void> {
    const g = this.guild();
    const t = function (this: GuildModalsComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !g ||
      !(await this.dialog.confirm(
        t('Leave {name}?', { name: g.name }),
        t('You will lose access to its history.'),
        { danger: true, confirmLabel: t('Leave') },
      ))
    )
      return;
    await this.guilds.leave(g.id);
    this.ui.guildSettingsOpen.set(false);
    await this.router.navigateByUrl('/groups');
  }

  /** Asks to confirm and deletes the group for everybody. */
  protected async deleteGuild(): Promise<void> {
    const g = this.guild();
    const t = function (this: GuildModalsComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !g ||
      !(await this.dialog.confirm(
        t('Delete {name}?', { name: g.name }),
        t('This permanently deletes every channel, message and file. It cannot be undone.'),
        { danger: true, confirmLabel: t('Delete forever') },
      ))
    )
      return;
    await this.guilds.deleteGuild(g.id);
    this.ui.guildSettingsOpen.set(false);
    await this.router.navigateByUrl('/groups');
  }
}
