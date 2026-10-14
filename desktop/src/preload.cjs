/**
 * desktop/src/preload.cjs
 * The only things the web page can see of the desktop shell: a frozen object with two read-only facts, the commands
 * to update the app and, when the web app is bundled, the address of the API.
 *
 * ! This file is the whole attack surface between the page and the main process. The page gets NO generic IPC: only
 *   the fixed update commands and the screen-share hint (each takes at most one argument, which the main process checks
 *   against a fixed list of values) and one fixed channel to hear the state of the update. Do not add
 *   channels or Node modules here without a security review. (desktop/test/desktop.mjs checks the list.)
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** The API address given by the main process (bundled mode only). Anything that is not an http(s) origin is ignored. */
function readApiOrigin() {
  const prefix = '--chatterly-api=';
  const arg = process.argv.find(function isApiArg(value) {
    return value.startsWith(prefix);
  });
  if (!arg) return null;
  try {
    const url = new URL(arg.slice(prefix.length));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch (error) {
    return null;
  }
}

function getState() {
  return ipcRenderer.invoke('updates:get');
}
function check() {
  return ipcRenderer.invoke('updates:check');
}
function download() {
  return ipcRenderer.invoke('updates:download');
}
function install() {
  return ipcRenderer.invoke('updates:install');
}
/** Changes how often it looks and whether it tells you. The main process accepts only its fixed list of values. */
function setSettings(settings) {
  return ipcRenderer.invoke('updates:settings', settings);
}

/** How the graphics card is used: read it, change it (a fixed list of values, checked by the main process) and restart. */
function getGraphics() {
  return ipcRenderer.invoke('graphics:get');
}
function setGraphics(choice) {
  return ipcRenderer.invoke('graphics:set', choice);
}
function restartForGraphics() {
  return ipcRenderer.invoke('graphics:restart');
}

/**
 * Tells the app what the person chose to share ('monitor', 'window', 'browser' or 'any') just before the capture, and whether
 * the sound box of the picker starts ticked.
 */
function setSurface(surface, audio) {
  return ipcRenderer.invoke('screen:surface', surface, audio === true);
}

/** The in-game overlay: its choices, the people to draw and the signalling of the local video connection. */
function getOverlay() {
  return ipcRenderer.invoke('overlay:get');
}
function setOverlay(patch) {
  return ipcRenderer.invoke('overlay:set', patch);
}
function setOverlayTiles(tiles) {
  return ipcRenderer.invoke('overlay:tiles', tiles);
}
function signalOverlay(message) {
  return ipcRenderer.invoke('overlay:signal', message);
}
/** Calls `callback(event)` for what the overlay says: a new state, the window being ready or closed, a signalling message. */
function onOverlayEvent(callback) {
  if (typeof callback !== 'function') return function noop() {};
  function listener(event, message) {
    callback(message);
  }
  ipcRenderer.on('overlay:event', listener);
  return function stop() {
    ipcRenderer.removeListener('overlay:event', listener);
  };
}

/** Calls `callback(state)` each time the update changes. Returns the function that stops listening. */
function onState(callback) {
  if (typeof callback !== 'function') return function noop() {};
  function listener(event, state) {
    callback(state);
  }
  ipcRenderer.on('updates:state', listener);
  return function stop() {
    ipcRenderer.removeListener('updates:state', listener);
  };
}

/** The height of the bar the app draws at the top of its window (given by the main process; null when there is none). */
function readTitlebarHeight() {
  const prefix = '--chatterly-titlebar=';
  const arg = process.argv.find(function isBarArg(value) {
    return value.startsWith(prefix);
  });
  const height = arg ? Number(arg.slice(prefix.length)) : 0;
  return Number.isInteger(height) && height >= 20 && height <= 64 ? height : null;
}

/** Tells the main process the colors of the bar, so the buttons of Windows match the theme. */
function setTitlebarColors(colors) {
  return ipcRenderer.invoke('window:titlebar', colors);
}

const titlebarHeight = readTitlebarHeight();

// * The web app reads window.CHATTERLY_API before it starts (frontend/src/app/core/config.ts).
const apiOrigin = readApiOrigin();
if (apiOrigin) contextBridge.exposeInMainWorld('CHATTERLY_API', apiOrigin);

contextBridge.exposeInMainWorld(
  'chatterlyDesktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    updates: Object.freeze({ getState, check, download, install, setSettings, onState }),
    screen: Object.freeze({ setSurface }),
    graphics: Object.freeze({ get: getGraphics, set: setGraphics, restart: restartForGraphics }),
    overlay: Object.freeze({
      get: getOverlay,
      set: setOverlay,
      setTiles: setOverlayTiles,
      signal: signalOverlay,
      onEvent: onOverlayEvent,
    }),
    ...(titlebarHeight
      ? { titlebar: Object.freeze({ height: titlebarHeight, setColors: setTitlebarColors }) }
      : {}),
  }),
);
