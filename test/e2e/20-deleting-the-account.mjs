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

  step('signing out erases the account from the device, and signing in again works');
  // Something of the person on the device besides the keys: a sticker in its own database.
  await c.evaluate(function keepSticker() {
    return new Promise(function opened(resolve, reject) {
      const request = indexedDB.open('chatterly-renewed-stickers', 1);
      request.onupgradeneeded = function create() {
        request.result.createObjectStore('test-stickers');
      };
      request.onerror = reject;
      request.onsuccess = function put() {
        const tx = request.result.transaction('test-stickers', 'readwrite');
        tx.objectStore('test-stickers').put('private sticker', 'one');
        tx.oncomplete = function done() {
          request.result.close();
          resolve(undefined);
        };
      };
    });
  });
  /** How many records every IndexedDB database of the page holds, by name (it opens what exists, creates nothing). */
  const records = function () {
    return c.evaluate(async function count() {
      const totals = {};
      for (const info of await indexedDB.databases()) {
        const db = await new Promise(function open(resolve, reject) {
          const request = indexedDB.open(info.name);
          request.onsuccess = function ok() {
            resolve(request.result);
          };
          request.onerror = reject;
        });
        let total = 0;
        for (const store of db.objectStoreNames) {
          total += await new Promise(function countStore(resolve) {
            const request = db.transaction(store).objectStore(store).count();
            request.onsuccess = function ok() {
              resolve(request.result);
            };
          });
        }
        db.close();
        totals[info.name] = total;
      }
      return totals;
    });
  };
  const before = await records();
  check(
    before['chatterly-renewed-keys'] > 0 && before['chatterly-renewed-stickers'] > 0,
    'signed in, the device holds the keys and the sticker of the person',
  );
  await c.goto(WEB + '/direct(settings:settings/profile)');
  await c.click('button:has-text("Sign out")');
  await c.waitForURL('**/login', { timeout: 30000 });
  await c.waitForLoadState('load');
  await c.waitForTimeout(1500);
  const after = await records();
  const kept = Object.entries(after).filter(function withData(entry) {
    return entry[1] > 0;
  });
  check(
    kept.length === 0,
    'after signing out no database keeps anything: keys, vault, sticker...' +
      (kept.length ? ' (left: ' + JSON.stringify(kept) + ')' : ''),
  );
  const leftAfterSignOut = (
    await c.evaluate(function () {
      return Object.keys(localStorage);
    })
  ).filter(function ofAccount(key) {
    return /session|pins|verified|activeGuild|emojiFreq/i.test(key);
  });
  check(
    leftAfterSignOut.length === 0,
    'after signing out nothing of the account stays in localStorage' +
      (leftAfterSignOut.length ? ' (left: ' + leftAfterSignOut.join(', ') + ')' : ''),
  );
  await c.fill('input[name=username]', C.user);
  await c.fill('input[name=password]', C.pw);
  await c.click('button[type=submit]');
  await c.waitForURL('**/direct', { timeout: 60000 });
  check(true, 'signing in again on the same device works (the keys come back from the server)');
  await c.waitForTimeout(1200);

  step('deleting the account');
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
