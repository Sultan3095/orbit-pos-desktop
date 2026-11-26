'use strict';
// Encrypted SQLite data store (main process). Key model:
//  - a random 32-byte data key K encrypts the database (SQLite3 Multiple Ciphers, sqlcipher scheme)
//  - K is wrapped three ways in keystore.json: by the passphrase, by the recovery key, and (mode 'os') by the Windows account (safeStorage/DPAPI)
//  - backups are encrypted copies of the same database plus a sidecar with the passphrase/recovery wraps, so they restore on any PC
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const COLLS = ['users', 'items', 'customers', 'suppliers', 'promos', 'sales', 'purchases', 'shifts', 'held', 'exchangeReceipts', 'edits', 'giftCards', 'coupons', 'audit'];

const b32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRecoveryKey() { // 160 bits as 32 chars from a 32-letter alphabet, shown as 8 groups of 4
  const bytes = crypto.randomBytes(20); let bits = ''; for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = ''; for (let i = 0; i < 160; i += 5) out += b32[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join('-');
}
const normSecret = (s) => String(s || '').normalize('NFKC').trim();
const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const kdf = (secret, salt) => crypto.scryptSync(secret, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
function wrap(K, secret) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', kdf(secret, salt), iv);
  const ct = Buffer.concat([c.update(K), c.final()]);
  return { salt: salt.toString('hex'), iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), ct: ct.toString('hex') };
}
function unwrap(w, secret) {
  try { const d = crypto.createDecipheriv('aes-256-gcm', kdf(secret, Buffer.from(w.salt, 'hex')), Buffer.from(w.iv, 'hex')); d.setAuthTag(Buffer.from(w.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(w.ct, 'hex')), d.final()]); } catch (e) { return null; }
}

