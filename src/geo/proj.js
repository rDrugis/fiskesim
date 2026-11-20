// Kartprojeksjoner: Transversal Mercator (Krüger-serier, GRS80) og Web Mercator.
// Verden i simulatoren bruker UTM sone 33 (EPSG:25833), samme rutenett som Kartverkets dybdemodell.

const A_ = 6378137;
const F_ = 1 / 298.257222101;
const DEG = Math.PI / 180;

const n = F_ / (2 - F_);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const AR = (A_ / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const alpha = [
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4,
  (61 / 240) * n3 - (103 / 140) * n4,
  (49561 / 161280) * n4,
];
const beta = [
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
  (17 / 480) * n3 - (37 / 840) * n4,
  (4397 / 161280) * n4,
];
const delta = [
  2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4,
  (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4,
  (56 / 15) * n3 - (136 / 35) * n4,
  (4279 / 630) * n4,
];
const e2n = (2 * Math.sqrt(n)) / (1 + n);

export function makeTM(lon0Deg, k0 = 0.9996, FE = 500000, FN = 0) {
  const lon0 = lon0Deg * DEG;
  function forward(lonDeg, latDeg) {
    const phi = latDeg * DEG, lam = lonDeg * DEG - lon0;
    const sp = Math.sin(phi);
    const t = Math.sinh(Math.atanh(sp) - e2n * Math.atanh(e2n * sp));
    const xi = Math.atan2(t, Math.cos(lam));
    const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let E = eta, N = xi;
    for (let j = 1; j <= 4; j++) {
      E += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      N += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    return [FE + k0 * AR * E, FN + k0 * AR * N];
  }
  function inverse(E, N) {
    const xi = (N - FN) / (k0 * AR), eta = (E - FE) / (k0 * AR);
    let xp = xi, ep = eta;
    for (let j = 1; j <= 4; j++) {
      xp -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      ep -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
    const lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
    return [(lon0 + lam) / DEG, phi / DEG];
  }
  // Retningen til geografisk nord målt i rutenettet (grader med klokka fra rutenettets nord).
  // Sann kurs → rutenettkurs: grid = true + trueNorthGrid. Vest for sentralmeridianen er verdien positiv.
  function trueNorthGrid(lonDeg, latDeg) {
    const [x0, y0] = forward(lonDeg, latDeg);
    const [x1, y1] = forward(lonDeg, latDeg + 0.001);
    return Math.atan2(x1 - x0, y1 - y0) / DEG;
  }
  return { forward, inverse, trueNorthGrid, lon0: lon0Deg };
}

export const UTM33 = makeTM(15);
export const UTM32 = makeTM(9);

// Web Mercator (EPSG:3857)
const R = 6378137;
export const merc = {
  forward(lon, lat) { return [R * lon * DEG, R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))]; },
  inverse(x, y) { return [(x / R) / DEG, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG]; },
};

export function tileBounds3857(z, x, y) {
  const size = (2 * Math.PI * R) / 2 ** z;
  const minx = -Math.PI * R + x * size, maxy = Math.PI * R - y * size;
  return [minx, maxy - size, minx + size, maxy];
}
export function lonLatToTile(lon, lat, z) {
  const [mx, my] = merc.forward(lon, lat);
  const size = (2 * Math.PI * R) / 2 ** z;
  return [Math.floor((mx + Math.PI * R) / size), Math.floor((Math.PI * R - my) / size)];
}

export function haversine(lat1, lon1, lat2, lon2) {
  const dl = (lat2 - lat1) * DEG, dn = (lon2 - lon1) * DEG;
  const s = Math.sin(dl / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dn / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const deg = DEG;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => { const w = wrap360(a); return w > 180 ? w - 360 : w; };

export function fmtLat(lat) {
  const h = lat >= 0 ? 'N' : 'S'; lat = Math.abs(lat);
  const d = Math.floor(lat), m = (lat - d) * 60;
  return `${d}°${m.toFixed(3).padStart(6, '0').replace('.', ',')}′${h}`;
}
export function fmtLon(lon) {
  const h = lon >= 0 ? 'Ø' : 'V'; lon = Math.abs(lon);
  const d = Math.floor(lon), m = (lon - d) * 60;
  return `${String(d).padStart(3, '0')}°${m.toFixed(3).padStart(6, '0').replace('.', ',')}′${h}`;
}
