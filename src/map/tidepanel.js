// Tidevannsgraf: knappen ved siden av 3D åpner en nedtrekksboks med predikert vannstand (Kartverket) for kartmidten,
// fra midnatt i dag og to døgn frem, med nå-strek og flo/fjære.
import { tideSeries } from '../data/kartverket.js';

const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => { const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-'; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${s}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; };
const hm = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const day = (t) => new Date(t).toLocaleDateString('nb-NO', { weekday: 'short' });
const cm = (v) => Math.round(v * 100);

// flo og fjære: lokale topp- og bunnpunkter i serien (10-minutters verdier)
export function extremes(s) {
  const out = [];
  for (let i = 1; i < s.length - 1; i++) {
    const a = s[i - 1].v, b = s[i].v, c = s[i + 1].v;
    if ((b > a && b >= c) || (b < a && b <= c)) {
      const typ = b > a ? 'flo' : 'fjære', last = out[out.length - 1];
      if (last && last.typ === typ) { if ((typ === 'flo') === (b > last.v)) out[out.length - 1] = { ...s[i], typ }; } else out.push({ ...s[i], typ });
    }
  }
  return out;
}

export class TidePanel {
  constructor(api, btn, panel) {
    this.api = api; this.btn = btn; this.panel = panel; this.key = ''; this.req = 0;
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    panel.addEventListener('click', (e) => { if (e.target.closest('[data-t="close"]')) this.toggle(false); });
    document.addEventListener('click', (e) => { if (this.open && !panel.contains(e.target) && e.target !== btn) this.toggle(false); });
    api.map.on('moveend', () => { if (this.open) this.load(); });
  }
  get open() { return !this.panel.classList.contains('hidden'); }
  toggle(v = !this.open) {
    this.panel.classList.toggle('hidden', !v); this.btn.setAttribute('aria-expanded', String(v));
    if (v) this.load();
  }
  async load() {
    const c = this.api.map.getCenter(), key = c.lat.toFixed(2) + ',' + c.lng.toFixed(2);
    if (key === this.key && this.data) return this.render();
    this.key = key; const id = ++this.req;
    this.panel.innerHTML = '<header><h2>Tidevann</h2><button class="iconbtn sm" data-t="close" aria-label="Lukk">✕</button></header><p class="pmut">Henter tidevann …</p>';
    const t0 = new Date(); t0.setHours(0, 0, 0, 0); const t1 = new Date(t0.getTime() + 2 * 86400e3);
    try {
      const r = await tideSeries(c.lat, c.lng, isoLocal(t0), isoLocal(t1));
      if (id !== this.req) return;
      if (!r.series.length) throw new Error('ingen data');
      this.data = r; this.render();
    } catch (e) {
      if (id !== this.req) return;
      this.data = null;
      this.panel.innerHTML = '<header><h2>Tidevann</h2><button class="iconbtn sm" data-t="close" aria-label="Lukk">✕</button></header><p class="pmut">Fant ikke tidevann her (Kartverket har bare data langs kysten). Flytt kartet til sjøen og prøv igjen.</p>';
    }
  }
  render() {
    const r = this.data, s = r.series, W = 560, H = 170, L = 34, B = 22, T = 10, now = Date.now();
    const ta = s[0].t, tb = s[s.length - 1].t, vs = s.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), pad2 = (hi - lo) * 0.12 || 0.1;
    const y0 = lo - pad2, y1 = hi + pad2, X = (t) => L + (t - ta) / (tb - ta) * (W - L - 6), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const path = s.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join('');
    const area = path + `L${X(tb).toFixed(1)} ${H - B}L${X(ta).toFixed(1)} ${H - B}Z`;
    const ex = extremes(s);
    // nå: nærmeste verdi og om vannet stiger
    let iN = s.findIndex((p) => p.t >= now); if (iN < 1) iN = 1;
    const cur = s[Math.min(iN, s.length - 1)], rising = s[Math.min(iN + 1, s.length - 1)].v > s[iN - 1].v;
    const next = ex.find((e) => e.t > now);
    // akse: timer hver 6. time, dagsskille ved midnatt
    let grid = '';
    for (let t = ta; t <= tb; t += 3600e3 * 6) {
      const x = X(t).toFixed(1), h = new Date(t).getHours();
      grid += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" class="${h === 0 ? 'gd' : 'gl'}"/><text x="${x}" y="${H - 6}" text-anchor="middle">${h === 0 ? day(t) : pad(h)}</text>`;
    }
    const step = (hi - lo) > 2 ? 100 : 50; let yt = '';
    for (let v = Math.ceil(y0 * 100 / step) * step; v <= y1 * 100; v += step) { const y = Y(v / 100).toFixed(1); yt += `<line x1="${L}" x2="${W - 6}" y1="${y}" y2="${y}" class="gl"/><text x="${L - 5}" y="${y}" dy="3" text-anchor="end">${v}</text>`; }
    const marks = ex.map((e) => { const x = X(e.t), y = Y(e.v), up = e.typ === 'flo'; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="${up ? 'hw' : 'lw'}"/><text x="${x.toFixed(1)}" y="${(up ? y - 7 : y + 14).toFixed(1)}" text-anchor="middle" class="tl">${hm(e.t)} · ${cm(e.v)}</text>`; }).join('');
    const nx = now >= ta && now <= tb ? `<line x1="${X(now).toFixed(1)}" x2="${X(now).toFixed(1)}" y1="${T}" y2="${H - B}" class="nw"/><circle cx="${X(now).toFixed(1)}" cy="${Y(cur.v).toFixed(1)}" r="4.5" class="nd"/>` : '';
    this.panel.innerHTML = `<header><h2>Tidevann</h2><span class="pmut">${r.descr ? r.descr : r.station} · cm over sjøkartnull</span><span class="psp"></span><button class="iconbtn sm" data-t="close" aria-label="Lukk">✕</button></header>
      <p class="tnow"><b>${cm(cur.v)} cm</b> nå, ${rising ? 'stigende ↑' : 'synkende ↓'}${next ? ` · ${next.typ} kl. ${hm(next.t)} (${cm(next.v)} cm)` : ''}</p>
      <svg class="tgraph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tidevann to døgn">${yt}${grid}<path d="${area}" class="ta"/><path d="${path}" class="tp"/>${marks}${nx}</svg>
      <p class="pmut">Predikert vannstand fra Kartverket for kartmidten (ikke vind- og lufttrykkseffekter). Flytt kartet for et annet sted.</p>`;
  }
}
