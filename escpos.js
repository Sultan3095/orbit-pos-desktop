'use strict';
// ESC/POS building blocks + transports. Receipts are printed as a RASTER image (GS v 0), so Arabic and any
// font look the same on every ESC/POS printer: the printer never needs an Arabic code page.
const net = require('net');
const fs = require('fs');

const ESC = 0x1b, GS = 0x1d;
const init = () => Buffer.from([ESC, 0x40]);
const feed = (n) => Buffer.from([ESC, 0x64, Math.max(0, Math.min(255, n | 0))]);
const cut = () => Buffer.from([GS, 0x56, 0x42, 0x00]);               // feed to cut position and partial cut
/** Cash-drawer kick: ESC p m t1 t2. pin 0 = drawer pin 2 (connector pin 2), 1 = pin 5. Pulse = t * 2 ms. */
const drawerKick = (pin, on, off) => Buffer.from([ESC, 0x70, pin === 1 ? 1 : 0, Math.min(255, on == null ? 60 : on), Math.min(255, off == null ? 120 : off)]);

/** mono: { width (dots, multiple of 8), height, data: Buffer of width/8*height bytes, 1 = black } */
function rasterBlock(mono, maxRows) {
  maxRows = maxRows || 255; const wb = mono.width / 8; const out = [];
  for (let y = 0; y < mono.height; y += maxRows) {   // slices keep cheap printers' buffers happy
    const h = Math.min(maxRows, mono.height - y);
    out.push(Buffer.from([GS, 0x76, 0x30, 0x00, wb & 0xff, (wb >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]), mono.data.subarray(y * wb, (y + h) * wb));
  }
  return Buffer.concat(out);
}
/** BGRA (Electron toBitmap) or RGBA pixels -> 1 bit. Transparent counts as white. */
function toMono(pixels, width, height, opts) {
  opts = opts || {}; const thr = opts.threshold == null ? 160 : opts.threshold; const bgra = opts.order !== 'rgba';
  const w8 = Math.ceil(width / 8) * 8, wb = w8 / 8; const data = Buffer.alloc(wb * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; const b = bgra ? pixels[i] : pixels[i + 2], g = pixels[i + 1], r = bgra ? pixels[i + 2] : pixels[i], a = pixels[i + 3];
    const lum = a < 128 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < thr) data[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { width: w8, height, data };
}
function receiptJob(mono, o) {
  o = o || {}; const parts = [init(), rasterBlock(mono), feed(o.feed == null ? 4 : o.feed)];
  if (o.cut !== false) parts.push(cut());
  if (o.drawer) parts.push(drawerKick(o.drawerPin, o.drawerOn, o.drawerOff));
  return Buffer.concat(parts);
}
const dotsFor = (widthMm) => (Number(widthMm) === 58 ? 384 : 576);   // 58 mm = 384 dots, 80 mm = 576 dots at 203 dpi

/** profile: { type: 'network'|'serial'|'share', host, port, path } -> Promise */
function send(profile, buf, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  if (profile.type === 'network') return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: profile.host, port: Number(profile.port) || 9100 }); let done = false;
    const fin = (err) => { if (done) return; done = true; clearTimeout(tm); try { s.destroy(); } catch (e) {} err ? reject(err) : resolve(); };
    const tm = setTimeout(() => fin(new Error('PRINTER_TIMEOUT')), timeoutMs);
    s.on('error', (e) => fin(new Error('PRINTER_UNREACHABLE: ' + e.code))); s.on('connect', () => s.end(buf, () => setTimeout(() => fin(), 150)));
  });
  if (profile.type === 'serial' || profile.type === 'share') return new Promise((resolve, reject) => {
    // serial: COM3 / /dev/ttyUSB0. share: \\localhost\PrinterName (a printer shared in Windows, written raw)
    if (!profile.path) return reject(new Error('PRINTER_PATH_MISSING'));
    const path = profile.type === 'serial' && /^COM\d+$/i.test(profile.path) ? '\\\\.\\' + profile.path : profile.path;
    fs.writeFile(path, buf, (e) => (e ? reject(new Error('PRINTER_UNREACHABLE: ' + (e.code || e.message))) : resolve()));
  });
  return Promise.reject(new Error('PRINTER_TYPE'));
}
/** Decoder used by the tests and the fake printer: splits a job into commands. */
function decode(buf) {
  const ev = []; let i = 0;
  while (i < buf.length) {
    if (buf[i] === ESC && buf[i + 1] === 0x40) { ev.push({ t: 'init' }); i += 2; }
    else if (buf[i] === ESC && buf[i + 1] === 0x64) { ev.push({ t: 'feed', n: buf[i + 2] }); i += 3; }
    else if (buf[i] === ESC && buf[i + 1] === 0x70) { ev.push({ t: 'drawer', pin: buf[i + 2], on: buf[i + 3], off: buf[i + 4] }); i += 5; }
    else if (buf[i] === GS && buf[i + 1] === 0x56) { ev.push({ t: 'cut', m: buf[i + 2] }); i += 4; }
    else if (buf[i] === GS && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) { const wb = buf[i + 4] | (buf[i + 5] << 8), h = buf[i + 6] | (buf[i + 7] << 8); ev.push({ t: 'raster', wb, h }); i += 8 + wb * h; }
    else { ev.push({ t: 'unknown', b: buf[i] }); i++; }
  }
  return ev;
}
module.exports = { init, feed, cut, drawerKick, rasterBlock, toMono, receiptJob, dotsFor, send, decode };
