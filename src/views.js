/* Orbit POS screens: items, purchases, promotions, people, history, shift, reports, settings */
'use strict';
const Views = {};
window.Views = Views;
const head = (title, extra) => '<div class="page-h"><h2>' + title + '</h2><div class="row">' + (extra || '') + '</div></div>';
const table = (cols, rows, cls) => '<div class="tbl-wrap"><table class="tbl ' + (cls || '') + '"><thead><tr>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + cols.length + '" class="empty">' + t('none') + '</td></tr>') + '</tbody></table></div>';
async function exportRows(name, rows, widths) { const p = await window.api.saveSheet(name, rows, widths); if (p) toast(t('saved') + ': ' + p); }

// ---------------- Items ----------------
Views.items = function (m) {
  const st = App.edit || (App.edit = {}); st.q = st.q || ''; st.filter = st.filter || 'all';
  const draw = () => {
    const q = st.q.toLowerCase();
    let rows = App.db.items.filter((i) => (!q || i.barcode.includes(q) || i.name.toLowerCase().includes(q) || (i.nameEn || '').toLowerCase().includes(q) || (i.group || '').toLowerCase().includes(q)));
    if (st.filter === 'noprice') rows = rows.filter((i) => !(i.price > 0)); else if (st.filter === 'low') rows = rows.filter((i) => !i.service && i.stock <= (i.minStock || 0));
    $('#itbody', m).innerHTML = table([t('barcode'), t('name'), t('group'), t('cost'), t('price'), t('margin'), t('stock'), ''], rows.slice(0, 400).map((i) => {
      const mg = i.price > 0 && i.cost > 0 ? Math.round((i.price - i.cost) / i.cost * 100) + '%' : '-';
      return '<tr class="' + (i.active === false ? 'dim' : '') + '"><td>' + esc(i.barcode) + '</td><td>' + esc(i.name) + (i.nameEn ? '<small class="muted"> · ' + esc(i.nameEn) + '</small>' : '') + (i.batchTracked ? ' <span class="tag">B</span>' : '') + (i.serialTracked ? ' <span class="tag">SN</span>' : '') + (i.byWeight ? ' <span class="tag">kg</span>' : '') + '</td><td>' + esc(i.group || '') + '</td><td>' + money(i.cost) + '</td><td class="' + (i.price > 0 ? '' : 'bad') + '">' + money(i.price) + '</td><td>' + mg + '</td><td class="' + (!i.service && i.stock <= (i.minStock || 0) ? 'bad' : '') + '">' + (i.service ? '∞' : i.stock) + '</td><td class="nw"><button class="btn sm" data-edit="' + i.id + '">✎</button> <button class="btn sm" data-adj="' + i.id + '">±</button></td></tr>';
    }));
    $('#itcount', m).textContent = rows.length + ' / ' + App.db.items.length;
  };
  m.innerHTML = head(t('nav_items'), '<button class="btn primary" id="i-add">+ ' + t('addItem') + '</button><button class="btn" id="i-margin">% ' + t('setByMargin') + '</button><button class="btn" id="i-exp">⬇ Excel</button>') +
    '<div class="bar"><input id="i-q" placeholder="' + t('search') + '" value="' + esc(st.q) + '"><select id="i-f"><option value="all">' + t('all') + '</option><option value="noprice">' + t('noPrice') + '</option><option value="low">' + t('lowStock') + '</option></select><span class="muted" id="itcount"></span></div><div id="itbody"></div>';
  $('#i-f', m).value = st.filter; draw();
  m.oninput = (e) => { if (e.target.id === 'i-q') { st.q = e.target.value; draw(); } };
  m.onchange = (e) => { if (e.target.id === 'i-f') { st.filter = e.target.value; draw(); } };
  m.onclick = (e) => {
    if (e.target.id === 'i-add') itemModal(null, () => Views.items(m)); const ed = e.target.closest('[data-edit]'); if (ed) itemModal(App.db.items.find((x) => x.id === ed.dataset.edit), () => draw());
    const ad = e.target.closest('[data-adj]'); if (ad) stockAdjust(App.db.items.find((x) => x.id === ad.dataset.adj), draw);
    if (e.target.id === 'i-margin') marginModal(draw);
    if (e.target.id === 'i-exp') exportRows('items.xlsx', [[t('barcode'), t('name'), 'Name EN', t('group'), t('cost'), t('price'), t('stock')]].concat(App.db.items.map((i) => [i.barcode, i.name, i.nameEn || '', i.group || '', i.cost, i.price, i.stock])), [16, 30, 30, 16, 10, 10, 10]);
  };
};
function itemModal(it, done) {
  const isNew = !it; it = it || { barcode: '', name: '', nameEn: '', group: '', unit: '', cost: 0, price: 0, stock: 0, minStock: App.db.settings.lowStockDefault };
  const groups = Array.from(new Set(App.db.items.map((i) => i.group).filter(Boolean)));
  const fields = [{ k: 'barcode', label: t('barcode'), first: true }, { k: 'name', label: t('name') }, { k: 'nameEn', label: t('nameEn') }, { k: 'group', label: t('group'), ph: groups.slice(0, 4).join(', ') }, { k: 'unit', label: t('unit') },
    { k: 'cost', label: t('cost'), type: 'number', step: 'any' }, { k: 'price', label: t('price'), type: 'number', step: 'any' }, { k: 'minStock', label: t('minStock'), type: 'number', step: 'any' }, { k: 'plu', label: t('plu'), ph: t('pluHint') }]
    .concat(isNew ? [{ k: 'stock', label: t('openingStock'), type: 'number', step: 'any' }] : [])
    .concat([{ k: 'byWeight', type: 'check', label: '', hint: t('byWeight') }, { k: 'taxExempt', type: 'check', label: '', hint: t('taxExempt') }, { k: 'service', type: 'check', label: '', hint: t('serviceItem') }, { k: 'serialTracked', type: 'check', label: '', hint: t('serialTracked') }, { k: 'active', type: 'check', label: '', hint: t('active'), def: true }]);
  const vals = Object.assign({}, it, { active: it.active !== false });
  const m = modal({ title: isNew ? t('addItem') : t('editItem'), cls: 'wide', body: '<div class="grid3">' + form(fields, vals) + '</div><button class="btn sm" id="gen">⚙ ' + t('autoBarcode') + '</button>',
    buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: (w) => {
      const v = readForm(w, fields); v.barcode = Core.normDigits(v.barcode);
      if (!v.name) { toast(t('nameRequired'), 'err'); return false; } if (!v.barcode) v.barcode = Core.autoBarcode(App.db);
      if (App.db.items.some((x) => x.barcode === v.barcode && x !== it)) { toast(t('barcodeExists'), 'err'); return false; }
      if ((v.cost || 0) < 0 || (v.price || 0) < 0) { toast(t('invalidValue'), 'err'); return false; }
      Object.assign(it, { barcode: v.barcode, name: v.name, nameEn: v.nameEn, group: v.group, unit: v.unit, cost: v.cost || 0, price: v.price || 0, minStock: v.minStock == null ? 0 : v.minStock, plu: v.plu, byWeight: v.byWeight, taxExempt: v.taxExempt, service: v.service, serialTracked: v.serialTracked || it.serialTracked && (it.serials || []).length > 0, active: v.active });
      if (isNew) { Object.assign(it, { id: Core.uid('it'), stock: v.stock || 0, batches: [], serials: [], batchTracked: false, created: new Date().toISOString() }); App.db.items.push(it); }
      save(); done(); } }], enter: 1 });
  m.addEventListener('click', (e) => { if (e.target.id === 'gen') $('[name=barcode]', m).value = Core.autoBarcode(App.db); });
}
function stockAdjust(it, done) {
  if (it.serialTracked || it.batchTracked) toast(t('adjustNote'));
  const fields = [{ k: 'newQty', label: t('countedQty'), type: 'number', step: 'any', def: it.stock, first: true }, { k: 'reason', label: t('reason') }];
  modal({ title: it.name + ' - ' + t('stockAdjust'), body: '<p class="muted">' + t('currentStock') + ': ' + it.stock + '</p><div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields); if (v.newQty == null || v.newQty < 0) { toast(t('invalidValue'), 'err'); return false; }
    if (it.serialTracked && v.newQty !== (it.serials || []).length) { toast(t('serialAdjustBlock'), 'err'); return false; }
    if (it.batchTracked) { const sumB = Core.r2((it.batches || []).reduce((s, b) => s + b.qty, 0)); if (v.newQty < sumB) { /* shrink earliest-expiry batches first */ let cut = Core.r2(sumB - v.newQty); (it.batches || []).slice().sort((a, b) => (a.expiry || '9').localeCompare(b.expiry || '9')).forEach((b) => { const d = Math.min(b.qty, cut); b.qty = Core.r2(b.qty - d); cut = Core.r2(cut - d); }); } }
    App.db.audit.push({ ts: new Date().toISOString(), user: App.user.name, act: 'stockAdjust', item: it.name, from: it.stock, to: v.newQty, reason: v.reason }); it.stock = v.newQty; save(); done(); } }], enter: 1 });
}
function marginModal(done) {
  const targets = App.db.items.filter((i) => !(i.price > 0) && i.cost > 0);
  const fields = [{ k: 'pct', label: t('markupPct'), type: 'number', step: 'any', def: 30, first: true }, { k: 'round', label: t('roundTo'), type: 'select', opts: [['0', t('noRound')], ['0.5', '0.50'], ['1', '1'], ['5', '5']] }, { k: 'all', type: 'check', label: '', hint: t('applyAll') }];
  modal({ title: t('setByMargin'), body: '<p>' + t('marginInfo', { n: targets.length }) + '</p><div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('apply'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields); if (v.pct == null || v.pct < 0) { toast(t('invalidValue'), 'err'); return false; }
    const rd = Number($('[name=round]', w).value); const list = v.all ? App.db.items.filter((i) => i.cost > 0) : targets;
    list.forEach((i) => { let p = i.cost * (1 + v.pct / 100); if (rd > 0) p = Math.ceil(p / rd) * rd; i.price = Core.r2(p); }); save(); toast(t('updated') + ': ' + list.length); done(); } }], enter: 1 });
}

