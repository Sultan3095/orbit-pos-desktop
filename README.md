# Orbit POS (desktop)

A standalone point of sale for shops and supermarkets. No server, no ERPNext. Works offline. Arabic and English (interface and receipt, chosen separately). Themes: light/white, dark/black, blue, plus a custom accent color.

## Run
```
npm install
npm start
```
Tests (no screen needed): `npm test` (business logic + translations).
End-to-end run of the real app (Linux with xvfb): `xvfb-run -a npx electron test/e2e.js`.

## Build
- Windows folder app: `npm run pack:win` (output in `dist/`, run `Orbit POS.exe`).
- Installers (.exe / .dmg / AppImage): push to GitHub and run the "Build installers" workflow (Actions tab), or run `npm run dist` on the matching OS.

## Data
One JSON file in the app data folder (`%APPDATA%\Orbit POS\orbit-pos.json` on Windows). Saves are atomic and keep a `.bak`. A backup is made every day and on exit (last 40 kept) in a folder you can change in Settings. Restore from Settings.

## What is inside
- Sell: barcode scan, `3*barcode` for quantity, search, hold/resume, split payment (cash/card/other), line and invoice discounts, manager PIN for discounts above the cashier limit, loyalty points, customer screen on a second monitor.
- Promotions (own screen, no Settings needed): percent, amount per unit, buy X get Y (with optional % off the "get" units), bundle (N for a fixed price), invoice % / amount with a minimum total, date range, stackable flag, priority.
  "Buy 2 get 3" means: in every complete group of 5 units, 3 are free (cheapest units in the group). Tested for 4, 5, 7, 10 units and split lines.
- Items: barcode (auto-generate), Arabic + English names, groups, weight items (scale barcode with PLU + weight), batch/expiry (FEFO), serial numbers, stock count, set prices by margin.
- Purchases: supplier invoice by Excel import (preview, row-level errors, nothing saved until the file is clean) or line by line; weighted-average or last cost; void with stock check.
- Returns: partial, per line, pro-rata of what was really paid, return window (default 14 days, set in Settings, manager bypass), reason, origin branch/profile recorded, serials restored.
- Shifts: one open shift per user, cash in/out with reason, expected vs counted cash, Z report.
- Reports: dashboard, sales/profit/VAT, slow-moving items, low stock, expiry, stock value. Excel export.

## Excel import columns
Barcode, Name (needed only for new items), Qty, Cost, Discount %, Batch, Expiry (YYYY-MM-DD), Serial (comma separated, must equal Qty), Sell Price, Group, Unit. Arabic headers and Arabic-Indic digits are accepted. Use the "Excel template" button in Purchases.

## Not done / not verified on real hardware
- Cash drawer opening, direct serial-port scales, Egyptian e-receipt (ETA) integration, multi-terminal sync: not included.
- Thermal printing uses the Windows print dialog (set the receipt printer as default or pick it each time).
- The app is unsigned: Windows SmartScreen shows "More info > Run anyway".

## License

GPL-3.0-or-later (see LICENSE). Orbit POS is open source. The web app matches the GPL used by Frappe/ERPNext. The business model is support, hosting and customization, not license sales.

---

# Orbit POS (نسخة الديسكتوب)

برنامج كاشير مستقل للمحلات والسوبر ماركت. من غير سيرفر ومن غير ERPNext. يشتغل من غير إنترنت. عربي وإنجليزي (الواجهة والإيصال، كل واحد تختاره لوحده). ثيمات: فاتح/أبيض، غامق/أسود، أزرق، وكمان لون مخصص تختاره.

## التشغيل
```
npm install
npm start
```
الاختبارات (من غير شاشة): `npm test` (منطق البرنامج + الترجمات).
تشغيل البرنامج الحقيقي طرف-لطرف (لينكس مع xvfb): `xvfb-run -a npx electron test/e2e.js`.

## البناء
- نسخة ويندوز كمجلد: `npm run pack:win` (الناتج في `dist/`، شغّل `Orbit POS.exe`).
- ملفات تثبيت (.exe / .dmg / AppImage): ارفع على GitHub وشغّل سير عمل "Build installers" (من تبويب Actions)، أو نفّذ `npm run dist` على نظام التشغيل المناسب.

