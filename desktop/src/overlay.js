/**
 * desktop/src/overlay.js
 * The page of the overlay window: the widgets (notifications, voice, video, call controls, activity, streams), the video of the
 * cameras and shared screens over a local WebRTC connection that never leaves the computer, and, while the overlay is unlocked,
 * dragging the widgets, pinning them and the buttons.
 * ! Everything that comes from the app is drawn as text (textContent) or as a checked data picture; the icons are fixed
 *   drawings of this file.
 */
'use strict';

const TILE_WIDTHS = { small: 180, medium: 240, large: 320 };
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
/** The cameras never get wider than this share of the screen, however much they are stretched. */
const MAX_SHARE = 0.6;
const TOAST_MS = 7000;
/** How long a message stays on screen, and how many are shown at once. */
const NOTICE_MS = 7000;
const MAX_NOTICES = 3;
const ORDER = ['notifications', 'voice', 'video', 'controls', 'activity', 'streams'];

/** The drawings of the icons (paths of a 24x24 grid, the same style as the app). */
const ICONS = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3',
  micOff:
    'M2 2l20 20 M18.89 13.23A7 7 0 0 0 19 12v-2 M5 10v2a7 7 0 0 0 12 5 M15 9.34V5a3 3 0 0 0-5.68-1.33 M9 9v3a3 3 0 0 0 5.12 2.12 M12 19v3',
  headphones:
    'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  headphonesOff:
    'M2 2l20 20 M21 14h-1.34 M9 4.12A9 9 0 0 1 21 12v1.34 M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.64-6.36',
  video: 'M16 13l5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5 M2 6h14v12H2z',
  videoOff:
    'M2 2l20 20 M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.06A.5.5 0 0 1 22 7.87v8.2 M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2',
  monitor: 'M2 3h20v14H2z M8 21h8 M12 17v4',
  phoneOff:
    'M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 M5.07 15.07A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91 M22 2 2 22',
  signal: 'M2 20h.01 M7 20v-4 M12 20v-8 M17 20V8 M22 4v16',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  x: 'M18 6 6 18 M6 6l12 12',
  gamepad:
    'M6 11h4 M8 9v4 M15 12h.01 M18 10h.01 M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-.6 5.98A3 3 0 0 0 5.08 18c1 0 1.96-.45 2.6-1.22L9 15h6l1.32 1.78A3.37 3.37 0 0 0 18.92 18a3 3 0 0 0 2.98-3.43l-.6-5.98A4 4 0 0 0 17.32 5z',
  volume: 'M11 5 6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07',
};

const SVG = 'http://www.w3.org/2000/svg';
let announced = false;

const host = document.getElementById('widgets');
const backdrop = document.getElementById('backdrop');
const bar = document.getElementById('bar');
const hint = document.getElementById('hint');
const done = document.getElementById('done');
const closeBox = document.getElementById('close');
const keys = document.getElementById('keys');

let config = null;
let tiles = [];
let scene = { call: null, streams: [], activity: null };
let notices = [];
let connection = null;
/** The streams that arrived, by id (the page tells which tile or shared screen each one belongs to). */
const remote = new Map();
/** The widgets on the page, by id. */
const widgets = new Map();
/** The video elements, by what they show, so a video is never rebuilt while it plays. */
const videos = new Map();

// ── Small builders ──────────────────────────────────────────────────────────────────────────────────

/** An element with a class (and a text). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** An icon of the fixed list. */
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.appendChild(path);
  return svg;
}

/** The first letters of a name. */
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const first = parts.length > 0 ? parts[0][0] : '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** A round picture of a person (their picture, or their initials on their color). */
function avatar(person) {
  const node = el('span', 'avatar');
  if (person.avatar) node.style.backgroundImage = 'url("' + person.avatar + '")';
  else {
    node.textContent = initials(person.name);
    node.style.backgroundColor = person.color || '#2ef2b0';
  }
  return node;
}

