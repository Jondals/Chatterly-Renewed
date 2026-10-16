/**
 * mobile/scripts/make-icons.mjs
 * Draws every icon and splash picture of the Android app from the logo of the web app (frontend/public/favicon.svg), so the
 * app has the same logo as the web and the desktop app. Run it again after changing the logo:
 *
 *   node mobile/scripts/make-icons.mjs
 *
 * * What it writes (inside mobile/android/app/src/main/res):
 *   - mipmap-*dpi/ic_launcher_foreground.png: the bubble alone, inside the safe zone of the adaptive icon (Android 8+
 *     crops the outer part with the shape of the phone: circle, squircle...). The background is a color.
 *   - mipmap-*dpi/ic_launcher.png and ic_launcher_round.png: the whole logo, for older Android and launchers.
 *   - splash.png of every drawable folder: the logo on the dark background of the app, for the start screen.
 * * The iOS app (mobile/ios) gets its icon (1024 px, opaque: iOS refuses transparency and rounds the corners itself) and its
 *   splash pictures (Assets.xcassets), drawn the same way.
 * * It uses the Chromium of Playwright (already a dependency of the project): the SVG is drawn by a real browser at each
 *   exact size, so the gradient and the round shapes stay sharp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RES = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS = path.join(ROOT, 'mobile', 'ios', 'App', 'App', 'Assets.xcassets');
const LOGO = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'favicon.svg'), 'utf8');

/** The dark of the logo (the square behind the bubble) and the background of the app. */
const ICON_BACKGROUND = '#0a0c11';
const APP_BACKGROUND = '#06070b';

/** The parts of the logo: its gradient and the bubble with its two eyes, taken from favicon.svg (64 × 64 units). */
function logoParts() {
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(LOGO)?.[0];
  const bubble = /<path[^>]*\/>/.exec(LOGO)?.[0];
  const eyes = [...LOGO.matchAll(/<circle[^>]*\/>/g)].map(function tag(match) {
    return match[0];
  });
  if (!defs || !bubble || eyes.length !== 2) {
    throw new Error(
      'favicon.svg does not have the expected shape (gradient, bubble, two eyes): update this script.',
    );
  }
  return { defs, bubble, eyes: eyes.join('') };
}

/**
 * The foreground of the adaptive icon: 108 × 108 units, transparent, with the bubble centred in the safe zone (the
 * inner circle of 66 units that every launcher shows). The bubble (about 36 units tall in the logo) is made 1.2 times
 * bigger, so it fills that zone like in the logo.
 */
function foregroundSvg() {
  const { defs, bubble, eyes } = logoParts();
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">' +
    defs +
    '<g transform="translate(54 54) scale(1.2) translate(-32 -32)">' +
    bubble +
    eyes +
    '</g></svg>'
  );
}

/** The whole logo in a circle (the round icon of older launchers). */
function roundSvg() {
  const { defs, bubble, eyes } = logoParts();
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    defs +
    '<circle cx="32" cy="32" r="32" fill="' +
    ICON_BACKGROUND +
    '"/>' +
    '<g transform="translate(32 32) scale(0.9) translate(-32 -32)">' +
    bubble +
    eyes +
    '</g></svg>'
  );
}

/** A splash picture: the logo (a fifth of the shorter side, at least 96 px) in the middle of the dark background. */
function splashHtml(width, height) {
  const size = Math.max(96, Math.round(Math.min(width, height) / 5));
  return (
    '<html><body style="margin:0;width:' +
    width +
    'px;height:' +
    height +
    'px;background:' +
    APP_BACKGROUND +
    ';display:flex;align-items:center;justify-content:center">' +
    LOGO.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') +
    '</body></html>'
  );
}

/** The size of a PNG (from its header). */
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Draws a page at an exact size and saves it as a PNG (transparent where the page has no background). */
async function draw(page, html, width, height, file, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.screenshot({
    path: file,
    omitBackground: transparent,
    clip: { x: 0, y: 0, width, height },
  });
}

/** An SVG drawn to fill a square of `size` pixels. */
function svgPage(svg, size) {
  return (
    '<html><body style="margin:0;background:transparent">' +
    svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" style="display:block" ') +
    '</body></html>'
  );
}

/** The icon of iOS: the logo on its dark square, edge to edge (the system rounds the corners). */
function iosIconHtml(size) {
  return (
    '<html><body style="margin:0;width:' +
    size +
    'px;height:' +
    size +
    'px;background:' +
    ICON_BACKGROUND +
    '">' +
    LOGO.replace('<svg ', '<svg width="' + size + '" height="' + size + '" style="display:block" ') +
    '</body></html>'
  );
}

/** Draws the icon and the splash pictures of the iOS app (when the project exists). */
async function drawIos(page) {
  if (!fs.existsSync(IOS_ASSETS)) return 0;
  let written = 0;
  const icon = path.join(IOS_ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  await draw(page, iosIconHtml(1024), 1024, 1024, icon, false);
  written++;
  const splashes = path.join(IOS_ASSETS, 'Splash.imageset');
  for (const name of fs.readdirSync(splashes)) {
    if (name.endsWith('.png')) {
      const file = path.join(splashes, name);
      const { width, height } = pngSize(file);
      await draw(page, splashHtml(width, height), width, height, file, false);
      written++;
    }
  }
  return written;
}

/** Writes every icon and splash picture. */
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let written = 0;
  try {
    for (const folder of fs.readdirSync(RES)) {
      const dir = path.join(RES, folder);
      if (folder.startsWith('mipmap-') && folder.endsWith('dpi')) {
        const foreground = path.join(dir, 'ic_launcher_foreground.png');
        const launcher = path.join(dir, 'ic_launcher.png');
        const round = path.join(dir, 'ic_launcher_round.png');
        const fg = pngSize(foreground).width;
        await draw(page, svgPage(foregroundSvg(), fg), fg, fg, foreground, true);
        const icon = pngSize(launcher).width;
        await draw(page, svgPage(LOGO, icon), icon, icon, launcher, true);
        await draw(page, svgPage(roundSvg(), icon), icon, icon, round, true);
        written += 3;
      }
      if (folder.startsWith('drawable')) {
        const splash = path.join(dir, 'splash.png');
        if (fs.existsSync(splash)) {
          const { width, height } = pngSize(splash);
          await draw(page, splashHtml(width, height), width, height, splash, false);
          written++;
        }
      }
    }
    written += await drawIos(page);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(RES, 'values', 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!-- The background of the adaptive icon: the dark square of the logo (frontend/public/favicon.svg). -->\n' +
      '<resources>\n    <color name="ic_launcher_background">' +
      ICON_BACKGROUND.toUpperCase() +
      '</color>\n</resources>\n',
  );
  console.log(written + ' pictures drawn from frontend/public/favicon.svg');
}

main().catch(function failed(error) {
  console.error(error);
  process.exit(1);
});