// ---------------- Purchases ----------------
const PU = { lines: [], supplierId: '', invoiceNo: '', date: '', paid: '', note: '', preview: null, tab: 'new' };
Views.purchases = function (m) {
  m.innerHTML = head(t('nav_purchases'), '<button class="btn' + (PU.tab === 'new' ? ' primary' : '') + '" data-tab="new">' + t('receiveGoods') + '</button><button class="btn' + (PU.tab === 'hist' ? ' primary' : '') + '" data-tab="hist">' + t('purchaseHistory') + '</button>') + '<div id="pbody"></div>';
  m.onclick = (e) => { const tb = e.target.closest('[data-tab]'); if (tb) { PU.tab = tb.dataset.tab; Views.purchases(m); } };
  if (PU.tab === 'hist') return purchaseHistory($('#pbody', m)); purchaseNew($('#pbody', m), m);
};
function purchaseNew(b, m) {
  PU.date = PU.date || Core.today();
  const sups = App.db.suppliers;
  const draw = () => {
    b.innerHTML = '<div class="card"><div class="grid4">' + form([{ k: 'supplierId', label: t('supplier'), type: 'select', opts: [['', '—']].concat(sups.map((s) => [s.id, s.name])) }, { k: 'invoiceNo', label: t('supplierInvoiceNo') }, { k: 'date', label: t('date'), type: 'date' }, { k: 'paid', label: t('paidAmount'), type: 'number', step: 'any' }, { k: 'note', label: t('note'), wide: true }], PU) + '</div>' +
      '<div class="row"><button class="btn primary" id="p-import">📥 ' + t('importExcel') + '</button><button class="btn" id="p-tpl">⬇ ' + t('template') + '</button><button class="btn" id="p-addrow">+ ' + t('addLine') + '</button></div></div>' +
      (PU.preview ? previewHTML(PU.preview) : '') +
      '<div class="card"><h3>' + t('lines') + ' (' + PU.lines.length + ')</h3>' + purchaseLinesHTML() + '<div class="row end"><b>' + t('total') + ': ' + money(PU.lines.reduce((s, l) => s + l.qty * (l.netCost != null ? l.netCost : l.cost * (1 - (l.discount || 0) / 100)), 0)) + '</b><button class="btn primary big" id="p-save"' + (PU.lines.length ? '' : ' disabled') + '>' + t('confirmReceive') + '</button></div></div>';
  };
  const readHead = () => { ['supplierId', 'invoiceNo', 'date', 'paid', 'note'].forEach((k) => { const el = $('[name="' + k + '"]', b); if (el) PU[k] = el.value; }); };
  draw();
  b.onchange = (e) => { if (e.target.name) readHead(); };
  b.onclick = async (e) => {
    readHead();
    if (e.target.id === 'p-import') {
      const r = await window.api.openSheet(); if (!r) return;
      const res = Core.parseSupplierRows(r.rows, App.db.items); res.file = r.file; PU.preview = res; if (!res.errors.length) { PU.lines = PU.lines.concat(res.rows); } draw(); return;
    }
    if (e.target.id === 'p-tpl') return exportRows('supplier-invoice-template.xlsx', [['Barcode', 'Name', 'Qty', 'Cost', 'Discount %', 'Batch', 'Expiry', 'Serial', 'Sell Price', 'Group', 'Unit'], ['6221234567890', 'Sample item', 10, 12.5, 0, 'B1', '2027-12-31', '', 20, 'Grocery', 'pcs']], [16, 24, 8, 10, 10, 10, 12, 20, 10, 12, 8]);
    if (e.target.id === 'p-addrow') return lineModal(null, draw);
    if (e.target.dataset.rm != null) { PU.lines.splice(+e.target.dataset.rm, 1); return draw(); }
    if (e.target.dataset.pv === 'clear') { PU.preview = null; return draw(); }
    if (e.target.id === 'p-save') {
      try {
        const p = Core.finalizePurchase(App.db, { lines: PU.lines, supplierId: PU.supplierId || null, invoiceNo: PU.invoiceNo, date: PU.date, paid: Core.num(PU.paid) || 0, note: PU.note }, App.user);
        await save(true); const created = p.lines.filter((l) => l.created).length; const nop = p.lines.filter((l) => { const it = App.db.items.find((x) => x.id === l.itemId); return it && !(it.price > 0); });
        PU.lines = []; PU.preview = null; PU.invoiceNo = ''; PU.paid = ''; PU.note = ''; draw(); toast(t('received') + ' ' + p.no + (created ? ' · ' + created + ' ' + t('newItemsCreated') : ''));
        if (nop.length) { const ok = await confirmBox(t('noPriceAfter', { n: nop.length })); if (ok) marginModal(() => {}); }
      } catch (er) {
        if (er.message === 'DUP_INVOICE') { if (await confirmBox(t('err_DUP_INVOICE') + ' (' + er.no + ') ' + t('receiveAnyway'))) { try { const p = Core.finalizePurchase(App.db, { lines: PU.lines, supplierId: PU.supplierId || null, invoiceNo: PU.invoiceNo, date: PU.date, paid: Core.num(PU.paid) || 0, note: PU.note, allowDuplicate: true }, App.user); await save(true); PU.lines = []; PU.preview = null; draw(); toast(t('received') + ' ' + p.no); } catch (e2) { toast(errMsg(e2), 'err'); } } } else toast(errMsg(er), 'err');
      }
    }
  };
}
function purchaseLinesHTML() {
  return table([t('barcode'), t('name'), t('qty'), t('cost'), t('discount') + ' %', t('batch'), t('expiry'), 'SN', t('sellPrice'), ''], PU.lines.map((l, i) => '<tr><td>' + esc(l.barcode) + '</td><td>' + esc(l.name) + (l.isNew ? ' <span class="tag n">' + t('newItem') + '</span>' : '') + (l.noSellPrice ? ' <span class="tag w">' + t('noSellPrice') + '</span>' : '') + '</td><td>' + l.qty + '</td><td>' + money(l.cost) + '</td><td>' + (l.discount || 0) + '</td><td>' + esc(l.batch || '') + '</td><td>' + esc(l.expiry || '') + '</td><td>' + ((l.serials || []).length || '') + '</td><td>' + (l.sellPrice != null ? money(l.sellPrice) : '') + '</td><td><button class="btn sm danger" data-rm="' + i + '">✕</button></td></tr>'));
}
function previewHTML(p) {
  const msg = (x) => (x.rowNo ? t('row') + ' ' + x.rowNo + ': ' : '') + (t('imp_' + x.code) === 'imp_' + x.code ? x.code : t('imp_' + x.code)) + (x.arg ? ' (' + esc(x.arg) + ')' : '');
  return '<div class="card ' + (p.errors.length ? 'errbox' : 'okbox') + '"><div class="row"><b>' + esc(p.file || '') + '</b> ' + (p.errors.length ? '<span class="bad">' + t('importBlocked', { n: p.errors.length }) + '</span>' : '<span class="good">' + t('importOk', { n: p.rows.length }) + '</span>') + '<button class="btn sm" data-pv="clear">✕</button></div>' +
    (p.errors.length ? '<ul>' + p.errors.slice(0, 60).map((x) => '<li>' + msg(x) + '</li>').join('') + '</ul><p class="muted">' + t('fixAndRetry') + '</p>' : '') +
    (p.warnings.length ? '<ul class="warnl">' + p.warnings.slice(0, 40).map((x) => '<li>⚠ ' + msg(x) + '</li>').join('') + '</ul>' : '') + '</div>';
}
function lineModal(_, done) {
  const fields = [{ k: 'barcode', label: t('barcode'), first: true }, { k: 'name', label: t('name') }, { k: 'qty', label: t('qty'), type: 'number', step: 'any' }, { k: 'cost', label: t('cost'), type: 'number', step: 'any' }, { k: 'discount', label: t('discount') + ' %', type: 'number', step: 'any' }, { k: 'sellPrice', label: t('sellPrice'), type: 'number', step: 'any' }, { k: 'batch', label: t('batch') }, { k: 'expiry', label: t('expiry') + ' (YYYY-MM-DD)' }, { k: 'serial', label: t('serial') + ' (,)' }, { k: 'group', label: t('group') }];
  const m = modal({ title: t('addLine'), cls: 'wide', body: '<div class="grid3">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('add'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields);
    const rows = [['barcode', 'name', 'qty', 'cost', 'discount', 'batch', 'expiry', 'serial', 'sellPrice', 'group'], [v.barcode, v.name, v.qty, v.cost, v.discount, v.batch, v.expiry, v.serial, v.sellPrice, v.group]];
    const res = Core.parseSupplierRows(rows, App.db.items.concat(PU.lines.filter((l) => l.isNew).map((l) => ({ id: 'x', barcode: l.barcode, name: l.name, price: 0, serials: l.serials }))));
    if (res.errors.length) { toast(res.errors.map((x) => t('imp_' + x.code)).join(' · '), 'err'); return false; }
    PU.lines.push(res.rows[0]); done(); } }], enter: 1 });
  const bc = $('[name=barcode]', m); bc.addEventListener('change', () => { const it = App.db.items.find((x) => x.barcode === Core.normDigits(bc.value)); if (it) { $('[name=name]', m).value = it.name; $('[name=cost]', m).value = it.cost; } });
}
function purchaseHistory(b) {
  const rows = App.db.purchases.slice().reverse();
  b.innerHTML = table([t('no'), t('date'), t('supplier'), t('supplierInvoiceNo'), t('lines'), t('total'), t('status'), ''], rows.map((p) => { const s = App.db.suppliers.find((x) => x.id === p.supplierId);
    return '<tr class="' + (p.status === 'voided' ? 'dim' : '') + '"><td>' + p.no + '</td><td>' + esc(p.date) + '</td><td>' + esc(s ? s.name : '') + '</td><td>' + esc(p.invoiceNo) + '</td><td>' + p.lines.length + '</td><td>' + money(p.total) + '</td><td>' + t(p.status) + '</td><td>' + (p.status === 'completed' ? '<button class="btn sm danger" data-void="' + p.id + '">' + t('void') + '</button>' : '') + '</td></tr>'; }));
  b.onclick = async (e) => { const v = e.target.dataset.void; if (v && await confirmBox(t('voidPurchaseQ'))) { try { Core.voidPurchase(App.db, v, App.user); await save(true); purchaseHistory(b); } catch (er) { toast(errMsg(er), 'err'); } } };
}

