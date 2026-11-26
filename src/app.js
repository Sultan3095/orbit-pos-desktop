/* Orbit POS renderer: shell, helpers, login, sell screen. Other screens live in views.js */
'use strict';
const App = { db: null, user: null, view: 'sell', cart: null, shift: null, timers: {}, edit: null };
window.App = App;

// ---------- helpers ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lang = () => (App.db ? App.db.settings.lang : 'ar');
const t = (k, a) => { let s = (I18N[lang()] && I18N[lang()][k]) || I18N.en[k] || k; if (a) for (const i in a) s = s.replace('{' + i + '}', a[i]); return s; };
const tr = (k, l, a) => { let s = (I18N[l] && I18N[l][k]) || I18N.en[k] || k; if (a) for (const i in a) s = s.replace('{' + i + '}', a[i]); return s; };
const locFor = (l) => ((l || lang()) === 'ar' ? (App.db && App.db.settings.numerals === 'arabic' ? 'ar-EG' : 'ar-EG-u-nu-latn') : 'en-US');
const money = (n, l) => Number(n || 0).toLocaleString(locFor(l), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = () => App.db.settings.currency;
const fmtDT = (iso) => { const d = new Date(iso); return d.toLocaleString(lang() === 'ar' ? locFor('ar') : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }); };
const itemName = (it, l) => ((l || lang()) === 'en' && it.nameEn) ? it.nameEn : it.name;
const can = (k) => !!App.user && Core.can(App.db, App.user, k);
const isMgr = () => can('approve'); // may approve by own PIN (discount / return / cash-out limits)

let saveTimer = null, saving = Promise.resolve();
// only the rows that changed since the last successful save go to the encrypted SQLite store
function persist() { const x = Store.delta(App.db); if (!x) return Promise.resolve(); return window.api.delta(x.delta).then(() => x.commit()); }
function save(now) {
  const run = () => { saving = saving.then(persist).catch((e) => toast(t('saveFail') + ' ' + e.message, 'err')); return saving; };
  if (now) { clearTimeout(saveTimer); return run(); }
  clearTimeout(saveTimer); saveTimer = setTimeout(run, 400); return Promise.resolve();
}
// sync on close: an async write can be lost while the window is closing
window.addEventListener('beforeunload', () => { if (App.db) { const x = Store.delta(App.db); if (x && window.api.deltaSync(x.delta)) x.commit(); } });

function toast(msg, kind) {
  const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.classList.add('hide'), kind === 'err' ? 5000 : 2200); setTimeout(() => el.remove(), 5600);
}
function errMsg(e) {
  const code = ((e && e.message) || '').match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|\b(?:EMPTY|LOCKED)\b/); const raw = (e && e.message) || ''; const code2 = code ? code[0] : raw; const key = 'err_' + code2; const m = t(key);
  try { Guide.forError(code2); } catch (x) {}
  return (m === key ? raw : m) + (e.item ? ' (' + e.item + ')' : '') + (e.no ? ' (' + e.no + ')' : '');
}

// ---------- modal ----------
function modal(o) {
  const id = 'm' + Math.random().toString(36).slice(2);
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap'; wrap.id = id;
  wrap.innerHTML = '<div class="modal ' + (o.cls || '') + '"><div class="modal-h"><b>' + esc(o.title || '') + '</b><button class="x" data-close>×</button></div><div class="modal-b">' + (o.body || '') + '</div>' +
    '<div class="modal-f">' + (o.buttons || [{ label: t('close') }]).map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-b="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', async (e) => {
    if (e.target.matches('[data-close]')) { close(); if (o.onCancel) o.onCancel(); return; }
    const b = e.target.closest('[data-b]');
    if (b) { const def = (o.buttons || [{}])[+b.dataset.b]; if (!def.onClick) { close(); return; } const keep = await def.onClick(wrap); if (keep !== false) close(); }
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); if (o.onCancel) o.onCancel(); } if (e.key === 'Enter' && o.enter != null && e.target.tagName !== 'TEXTAREA' && !e.target.matches('button')) { e.preventDefault(); const bb = $$('[data-b]', wrap)[o.enter]; if (bb) bb.click(); } });
  if (o.onOpen) o.onOpen(wrap);
  const f = $('[autofocus]', wrap) || $('input,select', wrap); if (f) setTimeout(() => f.focus(), 30);
  wrap.close = close; return wrap;
}
function confirmBox(msg, okLabel) {
  return new Promise((res) => modal({ title: t('confirm'), body: '<p>' + esc(msg) + '</p>', buttons: [{ label: t('cancel') }, { label: okLabel || t('ok'), cls: 'primary', onClick: () => { res(true); } }], onCancel: () => res(false), enter: 1 }).addEventListener('click', (e) => { if (e.target.matches('[data-b="0"]')) res(false); }));
}
// manager approval by PIN; resolves with the approving manager user or null
function managerApproval(reason) {
  return new Promise((resolve) => {
    if (isMgr()) return resolve(App.user);
    let done = false;
    const m = modal({ title: t('managerApproval'), body: '<p>' + esc(reason) + '</p><label>' + t('managerPin') + '</label><input id="mapin" type="password" inputmode="numeric" autofocus autocomplete="off">',
      buttons: [{ label: t('cancel') }, { label: t('approve'), cls: 'primary', onClick: (w) => {
        const pin = $('#mapin', w).value; const mgr = App.db.users.find((u) => Core.isApprover(App.db, u) && Core.checkPin(u, pin));
        if (!mgr) { toast(t('wrongPin'), 'err'); return false; } done = true; resolve(mgr); } }], enter: 1, onCancel: () => resolve(null) });
    m.addEventListener('click', (e) => { if (!done && e.target.matches('[data-b="0"]')) resolve(null); });
  });
}
function form(fields, vals) {
  vals = vals || {};
  return fields.filter((f) => !f.hidden).map((f) => {
    const v = vals[f.k] == null ? (f.def == null ? '' : f.def) : vals[f.k];
    let inp;
    if (f.type === 'select') inp = '<select name="' + f.k + '">' + f.opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    else if (f.type === 'check') inp = '<label class="chk"><input type="checkbox" name="' + f.k + '"' + (v ? ' checked' : '') + '> ' + esc(f.hint || '') + '</label>';
    else if (f.type === 'textarea') inp = '<textarea name="' + f.k + '" rows="2">' + esc(v) + '</textarea>';
    else inp = '<input name="' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + (f.step ? ' step="' + f.step + '"' : '') + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.ro ? ' readonly' : '') + (f.first ? ' autofocus' : '') + '>';
    return '<div class="fld' + (f.wide ? ' wide' : '') + '"><label>' + esc(f.label) + '</label>' + inp + '</div>';
  }).join('');
}
function readForm(root, fields) {
  const o = {};
  fields.forEach((f) => { const el = $('[name="' + f.k + '"]', root); if (!el) return; o[f.k] = f.type === 'check' ? el.checked : (f.type === 'number' ? (el.value === '' ? null : Core.num(el.value)) : el.value.trim()); });
  return o;
}

// ---------- theme / language ----------
function applyTheme() {
  const s = App.db ? App.db.settings : { theme: 'brand', lang: 'ar' };
  document.documentElement.setAttribute('data-theme', Core.themeOf(s, App.user));
  document.documentElement.lang = s.lang; document.documentElement.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent); else document.documentElement.style.removeProperty('--accent');
  document.title = 'Orbit POS';
}

