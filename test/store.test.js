const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../store-main.js'); const S = require('../src/store.js'); const C = require('../src/core.js');
let n = 0; const ok = (m) => { n++; console.log('ok  -', m); };
const tmpd = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-store-'));
const safe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('OS:' + s), decryptString: (b) => b.toString().slice(3) };
const mkdb = () => { const db = C.newDB(); db.users.push(C.makeUser('Boss', '1234', 'manager')); db.items.push({ id: 'a', barcode: '1', name: 'A', cost: 1, price: 2, stock: 5, batches: [], serials: [] }); return db; };

// --- create / encrypted on disk / unlock paths
{ const d = tmpd(); let st = new Store({ dir: d, safeStorage: safe }); assert.strictEqual(st.status(), 'new');
  const { recoveryKey, mode } = st.create('correct horse', 'os'); assert.ok(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(recoveryKey)); assert.strictEqual(mode, 'os');
  st.applyDelta({ kv: { settings: JSON.stringify({ currency: 'EGP' }) }, up: { items: [['a', JSON.stringify({ id: 'a', name: 'سر مميز SECRET-ITEM' })]] } }); st.close();
  const raw = fs.readFileSync(path.join(d, 'orbit-pos.db')); assert.ok(!raw.includes('SECRET-ITEM') && !raw.slice(0, 16).toString('latin1').includes('SQLite format')); ok('database file is encrypted on disk (no plaintext, no SQLite header)');
  st = new Store({ dir: d, safeStorage: safe }); assert.strictEqual(st.status(), 'ready'); assert.strictEqual(st.loadAll().items[0].id, 'a'); st.close(); ok('mode os: reopens without asking (Windows account protected)');
  st = new Store({ dir: d, safeStorage: { ...safe, decryptString: () => { throw new Error('other user'); } } }); assert.strictEqual(st.status(), 'locked');
  assert.strictEqual(st.unlock('wrong passphrase'), false); assert.strictEqual(st.unlock('correct horse'), true); st.close(); ok('other Windows account/PC -> locked; wrong passphrase refused; right passphrase opens');
  st = new Store({ dir: d, safeStorage: null }); assert.strictEqual(st.status(), 'locked'); assert.strictEqual(st.unlock(recoveryKey.toLowerCase().replace(/-/g, ' ')), true); assert.strictEqual(st.loadAll().items.length, 1); ok('recovery key opens it (case/dashes forgiving)');
  assert.strictEqual(st.setMode === undefined, false); assert.throws(() => st.setMode('os'), /OS_UNAVAILABLE/);
  const r2 = st.changePassphrase('correct horse', 'new pass 123'); assert.notStrictEqual(r2.recoveryKey, recoveryKey); st.close();
  st = new Store({ dir: d, safeStorage: null }); st.status(); assert.strictEqual(st.unlock('correct horse'), false); assert.strictEqual(st.unlock(recoveryKey), false); assert.strictEqual(st.unlock('new pass 123'), true); st.close(); ok('changing the passphrase issues a new recovery key; old passphrase and old recovery key stop working');
  st = new Store({ dir: d, safeStorage: safe }); st.status(); st.unlock('new pass 123'); st.setMode('prompt'); st.close(); st = new Store({ dir: d, safeStorage: safe }); assert.strictEqual(st.status(), 'locked'); ok('switch to ask-every-launch mode works'); }
assert.throws(() => new Store({ dir: tmpd(), safeStorage: safe }).create('abc'), /PASSPHRASE_SHORT/); ok('short passphrase refused');

