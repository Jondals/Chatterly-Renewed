/**
 * desktop/src/updater.cjs
 * Updates of the installed app, driven by the person from inside the app.
 *
 * * The app looks for a new version at start and every few hours, and only TELLS: the web app shows it in the
 *   notifications of the Home bell. The person downloads it (a progress bar), then restarts to apply it. Nothing is
 *   downloaded, installed or restarted behind their back, and nothing is installed when the app merely closes.
 * * Updates come from the GitHub Releases of the repository (one release per version of the whole project, the same
 *   number as the web app). The Microsoft Store version is updated by the Store and never by this file.
 *   CHATTERLY_NO_UPDATE=1 turns it off.
 * ! An update is trusted because of the https connection to GitHub and the sha512 in latest.yml. Until the installer is
 *   signed there is no publisher check on top of that: sign it (or ship through the Store) to get one.
 * ! Only the main page of the app may use the four commands (see isTrustedSender); an embedded frame cannot.
 * * Nothing is sent but the usual request for the release files: no account, no identifier.
 * ? Development only: CHATTERLY_UPDATE_URL=<folder with latest.yml> checks and downloads from there and never installs
 *   (a packaged app ignores it). desktop/test/desktop.mjs uses it.
 */
'use strict';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const STATE_CHANNEL = 'updates:state';

/**
 * What the web app sees. status: 'unavailable' (this build does not update itself), 'idle', 'checking', 'none'
 * (already the latest), 'available', 'downloading', 'ready', 'error'.
 */
let state = { status: 'unavailable', version: '', percent: 0, error: '' };
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

function onError(error) {
  log('error: ' + describe(error));
  // A failed check is shown as an error only if the person had asked for something (download/restart).
  if (state.status === 'downloading' || state.status === 'checking') {
    setState({ status: 'error', error: describe(error) });
  }
}

// ── The four commands the page may use ───────────────────────────────────────────────────────────────

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
  if (!isTrustedSender(event) || !autoUpdater) return state;
  if (state.status === 'downloading' || state.status === 'ready') return state;
  setState({ status: 'checking', error: '' });
  autoUpdater.checkForUpdates().catch(onError);
  return state;
}

function handleDownload(event) {
  if (!isTrustedSender(event) || !autoUpdater) return state;
  if (state.status !== 'available' && state.status !== 'error') return state;
  setState({ status: 'downloading', percent: 0, error: '' });
  autoUpdater.downloadUpdate().catch(onError);
  return state;
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

// ── Events of electron-updater ───────────────────────────────────────────────────────────────────────

function onAvailable(info) {
  log('available ' + info.version);
  setState({ status: 'available', version: info.version, percent: 0, error: '' });
}

function onNone() {
  log('up to date');
  // Only a manual check shows "up to date"; the silent ones go back to idle.
  setState({ status: state.status === 'checking' ? 'none' : 'idle', error: '' });
}

function onProgress(progress) {
  setState({ status: 'downloading', percent: Math.round(progress.percent || 0) });
}

function onDownloaded(info) {
  log('downloaded ' + info.version);
  setState({ status: 'ready', version: info.version, percent: 100, error: '' });
}

function check() {
  // A background check does not change what the page shows unless it finds something.
  if (state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch(onError);
}

/** Starts looking for updates and opens the four commands. Safe to call when updates are off. */
function start(window, isAppAddressFn) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  ipcMain.handle('updates:get', handleGet);
  ipcMain.handle('updates:check', handleCheck);
  ipcMain.handle('updates:download', handleDownload);
  ipcMain.handle('updates:install', handleInstall);
  if (!enabled()) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (error) {
    onError(error);
    return;
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
  // * The person decides: nothing is downloaded or installed on its own.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('error', onError);
  autoUpdater.on('update-available', onAvailable);
  autoUpdater.on('update-not-available', onNone);
  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  setState({ status: 'idle' });
  check();
  checkTimer = setInterval(check, CHECK_EVERY_MS);
  checkTimer.unref();
}

module.exports = { start, enabled };
