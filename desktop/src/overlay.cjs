/**
 * desktop/src/overlay.cjs
 * The in-game overlay: the people of your call (camera or picture, name, who is talking) drawn in a transparent window that
 * stays on top of the other windows, so you see them while you play. Desktop app only.
 *
 * * How it works: a window as big as the chosen screen, transparent, without frame, always on top at the highest level,
 *   that never takes the focus and lets the mouse go through. It is one more window of the app (same sandbox, no Node):
 *   it does not read, hook or change the game, so there is nothing for an anti-cheat to flag. It shows over games in
 *   windowed or borderless mode; a game in "exclusive full screen" owns the monitor and nothing can be drawn over it.
 * * The video: a MediaStream cannot be handed to another window, so the page of the app and the overlay talk through a
 *   WebRTC connection that never leaves the computer (no STUN, no TURN, no network). This file only RELAYS its signalling
 *   messages between the two windows; the frames are already decrypted in the page, travel inside the computer and stop there.
 * * Which games: the person can register the windows (games) that should use it. While the overlay is set to "only with my
 *   games", it opens when a window whose name contains one of the registered names is open (the list of open windows is read
 *   every few seconds, without pictures: Electron cannot tell which window has the focus), and a small notice in the overlay
 *   says which keys open it.
 * * Editing: a keyboard shortcut (chosen in Settings > Game overlay) lets the mouse reach the window for a moment, so the
 *   panel can be dragged and resized; the focus goes back to the game when it ends.
 * * The choices are kept in overlay.json in the profile folder and are checked on every read and write.
 * ! Only the main page of the app may use the commands, and only fixed shapes are accepted (see sanitize*): a page that lies
 *   can draw its own names and pictures in the overlay and nothing else.
 */
'use strict';

const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  // On by default, like the overlay of Discord: it only appears during a call.
  enabled: true,
  hotkey: 'CommandOrControl+Shift+O',
  size: 'medium',
  opacity: 100,
  onlySpeaking: false,
  showSelf: false,
  showNames: true,
  hideFromCapture: true,
  display: 'primary',
  mode: 'always',
  games: [],
  x: 0.02,
  y: 0.08,
  scale: 1,
};
const SIZES = ['small', 'medium', 'large'];
const DISPLAYS = ['primary', 'app'];
/** When it shows: during every call, or only while one of the registered games is open. */
const MODES = ['always', 'games'];
const MAX_GAMES = 30;
const MAX_GAME_CHARS = 80;
/** How often the open windows are read while the overlay waits for a game. */
const WATCH_MS = 4000;
/** A shortcut is one to three modifiers and a letter, a digit or F1 to F12. */
const HOTKEY = /^(?:(?:CommandOrControl|Alt|Shift)\+){1,3}(?:[A-Z0-9]|F[1-9]|F1[0-2])$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const AVATAR = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_TILES = 16;
const MAX_AVATAR_CHARS = 60000;
const MAX_SIGNAL_CHARS = 30000;

let settings = { ...DEFAULTS };
let mainWindow = null;
let isAppAddress = null;
let userData = '';
let quiet = false;
let overlayWindow = null;
let editing = false;
let hotkeyOk = true;
let registeredHotkey = '';
let tiles = [];
let gameOpen = false;
/** The person pressed the shortcut while the overlay waited for a game: it stays open until the call ends. */
let forced = false;
let watchTimer = null;

/** Where the choices are kept. */
function fileOf() {
  return path.join(userData, 'overlay.json');
}

/** A number inside a range (the fallback when it is not a finite number). */
function clamp(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;
}

/**
 * Turns anything into valid choices on top of `base`. ! Only the known keys with values of the right kind survive, so a
 * damaged file or a page that lies can only fall back to the defaults.
 */
function sanitizeSettings(raw, base) {
  const wanted = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = { ...base };
  for (const key of ['enabled', 'onlySpeaking', 'showSelf', 'showNames', 'hideFromCapture']) {
    if (typeof wanted[key] === 'boolean') next[key] = wanted[key];
  }
  if (typeof wanted.hotkey === 'string' && HOTKEY.test(wanted.hotkey)) next.hotkey = wanted.hotkey;
  if (SIZES.includes(wanted.size)) next.size = wanted.size;
  if (DISPLAYS.includes(wanted.display)) next.display = wanted.display;
  if (MODES.includes(wanted.mode)) next.mode = wanted.mode;
  if (Array.isArray(wanted.games)) next.games = cleanGames(wanted.games);
  next.opacity = Math.round(clamp(wanted.opacity, 30, 100, next.opacity));
  next.x = clamp(wanted.x, 0, 1, next.x);
  next.y = clamp(wanted.y, 0, 1, next.y);
  next.scale = clamp(wanted.scale, 0.5, 3, next.scale);
  return next;
}

