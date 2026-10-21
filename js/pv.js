// Photovoltaik auf Hausdächern: Anlagen aus dem BFE-Register (pv.json), Module als simulierte Belegung der Dachflächen.
// Gemessen ist nur Standort, Leistung, Jahr, Kategorie und teils Ausrichtung/Neigung. Modulzahl und Lage sind eine Simulation.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";

export const MODULE = { length: 1.75, width: 1.05, thickness: 0.04 };
const MODULE_AREA = MODULE.length * MODULE.width;
const UP = new THREE.Vector3(0, 1, 0);
const FLAT_SLOPE_DEG = 6;
const FLAT_TILT = THREE.MathUtils.degToRad(12);
const COPLANAR_COS = Math.cos(THREE.MathUtils.degToRad(4));
const COPLANAR_DISTANCE = 0.35;
const AZIMUTH = { 1: 0, 2: 45, 3: 90, 4: 135, 5: 180, 6: 225, 7: 270, 8: 315 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const angleDifference = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Nennleistung eines Moduls der Abmessung 1.75 × 1.05 m, je nach Baujahr der Anlage (Wirkungsgrad 13 bis 21.5 %). */
export const moduleWatt = (year) => Math.round(MODULE_AREA * 1000 * clamp(0.13 + ((year ?? 2015) - 2007) * 0.005, 0.13, 0.215));

/** Dachflächen eines Gebäudes aus buildings3d.bin: Normale, Fläche, Schwerpunkt, Dreiecke (lokale Koordinaten). */
export function extractRoofFaces(data, building) {
  const { table, faces, surfaces, positions, indices } = data;
  const [vertexStart, vertexCount, indexStart, indexCount, faceStart, faceCount] = table.subarray(building * 6, building * 6 + 6);
  const faceOfVertex = new Int32Array(vertexCount).fill(-1);
  const roof = new Uint8Array(faceCount);
  for (let f = 0, v = 0; f < faceCount; f++) {
    const size = faces[faceStart + f];
    for (let k = 0; k < size; k++) faceOfVertex[v + k] = f;
    roof[f] = surfaces[vertexStart + v] === 1 ? 1 : 0;
    v += size;
  }
  const buckets = Array.from({ length: faceCount }, () => []);
  for (let i = indexStart; i < indexStart + indexCount; i += 3) {
    const f = faceOfVertex[indices[i] - vertexStart];
    if (f >= 0 && roof[f]) buckets[f].push(i);
  }
  const point = (index) => new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
  // swissBUILDINGS3D liefert Dächer als einzelne Dreiecke: gleich geneigte, auf derselben Ebene liegende Flächen werden zusammengefasst.
  const clusters = [];
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const normal = new THREE.Vector3(), centroid = new THREE.Vector3(), tris = [];
    let area = 0;
    for (const i of bucket) {
      const [a, b, c] = [point(indices[i]), point(indices[i + 1]), point(indices[i + 2])];
      const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const triArea = cross.length() / 2;
      normal.add(cross);
      centroid.addScaledVector(a.clone().add(b).add(c), triArea / 3);
      area += triArea;
      tris.push([a, b, c]);
    }
    if (area < 1e-6 || normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    if (normal.y < 0.2) continue;
    centroid.multiplyScalar(1 / area);
    const match = clusters.find((c) => c.normal.dot(normal) > COPLANAR_COS && Math.abs(c.normal.dot(centroid) - c.normal.dot(c.centroid)) < COPLANAR_DISTANCE);
    if (match) {
      const total = match.area + area;
      match.centroid.multiplyScalar(match.area / total).addScaledVector(centroid, area / total);
      match.normal.multiplyScalar(match.area / total).addScaledVector(normal, area / total).normalize();
      match.area = total;
      match.tris.push(...tris);
    } else clusters.push({ normal, centroid, area, tris });
  }
  return clusters.map(({ normal, centroid, area, tris }) => {
    const slope = THREE.MathUtils.radToDeg(Math.acos(clamp(normal.y, -1, 1)));
    const flat = slope < FLAT_SLOPE_DEG;
    return { normal, centroid, area, tris, slope, flat, azimuth: flat ? null : (THREE.MathUtils.radToDeg(Math.atan2(normal.x, -normal.z)) + 360) % 360 };
  });
}

function inTriangle(p, t) {
  const [a, b, c] = t;
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return false;
  const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6;
}

/** Koordinatensystem für Module auf einer Dachfläche; `landscape` legt die lange Modulseite quer zur Gefällerichtung. */
function frameFor(face, facingAzimuth, landscape) {
  const lengthB = landscape ? MODULE.width : MODULE.length; // Modullänge in Richtung B (Gefälle bzw. Blickrichtung)
  const widthA = landscape ? MODULE.length : MODULE.width; // Modulbreite in Richtung A (quer)
  let X, Y, Z, axisA, axisB, extra;
  if (!face.flat) {
    const down = new THREE.Vector3(face.normal.x, 0, face.normal.z).normalize();
    const along = down.clone().addScaledVector(face.normal, -down.dot(face.normal)).normalize();
    const across = new THREE.Vector3().crossVectors(along, face.normal);
    [X, Y, Z, axisA, axisB] = [along, face.normal.clone(), across, across, along];
    extra = { pitchB: lengthB + 0.03, halfB: lengthB / 2, margin: 0.3, standoff: 0.17, sloped: true };
  } else {
    const az = THREE.MathUtils.degToRad(facingAzimuth);
    const facing = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
    Y = facing.clone().multiplyScalar(Math.sin(FLAT_TILT)).addScaledVector(UP, Math.cos(FLAT_TILT));
    X = facing.clone().multiplyScalar(Math.cos(FLAT_TILT)).addScaledVector(UP, -Math.sin(FLAT_TILT));
    Z = new THREE.Vector3().crossVectors(X, Y);
    [axisA, axisB] = [Z.clone().setY(0).normalize(), facing];
    extra = { pitchB: lengthB * Math.cos(FLAT_TILT) + 0.95, halfB: lengthB * Math.cos(FLAT_TILT) / 2, margin: 0.6, standoff: 0.25 + (lengthB / 2) * Math.sin(FLAT_TILT), sloped: false };
  }
  if (landscape) { const longAxis = Z.clone(); Z = new THREE.Vector3().crossVectors(longAxis, Y); X = longAxis; }
  return { X, Y, Z, axisA, axisB, pitchA: widthA + 0.03, halfA: widthA / 2, landscape, ...extra };
}

function layoutCells(face, frame) {
  const toPlane = (p) => [p.dot(frame.axisA), p.dot(frame.axisB)];
  const tris = face.tris.map((t) => t.map(toPlane));
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const t of tris) for (const [a, b] of t) { minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, b); maxB = Math.max(maxB, b); }
  const [centreA, centreB] = toPlane(face.centroid);
  const { halfA, halfB } = frame, grow = 0.12;
  const inside = (p) => tris.some((t) => inTriangle(p, t));
  const cells = [];
  for (let b = maxB - frame.margin - halfB; b >= minB + frame.margin + halfB - 1e-6; b -= frame.pitchB) {
    for (let a = minA + frame.margin + halfA; a <= maxA - frame.margin - halfA + 1e-6; a += frame.pitchA) {
      const hx = halfA + grow, hy = halfB + grow;
      const probes = [[a, b], [a - hx, b - hy], [a + hx, b - hy], [a - hx, b + hy], [a + hx, b + hy], [a, b - hy], [a, b + hy], [a - hx, b], [a + hx, b]];
      if (!probes.every(inside)) continue;
      const position = face.centroid.clone().addScaledVector(frame.axisA, a - centreA);
      if (frame.sloped) position.addScaledVector(frame.axisB, b - centreB).addScaledVector(face.normal, frame.standoff);
      else {
        position.addScaledVector(frame.axisB, b - centreB);
        position.y = face.centroid.y - (face.normal.x * (position.x - face.centroid.x) + face.normal.z * (position.z - face.centroid.z)) / face.normal.y + frame.standoff;
      }
      // Reihen von der Flächenmitte nach aussen, innerhalb der Reihe von der Mitte: ergibt zusammenhängende, rechteckige Felder.
      cells.push({ a, b, position, used: false, sortKey: Math.abs(Math.round((b - centreB) / frame.pitchB)) * 1000 + Math.abs(a - centreA) });
    }
  }
  cells.sort((x, y) => x.sortKey - y.sortKey);
  return cells;
}

