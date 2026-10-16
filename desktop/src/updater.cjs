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
 * ! An update is trusted because its manifest (latest.yml / beta.yml) carries an Ed25519 signature made in the build and checked
 *   here with the public keys of update-verify.cjs, and then the sha512 of the installer is checked against that manifest. The
 *   https connection alone is never enough. There is no Authenticode publisher check on top of that yet (the installer is not
 *   signed by Windows): sign it, or ship through the Store, to get one.
 * ! Nothing goes down in version, except one case: a person who runs a BETA and chooses the Release channel gets the latest
 *   signed release even if its number is lower than their beta (a beta is ahead of the stable one until that one is published).
 *   Every other app never downgrades, so an old signed version cannot be replayed to it.
 * ! Only the main page of the app may use the commands (see isTrustedSender); an embedded frame cannot, and the
 *   settings it sends are checked against a fixed list of values.
 * * Beta channel: with the "beta" choice on, the app looks in the Chatterly server instead of GitHub (the stable releases stay
 *   on GitHub and keep working even if the beta server is down). The server hands the installers only to a tester: the page
 *   asks it for a token of that account (valid two hours, checked again on every download) and gives it to this file with
 *   "updates:beta-token". The token is sent in a header, never in the address.
 * * After an update, the installer that was downloaded is deleted (cleanAfterUpdate).
 * * macOS: the app is not signed by Apple (that costs 99 USD a year), and the updater of macOS (Squirrel) refuses to install an
 *   app that is not. So on a Mac the check is the same (the signed manifest latest-mac.yml / beta-mac.yml), but "Download" fetches
 *   the .dmg the signed manifest lists, checks its sha512 against it, keeps it in Downloads, and "Install" opens it: the person
 *   drags Chatterly to Applications (manualFile, downloadManually).
 * * Nothing is sent but the usual request for the release files: no account, no identifier.
 * ? The updater code is loaded a few seconds after the window, so it does not compete with the start of the app.
 * ? Development only: CHATTERLY_UPDATE_URL=<folder with latest.yml> checks and downloads from there and never installs
 *   (a packaged app ignores it). desktop/test/desktop.mjs uses it.
 */
'use strict';

const { app, ipcMain, net, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const verify = require('./update-verify.cjs');

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
const DEFAULT_SETTINGS = {
  interval: '6h',
  notify: true,
  auto: false,
  beta: false,
};
/** Wait this long after the window opens before the first check. */
const START_DELAY_MS = 5000;
const STATE_CHANNEL = 'updates:state';
/** The repository whose releases are the stable channel. */
const GITHUB = { owner: 'Jondals', repo: 'ChatterlyRenewed' };
/** The longest manifest or signature the app reads, and how long it waits for one. */
const MANIFEST_MAX_BYTES = 64 * 1024;
const MANIFEST_TIMEOUT_MS = 20000;
/** A beta token that is about to expire is not used: a download takes a while. */
const TOKEN_MARGIN_MS = 10 * 60 * 1000;
/** How long a beta look or download waits for the page to give the token of the account. */
const TOKEN_WAIT_MS = 30 * 1000;

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
/** The address of the server (https only): the beta installers come from it. */
let serverOrigin = '';
/** What the page gave for the beta channel: the token of the account and when it stops working. */
let betaAuth = { token: '', expiresAt: 0 };
/**
 * A beta look ('check') or download ('download') put off for lack of a token: it is done when the page gives one. The page asks
 * for it when the channel changes, so this is the normal path right after choosing Beta, not an error.
 */
let betaPending = '';
/** Gives up waiting for the token (the account is signed out, or the server refuses it) and says so. */
let tokenWaitTimer = null;
/** Where the manifest of the channel in use is (see prepareFeed). */
let feed = null;
/** The version whose signature was verified: nothing else is downloaded. */
let trusted = '';
/** macOS: the disk image the verified manifest lists (name, sha512, size), and where it was saved. */
let manualFile = null;
let manualPath = '';
/** True on a Mac: the update is installed by the person (see the header). */
const MANUAL = process.platform === 'darwin';

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

/** The choices before the person makes any: a build of the beta branch starts on the beta channel, the rest on the release one. */
function startingSettings() {
  return { ...DEFAULT_SETTINGS, beta: app.getVersion().includes('-beta.') };
}

function loadSettings() {
  const start = startingSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return sanitizeSettings(raw, start) || start;
  } catch (error) {
    return start;
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings));
  } catch (error) {
    log('could not save the settings: ' + describe(error));
  }
}

