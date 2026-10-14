/**
 * public/mediapipe/camera-fx.worker.js
 * The effects of the camera of a call, made OFF the main thread so the page (the mouse, the animations, the chat) never waits
 * for them: it reads the frames of the camera, cuts the person out with a model that runs on this device (MediaPipe selfie
 * segmentation), and draws the final picture on the graphics card (WebGL 2): background (blur, color, picture or animation),
 * mirror, zoom, brightness, contrast and saturation. The finished frames go back to the call as a video track.
 *
 * ! Nothing leaves the device: the model and its engine are files of the app itself (this same folder), the frames only travel
 *   between the camera, this worker and the call (which encrypts them like any other video).
 * ? It is a classic worker (not a module) because the engine of MediaPipe loads itself with importScripts.
 *
 * Where the browser has no insertable streams (Firefox, Safari) the page sends the frames itself as bitmaps and this worker sends
 * the finished ones back: { type: 'start', mode: 'bitmaps', base, options }, then { type: 'frame', bitmap } -> { type: 'frame', bitmap }.
 *
 * Messages from the page: { type: 'start', readable, writable, base, options } starts it; { type: 'options', options } changes
 * what it does; { type: 'frames', frames, durations } brings the pictures of an image or animated background; { type: 'stop' }.
 * `options` = { mirror, brightness, contrast, saturation, zoom, panX, panY, edgeSoftness, background: { type, amount, stops, angle } }.
 */
'use strict';

importScripts('vision_bundle.js');

/**
 * How much of the previous mask is kept (smooths the edges in time). Kept low: the mask is made for every frame at the first level,
 * and a high memory made it trail behind a person who moves, which left a halo of the old room around them.
 */
var MASK_MEMORY = 0.3;
/**
 * The model sees a picture of 256 x 256 whatever it is given, so a person who fills a third of the camera gets about 85 pixels of
 * detail across. So the model is given only the part of the picture where the person is (the crop), which gives it two or three
 * times more detail on the edges of the hair, the hands and the shoulders. The whole picture is looked at only now and then, to
 * find the crop (and to notice somebody who comes in).
 */
var DETECT_EVERY = 24;
/** The longest side, in pixels, of the crop that is given to the model. */
var CROP_SIDE = 384;
/** The crop is never smaller than this fraction of the picture, in either direction. */
var MIN_CROP = 0.34;
var FULL_RECT = [0, 0, 1, 1];

var state = {
  running: false,
  base: '',
  options: null,
  gl: null,
  canvas: null,
  programs: {},
  textures: {},
  targets: {},
  segmenter: null,
  segmenterStarting: false,
  maskSize: { width: 0, height: 0 },
  /** Where the mask is, as a rectangle of the picture (x, y, width, height, from 0 to 1): the crop, or all of it. */
  maskRect: FULL_RECT,
  /** The crop given to the model ({ x, y, w, h } of the picture), or null while nobody has been found. */
  roi: null,
  detectIn: 0,
  crop: null,
  cropContext: null,
  segmentKind: 'detect',
  stamp: 0,
  maskData: null,
  maskMemory: null,
  haveMask: false,
  frameNumber: 0,
  frames: [],
  durations: [],
  frameClock: 0,
  gradient: null,
  gradientKey: '',
  background: { width: 1, height: 1 },
  reader: null,
  writer: null,
  /** True when the page sends bitmaps (no insertable streams). */
  bitmaps: false,
  /** How hard the effects work (see LEVELS): 0 is everything; it goes up when the computer cannot keep up and comes back down. */
  level: 0,
  levelChanged: 0,
  lastRead: 0,
  interval: 33,
  /** The time (ms) between frames of the camera, from its frame rate. */
  nominal: 33,
  skip: false,
};

/**
 * The levels of effort. Each one costs less than the one before: the model is asked less often, the blur has fewer rounds and works
 * on a smaller picture, the edge is cheaper, and the last one makes only every other picture. A person who shares the screen, or a
 * computer that is slow, gets a higher level before it lags.
 */
var LEVELS = [
  { every: 1, rounds: 3, cheap: false, factor: 4, drop: false },
  { every: 2, rounds: 2, cheap: false, factor: 4, drop: false },
  { every: 3, rounds: 2, cheap: true, factor: 8, drop: false },
  { every: 5, rounds: 1, cheap: true, factor: 8, drop: true },
];

/** The level that is used now: the one the speed asks for, and at least the second when the page says the computer is busy. */
function effort() {
  var wanted = state.options && state.options.busy ? 1 : 0;
  return LEVELS[Math.max(state.level, wanted)];
}

