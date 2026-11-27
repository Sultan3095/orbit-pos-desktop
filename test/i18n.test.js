const fs = require('fs'); const path = require('path'); const I = require('../src/i18n.js');
const src = ['app.js', 'views.js'].map((f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const used = new Set(); let m; const re = /\b(?:t|tr)\('([A-Za-z0-9_]+)'/g; while ((m = re.exec(src))) used.add(m[1]);
const dyn = ['nav_', 'pm_', 'pt_', 'pth_', 'rt_', 'sg_', 'err_', 'imp_', 'th_', 'cm_', 'sm_', 'hc_', 'etaState_'];
const extra = ['manager', 'cashier', 'sale', 'return', 'completed', 'voided', 'cashIn', 'cashOut', 'pm_cash', 'pm_card', 'pm_other', 'nav_sell'].concat(['percent', 'amount', 'bxgy', 'bundle', 'invoice_pct', 'invoice_amt'].flatMap((x) => ['pt_' + x, 'pth_' + x])).concat(['dash', 'sales', 'slow', 'low', 'expiry', 'stockval'].map((x) => 'rt_' + x));
let bad = 0;
[...used, ...extra].filter((k) => !dyn.includes(k)).forEach((k) => { ['en', 'ar'].forEach((l) => { if (!I[l][k]) { console.log('MISSING', l, k); bad++; } }); });
Object.keys(I.en).forEach((k) => { if (!I.ar[k]) { console.log('AR missing', k); bad++; } });
Object.keys(I.en).forEach((k) => { const a = (I.en[k].match(/\{\w+\}/g) || []).sort().join(), b = (I.ar[k].match(/\{\w+\}/g) || []).sort().join(); if (a !== b) { console.log('placeholder mismatch', k); bad++; } });
// every error code the code can throw must have a readable message in both languages (no raw codes on screen)
const codeSrc = ['../src/core.js', '../store-main.js', '../main.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
const codes = new Set(); const rc = /(?:Error\(|code: |return |push\()'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g; while ((m = rc.exec(codeSrc))) codes.add(m[1]);
['EMPTY', 'LOCKED'].forEach((c) => codes.add(c));
const NOT_ERRORS = new Set(['SHIFT_OPEN', 'PRICE_CHANGE', 'COST_ABOVE_PRICE'])  /* import warnings have imp_ texts */;
[...codes].filter((c) => !NOT_ERRORS.has(c)).forEach((c) => { ['en', 'ar'].forEach((l) => { if (!I[l]['err_' + c]) { console.log('NO ERROR TEXT', l, c); bad++; } }); });
console.log(bad ? bad + ' i18n problems' : 'i18n ok (' + Object.keys(I.en).length + ' keys)'); process.exitCode = bad ? 1 : 0;
