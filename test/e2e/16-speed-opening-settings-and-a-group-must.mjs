/**
 * test/e2e/16-speed-opening-settings-and-a-group-must.mjs
 * Speed: opening settings and a group must be almost instant.
 */
import { step, check } from './support.mjs';

/** Speed: opening settings and a group must be almost instant. */
export async function step16(world) {
  const { WEB, a } = world;
  step('speed: opening settings and a group must be almost instant');
  await a.goto(WEB + '/direct');
  await a.waitForSelector('a[data-tip="Rust Crew"]');
  await a.waitForTimeout(1500);
  let t0 = Date.now();
  await a.click('a[data-tip="Rust Crew"]');
  await a.waitForSelector('textarea[aria-label=Message]');
  const msGrupo = Date.now() - t0;
  t0 = Date.now();
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('h1:has-text("My profile")');
  const msAjustes = Date.now() - t0;
  console.log('  group: ' + msGrupo + ' ms, settings: ' + msAjustes + ' ms');
  check(
    msGrupo < 1200 && msAjustes < 1200,
    'opening a group and the settings takes less than 1.2 s',
  );
  await a.keyboard.press('Escape');
  await a.waitForTimeout(500);
}
