// Minimal GeoTIFF-leser for Kartverkets WCS-svar (ukomprimert float32/int16, striper eller fliser).

export function readTiff(buf) {
  const dv = new DataView(buf);
  const bo = dv.getUint16(0);
  if (bo !== 0x4949 && bo !== 0x4d4d) throw new Error('Ikke en TIFF-fil');
  const le = bo === 0x4949;
  const g16 = (o) => dv.getUint16(o, le), g32 = (o) => dv.getUint32(o, le);
  if (g16(2) !== 42) throw new Error('BigTIFF støttes ikke');
  const ifd = g32(4), cnt = g16(ifd), T = {};
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
  for (let i = 0; i < cnt; i++) {
    const e = ifd + 2 + i * 12, tag = g16(e), type = g16(e + 2), c = g32(e + 4);
    const bytes = (SZ[type] || 1) * c, off = bytes <= 4 ? e + 8 : g32(e + 8);
    const v = [];
    for (let k = 0; k < c && k < 4096; k++) {
      const o = off + k * (SZ[type] || 1);
      v.push(type === 3 ? g16(o) : type === 4 ? g32(o) : type === 12 ? dv.getFloat64(o, le) : type === 11 ? dv.getFloat32(o, le) : dv.getUint8(o));
    }
    T[tag] = type === 2 ? String.fromCharCode(...v).replace(/\0+$/, '') : v;
  }
  const W = T[256][0], H = T[257][0];
  const bps = T[258] ? T[258][0] : 8, comp = T[259] ? T[259][0] : 1, fmt = T[339] ? T[339][0] : 1;
  if (comp !== 1) throw new Error('Komprimert TIFF støttes ikke (' + comp + ')');
  const read = bps === 32 && fmt === 3 ? (o) => dv.getFloat32(o, le)
    : bps === 16 && fmt === 2 ? (o) => dv.getInt16(o, le)
    : bps === 16 ? (o) => dv.getUint16(o, le)
    : bps === 32 && fmt === 2 ? (o) => dv.getInt32(o, le)
    : (o) => dv.getUint8(o);
  const bpp = bps / 8, out = new Float32Array(W * H);
  if (T[322]) {
    const tw = T[322][0], th = T[323][0], offs = T[324], tx = Math.ceil(W / tw);
    offs.forEach((o, ti) => {
      const x0 = (ti % tx) * tw, y0 = Math.floor(ti / tx) * th;
      for (let y = 0; y < th; y++) {
        const Y = y0 + y; if (Y >= H) break;
        for (let x = 0; x < tw; x++) { const X = x0 + x; if (X < W) out[Y * W + X] = read(o + (y * tw + x) * bpp); }
      }
    });
  } else {
    const offs = T[273], rps = T[278] ? T[278][0] : H;
    offs.forEach((o, si) => {
      const n = Math.min(rps * W, W * H - si * rps * W);
      for (let i = 0; i < n; i++) out[si * rps * W + i] = read(o + i * bpp);
    });
  }
  const nodata = typeof T[42113] === 'string' ? parseFloat(T[42113]) : null;
  const scale = T[33550] || null, tie = T[33922] || null;
  return { W, H, data: out, nodata, scale, tie };
}
