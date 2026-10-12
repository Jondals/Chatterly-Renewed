/**
 * desktop/src/window-state.cjs
 * Remembers how the window was left: maximized or not and, if not, where and how big. The first time the app opens it is
 * MAXIMIZED, and it stays that way until the person restores the window; then it opens as they left it.
 *
 * * Plain functions, no Electron inside, so the test can run them alone.
 * ! The file is only read as data: every value is checked, so a damaged or edited file can only give a default window.
 */
'use strict';

const fs = require('node:fs');

/** The first start, and a start after a damaged file: maximized. */
const DEFAULT_STATE = { maximized: true, bounds: null };
/** At least this much of the window must be on a screen, or it opens in the default place. */
const MIN_VISIBLE_WIDTH = 160;
const MIN_VISIBLE_HEIGHT = 80;

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 100000;
}

/** Turns what was read into a valid state (the defaults for anything that is not valid). */
function sanitize(raw) {
  const state = { ...DEFAULT_STATE };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;
  if (typeof raw.maximized === 'boolean') state.maximized = raw.maximized;
  const b = raw.bounds;
  if (
    b &&
    typeof b === 'object' &&
    isInteger(b.x) &&
    isInteger(b.y) &&
    isInteger(b.width) &&
    isInteger(b.height) &&
    b.width >= 360 &&
    b.height >= 480
  ) {
    state.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return state;
}

/** Reads the saved state from a file (the defaults when there is none or it is damaged). */
function load(file) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    return { ...DEFAULT_STATE };
  }
}

/** Saves the state. A failure is ignored: the window just opens in the default way next time. */
function save(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify(sanitize(state)));
  } catch (error) {
    // Nothing to do: the next start uses the defaults.
  }
}

/** The bounds if enough of the window is on one of the work areas, or null (so it opens centred on the main screen). */
function fitBounds(bounds, workAreas) {
  if (!bounds) return null;
  for (const area of workAreas) {
    const width =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    if (width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT) return bounds;
  }
  return null;
}

module.exports = { DEFAULT_STATE, sanitize, load, save, fitBounds };
