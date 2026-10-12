/**
 * test/e2e/support.mjs
 * What the steps of the browser test share: the temporary folder, the printing of a passed check, the commands, a free port,
 * a small static server, the files made for the uploads (a PNG, a zip) and the cleanup that leaves nothing behind.
 * ! Everything temporary lives in one folder that `cleanup` removes, whatever happened.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const BACKEND = path.join(ROOT, 'backend');
export const FRONTEND = path.join(ROOT, 'frontend');
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterly-test-'));
export const hadAngularCache = fs.existsSync(path.join(FRONTEND, '.angular'));
export const children = [];
export const pages = [];
export const errors = [];
/** The two things the steps start and the cleanup stops. */
export const shared = { browser: null, webServer: null };

/** Optional: CHATTERLY_SHOTS=<dir> saves screenshots for a visual review (nothing is written otherwise). */
export async function shot(page, name) {
  const dir = process.env.CHATTERLY_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, name + '.png') });
}

export const step = function (s) {
  // CHATTERLY_STOP_BEFORE=<text>: stops at the step with that text in its title (to work on one part without running it all)
  const stop = process.env.CHATTERLY_STOP_BEFORE;
  if (stop && s.includes(stop)) throw new Error('Stopped on purpose before: ' + s);
  return console.log('\n== ' + s);
};
export const check = function (cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg);
  console.log('  ok  ' + msg);
};

/** Runs a command and fails if it ends with an error. */
export function run(cmd, args, opts = {}) {
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
export function freePort() {
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
export function serveStatic(dir, port) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.wasm': 'application/wasm',
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
export async function waitFor(url, ms = 60000) {
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
export function makePng() {
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
export function makeZip(entries, crc) {
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
export function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  else child.kill('SIGKILL');
}

/** Closes the browsers and the servers and deletes everything temporary, whatever happened. */
export async function cleanup() {
  try {
    await shared.browser?.close();
  } catch {}
  shared.webServer?.close();
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

/**
 * A new picture opens the window to adjust it (move and zoom): drags the picture a little, zooms with the slider and
 * saves, then waits for the window to close.
 * @param {import('playwright').Page} page
 */
export async function saveAdjusted(page) {
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