/**
 * Called once for every frame that arrives. When the frames come slower than the camera makes them (the work is not finished
 * before the next one), the level goes up; after a few quiet seconds it goes down again.
 */
function watchSpeed() {
  var now = performance.now();
  if (state.lastRead > 0) {
    state.interval = state.interval * 0.9 + (now - state.lastRead) * 0.1;
    var slow = Math.max(44, state.nominal * 1.35);
    var quick = Math.max(37, state.nominal * 1.12);
    if (
      state.interval > slow &&
      state.level < LEVELS.length - 1 &&
      now - state.levelChanged > 1500
    ) {
      state.level++;
      state.levelChanged = now;
      self.postMessage({ type: 'level', level: state.level });
    } else if (state.interval < quick && state.level > 0 && now - state.levelChanged > 8000) {
      state.level--;
      state.levelChanged = now;
      self.postMessage({ type: 'level', level: state.level });
    }
  }
  state.lastRead = now;
  // the last level makes every other picture
  state.skip = effort().drop && !state.skip;
}

/** Handles what the page says. */
function onMessage(event) {
  var message = event.data;
  if (message.type === 'start') {
    start(message);
  } else if (message.type === 'options') {
    setOptions(message.options);
  } else if (message.type === 'frames') {
    setFrames(message.frames, message.durations);
  } else if (message.type === 'frame') {
    processBitmap(message.bitmap);
  } else if (message.type === 'stop') {
    stop();
  }
}
self.onmessage = onMessage;

/** Takes the new options and makes what they need (the model only when a background asks for it). */
function setOptions(options) {
  state.options = options;
  if (needsMask() && !state.segmenter && !state.segmenterStarting && state.running) {
    createSegmenter();
  }
}

/** Whether the options need to know where the person is. */
function needsMask() {
  return state.options && state.options.background && state.options.background.type !== 'none';
}

/** Keeps the pictures of an image or animated background (the old ones are released). */
function setFrames(frames, durations) {
  releaseFrames();
  state.frames = frames;
  state.durations = durations;
  state.frameClock = performance.now();
  state.frameShown = -1;
  if (frames.length > 0) {
    state.background = { width: frames[0].width, height: frames[0].height };
  }
}

/** Frees the bitmaps of the background. */
function releaseFrames() {
  for (var i = 0; i < state.frames.length; i++) {
    state.frames[i].close();
  }
  state.frames = [];
  state.durations = [];
}

/** Starts the work: the graphics, the reading of frames and, when needed, the model. */
function start(message) {
  state.base = message.base;
  state.options = message.options;
  state.bitmaps = message.mode === 'bitmaps';
  state.nominal = 1000 / Math.max(10, Math.min(60, Number(message.fps) || 30));
  state.interval = state.nominal;
  if (!state.bitmaps) {
    state.reader = message.readable.getReader();
    state.writer = message.writable.getWriter();
  }
  state.canvas = new OffscreenCanvas(2, 2);
  var gl = state.canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    self.postMessage({ type: 'error', reason: 'no-webgl2' });
    return;
  }
  state.gl = gl;
  buildGraphics(gl);
  state.running = true;
  if (needsMask()) {
    createSegmenter();
  }
  if (!state.bitmaps) {
    pump();
  }
}

// ---- the model ----------------------------------------------------------------------------------------------------

/** Loads the model that finds the person (on the graphics card when it can, on the processor otherwise). */
function createSegmenter() {
  state.segmenterStarting = true;
  Vision.FilesetResolver.forVisionTasks(state.base + 'wasm')
    .then(openSegmenter.bind(null, 'GPU'))
    .catch(reportSegmenterFailure);
}

/** Opens the segmenter with a delegate; when the graphics card cannot, it tries the processor. */
function openSegmenter(delegate, files) {
  return Vision.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: state.base + 'selfie_segmenter.tflite', delegate: delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  }).then(
    function opened(segmenter) {
      state.segmenter = segmenter;
      state.segmenterStarting = false;
      if (!state.running) {
        segmenter.close();
        state.segmenter = null;
      }
    },
    function failed(error) {
      if (delegate === 'GPU') {
        return openSegmenter('CPU', files);
      }
      throw error;
    },
  );
}

/** The model could not start: the picture goes on without a cutout. */
function reportSegmenterFailure(error) {
  state.segmenterStarting = false;
  self.postMessage({
    type: 'error',
    reason: 'model',
    detail: String(error && error.message ? error.message : error),
  });
}

