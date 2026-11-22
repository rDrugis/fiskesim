# 3D-bilde av havbunnen «uten vann»: fiskekartets dybder (ferdige fliser) + landhøyder fra terrengmodellen (50 m).
# Bare for moro skyld / visning. Høyden er overdrevet (står i bildet).
# Bruk: python3 render.py <pre-mappe> <terrengmodell.tif> <ut> navn:lat:lon:halvbredde_m[:asimut[:høyde]] ...
import gzip, math, os, sys
import numpy as np
from osgeo import gdal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource, LinearSegmentedColormap
gdal.UseExceptions()
PRE, DTM, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
R = 6378137.0; ORIG = math.pi * R; Z = 14; S = 256
mx = lambda lon: math.radians(lon) * R
my = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
dtm = gdal.Open(DTM)

def depth_grid(x0, y0, x1, y1, n):
    """dybde (m, positiv nedover) på et n×n-rutenett i EPSG:3857 fra z14-flisene; NaN der flisene ikke har sjø"""
    ts = 2 * ORIG / 2 ** Z
    tx0, tx1 = int((x0 + ORIG) // ts), int((x1 + ORIG) // ts)
    ty0, ty1 = int((ORIG - y1) // ts), int((ORIG - y0) // ts)
    W, H = (tx1 - tx0 + 1) * S, (ty1 - ty0 + 1) * S
    big = np.full((H, W), np.nan, np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            f = os.path.join(PRE, str(Z), str(tx), f'{ty}.bin.gz')
            if not os.path.exists(f): continue
            b = gzip.open(f).read(); d = np.frombuffer(b[:S * S * 2], '<u2').reshape(S, S).astype(np.float32)
            v = np.where(d == 65535, np.nan, np.where(d > 60000, d - 65536, d) / 10.0)
            big[(ty - ty0) * S:(ty - ty0 + 1) * S, (tx - tx0) * S:(tx - tx0 + 1) * S] = v
    # sample midt i hver rute på målrutenettet
    px = ts / S; bx0, by1 = -ORIG + tx0 * ts, ORIG - ty0 * ts
    xs = x0 + (np.arange(n) + 0.5) * (x1 - x0) / n; ys = y1 - (np.arange(n) + 0.5) * (y1 - y0) / n
    ii = np.clip(((xs - bx0) / px).astype(int), 0, W - 1); jj = np.clip(((by1 - ys) / px).astype(int), 0, H - 1)
    return big[np.ix_(jj, ii)]

def land_grid(x0, y0, x1, y1, n):
    ds = gdal.Warp('', dtm, format='MEM', dstSRS='EPSG:3857', outputBounds=(x0, y0, x1, y1), width=n, height=n, resampleAlg='cubic', dstNodata=float('nan'))
    return ds.GetRasterBand(1).ReadAsArray().astype(np.float32)

cm_sea = LinearSegmentedColormap.from_list('sea', ['#0b1d3a', '#163d6b', '#2a6f97', '#4fa3a5', '#9ccfa4', '#e9dca0'])
cm_land = LinearSegmentedColormap.from_list('land', ['#6f8f4e', '#8a9a5b', '#a39274', '#c9c2b4', '#f2f2f2'])

for spec in sys.argv[4:]:
    p = spec.split(':'); name, lat, lon, half = p[0], float(p[1]), float(p[2]), float(p[3])
    az = float(p[4]) if len(p) > 4 else 225; el = float(p[5]) if len(p) > 5 else 32
    k = 1 / math.cos(math.radians(lat)); cx, cy = mx(lon), my(lat)
    x0, x1, y0, y1 = cx - half * k, cx + half * k, cy - half * k, cy + half * k
    n = 420
    dep = depth_grid(x0, y0, x1, y1, n)
    lnd = land_grid(x0, y0, x1, y1, n)
    z = np.where(np.isfinite(dep), -dep, lnd)                    # havbunn fra fiskekartet, ellers terrengmodellen
    z = np.where(np.isfinite(z), z, 0)
    sea = np.isfinite(dep) | (np.isfinite(lnd) & (lnd < 0))
    # litt utglatting av 50 m-landet så det ikke blir trappetrinn
    rng = float(max(1, np.nanmax(z) - np.nanmin(z))); ex = 1.6 if rng > 400 else 2.0
    ls = LightSource(azdeg=315, altdeg=40)
    zs, zl = z.copy(), z.copy()
    dmin = float(np.nanmin(z[sea])) if sea.any() else -1
    t_sea = np.clip((z - dmin) / max(1, -dmin), 0, 1); t_land = np.clip(z / max(50, float(np.nanmax(z))), 0, 1)
    rgb = np.where(sea[..., None], cm_sea(t_sea)[..., :3], cm_land(t_land)[..., :3])
    meters = 2 * half / n
    shaded = ls.shade_rgb(rgb, z, vert_exag=ex, dx=meters, dy=meters, blend_mode='soft')
    # strandlinje (der vannet ville stått): lys strek
    edge = sea & ~np.roll(sea, 1, 0) | sea & ~np.roll(sea, 1, 1) | sea & ~np.roll(sea, -1, 0) | sea & ~np.roll(sea, -1, 1)
    shaded[edge] = [0.95, 0.85, 0.35]
    X, Y = np.meshgrid(np.linspace(-half, half, n), np.linspace(half, -half, n))
    fig = plt.figure(figsize=(16, 10), dpi=110, facecolor='#0d1117')
    ax = fig.add_subplot(111, projection='3d', facecolor='#0d1117')
    ax.plot_surface(X, Y, z * ex, facecolors=shaded, rstride=1, cstride=1, linewidth=0, antialiased=False, shade=False)
    ax.set_box_aspect((1, 1, max(0.12, min(0.5, rng * ex / (2 * half)))))
    ax.view_init(elev=el, azim=az); ax.set_axis_off()
    deep = -dmin
    ax.set_title(f'{name.replace("_", " ")} uten vann  ·  {2 * half / 1000:.1f} × {2 * half / 1000:.1f} km  ·  dypest {deep:.0f} m  ·  høyde {ex:g}× overdrevet',
                 color='#e6edf3', fontsize=15, pad=0)
    fig.text(0.5, 0.04, 'Gul strek: der vannkanten går i dag. Havbunn: Fiskesim (Kartverket sjøkart + terrengmodell, CC BY 4.0). Land: Kartverket terrengmodell 50 m.',
             color='#8b949e', ha='center', fontsize=10)
    plt.subplots_adjust(0, 0, 1, 0.95)
    fig.savefig(os.path.join(OUT, name + '.png'), facecolor=fig.get_facecolor())
    plt.close(fig)
    print(name, 'ferdig', f'dypest {deep:.0f} m', flush=True)
