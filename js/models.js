// Kleiner prozeduraler Baukasten: Haltestellen, Laternen und Fahrzeuge als zusammengeführte Geometrien mit Vertexfarben.
// Konvention: Meter, Ursprung am Boden, vorne = +z, Länge von Haltestellenmodellen entlang x.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const unit = new THREE.Vector3(1, 1, 1);

function paint(geometry, hex, [x, y, z], [rx, ry, rz]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute("uv");
  quaternion.setFromEuler(euler.set(rx, ry, rz));
  g.applyMatrix4(matrix.compose(new THREE.Vector3(x, y, z), quaternion, unit));
  const color = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

const box = (w, h, d, hex, x = 0, y = 0, z = 0, r = [0, 0, 0]) => paint(new THREE.BoxGeometry(w, h, d), hex, [x, y + h / 2, z], r);
const cylinder = (rTop, rBottom, h, segments, hex, x = 0, y = 0, z = 0, r = [0, 0, 0]) => paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments), hex, [x, y + h / 2, z], r);
const build = (parts) => { const g = mergeGeometries(parts); g.computeBoundingSphere(); return g; };

const GREY = "#6e7378", DARK = "#2a2e32", GLASS = "#a9c4d1", WOOD = "#8b6a47", YELLOW = "#f5c400", CONCRETE = "#b9b8b3";

// --- Haltestellen -------------------------------------------------------------

function timetable(x, z) {
  return [box(0.5, 0.72, 0.04, "#f4f4f1", x, 1.2, z), box(0.5, 0.12, 0.05, YELLOW, x, 1.8, z + 0.005)];
}

/** Schweizer Haltestellenmast: gelbe Scheibe mit schwarzem H, Fahrplantafel; Buskante. Optional Wartehäuschen und Bank. */
export function busStop({ shelter = false, bench = false } = {}) {
  const parts = [
    box(12, 0.16, 0.7, CONCRETE, 0, 0, 0.35),
    cylinder(0.04, 0.04, 3.3, 6, GREY, -2.6, 0.16, 0.3),
    paint(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), YELLOW, [-2.6, 3.25, 0.34], [Math.PI / 2, 0, 0]),
    box(0.07, 0.36, 0.02, "#111", -2.72, 3.07, 0.37), box(0.07, 0.36, 0.02, "#111", -2.48, 3.07, 0.37), box(0.25, 0.07, 0.02, "#111", -2.6, 3.21, 0.37),
    ...timetable(-2.6, 0.38),
  ];
  if (shelter) {
    for (const x of [-1.9, 1.9]) parts.push(box(0.08, 2.4, 0.08, DARK, x, 0.16, 0.9), box(0.08, 2.4, 0.08, DARK, x, 0.16, -0.5));
    parts.push(
      box(4.2, 0.1, 1.9, "#3a4047", 0, 2.56, 0.2),
      box(3.8, 1.9, 0.03, GLASS, 0, 0.5, -0.5), box(0.03, 1.9, 1.35, GLASS, -1.9, 0.5, 0.2), box(0.03, 1.9, 1.35, GLASS, 1.9, 0.5, 0.2),
      ...timetable(1.0, -0.45),
    );
  }
  if (bench || shelter) parts.push(box(2.2, 0.06, 0.4, WOOD, shelter ? 0 : 1.2, 0.5, shelter ? -0.2 : 0.2), box(0.06, 0.34, 0.34, DARK, shelter ? -0.9 : 0.3, 0.16, shelter ? -0.2 : 0.2), box(0.06, 0.34, 0.34, DARK, shelter ? 0.9 : 2.1, 0.16, shelter ? -0.2 : 0.2));
  return build(parts);
}

