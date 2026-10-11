/**
 * desktop/scripts/start.mjs
 * Starts the desktop app for development: pnpm --dir desktop start
 *
 * ! Some editors set ELECTRON_RUN_AS_NODE in their terminals, which makes Electron run as plain Node and the app
 *   crash on start. This launcher removes it. CHATTERLY_URL chooses the server (default: the public site;
 *   http://localhost:4200 or :3000 work while developing).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', function onExit(code) {
  process.exit(code ?? 0);
});
