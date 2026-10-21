// Gebäude: ein zusammengeführtes Mesh (ein Draw-Call), Auswahl per eigenem AABB-/Dreiecks-Picker.
import * as THREE from "three";

const PERIODS = {
  8011: { from: null, to: 1918, mid: 1900, label: "vor 1919" },
  8012: { from: 1919, to: 1945, mid: 1932, label: "1919 bis 1945" },
  8013: { from: 1946, to: 1960, mid: 1953, label: "1946 bis 1960" },
  8014: { from: 1961, to: 1970, mid: 1966, label: "1961 bis 1970" },
  8015: { from: 1971, to: 1980, mid: 1976, label: "1971 bis 1980" },
  8016: { from: 1981, to: 1985, mid: 1983, label: "1981 bis 1985" },
  8017: { from: 1986, to: 1990, mid: 1988, label: "1986 bis 1990" },
  8018: { from: 1991, to: 1995, mid: 1993, label: "1991 bis 1995" },
  8019: { from: 1996, to: 2000, mid: 1998, label: "1996 bis 2000" },
  8020: { from: 2001, to: 2005, mid: 2003, label: "2001 bis 2005" },
  8021: { from: 2006, to: 2010, mid: 2008, label: "2006 bis 2010" },
  8022: { from: 2011, to: 2015, mid: 2013, label: "2011 bis 2015" },
  8023: { from: 2016, to: null, mid: 2019, label: "nach 2015" },
};

/** Baujahr aus GWR: exakt (GBAUJ) oder nur Bauperiode (GBAUP, dann Periodenmitte als Näherung). */
export function buildYear(record) {
  const gwr = record.gwr;
  if (!gwr) return null;
  if (gwr.yearBuilt) return { year: gwr.yearBuilt, exact: true };
  const period = PERIODS[gwr.periodBuilt];
  return period ? { year: period.mid, exact: false, label: period.label } : null;
}

const TYPE_GROUPS = [
  { id: "wohnen", label: "Wohnen", color: "#d98c5f", match: (c) => c >= 1110 && c <= 1130 },
  { id: "gastro", label: "Hotel und Gastronomie", color: "#b05a9c", match: (c) => c >= 1211 && c <= 1231 && c !== 1220 && c !== 1230 },
  { id: "buero", label: "Büro und Handel", color: "#4f81bd", match: (c) => c === 1220 || c === 1230 },
  { id: "industrie", label: "Industrie und Lager", color: "#7b7f86", match: (c) => c === 1251 || c === 1252 },
  { id: "verkehr", label: "Verkehr und Garagen", color: "#c9b037", match: (c) => c === 1241 || c === 1242 },
  { id: "oeffentlich", label: "Kultur, Bildung, Gesundheit, Sport", color: "#3e9c8d", match: (c) => c >= 1261 && c <= 1265 },
  { id: "land", label: "Landwirtschaft", color: "#79a64a", match: (c) => c === 1271 || (c >= 1276 && c <= 1278) },
  { id: "sakral", label: "Kirchen und Kultgebäude", color: "#8a5fc9", match: (c) => c === 1272 || c === 1273 },
  { id: "sonstige", label: "Sonstige Hochbauten", color: "#a0a39a", match: (c) => c === 1274 || c === 1275 },
];
const NO_DATA_COLOR = "#b9bcb4";

export function typeGroup(record) {
  const code = record.gwr?.class;
  return TYPE_GROUPS.find((group) => code && group.match(code)) ?? null;
}

function lerpColor(stops, t) {
  const clamped = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(clamped));
  return stops[i].clone().lerp(stops[i + 1], clamped - i);
}
const ramp = (hexes) => hexes.map((hex) => new THREE.Color(hex));
const YEAR_RAMP = ramp(["#2c3e8c", "#2a7ab0", "#35a58f", "#a2c64a", "#f2c63a", "#e8783a", "#c0392b"]);
const HEIGHT_RAMP = ramp(["#e7e3d5", "#e8c98f", "#e0955a", "#b8492f", "#6b2036"]);
const YEAR_RANGE = [1850, 2025];
const HEIGHT_RANGE = [3, 30];

