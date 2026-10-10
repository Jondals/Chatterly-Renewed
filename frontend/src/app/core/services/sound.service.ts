/**
 * src/app/core/services/sound.service.ts
 * Plays the sounds of the app: the interface (clicks, messages, notices), the calls (joining, leaving, mute, deafen), the
 * ringtones and the effects of the soundboard. Every one of them is a file of `public/sounds` (see sound-library.ts); this
 * service decides which file, how fast and how loud, and keeps the audio context, the master volume and a limiter.
 */
import { Injectable, effect, inject, untracked } from '@angular/core';
import {
  loadCustomClick,
  loadCustomRingtone,
  resolveRingtone,
  type RingtoneId,
} from '../ringtones';
import {
  ESSENTIAL_SOUNDS,
  loadSounds,
  preloadSounds,
  decodeClip,
  soundReady,
  playSound,
  soundGap,
  soundLength,
  type SoundId,
} from '../sound-library';
import { SettingsService } from './settings.service';

/** The sounds of the interface and of the calls. */
export type UiSound =
  | 'message'
  | 'send'
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'click'
  | 'toggle'
  | 'connect'
  | 'success'
  | 'error'
  | 'open'
  | 'exit';

/** The effects of the soundboard that are built in. (Their names travel in the signals of a call, so they never change.) */
export type SfxId = 'horn' | 'boing' | 'trombone' | 'tada' | 'rimshot' | 'applause';

/** The built-in soundboard effects: the name that travels in a call, what is shown, and the file. */
export const SOUNDBOARD: { id: SfxId; label: string; icon: string; sound: SoundId }[] = [
  { id: 'horn', label: 'Air horn', icon: '📯', sound: 'airHorn' },
  { id: 'boing', label: 'Boing', icon: '🏀', sound: 'boing' },
  { id: 'trombone', label: 'Sad trombone', icon: '🎺', sound: 'sadTrombone' },
  { id: 'tada', label: 'Ta-da!', icon: '🎉', sound: 'taDa' },
  { id: 'rimshot', label: 'Rimshot', icon: '😏', sound: 'rimshot' },
  { id: 'applause', label: 'Applause', icon: '👏', sound: 'applause' },
];

/** Which file each sound of the interface and of the calls plays. */
const UI_FILES: Record<Exclude<UiSound, 'click'>, SoundId> = {
  message: 'messageReceived',
  send: 'messageSent',
  join: 'userJoined',
  leave: 'userLeft',
  connect: 'youJoin',
  exit: 'youLeave',
  mute: 'micMute',
  unmute: 'micUnmute',
  deafen: 'headphonesDeafen',
  undeafen: 'headphonesUndeafen',
  toggle: 'toggleSwitch',
  open: 'menuOpen',
  success: 'noticeSuccess',
  error: 'noticeError',
};

/** Which file each style of click plays (the style "custom" is the file the person uploaded; "off" is silence). */
const CLICK_FILES: Record<string, SoundId> = {
  soft: 'clickSoft',
  drop: 'clickDrop',
  glass: 'clickGlass',
  typewriter: 'clickTypewriter',
  marimba: 'clickMarimba',
  kalimba: 'clickKalimba',
  tap: 'clickTap',
  switch: 'clickSwitch',
  pluck: 'clickPluck',
  bubble: 'clickBubble',
};

/** Which file each built-in ringtone plays. */
const RINGTONE_FILES: Record<string, SoundId> = {
  classic: 'ringtoneClassic',
  christmas: 'ringtoneChristmas',
  halloween: 'ringtoneHalloween',
  newyear: 'ringtoneNewyear',
};

/** General level of the sounds: the files are quiet, so the master volume raises them (and a limiter keeps overlaps clean). */
const MASTER_BOOST = 6;

/** A sound that repeats (a ringtone) and what is needed to stop it. */
interface Repeating {
  stopped: boolean;
  source: AudioBufferSourceNode | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** All the sounds of the app. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly settings = inject(SettingsService);
  private audioContext: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly clips = new Map<string, AudioBuffer>();
  /** Level multiplier for the sound being played (a press of a quiet or an important button). */
  private levelScale = 1;
  private lastSlide = 0;
  /** The click sound the person uploaded, decoded (null until it is loaded). */
  private clickClip: AudioBuffer | null = null;
  private clickLoading = false;
  private readonly clickWatcher = effect(this.watchClickClip.bind(this));

  /** Keeps the master volume equal to the volume setting. */
  constructor() {
    effect(this.applyVolume.bind(this));
  }

  /** Master gain for the volume setting (0 to 100): a perceptual curve, then boosted. */
  private masterGain(): number {
    return Math.pow(this.settings.soundVolume() / 100, 1.5) * MASTER_BOOST;
  }

