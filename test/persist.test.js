// main-process persistence: corrupt/truncated data file must fall back to .bak / backups, never start empty over real data
const Module = require('module'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-persist-')); const handlers = {};
const fake = { app: { setPath() {}, getPath: () => tmp, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {}, quit() {}, getVersion: () => '0' },
  BrowserWindow: function () {}, Menu: { setApplicationMenu() {} }, dialog: {}, ipcMain: { handle: (n, f) => { handlers[n] = f; }, on: (n, f) => { handlers['on:' + n] = f; }, removeHandler() {} } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
require('../main.js'); Module._load = orig;
const good = (n) => JSON.stringify({ items: [{ id: n }], settings: {} }); const f = path.join(tmp, 'orbit-pos.json');
let n = 0; const ok = (m) => { n++; console.log('ok  -', m); };
assert.strictEqual(handlers['db:load'](), null); ok('no data yet -> null (fresh install)');
handlers['db:save']({}, good(1)); handlers['db:save']({}, good(2)); assert.ok(JSON.parse(handlers['db:load']()).items[0].id === 2); ok('normal save/load');
fs.writeFileSync(f, '{"items":[{"id":3'); // truncated by a crash/power cut
assert.strictEqual(JSON.parse(handlers['db:load']()).items[0].id, 1); ok('truncated main file -> falls back to .bak (last good)');
handlers['db:save']({}, good(4)); assert.strictEqual(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')).items[0].id, 1); ok('saving over a corrupt file does not overwrite the good .bak');
fs.writeFileSync(f, 'garbage'); fs.writeFileSync(f + '.bak', 'garbage'); fs.mkdirSync(path.join(tmp, 'backups'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'backups', 'orbit-pos-2026-01-01-00-00-00.json'), good(9));
assert.strictEqual(JSON.parse(handlers['db:load']()).items[0].id, 9); ok('both corrupt -> newest valid backup');
fs.writeFileSync(f, 'garbage'); fs.writeFileSync(f + '.bak', 'garbage'); fs.rmSync(path.join(tmp, 'backups'), { recursive: true });
assert.throws(() => handlers['db:load'](), /DATA_FILE_UNREADABLE/); ok('nothing readable -> explicit error, not a silent empty DB');
console.log(n + ' passed'); process.exit(0);
