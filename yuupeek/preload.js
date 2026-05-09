const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuuApi', {
  onUpdate:    (cb) => ipcRenderer.on('yuushi-update', (_e, data) => cb(data)),
  onBaron:     (cb) => ipcRenderer.on('baron-event', (_e) => cb()),
  punish:      ()   => ipcRenderer.send('punish'),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  feed:            ()   => ipcRenderer.send('feed'),
  setYuushi:       (v)  => ipcRenderer.send('set-yuushi', v),
  quit:            ()   => ipcRenderer.send('quit'),
});
