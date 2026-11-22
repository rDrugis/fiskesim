# Henter Kartverkets nasjonale terrengmodell for land og sjø (topobaty, 50 m i sjøen) for noen z12-blokker
# og legger den på blokkens rutenett i EPSG:3857 (samme utstrekning som z12-rutenettet i raster.py, med kant).
# Utdata: <ut>/<x>_<y>.f32 = dybde i meter (positiv nedover) som Float32, N × N, NaN på land / uten data.
# Bruk: python3 fetch.py <ut> <N> x_y,x_y,...
import math, os, sys, time, urllib.request
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
OUT, N, TILES = sys.argv[1], int(sys.argv[2]), sys.argv[3].split(',')
os.makedirs(OUT, exist_ok=True)
WCS = 'https://wms.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-topobathy-25833'
COV = 'nhm_dtm_topobathy_25833'
R = 6378137.0; ORIG = math.pi * R
s3857 = osr.SpatialReference(); s3857.ImportFromEPSG(3857); s3857.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
s25833 = osr.SpatialReference(); s25833.ImportFromEPSG(25833); s25833.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tr = osr.CoordinateTransformation(s3857, s25833)

def merc(z, x, y):
    s = 2 * ORIG / 2 ** z
    return -ORIG + x * s, ORIG - (y + 1) * s, -ORIG + (x + 1) * s, ORIG - y * s

def get(url):
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'fiskesim-test (github.com/rDrugis/fiskesim)'})
            with urllib.request.urlopen(req, timeout=180) as r: return r.read()
        except Exception as e:
            print('  prøver igjen:', str(e)[:100], flush=True); time.sleep(5 * (k + 1))
    raise RuntimeError('fikk ikke hentet ' + url[:120])

# Ett felles 50 m-rutenett for hele området (låst til hele 50 m i UTM33), hentet i biter på 10 km og satt sammen.
# Alle blokker samples fra samme mosaikk, så det blir ingen skjøter mellom dem.
U0 = V0 = 1e12; U1 = V1 = -1e12; bbs = {}
for t in TILES:
    x, y = map(int, t.split('_'))
    mx0, my0, mx1, my1 = merc(12, x, y); p12 = (mx1 - mx0) / 256
    bb = (mx0 - 128 * p12, my0 - 128 * p12, mx1 + 128 * p12, my1 + 128 * p12); bbs[t] = bb
    for (a, b) in [(bb[0], bb[1]), (bb[0], bb[3]), (bb[2], bb[1]), (bb[2], bb[3])]:
        u, v, _ = tr.TransformPoint(a, b); U0, V0, U1, V1 = min(U0, u), min(V0, v), max(U1, u), max(V1, v)
STEP, CH = 50, 10000
U0, V0 = math.floor((U0 - 500) / CH) * CH, math.floor((V0 - 500) / CH) * CH
U1, V1 = math.ceil((U1 + 500) / CH) * CH, math.ceil((V1 + 500) / CH) * CH
parts = []
for u in range(int(U0), int(U1), CH):
    for v in range(int(V0), int(V1), CH):
        f = os.path.join(OUT, f'm_{u}_{v}.tif')
        url = (f'{WCS}?service=WCS&version=1.0.0&request=GetCoverage&coverage={COV}&crs=EPSG:25833'
               f'&bbox={u},{v},{u + CH},{v + CH}&width={CH // STEP}&height={CH // STEP}&format=GeoTIFF')
        data = get(url)
        if data[:2] not in (b'II', b'MM'): print('  ikke tiff', u, v, flush=True); continue
        open(f, 'wb').write(data); parts.append(f); time.sleep(0.5)
vrt = gdal.BuildVRT(os.path.join(OUT, 'mosaikk.vrt'), parts)
print(f'mosaikk: {len(parts)} biter, {(U1 - U0) / 1000:.0f} × {(V1 - V0) / 1000:.0f} km', flush=True)
for t, bb in bbs.items():
    ds = gdal.Warp('', vrt, format='MEM', dstSRS='EPSG:3857', outputBounds=bb, width=N, height=N, resampleAlg='bilinear', dstNodata=float('nan'))
    a = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    dep = np.where(np.isfinite(a) & (a < 0), -a, np.nan).astype(np.float32)
    dep.tofile(os.path.join(OUT, t + '.f32'))
    print(t, f'med modell: {100 * np.isfinite(dep).mean():.0f} % av blokka', flush=True)
vrt = None
print('ferdig', flush=True)