/** A video element for a stream of the local connection (kept between drawings). */
function videoFor(key, streamId) {
  let video = videos.get(key);
  if (!video) {
    video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    videos.set(key, video);
  }
  const stream = streamId ? remote.get(streamId) : undefined;
  if (stream && video.srcObject !== stream) video.srcObject = stream;
  if (!stream && video.srcObject) video.srcObject = null;
  return { video, live: Boolean(stream) };
}

/** "12:05" or "1:02:05". */
function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + seconds
    : minutes + ':' + seconds;
}

// ── The widgets ─────────────────────────────────────────────────────────────────────────────────────

/** The element of a widget: the title and the pin (shown while unlocked) and the body. */
function widgetFor(id) {
  let widget = widgets.get(id);
  if (widget) return widget;
  const root = el('section', 'widget');
  root.dataset.id = id;
  const head = el('div', 'w-head');
  const title = el('span', 'w-title');
  const pin = el('button', 'w-pin');
  pin.type = 'button';
  pin.appendChild(icon('pin'));
  pin.addEventListener('click', togglePin.bind(null, id));
  head.append(title, pin);
  const body = el('div', 'w-body');
  root.append(head, body);
  host.appendChild(root);
  root.addEventListener('pointerdown', onPointerDown);
  if (id === 'video') root.addEventListener('contextmenu', onVideoMenu);
  if (id === 'controls') {
    root.addEventListener('pointerenter', onControlsOver.bind(null, true));
    root.addEventListener('pointerleave', onControlsOver.bind(null, false));
  }
  widget = { root, title, pin, body };
  widgets.set(id, widget);
  return widget;
}

/** Whether a widget stays visible while playing. */
function isPinned(id) {
  return id === 'video' ? config.videoPinned : config.widgets[id].pinned;
}

/** Where a widget is (fractions of the screen). */
function placeOf(id) {
  return id === 'video' ? { x: config.x, y: config.y } : config.widgets[id];
}

/** Pins or unpins a widget (only while unlocked) and keeps it. */
function togglePin(id, event) {
  event.stopPropagation();
  if (!config || !config.editing) return;
  if (id === 'video') config.videoPinned = !config.videoPinned;
  else config.widgets[id].pinned = !config.widgets[id].pinned;
  saveLayout(false);
  render();
}

/** The people of the call, as the voice widget and the video widget show them. */
function shownPeople() {
  return tiles.filter(function isShown(tile) {
    return true;
  });
}

/** Voice: who is in the call, who talks, who is muted or deafened, who is live. */
function drawVoice(body) {
  const people = shownPeople();
  if (people.length === 0) return false;
  const list = el('div', 'card voice');
  for (const person of people) {
    const row = el('div', 'person' + (person.speaking ? ' speaking' : ''));
    row.append(avatar(person));
    if (config.showNames) row.append(el('span', 'name', person.name));
    if (person.screen) row.append(el('span', 'live', config.labels.live));
    if (person.camera) {
      const cam = el('span', 'state');
      cam.style.color = 'var(--muted)';
      cam.appendChild(icon('video'));
      row.append(cam);
    }
    if (person.deafened || person.muted) {
      // Both are shown when both are on: a person who is deafened and also muted (the mic is off too) shows the two.
      const state = el('span', 'state');
      if (person.muted) state.appendChild(icon('micOff'));
      if (person.deafened) state.appendChild(icon('headphonesOff'));
      row.append(state);
    }
    list.append(row);
  }
  body.append(list);
  return true;
}

/** Video: the cameras that are on (and, unlocked, a tile for everybody so the size can be set). */
function drawVideo(body) {
  const people = shownPeople().filter(function hasCamera(tile) {
    return config.editing || (tile.streamId && remote.has(tile.streamId));
  });
  if (people.length === 0) return false;
  const list = el('div', 'tiles' + (config.videoLayout === 'horizontal' ? ' horizontal' : ''));
  for (const person of people) {
    const tile = el('div', 'tile' + (person.speaking ? ' speaking' : ''));
    const { video, live } = videoFor('camera:' + person.id, person.streamId);
    if (live) tile.classList.add('has-video');
    const face = el('div', 'face');
    face.append(avatar(person));
    tile.append(video, face);
    if (config.showNames) {
      const label = el('div', 'label');
      label.append(el('span', '', person.name));
      if (person.muted) label.append(icon('micOff'));
      if (person.deafened) label.append(icon('headphonesOff'));
      tile.append(label);
    }
    list.append(tile);
  }
  const grip = el('span', 'grip');
  grip.dataset.grip = '1';
  list.append(grip);
  list.style.position = 'relative';
  body.append(list);
  return true;
}

