// Strassen ins Gelände legen (nach dem Vorbild von speicher.mlanalytica.com):
// 1. Strassen und Gleise werden in ein 2-m-Höhenraster gezeichnet (Höhe = Originalgelände).
// 2. Das Raster wird nur innerhalb des Netzes geglättet (rund 20 m Wirkung), so passen auch Kreuzungen zusammen.
// 3. Das 5-m-Gelände wird zur Strasse hin abgetragen bzw. aufgeschüttet, mit weichen Böschungen (bis 13 m).
// Gebäude (feste swissBUILDINGS3D-Höhen) und der See werden geschützt; Brücken und Tunnel bleiben aussen vor.
import { roadWidth } from "./roadmarks.js";

const RC = 2;                 // Rastergrösse des Strassenrasters in Metern
const EDGE = 0.6;             // Bankett über den Fahrbahnrand hinaus
const SMOOTH_ITERATIONS = 70; // Jacobi-Durchgänge, ca. 20 m Einfluss
const CORE = 1.5;             // bis hier gilt die Strassenhöhe voll
const BANK = 13;              // Ende der Böschung
const BUILDING_KEEP = 3;      // bis hier um Gebäude bleibt das Gelände unverändert
const BUILDING_FADE = 8;      // danach volle Böschung
const LAKE_MARGIN = 0.3;      // Gelände bis so hoch über dem Seespiegel gilt als See
const LINK_STEP = 3;          // Nachbarzellen mit grösserem Höhensprung gehören zu verschiedenen Ebenen (Haarnadelkurven) …
const LINK_ALONG = 20;        // … ausser sie liegen auf derselben Strasse nahe beieinander (Ausreisser im Gelände glätten)
const MAX_CORE = 6;           // grössere Abweichung unter der Fahrbahn: Galerie, Fels oder Kunstbaute -> Gelände belassen
const MAX_BANK = 4;           // Böschungen höchstens so hoch bzw. tief
const ENCODE = 40;            // Höhen im Strassenraster: 2.5 cm Auflösung (Uint16)
const NONE = 65535;

const FIXED_WIDTH = { tertiary: 6, minor: 5, service: 3.5, track: 3, rail: 4 };
const MEASURED = new Set(["motorway", "primary", "secondary"]);
const smoothstep = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** Fahrbahnbreite für das Raster, gleich wie die gezeichneten Bänder; null = nicht einebnen. */
export function gradeWidth(road) {
  if (road.t || road.b) return null;
  if (MEASURED.has(road.c)) return roadWidth(road);
  return FIXED_WIDTH[road.c] ?? null;
}

