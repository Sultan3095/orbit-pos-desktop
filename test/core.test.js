const assert = require('assert');
const C = require('../src/core.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  -', name); } catch (e) { console.log('FAIL-', name, '\n', e.stack); process.exitCode = 1; } };
const S = Object.assign(C.defaultSettings(), { taxRate: 14, pricesIncludeTax: true });
const mk = () => { const db = C.newDB(); db.users.push(C.makeUser('Boss', '1234', 'manager'), C.makeUser('Cash', '0000', 'cashier'));
  db.items.push({ id: 'a', barcode: '111', name: 'A', group: 'G1', cost: 6, price: 10, stock: 100, minStock: 5, batches: [], serials: [] },
    { id: 'b', barcode: '222', name: 'B', group: 'G1', cost: 3, price: 5, stock: 100, minStock: 5, batches: [], serials: [] },
    { id: 'c', barcode: '333', name: 'C', group: 'G2', cost: 20, price: 30, stock: 10, minStock: 2, batches: [], serials: [] }); return db; };
const line = (id, g, qty, price) => ({ itemId: id, group: g, qty, price });
const calc = (lines, promos) => C.computeCart({ lines }, promos, S);

// ---- the reported bug: buy 2 get 3 ----
const b2g3 = { id: 'p', name: 'b2g3', type: 'bxgy', scope: { type: 'item', value: 'a' }, params: { buy: 2, get: 3 } };
t('buy2get3: 5 units -> 3 free (not 2)', () => { const r = calc([line('a', 'G1', 5, 10)], [b2g3]); assert.strictEqual(r.lines[0].promoDisc, 30); assert.strictEqual(r.subtotal, 20); });
t('buy2get3: 4 units -> 0 free (needs full 5)', () => { assert.strictEqual(calc([line('a', 'G1', 4, 10)], [b2g3]).lines[0].promoDisc, 0); });
t('buy2get3: 10 units -> 6 free', () => { assert.strictEqual(calc([line('a', 'G1', 10, 10)], [b2g3]).lines[0].promoDisc, 60); });
t('buy2get3: 7 units -> 3 free', () => { assert.strictEqual(calc([line('a', 'G1', 7, 10)], [b2g3]).lines[0].promoDisc, 30); });
t('buy2get3: units split over two lines of same item still get 3 free', () => { const r = calc([line('a', 'G1', 2, 10), line('a', 'G1', 3, 10)], [b2g3]); assert.strictEqual(r.lines[0].promoDisc + r.lines[1].promoDisc, 30); });
t('buy 3 get 1 over a group: cheapest unit free across mixed items', () => {
  const p = { id: 'g', name: 'g', type: 'bxgy', scope: { type: 'group', value: 'G1' }, params: { buy: 3, get: 1 } };
  const r = calc([line('a', 'G1', 2, 10), line('b', 'G1', 2, 5)], [p]); assert.strictEqual(r.lines[1].promoDisc, 5); assert.strictEqual(r.lines[0].promoDisc, 0); });
t('buy 5 get 1', () => { const p = { id: 'x', name: 'x', type: 'bxgy', scope: { type: 'all' }, params: { buy: 5, get: 1 } }; assert.strictEqual(calc([line('a', 'G1', 12, 10)], [p]).lines[0].promoDisc, 20); });
t('bxgy half price on get units', () => { const p = { id: 'x', name: 'x', type: 'bxgy', scope: { type: 'item', value: 'a' }, params: { buy: 1, get: 1, getPct: 50 } }; assert.strictEqual(calc([line('a', 'G1', 2, 10)], [p]).lines[0].promoDisc, 5); });
t('percent promo', () => { assert.strictEqual(calc([line('a', 'G1', 3, 10)], [{ id: 'p', name: 'p', type: 'percent', scope: { type: 'all' }, params: { percent: 10 } }]).subtotal, 27); });
t('best non-stackable wins; stackable adds', () => {
  const ps = [{ id: '1', name: '10', type: 'percent', scope: { type: 'all' }, params: { percent: 10 } }, { id: '2', name: '20', type: 'percent', scope: { type: 'all' }, params: { percent: 20 } },
    { id: '3', name: '5', type: 'amount', stackable: true, scope: { type: 'all' }, params: { amount: 1 } }];
  const r = calc([line('a', 'G1', 1, 10)], ps); assert.strictEqual(r.subtotal, 7); });
