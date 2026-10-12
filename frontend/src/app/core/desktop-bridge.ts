/**
 * src/app/core/desktop-bridge.ts
 * What the desktop app (Windows) offers the page, and a way to ask for it. In a browser or on a phone `window.chatterlyDesktop`
 * does not exist, so everything here answers "not available".
 *
 * ! The desktop shell gives the page only these fixed commands (desktop/src/preload.cjs): nothing else crosses over.
 */

/** 'unavailable': this build does not update itself (a browser, the Store version). 'none': already the latest. */
export type DesktopUpdateStatus =
  'unavailable' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

/** How often the app looks for a new version: every hour/6/12/24 hours, only when it starts, or only when asked. */
export type UpdateInterval = '1h' | '6h' | '12h' | '24h' | 'start' | 'never';

/** The choices of the person about updates (auto: download at once and install when the app closes). */
export interface DesktopUpdateSettings {
  interval: UpdateInterval;
  notify: boolean;
  auto: boolean;
}

/** What the desktop shell tells the page about the update. */
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string;
  /** Download progress, 0 to 100. */
  percent: number;
  /** Bytes downloaded, bytes in all and bytes per second (0 when unknown). */
  transferred: number;
  total: number;
  bytesPerSecond: number;
  error: string;
  /** When the last check ended (milliseconds), or 0 if there has not been one. */
  lastCheck: number;
  settings: DesktopUpdateSettings;
}

/** The update commands. */
export interface DesktopUpdates {
  getState(): Promise<DesktopUpdateState | null>;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  setSettings(settings: Partial<DesktopUpdateSettings>): Promise<DesktopUpdateState>;
  onState(callback: (state: DesktopUpdateState) => void): () => void;
}

/** What to offer when sharing the screen. */
export type ShareSurface = 'any' | 'monitor' | 'window' | 'browser';

/** The screen sharing hint. */
export interface DesktopScreen {
  /** Says what is about to be shared and whether the picker starts with the sound ticked. */
  setSurface(surface: ShareSurface, audio?: boolean): Promise<boolean>;
}

/** The bar at the top of the window, when the app draws its own (Windows). */
export interface DesktopTitlebar {
  /** Height of the bar in pixels. */
  height: number;
  /** Colors of the buttons of Windows: the background and the symbols, as "#rrggbb". */
  setColors(colors: { color: string; symbolColor: string }): Promise<boolean>;
}

/** The graphics layers the person may choose ('auto' lets Chromium pick the best one). */
export type GraphicsBackend = 'auto' | 'd3d11' | 'gl' | 'vulkan' | 'metal';

/** How the desktop app uses the graphics card. */
export interface DesktopGraphicsState {
  hardwareAcceleration: boolean;
  backend: GraphicsBackend;
  /** What this run of the app uses (it changes after a restart). */
  applied: { hardwareAcceleration: boolean; backend: GraphicsBackend };
  /** The layers that exist on this system. */
  backends: GraphicsBackend[];
  /** True when the choice is not what the app is running with yet. */
  restartRequired: boolean;
  /** What Chromium says about drawing and WebGL ('enabled', 'disabled_software'...). */
  compositing: string;
  webgl: string;
}

/** The graphics choice. */
export interface DesktopGraphics {
  get(): Promise<DesktopGraphicsState | null>;
  set(choice: {
    hardwareAcceleration: boolean;
    backend: GraphicsBackend;
  }): Promise<DesktopGraphicsState | null>;
  restart(): Promise<boolean>;
}

/** Everything the desktop app puts on the page. */
export interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  updates?: DesktopUpdates;
  screen?: DesktopScreen;
  graphics?: DesktopGraphics;
  titlebar?: DesktopTitlebar;
}

declare global {
  interface Window {
    chatterlyDesktop?: DesktopBridge;
  }
}

/** The bridge, or undefined outside the desktop app. */
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.chatterlyDesktop;
}

/** True inside the desktop app. */
export function isDesktopApp(): boolean {
  return desktopBridge()?.isDesktop === true;
}
