/**
 * mobile/scripts/prepare-web.mjs
 * Copies the built web app (pnpm build at the root) into mobile/web, the folder that Capacitor packs inside the APK, and
 * makes the changes that only the native apps need (Android, and iOS with `--platform ios`):
 *   1. native-config.js: the address of the API and the native policy (calls ONLY through the relay over TLS). It is a
 *      file inside the APK, loaded before the app, so no server can change it.
 *   2. The viewport without viewport-fit=cover: the WebView is kept out of the bars of the system (see below), and
 *      native-config.js marks the page as the Android app (html[data-platform="android"]) for the styles of the phone.
 *   3. A stricter Content-Security-Policy: the page may talk only to the exact API origin (no "any wss:" and no
 *      localhost), media only from itself and the API, and no third-party frames (embedded players could open their own
 *      WebRTC connections and leak the address, which the relay policy cannot see).
 *   4. No web emoji font: the Android WebView draws it empty, and the emoji font of Android is the same Noto.
 *
 *   node scripts/prepare-web.mjs [--from <web build>] [--to <folder>]
 *   CHATTERLY_URL=https://example.org node scripts/prepare-web.mjs
 *
 * ! The folder is wiped first (one build, never a mix). The API must be https. The web version must match the version
 *   of the app, or the APK would carry old code under a new number. Any surprise in index.html stops the script.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The public server: the default address of the API. */
const DEFAULT_API = 'https://chatterlyrenewed.duckdns.org';

/** The folder of the native apps. */
const MOBILE = path.resolve(import.meta.dirname, '..');

/** The app this web folder is for: Android (the default) or iOS. */
const PLATFORM = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : 'android';
if (PLATFORM !== 'android' && PLATFORM !== 'ios') {
  console.error('--platform must be android or ios, not ' + PLATFORM);
  process.exit(1);
}

/** Reads `--name value` from the command line, or the fallback. */
function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : fallback;
}

/** Stops the script with a message. */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * The origin of the API from CHATTERLY_URL (or the public server). Only https, and only an origin: a path, a query or
 * credentials in the address are refused, because they would end up in the CSP and in every request.
 */
function apiOrigin() {
  const raw = process.env['CHATTERLY_URL'] || DEFAULT_API;
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('CHATTERLY_URL is not an address: ' + raw);
  }
  if (url.protocol !== 'https:') fail('The Android app only talks to an https server, not ' + raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    fail('CHATTERLY_URL must be only the origin of the server (https://host[:port]), not ' + raw);
  }
  return url.origin;
}

/** The directives of a CSP, in order, as [name, value] pairs. */
function parseCsp(text) {
  return text
    .split(';')
    .map(function trim(part) {
      return part.trim();
    })
    .filter(Boolean)
    .map(function split(part) {
      const space = part.indexOf(' ');
      return space < 0 ? [part, ''] : [part.slice(0, space), part.slice(space + 1).trim()];
    });
}

/**
 * The CSP of the Android app, from the one of the web build. script-src is kept as it is (the build adds the hashes of
 * its inline script); the directives that name other servers are replaced by exact origins.
 */
function nativeCsp(webCsp, api) {
  const socket = api.replace(/^https:/, 'wss:');
  const wanted = {
    'connect-src': "'self' " + api + ' ' + socket,
    'media-src': "'self' blob: mediastream: " + api,
    // The two players of "listen and watch together" (see music-link.ts): they are the only frames the app may open. ! With
    // 'none' the call could not show them at all in the app.
    // ! iOS: the YouTube player is shown inside a page of the server (see backend/src/routes/player.ts), so that one is allowed too.
    'frame-src': 'https://www.youtube-nocookie.com https://open.spotify.com' + (PLATFORM === 'ios' ? ' ' + api : ''),
  };
  const directives = parseCsp(webCsp);
  const names = directives.map(function name(pair) {
    return pair[0];
  });
  for (const required of ['default-src', 'script-src', 'connect-src', 'frame-src', 'object-src']) {
    if (!names.includes(required))
      fail('The CSP of index.html has no ' + required + ': update this script.');
  }
  const out = directives.map(function replace(pair) {
    return pair[0] in wanted ? [pair[0], wanted[pair[0]]] : pair;
  });
  return out
    .map(function join(pair) {
      return pair[1] ? pair[0] + ' ' + pair[1] : pair[0];
    })
    .join('; ');
}