// ---------------- Promotions ----------------
Views.promos = function (m) {
  const typeLbl = (p) => t('pt_' + p.type);
  const scopeLbl = (p) => { const s = p.scope || { type: 'all' }; if (s.type === 'all') return t('allItems'); if (s.type === 'group') return t('group') + ': ' + s.value; const it = App.db.items.find((x) => x.id === s.value); return it ? it.name : '?'; };
  const detail = (p) => { const a = p.params || {}; if (p.type === 'percent' || p.type === 'invoice_pct') return a.percent + '%' + (a.minTotal ? ' (≥ ' + a.minTotal + ')' : ''); if (p.type === 'amount' || p.type === 'invoice_amt') return money(a.amount) + (a.minTotal ? ' (≥ ' + a.minTotal + ')' : ''); if (p.type === 'bxgy') return t('buy') + ' ' + a.buy + ' ' + t('get') + ' ' + a.get + ((a.getPct != null && a.getPct < 100) ? ' (' + a.getPct + '%)' : ' ' + t('free')); return a.qty + ' = ' + money(a.price); };
  m.innerHTML = head(t('nav_promos'), '<button class="btn primary" id="pr-add">+ ' + t('addPromo') + '</button>') + '<p class="muted">' + t('promoHelp') + '</p>' +
    table([t('name'), t('type'), t('appliesTo'), t('details'), t('period'), t('stackable'), t('active'), ''], App.db.promos.map((p) => '<tr class="' + (p.active === false ? 'dim' : '') + '"><td>' + esc(p.name) + '</td><td>' + typeLbl(p) + '</td><td>' + esc(scopeLbl(p)) + '</td><td>' + detail(p) + '</td><td>' + esc((p.start || '…') + ' → ' + (p.end || '…')) + '</td><td>' + (p.stackable ? '✓' : '') + '</td><td>' + (Core.promoActive(p) ? '<span class="good">●</span>' : '○') + '</td><td class="nw"><button class="btn sm" data-pe="' + p.id + '">✎</button> <button class="btn sm danger" data-pd="' + p.id + '">✕</button></td></tr>'));
  m.onclick = async (e) => {
    if (e.target.id === 'pr-add') promoModal(null, () => Views.promos(m)); const pe = e.target.closest('[data-pe]'); if (pe) promoModal(App.db.promos.find((x) => x.id === pe.dataset.pe), () => Views.promos(m));
    const pd = e.target.closest('[data-pd]'); if (pd && await confirmBox(t('deleteQ'))) { App.db.promos = App.db.promos.filter((x) => x.id !== pd.dataset.pd); save(); Views.promos(m); }
  };
};
function promoModal(p, done, preset) {
  const isNew = !p; p = p || Object.assign({ name: '', type: 'percent', scope: { type: 'all' }, params: {}, stackable: false, priority: 0, active: true }, preset || {});
  const types = ['percent', 'amount', 'bxgy', 'bundle', 'invoice_pct', 'invoice_amt'];
  const groups = Array.from(new Set(App.db.items.map((i) => i.group).filter(Boolean)));
  const fields = [{ k: 'name', label: t('name'), first: true, wide: true }, { k: 'type', label: t('type'), type: 'select', opts: types.map((x) => [x, t('pt_' + x)]) },
    { k: 'scopeType', label: t('appliesTo'), type: 'select', opts: [['all', t('allItems')], ['group', t('group')], ['item', t('item')]] },
    { k: 'scopeValue', label: t('scopeValue'), type: 'select', opts: [] },
    { k: 'percent', label: t('discountPct'), type: 'number', step: 'any' }, { k: 'amount', label: t('discountAmt'), type: 'number', step: 'any' }, { k: 'buy', label: t('buyQty'), type: 'number' }, { k: 'get', label: t('getQty'), type: 'number' }, { k: 'getPct', label: t('getPct'), type: 'number', step: 'any' },
    { k: 'qty', label: t('bundleQty'), type: 'number' }, { k: 'price', label: t('bundlePrice'), type: 'number', step: 'any' }, { k: 'minTotal', label: t('minTotal'), type: 'number', step: 'any' },
    { k: 'start', label: t('startDate'), type: 'date' }, { k: 'end', label: t('endDate'), type: 'date' }, { k: 'priority', label: t('priority'), type: 'number' },
    { k: 'stackable', type: 'check', label: '', hint: t('stackableHint') }, { k: 'active', type: 'check', label: '', hint: t('active') }];
  const vals = Object.assign({}, p, p.params, { scopeType: (p.scope || {}).type, scopeValue: (p.scope || {}).value, active: p.active !== false });
  const m = modal({ title: isNew ? t('addPromo') : t('editPromo'), cls: 'wide', body: '<div class="grid3" id="pgrid">' + form(fields, vals) + '</div><p class="muted sm" id="phelp"></p>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields); if (!v.name) { toast(t('nameRequired'), 'err'); return false; }
    const params = {}; const T = v.type; const bad = () => { toast(t('invalidValue'), 'err'); return false; };
    if (T === 'percent' || T === 'invoice_pct') { if (!(v.percent > 0 && v.percent <= 100)) return bad(); params.percent = v.percent; }
    if (T === 'amount' || T === 'invoice_amt') { if (!(v.amount > 0)) return bad(); params.amount = v.amount; }
    if (T === 'bxgy') { if (!(v.buy >= 1 && v.get >= 1)) return bad(); params.buy = Math.floor(v.buy); params.get = Math.floor(v.get); params.getPct = v.getPct == null ? 100 : v.getPct; if (params.getPct <= 0 || params.getPct > 100) return bad(); }
    if (T === 'bundle') { if (!(v.qty >= 2 && v.price >= 0)) return bad(); params.qty = Math.floor(v.qty); params.price = v.price; }
    if ((T === 'invoice_pct' || T === 'invoice_amt') && v.minTotal) params.minTotal = v.minTotal;
    const isInv = T === 'invoice_pct' || T === 'invoice_amt';
    const scope = isInv ? { type: 'all' } : { type: v.scopeType, value: v.scopeValue }; if (!isInv && scope.type !== 'all' && !scope.value) { toast(t('pickScope'), 'err'); return false; }
    if (v.start && v.end && v.end < v.start) return bad();
    Object.assign(p, { name: v.name, type: T, scope, params, start: v.start || '', end: v.end || '', priority: v.priority || 0, stackable: v.stackable, active: v.active });
    if (isNew) { p.id = Core.uid('pr'); App.db.promos.push(p); } save(); done(); } }], enter: 1 });
  const sync = () => {
    const T = $('[name=type]', m).value; const show = { percent: ['percent'], amount: ['amount'], bxgy: ['buy', 'get', 'getPct'], bundle: ['qty', 'price'], invoice_pct: ['percent', 'minTotal'], invoice_amt: ['amount', 'minTotal'] }[T];
    ['percent', 'amount', 'buy', 'get', 'getPct', 'qty', 'price', 'minTotal'].forEach((k) => { $('[name=' + k + ']', m).closest('.fld').style.display = show.indexOf(k) >= 0 ? '' : 'none'; });
    const inv = T.startsWith('invoice'); $('[name=scopeType]', m).closest('.fld').style.display = inv ? 'none' : ''; const st = $('[name=scopeType]', m).value; $('[name=scopeValue]', m).closest('.fld').style.display = (inv || st === 'all') ? 'none' : '';
    const sv = $('[name=scopeValue]', m); const cur = sv.value || (p.scope || {}).value;
    sv.innerHTML = (st === 'group' ? groups.map((g) => [g, g]) : st === 'item' ? App.db.items.map((i) => [i.id, i.name + ' (' + i.barcode + ')']) : []).map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    $('#phelp', m).textContent = t('pth_' + T);
  };
  m.addEventListener('change', (e) => { if (e.target.name === 'type' || e.target.name === 'scopeType') { if (e.target.name === 'scopeType') $('[name=scopeValue]', m).innerHTML = ''; sync(); } }); sync();
}

