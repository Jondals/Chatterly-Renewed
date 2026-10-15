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
 */
import { screenPlugin } from './native-bridge';

/** What each quality of the menu means on a phone: the longest side of the picture, pictures per second, JPEG quality. */
const PROFILES: Record<string, { longSide: number; fps: number; quality: number }> = {
  standard: { longSide: 960, fps: 10, quality: 55 },
  high: { longSide: 1280, fps: 12, quality: 60 },
  max: { longSide: 1280, fps: 15, quality: 55 },
};

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
export async function startAndroidScreen(quality: string): Promise<MediaStream> {
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
    track.stop();
    track.dispatchEvent(new Event('ended'));
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
  try {
    await plugin.start(profile);
  } catch (error) {
    ended = true;
    clearInterval(keepAlive);
    for (const handle of handles) {
      void handle.remove().catch(function ignored(): void {
        return undefined;
      });
    }
    track.stop();
    throw error;
  }
  // The track is not live until the first picture is drawn; the call adds it as it is.
  return stream;
}
