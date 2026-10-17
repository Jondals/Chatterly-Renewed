/**
 * src/app/layout/drawer-swipe.ts
 * The swipe that opens and closes the navigation drawer on a phone: a swipe to the right opens it, a swipe to the left closes it.
 * * Only on a narrow screen (where the navigation is a drawer) and only with a finger.
 * * It must be a clear, quick, mostly horizontal swipe. The one that opens starts in the left part of the screen (not at the very
 *   edge, which the system uses to go back), and neither starts on something that already uses horizontal movement: a text field, a
 *   slider, a video, a list that scrolls sideways or anything marked with `data-no-swipe`.
 * * It listens passively, so it never slows or blocks the scroll.
 */

/** The width below which the navigation is a drawer (the `lg` breakpoint). */
const DRAWER_BELOW = 1024;
/** Fewest pixels to travel sideways, and the most time it may take (ms). */
const MIN_DISTANCE = 64;
const MAX_TIME = 700;
/** The sideways travel must be this many times the vertical one. */
const DOMINANCE = 1.8;
/** Where the swipe that opens may start: past the system edge, within this share of the width. */
const EDGE_GUARD = 18;
const OPEN_ZONE = 0.4;
/** Things that use horizontal movement themselves. */
const BUSY = 'input, textarea, select, [contenteditable="true"], [role="slider"], video, canvas, [data-no-swipe]';

/** Whether the element (or one above it) scrolls sideways, so a swipe over it is for it. */
function scrollsSideways(start: Element | null): boolean {
  for (let node = start; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

/**
 * Starts listening. `isOpen` says whether the drawer is open, `setOpen` opens or closes it. Returns the function that stops it.
 */
export function watchDrawerSwipe(isOpen: () => boolean, setOpen: (open: boolean) => void): () => void {
  let start: { x: number; y: number; time: number; target: Element | null } | null = null;

  function onStart(event: TouchEvent): void {
    start = null;
    if (event.touches.length !== 1 || window.innerWidth >= DRAWER_BELOW) return;
    const touch = event.touches[0]!;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(BUSY) || scrollsSideways(target)) return;
    start = { x: touch.clientX, y: touch.clientY, time: Date.now(), target };
  }

  function onEnd(event: TouchEvent): void {
    const begun = start;
    start = null;
    const touch = event.changedTouches[0];
    if (!begun || !touch) return;
    const dx = touch.clientX - begun.x;
    const dy = touch.clientY - begun.y;
    if (Date.now() - begun.time > MAX_TIME) return;
    if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
    if (dx > 0 && !isOpen()) {
      if (begun.x > EDGE_GUARD && begun.x < window.innerWidth * OPEN_ZONE) setOpen(true);
    } else if (dx < 0 && isOpen()) {
      setOpen(false);
    }
  }

  function onCancel(): void {
    start = null;
  }

  window.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchend', onEnd, { passive: true });
  window.addEventListener('touchcancel', onCancel, { passive: true });
  return function stop(): void {
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onCancel);
  };
}