## البيانات
ملف JSON واحد في مجلد بيانات البرنامج (`%APPDATA%\Orbit POS\orbit-pos.json` على ويندوز). الحفظ ذري ويحتفظ بنسخة `.bak`. نسخة احتياطية كل يوم وعند الخروج (آخر 40 نسخة) في مجلد تقدر تغيره من الإعدادات. الاسترجاع من الإعدادات.

## الموجود في البرنامج
- البيع: مسح باركود، `3*باركود` للكمية، بحث، تعليق/استكمال، دفع مقسّم (كاش/كارت/أخرى)، خصومات على الصنف وعلى الفاتورة، رقم سري للمدير للخصومات فوق حد الكاشير، نقاط ولاء، شاشة عميل على شاشة ثانية.
- العروض (شاشة مستقلة): نسبة، مبلغ على الوحدة، اشترِ X وخد Y (مع نسبة اختيارية على وحدات الهدية)، باكج (N بسعر ثابت)، نسبة/مبلغ على الفاتورة بحد أدنى، فترة تاريخية، قابلية التجميع، أولوية.
  "اشترِ 2 وخد 3" معناها: في كل مجموعة كاملة من 5 وحدات، 3 مجاناً (أرخص الوحدات في المجموعة). متجربة لـ 4 و5 و7 و10 وحدات وللأسطر المقسومة.
- الأصناف: باركود (توليد تلقائي)، أسماء عربي + إنجليزي، مجموعات، أصناف وزنية (باركود ميزان PLU + وزن)، تشغيلة/صلاحية (FEFO)، أرقام سيريال، جرد، تسعير بالهامش.
- المشتريات: فاتورة مورد من استيراد إكسل (معاينة، أخطاء برقم الصف، لا يُحفظ شيء قبل ما الملف يبقى سليم) أو صف بصف؛ متوسط مرجح أو آخر تكلفة؛ إلغاء مع مراجعة المخزون.
- المرتجعات: جزئي، لكل صنف، بنسبة المدفوع فعلياً، مدة مرتجع (افتراضي 14 يوم، تتظبط من الإعدادات، والمدير يتجاوزها)، السبب، تسجيل الفرع/الكاشير الأصلي، رجوع السيريالات.
- الشيفتات: شيفت مفتوح واحد لكل مستخدم، إيداع/سحب كاش بالسبب، النقدية المتوقعة مقابل المعدودة، تقرير Z.
- التقارير: لوحة متابعة، مبيعات/أرباح/ض.ق.م، أصناف بطيئة الحركة، مخزون منخفض، صلاحيات، قيمة المخزون. تصدير إكسل.

## أعمدة استيراد الإكسل
الباركود، الاسم (مطلوب للأصناف الجديدة فقط)، الكمية، التكلفة، خصم %، التشغيلة، الصلاحية (YYYY-MM-DD)، السيريال (مفصولة بفواصل وعددها يساوي الكمية)، سعر البيع، المجموعة، الوحدة. العناوين العربية والأرقام العربية المشرقية مقبولة. استخدم زرار "نموذج إكسل" في المشتريات.

## غير منفَّذ / غير مؤكَّد على أجهزة حقيقية
- فتح درج النقدية، موازين السيريال المباشرة، تكامل الفاتورة الإلكترونية المصرية (ETA)، المزامنة بين الأجهزة: غير موجودة.
- الطباعة الحرارية بتستخدم نافذة طباعة ويندوز (عيّن طابعة الإيصالات كافتراضية أو اخترها كل مرة).
- البرنامج غير موقَّع: Windows SmartScreen يعرض "More info > Run anyway".

## الرخصة

GPL-3.0-or-later (انظر LICENSE). Orbit POS مفتوح المصدر. تطبيق الويب على نفس رخصة GPL المستخدمة في Frappe/ERPNext. النموذج التجاري هو الدعم والاستضافة والتخصيص، وليس بيع التراخيص.
