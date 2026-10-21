// Simulierter Alltag (nur bei Boden «Simulation»): Autos auf den Strassen, Personen auf Wegen und Trottoirs.
// Symbolisch: Es gibt keine Verkehrs- oder Personenzahlen. Dichte und Wege sind Annahmen (Strassenklasse, Bebauung in der Nähe).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, cylinder } from "./models.js";
import { walk, ROAD_WIDTH } from "./roadmarks.js";

const CAR_CLASSES = { primary: { speed: 14, weight: 1 }, secondary: { speed: 12, weight: 0.9 }, tertiary: { speed: 10, weight: 0.8 }, minor: { speed: 8.5, weight: 0.5 }, service: { speed: 5, weight: 0.2 } };
const SIDEWALK_CLASSES = ["primary", "secondary", "tertiary", "minor"];
const CAR_MAX = 260, PED_MAX = 320;
const ACTIVE_DISTANCE = 1400;
const nodeKey = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;

// --- Netz und Bewegung (rein, ohne three.js) ---------------------------------------------------------------------------

/** `lines`: [{ p: flache Polylinie, cls, oneway? (+1/-1 entlang der Punktfolge) }] -> Netz mit Laufmetern und Knoten. */
export function buildNetwork(lines) {
  const out = [];
  for (const line of lines) {
    const n = line.p.length / 2;
    if (n < 2) continue;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(line.p[2 * i] - line.p[2 * i - 2], line.p[2 * i + 1] - line.p[2 * i - 1]);
    if (cum[n - 1] < 3) continue;
    out.push({ id: out.length, p: line.p, n, cum, total: cum[n - 1], cls: line.cls, oneway: line.oneway ?? 0, closed: n > 2 && line.p[0] === line.p[2 * n - 2] && line.p[1] === line.p[2 * n - 1] });
  }
  const nodes = new Map();
  for (const line of out) for (let i = 0; i < line.n; i++) {
    const key = nodeKey(line.p[2 * i], line.p[2 * i + 1]);
    if (!nodes.has(key)) nodes.set(key, []);
    nodes.get(key).push({ line, index: i });
  }
  return { lines: out, nodes };
}

const segmentLength = (line, seg) => line.cum[seg + 1] - line.cum[seg];

function enter(agent, line, vertex, random) {
  const last = line.n - 1;
  agent.line = line;
  agent.dir = line.oneway || (vertex === 0 ? 1 : vertex === last ? -1 : random() < 0.5 ? 1 : -1);
  agent.seg = Math.min(last - 1, Math.max(0, agent.dir > 0 ? vertex : vertex - 1));
  const len = segmentLength(line, agent.seg);
  agent.t = agent.dir > 0 ? (vertex >= last ? len : 0) : (vertex <= 0 ? 0 : len);
}

/**
 * Bewegt einen Agenten um `distance` Meter. An Knoten kann er abbiegen, an Enden wählt er eine Anschlusslinie.
 * Rückgabe false: Sackgasse ohne Wendemöglichkeit (`bounce` false), der Agent muss neu gesetzt werden.
 */
export function advance(agent, distance, net, random = Math.random, { turn = 0.35, bounce = false } = {}) {
  let remaining = distance;
  for (let guard = 0; remaining > 0 && guard < 60; guard++) {
    const line = agent.line, len = segmentLength(line, agent.seg);
    const room = agent.dir > 0 ? len - agent.t : agent.t;
    if (remaining < room) { agent.t += agent.dir * remaining; return true; }
    remaining -= room;
    const vertex = agent.dir > 0 ? agent.seg + 1 : agent.seg, last = line.n - 1;
    const atEnd = vertex === 0 || vertex === last;
    const options = (net.nodes.get(nodeKey(line.p[2 * vertex], line.p[2 * vertex + 1])) ?? []).filter((o) => o.line !== line);
    if (options.length && (atEnd || random() < turn)) { const pick = options[Math.floor(random() * options.length)]; enter(agent, pick.line, pick.index, random); continue; }
    if (!atEnd) { agent.seg += agent.dir; agent.t = agent.dir > 0 ? 0 : segmentLength(line, agent.seg); continue; }
    if (line.closed) {
      if (vertex === last) { agent.seg = 0; agent.t = 0; } else { agent.seg = last - 1; agent.t = segmentLength(line, agent.seg); }
      continue;
    }
    if (bounce) { agent.dir = -agent.dir; agent.t = agent.dir > 0 ? 0 : len; continue; }
    return false;
  }
  return true;
}