// ---------------- People (customers & suppliers) ----------------
Views.people = function (m) {
  const st = App.edit && App.edit.people || (App.edit = Object.assign(App.edit || {}, { people: 'customers' })).people;
  const kind = (App.edit.people) || 'customers';
  const list = App.db[kind];
  m.innerHTML = head(t('nav_people'), '<button class="btn' + (kind === 'customers' ? ' primary' : '') + '" data-k="customers">' + t('customers') + '</button><button class="btn' + (kind === 'suppliers' ? ' primary' : '') + '" data-k="suppliers">' + t('suppliers') + '</button><button class="btn primary" id="pp-add">+ ' + t('add') + '</button>') +
    table([t('name'), t('phone'), kind === 'customers' ? t('points') : t('note'), ''], list.map((c) => '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.phone || '') + '</td><td>' + (kind === 'customers' ? (c.points || 0) : esc(c.note || '')) + '</td><td class="nw"><button class="btn sm" data-e="' + c.id + '">✎</button> <button class="btn sm danger" data-d="' + c.id + '">✕</button></td></tr>'));
  const edit = (c) => { const isNew = !c; c = c || {}; const fields = [{ k: 'name', label: t('name'), first: true }, { k: 'phone', label: t('phone') }, { k: 'note', label: t('note') }];
    modal({ title: isNew ? t('add') : t('edit'), body: '<div class="grid2">' + form(fields, c) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: (w) => { const v = readForm(w, fields); if (!v.name) { toast(t('nameRequired'), 'err'); return false; }
      Object.assign(c, v); if (isNew) { c.id = Core.uid(kind[0]); if (kind === 'customers') c.points = 0; list.push(c); } save(); Views.people(m); } }], enter: 1 }); };
  m.onclick = async (e) => { if (e.target.dataset.k) { App.edit.people = e.target.dataset.k; Views.people(m); } if (e.target.id === 'pp-add') edit(null); const ed = e.target.closest('[data-e]'); if (ed) edit(list.find((x) => x.id === ed.dataset.e));
    const d = e.target.closest('[data-d]'); if (d && await confirmBox(t('deleteQ'))) { App.db[kind] = list.filter((x) => x.id !== d.dataset.d); save(); Views.people(m); } };
};

