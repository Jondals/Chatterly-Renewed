/**
 * desktop/src/preload.cjs
 * The only things the web page can see of the desktop shell: a frozen object with two read-only facts, the commands
 * to update the app and, when the web app is bundled, the address of the API.
 *
 * ! This file is the whole attack surface between the page and the main process. The page gets NO generic IPC: only
 *   the four fixed update commands (no arguments) and one fixed channel to hear the state of the update. Do not add
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

// * The web app reads window.CHATTERLY_API before it starts (frontend/src/app/core/config.ts).
const apiOrigin = readApiOrigin();
if (apiOrigin) contextBridge.exposeInMainWorld('CHATTERLY_API', apiOrigin);

contextBridge.exposeInMainWorld(
  'chatterlyDesktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    updates: Object.freeze({ getState, check, download, install, onState }),
  }),
);