/** Position und Fahrtrichtung (Einheitsvektor) des Agenten. */
export function sample(agent, out = {}) {
  const { p } = agent.line, i = agent.seg * 2;
  const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], length = Math.hypot(dx, dz) || 1, f = agent.t / length;
  out.x = p[i] + dx * f; out.z = p[i + 1] + dz * f;
  out.tx = (dx / length) * agent.dir; out.tz = (dz / length) * agent.dir;
  return out;
}

const loopDirection = (p) => {
  let area = 0;
  for (let i = 0; i + 3 < p.length; i += 2) area += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
  // Rechtsverkehr: Kreisel gegen den Uhrzeigersinn (Kartenansicht, Nord oben); z ist nach Süden gerichtet, daher negative Fläche
  return area < 0 ? 1 : -1;
};

// --- Modelle -------------------------------------------------------------------------------------------------------------

function tag(parts, tint, glow = 0) {
  return parts.map((g) => {
    const n = g.attributes.position.count;
    g.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
    g.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    return g;
  });
}

const GLASS_DARK = "#1b2631", LIGHT = "#fff1c4", TAIL = "#d41919", WHITE = "#ffffff", TIRE = "#1d1f22";

function carGeometry({ length, width, bodyHeight, cabinLength, cabinHeight, cabinShift }) {
  const wheelZ = length * 0.32, wheelX = width / 2 - 0.1;
  const parts = [
    ...tag([box(width, bodyHeight, length, WHITE, 0, 0.3, 0), box(width - 0.2, cabinHeight, cabinLength, WHITE, 0, 0.3 + bodyHeight, cabinShift)], 1),
    ...tag([box(width - 0.14, cabinHeight * 0.62, cabinLength + 0.05, GLASS_DARK, 0, 0.3 + bodyHeight + cabinHeight * 0.18, cabinShift)], 0),
    ...tag([cylinder(0.32, 0.32, 0.24, 10, TIRE, wheelX, 0, wheelZ, [0, 0, Math.PI / 2]), cylinder(0.32, 0.32, 0.24, 10, TIRE, -wheelX, 0, wheelZ, [0, 0, Math.PI / 2]),
      cylinder(0.32, 0.32, 0.24, 10, TIRE, wheelX, 0, -wheelZ, [0, 0, Math.PI / 2]), cylinder(0.32, 0.32, 0.24, 10, TIRE, -wheelX, 0, -wheelZ, [0, 0, Math.PI / 2])].map((g) => g.translate(0, 0, 0)), 0),
    ...tag([box(0.34, 0.12, 0.06, LIGHT, 0.55, 0.58, length / 2), box(0.34, 0.12, 0.06, LIGHT, -0.55, 0.58, length / 2)], 0, 1),
    ...tag([box(0.34, 0.12, 0.06, TAIL, 0.55, 0.62, -length / 2), box(0.34, 0.12, 0.06, TAIL, -0.55, 0.62, -length / 2)], 0, 1),
  ];
  return mergeGeometries(parts);
}

const CAR_TYPES = [
  { weight: 0.5, geometry: carGeometry({ length: 4.4, width: 1.8, bodyHeight: 0.6, cabinLength: 2.3, cabinHeight: 0.55, cabinShift: -0.2 }), kind: "limousine" },
  { weight: 0.33, geometry: carGeometry({ length: 3.8, width: 1.7, bodyHeight: 0.62, cabinLength: 2.1, cabinHeight: 0.6, cabinShift: -0.25 }), kind: "kompakt" },
  { weight: 0.17, geometry: carGeometry({ length: 5.3, width: 2.0, bodyHeight: 0.9, cabinLength: 3.6, cabinHeight: 0.85, cabinShift: -0.6 }), kind: "lieferwagen" },
];
const CAR_COLORS = ["#f2f2f0", "#f2f2f0", "#c7cacc", "#8e9397", "#2b2e33", "#1b1d21", "#2f4f7f", "#a8222a", "#355a3c", "#c9b99a", "#e0c24a"].map((c) => new THREE.Color(c));
const PED_COLORS = ["#c0392b", "#2c5aa0", "#2f7a4f", "#e1a83a", "#7b4d9e", "#d9d5cf", "#3b3f45", "#c76b2c", "#4f8fa6", "#8a9a3b"].map((c) => new THREE.Color(c));