// ---------------- History ----------------
Views.history = function (m) {
  const st = App.edit && App.edit.hist || (App.edit = Object.assign(App.edit || {}, { hist: { q: '', from: Core.today(new Date(Date.now() - 6 * 86400000)), to: Core.today() } })).hist;
  const draw = () => {
    let rows = App.db.sales.filter((s) => s.ts.slice(0, 10) >= st.from && s.ts.slice(0, 10) <= st.to);
    if (!isMgr()) rows = rows.filter((s) => s.userId === App.user.id || true);
    const q = st.q.toLowerCase(); if (q) rows = rows.filter((s) => s.no.toLowerCase().includes(q) || (s.customerName || '').toLowerCase().includes(q) || (s.saleNo || '').toLowerCase().includes(q));
    rows = rows.slice().reverse().slice(0, 300);
    $('#hb', m).innerHTML = table([t('no'), t('date'), t('type'), t('cashier'), t('customer'), t('total'), t('status'), ''], rows.map((s) => {
      const amt = s.type === 'return' ? -s.refund : s.total;
      return '<tr class="' + (s.status === 'voided' ? 'dim' : '') + '"><td>' + s.no + '</td><td>' + fmtDT(s.ts) + '</td><td>' + t(s.type) + (s.type === 'return' ? ' <small class="muted">' + esc(s.saleNo) + '</small>' : '') + '</td><td>' + esc(s.userName) + '</td><td>' + esc(s.customerName || '') + '</td><td class="' + (amt < 0 ? 'bad' : '') + '">' + money(amt) + '</td><td>' + t(s.status) + '</td><td class="nw"><button class="btn sm" data-pr="' + s.id + '">🖨</button>' + (s.type === 'sale' && s.status !== 'voided' ? ' <button class="btn sm" data-ret="' + s.id + '">↩ ' + t('return') + '</button>' : '') + (s.type === 'sale' && s.status !== 'voided' && isMgr() ? ' <button class="btn sm danger" data-vd="' + s.id + '">' + t('void') + '</button>' : '') + '</td></tr>'; }));
  };
  m.innerHTML = head(t('nav_history')) + '<div class="bar"><input id="h-q" placeholder="' + t('invoiceOrCustomer') + '" value="' + esc(st.q) + '"><input type="date" id="h-f" value="' + st.from + '"><input type="date" id="h-t" value="' + st.to + '"></div><div id="hb"></div>'; draw();
  m.oninput = (e) => { if (e.target.id === 'h-q') st.q = e.target.value; if (e.target.id === 'h-f') st.from = e.target.value; if (e.target.id === 'h-t') st.to = e.target.value; draw(); };
  m.onclick = async (e) => {
    const pr = e.target.closest('[data-pr]'); if (pr) { const d = App.db.sales.find((x) => x.id === pr.dataset.pr); return printChoice(d); }
    const rt = e.target.closest('[data-ret]'); if (rt) return returnModal(App.db.sales.find((x) => x.id === rt.dataset.ret), draw);
    const vd = e.target.closest('[data-vd]'); if (vd && await confirmBox(t('voidSaleQ'))) { try { Core.voidSale(App.db, vd.dataset.vd, App.user, ''); await save(true); draw(); } catch (er) { toast(errMsg(er), 'err'); } }
  };
};
function printChoice(doc) {
  const m = modal({ title: doc.no, body: '<p>' + t('receiptLang') + '</p><div class="row"><button class="btn primary" data-l="ar">العربية</button><button class="btn primary" data-l="en">English</button></div>', buttons: [{ label: t('close') }] });
  m.addEventListener('click', (e) => { if (e.target.dataset.l) { printReceipt(doc, e.target.dataset.l); m.close(); } });
}
async function returnModal(sale, done) {
  let user = App.user; const chk = Core.canReturn(App.db, sale, user);
  if (!chk.ok && chk.needManager) { const mgr = await managerApproval(t('returnWindowPassed', { n: App.db.settings.returnDays })); if (!mgr) return; if (!App.db.settings.managerBypassReturnWindow) return toast(t('err_WINDOW'), 'err'); user = mgr; } else if (!chk.ok) return toast(t('err_' + chk.code), 'err');
  if (!App.shift) return toast(t('noShift'), 'err');
  const rows = sale.lines.map((l, i) => { const left = Core.returnableQty(sale, i); return '<tr><td>' + esc(l.name) + (l.serials && l.serials.length ? '<br><small>SN: ' + esc(l.serials.join(', ')) + '</small>' : '') + '</td><td>' + l.qty + '</td><td>' + left + '</td><td>' + (left > 0 ? '<input class="rq" data-i="' + i + '" type="number" min="0" max="' + left + '" step="any" value="0">' : '—') + '</td>' + (l.serials && l.serials.length ? '<td><input class="rs" data-i="' + i + '" placeholder="' + t('serialsReturned') + '"></td>' : '<td></td>') + '<td>' + money(l.total / l.qty) + '</td></tr>'; });
  const m = modal({ title: t('return') + ' ' + sale.no, cls: 'wide', body: '<p class="muted">' + t('soldAt') + ': ' + esc(sale.profileName || '-') + ' · ' + fmtDT(sale.ts) + '</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + t('name') + '</th><th>' + t('sold') + '</th><th>' + t('returnable') + '</th><th>' + t('returnQty') + '</th><th></th><th>' + t('unitNet') + '</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
    '<div class="grid3">' + form([{ k: 'reason', label: t('reason') }, { k: 'method', label: t('refundMethod'), type: 'select', opts: [['cash', t('pm_cash')], ['card', t('pm_card')], ['other', t('pm_other')]] }]) + '</div><div class="paytot">' + t('refund') + ': <b id="rf">0.00</b></div>',
    buttons: [{ label: t('cancel') }, { label: t('confirmReturn'), cls: 'primary', onClick: async (w) => {
      const items = $$('.rq', w).map((x) => ({ idx: +x.dataset.i, qty: Core.num(x.value) || 0 })).filter((x) => x.qty > 0);
      if (!items.length) { toast(t('nothingToReturn'), 'err'); return false; }
      items.forEach((x) => { const s = $('.rs[data-i="' + x.idx + '"]', w); if (s) x.serials = s.value.split(/[,;\s]+/).filter(Boolean); });
      try { const r = Core.finalizeReturn(App.db, sale.id, items, user, { reason: $('[name=reason]', w).value, method: $('[name=method]', w).value, shiftId: App.shift.id, profileName: App.shift.profileName }); await save(true); toast(t('returnDone') + ' ' + r.no + ' · ' + money(r.refund)); done(); if (await confirmBox(t('printReturnQ'))) printReceipt(r); } catch (e) { toast(errMsg(e), 'err'); return false; } } }] });
  m.addEventListener('input', () => { let tot = 0; $$('.rq', m).forEach((x) => { const l = sale.lines[+x.dataset.i]; tot += (Core.num(x.value) || 0) * l.total / l.qty; }); $('#rf', m).textContent = money(Core.r2(tot)); });
}

