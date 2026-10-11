/**
 * desktop/src/main.cjs
 * The Electron shell of Chatterly-Renewed for Windows (and, with the same code, macOS and Linux later).
 *
 * * It is only a window around the web app: the encryption, the calls and the relay-only policy all run in the web
 *   code, exactly as in a browser. The shell adds nothing that can read messages and sends nothing anywhere.
 * ! Nothing here may open the door for the page to reach Node.js: sandbox, context isolation and no Node integration
 *   are required (desktop/test/desktop.mjs checks them), and the page only gets the tiny API of preload.cjs.
 * * The address of the server (the API) comes from CHATTERLY_URL, or the public site. A packaged build only accepts https.
 * * Two ways to show the web app: BUNDLED (the web build lives inside the app and is served as app://chatterly; the
 *   default for an installed app, see bundle.cjs) or REMOTE (the window loads the server itself; used while developing).
 */
'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
  desktopCapturer,
  dialog,
  ipcMain,
} = require('electron');
const path = require('node:path');
const { parseServerUrl } = require('./server-url.cjs');
const bundle = require('./bundle.cjs');
const updater = require('./updater.cjs');

const RETRY_MS = 5000;
/** Permissions the app itself may use. Anything else (geolocation, midi, usb, ...) is refused. */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'fullscreen',
  'clipboard-sanitized-write',
]);

let serverUrl;
/** The folder with the packed web app, or null when the window loads the server (remote mode). */
let webDir = null;
/** The origin of the pages of the app: app://chatterly when bundled, the server itself when remote. */
let appOrigin = '';
let mainWindow = null;
let pickerWindow = null;
let tray = null;
let quitting = false;
let retryTimer = null;

// * The profile (the keys of the account, settings) lives in %APPDATA%\Chatterly, not under the package name. A copy run
//   from the source gets its own folder so it never shares a profile (or the single-instance lock) with the installed app.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath(
    'userData',
    path.join(app.getPath('appData'), app.isPackaged ? 'Chatterly' : 'Chatterly-dev'),
  );
}
// * Every renderer runs in the Chromium sandbox, also the ones created later.
app.enableSandbox();
// ! Must happen before the app is ready.
bundle.registerScheme();
// ? The default user agent says "Electron" and the package name; the web app does not need either.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(chatterly-renewed-desktop|Chatterly)\/\S+/, '');

/** The origin of an address. ! URL gives "null" for app://, which would make every page of the bundled app foreign. */
function originOf(address) {
  const url = new URL(address);
  return url.protocol === bundle.SCHEME + ':' ? url.protocol + '//' + url.host : url.origin;
}

/** True when the address belongs to the app: its bundled pages, or the Chatterly server when remote. */
function isAppOrigin(address) {
  try {
    return originOf(address) === appOrigin;
  } catch (error) {
    return false;
  }
}

/**
 * Where the packed web app is: next to the code in an installed app. While developing, CHATTERLY_WEB_DIR may point to
 * a build (frontend/dist/frontend/browser); CHATTERLY_MODE=remote forces the window to load the server instead.
 * ! The override does not exist in a packaged app, so an environment variable cannot swap the code that holds the keys.
 */
function findWebDir() {
  if (!app.isPackaged && process.env.CHATTERLY_MODE === 'remote') return null;
  const candidates = [path.join(__dirname, '..', 'web')];
  if (!app.isPackaged && process.env.CHATTERLY_WEB_DIR) {
    candidates.unshift(path.resolve(process.env.CHATTERLY_WEB_DIR));
  }
  for (const dir of candidates) {
    if (bundle.hasWebApp(dir)) return dir;
  }
  return null;
}

