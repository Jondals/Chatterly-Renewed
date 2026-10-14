/**
 * src/app/core/services/camera-background.ts
 * Changes the background of the camera of a call, like Discord does: a model that runs on THIS device (MediaPipe selfie
 * segmentation, a 250 KB file served by the app itself) tells which pixels are the person, and the rest is blurred or
 * replaced by a color, a picture or an animation. The result is a new video track that the call sends instead of the
 * raw camera.
 *
 * ! Nothing leaves the device for this: the model and its WebAssembly engine come from the app's own files (never from a
 * CDN), the video is processed in memory and only the final picture goes to the call (which encrypts it as any other).
 * ? The person is cut out every other frame (the mask barely changes in 33 ms) and smoothed in time, so the cost is small
 * and the edges do not flicker; the picture itself is composed every frame so the video stays fluid.
 * ? This is the way for a browser that cannot do it in a worker (see camera-fx.ts, which prefers the worker): it runs on the
 * main thread with a canvas, and it only does the background and the mirror (not brightness, contrast, saturation or zoom).
 */
import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';

import { decodeGif } from '../gif-decode';
import type { CameraFx, CameraFxOptions } from './camera-fx';

/** Where the engine and the model are (inside the app, so the strict security policy of the page is kept). */
const ENGINE_FOLDER = 'mediapipe/wasm';
const MODEL_FILE = 'mediapipe/selfie_segmenter.tflite';
/** The mask is recalculated one frame of every this many. */
const SEGMENT_EVERY = 2;
/** How much of the previous mask is kept (smooths the edges in time). */
const MASK_MEMORY = 0.55;
/** The mask values between these two are the soft edge; below is background, above is person. */
const EDGE_LOW = 0.3;
const EDGE_HIGH = 0.7;
/** The most memory (bytes) the frames of an animated background may use. */
const MAX_FRAME_BYTES = 96 * 1024 * 1024;
/** The most frames of an animated background. */
const MAX_FRAMES = 160;
/** The longest side of a background picture (it is drawn at most this big; the output is rarely larger). */
const MAX_BACKGROUND_SIDE = 1280;

/** The segmenter is created once per session (it takes a moment and a few MB). */
let segmenterPromise: Promise<ImageSegmenter> | null = null;

/** The address of a file of the app. */
function appUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

/** Loads the engine and the model (once). */
function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = createSegmenter();
    segmenterPromise.catch(function forget(): void {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

/** Makes the segmenter, on the graphics card when it can and on the processor otherwise. */
async function createSegmenter(): Promise<ImageSegmenter> {
  const vision = await import('@mediapipe/tasks-vision');
  const files = await vision.FilesetResolver.forVisionTasks(appUrl(ENGINE_FOLDER));
  const options = {
    runningMode: 'VIDEO' as const,
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  };
  try {
    return await vision.ImageSegmenter.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: appUrl(MODEL_FILE), delegate: 'GPU' },
    });
  } catch {
    return vision.ImageSegmenter.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: appUrl(MODEL_FILE), delegate: 'CPU' },
    });
  }
}

/** Smooth step between two edges. */
function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, (value - EDGE_LOW) / (EDGE_HIGH - EDGE_LOW)));
  return t * t * (3 - 2 * t);
}

/** Decodes a picture or an animation into the frames (and how long each one lasts, in milliseconds). */
export async function decodeBackground(
  blob: Blob,
): Promise<{ frames: ImageBitmap[]; durations: number[] }> {
  const decoderType = (
    window as unknown as {
      ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
        tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
        decode(options: { frameIndex: number }): Promise<{
          image: VideoFrame;
        }>;
        close(): void;
      };
    }
  ).ImageDecoder;
  const animated = /image\/(gif|webp|png|apng)/.test(blob.type) && decoderType !== undefined;
  if (animated && decoderType) {
    try {
      const decoder = new decoderType({ data: await blob.arrayBuffer(), type: blob.type });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
      if (count > 1) {
        const out = await decodeFrames(decoder, count);
        decoder.close();
        if (out.frames.length > 0) {
          return out;
        }
      } else {
        decoder.close();
      }
    } catch {
      // The animation cannot be decoded here: its first picture is used.
    }
  }
  if (blob.type === 'image/gif' && decoderType === undefined) {
    // No ImageDecoder here (Firefox): the frames of the GIF are read by the app itself, so it keeps moving.
    try {
      const gif = decodeGif(new Uint8Array(await blob.arrayBuffer()), MAX_FRAMES);
      if (gif && gif.frames.length > 1) {
        return await bitmapsOfGif(gif);
      }
    } catch {
      // The GIF cannot be read: its first picture is used.
    }
  }
  const first = await createImageBitmap(blob, fitSize(await sizeOf(blob)));
  return { frames: [first], durations: [1000] };
}

