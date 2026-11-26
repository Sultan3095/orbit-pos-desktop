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
  const db = mk(); db.users[0].role = 'system'; const res = C.parseSupplierRows([H, ['111', '', 10, 6, 0, '', '', '', 12], ['222', '', 5, 4, 0, '', '', '', ''], ['333', '', 2, 25, 10, '', '', '', '']], db.items);
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
  const db = mk(); db.users[0].role = 'system'; const res = C.parseSupplierRows([H, ['111', '', 2, 6], ['111', '', 3, 6]], db.items); assert.strictEqual(res.rows.length, 1); assert.strictEqual(res.rows[0].qty, 5); assert.strictEqual(res.warnings[0].code, 'MERGED'); });
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
  const db = mk(); db.users[0].role = 'system'; const res = C.parseSupplierRows([H, ['111', '', 10, 6]], db.items);
  const p = C.finalizePurchase(db, { lines: res.rows, supplierId: 's', invoiceNo: 'X' }, db.users[0]);
  assert.throws(() => C.finalizePurchase(db, { lines: res.rows, supplierId: 's', invoiceNo: 'X' }, db.users[0]), /DUP_INVOICE/);
  C.voidPurchase(db, p.id, db.users[0]); assert.strictEqual(db.items[0].stock, 100); });
t('purchase void blocked when stock already sold', () => {
  const db = mk(); db.users[0].role = 'system'; const res = C.parseSupplierRows([H, ['333', '', 5, 20]], db.items); const p = C.finalizePurchase(db, { lines: res.rows }, db.users[0]);
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
t('partial returns of one line never refund more than the line total (cent drift)', () => {
  const db = mk(); const u = db.users[0]; db.settings.returnWindowDays = 0;
  const sale = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 3, 3.33)], invPct: 7 }, payments: pay(100), user: db.users[1] });
  let sum = 0; for (let i = 0; i < 3; i++) sum = Math.round((sum + C.finalizeReturn(db, sale.id, [{ idx: 0, qty: 1 }], u, { method: 'cash' }).refund) * 100) / 100;
  assert.strictEqual(sum, sale.total);
});
t('void reverses loyalty: earned points removed, redeemed points returned', () => {
  const db = mk(); db.settings.loyaltyEnabled = true; db.settings.loyaltyEarnPerCurrency = 10; db.settings.loyaltyPointValue = 1;
  db.customers.push({ id: 'c1', name: 'X', points: 50 });
  const sale = C.finalizeSale(db, { cart: { lines: [line('a', 'G1', 5, 10)], redeemValue: 20 }, payments: pay(100), user: db.users[1], customerId: 'c1' });
  const mid = db.customers[0].points; assert.ok(mid !== 50);
  C.voidSale(db, sale.id, db.users[0], 'x'); assert.strictEqual(db.customers[0].points, 50);
});
t('problem check: finds missing manager, stale shift, bad prices, duplicate barcodes; ok when clean', () => {
  const db = C.newDB(); let ids = (r) => r.map((x) => x.id + ':' + x.level).join(' ');
  assert.ok(/noManager:bad/.test(ids(C.healthCheck(db, { backupAgeDays: 0 }))));
  db.users.push(C.makeUser('B', '1234', 'manager'));
  db.items.push({ id: 'a', barcode: '1', name: 'A', cost: 10, price: 5, stock: -1 }, { id: 'b', barcode: '1', name: 'B', cost: 1, price: 2, stock: 3 });
  const sh = C.openShift(db, db.users[0], 0, 'P'); sh.openedAt = new Date(Date.now() - 30 * 3600e3).toISOString();
  const r = ids(C.healthCheck(db, { backupAgeDays: null }));
  ['backupNever:bad', 'shiftStale:warn', 'negStock:warn', 'belowCost:warn', 'dupBarcode:bad'].forEach((x) => assert.ok(r.includes(x), x + ' in ' + r));
  assert.ok(ids(C.healthCheck(db, { backupAgeDays: 5 })).includes('backupOld:warn'));
});
t('demo catalogue: unique barcodes, price above cost, all flagged demo', () => {
  const it = C.sampleItems(); assert.strictEqual(it.length, 8);
  assert.strictEqual(new Set(it.map((i) => i.barcode)).size, 8); assert.ok(it.every((i) => i.price > i.cost && i.demo && i.nameEn && i.name));
});
console.log(n + ' passed');

