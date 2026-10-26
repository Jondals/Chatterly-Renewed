/**
 * frontend/scripts/postbuild.mjs
 * Runs after `ng build` and makes the first paint of the sign-in page instant:
 *   1. Inlines the stylesheet into index.html, so the first paint does not wait for a second request (the
 *      lazy fonts stylesheet stays a separate file and is switched on when the page is idle).
 *   2. Renders the sign-in page once in a real browser and stores its HTML inside <app-root>, so the page is
 *      visible as soon as the HTML arrives (Angular replaces it with the live page when it starts).
 *      One snapshot is made for each language; a tiny script picks the one that matches the person.
 *   3. The same script hides the snapshot for people who are already signed in (they would otherwise see the
 *      sign-in page for a moment). Its hash is added to the Content-Security-Policy.
 *
 *   node scripts/postbuild.mjs [distFolder]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/** The browser used to take the snapshots; without it (no Playwright installed) the snapshots are skipped, the rest is done. */
let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('Playwright is not installed: the sign-in snapshots are skipped.');
}

/** Folder with the built web app (the first argument, or Angular's default output folder). */
const DIST = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '..', 'dist', 'frontend', 'browser'),
);

/** Content types needed to serve the build to the browser that takes the snapshot. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Pages that get a snapshot: the sign-in and the registration pages (the root address shows sign-in). */
const PAGES = ['welcome', 'login', 'register'];

/** Languages the app is translated into: one snapshot is stored for each. */
const LANGUAGES = [
  { id: 'en', locale: 'en-US' },
  { id: 'es', locale: 'es-ES' },
];

/**
 * Which files each public page needs: the chunk of the page and everything that chunk imports, found by reading the
 * build. Asking for them from the first moment (modulepreload) saves the browser from finding them one by one
 * after each file arrives, which is what made the first paint of the sign-in page wait.
 * @param {string} selector Selector of the component of the page (for example "app-login").
 * @returns {string[]} File names, without the ones index.html already preloads.
 */
function chunksOf(selector, already) {
  const files = fs.readdirSync(DIST).filter(function isScript(name) {
    return name.endsWith('.js');
  });
  const start = files.find(function hasPage(name) {
    const text = fs.readFileSync(path.join(DIST, name), 'utf8');
    // The selector is written with double quotes or with backticks, depending on how the build minified the file.
    return (
      text.includes('selector:"' + selector + '"') ||
      text.includes('"' + selector + '"') ||
      text.includes('`' + selector + '`')
    );
  });
  const found = new Set();
  /** Follows the static imports of a file. */
  function visit(name) {
    if (found.has(name) || !fs.existsSync(path.join(DIST, name))) {
      return;
    }
    found.add(name);
    const text = fs.readFileSync(path.join(DIST, name), 'utf8');
    for (const match of text.matchAll(/(?:from|import)\s*"\.\/(chunk-[A-Z0-9]+\.js)"/g)) {
      visit(match[1]);
    }
  }
  if (start) {
    visit(start);
  }
  return [...found].filter(function isNew(name) {
    return !already.includes(name) && !name.startsWith('main-');
  });
}

/**
 * Script placed in index.html. It tells the CSS which snapshot matches the page and the language of the person
 * and hides the snapshot when a session is stored (the live app opens straight into the chat then).
 */
let SESSION_SCRIPT =
  "try{var p=JSON.parse(localStorage.getItem('chatterly.pref.language')||'\"auto\"');" +
  "var l=p==='auto'?(navigator.language||'en').slice(0,2).toLowerCase():p;" +
  "var q=location.pathname;document.documentElement.dataset.snap=l==='es'?'es':'en';" +
  // The apps (desktop, Android, iPhone) open the root address into the sign-in; a browser shows the first page of the web.
  "var n=window.CHATTERLY_NATIVE||window.chatterlyDesktop;" +
  "document.documentElement.dataset.page=q==='/register'?'register':q==='/login'?'login':q==='/'?(n?'login':'welcome'):'';" +
  "if(localStorage.getItem('chatterly.session'))document.documentElement.classList.add('has-session');" +
  // The accent color the person chose is applied from the first paint (the first layer and the animations use it).
  "var h=document.documentElement,a=JSON.parse(localStorage.getItem('chatterly.pref.accent')||'null');" +
  "if(a){h.dataset.accent=a;if(a==='custom'){var c=JSON.parse(localStorage.getItem('chatterly.pref.customAccent')||'null');" +
  "if(/^#[0-9a-f]{6}$/i.test(c))h.style.setProperty('--accent',c)}}}catch(e){}";

/**
 * Serves the build folder, answering index.html for unknown paths (the routes of the app).
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
function serveBuild(request, response) {
  const route = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  let file = path.join(DIST, route);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(response);
}

/**
 * Opens a page of the build in a browser set to a language and returns the HTML Angular rendered inside
 * <app-root>.
 * @param {string} page Name of the page: "login" or "register".
 * @param {string} locale Browser language, for example "en-US".
 * @returns {Promise<string>}
 */
