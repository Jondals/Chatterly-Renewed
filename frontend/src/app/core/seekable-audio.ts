/**
 * src/app/core/seekable-audio.ts
 * Makes a recording that the browser cannot move around. A voice note recorded in the browser (WebM or Ogg from the
 * MediaRecorder) has no length and no index inside it, so the player ignores every jump to another second. Decoding it and
 * writing it again as plain PCM (WAV) gives a file whose every second is at a known place, so it can be moved freely.
 */

/** The rate of the new file: enough for a voice, and a five minute note stays under 15 MB. */
const RATE = 24000;
/** The longest recording that is converted (seconds) and the biggest file that is read. */
const MAX_SECONDS = 15 * 60;
const MAX_BYTES = 40 * 1024 * 1024;

/** True for the formats whose recordings cannot be moved. */
export function needsRewrite(mime: string): boolean {
  return /webm|ogg|opus/i.test(mime);
}

/** Writes the samples as a mono 16-bit WAV file. */
function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = function (at: number, value: string): void {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

/**
 * Gives the recording as a file that can be moved around, or the same bytes when it cannot be converted (the browser does not
 * know the format, or it is too long): then it plays as before.
 */
export async function makeSeekable(plain: ArrayBuffer | Uint8Array, mime: string): Promise<Blob> {
  const original = new Blob([plain as BlobPart], { type: mime });
  if (!needsRewrite(mime) || original.size > MAX_BYTES) return original;
  try {
    const copy = await original.arrayBuffer();
    const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(copy);
    if (decoded.duration > MAX_SECONDS) return original;
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++)
        mono[i] = (mono[i] ?? 0) + data[i]! / decoded.numberOfChannels;
    }
    return new Blob([encodeWav(mono, decoded.sampleRate)], { type: 'audio/wav' });
  } catch {
    return original;
  }
}