// ---------------- Shift ----------------
Views.shift = function (m) {
  const sh = App.shift; let body = '';
  if (!sh) body = '<div class="card center"><p>' + t('noShift') + '</p><button class="btn primary big" id="sh-open">' + t('openShift') + '</button></div>';
  else {
    const sum = Core.shiftSummary(App.db, sh);
    body = '<div class="card"><div class="stats">' + stat(t('openedAt'), fmtDT(sh.openedAt)) + stat(t('openingCash'), money(sh.openingCash)) + stat(t('salesCount'), sum.salesCount) + stat(t('salesTotal'), money(sum.salesTotal)) + stat(t('returns'), money(sum.returnsTotal)) + stat(t('pm_cash'), money(sum.byMethod.cash || 0)) + stat(t('pm_card'), money(sum.byMethod.card || 0)) + stat(t('pm_other'), money(sum.byMethod.other || 0)) + stat(t('cashIn'), money(sum.cashIn)) + stat(t('cashOut'), money(sum.cashOut)) + stat(t('expectedCash'), '<b>' + money(sum.expectedCash) + '</b>') + '</div>' +
      '<div class="row"><button class="btn" id="sh-in">＋ ' + t('cashIn') + '</button><button class="btn" id="sh-out">－ ' + t('cashOut') + '</button><button class="btn primary" id="sh-close">' + t('closeShift') + '</button></div></div>' +
      '<div class="card"><h3>' + t('cashMoves') + '</h3>' + table([t('time'), t('type'), t('amount'), t('reason')], sh.moves.map((x) => '<tr><td>' + fmtDT(x.ts) + '</td><td>' + t(x.kind === 'in' ? 'cashIn' : 'cashOut') + '</td><td>' + money(x.amount) + '</td><td>' + esc(x.reason) + (x.approvedBy ? ' <small>(' + esc(x.approvedBy) + ')</small>' : '') + '</td></tr>')) + '</div>';
  }
  const hist = App.db.shifts.filter((s) => s.closedAt && (isMgr() || s.userId === App.user.id)).slice().reverse().slice(0, 30);
  m.innerHTML = head(t('nav_shift')) + body + '<div class="card"><h3>' + t('closedShifts') + '</h3>' + table([t('cashier'), t('openedAt'), t('closedAt'), t('expectedCash'), t('countedCash'), t('difference'), ''], hist.map((s) => '<tr><td>' + esc(s.userName) + '</td><td>' + fmtDT(s.openedAt) + '</td><td>' + fmtDT(s.closedAt) + '</td><td>' + money(s.expectedCash) + '</td><td>' + money(s.countedCash) + '</td><td class="' + (Math.abs(s.diff) > 0.009 ? 'bad' : 'good') + '">' + money(s.diff) + '</td><td><button class="btn sm" data-z="' + s.id + '">🖨 Z</button></td></tr>')) + '</div>';
  m.onclick = (e) => {
    if (e.target.id === 'sh-open') openShiftModal(); if (e.target.id === 'sh-in') cashMoveModal('in'); if (e.target.id === 'sh-out') cashMoveModal('out'); if (e.target.id === 'sh-close') closeShiftModal();
    const z = e.target.closest('[data-z]'); if (z) printZ(App.db.shifts.find((x) => x.id === z.dataset.z));
  };
};
const stat = (l, v) => '<div class="stat"><span>' + l + '</span><b>' + v + '</b></div>';
function cashMoveModal(kind) {
  const fields = [{ k: 'amount', label: t('amount'), type: 'number', step: 'any', first: true }, { k: 'reason', label: t('reason') }];
  modal({ title: t(kind === 'in' ? 'cashIn' : 'cashOut'), body: '<div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async (w) => {
    const v = readForm(w, fields); if (!(v.amount > 0)) { toast(t('invalidValue'), 'err'); return false; } if (!v.reason) { toast(t('reasonRequired'), 'err'); return false; }
    let appr = ''; if (kind === 'out' && !isMgr() && v.amount > (App.db.settings.cashOutLimit || 200)) { const mgr = await managerApproval(t('cashOutApproval')); if (!mgr) return false; appr = mgr.name; }
    Core.cashMove(App.db, App.shift, kind, v.amount, v.reason, appr); await save(true); Views.shift($('#main')); } }], enter: 1 });
}
function closeShiftModal() {
  const sum = Core.shiftSummary(App.db, App.shift); const fields = [{ k: 'counted', label: t('countedCash'), type: 'number', step: 'any', first: true }, { k: 'note', label: t('note') }];
  const m = modal({ title: t('closeShift'), body: '<div class="paytot">' + t('expectedCash') + ': <b>' + money(sum.expectedCash) + '</b></div><div class="grid2">' + form(fields) + '</div><div id="dif" class="paystat"></div>', buttons: [{ label: t('cancel') }, { label: t('closeShift'), cls: 'primary', onClick: async (w) => {
    const v = readForm(w, fields); if (v.counted == null || v.counted < 0) { toast(t('invalidValue'), 'err'); return false; } const diff = Core.r2(v.counted - sum.expectedCash);
    if (Math.abs(diff) > 0.009 && !v.note) { toast(t('diffNeedsNote'), 'err'); return false; }
    const sh = Core.closeShift(App.db, App.shift, v.counted, v.note); await save(true); App.shift = null; Views.shift($('#main')); printZ(sh); } }], enter: 1 });
  m.addEventListener('input', () => { const v = Core.num($('[name=counted]', m).value); const d = isNaN(v) ? null : Core.r2(v - sum.expectedCash); $('#dif', m).innerHTML = d == null ? '' : '<span class="' + (Math.abs(d) > 0.009 ? 'bad' : 'good') + '">' + t('difference') + ': ' + money(d) + '</span>'; });
}
function printZ(sh) {
  const s = sh.summary || Core.shiftSummary(App.db, sh); const l = App.db.settings.receiptLang; const m = (n) => money(n, l);
  const row = (k, v) => '<tr><td>' + tr(k, l) + '</td><td class="e">' + v + '</td></tr>';
  const html = '<!doctype html><html dir="' + (l === 'ar' ? 'rtl' : 'ltr') + '"><head><meta charset="utf-8"><style>@page{size:76mm auto;margin:0}body{width:76mm;margin:0 auto;padding:3mm;font:12px "Segoe UI",Tahoma,Arial}h3{text-align:center;margin:2px}table{width:100%}td.e{text-align:' + (l === 'ar' ? 'left' : 'right') + '}hr{border-top:1px dashed #000;border-bottom:0}</style></head><body><h3>' + esc(App.db.settings.storeName) + '</h3><h3>' + tr('zReport', l) + '</h3><hr><table>' +
    row('cashier', esc(sh.userName)) + row('openedAt', new Date(sh.openedAt).toLocaleString(l === 'ar' ? locFor('ar') : 'en-GB')) + (sh.closedAt ? row('closedAt', new Date(sh.closedAt).toLocaleString(l === 'ar' ? locFor('ar') : 'en-GB')) : '') + row('openingCash', m(sh.openingCash)) + row('salesCount', s.salesCount) + row('salesTotal', m(s.salesTotal)) + row('returns', m(s.returnsTotal)) + row('pm_cash', m(s.byMethod.cash || 0)) + row('pm_card', m(s.byMethod.card || 0)) + row('pm_other', m(s.byMethod.other || 0)) + row('cashIn', m(s.cashIn)) + row('cashOut', m(s.cashOut)) + '</table><hr><table>' + row('expectedCash', m(s.expectedCash)) + (sh.closedAt ? row('countedCash', m(sh.countedCash)) + row('difference', m(sh.diff)) : '') + '</table>' + (sh.note ? '<p>' + esc(sh.note) + '</p>' : '') + '</body></html>';
  window.api.print(html, {});
}

