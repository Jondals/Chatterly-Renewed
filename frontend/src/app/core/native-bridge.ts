/**
 * src/app/core/native-bridge.ts
 * What the Android app offers the page, and a way to ask for it. In a browser or in the desktop app there is no
 * `window.Capacitor` native platform, so everything here does nothing.
 *
 * ! The Android app gives the page only the commands of its own two plugins (mobile/android/.../*Plugin.java):
 *   - ChatterlyCall: start and stop the foreground service that keeps the microphone of a call alive with the screen off;
 *   - ChatterlyUpdate: download a new version (only from the beta server of the app or a GitHub release of the project,
 *     checked before it is kept) and open the installer of Android.
 */

/** The plugin of the Android app that keeps a call alive in the background. */
interface CallPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Where to download a new version from: the address, the beta token (beta server only) and the expected SHA-256. */
export interface UpdateTarget {
  url: string;
  token?: string;
  sha256?: string;
}

/** The plugin of the Android app that downloads and installs a new version. */
export interface UpdatePlugin {
  download(target: UpdateTarget): Promise<{ version: string; sha256: string }>;
  install(): Promise<void>;
}

/** A handle to stop listening to an event of a plugin. */
interface ListenerHandle {
  remove(): Promise<void>;
}

/** The plugin of the Android app that captures the screen and sends it to the page as pictures. */
export interface ScreenPlugin {
  start(options: { longSide: number; fps: number; quality: number }): Promise<void>;
  ack(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'frame',
    listener: (frame: { data: string; width: number; height: number }) => void,
  ): Promise<ListenerHandle>;
  addListener(event: 'stopped', listener: () => void): Promise<ListenerHandle>;
}

/** The shape of `window.Capacitor` that is read here (the native bridge of Capacitor puts it on the page). */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    ChatterlyCall?: CallPlugin;
    ChatterlyUpdate?: UpdatePlugin;
    ChatterlyScreen?: ScreenPlugin;
  };
}

/** The plugins of the Android app, or null outside it. */
function nativePlugins(): CapacitorGlobal['Plugins'] | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins ?? null;
}

/** The update plugin of the Android app, or null outside it. */
export function updatePlugin(): UpdatePlugin | null {
  return nativePlugins()?.ChatterlyUpdate ?? null;
}

/** The screen plugin of the Android app, or null outside it. */
export function screenPlugin(): ScreenPlugin | null {
  return nativePlugins()?.ChatterlyScreen ?? null;
}

/**
 * Asks the Android app to keep the call alive in the background (a foreground service of type microphone with a
 * generic notification: no names, no group, no channel), or to stop doing it. Outside the app it does nothing. A refusal
 * of the system (for example the microphone permission was taken away) only means the call stops with the screen off.
 */
export function keepCallAlive(on: boolean): void {
  const plugin = nativePlugins()?.ChatterlyCall;
  if (!plugin) return;
  void (on ? plugin.start() : plugin.stop()).catch(function ignored(error: unknown) {
    console.warn('the call could not be kept alive in the background', error);
  });
}
