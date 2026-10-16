/**
 * src/app/core/android-screen.ts
 * Shares the screen from the Android app. The Android web view has no getDisplayMedia, so the app captures the screen
 * itself (plugin ChatterlyScreen, a foreground service of type mediaProjection) and sends JPEG pictures; they are drawn
 * on a canvas here and the canvas becomes the video track of the call, exactly like a stream from getDisplayMedia.
 *
 * ! The system asks the person every time; the pictures come only from the app plugin. Android blocks capturing this
 *   app's own window (FLAG_SECURE), so what is shared is the rest of the phone.
 * * Pace: one picture in flight. A picture is acknowledged once it was drawn, and only then does the app encode another,
 *   so a slow phone sends fewer pictures instead of piling them up.
 * * Sound (Android 10+, if the person asks for it): the app sends the sound of the other apps in pieces of 100 ms (PCM,
 *   mono, 48 kHz). Each piece is played, a little ahead, into an audio track that goes to the call with the video, like
 *   the sound of getDisplayMedia. The sound of Chatterly itself is not captured (no echo of the call).
 */
import { screenPlugin } from './native-bridge';

/** What each quality of the menu means on a phone: the longest side of the picture, pictures per second, JPEG quality. */
const PROFILES: Record<string, { longSide: number; fps: number; quality: number }> = {
  standard: { longSide: 960, fps: 10, quality: 55 },
  high: { longSide: 1280, fps: 12, quality: 60 },
  max: { longSide: 1280, fps: 15, quality: 55 },
};

/** The sound of the shared screen: mono, 48 kHz. */
const AUDIO_RATE = 48000;
/** How far ahead the sound is played: enough to cover an uneven arrival of the pieces, little enough to stay in sync. */
const AUDIO_AHEAD_S = 0.15;

/** Plays the pieces of sound of the phone into an audio track (the track goes to the call with the screen). */
class ScreenSound {
  private readonly context = new AudioContext({ sampleRate: AUDIO_RATE });
  private readonly output = this.context.createMediaStreamDestination();
  private next = 0;

  /** The track of the sound. */
  get track(): MediaStreamTrack {
    return this.output.stream.getAudioTracks()[0]!;
  }

  /** Plays one piece (16-bit little-endian PCM in base64) right after the previous one. */
  play(base64: string): void {
    const bytes = Uint8Array.from(atob(base64), function code(c) {
      return c.charCodeAt(0);
    });
    const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, AUDIO_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    const now = this.context.currentTime;
    // Late (a gap in the arrival): start again a little ahead instead of piling up delay.
    if (this.next < now) this.next = now + AUDIO_AHEAD_S;
    source.start(this.next);
    this.next += buffer.duration;
  }

  /** Stops the sound. */
  close(): void {
    this.track.stop();
    void this.context.close().catch(function ignored(): void {
      return undefined;
    });
  }
}

/** True when the Android app can share the screen. */
export function androidScreenAvailable(): boolean {
  return screenPlugin() !== null;
}

/** Stops the native capture (used when a call ends). */
export function stopAndroidScreen(): void {
  void screenPlugin()
    ?.stop()
    .catch(function ignored(): void {
      return undefined;
    });
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
  const profile = PROFILES[quality] ?? PROFILES['high']!;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('no canvas');
  context.fillStyle = '#000';
  context.fillRect(0, 0, 2, 2);
  const stream = canvas.captureStream(profile.fps);
  const track = stream.getVideoTracks()[0]!;
  const handles: { remove(): Promise<void> }[] = [];
  let ended = false;
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
    for (const handle of handles) {
      void handle.remove().catch(function ignored(): void {
        return undefined;
      });
    }
    void plugin!.stop().catch(function ignored(): void {
      return undefined;
    });
    sound?.close();
    track.stop();
    track.dispatchEvent(new Event('ended'));
  }

  /** Plays a piece of the sound of the phone. */
  function hear(piece: { data: string }): void {
    if (!ended) sound?.play(piece.data);
  }

  /** Draws a picture on the canvas and says it is done. */
  async function draw(frame: { data: string; width: number; height: number }): Promise<void> {
    try {
      const bytes = Uint8Array.from(atob(frame.data), function code(c) {
        return c.charCodeAt(0);
      });
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context!.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch {
      /* a broken picture is skipped */
    }
    if (!ended)
      void plugin!.ack().catch(function ignored(): void {
        return undefined;
      });
  }

  handles.push(await plugin.addListener('frame', draw));
  handles.push(await plugin.addListener('stopped', end));
  if (sound) handles.push(await plugin.addListener('audio', hear));
  try {
    await plugin.start({ ...profile, audio: withSound });
  } catch (error) {
    ended = true;
    clearInterval(keepAlive);
    for (const handle of handles) {
      void handle.remove().catch(function ignored(): void {
        return undefined;
      });
    }
    sound?.close();
    track.stop();
    throw error;
  }
  // The track is not live until the first picture is drawn; the call adds it as it is.
  return stream;
}
