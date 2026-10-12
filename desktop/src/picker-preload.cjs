/**
 * desktop/src/picker-preload.cjs
 * Draws the "share your screen" list inside the picker window and reports the choice to the main process.
 *
 * * The window has no script of its own (its CSP forbids them): the page is built here with safe DOM calls
 *   (textContent and a data: image), so a window title can never run as HTML.
 */
'use strict';

const { ipcRenderer } = require('electron');

function onChoose(event) {
  ipcRenderer.send('picker:choose', event.currentTarget.dataset.id);
}

function onCancel() {
  ipcRenderer.send('picker:cancel');
}

function makeCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.id = item.id;
  card.addEventListener('click', onChoose);

  const image = document.createElement('img');
  image.alt = '';
  image.src = item.thumb;
  const label = document.createElement('span');
  label.textContent = item.name;

  card.append(image, label);
  return card;
}

/** The words of the picker. */
const WORDS = {
  en: {
    any: 'Choose a screen or a window to share',
    screen: 'Choose a screen to share',
    window: 'Choose a window to share',
    cancel: 'Cancel',
    window_title: 'Share your screen',
  },
  es: {
    any: 'Elige una pantalla o una ventana para compartir',
    screen: 'Elige una pantalla para compartir',
    window: 'Elige una ventana para compartir',
    cancel: 'Cancelar',
    window_title: 'Compartir pantalla',
  },
};

function onSources(event, message) {
  const words = WORDS[message && message.language === 'es' ? 'es' : 'en'];
  const kind =
    message && (message.kind === 'screen' || message.kind === 'window') ? message.kind : 'any';
  const items = message && Array.isArray(message.items) ? message.items : [];
  const title = document.getElementById('title');
  if (title) title.textContent = words[kind];
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.textContent = words.cancel;
  document.title = words.window_title;
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.replaceChildren();
  items.forEach(function add(item) {
    grid.append(makeCard(item));
  });
}

function onReady() {
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.addEventListener('click', onCancel);
}

ipcRenderer.on('picker:sources', onSources);
window.addEventListener('DOMContentLoaded', onReady);
