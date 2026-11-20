// Solhøyde og lys over og under vann.
const R = Math.PI / 180;

export function sunPos(tMs, lat, lon) {
  const n = tMs / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R;
  const eps = (23.439 - 0.0000004 * n) * R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * R - ra;
  const phi = lat * R;
  const elev = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elev: elev / R, az: ((az / R) + 360) % 360 };
}

// Belysning i overflaten (lux), grovt: dagslys, skumring og natt. Skydekke 0–1.
export function surfaceLux(elevDeg, cloud = 0.5) {
  const cf = 1 - 0.72 * Math.pow(Math.max(0, Math.min(1, cloud)), 2.2);
  if (elevDeg > 0) return 400 + 110000 * Math.pow(Math.sin(elevDeg * R), 1.1) * cf;
  return Math.max(0.0008, 400 * Math.pow(10, elevDeg / 3)) * (0.5 + 0.5 * cf);
}

// Lysdempning i kystvann per måned (Kd, 1/m). Anslag: klarere atlanterhavsvann om vinteren,
// mest plankton under våroppblomstringen. Usikkert – varierer mye mellom fjord og kyst.
export const KD_MONTH = [0.09, 0.09, 0.12, 0.19, 0.17, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.09];

export function luxAtDepth(surface, depth, month) {
  return surface * 0.92 * Math.exp(-KD_MONTH[month] * Math.max(0, depth));
}
