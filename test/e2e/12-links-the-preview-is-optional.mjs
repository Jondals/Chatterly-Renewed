/**
 * test/e2e/12-links-the-preview-is-optional.mjs
 * Links: the preview is optional.
 */
import { shot, step, check } from './support.mjs';

/** Links: the preview is optional. */
export async function step12(world) {
  const { a, b } = world;
  step('links: the preview is optional');
  await b.fill('textarea[aria-label=Message]', 'mira https://localhost.invalid/pagina');
  await b.waitForSelector('button:has-text("Add preview")');
  check(
    (await b.locator('text=No preview is available').count()) === 0,
    'the preview is not requested by itself',
  );
  await b.click('button:has-text("Add preview")');
  await b.waitForSelector('text=No preview is available for this link.', {
    timeout: 20000,
  });
  await b.keyboard.press('Enter');
  await a.waitForSelector('a:has-text("localhost.invalid")', {
    timeout: 15000,
  });
  check(true, 'the link is sent without a card when there is no preview');

  await b.fill('textarea[aria-label=Message]', 'mira https://youtu.be/dQw4w9WgXcQ');
  await b.click('button:has-text("Add preview")');
  await b.waitForSelector('text=The preview will be sent with your message.', {
    timeout: 30000,
  });
  await b.keyboard.press('Enter');
  await a.waitForSelector('button[aria-label="Play video"]', {
    timeout: 20000,
  });
  check(
    (await a.locator('iframe[title="YouTube"]').count()) === 0,
    'the video player loads nothing until play is pressed',
  );
  await a.click('button[aria-label="Play video"]');
  await a.waitForSelector(
    'iframe[title="YouTube"][src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]',
    { timeout: 10000 },
  );
  check(
    (await a.locator('a:has-text("youtu.be/dQw4w9WgXcQ")').count()) >= 1,
    'the video goes on top and the link below, as one block',
  );

  await b.fill('textarea[aria-label=Message]', 'const total = items.length;\nreturn total;');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.code-block:has-text("const total")', {
    timeout: 15000,
  });
  check(true, 'text that looks like code is formatted as a code block by itself');
  await b.fill('textarea[aria-label=Message]', '🎉');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.bubble-emoji', { timeout: 15000 });
  await a.locator('.bubble-emoji').first().scrollIntoViewIfNeeded();
  await shot(a, '07d-emoji', 900);
  check(true, 'a single emoji is drawn big and without a bubble');

  // An emoji that has just arrived makes an entrance and a short show of its kind (a party popper sends confetti)...
  // (The app switches its light mode on by itself on a weak machine, and then a lone emoji only makes its entrance: the
  // test looks at the normal mode and at the light mode, whichever the machine is in.)
  const fresh = await a
    .locator('.bubble-emoji')
    .first()
    .evaluate(function (el) {
      const root = document.documentElement;
      const was = root.getAttribute('data-perf');
      root.removeAttribute('data-perf');
      const normal = {
        names: getComputedStyle(el).animationName,
        count: getComputedStyle(el).animationIterationCount,
      };
      root.setAttribute('data-perf', 'low');
      const light = getComputedStyle(el).animationName;
      if (was === null) root.removeAttribute('data-perf');
      else root.setAttribute('data-perf', was);
      return {
        cls: el.className,
        mood: el.getAttribute('data-mood'),
        normal,
        light,
        motion: root.getAttribute('data-motion'),
        move: getComputedStyle(el).getPropertyValue('--emo-move'),
      };
    });
  check(
    fresh.cls.includes('is-fresh') && fresh.mood === 'party',
    'a lone emoji that just arrived is "fresh" and has the mood of its kind (' + fresh.mood + ')',
  );
  check(
    fresh.normal.names === 'emoji-settle' && !/emo-party/.test(fresh.normal.names),
    'it only settles in when it arrives: its show does not play by itself (' +
      fresh.normal.names +
      ')',
  );
  // ...and pressing it plays the show of its kind, a few times, and stops
  await a.locator('.bubble-emoji').first().click();
  await a.waitForTimeout(150);
  const pressed = await a
    .locator('.bubble-emoji')
    .first()
    .evaluate(function (el) {
      const root = document.documentElement;
      const was = root.getAttribute('data-perf');
      root.removeAttribute('data-perf');
      const normal = {
        names: getComputedStyle(el).animationName,
        count: getComputedStyle(el).animationIterationCount,
      };
      root.setAttribute('data-perf', 'low');
      const light = getComputedStyle(el).animationName;
      if (was === null) root.removeAttribute('data-perf');
      else root.setAttribute('data-perf', was);
      return { normal, light };
    });
  check(
    /emo-party/.test(pressed.normal.names),
    'pressing it plays the show of its kind (' + JSON.stringify(pressed) + ')',
  );
  check(
    !/infinite/.test(pressed.normal.count),
    'the show runs a few times and stops: nothing loops for ever (' + pressed.normal.count + ')',
  );
  check(
    pressed.light.split(',').length === 1 && !/emo-party/.test(pressed.light),
    'a weak machine (light mode) gets the entrance only (' + pressed.light + ')',
  );
  // ...and the same emoji, when the chat is opened again, only settles in: no show, no looping.
  // (an emoji counts as just arrived for six seconds)
  await a.waitForTimeout(6500);
  await a.reload();
  await a.waitForSelector('.bubble-emoji', { timeout: 20000 });
  await a.waitForTimeout(500);
  const old = await a
    .locator('.bubble-emoji')
    .first()
    .evaluate(function (el) {
      return { cls: el.className, names: getComputedStyle(el).animationName };
    });
  check(
    !old.cls.includes('is-fresh') && old.names === 'emoji-settle',
    'an emoji that was already in the chat when it was opened only settles in (' + old.names + ')',
  );
  // Pressing it plays its show again.
  await a.locator('.bubble-emoji').first().click();
  const replay = await a
    .locator('.bubble-emoji')
    .first()
    .evaluate(function (el) {
      return getComputedStyle(el).animationName;
    });
  check(/emo-replay/.test(replay), 'pressing a lone emoji plays its show again (' + replay + ')');
}