// ---------------- Reports ----------------
Views.reports = function (m) {
  const st = App.edit && App.edit.rep || (App.edit = Object.assign(App.edit || {}, { rep: { tab: 'dash', from: Core.today(new Date(Date.now() - 29 * 86400000)), to: Core.today(), days: App.db.settings.slowDays } })).rep;
  const tabs = ['dash', 'sales', 'slow', 'low', 'expiry', 'stockval'];
  const draw = () => {
    const b = $('#rb', m); const s = App.db.settings;
    if (st.tab === 'dash') { const td = Core.salesReport(App.db, Core.today(), Core.today()); const mo = Core.salesReport(App.db, Core.today().slice(0, 8) + '01', Core.today());
      const low = Core.lowStock(App.db).length, slow = Core.slowMoving(App.db, s.slowDays).length, exp = Core.expiring(App.db, s.expiryWarnDays).length;
      b.innerHTML = '<div class="stats big">' + stat(t('todaySales'), money(td.net)) + stat(t('todayCount'), td.count) + stat(t('todayProfit'), money(td.profit)) + stat(t('monthSales'), money(mo.net)) + stat(t('monthProfit'), money(mo.profit)) + '</div><div class="stats">' + stat(t('lowStock'), '<a href="#" data-go="low">' + low + '</a>') + stat(t('slowItems'), '<a href="#" data-go="slow">' + slow + '</a>') + stat(t('expiringSoon'), '<a href="#" data-go="expiry">' + exp + '</a>') + '</div>'; }
    if (st.tab === 'sales') { const r = Core.salesReport(App.db, st.from, st.to);
      b.innerHTML = '<div class="bar"><input type="date" id="r-f" value="' + st.from + '"><input type="date" id="r-t" value="' + st.to + '"><button class="btn" id="r-x">⬇ Excel</button></div><div class="stats">' + stat(t('salesCount'), r.count) + stat(t('grossSales'), money(r.total)) + stat(t('refunds'), money(r.refunds)) + stat(t('netSales'), money(r.net)) + stat('VAT', money(r.tax)) + stat(t('cogs'), money(r.cogs)) + stat(t('profit'), '<b>' + money(r.profit) + '</b>') + '</div>' +
        '<div class="grid2"><div>' + table([t('date'), t('total')], Object.keys(r.byDay).sort().map((d) => '<tr><td>' + d + '</td><td>' + money(r.byDay[d]) + '</td></tr>')) + '</div><div>' + table([t('group'), t('total')], Object.keys(r.byGroup).sort((a, b2) => r.byGroup[b2] - r.byGroup[a]).map((g) => '<tr><td>' + esc(g) + '</td><td>' + money(r.byGroup[g]) + '</td></tr>')) + '</div></div>'; }
    if (st.tab === 'slow') { const rows = Core.slowMoving(App.db, st.days);
      b.innerHTML = '<div class="bar"><label>' + t('noSaleDays') + '</label><input type="number" id="r-d" min="1" value="' + st.days + '" style="width:90px"><button class="btn" id="r-x">⬇ Excel</button><button class="btn primary" id="r-promo">🏷️ ' + t('makePromoFromSlow') + '</button></div><div class="stats">' + stat(t('items'), rows.length) + stat(t('stockValue'), money(rows.reduce((a, x) => a + x.stockValue, 0))) + '</div>' +
        table([t('barcode'), t('name'), t('group'), t('stock'), t('stockValue'), t('lastSold'), t('daysSince')], rows.map((x) => '<tr><td>' + esc(x.barcode) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.group) + '</td><td>' + x.stock + '</td><td>' + money(x.stockValue) + '</td><td>' + (x.lastSold ? fmtDT(x.lastSold) : t('never')) + '</td><td>' + (x.daysSince == null ? '∞' : x.daysSince) + '</td></tr>')); b._rows = rows; }
    if (st.tab === 'low') b.innerHTML = table([t('barcode'), t('name'), t('stock'), t('minStock')], Core.lowStock(App.db).map((i) => '<tr><td>' + esc(i.barcode) + '</td><td>' + esc(i.name) + '</td><td class="bad">' + i.stock + '</td><td>' + i.minStock + '</td></tr>'));
    if (st.tab === 'expiry') b.innerHTML = '<p class="muted">' + t('withinDays', { n: s.expiryWarnDays }) + '</p>' + table([t('name'), t('batch'), t('expiry'), t('qty')], Core.expiring(App.db, s.expiryWarnDays).map((x) => '<tr><td>' + esc(x.item.name) + '</td><td>' + esc(x.batch.batch) + '</td><td class="' + (x.batch.expiry < Core.today() ? 'bad' : '') + '">' + x.batch.expiry + '</td><td>' + x.batch.qty + '</td></tr>'));
    if (st.tab === 'stockval') { const rows = App.db.items.filter((i) => !i.service && i.stock > 0); const tc = rows.reduce((a, i) => a + i.stock * i.cost, 0), tp = rows.reduce((a, i) => a + i.stock * i.price, 0);
      b.innerHTML = '<div class="stats">' + stat(t('stockAtCost'), money(tc)) + stat(t('stockAtPrice'), money(tp)) + '</div>' + table([t('name'), t('stock'), t('cost'), t('stockValue')], rows.sort((a, b2) => b2.stock * b2.cost - a.stock * a.cost).slice(0, 200).map((i) => '<tr><td>' + esc(i.name) + '</td><td>' + i.stock + '</td><td>' + money(i.cost) + '</td><td>' + money(i.stock * i.cost) + '</td></tr>')); }
  };
  m.innerHTML = head(t('nav_reports'), tabs.map((x) => '<button class="btn' + (st.tab === x ? ' primary' : '') + '" data-rt="' + x + '">' + t('rt_' + x) + '</button>').join('')) + '<div id="rb"></div>'; draw();
  m.onclick = (e) => {
    if (e.target.dataset.rt) { st.tab = e.target.dataset.rt; Views.reports(m); } if (e.target.dataset.go) { e.preventDefault(); st.tab = e.target.dataset.go; Views.reports(m); }
    if (e.target.id === 'r-x') { if (st.tab === 'slow') exportRows('slow-moving.xlsx', [[t('barcode'), t('name'), t('group'), t('stock'), t('stockValue'), t('lastSold')]].concat(Core.slowMoving(App.db, st.days).map((x) => [x.barcode, x.name, x.group, x.stock, x.stockValue, x.lastSold ? x.lastSold.slice(0, 10) : ''])), [16, 30, 14, 8, 12, 12]); else { const r = Core.salesReport(App.db, st.from, st.to); exportRows('sales.xlsx', [[t('date'), t('total')]].concat(Object.keys(r.byDay).sort().map((d) => [d, r.byDay[d]]))); } }
    if (e.target.id === 'r-promo') { const rows = Core.slowMoving(App.db, st.days); const groups = Array.from(new Set(rows.map((x) => x.group).filter(Boolean))); promoModal(null, () => toast(t('saved')), { name: t('clearanceName'), type: 'percent', params: { percent: 20 }, scope: groups.length === 1 ? { type: 'group', value: groups[0] } : { type: 'all' } }); }
  };
  m.oninput = (e) => { if (e.target.id === 'r-f') st.from = e.target.value; if (e.target.id === 'r-t') st.to = e.target.value; if (e.target.id === 'r-d') st.days = Math.max(1, Number(e.target.value) || 30); if (['r-f', 'r-t', 'r-d'].includes(e.target.id)) { const pos = e.target.selectionStart; draw(); const el = $('#' + e.target.id, m); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} } } };
};

