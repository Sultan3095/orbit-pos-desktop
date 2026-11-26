/* Guide mascot ("Captain Orbit"): a cartoon man in a suit who shows up when something is wrong or missing,
   POINTS at the exact control, says a short line, explains when tapped, and can be dismissed. Once per issue per user. */
const Guide = (function () {
  const L = (ar, en) => ({ ar, en });
  // code -> where to point (first selector that exists), short line, full explanation
  const ISSUES = {
    EMPTY_CART: { sel: ['#q'], short: L('السلة فاضية. ضيف صنف الأول.', 'The cart is empty. Add an item first.'), long: L('اسكن الباركود أو اكتب اسم الصنف في الخانة دي وادوس Enter. بعد ما الصنف يظهر في السلة دوس دفع.', 'Scan the barcode or type the item name here and press Enter. When the item shows in the cart, press Pay.') },
    UNDERPAID: { sel: ['.modal-wrap:last-of-type [name=cash]', '[name=cash]'], short: L('المدفوع أقل من الإجمالي.', 'The payment is less than the total.'), long: L('اكتب المبلغ المستلم في خانة الكاش، أو دوس على زرار المبلغ بالظبط. لو الدفع فيزا اكتب المبلغ في خانة الفيزا.', 'Type the cash received here, or press the exact amount button. For a card payment, type the amount in the card field.') },
    GIFT: { sel: ['.modal-wrap:last-of-type [name=gc]', '[name=gc]', '#g-q'], short: L('في مشكلة في كارت الهدية.', 'There is a problem with the gift card.'), long: L('راجع رقم الكارت. الكارت لازم يكون مباع، مش منتهي ولا ملغي ولا فاضي. دوس "استعلام عن الرصيد" في شاشة الكروت تشوف حالته.', 'Check the card number. The card must be sold, not expired, cancelled or empty. Use "Check balance" on the gift cards screen to see its state.') },
    COUPON: { sel: ['[data-cart=coupon]'], short: L('الكوبون مش مقبول.', 'The coupon was not accepted.'), long: L('الكوبون ممكن يكون منتهي أو مقفول أو الفاتورة أقل من الحد الأدنى، أو محتاج عميل محدد. راجع الكوبون من شاشة الكوبونات.', 'The coupon may be expired, switched off, the invoice may be below its minimum, or it may need a named customer. Check it on the Coupons screen.') },
    NO_STOCK: { sel: ['#q'], short: L('المخزون مش كفاية.', 'Not enough stock.'), long: L('الكمية المطلوبة أكبر من الموجود. قلل الكمية أو استلم بضاعة من شاشة المشتريات.', 'The quantity is more than what is on hand. Lower it or receive stock on the Purchases screen.') },
    SHIFT_CLOSED: { sel: ['#s-open', '#b-shift'], short: L('مفيش شيفت مفتوح.', 'There is no open shift.'), long: L('افتح الشيفت الأول عشان تقدر تبيع. اكتب الكاش اللي في الدرج واضغط ابدأ.', 'Open a shift first so you can sell. Enter the cash in the drawer and press Start.') },
    DIFF_NOTE: { sel: ['.modal-wrap:last-of-type [name=note]'], short: L('فيه فرق. اكتب ملاحظة.', 'There is a difference. Write a note.'), long: L('العدد الفعلي مختلف عن المتوقع. اكتب سبب الفرق في الملاحظة قبل ما تقفل.', 'The counted cash differs from the expected cash. Write the reason in the note before closing.') },
    REASON: { sel: ['.modal-wrap:last-of-type [name=reason]'], short: L('السبب ناقص.', 'The reason is missing.'), long: L('اكتب السبب (3 حروف على الأقل). بيتسجل في سجل المراجعة.', 'Write the reason (3+ characters). It is saved in the audit log.') },
    PRICE: { sel: ['.modal-wrap:last-of-type [name=price]', '[name=price]'], short: L('السعر ناقص أو غلط.', 'The price is missing or wrong.'), long: L('اكتب سعر البيع كرقم أكبر من صفر.', 'Enter the selling price as a number above zero.') }
  };
  const MAP = [[/^EMPTY_CART$/, 'EMPTY_CART'], [/^UNDERPAID$/, 'UNDERPAID'], [/^GIFT_(MISSING|EXPIRED|EMPTY|VOID|WRITTEN_OFF|NOT_ENOUGH)$/, 'GIFT'], [/^COUPON_(MISSING|INACTIVE|NOT_STARTED|EXPIRED|USED_UP|NEEDS_CUSTOMER|CUSTOMER_LIMIT|MIN_TOTAL)$/, 'COUPON'], [/^NO_STOCK$/, 'NO_STOCK'], [/^SHIFT_CLOSED$/, 'SHIFT_CLOSED'], [/^DIFF_NOTE$/, 'DIFF_NOTE'], [/^(EDIT_REASON|GIFT_REASON)$/, 'REASON'], [/^BAD_PRICE$/, 'PRICE']];
  let cur = null;
  const lg = () => (typeof lang === 'function' ? lang() : 'ar');
  const tx = (o) => o[lg() === 'en' ? 'en' : 'ar'];
  function mascotSVG() {
    return '<svg viewBox="0 0 120 170" width="104" height="147" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse cx="60" cy="164" rx="34" ry="5" fill="#000" opacity=".18"/>' +
      '<rect x="38" y="112" width="18" height="48" rx="6" fill="#12284C"/><rect x="64" y="112" width="18" height="48" rx="6" fill="#12284C"/><rect x="34" y="156" width="26" height="9" rx="4" fill="#000"/><rect x="60" y="156" width="26" height="9" rx="4" fill="#000"/>' +
      '<path d="M30 62 Q30 52 44 50 L76 50 Q90 52 90 62 L92 118 L28 118 Z" fill="#12284C"/>' +
      '<path d="M50 50 L60 78 L70 50 Z" fill="#fff"/><path d="M57 60 L63 60 L66 100 L60 108 L54 100 Z" fill="#F2A93B"/>' +
      '<path d="M44 50 L58 76 L46 82 L36 60 Z" fill="#1BA39C" opacity=".9"/><path d="M76 50 L62 76 L74 82 L84 60 Z" fill="#1BA39C" opacity=".9"/>' +
      '<g id="g-arm" transform="rotate(0 84 62)"><rect x="82" y="56" width="40" height="12" rx="6" fill="#12284C"/><circle cx="124" cy="62" r="7.5" fill="#F3C9A0"/><rect x="124" y="59" width="12" height="5" rx="2.5" fill="#F3C9A0"/></g>' +
      '<rect x="14" y="62" width="16" height="44" rx="8" fill="#12284C"/><circle cx="22" cy="110" r="7" fill="#F3C9A0"/>' +
      '<circle cx="60" cy="30" r="23" fill="#F3C9A0"/><path d="M37 28 Q38 6 60 6 Q82 6 83 28 Q72 16 60 18 Q48 16 37 28 Z" fill="#2b1d12"/>' +
      '<circle cx="51" cy="31" r="3" fill="#222"/><circle cx="69" cy="31" r="3" fill="#222"/><path d="M52 41 Q60 47 68 41" stroke="#8a4b2a" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
      '<path d="M46 24 Q51 21 56 24 M64 24 Q69 21 74 24" stroke="#2b1d12" stroke-width="2" fill="none"/></svg>';
  }
  function ensureCss() {
    if (document.getElementById('guide-css')) return;
    const s = document.createElement('style'); s.id = 'guide-css';
    s.textContent = '#guide{position:fixed;inset:0;z-index:100000;pointer-events:none}#guide *{pointer-events:auto}#guide .gring{position:fixed;border:3px solid #F2A93B;border-radius:10px;box-shadow:0 0 0 4px rgba(242,169,59,.28),0 0 18px rgba(242,169,59,.8);pointer-events:none;animation:gpulse 1.1s ease-in-out infinite}' +
      '@keyframes gpulse{50%{box-shadow:0 0 0 9px rgba(242,169,59,.15),0 0 26px rgba(242,169,59,1)}}#guide .gbox{position:fixed;display:flex;align-items:flex-end;gap:6px;max-width:440px}#guide .gman{cursor:pointer;flex:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));transition:transform .15s}#guide .gman:hover{transform:scale(1.04)}' +
      '#guide .gbub{background:#fff;color:#12284C;border:2px solid #1BA39C;border-radius:14px;padding:10px 12px;font:600 14px/1.5 "Segoe UI",Tahoma,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);min-width:180px}#guide .gbub small{display:block;font-weight:400;margin-top:6px;opacity:.85}' +
      '#guide .gbub .gx{float:inline-end;border:0;background:#eef2f7;border-radius:8px;cursor:pointer;margin-inline-start:8px;padding:2px 8px;color:#12284C}#guide .gbub .gok{margin-top:8px;border:0;background:#1BA39C;color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-weight:600}#guide .gtap{color:#1BA39C;font-weight:600;font-size:12px}';
    document.head.appendChild(s);
  }
  function close() { const g = document.getElementById('guide'); if (g) g.remove(); cur = null; }
  function find(sels) { for (const s of sels) { const e = document.querySelector(s); if (e && e.offsetParent !== null) return e; } return null; }
  function seen(user, key) { return !!(user && user.guideSeen && user.guideSeen[key]); }
  function show(key, target, opts) {
    ensureCss(); close(); const I = ISSUES[key]; if (!I || !target) return false;
    const user = (typeof App !== 'undefined' && App.user) || null;
    const r = target.getBoundingClientRect(); const W = window.innerWidth, H = window.innerHeight;
    const g = document.createElement('div'); g.id = 'guide'; g.setAttribute('data-guide', key); g.dir = lg() === 'ar' ? 'rtl' : 'ltr';
    const ring = document.createElement('div'); ring.className = 'gring'; Object.assign(ring.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
    const box = document.createElement('div'); box.className = 'gbox'; box.style.direction = 'ltr';
    const hw = 104, hh = 147;
    // the man stands below the target when there is room, else above; to the side with more space
    const below = r.bottom + hh + 20 < H; const top = below ? r.bottom + 18 : Math.max(8, r.top - hh - 18);
    const toRight = (W - r.right) > r.left; let left = toRight ? Math.min(r.left, W - hw - 260) : Math.max(8, r.right - hw - 260);
    left = Math.max(8, Math.min(left, W - hw - 200));
    box.style.left = left + 'px'; box.style.top = top + 'px';
    box.innerHTML = '<div class="gman" title="' + (lg() === 'ar' ? 'دوس عليّ للشرح' : 'Tap me for the details') + '">' + mascotSVG() + '</div><div class="gbub"><button class="gx" data-g="x" aria-label="close">✕</button><div data-g="short">' + tx(I.short) + '</div><span class="gtap" data-g="tap">' + (lg() === 'ar' ? 'دوس عليّ للشرح' : 'Tap me to see how to fix it') + '</span></div>';
    g.appendChild(ring); g.appendChild(box); document.body.appendChild(g);
    // point the arm at the middle of the target: pivot = shoulder inside the svg
    const man = box.querySelector('.gman svg').getBoundingClientRect(); const px = man.left + 84 / 120 * man.width, py = man.top + 62 / 170 * man.height;
    const tx2 = r.left + r.width / 2, ty2 = r.top + r.height / 2; const ang = Math.atan2(ty2 - py, tx2 - px) * 180 / Math.PI;
    box.querySelector('#g-arm').setAttribute('transform', 'rotate(' + ang.toFixed(1) + ' 84 62)');
    const done = () => { if (user && opts !== 'demo') { user.guideSeen = user.guideSeen || {}; user.guideSeen[key] = 1; try { save(); } catch (e) {} } close(); };
    const explain = () => { const b = box.querySelector('.gbub'); b.innerHTML = '<button class="gx" data-g="x" aria-label="close">✕</button><div>' + tx(I.short) + '</div><small data-g="long">' + tx(I.long) + '</small><button class="gok" data-g="ok">' + (lg() === 'ar' ? 'تمام، فهمت' : 'Got it') + '</button>'; };
    g.addEventListener('click', (e) => { const d = e.target.closest('[data-g]'); if (e.target.closest('.gman') || (d && d.dataset.g === 'tap')) return explain(); if (d && (d.dataset.g === 'x' || d.dataset.g === 'ok')) done(); });
    cur = key; return true;
  }
  function forError(code) {
    const user = (typeof App !== 'undefined' && App.user) || null; if (!code || (user && user.guideOff)) return false;
    let key = null; MAP.forEach(([re, k]) => { if (!key && re.test(code)) key = k; }); if (!key || seen(user, key)) return false;
    setTimeout(() => { const el = find(ISSUES[key].sel); if (el) show(key, el); }, 120); return true;
  }
  return { show, close, forError, seen, ISSUES, current: () => cur, setOff(user, off) { user.guideOff = !!off; if (off) close(); }, reset(user) { user.guideSeen = {}; } };
})();
if (typeof module !== 'undefined') module.exports = Guide;