/** The names of the registered games: short texts, no repeats (the case does not matter), at most MAX_GAMES. */
function cleanGames(list) {
  const names = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, MAX_GAME_CHARS);
    if (name === '' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    if (names.length === MAX_GAMES) break;
  }
  return names;
}

/** Reads the choices of the person (the defaults when there is none or the file is damaged). */
function load() {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(fileOf(), 'utf8')), DEFAULTS);
  } catch (error) {
    return { ...DEFAULTS };
  }
}

/** Keeps the choices. */
function save() {
  if (quiet) return;
  try {
    fs.writeFileSync(fileOf(), JSON.stringify(settings), 'utf8');
  } catch (error) {
    // The choices simply are not kept this time.
  }
}

/**
 * The people to draw, cleaned: at most MAX_TILES, each with short texts, a small picture that is really a data image, a
 * color written as "#rrggbb" and yes/no flags.
 */
function sanitizeTiles(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  for (const item of raw.slice(0, MAX_TILES)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    const avatar =
      typeof item.avatar === 'string' &&
      item.avatar.length <= MAX_AVATAR_CHARS &&
      AVATAR.test(item.avatar)
        ? item.avatar
        : '';
    clean.push({
      id: item.id.slice(0, 64),
      name: typeof item.name === 'string' ? item.name.slice(0, 40) : '',
      avatar,
      color: typeof item.color === 'string' && HEX_COLOR.test(item.color) ? item.color : '#2ef2b0',
      speaking: item.speaking === true,
      muted: item.muted === true,
      streamId: typeof item.streamId === 'string' ? item.streamId.slice(0, 80) : '',
    });
  }
  return clean;
}

/** A signalling message of the local connection: an offer, an answer or a candidate, small, nothing else. */
function sanitizeSignal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || !['offer', 'answer', 'candidate'].includes(keys[0])) return null;
  const body = raw[keys[0]];
  if (!body || typeof body !== 'object') return null;
  let text = '';
  try {
    text = JSON.stringify(raw);
  } catch (error) {
    return null;
  }
  return text.length <= MAX_SIGNAL_CHARS ? JSON.parse(text) : null;
}

/** What the page sees of the overlay. */
function state() {
  return { settings, editing, hotkeyOk, running: Boolean(overlayWindow) };
}

/** Tells the main page something (a change of state, a signalling message, the overlay window being ready). */
function tellPage(message) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('overlay:event', message);
}

/** Tells the overlay window something. */
function tellOverlay(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed())
    overlayWindow.webContents.send(channel, payload);
}

/** The screen the overlay covers: the main one, or the one the app window is on. */
function targetDisplay() {
  if (settings.display === 'app' && mainWindow && !mainWindow.isDestroyed()) {
    return screen.getDisplayMatching(mainWindow.getBounds());
  }
  return screen.getPrimaryDisplay();
}

/** The choices the overlay window needs to draw. */
function viewConfig() {
  const spanish = String(app.getLocale() || 'en').slice(0, 2) === 'es';
  const keys = settings.hotkey.replace('CommandOrControl', 'Ctrl');
  return {
    ...settings,
    editing,
    toast: spanish
      ? 'Overlay de Chatterly activo · ' + keys + ' para moverlo'
      : 'Chatterly overlay is on · ' + keys + ' to move it',
    hint: spanish
      ? 'Arrastra para mover · esquina para el tamaño · Esc para terminar'
      : 'Drag to move · corner to resize · Esc to finish',
  };
}

/** Sends the choices to the overlay window and to the page, and applies the ones that live in the window itself. */
function publish() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setContentProtection(settings.hideFromCapture);
    overlayWindow.setBounds(targetDisplay().bounds);
    tellOverlay('overlay:config', viewConfig());
  }
  tellPage({ type: 'state', state: state() });
}

// ── The window ────────────────────────────────────────────────────────────────────────────────────────

