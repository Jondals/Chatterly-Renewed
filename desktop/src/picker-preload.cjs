/**
 * desktop/src/picker-preload.cjs
 * Draws the "share your screen" window: two tabs (screens, windows), the list of what can be shared, a box to share the sound
 * too, and reports the choice to the main process.
 *
 * * The window has no script of its own (its CSP forbids them): the page is built here with safe DOM calls
 *   (textContent and a data: image), so a window title can never run as HTML.
 */
'use strict';

const { ipcRenderer } = require('electron');

/** What the window shows now: every source, the tab in use and the words. */
const view = { items: [], tab: 'screen', words: null };

/** A card was clicked: the source and whether the sound box is ticked go to the main process. */
function onChoose(event) {
  const box = document.getElementById('audio');
  ipcRenderer.send('picker:choose', event.currentTarget.dataset.id, Boolean(box && box.checked));
}

/** The window was cancelled. */
function onCancel() {
  ipcRenderer.send('picker:cancel');
}

/** One card of the list. */
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
    title: 'Choose what to share',
    screen: 'Entire screen',
    window: 'A window',
    empty: 'Nothing to show here.',
    audio: 'Share the sound of the computer',
    cancel: 'Cancel',
    window_title: 'Share your screen',
  },
  es: {
    title: 'Elige qué compartir',
    screen: 'Pantalla entera',
    window: 'Una ventana',
    empty: 'No hay nada que mostrar aquí.',
    audio: 'Compartir el sonido del equipo',
    cancel: 'Cancelar',
    window_title: 'Compartir pantalla',
  },
};

/** Fills the list with the sources of the tab in use and marks the tab. */
function render() {
  const grid = document.getElementById('grid');
  if (!grid || !view.words) return;
  grid.replaceChildren();
  const shown = view.items.filter(function ofTab(item) {
    return item.type === view.tab;
  });
  shown.forEach(function add(item) {
    grid.append(makeCard(item));
  });
  if (shown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = view.words.empty;
    grid.append(empty);
  }
  document.querySelectorAll('.tab').forEach(function mark(tab) {
    tab.classList.toggle('is-on', tab.dataset.tab === view.tab);
    tab.setAttribute('aria-selected', String(tab.dataset.tab === view.tab));
  });
}

/** A tab was clicked. */
function onTab(event) {
  view.tab = event.currentTarget.dataset.tab === 'window' ? 'window' : 'screen';
  render();
}

/** The main process sent the sources: the words, the tab to start in and the state of the sound box. */
function onSources(event, message) {
  view.words = WORDS[message && message.language === 'es' ? 'es' : 'en'];
  view.tab = message && message.kind === 'window' ? 'window' : 'screen';
  view.items = message && Array.isArray(message.items) ? message.items : [];
  const words = view.words;
  const write = function write(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };
  write('title', words.title);
  write('tab-screen', words.screen);
  write('tab-window', words.window);
  write('audio-label', words.audio);
  write('cancel', words.cancel);
  document.title = words.window_title;
  const box = document.getElementById('audio');
  if (box) box.checked = Boolean(message && message.audio);
  // With only one kind of source (only windows, when the menu of the call said "a window") there is nothing to switch.
  const tabs = document.getElementById('tabs');
  if (tabs) {
    const kinds = new Set(
      view.items.map(function kindOf(item) {
        return item.type;
      }),
    );
    tabs.hidden = kinds.size < 2 && view.items.length > 0;
    if (kinds.size === 1) view.tab = Array.from(kinds)[0] === 'window' ? 'window' : 'screen';
  }
  render();
}

/** The page is ready: the buttons start listening. */
function onReady() {
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.addEventListener('click', onCancel);
  document.querySelectorAll('.tab').forEach(function listen(tab) {
    tab.addEventListener('click', onTab);
  });
}

ipcRenderer.on('picker:sources', onSources);
window.addEventListener('DOMContentLoaded', onReady);
