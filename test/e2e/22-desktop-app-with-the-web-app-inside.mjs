/**
 * test/e2e/22-desktop-app-with-the-web-app-inside.mjs
 * Desktop app (Electron) with the web app inside it.
 */
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKEND,
  ROOT,
  TMP,
  children,
  shot,
  step,
  check,
  run,
  freePort,
  waitFor,
} from './support.mjs';

const DESKTOP = path.join(ROOT, 'desktop');

/** The open panel of the bell. ! The pop-up notice has the same title as the card, so look only inside the panel. */
function bellPanel(page) {
  return page.locator('.panel', { hasText: 'Notifications' });
}

/** Picks "how often to look for updates" in the drop-down of Settings > Updates. */
async function chooseInterval(page, label) {
  await page.getByRole('button', { name: 'Look for updates' }).click();
  await page.getByRole('option', { name: label }).click();
}

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

  // * A feed with a newer version, so the update notice, the download and the restart can be driven from the real UI.
  const feedDir = path.join(TMP, 'desktop-feed');
  fs.mkdirSync(feedDir, { recursive: true });
  const installer = Buffer.from('bytes of a pretend installer');
  fs.writeFileSync(path.join(feedDir, 'Chatterly-Setup-2.99.0.exe'), installer);
  const hash = createHash('sha512').update(installer).digest('base64');
  fs.writeFileSync(
    path.join(feedDir, 'latest.yml'),
    [
      'version: 2.99.0',
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
  const feed = http.createServer(function feedHandler(req, res) {
    const file = path.join(feedDir, path.basename(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(fs.readFileSync(file));
  });
  const feedPort = await freePort();
  await new Promise(function listening(resolve) {
    feed.listen(feedPort, '127.0.0.1', resolve);
  });

  const env = {
    ...process.env,
    CHATTERLY_URL: API,
    CHATTERLY_WEB_DIR: world.webDir,
    CHATTERLY_UPDATE_URL: 'http://127.0.0.1:' + feedPort,
    // The windows stay out of sight, so the test does not get in the way of your work.
    CHATTERLY_TEST_QUIET: '1',
  };
  delete env.CHATTERLY_NO_UPDATE;
  // ! Some editors set this, and Electron would then run as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  /** Opens the desktop app (the same profile each time, so the second start finds the first one's sign-in). */
  async function launchApp() {
    return electron.launch({
      executablePath: electronExe,
      args: [
        DESKTOP,
        '--user-data-dir=' + path.join(TMP, 'profile-desktop'),
        '--use-fake-device-for-media-stream',
        // ? The app follows the language of the system (here maybe Spanish); the checks below read English.
        '--lang=en-US',
      ],
      cwd: DESKTOP,
      env,
      timeout: 30000,
    });
  }
  let app = await launchApp();
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
    check(
      sockets.length > 0,
      'the app opened its WebSocket (' + (sockets[0] ? sockets[0].url : '') + ')',
    );
    check(
      sockets.some(function (s) {
        return !s.closed;
      }),
      'the WebSocket stays open (the server accepted the origin app://chatterly)',
    );
    check(
      problems.length === 0,
      'no console errors or CSP violations in the desktop app: ' + problems.join(' | '),
    );

    // The update: a notice in the bell, preferences in Settings, then download with a progress bar and restart.
    async function waitForState(test) {
      let last = null;
      for (let i = 0; i < 60; i++) {
        last = await page.evaluate(function () {
          return window.chatterlyDesktop.updates.getState();
        });
        if (test(last)) return last;
        await page.waitForTimeout(250);
      }
      throw new Error(
        'FAILED: the update state never changed as expected: ' + JSON.stringify(last),
      );
    }
    async function updaterLog() {
      return app.evaluate(function () {
        return (globalThis.__updaterLog || []).join(' | ');
      });
    }
    async function updaterState() {
      return page.evaluate(function () {
        return window.chatterlyDesktop.updates.getState();
      });
    }
    const bell = page.locator('button.tip:has(app-icon[name=bell])').first();
    await bell.click();
    await page.getByText('A new version is available').first().waitFor({ timeout: 30000 });
    check(true, 'a newer version shows up in the notifications of the bell');
    await shot(page, '22a-desktop-bell-update');
    check(
      !(await updaterLog()).includes('downloaded'),
      'it was not downloaded without the person asking',
    );

    // Settings > Updates, from the card of the bell.
    await page.getByRole('button', { name: 'Update settings' }).click();
    await page.getByText('Chatterly 2.99.0 is available').first().waitFor({ timeout: 15000 });
    check(true, 'Settings > Updates opens and says a new version is available');
    await page.waitForTimeout(500);
    await shot(page, '22b-desktop-settings-updates');
    check(
      (await updaterState()).settings.interval === '6h',
      'it looks every 6 hours until the person chooses otherwise',
    );
    await chooseInterval(page, 'Every hour');
    await waitForState(function hourly(state) {
      return state.settings.interval === '1h';
    });
    check(true, 'choosing "Every hour" reaches the app');
    await chooseInterval(page, 'Only when I ask');
    await waitForState(function manual(state) {
      return state.settings.interval === 'never';
    });
    check(true, 'choosing "Only when I ask" reaches the app');
    await chooseInterval(page, 'Every day');
    await waitForState(function daily(state) {
      return state.settings.interval === '24h';
    });
    const notifySwitch = page.getByRole('switch', {
      name: 'Tell me about new versions',
    });
    check(
      (await notifySwitch.getAttribute('aria-checked')) === 'true',
      'notices are on by default',
    );
    await notifySwitch.click();
    await waitForState(function quiet(state) {
      return state.settings.notify === false;
    });
    check(true, 'turning notices off reaches the app');

    // With notices off the bell shows nothing about the update (Settings still does).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await bell.click();
    await page.waitForTimeout(500);
    check(
      (await bellPanel(page).getByText('A new version is available').count()) === 0,
      'with notices off, the bell has no card for the update',
    );
    await page.keyboard.press('Escape');
    await page.goto('app://chatterly/direct(settings:settings/updates)');
    await page.getByText('Chatterly 2.99.0 is available').first().waitFor({ timeout: 15000 });
    check(true, 'with notices off, Settings > Updates still shows the new version');
    await page.getByRole('switch', { name: 'Tell me about new versions' }).click();
    await waitForState(function loud(state) {
      return state.settings.notify === true;
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // Back with notices on: the card of the bell downloads and restarts.
    await bell.click();
    await bellPanel(page)
      .getByText('A new version is available')
      .first()
      .waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Download' }).click();
    await page.getByRole('button', { name: 'Restart and update' }).waitFor({ timeout: 30000 });
    check(true, 'after downloading, the button to restart and update appears');
    await page.getByRole('button', { name: 'Restart and update' }).click();
    await page.waitForTimeout(800);
    check(
      (await updaterLog()).includes('would restart to install'),
      'pressing it asks the app to restart and install',
    );

    const prefs = await app.evaluate(function (electronModule) {
      return electronModule.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    });
    check(
      prefs.sandbox === true && prefs.contextIsolation === true,
      'the window stays sandboxed with context isolation',
    );

    // A second start: the choices were kept, and "Later" hides the card of the bell for that version.
    await app.close();
    app = await launchApp();
    const again = await app.firstWindow();
    await again.waitForURL('app://chatterly/**', { timeout: 30000 });
    await again.waitForFunction(
      function () {
        return window.chatterlyDesktop.updates.getState().then(function (state) {
          return Boolean(state) && state.status === 'available';
        });
      },
      null,
      { timeout: 30000 },
    );
    const kept = await again.evaluate(function () {
      return window.chatterlyDesktop.updates.getState();
    });
    check(
      kept.settings.interval === '24h' && kept.settings.notify === true,
      'the chosen interval and notices were kept after restarting',
    );
    const bell2 = again.locator('button.tip:has(app-icon[name=bell])').first();
    await bell2.click();
    await bellPanel(again)
      .getByText('A new version is available')
      .first()
      .waitFor({ timeout: 15000 });
    await again.getByRole('button', { name: 'Later' }).click();
    await again.waitForTimeout(500);
    check(
      (await bellPanel(again).getByText('A new version is available').count()) === 0,
      '"Later" hides the card of the bell for that version',
    );
  } finally {
    await app.close();
    feed.close();
  }
}