/** Opens a link in the default browser, only for http(s). */
function openExternal(address) {
  try {
    const url = new URL(address);
    if (url.protocol === 'https:' || url.protocol === 'http:') shell.openExternal(url.href);
  } catch (error) {
    // The address was not valid: nothing to open.
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

// ── Permissions and screen sharing ───────────────────────────────────────────────────────────────────

function onPermissionRequest(contents, permission, callback, details) {
  const fromApp = details.isMainFrame !== false && isAppOrigin(details.requestingUrl);
  callback(fromApp && ALLOWED_PERMISSIONS.has(permission));
}

function onPermissionCheck(contents, permission, requestingOrigin) {
  return isAppOrigin(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission);
}

/** Shows the list of screens and windows and resolves with the chosen source id, or null if cancelled. */
function pickSource(sources) {
  return new Promise(function executor(resolve) {
    let settled = false;
    pickerWindow = new BrowserWindow({
      parent: mainWindow || undefined,
      modal: Boolean(mainWindow),
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'Share your screen',
      backgroundColor: '#06070b',
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
      },
    });
    const picker = pickerWindow;

    function finish(sourceId) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('picker:choose', onChoose);
      ipcMain.removeListener('picker:cancel', onCancel);
      if (!picker.isDestroyed()) picker.close();
      pickerWindow = null;
      resolve(sourceId);
    }
    function onChoose(event, sourceId) {
      // ! Only the picker window may answer, and only with an id it was given.
      if (event.sender !== picker.webContents) return;
      const known = sources.some(function isKnown(source) {
        return source.id === sourceId;
      });
      finish(known ? sourceId : null);
    }
    function onCancel(event) {
      if (event.sender === picker.webContents) finish(null);
    }
    function onClosed() {
      finish(null);
    }
    function onLoaded() {
      const list = sources.map(function toItem(source) {
        return { id: source.id, name: source.name, thumb: source.thumbnail.toDataURL() };
      });
      picker.webContents.send('picker:sources', list);
    }

    ipcMain.on('picker:choose', onChoose);
    ipcMain.on('picker:cancel', onCancel);
    picker.on('closed', onClosed);
    picker.webContents.on('did-finish-load', onLoaded);
    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

async function onDisplayMediaRequest(request, callback) {
  // * The callback can be used once, and it throws if the page went away meanwhile (for example on quit).
  let answered = false;
  function answer(streams) {
    if (answered) return;
    answered = true;
    try {
      callback(streams);
    } catch (error) {
      // The request no longer exists: nothing to answer.
    }
  }
  if (!isAppOrigin(request.securityOrigin)) {
    answer({});
    return;
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    const chosen = sources.length > 0 ? await pickSource(sources) : null;
    const source = sources.find(function byId(candidate) {
      return candidate.id === chosen;
    });
    // ? System audio is not shared: on Windows it would also capture the voices of the call and echo them to everyone.
    // TODO: share the audio of a single window once Electron can capture it without the call itself.
    answer(source ? { video: source } : {});
  } catch (error) {
    answer({});
  }
}

// ── Navigation lock ──────────────────────────────────────────────────────────────────────────────────

function onWillNavigate(event, address) {
  if (isAppOrigin(address)) return;
  event.preventDefault();
  openExternal(address);
}

function onWindowOpen(details) {
  openExternal(details.url);
  return { action: 'deny' };
}

function onWillAttachWebview(event) {
  event.preventDefault();
}

function onWebContentsCreated(event, contents) {
  contents.setWindowOpenHandler(onWindowOpen);
  contents.on('will-navigate', onWillNavigate);
  contents.on('will-redirect', onWillNavigate);
  contents.on('will-attach-webview', onWillAttachWebview);
}

// ── Window, tray and menu ────────────────────────────────────────────────────────────────────────────

function loadApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(webDir ? bundle.ORIGIN + '/' : serverUrl.href);
}

function onFailLoad(event, errorCode, errorDescription, validatedUrl, isMainFrame) {
  // -3 is "aborted": a new navigation replaced this one, not a failure.
  if (!isMainFrame || errorCode === -3 || !isAppOrigin(validatedUrl)) return;
  mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(loadApp, RETRY_MS);
}

function onWindowClose(event) {
  // * Closing the window keeps the app (and a running call) alive in the tray. The tray menu quits for real.
  if (quitting || !tray) return;
  event.preventDefault();
  mainWindow.hide();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#06070b',
    title: 'Chatterly',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
      // * Bundled: the page learns the API address from the preload (window.CHATTERLY_API), nothing else.
      additionalArguments: webDir ? ['--chatterly-api=' + serverUrl.origin] : [],
      // * A call must keep its timers and its key rotation while the window is hidden in the tray.
      backgroundThrottling: false,
    },
  });
  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.on('close', onWindowClose);
  mainWindow.webContents.on('did-fail-load', onFailLoad);
  loadApp();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Chatterly');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Chatterly', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: quitApp },
    ]),
  );
  tray.on('click', showMainWindow);
}

/** Zoom and edit shortcuts only. There is no entry for the developer tools. */
function createMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Start ────────────────────────────────────────────────────────────────────────────────────────────

function onSecondInstance() {
  showMainWindow();
}

function onActivate() {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showMainWindow();
}

function onWindowAllClosed() {
  // The tray keeps the app alive; without a tray there is nothing left to show.
  if (!tray && process.platform !== 'darwin') app.quit();
}

function onBeforeQuit() {
  quitting = true;
}

async function start() {
  await app.whenReady();
  try {
    serverUrl = parseServerUrl(process.env.CHATTERLY_URL, app.isPackaged);
  } catch (error) {
    dialog.showErrorBox('Chatterly', String(error.message));
    app.quit();
    return;
  }
  webDir = findWebDir();
  appOrigin = webDir ? bundle.ORIGIN : serverUrl.origin;
  if (process.platform === 'win32') app.setAppUserModelId('app.chatterly.renewed');

  const ses = session.defaultSession;
  if (webDir) bundle.install(ses, webDir, serverUrl.origin);
  ses.setPermissionRequestHandler(onPermissionRequest);
  ses.setPermissionCheckHandler(onPermissionCheck);
  ses.setDisplayMediaRequestHandler(onDisplayMediaRequest, { useSystemPicker: false });

  createMenu();
  createWindow();
  createTray();
  updater.start(mainWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', onSecondInstance);
  app.on('web-contents-created', onWebContentsCreated);
  app.on('activate', onActivate);
  app.on('window-all-closed', onWindowAllClosed);
  app.on('before-quit', onBeforeQuit);
  start();
}
