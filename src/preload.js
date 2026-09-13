'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The whole surface the two screens get. Nothing else from Node or Electron is
// reachable from the pages.
contextBridge.exposeInMainWorld('beltBoard', {
  get: () => ipcRenderer.invoke('board:get'),
  save: (entry) => ipcRenderer.invoke('board:save', entry),
  complete: (belt) => ipcRenderer.invoke('board:complete', belt),
  clear: (belt) => ipcRenderer.invoke('board:clear', belt),
  getDisplay: () => ipcRenderer.invoke('display:get'),
  onState: (callback) => subscribe('board:state', callback),
  onDisplay: (callback) => subscribe('display:status', callback),
});

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
