/**
 * test/e2e/03-build-and-temporary-servers.mjs
 * Build and temporary servers.
 */
import { chromium, firefox } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKEND,
  FRONTEND,
  TMP,
  children,
  pages,
  errors,
  step,
  run,
  freePort,
  serveStatic,
  waitFor,
  makePng,
  makeZip,
  shared,
} from './support.mjs';

/** Build and temporary servers. */
export async function step03(world) {
  step('build and temporary servers');
  const webOut = path.join(TMP, 'web');
  run(
    'pnpm',
    ['--dir', 'frontend', 'exec', 'ng', 'build', '--output-path', JSON.stringify(webOut)],
    { env: { ...process.env, NG_BUILD_CACHE: 'false', CI: '1' } },
  );
  const webDir = fs.existsSync(path.join(webOut, 'browser', 'index.html'))
    ? path.join(webOut, 'browser')
    : webOut;
  // The final page carries the stylesheet inside the HTML and an already drawn copy of the sign-in screen
  run('node', ['scripts/postbuild.mjs', JSON.stringify(webDir)], {
    cwd: FRONTEND,
  });
  const finalHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  console.log('  ok  index.html with inline styles and the sign-in screen already drawn');
  if (!finalHtml.includes('boot-snapshot') || /<link rel="stylesheet"/.test(finalHtml))
    throw new Error(
      'FAILED: the final HTML does not carry the copy of the sign-in screen or still links a stylesheet',
    );
  const [webPort, apiPort] = [await freePort(), await freePort()];
  const WEB = `http://localhost:${webPort}`;
  const API = `http://localhost:${apiPort}`;
  shared.webServer = await serveStatic(webDir, webPort);
  const dataDir = path.join(TMP, 'data');
  const tsx = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const be = spawn(process.execPath, [tsx, 'src/index.ts'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      CORS_ORIGINS: WEB,
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  });
  children.push(be);
  await waitFor(API + '/api/rtc/config');
  console.log('  ok  frontend en ' + WEB + ' y backend en ' + API);

  const { bytes: png, crc } = makePng();
  const pngPath = path.join(TMP, 'avatar.png');
  fs.writeFileSync(pngPath, png);
  const wastickers = path.join(TMP, 'pack.wastickers');
  fs.writeFileSync(
    wastickers,
    makeZip(
      [
        ['title.txt', Buffer.from('Pack WA')],
        ['one.png', png],
        ['two.png', png],
      ],
      crc,
    ),
  );

  const wavPath = path.join(TMP, 'beep.wav');
  {
    const n = 4800;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + n * 2, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24);
    wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8) * 9000), 44 + i * 2);
    fs.writeFileSync(wavPath, wav);
  }

  const suffix = Math.random().toString(36).slice(2, 6);
  const A = { user: 'alice_' + suffix, pw: 'correct-horse-battery-1' };
  const B = { user: 'bob_' + suffix, pw: 'another-strong-pass-2' };

  // CHATTERLY_BROWSER=firefox runs the same test in Firefox (the browser many people use); by default it is Chromium.
  const inFirefox = process.env.CHATTERLY_BROWSER === 'firefox';
  shared.browser = inFirefox
    ? await firefox.launch({
        firefoxUserPrefs: {
          'media.navigator.streams.fake': true,
          'media.navigator.permission.disabled': true,
          'media.autoplay.default': 0,
          'media.autoplay.blocking_policy': 0,
        },
      })
    : await chromium.launch({
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
        ],
      });

  /** Opens a browser window with a new person. */
  async function newUser(name, viewport = { width: 1440, height: 900 }) {
    const ctx = await shared.browser.newContext({
      locale: 'en-US',
      viewport,
      permissions: inFirefox ? [] : ['microphone', 'camera'],
    });
    await ctx.addInitScript(function (api) {
      window.CHATTERLY_API = api;
      window.__snd = 0;
      for (const [proto, fn] of [
        [AudioContext.prototype, 'createOscillator'],
        [AudioContext.prototype, 'createBufferSource'],
      ]) {
        const orig = proto[fn];
        proto[fn] = function () {
          window.__snd++;
          return orig.apply(this, arguments);
        };
      }
    }, API);
    const page = await ctx.newPage();
    page.on('console', function (m) {
      // ? The expected 502 (the test asks on purpose for the preview of a link that does not exist) and the permission warnings of the embedded YouTube player (they belong to the external site) are ignored.
      if (
        m.type() === 'error' &&
        !m.text().includes('502 (Bad Gateway)') &&
        !m.text().includes('Permissions policy violation') &&
        // ? The wrong password typed on purpose when the account is erased answers 401.
        !(name === 'carol' && m.text().includes('401'))
      )
        errors.push(`[${name}] ${m.text().slice(0, 300)} @ ${m.location().url}`);
    });
    page.on('pageerror', function (e) {
      errors.push(`[${name}] ${e.message}`);
    });
    pages.push([name, page]);
    return page;
  }

  /** Signs up a person in a window. */
  async function register(page, u) {
    await page.goto(WEB + '/register');
    await page.fill('input[name=username]', u.user);
    await page.fill('input[name=displayName]', u.user.split('_')[0]);
    await page.fill('input[name=password]', u.pw);
    await page.fill('input[name=confirm]', u.pw);
    await page.click('button[type=submit]');
    try {
      await page.waitForURL('**/direct', { timeout: 60000 });
    } catch (e) {
      throw new Error(
        'sign-up did not reach /direct. URL: ' +
          page.url() +
          ' ' +
          (await page.locator('body').innerText()).slice(0, 700),
      );
    }
  }

  const a = await newUser('alice');
  const b = await newUser('bob');
  Object.assign(world, {
    A,
    API,
    B,
    WEB,
    a,
    b,
    dataDir,
    newUser,
    pngPath,
    register,
    suffix,
    wastickers,
    wavPath,
    webDir,
  });
}
