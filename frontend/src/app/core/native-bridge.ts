/**
 * src/app/core/native-bridge.ts
 * What the Android app offers the page, and a way to ask for it. In a browser or in the desktop app there is no
 * `window.Capacitor` native platform, so everything here does nothing.
 *
 * ! The Android app gives the page only the commands of its own plugins (mobile/android/.../*Plugin.java):
 *   - ChatterlyCall: the notification of a call in progress (with mute, deafen and hang up) and the service that keeps
 *     the microphone alive with the screen off; the notification of a call that rings; staying connected in the
 *     background; where the voice sounds (earpiece, speaker, headset); whether screenshots are blocked;
 *   - ChatterlyUpdate: download a new version (only from the beta server of the app or a GitHub release of the project,
 *     checked before it is kept) and open the installer of Android;
 *   - ChatterlyFiles: keep a file of a chat (decrypted, asked by the person) in Downloads;
 *   - ChatterlyScreen: share the screen.
 */

/** A button of a notification of a call: what the person pressed and, for a ringing call, which call. */
export interface CallAction {
  action?: 'mute' | 'deafen' | 'hangup' | 'answer' | 'decline' | 'ringing' | 'show';
  roomId?: string;
}

/** Where the voice of a call can sound. */
export interface AudioRoute {
  id: string;
  kind: 'earpiece' | 'speaker' | 'wired' | 'bluetooth';
  name: string;
}

/** The plugin of the Android app for calls. */
export interface CallPlugin {
  call(state: {
    title: string;
    startedAt: number;
    muted: boolean;
    deafened: boolean;
  }): Promise<void>;
  update(state: { title?: string; muted?: boolean; deafened?: boolean }): Promise<void>;
  end(): Promise<void>;
  listen(options: { on: boolean }): Promise<void>;
  ring(options: { roomId: string; caller: string }): Promise<void>;
  cancelRing(): Promise<void>;
  setSecure(options: { secure: boolean }): Promise<void>;
  notifications(): Promise<{ granted: boolean }>;
  fullScreen(): Promise<{ allowed: boolean }>;
  fullScreenSettings(): Promise<void>;
  audioRoutes(): Promise<{ routes: AudioRoute[]; current: string }>;
  setAudioRoute(options: { id: string }): Promise<void>;
  takePendingAction(): Promise<CallAction>;
  addListener(event: 'action', listener: (action: CallAction) => void): Promise<ListenerHandle>;
}

/** Where to download a new version from: the address, the beta token (beta server only) and the expected SHA-256. */
export interface UpdateTarget {
  url: string;
  token?: string;
  sha256?: string;
}

/** The plugin of the Android app that downloads and installs a new version. */
export interface UpdatePlugin {
  /** allowOlder: an older version, only to keep in Downloads (it is never installed over the app). */
  download(
    target: UpdateTarget & { allowOlder?: boolean },
  ): Promise<{ version: string; sha256: string }>;
  install(): Promise<void>;
  /** Copies the downloaded APK to the Downloads folder (it stays after uninstalling); answers its name. */
  keepInDownloads(): Promise<{ name: string }>;
  /** Opens the dialog of Android that uninstalls the app. */
  uninstall(): Promise<void>;
}

/** The plugin of the Android app that keeps a file of a chat in the Downloads folder. */
export interface FilesPlugin {
  /** Saves a file (already decrypted, in base64); answers the name it got. */
  save(file: { name: string; mime: string; data: string }): Promise<{ name: string }>;
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
    ChatterlyFiles?: FilesPlugin;
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

/** The call plugin of the Android app, or null outside it. */
export function callPlugin(): CallPlugin | null {
  return nativePlugins()?.ChatterlyCall ?? null;
}

/** The files plugin of the Android app, or null outside it. */
export function filesPlugin(): FilesPlugin | null {
  return nativePlugins()?.ChatterlyFiles ?? null;
}

/** The screen plugin of the Android app, or null outside it. */
export function screenPlugin(): ScreenPlugin | null {
  return nativePlugins()?.ChatterlyScreen ?? null;
}
