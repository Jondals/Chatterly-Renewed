/**
 * desktop/src/main.cjs
 * The Electron shell of Chatterly-Renewed for Windows (and, with the same code, macOS and Linux later).
 * * Closing the window closes the app. There is no tray and nothing stays running in the background.
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
  screen,
  session,
  shell,
  desktopCapturer,
  dialog,
  ipcMain,
} = require('electron');
const path = require('node:path');
const { parseServerUrl } = require('./server-url.cjs');
const bundle = require('./bundle.cjs');
const graphics = require('./graphics.cjs');
const overlay = require('./overlay.cjs');
const updater = require('./updater.cjs');
const { trace } = require('./trace.cjs');
const windowState = require('./window-state.cjs');

const RETRY_MS = 5000;
/** Permissions the app itself may use. Anything else (geolocation, midi, usb, ...) is refused. */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'fullscreen',
  'clipboard-sanitized-write',
  // Reading the clipboard still needs a click of the person (the Paste button of a link field).
  'clipboard-read',
]);

/** On Windows the app draws its own bar at the top (the page draws it; Windows draws the buttons over it). */
const CUSTOM_TITLEBAR = process.platform === 'win32';
const TITLEBAR_HEIGHT = 36;
const TITLEBAR_COLORS = { color: '#06070b', symbolColor: '#e8eaf2' };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

let serverUrl;
/** The folder with the packed web app, or null when the window loads the server (remote mode). */
let webDir = null;
/** The origin of the pages of the app: app://chatterly when bundled, the server itself when remote. */
let appOrigin = '';
/** What the person chose to share in the menu of the call: any, monitor (a screen) or window. Asked for before each capture. */
let screenSurface = 'any';
/** Whether the sound box of the picker starts ticked (set with the surface, from the menu of the call). */
let screenAudio = false;
let mainWindow = null;
/** The screen to share the person is choosing right now: what they may answer with, and how to answer the capture. */
let pendingPick = null;
let retryTimer = null;

// * The profile (the keys of the account, settings) lives in %APPDATA%\Chatterly, not under the package name. A copy run
//   from the source gets its own folder so it never shares a profile (or the single-instance lock) with the installed app.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath(
    'userData',
    path.join(app.getPath('appData'), app.isPackaged ? 'Chatterly' : 'Chatterly-dev'),
  );
}
/**
 * Chromium switches that open the app to someone who can start it: a debugging port, switches that turn off a protection
 * (certificate checks, the same-origin policy, the sandbox), or that send its traffic somewhere else. An installed app
 * refuses to start with any of them. The system proxy settings still work: only the explicit switches are refused.
 * ! Nothing in the installed app registers a protocol or a file type, so a web page cannot start it with arguments; this
 *   is a second lock for the case that something else on the computer does.
 */
const FORBIDDEN_SWITCHES = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-allow-origins',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'ignore-certificate-errors',
  'ignore-certificate-errors-spki-list',
  'disable-web-security',
  'allow-running-insecure-content',
  'disable-site-isolation-trials',
  'unsafely-treat-insecure-origin-as-secure',
  'no-sandbox',
  'disable-gpu-sandbox',
  'proxy-server',
  'proxy-pac-url',
  'proxy-bypass-list',
  'host-resolver-rules',
  'host-rules',
  'load-extension',
  'disable-extensions-except',
];
if (app.isPackaged) {
  const forbidden = FORBIDDEN_SWITCHES.filter(function isGiven(name) {
    return app.commandLine.hasSwitch(name);
  });
  if (forbidden.length > 0) {
    console.error('Chatterly refuses to start with: --' + forbidden.join(', --'));
    app.exit(2);
  }
}

/**
 * Tests only: CHATTERLY_TEST_QUIET=1 keeps every window out of sight (far off screen, not in the taskbar, never taking
 * the focus), so the tests can run while you work. ! An installed app ignores it.
 */
const QUIET = !app.isPackaged && process.env.CHATTERLY_TEST_QUIET === '1';
const QUIET_WINDOW = QUIET ? { x: -32000, y: -32000, skipTaskbar: true } : {};

// * How the graphics card is used (hardware acceleration and the graphics layer) is the choice of the person in Settings, read now
//   because Chromium decides it when it starts. It is a fixed list of values: see graphics.cjs.
const graphicsApplied = graphics.apply(app, process.platform);

