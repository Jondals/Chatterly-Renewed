/**
 * src/app/shared/components/profile-card.component.ts
 * Public card of a user: banner, picture, name, status and description.
 */
import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { GuildTag, PresenceStatus, User } from '../../core/models';
import { ImageService } from '../../core/services/image.service';
import { NameColorDirective } from '../util/name-color.directive';
import { parseRichText } from '../util/rich-text';
import { AvatarComponent } from './avatar.component';
import { BannerComponent } from './banner.component';
import { RichTextComponent } from './rich-text.component';

/** A user's public card: custom banner, picture, name font, pronouns, status and bio. */
import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NameFxDirective } from '../util/name-fx.directive';
import { fontClassOf } from '../util/user-font.directive';
import { ServerTagComponent } from './server-tag.component';
@Component({
  selector: 'app-profile-card',
  standalone: true,
  imports: [
    ServerTagComponent,
    UserFontDirective,
    NameFxDirective,
    AvatarComponent,
    BannerComponent,
    NameColorDirective,
    RichTextComponent,
    TranslatePipe,
  ],
  template: `
    @if (user(); as u) {
      <article class="overflow-hidden rounded-ui-lg border border-white/8 bg-black/20">
        <app-banner class="h-24" [image]="banner()" [color]="u.bannerColor" />
        <div class="px-4 pb-4">
          <div class="-mt-8 flex items-end justify-between">
            <span class="rounded-full ring-4 ring-ink-850"
              ><app-avatar
                [user]="u"
                [size]="56"
                [status]="status()"
                [aura]="true"
                [zoomable]="true"
            /></span>
            <ng-content select="[actions]" />
          </div>
          <h2
            class="mt-2 text-lg font-bold leading-tight"
            [class]="nameClass()"
            [appNameColor]="u.profileColor"
            [appUserFont]="u.nameFont"
            [nameFx]="u.nameFx"
          >
            {{ u.displayName }}
            <app-server-tag class="ml-1.5" [tag]="u.serverTag" />
          </h2>
          @if (showHandle() || u.pronouns) {
            <p class="text-xs text-muted">
              @if (showHandle()) {
                &#64;{{ u.username }}
              }
              @if (u.pronouns) {
                @if (showHandle()) {
                  ·
                }
                {{ u.pronouns }}
              }
            </p>
          }
          @if (tags().length) {
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (tag of tags(); track tag.id) {
                <span class="guild-tag" [style.--tag]="tag.color">{{ tag.name }}</span>
              }
            </div>
          }
          @if (u.statusText) {
            <p class="mt-2 text-sm">{{ u.statusText }}</p>
          }
          @if (u.bio) {
            <div class="mt-3 border-t border-white/6 pt-3">
              <div class="label mb-1">{{ 'About me' | t }}</div>
              <p class="whitespace-pre-wrap break-words text-sm text-muted">
                <app-rich-text [segments]="bio()" />
              </p>
            </div>
          }
          <div class="mt-3 border-t border-white/6 pt-3 text-xs text-muted">
            <span class="label mr-1">{{ 'Member since' | t }}</span> {{ since() }}
          </div>
          <ng-content />
        </div>
      </article>
    }
  `,
})
export class ProfileCardComponent {
  readonly user = input<User | null | undefined>(undefined);
  readonly status = input<PresenceStatus | null>(null);
  /** Show "@username" under the name (not inside a group, where people go by their display name). */
  readonly showHandle = input(true);
  /** The tags the person has in the group this profile is shown in. */
  readonly tags = input<GuildTag[]>([]);

  private readonly images = inject(ImageService);
  private readonly i18n = inject(I18nService);

  protected readonly bio = computed(
    function (this: ProfileCardComponent) {
      return parseRichText(this.user()?.bio ?? '');
    }.bind(this),
  );
  protected readonly nameClass = computed(
    function (this: ProfileCardComponent) {
      const f = this.user()?.nameFont;
      return fontClassOf(f);
    }.bind(this),
  );
  protected readonly banner = computed(
    function (this: ProfileCardComponent) {
      const url = this.images.url(this.user()?.bannerImage);
      return url ? `url(${url})` : null;
    }.bind(this),
  );
  protected readonly since = computed(
    function (this: ProfileCardComponent) {
      return new Date(this.user()?.createdAt ?? Date.now()).toLocaleDateString(this.i18n.locale(), {
        month: 'short',
        year: 'numeric',
      });
    }.bind(this),
  );

  constructor() {
    effect(
      function (this: ProfileCardComponent) {
        const id = this.user()?.bannerImage;
        untracked(
          function (this: ProfileCardComponent) {
            return this.images.ensure(id);
          }.bind(this),
        );
      }.bind(this),
    );
  }
}
