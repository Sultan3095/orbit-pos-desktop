'use strict';
const assert = require('assert'); const net = require('net'); const E = require('../escpos.js');
let pass = 0, fail = 0; const tests = [];
const t = (n, f) => tests.push([n, f]);
t('mono conversion: black pixels become set bits, width padded to 8', () => {
  const w = 10, h = 2; const px = Buffer.alloc(w * h * 4, 255); const set = (x, y) => { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; };
  set(0, 0); set(9, 1); const m = E.toMono(px, w, h);
  assert.strictEqual(m.width, 16); assert.strictEqual(m.data[0], 0x80); assert.strictEqual(m.data[1 * 2 + 1], 0x40); assert.strictEqual(m.data[1], 0);
});
t('raster command header: GS v 0, width bytes and height little-endian, sliced at 255 rows', () => {
  const m = { width: 384, height: 300, data: Buffer.alloc(48 * 300, 0xff) }; const b = E.rasterBlock(m); const ev = E.decode(b);
  assert.deepStrictEqual(ev.map((x) => x.t), ['raster', 'raster']); assert.strictEqual(ev[0].wb, 48); assert.strictEqual(ev[0].h, 255); assert.strictEqual(ev[1].h, 45);
});
t('drawer kick is ESC p pin t1 t2', () => { assert.deepStrictEqual([...E.drawerKick(0, 50, 100)], [0x1b, 0x70, 0, 50, 100]); assert.strictEqual(E.drawerKick(1)[2], 1); });
t('receipt job order: init, raster, feed, cut, drawer; no drawer when not requested', () => {
  const m = { width: 8, height: 3, data: Buffer.from([1, 2, 3]) };
  assert.deepStrictEqual(E.decode(E.receiptJob(m, { drawer: true })).map((x) => x.t), ['init', 'raster', 'feed', 'cut', 'drawer']);
  assert.deepStrictEqual(E.decode(E.receiptJob(m, { cut: false })).map((x) => x.t), ['init', 'raster', 'feed']);
});
t('paper widths: 58 mm = 384 dots, 80 mm = 576 dots', () => { assert.strictEqual(E.dotsFor(58), 384); assert.strictEqual(E.dotsFor(80), 576); });
t('network printer: job arrives byte-for-byte at a fake TCP printer on port 9100-style socket', async () => {
  const got = []; const srv = net.createServer((s) => { const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => got.push(Buffer.concat(c))); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const m = { width: 384, height: 40, data: Buffer.alloc(48 * 40, 0xaa) }; const job = E.receiptJob(m, { drawer: true });
  await E.send({ type: 'network', host: '127.0.0.1', port }, job); await new Promise((r) => setTimeout(r, 100)); srv.close();
  assert.strictEqual(got.length, 1); assert.ok(got[0].equals(job)); assert.deepStrictEqual(E.decode(got[0]).map((x) => x.t), ['init', 'raster', 'feed', 'cut', 'drawer']);
});
t('network printer down: clear error, no hang', async () => {
  const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; srv.close(); await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(E.send({ type: 'network', host: '127.0.0.1', port }, Buffer.from([1])), /PRINTER_UNREACHABLE/);
});
t('serial / share path is written raw to the device file', async () => {
  const f = require('path').join(require('os').tmpdir(), 'orbit-fake-printer-' + process.pid); await E.send({ type: 'share', path: f }, E.drawerKick(0));
  assert.deepStrictEqual([...require('fs').readFileSync(f)], [0x1b, 0x70, 0, 60, 120]); require('fs').unlinkSync(f);
  await assert.rejects(E.send({ type: 'serial' }, Buffer.from([1])), /PRINTER_PATH_MISSING/);
});
(async () => { for (const [n, f] of tests) { try { await f(); console.log('ok  - ' + n); pass++; } catch (e) { console.log('FAIL- ' + n + '\n ' + e.stack); fail++; } } console.log(pass + ' passed'); process.exit(fail ? 1 : 0); })();
