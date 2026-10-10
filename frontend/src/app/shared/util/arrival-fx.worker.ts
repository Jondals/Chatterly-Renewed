/**
 * src/app/shared/util/arrival-fx.worker.ts
 * Draws the light show of the arrival animations (arrival-fx-engine.ts) on a canvas that the page handed over (an
 * OffscreenCanvas). While the page is busy starting up (loading the app, drawing the first screen) the show keeps moving
 * smoothly, because nothing of it runs on the thread of the page.
 */
/// <reference lib="webworker" />
import { startShow, type Fx, type ShowConfig } from './arrival-fx-engine';

/** What the page tells the worker. */
type Command =
  | { type: 'start'; canvas: OffscreenCanvas; config: ShowConfig }
  | { type: 'explode' }
  | { type: 'burst'; x: number; y: number; count: number; gravity: number }
  | { type: 'stop' };

/* eslint-disable @typescript-eslint/no-explicit-any */
const scope = self as any;
let show: Fx | null = null;

/** Does what the page asks. */
function onCommand(event: MessageEvent<Command>): void {
  const command = event.data;
  switch (command.type) {
    case 'start':
      show = startShow(command.canvas, command.config, {
        tooSlow(): void {
          scope.postMessage({ type: 'slow' });
        },
        makeCanvas(size: number): OffscreenCanvas {
          return new OffscreenCanvas(size, size);
        },
      });
      break;
    case 'explode':
      show?.explode();
      break;
    case 'burst':
      show?.burst(command.x, command.y, command.count, command.gravity);
      break;
    case 'stop':
      show?.stop();
      show = null;
      break;
  }
}

scope.addEventListener('message', onCommand);