// ---------- boot ----------
// ---------- data passphrase (encrypted store) ----------
const sb = (ar, en) => (lang() === 'en' ? en : ar);
function secShell(html) { const root = $('#app'); root.innerHTML = '<div class="sec-wrap"><div class="card sec">' + html + '</div></div>'; return root; }
function secSetup(info) {
  return new Promise((resolve) => {
    const osOpt = info.osAvailable ? '<label class="chk"><input type="radio" name="sm" value="os" checked> ' + sb('تذكّر على الجهاز ده (محمي بحساب ويندوز) — مش هيسأل كل مرة', 'Remember on this PC (protected by your Windows account) - no prompt each launch') + '</label>' +
      '<label class="chk"><input type="radio" name="sm" value="prompt"> ' + sb('اسأل عن كلمة السر كل مرة أفتح فيها البرنامج', 'Ask for the passphrase every time the app starts') + '</label>' : '<p class="muted">' + sb('الجهاز ده مش بيدعم الحفظ الآمن، فهيسأل عن كلمة السر كل مرة.', 'This PC cannot store it securely, so the app will ask each launch.') + '</p>';
    const root = secShell('<h2>🔐 ' + sb('حماية ملف البيانات', 'Protect the data file') + '</h2><p>' + sb('بيانات المحل بتتحفظ مشفّرة على الجهاز. اختار كلمة سر (6 حروف على الأقل). هتاخد كمان مفتاح استرجاع لو نسيتها.', 'Shop data is stored encrypted on this PC. Choose a passphrase (at least 6 characters). You also get a recovery key in case you forget it.') + '</p>' +
      (info.hasLegacy ? '<p class="ok-box">' + sb('لقينا بيانات قديمة غير مشفّرة، هتتنقل تلقائياً بعد الإنشاء.', 'Existing unencrypted data was found and will be imported automatically.') + '</p>' : '') +
      '<label>' + sb('كلمة السر', 'Passphrase') + '</label><input id="sec-pass" type="password" autofocus><label>' + sb('أكّد كلمة السر', 'Confirm passphrase') + '</label><input id="sec-pass2" type="password">' + osOpt +
      '<div id="sec-err" class="err"></div><div class="row"><button class="btn primary" id="sec-create">' + sb('إنشاء', 'Create') + '</button></div>');
    const go = async () => {
      const p = $('#sec-pass').value, p2 = $('#sec-pass2').value, err = $('#sec-err');
      if (p.length < 6) { err.textContent = sb('كلمة السر أقل من 6 حروف', 'Passphrase is shorter than 6 characters'); return; }
      if (p !== p2) { err.textContent = sb('كلمتا السر مش متطابقتين', 'Passphrases do not match'); return; }
      const m = ($('input[name=sm]:checked') || {}).value || 'prompt';
      let r; try { r = await window.api.storeCreate(p, m); } catch (e) { err.textContent = errMsg(e); return; }
      secShowRecovery(r.recoveryKey, resolve);
    };
    root.onclick = (e) => { if (e.target.id === 'sec-create') go(); }; root.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}
function secShowRecovery(key, done) {
  const root = secShell('<h2>🗝 ' + sb('مفتاح الاسترجاع', 'Recovery key') + '</h2><p>' + sb('اكتبه أو اطبعه واحتفظ بيه في مكان آمن بعيد عن الجهاز. لو نسيت كلمة السر ده الطريقة الوحيدة لفتح البيانات، ومش هيتعرض تاني.', 'Write it down or print it and keep it somewhere safe, away from this PC. If you forget the passphrase it is the only way to open your data, and it is not shown again.') + '</p>' +
    '<div class="recovery" id="sec-recovery" dir="ltr">' + esc(key) + '</div><div class="row"><button class="btn" id="sec-print">🖨 ' + sb('طباعة', 'Print') + '</button></div>' +
    '<label class="chk"><input type="checkbox" id="sec-saved"> ' + sb('حفظت مفتاح الاسترجاع', 'I saved the recovery key') + '</label><div class="row"><button class="btn primary" id="sec-continue" disabled>' + sb('متابعة', 'Continue') + '</button></div>');
  root.onclick = (e) => {
    if (e.target.id === 'sec-saved') $('#sec-continue').disabled = !e.target.checked;
    if (e.target.id === 'sec-print') window.api.print('<html dir="rtl"><body style="font-family:sans-serif;padding:24px"><h2>Orbit POS - ' + sb('مفتاح الاسترجاع', 'Recovery key') + '</h2><p style="font:bold 22px monospace;direction:ltr">' + esc(key) + '</p><p>' + sb('احتفظ بالورقة دي في مكان آمن. أي حد معاه المفتاح يقدر يفتح البيانات.', 'Keep this page safe. Anyone with this key can open the data.') + '</p></body></html>', {});
    if (e.target.id === 'sec-continue' && $('#sec-saved').checked) { root.onclick = null; done(); }
  };
}
function secUnlock() {
  return new Promise((resolve) => {
    const root = secShell('<h2>🔐 ' + sb('البيانات مقفولة', 'Data is locked') + '</h2><p>' + sb('اكتب كلمة السر أو مفتاح الاسترجاع.', 'Enter your passphrase or recovery key.') + '</p><input id="sec-unlock-input" type="password" autofocus><div id="sec-err" class="err"></div><div class="row"><button class="btn primary" id="sec-unlock-btn">' + sb('فتح', 'Unlock') + '</button></div>');
    const go = async () => { let ok = false; try { ok = await window.api.storeUnlock($('#sec-unlock-input').value); } catch (e) { $('#sec-err').textContent = errMsg(e); return; } if (ok) { root.onclick = null; resolve(); } else $('#sec-err').textContent = sb('كلمة السر أو المفتاح غلط', 'Wrong passphrase or key'); };
    root.onclick = (e) => { if (e.target.id === 'sec-unlock-btn') go(); }; root.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}
async function ensureUnlocked() {
  let info = await window.api.storeInfo();
  while (info.status !== 'ready') { if (info.status === 'new') await secSetup(info); else await secUnlock(); info = await window.api.storeInfo(); }
}

// ---------- boot ----------
async function boot() {
  let raw;
  try { await ensureUnlocked(); raw = await window.api.load(); } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;font:16px sans-serif;direction:rtl;text-align:center"><h2>تعذر قراءة ملف البيانات</h2><p>Data could not be opened (' + esc(e.message) + '). Nothing was changed. Restore from a backup or contact support.</p></div>';
    return;
  }
  App.db = raw ? JSON.parse(raw) : Core.newDB();
  if (raw) Store.prime(App.db); else Store.reset();
  Core.upgradeRoles(App.db);
  const def = Core.defaultSettings(); for (const k in def) if (App.db.settings[k] === undefined) App.db.settings[k] = def[k];
  ['held', 'audit', 'customers', 'suppliers', 'promos', 'purchases', 'shifts', 'sales', 'items', 'users'].forEach((k) => { if (!App.db[k]) App.db[k] = []; });
  applyTheme();
  if (!App.db.users.length) return setupWizard();
  login();
}
function setupWizard() {
  const root = $('#app');
  root.innerHTML = '<div class="login"><div class="card login-card"><h1>Orbit POS</h1><p class="muted">' + t('welcome') + '</p>' +
    '<div class="row"><button class="btn" data-lang="ar">العربية</button><button class="btn" data-lang="en">English</button></div>' +
    '<div class="grid2">' + form([
      { k: 'storeName', label: t('storeName'), first: true, wide: true }, { k: 'name', label: t('managerName'), def: lang() === 'ar' ? 'المدير' : 'Manager' },
      { k: 'pin', label: t('pin4'), type: 'password' }, { k: 'currency', label: t('currency'), def: 'EGP' }, { k: 'taxRate', label: t('taxRate'), type: 'number', def: 14 },
      { k: 'demo', type: 'check', label: '', hint: t('wizDemo'), wide: true },
    ]) + '</div><button class="btn primary big" id="wiz-go">' + t('start') + '</button></div></div>';
  root.onclick = (e) => {
    const l = e.target.dataset && e.target.dataset.lang;
    if (l) { App.db.settings.lang = l; App.db.settings.receiptLang = l; applyTheme(); return setupWizard(); }
    if (e.target.id === 'wiz-go') {
      const v = readForm(root, [{ k: 'storeName' }, { k: 'name' }, { k: 'pin' }, { k: 'currency' }, { k: 'taxRate', type: 'number' }, { k: 'demo', type: 'check' }]);
      if (!v.storeName || !v.name || !/^\d{4,8}$/.test(v.pin)) return toast(t('wizInvalid'), 'err');
      App.db.settings.storeName = v.storeName; App.db.settings.currency = v.currency || 'EGP'; App.db.settings.taxRate = v.taxRate == null ? 14 : v.taxRate;
      App.db.users.push(Core.makeUser(v.name, v.pin, 'system')); if (v.demo && !App.db.items.length) Core.sampleItems().forEach((i) => App.db.items.push(i)); save(true); root.onclick = null; login();
    }
  };
}
function login() {
  App.user = null; const root = $('#app');
  const users = App.db.users.filter((u) => u.active !== false);
  root.innerHTML = '<div class="login"><div class="card login-card"><h1>Orbit POS</h1><p class="muted">' + esc(App.db.settings.storeName) + '</p>' +
    '<div class="users">' + users.map((u) => '<button class="btn user" data-u="' + u.id + '">' + esc(u.name) + '<small>' + t(u.role) + '</small></button>').join('') + '</div>' +
    '<div id="pinbox" class="hidden"><label id="pinfor"></label><input id="pin" type="password" inputmode="numeric" autocomplete="off"><button class="btn primary big" id="pin-go">' + t('login') + '</button></div></div></div>';
  let sel = null;
  root.onclick = (e) => {
    const b = e.target.closest('[data-u]');
    if (b) { sel = App.db.users.find((u) => u.id === b.dataset.u); $('#pinbox').classList.remove('hidden'); $('#pinfor').textContent = sel.name; $('#pin').value = ''; $('#pin').focus(); $$('.user').forEach((x) => x.classList.toggle('on', x === b)); }
    if (e.target.id === 'pin-go') go();
  };
  const go = () => { if (!sel) return; if (Core.checkPin(sel, $('#pin').value)) { App.user = sel; applyTheme(); root.onclick = null; App.cart = newCart(); App.view = 'sell'; shell(); } else { toast(t('wrongPin'), 'err'); $('#pin').value = ''; } };
  root.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'pin') go(); };
  if (users.length === 1) { $('[data-u]').click(); }
}

// ---------- shell ----------
const NAV = [['sell', '🛒'], ['items', '📦'], ['purchases', '🧾'], ['promos', '🏷️'], ['coupons', '🎟️'], ['gifts', '🎁'], ['people', '👥'], ['history', '📜'], ['shift', '⏱️'], ['reports', '📊'], ['settings', '⚙️']];
const NAV_PERM = { items: 'editItems', purchases: 'importPurchases', promos: 'promos', coupons: 'coupons', gifts: 'sellGiftCard', reports: 'reports', settings: 'settings' };
function curShift() { return App.db.shifts.find((s) => s.userId === App.user.id && !s.closedAt) || null; }
function shell() {
  App.shift = curShift();
  const nav = NAV.filter((n) => !NAV_PERM[n[0]] || can(NAV_PERM[n[0]]));
  $('#app').innerHTML = '<div class="shell"><aside class="side"><div class="brand">◉ Orbit POS<small>' + esc(App.db.settings.storeName) + '</small></div>' +
    nav.map((n) => '<button class="nav' + (App.view === n[0] ? ' on' : '') + '" data-nav="' + n[0] + '"><span>' + n[1] + '</span> ' + t('nav_' + n[0]) + '</button>').join('') +
    '<div class="grow"></div><div class="who">' + esc(App.user.name) + '<small>' + t(App.user.role) + '</small></div>' +
    '<div class="row tight"><button class="btn sm" id="b-lang">' + (lang() === 'ar' ? 'EN' : 'ع') + '</button><button class="btn sm" id="b-theme" title="' + t('theme') + '">🎨</button><button class="btn sm" id="b-guide" title="' + sb('المرشد: شغّال/موقوف', 'Guide: on/off') + '">' + (App.user && App.user.guideOff ? '🙈' : '🧑‍💼') + '</button><button class="btn sm" id="b-out">⎋</button></div></aside>' +
    '<main class="main" id="main"></main></div>';
  $('.side').onclick = (e) => {
    const n = e.target.closest('[data-nav]'); if (n) { App.view = n.dataset.nav; shell(); }
    if (e.target.id === 'b-lang') { App.db.settings.lang = lang() === 'ar' ? 'en' : 'ar'; applyTheme(); save(); shell(); }
    if (e.target.id === 'b-theme') return themePicker();
    if (e.target.id === 'b-guide') { App.user.guideOff = !App.user.guideOff; if (!App.user.guideOff) Guide.reset(App.user); save(); e.target.textContent = App.user.guideOff ? '🙈' : '🧑‍💼'; toast(sb(App.user.guideOff ? 'المرشد موقوف' : 'المرشد شغّال', App.user.guideOff ? 'Guide off' : 'Guide on')); return; }
    if (e.target.id === 'b-out') { if (App.cart && App.cart.lines.length) holdCart(true); save(true); login(); }
  };
  renderView();
}
function renderView() {
  const m = $('#main'); App.shift = curShift();
  const v = (window.Views && Views[App.view]) || (App.view === 'sell' ? Sell : null);
  if (App.view === 'sell') Sell.render(m); else v(m);
}

// ---------- Sell ----------
function newCart() { return { lines: [], invPct: 0, invAmt: 0, customerId: null, redeem: false, couponCode: '' }; }
function holdCart(silent) {
  if (!App.cart.lines.length) return;
  App.db.held.push({ id: Core.uid('h'), ts: new Date().toISOString(), userId: App.user.id, cart: App.cart });
  App.cart = newCart(); save(); if (!silent) { toast(t('held')); Sell.renderCart(); }
}
function offersBar() {
  const now = new Date();
  const act = (App.db.promos || []).filter((p) => Core.promoActive(p, now));
  if (!act.length) return '';
  const sc = (p) => { const x = p.scope || { type: 'all' }; if (x.type === 'all') return ''; if (x.type === 'group') return ' (' + x.value + ')'; const it = App.db.items.find((i) => i.id === x.value); return it ? ' (' + it.name + ')' : ''; };
  const txt = (p) => { const a = p.params || {}; if (p.type === 'bxgy') return t('buy') + ' ' + a.buy + ' ' + t('get') + ' ' + a.get + ((a.getPct != null && a.getPct < 100) ? ' (' + a.getPct + '%)' : ' ' + t('free')) + sc(p); if (p.type === 'percent' || p.type === 'invoice_pct') return esc(p.name) + ': -' + a.percent + '%' + sc(p); if (p.type === 'amount' || p.type === 'invoice_amt') return esc(p.name) + ': -' + money(a.amount) + sc(p); return a.qty + ' = ' + money(a.price) + sc(p); };
  return '<div class="offers" id="offers"><b>' + t('activeOffers') + ':</b> ' + act.map((p) => '<span class="tag n">' + txt(p) + '</span>').join(' ') + '</div>';
}
const Sell = {
  calc() {
    const c = App.cart; const cust = c.customerId ? App.db.customers.find((x) => x.id === c.customerId) : null;
    const s = App.db.settings; let redeemValue = 0;
    if (c.redeem && cust && s.loyaltyEnabled) redeemValue = Core.r2((cust.points || 0) * s.loyaltyPointValue);
    let coupon = null;
    if (c.couponCode) { try { coupon = Core.checkCoupon(App.db, c.couponCode, { customerId: c.customerId }); } catch (e) { coupon = null; } }
    return Core.computeCart({ lines: c.lines.map((l) => { const it = App.db.items.find((x) => x.id === l.itemId); return Object.assign({}, l, { group: it ? it.group : '', taxExempt: it && it.taxExempt }); }), invPct: c.invPct, invAmt: c.invAmt, redeemValue, coupon }, App.db.promos, s);
  },
  render(m) {
    const sh = App.shift;
    m.innerHTML = '<div class="sell"><section class="left"><div class="bar"><input id="q" placeholder="' + t('scanOrSearch') + '" autocomplete="off" autofocus>' +
      '<button class="btn" id="s-held">' + t('held') + ' (' + App.db.held.length + ')</button><button class="btn" id="s-disp">🖥️</button></div>' +
      offersBar() +
      (sh ? '' : '<div class="banner warn">' + t('noShift') + ' <button class="btn sm primary" id="s-open">' + t('openShift') + '</button></div>') +
      '<div id="results" class="results"></div></section><section class="right card"><div id="cart"></div></section></div>';
    this.renderCart(); this.showQuick();
    const q = $('#q'); q.focus();
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitQuery(q.value.trim()); q.value = ''; } });
    q.addEventListener('input', () => this.search(q.value.trim()));
    m.onclick = (e) => {
      const r = e.target.closest('[data-add]'); if (r) { this.addItem(App.db.items.find((x) => x.id === r.dataset.add)); $('#q').focus(); return; }
      const a = e.target.closest('[data-cart]'); if (a) return this.cartAction(a.dataset.cart, a.dataset.i != null ? +a.dataset.i : null);
      if (e.target.id === 's-open') return openShiftModal();
      if (e.target.id === 's-held') return this.heldList();
      if (e.target.id === 's-disp') { window.api.openDisplay(); setTimeout(() => this.pushDisplay(), 600); }
    };
    m.onkeydown = (e) => { if (e.key === 'F4') { e.preventDefault(); this.pay(); } if (e.key === 'F8') { e.preventDefault(); holdCart(); } if (e.key === 'F2') { e.preventDefault(); $('#q').focus(); } };
  },
  showQuick() {
    const items = App.db.items.filter((i) => i.active !== false).sort((a, b) => (b.lastSold || '').localeCompare(a.lastSold || '')).slice(0, 24);
    $('#results').innerHTML = items.length ? '<div class="muted sm">' + t('quickItems') + '</div><div class="tiles">' + items.map(tile).join('') + '</div>' : '<div class="empty">' + t('noItemsYet') + '</div>';
  },
  search(q) {
    if (!q) return this.showQuick();
    const n = q.toLowerCase(); const hits = App.db.items.filter((i) => i.active !== false && (i.barcode.includes(q) || i.name.toLowerCase().includes(n) || (i.nameEn || '').toLowerCase().includes(n))).slice(0, 40);
    $('#results').innerHTML = hits.length ? '<div class="tiles">' + hits.map(tile).join('') + '</div>' : '<div class="empty">' + t('noMatch') + '</div>';
  },
  async submitQuery(q) {
    if (!q) return;
    let qty = 1; const m = /^(\d+(?:\.\d+)?)\s*[*xX×]\s*(.+)$/.exec(Core.normDigits(q)); if (m) { qty = Number(m[1]); q = m[2]; }
    q = Core.normDigits(q);
    let it = App.db.items.find((i) => i.barcode === q && i.active !== false);
    if (!it) {
      const w = Core.parseWeightBarcode(q, App.db.settings);
      if (w) { const wi = App.db.items.find((i) => i.byWeight && (String(Number(i.plu || '')) === w.pluNum || i.barcode === w.plu || String(Number(i.barcode)) === w.pluNum)); if (wi) return this.addItem(wi, w.weightKg); toast(t('pluUnknown') + ' ' + w.plu, 'err'); return; }
      const hits = App.db.items.filter((i) => i.active !== false && (i.name.toLowerCase().includes(q.toLowerCase()) || (i.nameEn || '').toLowerCase().includes(q.toLowerCase())));
      if (hits.length === 1) it = hits[0]; else if (hits.length) return this.search(q); else { beep(); return toast(t('notFound') + ': ' + q, 'err'); }
    }
    this.addItem(it, null, qty);
  },
  async addItem(it, weight, qty) {
    if (!it) return;
    qty = qty || 1;
    if (it.byWeight && weight == null) { weight = await weightModal(it); if (!weight) return; }
    const c = App.cart;
    if (it.serialTracked) {
      const used = new Set(); c.lines.forEach((l) => (l.serials || []).forEach((s) => used.add(s)));
      const avail = (it.serials || []).filter((s) => !used.has(s));
      if (!avail.length) return toast(t('err_NO_STOCK') + ' (' + it.name + ')', 'err');
      const sn = await serialModal(it, avail, qty); if (!sn) return;
      let line = c.lines.find((l) => l.itemId === it.id); if (!line) { line = { itemId: it.id, name: it.name, nameEn: it.nameEn, barcode: it.barcode, qty: 0, price: it.price, serials: [] }; c.lines.push(line); }
      line.serials = line.serials.concat(sn); line.qty = line.serials.length;
    } else {
      const have = c.lines.filter((l) => l.itemId === it.id).reduce((s, l) => s + l.qty, 0);
      if (!it.service && !App.db.settings.allowNegativeStock && have + (weight || qty) > (it.stock || 0) + 1e-9) { beep(); return toast(t('err_NO_STOCK') + ' (' + it.name + ': ' + it.stock + ')', 'err'); }
      let line = it.byWeight ? null : c.lines.find((l) => l.itemId === it.id && !l.manualPct && !l.manualAmt);
      if (line) line.qty = Core.r2(line.qty + qty); else c.lines.push({ itemId: it.id, name: it.name, nameEn: it.nameEn, barcode: it.barcode, qty: weight || qty, price: it.price });
    }
    if (!(it.price > 0)) toast(t('noPriceWarn') + ' ' + it.name, 'err');
    this.renderCart(); this.pushDisplay(); const q = $('#q'); if (q) q.focus();
  },
  renderCart() {
    const el = $('#cart'); if (!el) return; const c = App.cart; const r = this.calc();
    const cust = c.customerId ? App.db.customers.find((x) => x.id === c.customerId) : null;
    el.innerHTML = '<div class="cart-head"><b>' + t('cart') + '</b><span class="muted">' + (cust ? esc(cust.name) + (App.db.settings.loyaltyEnabled ? ' · ' + (cust.points || 0) + ' ' + t('points') : '') : '') + '</span></div>' +
      '<div class="lines">' + (r.lines.length ? r.lines.map((l, i) => {
        const it = App.db.items.find((x) => x.id === l.itemId);
        return '<div class="line"><div class="ln"><b>' + esc(itemName(l, lang())) + '</b><small>' + money(l.price) + ' × ' + l.qty + (it && it.byWeight ? ' ' + t('kg') : '') +
          (l.promoNames.length ? ' · <span class="tag">' + esc(l.promoNames.join(', ')) + '</span>' : '') + ((l.manualDisc) ? ' · <span class="tag m">−' + money(l.manualDisc) + '</span>' : '') +
          (l.serials && l.serials.length ? ' · SN ' + esc(l.serials.join(',')) : '') + '</small></div>' +
          '<div class="lq">' + (it && it.serialTracked || (it && it.byWeight) ? '' : '<button class="btn sm" data-cart="dec" data-i="' + i + '">−</button><button class="btn sm" data-cart="inc" data-i="' + i + '">+</button>') +
          '<button class="btn sm" data-cart="edit" data-i="' + i + '">✎</button><button class="btn sm danger" data-cart="del" data-i="' + i + '">✕</button></div>' +
          '<div class="lt">' + (l.promoDisc + l.manualDisc > 0 ? '<s>' + money(l.gross) + '</s> ' : '') + money(l.net) + '</div></div>';
      }).join('') : '<div class="empty">' + t('cartEmpty') + '</div>') + '</div>' +
      '<div class="tot"><div><span>' + t('subtotal') + '</span><span>' + money(r.subtotal) + '</span></div>' +
      (r.invoiceDisc > 0 ? '<div><span>' + t('invDiscount') + (r.invoicePromoNames.length ? ' (' + esc(r.invoicePromoNames.join(', ')) + ')' : '') + '</span><span>−' + money(r.invoiceDisc) + '</span></div>' : '') +
      '<div class="muted sm"><span>' + t('incl_tax') + '</span><span>' + money(r.tax) + '</span></div>' +
      '<div class="grand"><span>' + t('total') + '</span><span>' + money(r.total) + ' <small>' + esc(cur()) + '</small></span></div></div>' +
      '<div class="actions"><button class="btn" data-cart="disc">% ' + t('discount') + '</button><button class="btn" data-cart="cust">👤 ' + t('customer') + '</button><button class="btn" data-cart="coupon">🎟 ' + t('cpButton') + (App.cart.couponCode ? ' ✓' : '') + '</button><button class="btn" data-cart="hold">⏸ ' + t('hold') + ' (F8)</button><button class="btn danger" data-cart="clear">🗑</button></div>' +
      '<button class="btn primary pay" data-cart="pay"' + (r.lines.length ? '' : ' disabled') + '>' + t('pay') + ' (F4)</button>';
  },
  pushDisplay() {
    try { const r = this.calc(); window.api.updateDisplay({ lines: r.lines.map((l) => ({ name: itemName(l, lang()), qty: l.qty, net: l.net, free: l.promoDisc > 0 })), total: r.total, currency: cur(), lang: lang(), theme: Core.themeOf(App.db.settings, App.user), store: App.db.settings.storeName }); } catch (e) {}
  },
  async cartAction(a, i) {
    const c = App.cart;
    if (a === 'inc') { const l = c.lines[i]; const it = App.db.items.find((x) => x.id === l.itemId); if (!it.service && !App.db.settings.allowNegativeStock && l.qty + 1 > it.stock + 1e-9) return toast(t('err_NO_STOCK'), 'err'); l.qty++; }
    else if (a === 'dec') { const l = c.lines[i]; if (l.qty > 1) l.qty--; else c.lines.splice(i, 1); }
    else if (a === 'del') c.lines.splice(i, 1);
    else if (a === 'clear') { if (c.lines.length && await confirmBox(t('clearCart'))) App.cart = newCart(); }
    else if (a === 'hold') return holdCart();
    else if (a === 'edit') return this.editLine(i);
    else if (a === 'disc') return this.invoiceDiscount();
    else if (a === 'cust') return customerPicker();
    else if (a === 'coupon') return couponPicker();
    else if (a === 'pay') return this.pay();
    this.renderCart(); this.pushDisplay();
  },
  editLine(i) {
    const l = App.cart.lines[i]; const it = App.db.items.find((x) => x.id === l.itemId);
    const fields = [{ k: 'qty', label: t('qty'), type: 'number', step: 'any', def: l.qty }, { k: 'pct', label: t('discountPct'), type: 'number', step: 'any', def: l.manualPct || '' }, { k: 'amt', label: t('discountAmt'), type: 'number', step: 'any', def: l.manualAmt || '' }];
    if (can('priceOverride')) fields.push({ k: 'price', label: t('price'), type: 'number', step: 'any', def: l.price });
    modal({ title: itemName(l, lang()), body: '<p class="muted sm">' + t('manualDiscNote') + '</p><div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async (w) => {
      const v = readForm(w, fields); let pct = v.pct || 0, amt = v.amt || 0;
      if (pct < 0 || amt < 0 || pct > 100) { toast(t('invalidValue'), 'err'); return false; }
      const maxPct = App.db.settings.maxCashierDiscountPct; const effPct = pct + (amt && l.price * l.qty ? amt / (l.price * l.qty) * 100 : 0);
      if (effPct > maxPct && !isMgr()) { const mgr = await managerApproval(t('discountAbove', { n: maxPct })); if (!mgr) return false; l.approvedBy = mgr.name; }
      if (!it.serialTracked && v.qty != null) { if (!(v.qty > 0)) { toast(t('invalidValue'), 'err'); return false; } if (!it.service && !App.db.settings.allowNegativeStock && v.qty > it.stock + 1e-9) { toast(t('err_NO_STOCK'), 'err'); return false; } l.qty = v.qty; }
      l.manualPct = pct; l.manualAmt = amt; if (can('priceOverride') && v.price != null && v.price >= 0) l.price = v.price;
      this.renderCart(); this.pushDisplay(); } }], enter: 1 });
  },
  invoiceDiscount() {
    const c = App.cart; const fields = [{ k: 'pct', label: t('discountPct'), type: 'number', step: 'any', def: c.invPct || '' }, { k: 'amt', label: t('discountAmt'), type: 'number', step: 'any', def: c.invAmt || '' }];
    modal({ title: t('invDiscount'), body: '<div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('save'), cls: 'primary', onClick: async (w) => {
      const v = readForm(w, fields); const pct = v.pct || 0, amt = v.amt || 0; if (pct < 0 || amt < 0 || pct > 100) { toast(t('invalidValue'), 'err'); return false; }
      const sub = this.calc().subtotal; const eff = pct + (sub ? amt / sub * 100 : 0);
      if (eff > App.db.settings.maxCashierDiscountPct && !isMgr()) { const mgr = await managerApproval(t('discountAbove', { n: App.db.settings.maxCashierDiscountPct })); if (!mgr) return false; c.approvedBy = mgr.name; }
      c.invPct = pct; c.invAmt = amt; this.renderCart(); this.pushDisplay(); } }], enter: 1 });
  },
  heldList() {
    const rows = App.db.held;
    const m = modal({ title: t('held'), body: rows.length ? rows.map((h) => '<div class="rowline"><span>' + fmtDT(h.ts) + ' · ' + h.cart.lines.length + ' ' + t('items') + '</span><span><button class="btn sm primary" data-res="' + h.id + '">' + t('resume') + '</button> <button class="btn sm danger" data-del="' + h.id + '">✕</button></span></div>').join('') : '<div class="empty">' + t('none') + '</div>' });
    m.addEventListener('click', (e) => {
      const r = e.target.dataset.res, d = e.target.dataset.del;
      if (r) { if (App.cart.lines.length) holdCart(true); const h = App.db.held.find((x) => x.id === r); App.cart = h.cart; App.db.held = App.db.held.filter((x) => x.id !== r); save(); m.close(); renderView(); }
      if (d) { App.db.held = App.db.held.filter((x) => x.id !== d); save(); m.close(); renderView(); }
    });
  },
  async pay() {
    if (!App.cart.lines.length) { if (!(App.user && App.user.guideOff) && !Guide.seen(App.user, 'EMPTY_CART')) { const q = $('#q'); if (q) Guide.show('EMPTY_CART', q); } return; }
    if (!App.shift) { if (!(App.user && App.user.guideOff) && !Guide.seen(App.user, 'SHIFT_CLOSED')) { const b = $('#s-open'); if (b) { Guide.show('SHIFT_CLOSED', b); return; } } return openShiftModal(); }
    const r = this.calc(); if (r.total < 0) return;
    const fields = [{ k: 'cash', label: t('cash'), type: 'number', step: 'any' }, { k: 'card', label: t('card'), type: 'number', step: 'any' }, { k: 'cref', label: t('cardRef') }, { k: 'other', label: t('otherPay'), type: 'number', step: 'any' }, { k: 'xr', label: t('exrNo') }, { k: 'gc', label: t('giftUseNo') }, { k: 'gca', label: t('giftUseAmt'), type: 'number', step: 'any' }];
    const quick = [r.total, 50, 100, 200, 500].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
    const cust = App.cart.customerId ? App.db.customers.find((x) => x.id === App.cart.customerId) : null;
    modal({ title: t('pay'), cls: 'wide', body: '<div class="paytot">' + t('total') + ': <b>' + money(r.total) + ' ' + esc(cur()) + '</b></div><div class="grid3">' + form(fields) + '</div>' +
      '<div class="row">' + quick.map((v, i) => '<button class="btn" data-q="' + v + '">' + (i === 0 ? t('exact') : money(v)) + '</button>').join('') + '<button class="btn" data-card-all>' + t('cardAll') + '</button></div><div id="paystat" class="paystat"></div>' +
      (cust && App.db.settings.loyaltyEnabled ? '<label class="chk"><input type="checkbox" id="redeem"' + (App.cart.redeem ? ' checked' : '') + '> ' + t('redeemPoints', { n: cust.points || 0 }) + '</label>' : ''),
      buttons: [{ label: t('cancel') }, { label: t('completeSale'), cls: 'primary', onClick: (w) => doPay(w, fields) }], enter: 1,
      onOpen: (w) => {
        const upd = () => { const v = readForm(w, fields); let cr = 0; try { if (v.xr) cr = Math.min(Core.checkExchangeReceipt(App.db, v.xr).amount, r.total); } catch (e) {} let gv = 0; try { if (v.gc) gv = Math.min(Core.checkGiftCard(App.db, v.gc).balance, Core.r2(r.total - cr), v.gca > 0 ? v.gca : Infinity); } catch (e) {} const paid = (v.cash || 0) + (v.card || 0) + (v.other || 0) + cr + gv; const rem = Core.r2(r.total - paid);
          $('#paystat', w).innerHTML = rem > 0.004 ? '<span class="bad">' + t('remaining') + ': ' + money(rem) + '</span>' : '<span class="good">' + t('change') + ': ' + money(-rem) + '</span>'; if (gv > 0) $('#paystat', w).innerHTML += ' · ' + t('giftCovers') + ': ' + money(gv); };
        w.addEventListener('input', (e) => { if (e.target.id === 'redeem') { App.cart.redeem = e.target.checked; w.close(); Sell.renderCart(); Sell.pay(); return; } upd(); });
        w.addEventListener('click', (e) => { if (e.target.dataset.q) { $('[name=cash]', w).value = e.target.dataset.q; $('[name=card]', w).value = ''; $('[name=other]', w).value = ''; upd(); } if (e.target.hasAttribute('data-card-all')) { $('[name=card]', w).value = r.total; $('[name=cash]', w).value = ''; $('[name=other]', w).value = ''; upd(); } });
        const cashEl = $('[name=cash]', w); cashEl.focus(); upd();
      } });
  },
};
async function doPay(w, fields) {
  const v = readForm(w, fields);
  const xrNo = (v.xr || '').trim();
  const payments = [{ method: 'cash', amount: v.cash || 0 }, { method: 'card', amount: v.card || 0, ref: (v.cref || '').trim() }, { method: 'other', amount: v.other || 0 }].filter((p) => p.amount > 0);
  const c = App.cart; const r = Sell.calc(); const cust = c.customerId ? App.db.customers.find((x) => x.id === c.customerId) : null;
  try {
    const sale = Core.finalizeSale(App.db, { cart: { lines: c.lines.map((l) => { const it = App.db.items.find((x) => x.id === l.itemId); return Object.assign({}, l, { group: it.group, taxExempt: it.taxExempt }); }), invPct: c.invPct, invAmt: c.invAmt, redeemValue: r.redeemValue, coupon: c.couponCode ? { code: c.couponCode } : undefined },
      payments, exchangeReceiptNo: xrNo || undefined, giftCardNo: (v.gc || '').trim() || undefined, giftAmount: v.gca > 0 ? v.gca : undefined, user: App.user, shiftId: App.shift.id, customerId: c.customerId, customerName: cust ? cust.name : '', profileName: App.shift.profileName });
    if (c.approvedBy) sale.approvedBy = c.approvedBy;
    await save(true);
    if (App.db.settings.printer && App.db.settings.printer.drawerOnCash && App.db.settings.printer.type !== 'system' && sale.payments.some((p) => p.method === 'cash')) { try { window.api.openDrawer(App.db.settings.printer); } catch (e) {} }
    App.cart = newCart(); Sell.renderCart();
    try { window.api.updateDisplay({ thanks: true, lang: lang(), theme: Core.themeOf(App.db.settings, App.user), total: sale.total, currency: cur(), change: sale.change }); } catch (e) {}
    showReceiptDone(sale);
  } catch (e) { toast(errMsg(e), 'err'); return false; }
}
function showReceiptDone(sale) {
  const m = modal({ title: t('saleDone') + ' ' + sale.no, body: '<div class="paytot">' + t('total') + ': <b>' + money(sale.total) + '</b></div>' + (sale.change > 0 ? '<div class="paytot good">' + t('change') + ': <b>' + money(sale.change) + '</b></div>' : ''),
    buttons: [{ label: t('close') }, { label: '🖨 ' + t('print'), cls: 'primary', onClick: () => { printReceipt(sale); return false; } }], enter: 0 });
  if (App.db.settings.autoPrint) printReceipt(sale);
  setTimeout(() => { const q = $('#q'); if (q && !$('.modal-wrap')) q.focus(); }, 100);
}
function tile(it) {
  return '<button class="tile" data-add="' + it.id + '"><b>' + esc(itemName(it)) + '</b><span>' + money(it.price) + '</span><small>' + (it.service ? '∞' : it.stock) + '</small></button>';
}
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); o.frequency.value = 220; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 120); } catch (e) {} }

