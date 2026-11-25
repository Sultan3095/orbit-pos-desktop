const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.env.ORBIT_USER_DATA) app.setPath('userData', process.env.ORBIT_USER_DATA);
let win = null, display = null;
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'orbit-pos.json');
const defaultBackupDir = () => path.join(dataDir(), 'backups');

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  const fd = fs.openSync(tmp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch (e) {} }
  fs.renameSync(tmp, file);
}
function backupDirFrom(json) {
  try { const d = JSON.parse(json).settings.backupDir; if (d && fs.existsSync(d)) return d; } catch (e) {}
  return defaultBackupDir();
}
function doBackup(tag) {
  const f = dataFile(); if (!fs.existsSync(f)) return null;
  const json = fs.readFileSync(f, 'utf8');
  const dir = backupDirFrom(json); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = path.join(dir, 'orbit-pos-' + stamp + (tag ? '-' + tag : '') + '.json');
  fs.writeFileSync(out, json);
  const all = fs.readdirSync(dir).filter((n) => /^orbit-pos-.*\.json$/.test(n)).sort();
  while (all.length > 40) { try { fs.unlinkSync(path.join(dir, all.shift())); } catch (e) { break; } }
  return out;
}

function createWindow() {
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#f4f5f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; if (display) display.close(); });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit(); else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // daily automatic backup at start
    try { const dir = defaultBackupDir(); const today = new Date().toISOString().slice(0, 10);
      const has = fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.includes(today));
      if (!has) doBackup('auto'); } catch (e) {}
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { try { doBackup('exit'); } catch (e) {} });
}

ipcMain.handle('db:load', () => { try { return fs.existsSync(dataFile()) ? fs.readFileSync(dataFile(), 'utf8') : null; } catch (e) {
  try { return fs.readFileSync(dataFile() + '.bak', 'utf8'); } catch (e2) { return null; } } });
ipcMain.on('pin:scrypt', (e, pin, salt) => { try { e.returnValue = require('crypto').scryptSync(String(pin), String(salt), 32).toString('hex'); } catch (err) { e.returnValue = null; } });
ipcMain.handle('db:save', (_e, json) => { atomicWrite(dataFile(), json); return true; });
ipcMain.handle('app:info', () => ({ dataFile: dataFile(), version: app.getVersion(), backupDir: defaultBackupDir() }));
ipcMain.handle('backup:now', () => doBackup('manual'));
ipcMain.handle('backup:restore', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Orbit POS backup', extensions: ['json'] }], defaultPath: defaultBackupDir() });
  if (r.canceled || !r.filePaths[0]) return null;
  const text = fs.readFileSync(r.filePaths[0], 'utf8'); const j = JSON.parse(text);
  if (!j || !Array.isArray(j.items) || !j.settings) throw new Error('Not an Orbit POS backup');
  doBackup('before-restore'); return text;
});
ipcMain.handle('dir:choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });

ipcMain.handle('xlsx:open', async () => {
  const XLSX = require('xlsx');
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const wb = XLSX.readFile(r.filePaths[0], { cellDates: true, raw: false, dateNF: 'yyyy-mm-dd' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
  const pad = (n) => String(n).padStart(2, '0');
  const fixed = rows.map((row) => row.map((c) => (c instanceof Date ? c.getFullYear() + '-' + pad(c.getMonth() + 1) + '-' + pad(c.getDate()) : c)));
  return { file: path.basename(r.filePaths[0]), rows: fixed };
});
ipcMain.handle('xlsx:save', async (_e, name, rows, widths) => {
  const XLSX = require('xlsx');
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return null;
  const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); XLSX.writeFile(wb, r.filePath); return r.filePath;
});
ipcMain.handle('print:html', async (_e, html, opts) => {
  opts = opts || {};
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return new Promise((resolve) => {
    w.webContents.print({ silent: !!opts.silent, printBackground: true, margins: { marginType: 'none' } }, (ok, reason) => { w.close(); resolve({ ok, reason }); });
  });
});
ipcMain.handle('display:open', () => {
  if (display && !display.isDestroyed()) { display.focus(); return true; }
  display = new BrowserWindow({ width: 900, height: 600, title: 'Orbit POS', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  display.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); display.webContents.on('will-navigate', (e) => e.preventDefault());
  display.setMenu(null); display.loadFile(path.join(__dirname, 'src', 'display.html'));
  display.on('closed', () => { display = null; }); return true;
});
ipcMain.on('display:update', (_e, payload) => { if (display && !display.isDestroyed()) display.webContents.send('display:data', payload); });
