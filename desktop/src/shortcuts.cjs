/**
 * desktop/src/shortcuts.cjs
 * The shortcuts of the call (mute, deafen, camera, screen, hang up) that work while Chatterly is NOT the window in front, for
 * example while you play. A page only receives keys while it has the focus, so the shell takes them from the system instead and
 * tells the page which action was pressed. The page does it as if the person had pressed its button.
 * * They are taken only while there is a call: the page sends an empty list the rest of the time, so no key of yours is
 *   held back from other programs when there is nothing to do with it.
 * ! Only the main page may set them, only the five actions below are accepted and a combination must be modifiers + a known key
 *   (or an F key alone): a page that lies can only press its own call buttons.
 */
'use strict';

const { globalShortcut, ipcMain } = require('electron');

/** The actions that can have a global shortcut. */
const ACTIONS = ['mute', 'deafen', 'camera', 'screen', 'hangup'];

const MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };
/** Keys written as the page does (the code of the key) and as Electron wants them. */
const NAMED_KEYS = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
};

let mainWindow = null;
let isAppAddress = null;
/** The accelerators this module holds, by action. */
let held = new Map();

/** "Ctrl+Alt+M" (how the page writes it) into "Control+Alt+M" (how Electron wants it), or '' when it is not acceptable. */
function accelerator(combo) {
  if (typeof combo !== 'string' || combo.length > 40) return '';
  const parts = combo.split('+');
  const key = parts.pop();
  let named = '';
  if (/^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key)) named = key;
  else if (Object.prototype.hasOwnProperty.call(NAMED_KEYS, key)) named = NAMED_KEYS[key];
  if (!named) return '';
  const modifiers = [];
  for (const part of parts) {
    if (
      !Object.prototype.hasOwnProperty.call(MODIFIERS, part) ||
      modifiers.includes(MODIFIERS[part])
    )
      return '';
    modifiers.push(MODIFIERS[part]);
  }
  // A letter or a key alone would be taken from every program: it needs a modifier (an F key may go alone).
  if (modifiers.length === 0 && !/^F\d+$/.test(named)) return '';
  return modifiers.concat(named).join('+');
}

/** The list the page sent, as { action: accelerator } with only valid entries and no repeated accelerator. */
function sanitize(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  const used = new Set();
  for (const action of ACTIONS) {
    const wanted = accelerator(raw[action]);
    if (wanted === '' || used.has(wanted)) continue;
    used.add(wanted);
    clean[action] = wanted;
  }
  return clean;
}

/** Tells the page which action was pressed. */
function fire(action) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('shortcuts:event', action);
}

/** Lets go of everything this module holds. */
function release() {
  for (const wanted of held.values()) {
    try {
      globalShortcut.unregister(wanted);
    } catch (error) {
      // Nothing to do: it was not held.
    }
  }
  held = new Map();
}

/** Takes the shortcuts of the list (the ones another program already has are simply left out). */
function apply(list) {
  release();
  for (const [action, wanted] of Object.entries(list)) {
    try {
      if (globalShortcut.register(wanted, fire.bind(null, action))) held.set(action, wanted);
    } catch (error) {
      // Not registered: another program has it.
    }
  }
  return [...held.keys()];
}

/** ! True when the message comes from the main page of the app (not a frame inside it, not another window). */
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

/** The page gives the shortcuts to hold now ({} to let go) and gets back which actions were taken. */
function handleSet(event, raw) {
  if (!isMainPage(event)) return [];
  return apply(sanitize(raw));
}

function start(window, isAppAddressFn) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  ipcMain.handle('shortcuts:set', handleSet);
}

function stop() {
  release();
}

module.exports = { start, stop, accelerator, sanitize, ACTIONS };
