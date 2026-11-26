const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.env.ORBIT_USER_DATA) app.setPath('userData', process.env.ORBIT_USER_DATA);
let win = null, display = null;
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'orbit-pos.json');
const defaultBackupDir = () => path.join(dataDir(), 'backups');

const { Store } = require('./store-main.js');
let store = null;
const getStore = () => store || (store = new Store({ dir: dataDir(), safeStorage }));
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
function backupDir() { try { const st = getStore(); if (st.db) { const r = st.db.prepare("select v from kv where k='settings'").get(); const d = r && JSON.parse(r.v).backupDir; if (d && fs.existsSync(d)) return d; } } catch (e) {} return defaultBackupDir(); }
// encrypted backup (same key, restorable on another PC with the passphrase/recovery key); keeps the newest 40
function doBackup(tag) {
  const st = getStore(); if (!st.db) return null;
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'orbit-pos-' + stamp() + (tag ? '-' + tag : '') + '.db'); st.backupTo(out);
  const all = fs.readdirSync(dir).filter((n) => /^orbit-pos-.*\.db$/.test(n)).sort();
  while (all.length > 40) { const o = all.shift(); for (const x of [o, o + '.keys.json']) { try { fs.unlinkSync(path.join(dir, x)); } catch (e) { } } }
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
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { try { doBackup('exit'); } catch (e) {} try { getStore().close(); } catch (e) {} });
}

ipcMain.on('pin:scrypt', (e, pin, salt) => { try { e.returnValue = require('crypto').scryptSync(String(pin), String(salt), 32).toString('hex'); } catch (err) { e.returnValue = null; } });
const needDb = () => { const st = getStore(); if (!st.db) throw new Error('LOCKED'); return st; };
ipcMain.handle('store:info', () => getStore().info());
ipcMain.handle('store:create', (_e, pass, mode) => { const st = getStore(); const r = st.create(pass, mode); r.migrated = st.migrateLegacy(); return r; });
ipcMain.handle('store:unlock', (_e, secret) => { const st = getStore(); const ok = st.unlock(secret); if (ok) st.migrateLegacy(); return ok; });
ipcMain.handle('store:setMode', (_e, mode) => needDb().setMode(mode));
ipcMain.handle('store:changePass', (_e, o, n) => needDb().changePassphrase(o, n));
let autoDone = false;
function autoBackup() { if (autoDone) return; autoDone = true; try { const dir = backupDir(); const today = new Date().toISOString().slice(0, 10); if (!(fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.includes(today) && n.endsWith('.db')))) doBackup('auto'); } catch (e) {} }
ipcMain.handle('db:load', () => { const st = needDb(); try { st.migrateLegacy(); } catch (e) { throw new Error('MIGRATION_FAILED'); } const out = st.isEmpty() ? null : JSON.stringify(st.loadAll()); setTimeout(autoBackup, 3000); return out; });
ipcMain.handle('db:delta', (_e, d) => needDb().applyDelta(d));
ipcMain.on('db:deltaSync', (e, d) => { try { needDb().applyDelta(d); e.returnValue = true; } catch (err) { e.returnValue = false; } });
ipcMain.handle('db:replaceAll', (_e, text) => { const st = needDb(); doBackup('before-restore'); st.replaceAll(text); return true; });
ipcMain.handle('app:info', () => ({ dataFile: getStore().dbFile, version: app.getVersion(), backupDir: defaultBackupDir() }));
ipcMain.handle('backup:age', () => { try { const dir = backupDir(); const t = fs.readdirSync(dir).filter((n) => /^orbit-pos-.*\.db$/.test(n)).map((n) => fs.statSync(path.join(dir, n)).mtimeMs); return t.length ? (Date.now() - Math.max(...t)) / 86400e3 : null; } catch (e) { return null; } });
ipcMain.handle('backup:now', () => doBackup('manual'));
ipcMain.handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Orbit POS backup', extensions: ['db', 'json'] }], defaultPath: backupDir() });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
// .db = encrypted backup, needs the passphrase/recovery key; .json = old plaintext backup from before encryption
ipcMain.handle('backup:read', (_e, file, secret) => {
  needDb();
  if (/\.json$/i.test(file)) { const text = fs.readFileSync(file, 'utf8'); const j = JSON.parse(text); if (!j || !Array.isArray(j.items) || !j.settings) throw new Error('Not an Orbit POS backup'); return text; }
  const text = getStore().readBackup(file, secret); if (!text) throw new Error('WRONG_SECRET'); return text;
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
// ---- ESC/POS raster printing: the receipt page is rendered to a bitmap and sent as GS v 0 ----
const ESCPOS = require('./escpos.js');
async function renderMono(html, widthMm) {
  const dots = ESCPOS.dotsFor(widthMm); const bodyMm = Number(widthMm) === 58 ? 54 : 76; const z = dots / (bodyMm * 3.7795);
  const w = new BrowserWindow({ show: false, width: dots, height: 800, useContentSize: true, webPreferences: { sandbox: true, offscreen: false } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); w.webContents.setZoomFactor(z); await new Promise((r) => setTimeout(r, 250));
    const h = Math.ceil((await w.webContents.executeJavaScript('document.documentElement.scrollHeight')) * z) + 4;
    w.setContentSize(dots, Math.min(h, 16000)); await new Promise((r) => setTimeout(r, 250));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: dots, height: Math.min(h, 16000) }); const sz = img.getSize();
    return ESCPOS.toMono(img.toBitmap(), sz.width, sz.height);
  } finally { w.close(); }
}
ipcMain.handle('print:raw', async (_e, html, profile, o) => {
  try { const mono = await renderMono(html, profile.width); await ESCPOS.send(profile, ESCPOS.receiptJob(mono, { drawer: !!(o && o.drawer), drawerPin: profile.drawerPin, cut: profile.cut !== false })); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
});
ipcMain.handle('printer:drawer', async (_e, profile) => {
  try { await ESCPOS.send(profile, Buffer.concat([ESCPOS.init(), ESCPOS.drawerKick(profile.drawerPin)])); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
});
ipcMain.handle('display:open', () => {
  if (display && !display.isDestroyed()) { display.focus(); return true; }
  display = new BrowserWindow({ width: 900, height: 600, title: 'Orbit POS', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  display.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); display.webContents.on('will-navigate', (e) => e.preventDefault());
  display.setMenu(null); display.loadFile(path.join(__dirname, 'src', 'display.html'));
  display.on('closed', () => { display = null; }); return true;
});
ipcMain.on('display:update', (_e, payload) => { if (display && !display.isDestroyed()) display.webContents.send('display:data', payload); });
