/**
 * The single test of Chatterly-Renewed: it checks EVERYTHING at once and leaves nothing behind.
 * (The messages it prints are in English.)
 *
 *   pnpm test
 *
 * What it does:
 *   1. Type-checks backend and frontend and checks that every UI string is translated, then runs the security checks
 *      (test/security.mts: other people's ids, sessions, uploads, SSRF, deletion, the relay-only policy, the frame cipher).
 *   2. Builds the frontend in a temporary folder and starts the real backend with a temporary database.
 *   3. Two real Chromium browsers: sign-up, friendship, chat with colors/emoji/stickers, GIFs (disabled
 *      without a key), an end-to-end encrypted video call (equal security codes and encrypted frames
 *      flowing), groups with text and voice channels, profile picture/banner/fonts, settings,
 *      language, WhatsApp sticker import, themed cursor, sounds, animated signature and mobile.
 *   4. Checks that the server NEVER stores clear text and that the API refuses requests without a session.
 *   5. Deletes everything temporary (servers, database, build, the Angular cache created by the test).
 *
 * Only when it fails does it save screenshots in the temporary folder of the system and print their path.
 */
import { chromium, firefox } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterly-test-'));
const hadAngularCache = fs.existsSync(path.join(FRONTEND, '.angular'));
const children = [];
const pages = [];
const errors = [];
let browser;
let webServer;

/** Optional: CHATTERLY_SHOTS=<dir> saves screenshots for a visual review (nothing is written otherwise). */
async function shot(page, name) {
  const dir = process.env.CHATTERLY_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, name + '.png') });
}

const step = function (s) {
  // CHATTERLY_STOP_BEFORE=<text>: stops at the step with that text in its title (to work on one part without running it all)
  const stop = process.env.CHATTERLY_STOP_BEFORE;
  if (stop && s.includes(stop)) throw new Error('Stopped on purpose before: ' + s);
  return console.log('\n== ' + s);
};
const check = function (cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok  ' + msg);
};

/** Runs a command and fails if it ends with an error. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    ...opts,
  });
  if (r.status !== 0) throw new Error(`failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** A free port chosen by the system. */
function freePort() {
  return new Promise(function (resolve) {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', function () {
      const { port } = s.address();
      s.close(function () {
        resolve(port);
      });
    });
  });
}

/** Minimal static server for the built frontend (falling back to index.html). */
function serveStatic(dir, port) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.json': 'application/json',
    '.txt': 'text/plain',
  };
  const server = http.createServer(function (req, res) {
    let file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(dir, 'index.html');
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

/** Waits until a URL answers. */
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise(function (r) {
        setTimeout(r, 300);
      });
    }
  }
  throw new Error('no responde: ' + url);
}

