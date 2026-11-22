# Rasteriserer dybdeflatene for én del (shard) av Vestland, z12-blokk for z12-blokk.
# For hver z12-flis lagres tre rutenett (Uint8: 0 = land/ingen data, 255 = tørrfall, ellers cid + 1):
#   z12: 512 × 512 (flisa + 128 px kant), z13: 768 × 768 (de fire z13-flisene + kant), z14: 1280 × 1280 (16 z14 + kant)
# Bruk: python3 raster.py <datamappe> <utmappe> <shard> <antall>
import json, math, os, sys
import numpy as np
from osgeo import gdal, ogr

gdal.UseExceptions()
data, out, SH, NSH = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
os.makedirs(out, exist_ok=True)
BB = dict(w=4.0, e=8.3, s=59.6, n=62.4)
R = 6378137.0; ORIG = math.pi * R

def tile(z, lon, lat):
    n = 2 ** z; la = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n)

def merc(z, x, y):
    s = 2 * ORIG / 2 ** z
    return -ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s

x0, y0 = tile(12, BB['w'], BB['n']); x1, y1 = tile(12, BB['e'], BB['s'])
allt = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
mine = [t for i, t in enumerate(allt) if i % NSH == SH]
# TILES="x_y,x_y" (valgfritt): bare disse z12-blokkene (brukes av testene i tools/dtm)
if os.environ.get('TILES'): mine = [tuple(map(int, t.split('_'))) for t in os.environ['TILES'].split(',')]
print(f'shard {SH}/{NSH}: {len(mine)} z12-fliser', flush=True)

# datakildene må holdes i live (ellers blir lagene ugyldige i GDAL for Python)
# Flere kilder (merge.py, sources.json): fra lavest til høyest prioritet; en kilde med høyere prioritet overskriver
# de lavere der den har data (sjø, tørrfall eller land). Én kilde: da.fgb, land.fgb og tf.fgb rett i datamappa.
DS, SRC = [], []
meta = json.load(open(os.path.join(data, 'sources.json'))) if os.path.exists(os.path.join(data, 'sources.json')) else [{'dir': '.', 'lut': None}]
for m in meta:
    d = os.path.join(data, m['dir']); L = {}
    for k in ('da', 'land', 'tf'):
        f = os.path.join(d, k + '.fgb')
        if os.path.exists(f): ds = ogr.Open(f); DS.append(ds); L[k] = ds.GetLayer(0)
    L['lut'] = np.array(m['lut'], np.int16) if m['lut'] is not None else None
    SRC.append(L)
mem = gdal.GetDriverByName('MEM')
NONE = -32768

def grid(bx0, by0, bx1, by1, n):
    bx0, by0, bx1, by1 = float(bx0), float(by0), float(bx1), float(by1)
    acc = np.full((n, n), -1, np.int16)   # −1 land / ingen data, −2 tørrfall, ellers felles intervallnummer
    for L in SRC:
        d = mem.Create('', n, n, 1, gdal.GDT_Int16)
        d.SetGeoTransform((bx0, (bx1 - bx0) / n, 0, by1, 0, -(by1 - by0) / n))
        b = d.GetRasterBand(1); b.Fill(NONE)
        if 'da' in L: L['da'].SetSpatialFilterRect(bx0, by0, bx1, by1); gdal.RasterizeLayer(d, [1], L['da'], options=['ATTRIBUTE=cid'])
        if 'tf' in L: L['tf'].SetSpatialFilterRect(bx0, by0, bx1, by1); gdal.RasterizeLayer(d, [1], L['tf'], burn_values=[-2])
        if 'land' in L: L['land'].SetSpatialFilterRect(bx0, by0, bx1, by1); gdal.RasterizeLayer(d, [1], L['land'], burn_values=[-1])
        a = b.ReadAsArray().astype(np.int16)
        if L['lut'] is not None: w = a >= 0; a[w] = L['lut'][a[w]]
        has = a != NONE; acc[has] = a[has]
    o = np.zeros(acc.shape, np.uint8); o[acc >= 0] = (acc[acc >= 0] + 1).astype(np.uint8); o[acc == -2] = 255
    return o

n = 0
for k, (x, y) in enumerate(mine):
    mx0, my0, mx1, my1 = merc(12, x, y)
    p12 = (mx1 - mx0) / 256
    g12 = grid(mx0 - 128 * p12, my0 - 128 * p12, mx1 + 128 * p12, my1 + 128 * p12, 512)
    if not ((g12[128:384, 128:384] > 0) & (g12[128:384, 128:384] < 255)).any():
        continue
    p13, p14 = p12 / 2, p12 / 4
    g13 = grid(mx0 - 128 * p13, my0 - 128 * p13, mx1 + 128 * p13, my1 + 128 * p13, 768)
    g14 = grid(mx0 - 128 * p14, my0 - 128 * p14, mx1 + 128 * p14, my1 + 128 * p14, 1280)
    with open(os.path.join(out, f'{x}_{y}.bin'), 'wb') as f:
        f.write(g12.tobytes()); f.write(g13.tobytes()); f.write(g14.tobytes())
    n += 1
    if (k + 1) % 20 == 0: print(f'{k + 1}/{len(mine)} · {n} med sjø', flush=True)
print(f'ferdig: {n} blokker med sjø', flush=True)
