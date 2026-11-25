/* Orbit POS core: pure logic (no DOM, no Electron). Runs in Node (tests) and in the renderer. */
(function (root) {
  'use strict';
  const Core = {};

  const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  Core.r2 = r2;

  // ---------- helpers ----------
  Core.normDigits = function (s) {
    if (s == null) return '';
    return String(s)
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
      .replace(/\u066B/g, '.')
      .replace(/\u066C/g, ',');
  };
  Core.num = function (v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const s = Core.normDigits(v).replace(/,/g, '').trim();
    if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  };
  Core.uid = function (p) {
    return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  Core.today = function (d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  Core.isoDate = function (v) {
    // returns YYYY-MM-DD or '' or null (invalid)
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? null : Core.today(v);
    const s = Core.normDigits(v).trim();
    let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return Core.today(dt);
  };

  // ---------- defaults ----------
  Core.defaultSettings = function () {
    return {
      storeName: 'My Store', storeAddress: '', storePhone: '', taxNumber: '', receiptFooter: '',
      currency: 'EGP', numerals: 'western', lang: 'ar', receiptLang: 'ar', theme: 'light', accent: '',
      taxRate: 14, pricesIncludeTax: true,
      returnDays: 14, managerBypassReturnWindow: true,
      maxCashierDiscountPct: 10, // above this the cashier needs manager approval
      costMethod: 'average', // 'average' | 'last'
      receiptWidth: 80, autoPrint: false,
      loyaltyEnabled: false, loyaltyEarnPerCurrency: 10, loyaltyPointValue: 0.5,
      slowDays: 30, lowStockDefault: 5, expiryWarnDays: 30,
      scaleMode: 'manual', scalePrefix: '2', // weight barcode prefix
      backupDir: '', allowNegativeStock: false,
    };
  };
  Core.newDB = function () {
    return {
      version: 1, settings: Core.defaultSettings(),
      users: [], items: [], customers: [], suppliers: [], promos: [],
      sales: [], purchases: [], shifts: [], held: [], audit: [],
      counters: { sale: 0, purchase: 0, ret: 0, exr: 0 }, exchangeReceipts: [],
    };
  };

  // ---------- users / PIN ----------
  Core.hashPin = function (pin, salt) {
    // small sync hash (FNV-1a x2). Local app PIN, not a network credential.
    const str = salt + ':' + pin;
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  };
  // scrypt (memory-hard) is provided by the host: Node crypto in tests, the main process in the app.
  const scryptHex = (pin, salt) => {
    try {
      if (typeof require === 'function') { const c = require('crypto'); return c.scryptSync(String(pin), String(salt), 32).toString('hex'); }
      if (root.api && root.api.scrypt) return root.api.scrypt(String(pin), String(salt));
    } catch (e) {}
    return null;
  };
  const newSalt = () => {
    try { if (typeof require === 'function') return require('crypto').randomBytes(16).toString('hex'); } catch (e) {}
    if (root.crypto && root.crypto.getRandomValues) { const a = new Uint8Array(16); root.crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''); }
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  };
  Core.makeUser = function (name, pin, role) {
    const salt = newSalt(); const h = scryptHex(pin, salt);
    return { id: Core.uid('u'), name, role: role || 'cashier', salt, pinHash: h ? 's1$' + h : Core.hashPin(pin, salt), active: true };
  };
  Core.checkPin = function (user, pin) {
    if (!user || user.active === false) return false;
    if (String(user.pinHash).startsWith('s1$')) { const h = scryptHex(pin, user.salt); return !!h && 's1$' + h === user.pinHash; }
    if (Core.hashPin(pin, user.salt) !== user.pinHash) return false;
    const h = scryptHex(pin, user.salt); if (h) user.pinHash = 's1$' + h; // upgrade the old weak hash on first good login
    return true;
  };

  // ---------- promotions ----------
  // promo: {id,name,active,type,scope:{type:'all'|'item'|'group',value},params,start,end,days,stackable,priority}
  // types: percent, amount (per unit), bxgy (buy X get Y at getPct% off, default free), bundle (qty for fixed price), invoice_pct, invoice_amt
  Core.promoActive = function (p, now) {
    if (!p || p.active === false) return false;
    const d = Core.today(now || new Date());
    if (p.start && d < p.start) return false;
    if (p.end && d > p.end) return false;
    if (p.days && p.days.length && p.days.indexOf((now || new Date()).getDay()) < 0) return false;
    return true;
  };
  function inScope(p, line) {
    const s = p.scope || { type: 'all' };
    if (s.type === 'all') return true;
    if (s.type === 'item') return line.itemId === s.value;
    if (s.type === 'group') return (line.group || '') === s.value;
    return false;
  }
  // returns array of per-line discount (currency) for one item-level promo
  function promoVector(p, lines) {
    const out = lines.map(() => 0);
    const elig = [];
    lines.forEach((l, i) => { if (!l.noPromo && l.qty > 0 && inScope(p, l)) elig.push(i); });
    if (!elig.length) return out;
    const pr = p.params || {};
    if (p.type === 'percent') {
      elig.forEach((i) => { out[i] = r2(lines[i].qty * lines[i].price * (pr.percent || 0) / 100); });
    } else if (p.type === 'amount') {
      elig.forEach((i) => { out[i] = r2(Math.min(lines[i].price, pr.amount || 0) * lines[i].qty); });
    } else if (p.type === 'bxgy') {
      const buy = Math.max(1, Math.floor(pr.buy || 1)), get = Math.max(1, Math.floor(pr.get || 1));
      const getPct = pr.getPct == null ? 100 : pr.getPct;
      // pool units across eligible lines (fractional qty from weighed items: use whole units only)
      const units = [];
      elig.forEach((i) => {
        const whole = Math.floor(lines[i].qty + 1e-9);
        for (let k = 0; k < whole; k++) units.push({ i, price: lines[i].price });
      });
      const cycles = Math.floor(units.length / (buy + get));
      let freeCount = cycles * get;
      units.sort((a, b) => a.price - b.price); // cheapest units are the discounted ones
      for (let k = 0; k < freeCount; k++) out[units[k].i] = r2(out[units[k].i] + units[k].price * getPct / 100);
    } else if (p.type === 'bundle') {
      const q = Math.max(1, Math.floor(pr.qty || 1));
      const units = [];
      elig.forEach((i) => {
        const whole = Math.floor(lines[i].qty + 1e-9);
        for (let k = 0; k < whole; k++) units.push({ i, price: lines[i].price });
      });
      units.sort((a, b) => b.price - a.price);
      const bundles = Math.floor(units.length / q);
      for (let b = 0; b < bundles; b++) {
        const grp = units.slice(b * q, b * q + q);
        const regular = grp.reduce((s, u) => s + u.price, 0);
        const off = Math.max(0, r2(regular - (pr.price || 0)));
        let given = 0; grp.forEach((u, k) => { const part = k === grp.length - 1 ? r2(off - given) : r2(off * (u.price / regular)); given = r2(given + part); out[u.i] = r2(out[u.i] + part); });
      }
    }
    return out;
  }

  /**
   * lines: [{itemId, group, qty, price, manualPct, manualAmt, noPromo}]
   * Returns {lines:[{...,gross,promoDisc,promoNames,manualDisc,net}], subtotal, invoicePromoDisc, invoicePromoNames}
   * Rules: manual line discount replaces promotions on that line. Non-stackable promos: best one per line wins.
   * Stackable promos apply on top (percent/amount on what remains).
   */
  Core.applyPromotions = function (lines, promos, now) {
    const act = (promos || []).filter((p) => Core.promoActive(p, now));
    const L = lines.map((l) => {
      const gross = r2(l.qty * l.price);
      const hasManual = (l.manualPct > 0) || (l.manualAmt > 0);
      const manualDisc = hasManual ? r2(Math.min(gross, (l.manualAmt || 0) + gross * (l.manualPct || 0) / 100)) : 0;
      return Object.assign({}, l, { gross, manualDisc, promoDisc: 0, promoNames: [], noPromo: l.noPromo || hasManual });
    });
    const itemPromos = act.filter((p) => p.type !== 'invoice_pct' && p.type !== 'invoice_amt')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const best = L.map(() => ({ d: 0, name: null }));
    const stack = L.map(() => ({ d: 0, names: [] }));
    itemPromos.forEach((p) => {
      const v = promoVector(p, L);
      v.forEach((d, i) => {
        if (d <= 0) return;
        if (p.stackable) { stack[i].d = r2(stack[i].d + d); stack[i].names.push(p.name); }
        else if (d > best[i].d) best[i] = { d, name: p.name };
      });
    });
    L.forEach((l, i) => {
      let d = best[i].d, names = best[i].name ? [best[i].name] : [];
      d = r2(d + stack[i].d); names = names.concat(stack[i].names);
      l.promoDisc = r2(Math.min(l.gross, d)); l.promoNames = names;
      l.net = r2(l.gross - l.promoDisc - l.manualDisc);
    });
    const subtotal = r2(L.reduce((s, l) => s + l.net, 0));
    // invoice-level promos
    let invD = 0, invNames = [], bestInv = { d: 0, name: null };
    act.filter((p) => p.type === 'invoice_pct' || p.type === 'invoice_amt').forEach((p) => {
      const pr = p.params || {};
      if (pr.minTotal && subtotal < pr.minTotal) return;
      const d = p.type === 'invoice_pct' ? r2(subtotal * (pr.percent || 0) / 100) : r2(Math.min(subtotal, pr.amount || 0));
      if (p.stackable) { invD = r2(invD + d); invNames.push(p.name); }
      else if (d > bestInv.d) bestInv = { d, name: p.name };
    });
    if (bestInv.name) { invD = r2(invD + bestInv.d); invNames.push(bestInv.name); }
    return { lines: L, subtotal, invoicePromoDisc: Math.min(subtotal, invD), invoicePromoNames: invNames };
  };

  /**
   * Full cart totals. cart: {lines, invPct, invAmt, customerPoints redeem}
   * Allocates invoice-level discounts proportionally to lines, computes tax per line.
   */
  Core.computeCart = function (cart, promos, settings, now) {
    const pr = Core.applyPromotions(cart.lines, promos, now);
    const subtotal = pr.subtotal;
    const manualInv = r2(Math.min(subtotal, (cart.invAmt || 0) + subtotal * (cart.invPct || 0) / 100));
    const redeem = r2(Math.min(Math.max(0, subtotal - manualInv - pr.invoicePromoDisc), cart.redeemValue || 0));
    const invDisc = r2(Math.min(subtotal, manualInv + pr.invoicePromoDisc + redeem));
    const rate = (settings.taxRate || 0) / 100;
    let alloc = 0;
    const lines = pr.lines.map((l, idx) => {
      let share = 0;
      if (subtotal > 0) {
        share = idx === pr.lines.length - 1 ? r2(invDisc - alloc) : r2(invDisc * l.net / subtotal);
        alloc = r2(alloc + share);
      }
      const base = r2(l.net - share); // value after every discount
      const taxable = !l.taxExempt;
      let tax = 0, total;
      if (settings.pricesIncludeTax) { total = base; tax = taxable ? r2(base - base / (1 + rate)) : 0; }
      else { tax = taxable ? r2(base * rate) : 0; total = r2(base + tax); }
      return Object.assign({}, l, { invShare: share, tax, total });
    });
    const total = r2(lines.reduce((s, l) => s + l.total, 0));
    const tax = r2(lines.reduce((s, l) => s + l.tax, 0));
    return {
      lines, gross: r2(lines.reduce((s, l) => s + l.gross, 0)),
      lineDisc: r2(lines.reduce((s, l) => s + l.promoDisc + l.manualDisc, 0)),
      invoiceDisc: invDisc, redeemValue: redeem, invoicePromoNames: pr.invoicePromoNames,
      subtotal, tax, total, net: r2(total - tax),
    };
  };

  // ---------- stock ----------
  Core.availableQty = function (item) { return item.stock || 0; };
  function fefoAllocate(item, qty) {
    // returns [{batch,expiry,qty}] taken from item.batches (earliest expiry first); remainder without batch
    const out = [];
    if (!item.batchTracked || !item.batches) return out;
    let need = qty;
    const bs = item.batches.filter((b) => b.qty > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
    for (const b of bs) {
      if (need <= 0) break;
      const t = Math.min(b.qty, need);
      out.push({ batch: b.batch, expiry: b.expiry || '', qty: t });
      need = r2(need - t);
    }
    return out;
  }
  Core.fefoAllocate = fefoAllocate;

  // ---------- exchange receipts (credit notes) ----------
  Core.addDays = function (iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return Core.today(d); };
  /** Valid-until date from the exchange window setting (returnDays). '' = no limit (window 0). */
  Core.creditExpiry = function (issued, days) { return days > 0 ? Core.addDays(issued, days) : ''; };
  Core.creditExpired = function (rec, now) { return !!rec.expiresOn && Core.today(now || new Date()) > rec.expiresOn; };
  Core.issueExchangeReceipt = function (db, amount, info, now) {
    now = now || new Date(); db.exchangeReceipts = db.exchangeReceipts || [];
    db.counters.exr = (db.counters.exr || 0) + 1;
    const issued = Core.today(now);
    const rec = Object.assign({ id: Core.uid('exr'), no: 'EXR-' + String(db.counters.exr).padStart(5, '0'), amount: r2(amount), issuedOn: issued,
      expiresOn: info.expiresOn != null ? info.expiresOn : Core.creditExpiry(issued, db.settings.returnDays), status: 'open', windowDays: db.settings.returnDays }, info);
    db.exchangeReceipts.push(rec);
    return rec;
  };
  Core.findExchangeReceipt = function (db, no) { return (db.exchangeReceipts || []).find((x) => x.no === String(no || '').trim().toUpperCase()); };
  Core.checkExchangeReceipt = function (db, no, now) {
    const rec = Core.findExchangeReceipt(db, no);
    if (!rec) throw new Error('EXR_MISSING');
    if (rec.status !== 'open') throw new Error('EXR_USED');
    if (Core.creditExpired(rec, now)) throw new Error('EXR_EXPIRED');
    return rec;
  };

  // ---------- sales ----------
  Core.newInvoiceNo = function (db, kind) {
    const k = kind === 'return' ? 'ret' : kind;
    db.counters[k] = (db.counters[k] || 0) + 1;
    const pre = kind === 'sale' ? 'S' : kind === 'return' ? 'R' : 'P';
    return pre + String(db.counters[k]).padStart(6, '0');
  };

  /**
   * Finalize a sale. input: {cart, payments:[{method,amount}], user, shiftId, customerId, promos snapshot}
   * Throws Error(code) on problems. Mutates db.
   */
  Core.finalizeSale = function (db, input, now) {
    now = now || new Date();
    const s = db.settings;
    const cart = input.cart;
    if (!cart.lines.length) throw new Error('EMPTY_CART');
    const calc = Core.computeCart(cart, db.promos, s, now);
    let xr = null, credit = 0;
    if (input.exchangeReceiptNo) {
      xr = Core.checkExchangeReceipt(db, input.exchangeReceiptNo, now);
      credit = r2(Math.min(xr.amount, calc.total));
      input = Object.assign({}, input, { payments: (input.payments || []).filter((p) => p.method !== 'credit').concat(credit > 0 ? [{ method: 'credit', amount: credit }] : []) });
    }
    const paid = r2((input.payments || []).reduce((t, p) => t + (p.amount || 0), 0));
    const cash = r2((input.payments || []).filter((p) => p.method === 'cash').reduce((t, p) => t + p.amount, 0));
    const nonCash = r2(paid - cash);
    if (paid + 0.004 < calc.total) throw new Error('UNDERPAID');
    if (nonCash > calc.total + 0.004) throw new Error('NONCASH_OVER');
    const change = r2(Math.max(0, paid - calc.total));
    if (change > cash + 0.004) throw new Error('CHANGE_EXCEEDS_CASH');
    // stock check
    const need = {};
    cart.lines.forEach((l) => { need[l.itemId] = r2((need[l.itemId] || 0) + l.qty); });
    for (const id in need) {
      const it = db.items.find((x) => x.id === id);
      if (!it) throw new Error('ITEM_MISSING');
      if (!s.allowNegativeStock && !it.service && (it.stock || 0) + 1e-9 < need[id]) { const e = new Error('NO_STOCK'); e.item = it.name; throw e; }
    }
    // serial check
    for (const l of cart.lines) {
      const it = db.items.find((x) => x.id === l.itemId);
      if (it.serialTracked) {
        const sel = l.serials || [];
        if (sel.length !== l.qty) { const e = new Error('SERIAL_COUNT'); e.item = it.name; throw e; }
        const avail = new Set(it.serials || []);
        for (const sn of sel) if (!avail.has(sn)) { const e = new Error('SERIAL_UNAVAILABLE'); e.item = it.name; throw e; }
      }
    }
    const sale = {
      id: Core.uid('sale'), no: Core.newInvoiceNo(db, 'sale'), ts: now.toISOString(), type: 'sale',
      userId: input.user.id, userName: input.user.name, shiftId: input.shiftId || null,
      customerId: input.customerId || null, customerName: input.customerName || '',
      lines: [], gross: calc.gross, lineDisc: calc.lineDisc, invoiceDisc: calc.invoiceDisc,
      redeemValue: calc.redeemValue, invoicePromoNames: calc.invoicePromoNames,
      subtotal: calc.subtotal, tax: calc.tax, total: calc.total,
      payments: (input.payments || []).filter((p) => p.amount > 0), paid, change,
      profileName: input.profileName || '', status: 'completed', returned: {},
    };
    let cogs = 0;
    calc.lines.forEach((l) => {
      const it = db.items.find((x) => x.id === l.itemId);
      const alloc = fefoAllocate(it, l.qty);
      if (!it.service) {
        it.stock = r2((it.stock || 0) - l.qty);
        alloc.forEach((a) => { const b = it.batches.find((x) => x.batch === a.batch); if (b) b.qty = r2(b.qty - a.qty); });
        if (it.serialTracked) it.serials = it.serials.filter((sn) => (l.serials || []).indexOf(sn) < 0);
      }
      it.lastSold = sale.ts;
      cogs = r2(cogs + (it.cost || 0) * l.qty);
      sale.lines.push({
        itemId: it.id, barcode: it.barcode, name: it.name, nameEn: it.nameEn || '', group: it.group || '',
        qty: l.qty, price: l.price, gross: l.gross, promoDisc: l.promoDisc, promoNames: l.promoNames,
        manualDisc: l.manualDisc, invShare: l.invShare, tax: l.tax, total: l.total, cost: it.cost || 0,
        serials: l.serials || [], alloc, unit: it.unit || '',
        exchangeOnly: !!((l.promoNames && l.promoNames.length) || l.promoDisc > 0 || (calc.invoicePromoNames && calc.invoicePromoNames.length)),
      });
    });
    sale.cogs = cogs;
    // loyalty
    if (s.loyaltyEnabled && input.customerId) {
      const c = db.customers.find((x) => x.id === input.customerId);
      if (c) {
        c.points = r2((c.points || 0) - calc.redeemValue / (s.loyaltyPointValue || 1));
        sale.pointsEarned = Math.floor(calc.total / (s.loyaltyEarnPerCurrency || 10));
        c.points = r2(Math.max(0, c.points) + sale.pointsEarned);
        c.lastVisit = sale.ts;
      }
    }
    if (xr) {
      xr.status = 'redeemed'; xr.redeemedIn = sale.no; xr.redeemedOn = Core.today(now);
      sale.exchangeCredit = { no: xr.no, amount: credit };
      const left = r2(xr.amount - credit);
      if (left > 0.004) sale.newExchangeReceipt = Core.issueExchangeReceipt(db, left, { expiresOn: xr.expiresOn, customerName: xr.customerName || '', splitFrom: xr.no }, now).no;
    }
    db.sales.push(sale);
    return sale;
  };

  /** Held-cart helpers use plain objects; nothing to compute here. */

  // ---------- returns ----------
  Core.returnableQty = function (sale, idx) {
    const done = (sale.returned && sale.returned[idx]) || 0;
    return r2(sale.lines[idx].qty - done);
  };
  Core.canReturn = function (db, sale, user, now) {
    now = now || new Date();
    if (sale.status === 'voided') return { ok: false, code: 'VOIDED' };
    const days = (now - new Date(sale.ts)) / 86400000;
    if (days > db.settings.returnDays) {
      if (user.role === 'manager' && db.settings.managerBypassReturnWindow) return { ok: true, late: true };
      return { ok: false, code: 'WINDOW', needManager: true };
    }
    return { ok: true };
  };
  /** items: [{idx, qty, serials?, restock:true}] ; refund pro-rata of what was actually paid for the line */
  Core.finalizeReturn = function (db, saleId, items, user, opts, now) {
    now = now || new Date(); opts = opts || {};
    const sale = db.sales.find((x) => x.id === saleId);
    if (!sale) throw new Error('SALE_MISSING');
    const chk = Core.canReturn(db, sale, user, now);
    if (!chk.ok) throw new Error(chk.code);
    sale.returned = sale.returned || {};
    sale.returnedSerials = sale.returnedSerials || [];
    const method = opts.method || 'cash';
    let refund = 0, tax = 0;
    const lines = [];
    items.forEach((r) => {
      const l = sale.lines[r.idx];
      if (!l) throw new Error('LINE_MISSING');
      const left = Core.returnableQty(sale, r.idx);
      if (r.qty <= 0 || r.qty > left + 1e-9) throw new Error('QTY_EXCEEDS');
      if (l.exchangeOnly && method !== 'credit') { const e = new Error('PROMO_EXCHANGE_ONLY'); e.item = l.name; throw e; }
      if (l.serials && l.serials.length) {
        const rs = r.serials || [];
        if (rs.length !== r.qty) throw new Error('SERIAL_COUNT');
        rs.forEach((sn) => { if (l.serials.indexOf(sn) < 0) throw new Error('SERIAL_NOT_ON_SALE'); });
        if (new Set(rs).size !== rs.length) throw new Error('SERIAL_COUNT');
        rs.forEach((sn) => { if (sale.returnedSerials.indexOf(sn) >= 0) { const e = new Error('SERIAL_ALREADY_RETURNED'); e.item = sn; throw e; } });
      }
      const ratio = r.qty / l.qty;
      const val = r2(l.total * ratio);
      const t = r2(l.tax * ratio);
      refund = r2(refund + val); tax = r2(tax + t);
      sale.returned[r.idx] = r2((sale.returned[r.idx] || 0) + r.qty);
      if (r.serials) sale.returnedSerials = sale.returnedSerials.concat(r.serials);
      const it = db.items.find((x) => x.id === l.itemId);
      if (it && !it.service && r.restock !== false) {
        it.stock = r2((it.stock || 0) + r.qty);
        if (it.batchTracked && l.alloc && l.alloc.length) {
          let rem = r.qty;
          l.alloc.forEach((a) => {
            if (rem <= 0) return;
            const back = Math.min(rem, a.qty);
            let b = it.batches.find((x) => x.batch === a.batch);
            if (!b) { b = { batch: a.batch, expiry: a.expiry || '', qty: 0 }; it.batches.push(b); }
            b.qty = r2(b.qty + back); rem = r2(rem - back);
          });
        }
        if (it.serialTracked && r.serials) it.serials = (it.serials || []).concat(r.serials);
      }
      lines.push({ itemId: l.itemId, name: l.name, nameEn: l.nameEn, qty: r.qty, value: val, tax: t, serials: r.serials || [] });
    });
    const ret = {
      id: Core.uid('ret'), no: Core.newInvoiceNo(db, 'return'), ts: now.toISOString(), type: 'return',
      saleId: sale.id, saleNo: sale.no, originalProfile: sale.profileName || '', fromBranch: sale.profileName || '',
      returnedAtProfile: opts.profileName || '', userId: user.id, userName: user.name, shiftId: opts.shiftId || null,
      reason: opts.reason || '', method, lines, refund, tax, customerName: sale.customerName || '',
      lateOverride: !!chk.late, status: 'completed',
    };
    if (sale.customerId && db.settings.loyaltyEnabled) {
      const c = db.customers.find((x) => x.id === sale.customerId);
      if (c) c.points = r2(Math.max(0, (c.points || 0) - Math.floor(refund / (db.settings.loyaltyEarnPerCurrency || 10))));
    }
    if (method === 'credit') {
      const rec = Core.issueExchangeReceipt(db, refund, { returnNo: ret.no, saleNo: sale.no, customerName: sale.customerName || '' }, now);
      ret.exchangeReceiptNo = rec.no;
    }
    db.sales.push(ret);
    return ret;
  };

  Core.voidSale = function (db, saleId, user, reason) {
    if (user.role !== 'manager') throw new Error('MANAGER_ONLY');
    const sale = db.sales.find((x) => x.id === saleId && x.type === 'sale');
    if (!sale) throw new Error('SALE_MISSING');
    if (sale.status === 'voided') throw new Error('VOIDED');
    if (Object.keys(sale.returned || {}).length) throw new Error('HAS_RETURNS');
    sale.lines.forEach((l) => {
      const it = db.items.find((x) => x.id === l.itemId);
      if (!it || it.service) return;
      it.stock = r2((it.stock || 0) + l.qty);
      if (it.batchTracked) l.alloc.forEach((a) => {
        let b = it.batches.find((x) => x.batch === a.batch);
        if (!b) { b = { batch: a.batch, expiry: a.expiry || '', qty: 0 }; it.batches.push(b); }
        b.qty = r2(b.qty + a.qty);
      });
      if (it.serialTracked) it.serials = (it.serials || []).concat(l.serials || []);
    });
    sale.status = 'voided'; sale.voidReason = reason || ''; sale.voidBy = user.name; sale.voidTs = new Date().toISOString();
    return sale;
  };

  // ---------- shifts ----------
  Core.openShift = function (db, user, openingCash, profileName) {
    if (db.shifts.some((s) => s.userId === user.id && !s.closedAt)) throw new Error('SHIFT_ALREADY_OPEN');
    const sh = { id: Core.uid('sh'), userId: user.id, userName: user.name, profileName: profileName || '',
      openedAt: new Date().toISOString(), openingCash: r2(openingCash || 0), moves: [], closedAt: null };
    db.shifts.push(sh); return sh;
  };
  Core.cashMove = function (db, shift, kind, amount, reason, approvedBy) {
    if (!(amount > 0)) throw new Error('BAD_AMOUNT');
    if (kind !== 'in' && kind !== 'out') throw new Error('BAD_KIND');
    shift.moves.push({ ts: new Date().toISOString(), kind, amount: r2(amount), reason: reason || '', approvedBy: approvedBy || '' });
  };
  // cashier cash-out above the limit needs a manager; a saved 0 means every cash-out needs one (200 only when unset)
  Core.cashOutNeedsApproval = function (settings, amount, isManager) {
    const lim = settings && settings.cashOutLimit != null ? settings.cashOutLimit : 200;
    return !isManager && amount > lim;
  };
  Core.shiftSummary = function (db, shift) {
    const rows = db.sales.filter((x) => x.shiftId === shift.id && x.status !== 'voided');
    const sales = rows.filter((x) => x.type === 'sale');
    const rets = rows.filter((x) => x.type === 'return');
    const byMethod = {};
    sales.forEach((s) => s.payments.forEach((p) => { byMethod[p.method] = r2((byMethod[p.method] || 0) + p.amount); }));
    const changeGiven = r2(sales.reduce((t, s) => t + s.change, 0));
    byMethod.cash = r2((byMethod.cash || 0) - changeGiven);
    const refunds = {};
    rets.forEach((r) => { refunds[r.method] = r2((refunds[r.method] || 0) + r.refund); });
    const cashIn = r2(shift.moves.filter((m) => m.kind === 'in').reduce((t, m) => t + m.amount, 0));
    const cashOut = r2(shift.moves.filter((m) => m.kind === 'out').reduce((t, m) => t + m.amount, 0));
    const expectedCash = r2(shift.openingCash + (byMethod.cash || 0) - (refunds.cash || 0) + cashIn - cashOut);
    return { salesCount: sales.length, returnsCount: rets.length, salesTotal: r2(sales.reduce((t, s) => t + s.total, 0)),
      returnsTotal: r2(rets.reduce((t, r) => t + r.refund, 0)), byMethod, refunds, cashIn, cashOut, expectedCash };
  };
  Core.closeShift = function (db, shift, countedCash, note) {
    const sum = Core.shiftSummary(db, shift);
    const diff = r2(countedCash - sum.expectedCash);
    shift.closedAt = new Date().toISOString(); shift.countedCash = r2(countedCash); shift.expectedCash = sum.expectedCash;
    shift.diff = diff; shift.note = note || ''; shift.summary = sum;
    return shift;
  };

  // ---------- purchases / Excel import ----------
  const HEAD = {
    barcode: ['barcode', 'code', 'sku', 'item code', 'الباركود', 'باركود', 'الكود', 'كود', 'كود الصنف'],
    name: ['name', 'item', 'item name', 'description', 'الاسم', 'اسم الصنف', 'الصنف', 'البيان'],
    qty: ['qty', 'quantity', 'الكمية', 'كمية', 'العدد'],
    cost: ['cost', 'unit cost', 'cost price', 'price', 'التكلفة', 'سعر التكلفة', 'سعر الشراء', 'التكلفه'],
    discount: ['discount', 'discount %', 'disc', 'disc %', 'الخصم', 'خصم', 'الخصم %', 'خصم %'],
    batch: ['batch', 'batch no', 'lot', 'الباتش', 'رقم الباتش', 'باتش', 'التشغيلة'],
    expiry: ['expiry', 'expiry date', 'exp', 'expire', 'تاريخ الصلاحية', 'الصلاحية', 'انتهاء الصلاحية'],
    serial: ['serial', 'serials', 'serial no', 'serial number', 'السيريال', 'سيريال', 'الرقم التسلسلي'],
    sellPrice: ['sell price', 'selling price', 'sale price', 'retail', 'سعر البيع', 'سعر البيع للجمهور'],
    group: ['group', 'category', 'item group', 'المجموعة', 'الفئة', 'القسم'],
    unit: ['unit', 'uom', 'الوحدة'],
  };
  Core.IMPORT_COLUMNS = Object.keys(HEAD);
  Core.mapHeaders = function (headerRow) {
    const map = {};
    headerRow.forEach((h, i) => {
      const k = String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');
      for (const f in HEAD) if (map[f] == null && HEAD[f].some((a) => a.toLowerCase() === k)) map[f] = i;
    });
    return map;
  };
  /**
   * rows: array of arrays, first row headers. Returns {rows:[{rowNo,barcode,name,qty,cost,discount,batch,expiry,serials,sellPrice,group,isNew,itemId}], errors:[{rowNo,msg}], warnings:[{rowNo,msg}], missingHeaders:[]}
   * Errors block the whole import (nothing is saved until the file is clean).
   */
  Core.parseSupplierRows = function (rows, items) {
    const res = { rows: [], errors: [], warnings: [], missingHeaders: [] };
    if (!rows || !rows.length) { res.errors.push({ rowNo: 0, code: 'EMPTY' }); return res; }
    const map = Core.mapHeaders(rows[0]);
    if (map.barcode == null) res.missingHeaders.push('barcode');
    if (map.qty == null) res.missingHeaders.push('qty');
    if (map.cost == null) res.missingHeaders.push('cost');
    if (res.missingHeaders.length) { res.errors.push({ rowNo: 1, code: 'HEADERS', arg: res.missingHeaders.join(', ') }); return res; }
    const get = (r, f) => (map[f] == null ? '' : r[map[f]]);
    const byBarcode = {}; items.forEach((it) => { byBarcode[String(it.barcode)] = it; });
    const fileSerials = new Map();
    const merged = new Map();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;
      const rowNo = i + 1;
      const barcode = Core.normDigits(get(r, 'barcode')).trim();
      const name = String(get(r, 'name') || '').trim();
      const qty = Core.num(get(r, 'qty'));
      const cost = Core.num(get(r, 'cost'));
      const discRaw = get(r, 'discount');
      const disc = discRaw === '' || discRaw == null ? 0 : Core.num(discRaw);
      const batch = String(get(r, 'batch') || '').trim();
      const expiry = Core.isoDate(get(r, 'expiry'));
      const sellRaw = get(r, 'sellPrice');
      const sellPrice = sellRaw === '' || sellRaw == null ? null : Core.num(sellRaw);
      const serialRaw = String(get(r, 'serial') || '').trim();
      const serials = serialRaw ? serialRaw.split(/[,;\n\s]+/).map((s) => s.trim()).filter(Boolean) : [];
      const group = String(get(r, 'group') || '').trim();
      const unit = String(get(r, 'unit') || '').trim();
      const err = (code, arg) => res.errors.push({ rowNo, code, arg });
      if (!barcode) err('NO_BARCODE');
      if (isNaN(qty) || qty <= 0) err('BAD_QTY');
      if (isNaN(cost) || cost < 0 || get(r, 'cost') === '') err('BAD_COST');
      if (isNaN(disc) || disc < 0 || disc > 100) err('BAD_DISCOUNT');
      if (expiry === null) err('BAD_EXPIRY');
      if (sellPrice !== null && (isNaN(sellPrice) || sellPrice < 0)) err('BAD_SELL');
      const existing = byBarcode[barcode];
      if (!existing && !name && barcode) err('NEW_NEEDS_NAME', barcode);
      if (serials.length) {
        if (serials.length !== qty) err('SERIAL_COUNT', serials.length + '/' + qty);
        if (new Set(serials).size !== serials.length) err('SERIAL_DUP_ROW');
        serials.forEach((sn) => {
          if (fileSerials.has(sn)) err('SERIAL_DUP_FILE', sn); else fileSerials.set(sn, rowNo);
          if (existing && (existing.serials || []).indexOf(sn) >= 0) err('SERIAL_EXISTS', sn);
        });
      }
      if (res.errors.some((e) => e.rowNo === rowNo)) continue;
      const netCost = r2(cost * (1 - disc / 100));
      const key = [barcode, batch, expiry || '', cost, disc, sellPrice == null ? '' : sellPrice, serials.length ? 'S' + rowNo : ''].join('|');
      if (merged.has(key)) {
        const m = merged.get(key); m.qty = r2(m.qty + qty);
        res.warnings.push({ rowNo, code: 'MERGED', arg: barcode });
      } else {
        const row = { rowNo, barcode, name: existing ? existing.name : name, qty, cost, discount: disc, netCost, batch, expiry: expiry || '',
          serials, sellPrice, group: group || (existing ? existing.group : ''), unit, isNew: !existing, itemId: existing ? existing.id : null,
          noSellPrice: sellPrice == null && (!existing || !(existing.price > 0)) };
        merged.set(key, row);
      }
      if (existing && existing.price > 0 && sellPrice != null && sellPrice !== existing.price) res.warnings.push({ rowNo, code: 'PRICE_CHANGE', arg: existing.price + ' → ' + sellPrice });
      if (existing && netCost > existing.price && existing.price > 0 && sellPrice == null) res.warnings.push({ rowNo, code: 'COST_ABOVE_PRICE', arg: barcode });
    }
    res.rows = Array.from(merged.values());
    if (!res.rows.length && !res.errors.length) res.errors.push({ rowNo: 0, code: 'EMPTY' });
    return res;
  };

  /** purchase: {supplierId, invoiceNo, date, paid, note, lines:[parsed rows]} */
  Core.finalizePurchase = function (db, purchase, user, now) {
    now = now || new Date();
    if (!purchase.lines || !purchase.lines.length) throw new Error('EMPTY');
    if (purchase.supplierId && purchase.invoiceNo) {
      const dup = db.purchases.find((p) => p.status !== 'voided' && p.supplierId === purchase.supplierId && p.invoiceNo === purchase.invoiceNo);
      if (dup && !purchase.allowDuplicate) { const e = new Error('DUP_INVOICE'); e.no = dup.no; throw e; }
    }
    // validate all first so nothing is half applied
    purchase.lines.forEach((l) => {
      if (!(l.qty > 0)) throw new Error('BAD_QTY');
      const ex = db.items.find((x) => x.barcode === l.barcode);
      if (ex && l.serials && l.serials.some((sn) => (ex.serials || []).indexOf(sn) >= 0)) throw new Error('SERIAL_EXISTS');
    });
    const applied = [];
    let total = 0;
    purchase.lines.forEach((l) => {
      let it = db.items.find((x) => x.barcode === l.barcode);
      const net = l.netCost != null ? l.netCost : r2(l.cost * (1 - (l.discount || 0) / 100));
      let created = false;
      if (!it) {
        it = { id: Core.uid('it'), barcode: l.barcode, name: l.name, nameEn: '', group: l.group || '', unit: l.unit || '',
          cost: 0, price: 0, stock: 0, minStock: db.settings.lowStockDefault, batchTracked: false, serialTracked: false,
          batches: [], serials: [], active: true, created: now.toISOString() };
        db.items.push(it); created = true;
      }
      const oldStock = Math.max(0, it.stock || 0), oldCost = it.cost || 0;
      if (db.settings.costMethod === 'average' && oldStock > 0) it.cost = r2((oldStock * oldCost + l.qty * net) / (oldStock + l.qty));
      else it.cost = net;
      it.stock = r2((it.stock || 0) + l.qty);
      if (l.batch || l.expiry) {
        it.batchTracked = true; it.batches = it.batches || [];
        const key = l.batch || ('EXP-' + l.expiry);
        const b = it.batches.find((x) => x.batch === key && (x.expiry || '') === (l.expiry || ''));
        if (b) b.qty = r2(b.qty + l.qty); else it.batches.push({ batch: key, expiry: l.expiry || '', qty: l.qty });
      }
      if (l.serials && l.serials.length) { it.serialTracked = true; it.serials = (it.serials || []).concat(l.serials); }
      if (l.sellPrice != null && !isNaN(l.sellPrice)) it.price = l.sellPrice;
      if (l.group && !it.group) it.group = l.group;
      total = r2(total + l.qty * net);
      applied.push(Object.assign({}, l, { itemId: it.id, netCost: net, created }));
    });
    const p = { id: Core.uid('pur'), no: Core.newInvoiceNo(db, 'purchase'), ts: now.toISOString(), date: purchase.date || Core.today(now),
      supplierId: purchase.supplierId || null, invoiceNo: purchase.invoiceNo || '', userName: user.name, note: purchase.note || '',
      lines: applied, total, paid: r2(purchase.paid || 0), status: 'completed' };
    db.purchases.push(p);
    return p;
  };
  Core.voidPurchase = function (db, id, user) {
    if (user.role !== 'manager') throw new Error('MANAGER_ONLY');
    const p = db.purchases.find((x) => x.id === id);
    if (!p || p.status === 'voided') throw new Error('PURCHASE_MISSING');
    // check feasibility first
    for (const l of p.lines) {
      const it = db.items.find((x) => x.id === l.itemId);
      if (!it) continue;
      if ((it.stock || 0) + 1e-9 < l.qty) { const e = new Error('STOCK_USED'); e.item = it.name; throw e; }
      if (l.batch || l.expiry) {
        const key = l.batch || ('EXP-' + l.expiry);
        const b = (it.batches || []).find((x) => x.batch === key && (x.expiry || '') === (l.expiry || ''));
        if (!b || b.qty + 1e-9 < l.qty) { const e = new Error('STOCK_USED'); e.item = it.name; throw e; }
      }
      if (l.serials && l.serials.some((sn) => (it.serials || []).indexOf(sn) < 0)) { const e = new Error('STOCK_USED'); e.item = it.name; throw e; }
    }
    p.lines.forEach((l) => {
      const it = db.items.find((x) => x.id === l.itemId);
      if (!it) return;
      it.stock = r2(it.stock - l.qty);
      if (l.batch || l.expiry) {
        const key = l.batch || ('EXP-' + l.expiry);
        const b = it.batches.find((x) => x.batch === key && (x.expiry || '') === (l.expiry || ''));
        b.qty = r2(b.qty - l.qty);
      }
      if (l.serials && l.serials.length) it.serials = it.serials.filter((sn) => l.serials.indexOf(sn) < 0);
    });
    p.status = 'voided'; p.voidBy = user.name; p.voidTs = new Date().toISOString();
    return p;
  };

  // ---------- weight barcodes (EAN-13: P + 5 digit item code + 5 digit weight(g) or price + check) ----------
  Core.parseWeightBarcode = function (code, settings) {
    code = Core.normDigits(code).trim();
    const pre = settings.scalePrefix || '2';
    if (!/^\d{13}$/.test(code) || !code.startsWith(pre)) return null;
    const plu = code.slice(pre.length, pre.length + (12 - pre.length - 5));
    const w = code.slice(12 - 5, 12);
    return { plu: plu, pluNum: String(Number(plu)), weightKg: Number(w) / 1000 };
  };
  Core.ean13Check = function (d12) {
    let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
    return String((10 - (s % 10)) % 10);
  };
  Core.autoBarcode = function (db) {
    // internal EAN-13 starting with 29 (in-store use), skips used values
    let n = db.items.length + 1;
    for (;;) {
      const d12 = '29' + String(n).padStart(10, '0');
      const code = d12 + Core.ean13Check(d12);
      if (!db.items.some((x) => x.barcode === code)) return code;
      n++;
    }
  };

  // ---------- reports ----------
  Core.slowMoving = function (db, days, now) {
    now = now || new Date();
    const cutoff = now.getTime() - days * 86400000;
    const rows = [];
    db.items.forEach((it) => {
      if (it.active === false || it.service || !(it.stock > 0)) return;
      const created = it.created ? new Date(it.created).getTime() : 0;
      if (created && created > cutoff) return; // too new to judge
      const last = it.lastSold ? new Date(it.lastSold).getTime() : 0;
      if (last && last > cutoff) return;
      const sinceDays = last ? Math.floor((now - last) / 86400000) : null;
      rows.push({ itemId: it.id, barcode: it.barcode, name: it.name, group: it.group || '', stock: it.stock, cost: it.cost || 0,
        price: it.price || 0, stockValue: r2(it.stock * (it.cost || 0)), lastSold: it.lastSold || '', daysSince: sinceDays });
    });
    return rows.sort((a, b) => b.stockValue - a.stockValue);
  };
  Core.lowStock = function (db) { return db.items.filter((i) => i.active !== false && !i.service && (i.stock || 0) <= (i.minStock || 0)); };
  Core.expiring = function (db, days, now) {
    now = now || new Date();
    const lim = Core.today(new Date(now.getTime() + days * 86400000)); const out = [];
    db.items.forEach((it) => (it.batches || []).forEach((b) => { if (b.qty > 0 && b.expiry && b.expiry <= lim) out.push({ item: it, batch: b }); }));
    return out.sort((a, b) => a.batch.expiry.localeCompare(b.batch.expiry));
  };
  Core.salesReport = function (db, from, to) {
    const rows = db.sales.filter((s) => s.status !== 'voided' && s.ts.slice(0, 10) >= from && s.ts.slice(0, 10) <= to);
    const sales = rows.filter((s) => s.type === 'sale'), rets = rows.filter((s) => s.type === 'return');
    const total = r2(sales.reduce((t, s) => t + s.total, 0)), refunds = r2(rets.reduce((t, s) => t + s.refund, 0));
    const tax = r2(sales.reduce((t, s) => t + s.tax, 0) - rets.reduce((t, s) => t + s.tax, 0));
    const cogs = r2(sales.reduce((t, s) => t + (s.cogs || 0), 0) - rets.reduce((t, r) => {
      const s = db.sales.find((x) => x.id === r.saleId); if (!s) return t;
      return t + r.lines.reduce((u, l) => { const sl = s.lines.find((q) => q.itemId === l.itemId); return u + (sl ? sl.cost * l.qty : 0); }, 0);
    }, 0));
    const net = r2(total - refunds);
    const byDay = {}, byGroup = {}, byUser = {};
    sales.forEach((s) => {
      const d = s.ts.slice(0, 10); byDay[d] = r2((byDay[d] || 0) + s.total);
      byUser[s.userName] = r2((byUser[s.userName] || 0) + s.total);
      s.lines.forEach((l) => { const g = l.group || '-'; byGroup[g] = r2((byGroup[g] || 0) + l.total); });
    });
    return { count: sales.length, returnsCount: rets.length, total, refunds, net, tax, cogs, profit: r2(net - tax - cogs), byDay, byGroup, byUser };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
