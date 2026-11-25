const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('db:load'), save: (j) => ipcRenderer.invoke('db:save', j),
  info: () => ipcRenderer.invoke('app:info'), backupNow: () => ipcRenderer.invoke('backup:now'),
  restore: () => ipcRenderer.invoke('backup:restore'), chooseDir: () => ipcRenderer.invoke('dir:choose'),
  openSheet: () => ipcRenderer.invoke('xlsx:open'), saveSheet: (n, r, w) => ipcRenderer.invoke('xlsx:save', n, r, w),
  scrypt: (pin, salt) => ipcRenderer.sendSync('pin:scrypt', pin, salt),
  print: (html, o) => ipcRenderer.invoke('print:html', html, o),
  openDisplay: () => ipcRenderer.invoke('display:open'), updateDisplay: (p) => ipcRenderer.send('display:update', p),
  onDisplay: (cb) => ipcRenderer.on('display:data', (_e, d) => cb(d)),
});
