// Brücken: Strassen und Autobahnen werden an Kreuzungen über die tiefere Strasse bzw. über Gleise geführt (Rampen, Widerlager, Brüstungen).
// OSM kennt hier meist keine Brückengeometrie; die Überführung wird aus Strassenklasse, Schicht und Kreuzungspunkten abgeleitet (symbolisch).
import * as THREE from "three";
import { walk, roadWidth } from "./roadmarks.js";

export const CLEARANCE = 6.4;   // Fahrbahnoberkante über der gekreuzten Fahrbahn bzw. dem Gleis (inkl. Brückenträger)
const SLOPE = 16;               // Rampenlänge je Meter Anhebung (rund 6 %)
const MIN_SLOPE = 10;           // steilere Rampen als 10 % werden nicht gebaut
const LIFTABLE = new Set(["motorway", "primary", "secondary", "tertiary", "minor", "service"]);
const CROSSING_CLASSES = new Set([...LIFTABLE, "rail"]);
const smooth = (t) => t * t * (3 - 2 * t);
const level = (road) => (road.l || 0) + (road.b && !(road.l > 0) ? 1 : 0);
const widthOf = (road) => (road.c === "rail" ? 4 : roadWidth(road));

/** Schnittpunkt zweier Strecken in der Ebene: { t, u } (Parameter 0..1) oder null. */
function intersect(a, b) {
  const rx = a[2] - a[0], rz = a[3] - a[1], sx = b[2] - b[0], sz = b[3] - b[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b[0] - a[0]) * sz - (b[1] - a[1]) * sx) / denominator, u = ((b[0] - a[0]) * rz - (b[1] - a[1]) * rx) / denominator;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { t, u, sin: Math.abs(denominator) / (Math.hypot(rx, rz) * Math.hypot(sx, sz)) } : null;
}

/** Wer führt über wen: höhere Schicht, sonst Autobahn über Strasse und Strasse über Gleis. Rückgabe 1 (a oben), -1 (b oben) oder 0 (gleiche Höhe). */
export function overUnder(a, b) {
  const la = level(a), lb = level(b);
  if (la !== lb) return la > lb ? 1 : -1;
  if (a.c === "motorway" && b.c !== "motorway") return 1;
  if (b.c === "motorway" && a.c !== "motorway") return -1;
  if (a.c === "rail" && b.c !== "rail") return -1;
  if (b.c === "rail" && a.c !== "rail") return 1;
  return 0;
}

const nodeKey = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;

export class Bridges {
  constructor(roads, terrain) {
    this.roads = roads;
    this.terrain = terrain;
    this.plan = new Map();   // Strassenindex -> Quellen { s0, offset, core, ramp, peak }
    this.totals = new Map();
    this.crossings = [];
    this.#plan();
  }

  #plan() {
    const { roads } = this;
    const eligible = [];
    roads.forEach((road, index) => { if (!road.t && CROSSING_CLASSES.has(road.c) && road.p.length >= 4) eligible.push(index); });
    const cum = new Map();
    for (const index of eligible) {
      const p = roads[index].p, c = [0];
      for (let i = 2; i < p.length; i += 2) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
      cum.set(index, c);
      this.totals.set(index, c[c.length - 1]);
    }
    // Knoten je Familie (Gleise getrennt von Strassen und Wegen): wer berührt wen
    const family = (road) => (road.c === "rail" ? "rail" : "road");
    const nodes = { rail: new Map(), road: new Map() };
    roads.forEach((road, index) => {
      if (road.t || road.c === "aerialway") return;
      const map = nodes[family(road)];
      for (let i = 0; i < road.p.length; i += 2) {
        const key = nodeKey(road.p[i], road.p[i + 1]);
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(index);
      }
    });
    const endpointKeys = (index) => { const p = roads[index].p; return [nodeKey(p[0], p[1]), nodeKey(p[p.length - 2], p[p.length - 1])]; };