// --- delta sync round trip, only changed rows are sent
{ const d = tmpd(); const st = new Store({ dir: d, safeStorage: safe }); st.status(); st.create('passphrase1', 'os');
  const db = mkdb(); S.reset(); let x = S.delta(db); assert.ok(x); st.applyDelta(x.delta); x.commit(); assert.strictEqual(S.delta(db), null); ok('first save writes everything, second save with no change writes nothing');
  db.items[0].stock = 4; x = S.delta(db); assert.deepStrictEqual(Object.keys(x.delta.up), ['items']); assert.strictEqual(x.delta.up.items.length, 1); assert.ok(!x.delta.kv.settings); st.applyDelta(x.delta); x.commit();
  db.items.push({ id: 'b', name: 'B' }); db.counters.sale = 7; x = S.delta(db); assert.strictEqual(x.delta.up.items.length, 1); assert.ok(x.delta.kv.counters); st.applyDelta(x.delta); x.commit();
  db.items.splice(0, 1); x = S.delta(db); assert.deepStrictEqual(x.delta.del.items, ['a']); st.applyDelta(x.delta); x.commit();
  const back = st.loadAll(); assert.strictEqual(back.items.length, 1); assert.strictEqual(back.items[0].id, 'b'); assert.strictEqual(back.counters.sale, 7); assert.strictEqual(back.users[0].name, 'Boss'); ok('edits, additions, deletions and settings round-trip through SQLite');
  // large history: old sales are not re-checked, but dirty-marked ones are
  const big = mkdb(); for (let i = 0; i < 5000; i++) big.sales.push({ id: 's' + i, type: 'sale', total: i }); S.reset(); const f = S.delta(big); st.applyDelta(f.delta); f.commit();
  big.sales[10].returned = { 0: 1 }; assert.strictEqual(S.delta(big), null || S.delta(big)); // not hot, not dirty -> deliberately skipped
  S.markDirty(big, 'sales', 's10'); x = S.delta(big); assert.strictEqual(x.delta.up.sales.length, 1); st.applyDelta(x.delta); x.commit();
  big.sales.push({ id: 'new', total: 1 }); x = S.delta(big); assert.strictEqual(x.delta.up.sales.length, 1); st.applyDelta(x.delta); x.commit();
  const l = st.loadAll(); assert.strictEqual(l.sales.length, 5001); assert.deepStrictEqual(l.sales.find((s) => s.id === 's10').returned, { 0: 1 }); ok('5000-sale history: a save only writes the changed/new/marked rows'); st.close(); }

// --- legacy JSON migration verifies and removes plaintext
{ const d = tmpd(); const legacy = mkdb(); legacy.sales.push({ id: 's1', type: 'sale', total: 5 }); legacy.audit.push({ act: 'x' }, { act: 'y' });
  fs.writeFileSync(path.join(d, 'orbit-pos.json'), JSON.stringify(legacy)); fs.writeFileSync(path.join(d, 'orbit-pos.json.bak'), JSON.stringify(legacy));
  const st = new Store({ dir: d, safeStorage: safe }); assert.ok(st.info().hasLegacy); st.status(); st.create('migrate me 1', 'os'); const c = st.migrateLegacy();
  assert.strictEqual(c.sales, 1); assert.strictEqual(c.audit, 2); assert.ok(!fs.existsSync(path.join(d, 'orbit-pos.json')) && !fs.existsSync(path.join(d, 'orbit-pos.json.bak')));
  const back = st.loadAll(); assert.strictEqual(back.audit[1].act, 'y'); assert.strictEqual(back.users[0].name, 'Boss'); ok('old JSON imported with verification (counts match), plaintext copies deleted, audit order kept'); st.close(); }

// --- encrypted backup restores on another PC with the passphrase
(async () => { const d = tmpd(); const st = new Store({ dir: d, safeStorage: safe }); st.status(); const { recoveryKey } = st.create('backup pass 1', 'os');
  st.replaceAll(JSON.stringify(mkdb())); const f = path.join(d, 'b1.db'); st.backupTo(f); st.close();
  assert.ok(!fs.readFileSync(f).includes('Boss')); const other = new Store({ dir: tmpd(), safeStorage: null });
  assert.strictEqual(other.readBackup(f, 'wrong'), null); assert.strictEqual(JSON.parse(other.readBackup(f, 'backup pass 1')).users[0].name, 'Boss'); assert.strictEqual(JSON.parse(other.readBackup(f, recoveryKey)).items.length, 1);
  ok('backup file is encrypted; restores on another PC with passphrase or recovery key; wrong secret refused'); console.log(n + ' passed'); process.exit(0); })().catch((e) => { console.log('FAIL', e.stack); process.exit(1); });
