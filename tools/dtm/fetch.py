# Kartverkets nasjonale terrengmodell for land og sjø (topobaty, 50 m i sjøen innenfor 12 nm; CC BY 4.0).
#   mosaikk: henter ett felles 50 m-rutenett (låst til hele 50 m i UTM33) i 40 km-biter og lagrer det som én GeoTIFF
#            python3 fetch.py mosaikk <ut.tif> <lon0,lat0,lon1,lat1> [datamappe: hent bare biter med sjø i da.fgb]
#            Serveren nekter tilkoblinger ved mange forespørsler: rolig tempo, lang venting, og biter som ikke kommer
#            hoppes over (der brukes bare sjøkartet, slik som før).
#   blokker: legger mosaikken på hver z12-blokks rutenett i EPSG:3857 (samme utstrekning som z12-rutenettet i raster.py)
#            python3 fetch.py blokker <mosaikk.tif> <utmappe> <N> <x_y,x_y,... | mappe med raster.py-filer>
#            Utdata <x>_<y>.f32: dybde i meter (positiv nedover), Float32 N × N, NaN på land / uten data.
# Alle blokker samples fra samme mosaikk, så det blir ingen skjøter mellom dem.
import math, os, socket, sys, time, urllib.request
# GitHub-maskinene har ikke IPv6: «Network is unreachable» kom av at IPv6-adressen ble prøvd. Bruk bare IPv4.
_gai = socket.getaddrinfo
def _ipv4(host, port, family=0, type=0, proto=0, flags=0): return _gai(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
WCS = 'https://wms.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-topobathy-25833'
COV = 'nhm_dtm_topobathy_25833'
R = 6378137.0; ORIG = math.pi * R
def srs(e):
    s = osr.SpatialReference(); s.ImportFromEPSG(e); s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); return s

def get(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'fiskesim (github.com/rDrugis/fiskesim)'})
            with urllib.request.urlopen(req, timeout=300) as r: return r.read()
        except Exception as e:
            w = 30 * 2 ** k; print(f'  prøver igjen om {w} s:', str(e)[:100], flush=True); time.sleep(w)
    return None

def merc(z, x, y):
    s = 2 * ORIG / 2 ** z
    return -ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s

mode = sys.argv[1]
if mode == 'mosaikk':
    out = sys.argv[2]; lo0, la0, lo1, la1 = map(float, sys.argv[3].split(','))
    tr = osr.CoordinateTransformation(srs(4326), srs(25833))
    pts = [tr.TransformPoint(lo, la) for lo in (lo0, (lo0 + lo1) / 2, lo1) for la in (la0, la1)]
    STEP, CH = 50, 40000
    U0, V0 = math.floor((min(p[0] for p in pts) - 2000) / CH) * CH, math.floor((min(p[1] for p in pts) - 2000) / CH) * CH
    U1, V1 = math.ceil((max(p[0] for p in pts) + 2000) / CH) * CH, math.ceil((max(p[1] for p in pts) + 2000) / CH) * CH
    d = os.path.dirname(out) or '.'; os.makedirs(d, exist_ok=True); parts = []
    # bare biter med sjø (dybdeflater) i dybdedataene
    from osgeo import ogr
    das = []
    if len(sys.argv) > 4:
        for root, _, fs in os.walk(sys.argv[4]):
            if 'da.fgb' in fs: das.append(ogr.Open(os.path.join(root, 'da.fgb')))
    to3857 = osr.CoordinateTransformation(srs(25833), srs(3857))
    def wet(u, v):
        if not das: return True
        c = [to3857.TransformPoint(a, b) for a in (u, u + CH) for b in (v, v + CH)]
        x0, x1, y0, y1 = min(p[0] for p in c), max(p[0] for p in c), min(p[1] for p in c), max(p[1] for p in c)
        for ds in das:
            l = ds.GetLayer(0); l.SetSpatialFilterRect(x0, y0, x1, y1)
            if l.GetNextFeature() is not None: return True
        return False
    jobs = [(u, v) for u in range(int(U0), int(U1), CH) for v in range(int(V0), int(V1), CH) if wet(u, v)]
    print(f'{len(jobs)} biter med sjø å hente', flush=True); skipped = 0
    for u, v in jobs:
        if True:
            f = os.path.join(d, f'm_{u}_{v}.tif')
            url = (f'{WCS}?service=WCS&version=1.0.0&request=GetCoverage&coverage={COV}&crs=EPSG:25833'
                   f'&bbox={u},{v},{u + CH},{v + CH}&width={CH // STEP}&height={CH // STEP}&format=GeoTIFF')
            data = get(url)
            if data is None: skipped += 1; print('  hoppet over', u, v, flush=True); continue
            if data[:2] not in (b'II', b'MM'): print('  ingen modell her', u, v, flush=True); continue
            open(f, 'wb').write(data); parts.append(f); time.sleep(3)
    vrt = gdal.BuildVRT('/tmp/mosaikk.vrt', parts)
    gdal.Translate(out, vrt, creationOptions=['COMPRESS=DEFLATE', 'PREDICTOR=3', 'TILED=YES'])
    vrt = None
    for f in parts: os.remove(f)
    print(f'mosaikk: {len(parts)} biter, {skipped} hoppet over, {(U1 - U0) / 1000:.0f} × {(V1 - V0) / 1000:.0f} km', flush=True)
    assert parts, 'fikk ingen biter av terrengmodellen'
elif mode == 'blokker':
    src, out, N, which = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
    os.makedirs(out, exist_ok=True)
    tiles = [f[:-4] for f in sorted(os.listdir(which)) if f.endswith('.bin')] if os.path.isdir(which) else which.split(',')
    ds0 = gdal.Open(src); n = 0
    for t in tiles:
        x, y = map(int, t.split('_'))
        mx0, my0, mx1, my1 = merc(12, x, y); p12 = (mx1 - mx0) / 256
        bb = (mx0 - 128 * p12, my0 - 128 * p12, mx1 + 128 * p12, my1 + 128 * p12)
        ds = gdal.Warp('', ds0, format='MEM', dstSRS='EPSG:3857', outputBounds=bb, width=N, height=N, resampleAlg='bilinear', dstNodata=float('nan'))
        a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
        dep = np.where(np.isfinite(a) & (a < 0), -a, np.nan).astype(np.float32)
        if np.isfinite(dep).any(): dep.tofile(os.path.join(out, t + '.f32')); n += 1
    print(f'blokker: {n} av {len(tiles)} med terrengmodell', flush=True)
