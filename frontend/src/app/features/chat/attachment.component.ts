/**
 * src/app/features/chat/attachment.component.ts
 * Shows an encrypted attachment: it downloads it, decrypts it and checks its integrity before showing it.
 */
import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SoundImportService } from './sound-import.service';
import { formatBytes, formatDuration } from '../../shared/pipes/timestamp.pipe';
import { IconComponent } from '../../shared/components/icon.component';
import { MessageStore, type ViewAttachment } from '../../store/message.store';

/** The speeds of a voice note or an audio. */
const SPEEDS = [1, 1.25, 1.5, 2, 3, 5];

/**
 * Renders one encrypted attachment. Bytes are fetched as ciphertext, decrypted in the browser and
 * checked against the SHA-256 that travelled inside the E2EE message before anything is shown.
 */
@Component({
  selector: 'app-attachment',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    @switch (att().kind) {
      @case ('image') {
        @if (att().sticker) {
          @if (url(); as src) {
            <img
              [src]="src"
              alt=""
              draggable="false"
              class="anim-pop mt-1 h-36 w-36 object-contain drop-shadow-lg transition duration-300 hover:scale-110 hover:-rotate-3"
            />
          } @else if (error()) {
            <div
              class="mt-1 flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-ui border border-dashed border-white/15 p-2 text-center text-[0.6875rem] text-muted"
            >
              <app-icon name="alert-triangle" [size]="18" /> {{ 'Sticker not available' | t }}
            </div>
          } @else {
            <div class="shimmer mt-1 h-36 w-36 rounded-ui"></div>
          }
        } @else {
          <div
            class="group relative mt-2 max-w-sm overflow-hidden rounded-ui border border-white/8 bg-black/30"
          >
            @if (url(); as src) {
              <img
                [src]="src"
                [alt]="att().name"
                class="anim-fade-in max-h-80 w-full cursor-zoom-in object-cover transition duration-500 group-hover:scale-[1.02]"
                (click)="lightbox.set(true)"
              />
            } @else if (error()) {
              <div class="flex h-32 items-center justify-center gap-2 text-sm text-red-300">
                <app-icon name="alert-triangle" [size]="16" /> {{ error() }}
              </div>
            } @else {
              <div class="shimmer h-40 w-72"></div>
            }
            @if (att().gif) {
              <span
                class="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-white backdrop-blur-sm"
                >GIF</span
              >
            }
            <div
              class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-2 pt-8 text-[0.6875rem] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            >
              <span class="truncate text-white/85">{{ att().name }}</span>
              @if (url()) {
                <span
                  class="flex shrink-0 items-center gap-1 text-white/70"
                  [attr.title]="'Checked with SHA-256' | t"
                  ><app-icon name="shield-check" [size]="12" class="text-accent" />
                  {{ size() }}</span
                >
              }
            </div>
          </div>
        }
        @if (lightbox() && url()) {
          <div
            class="anim-fade-in fixed inset-0 z-[95] flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur"
            (click)="lightbox.set(false)"
          >
            <img
              [src]="url()!"
              [alt]="att().name"
              class="anim-pop max-h-full max-w-full rounded-ui shadow-2xl"
            />
          </div>
        }
      }
      @case ('audio') {
        <div
          class="mt-2 flex w-72 max-w-full items-center gap-3 rounded-ui border border-white/8 bg-black/30 p-2.5"
        >
          <button
            class="btn btn-icon btn-primary !rounded-full"
            type="button"
            (click)="toggleAudio()"
            [disabled]="!url()"
            [attr.aria-label]="playing() ? 'Pause' : 'Play'"
          >
            <app-icon [name]="playing() ? 'pause' : 'play'" [size]="16" />
          </button>
          <div class="flex-1">
            <div class="flex h-8 items-center gap-[2px]">
              @for (bar of bars(); track $index) {
                <span
                  class="w-[3px] flex-1 rounded-full transition-colors"
                  [style.height.%]="bar"
                  [style.background]="
                    $index / bars().length <= progress() ? 'var(--accent)' : 'rgba(255,255,255,.22)'
                  "
                ></span>
              }
            </div>
            <div
              class="mt-0.5 flex items-center justify-between font-mono text-[0.625rem] text-muted"
            >
              <span>{{ elapsed() }}</span
              ><span>{{ total() }}</span>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-sm !h-7 min-w-[2.75rem] !px-2 font-mono text-[0.6875rem]"
            [class.btn-active]="rate() !== 1"
            [attr.title]="'Playback speed' | t"
            [attr.aria-label]="'Playback speed' | t"
            (click)="cycleRate()"
          >
            {{ rate() }}x
          </button>
          @if (att().kind === 'audio' || att().kind === 'video') {
            <button
              class="btn btn-icon btn-sm"
              type="button"
              [disabled]="!url() || adding()"
              [attr.title]="'Add to my soundboard' | t"
              [attr.aria-label]="'Add to my soundboard' | t"
              (click)="addToSoundboard()"
            >
              <app-icon name="waveform" [size]="15" />
            </button>
          }
          @if (url(); as src) {
            <audio
              #audio
              [src]="src"
              preload="metadata"
              (timeupdate)="onTime()"
              (ended)="playing.set(false); progress.set(0)"
              (loadedmetadata)="onMeta()"
            ></audio>
          }
        </div>
      }
      @case ('video') {
        <div class="mt-2 max-w-sm overflow-hidden rounded-ui border border-white/8 bg-black">
          @if (url(); as src) {
            <video [src]="src" controls class="max-h-80 w-full"></video>
            @if (att().kind === 'audio' || att().kind === 'video') {
              <button
                class="btn btn-sm m-2 gap-1.5"
                type="button"
                [disabled]="adding()"
                (click)="addToSoundboard()"
              >
                <app-icon name="waveform" [size]="14" /> {{ 'Add to my soundboard' | t }}
              </button>
            }
          } @else {
            <div class="shimmer h-40 w-72"></div>
          }
        </div>
      }
      @default {
        <div
          class="mt-2 flex w-80 max-w-full items-center gap-3 rounded-ui border border-white/8 bg-black/30 p-3"
        >
          <span
            class="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-deep/30 text-violet"
            ><app-icon name="file" [size]="20"
          /></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold">{{ att().name }}</div>
            <div class="font-mono text-[0.6875rem] text-muted">
              {{ size() }} · SHA-256 {{ att().secret.sha256.slice(0, 8) }}…
            </div>
          </div>
          <button
            class="btn btn-icon btn-sm"
            type="button"
            (click)="download()"
            [disabled]="busy()"
            aria-label="Decrypt and download"
          >
            @if (busy()) {
              <span
                class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              ></span>
            } @else {
              <app-icon name="download" [size]="15" />
            }
          </button>
        </div>
        @if (error()) {
          <div class="mt-1 text-xs text-red-300">{{ error() }}</div>
        }
      }
    }
  `,
})
export class AttachmentComponent implements OnDestroy {
  readonly att = input.required<ViewAttachment>();
  private readonly store = inject(MessageStore);
  private readonly imports = inject(SoundImportService);
  private readonly audioEl = viewChild<ElementRef<HTMLAudioElement>>('audio');

  protected readonly url = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  /** How fast the audio plays (the person chooses it with the button of the speed). */
  protected readonly rate = signal(1);
  protected readonly lightbox = signal(false);
  protected readonly playing = signal(false);
  protected readonly progress = signal(0);
  private readonly duration = signal(0);

  protected readonly size = computed(
    function (this: AttachmentComponent) {
      return formatBytes(this.att().size);
    }.bind(this),
  );
  protected readonly bars = computed(
    function (this: AttachmentComponent) {
      const wave = this.att().wave;
      const n = 36;
      if (wave?.length)
        return Array.from({ length: n }, function (_, i) {
          return 12 + 88 * (wave[Math.floor((i / n) * wave.length)] ?? 0.2);
        });
      return Array.from({ length: n }, function (_, i) {
        return 20 + 60 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4));
      });
    }.bind(this),
  );
  protected readonly total = computed(
    function (this: AttachmentComponent) {
      return formatDuration(this.att().durationMs ?? this.duration() * 1000);
    }.bind(this),
  );
  protected readonly elapsed = computed(
    function (this: AttachmentComponent) {
      return formatDuration(this.progress() * (this.att().durationMs ?? this.duration() * 1000));
    }.bind(this),
  );

  constructor() {
    // Images and audio load eagerly; plain files wait for the user.
    effect(
      function (this: AttachmentComponent) {
        const att = this.att();
        if (att.kind === 'file') return;
        untracked(
          function (this: AttachmentComponent) {
            this.store.attachmentUrl(att).then(
              function (this: AttachmentComponent, url: string) {
                return this.url.set(url);
              }.bind(this),
              function (this: AttachmentComponent) {
                return this.error.set(
                  'Could not decrypt this attachment (integrity check failed).',
                );
              }.bind(this),
            );
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /** Plays or pauses a voice note. */
  protected toggleAudio(): void {
    const el = this.audioEl()?.nativeElement;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = this.rate();
      void el.play();
      this.playing.set(true);
    } else {
      el.pause();
      this.playing.set(false);
    }
  }

  /** The next speed: 1, 1.25, 1.5, 2, 3, 5 and back to 1. */
  protected cycleRate(): void {
    const next = SPEEDS[(SPEEDS.indexOf(this.rate()) + 1) % SPEEDS.length]!;
    this.rate.set(next);
    const el = this.audioEl()?.nativeElement;
    if (el) {
      el.playbackRate = next;
    }
  }

  /** The voice note advanced: the bar follows it. */
  protected onTime(): void {
    const el = this.audioEl()?.nativeElement;
    if (el?.duration && isFinite(el.duration)) this.progress.set(el.currentTime / el.duration);
  }

  /** The length of the voice note is known. */
  protected onMeta(): void {
    const el = this.audioEl()?.nativeElement;
    if (el && isFinite(el.duration)) this.duration.set(el.duration);
  }

  /** Puts the sound of this attachment in the soundboard: the editor opens to cut it, name it and give it an emoji. */
  protected async addToSoundboard(): Promise<void> {
    this.adding.set(true);
    try {
      await this.imports.addOne(this.att());
    } finally {
      this.adding.set(false);
    }
  }

  /** Downloads the file, decrypts it on this device and shows it. */
  protected async download(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const url = await this.store.attachmentUrl(this.att());
      const a = document.createElement('a');
      a.href = url;
      a.download = this.att().name.replace(/[\\/:*?"<>|]/g, '_');
      a.click();
    } catch {
      this.error.set('Integrity check failed — the file was altered or corrupted.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Pauses the voice note when the message goes away. */
  ngOnDestroy(): void {
    this.audioEl()?.nativeElement.pause();
  }
}