/** The content of native-config.js: read once by config.ts when the app starts. */
function nativeConfig(api) {
  return [
    '/**',
    ' * native-config.js (written by mobile/scripts/prepare-web.mjs; do not edit)',
    ' * The settings of the Android app. This file is inside the APK: a server cannot change it.',
    ' * ! strictRelay: every call goes through the relay over TLS (turns:), whatever the server answers.',
    ' */',
    "'use strict';",
    'window.CHATTERLY_API = ' + JSON.stringify(api) + ';',
    "Object.defineProperty(window, 'CHATTERLY_NATIVE', {",
    "  value: Object.freeze({ platform: '" + PLATFORM + "', strictRelay: true }),",
    '  writable: false,',
    '  configurable: false,',
    '});',
    '// The styles that only the Android app uses hang from this mark (html[data-platform="android"]).',
    "document.documentElement.setAttribute('data-platform', '" + PLATFORM + "');",
    '',
  ].join('\n');
}

/**
 * Takes the web emoji font out of the APK: the @font-face rules of "Noto Color Emoji" in the lazy fonts stylesheet and
 * their files. ! The Android WebView loads that font but draws every emoji EMPTY (seen in the emulator with WebView 145
 * and on a phone). Android's own emoji font is Noto Color Emoji too (the same drawings), so the page falls back to it.
 * It also makes the APK about 4.5 MB smaller.
 */
function dropEmojiFont(target) {
  const sheet = fs.readdirSync(target).find(function isLazyFonts(name) {
    return /^lazy-fonts.*\.css$/.test(name);
  });
  if (!sheet) fail('There is no lazy-fonts stylesheet in the web build: update this script.');
  const file = path.join(target, sheet);
  const css = fs.readFileSync(file, 'utf8');
  const rules = /@font-face\s*\{[^}]*Noto Color Emoji[^}]*\}/g;
  const count = (css.match(rules) || []).length;
  if (count === 0)
    fail('The lazy fonts have no Noto Color Emoji rules to take out: update this script.');
  fs.writeFileSync(file, css.replace(rules, ''));
  const media = path.join(target, 'media');
  let files = 0;
  for (const name of fs.existsSync(media) ? fs.readdirSync(media) : []) {
    if (name.startsWith('noto-color-emoji-')) {
      fs.rmSync(path.join(media, name));
      files++;
    }
  }
  console.log(
    'Web emoji font taken out (' + count + ' rules, ' + files + ' files): Android draws its own.',
  );
}

/** Builds the folder of the Android app from the web build. */
function main() {
  const source = argument(
    '--from',
    path.resolve(MOBILE, '..', 'frontend', 'dist', 'frontend', 'browser'),
  );
  const target = argument('--to', path.join(MOBILE, 'web'));
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    fail('There is no web build at ' + source + '. Run "pnpm build" at the root first.');
  }
  const webVersion = JSON.parse(
    fs.readFileSync(path.resolve(MOBILE, '..', 'frontend', 'package.json'), 'utf8'),
  ).version;
  const appVersion = JSON.parse(fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8')).version;
  if (webVersion !== appVersion) {
    fail(
      'Versions differ: the web app is ' +
        webVersion +
        ' and the Android app is ' +
        appVersion +
        '.',
    );
  }
  const api = apiOrigin();

  let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi;
  const found = [...html.matchAll(meta)];
  if (found.length !== 1)
    fail('index.html must have exactly one CSP meta tag (found ' + found.length + ').');
  if (html.includes('native-config.js'))
    fail('index.html already loads native-config.js: the build is not clean.');
  const tag =
    '<meta http-equiv="Content-Security-Policy" content="' +
    nativeCsp(found[0][1], api) +
    '" />' +
    // ! Right after the CSP and before every script of the app: config.ts reads it when it is first imported.
    '<script src="native-config.js"></script>';
  html = html.replace(found[0][0], tag);
  // ! Without viewport-fit=cover Capacitor keeps the WebView out of the status bar, the navigation bar and the keyboard
  // (it pads the window natively), so no screen of the app (chat, settings, dialogs, calls) is drawn under them. The web
  // keeps cover, for the notch of phones in the browser.
  const viewport = /(<meta\s+name="viewport"\s+content="[^"]*?),\s*viewport-fit=cover([^"]*")/i;
  if (!viewport.test(html))
    fail('index.html has no viewport-fit=cover: update this script.');
  // ! Only Android: on iOS the page goes under the status bar and the home indicator, and it keeps cover so env(safe-area-inset-*)
  // gives the real insets (the styles of the app already use them).
  if (PLATFORM === 'android') html = html.replace(viewport, '$1$2');
  // ! iOS ignores touch-action on some elements and zoomed the page with a double tap or a pinch: inside the app the zoom is off.
  else html = html.replace('initial-scale=1', 'initial-scale=1, maximum-scale=1, user-scalable=no');

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  fs.writeFileSync(path.join(target, 'index.html'), html);
  fs.writeFileSync(path.join(target, 'native-config.js'), nativeConfig(api));
  dropEmojiFont(target);
  console.log(
    'Web build ' +
      webVersion +
      ' prepared for ' +
      (PLATFORM === 'ios' ? 'iOS' : 'Android') +
      ' in ' +
      target +
      ' (API ' +
      api +
      ')',
  );
}

main();