/** The name of the manifest of a channel on this platform. */
function manifestName(beta) {
  const suffix =
    process.platform === 'linux' ? '-linux' : process.platform === 'darwin' ? '-mac' : '';
  return (beta ? 'beta' : 'latest') + suffix + '.yml';
}

/**
 * macOS: the disk image listed in a verified manifest ("- url: Chatterly-<v>.dmg", its sha512 and size), or null.
 * ! Only a plain file name: nothing in the manifest can point the download somewhere else.
 */
function dmgOf(text) {
  const found =
    /^\s*-\s*url:\s*(Chatterly-[0-9A-Za-z.-]{1,60}\.dmg)\s*\n\s*sha512:\s*([A-Za-z0-9+/=]{80,100})\s*\n\s*size:\s*(\d{1,12})/m.exec(
      text,
    );
  return found ? { name: found[1], sha512: found[2], size: Number(found[3]) } : null;
}

/**
 * Points electron-updater at the feed of the channel. Returns '' when it is ready, or the reason it cannot look yet.
 * * Release: the releases of GitHub. Beta: the server, with the token of the account in a header. The channel is set on purpose:
 *   without it electron-updater would pick it from the version that runs, and a beta would look for beta.yml in GitHub.
 * ! Never a prerelease from GitHub. A downgrade only for a beta that goes back to Release (see the header).
 */
function prepareFeed() {
  if (!autoUpdater || devFeed()) return '';
  const beta = state.settings.beta;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = !beta && app.getVersion().includes('-beta.');
  if (beta) {
    if (!serverOrigin) return 'The server address is not known';
    if (!betaAuth.token || betaAuth.expiresAt < Date.now() + TOKEN_MARGIN_MS) {
      return 'beta-needs-token';
    }
    const base = serverOrigin + '/api/beta/dl/';
    feed = {
      base,
      name: manifestName(true),
      headers: { Authorization: 'Bearer ' + betaAuth.token },
    };
    autoUpdater.setFeedURL({ provider: 'generic', url: base, channel: 'beta' });
    autoUpdater.channel = 'beta';
    autoUpdater.requestHeaders = feed.headers;
  } else {
    feed = { base: '', name: manifestName(false), headers: {} };
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB.owner,
      repo: GITHUB.repo,
    });
    autoUpdater.channel = 'latest';
    autoUpdater.requestHeaders = null;
  }
  return '';
}

/** Looks for a version. A beta look without a token waits for the page to give one. */
function runCheck() {
  const problem = prepareFeed();
  if (problem === 'beta-needs-token') {
    waitForToken('check');
    return;
  }
  if (problem) {
    onError(new Error(problem));
    return;
  }
  autoUpdater.checkForUpdates().catch(onError);
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
  runCheck();
  return state;
}

function startDownload() {
  // ! Only a version whose signature was verified is downloaded.
  if (trusted === '' || trusted !== state.version) {
    setState({ status: 'checking', error: '' });
    runCheck();
    return;
  }
  const problem = prepareFeed();
  if (problem === 'beta-needs-token') {
    setState({ status: 'checking', error: '' });
    waitForToken('download');
    return;
  }
  if (problem) {
    setState({ status: 'error', error: problem, lastCheck: Date.now() });
    return;
  }
  if (MANUAL) {
    downloadManually().catch(onError);
    return;
  }
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
  if (autoUpdater) autoUpdater.autoInstallOnAppQuit = state.settings.auto && !devFeed() && !MANUAL;
}

/**
 * macOS: downloads the disk image of the verified manifest to Downloads, checking its sha512 as it arrives. ! A file whose
 * sha512 is not the signed one is deleted and never opened.
 */