/** Grundriss-Rechtecke [minX, minZ, maxX, maxZ] aus parseBuildings-Daten. */
export function buildingFootprints(data) {
  if (!data) return new Float32Array(0);
  const { table, positions, count } = data, stride = table.length / count;
  const out = new Float32Array(count * 4);
  for (let b = 0; b < count; b++) {
    const start = table[b * stride], length = table[b * stride + 1];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let v = start; v < start + length; v++) {
      const x = positions[v * 3], z = positions[v * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    out.set([minX, minZ, maxX, maxZ], b * 4);
  }
  return out;
}

/**
 * Ebnet das Gelände entlang der Strassen ein. Verändert `dem.values` direkt.
 * Rückgabe: { roadAt(x, z) -> Höhe der Strassenoberfläche oder null, rawHeightAt(x, z), stats }.
 */
export function gradeTerrain({ dem, minX, maxZ, roads, footprints = new Float32Array(0) }) {
  const started = performance.now();
  const { nx, ny, cell, scale, values } = dem;
  const raw = values.slice();
  const width = (nx - 1) * cell, depth = (ny - 1) * cell;

  let lowest = Infinity;
  for (let k = 0; k < raw.length; k++) if (raw[k] < lowest) lowest = raw[k];
  const lakeY = lowest * scale + LAKE_MARGIN;

  const rawHeightAt = (x, z) => {
    const fi = (x - minX) / cell, fj = (maxZ - z) / cell;
    if (fi < 0 || fj < 0 || fi > nx - 1 || fj > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fi)), j = Math.min(ny - 2, Math.floor(fj)), tx = fi - i, tz = fj - j;
    const h00 = raw[j * nx + i], h10 = raw[j * nx + i + 1], h01 = raw[(j + 1) * nx + i], h11 = raw[(j + 1) * nx + i + 1];
    return ((h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz) * scale;
  };

  // 1. Strassen ins 2-m-Raster zeichnen
  const RW = Math.ceil(width / RC) + 1, RH = Math.ceil(depth / RC) + 1;
  const roadH = new Uint16Array(RW * RH).fill(NONE);
  const slot = new Map();          // Rasterindex -> Listenposition
  let cells = new Int32Array(1 << 16), heights = new Float32Array(1 << 16), owners = new Int32Array(1 << 16), along = new Float32Array(1 << 16), n = 0;
  const grow = (array) => { const next = new array.constructor(array.length * 2); next.set(array); return next; };
  const push = (q, h, owner, s) => {
    if (n === cells.length) { cells = grow(cells); heights = grow(heights); owners = grow(owners); along = grow(along); }
    slot.set(q, n); cells[n] = q; heights[n] = h; owners[n] = owner; along[n] = s; n++;
  };
  let graded = 0;
  roads.forEach((road, owner) => {
    const w = gradeWidth(road);
    if (!w || road.p.length < 4) return;
    graded++;
    const rad = w / 2 + EDGE, p = road.p;
    let run = 0;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3], length = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(length));
      for (let t = 0; t <= steps; t++) {
        const x = ax + ((bx - ax) * t) / steps, z = az + ((bz - az) * t) / steps, metre = run + (length * t) / steps;
        const cx = (x - minX) / RC, cy = (maxZ - z) / RC, rr = rad / RC;
        const c0 = Math.max(0, Math.floor(cx - rr)), c1 = Math.min(RW - 1, Math.ceil(cx + rr));
        const r0 = Math.max(0, Math.floor(cy - rr)), r1 = Math.min(RH - 1, Math.ceil(cy + rr));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const q = r * RW + c;
          if (slot.has(q) || Math.hypot(c - cx, r - cy) > rr) continue;
          const h = rawHeightAt(minX + c * RC, maxZ - r * RC);
          if (h === null || h <= lakeY) continue;
          push(q, h, owner, metre);
        }
      }
      run += length;
    }
  });

  // 2. nur innerhalb des Netzes glätten (Jacobi); Haarnadelkurven und Ebenen werden nicht vermischt
  const neighbours = new Int32Array(n * 4).fill(-1);
  const linked = (k, m) => m !== undefined && (Math.abs(heights[k] - heights[m]) < LINK_STEP
    || (owners[k] === owners[m] && Math.abs(along[k] - along[m]) < LINK_ALONG));
  for (let k = 0; k < n; k++) {
    const q = cells[k], c = q % RW;
    let m;
    if (c > 0 && linked(k, m = slot.get(q - 1))) neighbours[k * 4] = m;
    if (c < RW - 1 && linked(k, m = slot.get(q + 1))) neighbours[k * 4 + 1] = m;
    if (linked(k, m = slot.get(q - RW))) neighbours[k * 4 + 2] = m;
    if (linked(k, m = slot.get(q + RW))) neighbours[k * 4 + 3] = m;
  }
  slot.clear();
  let a = heights.slice(0, n), b = new Float32Array(n);
  for (let it = 0; it < SMOOTH_ITERATIONS; it++) {
    for (let k = 0; k < n; k++) {
      let sum = a[k] * 2, count = 2;
      for (let e = 0; e < 4; e++) { const m = neighbours[k * 4 + e]; if (m >= 0) { sum += a[m]; count++; } }
      b[k] = sum / count;
    }
    const swap = a; a = b; b = swap;
  }
  let maxShift = 0;
  for (let k = 0; k < n; k++) {
    roadH[cells[k]] = Math.min(NONE - 1, Math.max(0, Math.round(a[k] * ENCODE)));
    maxShift = Math.max(maxShift, Math.abs(a[k] - heights[k]));
  }

  // 3. Abstand jedes Geländepunkts zur nächsten Strassenzelle und deren Höhe
  const dist = new Float32Array(nx * ny).fill(Infinity), near = new Float32Array(nx * ny);
  const reach = BANK + RC;
  for (let k = 0; k < n; k++) {
    const q = cells[k], x = minX + (q % RW) * RC, z = maxZ - Math.floor(q / RW) * RC, h = a[k];
    const i0 = Math.max(0, Math.floor((x - minX - reach) / cell)), i1 = Math.min(nx - 1, Math.ceil((x - minX + reach) / cell));
    const j0 = Math.max(0, Math.floor((maxZ - z - reach) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxZ - z + reach) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.max(0, Math.hypot(minX + i * cell - x, maxZ - j * cell - z) - RC / 2);
      const v = j * nx + i;
      if (d < dist[v]) { dist[v] = d; near[v] = h; }
    }
  }

  // Gebäudeschutz: Abstand zum nächsten Grundriss-Rechteck
  const keep = new Float32Array(nx * ny).fill(Infinity);
  for (let f = 0; f < footprints.length; f += 4) {
    const bx0 = footprints[f], bz0 = footprints[f + 1], bx1 = footprints[f + 2], bz1 = footprints[f + 3];
    if (!Number.isFinite(bx0)) continue;
    const i0 = Math.max(0, Math.floor((bx0 - minX - BUILDING_FADE) / cell)), i1 = Math.min(nx - 1, Math.ceil((bx1 - minX + BUILDING_FADE) / cell));
    const j0 = Math.max(0, Math.floor((maxZ - bz1 - BUILDING_FADE) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxZ - bz0 + BUILDING_FADE) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = minX + i * cell, z = maxZ - j * cell;
      const dx = Math.max(bx0 - x, 0, x - bx1), dz = Math.max(bz0 - z, 0, z - bz1);
      const d = Math.hypot(dx, dz), v = j * nx + i;
      if (d < keep[v]) keep[v] = d;
    }
  }

  // 4. Gelände abtragen / aufschütten
  let changed = 0, maxCut = 0, maxFill = 0;
  for (let v = 0; v < values.length; v++) {
    const d = dist[v];
    if (d >= BANK) continue;
    const orig = raw[v] * scale;
    if (orig <= lakeY) continue;
    const gap = near[v] - orig;
    if (Math.abs(gap) > MAX_CORE) continue;
    let f = d <= CORE ? 1 : 1 - smoothstep((d - CORE) / (BANK - CORE));
    if (d > CORE) f *= smoothstep((keep[v] - BUILDING_KEEP) / (BUILDING_FADE - BUILDING_KEEP));
    if (f <= 0) continue;
    const shift = gap * f;
    const target = orig + (d > CORE ? Math.max(-MAX_BANK, Math.min(MAX_BANK, shift)) : shift);
    const next = Math.max(0, Math.min(65535, Math.round(target / scale)));
    if (next === values[v]) continue;
    values[v] = next;
    changed++;
    const delta = target - orig;
    if (delta < maxCut) maxCut = delta;
    if (delta > maxFill) maxFill = delta;
  }

  /** Höhe der Strassenoberfläche (bilinear nur über Strassenzellen) oder null neben dem Netz. */
  const roadAt = (x, z) => {
    const cx = (x - minX) / RC, cy = (maxZ - z) / RC;
    if (cx < 0 || cy < 0 || cx > RW - 1 || cy > RH - 1) return null;
    const c0 = Math.min(RW - 2, Math.floor(cx)), r0 = Math.min(RH - 2, Math.floor(cy)), fc = cx - c0, fr = cy - r0;
    const q = r0 * RW + c0;
    let sum = 0, weight = 0, h;
    if ((h = roadH[q]) !== NONE) { const w = (1 - fc) * (1 - fr); sum += h * w; weight += w; }
    if ((h = roadH[q + 1]) !== NONE) { const w = fc * (1 - fr); sum += h * w; weight += w; }
    if ((h = roadH[q + RW]) !== NONE) { const w = (1 - fc) * fr; sum += h * w; weight += w; }
    if ((h = roadH[q + RW + 1]) !== NONE) { const w = fc * fr; sum += h * w; weight += w; }
    return weight > 1e-6 ? sum / weight / ENCODE : null;
  };

  const stats = {
    roads: graded, roadCells: n, terrainPointsChanged: changed,
    maxRoadShift: +maxShift.toFixed(2), maxCut: +maxCut.toFixed(2), maxFill: +maxFill.toFixed(2),
    ms: Math.round(performance.now() - started),
  };
  return { roadAt, rawHeightAt, stats };
}