/** The mouse is over the controls of the call: the shell lets it reach them even while locked (and gives it back when it leaves). */
let overControls = false;

function onControlsOver(over) {
  // ! Only remembered here: the shell decides when the window takes the mouse by watching the cursor against the rectangle of the
  //   controls (see reportControls), not by the events of the page. Asking the system to forward every mouse move over the whole screen
  //   (setIgnoreMouseEvents with forward) made the mouse of the game behave oddly.
  overControls = over;
}

/** The last rectangle of the controls told to the shell (as text, to tell only changes). */
let lastControls = '';

/** Tells the shell where the controls of the call are (or that they are not there), only when that changed. */
function reportControls() {
  const widget = widgets.get('controls');
  let rect = null;
  if (widget && widget.root.isConnected && !widget.root.hidden) {
    const box = widget.root.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) rect = { x: box.left, y: box.top, width: box.width, height: box.height };
  }
  const text = JSON.stringify(rect);
  if (text === lastControls) return;
  lastControls = text;
  window.chatterlyOverlay.controlsRect(rect);
}

/** A button of the controls. */
function control(name, title, className, action) {
  const button = el('button', 'ctl ' + className);
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.appendChild(icon(name));
  button.addEventListener('click', function press(event) {
    event.stopPropagation();
    if (config && (config.editing || overControls)) window.chatterlyOverlay.act({ type: action });
  });
  return button;
}

/** Controls: the buttons of the call and how it is going. */
function drawControls(body) {
  const call = scene.call;
  if (!call) return false;
  const l = config.labels;
  const card = el('div', 'card controls');
  const buttons = el('div', 'buttons');
  buttons.append(
    control(
      call.muted ? 'micOff' : 'mic',
      call.muted ? l.unmute : l.mute,
      call.muted ? 'is-off' : '',
      'mute',
    ),
    control(
      call.deafened ? 'headphonesOff' : 'headphones',
      call.deafened ? l.undeafen : l.deafen,
      call.deafened ? 'is-off' : '',
      'deafen',
    ),
    control(
      call.camera ? 'video' : 'videoOff',
      call.camera ? l.cameraOff : l.cameraOn,
      call.camera ? 'is-on' : '',
      'camera',
    ),
    control(
      'monitor',
      call.screen ? l.screenOff : l.screenOn,
      call.screen ? 'is-on' : '',
      'screen',
    ),
    control('phoneOff', l.leave, 'hang', 'leave'),
  );
  const status = el('div', 'status');
  const ok = el('span', 'ok');
  ok.append(icon('signal'), el('span', '', call.video ? l.videoConnected : l.voiceConnected));
  status.append(ok);
  if (call.room) status.append(el('span', 'room', call.room));
  if (call.ping >= 0) status.append(el('span', '', call.ping + ' ms'));
  if (call.since) status.append(el('span', 'tick-since', clock(Date.now() - call.since)));
  card.append(buttons, status);
  body.append(card);
  return true;
}

/** Activity: the registered game that is open, and for how long. */
function drawActivity(body) {
  const now = scene.activity;
  if (!now) {
    if (!config.editing) return false;
    body.append(el('div', 'card empty', config.labels.empty.activity));
    return true;
  }
  const card = el('div', 'card activity');
  card.append(el('span', 'kind', config.labels.playing));
  const game = el('div', 'game');
  const badge = el('span', 'icon');
  badge.appendChild(icon('gamepad'));
  const text = el('div');
  text.append(el('b', '', now.name), el('span', 'time tick-since', clock(Date.now() - now.since)));
  game.append(badge, text);
  card.append(game);
  body.append(card);
  card.querySelector('.tick-since').dataset.since = String(now.since);
  return true;
}