// ---- PIN hashing (scrypt) ----
t('new users get a scrypt PIN hash, right PIN passes, wrong fails', () => {
  const u = C.makeUser('X', '4321', 'cashier');
  assert.ok(u.pinHash.startsWith('s1$') && u.pinHash.length > 60);
  assert.ok(C.checkPin(u, '4321')); assert.ok(!C.checkPin(u, '4322'));
});
t('same PIN, different users -> different hashes (random salt)', () => {
  assert.notStrictEqual(C.makeUser('A', '1111').pinHash, C.makeUser('B', '1111').pinHash);
});
t('old weak PIN hash still logs in once and is upgraded to scrypt', () => {
  const u = { id: 'u1', name: 'Old', role: 'manager', salt: 'abc12345', active: true, pinHash: C.hashPin('5555', 'abc12345') };
  assert.ok(!C.checkPin(u, '0000')); assert.ok(!u.pinHash.startsWith('s1$'));
  assert.ok(C.checkPin(u, '5555')); assert.ok(u.pinHash.startsWith('s1$')); assert.ok(C.checkPin(u, '5555')); assert.ok(!C.checkPin(u, '5556'));
});

// ---- defects found in the review ----
const mk2 = () => { const db = C.newDB(); const boss = C.makeUser('B', '1234', 'manager'), cash = C.makeUser('C', '0000', 'cashier'); db.users.push(boss, cash);
  db.items.push({ id: 'a', barcode: '111', name: 'A', cost: 6, price: 10, stock: 100, batches: [], serials: [] });
  const sh = C.openShift(db, cash, 100);
  const sale = (q, pay, extra) => C.finalizeSale(db, Object.assign({ cart: { lines: [{ itemId: 'a', qty: q, price: 10, group: '' }] }, payments: pay, user: cash, shiftId: sh.id }, extra || {}));
  return { db, boss, cash, sh, sale }; };
const throws = (f, code) => { try { f(); } catch (e) { assert.strictEqual(e.message, code); return; } assert.fail('expected ' + code); };
t('qty 0, negative or NaN is rejected (used to add stock / poison it with NaN)', () => {
  const { db, sale } = mk2();
  throws(() => sale(0, [{ method: 'cash', amount: 0 }]), 'BAD_QTY'); throws(() => sale(-2, [{ method: 'cash', amount: 0 }]), 'BAD_QTY'); throws(() => sale(NaN, [{ method: 'cash', amount: 0 }]), 'BAD_QTY');
  assert.strictEqual(db.items[0].stock, 100); assert.strictEqual(db.sales.length, 0);
});
t('negative / NaN payment amounts are rejected', () => {
  const { sale } = mk2(); throws(() => sale(1, [{ method: 'cash', amount: 20 }, { method: 'card', amount: -10 }]), 'BAD_PAYMENT');
  throws(() => sale(1, [{ method: 'cash', amount: NaN }]), 'BAD_PAYMENT');
});
t('no sale or cash move on a closed shift', () => {
  const { db, cash, sh, sale } = mk2(); sale(1, [{ method: 'cash', amount: 10 }]); C.closeShift(db, sh, 110, '');
  throws(() => sale(1, [{ method: 'cash', amount: 10 }]), 'SHIFT_CLOSED'); throws(() => C.cashMove(db, sh, 'out', 5, 'x'), 'SHIFT_CLOSED');
});
t('return qty NaN is rejected', () => {
  const { db, cash, sale } = mk2(); const s = sale(2, [{ method: 'cash', amount: 20 }]);
  throws(() => C.finalizeReturn(db, s.id, [{ idx: 0, qty: NaN }], cash, { method: 'cash' }), 'QTY_EXCEEDS');
});
t('voiding a sale paid with an exchange receipt gives the credit back; leftover receipt is cancelled', () => {
  const { db, boss, cash, sh, sale } = mk2(); const s1 = sale(1, [{ method: 'cash', amount: 10 }]);
  C.finalizeReturn(db, s1.id, [{ idx: 0, qty: 1 }], cash, { method: 'credit', shiftId: sh.id }); const no = db.exchangeReceipts[0].no;
  const s2 = sale(0.5, [], { exchangeReceiptNo: no }); assert.strictEqual(db.exchangeReceipts[0].status, 'redeemed'); assert.ok(s2.newExchangeReceipt);
  C.voidSale(db, s2.id, boss, 'oops');
  assert.strictEqual(db.exchangeReceipts[0].status, 'open'); assert.strictEqual(C.findExchangeReceipt(db, s2.newExchangeReceipt).status, 'cancelled');
  sale(1, [], { exchangeReceiptNo: no }); // usable again
});
t('return window 0 = no limit for cashiers too (was: every return needed a manager)', () => {
  const { db, cash, sale } = mk2(); db.settings.returnDays = 0; const s = sale(1, [{ method: 'cash', amount: 10 }]);
  s.ts = new Date(Date.now() - 400 * 86400000).toISOString(); assert.ok(C.canReturn(db, s, cash).ok);
  db.settings.returnDays = 7; assert.strictEqual(C.canReturn(db, s, cash).code, 'WINDOW');
});