t('bundle 3 for 20', () => { const p = { id: 'b', name: 'b', type: 'bundle', scope: { type: 'item', value: 'a' }, params: { qty: 3, price: 20 } }; assert.strictEqual(calc([line('a', 'G1', 7, 10)], [p]).subtotal, 20 + 20 + 10); });
t('invoice promo needs min total', () => { const p = { id: 'i', name: 'i', type: 'invoice_pct', scope: { type: 'all' }, params: { percent: 10, minTotal: 100 } };
  assert.strictEqual(calc([line('a', 'G1', 5, 10)], [p]).total, 50); assert.strictEqual(calc([line('a', 'G1', 20, 10)], [p]).total, 180); });
t('expired / inactive / future promos are ignored', () => {
  const base = { type: 'percent', scope: { type: 'all' }, params: { percent: 50 }, name: 'x' };
  assert.strictEqual(calc([line('a', 'G1', 1, 10)], [Object.assign({ id: 1, end: '2000-01-01' }, base), Object.assign({ id: 2, active: false }, base), Object.assign({ id: 3, start: '2999-01-01' }, base)]).total, 10); });
t('manual line discount replaces promos', () => { const r = calc([Object.assign(line('a', 'G1', 2, 10), { manualPct: 5 })], [{ id: 'p', name: 'p', type: 'percent', scope: { type: 'all' }, params: { percent: 50 } }]); assert.strictEqual(r.subtotal, 19); });
t('tax inclusive & exclusive', () => { assert.strictEqual(calc([line('a', 'G1', 1, 114)], []).tax, 14);
  const r = C.computeCart({ lines: [line('a', 'G1', 1, 100)] }, [], Object.assign({}, S, { pricesIncludeTax: false })); assert.strictEqual(r.total, 114); assert.strictEqual(r.tax, 14); });
t('invoice discount allocates exactly', () => { const r = C.computeCart({ lines: [line('a', 'G1', 1, 10), line('b', 'G1', 1, 5), line('c', 'G2', 1, 30)], invPct: 10 }, [], S);
  assert.strictEqual(r.total, 40.5); assert.strictEqual(r.lines.reduce((s, l) => s + l.invShare, 0).toFixed(2), '4.50'); });