/** Bahnsteig mit Kante, Überdachung, Uhr und Namensschild; Länge 80 m entlang x, Gleis vorne (+z). */
export function trainPlatform() {
  const parts = [box(80, 0.9, 3.2, "#aeb1b4", 0, 0, 0), box(80, 0.02, 0.25, YELLOW, 0, 0.9, 1.35)];
  for (const x of [-26, 0, 26]) {
    parts.push(box(24, 0.15, 2.6, "#2e3338", x, 3.6, -0.2));
    for (const dx of [-10, 0, 10]) parts.push(box(0.2, 2.7, 0.2, GREY, x + dx, 0.9, -1.2));
  }
  for (const x of [-30, 30]) parts.push(cylinder(0.05, 0.05, 2.6, 6, GREY, x, 0.9, 0.2), box(2.2, 0.45, 0.06, DARK, x, 3.0, 0.2), box(1.9, 0.3, 0.07, "#f4f4f1", x, 3.08, 0.2));
  parts.push(box(2.4, 0.06, 0.45, WOOD, 6, 1.35, -1.0), box(2.4, 0.06, 0.45, WOOD, -12, 1.35, -1.0));
  return build(parts);
}

/** Schiffsteg aus Holz mit Pfählen, Geländer und Kassenhäuschen; Steg entlang +z, ca. 22 m. */
export function ferryPier() {
  const parts = [box(3.6, 0.22, 22, WOOD, 0, 0.5, 11)];
  for (let z = 1; z <= 21; z += 4) for (const x of [-1.6, 1.6]) parts.push(cylinder(0.14, 0.16, 3, 6, "#4a3b2e", x, -1.6, z), box(0.06, 1.0, 0.06, GREY, x, 0.72, z));
  for (const x of [-1.6, 1.6]) parts.push(box(0.05, 0.05, 20, GREY, x, 1.62, 11));
  parts.push(box(3.2, 2.4, 3.4, "#f1efe8", 0, 0.72, 2.4), box(3.6, 0.15, 3.8, "#8a2f25", 0, 3.1, 2.4), box(1.2, 0.9, 0.04, GLASS, 0, 1.6, 4.12));
  parts.push(cylinder(0.05, 0.05, 3.2, 6, GREY, 1.4, 0.72, 20), box(1.8, 0.4, 0.06, DARK, 1.4, 3.7, 20));
  return build(parts);
}

// --- Strassenlaternen -----------------------------------------------------------

export const streetLampPole = () => build([cylinder(0.06, 0.1, 6.2, 6, "#55595e", 0, 0, 0), box(0.08, 0.08, 1.4, "#55595e", 0, 6.15, 0.65)]);
export const streetLampHead = () => build([box(0.34, 0.1, 0.7, "#fff1c9", 0, 6.05, 1.25)]);

// --- Fahrzeuge ------------------------------------------------------------------

function sideWindows(x, y, h, z0, z1, count, hex) {
  const parts = [], step = (z1 - z0) / count, width = step * 0.82;
  for (let i = 0; i < count; i++) parts.push(box(0.03, h, width, hex, x, y, z0 + step * (i + 0.5)));
  return parts;
}

/** Postauto-Solobus, 12 m. */
export function postBus() {
  const parts = [box(2.55, 1.15, 11.9, "#ffcc00", 0, 0.55, 0), box(2.5, 1.55, 11.8, "#ffcc00", 0, 1.7, 0), box(2.58, 0.18, 11.95, "#222", 0, 0.5, 0)];
  for (const sx of [-1.26, 1.26]) parts.push(...sideWindows(sx, 2.0, 0.95, -5.4, 5.2, 8, "#1d2b36"));
  parts.push(box(2.3, 1.1, 0.03, "#1d2b36", 0, 1.95, 5.93), box(2.3, 0.8, 0.03, "#1d2b36", 0, 2.0, -5.93), box(1.8, 0.3, 2.6, "#d9dcde", 0, 3.25, -1),
    box(0.03, 1.7, 1.1, "#2a3a47", 1.27, 1.2, 3.2), box(0.8, 0.14, 0.03, "#111", 0, 1.35, 5.95), box(0.5, 0.2, 0.03, "#fff6c9", 0.9, 0.8, 5.95), box(0.5, 0.2, 0.03, "#fff6c9", -0.9, 0.8, 5.95));
  for (const x of [-1.2, 1.2]) for (const z of [3.9, -3.2]) parts.push(cylinder(0.5, 0.5, 0.32, 14, "#1b1b1b", x, 0, z, [0, 0, Math.PI / 2]));
  return build(parts);
}