    const cell = 50, grid = new Map();
    for (const index of eligible) {
      const p = roads[index].p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = Math.floor(Math.min(p[i], p[i + 2]) / cell), x1 = Math.floor(Math.max(p[i], p[i + 2]) / cell);
        const z0 = Math.floor(Math.min(p[i + 1], p[i + 3]) / cell), z1 = Math.floor(Math.max(p[i + 1], p[i + 3]) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const key = `${gx}:${gz}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push([index, i]);
        }
      }
    }

    /** Läuft von einer Kreuzung aus in eine Richtung über durchgehende Wege bis zur nächsten Verzweigung. */
    const trace = (start, s0, direction, limit) => {
      let index = start, dist = direction < 0 ? s0 : this.totals.get(start) - s0;
      const ways = [];
      for (let guard = 0; guard < 40; guard++) {
        if (dist >= limit) return { junction: Infinity, ways };
        const road = roads[index], keys = endpointKeys(index), key = direction < 0 ? keys[0] : keys[1];
        const others = [...(nodes[family(road)].get(key) ?? [])].filter((i) => i !== index);
        if (others.length !== 1) return { junction: dist, ways };
        const next = others[0];
        if (!this.totals.has(next) || family(roads[next]) !== family(road)) return { junction: dist, ways };
        const nextKeys = endpointKeys(next);
        const atStart = nextKeys[0] === key, atEnd = nextKeys[1] === key;
        if (!atStart && !atEnd) return { junction: dist, ways };
        ways.push({ index: next, s0: atStart ? 0 : this.totals.get(next), offset: dist });
        dist += this.totals.get(next);
        index = next;
        direction = atStart ? 1 : -1;
      }
      return { junction: dist, ways };
    };

    const seen = new Set();
    const planned = new Set();
    for (const list of grid.values()) {
      for (let m = 0; m < list.length; m++) for (let n = m + 1; n < list.length; n++) {
        const [ia, sa] = list[m], [ib, sb] = list[n];
        if (ia === ib) continue;
        const key = `${ia}:${sa}:${ib}:${sb}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = roads[ia], b = roads[ib], pa = a.p, pb = b.p;
        let hit = intersect([pa[sa], pa[sa + 1], pa[sa + 2], pa[sa + 3]], [pb[sb], pb[sb + 1], pb[sb + 2], pb[sb + 3]]);
        let x, z;
        if (hit) {
          x = pa[sa] + (pa[sa + 2] - pa[sa]) * hit.t; z = pa[sa + 1] + (pa[sa + 3] - pa[sa + 1]) * hit.t;
          const vertex = (p) => { for (let i = 0; i < p.length; i += 2) if (Math.hypot(p[i] - x, p[i + 1] - z) < 3) return true; return false; };
          if (vertex(pa) && vertex(pb) && a.c !== "rail" && b.c !== "rail") continue; // Einmündung oder Kreuzung mit gemeinsamem Knoten
        } else if ((a.c === "rail") !== (b.c === "rail")) {
          // Bahnübergang: Strasse und Gleis teilen sich einen Knoten, der Weg der Strasse endet dort
          const shared = [[pa[sa], pa[sa + 1]], [pa[sa + 2], pa[sa + 3]]].find(([qx, qz]) => [[pb[sb], pb[sb + 1]], [pb[sb + 2], pb[sb + 3]]].some(([rx, rz]) => Math.hypot(qx - rx, qz - rz) < 0.2));
          if (!shared) continue;
          [x, z] = shared;
          const da = Math.hypot(pa[sa] - x, pa[sa + 1] - z), db = Math.hypot(pb[sb] - x, pb[sb + 1] - z);
          const along = (p, i) => { const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; };
          const [ux, uz] = along(pa, sa), [vx, vz] = along(pb, sb);
          hit = { t: da / Math.hypot(pa[sa + 2] - pa[sa], pa[sa + 3] - pa[sa + 1]), u: db / Math.hypot(pb[sb + 2] - pb[sb], pb[sb + 3] - pb[sb + 1]), sin: Math.abs(ux * vz - uz * vx) };
          if (hit.sin < 0.25) continue;
        } else continue;
        const order = overUnder(a, b);
        if (!order) continue;
        const [upper, lower, iu, il, segU, tU, sin] = order > 0 ? [a, b, ia, ib, sa, hit.t, hit.sin] : [b, a, ib, ia, sb, hit.u, hit.sin];
        if (upper.c === "rail" && lower.c === "rail") continue;
        const c = cum.get(iu), s0 = c[segU / 2] + tU * (c[segU / 2 + 1] - c[segU / 2]);
        const core = Math.min(40, Math.max(8, (widthOf(lower) / 2 + 4) / Math.max(0.35, sin)));
        const dedupe = `${iu}:${Math.round(x / 12)}:${Math.round(z / 12)}`;
        if (planned.has(dedupe)) continue;
        const limit = core + CLEARANCE * SLOPE;
        const back = trace(iu, s0, -1, limit), forward = trace(iu, s0, 1, limit);
        const ramp = Math.min(CLEARANCE * SLOPE, back.junction - core, forward.junction - core);
        if (ramp < CLEARANCE * MIN_SLOPE) continue; // bis zur nächsten Verzweigung zu kurz für eine Rampe: bleibt auf Höhe
        planned.add(dedupe);
        const source = { peak: CLEARANCE, core, ramp, lowerWidth: widthOf(lower) };
        const add = (index, extra) => { if (!this.plan.has(index)) this.plan.set(index, []); this.plan.get(index).push({ ...source, ...extra }); };
        add(iu, { s0, offset: 0 });
        for (const way of [...back.ways, ...forward.ways]) if (way.offset < core + ramp) add(way.index, { s0: way.s0, offset: way.offset });
        this.crossings.push({ upper: iu, lower: il, x, z });
      }
    }
  }

  get count() { return this.crossings.length; }
  isLifted(index) { return this.plan.has(index); }

  /** Anhebung der Strassenmitte in Metern bei Laufmeter s. */
  liftOf(index, s) {
    let height = 0;
    for (const c of this.plan.get(index) ?? []) {
      const d = c.offset + Math.abs(s - c.s0), t = d <= c.core ? 1 : Math.max(0, 1 - (d - c.core) / c.ramp);
      height = Math.max(height, c.peak * smooth(t));
    }
    return height;
  }

  /** Strassenmittelpunkt bei Laufmeter s (aus den gleichmässig abgetasteten Punkten). */
  #centreHeight(index, s) {
    this.cache ??= new Map();
    let entry = this.cache.get(index);
    if (!entry) {
      const samples = walk(this.roads[index].p, 2);
      entry = { samples, heights: samples.map((p) => this.terrain.heightAt(p.x, p.z) ?? 0) };
      this.cache.set(index, entry);
    }
    const f = Math.min(entry.samples.length - 1, Math.max(0, s / 2)), i = Math.floor(f), j = Math.min(entry.samples.length - 1, i + 1);
    return entry.heights[i] + (entry.heights[j] - entry.heights[i]) * (f - i);
  }

  /** Höhe der Fahrbahnoberfläche bei Laufmeter s (ohne Auflage); nur für angehobene Strassen, flacher Querschnitt. */
  deckY(index, s) { return this.#centreHeight(index, s) + this.liftOf(index, s); }

  /** Höhenfunktion (x, z, s) -> y für angehobene Strassen, sonst null. */
  heightFn(index) {
    return this.plan.has(index) ? (x, z, s) => this.deckY(index, s) : null;
  }

  /** Rampen (Böschung), Brückenträger, Brüstungen. */
  build() {
    const group = new THREE.Group();
    group.name = "bridges";
    const concrete = [], slope = [];
    const strip = (target, a, b) => { // a, b: je zwei Punkte [x,y,z] einer Folge -> Viereck
      target.push(...a[0], ...b[0], ...a[1], ...a[1], ...b[0], ...b[1]);
    };
    for (const [index] of this.plan) {
      const road = this.roads[index], half = roadWidth(road) / 2 + 0.25;
      const samples = walk(road.p, 3).filter((s) => this.liftOf(index, s.d) > 0.05);
      let previous = null;
      for (const s of samples) {
        const lift = this.liftOf(index, s.d), y = this.deckY(index, s.d);
        const rx = -s.tz, rz = s.tx;
        const edge = (side, dy, outward = 0) => [s.x + rx * side * (half + outward), y + dy, s.z + rz * side * (half + outward)];
        const bank = (side) => { const out = lift * 1.5, x = s.x + rx * side * (half + out), z = s.z + rz * side * (half + out); return [x, (this.terrain.heightAt(x, z) ?? y - lift), z]; };
        const inSpan = this.plan.get(index).some((c) => c.offset === 0 && Math.abs(s.d - c.s0) <= c.core + 3);
        const current = { left: edge(-1, 0), right: edge(1, 0), leftTop: edge(-1, 0.95), rightTop: edge(1, 0.95), leftBottom: edge(-1, -1.15), rightBottom: edge(1, -1.15), leftBank: bank(-1), rightBank: bank(1), inSpan };
        if (previous && s.d - previous.s > 4) previous = null;
        if (previous) {
          for (const side of ["left", "right"]) {
            strip(concrete, [previous[`${side}Top`], previous[side]], [current[`${side}Top`], current[side]]); // Brüstung
            if (current.inSpan && previous.inSpan) strip(concrete, [previous[side], previous[`${side}Bottom`]], [current[side], current[`${side}Bottom`]]); // Trägerseite
            else if (lift > 0.8) strip(slope, [previous[side], previous[`${side}Bank`]], [current[side], current[`${side}Bank`]]); // Böschung
          }
          if (current.inSpan && previous.inSpan) strip(concrete, [previous.leftBottom, previous.rightBottom], [current.leftBottom, current.rightBottom]); // Unterseite
        }
        previous = { ...current, s: s.d };
      }
    }
    const make = (positions, color, roughness) => {
      if (!positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    };
    make(concrete, 0xa7a49d, 0.9);
    make(slope, 0x5c7b3d, 1);
    return group;
  }
}
