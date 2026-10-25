// Simulierter Alltag (nur bei Boden «Simulation»): Autos auf den Strassen, Personen auf Wegen und Trottoirs.
// Symbolisch: Es gibt keine Verkehrs- oder Personenzahlen. Dichte und Wege sind Annahmen (Strassenklasse, Bebauung in der Nähe).
import * as THREE from "three";
import { walk, roadLayout } from "./roadmarks.js";
import { skyEnvironment } from "./pv.js";
import { CAR_KINDS, carMaterial, pedestrianGeometry, dogGeometry, bikeGeometry, figureMaterial } from "./vehicles.js";
import { roadWidth } from "./roadmarks.js";

// Nebenstrassen ohne Mittellinie (minor, service) sind praktisch autofrei: Gewicht nahe null; dort fahren Velos und gehen Personen.
const CAR_CLASSES = { motorway: { speed: 28, weight: 1 }, primary: { speed: 14, weight: 1 }, secondary: { speed: 12, weight: 0.9 }, tertiary: { speed: 10, weight: 0.8 }, minor: { speed: 8.5, weight: 0.03 }, service: { speed: 5, weight: 0.02 } };
const BIKE_CLASSES = { minor: { speed: 5.2, weight: 1 }, service: { speed: 4.6, weight: 0.8 }, track: { speed: 4, weight: 0.4 } };
const SIDEWALK_CLASSES = ["primary", "secondary", "tertiary", "minor"];
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
    out.push({ id: out.length, p: line.p, n, cum, total: cum[n - 1], cls: line.cls, oneway: line.oneway ?? 0, lanes: line.lanes ?? [], width: line.width ?? 0, owner: line.owner ?? -1, d0: line.d0 ?? 0, closed: n > 2 && line.p[0] === line.p[2 * n - 2] && line.p[1] === line.p[2 * n - 1] });
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
export function advance(agent, distance, net, random = Math.random, { turn = 0.35, bounce = false, accept = null } = {}) {
  let remaining = distance;
  for (let guard = 0; remaining > 0 && guard < 60; guard++) {
    const line = agent.line, len = segmentLength(line, agent.seg);
    const room = agent.dir > 0 ? len - agent.t : agent.t;
    if (remaining < room) { agent.t += agent.dir * remaining; return true; }
    remaining -= room;
    const vertex = agent.dir > 0 ? agent.seg + 1 : agent.seg, last = line.n - 1;
    const atEnd = vertex === 0 || vertex === last;
    const options = (net.nodes.get(nodeKey(line.p[2 * vertex], line.p[2 * vertex + 1])) ?? []).filter((o) => o.line !== line && (!accept || accept(o.line)));
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

/**
 * Geschwindigkeitsbegrenzung gegen Durchdringung. Agenten: { id, x, z, tx, tz, w (halbe Breite), l (halbe Länge), base, speed }.
 * Gleichgerichtete Vorausfahrende bremsen den Hintermann (Folgeabstand); bei kreuzenden oder entgegenkommenden Wegen
 * wartet, wer die höhere `id` hat (Vorrang nach id, damit sich nie zwei gegenseitig blockieren).
 */
export function limitSpeeds(agents, { minGap = 1.5, lookBase = 4, lookTime = 1.4 } = {}) {
  for (const a of agents) {
    a.limit = a.base; a.blocked = false;
    for (const b of agents) {
      if (a === b) continue;
      const rx = b.x - a.x, rz = b.z - a.z, dist2 = rx * rx + rz * rz;
      if (dist2 > 900) continue;
      const aligned = a.tx * b.tx + a.tz * b.tz > 0.4;
      if (aligned) {
        const fwd = rx * a.tx + rz * a.tz, lat = Math.abs(rx * a.tz - rz * a.tx);
        if (fwd > 0 && fwd < lookBase + a.base * lookTime && lat < a.w + b.w) {
          const gap = fwd - a.l - b.l;
          a.limit = Math.min(a.limit, gap < minGap ? 0 : (gap - minGap) / 1.2);
          a.blocked = true;
        }
      } else if (a.id > b.id) {
        for (const t of [0.4, 0.8, 1.3, 1.8]) {
          const ax = a.x + a.tx * a.base * t, az = a.z + a.tz * a.base * t, bx = b.x + b.tx * b.speed * t, bz = b.z + b.tz * b.speed * t;
          const reach = a.w + b.w + 0.3 + Math.max(a.l, b.l) * 0.35;
          if ((ax - bx) ** 2 + (az - bz) ** 2 < reach * reach) { a.limit = 0; a.blocked = true; break; }
        }
      }
    }
    a.limit = Math.max(0, a.limit);
  }
}

// --- Szene -----------------------------------------------------------------------------------------------------------------

const CAR_MAX = 130, PED_MAX = 360, DOG_MAX = 90;
const HIGH_DETAIL_DISTANCE = 140;
const CAR_COLORS = ["#f2f2f0", "#f2f2f0", "#c7cacc", "#8e9397", "#2b2e33", "#1b1d21", "#2f4f7f", "#a8222a", "#355a3c", "#c9b99a", "#e0c24a", "#5b6670"].map((c) => new THREE.Color(c));
const PED_COLORS = ["#c0392b", "#2c5aa0", "#2f7a4f", "#e1a83a", "#7b4d9e", "#d9d5cf", "#3b3f45", "#c76b2c", "#4f8fa6", "#8a9a3b", "#e8e4dc", "#b04a7a"].map((c) => new THREE.Color(c));
const DOG_COLORS = ["#7a5230", "#1c1a19", "#d6c2a0", "#8b8b8b", "#4a3020", "#e9e4da"].map((c) => new THREE.Color(c));
const DOG_SHARE = 0.14;

export function initAmbient(ctx) {
  const { scene3d, terrain, layers, buildings } = ctx;
  const roads = ctx.roads ?? [];
  if (!roads.length) return;

  const carLines = roads.filter((r) => CAR_CLASSES[r.c] && !r.t).map((r) => {
    const closed = r.p.length > 6 && r.p[0] === r.p[r.p.length - 2] && r.p[1] === r.p[r.p.length - 1];
    const roundabout = closed && walk(r.p, 5).length * 5 < 160;
    const layout = roadLayout(r);
    return { p: r.p, cls: r.c, oneway: r.ow || (roundabout ? loopDirection(r.p) : 0), lanes: layout.lanes, width: layout.width };
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
    const offset = roadLayout(road).width / 2 + 1.1;
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

  const environment = (() => { try { return skyEnvironment(scene3d.renderer); } catch { return null; } })();
  const { material: carMat, uniforms: carUniforms } = carMaterial(environment);
  const figureMat = figureMaterial();
  const group = new THREE.Group();
  group.name = "ambient";
  const instanced = (geometry, material, max, shadow) => {
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(mesh);
    return mesh;
  };
  const carHigh = CAR_KINDS.map((kind) => instanced(kind.high, carMat, CAR_MAX, true));
  const carLow = CAR_KINDS.map((kind) => instanced(kind.low, carMat, CAR_MAX, false));
  const pedMesh = instanced(pedestrianGeometry(PED_MAX), figureMat, PED_MAX, true);
  const dogMesh = instanced(dogGeometry(DOG_MAX), figureMat, DOG_MAX, true);
  const leashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 1), new THREE.MeshStandardMaterial({ color: 0xb02828, roughness: 0.8 }), DOG_MAX);
  leashMesh.frustumCulled = false; leashMesh.count = 0;
  group.add(leashMesh);
  scene3d.scene.add(group);

  const pick = (items) => { let r = Math.random() * items.reduce((s, i) => s + i.weight, 0); for (const item of items) { r -= item.weight; if (r <= 0) return item; } return items[0]; };
  const random = (list) => list[Math.floor(Math.random() * list.length)];
  const cars = Array.from({ length: CAR_MAX }, () => ({ kind: "car", line: null, type: CAR_KINDS.indexOf(pick(CAR_KINDS)), color: random(CAR_COLORS), speed: 0, base: 0, lane: Math.floor(Math.random() * 4) }));
  const peds = Array.from({ length: PED_MAX }, () => {
    const dog = Math.random() < DOG_SHARE;
    const shirt = random(PED_COLORS).clone().offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.14);
    return { kind: "ped", line: null, dog, color: shirt, dogColor: random(DOG_COLORS), speed: (dog ? 1.0 : 1.2) + Math.random() * 0.4, base: 0, scale: 0.93 + Math.random() * 0.14, phase: Math.random() * 6.28, dogPhase: 0, seed: Math.random() };
  });

  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  const temp = {}, state = { enabled: true, radius: 0, activeCars: 0, activePeds: 0, visibleCars: 0, visiblePeds: 0, visibleDogs: 0 };

  // Autobahn: linke Spur schneller, rechte langsamer
  const laneFactor = (line, lane) => (line.cls === "motorway" && line.lanes.length > 1 ? 1.08 - 0.16 * ((lane % line.lanes.length) / (line.lanes.length - 1)) : 1);

  function place(agent, net, grid, target, radius, avoidView) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = Math.random() * 6.283, r = radius * (0.2 + 0.8 * Math.sqrt(Math.random()));
      const px = target.x + Math.cos(angle) * r, pz = target.z + Math.sin(angle) * r;
      const entries = grid.get(`${Math.floor(px / 80)}:${Math.floor(pz / 80)}`);
      if (!entries) continue;
      const [line, seg] = entries[Math.floor(Math.random() * entries.length)];
      const weight = agent.kind === "car" ? CAR_CLASSES[line.cls].weight : (line.cls === "sidewalk" ? 1 : 0.6);
      if (Math.random() > weight) continue;
      const f = Math.random(), x = line.p[seg * 2] + (line.p[seg * 2 + 2] - line.p[seg * 2]) * f, z = line.p[seg * 2 + 1] + (line.p[seg * 2 + 3] - line.p[seg * 2 + 1]) * f;
      if (avoidView) { const y = terrain.heightAt(x, z) ?? 0; if (frustum.containsPoint(new THREE.Vector3(x, y, z))) continue; }
      agent.line = line; agent.seg = seg;
      agent.dir = line.oneway || (Math.random() < 0.5 ? 1 : -1);
      agent.t = f * (line.cum[seg + 1] - line.cum[seg]);
      agent.base = agent.kind === "car" ? CAR_CLASSES[line.cls].speed * (0.85 + Math.random() * 0.3) * laneFactor(line, agent.lane) : agent.speed;
      agent.speed = agent.base;
      return true;
    }
    agent.line = null;
    return false;
  }

  const up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1), xAxis = new THREE.Vector3(1, 0, 0);
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  const camera = scene3d.camera, ground = new THREE.Vector3(), handPoint = new THREE.Vector3(), collarPoint = new THREE.Vector3(), leashDirection = new THREE.Vector3();
  let enabledByMode = true;
  // Handys und schwache Geräte: halb so viele Autos und Personen, weniger Rechenzeit pro Bild.
  const densityScale = ctx.lowPower ? 0.5 : 1;

  scene3d.onFrame((delta, now, distance) => {
    const mode = ctx.ground?.state.mode;
    enabledByMode = mode !== "aerial" && mode !== "map";
    group.visible = state.enabled && enabledByMode && distance < ACTIVE_DISTANCE;
    if (!group.visible) return;
    const dt = Math.min(0.1, delta), clock = now / 1000;
    const target = scene3d.controls.target;
    const radius = THREE.MathUtils.clamp(distance * 1.2, 120, 650);
    const night = ctx.sky?.state.night ?? 0, day = ctx.sky?.state.dayFactor ?? 1, cloud = ctx.sky?.state.cloudCover ?? 0;
    carUniforms.uNightGlow.value = night;
    carMat.envMapIntensity = 0.1 + 1.0 * day * (1 - 0.65 * cloud);
    const weather = ctx.weather?.state.condition;
    const carCount = Math.round(THREE.MathUtils.clamp(CAR_MAX * (radius / 650) ** 1.3, 7, CAR_MAX) * (1 - 0.45 * night) * densityScale);
    const pedCount = Math.round(THREE.MathUtils.clamp(PED_MAX * (radius / 650) ** 1.3, 14, PED_MAX) * (1 - 0.5 * night) * (weather?.rain || weather?.snow ? 0.6 : 1) * densityScale);
    // aus der Ferne vergrössert, damit Autos und Personen als Punkte erkennbar bleiben (symbolisch)
    const carBoost = THREE.MathUtils.clamp(distance / 450, 1, 2.2), pedBoost = THREE.MathUtils.clamp(distance / 150, 1, 3.4);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
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
      const key = `${a.line.id}:${a.lane % Math.max(1, a.line.lanes.length)}`;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(a);
    }
    for (const list of byLine.values()) for (const a of list) {
      let gap = Infinity, leader = null;
      for (const b of list) {
        if (b === a || b.dir !== a.dir) continue;
        const g = a.dir > 0 ? b.s - a.s : a.s - b.s;
        if (g > 0 && g < gap) { gap = g; leader = b; }
      }
      a.speed = leader && gap < 5 + a.base * 1.2 ? Math.min(a.base, gap < 6 ? 0 : leader.speed * 0.95) : a.base;
    }

    const high = CAR_KINDS.map(() => 0), low = CAR_KINDS.map(() => 0);
    let carTotal = 0;
    for (let i = 0; i < carCount; i++) {
      const a = cars[i];
      if (!a.line) continue;
      const alive = advance(a, a.speed * dt, carNet, Math.random, { turn: 0.35, bounce: false });
      sample(a, temp);
      const away = Math.hypot(temp.x - target.x, temp.z - target.z) > radius * 1.25;
      if (!alive || away) { place(a, carNet, carGrid, target, radius, true); if (!a.line) continue; sample(a, temp); }
      const lane = a.line.lanes.length ? a.line.lanes[a.lane % a.line.lanes.length] : a.line.width / 4;
      const x = temp.x - temp.tz * lane, z = temp.z + temp.tx * lane;
      const y = (terrain.heightAt(x, z) ?? 0) + 0.3;
      const ahead = terrain.heightAt(x + temp.tx * 1.8, z + temp.tz * 1.8), behind = terrain.heightAt(x - temp.tx * 1.8, z - temp.tz * 1.8);
      const pitch = ahead !== null && behind !== null ? -Math.atan2(ahead - behind, 3.6) : 0;
      q.setFromAxisAngle(up, Math.atan2(temp.tx, temp.tz)).multiply(qPitch.setFromAxisAngle(xAxis, pitch));
      matrix.compose(position.set(x, y, z), q, scale.set(carBoost, carBoost, carBoost));
      const near = ground.set(x, y, z).distanceToSquared(camera.position) < HIGH_DETAIL_DISTANCE * HIGH_DETAIL_DISTANCE;
      const mesh = (near ? carHigh : carLow)[a.type], counts = near ? high : low;
      mesh.setMatrixAt(counts[a.type], matrix);
      mesh.setColorAt(counts[a.type], a.color);
      counts[a.type]++; carTotal++;
    }
    CAR_KINDS.forEach((_, i) => {
      for (const [mesh, counts] of [[carHigh[i], high], [carLow[i], low]]) { mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    });
    state.visibleCars = carTotal;

    let pedTotal = 0, dogTotal = 0;
    const pedPhase = pedMesh.geometry.attributes.aPhase, dogPhase = dogMesh.geometry.attributes.aPhase;
    for (let i = 0; i < pedCount; i++) {
      const a = peds[i];
      if (!a.line) continue;
      const alive = advance(a, a.speed * dt, walkNet, Math.random, { turn: 0.3, bounce: true });
      sample(a, temp);
      const away = Math.hypot(temp.x - target.x, temp.z - target.z) > radius * 1.25;
      if (!alive || away) { place(a, walkNet, walkGrid, target, radius, true); if (!a.line) continue; sample(a, temp); }
      a.phase += a.speed * dt * 4.5;
      const k = a.scale * pedBoost;
      const y = (terrain.heightAt(temp.x, temp.z) ?? 0) + 0.34;
      const heading = Math.atan2(temp.tx, temp.tz);
      q.setFromAxisAngle(up, heading);
      matrix.compose(position.set(temp.x, y + Math.abs(Math.sin(a.phase)) * 0.03 * k, temp.z), q, scale.set(k, k, k));
      pedMesh.setMatrixAt(pedTotal, matrix);
      pedMesh.setColorAt(pedTotal, a.color);
      pedPhase.array[pedTotal] = a.phase;
      pedTotal++;
      if (a.dog && dogTotal < DOG_MAX) {
        // Hund an der Leine: links vor dem Besitzer, schwankt in Abstand und Seite
        const lead = (1.15 + 0.35 * Math.sin(clock * 0.8 + a.seed * 6)) * k, side = (0.5 + 0.22 * Math.sin(clock * 0.5 + a.seed * 9)) * k;
        const dx = temp.x + temp.tx * lead + temp.tz * side, dz = temp.z + temp.tz * lead - temp.tx * side;
        const dy = (terrain.heightAt(dx, dz) ?? y - 0.34) + 0.34, dk = k * (0.85 + a.seed * 0.3);
        a.dogPhase += a.speed * dt * 8;
        q.setFromAxisAngle(up, heading + Math.sin(clock * 1.3 + a.seed * 5) * 0.18);
        matrix.compose(position.set(dx, dy, dz), q, scale.set(dk, dk, dk));
        dogMesh.setMatrixAt(dogTotal, matrix);
        dogMesh.setColorAt(dogTotal, a.dogColor);
        dogPhase.array[dogTotal] = a.dogPhase;
        handPoint.set(temp.x + temp.tz * 0.28 * k, y + 0.9 * k, temp.z - temp.tx * 0.28 * k);
        collarPoint.set(dx + temp.tx * 0.27 * dk, dy + 0.4 * dk, dz + temp.tz * 0.27 * dk);
        leashDirection.subVectors(collarPoint, handPoint);
        const length = leashDirection.length();
        q.setFromUnitVectors(zAxis, leashDirection.normalize());
        matrix.compose(position.copy(handPoint).addScaledVector(leashDirection, length / 2), q, scale.set(Math.max(1, dk), Math.max(1, dk), length));
        leashMesh.setMatrixAt(dogTotal, matrix);
        dogTotal++;
      }
    }
    pedMesh.count = pedTotal; pedMesh.instanceMatrix.needsUpdate = true; pedPhase.needsUpdate = true;
    if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
    dogMesh.count = dogTotal; dogMesh.instanceMatrix.needsUpdate = true; dogPhase.needsUpdate = true;
    if (dogMesh.instanceColor) dogMesh.instanceColor.needsUpdate = true;
    leashMesh.count = dogTotal; leashMesh.instanceMatrix.needsUpdate = true;
    state.visiblePeds = pedTotal; state.visibleDogs = dogTotal;
  });

  layers.add({
    id: "ambient", label: "Verkehr und Personen (Simulation)", color: "#c0392b", visible: true,
    count: `${carNet.lines.length + walkNet.lines.length} Wege`, apply: (v) => { state.enabled = v; group.visible = v && enabledByMode; },
  });
  ctx.ambient = { state, carNet, walkNet, cars, peds, group };
}