/** S-Bahn-Triebzug (weiss mit rotem Band), `cars` Wagen à 25.5 m, Spitze bei +z. */
export function sbbTrain(cars = 3) {
  const parts = [], pitch = 25.7, total = cars * pitch;
  for (let c = 0; c < cars; c++) {
    const z0 = total / 2 - pitch * (c + 0.5);
    parts.push(box(2.9, 2.7, 25.2, "#f0f0ee", 0, 1.0, z0), box(2.93, 0.5, 25.25, "#d3001f", 0, 1.45, z0), box(2.5, 0.22, 24.4, "#9ea3a7", 0, 3.7, z0));
    for (const sx of [-1.46, 1.46]) parts.push(...sideWindows(sx, 2.2, 0.95, z0 - 11.4, z0 + 11.4, 7, "#1a2833"), box(0.03, 2.0, 1.3, "#b81e2a", sx, 1.0, z0 + (c % 2 ? 6 : -6)));
    for (const dz of [-8.5, 8.5]) parts.push(box(2.6, 0.55, 3.0, DARK, 0, 0.35, z0 + dz));
  }
  parts.push(box(2.5, 1.0, 0.03, "#1a2833", 0, 2.45, total / 2 + 0.03), box(0.4, 0.2, 0.03, "#fff6c9", 0.9, 1.2, total / 2 + 0.03), box(0.4, 0.2, 0.03, "#fff6c9", -0.9, 1.2, total / 2 + 0.03),
    box(0.06, 0.5, 2.0, DARK, 0, 3.85, total / 2 - 8), box(0.9, 0.05, 0.06, DARK, 0, 4.4, total / 2 - 8));
  return build(parts);
}

/** Kursschiff (Motorschiff, ca. 46 m); Ursprung auf Wasserlinie, Bug bei +z. */
export function lakeShip() {
  const outline = [[-4.6, -17], [-4.6, 12], [-3.4, 19], [0, 23.5], [3.4, 19], [4.6, 12], [4.6, -17]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const hull = (depth, hex, y, scale = 1) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.scale(scale, 1, scale);
    return paint(g, hex, [0, y, 0], [0, 0, 0]);
  };
  const parts = [hull(0.9, "#7e2a24", -0.9), hull(1.3, "#f4f4f2", 0), box(7.8, 2.3, 30, "#f4f4f2", 0, 1.3, -2), box(6.8, 2.1, 20, "#f4f4f2", 0, 3.6, -3), box(5.4, 2.2, 5.4, "#f4f4f2", 0, 5.7, 5),
    box(7.6, 0.18, 29, "#c9c9c4", 0, 3.55, -2), box(6.6, 0.18, 19, "#c9c9c4", 0, 5.65, -3), box(5.6, 0.16, 5.6, "#8a2f25", 0, 7.9, 5), cylinder(0.9, 1.05, 3.2, 12, "#b02a1d", 0, 5.7, -9), cylinder(0.92, 0.92, 0.4, 12, "#1a1a1a", 0, 8.9, -9),
    cylinder(0.06, 0.06, 4, 6, GREY, 0, 7.9, 6)];
  for (const sx of [-3.95, 3.95]) parts.push(...sideWindows(sx, 2.1, 1.0, -15, 11, 12, "#1a2833"), ...sideWindows(sx - Math.sign(sx) * 0.55, 4.3, 0.9, -11, 5, 9, "#1a2833"));
  parts.push(box(5.0, 1.0, 0.03, "#1a2833", 0, 6.3, 7.72));
  return build(parts);
}

export const MODEL_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide });

const cache = new Map();
export function model(name, ...args) {
  const key = `${name}:${args.map((a) => JSON.stringify(a)).join(",")}`;
  if (!cache.has(key)) cache.set(key, { busStop, trainPlatform, ferryPier, streetLampPole, streetLampHead, postBus, sbbTrain, lakeShip }[name](...args));
  return cache.get(key);
}
