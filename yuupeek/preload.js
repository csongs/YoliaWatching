const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuuApi', {
  onUpdate:    (cb) => ipcRenderer.on('yolia-update', (_e, data) => cb(data)),
  onBaron:     (cb) => ipcRenderer.on('baron-event', (_e) => cb()),
  punish:      ()   => ipcRenderer.send('punish'),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  feed:            ()   => ipcRenderer.send('feed'),
  setYoliaSee:     (v)  => ipcRenderer.send('set-yolia-see', v),
  quit:            ()   => ipcRenderer.send('quit'),
  getConfig:            ()   => ipcRenderer.invoke('get-config'),
  onAnimationsUpdate:   (cb) => ipcRenderer.on('animations-update', (_e, data) => cb(data)),
});