  /** Applies the volume setting to the master gain, once the audio context exists. */
  private applyVolume(): void {
    const gain = this.masterGain();
    if (this.master) {
      this.master.gain.value = gain;
    }
  }

  /** Starts loading the sounds of the interface when the browser is idle (no press of the person is needed for it). */
  preload(): void {
    if (!this.supported) {
      return;
    }
    if (this.settings.sounds()) {
      void preloadSounds(ESSENTIAL_SOUNDS);
    }
    // The six effects of the soundboard always: they are small, and the first press of one must sound.
    void preloadSounds(
      SOUNDBOARD.map(function file(effect) {
        return effect.sound;
      }),
    );
  }

  /** Shared audio context (also used by calls for spatial audio and level meters). */
  get context(): AudioContext {
    if (!this.audioContext) {
      const Context: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) {
        throw new Error('This browser has no Web Audio');
      }
      this.audioContext = new Context({ latencyHint: 'interactive' });
      this.master = this.audioContext.createGain();
      this.master.gain.value = this.masterGain();
      // A limiter after the boost keeps loud overlaps from distorting.
      const limiter = this.audioContext.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 10;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(this.audioContext.destination);
      // The files of the interface (about 200 KB, once) start loading now that the person has interacted.
      void loadSounds(this.audioContext, ESSENTIAL_SOUNDS);
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
    return this.audioContext;
  }

  /** The node every sound is connected to (the master volume). */
  get output(): AudioNode {
    void this.context;
    return this.master!;
  }

