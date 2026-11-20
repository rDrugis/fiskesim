// Formatering av tall, retninger og tid på norsk.
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
export const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
export const dec = (v, d = 1) => (v == null || v !== v ? '–' : v.toFixed(d).replace('.', ','));
export const int = (v) => (v == null || v !== v ? '–' : String(Math.round(v)));
export const deg3 = (v) => String(Math.round(((v % 360) + 360) % 360) % 360).padStart(3, '0') + '°';

const TZ = 'Europe/Oslo';
export const clock = (t) => new Date(t).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const dateShort = (t) => new Date(t).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: TZ });
export const dateTime = (t) => `${dateShort(t)} kl. ${clock(t)}`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lightWord(elev) {
  if (elev > 6) return 'dagslys';
  if (elev > -0.8) return 'lavt sollys';
  if (elev > -6) return 'skumring';
  if (elev > -12) return 'nautisk skumring';
  return 'mørkt';
}