/** Gives the model a picture and says what the answer is for ('detect': the whole picture; 'roi': the crop). */
function runSegmenter(source, kind) {
  state.segmentKind = kind;
  // the model wants a growing time stamp, and two pictures can be given in the same millisecond
  state.stamp = Math.max(state.stamp + 1, performance.now());
  state.segmenter.segmentForVideo(source, state.stamp, readMask);
}

/** Finds the person in a frame (the crop of it, most of the time) and keeps the mask up to date. */
function segmentFrame(frame) {
  var width = frame.displayWidth || frame.width;
  var height = frame.displayHeight || frame.height;
  if (!state.roi || state.detectIn <= 0) {
    state.detectIn = DETECT_EVERY;
    runSegmenter(frame, 'detect');
  } else {
    state.detectIn--;
  }
  var roi = state.roi;
  if (!roi) {
    return;
  }
  var sx = Math.round(roi.x * width);
  var sy = Math.round(roi.y * height);
  var sw = Math.max(8, Math.min(width - sx, Math.round(roi.w * width)));
  var sh = Math.max(8, Math.min(height - sy, Math.round(roi.h * height)));
  var scale = Math.min(1, CROP_SIDE / Math.max(sw, sh));
  var cw = Math.max(8, Math.round(sw * scale));
  var ch = Math.max(8, Math.round(sh * scale));
  if (!state.crop || state.crop.width !== cw || state.crop.height !== ch) {
    state.crop = new OffscreenCanvas(cw, ch);
    state.cropContext = state.crop.getContext('2d');
  }
  state.cropContext.drawImage(frame, sx, sy, sw, sh, 0, 0, cw, ch);
  // what the model answers is for exactly this part of the picture
  state.cropRect = [sx / width, sy / height, sw / width, sh / height];
  runSegmenter(state.crop, 'roi');
}

/** The rectangle (0 to 1, inside the mask) that holds everything the model is sure is the person, or null if there is nobody. */
function boxOf(values, width, height) {
  var minX = width;
  var minY = height;
  var maxX = -1;
  var maxY = -1;
  var count = 0;
  for (var y = 0; y < height; y++) {
    var row = y * width;
    for (var x = 0; x < width; x++) {
      if (values[row + x] > 128) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < width * height * 0.004) {
    return null;
  }
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height,
  };
}

/** Chooses the crop for a person (box in the coordinates of the picture); it moves only when the person has really moved. */
function proposeRoi(box) {
  if (!box) {
    state.roi = null;
    return;
  }
  var padX = box.w * 0.25 + 0.03;
  var padY = box.h * 0.2 + 0.03;
  var x0 = Math.max(0, box.x - padX);
  var y0 = Math.max(0, box.y - padY * 1.3);
  var x1 = Math.min(1, box.x + box.w + padX);
  var y1 = Math.min(1, box.y + box.h + padY);
  var next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (next.w < MIN_CROP) {
    next.x = Math.max(0, Math.min(1 - MIN_CROP, next.x + next.w / 2 - MIN_CROP / 2));
    next.w = MIN_CROP;
  }
  if (next.h < MIN_CROP) {
    next.y = Math.max(0, Math.min(1 - MIN_CROP, next.y + next.h / 2 - MIN_CROP / 2));
    next.h = MIN_CROP;
  }
  var old = state.roi;
  if (old) {
    var dx = Math.abs(next.x + next.w / 2 - (old.x + old.w / 2)) / old.w;
    var dy = Math.abs(next.y + next.h / 2 - (old.y + old.h / 2)) / old.h;
    var ds = Math.abs(next.w / old.w - 1) + Math.abs(next.h / old.h - 1);
    // the person touches a side of the crop that is not the edge of the picture: the crop has to grow
    var touching =
      (old.x > 0.001 && box.x - old.x < 0.03 * old.w) ||
      (old.x + old.w < 0.999 && old.x + old.w - (box.x + box.w) < 0.03 * old.w) ||
      (old.y > 0.001 && box.y - old.y < 0.03 * old.h) ||
      (old.y + old.h < 0.999 && old.y + old.h - (box.y + box.h) < 0.03 * old.h);
    if (dx < 0.12 && dy < 0.12 && ds < 0.3 && !touching) {
      return;
    }
  }
  state.roi = next;
}

