/**
 * test/e2e/09-presets-save-the-look-share-it-in-the-ch.mjs
 * Presets: save the look, share it in the chat, a friend imports it with one button.
 */
import { shot, step, check } from './support.mjs';

/** Presets: save the look, share it in the chat, a friend imports it with one button. */
export async function step09(world) {
  const { a, b } = world;
  step('presets: save the look, share it in the chat, a friend imports it with one button');
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.click('a:has-text("Appearance")');
  await a.click('button[aria-expanded]:has-text("Theme presets")');
  await a.fill('input[aria-label="Name of the preset"]', 'Night');
  await a.click('app-presets form button[type=submit]');
  await a.waitForSelector('app-presets >> text=Night');
  check(true, 'a preset of the theme is saved with a name');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });
  // it is shared from the "+" menu of the chat
  await a.click('[data-tip="More"]');
  // The menu offers photo or video, file and voice note as tiles, and the rest as cards.
  await a.waitForSelector('button:has-text("Photo or video")');
  await shot(a, '09a-plus-menu', 500);
  check(
    (await a.locator('button:has-text("File")').count()) >= 1 &&
      (await a.locator('button:has-text("Voice note")').count()) >= 1,
    'the + menu has photo or video, file and voice note',
  );
  // What the menu offers can be put in the bar as an icon, and taken back
  await a.click('button[aria-label="Customize"]');
  await a.click('button[role=switch]:has-text("Voice note")');
  await a.click('button[aria-label="Customize"]');
  await a.waitForTimeout(400);
  check(
    (await a.locator('button.menu-card:has-text("Voice note")').count()) === 0 &&
      (await a.locator('button[aria-label="Voice note"]:visible').count()) === 1,
    'an item put in the bar is an icon there and leaves the menu',
  );
  await a.click('button[aria-label="Customize"]');
  await a.click('button[role=switch]:has-text("Voice note")');
  await a.click('button[aria-label="Customize"]');
  await a.waitForTimeout(400);
  check(
    (await a.locator('button.menu-card:has-text("Voice note")').count()) === 1,
    'and goes back to the menu when it is taken out of the bar',
  );
  await a.click('button.menu-card:has-text("Share a preset")');
  await a.click('[role=dialog] [role=tab]:has-text("Theme of the app")');
  await a.click('[role=dialog] button:has-text("Night")');
  await b.waitForSelector('app-attachment button:has-text("Import and use")', {
    timeout: 15000,
  });
  await shot(b, '04d-preajuste-en-el-chat');
  // a theme can be tried before keeping it, and the person goes back to theirs
  await b.click('app-attachment button:has-text("Try")');
  await b.waitForSelector('text=You are trying');
  await b.click('button:has-text("Go back")');
  await b.waitForSelector('text=You are trying', { state: 'detached' });
  check(true, 'a theme of a message can be tried and given back');
  await b.click('app-attachment button:has-text("Import and use")');
  await b.waitForSelector('text=Preset imported and applied', {
    timeout: 15000,
  });
  check(true, 'the friend gets the preset with one button');
}