class Store {
  constructor(opts) { this.dir = opts.dir; this.safe = opts.safeStorage || null; this.Database = opts.Database || require('better-sqlite3-multiple-ciphers'); this.db = null; this.K = null; this.ks = null; }
  get keyFile() { return path.join(this.dir, 'keystore.json'); }
  get dbFile() { return path.join(this.dir, 'orbit-pos.db'); }
  osAvailable() { try { return !!(this.safe && this.safe.isEncryptionAvailable()); } catch (e) { return false; } }
  readKs() { try { return JSON.parse(fs.readFileSync(this.keyFile, 'utf8')); } catch (e) { return null; } }
  writeKs() { const tmp = this.keyFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.ks)); fs.renameSync(tmp, this.keyFile); }
  legacyJson() { const f = path.join(this.dir, 'orbit-pos.json'); return fs.existsSync(f) ? f : null; }

  /** 'new' (no keystore yet), 'locked' (needs passphrase/recovery key), 'ready' */
  status() {
    if (this.db) return 'ready';
    const ks = this.readKs(); if (!ks) return 'new';
    this.ks = ks;
    if (ks.mode === 'os' && ks.os && this.osAvailable()) { try { const K = Buffer.from(this.safe.decryptString(Buffer.from(ks.os, 'base64')), 'hex'); if (this.open(K)) return 'ready'; } catch (e) {} }
    return 'locked';
  }
  info() { const st = this.status(); const ks = this.ks; return { status: st, mode: ks ? ks.mode : null, osAvailable: this.osAvailable(), hasLegacy: !!this.legacyJson() }; }

  open(K) {
    const db = new this.Database(this.dbFile);
    try { db.pragma("cipher='sqlcipher'"); db.pragma("hexkey='" + K.toString('hex') + "'"); db.prepare('select count(*) c from sqlite_master').get(); }
    catch (e) { try { db.close(); } catch (e2) {} return false; }
    db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL');
    db.exec('create table if not exists kv(k text primary key, v text not null); create table if not exists rows(coll text not null, id text not null, data text not null, primary key(coll,id)) without rowid;');
    this.db = db; this.K = K; return true;
  }
  /** First run: pick the passphrase, create the key, return the recovery key (shown once). mode: 'os' (default when available) or 'prompt'. */
  create(passphrase, mode) {
    const p = normSecret(passphrase); if (p.length < 6) throw new Error('PASSPHRASE_SHORT');
    if (this.readKs()) throw new Error('ALREADY_SETUP');
    if (fs.existsSync(this.dbFile)) throw new Error('DB_EXISTS_WITHOUT_KEYS');
    const K = crypto.randomBytes(32); const rec = newRecoveryKey();
    const useOs = mode !== 'prompt' && this.osAvailable();
    this.ks = { v: 1, mode: useOs ? 'os' : 'prompt', wrapP: wrap(K, p), wrapR: wrap(K, normRecovery(rec)) };
    if (useOs) this.ks.os = this.safe.encryptString(K.toString('hex')).toString('base64');
    this.writeKs();
    if (!this.open(K)) throw new Error('OPEN_FAILED');
    return { recoveryKey: rec, mode: this.ks.mode };
  }
  /** secret = passphrase or recovery key */
  unlock(secret) {
    const ks = this.ks || this.readKs(); if (!ks) throw new Error('NO_KEYSTORE'); this.ks = ks;
    let K = unwrap(ks.wrapP, normSecret(secret)); if (!K) K = unwrap(ks.wrapR, normRecovery(secret));
    if (!K || !this.open(K)) return false;
    if (ks.mode === 'os' && this.osAvailable()) { ks.os = this.safe.encryptString(K.toString('hex')).toString('base64'); this.writeKs(); } // new PC / new Windows account: re-bind
    return true;
  }
  setMode(mode) { // 'os' | 'prompt'
    if (!this.db) throw new Error('LOCKED');
    if (mode === 'os') { if (!this.osAvailable()) throw new Error('OS_UNAVAILABLE'); this.ks.os = this.safe.encryptString(this.K.toString('hex')).toString('base64'); this.ks.mode = 'os'; }
    else { delete this.ks.os; this.ks.mode = 'prompt'; }
    this.writeKs(); return this.ks.mode;
  }
  /** change passphrase (needs the current one) and issue a NEW recovery key */
  changePassphrase(oldP, newP) {
    if (!this.db) throw new Error('LOCKED');
    if (!unwrap(this.ks.wrapP, normSecret(oldP))) throw new Error('WRONG_PASSPHRASE');
    const p = normSecret(newP); if (p.length < 6) throw new Error('PASSPHRASE_SHORT');
    const rec = newRecoveryKey(); this.ks.wrapP = wrap(this.K, p); this.ks.wrapR = wrap(this.K, normRecovery(rec)); this.writeKs(); return { recoveryKey: rec };
  }

  // ---------- data ----------
  isEmpty() { return !this.db.prepare("select 1 from kv where k='settings'").get(); }
  loadAll() {
    const out = {};
    for (const r of this.db.prepare('select k, v from kv').iterate()) out[r.k] = JSON.parse(r.v);
    for (const c of COLLS) out[c] = [];
    const tmp = {};
    for (const r of this.db.prepare('select coll, id, data from rows').iterate()) (tmp[r.coll] = tmp[r.coll] || []).push([r.id, r.data]);
    const num = (id) => (id[0] === '#' ? parseInt(id.slice(1), 10) : null);
    for (const c in tmp) {
      const arr = tmp[c];
      if (arr.some((x) => num(x[0]) !== null)) arr.sort((a, b) => (num(a[0]) || 0) - (num(b[0]) || 0)); // rows without ids keep their order
      out[c] = arr.map((x) => JSON.parse(x[1]));
    }
    return out;
  }
  /** delta: { kv:{k:jsonString}, up:{coll:[[id, jsonString]]}, del:{coll:[id]} } applied atomically */
  applyDelta(d) {
    const tx = this.db.transaction(() => {
      const kv = this.db.prepare('insert into kv(k,v) values(?,?) on conflict(k) do update set v=excluded.v');
      const up = this.db.prepare('insert into rows(coll,id,data) values(?,?,?) on conflict(coll,id) do update set data=excluded.data');
      const del = this.db.prepare('delete from rows where coll=? and id=?');
      for (const k in (d.kv || {})) kv.run(k, d.kv[k]);
      for (const c in (d.up || {})) for (const [id, data] of d.up[c]) up.run(c, String(id), data);
      for (const c in (d.del || {})) for (const id of d.del[c]) del.run(c, String(id));
    }); tx(); return true;
  }
  replaceAll(jsonText) { // used by migration and restore: whole model in, atomically
    const j = JSON.parse(jsonText); const tx = this.db.transaction(() => {
      this.db.exec('delete from kv; delete from rows;');
      const kv = this.db.prepare('insert into kv(k,v) values(?,?)'); const ins = this.db.prepare('insert into rows(coll,id,data) values(?,?,?)');
      for (const k in j) { if (COLLS.includes(k) || k[0] === '_') continue; kv.run(k, JSON.stringify(j[k])); }
      for (const c of COLLS) (j[c] || []).forEach((r, i) => ins.run(c, r && r.id != null ? String(r.id) : '#' + i, JSON.stringify(r)));
    }); tx();
  }
  /** import a legacy plaintext JSON database once; the plaintext files are removed only after the import is verified */
  migrateLegacy() {
    const f = this.legacyJson(); if (!f || !this.isEmpty()) return null;
    let text, orig; try { text = fs.readFileSync(f, 'utf8'); orig = JSON.parse(text); if (!orig || !Array.isArray(orig.items) || !orig.settings) return null; } catch (e) { return null; }
    this.replaceAll(text); const back = this.loadAll();
    const ok = COLLS.every((c) => (orig[c] || []).length === back[c].length) && JSON.stringify(orig.settings) === JSON.stringify(back.settings);
    if (!ok) { this.db.exec('delete from kv; delete from rows;'); throw new Error('MIGRATION_VERIFY_FAILED'); }
    const counts = {}; COLLS.forEach((c) => { counts[c] = back[c].length; });
    for (const x of [f, f + '.bak', f + '.tmp']) { try { fs.unlinkSync(x); } catch (e) {} }
    return counts;
  }
  /** encrypted backup copy + sidecar so it restores on another PC with the passphrase/recovery key */
  backupTo(file) {
    try { fs.unlinkSync(file); } catch (e) {}
    this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'"); // keeps the same encryption key
    fs.writeFileSync(file + '.keys.json', JSON.stringify({ v: 1, wrapP: this.ks.wrapP, wrapR: this.ks.wrapR }));
    return file;
  }
  /** open a backup with a secret and return its model as JSON text (does not touch the live DB); null = wrong secret */
  readBackup(file, secret) {
    const side = JSON.parse(fs.readFileSync(file + '.keys.json', 'utf8'));
    let K = unwrap(side.wrapP, normSecret(secret)); if (!K) K = unwrap(side.wrapR, normRecovery(secret)); if (!K) return null;
    const db = new this.Database(file, { readonly: true });
    try { db.pragma("cipher='sqlcipher'"); db.pragma("hexkey='" + K.toString('hex') + "'");
      const tmp = new Store({ dir: this.dir, safeStorage: null, Database: this.Database }); tmp.db = db; return JSON.stringify(tmp.loadAll()); }
    catch (e) { return null; } finally { try { db.close(); } catch (e) {} }
  }
  close() { try { if (this.db) { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close(); } } catch (e) {} this.db = null; }
}
module.exports = { Store, COLLS, newRecoveryKey };