function weightModal(it) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title: itemName(it) + ' - ' + t('weight'), body: '<p class="muted sm">' + t('scaleNote') + '</p><label>' + t('weightKg') + '</label><input id="wt" type="number" step="0.001" autofocus>' + (App.db.settings.scaleMode === 'simulator' ? '<button class="btn" id="wsim">' + t('simulate') + '</button>' : ''),
      buttons: [{ label: t('cancel') }, { label: t('add'), cls: 'primary', onClick: (w) => { const v = Core.num($('#wt', w).value); if (!(v > 0)) { toast(t('invalidValue'), 'err'); return false; } done = true; res(Math.round(v * 1000) / 1000); } }], enter: 1, onCancel: () => res(null) });
    m.addEventListener('click', (e) => { if (e.target.id === 'wsim') $('#wt', m).value = (Math.round((0.1 + Math.random() * 2.4) * 1000) / 1000); if (!done && e.target.matches('[data-b="0"]')) res(null); });
  });
}
function serialModal(it, avail, qty) {
  return new Promise((res) => {
    let done = false;
    const m = modal({ title: itemName(it) + ' - ' + t('serial'), body: '<p class="muted sm">' + t('pickSerial', { n: qty }) + '</p><div class="chips">' + avail.slice(0, 200).map((s) => '<label class="chip"><input type="checkbox" value="' + esc(s) + '"> ' + esc(s) + '</label>').join('') + '</div>',
      buttons: [{ label: t('cancel') }, { label: t('add'), cls: 'primary', onClick: (w) => { const sel = $$('input:checked', w).map((x) => x.value); if (sel.length !== qty) { toast(t('pickSerial', { n: qty }), 'err'); return false; } done = true; res(sel); } }], onCancel: () => res(null) });
    m.addEventListener('click', (e) => { if (!done && e.target.matches('[data-b="0"]')) res(null); });
  });
}
function customerPicker() {
  const m = modal({ title: t('customer'), body: '<input id="cq" placeholder="' + t('search') + '" autofocus><div id="cl"></div>', buttons: [{ label: t('noCustomer'), onClick: () => { App.cart.customerId = null; App.cart.redeem = false; Sell.renderCart(); } }, { label: t('close') }] });
  const draw = () => { const q = $('#cq', m).value.toLowerCase(); const hits = App.db.customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 30);
    $('#cl', m).innerHTML = hits.map((c) => '<div class="rowline"><span>' + esc(c.name) + ' <small class="muted">' + esc(c.phone || '') + '</small></span><button class="btn sm primary" data-pick="' + c.id + '">' + t('select') + '</button></div>').join('') || '<div class="empty">' + t('none') + '</div>'; };
  m.addEventListener('input', draw); m.addEventListener('click', (e) => { if (e.target.dataset.pick) { App.cart.customerId = e.target.dataset.pick; Sell.renderCart(); m.close(); } }); draw();
}
function couponPicker() {
  const cur0 = App.cart.couponCode;
  const m = modal({ title: t('cpButton'), body: '<label>' + t('cpEnter') + '</label><input id="cp-code" dir="ltr" value="' + esc(cur0 || '') + '" autofocus autocomplete="off">', enter: 1,
    buttons: [{ label: t('cancel') }, { label: t('cpRemove'), onClick: () => { App.cart.couponCode = ''; Sell.renderCart(); Sell.pushDisplay(); } }, { label: t('cpApply'), cls: 'primary', onClick: (w) => {
      const code = $('#cp-code', w).value.trim().toUpperCase(); if (!code) return false;
      try { Core.checkCoupon(App.db, code, { customerId: App.cart.customerId }); const r0 = Core.computeCart({ lines: App.cart.lines.map((l) => { const it = App.db.items.find((x) => x.id === l.itemId); return Object.assign({}, l, { group: it ? it.group : '', taxExempt: it && it.taxExempt }); }), coupon: Core.findCoupon(App.db, code) }, App.db.promos, App.db.settings);
        if (!(r0.couponDisc > 0)) { toast(t('err_COUPON_MIN_TOTAL'), 'err'); return false; }
        App.cart.couponCode = code; Sell.renderCart(); Sell.pushDisplay(); toast(t('cpApplied')); } catch (e) { toast(errMsg(e), 'err'); return false; } } }] });
  return m;
}
function openShiftModal() {
  const fields = [{ k: 'cash', label: t('openingCash'), type: 'number', step: 'any', def: 0, first: true }, { k: 'profile', label: t('profileName'), def: App.db.settings.storeName }];
  modal({ title: t('openShift'), body: '<div class="grid2">' + form(fields) + '</div>', buttons: [{ label: t('cancel') }, { label: t('openShift'), cls: 'primary', onClick: (w) => {
    const v = readForm(w, fields); if (v.cash == null || v.cash < 0) { toast(t('invalidValue'), 'err'); return false; }
    try { Core.openShift(App.db, App.user, v.cash, v.profile); save(true); App.shift = curShift(); renderView(); } catch (e) { toast(errMsg(e), 'err'); return false; } } }], enter: 1 });
}

