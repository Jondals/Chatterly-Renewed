/**
 * desktop/src/bundle.cjs
 * Serves the web app that is packed INSIDE the desktop app, on its own address app://chatterly.
 *
 * * Why: the code that handles the keys is the one that was signed into the installer, not whatever a server sends on
 *   each start. Updates reach the user as a new version of the app.
 * ! The files are read only from the web folder: a path that tries to leave it (.., encoded slashes, drives) is refused.
 * * The page needs two things the browser version gets for free: the address of the API (window.CHATTERLY_API, set by
 *   the preload) and a CSP that lets it call that address. The CSP of index.html is rewritten here, once, on the way out.
 */
'use strict';

const { protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'chatterly';
const ORIGIN = SCHEME + '://' + HOST;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** Must run before the app is ready. Makes app:// behave like https: secure context (crypto, IndexedDB), fetch, streams. */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      // codeCache: V8 keeps the compiled code of the scripts between starts, so the second start does not compile them again.
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

function reply(status, body, extra) {
  return new Response(body, { status, headers: { ...HEADERS, ...extra } });
}

/**
 * index.html with the connections narrowed to the server the app talks to. The CSP of the page allows any "wss:" host and
 * localhost (the web build is served by Caddy, which narrows it to its own domain); the installed app has no Caddy, so here
 * the whole connect-src directive becomes: the app itself, the API address and the WebSocket of that same address, nothing else.
 * ! So a script that got in by mistake could not send anything to any other server. Throws if the CSP no longer has the
 *   expected shape.
 */
function allowApiInCsp(html, apiOrigin) {
  const pattern = /connect-src [^;"]*/;
  if (!pattern.test(html)) {
    throw new Error(
      'index.html has no connect-src directive to narrow: update desktop/src/bundle.cjs',
    );
  }
  const socket = apiOrigin.replace(/^http/, 'ws');
  return html.replace(pattern, "connect-src 'self' " + apiOrigin + ' ' + socket);
}

/** True when `file` is inside `root` (both absolute and normalised). */
function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Builds the function that answers every app:// request. */
function makeHandler(webDir, apiOrigin) {
  const root = path.resolve(webDir);
  const indexPath = path.join(root, 'index.html');
  let indexBody = null;

  async function handler(request) {
    const url = new URL(request.url);
    if (url.hostname !== HOST) return reply(404, 'Not found');
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return reply(405, 'Method not allowed');

    let wanted;
    try {
      wanted = decodeURIComponent(url.pathname);
    } catch (error) {
      return reply(400, 'Bad request');
    }
    if (wanted.includes('\0') || wanted.includes('\\')) return reply(400, 'Bad request');
    // The same rule as the server: nothing under /.well-known, and no app routes there.
    if (wanted.startsWith('/.well-known/')) return reply(404, 'Not found');

    const target = path.resolve(root, '.' + wanted);
    if (target !== root && !isInside(root, target)) return reply(403, 'Forbidden');

    let file = target;
    let stat = null;
    try {
      stat = await fs.promises.stat(file);
    } catch (error) {
      stat = null;
    }
    if (!stat || stat.isDirectory()) {
      // A path with an extension is a missing file; any other path is a page of the app (client-side router).
      if (stat === null && path.extname(wanted) !== '') return reply(404, 'Not found');
      file = indexPath;
    }

    let body = await fs.promises.readFile(file);
    const extension = path.extname(file).toLowerCase();
    const type = TYPES[extension] || 'application/octet-stream';
    if (file === indexPath)
      body = Buffer.from(allowApiInCsp(body.toString('utf8'), apiOrigin), 'utf8');
    const hashed = /-[A-Z0-9]{8}\.(js|css|woff2?)$/i.test(file);
    return reply(200, request.method === 'HEAD' ? null : body, {
      'content-type': type,
      'content-length': String(body.length),
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }
  return handler;
}

/** Starts answering app:// for a session. */
function install(ses, webDir, apiOrigin) {
  ses.protocol.handle(SCHEME, makeHandler(webDir, apiOrigin));
}

/** True when the folder holds a built web app. */
function hasWebApp(webDir) {
  return fs.existsSync(path.join(webDir, 'index.html'));
}

module.exports = { SCHEME, ORIGIN, registerScheme, install, hasWebApp, allowApiInCsp, isInside };
