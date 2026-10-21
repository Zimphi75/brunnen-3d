// Strassenmarkierungen: gestrichelte Mittellinie und durchgezogene Randlinien für zweispurige Strassen.
// OSM enthält hier keine Spurzahl; zweispurig wird aus der Strassenklasse angenommen (symbolisch).

export const ROAD_WIDTH = { motorway: 11, primary: 8, secondary: 7, tertiary: 6, minor: 5, service: 3.5, track: 3, path: 1.6 };
const MARKED = {
  primary: { dash: [3, 6], edge: true }, secondary: { dash: [3, 6], edge: true },
  tertiary: { dash: [3, 6], edge: false }, minor: { dash: [2, 4], edge: false },
};
const MIN_LENGTH = 14;
const EDGE_INSET = 0.4;

/** Punkte im Abstand `step` entlang einer Polylinie mit Laufmeter und Richtung. */
export function walk(p, step) {
  const samples = [];
  let distance = 0, next = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x0 = p[i], z0 = p[i + 1], dx = p[i + 2] - x0, dz = p[i + 3] - z0, length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const tx = dx / length, tz = dz / length;
    while (next <= distance + length) {
      const at = next - distance;
      samples.push({ x: x0 + tx * at, z: z0 + tz * at, tx, tz, d: next });
      next += step;
    }
    distance += length;
  }
  return samples;
}

/**
 * Linien der Markierungen als flache Polylinien [x0, z0, x1, z1, …].
 * Markierungen enden vor Einmündungen und Kreuzungen (sobald eine andere Strasse die Fahrbahn berührt).
 */
export function markingLines(roads, index) {
  const dashes = [], edges = [];
  const crossing = (sample, owner, margin) => {
    const other = index.nearest(sample.x, sample.z, 14, owner);
    return other !== null && other.distance < (ROAD_WIDTH[roads[other.owner].c] ?? 4) / 2 + margin;
  };
  roads.forEach((road, owner) => {
    const rule = MARKED[road.c];
    if (!rule || road.t) return;
    const fine = walk(road.p, 1);
    if (fine.length < MIN_LENGTH) return;
    const half = ROAD_WIDTH[road.c] / 2;
    const [dash, gap] = rule.dash;
    const runs = (samples, keep, offset, target) => {
      let run = [];
      const flush = () => { if (run.length >= 2) target.push(run.flatMap(([x, z]) => [x, z])); run = []; };
      for (const sample of samples) {
        if (keep(sample)) run.push([sample.x - sample.tz * offset, sample.z + sample.tx * offset]); else flush();
      }
      flush();
    };
    runs(fine, (s) => s.d % (dash + gap) < dash && s.d > 2 && !crossing(s, owner, 1.2), 0, dashes);
    if (rule.edge) {
      const coarse = walk(road.p, 2);
      for (const side of [1, -1]) runs(coarse, (s) => !crossing(s, owner, 1.0), side * (half - EDGE_INSET), edges);
    }
  });
  return { dashes, edges };
}
