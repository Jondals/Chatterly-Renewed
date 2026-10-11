/**
 * desktop/src/updater.cjs
 * The app updates ITSELF, with no questions: it looks for a new version at start and every few hours, downloads it in
 * the background and installs it without a window.
 *
 * * When it restarts: (1) right away if the update arrived in the first minutes after starting (nobody is in a call
 *   yet); (2) when the app closes; (3) when the window has been hidden in the tray and silent for a while.
 *   ! It never restarts while a call may be running: only a hidden, silent window is restarted.
 * * Updates come from the GitHub Releases of the repository (the same version number as the web app). The Microsoft
 *   Store version is updated by the Store and never by this file. CHATTERLY_NO_UPDATE=1 turns it off.
 * ! An update is trusted because of the https connection to GitHub and the sha512 in latest.yml. Until the installer is
 *   signed there is no publisher check on top of that: sign it (or ship through the Store) to get one.
 * * Nothing is sent but the usual request for the release files: no account, no identifier.
 * ? Development only: CHATTERLY_UPDATE_URL=<folder with latest.yml> checks and downloads from there and never installs
 *   (a packaged app ignores it). desktop/test/desktop.mjs uses it.
 */
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** An update that arrives this soon after starting is installed at once. */
const FRESH_START_MS = 3 * 60 * 1000;
/** Hidden and silent for this long: nobody is using the app, so it may restart. */
const IDLE_MS = 10 * 60 * 1000;
const IDLE_CHECK_MS = 60 * 1000;

let autoUpdater = null;
let mainWindow = null;
let downloaded = false;
let startedAt = 0;
let quietSince = 0;
let idleTimer = null;
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

function onError(error) {
  // A failed check is not shown to anybody: the next one tries again.
  log('error: ' + (error && error.message ? error.message : error));
}

/** Installs the downloaded update and starts the app again. Silent: no installer window. */
function installNow() {
  if (!downloaded || !autoUpdater) return;
  if (devFeed()) {
    log('would restart to install (not done in development)');
    return;
  }
  log('restarting to install');
  autoUpdater.quitAndInstall(true, true);
}

/** True when the window is hidden and nothing is playing (no call with somebody talking). */
function isQuiet() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  return !mainWindow.isVisible() && !mainWindow.webContents.isCurrentlyAudible();
}

function onIdleTick() {
  if (!downloaded) return;
  if (!isQuiet()) {
    quietSince = 0;
    return;
  }
  if (quietSince === 0) quietSince = Date.now();
  if (Date.now() - quietSince >= IDLE_MS) installNow();
}

function onUpdateDownloaded(info) {
  downloaded = true;
  log('downloaded ' + info.version);
  if (Date.now() - startedAt < FRESH_START_MS) installNow();
}

function check() {
  autoUpdater.checkForUpdates().catch(onError);
}

/** Starts checking for updates now and every few hours. Safe to call when updates are off. */
function start(window) {
  if (!enabled()) return;
  mainWindow = window;
  startedAt = Date.now();
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
  autoUpdater.autoDownload = true;
  // * If nothing restarted it earlier, the update is installed when the app closes.
  autoUpdater.autoInstallOnAppQuit = !feed;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('error', onError);
  autoUpdater.on('update-available', function onAvailable(info) {
    log('available ' + info.version);
  });
  autoUpdater.on('update-not-available', function onNone() {
    log('up to date');
  });
  autoUpdater.on('update-downloaded', onUpdateDownloaded);
  check();
  checkTimer = setInterval(check, CHECK_EVERY_MS);
  checkTimer.unref();
  idleTimer = setInterval(onIdleTick, IDLE_CHECK_MS);
  idleTimer.unref();
}

module.exports = { start, enabled };
