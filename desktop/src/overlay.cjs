/**
 * desktop/src/overlay.cjs
 * The overlay, like the one of Discord: widgets drawn in a transparent window that stays on top of the other windows,
 * so you see your call while you play. Desktop app only.
 *
 * * The widgets: the call controls (microphone, headphones, camera, screen, hang up), the people of the voice channel (who
 *   talks, who is muted, who is live), the cameras, the activity (the registered game that is open and for how long), the
 *   screens other people share (with their volume) and the messages that arrive. Each one has its place on the screen, and a
 *   pin: a pinned widget stays visible while you play; the others only appear while the overlay is unlocked.
 * * How it works: a window as big as the chosen screen, transparent, without frame, always on top at the highest level,
 *   that never takes the focus and lets the mouse go through. It is one more window of the app (same sandbox, no Node):
 *   it does not read, hook or change the game, so there is nothing for an anti-cheat to flag. It shows over games in
 *   windowed or borderless mode; a game in "exclusive full screen" owns the monitor and nothing can be drawn over it.
 * * The video: a MediaStream cannot be handed to another window, so the page of the app and the overlay talk through a
 *   WebRTC connection that never leaves the computer (no STUN, no TURN, no network). This file only RELAYS its signalling
 *   messages between the two windows; the frames are already decrypted in the page, travel inside the computer and stop there.
 * * Which games: the person can register the windows (games) that should use it. While the overlay is set to "only with my
 *   games", it opens when a window whose name contains one of the registered names is open (the list of open windows is read
 *   every few seconds, without pictures: Electron cannot tell which window has the focus). The same reading feeds the activity.
 * * Unlocking (the shortcut, Ctrl+Shift+O by default): the screen dims, the mouse reaches the overlay, every widget shows with
 *   its title and its pin, they can be dragged, and the buttons of the controls work. A click on the dimmed area, the cross,
 *   Esc or the shortcut again lock it and give the mouse back to the game. Going back to the window of Chatterly locks it too.
 * * The choices are kept in overlay.json in the profile folder and are checked on every read and write.
 * ! Only the main page of the app may use the commands, and only fixed shapes are accepted (see sanitize*): a page that lies
 *   can draw its own names and pictures in the overlay and nothing else. The overlay can only ask the page for one of a fixed
 *   list of actions, and only while it is unlocked (the person is there, with the mouse on it).
 */
'use strict';

const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  session,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The page of the overlay is served by its own scheme, not by file://. ! In the installed app the files live inside app.asar and
 * the fuse that takes the extra privileges from file:// (see package.json) also stops it from reading inside an asar: the window
 * got ERR_FILE_NOT_FOUND, stayed blank and still took the mouse. Only these three files are served, read by this process.
 */
const PAGE_SCHEME = 'chatterly-overlay';
const PAGE_URL = PAGE_SCHEME + '://page/overlay.html';
const PAGE_FILES = {
  '/overlay.html': 'text/html; charset=utf-8',
  '/overlay.css': 'text/css; charset=utf-8',
  '/overlay.js': 'text/javascript; charset=utf-8',
};

/** The widgets, where they start (fractions of the screen) and whether they stay visible while you play. */
const WIDGETS = {
  notifications: { x: 0.02, y: 0.03, pinned: true },
  voice: { x: 0.02, y: 0.24, pinned: true },
  controls: { x: 0.36, y: 0.8, pinned: true },
  activity: { x: 0.8, y: 0.44, pinned: false },
  streams: { x: 0.8, y: 0.6, pinned: true },
};
const WIDGET_IDS = Object.keys(WIDGETS).concat('video');

