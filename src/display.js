const T = { ar: { total: 'الإجمالي', thanks: 'شكرًا لتسوقكم معنا', change: 'الباقي', free: 'مجاني', welcome: 'أهلاً بيك' }, en: { total: 'Total', thanks: 'Thank you for shopping with us', change: 'Change', free: 'free', welcome: 'Welcome' } };
const f = (n, l) => Number(n || 0).toLocaleString(l === 'ar' ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function draw(p) {
  p = p || {}; const l = p.lang || 'ar'; const x = T[l];
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; document.documentElement.setAttribute('data-theme', p.theme || 'light');
  const d = document.getElementById('d');
  if (p.thanks) { d.innerHTML = '<div class="dthanks"><h1>' + x.thanks + '</h1><p>' + x.total + ': ' + f(p.total, l) + ' ' + esc(p.currency) + '</p>' + (p.change > 0 ? '<p>' + x.change + ': ' + f(p.change, l) + '</p>' : '') + '</div>'; return; }
  if (!p.lines || !p.lines.length) { d.innerHTML = '<div class="dthanks"><h1>' + x.welcome + (p.store ? ' - ' + esc(p.store) : '') + '</h1></div>'; return; }
  d.innerHTML = '<div class="dlines">' + p.lines.map((r) => '<div class="dl"><span>' + esc(r.name) + ' × ' + r.qty + (r.free ? ' <i>' + x.free + '</i>' : '') + '</span><b>' + f(r.net, l) + '</b></div>').join('') + '</div><div class="dtotal"><span>' + x.total + '</span><b>' + f(p.total, l) + ' ' + esc(p.currency) + '</b></div>';
}
draw(); window.api.onDisplay(draw);