function pedestrianGeometry() {
  return mergeGeometries([
    ...tag([box(0.14, 0.82, 0.18, "#2d3345", 0.1, 0, 0), box(0.14, 0.82, 0.18, "#2d3345", -0.1, 0, 0)], 0),
    ...tag([box(0.42, 0.6, 0.24, WHITE, 0, 0.8, 0), box(0.09, 0.56, 0.12, WHITE, 0.26, 0.82, 0), box(0.09, 0.56, 0.12, WHITE, -0.26, 0.82, 0)], 1),
    ...tag([box(0.2, 0.22, 0.2, "#e0b494", 0, 1.4, 0), box(0.215, 0.08, 0.215, "#3a2a1c", 0, 1.56, 0)], 0),
  ]);
}

function tintedMaterial() {
  const uniforms = { uNightGlow: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = "attribute float aTint; attribute float aGlow; varying float vGlow;\n" + shader.vertexShader
      .replace("#include <color_vertex>", "vColor = vec3( 1.0 ); vColor *= color; vColor *= mix( vec3( 1.0 ), instanceColor.xyz, aTint ); vGlow = aGlow;");
    shader.fragmentShader = "varying float vGlow; uniform float uNightGlow;\n" + shader.fragmentShader
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vGlow * vColor.rgb * uNightGlow * 1.6;");
  };
  material.customProgramCacheKey = () => "ambient-v1";
  return { material, uniforms };
}

// --- Szene -----------------------------------------------------------------------------------------------------------------