// ---- roles & permissions ----
t('default matrix: cashier limited, manager no cost, system everything', () => {
  const db = C.newDB(); const cs = { role: 'cashier' }, mg = { role: 'manager' }, sy = { role: 'system' };
  assert.strictEqual(C.perm(db, cs, 'discountAbove'), 'A'); assert.strictEqual(C.perm(db, cs, 'editItems'), 'N'); assert.strictEqual(C.perm(db, cs, 'sell'), 'Y');
  assert.strictEqual(C.perm(db, mg, 'seeCost'), 'N'); assert.strictEqual(C.perm(db, mg, 'reports'), 'Y'); assert.strictEqual(C.perm(db, mg, 'settings'), 'N'); assert.strictEqual(C.perm(db, mg, 'editInvoice'), 'Y');
  C.PERMS.forEach((p) => assert.strictEqual(C.perm(db, sy, p[0]), 'Y')); assert.strictEqual(C.perm(db, sy, 'nonsense'), 'N');
});
t('system manager can change the matrix; system itself cannot be locked out', () => {
  const db = C.newDB(); C.upgradeRoles(db); db.settings.permissions.cashier.priceOverride = 'Y'; db.settings.permissions.manager.seeCost = 'Y'; db.settings.permissions.system.settings = 'N';
  assert.strictEqual(C.perm(db, { role: 'cashier' }, 'priceOverride'), 'Y'); assert.strictEqual(C.perm(db, { role: 'manager' }, 'seeCost'), 'Y'); assert.strictEqual(C.perm(db, { role: 'system' }, 'settings'), 'Y');
});
t('upgrade: first manager becomes System manager, others stay managers, missing switches are filled', () => {
  const db = C.newDB(); db.users.push(C.makeUser('Owner', '1', 'manager'), C.makeUser('Mgr2', '2', 'manager'), C.makeUser('C', '3', 'cashier'));
  assert.strictEqual(C.upgradeRoles(db), 'Owner'); assert.deepStrictEqual(db.users.map((u) => u.role), ['system', 'manager', 'cashier']); assert.strictEqual(C.upgradeRoles(db), null);
  assert.ok(db.settings.permissions.manager.reports);
});
t('return after window follows the role: cashier needs approval, manager passes, role set to N is blocked', () => {
  const { db, cash, sale } = mk2(); db.settings.returnDays = 7; const s = sale(1, [{ method: 'cash', amount: 10 }]); s.ts = new Date(Date.now() - 30 * 86400000).toISOString();
  const mg = { role: 'manager', id: 'm' }; C.upgradeRoles(db);
  assert.strictEqual(C.canReturn(db, s, cash).code, 'WINDOW'); assert.ok(C.canReturn(db, s, mg).ok);
  db.settings.permissions.cashier.returnAfterWindow = 'N'; assert.strictEqual(C.canReturn(db, s, cash).code, 'WINDOW_BLOCKED');
});

