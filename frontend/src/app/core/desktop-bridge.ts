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
  /** Also offer the beta versions (only for accounts the administrator made testers). */
  beta: boolean;
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
type ShareSurface = 'any' | 'monitor' | 'window' | 'browser';

/** One screen or window the app can share. */
export interface ScreenPickItem {
  id: string;
  name: string;
  type: 'screen' | 'window';
  /** A small picture as a data address. */
  thumb: string;
}

/** The question of the shell when the person starts sharing: what can be shared and what to show first. */
export interface ScreenPickRequest {
  kind: 'screen' | 'window';
  /** Whether the box to share the sound of the computer starts ticked. */
  audio: boolean;
  items: ScreenPickItem[];
}

/** The screen sharing hint. */
export interface DesktopScreen {
  /** Says what is about to be shared and whether the picker starts with the sound ticked. */
  setSurface(surface: ShareSurface, audio?: boolean): Promise<boolean>;
  /** Calls `callback` each time the shell asks what to share (the page draws the menu). Returns the function that stops listening. */
  onPick(callback: (request: ScreenPickRequest) => void): () => void;
  /** Shares one of the sources the shell sent, with or without the sound of the computer. */
  choose(sourceId: string, audio: boolean): Promise<boolean>;
  /** Closes the menu without sharing. */
  cancel(): Promise<boolean>;
}

/** The bar at the top of the window, when the app draws its own (Windows). */
interface DesktopTitlebar {
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
interface DesktopGraphics {
  get(): Promise<DesktopGraphicsState | null>;
  set(choice: {
    hardwareAcceleration: boolean;
    backend: GraphicsBackend;
  }): Promise<DesktopGraphicsState | null>;
  restart(): Promise<boolean>;
}

/** How big the tiles of the overlay are. */
export type OverlaySize = 'small' | 'medium' | 'large';

/** The choices about the in-game overlay (kept by the desktop app; the place of the panel is fractions of the screen). */
export interface OverlaySettings {
  enabled: boolean;
  /** The shortcut that lets the panel be moved and resized, as an Electron accelerator ("CommandOrControl+Shift+O"). */
  hotkey: string;
  size: OverlaySize;
  /** 30 to 100. */
  opacity: number;
  onlySpeaking: boolean;
  showSelf: boolean;
  showNames: boolean;
  /** Keep the overlay out of screen recordings and shared screens. */
  hideFromCapture: boolean;
  /** The screen it covers: the main one, or the one the app window is on. */
  display: 'primary' | 'app';
  /** When it shows: in every call, or only while one of the registered games is open. */
  mode: 'always' | 'games';
  /** The names of the registered games (the overlay opens when an open window has one of them in its name). */
  games: string[];
  x: number;
  y: number;
  scale: number;
}

/** What the desktop app says about the overlay. */
export interface OverlayState {
  settings: OverlaySettings;
  /** The panel can be moved with the mouse right now. */
  editing: boolean;
  /** False when another program already has the shortcut. */
  hotkeyOk: boolean;
  /** The overlay window is open. */
  running: boolean;
}

/** One person to draw in the overlay. */
export interface OverlayTile {
  id: string;
  name: string;
  /** A small picture as a data address, or empty to draw the initials. */
  avatar: string;
  color: string;
  speaking: boolean;
  muted: boolean;
  /** The id of the stream that carries their video over the local connection, or empty when there is none. */
  streamId: string;
}

/** A message of the local video connection between the app and the overlay window. */
export interface OverlaySignal {
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/** What the overlay tells the page. */
export type OverlayEvent =
  | { type: 'state'; state: OverlayState }
  | { type: 'ready' }
  | { type: 'closed' }
  | { type: 'signal'; message: OverlaySignal };

/** The in-game overlay. */
export interface DesktopOverlay {
  get(): Promise<OverlayState | null>;
  set(patch: Partial<OverlaySettings>): Promise<OverlayState | null>;
  setTiles(tiles: OverlayTile[]): Promise<boolean>;
  signal(message: OverlaySignal): Promise<boolean>;
  /** The names of the windows that are open now (to register a game from the list). */
  windows(): Promise<string[]>;
  onEvent(callback: (event: OverlayEvent) => void): () => void;
}

/** Everything the desktop app puts on the page. */
export interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  updates?: DesktopUpdates;
  screen?: DesktopScreen;
  graphics?: DesktopGraphics;
  overlay?: DesktopOverlay;
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
