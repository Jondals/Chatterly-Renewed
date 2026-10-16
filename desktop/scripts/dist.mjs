/**
 * desktop/scripts/dist.mjs
 * Builds the installer of a platform:  node scripts/dist.mjs win  |  linux  |  mac
 *
 * * It copies the web build into desktop/web and runs electron-builder for that platform (the Windows installer, or the Linux
 *   AppImage, or the macOS disk image: one universal app for Intel and Apple Silicon, signed ad hoc, which is what
 *   macOS needs to open an app it did not get from the App Store; it must be built on a Mac).
 * * The files are named "Chatterly-<label>.<ext>". The label is the version people read (CHATTERLY_LABEL, which the workflow sets to
 *   2.32.0 for a release and to 2.32.0-b1 for the first beta of it); without it, the version of package.json. The name is written
 *   in the update file (latest.yml / beta.yml) by electron-builder itself, so the apps always find the file they are told about.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const targets = {
  win: ['--win', 'nsis'],
  linux: ['--linux', 'AppImage'],
  mac: ['--mac', 'dmg', '--universal'],
};
const wanted = targets[process.argv[2]];
if (!wanted) {
  console.error('Usage: node scripts/dist.mjs win|linux|mac');
  process.exit(1);
}
const desktop = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
const builderCli = createRequire(path.join(desktop, 'package.json')).resolve(
  'electron-builder/cli.js',
);
const env = { ...process.env, CHATTERLY_LABEL: process.env.CHATTERLY_LABEL || version };
delete env.ELECTRON_RUN_AS_NODE;

/** Runs a command in the desktop folder and stops at the first failure. */
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: desktop, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['scripts/copy-web.mjs']);
run([builderCli, ...wanted, '--publish', 'never']);
