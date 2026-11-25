# On-site hardware checklist (Orbit POS desktop)

Nothing below was verified on real hardware by the build team. The software is tested against a fake ESC/POS printer
(byte-exact job decoding) only. Walk through this list on the real devices before going live.

## Receipt printer
1. Connect the printer (LAN: set a fixed IP, note port 9100. USB: share it in Windows, e.g. \\localhost\POS80. Serial: note the COM port).
2. Settings > Printer and cash drawer: choose the type, fill IP/port or path, choose paper width (58 or 80 mm), Save.
3. Press "Print test page". Check: Arabic text is readable and joined, digits are correct, nothing is cut at the edges, paper cuts.
4. If the text is cut on the sides: switch paper width. If the print is too light: print speed/density is set on the printer, not in Orbit POS.
5. Print one real sale receipt and one exchange receipt. Scan the exchange barcode with the real scanner.

## Cash drawer (connected to the printer's RJ11/RJ12 port)
1. Press "Open drawer". It should open at once.
2. If it does not open: change "Drawer pin" (2 or 5) and try again. Check the cable is in the printer's drawer port, not the phone port.
3. Tick "open the drawer automatically on cash sales", make a cash sale: it opens. A card-only sale must NOT open it.

## Card machine
Card readers have no common protocol, so Orbit POS does not talk to them. The cashier types the approval/slip number
in the "Card slip / approval code" field. It prints on the receipt. Check that the machine total matches the card total at shift close.

## Barcode scanner
Keyboard-type (HID) scanners work as-is. Scan into the search box. Check that a scanner adding Enter at the end works.

## Windows account protection (safeStorage)
1. First launch: set the passphrase, write down the recovery key and keep it away from the PC.
2. Restart the app: with "protected by Windows account" it opens without asking. Log in as a different Windows user: it must NOT open.
3. Test restoring a backup on a second PC with the passphrase or the recovery key.

## Roles and shifts
1. Create a Cashier and a Manager. Check the manager sees no cost/profit anywhere.
2. Two cashiers open shifts at the same time. Each sees only their own totals.
3. Cashier closes the shift blind, the manager approves from the Shift screen and sees expected vs counted.
