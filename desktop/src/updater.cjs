/**
 * desktop/src/updater.cjs
 * Updates of the installed app, driven by the person from inside the app.
 *
 * * The app looks for a new version when it starts and then as often as the person chose (Settings > Updates), and only
 *   TELLS: the web app shows it in the notifications of the Home bell (if the person wants notices) and in Settings.
 *   The person downloads it (a progress bar), then restarts to apply it. By default nothing is downloaded, installed or
 *   restarted behind their back, and nothing is installed when the app merely closes.
 * * "Update by itself" (off by default, the person turns it on) changes that on purpose: a new version is downloaded as
 *   soon as it is found, and installed silently when the app is closed. The app is never restarted in the middle of
 *   something (a call): the person can still press "Restart and update" when they want it sooner.
 * * The choices (how often, notices on or off, update by itself) are kept in update-settings.json in the profile folder.
 * * Updates come from the GitHub Releases of the repository (one release per version of the whole project, the same
 *   number as the web app). The Microsoft Store version is updated by the Store and never by this file.
 *   CHATTERLY_NO_UPDATE=1 turns it off.
 * ! An update is trusted because of the https connection to GitHub and the sha512 in latest.yml. Until the installer is
 *   signed there is no publisher check on top of that: sign it (or ship through the Store) to get one.
 * ! Only the main page of the app may use the commands (see isTrustedSender); an embedded frame cannot, and the
 *   settings it sends are checked against a fixed list of values.
 * * Beta channel: with the "beta" choice on, the pre-releases of GitHub (built from the beta branch, see the workflow) are
 *   offered too. The page only turns it on for an account the server says is a tester; the channel needs no secret.
 * * Nothing is sent but the usual request for the release files: no account, no identifier.
 * ? The updater code is loaded a few seconds after the window, so it does not compete with the start of the app.
 * ? Development only: CHATTERLY_UPDATE_URL=<folder with latest.yml> checks and downloads from there and never installs
 *   (a packaged app ignores it). desktop/test/desktop.mjs uses it.
 */
'use strict';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const HOUR = 60 * 60 * 1000;
/** How often to look: the milliseconds between checks; 0 = only when the app starts, -1 = never by itself. */
const INTERVALS = {
  '1h': HOUR,
  '6h': 6 * HOUR,
  '12h': 12 * HOUR,
  '24h': 24 * HOUR,
  start: 0,
  never: -1,
};
const DEFAULT_SETTINGS = { interval: '6h', notify: true, auto: false, beta: false };
/** Wait this long after the window opens before the first check. */
const START_DELAY_MS = 5000;
const STATE_CHANNEL = 'updates:state';

/**
 * What the web app sees. status: 'unavailable' (this build does not update itself), 'idle', 'checking', 'none'
 * (already the latest), 'available', 'downloading', 'ready', 'error'. lastCheck: when the last check ended (ms), or 0.
 */
let state = {
  status: 'unavailable',
  version: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  error: '',
  lastCheck: 0,
  settings: { ...DEFAULT_SETTINGS },
};
let autoUpdater = null;
let mainWindow = null;
let isAppAddress = null;
let checkTimer = null;

function devFeed() {
  return !app.isPackaged ? process.env.CHATTERLY_UPDATE_URL || '' : '';
}

function enabled() {
  if (process.env.CHATTERLY_NO_UPDATE === '1' || process.windowsStore) return false;
  return app.isPackaged || Boolean(devFeed());
}

function log(message) {
  console.log('[updater] ' + message);
  // ? Development only: the test reads this list (the output of a GUI process does not reach a pipe on Windows).
  if (!app.isPackaged) {
    globalThis.__updaterLog = (globalThis.__updaterLog || []).concat(message);
  }
}

/** Changes the state and tells the page. */
function setState(patch) {
  state = { ...state, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(STATE_CHANNEL, state);
  }
}

function describe(error) {
  return error && error.message ? String(error.message).slice(0, 300) : 'Unknown error';
}

// ── The choices of the person ────────────────────────────────────────────────────────────────────────

function settingsPath() {
  return path.join(app.getPath('userData'), 'update-settings.json');
}

/**
 * Turns what came in into valid settings, on top of `base`, or returns null if anything is wrong. ! The page is not
 * trusted: only these three keys, only these values.
 */
function sanitizeSettings(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const merged = { ...base };
  for (const key of Object.keys(raw)) {
    if (key === 'interval') {
      if (typeof raw.interval !== 'string' || !Object.hasOwn(INTERVALS, raw.interval)) return null;
      merged.interval = raw.interval;
    } else if (key === 'notify') {
      if (typeof raw.notify !== 'boolean') return null;
      merged.notify = raw.notify;
    } else if (key === 'auto') {
      if (typeof raw.auto !== 'boolean') return null;
      merged.auto = raw.auto;
    } else if (key === 'beta') {
      if (typeof raw.beta !== 'boolean') return null;
      merged.beta = raw.beta;
    } else {
      return null;
    }
  }
  return merged;
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return sanitizeSettings(raw, DEFAULT_SETTINGS) || { ...DEFAULT_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings));
  } catch (error) {
    log('could not save the settings: ' + describe(error));
  }
}

/** (Re)starts the timer for the chosen interval. */
function schedule() {
  clearInterval(checkTimer);
  checkTimer = null;
  const every = INTERVALS[state.settings.interval];
  if (every > 0 && autoUpdater) {
    checkTimer = setInterval(check, every);
    checkTimer.unref();
  }
}

// ── The commands the page may use ────────────────────────────────────────────────────────────────────