/** Opens the overlay window (transparent, on top, click-through, never taking the focus). */
function openWindow() {
  if (overlayWindow) return;
  const bounds = targetDisplay().bounds;
  overlayWindow = new BrowserWindow({
    ...bounds,
    ...(quiet ? { x: -32000, y: -32000 } : {}),
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    // ! On Windows a "toolbar" window is a tool window: it is NOT in the Alt+Tab list. Without it the overlay appeared there as one
    //   more "Chatterly" window, and choosing it minimized the game and left the overlay (which is not the game) in front.
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    alwaysOnTop: true,
    fullscreenable: false,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
      backgroundThrottling: false,
    },
  });
  const win = overlayWindow;
  // The highest level: above windows in "borderless" full screen. On a Mac it must also follow the full-screen spaces.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setContentProtection(settings.hideFromCapture);
  win.webContents.on('did-finish-load', onOverlayLoaded);
  win.once('ready-to-show', win.showInactive.bind(win));
  win.on('closed', onOverlayClosed);
  // Never keeps the focus: if something gives it to the overlay (outside the editing mode), it goes straight back to the game.
  win.on('focus', onOverlayFocus);
  win.loadFile(path.join(__dirname, 'overlay.html'));
}

/** The overlay got the focus without the person asking for it (editing): hand it back. */
function onOverlayFocus() {
  if (!editing && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.blur();
}

/** The overlay page is ready: give it the choices and the people, and ask the app page to send the video. */
function onOverlayLoaded() {
  tellOverlay('overlay:config', viewConfig());
  tellOverlay('overlay:tiles', tiles);
  tellPage({ type: 'ready' });
  tellPage({ type: 'state', state: state() });
}

/** The overlay window is gone (closed by us, or by the system). */
function onOverlayClosed() {
  overlayWindow = null;
  editing = false;
  tellPage({ type: 'closed' });
  tellPage({ type: 'state', state: state() });
}

/** Closes the overlay window. */
function closeWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
}

/** Names of the windows that are open now (without the ones of Chatterly itself). */
async function openWindowNames() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const names = [];
  for (const source of sources) {
    const name = String(source.name || '').trim();
    if (name === '' || name === 'Chatterly' || name.startsWith('Chatterly overlay')) continue;
    if (!names.includes(name)) names.push(name.slice(0, 120));
  }
  return names.slice(0, 100);
}

/** True when a registered game has a window open. */
function anyGameIn(names) {
  return names.some(function isGame(name) {
    return settings.games.some(function matches(game) {
      return name.toLowerCase().includes(game.toLowerCase());
    });
  });
}

/** Looks at the open windows and opens or closes the overlay if a registered game appeared or went away. */
async function watchGames() {
  let open = false;
  try {
    open = anyGameIn(await openWindowNames());
  } catch (error) {
    open = false;
  }
  if (open !== gameOpen) {
    gameOpen = open;
    sync();
  }
}

/** Reads the open windows now and then, but only while the overlay waits for a game during a call. */
function updateWatch() {
  const needed = settings.enabled && settings.mode === 'games' && tiles.length > 0;
  if (needed && !watchTimer) {
    watchTimer = setInterval(watchGames, WATCH_MS);
    void watchGames();
  } else if (!needed && watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
    gameOpen = false;
  }
}

/** Opens or closes the window to match: it exists while the overlay is on, there are people to show and (if it waits for a game) one is open. */
function sync() {
  updateWatch();
  if (tiles.length === 0) forced = false;
  const wanted =
    settings.enabled && tiles.length > 0 && (settings.mode === 'always' || gameOpen || forced);
  if (wanted) openWindow();
  else closeWindow();
  registerHotkey();
}

// ── Editing the place of the panel ───────────────────────────────────────────────────────────────────

/** Lets the mouse reach the overlay (to move and resize the panel), or hands it back to the game. */
function setEditing(on) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (editing === on) return;
  editing = on;
  overlayWindow.setFocusable(on);
  overlayWindow.setIgnoreMouseEvents(!on, { forward: true });
  if (on) overlayWindow.focus();
  else overlayWindow.blur();
  publish();
}

/**
 * The shortcut was pressed: it moves the panel (or ends moving it). If the overlay was waiting for a registered game
 * during a call, it opens it first, so the shortcut always shows something during a call.
 */
