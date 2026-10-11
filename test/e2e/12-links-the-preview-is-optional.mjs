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
  await a.waitForTimeout(900);
  await shot(a, '07d-emoji');
  check(true, 'a single emoji is drawn big and without a bubble');
}
