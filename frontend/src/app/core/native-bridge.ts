/**
 * src/app/core/native-bridge.ts
 * What the Android app offers the page, and a way to ask for it. In a browser or in the desktop app there is no
 * `window.Capacitor` native platform, so everything here does nothing.
 *
 * ! The Android app gives the page only the commands of its own plugin (mobile/android/.../CallServicePlugin.java):
 *   start and stop the foreground service that keeps the microphone of a call alive with the screen off.
 */

/** The plugin of the Android app that keeps a call alive in the background. */
interface CallPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The shape of `window.Capacitor` that is read here (the native bridge of Capacitor puts it on the page). */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { ChatterlyCall?: CallPlugin };
}

/** The call plugin of the Android app, or null outside it. */
function callPlugin(): CallPlugin | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.ChatterlyCall ?? null;
}

/**
 * Asks the Android app to keep the call alive in the background (a foreground service of type microphone with a
 * generic notification: no names, no group, no channel), or to stop doing it. Outside the app it does nothing. A refusal
 * of the system (for example the microphone permission was taken away) only means the call stops with the screen off.
 */
export function keepCallAlive(on: boolean): void {
  const plugin = callPlugin();
  if (!plugin) return;
  void (on ? plugin.start() : plugin.stop()).catch(function ignored(error: unknown) {
    console.warn('the call could not be kept alive in the background', error);
  });
}
