/**
 * desktop/scripts/beta-version.mjs
 * Gives a build of the beta branch its own version, "<version>-beta.<n>", in the working copy of the build machine (it is never
 * committed): desktop/package.json, frontend/package.json and frontend/src/app/version.ts. Used by .github/workflows/desktop.yml.
 *
 *   node desktop/scripts/beta-version.mjs 17 2.32.0-b1     prints 2.32.0-beta.17 (the second argument is the name people read
 *   in the app, APP_LABEL of version.ts)
 *
 * * Why: the apps of the people who try the beta look for updates in the pre-releases of GitHub, and a pre-release has to be
 *   a higher version than the one they run. "2.32.0-beta.17" is higher than 2.31.3 and lower than the stable 2.32.0, so the
 *   beta never replaces the stable version and the stable one replaces every beta.
 */
import fs from 'node:fs';
import path from 'node:path';

const number = process.argv[2];
if (!/^\d+$/.test(number || '')) {
  console.error('Usage: node beta-version.mjs <build number>');
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, '..', '..');
const desktopFile = path.join(root, 'desktop', 'package.json');
const base = JSON.parse(fs.readFileSync(desktopFile, 'utf8')).version.replace(/-.*$/, '');
const version = base + '-beta.' + number;

const label = process.argv[3] || version;

/** Writes the new version in a package.json. */
function setPackageVersion(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

setPackageVersion(desktopFile);
setPackageVersion(path.join(root, 'frontend', 'package.json'));
const versionFile = path.join(root, 'frontend', 'src', 'app', 'version.ts');
const source = fs.readFileSync(versionFile, 'utf8');
const changed = source
  .replace(/APP_VERSION = '[^']*'/, "APP_VERSION = '" + version + "'")
  .replace(/APP_LABEL = [^;]*;/, "APP_LABEL = '" + label + "';");
if (changed === source) {
  console.error('version.ts has no APP_VERSION to change');
  process.exit(1);
}
fs.writeFileSync(versionFile, changed);
console.log(version);