/** True when two rectangles are the same. */
function sameRect(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Puts a mask in the texture the shader reads (smoothed in time while it keeps the same place and size). */
function uploadMask(values, width, height, rect) {
  if (
    !state.maskData ||
    state.maskSize.width !== width ||
    state.maskSize.height !== height ||
    !sameRect(state.maskRect, rect)
  ) {
    state.maskSize = { width: width, height: height };
    state.maskRect = rect;
    state.maskData = new Uint8Array(width * height);
    state.maskMemory = new Float32Array(width * height);
    state.haveMask = false;
    allocateMask(width, height);
  }
  var out = state.maskData;
  var memory = state.maskMemory;
  var keep = state.haveMask ? MASK_MEMORY : 0;
  for (var i = 0; i < values.length; i++) {
    var mixed = memory[i] * keep + values[i] * (1 - keep);
    memory[i] = mixed;
    out[i] = mixed;
  }
  state.haveMask = true;
  var gl = state.gl;
  gl.bindTexture(gl.TEXTURE_2D, state.textures.mask);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, out);
}

/** The answer of the model: it finds the crop (whole picture) or gives the mask of the person (crop). */
function readMask(result) {
  var mask = result.confidenceMasks && result.confidenceMasks[0];
  if (!mask) {
    return;
  }
  var width = mask.width;
  var height = mask.height;
  var values = mask.getAsUint8Array();
  var box = boxOf(values, width, height);
  if (state.segmentKind === 'detect') {
    proposeRoi(box);
    // while nobody has a crop yet, the mask of the whole picture is the mask
    if (!state.roi) {
      uploadMask(values, width, height, FULL_RECT);
    }
    return;
  }
  uploadMask(values, width, height, state.cropRect);
  if (box) {
    var r = state.cropRect;
    proposeRoi({
      x: r[0] + box.x * r[2],
      y: r[1] + box.y * r[3],
      w: box.w * r[2],
      h: box.h * r[3],
    });
  } else {
    // nobody in the crop any more: look at the whole picture on the next frame
    state.detectIn = 0;
  }
}

// ---- the graphics -------------------------------------------------------------------------------------------------

var VERTEX =
  '#version 300 es\n' +
  'out vec2 vUv;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
  '  vUv = p;\n' +
  '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
  '}\n';

/**
 * A blur in one direction: 9 taps, as wide as `uStep` says. It blurs four channels: the colour (already multiplied by how much
 * of each pixel is background) and that amount itself, so the result can be divided back (see COPY and COMPOSE).
 */
var BLUR =
  '#version 300 es\n' +
  'precision mediump float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uSource; uniform vec2 uStep;\n' +
  'void main() {\n' +
  '  vec4 sum = texture(uSource, vUv) * 0.2270270270;\n' +
  '  sum += texture(uSource, vUv + uStep * 1.3846153846) * 0.3162162162;\n' +
  '  sum += texture(uSource, vUv - uStep * 1.3846153846) * 0.3162162162;\n' +
  '  sum += texture(uSource, vUv + uStep * 3.2307692308) * 0.0702702703;\n' +
  '  sum += texture(uSource, vUv - uStep * 3.2307692308) * 0.0702702703;\n' +
  '  outColor = sum;\n' +
  '}\n';

/**
 * The first pass of the blur reads the camera (top row first) and writes it the same way, but WITHOUT the person: each pixel counts
 * as much as it is background. Blurring the person together with the room smeared their dark clothes and hair into a halo around
 * them; this way only the room is blurred.
 */
var COPY =
  '#version 300 es\n' +
  'precision mediump float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uSource; uniform sampler2D uMatte;\n' +
  'void main() {\n' +
  '  float back = 1.0 - smoothstep(0.1, 0.4, texture(uMatte, vUv).r);\n' +
  '  outColor = vec4(texture(uSource, vUv).rgb * back, back);\n' +
  '}\n';

/**
 * The matte: how much of each pixel is the person (0 to 1), made once per frame at half size, so the final picture only reads it.
 * The mask of the model is small and blurry. Each of its samples counts as much as its pixel looks like this one (a bilateral
 * filter guided by the camera), so the edge of the person snaps to the edge that is really in the picture; and the soft edge is the
 * mask averaged over a ring whose radius (in texels of the mask) comes from the slider, so the person fades into the background
 * over a distance that really grows. uCheap skips the expensive part when the computer cannot keep up.
 */
