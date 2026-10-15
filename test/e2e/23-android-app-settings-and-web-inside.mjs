/**
 * test/e2e/23-android-app-settings-and-web-inside.mjs
 * Android app (Capacitor): its settings, manifest and the web app that goes inside the APK, made from the same build
 * as the rest of the test. The checks live in mobile/test/mobile.mjs (pnpm --dir mobile test runs them alone).
 * ! Building, signing and running the APK need the Android SDK and a device: they are reported as OMITIDO, never as
 *   passed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, step, check } from './support.mjs';

/** Android app: the checks that need no Android SDK, on the web build of this test. */
export async function step23(world) {
  step('android app (Capacitor): settings, manifest and the web app inside it');
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'mobile', 'test', 'mobile.mjs'), '--web', world.webDir],
    { cwd: ROOT, env, encoding: 'utf8' },
  );
  const output = (result.stdout || '') + (result.stderr || '');
  for (const line of output.split('\n')) {
    if (/OMITIDO|passed,|FAILED/.test(line)) console.log('  ' + line.trim());
  }
  check(
    result.status === 0 && output.includes('MOBILE CHECKS CORRECT'),
    'the Android checks pass (mobile/test/mobile.mjs)' +
      (result.status === 0 ? '' : ':\n' + output),
  );
}