// ---- edit invoice (revision) ----
const mkEdit = () => { const e = mk2(); C.upgradeRoles(e.db); e.boss.role = 'system'; return e; };
t('edit in an OPEN shift: quantity change recalculates total, stock, payments; revision + audit log kept', () => {
  const { db, boss, cash, sh, sale } = mkEdit(); const s = sale(2, [{ method: 'cash', amount: 20 }]); const stock0 = db.items[0].stock;
  assert.throws(() => C.editSale(db, s.id, { reason: 'x', lines: [{ idx: 0, qty: 3 }] }, cash), /MANAGER_ONLY/);
  throws(() => C.editSale(db, s.id, { reason: '', lines: [{ idx: 0, qty: 3 }] }, boss), 'EDIT_REASON');
  const r = C.editSale(db, s.id, { reason: 'customer took 3', lines: [{ idx: 0, qty: 3 }] }, boss);
  assert.strictEqual(s.total, 30); assert.strictEqual(db.items[0].stock, stock0 - 1); assert.strictEqual(s.payments[0].amount, 30); assert.strictEqual(s.rev, 1);
  assert.strictEqual(s.revisions[0].before.total, 20); assert.strictEqual(db.edits.length, 1); assert.strictEqual(db.edits[0].after.total, 30); assert.strictEqual(r.cashDiff, 10);
  assert.strictEqual(C.shiftSummary(db, sh).expectedCash, 130);
});
t('edit after the shift is CLOSED: closed Z unchanged, cash difference booked in the editor\'s open shift, never a void', () => {
  const { db, boss, cash, sh, sale } = mkEdit(); const s = sale(2, [{ method: 'cash', amount: 20 }]); C.closeShift(db, sh, 120, '');
  throws(() => C.voidSale(db, s.id, boss, 'oops'), 'VOID_CLOSED_SHIFT');
  throws(() => C.editSale(db, s.id, { reason: 'wrong qty', lines: [{ idx: 0, qty: 1 }] }, boss), 'EDIT_NEEDS_OPEN_SHIFT');
  const sh2 = C.openShift(db, boss, 50); const r = C.editSale(db, s.id, { reason: 'wrong qty', lines: [{ idx: 0, qty: 1 }] }, boss);
  assert.strictEqual(r.cashDiff, -10); assert.strictEqual(C.shiftSummary(db, sh).expectedCash, 120); assert.strictEqual(sh.expectedCash, 120);
  assert.strictEqual(sh2.moves.length, 1); assert.strictEqual(sh2.moves[0].kind, 'out'); assert.strictEqual(sh2.moves[0].amount, 10); assert.strictEqual(C.shiftSummary(db, sh2).expectedCash, 40);
  assert.strictEqual(C.salesReport(db, C.today(), C.today()).net, 10); // reports show the corrected invoice
});
t('edit is blocked for invoices with returns or exchange receipts, promos or serials; bad input changes nothing', () => {
  const { db, boss, cash, sh, sale } = mkEdit(); const s = sale(2, [{ method: 'cash', amount: 20 }]); const stock0 = db.items[0].stock;
  throws(() => C.editSale(db, s.id, { reason: 'abc', lines: [{ idx: 0, qty: NaN }] }, boss), 'BAD_QTY'); throws(() => C.editSale(db, s.id, { reason: 'abc', lines: [{ idx: 0, qty: 500 }] }, boss), 'NO_STOCK');
  assert.strictEqual(db.items[0].stock, stock0); assert.strictEqual(s.total, 20); assert.strictEqual(db.edits.length, 0);
  C.finalizeReturn(db, s.id, [{ idx: 0, qty: 1 }], cash, { method: 'cash', shiftId: sh.id }); throws(() => C.editSale(db, s.id, { reason: 'abc', lines: [{ idx: 0, qty: 1 }] }, boss), 'EDIT_HAS_RETURNS');
});
t('edit can change customer and payment split without touching items', () => {
  const { db, boss, sale } = mkEdit(); const s = sale(2, [{ method: 'cash', amount: 20 }]);
  C.editSale(db, s.id, { reason: 'paid by card', payments: [{ method: 'card', amount: 20 }], customerId: 'c1', customerName: 'Ahmed' }, boss);
  assert.strictEqual(s.payments[0].method, 'card'); assert.strictEqual(s.customerName, 'Ahmed'); assert.strictEqual(db.items[0].stock, 98);
});

t('two cashiers run overlapping shifts without touching each other', () => {
  const { db, cash, sh, sale } = mk2(); const c2 = C.makeUser('C2', '1111', 'cashier'); db.users.push(c2); const sh2 = C.openShift(db, c2, 200);
  throws(() => C.openShift(db, c2, 1), 'SHIFT_ALREADY_OPEN');
  sale(1, [{ method: 'cash', amount: 10 }]); C.finalizeSale(db, { cart: { lines: [{ itemId: 'a', qty: 3, price: 10, group: '' }] }, payments: [{ method: 'cash', amount: 30 }], user: c2, shiftId: sh2.id });
  assert.strictEqual(C.shiftSummary(db, sh).expectedCash, 110); assert.strictEqual(C.shiftSummary(db, sh2).expectedCash, 230);
  C.closeShift(db, sh, 110, ''); assert.ok(!sh2.closedAt); assert.strictEqual(C.shiftSummary(db, sh2).expectedCash, 230);
});

