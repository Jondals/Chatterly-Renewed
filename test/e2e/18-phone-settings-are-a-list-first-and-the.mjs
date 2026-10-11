/**
 * test/e2e/18-phone-settings-are-a-list-first-and-the.mjs
 * Phone: settings are a list first, and the chat fits the screen.
 */
import { shot, step, check } from './support.mjs';

/** Phone: settings are a list first, and the chat fits the screen. */
export async function step18(world) {
  const { WEB, a } = world;
  step('phone: settings are a list first, and the chat fits the screen');
  // The language was changed to Spanish above, so the controls are found by position, not by their words.
  await a.goto(WEB + '/direct');
  await a.setViewportSize({ width: 390, height: 700 });
  await a.waitForSelector('app-page-header');
  await a.locator('app-page-header button').first().click();
  await a.locator('.dock-btn').last().click();
  await a.waitForSelector('.settings-overlay nav a');
  check(
    (await a.locator('.settings-overlay main').isVisible()) === false,
    'on a phone the settings open as a list of sections',
  );
  await a.locator('.settings-overlay nav a').nth(1).click();
  await a.waitForSelector('.settings-overlay main button[class*="md:hidden"]');
  check(
    await a.evaluate(function () {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'a settings section fits in 390px',
  );
  await shot(a, '12-ajustes-movil');
  await a.locator('.settings-overlay main button[class*="md:hidden"]').click();
  await a.waitForSelector('.settings-overlay nav a >> nth=6');
  check(true, 'the back button leads to the list again');
  await a.keyboard.press('Escape');
  // The main screens on a phone: nothing may be wider than the screen (screenshots with CHATTERLY_SHOTS).
  for (const [name, route] of [
    ['friends', '/direct'],
    ['groups', '/groups'],
    ['voice', '/voice'],
  ]) {
    // Moved inside the app (no page load): every load asks the server to renew the session, which is rate limited.
    await a.evaluate(function (path) {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await a.waitForTimeout(1200);
    await shot(a, '13-movil-' + name);
    check(
      await a.evaluate(function () {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      }),
      `the ${name} screen fits in 390px`,
    );
  }
  await a.evaluate(function () {
    history.pushState({}, '', '/direct');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await a.waitForTimeout(900);
  const firstChat = a.locator('a[href*="/direct/"]').first();
  if (await firstChat.count()) {
    await firstChat.click();
    await a.waitForTimeout(900);
    await shot(a, '13-movil-chat');
    check(
      await a.evaluate(function () {
        return document.documentElement.scrollWidth <= window.innerWidth + 1;
      }),
      'a conversation fits in 390px',
    );
  }
  await a.setViewportSize({ width: 1440, height: 900 });
}
