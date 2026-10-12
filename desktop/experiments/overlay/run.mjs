/**
 * desktop/experiments/overlay/run.mjs
 * Runs the overlay experiment and prints what it found: does a live video get from one window to a transparent,
 * always-on-top, click-through window, how fast, and what does it cost?
 *
 *   node desktop/experiments/overlay/run.mjs
 *
 * It is an experiment to decide whether an in-game overlay is possible: nothing here ships in the app.
 */
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronExe = require('electron');
const here = import.meta.dirname;

function sleep(ms) {
  return new Promise(function executor(resolve) {
    setTimeout(resolve, ms);
  });
}

const env = { ...process.env };
// ! Some editors set this, and Electron would then run as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: electronExe,
  args: [path.join(here, 'main.cjs')],
  env,
  timeout: 30000,
});
try {
  const windows = [];
  while (windows.length < 2) {
    windows.push(
      ...app.windows().filter(function fresh(page) {
        return !windows.includes(page);
      }),
    );
    await sleep(100);
  }
  const overlayPage = windows.find(function isOverlay(page) {
    return page.url().endsWith('overlay.html');
  });
  const read = async function readReport() {
    return overlayPage.evaluate(function () {
      return new Promise(function executor(resolve) {
        const video = document.getElementById('v');
        resolve({ w: video.videoWidth, h: video.videoHeight, t: video.currentTime });
      });
    });
  };
  // Wait for the first picture.
  const begin = Date.now();
  let seen = await read();
  while (seen.w === 0 && Date.now() - begin < 20000) {
    await sleep(200);
    seen = await read();
  }
  const firstPicture = Date.now() - begin;
  // Count the frames of the overlay over three seconds, and ask what the processes cost.
  const counted = await overlayPage.evaluate(function () {
    return new Promise(function executor(resolve) {
      const video = document.getElementById('v');
      let n = 0;
      const start = performance.now();
      function tick() {
        n++;
        if (performance.now() - start < 3000) video.requestVideoFrameCallback(tick);
        else resolve({ n, ms: Math.round(performance.now() - start) });
      }
      video.requestVideoFrameCallback(tick);
    });
  });
  // The CPU use is measured between two questions, so the first answer is only the starting point.
  await overlayPage.evaluate(function () {
    return window.poc.metrics();
  });
  await sleep(3000);
  const metrics = await overlayPage.evaluate(function () {
    return window.poc.metrics();
  });
  const state = await overlayPage.evaluate(function () {
    return window.poc.overlayState();
  });
  const cpu = metrics.reduce(function sum(total, m) {
    return total + m.cpu;
  }, 0);
  console.log('first picture in the overlay after: ' + firstPicture + ' ms');
  console.log(
    'picture size in the overlay: ' +
      seen.w +
      'x' +
      seen.h +
      ' (sent at half size, 600 kbit/s at most)',
  );
  console.log(
    'frames drawn by the overlay in 3 s: ' +
      counted.n +
      ' (' +
      Math.round((counted.n / counted.ms) * 1000) +
      ' per second)',
  );
  console.log(
    'processes (all of them, both windows): ' +
      metrics.length +
      ', CPU about ' +
      Math.round(cpu) +
      '% of one core',
  );
  for (const m of metrics)
    console.log(
      '  ' + m.type + ': ' + m.cpu.toFixed(1) + '% CPU, ' + Math.round(m.memory / 1024) + ' MB',
    );
  console.log('overlay window: ' + JSON.stringify(state));
  const ok = seen.w > 0 && counted.n > 60 && state.alwaysOnTop && !state.focusable;
  console.log(
    ok
      ? 'RESULT: the video reaches the overlay and the window is as an overlay must be.'
      : 'RESULT: something is missing.',
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await app.close();
}
