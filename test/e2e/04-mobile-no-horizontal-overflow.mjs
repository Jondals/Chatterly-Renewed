/**
 * test/e2e/04-mobile-no-horizontal-overflow.mjs
 * Mobile: no horizontal overflow.
 */
import { shot, step, check } from './support.mjs';

/** Mobile: no horizontal overflow. */
export async function step04(world) {
  const { WEB, a, newUser } = world;
  step('mobile: no horizontal overflow');
  const m = await newUser('movil', { width: 390, height: 800 });
  await m.goto(WEB + '/register');
  await m.waitForSelector('input[name=username]');
  await shot(m, '01-movil');
  check(
    await m.evaluate(function () {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'the register screen fits in 390px',
  );
  await m.context().close();
  // Opening the root without a session must lead to the login (it used to leave an empty box)
  await a.goto(WEB + '/');
  await a.waitForSelector('input[name=username]', { timeout: 10000 });
  await a.waitForURL('**/login', { timeout: 5000 }).catch(function () {
    return undefined;
  });
  check(
    new URL(a.url()).pathname === '/login',
    'the root without a session leads to the login (' + a.url() + ')',
  );
  await shot(a, '00-login', 1500);
}