async function downloadManually() {
  const file = manualFile;
  if (!file) throw new Error('The update has no disk image for this Mac');
  setState({
    status: 'downloading',
    percent: 0,
    transferred: 0,
    total: file.size,
    bytesPerSecond: 0,
    error: '',
  });
  const target = path.join(app.getPath('downloads'), file.name);
  const partial = target + '.part';
  const answer = await net.fetch(file.base + file.name, {
    headers: feed ? feed.headers : {},
    redirect: 'follow',
  });
  if (!answer.ok || !answer.body) throw new Error('HTTP ' + answer.status + ' for ' + file.name);
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(partial);
  const started = Date.now();
  let transferred = 0;
  try {
    for await (const chunk of answer.body) {
      const bytes = Buffer.from(chunk);
      transferred += bytes.length;
      if (transferred > file.size + 1024)
        throw new Error('The disk image is bigger than the signed one');
      hash.update(bytes);
      if (!out.write(bytes))
        await new Promise(function drained(resolve) {
          out.once('drain', resolve);
        });
      const seconds = Math.max(0.5, (Date.now() - started) / 1000);
      onProgress({
        percent: (transferred / file.size) * 100,
        transferred,
        total: file.size,
        bytesPerSecond: transferred / seconds,
      });
    }
    await new Promise(function closed(resolve, reject) {
      out.end(resolve);
      out.on('error', reject);
    });
  } catch (error) {
    out.destroy();
    fs.rmSync(partial, { force: true });
    throw error;
  }
  if (hash.digest('base64') !== file.sha512) {
    fs.rmSync(partial, { force: true });
    throw new Error('The disk image is not the signed one');
  }
  fs.renameSync(partial, target);
  manualPath = target;
  onDownloaded({ version: state.version });
}

function handleInstall(event) {
  if (!isTrustedSender(event)) return state;
  if (state.status !== 'ready') return state;
  if (MANUAL) {
    // The person drags Chatterly to Applications from the disk image; the app closes so the copy can be replaced.
    if (manualPath) {
      void shell.openPath(manualPath);
      log('opened the disk image');
    }
    return state;
  }
  if (!autoUpdater) return state;
  if (devFeed()) {
    log('would restart to install (not done in development)');
    return state;
  }
  log('restarting to install');
  // Silent installer, and the app starts again by itself when it is done.
  autoUpdater.quitAndInstall(true, true);
  return state;
}

/** The page gives the token of the account for the beta channel (or null when nobody is signed in any more). */
function handleBetaToken(event, payload) {
  if (!isTrustedSender(event)) return state;
  if (payload === null) {
    betaAuth = { token: '', expiresAt: 0 };
    return state;
  }
  const valid =
    payload &&
    typeof payload === 'object' &&
    typeof payload.token === 'string' &&
    /^[A-Za-z0-9_.-]{20,300}$/.test(payload.token) &&
    Number.isFinite(payload.expiresAt);
  if (!valid) {
    log('refused a beta token from the page');
    return state;
  }
  betaAuth = { token: payload.token, expiresAt: payload.expiresAt };
  const next = betaPending;
  stopWaitingForToken();
  if (next === 'download' && state.settings.beta) startDownload();
  else if (next === 'check' && state.settings.beta) check();
  return state;
}

/** Puts a beta look or download off until the page gives the token, and gives up after TOKEN_WAIT_MS. */
function waitForToken(next) {
  // a download that waits is not lost to a look that comes later
  if (betaPending !== 'download') betaPending = next;
  clearTimeout(tokenWaitTimer);
  tokenWaitTimer = setTimeout(tokenNeverCame, TOKEN_WAIT_MS);
  tokenWaitTimer.unref();
}

function stopWaitingForToken() {
  betaPending = '';
  clearTimeout(tokenWaitTimer);
  tokenWaitTimer = null;
}

function tokenNeverCame() {
  stopWaitingForToken();
  // A silent look (status idle) shows nothing; a look the person asked for says why.
  onError(new Error('The Chatterly server did not give the beta access: sign in again and retry'));
}