/** Streams: the screens other people share, live, with their volume while unlocked. */
function drawStreams(body) {
  const list = scene.streams.filter(function hasVideo(item) {
    return config.editing || (item.streamId && remote.has(item.streamId));
  });
  if (list.length === 0) {
    if (!config.editing) return false;
    body.append(el('div', 'card empty', config.labels.empty.streams));
    return true;
  }
  const card = el('div', 'card streams');
  for (const item of list) {
    const box = el('div', 'stream');
    const { video } = videoFor('screen:' + item.id, item.streamId);
    box.append(video, el('span', 'live', config.labels.live), el('span', 'who', item.name));
    card.append(box);
    if (item.sound) {
      const row = el('label', 'volume');
      row.appendChild(icon('volume'));
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '200';
      range.step = '5';
      range.value = String(item.volume);
      range.setAttribute('aria-label', config.labels.volume);
      range.addEventListener('pointerdown', stop);
      range.addEventListener('input', function change() {
        window.chatterlyOverlay.act({
          type: 'stream-volume',
          id: item.id,
          volume: Number(range.value),
        });
      });
      row.append(range);
      card.append(row);
    }
  }
  body.append(card);
  return true;
}

function stop(event) {
  event.stopPropagation();
}

/** Notifications: the messages that arrived (a click while unlocked opens the chat). */
function drawNotifications(body) {
  if (notices.length === 0) {
    if (!config.editing) return false;
    body.append(el('div', 'card empty', config.labels.empty.notifications));
    return true;
  }
  const list = el('div', 'notices');
  for (const notice of notices) {
    const card = el('div', 'card notice');
    const text = el('div', 'body');
    const from = el('div', 'from', notice.name);
    if (notice.where) from.append(el('span', 'where', notice.where));
    text.append(from);
    if (notice.text) text.append(el('div', 'text', notice.text));
    text.append(el('div', 'reply', config.labels.reply));
    card.append(avatar(notice), text);
    card.addEventListener('click', function open(event) {
      event.stopPropagation();
      if (config.editing) window.chatterlyOverlay.act({ type: 'open-chat', id: notice.id });
    });
    list.append(card);
  }
  body.append(list);
  return true;
}

const DRAW = {
  notifications: drawNotifications,
  voice: drawVoice,
  video: drawVideo,
  controls: drawControls,
  activity: drawActivity,
  streams: drawStreams,
};

/**
 * Draws every widget. ! A drawing that fails (a camera that gives something odd, a picture that cannot be decoded) must not leave
 * the overlay half drawn and stuck: the failure is kept inside, the next drawing tries again.
 */
function render() {
  try {
    renderNow();
  } catch (error) {
    // Drawn again at the next change.
  }
}

/** The drawing itself: the pinned widgets that have something to show, or all of them while unlocked. */
function renderNow() {
  if (!config) return;
  const style = document.documentElement.style;
  style.setProperty('--tile', TILE_WIDTHS[config.size] + 'px');
  style.setProperty('--scale', String(Math.min(config.scale, maxScale())));
  style.setProperty('--opacity', String(config.opacity / 100));
  document.body.classList.toggle('editing', config.editing);
  backdrop.hidden = !config.editing;
  bar.hidden = !config.editing;
  closeBox.hidden = !config.editing;
  if (!config.editing) closeMenu();
  if (config.editing) {
    drawBar();
    document.getElementById('toast').hidden = true;
  }
  for (const id of ORDER) {
    const widget = widgetFor(id);
    widget.title.textContent = config.labels.widgets[id];
    widget.pin.setAttribute('aria-pressed', String(isPinned(id)));
    widget.pin.title = isPinned(id) ? config.labels.unpin : config.labels.pin;
    widget.body.replaceChildren();
    const visible = (config.editing || isPinned(id)) && DRAW[id](widget.body);
    widget.root.hidden = !visible;
  }
  placeAll();
}