const DEFAULTS = {
  // On by default, like the overlay of Discord: it only appears during a call.
  enabled: true,
  hotkey: 'CommandOrControl+Shift+O',
  size: 'medium',
  opacity: 100,
  onlySpeaking: false,
  // You see your own camera too (with nobody else's camera on, the video widget was empty and "my camera" seemed broken).
  showSelf: true,
  showNames: true,
  // The text of a message that arrives (off: only who wrote it).
  notifyText: true,
  // ! Off by default: on Windows, excluding the transparent overlay window from captures could leave it invisible on the
  //   screen too (a window that took the clicks and showed nothing). The person can still turn it on.
  hideFromCapture: false,
  display: 'primary',
  // How the cameras are laid out in the video widget (changed with a right click on it while unlocked).
  videoLayout: 'vertical',
  mode: 'always',
  games: [],
  // The place and size of the video widget (they were the place of the only panel before the widgets).
  x: 0.02,
  y: 0.42,
  scale: 1,
  videoPinned: true,
  widgets: WIDGETS,
};
const SIZES = ['small', 'medium', 'large'];
const VIDEO_LAYOUTS = ['vertical', 'horizontal'];
const DISPLAYS = ['primary', 'app'];
/** When it shows: during every call, or only while one of the registered games is open. */
const MODES = ['always', 'games'];
const MAX_GAMES = 30;
/** The biggest the cameras can be made (times their size); the overlay page also keeps them inside the screen. */
const MAX_SCALE = 4;
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
/** The version of overlay.json. Files of an older version get "hide from captures" off once (see DEFAULTS), and from
 *  before the widgets they also get "show me" on and the video widget at its new place. */
const FILE_VERSION = 4;
const MAX_STREAMS = 8;
const MAX_TEXT = 140;
/** What the overlay may ask the page to do (only while it is unlocked). */
const ACTIONS = ['mute', 'deafen', 'camera', 'screen', 'leave', 'open-chat', 'stream-volume'];
/** The buttons of the controls: they work while you play, with the mouse over them, without unlocking the overlay. */
const CONTROL_ACTIONS = ['mute', 'deafen', 'camera', 'screen', 'leave'];

let settings = { ...DEFAULTS };
let mainWindow = null;
let isAppAddress = null;
let userData = '';
let quiet = false;
let overlayWindow = null;
let editing = false;
/** The mouse is over the controls of the call (then the window takes the mouse for them, still without taking the focus). */
let hoverControls = false;
/** Where the controls are in the window (CSS pixels), told by the page; null when they are not shown. */
let controlsRect = null;
/** The timer that compares the cursor with controlsRect (only runs while the overlay window exists). */
let cursorTimer = null;
/** How often the cursor is compared (ms). */
const CURSOR_EVERY_MS = 50;
let hotkeyOk = true;
let registeredHotkey = '';
let tiles = [];
/** The call as the controls draw it, and the screens other people share. */
let callInfo = null;
let streams = [];
let gameOpen = false;
/** The registered game that is open (its registered name) and since when, for the activity widget. */
let activity = null;
/** The person pressed the shortcut while the overlay waited for a game: it stays open until the call ends. */
let forced = false;
/** The person pressed the shortcut with nothing to show (no call): the overlay is open on its own until they lock it. */
let summoned = false;
let watchTimer = null;
/** Safety net: the overlay page says it is alive every second; while unlocked (it holds the mouse) a silence means it is stuck. */
let lastAlive = 0;
let aliveTimer = null;
/** When the overlay was last rebuilt after a failure (ms), so a window that fails again and again is not rebuilt in a loop. */
const recoveries = [];
const ALIVE_EVERY_MS = 2000;
const ALIVE_LIMIT_MS = 6000;
const MAX_RECOVERIES = 3;
/** Esc is taken from the system while the overlay is unlocked (see setEscape). */
let escapeRegistered = false;
/** Brings the main window to the front (given by main.cjs). */
let showMain = null;

/** The scheme of the page, to be registered (before the app is ready) together with the others: see bundle.registerScheme. */
const PAGE_SCHEME_ENTRY = { scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } };

/** Answers the requests of the overlay page: its html, css and script, nothing else. */
async function servePage(request) {
  const url = new URL(request.url);
  const type = url.hostname === 'page' ? PAGE_FILES[url.pathname] : undefined;
  if (!type || request.method !== 'GET') return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(path.join(__dirname, url.pathname.slice(1)));
    return new Response(body, {
      headers: { 'content-type': type, 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    return new Response('Not found', { status: 404 });
  }
}

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
  for (const key of [
    'enabled',
    'onlySpeaking',
    'showSelf',
    'showNames',
    'hideFromCapture',
    'notifyText',
    'videoPinned',
  ]) {
    if (typeof wanted[key] === 'boolean') next[key] = wanted[key];
  }
  if (typeof wanted.hotkey === 'string' && HOTKEY.test(wanted.hotkey)) next.hotkey = wanted.hotkey;
  if (SIZES.includes(wanted.size)) next.size = wanted.size;
  if (DISPLAYS.includes(wanted.display)) next.display = wanted.display;
  if (VIDEO_LAYOUTS.includes(wanted.videoLayout)) next.videoLayout = wanted.videoLayout;
  if (MODES.includes(wanted.mode)) next.mode = wanted.mode;
  if (Array.isArray(wanted.games)) next.games = cleanGames(wanted.games);
  next.opacity = Math.round(clamp(wanted.opacity, 30, 100, next.opacity));
  next.x = clamp(wanted.x, 0, 1, next.x);
  next.y = clamp(wanted.y, 0, 1, next.y);
  next.scale = clamp(wanted.scale, 0.5, MAX_SCALE, next.scale);
  next.widgets = cleanWidgets(wanted.widgets, next.widgets || WIDGETS);
  return next;
}

/** The places and pins of the widgets: only the known ones, each with numbers inside the screen and a yes/no pin. */
function cleanWidgets(raw, base) {
  const wanted = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = {};
  for (const id of Object.keys(WIDGETS)) {
    const from = base[id] || WIDGETS[id];
    const item = wanted[id] && typeof wanted[id] === 'object' ? wanted[id] : {};
    next[id] = {
      x: clamp(item.x, 0, 1, from.x),
      y: clamp(item.y, 0, 1, from.y),
      pinned: typeof item.pinned === 'boolean' ? item.pinned : from.pinned,
    };
  }
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
    const raw = JSON.parse(fs.readFileSync(fileOf(), 'utf8'));
    const loaded = sanitizeSettings(raw, DEFAULTS);
    if (!raw || !(raw.version >= 4)) {
      // The controls of the call are shown (and can be pressed) while you play: they were only there while unlocked.
      loaded.widgets = { ...loaded.widgets, controls: { ...loaded.widgets.controls, pinned: true } };
    }
    if (!raw || raw.version !== FILE_VERSION) {
      if (!raw || !(raw.version >= 3)) loaded.hideFromCapture = false;
      if (!raw || !(raw.version >= 3)) {
        loaded.showSelf = true;
        loaded.x = DEFAULTS.x;
        loaded.y = DEFAULTS.y;
      }
    }
    return loaded;
  } catch (error) {
    return { ...DEFAULTS };
  }
}

/** Keeps the choices. */
function save() {
  if (quiet) return;
  try {
    fs.writeFileSync(fileOf(), JSON.stringify({ ...settings, version: FILE_VERSION }), 'utf8');
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
      deafened: item.deafened === true,
      camera: item.camera === true,
      screen: item.screen === true,
      streamId: typeof item.streamId === 'string' ? item.streamId.slice(0, 80) : '',
    });
  }
  return clean;
}

/** A short text without control characters. */
function cleanText(value, max) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)
    : '';
}

/** The call as the controls draw it: its name, how long it lasts and the state of the buttons. Yes/no flags and short texts. */
function sanitizeCall(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    room: cleanText(raw.room, 60),
    since: clamp(raw.since, 0, Number.MAX_SAFE_INTEGER, 0),
    muted: raw.muted === true,
    deafened: raw.deafened === true,
    camera: raw.camera === true,
    screen: raw.screen === true,
    video: raw.video === true,
    ping: Math.round(clamp(raw.ping, -1, 99999, -1)),
  };
}

/** The screens other people share: who, the id of the stream on the local connection, whether it has sound and its volume. */
function sanitizeStreams(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  for (const item of raw.slice(0, MAX_STREAMS)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    clean.push({
      id: item.id.slice(0, 64),
      name: cleanText(item.name, 40),
      streamId: typeof item.streamId === 'string' ? item.streamId.slice(0, 80) : '',
      sound: item.sound === true,
      volume: Math.round(clamp(item.volume, 0, 200, 100)),
    });
  }
  return clean;
}

/** A message that arrived: who (name, picture, color), where and what it says (short), and an id to open it. */
function sanitizeNotice(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const avatar =
    typeof raw.avatar === 'string' &&
    raw.avatar.length <= MAX_AVATAR_CHARS &&
    AVATAR.test(raw.avatar)
      ? raw.avatar
      : '';
  return {
    id: raw.id.slice(0, 40),
    name: cleanText(raw.name, 40),
    where: cleanText(raw.where, 40),
    text: settings.notifyText ? cleanText(raw.text, MAX_TEXT) : '',
    avatar,
    color: typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : '#2ef2b0',
  };
}

