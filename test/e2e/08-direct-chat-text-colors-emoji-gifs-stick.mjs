/**
 * test/e2e/08-direct-chat-text-colors-emoji-gifs-stick.mjs
 * Direct chat: text, colors, emoji, GIFs, stickers.
 */
import { step, check } from './support.mjs';

/** Direct chat: text, colors, emoji, GIFs, stickers. */
export async function step08(world) {
  const { a, b } = world;
  step('direct chat: text, colors, emoji, GIFs, stickers');
  await a.click('button:has-text("All")');
  await a.click('.friend-row:has-text("bob")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Set nickname")');
  await a.fill('input[maxlength="32"]', 'Bobby');
  await a.click('button:has-text("Save")');
  await a.waitForSelector('.friend-row:has-text("Bobby")');
  check(true, 'right click on a friend: nickname set');
  await a.click('.friend-row:has-text("Bobby")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Remove nickname")');
  await a.waitForSelector('.friend-row:has-text("bob"):not(:has-text("Bobby"))');
  // Pressing the friend itself (not one of the buttons) opens the chat.
  await a.click('.friend-row:has-text("bob")', { position: { x: 180, y: 20 } });
  await a.waitForURL('**/direct/**');
  check(true, 'friends: pressing a friend opens the chat');
  // typing makes the send button appear without moving anything beside it
  await a.waitForSelector('textarea[aria-label=Message]');
  const plusBefore = await a.locator('[data-tip="More"]').boundingBox();
  const emojiBefore = await a.locator('[data-tip="Emoji, GIFs & stickers"]').boundingBox();
  await a.fill('textarea[aria-label=Message]', 'x');
  await a.waitForTimeout(400);
  const plusAfter = await a.locator('[data-tip="More"]').boundingBox();
  const emojiAfter = await a.locator('[data-tip="Emoji, GIFs & stickers"]').boundingBox();
  check(
    Math.abs(plusBefore.x - plusAfter.x) < 1 && Math.abs(emojiBefore.x - emojiAfter.x) < 1,
    'typing does not move the buttons of the composer',
  );
  check(
    !(await a.locator('button[aria-label="Send"]').isVisible()),
    'on a computer there is no send button (Enter sends)',
  );
  await a.fill('textarea[aria-label=Message]', '');
  await a.fill('textarea[aria-label=Message]', 'Hello Bob! **bold** `code` :rocket:');
  await a.keyboard.press('Enter');
  await b.waitForTimeout(1500);
  await b.click('a:has-text("alice")');
  await b.waitForSelector('text=Hello Bob!', { timeout: 10000 });
  check(true, 'encrypted message received and decrypted');
  await a.fill(
    'textarea[aria-label=Message]',
    'const total = items.map(i => i.price);\nconsole.log(total);',
  );
  await a.waitForSelector('text=It will be sent as code');
  check(true, 'code is detected while it is typed and shown formatted in a preview');
  await a.fill('textarea[aria-label=Message]', '');

  await b.click('[data-tip="Text style & colors"]');
  await b.fill('textarea[aria-label=Message]', 'colourful reply');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('button[aria-label="#ff5d6c"]');
  await b.waitForSelector('text=Preview');
  await b.keyboard.press('Enter');
  await a.waitForSelector('text=colourful reply', { timeout: 10000 });
  check(
    (await a.locator('span[style*="color"]:has-text("colourful reply")').count()) > 0,
    'colored text rendered',
  );

  // custom gradient of the composer: the picker opens in view and applies the colors to the selection
  await b.fill('textarea[aria-label=Message]', 'second');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('button:has-text("Gradient")');
  await b.click('app-gradient-controls button[aria-label="Color"]');
  const popover = b.locator('input[aria-label="Hex color"]');
  await popover.waitFor();
  const dentro = await popover.evaluate(function (e) {
    const r = e.getBoundingClientRect();
    return (
      r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
    );
  });
  check(
    dentro,
    'the chat color picker opens inside the screen ' + JSON.stringify(await popover.boundingBox()),
  );
  await popover.fill('#00ff00');
  await b.waitForTimeout(300);
  await b.keyboard.press('Escape');
  await b.waitForTimeout(300);
  // the buttons of the colors: "+" never moves, "-" appears to its right when there is a color to remove; no hue controls
  const plus = b.locator('app-gradient-controls button[aria-label="Add a color"]');
  const minus = b.locator('app-gradient-controls button[aria-label="Remove this color"]');
  const plusAt = (await plus.boundingBox()).x;
  check((await minus.isDisabled()) === true, 'with two colors there is nothing to remove yet');
  await plus.click();
  await b.waitForTimeout(500);
  check(
    Math.abs((await plus.boundingBox()).x - plusAt) < 0.5,
    'the + does not change place when a color is added',
  );
  check(
    (await minus.isEnabled()) && (await minus.boundingBox()).x < plusAt,
    'the - appears to the left of the +',
  );
  check(
    (await b.locator('app-gradient-controls:has-text("hue")').count()) === 0,
    'there are no controls to turn the hue',
  );
  await minus.click();
  await b.waitForTimeout(400);
  check((await minus.isDisabled()) === true, 'the - fades again with two colors');
  await b.click('textarea[aria-label=Message]');
  await b.locator('textarea[aria-label=Message]').selectText();
  await b.click('app-message-input button:has-text("Apply")');
  await b.waitForTimeout(400);
  const valor = await b.inputValue('textarea[aria-label=Message]');
  check(
    valor.includes('[d=0f0,818cf8]second[/d]'),
    'el gradient personalizado se aplica al texto seleccionado. Texto: ' + valor,
  );
  await b.fill('textarea[aria-label=Message]', '');

  await a.click('[data-tip="Emoji, GIFs & stickers"]');
  await a.fill('input[placeholder="Search emoji"]', 'rocket');
  await a.waitForSelector('button:has-text("🚀")', { timeout: 15000 });
  await a.click('button:has-text("GIFs")');
  await a.waitForSelector('text=GIF search is not enabled');
  check(true, 'own emoji picker and GIFs tab (disabled without a GIPHY key)');
  await a.click('button:has-text("Stickers")');
  await a.click('button:has-text("Starter pack")');
  await a.waitForSelector('img[src^="blob:"]', { timeout: 15000 });
  await a.locator('.grid-cols-4 button').first().click();
  await b.waitForSelector('img.drop-shadow-lg', { timeout: 15000 });
  check(true, 'sticker sent and received');
  check(
    await b.evaluate(function () {
      const sticker = document.querySelector('img.stk-live');
      return !!sticker && getComputedStyle(sticker).animationName.startsWith('stk-');
    }),
    'the sticker moves: the picture is still and the page moves it',
  );
  await b.reload();
  await b.waitForSelector('img.drop-shadow-lg', { timeout: 15000 });
  check(true, 'the sticker is still visible after reloading the page');
}