var MATTE =
  '#version 300 es\n' +
  'precision highp float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uVideo; uniform sampler2D uMask;\n' +
  'uniform vec2 uMaskTexel; uniform vec4 uMaskRect; uniform float uSoft; uniform float uCheap;\n' +
  '// The mask covers only the crop that was given to the model (uMaskRect, in the coordinates of the picture); outside it nobody is there.\n' +
  'float maskAt(vec2 p) {\n' +
  '  vec2 q = (p - uMaskRect.xy) / uMaskRect.zw;\n' +
  '  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { return 0.0; }\n' +
  '  return texture(uMask, q).r;\n' +
  '}\n' +
  'float featherMask(vec2 img, float radius) {\n' +
  '  const vec2 R[8] = vec2[8](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0), vec2(0.7, 0.7), vec2(-0.7, 0.7),\n' +
  '    vec2(0.7, -0.7), vec2(-0.7, -0.7));\n' +
  '  float sum = maskAt(img);\n' +
  '  float weight = 1.0;\n' +
  '  for (int i = 0; i < 8; i++) {\n' +
  '    sum += maskAt(img + R[i] * uMaskTexel * radius * 0.34);\n' +
  '    sum += maskAt(img + R[i] * uMaskTexel * radius * 0.67);\n' +
  '    sum += maskAt(img + R[i] * uMaskTexel * radius);\n' +
  '    weight += 3.0;\n' +
  '  }\n' +
  '  return sum / weight;\n' +
  '}\n' +
  'float refineMask(vec2 img, vec3 center) {\n' +
  '  const vec2 K[12] = vec2[12](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0), vec2(0.7, 0.7), vec2(-0.7, 0.7),\n' +
  '    vec2(0.7, -0.7), vec2(-0.7, -0.7), vec2(2.0, 0.0), vec2(-2.0, 0.0), vec2(0.0, 2.0), vec2(0.0, -2.0));\n' +
  '  float sum = maskAt(img);\n' +
  '  float weight = 1.0;\n' +
  '  for (int i = 0; i < 12; i++) {\n' +
  '    vec2 p = img + K[i] * uMaskTexel * 1.5;\n' +
  '    vec3 d = texture(uVideo, p).rgb - center;\n' +
  '    float w = exp(-dot(d, d) * 26.0);\n' +
  '    sum += maskAt(p) * w;\n' +
  '    weight += w;\n' +
  '  }\n' +
  '  return sum / weight;\n' +
  '}\n' +
  'void main() {\n' +
  '  // t is the slider of the soft edge (0 to 1)\n' +
  '  float t = clamp((uSoft - 0.02) / 0.39, 0.0, 1.0);\n' +
  '  float edge = 0.07 + t * 0.2;\n' +
  '  float cut;\n' +
  '  if (uCheap > 0.5) { cut = smoothstep(0.5 - edge, 0.5 + edge, maskAt(vUv)); }\n' +
  '  else { cut = smoothstep(0.6 - edge, 0.6 + edge, refineMask(vUv, texture(uVideo, vUv).rgb)); }\n' +
  '  float m = cut;\n' +
  '  if (t > 0.03) {\n' +
  '    float feather = smoothstep(0.5 - edge, 0.5 + edge, featherMask(vUv, 0.7 + pow(t, 0.85) * 42.0));\n' +
  '    m = mix(cut, feather, clamp(t * 1.6, 0.0, 1.0));\n' +
  '  }\n' +
  '  outColor = vec4(m, m, m, 1.0);\n' +
  '}\n';

/** The final picture: the background behind the person, the person over it, and the adjustments of the camera. */
var COMPOSE =
  '#version 300 es\n' +
  'precision highp float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uVideo; uniform sampler2D uMatte; uniform sampler2D uBlur; uniform sampler2D uBg;\n' +
  'uniform int uMode; uniform float uHasMask;\n' +
  'uniform float uMirror; uniform float uZoom; uniform vec2 uPan; uniform vec4 uBgFit;\n' +
  'uniform float uBright; uniform float uContrast; uniform float uSat;\n' +
  'void main() {\n' +
  '  vec2 uv = vUv;\n' +
  '  uv = (uv - 0.5) / uZoom + 0.5 + uPan;\n' +
  '  vec2 bgUv = uv;\n' +
  '  if (uMirror > 0.5) { uv.x = 1.0 - uv.x; }\n' +
  '  vec2 img = vec2(uv.x, 1.0 - uv.y);\n' +
  '  vec3 color = texture(uVideo, img).rgb;\n' +
  '  if (uMode != 0 && uHasMask > 0.5) {\n' +
  '    float m = texture(uMatte, img).r;\n' +
  '    vec3 back;\n' +
  '    if (uMode == 1) { vec4 blurred = texture(uBlur, img); back = blurred.rgb / max(blurred.a, 0.06); }\n' +
  '    else {\n' +
  '      vec2 b = vec2(bgUv.x, 1.0 - bgUv.y);\n' +
  '      b = (b - 0.5) * uBgFit.zw + 0.5 + uBgFit.xy;\n' +
  '      back = texture(uBg, b).rgb;\n' +
  '    }\n' +
  '    color = mix(back, color, m);\n' +
  '  }\n' +
  '  color += uBright;\n' +
  '  color = (color - 0.5) * uContrast + 0.5;\n' +
  '  float luma = dot(color, vec3(0.299, 0.587, 0.114));\n' +
  '  color = mix(vec3(luma), color, uSat);\n' +
  '  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);\n' +
  '}\n';

