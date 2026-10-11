/**
 * test/e2e/10-name-and-time-on-every-message.mjs
 * Name and time on every message.
 */
import { step, check } from './support.mjs';

/** Name and time on every message. */
export async function step10(world) {
  const { a, b } = world;
  step('name and time on every message');
  const orden = await b.evaluate(function () {
    const fila = [...document.querySelectorAll('.group')].find(function (e) {
      return e.textContent.includes('colourful reply') || e.textContent.includes('Hello Bob');
    });
    const cab = fila && fila.querySelector('button.font-semibold');
    // (the tag of a group, when the person shows one, sits between the name and the time)
    let next = cab && cab.nextElementSibling;
    while (next && next.tagName === 'APP-SERVER-TAG') next = next.nextElementSibling;
    return !!cab && !!next && /\d{1,2}:\d{2}/.test(next.textContent);
  });
  check(orden, 'in every message the name comes first and the time after it');
  // 12-hour format: the time is followed by AM or PM
  await b.evaluate(function () {
    localStorage.setItem('chatterly.pref.timeFormat', '"12"');
  });
  await b.reload();
  await b.waitForSelector('button.msg-name', { timeout: 20000 });
  check(
    /\d{1,2}:\d{2} (AM|PM)/.test(
      await b
        .locator('button.msg-name')
        .first()
        .locator('xpath=following-sibling::span')
        .first()
        .innerText(),
    ),
    'in 12 h format the time carries AM or PM',
  );
  // sent, delivered and read marks: Bob has the chat open, so Alice sees "read"
  await a.waitForSelector('.status-dot.status-read', { timeout: 20000 });
  check(true, 'read marks arrive: Alice sees her message as read by Bob');
  await b.click('button.font-semibold:has-text("alice")');
  await b.waitForSelector('[role=dialog]');
  check(true, 'pressing the name of someone else opens their profile');
  await b.keyboard.press('Escape');
  await b.waitForSelector('[role=dialog]', { state: 'detached' });
}
