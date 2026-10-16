/**
 * src/app/shared/util/perf-monitor.ts
 * Watches how smoothly the page is drawn and, on a device that cannot keep up, switches the whole interface to the
 * light mode (`data-perf="low"`): no blur, fewer and slower lights, decorative animations paused.
 *
 * ? Why it exists: the animated backgrounds, auras and lights look great on a good computer and make a weak one stutter.
 * The light mode already existed, but it only switched on when the sign-in introduction was slow, so a person who
 * never saw it kept the heavy effects. Measuring the real frames of the real page is the only reliable way to know.
 *
 * * How it decides: for a minute after the start it counts the frames of every 3-second window. A window where more than a
 * third of the frames took longer than 34 ms (under 30 frames per second) is a "slow window"; two of them in a row switch
 * the light mode on for the rest of the visit. Frames after the tab was hidden or frozen (a gap over half a second) are
 * ignored, so changing tab never counts as lag. A good device pays almost nothing: one tiny callback per frame, for a
 * minute, outside Angular.
 */

/** Frames slower than this (milliseconds) count as slow: under about 30 frames per second. */
const SLOW_FRAME_MS = 34;
/** A gap longer than this is the tab having been hidden or frozen, not lag. */
const PAUSE_GAP_MS = 500;
/** Length of one measurement window. */
const WINDOW_MS = 3000;
/** Share of slow frames that makes a window slow. */
const SLOW_SHARE = 0.35;
/** Slow windows in a row that switch the light mode on. */
const SLOW_WINDOWS_TO_SWITCH = 3;
/** The first seconds are not judged: the page is still loading and every device stutters a little then. */
const SETTLE_MS = 6000;
/** Fewest frames a window needs to be judged (a window with almost no frames says nothing). */
const MIN_FRAMES = 30;
/** How long the page is watched after the start. */
const WATCH_MS = 60_000;

/** Starts watching. Call it once, outside the Angular zone, after the first paint. */
export function watchFramePerformance(): void {
  const root = document.documentElement;
  if (root.dataset['weak'] === '1') {
    return;
  }
  const startedAt = performance.now();
  let last = startedAt;
  let windowStart = startedAt;
  let frames = 0;
  let slow = 0;
  let slowWindows = 0;

  /** One frame: counts it, and at the end of the window decides whether the device is struggling. */
  function onFrame(now: number): void {
    const gap = now - last;
    last = now;
    if (document.hidden || gap > PAUSE_GAP_MS || now - startedAt < SETTLE_MS) {
      // The tab was in the background: start the window again, nothing is judged.
      windowStart = now;
      frames = 0;
      slow = 0;
    } else {
      frames++;
      if (gap > SLOW_FRAME_MS) {
        slow++;
      }
    }
    if (now - windowStart >= WINDOW_MS) {
      const struggling = frames >= MIN_FRAMES && slow / frames > SLOW_SHARE;
      slowWindows = struggling ? slowWindows + 1 : 0;
      windowStart = now;
      frames = 0;
      slow = 0;
      if (slowWindows >= SLOW_WINDOWS_TO_SWITCH) {
        // The settings decide what to do with it (only the automatic power mode lightens the page).
        root.dataset['weak'] = '1';
        window.dispatchEvent(new Event('chatterly:weak'));
        return;
      }
    }
    if (now - startedAt < WATCH_MS) {
      requestAnimationFrame(onFrame);
    }
  }

  requestAnimationFrame(onFrame);
}
