/**
 * src/app/core/android-screen.ts
 * Shares the screen from the Android app. The Android web view has no getDisplayMedia, so the app captures the screen
 * itself (plugin ChatterlyScreen, a foreground service of type mediaProjection) and sends JPEG pictures; they are drawn
 * on a canvas here and the canvas becomes the video track of the call, exactly like a stream from getDisplayMedia.
 *
 * ! The system asks the person every time; the pictures come only from the app plugin. Android blocks capturing this
 *   app's own window (FLAG_SECURE), so what is shared is the rest of the phone.
 * * The pictures and the sound arrive as BINARY messages on window.chatterlyScreen (a channel of the WebView straight from the
 *   app, see ScreenSharePlugin.java): no base64, no bridge in between. That is what lets the sharing reach 60 pictures per
 *   second without the phone stuttering (it was stuck at about 15, whatever the quality; the 60 qualities ask for 60 and a slower
 *   phone simply sends fewer, because only one picture is in flight). A WebView too old for it uses the
 *   events of the plugin, as before.
 * * Pace: one picture in flight. A picture is acknowledged once it was drawn, and only then does the app encode another,
 *   so a slow phone sends fewer pictures instead of piling them up.
 * * Sound (Android 10+, if the person asks for it): the app sends the sound of the other apps in pieces of 50 ms (PCM,
 *   mono, 48 kHz). Each piece is played, a little ahead, into an audio track that goes to the call with the video, like
 *   the sound of getDisplayMedia. The sound of Chatterly itself is not captured (no echo of the call). When it only brings
 *   silence (an app can forbid capturing its sound), `onScreenSilent` is told, so the person knows.
 */
import { screenPlugin } from './native-bridge';
import { screenQuality } from './screen-quality';

/** The JPEG quality for a picture of that height: bigger pictures are compressed a little more to keep each one light. */
const JPEG_QUALITY: Record<number, number> = { 720: 60, 1080: 58 };
/** The same over the old path (base64 through the bridge), which cannot go faster without making the phone stutter. */
const OLD_PATH_FPS = 15;

/** The sound of the shared screen: mono, 48 kHz. */
const AUDIO_RATE = 48000;
/** How far ahead the sound is played: enough to cover an uneven arrival of the pieces, little enough to stay in sync. */
const AUDIO_AHEAD_S = 0.12;
/** The kinds of message of the binary channel. */
const KIND_FRAME = 1;
const KIND_SOUND = 2;

/** The binary channel the app opens into the page (androidx.webkit WebMessageListener). */
interface ScreenChannel {
  postMessage(message: string): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

declare global {
  interface Window {
    chatterlyScreen?: ScreenChannel;
  }
}

/** Who is told that the shared sound is only silence (the call service shows it to the person). */
let silentListener: (() => void) | null = null;

/** Sets who is told that the sound of the shared screen comes as silence. */
export function onScreenSilent(listener: (() => void) | null): void {
  silentListener = listener;
}

/** Plays the pieces of sound of the phone into an audio track (the track goes to the call with the screen). */
class ScreenSound {
  private readonly context = new AudioContext({
    sampleRate: AUDIO_RATE,
    latencyHint: 'interactive',
  });
  private readonly output = this.context.createMediaStreamDestination();
  private next = 0;

  constructor() {
    // ! It must be running: a context that the WebView left suspended plays nothing, and the others heard nothing.
    void this.context.resume().catch(function ignored(): void {
      return undefined;
    });
  }

  /** The track of the sound. */
  get track(): MediaStreamTrack {
    return this.output.stream.getAudioTracks()[0]!;
  }

  /** Plays one piece given as base64 (the old path). */
  playBase64(base64: string): void {
    const bytes = Uint8Array.from(atob(base64), function code(c) {
      return c.charCodeAt(0);
    });
    this.play(bytes.buffer, 0, bytes.length);
  }

  /** Plays one piece (16-bit little-endian PCM) of `length` bytes from `offset`, right after the previous one. */
  play(buffer: ArrayBuffer, offset: number, length: number): void {
    const count = length >> 1;
    if (count === 0) return;
    if (this.context.state === 'suspended') void this.context.resume().catch(noop);
    const view = new DataView(buffer, offset, count * 2);
    const audio = this.context.createBuffer(1, count, AUDIO_RATE);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.output);
    const now = this.context.currentTime;
    // Late (a gap in the arrival): start again a little ahead instead of piling up delay.
    if (this.next < now) this.next = now + AUDIO_AHEAD_S;
    // Too far ahead (pieces came in a burst): drop back so the sound does not drift away from the picture.
    if (this.next > now + AUDIO_AHEAD_S * 4) this.next = now + AUDIO_AHEAD_S;
    source.start(this.next);
    this.next += audio.duration;
  }

  /** Stops the sound. */
  close(): void {
    this.track.stop();
    void this.context.close().catch(noop);
  }
}

function noop(): void {
  return undefined;
}