/** Mögliche Modulplätze (ohne Überlappung, mit Randabstand) auf einer Dachfläche; wählt Hoch- oder Querformat mit mehr Plätzen. */
function candidatesFor(face, facingAzimuth) {
  const key = face.flat ? Math.round(facingAzimuth) : "s";
  face.cache ??= new Map();
  if (face.cache.has(key)) return face.cache.get(key);
  let best = null;
  for (const landscape of [false, true]) {
    const frame = frameFor(face, facingAzimuth, landscape);
    const cells = layoutCells(face, frame);
    if (!best || cells.length > best.cells.length) best = { cells, frame };
  }
  face.cache.set(key, best);
  return best;
}

/** Eignung einer Dachfläche für einen Anlagenteil: Ausrichtung (wenn bekannt, sonst Süden) und Neigung. */
function suitability(face, part) {
  const orientation = part.orient;
  if (orientation === 9) return face.flat ? 1 : 0.15;
  const target = AZIMUTH[orientation] ?? 180;
  let score = face.flat ? 0.8 : (1 - angleDifference(face.azimuth, target) / 180) ** 2;
  if (part.incl != null && !face.flat) score *= 1 - Math.min(1, Math.abs(face.slope - part.incl) / 40) * 0.4;
  if (part.incl != null && part.incl > 25 && face.flat) score *= 0.6;
  return score;
}

