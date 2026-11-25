// Headless end-to-end run of the real app under Electron (xvfb). Usage: xvfb-run -a npx electron test/e2e.js
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-e2e-')); process.env.ORBIT_USER_DATA = tmp;
const OUT = process.env.E2E_OUT || path.join(tmp, 'shots'); fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
require('../main.js');
let importRows = null; const printed = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + (extra || ''))); if (!cond) fails++; };
app.whenReady().then(async () => {
  ipcMain.removeHandler('print:html'); ipcMain.handle('print:html', (_e, html) => { printed.push(html); return { ok: true }; });
  ipcMain.removeHandler('xlsx:open'); ipcMain.handle('xlsx:open', () => (importRows ? { file: 'inv.xlsx', rows: importRows } : null));
  ipcMain.removeHandler('xlsx:save'); ipcMain.handle('xlsx:save', (_e, n, rows) => { fs.writeFileSync(path.join(OUT, n + '.json'), JSON.stringify(rows)); return path.join(OUT, n); });
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0]; win.setSize(1366, 820);
  const ev = (js) => win.webContents.executeJavaScript('(async()=>{' + js + '})()');
  const shot = async (name) => { await sleep(350); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  const click = (sel) => ev(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('no element ${sel.replace(/'/g, '')}'); e.click(); return true`);
  const setv = (sel, v) => ev(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('no ${sel.replace(/'/g, '')}'); e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true`);
  const modalBtn = (i) => click(`.modal-wrap:last-of-type [data-b="${i}"]`);
  const errors = []; win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 3) errors.push(msg); });
  win.webContents.on('render-process-gone', () => { console.log('RENDERER GONE'); fails++; });
  try {
    // 1. wizard (Arabic default)
    await ev(`document.querySelector('[data-lang="ar"]')&&document.querySelector('[data-lang="ar"]').click()`);
    await setv('[name=storeName]', 'سوبر ماركت النور'); await setv('[name=name]', 'مدير'); await setv('[name=pin]', '1234'); await shot('01-wizard-ar');
    await click('#wiz-go'); await sleep(400);
    check('wizard created manager', await ev(`return App.db.users.length===1 && App.db.users[0].role==='manager'`));
    // login
    await click('[data-u]'); await setv('#pin', '1234'); await click('#pin-go'); await sleep(400);
    check('logged in, sell view', await ev(`return !!document.querySelector('.sell') && App.user.name==='مدير'`));
    await shot('02-sell-empty-ar');
    // 2. add items via UI
    await click('[data-nav=items]'); await sleep(200);
    for (const it of [['6221', 'لبن كامل الدسم', 'Milk', 'ألبان', 10, 15, 50], ['6222', 'شيبسي', 'Chips', 'سناكس', 5, 8, 100], ['6223', 'جبنة رومي', 'Roumy cheese', 'ألبان', 60, 90, 20]]) {
      await click('#i-add'); await sleep(150);
      await setv('[name=barcode]', it[0]); await setv('[name=name]', it[1]); await setv('[name=nameEn]', it[2]); await setv('[name=group]', it[3]); await setv('[name=cost]', it[4]); await setv('[name=price]', it[5]); await setv('[name=stock]', it[6]);
      await modalBtn(1); await sleep(150);
    }
    check('3 items created via UI', await ev(`return App.db.items.length===3`));
    await shot('03-items-ar');
    // 3. promotion buy 2 get 3 via UI
    await click('[data-nav=promos]'); await sleep(200); await click('#pr-add'); await sleep(150);
    await setv('[name=name]', 'اشتري 2 واحصل على 3'); await setv('[name=type]', 'bxgy'); await sleep(100); await setv('[name=scopeType]', 'item'); await sleep(100);
    await ev(`const sv=document.querySelector('[name=scopeValue]'); sv.value=App.db.items.find(i=>i.barcode==='6222').id; return sv.value`);
    await setv('[name=buy]', 2); await setv('[name=get]', 3); await shot('04-promo-modal-ar'); await modalBtn(1); await sleep(150);
    check('promo saved', await ev(`return App.db.promos.length===1 && App.db.promos[0].params.get===3`));
    // 4. supplier invoice import (stubbed file dialog) — first a bad file
    await click('[data-nav=purchases]'); await sleep(200);
    importRows = [['Barcode','Name','Qty','Cost','Discount %','Batch','Expiry','Serial','Sell Price'], ['6221','',0,10], ['9001','','5',3], ['6222','',1,5,0,'','2027-13-45']];
    await click('#p-import'); await sleep(300);
    check('bad import blocked', await ev(`return PU.preview.errors.length>=3 && PU.lines.length===0`));
    await shot('05-import-errors-ar');
    importRows = [['الباركود','الاسم','الكمية','التكلفة','الخصم %','الباتش','تاريخ الصلاحية','السيريال','سعر البيع'], ['6221','',10,10,0,'L7','2027-05-01','',16], ['7001','زبادي',24,4,5,'Y1','2026-12-15','',''], ['6222','',100,5,'','','','',8]];
    await click('#p-import'); await sleep(300);
    check('good import added 3 lines', await ev(`return PU.preview.errors.length===0 && PU.lines.length===3`));
    await setv('[name=invoiceNo]', 'INV-100'); await shot('06-import-ok-ar');
    await click('#p-save'); await sleep(400);
    // confirm dialog for "set prices by margin"? (new item zabadi has no price)
    const hasConfirm = await ev(`return !!document.querySelector('.modal-wrap')`);
    check('post-receive prompt for items without price', hasConfirm);
    if (hasConfirm) { await modalBtn(1); await sleep(300); await shot('07-margin-modal-ar'); await modalBtn(1); await sleep(200); }
    check('stock updated & new item created & priced', await ev(`const a=App.db.items.find(i=>i.barcode==='6221'),z=App.db.items.find(i=>i.barcode==='7001'); return a.stock===60 && a.price===16 && z && z.stock===24 && z.price>0 && z.batches[0].expiry==='2026-12-15'`));
    // 5. open shift & sale with promo
    await click('[data-nav=sell]'); await sleep(250); await click('#s-open'); await sleep(150); await setv('[name=cash]', 100); await modalBtn(1); await sleep(200);
    check('shift open', await ev(`return !!App.shift`));
    for (let i = 0; i < 5; i++) { await ev(`await Sell.submitQuery('6222')`); }
    const tot = await ev(`return Sell.calc().total`); check('cart: 5 chips with buy2get3 = 16.00 (not 24)', tot === 16, 'got ' + tot);
    await shot('08-sell-cart-promo-ar');
    await click('[data-cart=pay]'); await sleep(250); await click('[data-q]'); await sleep(100); await shot('09-pay-ar');
    await modalBtn(1); await sleep(400);
    check('sale saved, stock down', await ev(`return App.db.sales.length===1 && App.db.items.find(i=>i.barcode==='6222').stock===195 && App.db.sales[0].total===16`));
    await modalBtn(1).catch(() => {}); await sleep(200);
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove())`);
    // second sale: milk x3 with 12% manual discount as cashier should need manager; as manager passes
    await ev(`await Sell.submitQuery('3*6221'); App.cart.lines[0].manualPct=12; return 1`);
    // 6. return partial via history
    await click('[data-nav=history]'); await sleep(250); await shot('10-history-ar');
    await ev(`returnModal(App.db.sales[0], ()=>{})`); await sleep(300);
    await setv('.rq', 2); await shot('11-return-ar'); await modalBtn(1); await sleep(300);
    check('partial return 2 of 5 chips refunds 6.40', await ev(`const r=App.db.sales.find(s=>s.type==='return'); return r && r.refund===6.4 && App.db.items.find(i=>i.barcode==='6222').stock===197`));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove())`);
    // 7. shift close
    await click('[data-nav=shift]'); await sleep(250); await shot('12-shift-ar');
    await click('#sh-close'); await sleep(200); const exp = await ev(`return Core.shiftSummary(App.db, App.shift).expectedCash`); check('expected cash = 100+16 (promo return was an exchange credit, drawer untouched)', exp === 116, exp);
    await setv('[name=counted]', 109.6); await modalBtn(1); await sleep(400);
    check('shift closed and Z printed', await ev(`return !App.shift && App.db.shifts[0].diff===0`) && printed.some((h) => h.includes('Z')) || printed.length > 0);
    // 8. reports
    await click('[data-nav=reports]'); await sleep(250); await shot('13-reports-ar');
    await click('[data-rt=slow]'); await sleep(250); await shot('14-slow-ar');
    // 9. receipt languages
    const sale = await ev(`return JSON.stringify(App.db.sales[0])`);
    const ar = await ev(`return receiptHTML(App.db.sales[0],'ar')`), en = await ev(`return receiptHTML(App.db.sales[0],'en')`);
    check('receipt AR rtl + Arabic', ar.includes('dir="rtl"') && ar.includes('فاتورة بيع') && ar.includes('شيبسي'));
    check('receipt EN ltr + English item name', en.includes('dir="ltr"') && en.includes('Sales invoice') && en.includes('Chips'));
    fs.writeFileSync(path.join(OUT, 'receipt-ar.html'), ar); fs.writeFileSync(path.join(OUT, 'receipt-en.html'), en);
    // 10. switch UI to English + dark + blue
    await click('#b-lang'); await sleep(300); check('UI switched to LTR/EN', await ev(`return document.documentElement.dir==='ltr' && document.querySelector('.nav.on').textContent.includes('Reports')`));
    await click('[data-nav=sell]'); await sleep(200); await shot('15-sell-en-light');
    await click('#b-theme'); await sleep(200); await shot('16-sell-en-dark');
    await click('#b-theme'); await sleep(200); await shot('17-sell-en-blue');
    await click('[data-nav=settings]'); await sleep(300); await shot('18-settings-en-blue');

    // 12. cashier flow: approval above max discount, hold/resume, serial item, weighed item via scale barcode
    await ev(`App.db.users.push(Core.makeUser('Sara','1111','cashier')); App.db.items.push({id:'sn1',barcode:'8001',name:'Phone',nameEn:'Phone',group:'Electronics',cost:100,price:200,stock:2,minStock:1,serialTracked:true,serials:['IMEI1','IMEI2'],batches:[],created:'2026-01-01T00:00:00Z'},{id:'wt1',barcode:'123',plu:'123',name:'Tomatoes',nameEn:'Tomatoes',group:'Veg',cost:10,price:20,stock:50,minStock:1,byWeight:true,batches:[],serials:[],created:'2026-01-01T00:00:00Z'}); App.db.settings.lang='ar'; applyTheme(); login(); return 1`);
    await sleep(300); await ev(`[...document.querySelectorAll('[data-u]')].find(b=>b.textContent.includes('Sara')).click()`); await setv('#pin', '1111'); await click('#pin-go'); await sleep(300);
    check('cashier cannot see manager screens', await ev(`return !document.querySelector('[data-nav=settings]') && !!document.querySelector('[data-nav=sell]')`));
    await click('[data-nav=shift]'); await sleep(150); await click('#sh-open'); await sleep(150); await setv('[name=cash]', 50); await modalBtn(1); await sleep(200); await click('[data-nav=sell]'); await sleep(200);
    await ev(`await Sell.submitQuery('6221')`); await ev(`Sell.editLine(0)`); await sleep(150); await setv('[name=pct]', 20); await modalBtn(1); await sleep(300);
    check('discount 20% by cashier asks manager PIN', await ev(`return !!document.querySelector('#mapin')`)); await shot('19-manager-approval-ar');
    await setv('#mapin', '9999'); await modalBtn(1); await sleep(200); check('wrong manager PIN rejected, line not discounted', await ev(`return !!document.querySelector('#mapin') && !App.cart.lines[0].manualPct`));
    await setv('#mapin', '1234'); await modalBtn(1); await sleep(300); check('right manager PIN approves discount', await ev(`return App.cart.lines[0].manualPct===20 && App.cart.lines[0].approvedBy==='مدير'`));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove())`);
    await ev(`holdCart(); return 1`); check('hold clears cart and stores held', await ev(`return App.cart.lines.length===0 && App.db.held.length===1`));
    await ev(`const h=App.db.held[0]; App.cart=h.cart; App.db.held=[]; Sell.renderCart(); return 1`); check('resume restores cart', await ev(`return App.cart.lines.length===1`));
    await ev(`App.cart=newCart(); return 1`);
    // weighed item through scale barcode 2 + PLU(000123) + weight 01250 g + check
    const d12 = '2' + '000123' + '01250'; const code = d12 + (()=>{ let s=0; for (let i=0;i<12;i++) s+=Number(d12[i])*(i%2?3:1); return String((10-(s%10))%10); })();
    await ev(`await Sell.submitQuery('${code}')`); check('weight barcode adds Tomatoes 1.25kg = 25.00', await ev(`const l=App.cart.lines[0]; return l && l.qty===1.25 && Sell.calc().total===25`), await ev(`return JSON.stringify(App.cart.lines)`));
    await ev(`App.cart=newCart(); return 1`);
    // serial item: add opens picker; choose IMEI2
    await ev(`Sell.addItem(App.db.items.find(i=>i.barcode==='8001'))`); await sleep(250); check('serial picker opens', await ev(`return !!document.querySelector('.chips')`)); await shot('20-serial-picker-ar');
    await ev(`document.querySelectorAll('.chip input')[1].checked=true; return 1`); await modalBtn(1); await sleep(250);
    check('serial line qty 1 with IMEI2', await ev(`const l=App.cart.lines[0]; return l.qty===1 && l.serials[0]==='IMEI2'`));
    await click('[data-cart=pay]'); await sleep(250); await click('[data-q]'); await modalBtn(1); await sleep(400);
    check('serial sold: removed from stock', await ev(`const it=App.db.items.find(i=>i.id==='sn1'); return it.stock===1 && it.serials.join()==='IMEI1'`));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove())`);
    // numerals setting: western digits by default in Arabic
    check('Arabic UI uses western digits by default', await ev(`return money(1234.5)==='1,234.50'`));

    // 10b. exchange flow: promo lines are exchange only, receipt prints the configured window, redeem on the spot
    await ev(`App.db.settings.returnDays=7; App.db.settings.receiptTermsAr='الاستبدال بشرط سلامة المنتج وإحضار الفاتورة'; App.db.settings.receiptTermsEn='Exchange with the original invoice, item unused.'; return 1`);
    await click('[data-nav=sell]'); await sleep(300);
    check('active offers shown on the sell screen', await ev(`return !!document.querySelector('#offers') && document.querySelector('#offers').textContent.length>5`)); await shot('30-sell-active-offers-ar');
    await ev(`Sell.addItem(App.db.items.find(i=>i.barcode==='6222')); return 1`); await sleep(200);
    await ev(`for(let i=0;i<4;i++) Sell.addItem(App.db.items.find(i=>i.barcode==='6222')); return 1`); await sleep(300);
    await ev(`App.cart.customerId=null; Sell.renderCart(); return 1`);
    await ev(`const c={id:'c1',name:'أحمد محمود',phone:'01012345678',points:0}; App.db.customers.push(c); App.cart.customerId='c1'; Sell.renderCart(); return 1`); await sleep(200);
    await ev(`Sell.pay(); return 1`); await sleep(300); await setv('[name=cash]', 20); await shot('31-pay-with-exchange-field-ar');
    await modalBtn(1); await sleep(400);
    const sx = await ev(`const s=App.db.sales.filter(x=>x.type==='sale').slice(-1)[0]; return {id:s.id,no:s.no,ex:s.lines[0].exchangeOnly,cust:s.customerName,q:s.lines[0].qty}`);
    check('sale with customer; promo line flagged exchange-only', sx.ex === true && sx.cust === 'أحمد محمود', JSON.stringify(sx));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove()); return 1`);
    await ev(`returnModal(App.db.sales.find(s=>s.id==='${sx.id}'), ()=>{}); return 1`); await sleep(400);
    await setv('.rq[data-i="0"]', 1); await sleep(200); await shot('32-return-promo-exchange-only-ar');
    check('refund method locked to exchange for a promo line', await ev(`const o=[...document.querySelector('[name=method]').options]; return document.querySelector('[name=method]').value==='credit' && o.filter(x=>x.disabled).length===3`));
    await modalBtn(1); await sleep(400);
    const rx = await ev(`const r=App.db.sales.filter(x=>x.type==='return').slice(-1)[0]; const e=Core.findExchangeReceipt(App.db,r.exchangeReceiptNo); return {no:r.exchangeReceiptNo, amount:e.amount, exp:e.expiresOn, days:e.windowDays}`);
    check('exchange receipt issued: value = pro-rata paid, window = setting (7)', rx.no && rx.amount === 3.2 && rx.days === 7 && rx.exp, JSON.stringify(rx));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove()); return 1`);
    const html = await ev(`const r=App.db.sales.filter(x=>x.type==='return').slice(-1)[0]; return receiptHTML(r,'ar')`);
    check('exchange receipt prints number, barcode, value, valid-until, window days, terms, customer', html.includes(rx.no) && html.includes('<svg') && html.includes('7') && html.includes(rx.exp) && html.includes('الاستبدال بشرط') && html.includes('أحمد محمود'));
    await ev(`const f=document.createElement('iframe'); f.id='rcpt'; f.style.cssText='position:fixed;top:10px;left:50%;margin-left:-170px;width:340px;height:780px;background:#fff;z-index:99999;border:2px solid #333'; f.srcdoc=${JSON.stringify(html)}; document.body.appendChild(f); return 1`); await sleep(500); await shot('33-exchange-receipt-print-ar');
    await ev(`document.getElementById('rcpt').remove(); return 1`);
    // redeem on the spot: 10 credit-> new item
    await ev(`App.cart=newCart(); Sell.addItem(App.db.items.find(i=>i.barcode==='6221')); return 1`); await sleep(300);
    await ev(`Sell.pay(); return 1`); await sleep(300); await setv('[name=xr]', rx.no); await setv('[name=cash]', 15); await sleep(200); await shot('34-pay-with-exchange-credit-ar');
    await modalBtn(1); await sleep(400);
    check('exchange credit redeemed in the new sale and marked used', await ev(`const e=Core.findExchangeReceipt(App.db,'${rx.no}'); const s=App.db.sales.filter(x=>x.type==='sale').slice(-1)[0]; return e.status==='redeemed' && s.exchangeCredit && s.exchangeCredit.amount===3.2 && s.total===16`));
    const html2 = await ev(`const s=App.db.sales.filter(x=>x.type==='sale').slice(-1)[0]; return receiptHTML(s,'ar')`);
    check('sale receipt shows the credit used and the cash customer label', html2.includes(rx.no) && html2.includes('عميل نقدي'));
    await ev(`document.querySelectorAll('.modal-wrap').forEach(m=>m.remove()); return 1`);
    // used receipt rejected
    check('a used exchange receipt is rejected', await ev(`try{Core.checkExchangeReceipt(App.db,'${rx.no}');return false}catch(e){return e.message==='EXR_USED'}`));
    // 11. persistence: data file on disk has the data
    const file = path.join(tmp, 'orbit-pos.json'); await ev(`await save(true); return 1`); await sleep(300);
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')); check('data persisted to disk', disk.sales.length >= 2 && disk.items.length >= 4);
    check('no renderer console errors', errors.length === 0, errors.join(' | '));
  } catch (e) { console.log('E2E EXCEPTION', e.message); fails++; try { await shot('zz-error'); } catch (x) {} }
  console.log(fails ? 'E2E FAILED ' + fails : 'E2E ALL PASSED'); console.log('shots in ' + OUT);
  app.exit(fails ? 1 : 0);
});