/** Turns the frames of a GIF into bitmaps, small enough to keep them all in memory. */
async function bitmapsOfGif(gif: {
  width: number;
  height: number;
  frames: { image: ImageData; delay: number }[];
}): Promise<{ frames: ImageBitmap[]; durations: number[] }> {
  const side = Math.min(1, MAX_BACKGROUND_SIDE / Math.max(gif.width, gif.height));
  const fit = Math.min(
    side,
    Math.sqrt(MAX_FRAME_BYTES / (gif.frames.length * 4 * gif.width * gif.height)),
  );
  const size = {
    resizeWidth: Math.max(1, Math.round(gif.width * fit)),
    resizeHeight: Math.max(1, Math.round(gif.height * fit)),
    resizeQuality: 'high' as const,
  };
  const frames: ImageBitmap[] = [];
  const durations: number[] = [];
  for (const frame of gif.frames) {
    frames.push(await createImageBitmap(frame.image, size));
    durations.push(frame.delay);
  }
  return { frames, durations };
}

/** The size of a picture. */
async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** The size a picture is kept at (reduced when it is bigger than needed). */
function fitSize(size: { width: number; height: number }): {
  resizeWidth: number;
  resizeHeight: number;
  resizeQuality: 'high';
} {
  const scale = Math.min(1, MAX_BACKGROUND_SIDE / Math.max(size.width, size.height));
  return {
    resizeWidth: Math.max(1, Math.round(size.width * scale)),
    resizeHeight: Math.max(1, Math.round(size.height * scale)),
    resizeQuality: 'high',
  };
}

/** Decodes the frames of an animation, small enough to keep them all in memory. */
async function decodeFrames(
  decoder: {
    decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  },
  count: number,
): Promise<{ frames: ImageBitmap[]; durations: number[] }> {
  const frames: ImageBitmap[] = [];
  const durations: number[] = [];
  let size: ReturnType<typeof fitSize> | null = null;
  const total = Math.min(count, MAX_FRAMES);
  for (let index = 0; index < total; index++) {
    const { image } = await decoder.decode({ frameIndex: index });
    if (!size) {
      const natural = { width: image.displayWidth, height: image.displayHeight };
      const side = Math.min(1, MAX_BACKGROUND_SIDE / Math.max(natural.width, natural.height));
      // The memory of all the frames is bounded: a long animation is drawn smaller.
      const fit = Math.min(
        side,
        Math.sqrt(MAX_FRAME_BYTES / (total * 4 * natural.width * natural.height)),
      );
      size = {
        resizeWidth: Math.max(1, Math.round(natural.width * fit)),
        resizeHeight: Math.max(1, Math.round(natural.height * fit)),
        resizeQuality: 'high',
      };
    }
    frames.push(await createImageBitmap(image, size));
    durations.push(Math.max(20, Math.round((image.duration ?? 100000) / 1000)));
    image.close();
  }
  return { frames, durations };
}