/** An action the overlay asks for: one of ACTIONS, with an id (a notice, a person) or a volume when it needs one. */
function sanitizeAction(raw) {
  if (!raw || typeof raw !== 'object' || !ACTIONS.includes(raw.type)) return null;
  const action = { type: raw.type };
  if (raw.type === 'open-chat') {
    if (typeof raw.id !== 'string' || raw.id.length > 40) return null;
    action.id = raw.id;
  }
  if (raw.type === 'stream-volume') {
    if (typeof raw.id !== 'string' || raw.id.length > 64) return null;
    action.id = raw.id;
    action.volume = Math.round(clamp(raw.volume, 0, 200, 100));
  }
  return action;
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

/** The texts of the overlay, in the language of the system (Spanish or English). */
function labelsFor(spanish, keys) {
  return spanish
    ? {
        title: 'Overlay de Chatterly',
        small: 'Pequeño',
        medium: 'Mediano',
        large: 'Grande',
        onlySpeaking: 'Solo quien habla',
        showNames: 'Nombres',
        done: 'Cerrar',
        hint:
          'Arrastra los widgets · fija los que quieras ver jugando · ' +
          keys +
          ', Esc o un clic fuera para volver al juego',
        toast: 'Overlay de Chatterly activo · ' + keys + ' para desbloquearlo',
        layoutVertical: 'Cámaras en vertical',
        layoutHorizontal: 'Cámaras en horizontal',
        pin: 'Fijar: se ve mientras juegas',
        unpin: 'Fijado: pulsa para que solo se vea aquí',
        widgets: {
          notifications: 'Notificaciones',
          voice: 'Voz',
          video: 'Vídeo',
          controls: 'Llamada',
          activity: 'Actividad',
          streams: 'Transmisiones',
        },
        empty: {
          notifications: 'Aquí aparecen los mensajes que te lleguen',
          voice: 'Nadie en la llamada',
          video: 'Ninguna cámara encendida',
          activity: 'Registra tu juego en Ajustes > Overlay',
          streams: 'Nadie comparte su pantalla',
        },
        playing: 'Jugando',
        live: 'EN DIRECTO',
        reply: 'Pulsa aquí o ' + keys + ' para responder',
        voiceConnected: 'Voz conectada',
        videoConnected: 'Vídeo conectado',
        mute: 'Silenciar',
        unmute: 'Activar micrófono',
        deafen: 'Ensordecer',
        undeafen: 'Dejar de ensordecer',
        cameraOn: 'Encender la cámara',
        cameraOff: 'Apagar la cámara',
        screenOn: 'Compartir pantalla',
        screenOff: 'Dejar de compartir',
        leave: 'Colgar',
        volume: 'Volumen',
      }
    : {
        title: 'Chatterly overlay',
        small: 'Small',
        medium: 'Medium',
        large: 'Large',
        onlySpeaking: 'Only who talks',
        showNames: 'Names',
        done: 'Close',
        hint:
          'Drag the widgets · pin the ones you want while you play · ' +
          keys +
          ', Esc or a click outside to go back to the game',
        toast: 'Chatterly overlay is on · ' + keys + ' to unlock it',
        layoutVertical: 'Cameras stacked',
        layoutHorizontal: 'Cameras side by side',
        pin: 'Pin: it shows while you play',
        unpin: 'Pinned: press so it only shows here',
        widgets: {
          notifications: 'Notifications',
          voice: 'Voice',
          video: 'Video',
          controls: 'Call',
          activity: 'Activity',
          streams: 'Streams',
        },
        empty: {
          notifications: 'Messages you get show up here',
          voice: 'Nobody in the call',
          video: 'No camera is on',
          activity: 'Register your game in Settings > Overlay',
          streams: 'Nobody is sharing their screen',
        },
        playing: 'Playing',
        live: 'LIVE',
        reply: 'Click here or ' + keys + ' to reply',
        voiceConnected: 'Voice connected',
        videoConnected: 'Video connected',
        mute: 'Mute',
        unmute: 'Unmute',
        deafen: 'Deafen',
        undeafen: 'Undeafen',
        cameraOn: 'Turn camera on',
        cameraOff: 'Turn camera off',
        screenOn: 'Share your screen',
        screenOff: 'Stop sharing',
        leave: 'Hang up',
        volume: 'Volume',
      };
}

/** The choices the overlay window needs to draw. */
function viewConfig() {
  const spanish = String(app.getLocale() || 'en').slice(0, 2) === 'es';
  const keys = settings.hotkey.replace('CommandOrControl', 'Ctrl');
  const labels = labelsFor(spanish, keys);
  return {
    ...settings,
    editing,
    toast: labels.toast,
    hint: labels.hint,
    labels,
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

/** Sends the call, the streams and the activity to the overlay window. */
function publishScene() {
  tellOverlay('overlay:scene', { call: callInfo, streams, activity });
}

// ── The window ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lets the mouse go through the window to the game (or not, while unlocked). ! Said again after the window is shown and
 * after every change of its size: Windows can drop the "transparent to the mouse" style of a layered window when it is
 * shown or resized, and then the overlay kept every click of the game.
 */
function applyMouse() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(!(editing || hoverControls));
}

/** Opens the overlay window (transparent, on top, click-through, never taking the focus). */
function openWindow() {
  if (overlayWindow) return;
  const bounds = targetDisplay().bounds;
  overlayWindow = new BrowserWindow({
    ...bounds,
    ...(quiet ? { x: -32000, y: -32000 } : {}),
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
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
    title: 'Chatterly overlay',
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
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(settings.hideFromCapture);
  win.webContents.on('did-finish-load', onOverlayLoaded);
  win.once('ready-to-show', win.showInactive.bind(win));
  // ! If the window never says it is ready (a transparent window can stay unpainted on some graphics drivers), it is shown anyway.
  setTimeout(showIfHidden.bind(null, win), 1500);
  win.on('show', applyMouse);
  win.on('show', kickPainting.bind(null, win));
  win.on('resize', applyMouse);
  win.on('closed', onOverlayClosed);
  // Never keeps the focus: if something gives it to the overlay (outside the editing mode), it goes straight back to the game.
  win.on('focus', onOverlayFocus);
  // ! The title of the page must not rename the window: the screen picker and the list of games leave it out by this name.
  win.on('page-title-updated', preventDefault);
  // ! If the page of the overlay dies, hangs or does not load, the window is thrown away and rebuilt: an overlay that is
  //   stuck while it holds the mouse leaves the person with a screen they cannot click.
  win.webContents.on('render-process-gone', recoverOverlay);
  win.webContents.on('did-fail-load', onOverlayLoadFailed);
  win.on('unresponsive', recoverOverlay);
  lastAlive = Date.now();
  clearInterval(aliveTimer);
  aliveTimer = setInterval(checkAlive, ALIVE_EVERY_MS);
  win.loadURL(PAGE_URL);
}

/** The page of the overlay did not load (the address changed, a file is missing): same as a page that died. */
function onOverlayLoadFailed(event, code, description, address, isMainFrame) {
  // -3 is "aborted": a new load replaced this one, not a failure.
  if (isMainFrame === true && code !== -3) recoverOverlay();
}

/** The page of the overlay says it is alive. */
function handleAlive(event) {
  if (isOverlay(event)) lastAlive = Date.now();
}

/** While unlocked, a page that has not answered for a while is stuck: it is rebuilt. */
function checkAlive() {
  if (editing && Date.now() - lastAlive > ALIVE_LIMIT_MS) recoverOverlay();
}

/**
 * Gives the mouse back at once and rebuilds the overlay window (it opens again by itself when it should). At most MAX_RECOVERIES
 * times a minute: past that it stays closed rather than flickering forever.
 */
function recoverOverlay() {
  editing = false;
  hoverControls = false;
  summoned = false;
  setEscape(false);
  const window = overlayWindow;
  if (window && !window.isDestroyed()) {
    try {
      window.setIgnoreMouseEvents(true);
    } catch (error) {
      // The window is already going away.
    }
    window.destroy();
  }
  const now = Date.now();
  while (recoveries.length > 0 && now - recoveries[0] > 60000) recoveries.shift();
  if (recoveries.length >= MAX_RECOVERIES) return;
  recoveries.push(now);
  setTimeout(sync, 800);
}

/**
 * ! A transparent window that never takes the focus can stay blank on Windows after it is shown: the page is drawn (it is there, and
 * the screen would show it) but the system never puts it on the screen until the window changes. So, once shown, the window is
 * made one pixel wider and back, the page is told to paint again and the window goes to the top: the same thing moving it would do.
 */
function kickPainting(win) {
  for (const wait of [60, 400, 1200]) setTimeout(repaint.bind(null, win), wait);
}

function repaint(win) {
  if (win.isDestroyed() || !win.isVisible() || quiet) return;
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, width: bounds.width + 1 });
  win.setBounds(bounds);
  win.webContents.invalidate();
  win.moveTop();
  applyMouse();
}

/** Shows a window that is still hidden (see openWindow). */
function showIfHidden(win) {
  if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
}

function preventDefault(event) {
  event.preventDefault();
}

/** The overlay got the focus without the person asking for it (editing): hand it back. */
function onOverlayFocus() {
  if (!editing && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.blur();
}

/** The overlay page is ready: give it the choices and the people, and ask the app page to send the video. */
function onOverlayLoaded() {
  tellOverlay('overlay:config', viewConfig());
  tellOverlay('overlay:tiles', tiles);
  publishScene();
  tellPage({ type: 'ready' });
  tellPage({ type: 'state', state: state() });
}

/** The overlay window is gone (closed by us, or by the system). */
function onOverlayClosed() {
  clearInterval(aliveTimer);
  overlayWindow = null;
  setEscape(false);
  editing = false;
  hoverControls = false;
  tellPage({ type: 'closed' });
  tellPage({ type: 'state', state: state() });
}

/** Closes the overlay window. */
function closeWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
}

/** The media source id of the overlay window (the screen picker leaves it out), or ''. */
function mediaSourceId() {
  try {
    return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getMediaSourceId() : '';
  } catch (error) {
    return '';
  }
}

/** Names of the windows that are open now (without the ones of Chatterly itself). */
async function openWindowNames() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const names = [];
  const own = mediaSourceId();
  for (const source of sources) {
    const name = String(source.name || '').trim();
    if (source.id === own) continue;
    if (name === '' || name === 'Chatterly' || name.startsWith('Chatterly overlay')) continue;
    if (!names.includes(name)) names.push(name.slice(0, 120));
  }
  return names.slice(0, 100);
}

/** The registered game that has a window open (its registered name), or ''. */
function gameIn(names) {
  for (const game of settings.games) {
    const wanted = game.toLowerCase();
    if (
      names.some(function hasGame(name) {
        return name.toLowerCase().includes(wanted);
      })
    ) {
      return game;
    }
  }
  return '';
}

/**
 * Looks at the open windows: opens or closes the overlay if a registered game appeared or went away, and keeps the activity
 * (which game, since when) for its widget.
 */
async function watchGames() {
  let game = '';
  try {
    game = gameIn(await openWindowNames());
  } catch (error) {
    game = '';
  }
  const known = activity ? activity.name : '';
  if (game !== known) {
    activity = game ? { name: game, since: Date.now() } : null;
    publishScene();
  }
  const open = game !== '';
  if (open !== gameOpen) {
    gameOpen = open;
    sync();
  }
}

/**
 * Reads the open windows now and then, only during a call with registered games: to wait for a game (mode "only with my
 * games") and to show the activity.
 */
function updateWatch() {
  // In "only with my games" the open windows are read also outside a call: the shortcut only works while one of them is open.
  const needed =
    settings.enabled &&
    settings.games.length > 0 &&
    (tiles.length > 0 || settings.mode === 'games');
  if (needed && !watchTimer) {
    watchTimer = setInterval(watchGames, WATCH_MS);
    void watchGames();
  } else if (!needed && watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
    gameOpen = false;
    activity = null;
  }
}

/** Opens or closes the window to match: it exists while the overlay is on, there are people to show and (if it waits for a game) one is open. */
function sync() {
  updateWatch();
  if (tiles.length === 0) forced = false;
  const wanted =
    settings.enabled &&
    (summoned || (tiles.length > 0 && (settings.mode === 'always' || gameOpen || forced)));
  if (wanted) openWindow();
  else closeWindow();
  registerHotkey();
}

// ── Unlocking (editing the widgets) ─────────────────────────────────────────────────────────────────

/**
 * Esc locks the overlay again while it is unlocked, even when Windows did not let it take the keyboard (a game in front keeps
 * the foreground): the key is taken from the system only while unlocked.
 */
function setEscape(on) {
  try {
    if (on && !escapeRegistered) {
      escapeRegistered = globalShortcut.register('Escape', setEditing.bind(null, false));
    } else if (!on && escapeRegistered) {
      globalShortcut.unregister('Escape');
      escapeRegistered = false;
    }
  } catch (error) {
    escapeRegistered = false;
  }
}

/** Lets the mouse reach the overlay (to move the widgets and use the controls), or hands it back to the game. */
function setEditing(on) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (editing === on) return;
  editing = on;
  hoverControls = false;
  overlayWindow.setFocusable(on);
  applyMouse();
  setEscape(on);
  if (on) overlayWindow.focus();
  else overlayWindow.blur();
  publish();
  // Locked again: an overlay that was opened by the shortcut with nothing else to show goes away.
  if (!on && summoned) {
    summoned = false;
    sync();
  }
}

