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
 * Messages from the page: { type: 'start', readable, writable, base, options } starts it; { type: 'options', options } changes
 * what it does; { type: 'frames', frames, durations } brings the pictures of an image or animated background; { type: 'stop' }.
 * `options` = { mirror, brightness, contrast, saturation, zoom, background: { type, amount, stops, angle } }.
 */
'use strict';

importScripts('vision_bundle.js');

/** The mask is recalculated one frame of every this many (the person barely moves in 33 ms). */
var SEGMENT_EVERY = 2;
/** How much of the previous mask is kept (smooths the edges in time). */
var MASK_MEMORY = 0.5;

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
};

/** Handles what the page says. */
function onMessage(event) {
  var message = event.data;
  if (message.type === 'start') {
    start(message);
  } else if (message.type === 'options') {
    setOptions(message.options);
  } else if (message.type === 'frames') {
    setFrames(message.frames, message.durations);
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
  state.reader = message.readable.getReader();
  state.writer = message.writable.getWriter();
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
  pump();
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
  self.postMessage({ type: 'error', reason: 'model', detail: String(error && error.message ? error.message : error) });
}

/** Turns the confidence mask of the model into the soft mask the shader uses (smoothed in time). */
function readMask(result) {
  var mask = result.confidenceMasks && result.confidenceMasks[0];
  if (!mask) {
    return;
  }
  var width = mask.width;
  var height = mask.height;
  var values = mask.getAsUint8Array();
  if (!state.maskData || state.maskSize.width !== width || state.maskSize.height !== height) {
    state.maskSize = { width: width, height: height };
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

// ---- the graphics -------------------------------------------------------------------------------------------------

var VERTEX = '#version 300 es\n' +
  'out vec2 vUv;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
  '  vUv = p;\n' +
  '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
  '}\n';

/** A blur in one direction: 9 taps, as wide as `uStep` says. The result keeps the orientation of the picture it reads. */
var BLUR = '#version 300 es\n' +
  'precision mediump float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uSource; uniform vec2 uStep;\n' +
  'void main() {\n' +
  '  vec3 sum = texture(uSource, vUv).rgb * 0.2270270270;\n' +
  '  sum += texture(uSource, vUv + uStep * 1.3846153846).rgb * 0.3162162162;\n' +
  '  sum += texture(uSource, vUv - uStep * 1.3846153846).rgb * 0.3162162162;\n' +
  '  sum += texture(uSource, vUv + uStep * 3.2307692308).rgb * 0.0702702703;\n' +
  '  sum += texture(uSource, vUv - uStep * 3.2307692308).rgb * 0.0702702703;\n' +
  '  outColor = vec4(sum, 1.0);\n' +
  '}\n';

/** The first pass of the blur reads the camera (top row first) and writes it the same way. */
var COPY = '#version 300 es\n' +
  'precision mediump float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uSource;\n' +
  'void main() { outColor = vec4(texture(uSource, vUv).rgb, 1.0); }\n';

/** The final picture: the background behind the person, the person over it, and the adjustments of the camera. */
var COMPOSE = '#version 300 es\n' +
  'precision highp float;\n' +
  'in vec2 vUv; out vec4 outColor;\n' +
  'uniform sampler2D uVideo; uniform sampler2D uMask; uniform sampler2D uBlur; uniform sampler2D uBg;\n' +
  'uniform int uMode; uniform float uHasMask;\n' +
  'uniform float uMirror; uniform float uZoom; uniform vec4 uBgFit;\n' +
  'uniform float uBright; uniform float uContrast; uniform float uSat;\n' +
  'void main() {\n' +
  '  vec2 uv = vUv;\n' +
  '  uv = (uv - 0.5) / uZoom + 0.5;\n' +
  '  vec2 bgUv = uv;\n' +
  '  if (uMirror > 0.5) { uv.x = 1.0 - uv.x; }\n' +
  '  vec2 img = vec2(uv.x, 1.0 - uv.y);\n' +
  '  vec3 color = texture(uVideo, img).rgb;\n' +
  '  if (uMode != 0 && uHasMask > 0.5) {\n' +
  '    float m = smoothstep(0.35, 0.65, texture(uMask, img).r);\n' +
  '    vec3 back;\n' +
  '    if (uMode == 1) { back = texture(uBlur, img).rgb; }\n' +
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

/** Makes the small pictures of the blur for the size of the camera. */
function sizeTargets(width, height) {
  var gl = state.gl;
  var w = Math.max(16, Math.round(width / 4));
  var h = Math.max(16, Math.round(height / 4));
  if (state.targets.a && state.targets.a.width === w && state.targets.a.height === h) {
    return;
  }
  state.targets.a = makeTarget(gl, w, h);
  state.targets.b = makeTarget(gl, w, h);
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
  var width = frame.displayWidth;
  var height = frame.displayHeight;
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
  if (mode === 1) {
    sizeTargets(width, height);
    var a = state.targets.a;
    var b = state.targets.b;
    var spread = Math.max(0.5, options.background.amount / 7);
    // the camera into the small picture, then three rounds of blur (across, then down), each a little wider than the last
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, a.width, a.height);
    draw(state.programs.copy, [state.textures.video], function copyUniforms(g) {
      sampler(g, state.programs.copy, 'uSource', 0);
    });
    var rounds = [0.55, 0.85, 1.25];
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
    [state.textures.video, state.textures.mask, blurTexture, state.textures.bg],
    function composeUniforms(g) {
      var p = state.programs.compose;
      sampler(g, p, 'uVideo', 0);
      sampler(g, p, 'uMask', 1);
      sampler(g, p, 'uBlur', 2);
      sampler(g, p, 'uBg', 3);
      g.uniform1i(g.getUniformLocation(p, 'uMode'), mode);
      g.uniform1f(g.getUniformLocation(p, 'uHasMask'), hasMask ? 1 : 0);
      g.uniform1f(g.getUniformLocation(p, 'uMirror'), options.mirror ? 1 : 0);
      g.uniform1f(g.getUniformLocation(p, 'uZoom'), Math.max(1, options.zoom || 1));
      g.uniform4f(g.getUniformLocation(p, 'uBgFit'), fit[0], fit[1], fit[2], fit[3]);
      g.uniform1f(g.getUniformLocation(p, 'uBright'), options.brightness || 0);
      g.uniform1f(g.getUniformLocation(p, 'uContrast'), options.contrast === undefined ? 1 : options.contrast);
      g.uniform1f(g.getUniformLocation(p, 'uSat'), options.saturation === undefined ? 1 : options.saturation);
    },
  );
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
    try {
      if (needsMask() && state.segmenter && state.frameNumber % SEGMENT_EVERY === 0) {
        state.segmenter.segmentForVideo(frame, performance.now(), readMask);
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
    state.writer.close().catch(ignore);
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