export const COLOR_MODES = [
  { id: "standard", label: "Standard" },
  { id: "year", label: "Baujahr" },
  { id: "height", label: "Höhe" },
  { id: "type", label: "Typ" },
];

const SELECT_COLOR = new THREE.Color("#ff9d1c");
const HOVER_COLOR = new THREE.Color("#ffd27a");

export class Buildings {
  constructor(data, records) {
    this.data = data;
    this.records = records;
    this.mode = "standard";
    this.selected = -1;
    this.hovered = -1;
    this.visibleMask = new Uint8Array(data.count).fill(1);
    this.#createGeometry();
    this.#computeBounds();
    this.setColorMode("standard");
  }

  #createGeometry() {
    const { positions, indices, vertexCount } = this.data;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(vertexCount * 3), 3, true));
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.geometry = geometry;
    this.fullIndices = indices;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "buildings";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }

  #computeBounds() {
    const { table, positions, count } = this.data;
    this.bounds = new Float32Array(count * 6);
    for (let b = 0; b < count; b++) {
      const start = table[b * 4], length = table[b * 4 + 1];
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let v = start; v < start + length; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      this.bounds.set([minX, minY, minZ, maxX, maxY, maxZ], b * 6);
    }
  }

  center(index) {
    const b = this.bounds.subarray(index * 6, index * 6 + 6);
    return new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  }

  baseColor(record) {
    const wall = new THREE.Color();
    switch (this.mode) {
      case "year": {
        const info = buildYear(record);
        return info ? lerpColor(YEAR_RAMP, (info.year - YEAR_RANGE[0]) / (YEAR_RANGE[1] - YEAR_RANGE[0])) : wall.set(NO_DATA_COLOR);
      }
      case "height":
        return record.height == null ? wall.set(NO_DATA_COLOR) : lerpColor(HEIGHT_RAMP, (record.height - HEIGHT_RANGE[0]) / (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]));
      case "type": {
        const group = typeGroup(record);
        return wall.set(group ? group.color : NO_DATA_COLOR);
      }
      default:
        return wall.set("#d6d0c4");
    }
  }

  setColorMode(mode) {
    this.mode = mode;
    const { table, surfaces, count } = this.data;
    const colors = this.geometry.attributes.color.array;
    const roof = new THREE.Color();
    for (let b = 0; b < count; b++) {
      const wall = this.baseColor(this.records[b]);
      roof.copy(wall).multiplyScalar(mode === "standard" ? 0.6 : 0.8);
      for (let v = table[b * 4]; v < table[b * 4] + table[b * 4 + 1]; v++) {
        const color = surfaces[v] === 1 ? roof : wall;
        colors[v * 3] = Math.round(color.r * 255);
        colors[v * 3 + 1] = Math.round(color.g * 255);
        colors[v * 3 + 2] = Math.round(color.b * 255);
      }
    }
    this.geometry.attributes.color.needsUpdate = true;
    this.#repaint(this.selected, SELECT_COLOR);
    this.#repaint(this.hovered, HOVER_COLOR);
  }

  legend() {
    const swatches = (items) => items.map(([color, label]) => ({ color, label }));
    switch (this.mode) {
      case "year":
        return swatches([
          [YEAR_RAMP[0].getStyle(), "1850 oder früher"], [YEAR_RAMP[2].getStyle(), "um 1920"], [YEAR_RAMP[4].getStyle(), "um 1970"],
          [YEAR_RAMP[6].getStyle(), "2025"], [NO_DATA_COLOR, "kein Baujahr im GWR"],
        ]).concat([{ note: "Bauperioden werden mit der Periodenmitte dargestellt (Näherung)." }]);
      case "height":
        return swatches([[HEIGHT_RAMP[0].getStyle(), "3 m"], [HEIGHT_RAMP[2].getStyle(), "15 m"], [HEIGHT_RAMP[4].getStyle(), "30 m und mehr"]]);
      case "type":
        return swatches(TYPE_GROUPS.map((g) => [g.color, g.label]).concat([[NO_DATA_COLOR, "kein GWR-Eintrag"]]));
      default:
        return [];
    }
  }

  #repaint(index, override) {
    if (index < 0) return;
    const { table, surfaces } = this.data;
    const colors = this.geometry.attributes.color.array;
    const wall = override ?? this.baseColor(this.records[index]);
    const roof = wall.clone().multiplyScalar(override ? 0.9 : this.mode === "standard" ? 0.6 : 0.8);
    for (let v = table[index * 4]; v < table[index * 4] + table[index * 4 + 1]; v++) {
      const color = surfaces[v] === 1 ? roof : wall;
      colors[v * 3] = Math.round(color.r * 255);
      colors[v * 3 + 1] = Math.round(color.g * 255);
      colors[v * 3 + 2] = Math.round(color.b * 255);
    }
    this.geometry.attributes.color.needsUpdate = true;
  }

  select(index) {
    if (this.selected === index) return;
    const previous = this.selected;
    this.selected = index;
    this.#repaint(previous, null);
    if (previous === this.hovered) this.#repaint(previous, HOVER_COLOR);
    this.#repaint(index, SELECT_COLOR);
  }

  hover(index) {
    if (this.hovered === index) return;
    const previous = this.hovered;
    this.hovered = index;
    if (previous >= 0 && previous !== this.selected) this.#repaint(previous, null);
    if (index >= 0 && index !== this.selected) this.#repaint(index, HOVER_COLOR);
  }

  /** Sichtbarkeit je Gebäude (Zeitachse, Filter): baut die Indexliste ohne ausgeblendete Gebäude neu. */
  applyFilter(predicate) {
    const { table, count } = this.data;
    const target = this.geometry.index.array;
    let cursor = 0;
    for (let b = 0; b < count; b++) {
      const visible = predicate ? predicate(this.records[b], b) : true;
      this.visibleMask[b] = visible ? 1 : 0;
      if (!visible) continue;
      const from = table[b * 4 + 2], length = table[b * 4 + 3];
      target.set(this.fullIndices.subarray(from, from + length), cursor);
      cursor += length;
    }
    this.geometry.index.needsUpdate = true;
    this.geometry.setDrawRange(0, cursor);
    return this.visibleMask.reduce((sum, v) => sum + v, 0);
  }

  /** Schnellster Treffer entlang eines Strahls: AABB-Vorfilter, dann Dreiecke der Kandidaten. */
  pick(ray) {
    const { table, positions, indices, count } = this.data;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const candidates = [];
    for (let b = 0; b < count; b++) {
      if (!this.visibleMask[b]) continue;
      const o = b * 6;
      box.min.set(this.bounds[o], this.bounds[o + 1], this.bounds[o + 2]);
      box.max.set(this.bounds[o + 3], this.bounds[o + 4], this.bounds[o + 5]);
      if (ray.intersectBox(box, hit)) candidates.push([ray.origin.distanceTo(hit), b]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
    let best = null;
    for (const [boxDistance, index] of candidates) {
      if (best && boxDistance > best.distance) break;
      const first = table[index * 4 + 2], last = first + table[index * 4 + 3];
      for (let k = first; k < last; k += 3) {
        a.fromArray(positions, indices[k] * 3);
        b2.fromArray(positions, indices[k + 1] * 3);
        c.fromArray(positions, indices[k + 2] * 3);
        if (ray.intersectTriangle(a, b2, c, false, hit)) {
          const distance = ray.origin.distanceTo(hit);
          if (!best || distance < best.distance) best = { index, distance, point: hit.clone() };
        }
      }
    }
    return best;
  }

  stats() {
    return { buildings: this.data.count, triangles: this.data.indexCount / 3, vertices: this.data.vertexCount };
  }
}
