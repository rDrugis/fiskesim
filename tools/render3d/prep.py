# Forbereder fotorealistiske dronebilder: terreng (land + havbunn uten vann) i ekte målestokk, bygninger og bruer.
#   havbunn: fiskekartets ferdige fliser (z14, ca. 4,6 m) · land: Kartverkets høydemodell (WCS, ca. 4 m), ellers 50 m
#   bygninger og bruer: OpenStreetMap (Overpass)
# Utdata per sted: <ut>/<navn>/hm.npy (høyde i m, UTM33, rader nord→sør), meta.json, bygg.json, bruer.json
# Bruk: python3 prep.py <pre-mappe> <terrengmodell50.tif> <ut> navn:lat:lon:halvbredde_m ...
import gzip, json, math, os, socket, sys, time, urllib.parse, urllib.request
_gai = socket.getaddrinfo
def _ipv4(host, port, family=0, type=0, proto=0, flags=0): return _gai(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
PRE, DTM50, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
R = 6378137.0; ORIG = math.pi * R; Z = 14; S = 256; CELL = 4.0
def srs(e):
    s = osr.SpatialReference(); s.ImportFromEPSG(e); s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); return s
to33 = osr.CoordinateTransformation(srs(4326), srs(25833)); from33 = osr.CoordinateTransformation(srs(25833), srs(4326))

