/**
 * src/app/features/chat/link-card.component.ts
 * The block a link preview shows as inside a message: the video on top (when the link is a video) and the
 * link with its title and description underneath.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { FrameAllowDirective } from '../../shared/util/iframe-allow';
import {
  isSafeLink,
  videoEmbed,
  type LinkPreview,
  type VideoEmbed,
} from '../../shared/util/link-preview';

/**
 * Link block. A video link shows a player: nothing is loaded from the video site until the player is
 * opened (press play).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-link-card',
  standalone: true,
  imports: [FrameAllowDirective, IconComponent, TranslatePipe],
  template: `
    @if (safe()) {
      <div
        class="mt-2 w-80 max-w-full overflow-hidden rounded-ui-lg border border-white/10 bg-ink-800"
      >
        @if (video(); as embed) {
          <div class="relative w-full bg-black" [style.aspect-ratio]="embed.ratio">
            @if (playing()) {
              @if (embed.kind === 'file') {
                <video
                  class="absolute inset-0 h-full w-full"
                  [src]="embed.src"
                  controls
                  playsinline
                  preload="metadata"
                ></video>
              } @else {
                <iframe
                  class="absolute inset-0 h-full w-full border-0"
                  [frameAllow]="allowMedia"
                  [src]="frameSrc()!"
                  [title]="embed.provider"
                  loading="lazy"
                  referrerpolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
                  allowfullscreen
                ></iframe>
              }
            } @else {
              @if (preview().image) {
                <img decoding="async" loading="lazy"
                  [src]="preview().image"
                  alt=""
                  class="absolute inset-0 h-full w-full object-cover opacity-80"
                  draggable="false"
                />
              }
              <button
                type="button"
                class="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20"
                [attr.aria-label]="'Play video' | t"
                (click)="play()"
              >
                <span
                  class="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-[var(--accent-ink)] shadow-xl"
                  ><app-icon name="play" [size]="26"
                /></span>
              </button>
              <span
                class="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[0.625rem] font-semibold text-white"
                >{{ embed.provider }}</span
              >
            }
          </div>
        }
        <a
          class="flex gap-3 p-3 hover:bg-white/5"
          [href]="preview().url"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          @if (!video() && preview().image) {
            <img decoding="async" loading="lazy"
              [src]="preview().image"
              alt=""
              class="h-16 w-16 shrink-0 rounded-ui object-cover"
              draggable="false"
            />
          }
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1 text-[0.6875rem] text-muted"
              ><app-icon name="link" [size]="11" />
              <span class="truncate">{{ preview().site }}</span></span
            >
            @if (preview().title) {
              <span class="mt-0.5 block line-clamp-2 text-sm font-semibold leading-snug">{{
                preview().title
              }}</span>
            }
            @if (preview().description) {
              <span class="mt-0.5 block line-clamp-2 text-xs text-muted">{{
                preview().description
              }}</span>
            }
            <span class="mt-0.5 block truncate text-[0.6875rem] text-accent">{{
              preview().url
            }}</span>
          </span>
        </a>
      </div>
    }
  `,
})
export class LinkCardComponent {
  protected readonly allowMedia = [
    'autoplay',
    'encrypted-media',
    'picture-in-picture',
    'fullscreen',
  ];
  /** The preview that travelled inside the message. */
  readonly preview = input.required<LinkPreview>();

  private readonly sanitizer = inject(DomSanitizer);

  /** True once the person pressed play. */
  protected readonly started = signal(false);
  protected readonly safe = computed(this.checkSafe.bind(this));
  protected readonly video = computed(this.findVideo.bind(this));
  protected readonly playing = computed(this.isPlaying.bind(this));
  protected readonly frameSrc = computed(this.buildFrameSrc.bind(this));

  /** Only https links are drawn as links (never javascript: or data:). */
  private checkSafe(): boolean {
    return isSafeLink(this.preview().url);
  }

  /** The player of the link, if it is a video or music that can play inside the chat. */
  private findVideo(): VideoEmbed | null {
    return videoEmbed(this.preview().url);
  }

  /** Whether the person already pressed play (the player does not load anything before). */
  private isPlaying(): boolean {
    return this.started();
  }

  /** The player address was built by videoEmbed from checked identifiers, so it is safe to trust here. */
  private buildFrameSrc(): SafeResourceUrl | null {
    const embed = this.video();
    return embed && embed.kind === 'frame'
      ? this.sanitizer.bypassSecurityTrustResourceUrl(embed.src)
      : null;
  }

  /** Starts the player. */
  protected play(): void {
    this.started.set(true);
  }
}
