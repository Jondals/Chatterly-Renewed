/**
 * desktop/src/overlay.js
 * The page of the overlay window: draws the panel of tiles (a camera, or the picture of the person when there is none, the
 * name, a ring while they talk), receives the video over a local WebRTC connection that never leaves the computer, and lets
 * the person move and resize the panel while editing.
 */
'use strict';

const TILE_WIDTHS = { small: 180, medium: 240, large: 320 };
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const TOAST_MS = 7000;
let announced = false;

const panel = document.getElementById('panel');
const list = document.getElementById('tiles');
const backdrop = document.getElementById('backdrop');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
const done = document.getElementById('done');
const grip = document.getElementById('grip');
const only = document.getElementById('only');
const names = document.getElementById('names');
const sizeButtons = bar.querySelectorAll('[data-size]');

let config = null;
let tiles = [];
let connection = null;
/** The streams that arrived, by id (the page tells which tile each one belongs to). */
const streams = new Map();
/** The elements of the tiles on screen, by person, so a video is never rebuilt while it plays. */
const elements = new Map();

/** The first letters of a name. */
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const first = parts.length > 0 ? parts[0][0] : '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Builds the element of one tile. */
function makeTile() {
  const root = document.createElement('div');
  root.className = 'tile';
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const face = document.createElement('span');
  avatar.appendChild(face);
  const name = document.createElement('div');
  name.className = 'name';
  root.append(video, avatar, name);
  return { root, video, face, name };
}

/** Puts what one person is doing in their tile. */
function fill(entry, tile) {
  entry.root.classList.toggle('speaking', tile.speaking);
  const stream = tile.streamId ? streams.get(tile.streamId) : undefined;
  entry.root.classList.toggle('live', Boolean(stream));
  if (stream && entry.video.srcObject !== stream) entry.video.srcObject = stream;
  if (!stream && entry.video.srcObject) entry.video.srcObject = null;
  entry.face.textContent = tile.avatar ? '' : initials(tile.name);
  entry.face.style.backgroundImage = tile.avatar ? 'url("' + tile.avatar + '")' : '';
  entry.face.style.backgroundColor = tile.avatar ? 'transparent' : tile.color;
  entry.name.textContent = tile.name;
  entry.name.classList.toggle('muted', tile.muted);
  entry.name.hidden = !config.showNames;
}

/** Puts the panel where the person left it, always inside the screen. */
function place() {
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const left = Math.min(Math.max(config.x * innerWidth, 0), Math.max(innerWidth - width, 0));
  const top = Math.min(Math.max(config.y * innerHeight, 0), Math.max(innerHeight - height, 0));
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}

/** Draws the panel: who is shown, how big and where. */
function render() {
  if (!config) return;
  const style = document.documentElement.style;
  style.setProperty('--tile', TILE_WIDTHS[config.size] + 'px');
  style.setProperty('--scale', String(config.scale));
  style.setProperty('--opacity', String(config.opacity / 100));
  panel.classList.toggle('editing', config.editing);
  backdrop.hidden = !config.editing;
  bar.hidden = !config.editing;
  grip.hidden = !config.editing;
  if (config.editing) {
    drawBar();
    // The notice of the start would sit under the bar.
    document.getElementById('toast').hidden = true;
  }
  const shown = tiles.filter(function isShown(tile) {
    return config.editing || !config.onlySpeaking || tile.speaking;
  });
  const keep = new Set();
  for (const tile of shown) {
    keep.add(tile.id);
    let entry = elements.get(tile.id);
    if (!entry) {
      entry = makeTile();
      elements.set(tile.id, entry);
    }
    fill(entry, tile);
    list.appendChild(entry.root);
  }
  for (const [id, entry] of elements) {
    if (!keep.has(id)) {
      entry.root.remove();
      elements.delete(id);
    }
  }
  place();
}

/** The bar of the editing mode: the texts in the language of the app and which choices are on. */
function drawBar() {
  const labels = config.labels;
  document.getElementById('title').textContent = labels.title;
  hint.textContent = config.hint;
  done.textContent = labels.done;
  only.textContent = labels.onlySpeaking;
  only.setAttribute('aria-pressed', String(config.onlySpeaking));
  names.textContent = labels.showNames;
  names.setAttribute('aria-pressed', String(config.showNames));
  for (const button of sizeButtons) {
    button.textContent = labels[button.dataset.size];
    button.setAttribute('aria-pressed', String(config.size === button.dataset.size));
  }
}

