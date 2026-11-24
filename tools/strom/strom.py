# Strømkart: henter overflatestrømmen fra MET sin havmodell NorKyst v3 (800 m, timesprognose) for Vestland,
# legger den på et fast rutenett i EPSG:3857 og skriver én liten fil per time.
#   meta.json  tider, utstrekning, rutenett, skala og kilde
#   hNNN.bin   Int8 u (øst) så v (nord) i rader fra nord, 0,02 m/s per steg, −128 = ingen data (land/utenfor modellen)
# Kilde: MET Norway, NorKyst v3 (thredds.met.no, CC BY 4.0). Bruk: python3 strom.py <ut>
import datetime as dt, json, math, os, re, sys, time, urllib.request
import numpy as np
from netCDF4 import Dataset
from scipy.spatial import cKDTree
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BB = (4.0, 59.6, 8.3, 62.4)          # samme område som det ferdig utregnede fiskekartet
CELL = 1600.0                         # m i EPSG:3857 (ca. 790 m på 60,5° N, omtrent modellens 800 m)
SCALE = 0.02; HOURS = 54
CAT = 'https://thredds.met.no/thredds/catalog/fou-hi/norkystv3_his_files/'
DODS = 'https://thredds.met.no/thredds/dodsC/'
R = 6378137.0
mx = lambda lon: np.radians(lon) * R
my = lambda lat: np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R

def files():
    """de nyeste prognosefilene (800 m, hovedkjøringen m00), sortert"""
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(3):
        d = now - dt.timedelta(days=back); p = f'{d:%Y/%m/%d}/'
        try:
            with urllib.request.urlopen(CAT + p + 'catalog.xml', timeout=60) as r: x = r.read().decode()
        except Exception as e: print('ingen katalog', p, e); continue
        # AN-fila dekker selve døgnet (fra kl. 00 UTC), FC-filene døgnene etter
        an = sorted(set(re.findall(r'urlPath="([^"]*norkyst800_his_zdepth_\d{8}T00Z_m00_AN\.nc)"', x)))
        fc = sorted(set(re.findall(r'urlPath="([^"]*norkyst800_his_zdepth_latest_m00_FC_\d+\.nc)"', x)))
        if fc: return an[-1:] + fc
    raise SystemExit('fant ingen NorKyst-prognose')

def opendap(path, tries=4):
    for k in range(tries):
        try: return Dataset(DODS + path)
        except Exception as e: print('  prøver igjen:', str(e)[:100], flush=True); time.sleep(20 * (k + 1))
    raise SystemExit('kom ikke til ' + path)

fc = files(); print('filer:', fc, flush=True)
# målrutenett
X0, X1, Y0, Y1 = float(mx(BB[0])), float(mx(BB[2])), float(my(BB[1])), float(my(BB[3]))
nx, ny = int(math.ceil((X1 - X0) / CELL)), int(math.ceil((Y1 - Y0) / CELL))
gx = X0 + (np.arange(nx) + 0.5) * CELL; gy = Y1 - (np.arange(ny) + 0.5) * CELL
GX, GY = np.meshgrid(gx, gy)
# modellens rutenett (kurvelineært): utsnitt rundt Vestland
ds = opendap(fc[0])
lat, lon = np.asarray(ds['lat'][:]), np.asarray(ds['lon'][:])
m = (lat > BB[1] - 0.15) & (lat < BB[3] + 0.15) & (lon > BB[0] - 0.3) & (lon < BB[2] + 0.3)
jj, ii = np.where(m); j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
la, lo = lat[j0:j1, i0:i1], lon[j0:j1, i0:i1]
dep = np.asarray(ds['depth'][:]); kz = int(np.argmin(np.abs(dep)))
print(f'utsnitt {j1 - j0}×{i1 - i0}, dybdenivå {dep[kz]} m', flush=True)
tree = cKDTree(np.stack([mx(lo).ravel(), my(la).ravel()], 1))
dist, idx = tree.query(np.stack([GX.ravel(), GY.ravel()], 1), k=1)
far = dist > 2400            # ingen modellrute nær nok (≈ 1,2 km)
enc = lambda a: np.where(np.isfinite(a), np.clip(np.round(a / SCALE), -127, 127), -128).astype(np.int8)
times = []; now = time.time(); h = 0
for f in fc:
    if h >= HOURS: break
    d = ds if f == fc[0] else opendap(f)
    tv = d['time']; tt = np.asarray(tv[:], dtype='float64'); units = tv.units
    base = dt.datetime.fromisoformat(re.search(r'since (\S+)', units).group(1).replace('Z', '')).replace(tzinfo=dt.timezone.utc).timestamp()
    sec = base + tt * (86400 if units.startswith('days') else 3600 if units.startswith('hours') else 1)
    for k, s in enumerate(sec):
        if s < now - 3600 or h >= HOURS: continue
        u = np.ma.filled(d['u_eastward'][k, kz, j0:j1, i0:i1].astype('float32'), np.nan).ravel()
        v = np.ma.filled(d['v_northward'][k, kz, j0:j1, i0:i1].astype('float32'), np.nan).ravel()
        U, V = u[idx], v[idx]; U[far] = np.nan; V[far] = np.nan
        with open(os.path.join(OUT, f'h{h:03d}.bin'), 'wb') as fo: fo.write(enc(U).tobytes()); fo.write(enc(V).tobytes())
        sp = np.hypot(U, V); times.append(int(s * 1000))
        print(dt.datetime.fromtimestamp(s, dt.timezone.utc).strftime('%d.%m %H:%MZ'), f'maks {np.nanmax(sp):.2f} m/s, snitt {np.nanmean(sp):.2f}', flush=True)
        h += 1
json.dump({'t': times, 'bbox': [X0, Y1 - ny * CELL, X0 + nx * CELL, Y1], 'nx': nx, 'ny': ny, 'scale': SCALE, 'depth': float(dep[kz]),
           'kilde': 'MET Norway, NorKyst v3 800 m (CC BY 4.0)', 'laget': int(now * 1000)}, open(os.path.join(OUT, 'meta.json'), 'w'))
print('ferdig', len(times), 'timer', f'{nx}×{ny}', flush=True)