async function takeSnapshot(page, locale) {
  const server = http.createServer(serveBuild);
  await new Promise(function listen(resolve) {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: locale });
    // The first page of the web is the root address; the sign-in and registration pages have their own.
    await tab.goto('http://127.0.0.1:' + port + '/' + (page === 'welcome' ? '' : page));
    await tab.waitForSelector(page === 'welcome' ? 'app-landing h1' : 'form');
    await tab.evaluate(function waitForFonts() {
      return document.fonts.ready;
    });
    await tab.waitForTimeout(400);
    return await tab.evaluate(function readRoot() {
      const root = document.querySelector('app-root');
      // Canvases cannot be saved as HTML; the live page draws them again.
      for (const canvas of root.querySelectorAll('canvas')) {
        canvas.removeAttribute('style');
      }
      return root.innerHTML;
    });
  } finally {
    await browser.close();
    server.close();
  }
}

/** Replaces the stylesheet link of index.html by the stylesheet itself. */
function inlineStylesheet(html) {
  const link = /<link rel="stylesheet" href="([^"]+\.css)"[^>]*>/.exec(html);
  if (!link) {
    return html;
  }
  const cssFile = path.join(DIST, link[1]);
  const css = fs.readFileSync(cssFile, 'utf8');
  fs.rmSync(cssFile);
  return html.replace(link[0], '<style>' + css + '</style>');
}

/** Points the lazy fonts link of index.html at the hashed file Angular built (lazy-fonts-XXXX.css). */
function pointLazyFonts(html) {
  const built = fs.readdirSync(DIST).find(function isLazyFonts(name) {
    return /^lazy-fonts.*\.css$/.test(name);
  });
  return built ? html.replace('href="lazy-fonts.css"', 'href="' + built + '"') : html;
}

/** Adds the "has-session" script before the stylesheet and allows exactly that script in the CSP. */
function addSessionScript(html) {
  // People who are not signed in will see the sign-in or the registration page: their chunks load in parallel.
  const asked = Array.from(html.matchAll(/rel="modulepreload" href="([^"]+)"/g)).map(
    function name(m) {
      return m[1];
    },
  );
  const lists = {
    welcome: chunksOf('app-landing', asked),
    login: chunksOf('app-login', asked),
    register: chunksOf('app-register', asked),
  };
  SESSION_SCRIPT = SESSION_SCRIPT.replace(
    '}catch(e){}',
    ";if(!localStorage.getItem('chatterly.session')){var L=" +
      JSON.stringify(lists) +
      "[document.documentElement.dataset.page]||[];for(var i=0;i<L.length;i++){var k=document.createElement('link');k.rel='modulepreload';k.href='/'+L[i];document.head.appendChild(k)}}}catch(e){}",
  );
  const hash = createHash('sha256').update(SESSION_SCRIPT).digest('base64');
  const withPolicy = html.replace("script-src 'self'", "script-src 'self' 'sha256-" + hash + "'");
  return withPolicy.replace('<style>', '<script>' + SESSION_SCRIPT + '</script><style>');
}

/**
 * Allows the structured data (`<script type="application/ld+json">`) in the policy by its hash. A data block is never run, but
 * Firefox still reports it as a script that the policy blocks (a warning in the console on every load).
 */
function allowDataScripts(html) {
  const hashes = Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ).map(function hashOf(m) {
    return "'sha256-" + createHash('sha256').update(m[1]).digest('base64') + "'";
  });
  return hashes.length
    ? html.replace("script-src 'self'", "script-src 'self' " + hashes.join(' '))
    : html;
}

/**
 * Asks for the fonts of the first paint right away: Inter (the text) and Open Sans (the headlines of the first page). The first
 * paint is drawn with them and does not change afterwards, so the page does not jump when they arrive.
 */
function preloadFont(html) {
  const media = path.join(DIST, 'media');
  const files = fs.existsSync(media) ? fs.readdirSync(media) : [];
  let links = '';
  for (const family of ['open-sans']) {
    const font = files.find(function isFamily(name) {
      return new RegExp('^' + family + '-latin-wght-normal.*\.woff2$').test(name);
    });
    if (font) {
      links +=
        '<link rel="preload" as="font" type="font/woff2" crossorigin href="/media/' + font + '"/>';
    }
  }
  return links ? html.replace('<style>', links + '<style>') : html;
}

/**
 * ? What people who are already signed in see while the app starts instead of an empty dark page: the logo of
 * Chatterly-Renewed, breathing. It lives inside <app-root>, so Angular removes it when the app draws itself, and its
 * little stylesheet is inline (it is not part of the bundle). Only shown when the "has-session" mark is on.
 */
