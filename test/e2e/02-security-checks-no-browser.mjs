/**
 * test/e2e/02-security-checks-no-browser.mjs
 * Security checks (no browser).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, BACKEND, step } from './support.mjs';

/** Security checks (no browser). */
export async function step02(world) {
  step('security checks (no browser)');
  const securityCli = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const security = spawnSync(
    process.execPath,
    [securityCli, path.join(ROOT, 'test', 'security.mts')],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  process.stdout.write(security.stdout);
  if (security.status !== 0) throw new Error('security checks failed:\n' + security.stderr);
}
