/**
 * desktop/test/desktop.mjs
 * The test of the desktop shell (Electron). It checks the SHELL, not the chat: the end-to-end behaviour of the app is
 * covered by the main test (pnpm test at the root), which loads the same web code.
 *
 *   pnpm --dir desktop test
 *
 * What it does:
 *   1. Reads the source and fails if a dangerous setting appears (no sandbox, Node in the page, webview, arrow functions...).
 *   2. Checks the rule for the server address (https only when packaged).
 *   3. Starts the real Electron app against a tiny local server and checks, with the app running: the page cannot reach
 *      Node, navigation and pop-ups cannot leave the app, permissions go only to the app itself (not to an embedded
 *      frame), camera and microphone work, screen sharing goes through the picker, closing the window closes the app, a second
 *      copy does not start, and an unreachable server shows the offline page and recovers by itself.
 *   4. The bundled mode: the web app inside the app, served as app://chatterly, and what that server refuses.
 *   5. The updater: it announces a newer version from a local feed, the page downloads and applies it, a wrong hash is refused.
 *   6. If a packaged build exists (pnpm --dir desktop dist), checks its fuses and that it starts.
 *   7. Deletes everything temporary.
 *
 * ! Exit code 1 on any failure. Nothing opens in your browser: shell.openExternal is replaced while testing.
 */
import { _electron as electron } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');
const DESKTOP = path.resolve(import.meta.dirname, '..');
const SRC = path.join(DESKTOP, 'src');
const ELECTRON_EXE = require('electron');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterly-desktop-test-'));
const servers = [];
const apps = [];

const step = function (s) {
  return console.log('\n== ' + s);
};
const check = function (cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok  ' + msg);
};
function sleep(ms) {
  return new Promise(function executor(resolve) {
    setTimeout(resolve, ms);
  });
}
/** Waits until fn() is truthy (or throws after the time). */
async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error('FAILED: timed out waiting for ' + what);
}

function listen(handler, port = 0) {
  return new Promise(function executor(resolve, reject) {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', function onListening() {
      servers.push(server);
      resolve({ server, port: server.address().port });
    });
  });
}
function freePort() {
  return new Promise(function executor(resolve) {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', function onListening() {
      const port = probe.address().port;
      probe.close(function onClosed() {
        resolve(port);
      });
    });
  });
}

// ── 1. Source audit ──────────────────────────────────────────────────────────────────────────────────