// ---------------- Settings ----------------
Views.settings = function (m) {
  const s = App.db.settings; const th = [['light', t('th_light')], ['dark', t('th_dark')], ['blue', t('th_blue')]];
  const F = [
    ['store', [{ k: 'storeName', label: t('storeName') }, { k: 'storeAddress', label: t('address') }, { k: 'storePhone', label: t('phone') }, { k: 'taxNumber', label: t('taxNumber') }, { k: 'currency', label: t('currency') }, { k: 'receiptFooter', label: t('receiptFooter') }]],
    ['look', [{ k: 'lang', label: t('uiLang'), type: 'select', opts: [['ar', 'العربية'], ['en', 'English']] }, { k: 'receiptLang', label: t('receiptLang'), type: 'select', opts: [['ar', 'العربية'], ['en', 'English']] }, { k: 'theme', label: t('theme'), type: 'select', opts: th }, { k: 'numerals', label: t('numerals'), type: 'select', opts: [['western', '0123456789'], ['arabic', '٠١٢٣٤٥٦٧٨٩']] }, { k: 'accent', label: t('accentColor'), type: 'color', def: s.accent || '#2563eb' }, { k: 'receiptWidth', label: t('receiptWidth'), type: 'select', opts: [['80', '80mm'], ['58', '58mm']] }, { k: 'autoPrint', type: 'check', label: '', hint: t('autoPrint') }]],
    ['sales', [{ k: 'taxRate', label: t('taxRate'), type: 'number', step: 'any' }, { k: 'pricesIncludeTax', type: 'check', label: '', hint: t('pricesIncludeTax') }, { k: 'maxCashierDiscountPct', label: t('maxCashierDiscount'), type: 'number', step: 'any' }, { k: 'allowNegativeStock', type: 'check', label: '', hint: t('allowNegative') }, { k: 'costMethod', label: t('costMethod'), type: 'select', opts: [['average', t('cm_average')], ['last', t('cm_last')]] }, { k: 'lowStockDefault', label: t('lowStockDefault'), type: 'number' }]],
    ['returns', [{ k: 'returnDays', label: t('returnDays'), type: 'number' }, { k: 'managerBypassReturnWindow', type: 'check', label: '', hint: t('managerBypass') }, { k: 'cashOutLimit', label: t('cashOutLimit'), type: 'number', def: 200 }]],
    ['loyalty', [{ k: 'loyaltyEnabled', type: 'check', label: '', hint: t('loyaltyEnabled') }, { k: 'loyaltyEarnPerCurrency', label: t('earnPer'), type: 'number', step: 'any' }, { k: 'loyaltyPointValue', label: t('pointValue'), type: 'number', step: 'any' }]],
    ['stockrep', [{ k: 'slowDays', label: t('slowDays'), type: 'number' }, { k: 'expiryWarnDays', label: t('expiryWarnDays'), type: 'number' }, { k: 'scaleMode', label: t('scaleMode'), type: 'select', opts: [['manual', t('sm_manual')], ['simulator', t('sm_sim')]] }, { k: 'scalePrefix', label: t('scalePrefix') }]],
  ];
  const vals = Object.assign({}, s, { receiptWidth: String(s.receiptWidth), accent: s.accent || '#2563eb' });
  m.innerHTML = head(t('nav_settings'), '<button class="btn primary" id="st-save">' + t('save') + '</button>') + F.map((g) => '<div class="card"><h3>' + t('sg_' + g[0]) + '</h3><div class="grid3">' + form(g[1], vals) + '</div></div>').join('') +
    '<div class="card"><h3>' + t('users') + '</h3><div id="ulist"></div><button class="btn" id="u-add">+ ' + t('addUser') + '</button></div>' +
    '<div class="card"><h3>' + t('backup') + '</h3><p class="muted">' + t('backupInfo') + '</p><div class="row"><button class="btn" id="b-now">💾 ' + t('backupNow') + '</button><button class="btn" id="b-res">♻ ' + t('restore') + '</button><button class="btn" id="b-dir">📁 ' + t('chooseFolder') + '</button><span class="muted">' + esc(s.backupDir || t('defaultFolder')) + '</span></div><div class="muted sm" id="dpath"></div></div>';
  window.api.info().then((i) => { const el = $('#dpath', m); if (el) el.textContent = t('dataFile') + ': ' + i.dataFile + ' · v' + i.version; });
  const drawUsers = () => { $('#ulist', m).innerHTML = table([t('name'), t('role'), t('active'), ''], App.db.users.map((u) => '<tr><td>' + esc(u.name) + '</td><td>' + t(u.role) + '</td><td>' + (u.active !== false ? '✓' : '') + '</td><td><button class="btn sm" data-ue="' + u.id + '">✎</button></td></tr>')); }; drawUsers();
  const all = F.reduce((a, g) => a.concat(g[1]), []);
  m.onclick = async (e) => {
    if (e.target.id === 'st-save') {
      const v = readForm(m, all); const th0 = s.theme;
      ['storeName', 'storeAddress', 'storePhone', 'taxNumber', 'currency', 'receiptFooter', 'lang', 'receiptLang', 'theme', 'costMethod', 'scaleMode', 'scalePrefix', 'numerals'].forEach((k) => { s[k] = v[k]; });
      s.accent = v.accent === '#2563eb' && !s.accent ? '' : v.accent; s.receiptWidth = Number(v.receiptWidth); ['autoPrint', 'pricesIncludeTax', 'allowNegativeStock', 'managerBypassReturnWindow', 'loyaltyEnabled'].forEach((k) => { s[k] = !!v[k]; });
      for (const k of ['taxRate', 'maxCashierDiscountPct', 'lowStockDefault', 'returnDays', 'cashOutLimit', 'loyaltyEarnPerCurrency', 'loyaltyPointValue', 'slowDays', 'expiryWarnDays']) { if (v[k] != null && v[k] >= 0) s[k] = v[k]; }
      await save(true); applyTheme(); toast(t('saved')); shell();
    }
    if (e.target.id === 'u-add') userModal(null, () => drawUsers()); const ue = e.target.closest('[data-ue]'); if (ue) userModal(App.db.users.find((x) => x.id === ue.dataset.ue), () => drawUsers());
    if (e.target.id === 'b-now') { await save(true); const p = await window.api.backupNow(); toast(p ? t('backupSaved') + ': ' + p : t('saveFail'), p ? '' : 'err'); }
    if (e.target.id === 'b-dir') { const d = await window.api.chooseDir(); if (d) { s.backupDir = d; await save(true); Views.settings(m); } }
    if (e.target.id === 'b-res') { if (!await confirmBox(t('restoreQ'))) return; try { const text = await window.api.restore(); if (text) { App.db = JSON.parse(text); await save(true); toast(t('restored')); login(); } } catch (er) { toast(er.message, 'err'); } }
  };
};
function userModal(u, done) {
  const isNew = !u; const fields = [{ k: 'name', label: t('name'), first: true }, { k: 'role', label: t('role'), type: 'select', opts: [['cashier', t('cashier')], ['manager', t('manager')]] }, { k: 'pin', label: isNew ? t('pin4') : t('newPinOpt'), type: 'password' }, { k: 'active', type: 'check', label: '', hint: t('active'), def: true }];
  modal({ title: isNew ? t('addUser') : t('editUser'), body: '<div class="grid2">' + form(fields, u ? Object.assign({}, u, { pin: '', active: u.active !== false }) : {}) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields); if (!v.name) { toast(t('nameRequired'), 'err'); return false; } if ((isNew || v.pin) && !/^\d{4,8}$/.test(v.pin)) { toast(t('pin4'), 'err'); return false; }
    if (!isNew && (v.role !== 'manager' || !v.active) && u.role === 'manager' && App.db.users.filter((x) => x.role === 'manager' && x.active !== false).length < 2) { toast(t('lastManager'), 'err'); return false; }
    if (isNew) { const nu = Core.makeUser(v.name, v.pin, v.role); nu.active = v.active; App.db.users.push(nu); } else { u.name = v.name; u.role = v.role; u.active = v.active; if (v.pin) { u.salt = Math.random().toString(36).slice(2, 10); u.pinHash = Core.hashPin(v.pin, u.salt); } }
    save(true); done(); } }], enter: 1 });
}
