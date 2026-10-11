/**
 * test/e2e/22-desktop-app-with-the-web-app-inside.mjs
 * Desktop app (Electron) with the web app inside it.
 */
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND, ROOT, TMP, children, step, check, run, freePort, waitFor } from './support.mjs';

const DESKTOP = path.join(ROOT, 'desktop');

/** Desktop app (Electron) with the web app inside it: the real build and the real backend, sign-up included. */
export async function step22(world) {
  step('desktop app (Electron) with the web app inside it');
  const electronPackage = path.join(DESKTOP, 'node_modules', 'electron');
  if (!fs.existsSync(electronPackage)) {
    console.log('  SKIPPED: Electron is not installed (run: pnpm --dir desktop install)');
    return;
  }
  // The checks of the shell itself (sandbox, permissions, navigation, screen picker, the app:// server, the packaged build).
  run('node', [path.join('desktop', 'test', 'desktop.mjs')]);
  check(true, 'the desktop shell checks pass (desktop/test/desktop.mjs)');

  const electronExe = createRequire(path.join(DESKTOP, 'package.json'))('electron');

  // * A second backend that, like the real server, lets the origin of the desktop app in (CORS and WebSocket).
  const apiPort = await freePort();
  const API = `http://localhost:${apiPort}`;
  const tsx = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const backend = spawn(process.execPath, [tsx, 'src/index.ts'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      DATA_DIR: path.join(TMP, 'data-desktop'),
      CORS_ORIGINS: 'app://chatterly',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  });
  children.push(backend);
  await waitFor(API + '/api/rtc/config');

  const env = { ...process.env, CHATTERLY_URL: API, CHATTERLY_WEB_DIR: world.webDir };
  // ! Some editors set this, and Electron would then run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: electronExe,
    args: [
      DESKTOP,
      '--user-data-dir=' + path.join(TMP, 'profile-desktop'),
      '--use-fake-device-for-media-stream',
    ],
    cwd: DESKTOP,
    env,
    timeout: 30000,
  });
  const problems = [];
  const sockets = [];
  try {
    const page = await app.firstWindow();
    page.on('console', function (m) {
      if (m.type() === 'error') problems.push(m.text().slice(0, 300) + ' @ ' + m.location().url);
    });
    page.on('pageerror', function (e) {
      problems.push(e.message);
    });
    page.on('websocket', function (ws) {
      const record = { url: ws.url(), closed: false };
      ws.on('close', function () {
        record.closed = true;
      });
      sockets.push(record);
    });
    await page.waitForURL('app://chatterly/**', { timeout: 30000 });
    await page.goto('app://chatterly/register');
    const user = 'dave_' + world.suffix;
    await page.fill('input[name=username]', user);
    await page.fill('input[name=displayName]', 'dave');
    await page.fill('input[name=password]', 'a-long-desktop-pass-3');
    await page.fill('input[name=confirm]', 'a-long-desktop-pass-3');
    await page.click('button[type=submit]');
    try {
      await page.waitForURL('app://chatterly/direct', { timeout: 60000 });
    } catch (e) {
      throw new Error(
        'desktop sign-up did not reach /direct. URL: ' +
          page.url() +
          ' ' +
          (await page.locator('body').innerText()).slice(0, 700) +
          ' problems: ' +
          problems.join(' | '),
      );
    }
    check(true, 'sign-up works from app://chatterly against the backend (CORS, keys, session)');

    const hasKeys = await page.evaluate(function () {
      return new Promise(function (resolve) {
        const open = indexedDB.open('chatterly-renewed-keys');
        open.onsuccess = function () {
          resolve(open.result.objectStoreNames.contains('identity'));
          open.result.close();
        };
        open.onerror = function () {
          resolve(false);
        };
      });
    });
    check(hasKeys, 'the identity keys are stored in the app profile');

    await page.waitForTimeout(2500);
    check(sockets.length > 0, 'the app opened its WebSocket (' + (sockets[0] ? sockets[0].url : '') + ')');
    check(
      sockets.some(function (s) {
        return !s.closed;
      }),
      'the WebSocket stays open (the server accepted the origin app://chatterly)',
    );
    check(problems.length === 0, 'no console errors or CSP violations in the desktop app: ' + problems.join(' | '));

    const prefs = await app.evaluate(function (electronModule) {
      return electronModule.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    });
    check(prefs.sandbox === true && prefs.contextIsolation === true, 'the window stays sandboxed with context isolation');
  } finally {
    await app.close();
  }
}