/** Compiles one shader. */
function compile(gl, type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

/** Links a program from the common vertex shader and a fragment shader. */
function program(gl, fragment) {
  var linked = gl.createProgram();
  gl.attachShader(linked, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(linked, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(linked));
  }
  return linked;
}

/** Makes a texture (smooth, never repeating). */
function makeTexture(gl, linear) {
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  var filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Makes a small picture to draw into (for the blur). */
function makeTarget(gl, width, height) {
  var texture = makeTexture(gl, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  var framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture: texture, framebuffer: framebuffer, width: width, height: height };
}

/** Builds the programs and the textures. */
function buildGraphics(gl) {
  state.programs.copy = program(gl, COPY);
  state.programs.blur = program(gl, BLUR);
  state.programs.matte = program(gl, MATTE);
  state.programs.compose = program(gl, COMPOSE);
  state.vao = gl.createVertexArray();
  state.textures.video = makeTexture(gl, true);
  state.textures.bg = makeTexture(gl, true);
  state.textures.mask = makeTexture(gl, true);
  allocateMask(256, 256);
  gl.bindTexture(gl.TEXTURE_2D, state.textures.mask);
}

/** Gives the mask texture its size. */
function allocateMask(width, height) {
  var gl = state.gl;
  gl.bindTexture(gl.TEXTURE_2D, state.textures.mask);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
}

/** Frees a small picture of the blur. */
function freeTarget(target) {
  if (target) {
    state.gl.deleteTexture(target.texture);
    state.gl.deleteFramebuffer(target.framebuffer);
  }
}

/** Makes the small pictures of the blur for the size of the camera, 1/factor of it. */
function sizeTargets(width, height, factor) {
  var gl = state.gl;
  var w = Math.max(16, Math.round(width / factor));
  var h = Math.max(16, Math.round(height / factor));
  if (state.targets.a && state.targets.a.width === w && state.targets.a.height === h) {
    return;
  }
  freeTarget(state.targets.a);
  freeTarget(state.targets.b);
  state.targets.a = makeTarget(gl, w, h);
  state.targets.b = makeTarget(gl, w, h);
}

/** The picture of the matte, half the size of the camera (at least 160 pixels wide). */
function sizeMatte(width, height) {
  var w = Math.max(160, Math.round(width / 2));
  var h = Math.max(90, Math.round(height / 2));
  if (state.targets.matte && state.targets.matte.width === w && state.targets.matte.height === h) {
    return;
  }
  freeTarget(state.targets.matte);
  state.targets.matte = makeTarget(state.gl, w, h);
}

/** Draws the full-screen triangle with a program, its textures (in the order given) and uniforms. */
function draw(prog, textures, setUniforms) {
  var gl = state.gl;
  gl.useProgram(prog);
  for (var i = 0; i < textures.length; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
  }
  setUniforms(gl);
  gl.bindVertexArray(state.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Sets a sampler uniform to a unit. */
function sampler(gl, prog, name, unit) {
  gl.uniform1i(gl.getUniformLocation(prog, name), unit);
}

/** The picture of the background that is on now, put in its texture (a still picture once, an animation when its frame changes). */
function updateBackground(width, height) {
  var options = state.options.background;
  var gl = state.gl;
  if (options.type === 'gradient') {
    var key = options.stops.join(',') + '@' + options.angle + '@' + width + 'x' + height;
    if (state.gradientKey !== key) {
      state.gradientKey = key;
      var size = { width: Math.min(width, 640), height: Math.min(height, 360) };
      var paint = new OffscreenCanvas(size.width, size.height);
      paintGradient(paint.getContext('2d'), options, size.width, size.height);
      gl.bindTexture(gl.TEXTURE_2D, state.textures.bg);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint);
      state.background = size;
    }
    return;
  }
  if (options.type === 'image' && state.frames.length > 0) {
    var index = frameIndexNow();
    if (state.frameShown !== index) {
      state.frameShown = index;
      gl.bindTexture(gl.TEXTURE_2D, state.textures.bg);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.frames[index]);
    }
  }
}

/** Which frame of an animated background belongs to this moment (a still picture has one). */
function frameIndexNow() {
  if (state.frames.length === 1) {
    return 0;
  }
  var total = 0;
  for (var i = 0; i < state.durations.length; i++) {
    total += state.durations[i];
  }
  var time = (performance.now() - state.frameClock) % total;
  for (var j = 0; j < state.durations.length; j++) {
    if (time < state.durations[j]) {
      return j;
    }
    time -= state.durations[j];
  }
  return state.frames.length - 1;
}

/** Paints a gradient (the ready-made and the custom backgrounds). */
function paintGradient(context, options, width, height) {
  var radians = (options.angle * Math.PI) / 180;
  var dx = Math.sin(radians);
  var dy = -Math.cos(radians);
  var half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  var gradient = context.createLinearGradient(
    width / 2 - dx * half,
    height / 2 - dy * half,
    width / 2 + dx * half,
    height / 2 + dy * half,
  );
  var count = Math.max(1, options.stops.length - 1);
  for (var i = 0; i < options.stops.length; i++) {
    gradient.addColorStop(i / count, options.stops[i]);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

/** Draws one finished picture from a frame of the camera. */
function render(frame) {
  var gl = state.gl;
  var options = state.options;
  var width = frame.displayWidth || frame.width;
  var height = frame.displayHeight || frame.height;
  if (state.canvas.width !== width || state.canvas.height !== height) {
    state.canvas.width = width;
    state.canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  gl.bindTexture(gl.TEXTURE_2D, state.textures.video);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

  var kind = options.background ? options.background.type : 'none';
  var mode = 0;
  var hasMask = state.haveMask && state.segmenter !== null;
  if (kind !== 'none' && hasMask) {
    mode = kind === 'blur' ? 1 : 2;
  }
  var level = effort();
  if (mode !== 0) {
    // the matte of the person, at half size, once for the whole picture
    sizeMatte(width, height);
    var matte = state.targets.matte;
    gl.bindFramebuffer(gl.FRAMEBUFFER, matte.framebuffer);
    gl.viewport(0, 0, matte.width, matte.height);
    draw(
      state.programs.matte,
      [state.textures.video, state.textures.mask],
      function matteUniforms(g) {
        var p = state.programs.matte;
        sampler(g, p, 'uVideo', 0);
        sampler(g, p, 'uMask', 1);
        var rect = state.maskRect;
        g.uniform4f(g.getUniformLocation(p, 'uMaskRect'), rect[0], rect[1], rect[2], rect[3]);
        // the size of one texel of the mask in the coordinates of the picture (the mask may cover only the crop)
        g.uniform2f(
          g.getUniformLocation(p, 'uMaskTexel'),
          rect[2] / Math.max(1, state.maskSize.width),
          rect[3] / Math.max(1, state.maskSize.height),
        );
        var soft =
          0.02 +
          Math.max(
            0,
            Math.min(1, options.edgeSoftness === undefined ? 0.55 : options.edgeSoftness),
          ) *
            0.39;
        g.uniform1f(g.getUniformLocation(p, 'uSoft'), soft);
        g.uniform1f(g.getUniformLocation(p, 'uCheap'), level.cheap ? 1 : 0);
      },
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
  }
  if (mode === 1) {
    sizeTargets(width, height, level.factor);
    var a = state.targets.a;
    var b = state.targets.b;
    // The reach of the blur is the same on every level: a smaller picture needs a smaller step.
    var spread = Math.max(0.5, ((options.background.amount / 7) * 4) / level.factor);
    // the camera (without the person) into the small picture, then rounds of blur (across, then down), each a little wider than
    // the last; fewer rounds are wider so the blur looks the same
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, a.width, a.height);
    draw(
      state.programs.copy,
      [state.textures.video, state.targets.matte.texture],
      function copyUniforms(g) {
        sampler(g, state.programs.copy, 'uSource', 0);
        sampler(g, state.programs.copy, 'uMatte', 1);
      },
    );
    var rounds = level.rounds === 3 ? [0.55, 0.85, 1.25] : level.rounds === 2 ? [0.8, 1.4] : [1.6];
    for (var round = 0; round < rounds.length; round++) {
      var step = spread * rounds[round];
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.framebuffer);
      draw(state.programs.blur, [a.texture], function across(g) {
        sampler(g, state.programs.blur, 'uSource', 0);
        g.uniform2f(g.getUniformLocation(state.programs.blur, 'uStep'), step / a.width, 0);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
      draw(state.programs.blur, [b.texture], function down(g) {
        sampler(g, state.programs.blur, 'uSource', 0);
        g.uniform2f(g.getUniformLocation(state.programs.blur, 'uStep'), 0, step / a.height);
      });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
  } else if (mode === 2) {
    updateBackground(width, height);
  }

  // how the picture of the background covers the frame (like object-fit: cover)
  var fit = [0, 0, 1, 1];
  if (mode === 2) {
    var bgRatio = state.background.width / state.background.height;
    var frameRatio = width / height;
    if (bgRatio > frameRatio) {
      fit = [0, 0, frameRatio / bgRatio, 1];
    } else {
      fit = [0, 0, 1, bgRatio / frameRatio];
    }
  }
  var blurTexture = mode === 1 ? state.targets.a.texture : state.textures.bg;
  draw(
    state.programs.compose,
    [
      state.textures.video,
      state.targets.matte ? state.targets.matte.texture : state.textures.mask,
      blurTexture,
      state.textures.bg,
    ],
    function composeUniforms(g) {
      var p = state.programs.compose;
      sampler(g, p, 'uVideo', 0);
      sampler(g, p, 'uMatte', 1);
      sampler(g, p, 'uBlur', 2);
      sampler(g, p, 'uBg', 3);
      g.uniform1i(g.getUniformLocation(p, 'uMode'), mode);
      g.uniform1f(g.getUniformLocation(p, 'uHasMask'), hasMask ? 1 : 0);
      g.uniform1f(g.getUniformLocation(p, 'uMirror'), options.mirror ? 1 : 0);
      var zoom = Math.max(1, options.zoom || 1);
      // the room the zoom leaves on each side is what the pan (-1 to 1) moves through
      var room = 0.5 - 0.5 / zoom;
      var panX = Math.max(-1, Math.min(1, options.panX || 0)) * room;
      var panY = Math.max(-1, Math.min(1, options.panY || 0)) * room;
      g.uniform1f(g.getUniformLocation(p, 'uZoom'), zoom);
      g.uniform2f(g.getUniformLocation(p, 'uPan'), panX, panY);
      g.uniform4f(g.getUniformLocation(p, 'uBgFit'), fit[0], fit[1], fit[2], fit[3]);
      g.uniform1f(g.getUniformLocation(p, 'uBright'), options.brightness || 0);
      g.uniform1f(
        g.getUniformLocation(p, 'uContrast'),
        options.contrast === undefined ? 1 : options.contrast,
      );
      g.uniform1f(
        g.getUniformLocation(p, 'uSat'),
        options.saturation === undefined ? 1 : options.saturation,
      );
    },
  );
}

/** A bitmap of the camera that the page sent: the picture is made and the finished one goes back as a bitmap. */
function processBitmap(bitmap) {
  if (!state.running) {
    bitmap.close();
    return;
  }
  watchSpeed();
  var done = null;
  try {
    if (needsMask() && state.segmenter && state.frameNumber % effort().every === 0) {
      segmentFrame(bitmap);
    }
    state.frameNumber++;
    render(bitmap);
    done = state.canvas.transferToImageBitmap();
  } catch (error) {
    // A frame that fails is skipped; the page asks again with the next one.
  }
  bitmap.close();
  if (done) {
    self.postMessage({ type: 'frame', bitmap: done }, [done]);
  } else {
    self.postMessage({ type: 'frame', bitmap: null });
  }
}

// ---- the loop -----------------------------------------------------------------------------------------------------

/** Reads a frame, makes the picture and sends it on, until it is stopped. */
async function pump() {
  while (state.running) {
    var step;
    try {
      step = await state.reader.read();
    } catch (error) {
      break;
    }
    if (step.done) {
      break;
    }
    var frame = step.value;
    watchSpeed();
    if (state.skip) {
      frame.close();
      continue;
    }
    try {
      if (needsMask() && state.segmenter && state.frameNumber % effort().every === 0) {
        segmentFrame(frame);
      }
      state.frameNumber++;
      render(frame);
      var out = new VideoFrame(state.canvas, { timestamp: frame.timestamp, alpha: 'discard' });
      await state.writer.write(out);
      out.close();
    } catch (error) {
      // A frame that fails is skipped; the next one tries again.
    }
    frame.close();
  }
  finish();
}

/** Stops the work and frees everything. */
function stop() {
  state.running = false;
  if (state.bitmaps) {
    finish();
    return;
  }
  try {
    state.reader.cancel().catch(ignore);
  } catch (error) {
    // it had ended already
  }
}

/** Nothing to do: a stream that already ended says so with an error nobody needs. */
function ignore() {
  return undefined;
}

/** Closes what the loop used (the loop calls it when it ends). */
function finish() {
  state.running = false;
  try {
    if (state.writer) {
      state.writer.close().catch(ignore);
    }
  } catch (error) {
    // it had ended already
  }
  if (state.segmenter) {
    state.segmenter.close();
    state.segmenter = null;
  }
  releaseFrames();
  self.postMessage({ type: 'stopped' });
}
