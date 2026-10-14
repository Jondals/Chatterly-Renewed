/**
 * src/app/core/services/camera-fx.ts
 * The effects of the camera of a call (background, mirror, zoom, brightness, contrast, saturation) and how they are made.
 * Where the browser can (Chrome, Edge, the desktop app) they are made in a WORKER, off the main thread, drawing on the graphics
 * card, so the page never waits for them (see public/mediapipe/camera-fx.worker.js). Where there are no insertable streams (Firefox,
 * Safari) the SAME worker is used, fed with a bitmap of every frame (BitmapFx); only a browser with no worker that can draw
 * falls back to the main thread with a canvas (camera-background.ts), heavier and with fewer effects.
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
  /** Where the zoomed picture looks, -1 to 1 of the room the zoom leaves on each side (0: the middle). */
  panX: number;
  panY: number;
  /** 0 to 1: how soft the edge of the person is against the background (0.33: the original look). */
  edgeSoftness: number;
  background: BackgroundSetting;
}

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
function canUseWorker(): boolean {
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

/** Whether a canvas that is not on the page can draw with WebGL 2 (the worker needs it). Asked once. */
let webgl2Answer: boolean | null = null;
function offscreenWebgl2(): boolean {
  if (webgl2Answer === null) {
    try {
      webgl2Answer = new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
    } catch {
      webgl2Answer = false;
    }
  }
  return webgl2Answer;
}

/** Whether the worker can be fed with bitmaps (the way for the browsers with no insertable streams). */
function canUseBitmapWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    offscreenWebgl2() &&
    typeof createImageBitmap === 'function' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof WebAssembly === 'object'
  );
}

/** Whether any effect can be made (in a worker or, failing that, with a canvas). */
export function canChangeCamera(): boolean {
  return (
    canUseWorker() ||
    canUseBitmapWorker() ||
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

/** The longest side of the pictures sent to the worker by the bitmap way (it keeps the cost of Firefox and Safari low). */
const BITMAP_SIDE = 1280;

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

/**
 * The effects made in the same worker where the browser has no insertable streams: a hidden video plays the camera, every frame
 * goes to the worker as a bitmap (one at a time: a new one only when the last came back), and the finished ones are drawn on a
 * canvas that the call captures.
 */
class BitmapFx implements CameraFx {
  readonly stream: MediaStream;
  private readonly worker: Worker;
  private readonly video = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private sent: ImageBitmap[] | null = null;
  private waiting = false;
  private stopped = false;
  private handle = 0;

  /** Starts the worker and the loop. */
  constructor(
    private readonly source: MediaStream,
    options: CameraFxOptions,
    onProblem: (reason: string) => void,
  ) {
    const settings = source.getVideoTracks()[0]?.getSettings() ?? {};
    const fps = Math.min(60, Math.max(15, Math.round(settings.frameRate ?? 30)));
    this.canvas.width = settings.width ?? 1280;
    this.canvas.height = settings.height ?? 720;
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('This browser cannot draw the camera.');
    }
    this.context = context;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = source;
    this.stream = this.canvas.captureStream(fps);
    this.worker = new Worker(appUrl('mediapipe/camera-fx.worker.js'));
    this.worker.onmessage = this.fromWorker.bind(this, onProblem);
    this.worker.postMessage({
      type: 'start',
      mode: 'bitmaps',
      base: appUrl('mediapipe/'),
      options: this.plain(options),
    });
    void this.sendFrames(options);
    void this.video.play().then(this.schedule.bind(this), onProblem.bind(null, 'video'));
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

  /** What the worker says: an error, or a finished picture to draw. */
  private fromWorker(onProblem: (reason: string) => void, event: MessageEvent): void {
    const data = event.data as { type?: string; reason?: string; bitmap?: ImageBitmap | null };
    if (data.type === 'error') {
      onProblem(String(data.reason));
    } else if (data.type === 'frame') {
      this.waiting = false;
      if (data.bitmap) {
        if (this.canvas.width !== data.bitmap.width || this.canvas.height !== data.bitmap.height) {
          this.canvas.width = data.bitmap.width;
          this.canvas.height = data.bitmap.height;
        }
        this.context.drawImage(data.bitmap, 0, 0);
        data.bitmap.close();
      }
    }
  }

  /** Asks for the next frame of the camera (or the next screen frame where that is not available). */
  private schedule(): void {
    if (this.stopped) {
      return;
    }
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (video.requestVideoFrameCallback) {
      this.handle = video.requestVideoFrameCallback(this.tick.bind(this));
    } else {
      this.handle = window.setTimeout(this.tick.bind(this), 33);
    }
  }

  /** One frame of the camera goes to the worker, unless it is still busy with the last one. */
  private tick(): void {
    if (this.stopped) {
      return;
    }
    if (!this.waiting && this.video.videoWidth > 0) {
      this.waiting = true;
      const scale = Math.min(
        1,
        BITMAP_SIDE / Math.max(this.video.videoWidth, this.video.videoHeight),
      );
      createImageBitmap(this.video, {
        resizeWidth: Math.round(this.video.videoWidth * scale),
        resizeHeight: Math.round(this.video.videoHeight * scale),
      }).then(this.give.bind(this), this.free.bind(this));
    }
    this.schedule();
  }

  /** The bitmap is ready: it goes to the worker (which owns it from now on). */
  private give(bitmap: ImageBitmap): void {
    if (this.stopped) {
      bitmap.close();
      return;
    }
    this.worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
  }

  /** The bitmap could not be made: the next frame tries again. */
  private free(): void {
    this.waiting = false;
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
    const video = this.video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.handle);
    } else {
      window.clearTimeout(this.handle);
    }
    this.worker.postMessage({ type: 'stop' });
    this.video.pause();
    this.video.srcObject = null;
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
  if (canUseBitmapWorker()) {
    try {
      return new BitmapFx(source, options, onProblem);
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
