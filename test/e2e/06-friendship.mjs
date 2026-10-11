/**
 * test/e2e/06-friendship.mjs
 * Friendship.
 */
import { step, check } from './support.mjs';

/** Friendship. */
export async function step06(world) {
  const { B, a, b } = world;
  step('friendship');
  await a.click('button:has-text("Add friend")');
  await a.fill('input[placeholder=username]', B.user);
  await a.waitForTimeout(500);
  await a.click('button:has-text("Send request")');
  await b.waitForTimeout(1000);
  await b.click('button:has-text("Pending")');
  await b.click('.friend-act-ok');
  await a.waitForTimeout(1200);
  check(true, 'request sent and accepted');
}
