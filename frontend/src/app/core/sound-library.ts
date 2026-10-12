/**
 * src/app/core/sound-library.ts
 * The library of sounds of the app: the list of every sound file (one place, with a descriptive name for what each is for),
 * the loading and decoding of the files, and the playing of one with a chosen speed and level.
 *
 * * Every sound is a FILE in `public/sounds/<folder>/` (see the README of that folder). To use another sound, replace the
 * file (or change its name/extension in `SOUNDS`): nothing is made by the code any more. Files are loaded only after the
 * first interaction of the person, once each, and the browser keeps them.
 *
 * ! Quiet on purpose: the sounds of the interface are about -38 dB before the volume of the settings (which boosts them),
 * ! so `trim` is 1 for them. A file that is louder than the others must get a smaller `trim` here, never a bigger volume.
 */

/** One sound file. */
interface SoundDef {
  /** Path inside `public/sounds`. */
  file: string;
  /** Gain that levels the file with the others (1 = as it is). */
  trim?: number;
  /** For ringtones: seconds of silence before the sound repeats. */
  gap?: number;
}

/** Every sound by the name it is used with. */
export const SOUNDS = {
  // ---- interface (ui/)
  messageReceived: { file: 'ui/message-received.ogg' },
  messageSent: { file: 'ui/message-sent.ogg' },
  menuOpen: { file: 'ui/menu-open.ogg' },
  toggleSwitch: { file: 'ui/toggle-switch.ogg' },
  noticeSuccess: { file: 'ui/notice-success.ogg' },
  noticeError: { file: 'ui/notice-error.ogg' },
  // ---- the sound of pressing a button, one per style (ui/)
  clickSoft: { file: 'ui/click-soft.ogg' },
  clickDrop: { file: 'ui/click-drop.ogg' },
  clickGlass: { file: 'ui/click-glass.ogg' },
  clickTypewriter: { file: 'ui/click-typewriter.ogg' },
  clickMarimba: { file: 'ui/click-marimba.ogg' },
  clickKalimba: { file: 'ui/click-kalimba.ogg' },
  clickTap: { file: 'ui/click-tap.ogg', trim: 0.09 },
  clickSwitch: { file: 'ui/click-switch.ogg', trim: 0.09 },
  clickPluck: { file: 'ui/click-pluck.ogg', trim: 0.1 },
  clickBubble: { file: 'ui/click-bubble.ogg', trim: 0.1 },
  // ---- calls (call/)
  youJoin: { file: 'call/you-join.ogg' },
  youLeave: { file: 'call/you-leave.ogg' },
  userJoined: { file: 'call/user-joined.ogg' },
  userLeft: { file: 'call/user-left.ogg' },
  micMute: { file: 'call/mic-mute.ogg' },
  micUnmute: { file: 'call/mic-unmute.ogg' },
  headphonesDeafen: { file: 'call/headphones-deafen.ogg' },
  headphonesUndeafen: { file: 'call/headphones-undeafen.ogg' },
  // ---- default ringtones (ringtones/)
  ringtoneClassic: { file: 'ringtones/classic.wav', gap: 0.6 },
  ringtoneOld: { file: 'ringtones/old.ogg', gap: 0.8, trim: 0.1 },
  ringtoneChime: { file: 'ringtones/chime.wav', gap: 0.8 },
  ringtoneChristmas: { file: 'ringtones/christmas.wav', gap: 0.8 },
  ringtoneHalloween: { file: 'ringtones/halloween.ogg', gap: 0.9 },
  ringtoneNewyear: { file: 'ringtones/newyear.wav', gap: 0.8 },
  ringtoneArcade: { file: 'ringtones/arcade.wav', gap: 0.8 },
  // the secret one: it cannot be chosen anywhere (see SoundService.ring)
  ringtoneSecret: { file: 'ringtones/secret.ogg', gap: 1 },
  // ---- soundtracks of the animations of arriving (auth/)
  authIntro: { file: 'auth/intro.ogg' },
  authSignIn: { file: 'auth/sign-in-unlock.ogg' },
  authSignOut: { file: 'auth/sign-out-lock.ogg' },
  authSignUp: { file: 'auth/sign-up-fireworks.ogg' },
  // ---- default effects of the soundboard (soundboard/)
  airHorn: { file: 'soundboard/air-horn.ogg' },
  boing: { file: 'soundboard/boing.ogg' },
  sadTrombone: { file: 'soundboard/sad-trombone.ogg' },
  taDa: { file: 'soundboard/ta-da.ogg' },
  rimshot: { file: 'soundboard/rimshot.ogg' },
  applause: { file: 'soundboard/applause.ogg' },
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

/** The sounds that are loaded as soon as the audio exists: they are the ones people hear all the time. */
export const ESSENTIAL_SOUNDS: readonly SoundId[] = [
  'messageReceived',
  'messageSent',
  'menuOpen',
  'toggleSwitch',
  'noticeSuccess',
  'noticeError',
  'clickSoft',
  'clickDrop',
  'clickGlass',
  'clickTypewriter',
  'clickMarimba',
  'clickKalimba',
  'clickTap',
  'clickSwitch',
  'clickPluck',
  'clickBubble',
  'youJoin',
  'youLeave',
  'userJoined',
  'userLeft',
  'micMute',
  'micUnmute',
  'headphonesDeafen',
  'headphonesUndeafen',
  'authSignIn',
  'authSignOut',
  'authSignUp',
  'authIntro',
];

/** The decoded sounds by file. */
const buffers = new Map<string, AudioBuffer>();
/** Loads that have started, by file (also the failed ones: a file that cannot be loaded is not asked for again). */
const requested = new Map<string, Promise<void>>();

/** Downloads and decodes one file. A failure is ignored: that sound is simply silent. */
async function fetchAndDecode(context: BaseAudioContext, file: string): Promise<void> {
  try {
    const response = await fetch(new URL('sounds/' + file, document.baseURI), {
      credentials: 'omit',
    });
    if (!response.ok) {
      return;
    }
    buffers.set(file, await context.decodeAudioData(await response.arrayBuffer()));
  } catch {
    /* no file, or a format this browser cannot decode: that sound stays silent */
  }
}

/** Starts loading some sounds (each file only once). Returns when they are all ready (or failed). */
export function loadSounds(context: BaseAudioContext, ids: readonly SoundId[]): Promise<unknown> {
  const loads: Promise<void>[] = [];
  for (const id of ids) {
    const file = SOUNDS[id].file;
    let load = requested.get(file);
    if (!load) {
      load = fetchAndDecode(context, file);
      requested.set(file, load);
    }
    loads.push(load);
  }
  return Promise.all(loads);
}

/** The context that only decodes (it needs no gesture of the person, unlike the one that plays). */
let decoder: OfflineAudioContext | undefined;

/**
 * Downloads and decodes some sounds before the person has pressed anything, so that the first press already sounds
 * (before, the files started loading with that first press and it stayed silent). A decoded buffer plays in any context.
 */
export function preloadSounds(ids: readonly SoundId[]): Promise<unknown> {
  try {
    decoder ??= new OfflineAudioContext(1, 1, 44100);
  } catch {
    return Promise.resolve();
  }
  return loadSounds(decoder, ids);
}

/** Whether a sound is decoded and ready to play right now. */
export function soundReady(id: SoundId): boolean {
  return buffers.has(SOUNDS[id].file);
}

/** How long a sound lasts in seconds (0 until it is loaded). */
export function soundLength(id: SoundId): number {
  return buffers.get(SOUNDS[id].file)?.duration ?? 0;
}

/** The seconds of silence after a ringtone before it repeats. */
export function soundGap(id: SoundId): number {
  const def: SoundDef = SOUNDS[id];
  return def.gap ?? 0;
}

/** The context that only decodes sounds the person made (see `decodeClip`). */
let clipDecoder: OfflineAudioContext | undefined;

/** Decodes a file of the person without a press being needed: a clip that is decoded in advance plays at the first press. */
export async function decodeClip(data: ArrayBuffer): Promise<AudioBuffer> {
  clipDecoder ??= new OfflineAudioContext(1, 1, 44100);
  return clipDecoder.decodeAudioData(data);
}

/** What a sound plays with. */
export interface PlayOptions {
  /** Playback speed: 1 is the recording, above 1 is higher and shorter. */
  rate?: number;
  /** Level before the master volume (1 is the level of the file). */
  gain?: number;
  /** Seconds from now. */
  at?: number;
  /** Play it again and again until it is stopped. */
  loop?: boolean;
}

/**
 * Plays a sound through a destination. Returns the source (to stop it), or null when the sound is not loaded yet (it
 * starts loading, and that press is silent: the next one sounds).
 */
export function playSound(
  context: BaseAudioContext,
  destination: AudioNode,
  id: SoundId,
  options: PlayOptions = {},
): AudioBufferSourceNode | null {
  const def: SoundDef = SOUNDS[id];
  const buffer = buffers.get(def.file);
  if (!buffer) {
    void loadSounds(context, [id]);
    return null;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = options.rate ?? 1;
  source.loop = options.loop ?? false;
  const level = context.createGain();
  level.gain.value = (options.gain ?? 1) * (def.trim ?? 1);
  source.connect(level).connect(destination);
  source.start(context.currentTime + (options.at ?? 0));
  return source;
}
