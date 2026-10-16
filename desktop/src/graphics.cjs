/**
 * desktop/src/graphics.cjs
 * How the desktop app uses the graphics card: hardware acceleration on or off, and which graphics layer (the "ANGLE backend")
 * draws the page: Direct3D 11, Direct3D 12, OpenGL or Vulkan on Windows (Metal and OpenGL on a Mac), or the one Chromium
 * chooses ("auto", the default and almost always the best).
 * ? Direct3D 12 is ANGLE's "D3D11 on 12" layer (d3d11on12): Chromium has no native Direct3D 12 backend; this one draws through
 *   the Direct3D 12 driver, which helps on some cards whose Direct3D 11 driver is poor and does nothing on others. The person chooses in Settings; the choice is read when the app starts, so it
 * applies after a restart.
 *
 * ! Only values of a fixed list are ever written, read or turned into a Chromium switch: the file is checked on every read,
 *   so a damaged or edited file can only fall back to the defaults, never put a free switch on the command line.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The graphics layers the person may choose, by system (the first one, "auto", is always there). */
const BACKENDS = {
  win32: ['auto', 'd3d11', 'd3d11on12', 'gl', 'vulkan'],
  darwin: ['auto', 'metal', 'gl'],
  linux: ['auto', 'gl', 'vulkan'],
};

const DEFAULTS = { hardwareAcceleration: true, backend: 'auto' };

/** The layers that exist on this system. */
function backendsFor(platform) {
  return BACKENDS[platform] || ['auto'];
}

/** Where the choice is kept. */
function fileOf(userData) {
  return path.join(userData, 'graphics.json');
}

/** Makes a clean choice out of anything (only a yes/no and a layer of the list survive). */
function clean(value, platform) {
  const wanted = value && typeof value === 'object' ? value : {};
  return {
    hardwareAcceleration:
      typeof wanted.hardwareAcceleration === 'boolean'
        ? wanted.hardwareAcceleration
        : DEFAULTS.hardwareAcceleration,
    backend: backendsFor(platform).includes(wanted.backend) ? wanted.backend : DEFAULTS.backend,
  };
}

/** Reads the choice of the person (the defaults when there is none or the file is damaged). */
function read(userData, platform) {
  try {
    return clean(JSON.parse(fs.readFileSync(fileOf(userData), 'utf8')), platform);
  } catch (error) {
    return { ...DEFAULTS };
  }
}

/** Keeps a choice (after cleaning it) and gives back what was kept. */
function write(userData, platform, value) {
  const kept = clean(value, platform);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(fileOf(userData), JSON.stringify(kept), 'utf8');
  return kept;
}

/**
 * Puts the choice on the app. It must run before the app is ready.
 * @param {Electron.App} app
 * @param {string} platform process.platform
 * @returns {{hardwareAcceleration: boolean, backend: string}} what was applied
 */
function apply(app, platform) {
  const choice = read(app.getPath('userData'), platform);
  if (!choice.hardwareAcceleration) {
    app.disableHardwareAcceleration();
  } else if (choice.backend !== 'auto') {
    app.commandLine.appendSwitch('use-angle', choice.backend);
  }
  return choice;
}

module.exports = { BACKENDS, DEFAULTS, backendsFor, clean, read, write, apply };
