/**
 * desktop/experiments/overlay/main.cjs
 * EXPERIMENT (not part of the app): can a friend's camera be drawn in a transparent, always-on-top window over a game?
 * Run it with: node desktop/experiments/overlay/run.mjs
 *
 * * The "host" window plays the part of the call window: it makes a live video (a moving canvas) and sends it to the
 *   "overlay" window through a local WebRTC loopback (no network, no relay: both ends are on this computer).
 * * The "overlay" window is transparent, without frame, always on top, never takes the focus and lets the mouse through.
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// Chromium hides the local addresses behind random .local names (mDNS); two windows of the same app would then have to
// resolve names to find each other. For this local-only connection the real addresses are fine.
app.commandLine.appendSwitch(
  'disable-features',
  'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion',
);

let host = null;
let overlay = null;
const report = { events: [] };

// OVERLAY_VISIBLE=1 puts both windows on screen for a few seconds: a window kept far off screen is not drawn, so the
// frame rate can only be measured with the overlay really visible.
const VISIBLE = process.env.OVERLAY_VISIBLE === '1';

function makeWindow(file, extra) {
  const win = new BrowserWindow({
    x: VISIBLE ? 40 : -32000,
    y: VISIBLE ? 40 : -32000,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
    ...extra,
  });
  win.loadFile(path.join(__dirname, file));
  return win;
}

function relay(event, message) {
  const target = event.sender === host.webContents ? overlay : host;
  if (target && !target.isDestroyed()) target.webContents.send('signal', message);
}

function onReport(event, data) {
  report.events.push(data);
}

function metrics() {
  return app.getAppMetrics().map(function pick(m) {
    return { type: m.type, cpu: m.cpu.percentCPUUsage, memory: m.memory.workingSetSize };
  });
}

function overlayState() {
  return {
    alwaysOnTop: overlay.isAlwaysOnTop(),
    focusable: overlay.isFocusable(),
    visible: overlay.isVisible(),
    bounds: overlay.getBounds(),
  };
}

app.whenReady().then(function start() {
  ipcMain.on('signal', relay);
  ipcMain.on('report', onReport);
  ipcMain.handle('metrics', metrics);
  ipcMain.handle('overlay-state', overlayState);
  host = makeWindow('host.html', {
    width: 640,
    height: 360,
    ...(VISIBLE ? { x: 600, y: 40 } : {}),
  });
  if (VISIBLE) host.showInactive();
  overlay = makeWindow('overlay.html', {
    width: 480,
    height: 270,
    transparent: true,
    frame: false,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    resizable: false,
  });
  // The highest level: above full-screen windows that are not exclusive (a game in "borderless" mode).
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // The mouse goes through, but the window still gets the movement (to know when to show its controls).
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.showInactive();
});
