/**
 * test/e2e/13-undo-redo-and-caret-when-formatting.mjs
 * Undo, redo and caret when formatting.
 */
import { step, check } from './support.mjs';

/** Undo, redo and caret when formatting. */
export async function step13(world) {
  const { b } = world;
  step('undo, redo and caret when formatting');
  await b.fill('textarea[aria-label=Message]', '');
  await b.click('textarea[aria-label=Message]');
  await b.keyboard.type('hola');
  await b.keyboard.press('Control+z');
  check(
    (await b.inputValue('textarea[aria-label=Message]')) === '',
    'Control+Z undoes what was typed',
  );
  await b.keyboard.press('Control+y');
  check((await b.inputValue('textarea[aria-label=Message]')) === 'hola', 'Control+Y redoes it');
  await b.fill('textarea[aria-label=Message]', '');
  if ((await b.locator('button[aria-label="#ff5d6c"]').count()) === 0) {
    await b.click('[data-tip="Text style & colors"]');
  }
  await b.click('button[aria-label="#ff5d6c"]');
  await b.keyboard.type('x');
  check(
    (await b.inputValue('textarea[aria-label=Message]')) === '[c=#ff5d6c]x[/c]',
    'with no text selected, the caret stays inside the color to type',
  );
  await b.fill('textarea[aria-label=Message]', '');
}
