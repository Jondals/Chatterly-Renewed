/**
 * scripts/static-server.mjs
 * The request handler of the small static web server that serves the built web app (used by scripts/produccion.mjs).
 *
 * What it does: answers GET and HEAD requests with the files of the build, returns index.html for the routes of the
 * app (so a reload of /direct/<id> works), compresses text files once and keeps them in memory, caches hashed files
 * forever and adds the usual security headers.
 *
 * Why it is a separate file: the handler used to live inside produccion.mjs, which starts the backend as soon as it is
 * loaded, so it could not be tested. Here it only needs the folder to serve, and the single test exercises it directly.
 *
 * ! Safety: nothing outside the folder is ever served (the path is resolved and checked against the folder, not matched
 * by prefix), a malformed address answers 400 instead of throwing (an exception in a request handler would stop the
 * whole process), and only GET and HEAD are accepted.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Content type of each file extension the build produces. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.woff': 'font/woff',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Extensions worth compressing (the rest is already compressed). */
const COMPRESSIBLE = ['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt', '.ico'];

/** Headers added to every response. */
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
};

/**
 * Turns the path of a request into the file to send, or null when the address is malformed or tries to leave the
 * folder. The folder itself and anything that is not a regular file fall back to index.html (the app routes).
 *
 * @param {string} webDir Absolute path of the folder with the build.
 * @param {string} rawUrl The URL of the request, as received (path and query).
 * @returns {string | null} Absolute path of the file, or null for a bad request.
 */
export function resolveFile(webDir, rawUrl) {
  let route;
  try {
    route = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  } catch {
    return null;
  }
  if (route.includes('\0')) return null;
  const index = path.join(webDir, 'index.html');
  const file = path.resolve(webDir, '.' + route);
  const relative = path.relative(webDir, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return fs.statSync(file).isFile() ? file : index;
  } catch {
    return index;
  }
}

/** Whether an address is one of the app (a route like /direct/<id>) and not a request for a file (it has an extension or is under /.well-known/). */
function isAppRoute(rawUrl) {
  let route;
  try {
    route = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  } catch {
    return false;
  }
  return !route.startsWith('/.well-known/') && path.extname(route) === '';
}

/**
 * Creates the request handler for a folder with a build.
 *
 * @param {string} webDir Folder with the built web app (it must contain index.html).
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void}
 */
export function createStaticHandler(webDir) {
  const root = path.resolve(webDir);
  /** Compressed copies of the files, made the first time each one is asked for. */
  const compressedCache = new Map();

  /**
   * Returns the file as it should be sent: compressed when the browser accepts it and the file is text.
   * @param {string} file Absolute path of the file.
   * @param {string} acceptEncoding Value of the Accept-Encoding header.
   * @returns {{ body: Buffer, encoding: string | null }}
   */
  function readForClient(file, acceptEncoding) {
    const extension = path.extname(file);
    const wantsBrotli = /\bbr\b/.test(acceptEncoding);
    const wantsGzip = /\bgzip\b/.test(acceptEncoding);
    if (!COMPRESSIBLE.includes(extension) || (!wantsBrotli && !wantsGzip)) {
      return { body: fs.readFileSync(file), encoding: null };
    }
    const encoding = wantsBrotli ? 'br' : 'gzip';
    const key = file + '|' + encoding;
    let body = compressedCache.get(key);
    if (!body) {
      const raw = fs.readFileSync(file);
      body =
        encoding === 'br'
          ? zlib.brotliCompressSync(raw, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
            })
          : zlib.gzipSync(raw, { level: 9 });
      compressedCache.set(key, body);
    }
    return { body, encoding };
  }

  /**
   * ? Answers one request: the file if it exists, otherwise index.html so the app can handle the route.
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  return function handleRequest(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const file = resolveFile(root, request.url ?? '/');
    if (!file) {
      response.writeHead(400, SECURITY_HEADERS);
      response.end();
      return;
    }
    // A file that does not exist is a 404, not the page of the app: only addresses of the app (no extension) get index.html.
    if (file === path.join(root, 'index.html') && !isAppRoute(request.url ?? '/')) {
      response.writeHead(404, SECURITY_HEADERS);
      response.end();
      return;
    }
    const hashed = /-[A-Za-z0-9]{8}\.(js|css|woff2?)$/.test(file);
    // ! The recorded sounds do not change between versions (and are small): a week in the cache of the browser.
    const sound = file.endsWith('.ogg');
    const { body, encoding } = readForClient(
      file,
      String(request.headers['accept-encoding'] ?? ''),
    );
    const headers = {
      ...SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': hashed
        ? 'public, max-age=31536000, immutable'
        : sound
          ? 'public, max-age=604800'
          : 'no-cache',
      vary: 'Accept-Encoding',
    };
    if (encoding) headers['content-encoding'] = encoding;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
  };
}