  /** True when the browser has Web Audio at all (decoding the files needs no press of the person). */
  private get supported(): boolean {
    return (
      typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window)
    );
  }

  /**
   * True when a sound can be played now: the browser has Web Audio and the person has already pressed something on the page
   * (before that, an audio context may not start and the browser writes a warning for each try).
   */
  private get audible(): boolean {
    return (
      this.supported && (!!this.audioContext || (navigator.userActivation?.hasBeenActive ?? true))
    );
  }

  /** Plays one of the sounds of the interface or of the calls (nothing when sounds are off). */
  play(sound: UiSound, weight?: { pitch: number; level: number }): void {
    if (!this.settings.sounds() || !this.audible) {
      return;
    }
    if (sound === 'click') {
      this.levelScale = weight ? weight.level : 1;
      this.clickSound(weight ? weight.pitch : 1);
      this.levelScale = 1;
      return;
    }
    playSound(this.context, this.output, UI_FILES[sound], { gain: this.levelScale });
  }

  /**
   * A soft tick for a step of a slider (`position` is 0 to 1): it is the sound of the chosen click style, higher as the
   * slider goes up, so every style has its own slider.
   */
  slide(position: number): void {
    if (!this.audible) {
      return;
    }
    const now = performance.now();
    if (
      !this.settings.sounds() ||
      this.settings.clickStyle() === 'off' ||
      now - this.lastSlide < 55
    ) {
      return;
    }
    this.lastSlide = now;
    const rate = 0.8 + Math.max(0, Math.min(1, position)) * 0.8;
    this.clickSound(rate, 0.7);
  }

  /** Plays a soundboard effect; it is always audible when asked for explicitly (by you or by someone in the call). */
  sfx(id: SfxId): void {
    const effect = SOUNDBOARD.find(function byId(entry) {
      return entry.id === id;
    });
    if (!this.audible || !effect) {
      return;
    }
    const options = { gain: this.settings.callEffectsVolume() / 100 };
    // ? An effect that is not loaded yet is loaded and then played (before, that press was silent and the next one sounded).
    if (!soundReady(effect.sound)) {
      const context = this.context;
      const output = this.output;
      void loadSounds(context, [effect.sound]).then(function later() {
        playSound(context, output, effect.sound, options);
      });
      return;
    }
    playSound(this.context, this.output, effect.sound, options);
  }

  /** Decodes a clip of the soundboard in advance, so that its first press already sounds. */
  async warmClip(key: string, blob: Blob): Promise<void> {
    if (!this.supported || this.clips.has(key)) {
      return;
    }
    try {
      this.clips.set(key, await decodeClip(await blob.arrayBuffer()));
    } catch {
      /* it will be decoded (or refused) when it is played */
    }
  }

  /** Whether a name is one of the built-in effects (the signals of a call carry any text; only these play). */
  isSfx(id: unknown): id is SfxId {
    return SOUNDBOARD.some(function same(entry) {
      return entry.id === id;
    });
  }

  /** Plays an uploaded clip of the soundboard (always audible, like the built-in effects). */
  async playBlob(key: string, blob: Blob): Promise<void> {
    if (!this.audible) {
      return;
    }
    let buffer = this.clips.get(key);
    if (!buffer) {
      buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
      this.clips.set(key, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const level = this.context.createGain();
    level.gain.value = this.settings.callEffectsVolume() / 100;
    source.connect(level).connect(this.output);
    source.start();
  }

  /** Forgets a decoded clip (when it is deleted). */
  forgetClip(key: string): void {
    this.clips.delete(key);
  }

  /** Starts the ringtone chosen in the settings for an incoming call; returns the function that stops it. */
  ring(): () => void {
    if (!this.settings.sounds() || !this.audible) {
      return this.noop;
    }
    return this.startRingtone(this.settings.ringtone());
  }

  /** Plays a ringtone so the person can hear it in the settings; returns the function that stops it. */
  preview(id: RingtoneId): () => void {
    if (!this.audible) {
      return this.noop;
    }
    return this.startRingtone(id);
  }

  /** A function that does nothing. */
  private noop(): void {
    return;
  }

  /** Starts a ringtone on repeat: a built-in one plays again after its pause, the custom file is looped. */
  private startRingtone(id: RingtoneId): () => void {
    const real = resolveRingtone(id);
    const repeating: Repeating = { stopped: false, source: null, timer: undefined };
    if (real === 'custom') {
      void this.startCustom(repeating);
    } else {
      void this.repeatFile(RINGTONE_FILES[real] ?? 'ringtoneClassic', repeating);
    }
    return this.stopRepeating.bind(this, repeating);
  }

  /** Plays the file of a ringtone and schedules the next time after its pause, until it is stopped. */
  private async repeatFile(sound: SoundId, repeating: Repeating): Promise<void> {
    await loadSounds(this.context, [sound]);
    if (repeating.stopped) {
      return;
    }
    repeating.source = playSound(this.context, this.output, sound);
    const seconds = soundLength(sound) + soundGap(sound);
    repeating.timer = setTimeout(
      this.repeatFile.bind(this, sound, repeating),
      Math.max(1, seconds) * 1000,
    );
  }

  /** Stops a repeating sound. */
  private stopRepeating(repeating: Repeating): void {
    repeating.stopped = true;
    clearTimeout(repeating.timer);
    try {
      repeating.source?.stop();
    } catch {
      // It had already ended.
    }
  }

  /** Decodes the file the person uploaded as ringtone and loops it (unless it was stopped meanwhile). */
  private async startCustom(repeating: Repeating): Promise<void> {
    const blob = await loadCustomRingtone();
    if (!blob || repeating.stopped) {
      return;
    }
    try {
      const buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
      if (repeating.stopped) {
        return;
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.output);
      source.start();
      repeating.source = source;
    } catch {
      void this.repeatFile('ringtoneClassic', repeating);
    }
  }

  /** The sound under every button press (the file of the chosen style); the pitch varies a little so it never feels repetitive. */
  private clickSound(pitch = 1, level = 1): void {
    const style = this.settings.clickStyle();
    if (style === 'off') {
      return;
    }
    const rate = (1 + (Math.random() - 0.5) * 0.08) * pitch;
    if (style === 'custom') {
      this.playClickClip(rate);
      return;
    }
    const sound = CLICK_FILES[style] ?? 'clickSoft';
    playSound(this.context, this.output, sound, { rate, gain: this.levelScale * level });
  }

  /** Loads the uploaded click sound as soon as it is the one chosen. */
  private watchClickClip(): void {
    if (this.settings.clickStyle() === 'custom') {
      untracked(this.loadClickClip.bind(this));
    }
  }

  /** Reads and decodes the uploaded click sound (once). */
  private async loadClickClip(): Promise<void> {
    if (this.clickClip || this.clickLoading) {
      return;
    }
    this.clickLoading = true;
    try {
      const blob = await loadCustomClick();
      if (blob) {
        this.clickClip = await this.context.decodeAudioData(await blob.arrayBuffer());
      }
    } catch {
      this.clickClip = null;
    }
    this.clickLoading = false;
  }

  /** Forgets the decoded click sound (a new one was uploaded or it was deleted). */
  forgetClickClip(): void {
    this.clickClip = null;
    this.clickLoading = false;
    if (this.settings.clickStyle() === 'custom') {
      void this.loadClickClip();
    }
  }

  /** Plays the uploaded click sound, a little different every time. */
  private playClickClip(rate: number): void {
    if (!this.clickClip) {
      void this.loadClickClip();
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.clickClip;
    source.playbackRate.value = rate;
    const level = this.context.createGain();
    level.gain.value = this.levelScale;
    source.connect(level).connect(this.output);
    source.start();
  }
}