/** A button of the bar: a size, or turning "only who talks" or the names on or off. */
function onBarClick(event) {
  const button = event.target.closest('button');
  if (!button || !config) return;
  if (button.dataset.size) window.chatterlyOverlay.choose({ size: button.dataset.size });
  else if (button === only) window.chatterlyOverlay.choose({ onlySpeaking: !config.onlySpeaking });
  else if (button === names) window.chatterlyOverlay.choose({ showNames: !config.showNames });
}

/** Tells the app where the panel is now (as fractions of the screen) and how big. */
function saveLayout(finished) {
  const rect = panel.getBoundingClientRect();
  window.chatterlyOverlay.saveLayout(
    { x: rect.left / innerWidth, y: rect.top / innerHeight, scale: config.scale },
    finished,
  );
}

// ── The local video connection ───────────────────────────────────────────────────────────────────

/** Opens a connection for the video of the app (nothing outside the computer: no STUN, no TURN). */
function openConnection() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ontrack = function onTrack(event) {
    const stream = event.streams[0];
    if (!stream) return;
    streams.set(stream.id, stream);
    stream.onremovetrack = function onRemove() {
      if (stream.getTracks().length === 0) streams.delete(stream.id);
      render();
    };
    render();
  };
  pc.onicecandidate = function onCandidate(event) {
    if (event.candidate) window.chatterlyOverlay.signal({ candidate: event.candidate.toJSON() });
  };
  return pc;
}

/** The app sent an offer or a candidate: answer it. */
async function onSignal(message) {
  try {
    if (message.offer) {
      if (!connection) connection = openConnection();
      await connection.setRemoteDescription(message.offer);
      await connection.setLocalDescription(await connection.createAnswer());
      window.chatterlyOverlay.signal({ answer: connection.localDescription.toJSON() });
    } else if (message.candidate && connection) {
      await connection.addIceCandidate(message.candidate);
    }
  } catch (error) {
    // A connection that cannot take the new offer is dropped; the app offers again when it is asked to.
    if (connection) connection.close();
    connection = null;
    streams.clear();
    render();
  }
}

// ── Moving and resizing the panel (only while editing) ──────────────────────────────────────────────

let drag = null;

/** The pointer went down on the panel (to move it) or on the corner (to resize it). */
function onPointerDown(event) {
  if (!config || !config.editing) return;
  const rect = panel.getBoundingClientRect();
  drag = {
    resize: event.target === grip,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    scale: config.scale,
  };
  panel.setPointerCapture(event.pointerId);
}

/** The pointer moved while dragging. */
function onPointerMove(event) {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (drag.resize) {
    const wanted = (drag.scale * (drag.width + dx)) / drag.width;
    config.scale = Math.min(Math.max(wanted, MIN_SCALE), MAX_SCALE);
    document.documentElement.style.setProperty('--scale', String(config.scale));
  } else {
    config.x = (drag.left + dx) / innerWidth;
    config.y = (drag.top + dy) / innerHeight;
  }
  place();
}

/** The pointer was released: keep the new place. */
function onPointerUp() {
  if (!drag) return;
  drag = null;
  saveLayout(false);
}

/** Escape ends editing. */
function onKey(event) {
  if (event.key === 'Escape' && config && config.editing) saveLayout(true);
}

/** Says once, when the overlay appears, which keys open it. */
function announce() {
  if (announced || !config.toast) return;
  announced = true;
  const toast = document.getElementById('toast');
  toast.textContent = config.toast;
  toast.hidden = false;
  setTimeout(function hide() {
    toast.hidden = true;
  }, TOAST_MS);
}

function onConfig(next) {
  config = next;
  announce();
  render();
}

function onTiles(next) {
  tiles = Array.isArray(next) ? next : [];
  render();
}

function onDone() {
  saveLayout(true);
}

window.chatterlyOverlay.onConfig(onConfig);
window.chatterlyOverlay.onTiles(onTiles);
window.chatterlyOverlay.onSignal(onSignal);
panel.addEventListener('pointerdown', onPointerDown);
panel.addEventListener('pointermove', onPointerMove);
panel.addEventListener('pointerup', onPointerUp);
done.addEventListener('click', onDone);
bar.addEventListener('click', onBarClick);
window.addEventListener('keydown', onKey);
window.addEventListener('resize', place);