export function initAmbient(ctx) {
  const { scene3d, terrain, layers, buildings } = ctx;
  const roads = ctx.roads ?? [];
  if (!roads.length) return;

  const carLines = roads.filter((r) => CAR_CLASSES[r.c] && !r.t).map((r) => {
    const closed = r.p.length > 6 && r.p[0] === r.p[r.p.length - 2] && r.p[1] === r.p[r.p.length - 1];
    const roundabout = closed && walk(r.p, 5).length * 5 < 160;
    return { p: r.p, cls: r.c, oneway: roundabout ? loopDirection(r.p) : 0 };
  });
  const carNet = buildNetwork(carLines);

  // Bebauungsdichte (Gebäude je 50 m Zelle): Trottoirs und Personen gibt es nur im Siedlungsgebiet.
  const density = new Map();
  const cellOf = (x, z) => `${Math.floor(x / 50)}:${Math.floor(z / 50)}`;
  if (buildings) for (let i = 0; i < ctx.records.length; i++) {
    const c = buildings.center(i);
    density.set(cellOf(c.x, c.z), (density.get(cellOf(c.x, c.z)) ?? 0) + 1);
  }
  const built = (x, z) => {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) n += density.get(`${Math.floor(x / 50) + dx}:${Math.floor(z / 50) + dz}`) ?? 0;
    return n;
  };
  const walkLines = roads.filter((r) => (r.c === "path" || r.c === "track") && !r.t).map((r) => ({ p: r.p, cls: "path" }));
  for (const road of roads) {
    if (!SIDEWALK_CLASSES.includes(road.c) || road.t) continue;
    const offset = ROAD_WIDTH[road.c] / 2 + 1.1;
    for (const side of [1, -1]) {
      let run = [];
      const flush = () => { if (run.length >= 6) walkLines.push({ p: run.flat(), cls: "sidewalk" }); run = []; };
      for (const s of walk(road.p, 4)) {
        const x = s.x - s.tz * offset * side, z = s.z + s.tx * offset * side;
        if (built(x, z) >= 3) run.push([x, z]); else flush();
      }
      flush();
    }
  }
  const walkNet = buildNetwork(walkLines);

  // Raster für zufällige Startpunkte in Blicknähe
  const gridOf = (net) => {
    const grid = new Map();
    for (const line of net.lines) for (let seg = 0; seg < line.n - 1; seg++) {
      const key = `${Math.floor(line.p[seg * 2] / 80)}:${Math.floor(line.p[seg * 2 + 1] / 80)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push([line, seg]);
    }
    return grid;
  };
  const carGrid = gridOf(carNet), walkGrid = gridOf(walkNet);

  const { material, uniforms } = tintedMaterial();
  const group = new THREE.Group();
  group.name = "ambient";
  const carMeshes = CAR_TYPES.map((type) => {
    const mesh = new THREE.InstancedMesh(type.geometry, material, CAR_MAX);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
    mesh.setColorAt(0, CAR_COLORS[0]);
    group.add(mesh);
    return mesh;
  });
  const pedMesh = new THREE.InstancedMesh(pedestrianGeometry(), material, PED_MAX);
  pedMesh.castShadow = true; pedMesh.receiveShadow = true; pedMesh.frustumCulled = false; pedMesh.count = 0;
  pedMesh.setColorAt(0, PED_COLORS[0]);
  group.add(pedMesh);
  scene3d.scene.add(group);

  const pick = (items) => { let r = Math.random(), total = items.reduce((s, i) => s + i.weight, 0); r *= total; for (const item of items) { r -= item.weight; if (r <= 0) return item; } return items[0]; };
  const cars = Array.from({ length: CAR_MAX }, () => ({ kind: "car", line: null, type: CAR_TYPES.indexOf(pick(CAR_TYPES)), color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], speed: 0, base: 0 }));
  const peds = Array.from({ length: PED_MAX }, () => ({ kind: "ped", line: null, color: PED_COLORS[Math.floor(Math.random() * PED_COLORS.length)], speed: 1.2 + Math.random() * 0.4, base: 0, scale: 0.92 + Math.random() * 0.16, phase: Math.random() * 6.28 }));

  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  const temp = {}, state = { enabled: true, radius: 0, activeCars: 0, activePeds: 0 };

  function place(agent, net, grid, target, radius, avoidView) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = Math.random() * 6.283, r = radius * (0.2 + 0.8 * Math.sqrt(Math.random()));
      const px = target.x + Math.cos(angle) * r, pz = target.z + Math.sin(angle) * r;
      const entries = grid.get(`${Math.floor(px / 80)}:${Math.floor(pz / 80)}`);
      if (!entries) continue;
      const [line, seg] = entries[Math.floor(Math.random() * entries.length)];
      const weight = agent.kind === "car" ? CAR_CLASSES[line.cls].weight : (line.cls === "sidewalk" ? 1 : 0.5);
      if (Math.random() > weight) continue;
      const f = Math.random(), x = line.p[seg * 2] + (line.p[seg * 2 + 2] - line.p[seg * 2]) * f, z = line.p[seg * 2 + 1] + (line.p[seg * 2 + 3] - line.p[seg * 2 + 1]) * f;
      if (avoidView) { const y = terrain.heightAt(x, z) ?? 0; if (frustum.containsPoint(new THREE.Vector3(x, y, z))) continue; }
      agent.line = line; agent.seg = seg;
      agent.dir = line.oneway || (Math.random() < 0.5 ? 1 : -1);
      agent.t = f * (line.cum[seg + 1] - line.cum[seg]);
      const classSpeed = agent.kind === "car" ? CAR_CLASSES[line.cls].speed : agent.speed;
      agent.base = agent.kind === "car" ? classSpeed * (0.85 + Math.random() * 0.3) : agent.speed;
      agent.speed = agent.base;
      return true;
    }
    agent.line = null;
    return false;
  }

  const up = new THREE.Vector3(0, 1, 0), position = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), matrix = new THREE.Matrix4(), xAxis = new THREE.Vector3(1, 0, 0);
  let enabledByMode = true;

  scene3d.onFrame((delta, _now, distance) => {
    const sim = ctx.ground?.state.mode !== "aerial" && ctx.ground?.state.mode !== "map";
    enabledByMode = sim;
    group.visible = state.enabled && sim && distance < ACTIVE_DISTANCE;
    if (!group.visible) return;
    const dt = Math.min(0.1, delta);
    const target = scene3d.controls.target;
    const radius = THREE.MathUtils.clamp(distance * 1.2, 120, 650);
    const night = ctx.sky?.state.night ?? 0;
    uniforms.uNightGlow.value = night;
    const weather = ctx.weather?.state.condition;
    const carCount = Math.round(THREE.MathUtils.clamp(CAR_MAX * (radius / 650) ** 1.3, 14, CAR_MAX) * (1 - 0.5 * night));
    const pedCount = Math.round(THREE.MathUtils.clamp(PED_MAX * (radius / 650) ** 1.3, 10, PED_MAX) * (1 - 0.8 * night) * (weather?.rain || weather?.snow ? 0.5 : 1));
    scene3d.camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(scene3d.camera.projectionMatrix, scene3d.camera.matrixWorldInverse));
    const reseed = state.radius === 0 || radius > state.radius * 1.35 || radius < state.radius / 1.6;
    if (reseed) state.radius = radius;
    const process = (list, active, previous, net, grid) => {
      for (let i = 0; i < active; i++) {
        const agent = list[i];
        if (reseed || i >= previous || !agent.line) place(agent, net, grid, target, radius, !reseed && i < previous);
      }
    };
    process(cars, carCount, reseed ? 0 : state.activeCars, carNet, carGrid);
    process(peds, pedCount, reseed ? 0 : state.activePeds, walkNet, walkGrid);
    state.activeCars = carCount; state.activePeds = pedCount;

    // Autos: Folgeabstand je Linie und Richtung
    const byLine = new Map();
    for (let i = 0; i < carCount; i++) {
      const a = cars[i];
      if (!a.line) continue;
      a.s = a.line.cum[a.seg] + a.t;
      if (!byLine.has(a.line)) byLine.set(a.line, []);
      byLine.get(a.line).push(a);
    }
    for (const list of byLine.values()) {
      for (const a of list) {
        let gap = Infinity, leader = null;
        for (const b of list) {
          if (b === a || b.dir !== a.dir) continue;
          const g = a.dir > 0 ? b.s - a.s : a.s - b.s;
          if (g > 0 && g < gap) { gap = g; leader = b; }
        }
        a.speed = leader && gap < 5 + a.base * 1.2 ? Math.min(a.base, gap < 6 ? 0 : leader.speed * 0.95) : a.base;
      }
    }

    const counts = [0, 0, 0];
    for (let i = 0; i < carCount; i++) {
      const a = cars[i];
      if (!a.line) continue;
      const alive = advance(a, a.speed * dt, carNet, Math.random, { turn: 0.35, bounce: false });
      sample(a, temp);
      const away = Math.hypot(temp.x - target.x, temp.z - target.z) > radius * 1.25;
      if (!alive || away) { place(a, carNet, carGrid, target, radius, true); if (!a.line) continue; sample(a, temp); }
      const lane = ROAD_WIDTH[a.line.cls] / 4;
      const x = temp.x - temp.tz * lane, z = temp.z + temp.tx * lane;
      const y = (terrain.heightAt(x, z) ?? 0) + 0.32;
      const ahead = terrain.heightAt(x + temp.tx * 1.8, z + temp.tz * 1.8), behind = terrain.heightAt(x - temp.tx * 1.8, z - temp.tz * 1.8);
      const pitch = ahead !== null && behind !== null ? -Math.atan2(ahead - behind, 3.6) : 0;
      q.setFromAxisAngle(up, Math.atan2(temp.tx, temp.tz)).multiply(qPitch.setFromAxisAngle(xAxis, pitch));
      matrix.compose(position.set(x, y, z), q, scale.set(1, 1, 1));
      const mesh = carMeshes[a.type];
      mesh.setMatrixAt(counts[a.type], matrix);
      mesh.setColorAt(counts[a.type], a.color);
      counts[a.type]++;
    }
    carMeshes.forEach((mesh, i) => { mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });

    let pedTotal = 0;
    for (let i = 0; i < pedCount; i++) {
      const a = peds[i];
      if (!a.line) continue;
      const alive = advance(a, a.speed * dt, walkNet, Math.random, { turn: 0.3, bounce: true });
      sample(a, temp);
      const away = Math.hypot(temp.x - target.x, temp.z - target.z) > radius * 1.25;
      if (!alive || away) { place(a, walkNet, walkGrid, target, radius, true); if (!a.line) continue; sample(a, temp); }
      a.phase += a.speed * dt * 4.2;
      const y = (terrain.heightAt(temp.x, temp.z) ?? 0) + 0.34 + Math.abs(Math.sin(a.phase)) * 0.035;
      q.setFromAxisAngle(up, Math.atan2(temp.tx, temp.tz) + Math.sin(a.phase) * 0.05);
      matrix.compose(position.set(temp.x, y, temp.z), q, scale.set(a.scale, a.scale, a.scale));
      pedMesh.setMatrixAt(pedTotal, matrix);
      pedMesh.setColorAt(pedTotal, a.color);
      pedTotal++;
    }
    pedMesh.count = pedTotal; pedMesh.instanceMatrix.needsUpdate = true;
    if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
  });

  layers.add({
    id: "ambient", label: "Verkehr und Personen (Simulation)", color: "#c0392b", visible: true,
    count: `${carNet.lines.length + walkNet.lines.length} Wege`, apply: (v) => { state.enabled = v; group.visible = v && enabledByMode; },
  });
  ctx.ambient = { state, carNet, walkNet, cars, peds };
}