const SPLASH = {
  style:
    '<style>.boot-splash{display:none}html.has-session .boot-splash{position:fixed;inset:0;display:grid;place-items:center;background:#06070b}' +
    '.boot-splash svg{width:6rem;height:6rem;filter:drop-shadow(0 0 22px #2ef2b080);animation:boot-breathe 1.6s ease-in-out infinite}' +
    '@keyframes boot-breathe{50%{transform:scale(1.08);filter:drop-shadow(0 0 34px #8b5cf6aa)}}' +
    '@media (prefers-reduced-motion:reduce){.boot-splash svg{animation:none}}</style>',
  markup:
    '<div class="boot-splash" aria-hidden="true"><svg viewBox="0 0 64 64"><defs><linearGradient id="bs" x1="0" x2="1" y1="0" y2="1">' +
    '<stop offset="0" stop-color="#2ef2b0"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
    '<path fill="url(#bs)" d="M16 22a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8h-9l-9 8v-8a8 8 0 0 1-6-8z"/>' +
    '<circle cx="26" cy="28" r="2.6" fill="#06070b"/><circle cx="38" cy="28" r="2.6" fill="#06070b"/></svg></div>',
};

/** The public address of the site (no trailing slash): the canonical link, the social cards, the sitemap and robots.txt use it. */
const SITE_URL = (process.env.SITE_URL ?? 'https://chatterly.dpdns.org').replace(
  /\/+$/,
  '',
);

/** Writes sitemap.xml (the only pages a search engine can see are the sign-in and registration ones) and points robots.txt at it. */
function writeSearchFiles() {
  const pages = ['/', '/login', '/register'];
  const urls = pages
    .map(function entry(page) {
      return '  <url><loc>' + SITE_URL + page + '</loc></url>';
    })
    .join('\n');
  fs.writeFileSync(
    path.join(DIST, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls +
      '\n</urlset>\n',
  );
  for (const name of ['robots.txt', 'llms.txt']) {
    const file = path.join(DIST, name);
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('__SITE_URL__').join(SITE_URL));
    }
  }
}

/**
 * The emoji font comes in two formats, woff2 and, as a fallback, woff. Every browser that can run this app reads woff2 (the
 * format of all the other fonts here, which have no fallback), so the woff files are never asked for: they are left out. That is
 * half of the weight of the build (about 7 MB), in the container, on the disk and in the installer of the desktop app.
 */
function dropLegacyFonts() {
  const sheet = path.join(DIST, 'lazy-fonts.css');
  if (!fs.existsSync(sheet)) {
    return;
  }
  const dropped = [];
  const css = fs
    .readFileSync(sheet, 'utf8')
    .replace(/,\s*url\("([^"]+\.woff)"\)\s*format\("woff"\)/g, function remove(match, file) {
      dropped.push(file);
      return '';
    });
  if (dropped.length === 0) {
    return;
  }
  // ! A file is deleted only when nothing refers to it any more.
  if (/\.woff["')]/.test(css)) {
    console.log('A woff file is still referenced: the legacy fonts stay');
    return;
  }
  fs.writeFileSync(sheet, css);
  let bytes = 0;
  for (const file of dropped) {
    const target = path.join(path.dirname(sheet), file);
    if (fs.existsSync(target)) {
      bytes += fs.statSync(target).size;
      fs.rmSync(target);
    }
  }
  console.log(
    'Legacy woff fonts left out: ' + dropped.length + ' files, ' + Math.round(bytes / 1024) + ' kB',
  );
}

/** Builds the final index.html. */
async function main() {
  dropLegacyFonts();
  const indexPath = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes('data-snapshot')) {
    console.log('index.html already has a snapshot');
    return;
  }
  let snapshots = '';
  for (const page of chromium ? PAGES : []) {
    for (const language of LANGUAGES) {
      const body = await takeSnapshot(page, language.locale);
      snapshots +=
        '<div class="boot-snapshot" lang="' +
        language.id +
        '" data-page="' +
        page +
        '">' +
        body +
        '</div>';
    }
  }
  html = pointLazyFonts(html);
  html = inlineStylesheet(html);
  html = addSessionScript(html);
  html = preloadFont(html);
  html = html.replace('</head>', SPLASH.style + '</head>');
  html = html.replace(
    /<app-root([^>]*)>\s*<\/app-root>/,
    '<app-root$1 data-snapshot>' + SPLASH.markup + snapshots.replace(/\$/g, '$$$$') + '</app-root>',
  );
  html = html.split('__SITE_URL__').join(SITE_URL);
  html = allowDataScripts(html);
  fs.writeFileSync(indexPath, html);
  writeSearchFiles();
  console.log('Sign-in snapshot and inline stylesheet added to ' + indexPath);
}

main().catch(function onError(error) {
  console.error(error);
  process.exit(1);
});