/** ! Only the main page of the app, at the app's own address, may talk to the updater. */
function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  return Boolean(frame) && frame === mainWindow.webContents.mainFrame && isAppAddress(frame.url);
}

function handleGet(event) {
  if (!isTrustedSender(event)) return null;
  return state;
}

function handleCheck(event) {
  if (!isTrustedSender(event) || !ensureUpdater()) return state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  setState({ status: 'checking', error: '' });
  autoUpdater.checkForUpdates().catch(onError);
  return state;
}

function startDownload() {
  setState({
    status: 'downloading',
    percent: 0,
    transferred: 0,
    bytesPerSecond: 0,
    error: '',
  });
  autoUpdater.downloadUpdate().catch(onError);
}

function handleDownload(event) {
  if (!isTrustedSender(event) || !ensureUpdater()) return state;
  if (state.status !== 'available' && state.status !== 'error') return state;
  startDownload();
  return state;
}

/** With "update by itself" on, a downloaded update is installed (silently) when the app closes. Never in development. */
function applyInstallOnQuit() {
  if (autoUpdater) autoUpdater.autoInstallOnAppQuit = state.settings.auto && !devFeed();
}

function handleInstall(event) {
  if (!isTrustedSender(event) || !autoUpdater) return state;
  if (state.status !== 'ready') return state;
  if (devFeed()) {
    log('would restart to install (not done in development)');
    return state;
  }
  log('restarting to install');
  // Silent installer, and the app starts again by itself when it is done.
  autoUpdater.quitAndInstall(true, true);
  return state;
}

function handleSettings(event, patch) {
  if (!isTrustedSender(event)) return state;
  const next = sanitizeSettings(patch, state.settings);
  if (!next) {
    log('refused settings from the page');
    return state;
  }
  saveSettings(next);
  setState({ settings: next });
  schedule();
  applyInstallOnQuit();
  // The beta channel: the pre-releases of GitHub (built from the beta branch) are offered too.
  if (autoUpdater) autoUpdater.allowPrerelease = next.beta;
  // Turning it on while a version is waiting starts the download at once.
  if (next.auto && autoUpdater && state.status === 'available') startDownload();
  return state;
}

// ── Events of electron-updater ───────────────────────────────────────────────────────────────────────

function onError(error) {
  log('error: ' + describe(error));
  // A failed silent check shows nothing; a failed download or manual check says so.
  if (state.status === 'downloading' || state.status === 'checking') {
    setState({
      status: 'error',
      error: describe(error),
      lastCheck: Date.now(),
    });
  }
}

function onAvailable(info) {
  log('available ' + info.version);
  const file = info.files && info.files[0];
  setState({
    status: 'available',
    version: info.version,
    percent: 0,
    transferred: 0,
    total: file && file.size ? file.size : 0,
    error: '',
    lastCheck: Date.now(),
  });
  if (state.settings.auto && autoUpdater) startDownload();
}

function onNone() {
  log('up to date');
  // Only a manual check shows "up to date"; the silent ones go back to idle.
  setState({
    status: state.status === 'checking' ? 'none' : 'idle',
    error: '',
    lastCheck: Date.now(),
  });
}

function onProgress(progress) {
  setState({
    status: 'downloading',
    percent: Math.round(progress.percent || 0),
    transferred: progress.transferred || 0,
    total: progress.total || state.total,
    bytesPerSecond: progress.bytesPerSecond || 0,
  });
}

function onDownloaded(info) {
  log('downloaded ' + info.version);
  setState({ status: 'ready', version: info.version, percent: 100, error: '' });
  applyInstallOnQuit();
}

function check() {
  // A background check does not change what the page shows unless it finds something.
  if (!autoUpdater || state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch(onError);
}

/** Loads electron-updater the first time it is needed. Returns false if it cannot be used. */
function ensureUpdater() {
  if (autoUpdater) return true;
  if (!enabled()) return false;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (error) {
    onError(error);
    return false;
  }
  const feed = devFeed();
  if (feed) {
    // The downloader also wants an update config file; an unpackaged app has none, so one is made in the profile.
    const configPath = path.join(app.getPath('userData'), 'dev-app-update.yml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, ['provider: generic', 'url: ' + feed, ''].join('\n'));
    autoUpdater.updateConfigPath = configPath;
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }
  // * The person decides: nothing is downloaded or installed on its own, unless they turned "update by itself" on (the
  // * download is then started by onAvailable, and the install on quit by applyInstallOnQuit).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = state.settings.beta;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('error', onError);
  autoUpdater.on('update-available', onAvailable);
  autoUpdater.on('update-not-available', onNone);
  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  return true;
}

/** The first look for updates, a few seconds after the window opened. */
function begin() {
  if (!ensureUpdater()) return;
  setState({ status: 'idle' });
  if (state.settings.interval !== 'never') check();
  schedule();
}

/** Opens the commands and starts looking for updates. Safe to call when updates are off. */
function start(window, isAppAddressFn) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  state = { ...state, settings: loadSettings() };
  ipcMain.handle('updates:get', handleGet);
  ipcMain.handle('updates:check', handleCheck);
  ipcMain.handle('updates:download', handleDownload);
  ipcMain.handle('updates:install', handleInstall);
  ipcMain.handle('updates:settings', handleSettings);
  if (!enabled()) return;
  // The page can already ask for the state: until the first check it is "idle".
  setState({ status: 'idle' });
  const wait = devFeed() ? 0 : START_DELAY_MS;
  const timer = setTimeout(begin, wait);
  timer.unref();
}

module.exports = {
  start,
  enabled,
  sanitizeSettings,
  INTERVALS,
  DEFAULT_SETTINGS,
};
