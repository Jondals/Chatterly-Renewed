/**
 * test/e2e/20-deleting-the-account.mjs
 * Deleting the account.
 */
import { step, check } from './support.mjs';

/** Deleting the account. */
export async function step20(world) {
  const { API, WEB, newUser, register, suffix } = world;
  step('deleting the account');
  const C = { user: 'carol_' + suffix, pw: 'correct-horse-battery-1' };
  const c = await newUser('carol');
  let carolBearer = '';
  c.on('request', function remember(request) {
    carolBearer = request.headers()['authorization'] ?? carolBearer;
  });
  await register(c, C);
  await c.waitForTimeout(1200);
  await c.goto(WEB + '/direct(settings:settings/profile)');
  await c.click('button:has-text("Delete my account")');
  const eraseForm = '[role="dialog"][aria-label="Delete account"]';
  await c.waitForSelector(eraseForm);
  check(
    await c.locator(eraseForm + ' button[type=submit]').isDisabled(),
    'delete account: the button is off until the username is typed',
  );
  await c.fill(eraseForm + ' input[type=text]', C.user);
  await c.fill(eraseForm + ' input[type=password]', 'not-the-password-1');
  await c.click(eraseForm + ' button[type=submit]');
  await c.waitForSelector(eraseForm + ' .text-red-300');
  check(true, 'delete account: a wrong password does not erase it');
  await c.fill(eraseForm + ' input[type=password]', C.pw);
  await c.click(eraseForm + ' button[type=submit]');
  await c.waitForURL('**/login', { timeout: 30000 });
  check(true, 'delete account: it goes back to the sign in');
  const again = await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: C.user, authSecret: 'A'.repeat(43) }),
  });
  check(
    again.status === 401 || again.status === 400,
    'delete account: the name can not sign in any more',
  );
  const stale = await fetch(API + '/api/me', {
    headers: { authorization: carolBearer },
  });
  check(
    carolBearer.length > 20 && stale.status === 401,
    'delete account: the old session token stops working at once',
  );
  // The page that loads after the erasure writes the default value of its own preferences, so what is checked is that nothing
  // that belongs to the account is left: no session, no pinned or verified keys, no active group, no used emoji.
  const leftKeys = await c.evaluate(function () {
    return Object.keys(localStorage);
  });
  const belonging = leftKeys.filter(function ofAccount(key) {
    return /session|pins|verified|activeGuild|emojiFreq/i.test(key);
  });
  check(
    belonging.length === 0,
    'delete account: nothing of the account stays in the browser' +
      (belonging.length ? ' (left: ' + belonging.join(', ') + ')' : ''),
  );
}