t('blind close: saved and locked, expected hidden until a manager approves; self-approval and cashier approval refused', () => {
  const { db, boss, cash, sh, sale } = mk2(); C.upgradeRoles(db); sale(2, [{ method: 'cash', amount: 20 }]);
  C.closeShift(db, sh, 115, '', { blind: true });
  assert.strictEqual(sh.approval, 'pending'); assert.ok(sh.closedAt); assert.strictEqual(sh.expectedCash, undefined); assert.strictEqual(sh.diff, undefined);
  throws(() => C.finalizeSale(db, { cart: { lines: [{ itemId: 'a', qty: 1, price: 10, group: '' }] }, payments: [{ method: 'cash', amount: 10 }], user: cash, shiftId: sh.id }), 'SHIFT_CLOSED');
  assert.ok(C.openShift(db, cash, 50)); // the cashier can start a new shift right away
  throws(() => C.approveClose(db, sh, cash, ''), 'MANAGER_ONLY');
  const v = C.pendingCloseView(db, sh); assert.strictEqual(v.expectedCash, 120); assert.strictEqual(v.countedCash, 115); assert.strictEqual(v.diff, -5);
  throws(() => C.approveClose(db, sh, boss, ''), 'DIFF_NOTE');
  C.approveClose(db, sh, boss, 'counted again, 5 short'); assert.strictEqual(sh.approval, 'approved'); assert.strictEqual(sh.expectedCash, 120); assert.strictEqual(sh.diff, -5); assert.strictEqual(sh.approvedBy, 'B'); assert.strictEqual(sh._sealed, undefined);
  throws(() => C.approveClose(db, sh, boss, ''), 'NOT_PENDING');
});
t('normal (non-blind) close closes at once; approver cannot approve his own blind close', () => {
  const { db, boss, sh } = mk2(); C.upgradeRoles(db); const bs = C.openShift(db, boss, 10); C.closeShift(db, bs, 10, ''); assert.strictEqual(bs.approval, 'auto'); assert.strictEqual(bs.diff, 0);
  const s2 = C.openShift(db, boss, 10); C.closeShift(db, s2, 10, '', { blind: true }); throws(() => C.approveClose(db, s2, boss, ''), 'SELF_APPROVE');
});