/** Draws a gradient background (the ready-made ones). */
function paintGradient(
  context: CanvasRenderingContext2D,
  spec: { stops: string[]; angle: number },
  width: number,
  height: number,
): void {
  const radians = (spec.angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const gradient = context.createLinearGradient(
    width / 2 - dx * half,
    height / 2 - dy * half,
    width / 2 + dx * half,
    height / 2 + dy * half,
  );
  spec.stops.forEach(function add(color, index) {
    gradient.addColorStop(index / Math.max(1, spec.stops.length - 1), color);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

/** Draws a picture so it covers the whole canvas (like `object-fit: cover`). */
function paintCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

/** The camera with another background: `stream` is what the call sends. */
export class CameraBackground implements CameraFx {
  /** The processed video (a new track; it ends when `stop` is called). */
  readonly stream: MediaStream;

  private readonly video = document.createElement('video');
  private readonly output = document.createElement('canvas');
  private readonly person = document.createElement('canvas');
  private readonly maskSmall = document.createElement('canvas');
  private readonly outContext: CanvasRenderingContext2D;
  private readonly personContext: CanvasRenderingContext2D;
  private readonly maskContext: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  private maskValues: Float32Array | null = null;
  private haveMask = false;
  private options!: CameraFxOptions;
  private segmenter: ImageSegmenter | null = null;
  private running = false;
  private frameNumber = 0;
  private callback = 0;
  private startedAt = 0;
  private readonly onResult = this.readMask.bind(this);

  /** Prepares the canvases for a camera stream (call `start` to begin). */
  private constructor(private readonly source: MediaStream) {
    const settings = source.getVideoTracks()[0]?.getSettings() ?? {};
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;
    this.output.width = this.person.width = width;
    this.output.height = this.person.height = height;
    const outContext = this.output.getContext('2d', { alpha: false });
    const personContext = this.person.getContext('2d');
    const maskContext = this.maskSmall.getContext('2d', { willReadFrequently: true });
    if (!outContext || !personContext || !maskContext) {
      throw new Error('This browser cannot draw the background.');
    }
    this.outContext = outContext;
    this.personContext = personContext;
    this.maskContext = maskContext;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = source;
    const fps = settings.frameRate ?? 30;
    this.stream = this.output.captureStream(Math.min(60, Math.max(15, Math.round(fps))));
  }

  /** Starts the processing of a camera stream with a first background. */
  static async create(source: MediaStream, options: CameraFxOptions): Promise<CameraBackground> {
    const processor = new CameraBackground(source);
    processor.options = options;
    // The model first, when a background needs it (it fails here when the engine is missing, and the call keeps the raw camera).
    if (options.background.type !== 'none') {
      processor.segmenter = await loadSegmenter();
    }
    await processor.video.play();
    processor.start();
    return processor;
  }

  /** Changes the effects, without restarting the camera. */
  setOptions(options: CameraFxOptions): void {
    this.options = options;
    this.startedAt = performance.now();
    if (options.background.type !== 'none' && !this.segmenter) {
      void loadSegmenter().then(this.adoptSegmenter.bind(this), function ignore(): void {
        return undefined;
      });
    }
  }

  /** The model arrived after the background was asked for. */
  private adoptSegmenter(segmenter: ImageSegmenter): void {
    this.segmenter = segmenter;
  }

  /** Starts the loop: one picture per frame of the camera. */
  private start(): void {
    this.running = true;
    this.startedAt = performance.now();
    this.schedule();
  }

  /** Asks for the next frame of the camera (or the next screen frame where that is not available). */
  private schedule(): void {
    if (!this.running) {
      return;
    }
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (video.requestVideoFrameCallback) {
      this.callback = video.requestVideoFrameCallback(this.tick.bind(this));
    } else {
      this.callback = window.setTimeout(this.tick.bind(this), 33);
    }
  }

  /** One frame: cut the person out (every other frame), compose, and ask for the next. */
  private tick(): void {
    if (!this.running) {
      return;
    }
    try {
      if (
        this.segmenter &&
        this.options.background.type !== 'none' &&
        this.frameNumber % SEGMENT_EVERY === 0
      ) {
        this.segmenter.segmentForVideo(this.video, performance.now(), this.onResult);
      }
      this.frameNumber++;
      this.compose();
    } catch {
      // A frame that fails is skipped; the next one tries again.
    }
    this.schedule();
  }

  /** Turns the confidence mask of the model into the soft mask used to cut the person out. */
  private readMask(result: ImageSegmenterResult): void {
    const mask = result.confidenceMasks?.[0];
    if (!mask) {
      return;
    }
    const width = mask.width;
    const height = mask.height;
    const values = mask.getAsFloat32Array();
    if (this.maskSmall.width !== width || this.maskSmall.height !== height) {
      this.maskSmall.width = width;
      this.maskSmall.height = height;
      this.maskImage = this.maskContext.createImageData(width, height);
      this.maskValues = new Float32Array(width * height);
      this.haveMask = false;
    }
    const image = this.maskImage!;
    const memory = this.maskValues!;
    for (let i = 0; i < values.length; i++) {
      const raw = values[i]!;
      const mixed = this.haveMask ? memory[i]! * MASK_MEMORY + raw * (1 - MASK_MEMORY) : raw;
      memory[i] = mixed;
      const o = i * 4;
      image.data[o] = 255;
      image.data[o + 1] = 255;
      image.data[o + 2] = 255;
      image.data[o + 3] = Math.round(smooth(mixed) * 255);
    }
    this.haveMask = true;
    this.maskContext.putImageData(image, 0, 0);
  }

  /** Draws one picture: the background, then the person on top of it. */
  private compose(): void {
    const width = this.output.width;
    const height = this.output.height;
    const out = this.outContext;
    const mirror = this.options.mirror;
    const kind = this.options.background.type;
    out.save();
    if (mirror) {
      out.translate(width, 0);
      out.scale(-1, 1);
    }
    if (kind === 'none' || !this.haveMask || !this.segmenter) {
      // No background asked for (or no mask yet, the first frames): the plain camera.
      out.drawImage(this.video, 0, 0, width, height);
      out.restore();
      return;
    }
    this.paintBackground(out, width, height);
    const person = this.personContext;
    person.globalCompositeOperation = 'source-over';
    person.clearRect(0, 0, width, height);
    person.drawImage(this.video, 0, 0, width, height);
    person.globalCompositeOperation = 'destination-in';
    person.filter = 'blur(2px)';
    person.drawImage(this.maskSmall, 0, 0, width, height);
    person.filter = 'none';
    out.drawImage(this.person, 0, 0);
    out.restore();
  }

  /** Draws what goes behind the person. */
  private paintBackground(out: CanvasRenderingContext2D, width: number, height: number): void {
    const spec = this.options.background;
    if (spec.type === 'blur') {
      // The blur of the canvas is heavy: a smaller strength than the worker's, and the picture a little bigger than the canvas
      // so the blur does not leave a transparent border.
      const amount = Math.max(1, Math.round(spec.amount / 2));
      out.filter = 'blur(' + amount + 'px)';
      out.drawImage(this.video, -amount * 2, -amount * 2, width + amount * 4, height + amount * 4);
      out.filter = 'none';
    } else if (spec.type === 'gradient') {
      paintGradient(out, spec, width, height);
    } else if (spec.type === 'image') {
      const frame = this.frameAt(spec);
      paintCover(out, frame, frame.width, frame.height, width, height);
    }
  }

  /** The frame of an animated background that belongs to this moment (a still picture has one). */
  private frameAt(spec: { frames: ImageBitmap[]; durations: number[] }): ImageBitmap {
    if (spec.frames.length === 1) {
      return spec.frames[0]!;
    }
    const total = spec.durations.reduce(function add(sum, ms) {
      return sum + ms;
    }, 0);
    let time = (performance.now() - this.startedAt) % total;
    for (let i = 0; i < spec.frames.length; i++) {
      if (time < spec.durations[i]!) {
        return spec.frames[i]!;
      }
      time -= spec.durations[i]!;
    }
    return spec.frames[spec.frames.length - 1]!;
  }

  /** Stops everything: the loop, the copy of the camera and the processed track. The raw camera is stopped by its owner. */
  stop(): void {
    this.running = false;
    const video = this.video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.callback);
    } else {
      window.clearTimeout(this.callback);
    }
    this.video.pause();
    this.video.srcObject = null;
    for (const track of [...this.stream.getTracks(), ...this.source.getTracks()]) {
      track.stop();
    }
  }

  /** The raw camera this processor reads. */
  get raw(): MediaStream {
    return this.source;
  }
}
