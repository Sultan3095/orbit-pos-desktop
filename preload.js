const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('db:load'), delta: (d) => ipcRenderer.invoke('db:delta', d), deltaSync: (d) => ipcRenderer.sendSync('db:deltaSync', d), replaceAll: (t) => ipcRenderer.invoke('db:replaceAll', t),
  storeInfo: () => ipcRenderer.invoke('store:info'), storeCreate: (p, m) => ipcRenderer.invoke('store:create', p, m), storeUnlock: (s) => ipcRenderer.invoke('store:unlock', s), storeSetMode: (m) => ipcRenderer.invoke('store:setMode', m), storeChangePass: (o, n) => ipcRenderer.invoke('store:changePass', o, n),
  pickBackup: () => ipcRenderer.invoke('backup:pick'), readBackup: (f, s) => ipcRenderer.invoke('backup:read', f, s),
  info: () => ipcRenderer.invoke('app:info'), backupNow: () => ipcRenderer.invoke('backup:now'),
  chooseDir: () => ipcRenderer.invoke('dir:choose'),
  openSheet: () => ipcRenderer.invoke('xlsx:open'), saveSheet: (n, r, w) => ipcRenderer.invoke('xlsx:save', n, r, w),
  scrypt: (pin, salt) => ipcRenderer.sendSync('pin:scrypt', pin, salt),
  print: (html, o) => ipcRenderer.invoke('print:html', html, o),
  openDisplay: () => ipcRenderer.invoke('display:open'), updateDisplay: (p) => ipcRenderer.send('display:update', p),
  onDisplay: (cb) => ipcRenderer.on('display:data', (_e, d) => cb(d)),
});
