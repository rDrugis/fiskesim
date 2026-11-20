// Fargeskala for fiskekartet (deles av kartflisene og forklaringen).
export const PAL = {
  // varmt på grunt, kaldt på dypt – myke overganger
  dag: [[0, [245, 118, 74]], [3, [248, 150, 72]], [7, [250, 186, 84]], [12, [238, 214, 102]], [20, [184, 214, 112]], [30, [118, 200, 140]], [45, [70, 184, 172]], [65, [52, 160, 200]], [100, [52, 128, 206]], [160, [56, 98, 192]], [260, [58, 72, 168]], [450, [52, 50, 138]], [900, [38, 32, 102]]],
  natt: [[0, [70, 104, 120]], [10, [52, 88, 108]], [30, [38, 72, 96]], [80, [26, 56, 82]], [200, [18, 42, 66]], [600, [11, 28, 48]]],
};
export function rgb(d, pal) {
  if (d <= pal[0][0]) return pal[0][1];
  for (let k = 1; k < pal.length; k++) if (d <= pal[k][0]) { const [a, ca] = pal[k - 1], [b, cb] = pal[k], t = (d - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  return pal[pal.length - 1][1];
}