/** The biggest scale the cameras may have now: the general limit, and no more than a share of the width of the screen. */
function maxScale() {
  const tile = TILE_WIDTHS[config.size] || TILE_WIDTHS.medium;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, (innerWidth * MAX_SHARE) / tile));
}

/** Puts every widget where the person left it, always inside the screen. */
function placeAll() {
  for (const [id, widget] of widgets) {
    if (widget.root.hidden) continue;
    const at = placeOf(id);
    const width = widget.root.offsetWidth;
    const height = widget.root.offsetHeight;
    const left = Math.min(Math.max(at.x * innerWidth, 0), Math.max(innerWidth - width, 0));
    const top = Math.min(Math.max(at.y * innerHeight, 0), Math.max(innerHeight - height, 0));
    widget.root.style.left = left + 'px';
    widget.root.style.top = top + 'px';
  }
}

/** The bar of the unlocked overlay: the texts in the language of the app and which choices are on. */
function drawBar() {
  const labels = config.labels;
  document.getElementById('title').textContent = labels.title;
  hint.textContent = config.hint;
  done.replaceChildren(icon('x'));
  done.title = labels.done;
  done.setAttribute('aria-label', labels.done);
  keys.textContent = config.hotkey.replace('CommandOrControl', 'Ctrl');
}

/** Tells the app where the widgets are now (as fractions of the screen), their pins and the size of the video. */
function saveLayout(finished) {
  const layout = { widgets: {}, scale: config.scale, videoPinned: config.videoPinned };
  for (const id of ORDER) {
    const widget = widgets.get(id);
    const at = placeOf(id);
    let x = at.x;
    let y = at.y;
    if (widget && !widget.root.hidden) {
      const rect = widget.root.getBoundingClientRect();
      x = rect.left / innerWidth;
      y = rect.top / innerHeight;
    }
    if (id === 'video') {
      layout.x = x;
      layout.y = y;
    } else {
      layout.widgets[id] = { x, y, pinned: config.widgets[id].pinned };
    }
  }
  window.chatterlyOverlay.saveLayout(layout, finished);
}

/** Updates the clocks (how long the call and the game last) once a second, without drawing everything again. */
function tick() {
  reportControls();
  // Tells the shell the page is alive (while unlocked it watches for this, and rebuilds the window if it stops).
  window.chatterlyOverlay.alive();
  if (!config) return;
  const call = scene.call;
  for (const node of host.querySelectorAll('.tick-since')) {
    const since = Number(node.dataset.since) || (call ? call.since : 0);
    if (since) node.textContent = clock(Date.now() - since);
  }
}

// ── The local video connection ───────────────────────────────────────────────────────────────────

/** Opens a connection for the video of the app (nothing outside the computer: no STUN, no TURN). */
function openConnection() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.ontrack = function onTrack(event) {
    const stream = event.streams[0];
    if (!stream) return;
    remote.set(stream.id, stream);
    stream.onremovetrack = function onRemove() {
      if (stream.getTracks().length === 0) remote.delete(stream.id);
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
    remote.clear();
    render();
  }
}

// ── Moving the widgets and resizing the video (only while unlocked) ─────────────────────────────────

let drag = null;

/** Right click on the cameras (while unlocked): choose whether they are stacked or side by side. */
let menu = null;

function closeMenu() {
  if (menu) menu.remove();
  menu = null;
}

function onVideoMenu(event) {
  event.preventDefault();
  if (!config || !config.editing) return;
  closeMenu();
  menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  for (const layout of ['vertical', 'horizontal']) {
    const item = el(
      'button',
      '',
      layout === 'vertical' ? config.labels.layoutVertical : config.labels.layoutHorizontal,
    );
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String((config.videoLayout || 'vertical') === layout));
    item.addEventListener('click', function pick(click) {
      click.stopPropagation();
      window.chatterlyOverlay.choose({ videoLayout: layout });
      closeMenu();
    });
    menu.append(item);
  }
  menu.style.left = Math.min(event.clientX, innerWidth - 200) + 'px';
  menu.style.top = Math.min(event.clientY, innerHeight - 90) + 'px';
  document.body.append(menu);
}