// ---------- receipt ----------
function barcodeSvg(text) {
  try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, text, { format: 'CODE128', height: 40, width: 1.5, displayValue: true, fontSize: 12, margin: 0 }); return svg.outerHTML; } catch (e) { return '<b>' + esc(text) + '</b>'; }
}
function exchangeBlock(doc, l, m) {
  const no = doc.exchangeReceiptNo || doc.newExchangeReceipt; if (!no) return '';
  const rec = (App.db.exchangeReceipts || []).find((x) => x.no === no); if (!rec) return '';
  return '<div style="border:1px dashed #000;padding:3px;margin-top:4px"><h3>' + tr('rcExchange', l) + '</h3><p>' + barcodeSvg(rec.no) + '</p><table><tr><td>' + tr('rcValue', l) + '</td><td class="e"><b>' + m(rec.amount) + '</b></td></tr>' +
    (rec.expiresOn ? '<tr><td>' + tr('rcValidUntil', l) + '</td><td class="e"><b>' + esc(rec.expiresOn) + '</b></td></tr>' : '') + '</table>' +
    (rec.windowDays ? '<p class="sm">' + tr('rcWindow', l, { n: rec.windowDays }) + '</p>' : '') + '</div>';
}
function termsBlock(s) {
  const a = (s.receiptTermsAr || '').trim(), e = (s.receiptTermsEn || '').trim(); if (!a && !e) return '';
  return '<hr><div class="sm" style="white-space:pre-wrap">' + (a ? '<div dir="rtl">' + esc(a) + '</div>' : '') + (e ? '<div dir="ltr">' + esc(e) + '</div>' : '') + '</div>';
}

