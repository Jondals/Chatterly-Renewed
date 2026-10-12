/** desktop/experiments/overlay/preload.cjs: the little bridge of the experiment (signalling, reports, metrics). */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poc', {
  signal: function signal(message) {
    ipcRenderer.send('signal', message);
  },
  onSignal: function onSignal(callback) {
    ipcRenderer.on('signal', function relay(event, message) {
      callback(message);
    });
  },
  report: function report(data) {
    ipcRenderer.send('report', data);
  },
  metrics: function metrics() {
    return ipcRenderer.invoke('metrics');
  },
  overlayState: function overlayState() {
    return ipcRenderer.invoke('overlay-state');
  },
});