/** The pointer went down on a widget (to move it) or on the corner of the video (to resize it). */
function onPointerDown(event) {
  if (!config || !config.editing || event.button !== 0) return;
  if (menu && !event.target.closest('.menu')) closeMenu();
  if (event.target.closest('button, input')) return;
  const root = event.currentTarget;
  const rect = root.getBoundingClientRect();
  const tilesBox = root.querySelector('.tiles');
  drag = {
    id: root.dataset.id,
    root,
    resize: Boolean(event.target.dataset && event.target.dataset.grip),
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top,
    width: tilesBox ? tilesBox.getBoundingClientRect().width : rect.width,
    scale: config.scale,
  };
  root.classList.add('is-dragging');
  root.setPointerCapture(event.pointerId);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  event.stopPropagation();
}

/** The pointer moved while dragging. */
function onPointerMove(event) {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (drag.resize) {
    const wanted = (drag.scale * (drag.width + dx)) / drag.width;
    config.scale = Math.min(Math.max(wanted, MIN_SCALE), maxScale());
    document.documentElement.style.setProperty('--scale', String(config.scale));
    return;
  }
  const x = (drag.left + dx) / innerWidth;
  const y = (drag.top + dy) / innerHeight;
  if (drag.id === 'video') {
    config.x = x;
    config.y = y;
  } else {
    config.widgets[drag.id].x = x;
    config.widgets[drag.id].y = y;
  }
  placeAll();
}

/** The pointer was released: keep the new place. */
function onPointerUp(event) {
  if (!drag) return;
  const root = drag.root;
  root.classList.remove('is-dragging');
  root.removeEventListener('pointermove', onPointerMove);
  root.removeEventListener('pointerup', onPointerUp);
  root.removeEventListener('pointercancel', onPointerUp);
  root.releasePointerCapture(event.pointerId);
  drag = null;
  saveLayout(false);
}

/** Escape locks the overlay. */
function onKey(event) {
  if (event.key === 'Escape' && menu) closeMenu();
  else if (event.key === 'Escape' && config && config.editing) saveLayout(true);
}

/** A click on the dimmed screen (not on a widget) locks the overlay, like the overlay of Discord. */
function onBackdrop() {
  if (menu) {
    closeMenu();
    return;
  }
  if (config && config.editing) saveLayout(true);
}

/** Says once, when the overlay appears, which keys unlock it. */
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
  setTimeout(reportControls, 60);
}

function onTiles(next) {
  tiles = Array.isArray(next) ? next : [];
  render();
}

function onScene(next) {
  scene = {
    call: next && next.call ? next.call : null,
    streams: next && Array.isArray(next.streams) ? next.streams : [],
    activity: next && next.activity ? next.activity : null,
  };
  render();
  setTimeout(reportControls, 60);
}

/** A message arrived: it shows for a few seconds (the newest on top). */
function onNotice(notice) {
  if (!notice || typeof notice.id !== 'string') return;
  notices = [notice]
    .concat(
      notices.filter(function other(item) {
        return item.id !== notice.id;
      }),
    )
    .slice(0, MAX_NOTICES);
  render();
  setTimeout(function expire() {
    notices = notices.filter(function keep(item) {
      return item !== notice;
    });
    render();
  }, NOTICE_MS);
}

function onDone() {
  saveLayout(true);
}

window.chatterlyOverlay.onConfig(onConfig);
window.chatterlyOverlay.onTiles(onTiles);
window.chatterlyOverlay.onScene(onScene);
window.chatterlyOverlay.onNotice(onNotice);
window.chatterlyOverlay.onSignal(onSignal);
done.addEventListener('click', onDone);
backdrop.addEventListener('pointerdown', onBackdrop);
window.addEventListener('keydown', onKey);
window.addEventListener('resize', placeAll);
window.addEventListener('error', function onError(event) {
  event.preventDefault();
});
window.addEventListener('unhandledrejection', function onRejection(event) {
  event.preventDefault();
});
setInterval(tick, 1000);
