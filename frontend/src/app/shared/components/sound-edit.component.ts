/**
 * src/app/shared/components/sound-edit.component.ts
 * The window to prepare a sound of the soundboard: see its wave, cut the part to keep (drag on the wave or use the
 * sliders), listen to it, give it a name and an emoji, and save it. It is loaded only when a sound is added or edited,
 * and opened by `editSound`. The cut sound is kept as a WAV (sound that was cut) or as the file it was (not cut).
 */
import {
  AfterViewInit,
  ApplicationRef,
  Component,
  ElementRef,
  EnvironmentInjector,
  OnDestroy,
  createComponent,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SoundService } from '../../core/services/sound.service';
import type { CustomSound } from '../../core/services/soundboard.store';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

/** The longest part that can be kept (seconds): it is sent to the others in the call in small pieces. */
export const MAX_CLIP_SECONDS = 30;
/** Biggest file that can be opened (it is only read here and cut; what is kept is smaller). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Emojis offered at a glance (anything can be typed or pasted). */
const QUICK_EMOJIS = ['🔊', '🎵', '😂', '🔥', '💥', '👏', '🥁', '🎺', '😱', '🤣'];
/** The shortest part that can be kept (seconds). */
const MIN_SECONDS = 0.1;

/** What the window gives back when a sound is saved. */
export type EditedSound = Pick<
  CustomSound,
  'name' | 'emoji' | 'blob' | 'original' | 'start' | 'end' | 'duration'
>;

/** The first character the person sees of a text (an emoji can be made of several code points), or nothing. */
function firstGlyph(value: string): string {
  const text = value.trim();
  if (typeof Intl.Segmenter === 'function') {
    const first = new Intl.Segmenter().segment(text)[Symbol.iterator]().next();
    return first.done ? '' : first.value.segment;
  }
  return Array.from(text)[0] ?? '';
}

