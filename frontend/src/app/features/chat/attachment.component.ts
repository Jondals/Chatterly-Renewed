/**
 * src/app/features/chat/attachment.component.ts
 * Shows an encrypted attachment: it downloads it, decrypts it and checks its integrity before showing it.
 */
import { DecimalPipe } from '@angular/common';
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
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { PresetService } from '../../core/services/preset.service';
import { ToastService } from '../../core/services/toast.service';
import { saveFile } from '../../shared/util/save-file';
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
  imports: [IconComponent, TranslatePipe, DecimalPipe],
  styles: `
    .wave {
      cursor: var(--cur-pointer, pointer);
    }
    .wave-head {
      position: absolute;
      top: 50%;
      width: 0.7rem;
      height: 0.7rem;
      margin: -0.35rem 0 0 -0.35rem;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }
  `,
  template: `
    @if (att().preset; as mark) {
      <div class="mt-2 w-80 max-w-full rounded-ui border border-white/8 bg-black/30 p-2.5">
        <div class="flex items-center gap-3">
          @if (mark.thumb) {
            <img
              [src]="mark.thumb"
              alt=""
              class="h-12 w-[4.75rem] shrink-0 rounded-lg border border-white/12 object-cover"
            />
          } @else {
            <span
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
              ><app-icon [name]="mark.kind === 'theme' ? 'palette' : 'user'" [size]="20"
            /></span>
          }
          <div class="min-w-0 flex-1 leading-tight">
            <div class="truncate text-sm font-bold">{{ mark.name }}</div>
            <div class="mt-0.5 truncate text-xs text-muted">
              {{ (mark.kind === 'theme' ? 'Theme preset' : 'Profile preset') | t }} · {{ size() }}
            </div>
          </div>
        </div>
        <div class="mt-2.5 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            class="btn btn-sm btn-outline !px-1.5 !text-xs"
            [disabled]="adding()"
            (click)="tryPreset()"
          >
            {{ 'Try' | t }}
          </button>
          @if (ownsPreset()) {
            <span
              class="col-span-2 flex items-center justify-center gap-1.5 rounded-ui bg-white/5 px-2 text-xs font-semibold text-muted"
            >
              <app-icon name="check" [size]="13" class="text-accent" />
              {{ 'You already have it' | t }}
            </span>
          } @else {
            <button
              type="button"
              class="btn btn-sm btn-soft-accent !px-1.5 !text-xs"
              [disabled]="adding()"
              (click)="importPreset(false)"
            >
              {{ 'Import' | t }}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-accent-strong !px-1.5 !text-xs"
              [disabled]="adding()"
              (click)="importPreset(true)"
            >
              {{ 'Import and use' | t }}
            </button>
          }
        </div>
      </div>
    } @else {
      @switch (att().kind) {
        @case ('image') {
          @if (att().sticker) {
            @if (url(); as src) {
              <img
                [src]="src"
                alt=""
                draggable="false"
                (contextmenu)="$event.preventDefault()"
                class="anim-pop stk stk-live mt-1 h-36 w-36 object-contain drop-shadow-lg"
                [attr.data-move]="att().move"
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
            class="mt-2 grid w-80 max-w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 rounded-ui border border-white/8 bg-black/30 p-2.5 pt-4"
          >
            <button
              class="btn btn-icon btn-primary col-start-1 row-start-1 shrink-0 !rounded-ui"
              type="button"
              (click)="toggleAudio()"
              [disabled]="!url()"
              [attr.aria-label]="playing() ? 'Pause' : 'Play'"
            >
              <app-icon [name]="playing() ? 'pause' : 'play'" [size]="16" />
            </button>
            <div class="contents">
              <div
                class="wave relative col-start-2 row-start-1 flex h-9 touch-none select-none items-center gap-[2px]"
                role="slider"
                tabindex="0"
                [attr.aria-label]="'Position' | t"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="progress() * 100 | number: '1.0-0'"
                (pointerdown)="seekStart($event)"
                (pointermove)="seekMove($event)"
                (pointerup)="seekEnd($event)"
                (pointercancel)="seekEnd($event)"
                (click)="seekClick($event)"
                (keydown.arrowLeft)="seekBy(-5)"
                (keydown.arrowRight)="seekBy(5)"
              >
                @for (bar of bars(); track $index) {
                  <span
                    class="min-w-0 flex-1 rounded-full"
                    [style.height.%]="bar"
                    [style.background]="
                      $index / bars().length <= progress()
                        ? 'var(--accent)'
                        : 'rgba(255,255,255,.22)'
                    "
                  ></span>
                }
                <span class="wave-head" [style.left.%]="progress() * 100"></span>
              </div>
              <div
                class="col-start-2 row-start-2 flex items-center justify-between font-mono text-[0.625rem] text-muted"
              >
                <span>{{ elapsed() }}</span
                ><span>{{ total() }}</span>
              </div>
            </div>
            <button
              type="button"
              class="col-start-3 row-start-1 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-white/6 px-1.5 font-mono text-[0.6875rem] font-semibold text-muted hover:bg-white/12 hover:text-fg"
              [class.!text-accent]="rate() !== 1"
              [attr.title]="'Playback speed' | t"
              [attr.aria-label]="'Playback speed' | t"
              (click)="cycleRate()"
            >
              {{ rate() }}x
            </button>
            @if (att().kind === 'audio' || att().kind === 'video') {
              <button
                class="col-start-4 row-start-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/6 text-muted hover:bg-white/12 hover:text-fg"
                type="button"
                [disabled]="!url() || adding()"
                [attr.title]="'Add to my soundboard' | t"
                [attr.aria-label]="'Add to my soundboard' | t"
                (click)="addToSoundboard()"
              >
                <app-icon name="waveform" [size]="14" />
              </button>
            }
            @if (url(); as src) {
              <audio
                #audio
                [src]="src"
                preload="metadata"
                (timeupdate)="onTime()"
                (play)="onPlay()"
                (pause)="onPause()"
                (ended)="onEnded()"
                (seeked)="onTime()"
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
    }
  `,
})
export class AttachmentComponent implements OnDestroy {
  readonly att = input.required<ViewAttachment>();
  private readonly store = inject(MessageStore);
  private readonly imports = inject(SoundImportService);
  private readonly presets = inject(PresetService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly audioEl = viewChild<ElementRef<HTMLAudioElement>>('audio');

  protected readonly url = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  /** True when the preset of this message is one the person already has. */
  protected readonly ownsPreset = signal(false);
  /** How fast the audio plays (the person chooses it with the button of the speed). */
  protected readonly rate = signal(1);
  protected readonly lightbox = signal(false);
  protected readonly playing = signal(false);
  protected readonly progress = signal(0);
  private readonly duration = signal(0);
  private frame = 0;
  private scrubbing = false;
  private seekPointerId: number | null = null;

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
    effect(this.checkOwned.bind(this));
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

  /** Looks whether the preset of this message is already in the library of the person (and again when the library changes). */
  private checkOwned(): void {
    const att = this.att();
    // Read here so the check runs again when a preset is kept or deleted.
    this.presets.presets();
    if (!att.preset) {
      return;
    }
    untracked(
      function check(this: AttachmentComponent): void {
        void this.presets.alreadyHave(att).then(this.ownsPreset.set.bind(this.ownsPreset));
      }.bind(this),
    );
  }

  /** Lets the person try the preset of this message before keeping it. */
  protected async tryPreset(): Promise<void> {
    this.adding.set(true);
    try {
      await this.presets.tryFrom(this.att());
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not import the preset'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    } finally {
      this.adding.set(false);
    }
  }

  /** Takes the preset of this message (and puts it on, a theme, when asked). */
  protected async importPreset(use: boolean): Promise<void> {
    this.adding.set(true);
    try {
      const preset = await this.presets.importFrom(this.att(), use);
      this.toast.success(
        this.i18n.t(use ? 'Preset imported and applied' : 'Preset imported'),
        preset.name,
      );
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not import the preset'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    } finally {
      this.adding.set(false);
    }
  }

  /** Plays or pauses a voice note. */
  protected toggleAudio(): void {
    const el = this.audioEl()?.nativeElement;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = this.rate();
      void el.play();
    } else {
      el.pause();
    }
  }

