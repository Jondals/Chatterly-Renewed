/**
 * test/e2e/11-spinly-a-wheel-and-a-tournament-in-the-c.mjs
 * Spinly: a wheel and a tournament in the chat, like a poll, and the linked account.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shot, step, check } from './support.mjs';

/** Spinly: a wheel and a tournament in the chat, like a poll, and the linked account. */
export async function step11(world) {
  const { a, b, webDir } = world;
  step('Spinly: a wheel and a tournament in the chat, like a poll, and the linked account');
  // The real Spinly lives on another site; here a test page plays Spinly with the same message protocol.
  fs.writeFileSync(
    path.join(webDir, 'spinly-stub.html'),
    '<!doctype html><meta charset="utf-8"><title>Spinly</title>' +
      '<button id="spin">spin</button><button id="champion">champion</button><script>' +
      'var params = new URLSearchParams(location.search);' +
      'var origin = params.get("chatterly");' +
      'var target = window.opener || window.parent;' +
      'target.postMessage({ source: "spinly", type: "hello", signedIn: true }, origin);' +
      'window.addEventListener("message", function (e) { if (e.data && e.data.type === "send-profile") target.postMessage({ source: "spinly", type: "profile", signedIn: true, profile: { themes: [{ name: "Test Theme", segments: ["#112233", "#445566", "#778899"], pointer: "#ff0000" }], presets: [{ name: "Friday", options: [{ name: "Pizza", color: "indigo" }, { name: "Tacos", color: "coral" }, { name: "Sushi", color: "teal" }], theme: { name: "Test Theme", segments: ["#112233", "#445566"] } }] } }, origin); });' +
      'document.getElementById("spin").onclick = function () { target.postMessage({ source: "spinly", type: "result", result: { kind: "wheel", title: "", names: ["Pizza", "Tacos", "Sushi"], winner: "Tacos" } }, origin); };' +
      'document.getElementById("champion").onclick = function () { target.postMessage({ source: "spinly", type: "result", result: { kind: "tournament", title: "Cup", names: ["Ana", "Luis", "Eva"], winner: "Ana" } }, origin); };' +
      '</script>',
  );
  await a.route('https://spinly-psi.vercel.app/**', async function (route) {
    await route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync(path.join(webDir, 'spinly-stub.html'), 'utf8'),
    });
  });
  await a.click('[data-tip="Settings"]');
  await a.waitForSelector('.settings-overlay');
  await a.click('a:has-text("Integrations")');
  await a.waitForSelector('button:has-text("Link my Spinly account")');
  check(
    (await a.locator('input[aria-label="Spinly address"]').count()) === 0,
    'there is no Spinly address to set: it is always the same one',
  );
  await a.waitForSelector('text=Not linked');
  check(true, 'Settings > Integrations: no Spinly account linked yet');
  await a.click('button:has-text("Link my Spinly account")');
  await a.waitForSelector('iframe[title="Spinly"]');
  check(
    (await a.locator('button:has-text("Open in a window")').count()) === 0,
    'Spinly is integrated: there is no button to open it in a window',
  );
  await a.click('button:has-text("Use my themes and presets")');
  await a.waitForSelector('.settings-overlay .chip-accent', { timeout: 15000 });
  check(
    (await a.locator('.settings-overlay .stat').allInnerTexts()).join(' ').replace(/\s+/g, ' ') ===
      '1 themes 1 presets',
    'the linked account shows how many themes and presets came over',
  );
  check(true, 'linking the Spinly account brings its themes and presets into Chatterly');
  await a.keyboard.press('Escape');
  await a.waitForSelector('.settings-overlay', { state: 'detached' });

  // A wheel made from a preset of the linked account, sent to the chat.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  // The ready-made lists to start from: one press fills the options.
  await a.click('[role=dialog][aria-label="Spinly"] button.starter-chip:has-text("Yes or no")');
  await a.waitForFunction(
    function () {
      const boxes = [
        ...document.querySelectorAll('[role=dialog][aria-label="Spinly"] input[data-entry]'),
      ];
      return boxes.length === 2 && boxes[0].value === 'Yes' && boxes[1].value === 'No';
    },
    null,
    { timeout: 5000 },
  );
  check(true, 'a ready-made list ("Yes or no") fills the options of the wheel with one press');
  await a.click('[role=dialog][aria-label="Spinly"] .fold-head:has-text("presets")');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Friday")');
  await a.waitForFunction(function () {
    const boxes = [
      ...document.querySelectorAll('[role=dialog][aria-label="Spinly"] input[data-entry]'),
    ];
    return (
      boxes.length === 3 &&
      boxes.some(function (box) {
        return box.value === 'Sushi';
      })
    );
  });
  check(true, 'a preset of the linked account fills in the options');
  await shot(a, '07c-spinly-composer');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Send to the chat")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]', {
    state: 'detached',
  });
  await b.waitForSelector('app-spinly-message button:has-text("Spin the wheel")', {
    timeout: 15000,
  });
  await a.waitForSelector('app-spinly-message button:has-text("Spin the wheel")', {
    timeout: 15000,
  });
  check(true, 'the wheel reaches both people as a message, like a poll');
  await b.click('app-spinly-message button:has-text("Spin the wheel")');
  await a.waitForSelector('app-spinly-message:has-text("The wheel says")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-message:has-text("The wheel says")', {
    timeout: 15000,
  });
  const winnerA = (await a.locator('app-spinly-message .text-xl').first().innerText()).trim();
  const winnerB = (await b.locator('app-spinly-message .text-xl').first().innerText()).trim();
  check(
    winnerA === winnerB && ['Pizza', 'Tacos', 'Sushi'].includes(winnerA),
    'when Bob spins, both see the same winner (' + winnerA + ')',
  );
  check(
    (await a.locator('app-spinly-message button:has-text("Spin")').count()) === 0 &&
      (await b.locator('app-spinly-message button:has-text("Spin")').count()) === 0,
    'once the result is out nobody can spin that wheel again',
  );
  await shot(a, '07d-spinly-wheel-result');

  // A tournament in the chat: one start, the same champion for everybody.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  await a.waitForSelector(
    '[role=dialog][aria-label="Spinly"] button.starter-chip:has-text("8 players")',
    { timeout: 5000 },
  );
  check(true, 'a tournament offers its sizes to start from');
  const rows = a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]');
  await rows.nth(0).fill('Ana');
  await rows.nth(1).fill('Luis');
  await rows.nth(2).fill('Eva');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Add participant")');
  await rows.nth(3).fill('Mia');
  await shot(a, '07c2-spinly-tournament-composer');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Send to the chat")');
  await b.waitForSelector('app-spinly-message button:has-text("Start the tournament")', {
    timeout: 15000,
  });
  await b.click('app-spinly-message button:has-text("Start the tournament")');
  await a.waitForSelector('app-spinly-message button:has-text("Skip to the result")', {
    timeout: 15000,
  });
  await shot(a, '07e-spinly-tournament');
  await a.click('app-spinly-message button:has-text("Skip to the result")');
  await b.click('app-spinly-message button:has-text("Skip to the result")');
  await a.waitForSelector('app-spinly-message:has-text("Champion")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-message:has-text("Champion")', {
    timeout: 15000,
  });
  const championA = (
    await a.locator('app-spinly-message .tour-champion-name').last().innerText()
  ).trim();
  const championB = (
    await b.locator('app-spinly-message .tour-champion-name').last().innerText()
  ).trim();
  check(
    championA === championB && ['Ana', 'Luis', 'Eva', 'Mia'].includes(championA),
    'the tournament has the same champion for both people (' + championA + ')',
  );

  // Everything is integrated: the window has no way out to the whole Spinly, and lists every theme once.
  await a.click('[data-tip="More"]');
  await a.click('button.menu-card:has-text("Spinly")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  check(
    (await a.locator('button:has-text("Open the full Spinly")').count()) === 0,
    'the window has no button to open the whole Spinly',
  );
  const themeNames = await a
    .locator(
      '[role=dialog][aria-label="Spinly"] .fold:has(.fold-head:has-text("Look")) .theme-card',
    )
    .allInnerTexts();
  check(new Set(themeNames).size === themeNames.length, 'every theme is listed once');
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"] .rule-preset');
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"] .rule-preset').count()) === 3 &&
      (await a.locator('[role=dialog][aria-label="Spinly"] .stepper-card').count()) === 0,
    'a tournament offers just three modes (fast, classic, epic)',
  );
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Wheel")');
  // The color of a slice, of the arrow and of the lights is edited with the normal color picker.
  await a.locator('[role=dialog][aria-label="Spinly"] path.slice').first().click({ force: true });
  await a.waitForSelector('.picker-panel .sv-area');
  // Escape closes only the picker, not the window under it.
  await a.keyboard.press('Escape');
  await a.waitForSelector('.picker-panel', { state: 'detached' });
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"]').count()) === 1,
    'Escape closes only the color picker and leaves the window open',
  );
  await a.locator('[role=dialog][aria-label="Spinly"] g.pointer').click({ force: true });
  await a.waitForSelector('.picker-panel');
  // A press outside closes only the picker as well.
  await a.mouse.click(5, 5);
  await a.waitForSelector('.picker-panel', { state: 'detached' });
  check(
    (await a.locator('[role=dialog][aria-label="Spinly"]').count()) === 1,
    'a press outside closes only the color picker',
  );
  await a.click('[role=dialog][aria-label="Spinly"] [role=tab]:has-text("Tournament")');
  await a.click('[role=dialog][aria-label="Spinly"] .rule-preset >> nth=2');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"] .rule-preset.is-on:has-text("Epic")');
  await shot(a, '07f-spinly-rules');
  await a.keyboard.press('Escape');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]', {
    state: 'detached',
  });
  await shot(a, '07-chat');
  await a.click('text=Hello Bob!', { button: 'right' });
  await shot(a, '07b-menu-contextual');
  await a.keyboard.press('Escape');
  await a.click('text=Hello Bob!', { button: 'right' });
  await a.waitForSelector('[role=menuitem]:has-text("Delete")');
  await a.click('[role=menuitem]:has-text("Delete")');
  await a.click('button:has-text("Delete"):not([role=menuitem])');
  await b.waitForSelector('text=Hello Bob!', {
    state: 'detached',
    timeout: 15000,
  });
  check(true, 'right click on a message: delete removes it for everybody');
}
