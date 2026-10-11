/**
 * test/e2e/01-types-and-languages.mjs
 * Types and languages.
 */
import { FRONTEND, step, run } from './support.mjs';

/** Types and languages. */
export async function step01(world) {
  step('types and languages');
  run('pnpm', ['--dir', 'backend', 'typecheck']);
  run('pnpm', ['--dir', 'frontend', 'typecheck']);
  run('node', ['scripts/i18n.mjs', '--check'], { cwd: FRONTEND });
  console.log('  ok  backend and frontend types, and every string translated');
}