/**
 * The shortcut was pressed: it opens the overlay and unlocks it, at any time (in a call or not, in a game or not), and the next
 * press locks it again. If the overlay was waiting for a registered game during a call, this opens it too.
 */
function onHotkey() {
  // ! "Only with my games": the shortcut does nothing while none of them is open.
  if (!overlayWindow && settings.enabled && settings.mode === 'games' && !gameOpen) return;
  if (!overlayWindow && settings.enabled) {
    if (tiles.length > 0) forced = true;
    else summoned = true;
    sync();
    if (overlayWindow)
      overlayWindow.webContents.once('did-finish-load', setEditing.bind(null, true));
    return;
  }
  setEditing(!editing);
}

/** The person went back to the window of Chatterly: the overlay locks (it must never keep the mouse behind their back). */
function onMainFocus() {
  setEditing(false);
}

/** The main page died or stopped answering: the overlay locks (the mouse goes back to whatever is under it). */
function onMainGone() {
  setEditing(false);
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
  if (!settings.enabled) {
    setEscape(false);
    editing = false;
  }
  sync();
  publish();
  return state();
}

/** The page tells who is in the call (an empty list: nobody to show, the window closes). */
function handleTiles(event, list) {
  if (!isMainPage(event)) return false;
  tiles = sanitizeTiles(list);
  if (tiles.length === 0) {
    callInfo = null;
    streams = [];
  }
  sync();
  tellOverlay('overlay:tiles', tiles);
  return true;
}

