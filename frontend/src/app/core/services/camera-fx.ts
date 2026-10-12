/**
 * src/app/core/services/camera-fx.ts
 * The effects of the camera of a call (background, mirror, zoom, brightness, contrast, saturation) and how they are made.
 * Where the browser can (Chrome, Edge, the desktop app) they are made in a WORKER, off the main thread, drawing on the graphics
 * card, so the page never waits for them (see public/mediapipe/camera-fx.worker.js). Where it cannot, the same effects are made
 * on the main thread with a canvas (camera-background.ts), a little heavier but working.
 *
 * ! Nothing leaves the device for this: the model, the engine and the worker are files of the app itself.
 */
import { CameraBackground, decodeBackground } from './camera-background';

/** What goes behind the person. */
export type BackgroundSetting =
  | { type: 'none' }
  | { type: 'blur'; amount: number }
  | { type: 'gradient'; stops: string[]; angle: number }
  | { type: 'image'; frames: ImageBitmap[]; durations: number[] };

/** Everything the effects of the camera can do. */
export interface CameraFxOptions {
  /** The picture is turned like in a mirror (for everybody who sees the camera). */
  mirror: boolean;
  /** -0.5 to 0.5 (0: as it is). */
  brightness: number;
  /** 0.5 to 1.5 (1: as it is). */
  contrast: number;
  /** 0 to 2 (1: as it is). */
  saturation: number;
  /** 1 to 2 (1: no zoom). */
  zoom: number;
  background: BackgroundSetting;
}

/** The options that change nothing. */
export const NEUTRAL_FX: CameraFxOptions = {
  mirror: false,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  zoom: 1,
  background: { type: 'none' },
};

/** True when the options change nothing (the plain camera can be used, with no processing at all). */
export function isNeutral(options: CameraFxOptions): boolean {
  return (
    !options.mirror &&
    options.brightness === 0 &&
    options.contrast === 1 &&
    options.saturation === 1 &&
    options.zoom === 1 &&
    options.background.type === 'none'
  );
}

/** A camera with effects: `stream` is what the call sends. */
export interface CameraFx {
  readonly stream: MediaStream;
  /** Changes the effects, live. */
  setOptions(options: CameraFxOptions): void;
  /** Stops the effects and the camera behind them. */
  stop(): void;
}

/** What the page needs of the insertable streams of the browser (not in the standard types yet). */
interface TrackProcessorConstructor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream };
}
interface TrackGeneratorConstructor {
  new (init: { kind: 'video' }): MediaStreamTrack & { writable: WritableStream };
}

/** The address of a file of the app. */
function appUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

/** Whether the effects can be made in a worker (insertable streams and a worker that draws with WebGL). */
export function canUseWorker(): boolean {
  const scope = window as unknown as {
    MediaStreamTrackProcessor?: TrackProcessorConstructor;
    MediaStreamTrackGenerator?: TrackGeneratorConstructor;
  };
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    !!scope.MediaStreamTrackProcessor &&
    !!scope.MediaStreamTrackGenerator
  );
}

/** Whether any effect can be made (in a worker or, failing that, with a canvas). */
export function canChangeCamera(): boolean {
  return canUseWorker() || typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/** The effects made in a worker. */
class WorkerFx implements CameraFx {
  readonly stream: MediaStream;
  private readonly worker: Worker;
  /** The pictures of the background that the worker has now (to send them again only when they change). */
  private sent: ImageBitmap[] | null = null;
  private stopped = false;

  /** Starts the worker with the camera and the first options. */
  constructor(
    private readonly source: MediaStream,
    options: CameraFxOptions,
    onProblem: (reason: string) => void,
  ) {
    const scope = window as unknown as {
      MediaStreamTrackProcessor: TrackProcessorConstructor;
      MediaStreamTrackGenerator: TrackGeneratorConstructor;
    };
    const track = source.getVideoTracks()[0]!;
    const processor = new scope.MediaStreamTrackProcessor({ track });
    const generator = new scope.MediaStreamTrackGenerator({ kind: 'video' });
    this.worker = new Worker(appUrl('mediapipe/camera-fx.worker.js'));
    this.worker.onmessage = function fromWorker(event: MessageEvent): void {
      if (event.data?.type === 'error') {
        onProblem(String(event.data.reason));
      }
    };
    this.worker.postMessage(
      {
        type: 'start',
        readable: processor.readable,
        writable: generator.writable,
        base: appUrl('mediapipe/'),
        options: this.plain(options),
      },
      [processor.readable, generator.writable],
    );
    void this.sendFrames(options);
    this.stream = new MediaStream([generator]);
  }

  /** The options without the bitmaps (they travel apart). */
  private plain(options: CameraFxOptions): unknown {
    const background = options.background;
    return {
      ...options,
      background: background.type === 'image' ? { type: 'image' } : background,
    };
  }

  /** Sends the pictures of an image background when they are not the ones the worker has. */
  private async sendFrames(options: CameraFxOptions): Promise<void> {
    const background = options.background;
    if (background.type !== 'image' || this.sent === background.frames) {
      return;
    }
    this.sent = background.frames;
    // The worker gets its own copies: the page keeps the originals for the next time.
    const copies = await Promise.all(
      background.frames.map(function copy(frame) {
        return createImageBitmap(frame);
      }),
    );
    if (this.stopped) {
      for (const copy of copies) {
        copy.close();
      }
      return;
    }
    this.worker.postMessage(
      { type: 'frames', frames: copies, durations: background.durations },
      copies,
    );
  }

  /** Changes the effects. */
  setOptions(options: CameraFxOptions): void {
    if (this.stopped) {
      return;
    }
    this.worker.postMessage({ type: 'options', options: this.plain(options) });
    void this.sendFrames(options);
  }

  /** Stops everything and gives the camera back. */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.worker.postMessage({ type: 'stop' });
    // The worker closes by itself when its last frame is done; the tracks end now so nothing waits.
    for (const track of [...this.stream.getTracks(), ...this.source.getTracks()]) {
      track.stop();
    }
    setTimeout(this.worker.terminate.bind(this.worker), 500);
  }
}

/** Starts the effects of a camera. Gives back null when the effects cannot be made here. */
export async function startCameraFx(
  source: MediaStream,
  options: CameraFxOptions,
  onProblem: (reason: string) => void = function ignore(): void {
    return undefined;
  },
): Promise<CameraFx | null> {
  if (canUseWorker()) {
    try {
      return new WorkerFx(source, options, onProblem);
    } catch {
      // The worker could not start: the canvas way is tried.
    }
  }
  if (typeof HTMLCanvasElement.prototype.captureStream === 'function') {
    return CameraBackground.create(source, options);
  }
  return null;
}

export { decodeBackground };