// ---------- printable gift cards (85.6 x 54 mm on A4, 8 per page). QR and Code 128 both carry the card number. ----------
function qrSvg(text, px) {
  try { const q = qrcode(0, 'M'); q.addData(String(text)); q.make(); const n = q.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += '<rect x="' + c + '" y="' + r + '" width="1.02" height="1.02"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + ' ' + n + '" fill="#12284C" shape-rendering="crispEdges">' + d + '</svg>'; } catch (e) { return ''; }
}
function giftCardFrontHTML(row, store) {
  const acc = row.value >= 1000 ? '#1BA39C' : '#F2A93B'; const no = row.no;
  let bars = ''; try { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); JsBarcode(svg, no, { format: 'CODE128', height: 40, width: 2, displayValue: false, margin: 0 }); bars = svg.outerHTML; } catch (e) { bars = ''; }
  const mark = '<svg width="70" height="70" viewBox="0 0 120 120"><circle cx="60" cy="60" r="22" fill="#fff"/><ellipse cx="60" cy="60" rx="52" ry="22" fill="none" stroke="#1BA39C" stroke-width="7" transform="rotate(-25 60 60)"/><circle cx="104" cy="40" r="9" fill="#F2A93B"/></svg>';
  return '<div class="gcell"><div class="gcard" style="background:linear-gradient(135deg,#12284C,#0d1d38);color:#fff"><div class="gtop"><div class="gbrand">' + mark + '<b>ORBIT</b></div><div class="ggc">بطاقة هدية<br><span>GIFT CARD</span></div></div>' +
    '<div class="gval" style="color:' + acc + '">' + money(row.value) + '<small> ' + esc(App.db.settings.currency || '') + '</small></div>' +
    '<div class="gmid"><div class="gqr">' + qrSvg(no, 110) + '</div><div><div class="glab">رقم البطاقة · Card No.</div><div class="gno">' + esc(no) + '</div><div class="gbar">' + bars.replace('<svg ', '<svg style="width:280px;height:42px" preserveAspectRatio="none" ') + '</div></div></div><div class="gfoot">' + esc(store) + '</div></div></div>';
}
function giftCardBackHTML(store) {
  return '<div class="gcell"><div class="gcard" style="background:#F1F5F9;color:#12284C"><div style="height:70px;background:#12284C"></div><div style="direction:rtl;padding:26px 40px;font-size:19px;line-height:1.7"><b style="font-size:23px">الشروط · Terms</b><br>• البطاقة لحاملها وتُستخدم كوسيلة دفع على المشتريات من المحل.<br>• لا تُستبدل بنقد. الرصيد المتبقي يبقى على البطاقة.<br>• الاحتفاظ بالبطاقة مسؤولية حاملها.<br><span dir="ltr" style="display:block;margin-top:6px">• Redeemable in store as a payment method. Not exchangeable for cash. Remaining balance stays on the card.</span></div>' +
    '<div style="position:absolute;bottom:22px;left:40px;right:40px;font-size:17px;display:flex;justify-content:space-between"><span>' + esc(store) + '</span><span>توقيع / Signature: ____________</span></div></div></div>';
}
function giftCardsSheetHTML(rows) {
  const store = App.db.settings.storeName || ''; const pages = []; const per = 8;
  for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per));
  const css = '@page{size:A4;margin:0}*{box-sizing:border-box;margin:0}body{font-family:"Segoe UI","Noto Sans Arabic",Tahoma,Arial,sans-serif}.pg{width:210mm;height:297mm;padding:31mm 15.4mm 0;display:grid;grid-template-columns:85.6mm 85.6mm;grid-auto-rows:54mm;gap:6mm 8mm;page-break-after:always;direction:ltr}.pg.back{direction:rtl}' +
    '.gcell{width:85.6mm;height:54mm;outline:.2mm dashed #999;outline-offset:.6mm;overflow:hidden;border-radius:3mm}.gcard{zoom:.378;width:856px;height:540px;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.gtop{display:flex;justify-content:space-between;padding:36px 44px;direction:ltr;align-items:flex-start}.gbrand{display:flex;align-items:center;gap:14px;font-size:34px;letter-spacing:6px}.ggc{text-align:right;font-size:26px}.ggc span{font-size:16px;letter-spacing:4px;opacity:.7}' +
    '.gval{font-size:120px;font-weight:800;padding:0 44px;direction:ltr;line-height:1}.gval small{font-size:28px;color:#fff;font-weight:400}.gmid{position:absolute;left:44px;right:44px;bottom:70px;display:flex;gap:26px;align-items:flex-end;direction:ltr}.gqr{background:#fff;padding:8px;border-radius:12px;line-height:0}' +
    '.glab{font-size:17px;opacity:.75;margin-bottom:6px}.gno{font-size:34px;letter-spacing:4px;font-family:"Consolas","DejaVu Sans Mono",monospace;margin-bottom:10px}.gbar{background:#fff;padding:6px 10px;border-radius:8px;display:inline-block;line-height:0}.gfoot{position:absolute;bottom:20px;left:0;right:0;text-align:center;font-size:17px;opacity:.7}';
  const front = pages.map((p) => '<div class="pg">' + p.map((r) => giftCardFrontHTML(r, store)).join('') + '</div>').join('');
  const back = '<div class="pg back">' + Array(Math.min(per, rows.length)).fill(giftCardBackHTML(store)).join('') + '</div>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Gift cards</title><style>' + css + '</style></head><body>' + front + back + '</body></html>';
}
async function printGiftCards(rows) {
  const html = giftCardsSheetHTML(rows);
  try { const r = await window.api.print(html, { silent: false }); if (r && !r.ok && r.reason !== 'cancelled' && r.reason !== 'Print job canceled') toast(t('printFail') + ' ' + (r.reason || ''), 'err'); } catch (e) { toast(t('printFail'), 'err'); }
}
function giftVoucherHTML(doc, l) {
  const s = App.db.settings; const g = Core.findGiftCard(App.db, doc.giftCardNo) || {}; const rtl = l === 'ar'; const w = s.receiptWidth === 58 ? '54mm' : '76mm'; const m = (n) => money(n, l);
  return '<!doctype html><html dir="' + (rtl ? 'rtl' : 'ltr') + '" lang="' + l + '"><head><meta charset="utf-8"><style>@page{size:' + w + ' auto;margin:0}*{box-sizing:border-box}body{width:' + w + ';margin:0 auto;padding:3mm;font:12px/1.35 "Segoe UI",Tahoma,Arial,sans-serif;color:#000}h2,h3,p{margin:0;text-align:center}.big{font-size:20px;font-weight:bold}</style></head><body>' +
    '<h2>' + esc(s.storeName) + '</h2><hr><h3>' + tr('rcGiftTitle', l) + '</h3><p>' + barcodeSvg(g.no || doc.giftCardNo) + '</p><p class="big">' + m(g.initial != null ? g.initial : doc.total) + ' ' + esc(s.currency) + '</p>' +
    '<p>' + tr('rcGiftValid', l) + ': ' + esc(g.expiresOn || tr('rcGiftNoExpiry', l)) + '</p><hr><p>' + esc(doc.no) + ' · ' + new Date(doc.ts).toLocaleDateString(rtl ? locFor('ar') : 'en-GB') + '</p>' + termsBlock(s) + '</body></html>';
}
function receiptHTML(doc, l) {
  if (doc.type === 'giftsale') return giftVoucherHTML(doc, l || App.db.settings.receiptLang);
  const s = App.db.settings; l = l || s.receiptLang; const rtl = l === 'ar'; const w = s.receiptWidth === 58 ? '54mm' : '76mm';
  const m = (n) => money(n, l); const isRet = doc.type === 'return';
  const rows = (isRet ? doc.lines.map((x) => ({ name: (l === 'en' && x.nameEn) ? x.nameEn : x.name, qty: x.qty, total: -x.value })) : doc.lines.map((x) => ({ name: (l === 'en' && x.nameEn) ? x.nameEn : x.name, qty: x.qty, price: x.price, total: x.total, promo: x.promoNames })));
  const pay = (doc.payments || []).map((p) => '<tr><td>' + tr('pm_' + p.method, l) + (p.ref ? ' <span class="sm">#' + esc(p.ref) + '</span>' : '') + '</td><td class="e">' + m(p.amount) + '</td></tr>').join('');
  return '<!doctype html><html dir="' + (rtl ? 'rtl' : 'ltr') + '" lang="' + l + '"><head><meta charset="utf-8"><style>@page{size:' + w + ' auto;margin:0}*{box-sizing:border-box}body{width:' + w + ';margin:0 auto;padding:3mm;font:12px/1.35 "Segoe UI",Tahoma,Arial,sans-serif;color:#000}h2,h3,p{margin:0;text-align:center}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.e{text-align:' + (rtl ? 'left' : 'right') + '}hr{border:0;border-top:1px dashed #000;margin:4px 0}.big{font-size:15px;font-weight:700}.sm{font-size:10px}</style></head><body>' +
    '<h2>' + esc(s.storeName) + '</h2>' + (s.storeAddress ? '<p class="sm">' + esc(s.storeAddress) + '</p>' : '') + (s.storePhone ? '<p class="sm">' + esc(s.storePhone) + '</p>' : '') + (s.taxNumber ? '<p class="sm">' + tr('taxNo', l) + ': ' + esc(s.taxNumber) + '</p>' : '') +
    '<hr><h3>' + tr(isRet ? 'rcReturn' : 'rcInvoice', l) + '</h3>' + (doc.rev ? '<p><b>' + tr('rcRevised', l) + ' ' + doc.rev + '</b></p>' : '') + '<table><tr><td>' + tr('rcNo', l) + '</td><td class="e">' + esc(doc.no) + '</td></tr><tr><td>' + tr('rcDate', l) + '</td><td class="e">' + new Date(doc.ts).toLocaleString(rtl ? locFor('ar') : 'en-GB') + '</td></tr><tr><td>' + tr('rcCashier', l) + '</td><td class="e">' + esc(doc.userName) + '</td></tr>' +
    (isRet ? '<tr><td>' + tr('rcOrig', l) + '</td><td class="e">' + esc(doc.saleNo) + '</td></tr>' : '') + '<tr><td>' + tr('customer', l) + '</td><td class="e">' + esc(doc.customerName || tr('rcCashCustomer', l)) + '</td></tr>' + '</table><hr>' +
    '<table>' + rows.map((r) => '<tr><td colspan="2"><b>' + esc(r.name) + '</b></td></tr><tr><td>' + (r.price != null ? r.qty + ' × ' + m(r.price) : r.qty) + (r.promo && r.promo.length ? ' <span class="sm">(' + esc(r.promo.join(', ')) + ')</span>' : '') + '</td><td class="e">' + m(r.total) + '</td></tr>').join('') + '</table><hr>' +
    (isRet ? '<table><tr class="big"><td>' + tr('rcRefund', l) + '</td><td class="e">' + m(doc.refund) + ' ' + esc(s.currency) + '</td></tr></table>' :
      '<table>' + (doc.lineDisc + doc.invoiceDisc > 0 ? '<tr><td>' + tr('rcSaved', l) + '</td><td class="e">' + m(doc.lineDisc + doc.invoiceDisc) + '</td></tr>' : '') + '<tr><td>' + tr('incl_tax', l) + '</td><td class="e">' + m(doc.tax) + '</td></tr><tr class="big"><td>' + tr('total', l) + '</td><td class="e">' + m(doc.total) + ' ' + esc(s.currency) + '</td></tr>' + pay + (doc.change > 0 ? '<tr><td>' + tr('change', l) + '</td><td class="e">' + m(doc.change) + '</td></tr>' : '') + '</table>') +
    (doc.exchangeCredit ? '<table><tr><td>' + tr('rcCreditUsed', l) + ' ' + esc(doc.exchangeCredit.no) + '</td><td class="e">' + m(doc.exchangeCredit.amount) + '</td></tr></table>' : '') +
    (doc.coupon ? '<table><tr><td>' + tr('rcCoupon', l) + ' ' + esc(doc.coupon.code) + '</td><td class="e">−' + m(doc.coupon.amount) + '</td></tr></table>' : '') +
    (doc.giftCard ? (() => { const g = Core.findGiftCard(App.db, doc.giftCard.no); return '<table><tr><td>' + tr('rcGiftCard', l) + ' ' + esc(doc.giftCard.no) + '</td><td class="e">' + m(doc.giftCard.amount) + '</td></tr>' + (g ? '<tr><td>' + tr('rcGiftLeft', l) + '</td><td class="e">' + m(g.balance) + '</td></tr>' : '') + '</table>'; })() : '') +
    exchangeBlock(doc, l, m) + termsBlock(s) +
    '<hr><p>' + esc(s.receiptFooter || tr('rcThanks', l)) + '</p><p class="sm">' + esc(doc.no) + '</p></body></html>';
}
async function printReceipt(doc, l) {
  const html = receiptHTML(doc, l); const pr = App.db.settings.printer;
  if (pr && pr.type !== 'system') { try { const r = await window.api.printRaw(html, pr, { drawer: false }); if (!r.ok) toast(t('printFail') + ' ' + (r.reason || ''), 'err'); } catch (e) { toast(t('printFail'), 'err'); } return; }
  try { const r = await window.api.print(html, { silent: false }); if (r && !r.ok && r.reason !== 'cancelled' && r.reason !== 'Print job canceled') toast(t('printFail') + ' ' + (r.reason || ''), 'err'); } catch (e) { toast(t('printFail'), 'err'); }
}