// ---- gift cards and coupons ----
const gk = () => { const db = mk(); C.upgradeRoles(db); const [boss, cash] = db.users; const sh = C.openShift(db, cash, 100); return { db, boss, cash, sh }; };
const sellG = (x, amt, extra) => C.sellGiftCard(x.db, Object.assign({ amount: amt, payments: [{ method: 'cash', amount: amt }], user: x.cash, shiftId: x.sh.id }, extra || {}));
const buy = (x, qty, payments, extra) => C.finalizeSale(x.db, Object.assign({ cart: Object.assign({ lines: [line('a', 'G1', qty, 10)] }, (extra && extra.cart) || {}), payments, user: x.cash, shiftId: x.sh.id }, Object.assign({}, extra, { cart: undefined }, (extra && extra.cart) ? { cart: Object.assign({ lines: [line('a', 'G1', qty, 10)] }, extra.cart) } : {})));
t('gift card sale: card issued, not revenue, cash counted in the drawer', () => {
  const x = gk(); const r = sellG(x, 100);
  assert.strictEqual(r.card.balance, 100); assert.strictEqual(r.sale.type, 'giftsale'); assert.strictEqual(r.sale.tax, 0);
  const rep = C.salesReport(x.db, '2000-01-01', '2999-01-01'); assert.strictEqual(rep.total, 0); assert.strictEqual(rep.count, 0);
  const sum = C.shiftSummary(x.db, x.sh); assert.strictEqual(sum.salesTotal, 0); assert.strictEqual(sum.giftSoldTotal, 100); assert.strictEqual(sum.expectedCash, 200);
  assert.deepStrictEqual(C.giftLiability(x.db), { open: 100, expired: 0, count: 1 });
});
t('gift card sale: pre-printed number, duplicate number, bad amount, short payment', () => {
  const x = gk(); sellG(x, 50, { no: 'card-0001' }); assert.ok(C.findGiftCard(x.db, 'CARD-0001'));
  throws(() => sellG(x, 50, { no: 'CARD-0001' }), 'GIFT_EXISTS'); throws(() => sellG(x, 0), 'GIFT_BAD_AMOUNT');
  throws(() => C.sellGiftCard(x.db, { amount: 100, payments: [{ method: 'cash', amount: 60 }], user: x.cash, shiftId: x.sh.id }), 'UNDERPAID');
  throws(() => C.sellGiftCard(x.db, { amount: 100, payments: [{ method: 'gift', amount: 100 }], user: x.cash, shiftId: x.sh.id }), 'GIFT_PAY_WITH_CREDIT');
});
t('gift card redeem: partial then full, balance and history tracked', () => {
  const x = gk(); const g = sellG(x, 100).card;
  const s1 = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 4, 10)] }, payments: [], giftCardNo: g.no, user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(s1.giftCard.amount, 40); assert.strictEqual(g.balance, 60); assert.strictEqual(s1.paid, 40);
  const s2 = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)] }, payments: [{ method: 'cash', amount: 40 }], giftCardNo: g.no, user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(s2.giftCard.amount, 60); assert.strictEqual(g.balance, 0); assert.strictEqual(g.log.length, 3);
  throws(() => C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 1, 10)] }, payments: [], giftCardNo: g.no, user: x.cash, shiftId: x.sh.id }), 'GIFT_EMPTY');
});
t('gift card redeem: cap by giftAmount, cash makes up the rest, shortfall is UNDERPAID', () => {
  const x = gk(); const g = sellG(x, 100).card;
  throws(() => C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)] }, payments: [], giftCardNo: g.no, giftAmount: 30, user: x.cash, shiftId: x.sh.id }), 'UNDERPAID');
  assert.strictEqual(g.balance, 100); // a failed sale leaves the card untouched
  const s = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)] }, payments: [{ method: 'cash', amount: 70 }], giftCardNo: g.no, giftAmount: 30, user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(g.balance, 70); assert.strictEqual(s.giftCard.amount, 30);
});
t('gift card: missing, expired, void are refused', () => {
  const x = gk(); throws(() => C.checkGiftCard(x.db, 'NOPE'), 'GIFT_MISSING');
  const g = sellG(x, 100, { expiresOn: '2999-01-01' }).card; assert.ok(C.checkGiftCard(x.db, g.no));
  g.expiresOn = '2000-01-01'; throws(() => C.checkGiftCard(x.db, g.no), 'GIFT_EXPIRED'); assert.strictEqual(C.giftLiability(x.db).expired, 100);
  C.extendGiftCard(x.db, g.no, x.boss, '2999-01-01'); assert.ok(C.checkGiftCard(x.db, g.no));
  throws(() => C.sellGiftCard(x.db, { amount: 10, expiresOn: '2000-01-01', payments: [{ method: 'cash', amount: 10 }], user: x.cash, shiftId: x.sh.id }), 'GIFT_BAD_EXPIRY');
});
t('gift card: void a sale puts the balance back; return refunds to the card pro-rata', () => {
  const x = gk(); const g = sellG(x, 100).card;
  const s = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)] }, payments: [{ method: 'cash', amount: 50 }], giftCardNo: g.no, giftAmount: 50, user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(g.balance, 50);
  const r = C.finalizeReturn(x.db, s.id, [{ idx: 0, qty: 5 }], x.boss, { shiftId: x.sh.id });
  assert.strictEqual(r.refund, 50); assert.strictEqual(r.giftRefund, 25); assert.strictEqual(g.balance, 75);
  const sum = C.shiftSummary(x.db, x.sh); assert.strictEqual(sum.refunds.cash, 25); assert.strictEqual(sum.refunds.gift, 25);
  const y = gk(); const g2 = sellG(y, 100).card;
  const s2 = C.finalizeSale(y.db, { cart: { lines: [line('a', 'G1', 4, 10)] }, payments: [], giftCardNo: g2.no, user: y.cash, shiftId: y.sh.id });
  C.voidSale(y.db, s2.id, y.boss, 'x'); assert.strictEqual(g2.balance, 100);
  assert.ok(C.editBlockers(x.db, s).includes('EDIT_HAS_GIFT'));
});
t('gift card: void only when unused', () => {
  const x = gk(); const g = sellG(x, 100).card; const g2 = sellG(x, 50).card;
  C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 1, 10)] }, payments: [], giftCardNo: g.no, user: x.cash, shiftId: x.sh.id });
  throws(() => C.voidGiftCard(x.db, g.no, x.boss, 'r'), 'GIFT_ALREADY_USED'); throws(() => C.voidGiftCard(x.db, g2.no, x.cash, 'r'), 'MANAGER_ONLY');
  C.voidGiftCard(x.db, g2.no, x.boss, 'sold by mistake'); assert.strictEqual(g2.status, 'void'); assert.strictEqual(C.shiftSummary(x.db, x.sh).giftSoldTotal, 100);
  throws(() => C.checkGiftCard(x.db, g2.no), 'GIFT_VOID');
});
const cpnDb = () => { const x = gk(); C.saveCoupon(x.db, { code: 'save10', kind: 'percent', value: 10 }); return x; };
t('coupon percent: discounts the invoice, lines become exchange-only, usage counted, void gives it back', () => {
  const x = cpnDb(); const s = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)], coupon: { code: 'SAVE10' } }, payments: [{ method: 'cash', amount: 90 }], user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(s.total, 90); assert.strictEqual(s.coupon.amount, 10); assert.ok(s.lines[0].exchangeOnly); assert.strictEqual(C.findCoupon(x.db, 'save10').used, 1);
  C.voidSale(x.db, s.id, x.boss, 'x'); assert.strictEqual(C.findCoupon(x.db, 'SAVE10').used, 0);
});
t('coupon amount sits on top of an invoice promo and never exceeds the total', () => {
  const x = gk(); C.saveCoupon(x.db, { code: 'OFF500', kind: 'amount', value: 500 });
  const r = C.computeCart({ lines: [line('a', 'G1', 2, 10)], coupon: C.findCoupon(x.db, 'OFF500') }, [], S); assert.strictEqual(r.total, 0);
  C.saveCoupon(x.db, { code: 'OFF5', kind: 'amount', value: 5 });
  const p = { id: 'i', name: 'i', type: 'invoice_pct', scope: { type: 'all' }, params: { percent: 10 } };
  const r2_ = C.computeCart({ lines: [line('a', 'G1', 10, 10)], coupon: C.findCoupon(x.db, 'OFF5') }, [p], S); assert.strictEqual(r2_.total, 85);
});
t('coupon rules: min total, validity, usage limits, per customer', () => {
  const x = gk(); const mkc = (o) => C.saveCoupon(x.db, Object.assign({ code: 'C' + Math.random().toString(36).slice(2, 7), kind: 'amount', value: 5 }, o));
  throws(() => C.checkCoupon(x.db, 'NOPE'), 'COUPON_MISSING');
  const cm = mkc({ minTotal: 200 }); throws(() => C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)], coupon: { code: cm.code } }, payments: [{ method: 'cash', amount: 100 }], user: x.cash, shiftId: x.sh.id }), 'COUPON_MIN_TOTAL');
  throws(() => C.checkCoupon(x.db, mkc({ endDate: '2000-01-01' }).code), 'COUPON_EXPIRED'); throws(() => C.checkCoupon(x.db, mkc({ startDate: '2999-01-01' }).code), 'COUPON_NOT_STARTED');
  throws(() => C.checkCoupon(x.db, mkc({ active: false }).code), 'COUPON_INACTIVE');
  const one = mkc({ maxUses: 1 }); C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 2, 10)], coupon: { code: one.code } }, payments: [{ method: 'cash', amount: 15 }], user: x.cash, shiftId: x.sh.id });
  throws(() => C.checkCoupon(x.db, one.code), 'COUPON_USED_UP');
  const pc = mkc({ maxPerCustomer: 1 }); throws(() => C.checkCoupon(x.db, pc.code, {}), 'COUPON_NEEDS_CUSTOMER');
  x.db.customers.push({ id: 'cu1', name: 'Z', points: 0 }); C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 2, 10)], coupon: { code: pc.code } }, payments: [{ method: 'cash', amount: 15 }], customerId: 'cu1', user: x.cash, shiftId: x.sh.id });
  throws(() => C.checkCoupon(x.db, pc.code, { customerId: 'cu1' }), 'COUPON_CUSTOMER_LIMIT'); assert.ok(C.checkCoupon(x.db, pc.code, { customerId: 'cu2' }));
  throws(() => C.saveCoupon(x.db, { code: 'x', kind: 'percent', value: 5 }), 'COUPON_BAD_CODE'); throws(() => C.saveCoupon(x.db, { code: 'ABC', kind: 'percent', value: 150 }), 'COUPON_BAD_VALUE');
});
t('coupon plus gift card in one sale', () => {
  const x = cpnDb(); const g = sellG(x, 100).card;
  const s = C.finalizeSale(x.db, { cart: { lines: [line('a', 'G1', 10, 10)], coupon: { code: 'SAVE10' } }, payments: [], giftCardNo: g.no, user: x.cash, shiftId: x.sh.id });
  assert.strictEqual(s.total, 90); assert.strictEqual(s.giftCard.amount, 90); assert.strictEqual(g.balance, 10);
});