// ---- sales / stock / returns ----
const pay = (a) => [{ method: 'cash', amount: a }];
t('sale reduces stock, underpay rejected, split payment, change only from cash', () => {
  const db = mk(); const u = db.users[1];
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 2, 10)] }, payments: pay(5), user: u }), /UNDERPAID/);
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 2, 10)] }, payments: [{ method: 'cash', amount: 10 }, { method: 'card', amount: 10 }], user: u });
  assert.strictEqual(s.total, 20); assert.strictEqual(s.change, 0); assert.strictEqual(db.items[0].stock, 98);
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 1, 10)] }, payments: [{ method: 'card', amount: 15 }], user: u }), /NONCASH_OVER/);
});
t('cannot sell more than stock', () => { const db = mk(); assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('c', 'G2', 11, 30)] }, payments: pay(999), user: db.users[1] }), /NO_STOCK/); });
t('partial return pro-rata incl. discounts; restock; over-return blocked', () => {
  const db = mk(); const u = db.users[1];
  db.promos.push({ id: 'p', name: 'b2g3', type: 'bxgy', scope: { type: 'item', value: 'a' }, params: { buy: 2, get: 3 } });
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 5, 10)] }, payments: pay(20), user: u });
  assert.strictEqual(s.total, 20);
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 2 }], u, { method: 'credit' });
  assert.strictEqual(r.refund, 8); assert.strictEqual(db.items[0].stock, 97);
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 4 }], u, { method: 'credit' }), /QTY_EXCEEDS/);
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 3 }], u, { method: 'credit' });
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, {}), /QTY_EXCEEDS/);
  assert.strictEqual(db.sales.filter((x) => x.type === 'return').reduce((t, x) => t + x.refund, 0), 20);
});
t('return window: cashier blocked, manager may bypass', () => {
  const db = mk(); const u = db.users[1]; const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 1, 10)] }, payments: pay(10), user: u }, new Date(Date.now() - 20 * 86400000));
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, {}), /WINDOW/);
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], db.users[0], {}); assert.ok(r.lateOverride);
});
t('return records origin profile and return profile', () => { const db = mk(); const u = db.users[1];
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 1, 10)] }, payments: pay(10), user: u, profileName: 'Branch A' });
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { profileName: 'Branch B' }); assert.strictEqual(r.originalProfile, 'Branch A'); assert.strictEqual(r.returnedAtProfile, 'Branch B'); });
t('void sale restores stock; manager only; blocked after return', () => {
  const db = mk(); const u = db.users[1]; const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 3, 10)] }, payments: pay(30), user: u });
  assert.throws(() => C.voidSale(db, s.id, u), /MANAGER_ONLY`?/); C.voidSale(db, s.id, db.users[0]); assert.strictEqual(db.items[0].stock, 100); });

// ---- supplier invoice import ----
const H = ['Barcode', 'Name', 'Qty', 'Cost', 'Discount %', 'Batch', 'Expiry', 'Serial', 'Sell Price'];
t('import: valid file with 3 existing items increases stock and cost (average)', () => {
  const db = mk(); const res = C.parseSupplierRows([H, ['111', '', 10, 6, 0, '', '', '', 12], ['222', '', 5, 4, 0, '', '', '', ''], ['333', '', 2, 25, 10, '', '', '', '']], db.items);
  assert.strictEqual(res.errors.length, 0); const p = C.finalizePurchase(db, { lines: res.rows, supplierId: 's1', invoiceNo: 'INV1' }, db.users[0]);
  assert.strictEqual(db.items[0].stock, 110); assert.strictEqual(db.items[0].cost, 6); assert.strictEqual(db.items[0].price, 12);
  assert.strictEqual(db.items[2].cost, C.r2((10 * 20 + 2 * 22.5) / 12)); assert.strictEqual(p.total, 60 + 20 + 45); });
t('import: new item flagged new, created on confirm, warned when no sell price', () => {
  const db = mk(); const res = C.parseSupplierRows([H, ['999', 'Milk', 6, 10, 0, 'L1', '2027-03-01', '', '']], db.items);
  assert.ok(res.rows[0].isNew); assert.ok(res.rows[0].noSellPrice); C.finalizePurchase(db, { lines: res.rows }, db.users[0]);
  const it = db.items.find((x) => x.barcode === '999'); assert.strictEqual(it.stock, 6); assert.strictEqual(it.batches[0].expiry, '2027-03-01'); });
t('import: bad rows rejected with row numbers and nothing is saved', () => {
  const db = mk(); const rows = [H, ['111', '', 0, 6], ['222', '', 5, ''], ['333', '', 1, 5, 0, '', 'nonsense'], ['', 'x', 1, 1], ['777', '', 1, 1]];
  const res = C.parseSupplierRows(rows, db.items); const codes = res.errors.map((e) => e.rowNo + ':' + e.code);
  ['2:BAD_QTY', '3:BAD_COST', '4:BAD_EXPIRY', '5:NO_BARCODE', '6:NEW_NEEDS_NAME'].forEach((c) => assert.ok(codes.includes(c), c + ' in ' + codes));
  assert.strictEqual(db.items[0].stock, 100); });
t('import: duplicate barcode rows merge with a warning (not silently)', () => {
  const db = mk(); const res = C.parseSupplierRows([H, ['111', '', 2, 6], ['111', '', 3, 6]], db.items); assert.strictEqual(res.rows.length, 1); assert.strictEqual(res.rows[0].qty, 5); assert.strictEqual(res.warnings[0].code, 'MERGED'); });
t('import: serials must equal qty, no duplicates in file or stock', () => {
  const db = mk(); db.items[2].serials = ['S9'];
  let res = C.parseSupplierRows([H, ['333', '', 2, 5, 0, '', '', 'S1,S2'], ['333', '', 1, 5, 0, '', '', 'S2']], db.items); assert.ok(res.errors.some((e) => e.code === 'SERIAL_DUP_FILE'));
  res = C.parseSupplierRows([H, ['333', '', 2, 5, 0, '', '', 'S1']], db.items); assert.ok(res.errors.some((e) => e.code === 'SERIAL_COUNT'));
  res = C.parseSupplierRows([H, ['333', '', 1, 5, 0, '', '', 'S9']], db.items); assert.ok(res.errors.some((e) => e.code === 'SERIAL_EXISTS')); });
t('import: Arabic headers and Arabic-Indic digits', () => {
  const db = mk(); const res = C.parseSupplierRows([['الباركود', 'الاسم', 'الكمية', 'التكلفة', 'الخصم', 'الباتش', 'تاريخ الصلاحية', 'سعر البيع'], ['١١١', '', '٥', '٦٫٥', '', '', '٢٠٢٧/٠٣/٠١', '١٢']], db.items);
  assert.strictEqual(res.errors.length, 0, JSON.stringify(res.errors)); assert.strictEqual(res.rows[0].qty, 5); assert.strictEqual(res.rows[0].cost, 6.5); assert.strictEqual(res.rows[0].expiry, '2027-03-01'); });
t('import: missing required headers rejected', () => { assert.strictEqual(C.parseSupplierRows([['name', 'qty']], []).errors[0].code, 'HEADERS'); });
t('purchase: same supplier invoice twice warns; void restores', () => {
  const db = mk(); const res = C.parseSupplierRows([H, ['111', '', 10, 6]], db.items);
  const p = C.finalizePurchase(db, { lines: res.rows, supplierId: 's', invoiceNo: 'X' }, db.users[0]);
  assert.throws(() => C.finalizePurchase(db, { lines: res.rows, supplierId: 's', invoiceNo: 'X' }, db.users[0]), /DUP_INVOICE/);
  C.voidPurchase(db, p.id, db.users[0]); assert.strictEqual(db.items[0].stock, 100); });
t('purchase void blocked when stock already sold', () => {
  const db = mk(); const res = C.parseSupplierRows([H, ['333', '', 5, 20]], db.items); const p = C.finalizePurchase(db, { lines: res.rows }, db.users[0]);
  C.finalizeSale(db, { cart: { lines: [line('c', 'G2', 15, 30)] }, payments: pay(450), user: db.users[1] }); assert.throws(() => C.voidPurchase(db, p.id, db.users[0]), /STOCK_USED/); });
t('FEFO batch deduction; return restores same batch', () => {
  const db = mk(); const it = db.items[0]; it.batchTracked = true; it.stock = 10; it.batches = [{ batch: 'late', expiry: '2028-01-01', qty: 5 }, { batch: 'early', expiry: '2027-01-01', qty: 5 }];
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 6, 10)] }, payments: pay(60), user: db.users[1] });
  assert.deepStrictEqual(it.batches.map((b) => b.qty), [4, 0]); C.finalizeReturn(db, s.id, [{ idx: 0, qty: 2 }], db.users[1], {}); assert.strictEqual(it.batches.find((b) => b.batch === 'early').qty, 2); });
t('serial items: sale needs chosen serials; partial return restores selected', () => {
  const db = mk(); const it = db.items[2]; it.serialTracked = true; it.serials = ['A', 'B', 'C']; it.stock = 3;
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('c', 'G2', 2, 30)] }, payments: pay(60), user: db.users[1] }), /SERIAL_COUNT/);
  const s = C.finalizeSale(db, { cart: { lines: [Object.assign(line('c', 'G2', 2, 30), { serials: ['A', 'B'] })] }, payments: pay(60), user: db.users[1] });
  assert.deepStrictEqual(it.serials, ['C']); C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1, serials: ['B'] }], db.users[1], {}); assert.deepStrictEqual(it.serials, ['C', 'B']); assert.strictEqual(it.stock, 2); });

// ---- shift ----
t('shift: expected cash = open + cash sales - change - cash refunds + in - out; one open shift per user', () => {
  const db = mk(); const u = db.users[1]; const sh = C.openShift(db, u, 100, 'P1'); assert.throws(() => C.openShift(db, u, 0), /SHIFT_ALREADY_OPEN/);
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 3, 10)] }, payments: pay(50), user: u, shiftId: sh.id });
  C.finalizeSale(db, { cart: { lines: [line('b', 'G1', 2, 5)] }, payments: [{ method: 'card', amount: 10 }], user: u, shiftId: sh.id });
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { shiftId: sh.id, method: 'cash' });
  C.cashMove(db, sh, 'out', 20, 'supplier'); C.cashMove(db, sh, 'in', 5, 'float');
  const sum = C.shiftSummary(db, sh); assert.strictEqual(sum.expectedCash, 100 + 30 - 10 + 5 - 20); assert.strictEqual(sum.byMethod.card, 10);
  C.closeShift(db, sh, 105, 'ok'); assert.strictEqual(sh.diff, 0); });

t('cash-out approval: limit 0 always needs a manager, unset falls back to 200, managers never need one', () => {
  assert.strictEqual(C.cashOutNeedsApproval({ cashOutLimit: 0 }, 1, false), true);
  assert.strictEqual(C.cashOutNeedsApproval({}, 50, false), false);
  assert.strictEqual(C.cashOutNeedsApproval({}, 250, false), true);
  assert.strictEqual(C.cashOutNeedsApproval({ cashOutLimit: 100 }, 100, false), false);
  assert.strictEqual(C.cashOutNeedsApproval({ cashOutLimit: 100 }, 101, false), true);
  assert.strictEqual(C.cashOutNeedsApproval({ cashOutLimit: 0 }, 500, true), false); });

// ---- reports ----
t('slow-moving: 100-day old unsold flagged; recent sale & brand-new not flagged; sorted by value', () => {
  const db = mk(); const now = new Date('2026-06-01T10:00:00Z');
  db.items[0].created = '2026-01-01T00:00:00Z'; db.items[1].created = '2026-01-01T00:00:00Z'; db.items[1].lastSold = '2026-05-25T00:00:00Z';
  db.items[2].created = '2026-05-30T00:00:00Z';
  const r = C.slowMoving(db, 30, now); assert.deepStrictEqual(r.map((x) => x.itemId), ['a']); assert.strictEqual(r[0].stockValue, 600); });
t('weight barcode parse + EAN check + auto barcode unique', () => {
  const d12 = '2' + '000123' + '01250'; const full = d12 + C.ean13Check(d12); assert.strictEqual(full.length, 13);
  const p = C.parseWeightBarcode(full, S); assert.ok(p); assert.strictEqual(p.weightKg, 1.25); assert.strictEqual(p.pluNum, '123');
  assert.strictEqual(C.parseWeightBarcode('1234567890128', S), null);
  const db = mk(); const a = C.autoBarcode(db); db.items.push({ barcode: a }); assert.notStrictEqual(C.autoBarcode(db), a); assert.strictEqual(a.length, 13); });

// ---- exchange receipts, promo exchange-only, serial returns
const mkx = () => { const db = mk(); db.promos.push(b2g3); db.settings.returnDays = 7; return db; };
t('promo line: cash refund refused, exchange allowed, receipt valid for the configured window', () => {
  const db = mkx(); const u = db.users[1]; const now = new Date('2026-03-01T10:00:00');
  const s = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 5, 10)] }, payments: [{ method: 'cash', amount: 20 }], user: u }, now);
  assert.ok(s.lines[0].exchangeOnly);
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'cash' }, now), /PROMO_EXCHANGE_ONLY/);
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'credit' }, now);
  const rec = C.findExchangeReceipt(db, r.exchangeReceiptNo);
  assert.strictEqual(rec.amount, 4); assert.strictEqual(rec.expiresOn, '2026-03-08'); assert.strictEqual(rec.status, 'open');
  db.settings.returnDays = 30; const r2 = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'credit' }, now);
  assert.strictEqual(C.findExchangeReceipt(db, r2.exchangeReceiptNo).expiresOn, '2026-03-31');
  db.settings.returnDays = 0; const r3 = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'credit' }, now);
  assert.strictEqual(C.findExchangeReceipt(db, r3.exchangeReceiptNo).expiresOn, '');
});
t('percent discount line refunds the discounted price in cash', () => {
  const db = mkx(); const u = db.users[1];
  const s = C.finalizeSale(db, { cart: { lines: [Object.assign(line('b', 'G1', 2, 5), { manualPct: 20 })] }, payments: [{ method: 'cash', amount: 20 }], user: u });
  assert.ok(!s.lines[0].exchangeOnly);
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'cash' }); assert.strictEqual(r.refund, 4);
});
t('exchange receipt: redeem in a sale, split leftover, single use, expiry', () => {
  const db = mkx(); const u = db.users[1]; const now = new Date('2026-03-01T10:00:00');
  const s = C.finalizeSale(db, { cart: { lines: [line('c', 'G2', 1, 30)] }, payments: [{ method: 'cash', amount: 30 }], user: u }, now);
  const r = C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'credit' }, now);
  const no = r.exchangeReceiptNo;
  const s2 = C.finalizeSale(db, { cart: { lines: [line('b', 'G1', 2, 5)] }, payments: [], exchangeReceiptNo: no, user: u }, new Date('2026-03-02T10:00:00'));
  assert.strictEqual(s2.total, 10); assert.deepStrictEqual(s2.payments, [{ method: 'credit', amount: 10 }]); assert.strictEqual(s2.exchangeCredit.amount, 10);
  const left = C.findExchangeReceipt(db, s2.newExchangeReceipt); assert.strictEqual(left.amount, 20); assert.strictEqual(left.expiresOn, '2026-03-08');
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('b', 'G1', 1, 5)] }, payments: [], exchangeReceiptNo: no, user: u }), /EXR_USED/);
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('b', 'G1', 1, 5)] }, payments: [], exchangeReceiptNo: left.no, user: u }, new Date('2026-03-09T10:00:00')), /EXR_EXPIRED/);
  assert.throws(() => C.finalizeSale(db, { cart: { lines: [line('b', 'G1', 1, 5)] }, payments: [], exchangeReceiptNo: 'EXR-99999', user: u }), /EXR_MISSING/);
  // dearer replacement: 20 credit + 5 cash for 25
  const s3 = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 2, 10), line('b', 'G1', 1, 5)] }, payments: [{ method: 'cash', amount: 5 }], exchangeReceiptNo: left.no, user: u }, new Date('2026-03-03T10:00:00'));
  assert.strictEqual(s3.total, 25); assert.ok(!s3.newExchangeReceipt);
});
t('exchange credit does not move drawer cash', () => {
  const db = mkx(); const u = db.users[1]; const sh = C.openShift(db, u, 100, 'P');
  const s = C.finalizeSale(db, { cart: { lines: [line('c', 'G2', 1, 30)] }, payments: [{ method: 'cash', amount: 30 }], user: u, shiftId: sh.id });
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], u, { method: 'credit', shiftId: sh.id });
  assert.strictEqual(C.shiftSummary(db, sh).expectedCash, 130);
});
t('a returned serial cannot be returned twice (duplicate-serial hole)', () => {
  const db = mkx(); const u = db.users[1];
  db.items.push({ id: 's', barcode: '999', name: 'Phone', group: 'G3', cost: 50, price: 100, stock: 3, serialTracked: true, serials: ['S1', 'S2', 'S3'], batches: [] });
  const s = C.finalizeSale(db, { cart: { lines: [Object.assign(line('s', 'G3', 2, 100), { serials: ['S1', 'S2'] })] }, payments: [{ method: 'cash', amount: 200 }], user: u });
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1, serials: ['S1'] }], u, {});
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1, serials: ['S1'] }], u, {}), /SERIAL_ALREADY_RETURNED/);
  assert.throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1, serials: ['S3'] }], u, {}), /SERIAL_NOT_ON_SALE/);
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1, serials: ['S2'] }], u, {});
});
console.log(n + ' passed');