/** The page tells the state of the call (for the controls) and the screens other people share. */
function handleCall(event, payload) {
  if (!isMainPage(event) || !payload || typeof payload !== 'object') return false;
  callInfo = sanitizeCall(payload.call);
  streams = sanitizeStreams(payload.streams);
  publishScene();
  return true;
}

/** The page tells that a message arrived (the overlay shows it for a few seconds). */
function handleNotify(event, notice) {
  if (!isMainPage(event)) return false;
  const clean = sanitizeNotice(notice);
  if (!clean || !overlayWindow) return false;
  tellOverlay('overlay:notice', clean);
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

/** The overlay window says where the person left the widgets (it is kept) and, when asked, that editing ended. */
function handleLayout(event, layout, finished) {
  if (!isOverlay(event)) return;
  const raw = layout && typeof layout === 'object' ? layout : {};
  settings = sanitizeSettings(
    {
      x: raw.x,
      y: raw.y,
      scale: raw.scale,
      videoPinned: raw.videoPinned,
      widgets: raw.widgets,
    },
    settings,
  );
  save();
  if (finished === true) setEditing(false);
  else publish();
}

/** The person changed a choice from the overlay while editing (only the size, who is shown, the names and the layout of the cameras). */
function handleChoose(event, patch) {
  if (!isOverlay(event) || !editing || !patch || typeof patch !== 'object') return;
  settings = sanitizeSettings(
    {
      size: patch.size,
      onlySpeaking: patch.onlySpeaking,
      showNames: patch.showNames,
      videoLayout: patch.videoLayout,
    },
    settings,
  );
  save();
  publish();
}

/**
 * A button of the overlay was pressed (a control of the call, a message to open, the volume of a stream). ! Only while it is
 * unlocked (the mouse can reach it only then, so the person is the one who pressed), only one of ACTIONS, and the page does it
 * as if it was pressed in the app. Opening a chat or sharing the screen brings the window of Chatterly to the front.
 */
function handleAction(event, raw) {
  if (!isOverlay(event)) return;
  const action = sanitizeAction(raw);
  if (!action) return;
  // Locked: only the buttons of the controls, and only while the mouse is over them.
  if (!editing && !(hoverControls && CONTROL_ACTIONS.includes(action.type))) return;
  if (action.type === 'open-chat' || (action.type === 'screen' && !(callInfo && callInfo.screen))) {
    setEditing(false);
    if (showMain) showMain();
  }
  tellPage({ type: 'action', action });
}

/** The old way of the page to say the mouse is over the controls: ignored now (the cursor is compared here, see watchCursor). */
function handleHover() {}

/**
 * The page says where its controls are. The window is click-through and never asks the system for the mouse moves (the forwarding
 * of mouse moves over a whole screen made the mouse of the games behave oddly): the cursor is read here instead and compared with
 * that rectangle, and only while it is over them does the window take the mouse.
 */
function handleControlsRect(event, rect) {
  if (!isOverlay(event)) return;
  const valid =
    rect &&
    [rect.x, rect.y, rect.width, rect.height].every(function finite(value) {
      return typeof value === 'number' && Number.isFinite(value);
    });
  controlsRect = valid ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  if (controlsRect && !cursorTimer) cursorTimer = setInterval(watchCursor, CURSOR_EVERY_MS);
  watchCursor();
}

/** Compares the cursor with the controls: the window takes the mouse only while it is over them (never while editing: it has it all). */
function watchCursor() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible() || !controlsRect) {
    if (cursorTimer && (!overlayWindow || overlayWindow.isDestroyed() || !controlsRect)) {
      clearInterval(cursorTimer);
      cursorTimer = null;
    }
    if (hoverControls && !editing) {
      hoverControls = false;
      applyMouse();
    }
    return;
  }
  if (editing) return;
  const point = screen.getCursorScreenPoint();
  const bounds = overlayWindow.getBounds();
  const margin = 3;
  const over =
    point.x >= bounds.x + controlsRect.x - margin &&
    point.x <= bounds.x + controlsRect.x + controlsRect.width + margin &&
    point.y >= bounds.y + controlsRect.y - margin &&
    point.y <= bounds.y + controlsRect.y + controlsRect.height + margin;
  if (over !== hoverControls) {
    hoverControls = over;
    applyMouse();
  }
}

