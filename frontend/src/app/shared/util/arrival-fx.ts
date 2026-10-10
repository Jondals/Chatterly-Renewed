/**
 * src/app/shared/util/arrival-fx.ts
 * The light show behind the arrival animations, drawn on a canvas: points of light that spiral in from the edges of the
 * screen and gather into a ring (then burst outward), fireworks with gravity for the celebration, and slow dust that
 * floats and twinkles in the background all through. It is plain math on a 2D canvas, with no library.
 *
 * * Where the browser can (OffscreenCanvas and workers) the whole show runs in a worker: the page is busy while the app
 * starts, and a show drawn there lags. Elsewhere it runs on the page, as it always did (see arrival-fx-engine.ts).
 */
import { startShow, type Fx, type FxMode, type Rgb, type ShowConfig } from './arrival-fx-engine';

export type { Fx, FxMode } from './arrival-fx-engine';

/** Reads a #rrggbb color (null when it is something else). */
function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
  return match ? [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)] : null;
}

/** The middle color between two. */
function mixColors(first: Rgb, second: Rgb): Rgb {
  return [
    Math.round((first[0] + second[0]) / 2),
    Math.round((first[1] + second[1]) / 2),
    Math.round((first[2] + second[2]) / 2),
  ];
}

/** A lighter version of a color (towards white). */
function lighten(color: Rgb, amount: number): Rgb {
  return [
    Math.round(color[0] + (255 - color[0]) * amount),
    Math.round(color[1] + (255 - color[1]) * amount),
    Math.round(color[2] + (255 - color[2]) * amount),
  ];
}

/** The colors of the lights, from the theme of the person: its two accents, the mix of both, lighter ones and white. */
function readPalette(element: Element): Rgb[] {
  const style = getComputedStyle(element);
  const first = parseHex(style.getPropertyValue('--accent')) ?? [46, 242, 176];
  const second = parseHex(style.getPropertyValue('--accent-2')) ?? [167, 139, 250];
  return [
    first,
    second,
    mixColors(first, second),
    lighten(first, 0.5),
    lighten(second, 0.5),
    [255, 255, 255],
  ];
}

/** A canvas for a sprite, on the page. */
function pageCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

/** The whole page goes to the light mode (no blur, quick motion) for this visit. */
function lightMode(): void {
  document.documentElement.dataset['perf'] = 'low';
}

/** Whether this browser can draw on a canvas from a worker. */
function canUseWorker(canvas: HTMLCanvasElement): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof canvas.transferControlToOffscreen === 'function'
  );
}

/**
 * Starts the show on a canvas.
 * @param canvas Where to draw (it is sized to fill its box).
 * @param mode The show: the introduction, the sign-in or the celebration.
 */
export function startFx(canvas: HTMLCanvasElement, mode: FxMode): Fx {
  const weak = document.documentElement.dataset['perf'] === 'low';
  const config: ShowConfig = {
    mode,
    // Sharper than 1.5 pixels per pixel is not seen in glowing dots, and it costs the square of it to fill.
    ratio: Math.min(window.devicePixelRatio || 1, weak ? 1 : 1.5),
    width: canvas.clientWidth || window.innerWidth,
    height: canvas.clientHeight || window.innerHeight,
    weak,
    palette: readPalette(canvas),
  };
  if (canUseWorker(canvas)) {
    try {
      return startInWorker(canvas, config);
    } catch {
      /* the worker could not be made: the show runs on the page (the canvas is still free only if it was not handed over) */
    }
  }
  return startShow(canvas, config, { tooSlow: lightMode, makeCanvas: pageCanvas });
}

/** Runs the show in a worker that draws on the canvas of the page. */
function startInWorker(canvas: HTMLCanvasElement, config: ShowConfig): Fx {
  const worker = new Worker(new URL('./arrival-fx.worker', import.meta.url), { type: 'module' });
  const offscreen = canvas.transferControlToOffscreen();
  worker.onmessage = function onMessage(event: MessageEvent<{ type: string }>): void {
    if (event.data.type === 'slow') {
      lightMode();
    }
  };
  worker.postMessage({ type: 'start', canvas: offscreen, config }, [offscreen]);
  return {
    explode(): void {
      worker.postMessage({ type: 'explode' });
    },
    burst(x: number, y: number, count: number, gravity = 0): void {
      worker.postMessage({ type: 'burst', x, y, count, gravity });
    },
    stop(): void {
      worker.postMessage({ type: 'stop' });
      // a moment later, so the worker has cleared the canvas before it goes
      setTimeout(worker.terminate.bind(worker), 80);
    },
  };
}