/**
 * Belegt die Dachflächen eines Gebäudes mit Modulen. Rückgabe: Matrizen je Modul, angefragte und platzierte Modulzahl.
 * Die Zahl ergibt sich aus der registrierten Leistung und der Modulleistung des Inbetriebnahmejahres.
 */
export function layoutModules(faces, plant) {
  const usable = faces.filter((f) => f.area >= 5);
  const parts = plant.parts?.length ? plant.parts.map(([kw, incl, orient, year]) => ({ kw, incl, orient, year: year ?? plant.year })) : [{ kw: plant.kw, incl: null, orient: null, year: plant.year }];
  const modules = [];
  let requested = 0, placed = 0;
  let facadeKw = 0;
  for (const part of parts) {
    if (part.incl != null && part.incl >= 60) { facadeKw += part.kw; continue; } // Fassadenanlage: nicht auf dem Dach
    const want = Math.max(1, Math.round((part.kw * 1000) / moduleWatt(part.year)));
    requested += want;
    const knownTarget = part.orient != null && part.orient !== 9;
    const minimum = part.orient == null ? 0.12 : 0;
    const ranked = usable.map((face) => ({ face, score: suitability(face, part) })).filter((r) => r.score > minimum)
      .sort((a, b) => (b.score + Math.min(b.face.area, 200) / 4000) - (a.score + Math.min(a.face.area, 200) / 4000));
    let remaining = want;
    for (const { face } of ranked) {
      if (remaining <= 0) break;
      const facing = knownTarget ? AZIMUTH[part.orient] : 180;
      const { cells, frame } = candidatesFor(face, facing);
      for (const cell of cells) {
        if (remaining <= 0) break;
        if (cell.used) continue;
        cell.used = true;
        const standoffAdjust = plant.cat === "integriert" && frame.sloped ? -0.14 : 0;
        const position = cell.position.clone().addScaledVector(face.normal, standoffAdjust);
        modules.push(new THREE.Matrix4().makeBasis(frame.X, frame.Y, frame.Z).setPosition(position));
        remaining--; placed++;
      }
    }
  }
  return { modules, requested, placed, facadeKw };
}

// --- Darstellung --------------------------------------------------------------------------------------------------------

function moduleTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 308;
  const g = canvas.getContext("2d");
  const blue = kind === "poly";
  g.fillStyle = kind === "integrated" ? "#15181d" : blue ? "#9aa6b2" : "#b9c0c7";
  g.fillRect(0, 0, 512, 308);
  const frame = kind === "integrated" ? 3 : 9, cols = 10, rows = 6;
  const cellWidth = (512 - 2 * frame) / cols, cellHeight = (308 - 2 * frame) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = frame + c * cellWidth, y = frame + r * cellHeight;
    const gradient = g.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
    if (blue) { gradient.addColorStop(0, "#1c3f86"); gradient.addColorStop(1, "#163266"); }
    else { gradient.addColorStop(0, "#0d1220"); gradient.addColorStop(1, "#070a14"); }
    g.fillStyle = gradient;
    g.fillRect(x + 1.5, y + 1.5, cellWidth - 3, cellHeight - 3);
    if (!blue) { // monokristalline Zellen mit abgeschnittenen Ecken
      g.fillStyle = "#b9c0c7";
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        g.beginPath();
        const cx = x + 1.5 + dx * (cellWidth - 3), cy = y + 1.5 + dy * (cellHeight - 3), s = 5;
        g.moveTo(cx, cy + (dy ? -s : s)); g.lineTo(cx + (dx ? -s : s), cy); g.lineTo(cx, cy); g.closePath(); g.fill();
      }
    }
    g.strokeStyle = blue ? "rgba(200,215,240,0.28)" : "rgba(170,185,215,0.2)";
    g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { const bx = x + (cellWidth * k) / 4; g.beginPath(); g.moveTo(bx, y + 2); g.lineTo(bx, y + cellHeight - 2); g.stroke(); }
    if (blue) { g.strokeStyle = "rgba(180,200,240,0.07)"; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x + 2, y + 4 + k * 7); g.lineTo(x + cellWidth - 2, y + 4 + k * 7); g.stroke(); } }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Einfache Himmelsumgebung für Spiegelungen im Modulglas (nur für Module, nicht für die ganze Szene). */
