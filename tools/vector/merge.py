# Slår sammen flere omgjorte dybdefiler (prep.py) til ett datasett for utregningen:
#   iv.json      alle dybdeintervaller fra alle kildene (felles nummerering)
#   pts.bin      loddskudd og grunner fra alle kildene, bare innenfor området
#   sources.json kildene i rekkefølge fra lavest til høyest prioritet, med omregning fra kildens egne intervallnummer
#   src_<k>/     da.fgb, land.fgb, tf.fgb for hver kilde
# Fylkesfilene har høyest prioritet (mest detaljerte), havområdefilene fyller bare der fylkene ikke har data.
# Bruk: python3 merge.py <ut> <lon0,lat0,lon1,lat1> <prepmappe lavest prioritet> ... <prepmappe høyest prioritet>
import json, math, os, shutil, sys
import numpy as np
out, bb, srcs = sys.argv[1], [float(v) for v in sys.argv[2].split(',')], sys.argv[3:]
os.makedirs(out, exist_ok=True)
R = 6378137.0
mx = lambda lon: math.radians(lon) * R
my = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
X0, Y0, X1, Y1 = mx(bb[0]) - 20000, my(bb[1]) - 20000, mx(bb[2]) + 20000, my(bb[3]) + 20000
ivs = [[tuple(p) for p in json.load(open(os.path.join(s, 'iv.json')))] for s in srcs]
glob = sorted(set(p for iv in ivs for p in iv))
print('intervaller totalt:', len(glob), '·', ', '.join(f'{os.path.basename(s)}: {len(iv)}' for s, iv in zip(srcs, ivs)), flush=True)
assert len(glob) <= 253, f'for mange intervaller ({len(glob)}) for Uint8'
gi = {p: i for i, p in enumerate(glob)}
json.dump(glob, open(os.path.join(out, 'iv.json'), 'w'))
meta = []
with open(os.path.join(out, 'pts.bin'), 'wb') as fo:
    for k, (s, iv) in enumerate(zip(srcs, ivs)):
        d = os.path.join(out, f'src_{k}'); os.makedirs(d, exist_ok=True)
        for f in ('da.fgb', 'land.fgb', 'tf.fgb'):
            if os.path.exists(os.path.join(s, f)): shutil.move(os.path.join(s, f), os.path.join(d, f))
        meta.append({'dir': f'src_{k}', 'navn': os.path.basename(s.rstrip('/')), 'lut': [gi[p] for p in iv]})
        p = np.fromfile(os.path.join(s, 'pts.bin'), dtype='<f4').reshape(-1, 3)
        m = (p[:, 0] >= X0) & (p[:, 0] <= X1) & (p[:, 1] >= Y0) & (p[:, 1] <= Y1)
        p[m].astype('<f4').tofile(fo)
        print(os.path.basename(s.rstrip('/')), int(m.sum()), 'punkter i området', flush=True)
json.dump(meta, open(os.path.join(out, 'sources.json'), 'w'), ensure_ascii=False)
print('ferdig', flush=True)