function handleSettings(event, patch) {
  if (!isTrustedSender(event)) return state;
  const next = sanitizeSettings(patch, state.settings);
  if (!next) {
    log('refused settings from the page');
    return state;
  }
  const previous = state.settings;
  saveSettings(next);
  setState({ settings: next });
  schedule();
  applyInstallOnQuit();
  const changedChannel = next.beta !== previous.beta;
  // ! What was verified belongs to the channel it came from: another channel starts again.
  if (changedChannel) {
    trusted = '';
    stopWaitingForToken();
  }
  // Changing the channel looks again at once, so the person sees what the new channel offers (never in the middle of a download).
  if (
    changedChannel &&
    ensureUpdater() &&
    state.status !== 'downloading' &&
    state.status !== 'ready'
  ) {
    setState({ status: 'checking', error: '' });
    runCheck();
  }
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

/** The text of a small file (a manifest or a signature), or throws. */
async function fetchSmall(url, headers) {
  const answer = await net.fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
  });
  if (!answer.ok)
    throw new Error('HTTP ' + answer.status + ' for ' + path.basename(new URL(url).pathname));
  const text = await answer.text();
  if (text.length > MANIFEST_MAX_BYTES) throw new Error('the manifest is too big');
  return text;
}

/** Reads the signed manifest of the version electron-updater found and compares it with what it found. '' = it is the signed one. */
async function verifyAvailable(info) {
  if (!feed || !/^[0-9A-Za-z.+-]{1,40}$/.test(String(info.version)))
    return 'the version is not valid';
  const base =
    feed.base ||
    'https://github.com/' +
      GITHUB.owner +
      '/' +
      GITHUB.repo +
      '/releases/download/v' +
      info.version +
      '/';
  const found = {
    version: info.version,
    sha512: info.sha512 || (info.files && info.files[0] && info.files[0].sha512) || '',
  };
  const text = await fetchSmall(base + feed.name, feed.headers);
  manualFile = MANUAL ? dmgOf(text) : null;
  if (manualFile) manualFile.base = base;
  // the signature is the last line of the manifest; only a release older than that has it in a file of its own
  const signature = verify.splitSigned(text)
    ? ''
    : await fetchSmall(base + feed.name + '.sig', feed.headers);
  return verify.checkAgainstManifest(found, text, signature);
}

function onAvailable(info) {
  log('available ' + info.version);
  if (devFeed()) {
    accept(info);
    return;
  }
  verifyAvailable(info).then(
    function done(reason) {
      if (reason) refuse(reason);
      else accept(info);
    },
    function failed(error) {
      refuse(describe(error));
    },
  );
}

/** ! The update is not the signed one (or its signature cannot be read): it is never offered. */
function refuse(reason) {
  log('refused the update: ' + reason);
  trusted = '';
  setState({
    status: 'error',
    version: '',
    error: 'The update could not be verified: ' + reason,
    lastCheck: Date.now(),
  });
}

function accept(info) {
  trusted = info.version;
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
  runCheck();
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
  prepareFeed();
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

/** The folder where electron-updater keeps what it downloads (the same rule as electron-updater). */
function updaterCacheDir() {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const name = require('../package.json').name;
  return base && /^[a-z0-9-]{3,80}$/.test(name) ? path.join(base, name + '-updater') : '';
}

/**
 * After an update (the version is not the one of the last run) the installer that was downloaded is deleted: it is 100 MB the
 * person no longer needs. Only that folder, only when the app is installed.
 */
function cleanAfterUpdate() {
  if (!app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), 'last-version.txt');
  let last = '';
  try {
    last = fs.readFileSync(marker, 'utf8').trim();
  } catch (error) {
    last = '';
  }
  if (last !== '' && last !== app.getVersion()) {
    const folder = updaterCacheDir();
    if (folder) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
        log('deleted the downloaded installer');
      } catch (error) {
        log('could not delete the downloaded installer: ' + describe(error));
      }
    }
  }
  try {
    fs.writeFileSync(marker, app.getVersion());
  } catch (error) {
    log('could not save the version: ' + describe(error));
  }
}

/** Opens the commands and starts looking for updates. Safe to call when updates are off. */
function start(window, isAppAddressFn, serverOriginValue) {
  mainWindow = window;
  isAppAddress = isAppAddressFn;
  serverOrigin = /^https:\/\/[^/]+$/.test(serverOriginValue || '') ? serverOriginValue : '';
  cleanAfterUpdate();
  state = { ...state, settings: loadSettings() };
  ipcMain.handle('updates:get', handleGet);
  ipcMain.handle('updates:check', handleCheck);
  ipcMain.handle('updates:download', handleDownload);
  ipcMain.handle('updates:install', handleInstall);
  ipcMain.handle('updates:settings', handleSettings);
  ipcMain.handle('updates:beta-token', handleBetaToken);
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