t('theme: user choice wins, then store setting, then brand; old blue is brand', () => {
  assert.strictEqual(C.themeOf({ theme: 'light' }, { theme: 'galaxy' }), 'galaxy');
  assert.strictEqual(C.themeOf({ theme: 'dark' }, {}), 'dark');
  assert.strictEqual(C.themeOf({}, null), 'brand');
  assert.strictEqual(C.themeOf({ theme: 'blue' }, null), 'brand');
  assert.strictEqual(C.themeOf({ theme: 'nonsense' }, { theme: 'x' }), 'brand');
  assert.strictEqual(C.newDb ? C.newDb().settings.theme : 'brand', 'brand');
});

// ---- gift card per-denomination, shift block, write-off, printed batch ----
t('gift cards by denomination: counts and open balance per value; voided cards left out', () => {
  const x = gk(); const a = sellG(x, 200).card; sellG(x, 200); sellG(x, 500); const v = sellG(x, 500).card; C.voidGiftCard(x.db, v.no, x.boss, 'x');
  buy(x, 5, [{ method: 'cash', amount: 0 }], { cart: {}, giftCardNo: a.no, giftAmount: 50 });
  const d = C.giftByDenomination(x.db); const r200 = d.rows.find((r) => r.value === 200), r500 = d.rows.find((r) => r.value === 500);
  assert.strictEqual(r200.sold, 2); assert.strictEqual(r200.partly, 1); assert.strictEqual(r200.untouched, 1); assert.strictEqual(r200.openBalance, 350);
  assert.strictEqual(r500.sold, 1); assert.strictEqual(d.total.sold, 3);
});
t('shift summary: cards sold per value, cash value, redemption moves no cash', () => {
  const x = gk(); sellG(x, 200); sellG(x, 200); const c = sellG(x, 1000, { payments: [{ method: 'card', amount: 1000 }] }).card;
  let sum = C.shiftSummary(x.db, x.sh);
  assert.deepStrictEqual(sum.giftByValue, [{ value: 200, count: 2, total: 400 }, { value: 1000, count: 1, total: 1000 }]);
  assert.strictEqual(sum.giftSoldCash, 400); assert.strictEqual(sum.expectedCash, 500);
  buy(x, 5, [{ method: 'cash', amount: 0 }], { cart: {}, giftCardNo: c.no, giftAmount: 50 });
  sum = C.shiftSummary(x.db, x.sh); assert.strictEqual(sum.giftRedeemed, 50); assert.strictEqual(sum.expectedCash, 500);
});
t('gift card write-off: manager only, expired only, reason needed, leaves the open liability, card unusable', () => {
  const x = gk(); const g = sellG(x, 300, { expiresOn: '2999-01-01' }).card;
  throws(() => C.giftWriteOff(x.db, g.no, x.boss, 'old'), 'GIFT_NOT_EXPIRED');
  g.expiresOn = '2000-01-01';
  throws(() => C.giftWriteOff(x.db, g.no, x.cash, 'old'), 'MANAGER_ONLY'); throws(() => C.giftWriteOff(x.db, g.no, x.boss, ' '), 'GIFT_REASON');
  const r = C.giftWriteOff(x.db, g.no, x.boss, 'expired for a year'); assert.strictEqual(r.amount, 300);
  assert.deepStrictEqual(C.giftLiability(x.db), { open: 0, expired: 0, count: 0 }); assert.strictEqual(x.db.giftWriteOffs.length, 1);
  throws(() => C.checkGiftCard(x.db, g.no), 'GIFT_WRITTEN_OFF'); throws(() => C.giftWriteOff(x.db, g.no, x.boss, 'again'), 'GIFT_WRITTEN_OFF');
  const d = C.giftByDenomination(x.db).rows[0]; assert.strictEqual(d.writtenOffCount, 1); assert.strictEqual(d.writtenOffTotal, 300);
});
t('printed gift card batch: unique numbers, sale must match the printed value', () => {
  const x = gk(); const rows = C.giftPrintBatch(x.db, 500, 12); assert.strictEqual(new Set(rows.map((r) => r.no)).size, 12);
  throws(() => C.giftPrintBatch(x.db, 500, 0), 'GIFT_BAD_QTY'); throws(() => C.giftPrintBatch(x.db, 0, 5), 'GIFT_BAD_AMOUNT');
  throws(() => sellG(x, 200, { no: rows[0].no }), 'GIFT_PRINTED_VALUE'); const g = sellG(x, 500, { no: rows[0].no }).card; assert.strictEqual(g.no, rows[0].no);
  throws(() => sellG(x, 500, { no: rows[0].no }), 'GIFT_EXISTS');
});
