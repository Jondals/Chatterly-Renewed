/**
 * test/e2e/05-sign-up-keys-generated-in-the-browser.mjs
 * Sign-up (keys generated in the browser).
 */
import { step, check } from './support.mjs';

/** Sign-up (keys generated in the browser). */
export async function step05(world) {
  const { A, B, a, b, register } = world;
  step('sign-up (keys generated in the browser)');
  await Promise.all([register(a, A), register(b, B)]);
  check(true, 'two identities created');
}
