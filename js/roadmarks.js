// Strassenmarkierungen und Fahrstreifen: gestrichelte Mittel- bzw. Spurtrennlinien, durchgezogene Randlinien.
// Autobahnen und Einbahnstrassen nutzen Richtung (`ow`) und Spurzahl (`ln`) aus OSM; sonst gilt die Strassenklasse (symbolisch).

export const ROAD_WIDTH = { motorway: 10, primary: 8, secondary: 7, tertiary: 6, minor: 5, service: 3.5, track: 3, path: 1.6 };
const LANE_WIDTH_MOTORWAY = 3.75;
const MIN_LENGTH = 14;
const EDGE_INSET = 0.4;

/**
 * Fahrbahnbreite, Fahrstreifenmitten, Trennlinien und Randlinien (Versatz in Fahrtrichtung nach rechts, in Metern).
 * Einbahn-Fahrbahnen (`ow`) haben `ln` Streifen; sonst gilt Rechtsverkehr mit je einem Streifen (`ln` Streifen gesamt, mindestens 2).
 */
export function roadLayout(road) {
  const base = ROAD_WIDTH[road.c] ?? 4;
  const oneway = Boolean(road.ow);
  if (road.c === "motorway") {
    const lanes = Math.max(1, road.ln || (oneway ? 2 : 4));
    if (oneway) {
      const width = lanes * LANE_WIDTH_MOTORWAY + 2.5, left = -width / 2 + 0.4;
      const centres = Array.from({ length: lanes }, (_, i) => left + LANE_WIDTH_MOTORWAY * (i + 0.5));
      return { width, lanes: centres, dividers: Array.from({ length: lanes - 1 }, (_, i) => left + LANE_WIDTH_MOTORWAY * (i + 1)), edges: [left, left + LANE_WIDTH_MOTORWAY * lanes], dash: [6, 12] };
    }
    const width = Math.max(8.5, lanes * 3.5 + 1.5);
    return { width, lanes: [width / 4], dividers: [0], edges: [-(width / 2 - EDGE_INSET), width / 2 - EDGE_INSET], dash: [6, 12] };
  }
  if (oneway) {
    const lanes = Math.max(1, road.ln || 1), width = Math.max(base, lanes * 3.2 + 1);
    return { width, lanes: Array.from({ length: lanes }, (_, i) => (i - (lanes - 1) / 2) * 3.2), dividers: lanes > 1 ? Array.from({ length: lanes - 1 }, (_, i) => (i - (lanes - 2) / 2) * 3.2) : [], edges: [], dash: [3, 6] };
  }
  const marked = { primary: { edge: true, dash: [3, 6] }, secondary: { edge: true, dash: [3, 6] }, tertiary: { edge: false, dash: [3, 6] } }[road.c];
  return {
    width: base, lanes: [base / 4], dividers: marked ? [0] : [], edges: marked?.edge ? [-(base / 2 - EDGE_INSET), base / 2 - EDGE_INSET] : [], dash: marked?.dash ?? [3, 6],
  };
}

export const roadWidth = (road) => roadLayout(road).width;

export function roadsidePosition(x, z, roads, index, maxDistance, clearance = 1.25) {
  if (!roads || !index) return { x, z };
  for (let attempt = 0; attempt < 8; attempt++) {
    const nearest = index.nearest(x, z, maxDistance);
    const road = nearest && roads[nearest.owner];
    if (!road || nearest.distance >= roadWidth(road) / 2 + clearance) break;
    const distance = roadWidth(road) / 2 + clearance;
    const nx = -nearest.tz, nz = nearest.tx;
    const side = Math.sign((x - nearest.x) * nx + (z - nearest.z) * nz) || 1;
    x = nearest.x + nx * distance * side;
    z = nearest.z + nz * distance * side;
  }
  return { x, z };
}

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
  const dashes = [], edges = [], dashMeta = [], edgeMeta = [];
  const crossing = (sample, owner, margin) => {
    const other = index.nearest(sample.x, sample.z, 14, owner);
    return other !== null && other.distance < roadWidth(roads[other.owner]) / 2 + margin;
  };
  roads.forEach((road, owner) => {
    if (!["motorway", "primary", "secondary", "tertiary", "minor"].includes(road.c) || road.t) return;
    const layout = roadLayout(road);
    if (!layout.dividers.length && !layout.edges.length) return;
    const fine = walk(road.p, 1);
    if (fine.length < MIN_LENGTH) return;
    const [dash, gap] = layout.dash;
    const runs = (samples, keep, offset, target, meta) => {
      let run = [], start = 0;
      const flush = () => { if (run.length >= 2) { target.push(run.flatMap(([x, z]) => [x, z])); meta.push({ owner, s0: start }); } run = []; };
      for (const sample of samples) {
        if (keep(sample)) { if (!run.length) start = sample.d; run.push([sample.x - sample.tz * offset, sample.z + sample.tx * offset]); } else flush();
      }
      flush();
    };
    for (const offset of layout.dividers) runs(fine, (s) => s.d % (dash + gap) < dash && s.d > 2 && !crossing(s, owner, 1.2), offset, dashes, dashMeta);
    if (layout.edges.length) {
      const coarse = walk(road.p, 2);
      for (const offset of layout.edges) runs(coarse, (s) => !crossing(s, owner, 1.0), offset, edges, edgeMeta);
    }
  });
  return { dashes, edges, dashMeta, edgeMeta };
}
