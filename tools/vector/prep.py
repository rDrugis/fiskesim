# Leser Kartverkets «Sjøkart – Dybdedata» (GML, UTM33) og lager kompakte filer for utregningen av fiskekartet:
#   da.fgb   Dybdeareal i EPSG:3857 med feltet cid (indeks i iv.json)
#   land.fgb Landareal i EPSG:3857
#   tf.fgb   Tørrfall i EPSG:3857 (hvis laget finnes)
#   pts.bin  loddskudd og grunner: Float32 [x, y, dybde] i EPSG:3857
#   iv.json  alle dybdeintervaller [[lo, hi], …] slik de står i fila
# Bruk: python3 prep.py <gml> <utmappe>
import json, os, struct, sys
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
src_path, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
ds = ogr.Open(src_path)
names = [ds.GetLayer(i).GetName() for i in range(ds.GetLayerCount())]
print('lag:', ', '.join(names), flush=True)

s25833 = osr.SpatialReference(); s25833.ImportFromEPSG(25833); s25833.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
s3857 = osr.SpatialReference(); s3857.ImportFromEPSG(3857); s3857.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tr = osr.CoordinateTransformation(s25833, s3857)
fgb = ogr.GetDriverByName('FlatGeobuf')

def copy_polys(name, path, field=None, fn=None):
    lyr = ds.GetLayerByName(name)
    if lyr is None:
        print('mangler lag', name, flush=True); return 0
    o = fgb.CreateDataSource(path)
    ol = o.CreateLayer(name, s3857, ogr.wkbMultiPolygon, ['SPATIAL_INDEX=YES'])
    if field: ol.CreateField(ogr.FieldDefn(field, ogr.OFTInteger))
    d = ol.GetLayerDefn(); n = 0
    lyr.ResetReading()
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None: continue
        g = g.Clone(); g.Transform(tr)
        of = ogr.Feature(d); of.SetGeometry(g)
        if field: of.SetField(field, fn(f))
        ol.CreateFeature(of); n += 1
    o = None
    print(name, n, 'flater', flush=True)
    return n

# alle intervaller i fila
lyr = ds.GetLayerByName('Dybdeareal')
pairs = set()
for f in lyr:
    pairs.add((float(f.GetField('minimumsdybde')), float(f.GetField('maksimumsdybde'))))
iv = sorted(pairs)
idx = {p: i for i, p in enumerate(iv)}
assert len(iv) < 250, len(iv)
json.dump(iv, open(os.path.join(out, 'iv.json'), 'w'))
print('intervaller:', len(iv), flush=True)

copy_polys('Dybdeareal', os.path.join(out, 'da.fgb'), 'cid', lambda f: idx[(float(f.GetField('minimumsdybde')), float(f.GetField('maksimumsdybde')))])
copy_polys('Landareal', os.path.join(out, 'land.fgb'))
for n in names:
    if n.lower().replace('ø', 'o').startswith('torrfall'):
        copy_polys(n, os.path.join(out, 'tf.fgb'))

# punkter: loddskudd og grunner
with open(os.path.join(out, 'pts.bin'), 'wb') as fo:
    tot = 0
    for name in ('Dybdepunkt', 'Grunne'):
        lyr = ds.GetLayerByName(name)
        if lyr is None: continue
        n = 0
        for f in lyr:
            g = f.GetGeometryRef(); d = f.GetField('dybde')
            if g is None or d is None: continue
            x, y, _ = tr.TransformPoint(g.GetX(), g.GetY())
            fo.write(struct.pack('<fff', x, y, float(d))); n += 1
        print(name, n, 'punkter', flush=True); tot += n
print('ferdig', flush=True)
