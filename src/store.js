/* Orbit POS: change tracking for the SQLite store. Pure logic (Node tests + renderer).
   The app keeps its in-memory model; on save we send ONLY the rows that changed since the last successful save. */
(function (root) {
  'use strict';
  const Store = {};
  const COLLS = ['users', 'items', 'customers', 'suppliers', 'promos', 'sales', 'purchases', 'shifts', 'held', 'exchangeReceipts', 'edits', 'audit'];
  const HOT_SALES = 300; // sales are append-mostly: only the newest ones (and ones explicitly marked dirty) are re-checked on each save
  let snap = null;
  const keyOf = (r, i) => (r && r.id != null ? String(r.id) : '#' + i);

  Store.reset = () => { snap = null; };
  Store.markDirty = (db, coll, id) => { (db._dirty = db._dirty || {}); (db._dirty[coll] = db._dirty[coll] || []).push(id); };

  function fullSnapshot(db) {
    const s = { kv: {}, rows: {} };
    for (const k in db) { if (COLLS.includes(k) || k[0] === '_') continue; s.kv[k] = JSON.stringify(db[k]); }
    COLLS.forEach((c) => { s.rows[c] = {}; (db[c] || []).forEach((r, i) => { s.rows[c][keyOf(r, i)] = JSON.stringify(r); }); });
    return s;
  }
  /** call right after load/restore: remember what is on disk */
  Store.prime = (db) => { snap = fullSnapshot(db); };
  /** returns { delta, commit } or null when nothing changed. commit() must be called after the write succeeded. */
  Store.delta = (db) => {
    if (!snap) { snap = { kv: {}, rows: {} }; COLLS.forEach((c) => { snap.rows[c] = {}; }); }
    const d = { kv: {}, up: {}, del: {} }; const nextRows = {}; let n = 0;
    for (const k in db) { if (COLLS.includes(k) || k[0] === '_') continue; const s = JSON.stringify(db[k]); if (snap.kv[k] !== s) { d.kv[k] = s; n++; } }
    COLLS.forEach((c) => {
      const arr = db[c] || []; const old = snap.rows[c] || {}; const dirty = new Set((db._dirty && db._dirty[c]) || []);
      const start = c === 'sales' && Object.keys(old).length ? Math.max(0, arr.length - HOT_SALES) : 0;
      const seen = new Set(); const ups = []; const upMap = {};
      arr.forEach((r, i) => {
        const key = keyOf(r, i); seen.add(key);
        if (c === 'sales' && i < start && !dirty.has(key) && key in old) return;
        const s = JSON.stringify(r); if (old[key] !== s) { ups.push([key, s]); upMap[key] = s; }
      });
      const dels = Object.keys(old).filter((k) => !seen.has(k));
      if (ups.length) { d.up[c] = ups; n += ups.length; } if (dels.length) { d.del[c] = dels; n += dels.length; }
      nextRows[c] = { ups: upMap, dels };
    });
    if (!n) return null;
    return { delta: d, commit() {
      for (const k in d.kv) snap.kv[k] = d.kv[k];
      COLLS.forEach((c) => { const nr = nextRows[c]; Object.assign(snap.rows[c], nr.ups); nr.dels.forEach((k) => { delete snap.rows[c][k]; }); });
      db._dirty = {};
    } };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Store; else root.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