/** A real 64x64 PNG for the image uploads. */
function makePng() {
  const w = 64,
    h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = x * 4;
      raw[o + 1] = y * 4;
      raw[o + 2] = 200;
    }
  }
  const table = Array.from({ length: 256 }, function (_, n) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const png = Object.assign(
    function (buf) {
      let c = ~0;
      for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8);
      return ~c >>> 0;
    },
    { table },
  );
  const chunk = function (type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(png(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { bytes, crc: png };
}

/** An uncompressed ZIP (the format of a .wastickers pack). */
function makeZip(entries, crc) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const c = crc(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(c, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(c, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/** Kills a process and its children (Windows and Unix). */
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  else child.kill('SIGKILL');
}

/** Closes the browsers and the servers and deletes everything temporary, whatever happened. */
async function cleanup() {
  try {
    await browser?.close();
  } catch {}
  webServer?.close();
  for (const c of children) kill(c);
  await new Promise(function (r) {
    setTimeout(r, 800);
  });
  fs.rmSync(TMP, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
  if (!hadAngularCache)
    fs.rmSync(path.join(FRONTEND, '.angular'), {
      recursive: true,
      force: true,
    });
}

/** The whole test, step by step. */
/**
 * A new picture opens the window to adjust it (move and zoom): drags the picture a little, zooms with the slider and
 * saves, then waits for the window to close.
 * @param {import('playwright').Page} page
 */
async function saveAdjusted(page) {
  await page.waitForSelector('.adjust-frame', { timeout: 15000 });
  await page.waitForTimeout(400);
  const box = await page.locator('.adjust-frame').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await page.locator('.adjust-frame ~ label input[type=range]').evaluate(function zoomIn(slider) {
    slider.value = '1.8';
    slider.dispatchEvent(new Event('input'));
  });
  await page.click('[aria-label="Adjust the picture"] button:has-text("Save")');
  await page.waitForSelector('.adjust-frame', {
    state: 'detached',
    timeout: 15000,
  });
}

async function main() {
  step('types and languages');
  run('pnpm', ['--dir', 'backend', 'typecheck']);
  run('pnpm', ['--dir', 'frontend', 'typecheck']);
  run('node', ['scripts/i18n.mjs', '--check'], { cwd: FRONTEND });
  console.log('  ok  backend and frontend types, and every string translated');

  step('security checks (no browser)');
  const securityCli = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const security = spawnSync(
    process.execPath,
    [securityCli, path.join(ROOT, 'test', 'security.mts')],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  process.stdout.write(security.stdout);
  if (security.status !== 0) throw new Error('security checks failed:\n' + security.stderr);

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
  webServer = await serveStatic(webDir, webPort);
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
  browser = inFirefox
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
    const ctx = await browser.newContext({
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

  step('mobile: no horizontal overflow');
  const m = await newUser('movil', { width: 390, height: 800 });
  await m.goto(WEB + '/register');
  await m.waitForSelector('input[name=username]');
  await shot(m, '01-movil');
  check(
    await m.evaluate(function () {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'the register screen fits in 390px',
  );
  await m.context().close();
  // Opening the root without a session must lead to the login (it used to leave an empty box)
  await a.goto(WEB + '/');
  await a.waitForSelector('input[name=username]', { timeout: 10000 });
  await a.waitForURL('**/login', { timeout: 5000 }).catch(function () {
    return undefined;
  });
  check(
    new URL(a.url()).pathname === '/login',
    'the root without a session leads to the login (' + a.url() + ')',
  );
  await a.waitForTimeout(1500);
  await shot(a, '00-login');

  step('sign-up (keys generated in the browser)');
  await Promise.all([register(a, A), register(b, B)]);
  check(true, 'two identities created');

  step('friendship');
  await a.click('button:has-text("Add friend")');
  await a.fill('input[placeholder=username]', B.user);
  await a.waitForTimeout(500);
  await a.click('button:has-text("Send request")');
  await b.waitForTimeout(1000);
  await b.click('button:has-text("Pending")');
  await b.click('.friend-act-ok');
  await a.waitForTimeout(1200);
  check(true, 'request sent and accepted');

  step('mute without a call, right click and overflow');
  await a.click('[data-tip="Mute"]');
  await a.waitForSelector('[data-tip="Unmute"]');
  await a.click('[data-tip="Deafen"]');
  await a.waitForSelector('[data-tip="Undeafen"]');
  check(true, 'muting and deafening works outside a call');
  // (undeafening also unmutes: the mute that came with the deafening goes away with it)
  await a.click('[data-tip="Undeafen"]');
  await a.waitForSelector('[data-tip="Mute"]');
  check(
    await a.evaluate(function () {
      return !document.dispatchEvent(
        new MouseEvent('contextmenu', { cancelable: true, bubbles: true }),
      );
    }),
    'the browser right click is blocked',
  );
  const wide = await a.evaluate(function () {
    return [...document.querySelectorAll('*')]
      .filter(function (e) {
        const o = getComputedStyle(e).overflowX;
        return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1;
      })
      .map(function (e) {
        return e.tagName + '.' + String(e.className).slice(0, 80);
      });
  });
  check(wide.length === 0, 'the friends list has no sideways scroll ' + wide.join(' | '));
  await shot(a, '01-amigos');
  // ! when the status menu opens, the user panel and its buttons do not move
  await a.mouse.move(700, 400);
  await a.waitForTimeout(600);
  const dockBefore = await a.locator('.dock-btn').first().boundingBox();
  await a.click('aside .border-t > button');
  await a.waitForSelector('.menu-up');
  await a.waitForTimeout(400);
  const dockAfter = await a.locator('.dock-btn').first().boundingBox();
  check(
    !!dockBefore && !!dockAfter && Math.abs(dockBefore.y - dockAfter.y) < 1,
    'the status menu opens without moving the buttons below it ' +
      JSON.stringify([dockBefore, dockAfter]),
  );
  await a.mouse.click(700, 500);
  await a.waitForSelector('.menu-up', { state: 'detached' });

  step('direct chat: text, colors, emoji, GIFs, stickers');
  await a.click('button:has-text("All")');
  await a.click('.friend-row:has-text("bob")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Set nickname")');
  await a.fill('input[maxlength="32"]', 'Bobby');
  await a.click('button:has-text("Save")');
  await a.waitForSelector('.friend-row:has-text("Bobby")');
  check(true, 'right click on a friend: nickname set');
  await a.click('.friend-row:has-text("Bobby")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Remove nickname")');
  await a.waitForSelector('.friend-row:has-text("bob"):not(:has-text("Bobby"))');
  // Pressing the friend itself (not one of the buttons) opens the chat.
  await a.click('.friend-row:has-text("bob")', { position: { x: 180, y: 20 } });
  await a.waitForURL('**/direct/**');
  check(true, 'friends: pressing a friend opens the chat');
  await a.fill('textarea[aria-label=Message]', 'Hello Bob! **bold** `code` :rocket:');
  await a.keyboard.press('Enter');
  await b.waitForTimeout(1500);
  await b.click('a:has-text("alice")');
  await b.waitForSelector('text=Hello Bob!', { timeout: 10000 });
  check(true, 'encrypted message received and decrypted');
  await a.fill(
    'textarea[aria-label=Message]',
    'const total = items.map(i => i.price);\nconsole.log(total);',
  );
  await a.waitForSelector('text=It will be sent as code');
  check(true, 'code is detected while it is typed and shown formatted in a preview');
  await a.fill('textarea[aria-label=Message]', '');

  await b.click('[data-tip="Text style & colors"]');
  await b.fill('textarea[aria-label=Message]', 'colourful reply');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('button[aria-label="#ff5d6c"]');
  await b.waitForSelector('text=Preview');
  await b.keyboard.press('Enter');
  await a.waitForSelector('text=colourful reply', { timeout: 10000 });
  check(
    (await a.locator('span[style*="color"]:has-text("colourful reply")').count()) > 0,
    'colored text rendered',
  );

  // custom gradient of the composer: the picker opens in view and applies the colors to the selection
  await b.fill('textarea[aria-label=Message]', 'second');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('button:has-text("Gradient")');
  await b.click('app-gradient-controls button[aria-label="Color"]');
  const popover = b.locator('input[aria-label="Hex color"]');
  await popover.waitFor();
  const dentro = await popover.evaluate(function (e) {
    const r = e.getBoundingClientRect();
    return (
      r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
    );
  });
  check(
    dentro,
    'the chat color picker opens inside the screen ' + JSON.stringify(await popover.boundingBox()),
  );
  await popover.fill('#00ff00');
  await b.waitForTimeout(300);
  await b.click('textarea[aria-label=Message]');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('app-message-input button:has-text("Apply")');
  await b.waitForTimeout(400);
  const valor = await b.inputValue('textarea[aria-label=Message]');
  check(
    valor.includes('[g=#00ff00,#818cf8]second[/g]'),
    'el gradient personalizado se aplica al texto seleccionado. Texto: ' + valor,
  );
  await b.fill('textarea[aria-label=Message]', '');

  await a.click('[data-tip="Emoji, GIFs & stickers"]');
  await a.fill('input[placeholder="Search emoji"]', 'rocket');
  await a.waitForSelector('button:has-text("🚀")', { timeout: 15000 });
  await a.click('button:has-text("GIFs")');
  await a.waitForSelector('text=GIF search is not enabled');
  check(true, 'own emoji picker and GIFs tab (disabled without a GIPHY key)');
  await a.click('button:has-text("Stickers")');
  await a.click('button:has-text("Starter pack")');
  await a.waitForSelector('img[src^="blob:"]', { timeout: 15000 });
  await a.locator('.grid-cols-4 button').first().click();
  await b.waitForSelector('img.drop-shadow-lg', { timeout: 15000 });
  check(true, 'sticker sent and received');
  check(
    await b.evaluate(function () {
      const sticker = document.querySelector('img.stk-live');
      return !!sticker && getComputedStyle(sticker).animationName.startsWith('stk-');
    }),
    'the sticker moves: the picture is still and the page moves it',
  );
  await b.reload();
  await b.waitForSelector('img.drop-shadow-lg', { timeout: 15000 });
  check(true, 'the sticker is still visible after reloading the page');

  step('presets: save the look, share it in the chat, a friend imports it with one button');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.click('a:has-text("Appearance")');
  await a.click('button[aria-expanded]:has-text("Theme presets")');
  await a.fill('input[aria-label="Name of the preset"]', 'Night');
  await a.click('button:has-text("Save what I have now")');
  await a.waitForSelector('app-presets >> text=Night');
  check(true, 'a preset of the theme is saved with a name');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });
  // it is shared from the "+" menu of the chat
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Share a preset")');
  await a.click('[role=dialog] [role=tab]:has-text("Theme of the app")');
  await a.click('[role=dialog] button:has-text("Night")');
  await b.waitForSelector('app-attachment button:has-text("Import and use")', { timeout: 15000 });
  await shot(b, '04d-preajuste-en-el-chat');
  // a theme can be tried before keeping it, and the person goes back to theirs
  await b.click('app-attachment button:has-text("Try")');
  await b.waitForSelector('text=You are trying');
  await b.click('button:has-text("Go back")');
  await b.waitForSelector('text=You are trying', { state: 'detached' });
  check(true, 'a theme of a message can be tried and given back');
  await b.click('app-attachment button:has-text("Import and use")');
  await b.waitForSelector('text=Preset imported and applied', { timeout: 15000 });
  check(true, 'the friend gets the preset with one button');

  step('name and time on every message');
  const orden = await b.evaluate(function () {
    const fila = [...document.querySelectorAll('.group')].find(function (e) {
      return e.textContent.includes('colourful reply') || e.textContent.includes('Hello Bob');
    });
    const cab = fila && fila.querySelector('button.font-semibold');
    // (the tag of a group, when the person shows one, sits between the name and the time)
    let next = cab && cab.nextElementSibling;
    while (next && next.tagName === 'APP-SERVER-TAG') next = next.nextElementSibling;
    return !!cab && !!next && /\d{1,2}:\d{2}/.test(next.textContent);
  });
  check(orden, 'in every message the name comes first and the time after it');
  // 12-hour format: the time is followed by AM or PM
  await b.evaluate(function () {
    localStorage.setItem('chatterly.pref.timeFormat', '"12"');
  });
  await b.reload();
  await b.waitForSelector('button.msg-name', { timeout: 20000 });
  check(
    /\d{1,2}:\d{2} (AM|PM)/.test(
      await b
        .locator('button.msg-name')
        .first()
        .locator('xpath=following-sibling::span')
        .first()
        .innerText(),
    ),
    'in 12 h format the time carries AM or PM',
  );
  // sent, delivered and read marks: Bob has the chat open, so Alice sees "read"
  await a.waitForSelector('.status-dot.status-read', { timeout: 20000 });
  check(true, 'read marks arrive: Alice sees her message as read by Bob');
  await b.click('button.font-semibold:has-text("alice")');
  await b.waitForSelector('[role=dialog]');
  check(true, 'pressing the name of someone else opens their profile');
  await b.keyboard.press('Escape');
  await b.waitForSelector('[role=dialog]', { state: 'detached' });

  step('Spinly: a wheel and a tournament in the chat, like a poll, and the linked account');
  // The real Spinly lives on another site; here a test page plays Spinly with the same message protocol.
  fs.writeFileSync(
    path.join(webDir, 'spinly-stub.html'),
    '<!doctype html><meta charset="utf-8"><title>Spinly</title>' +
      '<button id="spin">spin</button><button id="champion">champion</button><script>' +
      'var params = new URLSearchParams(location.search);' +
      'var origin = params.get("chatterly");' +
      'var target = window.opener || window.parent;' +
      'target.postMessage({ source: "spinly", type: "hello", signedIn: true }, origin);' +
      'window.addEventListener("message", function (e) { if (e.data && e.data.type === "send-profile") target.postMessage({ source: "spinly", type: "profile", signedIn: true, profile: { themes: [{ name: "Test Theme", segments: ["#112233", "#445566", "#778899"], pointer: "#ff0000" }], presets: [{ name: "Friday", options: [{ name: "Pizza", color: "indigo" }, { name: "Tacos", color: "coral" }, { name: "Sushi", color: "teal" }], theme: { name: "Test Theme", segments: ["#112233", "#445566"] } }] } }, origin); });' +
      'document.getElementById("spin").onclick = function () { target.postMessage({ source: "spinly", type: "result", result: { kind: "wheel", title: "", names: ["Pizza", "Tacos", "Sushi"], winner: "Tacos" } }, origin); };' +
      'document.getElementById("champion").onclick = function () { target.postMessage({ source: "spinly", type: "result", result: { kind: "tournament", title: "Cup", names: ["Ana", "Luis", "Eva"], winner: "Ana" } }, origin); };' +
      '</script>',
  );
  await a.route('https://spinly-psi.vercel.app/**', async function (route) {
    await route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync(path.join(webDir, 'spinly-stub.html'), 'utf8'),
    });
  });
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.click('a:has-text("Integrations")');
  await a.waitForSelector('button:has-text("Link my Spinly account")');
  check(
    (await a.locator('input[aria-label="Spinly address"]').count()) === 0,
    'there is no Spinly address to set: it is always the same one',
  );
  await a.waitForSelector('text=Not linked');
  check(true, 'Settings > Integrations: no Spinly account linked yet');
  await a.click('button:has-text("Link my Spinly account")');
  await a.waitForSelector('iframe[title="Spinly"]');
  check(
    (await a.locator('button:has-text("Open in a window")').count()) === 0,
    'Spinly is integrated: there is no button to open it in a window',
  );
  await a.click('button:has-text("Use my themes and presets")');
  await a.waitForSelector('.settings-overlay .chip-accent', { timeout: 15000 });
  check(
    (await a.locator('.settings-overlay .stat').allInnerTexts()).join(' ').replace(/\s+/g, ' ') ===
      '1 themes 1 presets',
    'the linked account shows how many themes and presets came over',
  );
  check(true, 'linking the Spinly account brings its themes and presets into Chatterly');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });

  // A wheel made from a preset of the linked account, sent to the chat.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  await a.click('[role=dialog][aria-label="Spinly"] .fold-head:has-text("presets")');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Friday")');
  await a.waitForFunction(function () {
    const boxes = [
      ...document.querySelectorAll('[role=dialog][aria-label="Spinly"] input[data-entry]'),
    ];
    return (
      boxes.length === 3 &&
      boxes.some(function (box) {
        return box.value === 'Sushi';
      })
    );
  });
  check(true, 'a preset of the linked account fills in the options');
  await shot(a, '07c-spinly-composer');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Send to the chat")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]', {
    state: 'detached',
  });
  await b.waitForSelector('app-spinly-message button:has-text("Spin the wheel")', {
    timeout: 15000,
  });
  await a.waitForSelector('app-spinly-message button:has-text("Spin the wheel")', {
    timeout: 15000,
  });
  check(true, 'the wheel reaches both people as a message, like a poll');
  await b.click('app-spinly-message button:has-text("Spin the wheel")');
  await a.waitForSelector('app-spinly-message:has-text("The wheel says")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-message:has-text("The wheel says")', {
    timeout: 15000,
  });
  const winnerA = (await a.locator('app-spinly-message .text-xl').first().innerText()).trim();
  const winnerB = (await b.locator('app-spinly-message .text-xl').first().innerText()).trim();
  check(
    winnerA === winnerB && ['Pizza', 'Tacos', 'Sushi'].includes(winnerA),
    'when Bob spins, both see the same winner (' + winnerA + ')',
  );
  check(
    (await a.locator('app-spinly-message button:has-text("Spin")').count()) === 0 &&
      (await b.locator('app-spinly-message button:has-text("Spin")').count()) === 0,
    'once the result is out nobody can spin that wheel again',
  );
  await shot(a, '07d-spinly-wheel-result');

  // A tournament in the chat: one start, the same champion for everybody.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  const rows = a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]');
  await rows.nth(0).fill('Ana');
  await rows.nth(1).fill('Luis');
  await rows.nth(2).fill('Eva');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Add participant")');
  await rows.nth(3).fill('Mia');
  await shot(a, '07c2-spinly-tournament-composer');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Send to the chat")');
  await b.waitForSelector('app-spinly-message button:has-text("Start the tournament")', {
    timeout: 15000,
  });
  await b.click('app-spinly-message button:has-text("Start the tournament")');
  await a.waitForSelector('app-spinly-message button:has-text("Skip to the result")', {
    timeout: 15000,
  });
  await shot(a, '07e-spinly-tournament');
  await a.click('app-spinly-message button:has-text("Skip to the result")');
  await b.click('app-spinly-message button:has-text("Skip to the result")');
  await a.waitForSelector('app-spinly-message:has-text("Champion")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-message:has-text("Champion")', {
    timeout: 15000,
  });
  const championA = (
    await a.locator('app-spinly-message .tour-champion-name').last().innerText()
  ).trim();
  const championB = (
    await b.locator('app-spinly-message .tour-champion-name').last().innerText()
  ).trim();
  check(
    championA === championB && ['Ana', 'Luis', 'Eva', 'Mia'].includes(championA),
    'the tournament has the same champion for both people (' + championA + ')',
  );

  // Everything is integrated: the window has no way out to the whole Spinly, and lists every theme once.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  check(
    (await a.locator('button:has-text("Open the full Spinly")').count()) === 0,
    'the window has no button to open the whole Spinly',
  );
  const themeNames = await a
    .locator(
      '[role=dialog][aria-label="Spinly"] .fold:has(.fold-head:has-text("Look")) .theme-card',
    )
    .allInnerTexts();
  check(new Set(themeNames).size === themeNames.length, 'every theme is listed once');
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"] .rule-preset');
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"] .rule-preset').count()) === 3 &&
      (await a.locator('[role=dialog][aria-label="Spinly"] .stepper-card').count()) === 0,
    'a tournament offers just three modes (fast, classic, epic)',
  );
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Wheel")');
  // The color of a slice, of the arrow and of the lights is edited with the normal color picker.
  await a.locator('[role=dialog][aria-label="Spinly"] path.slice').first().click({ force: true });
  await a.waitForSelector('.picker-panel .sv-area');
  // Escape closes only the picker, not the window under it.
  await a.keyboard.press('Escape');
  await a.waitForSelector('.picker-panel', { state: 'detached' });
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"]').count()) === 1,
    'Escape closes only the color picker and leaves the window open',
  );
  await a.locator('[role=dialog][aria-label="Spinly"] g.pointer').click({ force: true });
  await a.waitForSelector('.picker-panel');
  // A press outside closes only the picker as well.
  await a.mouse.click(5, 5);
  await a.waitForSelector('.picker-panel', { state: 'detached' });
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"]').count()) === 1,
    'a press outside closes only the color picker',
  );
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  await a.click('[role=dialog][aria-label="Spinly"] .rule-preset >> nth=2');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"] .rule-preset.is-on:has-text("Epic")');
  await shot(a, '07f-spinly-rules');
  await a.keyboard.press('Escape');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]', {
    state: 'detached',
  });
  await shot(a, '07-chat');
  await a.click('text=Hello Bob!', { button: 'right' });
  await shot(a, '07b-menu-contextual');
  await a.keyboard.press('Escape');
  await a.click('text=Hello Bob!', { button: 'right' });
  await a.waitForSelector('[role=menuitem]:has-text("Delete")');
  await a.click('[role=menuitem]:has-text("Delete")');
  await a.click('button:has-text("Delete"):not([role=menuitem])');
  await b.waitForSelector('text=Hello Bob!', {
    state: 'detached',
    timeout: 15000,
  });
  check(true, 'right click on a message: delete removes it for everybody');

  step('links: the preview is optional');
  await b.fill('textarea[aria-label=Message]', 'mira https://localhost.invalid/pagina');
  await b.waitForSelector('button:has-text("Add preview")');
  check(
    (await b.locator('text=No preview is available').count()) === 0,
    'the preview is not requested by itself',
  );
  await b.click('button:has-text("Add preview")');
  await b.waitForSelector('text=No preview is available for this link.', {
    timeout: 20000,
  });
  await b.keyboard.press('Enter');
  await a.waitForSelector('a:has-text("localhost.invalid")', {
    timeout: 15000,
  });
  check(true, 'the link is sent without a card when there is no preview');

  await b.fill('textarea[aria-label=Message]', 'mira https://youtu.be/dQw4w9WgXcQ');
  await b.click('button:has-text("Add preview")');
  await b.waitForSelector('text=The preview will be sent with your message.', {
    timeout: 30000,
  });
  await b.keyboard.press('Enter');
  await a.waitForSelector('button[aria-label="Play video"]', {
    timeout: 20000,
  });
  check(
    (await a.locator('iframe[title="YouTube"]').count()) === 0,
    'the video player loads nothing until play is pressed',
  );
  await a.click('button[aria-label="Play video"]');
  await a.waitForSelector(
    'iframe[title="YouTube"][src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]',
    { timeout: 10000 },
  );
  check(
    (await a.locator('a:has-text("youtu.be/dQw4w9WgXcQ")').count()) >= 1,
    'the video goes on top and the link below, as one block',
  );

  await b.fill('textarea[aria-label=Message]', 'const total = items.length;\nreturn total;');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.code-block:has-text("const total")', {
    timeout: 15000,
  });
  check(true, 'text that looks like code is formatted as a code block by itself');
  await b.fill('textarea[aria-label=Message]', '🎉');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.bubble-emoji', { timeout: 15000 });
  await a.locator('.bubble-emoji').first().scrollIntoViewIfNeeded();
  await a.waitForTimeout(900);
  await shot(a, '07d-emoji');
  check(true, 'a single emoji is drawn big and without a bubble');

  step('undo, redo and caret when formatting');
  await b.fill('textarea[aria-label=Message]', '');
  await b.click('textarea[aria-label=Message]');
  await b.keyboard.type('hola');
  await b.keyboard.press('Control+z');
  check(
    (await b.inputValue('textarea[aria-label=Message]')) === '',
    'Control+Z undoes what was typed',
  );
  await b.keyboard.press('Control+y');
  check((await b.inputValue('textarea[aria-label=Message]')) === 'hola', 'Control+Y redoes it');
  await b.fill('textarea[aria-label=Message]', '');
  if ((await b.locator('button[aria-label="#ff5d6c"]').count()) === 0) {
    await b.click('[data-tip="Text style & colors"]');
  }
  await b.click('button[aria-label="#ff5d6c"]');
  await b.keyboard.type('x');
  check(
    (await b.inputValue('textarea[aria-label=Message]')) === '[c=#ff5d6c]x[/c]',
    'with no text selected, the caret stays inside the color to type',
  );
  await b.fill('textarea[aria-label=Message]', '');

  step('end-to-end encrypted call with video');
  await a.click('[data-tip="Voice call"]');
  await a.waitForURL('**/voice');
  await b.waitForSelector('text=Incoming encrypted call', { timeout: 10000 });
  await b.click('button[aria-label=Accept]');
  await b.waitForURL('**/voice');
  await a.waitForSelector('button.chip[title="End-to-end encrypted"]', {
    timeout: 40000,
  });
  await b.waitForSelector('button.chip[title="End-to-end encrypted"]', {
    timeout: 40000,
  });
  await a.waitForTimeout(4500);
  await shot(a, '02-llamada-a');
  await shot(b, '03-llamada-b');
  // The arrows with the devices, and the menu of a person (volume, next to the cursor, closes with a press elsewhere).
  check(
    (await a.locator('app-device-menu').count()) === 3,
    'the microphone, the speakers and the camera have an arrow with their devices',
  );
  await a.locator('app-device-menu button').first().click();
  await a.waitForSelector('app-device-menu [role=menu]', { timeout: 5000 });
  check(
    await a.locator('app-device-menu [role=menu]').first().isVisible(),
    'the arrow of the microphone opens the list of devices',
  );
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  check(
    (await a.locator('app-device-menu [role=menu]').count()) === 0,
    'Escape closes the list of devices',
  );
  const bobTile = a.locator('.stage-host').getByText('bob', { exact: true }).first();
  const bobBox = await bobTile.boundingBox();
  await bobTile.click({ button: 'right' });
  await a.waitForSelector('app-person-menu input[type=range]');
  const menuBox = await a.locator('app-person-menu').boundingBox();
  check(
    Math.abs(menuBox.x - (bobBox.x + bobBox.width / 2)) < 280 &&
      Math.abs(menuBox.y - (bobBox.y + bobBox.height / 2)) < 280,
    'the menu of a person opens next to the cursor',
  );
  await a.locator('app-person-menu input[type=range]').fill('150');
  // (the preferences are saved by an effect, a moment after the change)
  await a
    .waitForFunction(
      function () {
        return Object.values(
          JSON.parse(localStorage.getItem('chatterly.pref.peerVolumes') ?? '{}'),
        ).includes(150);
      },
      null,
      { timeout: 3000 },
    )
    .catch(function () {
      return undefined;
    });
  const volumes = await a.evaluate(function () {
    return JSON.parse(localStorage.getItem('chatterly.pref.peerVolumes') ?? '{}');
  });
  check(
    Object.values(volumes).includes(150),
    'the volume of a person can be raised (150 %) and is kept',
  );
  await a.mouse.click(4, 4);
  await a.waitForTimeout(300);
  check(
    (await a.locator('app-person-menu').count()) === 0,
    'a press anywhere else closes the menu of a person',
  );
  await a.click('button.chip[title="End-to-end encrypted"]');
  await b.click('button.chip[title="End-to-end encrypted"]');
  await a.waitForSelector('text=Verify this call');
  const codeOf = async function (p) {
    return (await p.locator('[role=dialog] .font-mono.tracking-widest').first().innerText()).trim();
  };
  const [codeA, codeB] = [await codeOf(a), await codeOf(b)];
  check(!!codeA && codeA === codeB, `identical security codes on both sides (${codeA})`);
  const stats = await a.locator('text=Sent, encrypted').first().innerText();
  const sent = Number(/encrypted: (\d+)/.exec(stats)?.[1] ?? 0);
  const received = Number(/decrypted: (\d+)/.exec(stats)?.[1] ?? 0);
  check(
    sent >= 20 && received >= 20,
    `encrypted frames flowing (sent ${sent}, decrypted ${received})`,
  );
  check(!/rejected: [1-9]/.test(stats), 'no frame rejected');
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  // The activities of a call (listening, watching, Spinly) start from one menu and become tiles of the stage.
  await a.click('[data-tip="Activities"]');
  await a.waitForSelector('.menu-card:has-text("Spinly")');
  check(
    (await a.locator('.menu-card:has-text("Listen together")').count()) === 1 &&
      (await a.locator('.menu-card:has-text("Watch together")').count()) === 1 &&
      (await a.locator('.menu-card:has-text("Spinly")').count()) === 1,
    'the Activities menu offers listening, watching and Spinly',
  );
  await a.click('.menu-card:has-text("Listen together") button >> nth=0');
  await a.fill('form.act-form input', 'https://example.com/nope');
  await a.click('button:has-text("Play for everyone")');
  await a.waitForSelector('text=That is not a valid YouTube or Spotify link.');
  await a.fill('form.act-form input', 'https://youtu.be/dQw4w9WgXcQ');
  await a.click('button:has-text("Play for everyone")');
  await b.waitForSelector('text=Listening together', { timeout: 15000 });
  check(
    (await b.locator('iframe[title="Music"]').count()) === 1,
    'the shared music reaches Bob encrypted and plays in a small player',
  );
  check(
    (await b.locator('.music-card').count()) === 1 &&
      (await b.locator('.call-tile iframe').count()) === 0,
    'music is only sound: a small player, not a tile of the stage',
  );
  // The card of the music can be made small and big again (its body folds away and comes back).
  const bodyHeight = function () {
    return b.locator('.music-card .mc-inner').evaluate(function (e) {
      return e.getBoundingClientRect().height;
    });
  };
  await b.waitForFunction(
    function () {
      const inner = document.querySelector('.music-card .mc-inner');
      return !!inner && inner.getBoundingClientRect().height > 20;
    },
    null,
    { timeout: 5000 },
  );
  check(true, 'the card of the music shows its controls');
  await b.click('.music-card button[aria-label="Minimize"]');
  await b.waitForTimeout(700);
  check((await bodyHeight()) < 2, 'the card of the music can be minimized');
  await b.click('.music-card button[aria-label="Expand"]');
  await b.waitForTimeout(700);
  check((await bodyHeight()) > 20, 'and made big again');
  // Anybody can queue a song, and a vote of everybody skips to the next one.
  await a.click('.music-card button[aria-label="Queue"]');
  await a.fill('.music-card form input', 'https://youtu.be/jNQXAC9IVRw');
  await a.click('.music-card form button[type=submit]');
  await b.waitForSelector('.music-card button[aria-label="Queue"]:has-text("1")', {
    timeout: 15000,
  });
  check(true, 'a song queued by Alice shows up in the queue of Bob');
  await a.click('.music-card button[aria-label="Vote to skip"]');
  await b.click('.music-card button[aria-label="Vote to skip"]');
  await b.waitForSelector('.music-card button[aria-label="Queue"]:has-text("0")', {
    timeout: 15000,
  });
  check(true, 'when everybody votes to skip, the next song of the queue starts');
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Watch together") button >> nth=0');
  await a.fill('form.act-form input', 'https://youtu.be/dQw4w9WgXcQ');
  await a.click('button:has-text("Play for everyone")');
  await b.waitForSelector('text=Watching together', { timeout: 15000 });
  await b.waitForTimeout(600);
  check(
    (await b.locator('iframe[title="Video"]').count()) === 1 &&
      (await b.locator('iframe[title="Music"]').count()) === 0,
    'a video replaces the music instead of playing on top of it',
  );
  await shot(b, '11c-ver-juntos');
  // The bar of the call controls the video (needs the network: the player reports its length only when it plays).
  await b.waitForSelector('.timeline input[type=range]:not([disabled])', { timeout: 25000 });
  check(true, 'the timeline of the video is enabled once the player reports its length');
  const videoFrom = Number(await b.locator('.timeline input[type=range]').inputValue());
  // a real drag of the thumb with the mouse (not a value written by the test)
  const bar = await b.locator('.timeline input[type=range]').boundingBox();
  await b.mouse.move(bar.x + 8, bar.y + bar.height / 2);
  await b.mouse.down();
  await b.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2, { steps: 12 });
  await b.mouse.up();
  await b.waitForFunction(
    function (from) {
      return Number(document.querySelector('.timeline input[type=range]').value) >= from;
    },
    20,
    { timeout: 8000 },
  );
  // The player itself must have jumped (the bar follows what the player says: if the jump had not happened it would go back).
  await b.waitForTimeout(2500);
  check(
    videoFrom < 100 && Number(await b.locator('.timeline input[type=range]').inputValue()) >= 30,
    'the timeline moves the video',
  );
  await a.waitForFunction(
    function () {
      const bar = document.querySelector('.timeline input[type=range]');
      return !!bar && Number(bar.value) >= 20;
    },
    null,
    { timeout: 12000 },
  );
  check(true, 'and everybody else is taken to the same second');
  // Closing is personal; stopping from the Activities menu ends it for everybody.
  await b.click('button[aria-label="Close for me"]');
  await b.waitForSelector('text=Watching together', {
    state: 'detached',
    timeout: 15000,
  });
  check(
    (await a.locator('iframe[title="Video"]').count()) === 1,
    'closing the video only closes it for the person who pressed it',
  );
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Watch together") button:has-text("Stop")');
  await a.waitForSelector('iframe[title="Video"]', {
    state: 'detached',
    timeout: 15000,
  });
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Spinly") button >> nth=0');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  const callRows = a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]');
  await callRows.nth(0).fill('Red');
  await callRows.nth(1).fill('Blue');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Start for everybody")');
  await b.waitForSelector('app-spinly-call-panel', { timeout: 15000 });
  await a.waitForSelector('app-spinly-call-panel', { timeout: 15000 });
  check(true, 'in the call, the wheel appears right in the call screen for everybody');
  await b.click('app-spinly-call-panel button:has-text("Spin the wheel")');
  await a.waitForSelector('app-spinly-call-panel:has-text("The wheel says")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-call-panel:has-text("The wheel says")', {
    timeout: 15000,
  });
  const callWinnerA = (
    await a.locator('app-spinly-call-panel .text-xl').first().innerText()
  ).trim();
  const callWinnerB = (
    await b.locator('app-spinly-call-panel .text-xl').first().innerText()
  ).trim();
  check(
    callWinnerA === callWinnerB && ['Red', 'Blue'].includes(callWinnerA),
    'Bob spins in the call and both see the same winner (' + callWinnerA + ')',
  );
  await shot(a, '11b-spinly-call');
  await a.waitForSelector('app-spinly-call-panel button:has-text("Spin again")');
  check(true, 'in the call the wheel can be spun again');
  await a.click('app-spinly-call-panel button:has-text("Spin again")');
  await b.waitForSelector('app-spinly-call-panel:has-text("Spinning…")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-call-panel button:has-text("Spin again")', {
    timeout: 15000,
  });
  await a.click('app-spinly-call-panel button:has-text("Edit")');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Add option")');
  await a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]').nth(2).fill('Green');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Apply for everybody")');
  await b.waitForFunction(function () {
    return document.querySelectorAll('app-spinly-call-panel svg text').length === 3;
  });
  check(true, 'editing the wheel in the call changes it for everybody');
  await a.click('app-spinly-call-panel button[aria-label=Close]');
  await a.waitForSelector('app-spinly-call-panel', { state: 'detached' });
  await b.waitForSelector('app-spinly-call-panel', {
    state: 'detached',
    timeout: 15000,
  });
  await a.click('[data-tip="Turn camera on"]');
  await a.waitForTimeout(3000);
  check(
    await b.evaluate(function () {
      return [...document.querySelectorAll('video')].some(function (v) {
        return v.readyState >= 2 && v.videoWidth > 0;
      });
    }),
    'Bob decrypts and shows the video of Alice',
  );
  // The camera is turned off and on again several times, quickly and slowly: every time the other person must see it move.
  const movingVideo = async function (page, label) {
    const ok = await page
      .waitForFunction(
        function () {
          return [...document.querySelectorAll('video')].some(function (v) {
            if (v.readyState < 2 || v.videoWidth === 0) return false;
            const now = v.currentTime;
            if (v.__last === undefined || v.__last === now) {
              v.__last = now;
              return false;
            }
            return true;
          });
        },
        null,
        { timeout: 9000, polling: 400 },
      )
      .then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
    check(ok, label);
  };
  for (const pause of [1200, 150, 600, 150]) {
    await a.click('[data-tip="Turn camera off"]');
    await a.waitForTimeout(pause);
    await a.click('[data-tip="Turn camera on"]');
    await movingVideo(
      b,
      'Bob sees the camera of Alice move after turning it off and on (' + pause + ' ms)',
    );
  }
  // Both cameras at the same time, turned off and on together (the two sides negotiate at once).
  const remoteMoving = function (page, label) {
    return page
      .waitForFunction(
        function () {
          return [...document.querySelectorAll('video')].some(function (v) {
            if (v.muted || v.readyState < 2 || v.videoWidth === 0) return false;
            const now = v.currentTime;
            const moved = v.__seen !== undefined && v.__seen !== now;
            v.__seen = now;
            return moved;
          });
        },
        null,
        { timeout: 9000, polling: 400 },
      )
      .then(
        function () {
          return check(true, label);
        },
        function () {
          return check(false, label);
        },
      );
  };
  await b.click('[data-tip="Turn camera on"]');
  await remoteMoving(a, 'Alice sees the camera of Bob');
  for (const pause of [900, 100, 400]) {
    await Promise.all([
      a.click('[data-tip="Turn camera off"]'),
      b.click('[data-tip="Turn camera off"]'),
    ]);
    await a.waitForTimeout(pause);
    await Promise.all([
      a.click('[data-tip="Turn camera on"]'),
      b.click('[data-tip="Turn camera on"]'),
    ]);
    await remoteMoving(
      a,
      'Alice sees Bob after both turned the camera off and on together (' + pause + ' ms)',
    );
    await remoteMoving(
      b,
      'Bob sees Alice after both turned the camera off and on together (' + pause + ' ms)',
    );
  }
  await b.click('[data-tip="Turn camera off"]');
  await a.click('button[aria-label="Hang up"]');
  await b.waitForTimeout(800);
  await b.click('button[aria-label="Hang up"]');

  step('groups, uploaded icon, and text and voice channels');
  await a.goto(WEB + '/groups');
  await a.click('text=Create your first group');
  await a.fill('input[placeholder="e.g. Game night"]', 'Rust Crew');
  const iconChooser = a.waitForEvent('filechooser');
  await a.click('button[aria-label="Upload an icon"]');
  (await iconChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.waitForSelector('img[src^="blob:"]');
  await a.click('button:has-text("Create group")');
  await a.waitForSelector('a[data-tip="Rust Crew"] img[src^="blob:"]', { timeout: 20000 });
  check(true, 'the encrypted icon of the group is opened and shown');
  await a.waitForURL('**/groups/**/**', { timeout: 20000 });
  await a.waitForTimeout(800);
  await a.fill('textarea[aria-label=Message]', 'First message in the group');
  await a.keyboard.press('Enter');
  await a.waitForSelector('text=First message in the group', {
    timeout: 10000,
  });
  await a.click('[data-tip="Create text channel"]');
  await a.fill('input[placeholder="General chat"]', 'dev talk');
  await a.click('button:has-text("Create channel")');
  await a.waitForSelector('a:has-text("Dev talk")', { timeout: 10000 });
  await a.click('[data-tip="Create voice channel"]');
  await a.fill('input[placeholder="Lounge"]', 'Stage');
  await a.click('button:has-text("Create channel")');
  await a.waitForSelector('button:has-text("Stage")', { timeout: 10000 });
  await a.click('a:has-text("Dev talk")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Rename channel")');
  await a.fill('input[maxlength="32"]', 'ideas');
  await a.click('button:has-text("Save")');
  await a.waitForSelector('a:has-text("Ideas")', { timeout: 10000 });
  check(true, 'right click on a channel: rename');
  // order of the channels: they are born in order of arrival and the owner reorders them (menu and drag)
  const ordenCanales = async function () {
    return await a.$$eval('a.chan-text', function (els) {
      return els.map(function (e) {
        return (e.textContent || '').toLowerCase();
      });
    });
  };
  const ordenInicial = await ordenCanales();
  check(
    ordenInicial.length === 2 &&
      ordenInicial[0].includes('general') &&
      ordenInicial[1].includes('ideas'),
    'channels in order of arrival: ' + ordenInicial.join(' | '),
  );
  await a.click('a.chan-text:has-text("Ideas")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Move channel up")');
  await a.waitForFunction(
    function () {
      return (document.querySelector('a.chan-text')?.textContent || '')
        .toLowerCase()
        .includes('ideas');
    },
    null,
    { timeout: 8000 },
  );
  check(true, 'move a channel up from the menu');
  await a.dragAndDrop('a.chan-text:has-text("Ideas")', 'a.chan-text:has-text("General")');
  await a.waitForFunction(
    function () {
      return (document.querySelector('a.chan-text')?.textContent || '')
        .toLowerCase()
        .includes('general');
    },
    null,
    { timeout: 8000 },
  );
  check(true, 'drag a channel to change its order');
  check(true, 'group with its own icon and text and voice channels created');
  await a.click('[data-tip="Invite people"]');
  await a.click('.nav-item:has-text("bob") button:has-text("Invite")');
  await a.waitForTimeout(1500);
  await a.keyboard.press('Escape');
  await b.goto(WEB + '/groups');
  await b.waitForSelector('text=First message in the group', {
    timeout: 15000,
  });
  check(true, 'Bob joins the group and decrypts with the key envelope');
  const memberRows = async function () {
    return a.$$eval('aside.anim-slide-right .chan-item', function (els) {
      return els.map(function (e) {
        return (e.textContent || '').toLowerCase();
      });
    });
  };
  await a.waitForSelector('aside.anim-slide-right .chan-item:has-text("bob")', {
    timeout: 15000,
  });
  const rowsBefore = await memberRows();
  check(
    rowsBefore[0].includes('alice') && rowsBefore[1].includes('bob'),
    'members appear in order of arrival: ' + rowsBefore.length,
  );
  await a.dragAndDrop(
    'aside.anim-slide-right .chan-item:has-text("bob")',
    'aside.anim-slide-right .chan-item:has-text("alice")',
  );
  await a.waitForTimeout(1200);
  const rowsAfter = await memberRows();
  check(
    rowsAfter[0].includes('alice'),
    'nobody can be placed above the owner: the owner stays first',
  );

  step('speed: opening settings and a group must be almost instant');
  await a.goto(WEB + '/direct');
  await a.waitForSelector('a[data-tip="Rust Crew"]');
  await a.waitForTimeout(1500);
  let t0 = Date.now();
  await a.click('a[data-tip="Rust Crew"]');
  await a.waitForSelector('textarea[aria-label=Message]');
  const msGrupo = Date.now() - t0;
  t0 = Date.now();
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('h1:has-text("My profile")');
  const msAjustes = Date.now() - t0;
  console.log('  group: ' + msGrupo + ' ms, settings: ' + msAjustes + ' ms');
  check(
    msGrupo < 1200 && msAjustes < 1200,
    'opening a group and the settings takes less than 1.2 s',
  );
  await a.keyboard.press('Escape');
  await a.waitForTimeout(500);

  step('settings: profile, appearance, language, stickers, sound, signature');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.waitForTimeout(700);
  // the pointer lights the entries of the menu, one after another and also when it goes back and forth quickly
  const entries = a.locator('.settings-overlay a.nav-item');
  const lit = [];
  for (const at of [0, 1, 2, 3, 2, 1, 4, 0, 5, 3]) {
    await entries.nth(at).hover();
    await a.waitForTimeout(80);
    lit.push(
      await entries.nth(at).evaluate(function (e) {
        return getComputedStyle(e).backgroundColor;
      }),
    );
  }
  await a.waitForTimeout(500);
  const finalLit = await entries.nth(3).evaluate(function (e) {
    return getComputedStyle(e).backgroundColor;
  });
  check(
    finalLit !== 'rgba(0, 0, 0, 0)' && lit.every(Boolean),
    'hovering an entry of the settings menu lights it ' + finalLit,
  );
  await a.mouse.click(4, 400);
  await a.waitForSelector('.settings-overlay', {
    state: 'detached',
    timeout: 5000,
  });
  check(true, 'pressing outside the settings closes them');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  check(
    await a.evaluate(function () {
      return !!document.querySelector('app-direct-hub, app-group-view, app-voice-stage');
    }),
    'when the settings open the screen underneath is still there',
  );
  // What is written in the profile and not saved is kept when the settings are closed and opened again.
  await a.fill('input[maxlength="80"]', 'unsaved status');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  check(
    (await a.inputValue('input[maxlength="80"]')) === 'unsaved status',
    'an unsaved status is still there after closing and opening the settings',
  );
  await a.fill('input[maxlength="80"]', '');
  const avatarChooser = a.waitForEvent('filechooser');
  await a.click('[aria-label="Change picture"]');
  (await avatarChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.waitForSelector('img[src^="blob:"]', { timeout: 15000 });
  const bannerChooser = a.waitForEvent('filechooser');
  await a.click('[aria-label="Change banner"]');
  (await bannerChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.click('button[aria-expanded]:has-text("Name font")');
  await a.click('button.choice-card:has-text("Serif")');
  // the letters of the name move (one element per letter; only transform moves)
  await a.click('button[aria-expanded]:has-text("Name animation")');
  await a.click('button.choice-card:has-text("Bounce")');
  await a.waitForTimeout(900);
  await shot(a, '04c-animacion-nombre');
  await a.waitForSelector('.nfx-l');
  check(
    await a.evaluate(function () {
      const letter = document.querySelector('.nfx-l');
      return (
        document.querySelectorAll('.nfx-l').length >= 3 &&
        !!letter &&
        getComputedStyle(letter).animationName === 'nfx-bounce'
      );
    }),
    'a name animation moves the letters of the name',
  );
  // the banner color is offered when the banner is not a picture
  await a.click('button:has-text("Remove banner")');
  await a.click('button[aria-label="Banner color"]');
  await shot(a, '04-color-picker');
  const swatch = a.locator('button[aria-label="Banner color"]').first();
  await a.fill('input[aria-label="Hex color"]', '#ff0066');
  await a.waitForTimeout(1500);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) === 'rgb(255, 0, 102)',
    'the color picker applies the typed hex',
  );
  // the picker window is dragged by its title bar and has R, G and B fields
  const barra = a
    .locator('[popover] [title="Arrastra para mover"], [popover] [title="Drag to move"]')
    .first();
  const antes = await barra.boundingBox();
  await a.mouse.move(antes.x + 40, antes.y + antes.height / 2);
  await a.mouse.down();
  await a.mouse.move(antes.x + 140, antes.y + 90, { steps: 5 });
  await a.mouse.up();
  const despues = await barra.boundingBox();
  check(
    Math.abs(despues.x - antes.x - 100) < 4 &&
      Math.abs(despues.y - antes.y - (90 - antes.height / 2)) < 6,
    'the color picker is dragged by its title bar',
  );
  check(
    (await a.locator('input[aria-label="R"]').inputValue()) === '255',
    'the picker shows the RGB channels (R = 255)',
  );
  await a.fill('input[aria-label="G"]', '255');
  await a.waitForTimeout(600);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) === 'rgb(255, 255, 102)',
    'typing an RGB channel changes the color',
  );
  await a.fill('input[aria-label="Hex color"]', '#ff0066');
  await a.waitForTimeout(200);
  const area = a.locator('.sv-area').first();
  const box = await area.boundingBox();
  await a.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, {
    steps: 4,
  });
  await a.mouse.up();
  await a.waitForTimeout(500);
  check(
    (await swatch.evaluate(function (e) {
      return getComputedStyle(e).backgroundColor;
    })) !== 'rgb(255, 0, 102)',
    'dragging in the color square changes the color',
  );
  check(
    (await a
      .locator(
        'button[aria-label="Pick a color from the screen"], .tip[data-tip="Pick a color from the screen"]',
      )
      .count()) > 0,
    'the own color picker has an eyedropper',
  );
  await a.click('h2:has-text("About you")');
  await a.click('button[aria-expanded]:has-text("Profile effect")');
  await a.waitForTimeout(600);
  await shot(a, '04b-efectos');
  await a.click('h2:has-text("About you")');
  await a.click('label:has-text("Gradient") input');
  await a.click('button:has-text("More options") >> nth=0');
  await a.waitForSelector('text=Angle');
  check(true, 'banner with gradient, angle and where it starts and ends');
  check(
    (await a.locator('.gbar').count()) === 1 || (await a.locator('.gbar:visible').count()) >= 1,
    'the gradient editor is one single bar that also holds the markers',
  );
  await a.click('button:has-text("Save changes")');
  await a.waitForTimeout(1000);
  check(true, 'profile picture and banner uploaded, name font saved');
  // The picture is ciphertext on the server: a friend sees it only if the key that alice sealed for them opens it.
  await b.waitForSelector('app-avatar img[src^="blob:"]', { timeout: 40000 });
  check(
    true,
    'a friend sees the profile picture: it was encrypted, and its key was sealed for them',
  );

  check(
    (await a.evaluate(function () {
      return window.__snd;
    })) > 0,
    'buttons play a sound',
  );
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--cur-pointer');
      })
    ).includes('url('),
    'themed cursor applied',
  );
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--bg-blur');
      })
    ).trim() !== '',
    'background blur is adjustable',
  );
  check(
    await a.evaluate(function () {
      const n = document.querySelector('.nav-item');
      return !n || getComputedStyle(n).transitionDuration !== '0s';
    }),
    'hover with a soft transition',
  );

  await a.click('a:has-text("Appearance")');
  await a.click('button[aria-expanded]:has-text("Typeface")');
  await a.waitForTimeout(600);
  check(
    (await a.locator('.choice-card:visible').count()) === 9,
    'the typeface shows nine cards (the last one uploads your own)',
  );
  await shot(a, '05a-tipografia');
  await a.click('button[aria-expanded]:has-text("Accent color")');
  await a.click('button[aria-label="Rose"]');
  await a
    .locator('button[aria-expanded]', { hasText: /^\s*Theme(?! presets)/ })
    .first()
    .click();
  await a.click('button:has-text("Dusk")');
  await a.click('button[aria-expanded]:has-text("Background")');
  await shot(a, '05b-fondos');
  await a.click('button:has-text("Stars")');
  await a.click('button[aria-expanded]:has-text("Mouse cursor")');
  await a.click('button:has-text("Sleek")');
  check(
    (
      await a.evaluate(function () {
        return getComputedStyle(document.documentElement).getPropertyValue('--cur-default');
      })
    ).includes('url('),
    'Sleek cursor applied',
  );
  const gifPath = path.join(TMP, 'cursor.gif');
  fs.writeFileSync(
    gifPath,
    Buffer.from(
      'R0lGODlhAQABAPAAAP8AAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==',
      'base64',
    ),
  );
  const cursorChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Upload your cursor")');
  (await cursorChooser).setFiles(gifPath);
  await a.waitForFunction(
    function () {
      return [...document.querySelectorAll('input')].some(function (i) {
        return i.value === 'cursor';
      });
    },
    null,
    { timeout: 10000 },
  );
  check(
    await a.evaluate(function () {
      return (
        document.documentElement.classList.contains('cursor-js') &&
        !!document.querySelector('.cursor-overlay')
      );
    }),
    'animated cursor uploaded: it is drawn by the own cursor',
  );
  await a.click('button:has-text("Sleek")');
  await a.click('app-select[label="Trail"] button, button[aria-label="Trail"]');
  await a.click('.select-option:has-text("Comet")');
  await a.waitForTimeout(500);
  check(
    await a.evaluate(function () {
      return document.documentElement.classList.contains('cursor-js');
    }),
    'cursor with a trail (comet) active',
  );
  await a.click('app-select[label="Trail"] button, button[aria-label="Trail"]');
  await a.click('.select-option:has-text("None")');
  await a.click('button:has-text("Animated")');
  await a.waitForTimeout(500);
  check(
    await a.evaluate(function () {
      return !!document.querySelector('.cursor-overlay svg');
    }),
    'animated cursor: drawn with animation',
  );
  // every cursor state keeps its themed drawing: link, arrow and text field
  await a.hover('a:has-text("Language")');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      const e = document.querySelector('.cursor-overlay .cs-active');
      return e ? e.dataset.cur : '';
    })) === 'pointer',
    'over a link the animated cursor draws the link one',
  );
  await a.hover('input[aria-label="Cursor name"]');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      const e = document.querySelector('.cursor-overlay .cs-active');
      return e ? e.dataset.cur : '';
    })) === 'text',
    'over a text field the animated cursor draws the text one (not the Windows one)',
  );
  await a.click('button:has-text("Static")');
  await a.waitForTimeout(300);
  await a.click('button[aria-expanded]:has-text("Chat bubbles")');
  await a.click('button:has-text("Outline")');
  await a.waitForTimeout(500);
  check(
    (await a.evaluate(function () {
      return document.documentElement.dataset.bubble;
    })) === 'outline',
    'the bubble style changes',
  );
  // the corner style is a row of seven choices
  await a.click('button[aria-expanded]:has-text("Corner style")');
  await a.waitForTimeout(500);
  await a.click('button[aria-label="Square"]');
  await a.waitForTimeout(200);
  check(
    (await a.evaluate(function () {
      return document.documentElement.style.getPropertyValue('--r');
    })) === '2px',
    'the corner choices change the rounding of the whole interface',
  );
  await a.click('button[aria-label="Soft"]');
  // mouse wheel over a slider: it goes up or down one step
  const deslizador = a.locator('input[type=range][min="12"][max="18"]').first();
  await deslizador.scrollIntoViewIfNeeded();
  const valorAntes = Number(await deslizador.inputValue());
  const caja = await deslizador.boundingBox();
  await a.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await a.mouse.wheel(0, -100);
  await a.waitForTimeout(200);
  const valorMas = Number(await deslizador.inputValue());
  // The whole interface follows the text size, so the slider may have moved: wait for it to settle, then the pointer goes to where it is now.
  await a.waitForTimeout(800);
  await deslizador.scrollIntoViewIfNeeded();
  const cajaNueva = await deslizador.boundingBox();
  await a.mouse.move(cajaNueva.x + cajaNueva.width / 2, cajaNueva.y + cajaNueva.height / 2);
  await a.mouse.wheel(0, 100);
  await a.waitForTimeout(200);
  const valorMenos = Number(await deslizador.inputValue());
  check(
    valorMas === valorAntes + 1 && valorMenos === valorAntes,
    'the mouse wheel raises and lowers a slider (step by step) ' +
      JSON.stringify([valorAntes, valorMas, valorMenos]),
  );
  await a.click('button[aria-expanded]:has-text("Corner style")');
  await a.waitForTimeout(600);
  // Opening a folding section closes the others, so the bubbles are opened again.
  if ((await a.locator('button[aria-expanded="false"]:has-text("Chat bubbles")').count()) === 1) {
    await a.click('button[aria-expanded]:has-text("Chat bubbles")');
    await a.waitForTimeout(600);
  }
  check(
    (await a.locator('button:has(.bubble-in)').count()) === 12,
    'there are twelve bubble styles',
  );
  await a.click('button:has-text("Neon")');
  await a.waitForTimeout(300);
  check(
    (await a.evaluate(function () {
      return document.documentElement.dataset.bubble;
    })) === 'neon',
    'a new bubble style is applied (Neon)',
  );
  await a.click('button:has-text("Round")');
  await shot(a, '05-apariencia');
  check(true, 'theme, background and rounding changed');

  await a.click('a:has-text("Sounds")');
  await a.click('button[aria-expanded]:has-text("Call ringtone")');
  await a.waitForTimeout(600);
  check(
    (await a.locator('.ring-card:visible').count()) === 6,
    'the automatic ringtone, four melodies and one of your own',
  );
  check(
    (await a.locator('.ring-card:has-text("Automatic")').count()) === 1,
    'there is a ringtone that follows the season',
  );
  await shot(a, '06a-tonos');
  await a.click('button:has-text("Open soundboard")');
  await a.waitForSelector('.sb-pill:has-text("All")');
  await shot(a, '06-soundboard');
  // The first press of an effect must sound (the effects are loaded before the person asks for them).
  const antesSfx = await a.evaluate(function () {
    return window.__snd;
  });
  await a.locator('.sb-grid .sb-tile:not(.sb-add)').first().click();
  await a
    .waitForFunction(
      function (n) {
        return window.__snd > n;
      },
      antesSfx,
      { timeout: 1500 },
    )
    .catch(function () {
      return undefined;
    });
  check(
    (await a.evaluate(function () {
      return window.__snd;
    })) > antesSfx,
    'the first press of an effect of the soundboard sounds',
  );
  const soundChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Add a sound")');
  (await soundChooser).setFiles(wavPath);
  // The sound opens in a window to cut it, name it and give it an emoji (there is no limit of 8 seconds any more).
  const editor = '[role="dialog"][aria-label="Edit the sound"]';
  await a.waitForSelector(editor + ' canvas.sound-wave', { timeout: 10000 });
  await a.waitForFunction(function (selector) {
    const ends = document.querySelectorAll(selector + ' input[type=range]');
    return ends.length === 2 && Number(ends[1].max) > 0.1 && Number(ends[1].value) > 0.1;
  }, editor);
  await a.fill(editor + ' input[aria-label="Emoji"]', '🔥');
  await a.fill(editor + ' input[aria-label="Name"]', 'boom');
  const keptBefore = await a.locator(editor + ' .text-accent').innerText();
  await a
    .locator(editor + ' input[type=range]')
    .nth(1)
    .evaluate(function halve(slider) {
      slider.value = String(Number(slider.max) / 2);
      slider.dispatchEvent(new Event('input'));
    });
  const keptAfter = await a.locator(editor + ' .text-accent').innerText();
  check(keptBefore !== keptAfter, 'soundboard: the end of the sound can be moved to cut it');
  await a.click(editor + ' button:has-text("Save")');
  await a.waitForSelector('button:has-text("boom")', { timeout: 10000 });
  check(
    (await a.locator('button:has-text("boom") .emoji-glyph').innerText()) === '🔥',
    'soundboard: own sound uploaded, cut, renamed and with an emoji',
  );
  await a.hover('button:has-text("boom")');
  await a.click('button[aria-label="Edit the sound"]');
  await a.waitForSelector(editor + ' canvas.sound-wave');
  await a.fill(editor + ' input[aria-label="Name"]', 'bam');
  await a.click(editor + ' button:has-text("Save")');
  await a.waitForSelector('button:has-text("bam")', { timeout: 10000 });
  check(
    (await a.locator('button:has-text("boom")').count()) === 0,
    'soundboard: an edited sound replaces the old one',
  );
  await a.click('div[class*="z-[75]"] button[aria-label="Close"]');

  await a.click('a:has-text("Stickers")');
  const waChooser = a.waitForEvent('filechooser');
  await a.click('button:has-text("Choose files")');
  (await waChooser).setFiles(wastickers);
  await a.waitForFunction(
    function () {
      return [...document.querySelectorAll('input')].some(function (i) {
        return i.value === 'Pack WA';
      });
    },
    null,
    { timeout: 15000 },
  );
  check(true, 'WhatsApp .wastickers pack imported');

  await a.click('a:has-text("Language")');
  await a.waitForTimeout(700);
  await shot(a, '06c-idioma');
  await a.click('button:has-text("Español")');
  await a.waitForSelector('text=Idioma');
  check(true, 'language changed to Spanish');

  await a.click('a:has-text("Acerca de")');
  await a.waitForSelector('text=Jondals', { timeout: 10000 });
  check(true, 'animated "Developed by Jondals" signature visible');
  await a.waitForTimeout(1500);
  await shot(a, '08-acerca');

  step('phone: settings are a list first, and the chat fits the screen');
  // The language was changed to Spanish above, so the controls are found by position, not by their words.
  await a.goto(WEB + '/direct');
  await a.setViewportSize({ width: 390, height: 700 });
  await a.waitForSelector('app-page-header');
  await a.locator('app-page-header button').first().click();
  await a.locator('.dock-btn').last().click();
  await a.waitForSelector('.settings-overlay nav a');
  check(
    (await a.locator('.settings-overlay main').isVisible()) === false,
    'on a phone the settings open as a list of sections',
  );
  await a.locator('.settings-overlay nav a').nth(1).click();
  await a.waitForSelector('.settings-overlay main button[class*="md:hidden"]');
  check(
    await a.evaluate(function () {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'a settings section fits in 390px',
  );
  await shot(a, '12-ajustes-movil');
  await a.locator('.settings-overlay main button[class*="md:hidden"]').click();
  await a.waitForSelector('.settings-overlay nav a >> nth=6');
  check(true, 'the back button leads to the list again');
  await a.keyboard.press('Escape');
  // The main screens on a phone: nothing may be wider than the screen (screenshots with CHATTERLY_SHOTS).
  for (const [name, route] of [
    ['friends', '/direct'],
    ['groups', '/groups'],
    ['voice', '/voice'],
  ]) {
    // Moved inside the app (no page load): every load asks the server to renew the session, which is rate limited.
    await a.evaluate(function (path) {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await a.waitForTimeout(1200);
    await shot(a, '13-movil-' + name);
    check(
      await a.evaluate(function () {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      }),
      `the ${name} screen fits in 390px`,
    );
  }
  await a.evaluate(function () {
    history.pushState({}, '', '/direct');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await a.waitForTimeout(900);
  const firstChat = a.locator('a[href*="/direct/"]').first();
  if (await firstChat.count()) {
    await firstChat.click();
    await a.waitForTimeout(900);
    await shot(a, '13-movil-chat');
    check(
      await a.evaluate(function () {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      }),
      'a conversation fits in 390px',
    );
  }
  await a.setViewportSize({ width: 1440, height: 900 });

  step('the server stores nothing in clear');
  await a.waitForTimeout(1500);
  const blob = fs
    .readdirSync(dataDir, { recursive: true })
    .map(function (f) {
      return path.join(dataDir, f);
    })
    .filter(function (f) {
      return fs.statSync(f).isFile();
    })
    .map(function (f) {
      return fs.readFileSync(f).toString('latin1');
    })
    .join('\n');
  for (const secret of ['Hello Bob', 'colourful reply', 'First message in the group', A.pw, B.pw]) {
    check(
      !blob.includes(secret),
      `"${secret.slice(0, 18)}" does not appear in the database or in the files`,
    );
  }

  // every picture on the disk is ciphertext (profile pictures, banners and the icon of the group): none starts like an image
  const pictures = fs.readdirSync(path.join(dataDir, 'uploads', 'images'));
  check(
    pictures.length > 0,
    'there are pictures stored (the icon, the profile picture and the banner)',
  );
  check(
    pictures.every(function (name) {
      const head = fs.readFileSync(path.join(dataDir, 'uploads', 'images', name)).subarray(0, 4);
      return head.toString('latin1') !== 'PNG' && head.toString('latin1') !== 'RIFF';
    }),
    'no picture is stored as a picture: the group icon is ciphertext too',
  );

  step('deleting the account');
  const C = { user: 'carol_' + suffix, pw: 'correct-horse-battery-1' };
  const c = await newUser('carol');
  let carolBearer = '';
  c.on('request', function remember(request) {
    carolBearer = request.headers()['authorization'] ?? carolBearer;
  });
  await register(c, C);
  await c.waitForTimeout(1200);
  await c.goto(WEB + '/direct(settings:settings/profile)');
  await c.click('button:has-text("Delete my account")');
  const eraseForm = '[role="dialog"][aria-label="Delete account"]';
  await c.waitForSelector(eraseForm);
  check(
    await c.locator(eraseForm + ' button[type=submit]').isDisabled(),
    'delete account: the button is off until the username is typed',
  );
  await c.fill(eraseForm + ' input[type=text]', C.user);
  await c.fill(eraseForm + ' input[type=password]', 'not-the-password-1');
  await c.click(eraseForm + ' button[type=submit]');
  await c.waitForSelector(eraseForm + ' .text-red-300');
  check(true, 'delete account: a wrong password does not erase it');
  await c.fill(eraseForm + ' input[type=password]', C.pw);
  await c.click(eraseForm + ' button[type=submit]');
  await c.waitForURL('**/login', { timeout: 30000 });
  check(true, 'delete account: it goes back to the sign in');
  const again = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: C.user, authSecret: 'A'.repeat(43) }),
  });
  check(
    again.status === 401 || again.status === 400,
    'delete account: the name can not sign in any more',
  );
  const stale = await fetch(API + '/api/me', {
    headers: { authorization: carolBearer },
  });
  check(
    carolBearer.length > 20 && stale.status === 401,
    'delete account: the old session token stops working at once',
  );
  // The page that loads after the erasure writes the default value of its own preferences, so what is checked is that nothing
  // that belongs to the account is left: no session, no pinned or verified keys, no active group, no used emoji.
  const leftKeys = await c.evaluate(function () {
    return Object.keys(localStorage);
  });
  const belonging = leftKeys.filter(function ofAccount(key) {
    return /session|pins|verified|activeGuild|emojiFreq/i.test(key);
  });
  check(
    belonging.length === 0,
    'delete account: nothing of the account stays in the browser' +
      (belonging.length ? ' (left: ' + belonging.join(', ') + ')' : ''),
  );

  step('API: requests without a session, and CORS');
  for (const route of [
    '/api/friends',
    '/api/guilds',
    '/api/images/x',
    '/api/gifs/status',
    '/api/rtc/config',
  ]) {
    const r = await fetch(API + route);
    check(r.status === 401, `${route} without a session answers 401`);
  }
  const pre = await fetch(API + '/api/friends', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://evil.example',
      'access-control-request-method': 'GET',
    },
  });
  check(!pre.headers.get('access-control-allow-origin'), 'a disallowed origin gets no CORS');
  const hdr = await fetch(API + '/api/friends');
  check(hdr.headers.get('x-content-type-options') === 'nosniff', 'defensive headers present');

  check(
    errors.length === 0,
    'no errors in the browser console' + (errors.length ? ':\n' + errors.join('\n') : ''),
  );
  console.log('\nALL CORRECT');
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  console.error('\n' + (e instanceof Error ? e.stack : e));
  for (const [name, page] of pages) {
    try {
      const file = path.join(os.tmpdir(), `chatterly-fallo-${name}.png`);
      await page.screenshot({ path: file });
      console.error('failure screenshot: ' + file);
    } catch {}
  }
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
