# Vurderer Kartverkets terrengmodeller for havbunnen (WCS) på noen kjente steder:
#  - hvilke dekninger tjenestene har (GetCapabilities)
#  - hvor mye av sjøen hver modell dekker, og oppløsningen
#  - avvik mot loddskuddene (målte dybder) i samme område
#  - skyggerelieff-bilder til øyekontroll
# Bruk: python3 probe.py <vdata-mappe med pts.bin> <utmappe>
import json, math, os, re, struct, subprocess, sys, urllib.request
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
VD, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SERVICES = {
  'dtm2': 'https://wms.geonorge.no/skwms1/wms.dtm2',
  'topobaty33': 'https://wms.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-topobathy-25833',
}
PLACES = {'temba': (61.47, 4.50), 'salhus': (60.51, 5.262), 'klokkarneset': (60.5415, 5.3409), 'ortna': (61.1153, 6.1401), 'askrova': (61.54, 5.06)}
HALF = 1500  # m rundt stedet
s4326 = osr.SpatialReference(); s4326.ImportFromEPSG(4326); s4326.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
s25833 = osr.SpatialReference(); s25833.ImportFromEPSG(25833); s25833.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
s3857 = osr.SpatialReference(); s3857.ImportFromEPSG(3857); s3857.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
to33 = osr.CoordinateTransformation(s4326, s25833); m2u = osr.CoordinateTransformation(s3857, s25833)

def get(url, path=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'fiskesim-test (github.com/rDrugis/fiskesim)'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if path: open(path, 'wb').write(data)
    return data

rep = {'tjenester': {}, 'steder': {}}
cov = {}
for k, base in SERVICES.items():
    try:
        cap = get(base + '?service=WCS&version=1.0.0&request=GetCapabilities').decode('utf-8', 'replace')
        names = re.findall(r'<(?:wcs:)?name>([^<]+)</(?:wcs:)?name>', cap)
        cov[k] = names; rep['tjenester'][k] = names
        print(k, 'dekninger:', names, flush=True)
    except Exception as e:
        rep['tjenester'][k] = 'feil: ' + str(e); print(k, 'feil', e, flush=True)

# loddskudd (EPSG:3857) til UTM33
raw = open(os.path.join(VD, 'pts.bin'), 'rb').read()
P = np.frombuffer(raw, dtype='<f4').reshape(-1, 3)

for name, (lat, lon) in PLACES.items():
    x, y, _ = to33.TransformPoint(lon, lat)
    bb = (x - HALF, y - HALF, x + HALF, y + HALF)
    pl = {}
    # loddskudd i boksen
    pts = []
    for (mx, my, d) in P:
        ux, uy, _ = m2u.TransformPoint(float(mx), float(my))
        if bb[0] <= ux <= bb[2] and bb[1] <= uy <= bb[3]: pts.append((ux, uy, float(d)))
    pl['loddskudd'] = len(pts)
    for k, names in cov.items():
        for cn in names:
            for res in (5, 25, 50):
                n = int(2 * HALF / res)
                f = os.path.join(OUT, f'{name}_{k}_{cn}_{res}.tif'.replace(':', '_'))
                url = (f"{SERVICES[k]}?service=WCS&version=1.0.0&request=GetCoverage&coverage={cn}&crs=EPSG:25833"
                       f"&bbox={bb[0]:.0f},{bb[1]:.0f},{bb[2]:.0f},{bb[3]:.0f}&width={n}&height={n}&format=GeoTIFF")
                try:
                    data = get(url, f)
                    if data[:2] not in (b'II', b'MM'): os.remove(f); continue
                    ds = gdal.Open(f); a = ds.GetRasterBand(1).ReadAsArray().astype('float64'); nd = ds.GetRasterBand(1).GetNoDataValue()
                    ok = np.isfinite(a) & (a != nd if nd is not None else True) & (a > -12000) & (a < 12000)
                    if ok.sum() == 0: continue
                    gt = ds.GetGeoTransform(); errs = []
                    for (px, py, d) in pts:
                        i, j = int((px - gt[0]) / gt[1]), int((py - gt[3]) / gt[5])
                        if 0 <= i < n and 0 <= j < n and ok[j, i]: errs.append(abs(abs(a[j, i]) - d))
                    key = f'{k}:{cn}@{res}m'
                    pl[key] = {'dekning_%': round(100 * ok.mean(), 1), 'min': round(float(a[ok].min()), 1), 'maks': round(float(a[ok].max()), 1),
                               'loddskudd_sammenlignet': len(errs), 'avvik_median_m': round(float(np.median(errs)), 1) if errs else None,
                               'avvik_90pst_m': round(float(np.percentile(errs, 90)), 1) if errs else None}
                    png = f.replace('.tif', '.png')
                    subprocess.run(['gdaldem', 'hillshade', '-q', '-z', '3', f, png.replace('.png', '_hs.tif')], check=False)
                    subprocess.run(['gdal_translate', '-q', '-of', 'PNG', '-scale', png.replace('.png', '_hs.tif'), png], check=False)
                    print(name, key, pl[key], flush=True)
                except Exception as e:
                    print(name, k, cn, res, 'feil', str(e)[:120], flush=True)
    rep['steder'][name] = pl
json.dump(rep, open(os.path.join(OUT, 'rapport.json'), 'w'), indent=1, ensure_ascii=False)
print('ferdig', flush=True)