/** True when the Android app can share the screen. */
export function androidScreenAvailable(): boolean {
  return screenPlugin() !== null;
}

/** Stops the native capture (used when a call ends). */
export function stopAndroidScreen(): void {
  void screenPlugin()?.stop().catch(noop);
}

/**
 * Asks the system for permission and starts sharing. Resolves with the video stream, or rejects if the person cancelled.
 * The video track is ended (an `ended` event) when the capture stops, whether the person did it or the system.
 */
export async function startAndroidScreen(
  quality: string,
  withSound: boolean,
): Promise<MediaStream> {
  const plugin = screenPlugin();
  if (!plugin) throw new Error('screen sharing is not available');
  const channel = window.chatterlyScreen ?? null;
  const chosen = screenQuality(quality, true);
  // The longest side of the picture is the width of the quality (the phone may be held either way).
  const base = {
    longSide: chosen.width,
    fps: chosen.fps,
    quality: JPEG_QUALITY[chosen.height] ?? 58,
  };
  const profile = channel ? base : { ...base, fps: Math.min(base.fps, OLD_PATH_FPS) };
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) throw new Error('no canvas');
  context.fillStyle = '#000';
  context.fillRect(0, 0, 2, 2);
  const stream = canvas.captureStream(profile.fps);
  const track = stream.getVideoTracks()[0]!;
  const handles: { remove(): Promise<void> }[] = [];
  let ended = false;
  let drawing = false;
  const sound = withSound ? new ScreenSound() : null;
  if (sound) stream.addTrack(sound.track);
  // A canvas only sends a video frame when it changes, and a screen that does not change sends no picture: touching the
  // canvas once a second keeps the video alive (a person who joins later still gets an image, the call sees no freeze).
  const keepAlive = setInterval(function touch(): void {
    if (canvas.width > 2) context.drawImage(canvas, 0, 0);
  }, 1000);

  /** Ends everything, once: the listeners, the native capture and the track. */
  function end(): void {
    if (ended) return;
    ended = true;
    clearInterval(keepAlive);
    if (channel) channel.onmessage = null;
    for (const handle of handles) void handle.remove().catch(noop);
    void plugin!.stop().catch(noop);
    sound?.close();
    track.stop();
    track.dispatchEvent(new Event('ended'));
  }

  /** Says the picture was drawn (the next one may be encoded). */
  function acknowledge(binary: boolean): void {
    if (ended) return;
    if (binary && channel) channel.postMessage('ack');
    else void plugin!.ack().catch(noop);
  }

  /** Draws a JPEG on the canvas and says it is done. */
  async function drawJpeg(jpeg: Blob, binary: boolean): Promise<void> {
    drawing = true;
    try {
      const bitmap = await createImageBitmap(jpeg);
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context!.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch {
      /* a broken picture is skipped */
    } finally {
      drawing = false;
    }
    acknowledge(binary);
  }

  /** A message of the binary channel: a picture or a piece of sound. */
  function onChannel(event: MessageEvent): void {
    if (ended || !(event.data instanceof ArrayBuffer) || event.data.byteLength < 2) return;
    const data = event.data;
    const kind = new Uint8Array(data, 0, 1)[0];
    if (kind === KIND_FRAME && data.byteLength > 5 && !drawing) {
      void drawJpeg(new Blob([new Uint8Array(data, 5)], { type: 'image/jpeg' }), true);
    } else if (kind === KIND_SOUND) {
      sound?.play(data, 1, data.byteLength - 1);
    }
  }

  /** The old path: a picture as base64 through the plugin. */
  function drawOld(frame: { data: string; width: number; height: number }): void {
    const bytes = Uint8Array.from(atob(frame.data), function code(c) {
      return c.charCodeAt(0);
    });
    void drawJpeg(new Blob([bytes], { type: 'image/jpeg' }), false);
  }

  /** The old path: a piece of the sound as base64. */
  function hearOld(piece: { data: string }): void {
    if (!ended) sound?.playBase64(piece.data);
  }

  /** The sound comes as silence: the person is told (once per sharing). */
  let toldSilent = false;
  function silent(): void {
    if (!toldSilent && !ended) {
      toldSilent = true;
      silentListener?.();
    }
  }

  if (channel) {
    channel.onmessage = onChannel;
    channel.postMessage('attach');
  }
  handles.push(await plugin.addListener('frame', drawOld));
  handles.push(await plugin.addListener('stopped', end));
  handles.push(await plugin.addListener('silent', silent));
  if (sound) handles.push(await plugin.addListener('audio', hearOld));
  try {
    await plugin.start({ ...profile, audio: withSound });
  } catch (error) {
    ended = true;
    clearInterval(keepAlive);
    if (channel) channel.onmessage = null;
    for (const handle of handles) void handle.remove().catch(noop);
    sound?.close();
    track.stop();
    throw error;
  }
  // The track is not live until the first picture is drawn; the call adds it as it is.
  return stream;
}