// * Every renderer runs in the Chromium sandbox, also the ones created later.
app.enableSandbox();
// ! Must happen before the app is ready.
bundle.registerScheme();
// * Windows works out which windows are covered by others and slows those down; a call in a window that is behind
//   another one must not be slowed down (the same switch VS Code uses).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// * This is an app, not a web page: its sounds (the intro, the rings) play at once, without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
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
  if (QUIET) {
    mainWindow.showInactive();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Permissions and screen sharing ───────────────────────────────────────────────────────────────────

function onPermissionRequest(contents, permission, callback, details) {
  const fromApp = details.isMainFrame !== false && isAppOrigin(details.requestingUrl);
  callback(fromApp && ALLOWED_PERMISSIONS.has(permission));
}

function onPermissionCheck(contents, permission, requestingOrigin) {
  return isAppOrigin(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission);
}

/** True when the message comes from the main page of the app (not an embedded frame, not another window). */
function isMainPage(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const frame = event.senderFrame;
  return (
    event.sender === mainWindow.webContents &&
    Boolean(frame) &&
    frame === mainWindow.webContents.mainFrame &&
    isAppOrigin(frame.url)
  );
}

/**
 * The page tells the colors of its bar so the buttons of Windows match the theme.
 * ! Only the main page, and only two colors written as "#rrggbb": nothing else reaches the window.
 */
function onTitlebarColors(event, colors) {
  if (!CUSTOM_TITLEBAR || !isMainPage(event)) return false;
  if (
    !colors ||
    typeof colors !== 'object' ||
    typeof colors.color !== 'string' ||
    typeof colors.symbolColor !== 'string' ||
    !HEX_COLOR.test(colors.color) ||
    !HEX_COLOR.test(colors.symbolColor)
  ) {
    return false;
  }
  try {
    mainWindow.setTitleBarOverlay({
      color: colors.color,
      symbolColor: colors.symbolColor,
      height: TITLEBAR_HEIGHT,
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * ! Only the main page of the app may say what it is about to share, and only one of the known words. (A page that
 *   lies can only make the picker show screens instead of windows: it never gets a capture without the picker.)
 */
function onScreenSurface(event, surface, audio) {
  if (!isMainPage(event)) return false;
  // "A tab" is a browser idea: here it means a window. Anything that is not on the list means "ask for everything".
  if (surface === 'monitor' || surface === 'window') screenSurface = surface;
  else if (surface === 'browser') screenSurface = 'window';
  else screenSurface = 'any';
  // Whether the sound box of the picker starts ticked (anything that is not a plain true means no).
  screenAudio = audio === true;
  return true;
}

/** The graphics choice of the person, what this run uses, the layers that exist here and the state of the graphics card. */
function graphicsState() {
  const chosen = graphics.read(app.getPath('userData'), process.platform);
  const features = app.getGPUFeatureStatus();
  return {
    ...chosen,
    applied: graphicsApplied,
    backends: graphics.backendsFor(process.platform),
    restartRequired:
      chosen.hardwareAcceleration !== graphicsApplied.hardwareAcceleration ||
      chosen.backend !== graphicsApplied.backend,
    compositing: String(features.gpu_compositing || 'unknown'),
    webgl: String(features.webgl2 || 'unknown'),
  };
}

/** The page asks how the graphics are set. */
function onGraphicsGet(event) {
  return isMainPage(event) ? graphicsState() : null;
}

/** The page changes the graphics choice (it is checked and kept; it applies when the app starts again). */
function onGraphicsSet(event, value) {
  if (!isMainPage(event)) return null;
  graphics.write(app.getPath('userData'), process.platform, value);
  return graphicsState();
}

/** The page asks to start the app again so the graphics choice applies. */
function onGraphicsRestart(event) {
  if (!isMainPage(event)) return false;
  app.relaunch();
  app.exit(0);
  return true;
}

/** What the page needs to draw one source: its id, its name, whether it is a screen or a window, and a small picture. */
function pickItem(source) {
  return {
    id: source.id,
    name: source.name,
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumb: source.thumbnail.toDataURL(),
  };
}

/**
 * Asks the person, INSIDE the app (the page draws the menu), what to share: the screens and the windows with their pictures.
 * Resolves with { id, audio } (the source chosen and whether the sound box was ticked) or with null if cancelled. `kind` is the
 * tab to start in and `audio` the start state of the box.
 */
function pickSource(sources, kind, audio) {
  return new Promise(function executor(resolve) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve(null);
      return;
    }
    // Only one question at a time: a new one cancels the old one.
    if (pendingPick) pendingPick.resolve(null);
    pendingPick = { sources, resolve };
    mainWindow.webContents.send('screen:pick', { kind, audio, items: sources.map(pickItem) });
  });
}

/** The person chose a source. ! Only the main page may answer, and only with an id it was given. */
function onPickChoose(event, sourceId, withAudio) {
  if (!isMainPage(event) || !pendingPick) return false;
  const pick = pendingPick;
  const known = pick.sources.some(function isKnown(source) {
    return source.id === sourceId;
  });
  if (!known) return false;
  pendingPick = null;
  pick.resolve({ id: sourceId, audio: withAudio === true });
  return true;
}

/** The person closed the menu without choosing. */
function onPickCancel(event) {
  if (!isMainPage(event) || !pendingPick) return false;
  const pick = pendingPick;
  pendingPick = null;
  pick.resolve(null);
  return true;
}

/** Of the screens that can be captured, the one the app window is on (the first one when that cannot be told). */
function nearestScreen(sources) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const match = sources.find(function onDisplay(source) {
      return source.display_id === String(display.id);
    });
    if (match) return match;
  }
  return sources[0];
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
    // * What the person chose in the menu of the call decides what is offered; with one screen and "a screen" chosen
    //   there is nothing left to ask, so it is shared at once.
    const surface = screenSurface;
    const audio = screenAudio;
    screenSurface = 'any';
    screenAudio = false;
    const wantsScreen = surface === 'monitor';
    const sources = await desktopCapturer.getSources({
      types: wantsScreen ? ['screen'] : surface === 'window' ? ['window'] : ['screen', 'window'],
      // * A screen shared at once is never drawn, so it needs no picture.
      thumbnailSize: wantsScreen ? { width: 0, height: 0 } : { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    let picked = null;
    if (wantsScreen && sources.length > 0) {
      // * "A screen" was chosen in the menu of the call: nothing is left to ask. The screen the app is on is the one shared.
      picked = { id: nearestScreen(sources).id, audio };
    } else if (sources.length > 0) {
      // A window has to be told apart from the others, so only then (or when the menu said "anything") the person picks.
      picked = await pickSource(sources, surface === 'window' ? 'window' : 'screen', audio);
    }
    const source = picked
      ? sources.find(function byId(candidate) {
          return candidate.id === picked.id;
        })
      : null;
    if (!source) {
      answer({});
      return;
    }
    // ? The sound is the sound of the computer (Windows cannot give the sound of one window alone). It is given only
    //   when the page asked for audio.
    answer(
      picked.audio && request.audioRequested
        ? { video: source, audio: 'loopback' }
        : { video: source },
    );
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

// ── Window and menu ─────────────────────────────────────────────────────────────────────────────────────

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

function onReadyToShow() {
  trace('ready-to-show');
  showMainWindow();
}

function onDomReady() {
  trace('dom-ready');
}

function onFinishLoad() {
  trace('did-finish-load');
  traceSharpness();
}

/**
 * Diagnostic for a blurry window (only with CHATTERLY_TRACE, otherwise it does nothing): screen scale, window placement,
 * page zoom, actual font settings and loaded font faces. It does not change the graphics or rendering settings.
 */
function traceSharpness() {
  if (!process.env.CHATTERLY_TRACE || !mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  const bounds = mainWindow.getBounds();
  const here = screen.getDisplayMatching(bounds);
  trace(
    'sharp-displays ' +
      screen
        .getAllDisplays()
        .map(function describe(display) {
          return (
            display.id +
            ':' +
            display.scaleFactor +
            'x@' +
            display.size.width +
            'x' +
            display.size.height
          );
        })
        .join(' '),
  );
  trace(
    'sharp-window dip=' +
      bounds.x +
      ',' +
      bounds.y +
      '+' +
      bounds.width +
      'x' +
      bounds.height +
      ' px=' +
      bounds.x * here.scaleFactor +
      ',' +
      bounds.y * here.scaleFactor +
      '+' +
      bounds.width * here.scaleFactor +
      'x' +
      bounds.height * here.scaleFactor +
      ' screen=' +
      here.scaleFactor +
      'x zoom=' +
      contents.getZoomFactor(),
  );
  contents
    .executeJavaScript(
      '(function () { return document.fonts.ready.then(function () { const body = getComputedStyle(document.body); const root = getComputedStyle(document.documentElement); return { ratio: devicePixelRatio, inner: innerWidth + "x" + innerHeight, viewportScale: visualViewport.scale, fontSizePreference: root.getPropertyValue("--font-size"), rootFontSize: root.fontSize, bodyFontSize: body.fontSize, uiFont: body.fontFamily, fontLoad: document.fonts.status, customUiFontLoaded: document.fonts.check("400 14px Chatterly Custom UI"), interRegularLoaded: document.fonts.check("400 14px Inter Variable"), interSemiboldLoaded: document.fonts.check("600 14px Inter Variable") }; }); })()',
    )
    .then(function report(page) {
      trace('sharp-page ' + JSON.stringify(page));
    })
    .catch(function ignore() {
      // The diagnostic must never break the app.
    });
}

/** Where the state of the window is kept. */
function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/** Writes how the window is left (maximized or where it is) when it closes. Tests keep their windows off screen: nothing is saved. */
function saveWindowState() {
  if (QUIET || !mainWindow || mainWindow.isDestroyed()) return;
  windowState.save(windowStatePath(), {
    maximized: mainWindow.isMaximized(),
    bounds: mainWindow.getNormalBounds(),
  });
}

function createWindow() {
  const saved = windowState.load(windowStatePath());
  const workAreas = screen.getAllDisplays().map(function workArea(display) {
    return display.workArea;
  });
  const bounds = windowState.fitBounds(saved.bounds, workAreas);
  mainWindow = new BrowserWindow({
    ...QUIET_WINDOW,
    ...(bounds && !QUIET ? bounds : {}),
    width: bounds ? bounds.width : 1280,
    height: bounds ? bounds.height : 800,
    minWidth: 360,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#06070b',
    title: 'Chatterly',
    // The bar is drawn by the page; Windows draws minimize, maximize and close over it (and keeps its snap layouts).
    ...(CUSTOM_TITLEBAR
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { ...TITLEBAR_COLORS, height: TITLEBAR_HEIGHT },
        }
      : {}),
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
      // * Compile and cache the scripts of the app from the first start, not after they prove to be used often.
      v8CacheOptions: 'bypassHeatCheck',
      // * Bundled: the page learns the API address from the preload (window.CHATTERLY_API), nothing else.
      additionalArguments: [
        ...(webDir ? ['--chatterly-api=' + serverUrl.origin] : []),
        ...(CUSTOM_TITLEBAR ? ['--chatterly-titlebar=' + TITLEBAR_HEIGHT] : []),
      ],
      // * A call must keep its timers and its key rotation while the window is behind other windows or minimized.
      backgroundThrottling: false,
    },
  });
  // * First start: maximized, and it stays so until the person restores it (then it opens as they left it).
  trace(saved.maximized ? 'window-mode maximized' : 'window-mode normal');
  if (saved.maximized && !QUIET) mainWindow.maximize();
  mainWindow.on('close', saveWindowState);
  mainWindow.once('ready-to-show', onReadyToShow);
  mainWindow.webContents.once('dom-ready', onDomReady);
  mainWindow.webContents.once('did-finish-load', onFinishLoad);
  trace('window-created');
  mainWindow.webContents.on('did-fail-load', onFailLoad);
  loadApp();
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

function onWillQuit() {
  overlay.stop();
}

function onWindowAllClosed() {
  // * Closing the window closes the app: nothing keeps running in the background.
  app.quit();
}

async function start() {
  trace('main-loaded');
  await app.whenReady();
  trace('app-ready');
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
  ipcMain.handle('screen:surface', onScreenSurface);
  ipcMain.handle('screen:choose', onPickChoose);
  ipcMain.handle('screen:cancel', onPickCancel);
  ipcMain.handle('window:titlebar', onTitlebarColors);
  ipcMain.handle('graphics:get', onGraphicsGet);
  ipcMain.handle('graphics:set', onGraphicsSet);
  ipcMain.handle('graphics:restart', onGraphicsRestart);
  ses.setPermissionRequestHandler(onPermissionRequest);
  ses.setPermissionCheckHandler(onPermissionCheck);
  ses.setDisplayMediaRequestHandler(onDisplayMediaRequest, {
    useSystemPicker: false,
  });

  createMenu();
  createWindow();
  updater.start(mainWindow, isAppOrigin, serverUrl.origin);
  overlay.start(mainWindow, isAppOrigin, app.getPath('userData'), QUIET);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', onSecondInstance);
  app.on('web-contents-created', onWebContentsCreated);
  app.on('activate', onActivate);
  app.on('window-all-closed', onWindowAllClosed);
  app.on('will-quit', onWillQuit);
  start();
}
