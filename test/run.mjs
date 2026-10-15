/**
 * The single test of Chatterly-Renewed: it checks EVERYTHING at once and leaves nothing behind.
 * (The messages it prints are in English.)
 *
 *   pnpm test
 *
 * What it does:
 *   1. Type-checks backend and frontend and checks that every UI string is translated, then runs the security checks
 *      (test/security.mts: other people's ids, sessions, uploads, SSRF, deletion, the relay-only policy, the frame cipher).
 *   2. Builds the frontend in a temporary folder and starts the real backend with a temporary database.
 *   3. Two real Chromium browsers: sign-up, friendship, chat with colors/emoji/stickers, GIFs (disabled
 *      without a key), an end-to-end encrypted video call (equal security codes and encrypted frames
 *      flowing), groups with text and voice channels, profile picture/banner/fonts, settings,
 *      language, WhatsApp sticker import, themed cursor, sounds, animated signature and mobile.
 *   4. Checks that the server NEVER stores clear text and that the API refuses requests without a session.
 *      Then the desktop app (Electron) with the web app inside it signs up against the real backend. (The checks of the
 *      shell alone are in desktop/test/desktop.mjs: pnpm --dir desktop test, which this test also runs.)
 *      Then the Android app: its settings, manifest and the web folder of the APK (mobile/test/mobile.mjs); building
 *      and running the APK need the Android SDK and a device and are reported as OMITIDO.
 *      Then the Android app: its settings, manifest and the web folder of the APK (mobile/test/mobile.mjs); building
 *      and running the APK need the Android SDK and a device and are reported as OMITIDO.
 *   5. Deletes everything temporary (servers, database, build, the Angular cache created by the test).
 *
 * Only when it fails does it save screenshots in the temporary folder of the system and print their path.
 */
import os from 'node:os';
import path from 'node:path';
import { cleanup, pages } from './e2e/support.mjs';
import { step01 } from './e2e/01-types-and-languages.mjs';
import { step02 } from './e2e/02-security-checks-no-browser.mjs';
import { step03 } from './e2e/03-build-and-temporary-servers.mjs';
import { step04 } from './e2e/04-mobile-no-horizontal-overflow.mjs';
import { step05 } from './e2e/05-sign-up-keys-generated-in-the-browser.mjs';
import { step06 } from './e2e/06-friendship.mjs';
import { step07 } from './e2e/07-mute-without-a-call-right-click-and-over.mjs';
import { step08 } from './e2e/08-direct-chat-text-colors-emoji-gifs-stick.mjs';
import { step09 } from './e2e/09-presets-save-the-look-share-it-in-the-ch.mjs';
import { step10 } from './e2e/10-name-and-time-on-every-message.mjs';
import { step11 } from './e2e/11-spinly-a-wheel-and-a-tournament-in-the-c.mjs';
import { step12 } from './e2e/12-links-the-preview-is-optional.mjs';
import { step13 } from './e2e/13-undo-redo-and-caret-when-formatting.mjs';
import { step14 } from './e2e/14-end-to-end-encrypted-call-with-video.mjs';
import { step15 } from './e2e/15-groups-uploaded-icon-and-text-and-voice.mjs';
import { step16 } from './e2e/16-speed-opening-settings-and-a-group-must.mjs';
import { step17 } from './e2e/17-settings-profile-appearance-language-sti.mjs';
import { step18 } from './e2e/18-phone-settings-are-a-list-first-and-the.mjs';
import { step19 } from './e2e/19-the-server-stores-nothing-in-clear.mjs';
import { step20 } from './e2e/20-deleting-the-account.mjs';
import { step21 } from './e2e/21-api-requests-without-a-session-and-cors.mjs';
import { step22, startDesktopShellChecks } from './e2e/22-desktop-app-with-the-web-app-inside.mjs';
import { step23 } from './e2e/23-android-app-settings-and-web-inside.mjs';

/** What the steps hand to each other (the people, the addresses and the files they made). */
const world = {};

/** The whole test: the steps, in order. */
/** The steps, in order (each one gets the shared world). */
const STEPS = [
  step01,
  step02,
  step03,
  step04,
  step05,
  step06,
  step07,
  step08,
  step09,
  step10,
  step11,
  step12,
  step13,
  step14,
  step15,
  step16,
  step17,
  step18,
  step19,
  step20,
  step21,
  step22,
  step23,
];

/** The whole test: the steps, in order, with the time each one took (to see what makes the test slow). */
async function main() {
  const times = [];
  const started = performance.now();
  // The checks of the desktop shell need nothing of the other steps: they run alongside them (step 22 waits for them).
  startDesktopShellChecks(world);
  for (const run of STEPS) {
    const at = performance.now();
    await run(world);
    times.push([run.name, (performance.now() - at) / 1000]);
  }
  console.log(
    '\nTime of each step (s): ' +
      times
        .map(function format(entry) {
          return entry[0].replace('step', '') + ' ' + entry[1].toFixed(0);
        })
        .join(', ') +
      ' | total ' +
      ((performance.now() - started) / 1000).toFixed(0),
  );
  // ! Printed only here, after the last step: the words mean that the WHOLE command passed.
  console.log('\nALL CORRECT');
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  console.error('\n' + (e instanceof Error ? e.stack : e));
  for (const [name, page] of pages) {
    try {
      const file = path.join(os.tmpdir(), `chatterly-fallo-${name}.png`);
      await page.screenshot({ path: file });
      console.error('failure screenshot: ' + file);
    } catch {}
  }
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