/** Writes a part of an audio buffer as a WAV file (16 bits, up to two channels). */
function toWav(buffer: AudioBuffer, from: number, to: number): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const first = Math.floor(from * buffer.sampleRate);
  const frames = Math.max(1, Math.min(buffer.length, Math.ceil(to * buffer.sampleRate)) - first);
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = function writeText(offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  for (let channel = 0; channel < channels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++) {
      const value = Math.max(-1, Math.min(1, samples[first + i] ?? 0));
      view.setInt16(
        44 + (i * channels + channel) * 2,
        value < 0 ? value * 0x8000 : value * 0x7fff,
        true,
      );
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/** The window to add or edit a sound. */
@Component({
  selector: 'app-sound-edit',
  standalone: true,
  imports: [ModalComponent, TranslatePipe, IconComponent],
  template: `
    <app-modal [title]="'Edit the sound' | t" [width]="520" (closed)="cancel()">
      <canvas
        #wave
        class="sound-wave"
        (pointerdown)="startMove($event)"
        (pointermove)="move($event)"
        (pointerup)="endMove($event)"
        (pointercancel)="endMove($event)"
      ></canvas>
      <div class="mt-1 flex justify-between text-[0.6875rem] tabular-nums text-dim">
        <span>{{ start().toFixed(2) }} s</span>
        <span class="text-accent">{{
          'Kept: {n} s' | t: { n: (end() - start()).toFixed(2) }
        }}</span>
        <span>{{ end().toFixed(2) }} s</span>
      </div>
      @if (tooLong()) {
        <p class="mt-1 text-[0.6875rem] text-amber-300">
          {{
            'Only up to {n} seconds can be kept: choose the part you want.' | t: { n: maxSeconds }
          }}
        </p>
      }
      <div class="mt-3 grid grid-cols-2 gap-3 text-xs text-muted">
        <label class="flex flex-col gap-1">
          {{ 'Start' | t }}
          <input
            type="range"
            min="0"
            [max]="duration()"
            step="0.01"
            [value]="start()"
            [attr.aria-label]="'Start' | t"
            (input)="onStart($event)"
          />
        </label>
        <label class="flex flex-col gap-1">
          {{ 'End' | t }}
          <input
            type="range"
            min="0"
            [max]="duration()"
            step="0.01"
            [value]="end()"
            [attr.aria-label]="'End' | t"
            (input)="onEnd($event)"
          />
        </label>
      </div>
      <div class="mt-4 flex items-center gap-2">
        <button
          type="button"
          class="btn btn-icon"
          [attr.aria-label]="(playing() ? 'Stop' : 'Play') | t"
          (click)="toggle()"
        >
          <app-icon [name]="playing() ? 'stop' : 'play'" [size]="16" />
        </button>
        <input
          class="input w-16 text-center text-xl"
          type="text"
          maxlength="8"
          [value]="emoji()"
          [attr.aria-label]="'Emoji' | t"
          (input)="onEmoji($event)"
        />
        <input
          class="input min-w-0 flex-1"
          type="text"
          maxlength="24"
          [value]="name()"
          [attr.aria-label]="'Name' | t"
          (input)="onName($event)"
        />
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        @for (option of emojis; track option) {
          <button
            type="button"
            class="btn btn-sm btn-ghost !px-2 text-lg"
            (click)="emoji.set(option)"
          >
            <span class="emoji-glyph">{{ option }}</span>
          </button>
        }
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" (click)="cancel()">{{ 'Cancel' | t }}</button>
        <button type="button" class="btn btn-primary" [disabled]="!canSave()" (click)="save()">
          {{ 'Save' | t }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .sound-wave {
      display: block;
      width: 100%;
      height: 84px;
      border-radius: var(--r, 10px);
      background: #0b0d12;
      cursor: ew-resize;
      touch-action: none;
    }
  `,
})
class SoundEditComponent implements AfterViewInit, OnDestroy {
  /** The sound to edit (the original file when it was cut before). */
  readonly source = input.required<Blob>();
  /** What the sound had before (when it is edited, not new). */
  readonly existing = input<CustomSound | null>(null);
  /** A name to start with (the name of the file). */
  readonly suggestedName = input('');
  /** The result: the sound ready to keep, or null when the person cancels. */
  readonly done = output<EditedSound | null>();
  private readonly sound = inject(SoundService);
  private readonly wave = viewChild.required<ElementRef<HTMLCanvasElement>>('wave');
  protected readonly maxSeconds = MAX_CLIP_SECONDS;
  protected readonly emojis = QUICK_EMOJIS;
  protected readonly duration = signal(0);
  protected readonly start = signal(0);
  protected readonly end = signal(0);
  protected readonly name = signal('');
  protected readonly emoji = signal('');
  protected readonly playing = signal(false);
  /** Whether the whole sound is longer than what can be kept. */
  protected readonly tooLong = computed(this.isTooLong.bind(this));
  /** Whether the sound can be saved. */
  protected readonly canSave = computed(this.isSavable.bind(this));
  private buffer: AudioBuffer | null = null;
  private peaks: number[] = [];
  private grabbed: 'start' | 'end' | null = null;
  private playback: AudioBufferSourceNode | null = null;

  /** Whether the whole sound is longer than the limit. */
  private isTooLong(): boolean {
    return this.duration() > MAX_CLIP_SECONDS;
  }

  /** Whether there is a part worth keeping and a name. */
  private isSavable(): boolean {
    return (
      this.duration() > 0 &&
      this.end() - this.start() >= MIN_SECONDS &&
      this.name().trim().length > 0
    );
  }

  /** Decodes the sound and draws its wave. */
  async ngAfterViewInit(): Promise<void> {
    const before = this.existing();
    this.name.set(before?.name ?? this.suggestedName());
    this.emoji.set(before?.emoji ?? '');
    try {
      this.buffer = await this.sound.context.decodeAudioData(await this.source().arrayBuffer());
    } catch {
      this.done.emit(null);
      return;
    }
    this.duration.set(this.buffer.duration);
    const begin = before?.start ?? 0;
    this.start.set(Math.min(begin, this.buffer.duration));
    this.end.set(
      Math.min(
        before?.end ?? this.buffer.duration,
        this.start() + MAX_CLIP_SECONDS,
        this.buffer.duration,
      ),
    );
    this.measurePeaks();
    this.draw();
  }

  /** Reduces the sound to a few hundred bars (the highest point of each stretch). */
  private measurePeaks(): void {
    const buffer = this.buffer;
    if (!buffer) {
      return;
    }
    const bars = 360;
    const samples = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(samples.length / bars));
    this.peaks = [];
    for (let bar = 0; bar < bars; bar++) {
      let top = 0;
      for (let i = bar * size; i < Math.min(samples.length, (bar + 1) * size); i += 4) {
        top = Math.max(top, Math.abs(samples[i] ?? 0));
      }
      this.peaks.push(top);
    }
  }

  /** Draws the wave: the kept part in color, the rest dim, and the two ends. */
  private draw(): void {
    const canvas = this.wave().nativeElement;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context || !this.duration()) {
      return;
    }
    context.scale(ratio, ratio);
    const from = (this.start() / this.duration()) * width;
    const to = (this.end() / this.duration()) * width;
    const step = width / this.peaks.length;
    for (let i = 0; i < this.peaks.length; i++) {
      const x = i * step;
      const bar = Math.max(2, this.peaks[i]! * (height - 8));
      context.fillStyle = x >= from - 1 && x <= to ? '#2ef2b0' : '#475569';
      context.fillRect(x, (height - bar) / 2, Math.max(1, step - 1), bar);
    }
    context.fillStyle = '#ffffff';
    context.fillRect(from - 1, 0, 2, height);
    context.fillRect(to - 1, 0, 2, height);
  }

  /** Moves the start (keeping the part short enough) and redraws. */
  protected onStart(event: Event): void {
    this.setStart(Number((event.target as HTMLInputElement).value));
  }

  /** Moves the end (keeping the part short enough) and redraws. */
  protected onEnd(event: Event): void {
    this.setEnd(Number((event.target as HTMLInputElement).value));
  }

  /** Puts the start at a time: it stays before the end and the part stays short enough. */
  private setStart(time: number): void {
    const start = Math.max(0, Math.min(time, this.end() - MIN_SECONDS));
    this.start.set(start);
    if (this.end() - start > MAX_CLIP_SECONDS) {
      this.end.set(start + MAX_CLIP_SECONDS);
    }
    this.draw();
  }

  /** Puts the end at a time: it stays after the start and the part stays short enough. */
  private setEnd(time: number): void {
    const end = Math.min(this.duration(), Math.max(time, this.start() + MIN_SECONDS));
    this.end.set(end);
    if (end - this.start() > MAX_CLIP_SECONDS) {
      this.start.set(end - MAX_CLIP_SECONDS);
    }
    this.draw();
  }

  /** The time under a press on the wave. */
  private timeAt(event: PointerEvent): number {
    const box = this.wave().nativeElement.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * this.duration();
  }

  /** A press on the wave grabs the nearest end and moves it there. */
  protected startMove(event: PointerEvent): void {
    const time = this.timeAt(event);
    this.grabbed = Math.abs(time - this.start()) <= Math.abs(time - this.end()) ? 'start' : 'end';
    this.wave().nativeElement.setPointerCapture(event.pointerId);
    this.move(event);
  }

  /** The grabbed end follows the pointer. */
  protected move(event: PointerEvent): void {
    if (!this.grabbed) {
      return;
    }
    if (this.grabbed === 'start') {
      this.setStart(this.timeAt(event));
    } else {
      this.setEnd(this.timeAt(event));
    }
  }

  /** The release lets go of the end. */
  protected endMove(event: PointerEvent): void {
    this.grabbed = null;
    this.wave().nativeElement.releasePointerCapture(event.pointerId);
  }

  /** The emoji box: only the first symbol is kept. */
  protected onEmoji(event: Event): void {
    this.emoji.set(firstGlyph((event.target as HTMLInputElement).value));
  }

  /** The name box. */
  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  /** Plays the part that would be kept, or stops it. */
  protected toggle(): void {
    if (this.playing()) {
      this.stopPlayback();
      return;
    }
    const buffer = this.buffer;
    if (!buffer) {
      return;
    }
    const context = this.sound.context;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = this.stopPlayback.bind(this);
    source.start(0, this.start(), this.end() - this.start());
    this.playback = source;
    this.playing.set(true);
  }

  /** Stops the preview. */
  private stopPlayback(): void {
    this.playback?.stop();
    this.playback = null;
    this.playing.set(false);
  }

  /** Cuts the sound and hands it over. */
  protected save(): void {
    const buffer = this.buffer;
    if (!buffer) {
      return;
    }
    const whole = this.start() <= 0.005 && this.end() >= buffer.duration - 0.005;
    const original = this.existing()?.original ?? this.source();
    const source = this.source();
    // A sound that was not cut stays as the file it was (when it is small); a cut one becomes a WAV.
    const keepFile = whole && source.size <= 2 * 1024 * 1024;
    this.stopPlayback();
    this.done.emit({
      name: this.name().trim().slice(0, 24),
      emoji: this.emoji(),
      blob: keepFile ? source : toWav(buffer, this.start(), this.end()),
      original: keepFile ? undefined : original,
      start: this.start(),
      end: this.end(),
      duration: this.end() - this.start(),
    });
  }

  /** Closes without saving. */
  protected cancel(): void {
    this.stopPlayback();
    this.done.emit(null);
  }

  /** Stops the preview when the window goes away. */
  ngOnDestroy(): void {
    this.playback?.stop();
  }
}

/**
 * Opens the window to prepare a sound and waits for the answer.
 * @param injector Where the window gets its services from.
 * @param source The audio file (the original one when a cut sound is edited again).
 * @param existing The sound that is being edited, if any.
 * @param suggestedName A name to start with.
 * @returns The sound ready to keep, or null when the person cancels.
 */
export function editSound(
  injector: EnvironmentInjector,
  source: Blob,
  existing: CustomSound | null,
  suggestedName: string,
): Promise<EditedSound | null> {
  return new Promise<EditedSound | null>(function open(resolve) {
    const ref = createComponent(SoundEditComponent, { environmentInjector: injector });
    ref.setInput('source', source);
    ref.setInput('existing', existing);
    ref.setInput('suggestedName', suggestedName);
    const app = injector.get(ApplicationRef);
    app.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    const subscription = ref.instance.done.subscribe(function finish(result: EditedSound | null) {
      subscription.unsubscribe();
      app.detachView(ref.hostView);
      ref.destroy();
      resolve(result);
    });
  });
}
