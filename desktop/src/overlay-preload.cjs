/**
 * desktop/src/overlay-preload.cjs
 * The only things the overlay window can do: hear the choices, the people, the call, the messages that arrive and the signalling
 * of the local video connection from the main process, and send back its own signalling, the place where the person left the
 * widgets, a few choices of the editing bar (size, who is shown, names), one of the fixed actions of its buttons (the main process
 * takes them only while the overlay is unlocked) and "editing ended".
 * ! No generic IPC and no Node here (desktop/test/desktop.mjs checks the list).
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Calls `callback(payload)` each time the main process sends on `channel`. */
function listen(channel, callback) {
  if (typeof callback !== 'function') return;
  function relay(event, payload) {
    callback(payload);
  }
  ipcRenderer.on(channel, relay);
}

function onConfig(callback) {
  listen('overlay:config', callback);
}
function onTiles(callback) {
  listen('overlay:tiles', callback);
}
function onSignal(callback) {
  listen('overlay:signal', callback);
}
function onScene(callback) {
  listen('overlay:scene', callback);
}
function onNotice(callback) {
  listen('overlay:notice', callback);
}
function act(action) {
  ipcRenderer.send('overlay:action', action);
}
function signal(message) {
  ipcRenderer.send('overlay:signal-out', message);
}
function saveLayout(layout, finished) {
  ipcRenderer.send('overlay:layout', layout, finished === true);
}
function stopEditing() {
  ipcRenderer.send('overlay:stop-editing');
}
function choose(patch) {
  ipcRenderer.send('overlay:choose', patch);
}
function hover(over) {
  ipcRenderer.send('overlay:hover', over === true);
}

contextBridge.exposeInMainWorld(
  'chatterlyOverlay',
  Object.freeze({
    onConfig,
    onTiles,
    onSignal,
    onScene,
    onNotice,
    signal,
    saveLayout,
    stopEditing,
    choose,
    hover,
    act,
  }),
);
