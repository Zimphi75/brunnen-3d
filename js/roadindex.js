// Räumlicher Index über Strassen- und Bahnsegmente (lokale Koordinaten) für Ausrichtung von Haltestellen und Laternen.

export function createSegmentIndex(roads, accept, cell = 60) {
  const segments = [];
  const grid = new Map();
  for (const [owner, road] of roads.entries()) {
    if (!accept(road)) continue;
    const p = road.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const seg = [p[i], p[i + 1], p[i + 2], p[i + 3], owner];
      const index = segments.push(seg) - 1;
      const x0 = Math.floor(Math.min(seg[0], seg[2]) / cell), x1 = Math.floor(Math.max(seg[0], seg[2]) / cell);
      const z0 = Math.floor(Math.min(seg[1], seg[3]) / cell), z1 = Math.floor(Math.max(seg[1], seg[3]) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const key = `${gx}:${gz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
      }
    }
  }

  /** Nächster Punkt auf einem Segment innerhalb von maxDistance: { x, z, tx, tz, distance, owner } oder null; `excludeOwner` überspringt eine Strasse (Index in `roads`). */
  function nearest(x, z, maxDistance = 30, excludeOwner = -1) {
    const reach = Math.ceil(maxDistance / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = null;
    for (let gx = cx - reach; gx <= cx + reach; gx++) for (let gz = cz - reach; gz <= cz + reach; gz++) {
      for (const index of grid.get(`${gx}:${gz}`) ?? []) {
        const [x0, z0, x1, z1, owner] = segments[index];
        if (owner === excludeOwner) continue;
        const dx = x1 - x0, dz = z1 - z0, length2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length2));
        const px = x0 + dx * t, pz = z0 + dz * t, distance = Math.hypot(x - px, z - pz);
        if (distance <= maxDistance && (!best || distance < best.distance)) {
          const length = Math.sqrt(length2);
          best = { x: px, z: pz, tx: dx / length, tz: dz / length, distance, owner };
        }
      }
    }
    return best;
  }
  return { nearest, count: segments.length };
}

const BLOCKED_HALF_WIDTH = { motorway: 5.5, primary: 4, secondary: 3.5, tertiary: 3, minor: 2.5, service: 1.75, track: 1.5, path: 0.8, rail: 1.7 };
const BLOCKED_WATER_HALF_WIDTH = { river: 3, canal: 2, stream: 0.9 };

function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Prüft, ob an einer Stelle (x, z) ein Baum auf Strasse, Weg, Gleis, Bach oder im Wasser stünde.
 * `clearance` ist der zusätzliche Abstand (Stammstärke, Bankett, ein Teil der Kronenbreite).
 */
export function createBlocker(roads, water) {
  const lines = Object.entries(BLOCKED_HALF_WIDTH).map(([kind, half]) => ({ half, index: createSegmentIndex(roads, (r) => r.c === kind && !r.t) }))
    .filter((entry) => entry.index.count);
  const streams = water?.streams ?? [];
  const streamsByHalf = new Map();
  for (const stream of streams) {
    const half = BLOCKED_WATER_HALF_WIDTH[stream.k] ?? 0.9;
    if (!streamsByHalf.has(half)) streamsByHalf.set(half, []);
    streamsByHalf.get(half).push(stream);
  }
  for (const [half, list] of streamsByHalf) lines.push({ half, index: createSegmentIndex(list, () => true) });
  const areas = (water?.areas ?? []).map((area) => {
    const ring = area.rings[0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]); minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]); }
    return { rings: area.rings, minX, maxX, minZ, maxZ };
  });
  return function blocked(x, z, clearance = 0.7) {
    for (const { half, index } of lines) if (index.nearest(x, z, half + clearance)) return true;
    for (const area of areas) {
      if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
      if (insideRing(x, z, area.rings[0]) && !area.rings.slice(1).some((hole) => insideRing(x, z, hole))) return true;
    }
    return false;
  };
}
