/**
 * src/app/core/audio-chain.ts
 * The processing of the voice between the microphone and what is sent to the call (or to the test of the microphone).
 * The browser already offers noise suppression, echo cancellation and automatic gain (see the audio settings); this is what
 * comes after them, made with Web Audio nodes that run in the audio thread (no cost for the page).
 *
 * * The person chooses ONE mode, and each mode is a clear change that can be heard:
 *   - off: the voice goes as it comes out of the microphone.
 *   - natural: only the low rumble is cut (desks, fans, handling noise).
 *   - noisy: for a room with noise (fan, keyboard, street): the rumble and the hiss are cut, the voice is narrower and the
 *     microphone opens only for the voice (the call service learns how loud the room is and keeps the gate above it).
 *   - studio: a voice like a podcast: less boominess, more presence and brightness, and loud and quiet words brought closer.
 */

/** What is done to the voice. */
export type VoiceMode = 'off' | 'natural' | 'noisy' | 'studio';

/** What the person chose for the voice. */
export interface VoiceOptions {
  /** Volume of the microphone in percent (100 is as it comes). */
  inputVolume: number;
  mode: VoiceMode;
}

/** The connected nodes: audio enters `input` and leaves through `output`. */
export interface VoiceChain {
  input: AudioNode;
  output: AudioNode;
}

/** The modes of the choice, with what each one does (the settings show these words). */
export const VOICE_MODES: { id: VoiceMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Your voice goes as it comes out of the microphone.' },
  {
    id: 'natural',
    label: 'Natural',
    hint: 'Only cuts the low rumble of desks and fans. Your voice does not change.',
  },
  {
    id: 'noisy',
    label: 'Noisy room',
    hint: 'For fans, keyboard or street: cuts rumble and hiss and opens the microphone only for your voice. It sounds a bit narrower.',
  },
  {
    id: 'studio',
    label: 'Studio',
    hint: 'A podcast voice: less boominess, more presence and brightness, and loud and quiet words are brought closer.',
  },
];

/** Adds a filter to the chain. */
function filter(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  gain = 0,
  q = 0.7,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.gain.value = gain;
  node.Q.value = q;
  return node;
}

/** A compressor with the threshold (dB), the ratio, the attack and the release (seconds) given. */
function compressor(
  context: BaseAudioContext,
  threshold: number,
  ratio: number,
  attack: number,
  release: number,
): DynamicsCompressorNode {
  const node = context.createDynamicsCompressor();
  node.threshold.value = threshold;
  node.knee.value = 10;
  node.ratio.value = ratio;
  node.attack.value = attack;
  node.release.value = release;
  return node;
}

/**
 * Builds the chain of the voice. Nothing is created for what the mode does not use, so "off" is a plain wire.
 * @param context The audio context where it runs.
 * @param options What the person chose.
 */
export function buildVoiceChain(context: BaseAudioContext, options: VoiceOptions): VoiceChain {
  const volume = context.createGain();
  volume.gain.value = Math.max(0, Math.min(2, options.inputVolume / 100));
  let tail: AudioNode = volume;
  const append = function append(node: AudioNode): void {
    tail.connect(node);
    tail = node;
  };
  if (options.mode === 'natural') {
    append(filter(context, 'highpass', 110));
  } else if (options.mode === 'noisy') {
    append(filter(context, 'highpass', 240, 0, 0.9));
    append(filter(context, 'lowpass', 5200, 0, 0.7));
    append(filter(context, 'peaking', 1800, 3, 0.8));
    append(compressor(context, -32, 3, 0.005, 0.2));
    const makeup = context.createGain();
    makeup.gain.value = 1.5;
    append(makeup);
  } else if (options.mode === 'studio') {
    append(filter(context, 'highpass', 90));
    append(filter(context, 'lowshelf', 200, -4));
    append(filter(context, 'peaking', 3200, 5, 0.9));
    append(filter(context, 'highshelf', 7500, 3));
    append(compressor(context, -34, 4.5, 0.004, 0.22));
    const makeup = context.createGain();
    makeup.gain.value = 2;
    append(makeup);
  }
  return { input: volume, output: tail };
}
