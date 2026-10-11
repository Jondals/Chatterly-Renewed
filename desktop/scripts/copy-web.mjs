/**
 * desktop/scripts/copy-web.mjs
 * Copies the built web app (pnpm build at the root) into desktop/web, so the installer carries it.
 *
 * ! The folder is wiped first: what ships is exactly one build, never a mix of two. The web version must match the
 *   desktop version, or the installer would hold old code under a new number.
 */
import fs from 'node:fs';
import path from 'node:path';

const desktop = path.resolve(import.meta.dirname, '..');
const source = path.resolve(desktop, '..', 'frontend', 'dist', 'frontend', 'browser');
const target = path.join(desktop, 'web');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error('There is no web build at ' + source + '. Run "pnpm build" at the root first.');
  process.exit(1);
}
const webVersion = JSON.parse(
  fs.readFileSync(path.resolve(desktop, '..', 'frontend', 'package.json'), 'utf8'),
).version;
const desktopVersion = JSON.parse(
  fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'),
).version;
if (webVersion !== desktopVersion) {
  console.error(
    'Versions differ: the web app is ' +
      webVersion +
      ' and the desktop app is ' +
      desktopVersion +
      '.',
  );
  process.exit(1);
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log('Web build ' + webVersion + ' copied to desktop/web');
