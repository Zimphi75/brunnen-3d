// Räumlicher Index über Strassen- und Bahnsegmente (lokale Koordinaten) für Ausrichtung von Haltestellen und Laternen.

export function createSegmentIndex(roads, accept, cell = 60) {
  const segments = [];
  const grid = new Map();
  for (const road of roads) {
    if (!accept(road)) continue;
    const p = road.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const seg = [p[i], p[i + 1], p[i + 2], p[i + 3]];
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

  /** Nächster Punkt auf einem Segment innerhalb von maxDistance: { x, z, tx, tz, distance } oder null. */
  function nearest(x, z, maxDistance = 30) {
    const reach = Math.ceil(maxDistance / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = null;
    for (let gx = cx - reach; gx <= cx + reach; gx++) for (let gz = cz - reach; gz <= cz + reach; gz++) {
      for (const index of grid.get(`${gx}:${gz}`) ?? []) {
        const [x0, z0, x1, z1] = segments[index];
        const dx = x1 - x0, dz = z1 - z0, length2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length2));
        const px = x0 + dx * t, pz = z0 + dz * t, distance = Math.hypot(x - px, z - pz);
        if (distance <= maxDistance && (!best || distance < best.distance)) {
          const length = Math.sqrt(length2);
          best = { x: px, z: pz, tx: dx / length, tz: dz / length, distance };
        }
      }
    }
    return best;
  }
  return { nearest, count: segments.length };
}