function skyEnvironment(renderer) {
  const geometry = new THREE.SphereGeometry(50, 32, 16);
  const colors = [], position = geometry.getAttribute("position");
  const horizon = new THREE.Color("#e6eef5"), zenith = new THREE.Color("#4f86c6"), ground = new THREE.Color("#5d6158");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 50;
    const c = y >= 0 ? horizon.clone().lerp(zenith, Math.pow(y, 0.55)) : ground.clone().lerp(horizon, Math.pow(1 + y, 6));
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.02);
  generator.dispose();
  return target.texture;
}

function moduleGeometry() {
  return new THREE.BoxGeometry(MODULE.length, MODULE.thickness, MODULE.width).translate(0, MODULE.thickness / 2, 0);
}

export async function initPv(ctx) {
  const { scene3d, buildings, layers, sky } = ctx;
  const file = await loadOptionalJson("pv.json");
  const plants = file?.plants ?? [];
  const byBuilding = new Map();
  ctx.pv = { plants, byBuilding, file };
  if (!buildings || !plants.length) {
    layers.add({ id: "pv", label: "Photovoltaik", color: "#2b4c9b", available: false, note: "pv.json fehlt (Pipeline: python -m pipeline.run_all pv)" });
    return;
  }

  const placements = { poly: [], mono: [], integrated: [] };
  const faceCache = new Map();
  for (const plant of plants) {
    if (plant.cat === "freistehend") { byBuilding.set(plant.b, [...(byBuilding.get(plant.b) ?? []), { plant, placed: 0, requested: 0, onRoof: false }]); continue; }
    if (!faceCache.has(plant.b)) faceCache.set(plant.b, extractRoofFaces(buildings.data, plant.b));
    const result = layoutModules(faceCache.get(plant.b), plant);
    const kind = plant.cat === "integriert" ? "integrated" : (plant.year ?? 2020) < 2013 ? "poly" : "mono";
    placements[kind].push(...result.modules);
    byBuilding.set(plant.b, [...(byBuilding.get(plant.b) ?? []), { plant, placed: result.placed, requested: result.requested, onRoof: true, facadeKw: result.facadeKw }]);
  }

  const environment = (() => { try { return skyEnvironment(scene3d.renderer); } catch { return null; } })();
  const group = new THREE.Group();
  group.name = "photovoltaics";
  const materials = [];
  const frameMaterial = (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.38 });
  for (const [kind, matrices] of Object.entries(placements)) {
    if (!matrices.length) continue;
    const glass = new THREE.MeshPhysicalMaterial({
      map: moduleTexture(kind), roughness: 0.2, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05,
      envMap: environment, envMapIntensity: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const frame = frameMaterial(kind === "integrated" ? 0x1b1f25 : 0xaab0b6);
    const back = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.8 });
    materials.push(glass);
    const mesh = new THREE.InstancedMesh(moduleGeometry(), [frame, frame, glass, back, frame, frame], matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `pv-${kind}`;
    group.add(mesh);
  }
  scene3d.scene.add(group);

  let layerOn = true;
  scene3d.onFrame((_, __, distance) => {
    group.visible = layerOn && distance < 2200;
    const day = sky.state.dayFactor ?? 1;
    const intensity = 0.08 + 1.1 * day * (1 - 0.65 * (sky.state.cloudCover ?? 0));
    for (const material of materials) material.envMapIntensity = intensity;
  });

  const inMunicipality = plants.filter((p) => ctx.records[p.b]?.inMunicipality);
  layers.add({
    id: "pv", label: "Photovoltaik (BFE-Register)", color: "#2b4c9b", count: `${inMunicipality.length} Anlagen`,
    note: "pv.json fehlt", apply: (v) => { layerOn = v; group.visible = v; },
  });
  ctx.pv.summary = {
    plants: inMunicipality.length, kw: inMunicipality.reduce((s, p) => s + p.kw, 0),
    buildings: new Set(inMunicipality.map((p) => p.b)).size,
    modules: Object.values(placements).reduce((s, m) => s + m.length, 0),
  };
}