window.addEventListener('DOMContentLoaded', boot);

// Each user picks his own theme (kept on his user record). The store setting is the fallback before login and for users who never chose.
function themePicker() {
  const cur = Core.themeOf(App.db.settings, App.user);
  const sw = { brand: 'linear-gradient(135deg,#12284C,#1BA39C 70%,#F2A93B)', galaxy: 'radial-gradient(circle at 70% 30%,#8b6cff,#060413 70%)', light: 'linear-gradient(135deg,#F1F5F9,#fff)', dark: '#000' };
  const m = modal({ title: t('theme'), body: '<div class="themes">' + Core.THEMES.map((k) => '<button class="theme-pick' + (k === cur ? ' on' : '') + '" data-theme-pick="' + k + '"><i style="background:' + sw[k] + '"></i><b>' + t('th_' + k) + '</b></button>').join('') + '</div><p class="muted sm">' + t('themeHint') + '</p>', buttons: [{ label: t('close') }] });
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-theme-pick]'); if (!b) return; App.user.theme = b.dataset.themePick; save(); applyTheme(); m.querySelectorAll('.theme-pick').forEach((x) => x.classList.toggle('on', x === b)); try { window.api.updateDisplay({ theme: Core.themeOf(App.db.settings, App.user) }); } catch (er) {} });
}