def get(url, data=None, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': 'fiskesim-3d (github.com/rDrugis/fiskesim)'})
            with urllib.request.urlopen(req, timeout=300) as r: return r.read()
        except Exception as e:
            print('  prøver igjen:', str(e)[:90], flush=True); time.sleep(20 * (k + 1))
    return None

# høydemodellens dekning (navn) fra GetCapabilities
NHM = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833'
cap = (get(NHM + '?service=WCS&version=1.0.0&request=GetCapabilities') or b'').decode('utf-8', 'replace')
import re
names = re.findall(r'<(?:wcs:)?name>([^<]+)</(?:wcs:)?name>', cap)
cov = next((n for n in names if 'dtm' in n.lower() and 'skygge' not in n.lower()), names[1] if len(names) > 1 else None)
print('høydemodell:', cov, '·', names[:6], flush=True)

def tiles_ds(x0, y0, x1, y1):
    ts = 2 * ORIG / 2 ** Z
    tx0, tx1 = int((x0 + ORIG) // ts), int((x1 + ORIG) // ts); ty0, ty1 = int((ORIG - y1) // ts), int((ORIG - y0) // ts)
    W, H = (tx1 - tx0 + 1) * S, (ty1 - ty0 + 1) * S
    big = np.full((H, W), np.nan, np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            f = os.path.join(PRE, str(Z), str(tx), f'{ty}.bin.gz')
            if not os.path.exists(f): continue
            d = np.frombuffer(gzip.open(f).read()[:S * S * 2], '<u2').reshape(S, S).astype(np.float32)
            big[(ty - ty0) * S:(ty - ty0 + 1) * S, (tx - tx0) * S:(tx - tx0 + 1) * S] = np.where(d == 65535, np.nan, np.where(d > 60000, d - 65536, d) / 10.0)
    ds = gdal.GetDriverByName('MEM').Create('', W, H, 1, gdal.GDT_Float32)
    ds.SetGeoTransform((-ORIG + tx0 * ts, ts / S, 0, ORIG - ty0 * ts, 0, -ts / S)); ds.SetProjection(srs(3857).ExportToWkt())
    b = ds.GetRasterBand(1); b.SetNoDataValue(float('nan')); b.WriteArray(big)
    return ds

def warp(src, bb, n, alg='bilinear'):
    ds = gdal.Warp('', src, format='MEM', dstSRS='EPSG:25833', outputBounds=bb, width=n, height=n, resampleAlg=alg, dstNodata=float('nan'))
    return ds.GetRasterBand(1).ReadAsArray().astype(np.float32)

def blur(a, r):
    if r < 1: return a
    out = a.copy(); m = np.isfinite(a).astype(np.float32); v = np.where(np.isfinite(a), a, 0)
    for axis in (0, 1):
        k = np.ones(2 * r + 1, np.float32)
        v = np.apply_along_axis(lambda x: np.convolve(x, k, 'same'), axis, v); m = np.apply_along_axis(lambda x: np.convolve(x, k, 'same'), axis, m)
    return np.where(np.isfinite(a), v / np.maximum(m, 1e-6), np.nan)

for spec in sys.argv[4:]:
    name, lat, lon, half = spec.split(':')[:4]; lat, lon, half = float(lat), float(lon), float(half)
    cx, cy, _ = to33.TransformPoint(lon, lat)
    bb = (cx - half, cy - half, cx + half, cy + half); n = int(2 * half / CELL)
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    # havbunn fra fiskekartet
    c = [osr.CoordinateTransformation(srs(25833), srs(3857)).TransformPoint(a, b) for a in (bb[0], bb[2]) for b in (bb[1], bb[3])]
    tds = tiles_ds(min(p[0] for p in c) - 500, min(p[1] for p in c) - 500, max(p[0] for p in c) + 500, max(p[1] for p in c) + 500)
    sea = warp(tds, bb, n)
    # loddskudd ligger i enkeltceller (små spisser): mild utglatting for bildet
    sea = blur(sea, 1)
    # land: detaljert høydemodell, ellers 50 m
    land = None
    if cov:
        f = os.path.join(d, 'land.tif')
        url = (f'{NHM}?service=WCS&version=1.0.0&request=GetCoverage&coverage={urllib.parse.quote(cov)}&crs=EPSG:25833'
               f'&bbox={bb[0]:.0f},{bb[1]:.0f},{bb[2]:.0f},{bb[3]:.0f}&width={n}&height={n}&format=GeoTIFF')
        data = get(url)
        if data and data[:2] in (b'II', b'MM'):
            open(f, 'wb').write(data); land = warp(gdal.Open(f), bb, n, 'cubic'); land[(land < -50) | (land > 3000)] = np.nan
    l50 = warp(gdal.Open(DTM50), bb, n, 'cubic')
    if land is None: land = l50
    else: land = np.where(np.isfinite(land), land, l50)
    # hull i havbunnen der høydemodellen heller ikke har land (flytebrua sine pongtonger, kaier): fyll fra havbunnen rundt
    hole = ~np.isfinite(sea) & (~np.isfinite(land) | (land < 1.0))
    for _ in range(80):
        if not hole.any(): break
        v = np.where(np.isfinite(sea), sea, 0); c = np.isfinite(sea).astype(np.float32)
        sv = sum(np.roll(np.roll(v, a, 0), b, 1) for a in (-1, 0, 1) for b in (-1, 0, 1))
        sc = sum(np.roll(np.roll(c, a, 0), b, 1) for a in (-1, 0, 1) for b in (-1, 0, 1))
        grow = hole & (sc > 0); sea = np.where(grow, sv / np.maximum(sc, 1), sea); hole &= ~grow
    z = np.where(np.isfinite(sea), -np.maximum(sea, 0), np.where(np.isfinite(land), np.maximum(land, 0.2), 0))
    np.save(os.path.join(d, 'hm.npy'), z.astype(np.float32))
    # OpenStreetMap: bygninger og bruer
    lo0, la0, _ = from33.TransformPoint(bb[0], bb[1]); lo1, la1, _ = from33.TransformPoint(bb[2], bb[3])
    q = f'[out:json][timeout:120];(way["building"]({la0},{lo0},{la1},{lo1});way["bridge"]["highway"]({la0},{lo0},{la1},{lo1}););out tags geom;'
    raw = get('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode())
    els = json.loads(raw)['elements'] if raw else []
    loc = lambda g: [[to33.TransformPoint(p['lon'], p['lat'])[0] - bb[0], to33.TransformPoint(p['lon'], p['lat'])[1] - bb[1]] for p in g]
    bygg, bruer = [], []
    for e in els:
        t = e.get('tags', {}); g = e.get('geometry')
        if not g: continue
        if 'building' in t:
            h = None
            try: h = float(str(t.get('height', '')).split()[0])
            except Exception: pass
            if h is None:
                try: h = 3.0 * float(t.get('building:levels')) + 1.5
                except Exception: h = 9.0 if t.get('building') in ('industrial', 'warehouse', 'commercial', 'apartments') else 6.0
            bygg.append({'p': loc(g), 'h': h, 'k': t.get('building')})
        else:
            bruer.append({'p': loc(g), 'navn': t.get('name', ''), 'flyt': t.get('bridge:structure') == 'floating'})
    json.dump(bygg, open(os.path.join(d, 'bygg.json'), 'w')); json.dump(bruer, open(os.path.join(d, 'bruer.json'), 'w'))
    json.dump({'size': 2 * half, 'n': n, 'cell': CELL, 'zmin': float(z.min()), 'zmax': float(z.max())}, open(os.path.join(d, 'meta.json'), 'w'))
    print(name, f'{n}×{n}', f'dypest {-z.min():.0f} m, høyest {z.max():.0f} m', f'{len(bygg)} bygg, {len(bruer)} bruer', flush=True)
    time.sleep(5)