/** The person ended editing with the mouse (a click outside, Esc or the button of the overlay). */
function handleStopEditing(event) {
  if (isOverlay(event)) setEditing(false);
}

/**
 * Opens the commands. `window` is the main window; `isAppAddressFn` tells whether an address belongs to the app;
 * `showMainFn` brings the main window to the front. In tests (`quietMode`) the window stays off screen and nothing is
 * written to the disk.
 */
function start(window, isAppAddressFn, userDataPath, quietMode, showMainFn) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  userData = userDataPath;
  quiet = quietMode === true;
  showMain = typeof showMainFn === 'function' ? showMainFn : null;
  settings = quiet ? { ...DEFAULTS } : load();
  if (!session.defaultSession.protocol.isProtocolHandled(PAGE_SCHEME))
    session.defaultSession.protocol.handle(PAGE_SCHEME, servePage);
  ipcMain.handle('overlay:get', handleGet);
  ipcMain.handle('overlay:set', handleSet);
  ipcMain.handle('overlay:tiles', handleTiles);
  ipcMain.handle('overlay:call', handleCall);
  ipcMain.handle('overlay:notify', handleNotify);
  ipcMain.handle('overlay:windows', handleWindows);
  ipcMain.handle('overlay:signal', handleSignalToOverlay);
  ipcMain.on('overlay:signal-out', handleSignalToPage);
  ipcMain.on('overlay:layout', handleLayout);
  ipcMain.on('overlay:stop-editing', handleStopEditing);
  ipcMain.on('overlay:choose', handleChoose);
  ipcMain.on('overlay:action', handleAction);
  ipcMain.on('overlay:hover', handleHover);
  ipcMain.on('overlay:controls-rect', handleControlsRect);
  ipcMain.on('overlay:alive', handleAlive);
  if (mainWindow) {
    mainWindow.on('focus', onMainFocus);
    // The app page itself died or hung: the overlay must not keep the mouse for a page that can no longer answer it.
    mainWindow.webContents.on('render-process-gone', onMainGone);
    mainWindow.on('unresponsive', onMainGone);
  }
  registerHotkey();
}

/** Leaves nothing registered on the system when the app closes. */
function stop() {
  clearInterval(watchTimer);
  clearInterval(aliveTimer);
  globalShortcut.unregisterAll();
  closeWindow();
}

module.exports = {
  PAGE_SCHEME_ENTRY,
  start,
  stop,
  mediaSourceId,
  sanitizeSettings,
  sanitizeTiles,
  sanitizeSignal,
  sanitizeCall,
  sanitizeStreams,
  sanitizeNotice,
  sanitizeAction,
  DEFAULTS,
};
