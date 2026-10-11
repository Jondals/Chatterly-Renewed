/**
 * test/e2e/07-mute-without-a-call-right-click-and-over.mjs
 * Mute without a call, right click and overflow.
 */
import { shot, step, check } from './support.mjs';

/** Mute without a call, right click and overflow. */
export async function step07(world) {
  const { a } = world;
  step('mute without a call, right click and overflow');
  // a right click on the own panel opens the profile, big
  await a.locator('button:has(app-avatar):has-text("alice")').last().click({ button: 'right' });
  await a.waitForSelector('app-profile-card');
  await a.keyboard.press('Escape');
  await a.waitForSelector('app-profile-card', { state: 'detached' });
  check(true, 'a right click on the own panel opens the own profile');
  await a.click('[data-tip="Mute"]');
  await a.waitForSelector('[data-tip="Unmute"]');
  await a.click('[data-tip="Deafen"]');
  await a.waitForSelector('[data-tip="Undeafen"]');
  check(true, 'muting and deafening works outside a call');
  // (undeafening also unmutes: the mute that came with the deafening goes away with it)
  await a.click('[data-tip="Undeafen"]');
  await a.waitForSelector('[data-tip="Mute"]');
  check(
    await a.evaluate(function () {
      return !document.dispatchEvent(
        new MouseEvent('contextmenu', { cancelable: true, bubbles: true }),
      );
    }),
    'the browser right click is blocked',
  );
  const wide = await a.evaluate(function () {
    return [...document.querySelectorAll('*')]
      .filter(function (e) {
        const o = getComputedStyle(e).overflowX;
        return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1;
      })
      .map(function (e) {
        return e.tagName + '.' + String(e.className).slice(0, 80);
      });
  });
  check(wide.length === 0, 'the friends list has no sideways scroll ' + wide.join(' | '));
  await shot(a, '01-amigos');
  // ! when the status menu opens, the user panel and its buttons do not move
  await a.mouse.move(700, 400);
  await a.waitForTimeout(600);
  const dockBefore = await a.locator('.dock-btn').first().boundingBox();
  await a.click('aside .border-t > button');
  await a.waitForSelector('.menu-up');
  await a.waitForTimeout(400);
  const dockAfter = await a.locator('.dock-btn').first().boundingBox();
  check(
    !!dockBefore && !!dockAfter && Math.abs(dockBefore.y - dockAfter.y) < 1,
    'the status menu opens without moving the buttons below it ' +
      JSON.stringify([dockBefore, dockAfter]),
  );
  await a.mouse.click(700, 500);
  await a.waitForSelector('.menu-up', { state: 'detached' });
}