function auditSource() {
  step('Source: no dangerous settings');
  const files = fs.readdirSync(SRC).filter(function isCode(name) {
    return name.endsWith('.cjs') || name.endsWith('.html');
  });
  const text = {};
  for (const name of files) text[name] = fs.readFileSync(path.join(SRC, name), 'utf8');
  const main = text['main.cjs'];

  for (const needed of [
    'sandbox: true',
    'contextIsolation: true',
    'nodeIntegration: false',
    'webSecurity: true',
  ]) {
    check(main.includes(needed), 'main.cjs sets ' + needed);
  }
  for (const banned of [
    'sandbox: false',
    'contextIsolation: false',
    'nodeIntegration: true',
    'webSecurity: false',
    'allowRunningInsecureContent: true',
    'webviewTag',
    'enableRemoteModule',
    'nodeIntegrationInWorker',
    'nodeIntegrationInSubFrames',
    'openDevTools',
    'ignore-certificate-errors',
    'disable-web-security',
  ]) {
    for (const name of Object.keys(text)) {
      // The list of refused switches in main.cjs names them on purpose; anywhere else they must not appear.
      const source = text[name].replace(/const FORBIDDEN_SWITCHES = \[[\s\S]*?\];/, '');
      check(!source.includes(banned), name + ' does not contain ' + banned);
    }
  }
  for (const refused of [
    'remote-debugging-port',
    'ignore-certificate-errors',
    'disable-web-security',
    'no-sandbox',
    'proxy-server',
    'host-resolver-rules',
  ]) {
    const listStart = main.indexOf('FORBIDDEN_SWITCHES = [');
    const list = main.slice(listStart, main.indexOf('];', listStart));
    check(
      listStart > 0 && list.includes("'" + refused + "'"),
      'an installed app refuses to start with --' + refused,
    );
  }
  check(main.includes('devTools: !app.isPackaged'), 'developer tools are off in a packaged app');
  check(
    main.split('shell.openExternal(').length === 2,
    'shell.openExternal is called from one place only (the guarded openExternal)',
  );
  for (const name of Object.keys(text).filter(function isCjs(n) {
    return n.endsWith('.cjs');
  })) {
    check(!/=>/.test(text[name]), name + ' has no arrow functions (project rule)');
  }
  const updaterSource = text['updater.cjs'];
  check(
    !updaterSource.includes('showMessageBox'),
    'the updater shows no native dialog: the app itself tells the person',
  );
  check(
    updaterSource.includes('autoDownload = false'),
    'nothing is downloaded unless the person asks',
  );
  check(
    updaterSource.includes('autoInstallOnAppQuit = false'),
    'nothing is installed just because the app closes',
  );
  check(
    (updaterSource.match(/isTrustedSender\(event\)/g) || []).length >= 4,
    'every update command checks who is asking',
  );
  check(
    updaterSource.includes('sanitizeSettings(patch, state.settings)'),
    'the settings sent by the page are checked against a fixed list of values',
  );
  check(
    !/new Tray|Tray,/.test(text['main.cjs']),
    'there is no tray: closing the window closes the app',
  );
  check(
    updaterSource.includes('!app.isPackaged ? process.env.CHATTERLY_UPDATE_URL'),
    'a packaged app ignores CHATTERLY_UPDATE_URL',
  );
  check(
    updaterSource.includes('quitAndInstall(true, true)'),
    'the update installs silently and the app starts again',
  );
  const preload = text['preload.cjs'];
  const allowedPageChannels = new Set([
    'updates:get',
    'updates:check',
    'updates:download',
    'updates:install',
    'updates:settings',
    'updates:state',
  ]);
  const usedChannels = [...preload.matchAll(/ipcRenderer\.\w+\('([^']+)'/g)].map(function name(m) {
    return m[1];
  });
  check(usedChannels.length > 0, 'the page preload talks to the main process');
  for (const channel of usedChannels) {
    check(
      allowedPageChannels.has(channel),
      'the page preload uses only a listed channel: ' + channel,
    );
  }
  check(
    !preload.slice(preload.indexOf('exposeInMainWorld(')).includes('ipcRenderer'),
    'the page preload never hands ipcRenderer itself to the page',
  );
  check(
    !/ipcRenderer\.(send|sendSync|postMessage)\(/.test(preload),
    'the page preload cannot send free messages',
  );
  const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map(function name(m) {
    return m[1];
  });
  check(
    exposed.sort().join(',') === 'CHATTERLY_API,chatterlyDesktop',
    'the page preload exposes only CHATTERLY_API and chatterlyDesktop',
  );
  check(
    (preload.match(/require\(/g) || []).length === 1 && preload.includes("require('electron')"),
    'the page preload requires nothing but electron',
  );
  const mainChannels = new Set();
  for (const name of ['main.cjs', 'updater.cjs']) {
    for (const m of text[name].matchAll(/ipcMain\.(?:handle|on|once)\('([^']+)'/g))
      mainChannels.add(m[1]);
  }
  check(
    [...mainChannels].sort().join(',') ===
      'picker:cancel,picker:choose,updates:check,updates:download,updates:get,updates:install,updates:settings',
    'the main process listens on exactly the expected channels: ' +
      [...mainChannels].sort().join(', '),
  );
  for (const name of Object.keys(text).filter(function isHtml(n) {
    return n.endsWith('.html');
  })) {
    check(/default-src 'none'/.test(text[name]), name + ' has a strict CSP');
    check(!/<script/i.test(text[name]), name + ' has no script tag');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
  const fuses = pkg.build.electronFuses;
  check(fuses.runAsNode === false, 'fuse: ELECTRON_RUN_AS_NODE is disabled');
  check(fuses.enableNodeOptionsEnvironmentVariable === false, 'fuse: NODE_OPTIONS is disabled');
  check(fuses.enableNodeCliInspectArguments === false, 'fuse: --inspect is disabled');
  check(fuses.onlyLoadAppFromAsar === true, 'fuse: the app loads only from the asar');
  check(fuses.enableEmbeddedAsarIntegrityValidation === true, 'fuse: asar integrity is checked');
  check(pkg.build.asar === true, 'the app is packed in an asar');
}

// ── 2. Server address rule ───────────────────────────────────────────────────────────────────────────

function auditServerUrl() {
  step('Server address rule');
  const { parseServerUrl, DEFAULT_URL } = require(path.join(SRC, 'server-url.cjs'));
  check(DEFAULT_URL.startsWith('https://'), 'the default server is https');
  check(
    parseServerUrl(undefined, true).href === new URL(DEFAULT_URL).href,
    'empty means the default',
  );
  check(
    parseServerUrl('https://example.org', true).origin === 'https://example.org',
    'https is accepted',
  );
  check(
    parseServerUrl('http://localhost:3000', false).port === '3000',
    'http localhost works unpackaged',
  );
  const refused = [
    ['http://example.org', false],
    ['http://localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['https://user:secret@example.org', true],
    ['ftp://example.org', false],
    ['javascript:alert(1)', false],
    ['file:///c:/windows', false],
    ['not an address', false],
  ];
  for (const [raw, packaged] of refused) {
    let failed = false;
    try {
      parseServerUrl(raw, packaged);
    } catch (error) {
      failed = true;
    }
    check(failed, 'refused: ' + raw + (packaged ? ' (packaged)' : ''));
  }
}

// ── 3. The running app ───────────────────────────────────────────────────────────────────────────────

/** The environment for a test run. ! ELECTRON_RUN_AS_NODE (set by some editors) would make Electron behave as plain Node. */
function appEnv(url) {
  const env = { ...process.env, CHATTERLY_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  // A test must not ask GitHub for updates.
  env.CHATTERLY_NO_UPDATE = '1';
  // ? desktop/web (made by pnpm dist) would switch an unpackaged run to bundled mode; these runs test the remote mode.
  env.CHATTERLY_MODE = 'remote';
  // The windows stay out of sight (far off screen, no focus) so the tests do not get in the way of your work.
  env.CHATTERLY_TEST_QUIET = '1';
  return env;
}

async function launch(url, userData) {
  const app = await electron.launch({
    executablePath: ELECTRON_EXE,
    args: [
      DESKTOP,
      '--user-data-dir=' + userData,
      // ! Fake devices only. --use-fake-ui-for-media-stream would auto-grant and skip the app's own permission handler.
      '--use-fake-device-for-media-stream',
    ],
    cwd: DESKTOP,
    env: appEnv(url),
    timeout: 30000,
  });
  apps.push(app);
  return app;
}

function stubPage(foreignOrigin) {
  return (
    '<!doctype html><meta charset="utf-8"><title>stub</title>' +
    '<button id="share">share</button>' +
    '<iframe id="f" allow="microphone; camera" src="' +
    foreignOrigin +
    '/frame"></iframe>' +
    '<script>document.getElementById("share").addEventListener("click", function () {' +
    'window.__share = navigator.mediaDevices.getDisplayMedia({ video: true }).then(' +
    'function (s) { return "tracks:" + s.getVideoTracks().length; },' +
    'function (e) { return e.name; });});</script>'
  );
}

async function runningApp() {
  step('Starting the app against a local server');
  const foreignHits = [];
  const frameResults = [];
  const foreign = await listen(function foreignHandler(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/result') {
      frameResults.push(url.searchParams.get('r'));
      res.end('ok');
      return;
    }
    foreignHits.push(url.pathname);
    res.setHeader('content-type', 'text/html');
    if (url.pathname === '/frame') {
      res.end(
        '<!doctype html><script>function report(r) { fetch("/result?r=" + encodeURIComponent(r)); }' +
          'navigator.mediaDevices.getUserMedia({ audio: true }).then(' +
          'function () { report("granted"); }, function (e) { report(e.name); });</script>',
      );
      return;
    }
    res.end('<!doctype html><title>foreign</title>');
  });
  const foreignOrigin = 'http://127.0.0.1:' + foreign.port;
  const appServer = await listen(function appHandler(req, res) {
    res.setHeader('content-type', 'text/html');
    res.end(stubPage(foreignOrigin));
  });
  const appOrigin = 'http://127.0.0.1:' + appServer.port;
  const userData = path.join(TMP, 'profile-main');
  const app = await launch(appOrigin, userData);
  const page = await app.firstWindow();
  await page.waitForURL(appOrigin + '/', { timeout: 20000 });
  check(true, 'the app opened and loaded the server address');

  step('Window settings in the running app');
  const prefs = await app.evaluate(function (electronModule) {
    const win = electronModule.BrowserWindow.getAllWindows()[0];
    return win.webContents.getLastWebPreferences();
  });
  check(prefs.sandbox === true, 'the page renderer is sandboxed');
  check(prefs.contextIsolation === true, 'context isolation is on');
  check(prefs.nodeIntegration === false, 'Node integration is off');
  check(prefs.webSecurity !== false, 'web security is on');

  step('The page cannot reach Node');
  const world = await page.evaluate(function () {
    return {
      require: typeof require,
      process: typeof process,
      module: typeof module,
      buffer: typeof Buffer,
      ipc: typeof window.ipcRenderer,
      apiAddress: typeof window.CHATTERLY_API,
      api: window.chatterlyDesktop ? Object.keys(window.chatterlyDesktop).sort().join(',') : '',
      isDesktop: window.chatterlyDesktop ? window.chatterlyDesktop.isDesktop : null,
    };
  });
  check(world.require === 'undefined', 'no require in the page');
  check(world.process === 'undefined', 'no process in the page');
  check(world.module === 'undefined', 'no module in the page');
  check(world.buffer === 'undefined', 'no Buffer in the page');
  check(world.ipc === 'undefined', 'no ipcRenderer in the page');
  check(world.apiAddress === 'undefined', 'remote mode does not inject an API address');
  check(
    world.api === 'isDesktop,platform,updates',
    'the page sees only isDesktop, platform and the update commands',
  );
  check(world.isDesktop === true, 'the page can tell it runs in the desktop app');
  const tampered = await page.evaluate(function () {
    try {
      window.chatterlyDesktop.isDesktop = false;
    } catch (error) {
      // frozen objects may throw in strict mode
    }
    return window.chatterlyDesktop.isDesktop;
  });
  check(tampered === true, 'the page cannot change the desktop API');

  step('Permissions');
  const tracks = await page.evaluate(async function () {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const count = stream.getTracks().length;
    stream.getTracks().forEach(function stop(track) {
      track.stop();
    });
    return count;
  });
  check(tracks === 2, 'the app can use the microphone and the camera');
  const geo = await page.evaluate(function () {
    return new Promise(function executor(resolve) {
      navigator.geolocation.getCurrentPosition(
        function granted() {
          resolve('granted');
        },
        function denied(error) {
          resolve('code' + error.code);
        },
      );
    });
  });
  check(geo === 'code1', 'location is refused');
  const notifications = await page.evaluate(function () {
    return Notification.requestPermission();
  });
  check(notifications === 'granted', 'notifications are allowed for the app');
  await waitFor(function hasFrameResult() {
    return frameResults.length > 0;
  }, 'the embedded frame to report');
  check(
    frameResults[0] !== 'granted',
    'an embedded frame from another site is refused the microphone (' + frameResults[0] + ')',
  );

  step('Screen sharing goes through the picker');
  const screens = await app.evaluate(async function (electronModule) {
    const list = await electronModule.desktopCapturer.getSources({ types: ['screen'] });
    return list.length;
  });
  if (screens === 0) {
    console.log('  SKIPPED: this machine has no screen to capture');
  } else {
    const [picker] = await Promise.all([app.waitForEvent('window'), page.click('#share')]);
    await picker.waitForSelector('.card', { timeout: 10000 });
    const cards = await picker.locator('.card').count();
    check(cards > 0, 'the picker lists ' + cards + ' source(s)');
    await picker.locator('.card').first().click();
    const shared = await page.evaluate(function () {
      return window.__share;
    });
    check(shared === 'tracks:1', 'choosing a source gives the page one video track');
    const [second] = await Promise.all([app.waitForEvent('window'), page.click('#share')]);
    await second.waitForSelector('#cancel', { timeout: 10000 });
    await second.click('#cancel');
    const cancelled = await page.evaluate(function () {
      return window.__share;
    });
    check(
      !String(cancelled).startsWith('tracks'),
      'cancelling gives the page no video (' + cancelled + ')',
    );
  }

  // ? Navigation checks come after the others on purpose: a blocked navigation leaves Playwright waiting for it to
  //   finish, which would stall every later click on the page.
  step('Navigation and pop-ups cannot leave the app');
  await app.evaluate(function (electronModule) {
    globalThis.__opened = [];
    Object.defineProperty(electronModule.shell, 'openExternal', {
      configurable: true,
      writable: true,
      value: function (address) {
        globalThis.__opened.push(address);
        return Promise.resolve();
      },
    });
  });
  await page.evaluate(function (address) {
    window.location.href = address;
  }, foreignOrigin + '/nav');
  await sleep(800);
  check(page.url() === appOrigin + '/', 'a page navigation to another site is blocked');
  check(!foreignHits.includes('/nav'), 'the other site received no request');
  const popup = await page.evaluate(function (address) {
    return window.open(address) === null;
  }, foreignOrigin + '/popup');
  check(popup === true, 'window.open returns nothing (denied)');
  await sleep(300);
  check(app.windows().length === 1, 'no extra Electron window was created');
  const opened = await app.evaluate(function () {
    return globalThis.__opened;
  });
  check(
    opened.includes(foreignOrigin + '/nav') && opened.includes(foreignOrigin + '/popup'),
    'both links went to the default browser instead',
  );
  check(!foreignHits.includes('/popup'), 'the pop-up address was not loaded inside the app');

  step('Only one copy of the app runs');
  const again = spawnSync(ELECTRON_EXE, [DESKTOP, '--user-data-dir=' + userData], {
    env: appEnv(appOrigin),
    timeout: 20000,
  });
  check(!again.error, 'a second copy ended by itself');
  check(again.status === 0, 'a second copy exits cleanly');
  check(page.url() === appOrigin + '/', 'the first copy is still running');

  step('Closing the window closes the app');
  const exited = new Promise(function executor(resolve) {
    app.process().once('exit', resolve);
  });
  await app.evaluate(function (electronModule) {
    electronModule.BrowserWindow.getAllWindows()[0].close();
  });
  const outcome = await Promise.race([
    exited.then(function done() {
      return 'exited';
    }),
    sleep(10000).then(function late() {
      return 'still running';
    }),
  ]);
  check(
    outcome === 'exited',
    'closing the window ends the process (nothing stays in the background)',
  );
}

async function offlineApp() {
  step('An unreachable server shows the offline page and recovers');
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const app = await launch(origin, path.join(TMP, 'profile-offline'));
  const page = await app.firstWindow();
  await page.waitForSelector("text=Can't reach the server", { timeout: 20000 });
  check(true, 'the offline page is shown while the server is down');
  await listen(function handler(req, res) {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>back</title><p id="ok">server is back</p>');
  }, port);
  await page.waitForSelector('#ok', { timeout: 20000 });
  check(page.url() === origin + '/', 'the app loads the server by itself when it comes back');
  await app.close();
}

/** Bundled mode: the web app lives inside the app and is served as app://chatterly. */
async function bundledApp() {
  step('Bundled web app (app://chatterly)');
  const webDir = path.join(TMP, 'bundle-web');
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(
    path.join(webDir, 'index.html'),
    '<!doctype html><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' wss:">' +
      '<title>bundle</title><div id="r">no js</div><script src="/main-ABCDEFGH.js"></script>',
  );
  fs.writeFileSync(
    path.join(webDir, 'main-ABCDEFGH.js'),
    'document.getElementById("r").textContent = "js ran";',
  );
  // A file next to the web folder that must never be reachable.
  fs.writeFileSync(path.join(TMP, 'secret.txt'), 'TOP-SECRET');
  const api = await listen(function apiHandler(req, res) {
    res.end('api');
  });
  const apiOrigin = 'http://127.0.0.1:' + api.port;
  const env = appEnv(apiOrigin);
  env.CHATTERLY_WEB_DIR = webDir;
  delete env.CHATTERLY_MODE;
  const app = await electron.launch({
    executablePath: ELECTRON_EXE,
    args: [
      DESKTOP,
      '--user-data-dir=' + path.join(TMP, 'profile-bundle'),
      '--use-fake-device-for-media-stream',
    ],
    cwd: DESKTOP,
    env,
    timeout: 30000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.waitForURL('app://chatterly/', { timeout: 20000 });
  check(true, 'the window shows the packed web app at app://chatterly');
  await page.waitForFunction(function () {
    return document.getElementById('r').textContent === 'js ran';
  });
  check(true, 'its script runs under the page CSP');
  const facts = await page.evaluate(async function () {
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    const db = await new Promise(function executor(resolve) {
      const request = indexedDB.open('bundle-probe');
      request.onsuccess = function onOk() {
        request.result.close();
        resolve(true);
      };
      request.onerror = function onFail() {
        resolve(false);
      };
    });
    return {
      api: window.CHATTERLY_API,
      csp,
      secure: window.isSecureContext,
      subtle: typeof crypto.subtle,
      db,
      node: typeof require + ',' + typeof process,
    };
  });
  check(facts.api === apiOrigin, 'window.CHATTERLY_API is the server address');
  check(
    facts.csp.includes("connect-src 'self' " + apiOrigin),
    'the CSP of index.html allows the API address',
  );
  check(facts.secure === true, 'app:// is a secure context');
  check(facts.subtle === 'object', 'WebCrypto is available');
  check(facts.db === true, 'IndexedDB opens');
  check(facts.node === 'undefined,undefined', 'the bundled page cannot reach Node either');

  step('Bundled web app: what the protocol serves and refuses');
  const probe = await page.evaluate(async function () {
    async function get(url, init) {
      const res = await fetch(url, init);
      return {
        status: res.status,
        type: res.headers.get('content-type'),
        cache: res.headers.get('cache-control'),
        text: await res.text(),
      };
    }
    return {
      script: await get('/main-ABCDEFGH.js'),
      deep: await get('/direct/some-chat'),
      missing: await get('/missing.js'),
      wellKnown: await get('/.well-known/anything'),
      encodedDots: await get('/..%2fsecret.txt'),
      backslash: await get('/..%5csecret.txt'),
      collapsed: await get('/%2e%2e/secret.txt'),
      post: await get('/', { method: 'POST' }),
    };
  });
  check(
    probe.script.status === 200 && probe.script.type.startsWith('text/javascript'),
    'a script is served as JavaScript',
  );
  check(probe.script.cache.includes('immutable'), 'a hashed file is cached for good');
  check(
    probe.deep.status === 200 && probe.deep.type.startsWith('text/html'),
    'an app route gets index.html',
  );
  check(probe.missing.status === 404, 'a missing file is a 404');
  check(probe.wellKnown.status === 404, '/.well-known is a 404');
  check(probe.post.status === 405, 'POST is refused');
  for (const name of ['encodedDots', 'backslash', 'collapsed']) {
    check(
      !probe[name].text.includes('TOP-SECRET'),
      'a path trying to leave the web folder gets nothing (' + name + ')',
    );
    check(
      [400, 403, 404].includes(probe[name].status),
      '... and is refused (' + name + ': ' + probe[name].status + ')',
    );
  }

  step('Bundled web app: permissions and links');
  await page.reload();
  check(
    page.url() === 'app://chatterly/',
    'a reload stays inside the app (not sent to the browser)',
  );
  const tracks = await page.evaluate(async function () {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const count = stream.getTracks().length;
    stream.getTracks().forEach(function stop(track) {
      track.stop();
    });
    return count;
  });
  check(tracks === 1, 'the bundled app can use the microphone');
  await app.evaluate(function (electronModule) {
    globalThis.__opened = [];
    Object.defineProperty(electronModule.shell, 'openExternal', {
      configurable: true,
      writable: true,
      value: function (address) {
        globalThis.__opened.push(address);
        return Promise.resolve();
      },
    });
  });
  await page.evaluate(function (address) {
    window.location.href = address;
  }, apiOrigin + '/elsewhere');
  await sleep(800);
  check(page.url() === 'app://chatterly/', 'the window never navigates away from app://chatterly');
  const opened = await app.evaluate(function () {
    return globalThis.__opened;
  });
  check(opened.includes(apiOrigin + '/elsewhere'), 'the link went to the default browser');
  await app.close();
}

/** Updates: the app tells the person, who downloads and applies the new version from inside the app. */
async function updatingApp() {
  step('Updates: the app notifies, the person downloads and applies');
  const feedDir = path.join(TMP, 'feed');
  fs.mkdirSync(feedDir, { recursive: true });
  const installer = Buffer.from('not a real installer, only bytes with a known hash');
  fs.writeFileSync(path.join(feedDir, 'Chatterly-Setup-2.99.0.exe'), installer);
  const sha512 = createHash('sha512').update(installer).digest('base64');
  function writeFeed(version, hash) {
    fs.writeFileSync(
      path.join(feedDir, 'latest.yml'),
      [
        'version: ' + version,
        'files:',
        '  - url: Chatterly-Setup-2.99.0.exe',
        '    sha512: ' + hash,
        '    size: ' + installer.length,
        'path: Chatterly-Setup-2.99.0.exe',
        'sha512: ' + hash,
        "releaseDate: '2026-01-01T00:00:00.000Z'",
        '',
      ].join('\n'),
    );
  }
  const feed = await listen(function feedHandler(req, res) {
    const file = path.join(feedDir, path.basename(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(fs.readFileSync(file));
  });
  const foreign = await listen(function foreignHandler(req, res) {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>foreign</title>');
  });
  const stub = await listen(function stubHandler(req, res) {
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><title>stub</title><iframe src="http://127.0.0.1:' +
        foreign.port +
        '/"></iframe>',
    );
  });

  /** Starts the app against the feed and returns what is needed to drive its update commands from the page. */
  async function open(label, version, hash, files = {}) {
    writeFeed(version, hash);
    const profile = path.join(TMP, 'profile-update-' + label.replace(/-again$/, ''));
    fs.mkdirSync(profile, { recursive: true });
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(profile, name), content);
    const env = appEnv('http://127.0.0.1:' + stub.port);
    delete env.CHATTERLY_NO_UPDATE;
    env.CHATTERLY_UPDATE_URL = 'http://127.0.0.1:' + feed.port;
    const app = await electron.launch({
      executablePath: ELECTRON_EXE,
      args: [DESKTOP, '--user-data-dir=' + profile],
      cwd: DESKTOP,
      env,
      timeout: 30000,
    });
    apps.push(app);
    const page = await app.firstWindow();
    await page.waitForURL('http://127.0.0.1:' + stub.port + '/');
    // The page records every state the app announces.
    await page.evaluate(function () {
      window.__states = [];
      window.chatterlyDesktop.updates.onState(function remember(state) {
        window.__states.push(state);
      });
    });
    async function state() {
      return page.evaluate(function () {
        return window.chatterlyDesktop.updates.getState();
      });
    }
    async function until(status, ms = 20000) {
      let last = null;
      try {
        return await waitFor(
          async function reached() {
            last = await state();
            return last.status === status ? last : null;
          },
          label + ' to reach ' + status,
          ms,
        );
      } catch (error) {
        throw new Error(error.message + ' (last state: ' + JSON.stringify(last) + ')');
      }
    }
    async function call(name) {
      return page.evaluate(function (command) {
        return window.chatterlyDesktop.updates[command]();
      }, name);
    }
    async function seen() {
      return page.evaluate(function () {
        return window.__states.map(function status(s) {
          return s.status;
        });
      });
    }
    async function log() {
      return (
        await app.evaluate(function () {
          return globalThis.__updaterLog || [];
        })
      ).join(' | ');
    }
    async function setSettings(patch) {
      return page.evaluate(function (value) {
        return window.chatterlyDesktop.updates.setSettings(value);
      }, patch);
    }
    return { app, page, state, until, call, seen, log, setSettings, profile };
  }

  // 1. A newer version: the app only tells.
  const good = await open('good', '2.99.0', sha512);
  const found = await good.until('available');
  check(
    found.version === '2.99.0',
    'a newer version in the feed is announced to the page (' + found.version + ')',
  );
  await sleep(2500);
  check((await good.state()).status === 'available', 'it waits: nothing is downloaded by itself');
  check(
    !(await good.log()).includes('downloaded'),
    'no download started without the person asking',
  );

  // 2. The person downloads it: progress, then ready.
  await good.call('download');
  const ready = await good.until('ready');
  check(ready.percent === 100, 'the download finishes and the page is told it is ready');
  const statuses = await good.seen();
  check(
    statuses.includes('downloading') && statuses.includes('ready'),
    'the page heard downloading, then ready (' + statuses.join(', ') + ')',
  );

  // 3. The person applies it.
  await good.call('install');
  await waitFor(
    async function logged() {
      return (await good.log()).includes('would restart to install');
    },
    'the restart request',
    10000,
  );
  check(true, 'applying asks the app to restart and install (not done in development)');

  // 4. An embedded frame from another site cannot use the commands.
  const frame = good.page.frames().find(function isForeign(f) {
    return f.url().startsWith('http://127.0.0.1:' + foreign.port);
  });
  check(Boolean(frame), 'the stub page embeds a frame from another site');
  const inFrame = await frame.evaluate(function () {
    return typeof window.chatterlyDesktop + ',' + typeof window.CHATTERLY_API;
  });
  check(
    inFrame === 'undefined,undefined',
    'an embedded frame from another site has no update commands',
  );
  await good.app.close();

  // 5. A download whose hash does not match is refused and reported.
  const tampered = await open('tampered', '2.99.0', 'A'.repeat(86) + '==');
  await tampered.until('available');
  await tampered.call('download');
  const failed = await tampered.until('error');
  check(
    /sha512|checksum/i.test(failed.error),
    'a wrong hash is refused, with a clear message (' + failed.error.slice(0, 80) + ')',
  );
  check(!(await tampered.seen()).includes('ready'), 'a refused file never becomes ready');
  await tampered.call('install');
  check(!(await tampered.log()).includes('would restart'), 'a refused file cannot be applied');
  await tampered.app.close();

  // 6. Already on the latest version: only a manual check says so.
  const same = await open('same', '2.24.0', sha512);
  await same.until('idle');
  check(!(await same.seen()).includes('available'), 'on the latest version nothing is announced');
  await same.call('check');
  await same.until('none');
  check(true, 'a manual check says it is up to date');
  check((await same.state()).lastCheck > 0, 'the time of the last check is reported to the page');
  await same.app.close();

  // 7. The choices of the person: defaults, valid changes, refused values, kept after restarting.
  step('Updates: how often to look and whether to tell');
  const prefs = await open('prefs', '2.99.0', sha512);
  await prefs.until('available');
  const defaults = (await prefs.state()).settings;
  check(
    defaults.interval === '6h' && defaults.notify === true,
    'by default it looks every 6 hours and tells the person',
  );
  const changed = await prefs.setSettings({ interval: '1h', notify: false });
  check(
    changed.settings.interval === '1h' && changed.settings.notify === false,
    'valid choices are accepted',
  );
  const saved = JSON.parse(
    fs.readFileSync(path.join(prefs.profile, 'update-settings.json'), 'utf8'),
  );
  check(
    saved.interval === '1h' && saved.notify === false,
    'the choices are saved in the profile folder',
  );
  const refused = [
    { interval: 'banana' },
    { interval: 5 },
    { interval: '1h', evil: true },
    { notify: 'yes' },
    { toString: 'x' },
    [],
    null,
    'interval',
    { interval: '__proto__' },
    { interval: 'constructor' },
  ];
  for (const bad of refused) {
    const after = await prefs.setSettings(bad);
    check(
      after.settings.interval === '1h' && after.settings.notify === false,
      'a value that is not on the list is refused: ' + JSON.stringify(bad),
    );
  }
  await prefs.app.close();
  const again = await open('prefs-again', '2.99.0', sha512);
  await again.until('available');
  const kept = (await again.state()).settings;
  check(kept.interval === '1h' && kept.notify === false, 'the choices are kept after restarting');
  await again.app.close();

  // "Only when I ask": the app does not look by itself, not even at start.
  const manual = await open('manual', '2.99.0', sha512, {
    'update-settings.json': JSON.stringify({ interval: 'never', notify: true }),
  });
  await sleep(3000);
  check(
    (await manual.state()).status === 'idle',
    'with "only when I ask" it does not check at start',
  );
  check(!(await manual.log()).includes('available'), '... and it found nothing by itself');
  await manual.call('check');
  await manual.until('available');
  check(true, '... but a manual check finds the new version');
  await manual.app.close();

  // A damaged file does not stop the app: the defaults are used.
  const damaged = await open('damaged', '2.99.0', sha512, {
    'update-settings.json': '{ this is not json',
  });
  await damaged.until('available');
  const fallback = (await damaged.state()).settings;
  check(
    fallback.interval === '6h' && fallback.notify === true,
    'a damaged settings file falls back to the defaults',
  );
  await damaged.app.close();
}

/** The packaged exe (pnpm --dir desktop dist): fuses are really set, and it starts and shows the offline page. */
async function packagedApp() {
  step('Packaged build');
  const exe = path.join(DESKTOP, 'dist', 'win-unpacked', 'Chatterly.exe');
  if (process.platform !== 'win32' || !fs.existsSync(exe)) {
    console.log('  SKIPPED: no packaged build here (run: pnpm --dir desktop dist)');
    return;
  }
  const wire = await getCurrentFuseWire(exe);
  // The fuse wire stores each fuse as the character '1' (enabled) or '0' (disabled).
  const on = '1'.charCodeAt(0);
  const off = '0'.charCodeAt(0);
  check(wire[FuseV1Options.RunAsNode] === off, 'packaged: ELECTRON_RUN_AS_NODE is off');
  check(
    wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable] === off,
    'packaged: NODE_OPTIONS is off',
  );
  check(wire[FuseV1Options.EnableNodeCliInspectArguments] === off, 'packaged: --inspect is off');
  check(
    wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === on,
    'packaged: asar integrity is checked',
  );
  check(wire[FuseV1Options.OnlyLoadAppFromAsar] === on, 'packaged: loads only from the asar');
  check(wire[FuseV1Options.EnableCookieEncryption] === on, 'packaged: cookies are encrypted');
  check(
    wire[FuseV1Options.GrantFileProtocolExtraPrivileges] === off,
    'packaged: file:// gets no extra privileges',
  );

  // An installed app refuses to start with switches that open it up (a debugging port, no certificate checks...).
  const debugPort = await freePort();
  const profile = path.join(TMP, 'profile-packaged');
  const refusedSwitches = [
    '--remote-debugging-port=' + debugPort,
    '--ignore-certificate-errors',
    '--disable-web-security',
    '--proxy-server=127.0.0.1:9',
    '--no-sandbox',
    '--host-resolver-rules=MAP * 127.0.0.1',
  ];
  for (const flag of refusedSwitches) {
    const run = spawnSync(exe, ['--user-data-dir=' + profile, flag], {
      env: appEnv('https://127.0.0.1:9'),
      timeout: 20000,
      windowsHide: true,
    });
    check(!run.error && run.status === 2, 'packaged: refuses to start with ' + flag.split('=')[0]);
  }
  let debugOpen = true;
  try {
    await fetch('http://127.0.0.1:' + debugPort + '/json/version');
  } catch (error) {
    debugOpen = false;
  }
  check(!debugOpen, 'packaged: no debugging port was opened');

  // Without those switches it starts from its asar and loads the web app packed inside it.
  const trace = path.join(TMP, 'packaged-trace.txt');
  const env = appEnv('https://127.0.0.1:' + (await freePort()));
  env.CHATTERLY_TRACE = trace;
  const child = spawn(exe, ['--user-data-dir=' + profile], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await waitFor(
      function loaded() {
        return fs.existsSync(trace) && fs.readFileSync(trace, 'utf8').includes('did-finish-load');
      },
      'the packaged app to load its web app',
      30000,
    );
    check(true, 'the packaged app starts from its asar and loads the web app packed inside it');
  } finally {
    // ! The whole tree: the packaged app has Chromium helper processes that keep files of the profile open.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
    await sleep(800);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────────

async function cleanup() {
  for (const app of apps) {
    try {
      await Promise.race([app.close(), sleep(5000)]);
    } catch (error) {
      // already closed
    }
    try {
      app.process().kill();
    } catch (error) {
      // already gone
    }
  }
  for (const server of servers) server.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

let failed = false;
try {
  auditSource();
  auditServerUrl();
  await runningApp();
  await offlineApp();
  await bundledApp();
  await updatingApp();
  await packagedApp();
  console.log('\nAll desktop checks passed.');
} catch (error) {
  failed = true;
  console.error('\n' + (error && error.stack ? error.stack : error));
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
