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
- Promotions (Settings-free, own screen): percent, amount per unit, buy X get Y (with optional % off the "get" units), bundle (N for a fixed price), invoice % / amount with a minimum total, date range, stackable flag, priority.
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
