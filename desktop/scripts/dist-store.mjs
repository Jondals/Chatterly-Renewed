/**
 * desktop/scripts/dist-store.mjs
 * Builds the Microsoft Store package (MSIX/APPX). The Store signs it, so no certificate is needed here.
 *
 * You get the three values when you reserve the app name in Partner Center (Product identity):
 *   STORE_IDENTITY_NAME            e.g. 12345Jondals.Chatterly
 *   STORE_PUBLISHER                e.g. CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 *   STORE_PUBLISHER_DISPLAY_NAME   e.g. Jondals
 * ! Without them the package would be rejected, so the script stops instead of using made-up values.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const names = ['STORE_IDENTITY_NAME', 'STORE_PUBLISHER', 'STORE_PUBLISHER_DISPLAY_NAME'];
const missing = names.filter(function isMissing(name) {
  return !process.env[name];
});
if (missing.length > 0) {
  console.error('Missing: ' + missing.join(', ') + '\nSee the comment at the top of this file.');
  process.exit(1);
}
const desktop = path.resolve(import.meta.dirname, '..');
const builderCli = createRequire(path.join(desktop, 'package.json')).resolve(
  'electron-builder/cli.js',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktop, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['scripts/copy-web.mjs']);
run(process.execPath, [
  builderCli,
  '--win',
  'appx',
  '--publish',
  'never',
  '-c.appx.identityName=' + process.env.STORE_IDENTITY_NAME,
  '-c.appx.publisher=' + process.env.STORE_PUBLISHER,
  '-c.appx.publisherDisplayName=' + process.env.STORE_PUBLISHER_DISPLAY_NAME,
]);
