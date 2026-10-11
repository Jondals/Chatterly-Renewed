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

function onSources(event, list) {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.replaceChildren();
  list.forEach(function add(item) {
    grid.append(makeCard(item));
  });
}

function onReady() {
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.addEventListener('click', onCancel);
}

ipcRenderer.on('picker:sources', onSources);
window.addEventListener('DOMContentLoaded', onReady);