  /** The sound started (from the button or from anywhere else): the bar follows it frame by frame. */
  protected onPlay(): void {
    this.playing.set(true);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.follow.bind(this));
  }

  /** The sound stopped. */
  protected onPause(): void {
    this.playing.set(false);
    cancelAnimationFrame(this.frame);
  }

  /** The sound reached its end: it goes back to the start, ready to play again. */
  protected onEnded(): void {
    this.playing.set(false);
    cancelAnimationFrame(this.frame);
    this.progress.set(0);
  }

  /** The length of the sound, in seconds (what the file says, or what the message said when the file does not know). */
  private length(el: HTMLAudioElement): number {
    if (isFinite(el.duration) && el.duration > 0) return el.duration;
    return (this.att().durationMs ?? 0) / 1000;
  }

  /** One frame while playing: the bar and the time are where the sound is now. */
  private follow(): void {
    const el = this.audioEl()?.nativeElement;
    if (!el || el.paused) return;
    const total = this.length(el);
    if (!this.scrubbing && total > 0) this.progress.set(Math.min(1, el.currentTime / total));
    this.frame = requestAnimationFrame(this.follow.bind(this));
  }

  /** The press on the wave jumps there and keeps following the pointer until it is released. */
  protected seekStart(event: PointerEvent): void {
    if (event.button !== 0 || this.scrubbing) return;
    event.preventDefault();
    event.stopPropagation();
    this.scrubbing = true;
    this.seekPointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.seekTo(event.clientX, event.currentTarget as HTMLElement);
  }

  /** The pointer moves along the wave while it is pressed. */
  protected seekMove(event: PointerEvent): void {
    if (this.scrubbing && event.pointerId === this.seekPointerId) {
      event.preventDefault();
      event.stopPropagation();
      this.seekTo(event.clientX, event.currentTarget as HTMLElement);
    }
  }

  /** The pointer is released. */
  protected seekEnd(event: PointerEvent): void {
    if (!this.scrubbing || event.pointerId !== this.seekPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.seekTo(event.clientX, event.currentTarget as HTMLElement);
    this.scrubbing = false;
    this.seekPointerId = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** A click also seeks directly; this keeps tap-to-seek working when the pointer does not produce a drag. */
  protected seekClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.seekTo(event.clientX, event.currentTarget as HTMLElement);
  }

  /** Puts the sound where the pointer is on the wave. */
  private seekTo(clientX: number, wave: HTMLElement): void {
    const el = this.audioEl()?.nativeElement;
    const box = wave.getBoundingClientRect();
    if (!el || box.width === 0) return;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    this.progress.set(share);
    const total = this.length(el);
    if (total > 0) {
      const target = Math.min(total, share * total);
      try {
        el.currentTime = target;
      } catch {
        // Some media formats reject precise seeks; try the browser's keyframe seek instead.
        el.fastSeek?.(target);
      }
    }
  }

  /** The arrow keys move the sound some seconds back or forward. */
  protected seekBy(seconds: number): void {
    const el = this.audioEl()?.nativeElement;
    if (!el) return;
    const total = this.length(el);
    const target = Math.max(0, el.currentTime + seconds);
    el.currentTime = total > 0 ? Math.min(total, target) : target;
    this.onTime();
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

  /** The voice note advanced or was moved: the bar follows it. */
  protected onTime(): void {
    const el = this.audioEl()?.nativeElement;
    if (!el || this.scrubbing) return;
    const total = this.length(el);
    if (total > 0) this.progress.set(Math.min(1, el.currentTime / total));
  }

  /**
   * The length of the voice note is known. A recording made in the browser says its length is infinite until it has been
   * played to the end, and then it cannot be moved: jumping to the end once makes the browser measure it, and it goes back.
   */
  protected onMeta(): void {
    const el = this.audioEl()?.nativeElement;
    if (!el) return;
    if (isFinite(el.duration)) {
      this.duration.set(el.duration);
      return;
    }
    const measured = function (this: AttachmentComponent): void {
      el.removeEventListener('timeupdate', measured);
      if (isFinite(el.duration)) this.duration.set(el.duration);
      el.currentTime = 0;
    }.bind(this);
    el.addEventListener('timeupdate', measured);
    el.currentTime = 1e101;
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
      if ((await saveFile(url, this.att().name, this.att().mime)) === 'downloads') {
        this.toast.success(this.i18n.t('Saved in Downloads'), this.att().name);
      }
    } catch {
      this.error.set('Integrity check failed — the file was altered or corrupted.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Pauses the voice note when the message goes away. */
  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.audioEl()?.nativeElement.pause();
  }
}