function onHotkey() {
  if (!overlayWindow && tiles.length > 0 && settings.enabled) {
    forced = true;
    sync();
    if (overlayWindow)
      overlayWindow.webContents.once('did-finish-load', setEditing.bind(null, true));
    return;
  }
  setEditing(!editing);
}

/** (Re)registers the shortcut of editing; it exists only while the overlay is on. */
function registerHotkey() {
  const wanted = settings.enabled ? settings.hotkey : '';
  if (registeredHotkey === wanted) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = '';
  hotkeyOk = true;
  if (wanted) {
    try {
      hotkeyOk = globalShortcut.register(wanted, onHotkey);
    } catch (error) {
      hotkeyOk = false;
    }
    if (hotkeyOk) registeredHotkey = wanted;
  }
}

// ── The commands ──────────────────────────────────────────────────────────────────────────────────────

/** ! True when the message comes from the main page of the app (not an embedded frame, not another window). */
function isMainPage(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const frame = event.senderFrame;
  return (
    event.sender === mainWindow.webContents &&
    Boolean(frame) &&
    frame === mainWindow.webContents.mainFrame &&
    isAppAddress(frame.url)
  );
}

/** True when the message comes from the overlay window itself. */
function isOverlay(event) {
  return Boolean(overlayWindow) && event.sender === overlayWindow.webContents;
}

/** The page asks which windows are open (to register a game from the list). */
async function handleWindows(event) {
  if (!isMainPage(event)) return [];
  try {
    return await openWindowNames();
  } catch (error) {
    return [];
  }
}

function handleGet(event) {
  return isMainPage(event) ? state() : null;
}

/** The page changes some choices (they are checked, kept and applied at once). */
function handleSet(event, patch) {
  if (!isMainPage(event)) return null;
  settings = sanitizeSettings(patch, settings);
  save();
  if (!settings.enabled) editing = false;
  sync();
  publish();
  return state();
}

/** The page tells who is in the call (an empty list: nobody to show, the window closes). */
function handleTiles(event, list) {
  if (!isMainPage(event)) return false;
  tiles = sanitizeTiles(list);
  sync();
  tellOverlay('overlay:tiles', tiles);
  return true;
}

/** The page sends a signalling message to the overlay window. */
function handleSignalToOverlay(event, message) {
  if (!isMainPage(event)) return false;
  const clean = sanitizeSignal(message);
  if (!clean) return false;
  tellOverlay('overlay:signal', clean);
  return true;
}

/** The overlay window sends a signalling message to the page. */
function handleSignalToPage(event, message) {
  if (!isOverlay(event)) return;
  const clean = sanitizeSignal(message);
  if (clean) tellPage({ type: 'signal', message: clean });
}

/** The overlay window says where the person left the panel (it is kept) and, when asked, that editing ended. */
function handleLayout(event, layout, finished) {
  if (!isOverlay(event)) return;
  settings = sanitizeSettings(
    {
      x: layout && layout.x,
      y: layout && layout.y,
      scale: layout && layout.scale,
    },
    settings,
  );
  save();
  if (finished === true) setEditing(false);
  else publish();
}

/** The person ended editing with the mouse (Esc or the button of the overlay). */
function handleStopEditing(event) {
  if (isOverlay(event)) setEditing(false);
}

/**
 * Opens the commands. `window` is the main window; `isAppAddressFn` tells whether an address belongs to the app. In tests
 * (`quietMode`) the window stays off screen and nothing is written to the disk.
 */
function start(window, isAppAddressFn, userDataPath, quietMode) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  userData = userDataPath;
  quiet = quietMode === true;
  settings = quiet ? { ...DEFAULTS } : load();
  ipcMain.handle('overlay:get', handleGet);
  ipcMain.handle('overlay:set', handleSet);
  ipcMain.handle('overlay:tiles', handleTiles);
  ipcMain.handle('overlay:windows', handleWindows);
  ipcMain.handle('overlay:signal', handleSignalToOverlay);
  ipcMain.on('overlay:signal-out', handleSignalToPage);
  ipcMain.on('overlay:layout', handleLayout);
  ipcMain.on('overlay:stop-editing', handleStopEditing);
  registerHotkey();
}

/** Leaves nothing registered on the system when the app closes. */
function stop() {
  clearInterval(watchTimer);
  globalShortcut.unregisterAll();
  closeWindow();
}

module.exports = {
  start,
  stop,
  sanitizeSettings,
  sanitizeTiles,
  sanitizeSignal,
  DEFAULTS,
};
