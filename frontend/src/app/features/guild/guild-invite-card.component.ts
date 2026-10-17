/**
 * src/app/features/guild/guild-invite-card.component.ts
 * The invitations to groups: a card with the banner, the icon and the name of the group and who invited, to accept or decline.
 * The person is not in the group until they accept. Shown in the conversation with whoever invited (`from`) and in the list of
 * requests of the Home (no `from`: all of them).
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DirectoryService } from '../../core/services/directory.service';
import { ToastService } from '../../core/services/toast.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { BannerComponent } from '../../shared/components/banner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { GuildStore, type GuildInviteView } from '../../store/guild.store';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-guild-invites',
  standalone: true,
  imports: [AvatarComponent, BannerComponent, IconComponent, TranslatePipe],
  host: { class: 'block' },
  template: `
    @for (invite of shown(); track invite.guildId) {
      <article
        class="anim-fade-up mx-3 mb-2 overflow-hidden rounded-ui border border-white/10 bg-ink-800 sm:max-w-sm"
      >
        <app-banner class="h-14" [color]="invite.tagColor" />
        <div class="px-3 pb-3">
          <div class="-mt-6 flex items-end gap-3">
            <app-avatar
              class="shrink-0 rounded-ui ring-2 ring-ink-800"
              [imageId]="invite.iconImage"
              [name]="invite.name"
              shape="square"
              [size]="52"
            />
            <div class="min-w-0 flex-1 pb-0.5 leading-tight">
              <div class="truncate text-sm font-bold">{{ invite.name }}</div>
              <div class="truncate text-xs text-muted">
                {{ 'Invited by {name}' | t: { name: inviterName(invite) } }}
              </div>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="btn btn-primary btn-sm flex-1 justify-center"
              [disabled]="busy() === invite.guildId"
              (click)="accept(invite)"
            >
              <app-icon name="check" [size]="14" /> {{ 'Accept' | t }}
            </button>
            <button
              type="button"
              class="btn btn-sm flex-1 justify-center"
              [disabled]="busy() === invite.guildId"
              (click)="decline(invite)"
            >
              {{ 'Decline' | t }}
            </button>
          </div>
        </div>
      </article>
    }
  `,
})
export class GuildInviteCardComponent {
  private readonly guilds = inject(GuildStore);
  private readonly directory = inject(DirectoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  /** Only the invitations from this person (nothing: all of them). */
  readonly from = input<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  protected readonly shown = computed(
    function (this: GuildInviteCardComponent) {
      const from = this.from();
      return this.guilds.invites().filter(function wanted(invite) {
        return !from || invite.inviterId === from;
      });
    }.bind(this),
  );

  protected inviterName(invite: GuildInviteView): string {
    return this.directory.get(invite.inviterId)?.displayName ?? '';
  }

  protected async accept(invite: GuildInviteView): Promise<void> {
    this.busy.set(invite.guildId);
    try {
      await this.guilds.acceptInvite(invite.guildId);
    } catch {
      this.toast.error(
        this.i18n.t('Could not join'),
        this.i18n.t('The invitation is not valid any more.'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async decline(invite: GuildInviteView): Promise<void> {
    this.busy.set(invite.guildId);
    try {
      await this.guilds.declineInvite(invite.guildId);
    } finally {
      this.busy.set(null);
    }
  }
}
