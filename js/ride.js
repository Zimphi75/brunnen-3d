// Velomodus: frei fahren mit Velo, gelbem Anhänger und Hund. Vor dem Start zeigt die Kamera den Fahrer schräg von
// vorne und kreist dann um ihn herum in die Spielkamera hinter dem Velo; erst danach lässt er sich steuern.
// Höchsttempo 40 km/h auf Strassen, 25 km/h im Gelände. Vor Gebäuden, Bäumen, dem See, Autos und Personen hält das
// Velo an (es fährt nicht hindurch). Arcade-Physik, keine echte Simulation.
import * as THREE from "three";
import { createBikeModel } from "./bike-model.js";
import { roadWidth, ROAD_WIDTH } from "./roadmarks.js";

const KMH = 1 / 3.6;
const MAX_ROAD = 40 * KMH, MAX_TERRAIN = 25 * KMH, MAX_REVERSE = 5 * KMH;
const ACCEL = 2.4, BRAKE = 6.5, ROLL = 0.18, WHEELBASE = 1.1, MAX_STEER = 0.45;
const FRONT_REACH = 1.05, BACK_REACH = 2.55;          // Vorderrad bzw. Anhängerheck ab Velomitte (m)
const TREE_TRUNK = 0.55, CAR_RADIUS = 2.1, PED_RADIUS = 0.8;
const STEEP = 1.0;                                     // steiler als 100 % (45°) ist im Gelände nicht befahrbar
const RIBBON_LIFT = 0.3;                               // Strassen und Wege liegen so hoch über dem Gelände (features.js)
const PIVOT_RATE = 0.9;                                // Drehen im Stand bzw. beim Schieben (rad/s)
// Kamera relativ zum Velo (x links, y oben, z vorne), wie im Modellvorschlag
const VIEW_FRONT = { pos: new THREE.Vector3(-2.6, 1.6, 3.2), look: new THREE.Vector3(0, 0.8, -0.6) };
const VIEW_GAME = { pos: new THREE.Vector3(0.35, 2.05, -5.6), look: new THREE.Vector3(0, 1.0, 4) };
const FLY_IN = 1.6, ORBIT = 3.4;
const KEYS = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function initRide(ctx) {
  const { scene3d, terrain } = ctx;
  const { camera, controls } = scene3d;
  const model = createBikeModel();
  const button = document.querySelector("#btn-ride");
  const hud = document.createElement("div");
  hud.id = "ride-hud";
  hud.hidden = true;
  hud.innerHTML = `
    <div class="ride-info">
      <div class="ride-street" id="ride-street">–</div>
      <div class="ride-meta"><span id="ride-surface">Strasse</span> · max. <span class="num" id="ride-max">40</span> km/h</div>
      <div class="ride-note" id="ride-note" aria-live="polite"></div>
    </div>
    <div class="ride-speed"><span class="num" id="ride-kmh">0</span><span class="ride-unit">km/h</span></div>
    <button type="button" class="ride-exit" id="ride-exit">Absteigen und Beenden <kbd>Esc</kbd></button>`;
  document.body.append(hud);
  // Smartphone: Kompass-Joystick am unteren Rand (vor, zurück, links, rechts), mit kurzer Anleitung beim Start
  const touch = matchMedia("(pointer: coarse)").matches;
  const stick = document.createElement("div");
  stick.id = "ride-stick";
  stick.hidden = true;
  stick.setAttribute("aria-hidden", "true");
  stick.innerHTML = `
    <div class="ride-stick-help">Daumen auf den Kompass legen und ziehen</div>
    <div class="ride-stick-pad">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r="76" class="ring"/><circle cx="80" cy="80" r="52" class="inner"/>
        <g class="ticks">${Array.from({ length: 24 }, (_, i) => `<line x1="80" y1="6" x2="80" y2="${i % 6 === 0 ? 16 : 11}" transform="rotate(${i * 15} 80 80)"/>`).join("")}</g>
        <path class="arrow" d="M80 24l10 13H70z"/><path class="arrow" d="M80 136l10-13H70z"/>
        <path class="arrow" d="M24 80l13-10v20z"/><path class="arrow" d="M136 80l-13-10v20z"/>
      </svg>
      <span class="ride-stick-label up">Vor</span><span class="ride-stick-label down">Zurück</span>
      <span class="ride-stick-label left">Links</span><span class="ride-stick-label right">Rechts</span>
      <div class="ride-stick-knob"></div>
    </div>`;
  document.body.append(stick);
  const pad = stick.querySelector(".ride-stick-pad"), knob = stick.querySelector(".ride-stick-knob");
  const joy = { x: 0, y: 0, id: null };   // x: rechts +, y: vor +, je -1..1
  function moveStick(event) {
    const r = pad.getBoundingClientRect(), radius = r.width / 2;
    let dx = (event.clientX - r.left - radius) / (radius * 0.72), dy = (event.clientY - r.top - radius) / (radius * 0.72);
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    joy.x = Math.abs(dx) < 0.12 ? 0 : dx; joy.y = Math.abs(dy) < 0.12 ? 0 : -dy;
    knob.style.transform = `translate(${dx * radius * 0.72}px, ${dy * radius * 0.72}px)`;
  }
  function releaseStick() { joy.x = 0; joy.y = 0; joy.id = null; knob.style.transform = ""; stick.classList.remove("is-active"); }
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (state.phase !== "ride") return;
    joy.id = event.pointerId; pad.setPointerCapture(event.pointerId);
    stick.classList.add("is-active", "is-learned");
    moveStick(event);
  });
  pad.addEventListener("pointermove", (event) => { if (event.pointerId === joy.id) moveStick(event); });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(type, (event) => { if (event.pointerId === joy.id) releaseStick(); });
  let helpTimer = 0;
  const $street = hud.querySelector("#ride-street"), $kmh = hud.querySelector("#ride-kmh"), $surface = hud.querySelector("#ride-surface"), $max = hud.querySelector("#ride-max"), $note = hud.querySelector("#ride-note");

  const state = { active: false, phase: "off", t: 0, x: 0, z: 0, heading: 0, v: 0, steer: 0, onRoad: true, blockedFor: 0 };
  const keys = new Set();
  const fly = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookSmooth = new THREE.Vector3();
  const ray = new THREE.Ray(), v3 = new THREE.Vector3();
  let groundBefore = null, modeBefore = null, streetTimer = 0;

  // Bäume in einem 20-m-Raster für schnelle Abfragen
  let treeGrid = null;
  function trees() {
    if (treeGrid || !ctx.treeData) return treeGrid;
    treeGrid = new Map();
    const t = ctx.treeData;
    for (let i = 0; i < t.count; i++) {
      const key = `${Math.floor(t.x[i] / 20)}:${Math.floor(t.z[i] / 20)}`;
      if (!treeGrid.has(key)) treeGrid.set(key, []);
      treeGrid.get(key).push(i);
    }
    return treeGrid;
  }
  const lakes = () => (ctx.waterData?.areas ?? []).filter((a) => a.k === "lake").map((a) => a.rings[0]);

  const ground = (x, z) => terrain.heightAt(x, z) ?? 0;
  // Gezeichnete Strassen und Wege liegen 30 cm über dem Gelände: Räder darauf, nicht darin
  // Gezeichnete Strassen und Wege liegen 30 cm über dem Gelände. Massgebend ist das höchste Band an der Stelle
  // (nicht das nächste: neben der Strasse verlaufen oft schmale Trottoir-Linien, die sonst den Belag «absenken»).
  let ribbons = null;
  function ribbonGrid() {
    if (ribbons) return ribbons;
    ribbons = new Map();
    for (const road of ctx.roads ?? []) {
      if (road.t || road.c === "rail" || road.c === "aerialway") continue;
      const half = (["motorway", "primary", "secondary"].includes(road.c) ? roadWidth(road) : ROAD_WIDTH[road.c] ?? 3) / 2;
      const p = road.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const seg = [p[i], p[i + 1], p[i + 2], p[i + 3], half, road];
        const x0 = Math.floor(Math.min(p[i], p[i + 2]) / 20), x1 = Math.floor(Math.max(p[i], p[i + 2]) / 20);
        const z0 = Math.floor(Math.min(p[i + 1], p[i + 3]) / 20), z1 = Math.floor(Math.max(p[i + 1], p[i + 3]) / 20);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const key = `${gx}:${gz}`;
          if (!ribbons.has(key)) ribbons.set(key, []);
          ribbons.get(key).push(seg);
        }
      }
    }
    return ribbons;
  }
  function ribbonLift(x, z) {
    const grid = ribbonGrid(), gx = Math.floor(x / 20), gz = Math.floor(z / 20);
    let best = 0;
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
      for (const [x0, z0, x1, z1, half] of grid.get(`${i}:${j}`) ?? []) {
        const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(x - x0 - dx * t, z - z0 - dz * t);
        const lift = THREE.MathUtils.clamp((half + 0.3 - d) / 0.6, 0, 1);
        if (lift > best) { best = lift; if (best >= 1) return RIBBON_LIFT; }
      }
    }
    return best * RIBBON_LIFT;
  }
  const surface = (x, z) => ground(x, z) + ribbonLift(x, z);
  /** Name der Strasse bzw. des Wegs unter dem Velo, sonst «Abseits der Strasse». */
  function streetName(x, z) {
    const grid = ribbonGrid(), gx = Math.floor(x / 20), gz = Math.floor(z / 20);
    let best = null, bestScore = Infinity;
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
      for (const [x0, z0, x1, z1, half, road] of grid.get(`${i}:${j}`) ?? []) {
        const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(x - x0 - dx * t, z - z0 - dz * t);
        if (d > half + 1.5) continue;
        const score = d - half + (road.n ? 0 : 3);          // benannte Strassen bevorzugen
        if (score < bestScore) { bestScore = score; best = road; }
      }
    }
    if (!best) return "Abseits der Strasse";
    if (best.n) return best.n;
    return { footway: "Fussweg", cycleway: "Veloweg", steps: "Treppe", path: "Weg", pedestrian: "Fussgängerzone", track: "Feldweg", service: "Zufahrt" }[best.hw] ?? { path: "Weg", track: "Feldweg", service: "Zufahrt" }[best.c] ?? "Strasse ohne Namen";
  }
  const dirX = () => Math.sin(state.heading), dirZ = () => Math.cos(state.heading);
  /** Lokaler Punkt (x links, y oben, z vorne) des Velos in Weltkoordinaten. */
  function toWorld(local, out, y0 = ground(state.x, state.z)) {
    const fx = dirX(), fz = dirZ();
    return out.set(state.x + local.z * fx + local.x * fz, y0 + local.y, state.z + local.z * fz - local.x * fx);
  }

  /** Was liegt an diesem Punkt im Weg? Rückgabe: Beschreibung oder null. */
  function obstacleAt(px, pz, fromX, fromZ, travel) {
    if (px < terrain.minX + 10 || px > terrain.minX + terrain.width - 10 || pz > terrain.maxZ - 10 || pz < terrain.maxZ - terrain.depth + 10) return "Modellrand";
    // Gebäude: waagrechter Strahl auf Hüfthöhe von der Velomitte zum Prüfpunkt
    if (ctx.buildings) {
      const len = Math.hypot(px - fromX, pz - fromZ) || 1;
      ray.origin.set(fromX, ground(fromX, fromZ) + 0.9, fromZ);
      ray.direction.set((px - fromX) / len, 0, (pz - fromZ) / len);
      const hit = ctx.buildings.pick(ray);
      if (hit && hit.distance < len) return "Gebäude";
    }
    const grid = trees();
    if (grid) {
      const t = ctx.treeData, gx = Math.floor(px / 20), gz = Math.floor(pz / 20);
      for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
        for (const k of grid.get(`${i}:${j}`) ?? []) if (Math.hypot(t.x[k] - px, t.z[k] - pz) < TREE_TRUNK) return "Baum";
      }
    }
    for (const ring of lakes()) if (pointInRing(px, pz, ring)) return "See";
    const ambient = ctx.ambient;
    if (ambient) {
      // nur Autos und Personen, die gerade gezeichnet werden (inaktive behalten ihre letzte Position)
      const frame = ambient.state.frame ?? 0, live = (a) => a.line && a.seen !== undefined && a.seen >= frame - 1;
      for (const a of ambient.cars) if (live(a) && Math.hypot(a.x - px, a.z - pz) < CAR_RADIUS) return "Auto";
      for (const a of ambient.peds) if (live(a) && Math.hypot(a.x - px, a.z - pz) < PED_RADIUS) return "Person";
    }
    if (terrain.grading?.roadAt(px, pz) === null || terrain.grading?.roadAt(px, pz) === undefined) {
      const rise = Math.abs(ground(px, pz) - ground(fromX, fromZ));
      if (rise > STEEP * Math.max(0.5, travel)) return "zu steil";
    }
    return null;
  }

  function placeAtStart() {
    const t = controls.target;
    const near = ctx.roadIndex?.nearest(t.x, t.z, 400);
    state.x = near?.x ?? t.x; state.z = near?.z ?? t.z;
    state.heading = near ? Math.atan2(near.tx, near.tz) : 0;
    state.v = 0; state.steer = 0; state.blockedFor = 0;
    model.reset();
  }

  function pose(dt, yawRate = 0) {
    const g = surface(state.x, state.z);
    const fx = dirX(), fz = dirZ();
    const front = surface(state.x + fx * 0.55, state.z + fz * 0.55), back = surface(state.x - fx * 0.55, state.z - fz * 0.55);
    model.group.position.set(state.x, g, state.z);
    model.group.rotation.set(0, state.heading, 0);   // nur Gierung: Velo und Anhänger neigen sich je für sich
    const tx = state.x - fx * 1.65, tz = state.z - fz * 1.65;
    const trailerFront = surface(tx + fx * 0.4, tz + fz * 0.4), trailerBack = surface(tx - fx * 0.4, tz - fz * 0.4);
    model.update(dt, {
      speed: state.v, steer: state.steer, yawRate,
      pitch: -Math.atan2(front - back, 1.1),
      trailerDy: THREE.MathUtils.clamp(surface(tx, tz) - g, -1.5, 1.5),
      trailerPitch: -Math.atan2(trailerFront - trailerBack, 0.8),
    });
  }

  function setNote(text) { $note.textContent = text; }

  function start() {
    if (state.active) return;
    state.active = true;
    ctx.player = () => (state.active ? { x: state.x, z: state.z } : null);
    groundBefore = (x, z) => terrain.heightAt(x, z);
    scene3d.groundAt = null;            // Kamera darf tiefer als 3 m über Boden
    controls.enabled = false;
    controls.minDistance = 0;
    placeAtStart();
    scene3d.scene.add(model.group);
    pose(0);
    fly.pos.copy(camera.position); fly.look.copy(controls.target);
    state.phase = "intro"; state.t = 0;
    hud.hidden = false;
    stick.hidden = !touch;
    stick.classList.remove("is-ready", "is-learned", "is-active");
    hud.classList.toggle("is-touch", touch);
    hud.classList.add("is-intro");
    setNote("Bereit machen …");
    button?.setAttribute("aria-pressed", "true");
    document.body.classList.add("ride-mode");
    // Pins und Beschriftungen ausblenden (auch ohne neues CSS im Browser-Cache)
    const labels = document.getElementById("labels");
    if (labels) labels.style.visibility = "hidden";
    // Immer bei Tageslicht fahren: Darstellung «Hell & klar», beim Beenden zurück
    const panel = ctx.timeWeatherPanel;
    modeBefore = panel?.state.mode ?? null;
    if (panel && modeBefore !== "clear") panel.setMode("clear");
  }

  function stop({ flyBack = true } = {}) {
    if (!state.active) return;
    state.active = false;
    state.phase = "off";
    ctx.player = null;
    keys.clear();
    scene3d.scene.remove(model.group);
    controls.enabled = true;
    controls.minDistance = 15;
    scene3d.groundAt = groundBefore;
    hud.hidden = true;
    stick.hidden = true;
    releaseStick();
    clearTimeout(helpTimer);
    button?.setAttribute("aria-pressed", "false");
    document.body.classList.remove("ride-mode");
    const labels = document.getElementById("labels");
    if (labels) labels.style.visibility = "";
    if (modeBefore && modeBefore !== "clear") ctx.timeWeatherPanel?.setMode(modeBefore);
    modeBefore = null;
    const target = new THREE.Vector3(state.x, ground(state.x, state.z), state.z);
    if (flyBack) ctx.rig?.flyTo({ target, distance: 260, heading: state.heading + Math.PI, tilt: THREE.MathUtils.degToRad(55), duration: 1.4 });
  }

  /** Kamera im Intro: Anflug, dann Kreisbahn um den Fahrer von schräg vorne bis hinter ihn. */
  function introCamera(dt) {
    state.t += dt;
    const g = surface(state.x, state.z);
    if (state.t < FLY_IN) {
      const k = ease(state.t / FLY_IN);
      toWorld(VIEW_FRONT.pos, camPos, g); toWorld(VIEW_FRONT.look, camLook, g);
      camera.position.lerpVectors(fly.pos, camPos, k);
      controls.target.lerpVectors(fly.look, camLook, k);
      return;
    }
    const k = ease(Math.min(1, (state.t - FLY_IN) / ORBIT));
    const a0 = Math.atan2(VIEW_FRONT.pos.x, VIEW_FRONT.pos.z), a1 = Math.atan2(VIEW_GAME.pos.x, VIEW_GAME.pos.z);
    let delta = a1 - a0; if (delta > 0) delta -= Math.PI * 2;   // über die rechte Seite des Fahrers herum
    const r0 = Math.hypot(VIEW_FRONT.pos.x, VIEW_FRONT.pos.z), r1 = Math.hypot(VIEW_GAME.pos.x, VIEW_GAME.pos.z);
    const angle = a0 + delta * k, r = r0 + (r1 - r0) * k;
    v3.set(Math.sin(angle) * r, VIEW_FRONT.pos.y + (VIEW_GAME.pos.y - VIEW_FRONT.pos.y) * k, Math.cos(angle) * r);
    toWorld(v3, camera.position, g);
    toWorld(v3.lerpVectors(VIEW_FRONT.look, VIEW_GAME.look, k), controls.target, g);
    if (k >= 1) {
      state.phase = "ride";
      hud.classList.remove("is-intro");
      if (touch) {
        stick.classList.add("is-ready");
        clearTimeout(helpTimer);
        helpTimer = setTimeout(() => stick.classList.add("is-learned"), 5000);   // Anleitung ausblenden, Kompass halbtransparent
      } else setNote("Pfeiltasten oder WASD · Leertaste klingelt");
      camPos.copy(camera.position); lookSmooth.copy(controls.target);
    }
  }

  /** Spielkamera: hinter dem Velo, folgt weich; steht ein Gebäude dazwischen, rückt sie näher. */
  function chaseCamera(dt) {
    const g = surface(state.x, state.z);
    let back = -VIEW_GAME.pos.z;
    const fx = dirX(), fz = dirZ();
    if (ctx.buildings) {
      ray.origin.set(state.x, g + 1.4, state.z);
      ray.direction.set(-fx, 0, -fz);
      const hit = ctx.buildings.pick(ray);
      if (hit && hit.distance < back) back = Math.max(2.2, hit.distance - 0.6);
    }
    toWorld(v3.set(VIEW_GAME.pos.x * (back / -VIEW_GAME.pos.z), VIEW_GAME.pos.y, -back), camPos, g);
    camPos.y = Math.max(camPos.y, ground(camPos.x, camPos.z) + 1.2);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6));
    toWorld(VIEW_GAME.look, camLook, g);
    lookSmooth.lerp(camLook, 1 - Math.exp(-dt * 8));
    controls.target.copy(lookSmooth);
  }

  function physics(dt) {
    // Eingabe: Tastatur (voll) oder Kompass-Joystick (stufenlos)
    const throttle = keys.has("up") ? 1 : keys.has("down") ? -1 : joy.y;
    const steerIn = (keys.has("left") ? 1 : 0) - (keys.has("right") ? 1 : 0) || -joy.x;
    const up = throttle > 0, down = throttle < 0;
    state.onRoad = terrain.grading ? terrain.grading.roadAt(state.x, state.z) !== null : true;
    const limit = state.onRoad ? MAX_ROAD : MAX_TERRAIN;
    if (up) state.v += (state.v < 0 ? BRAKE : ACCEL * throttle * (1 - Math.max(0, state.v) / (limit * 1.15))) * dt;
    else if (down) state.v -= (state.v > 0.2 ? BRAKE : 1.5) * -throttle * dt;
    else state.v -= Math.sign(state.v) * Math.min(Math.abs(state.v), ROLL * dt + Math.abs(state.v) * 0.04 * dt);
    // Steigung bremst bergauf und zieht bergab
    const fx = dirX(), fz = dirZ();
    const slope = (ground(state.x + fx, state.z + fz) - ground(state.x - fx, state.z - fz)) / 2;
    state.v -= 9.81 * slope * 0.5 * dt;
    // Tempolimit: über der Grenze (z. B. von der Strasse ins Gelände) sanft abbremsen
    if (state.v > limit) state.v = Math.max(limit, state.v - BRAKE * dt);
    state.v = Math.max(-MAX_REVERSE, state.v);
    // Lenken: deutlich weniger Einschlag bei hohem Tempo (bei 25 km/h rund 35 Grad pro Sekunde)
    const target = steerIn * MAX_STEER * (1 - Math.min(0.85, Math.abs(state.v) / 9));
    state.steer += (target - state.steer) * Math.min(1, dt * 6);
    // Im Stand oder beim Schieben lässt sich das Velo trotzdem drehen (z. B. nach einem Halt vor einem Hindernis)
    const pivot = steerIn * PIVOT_RATE * Math.max(0, 1 - Math.abs(state.v) / 1.5);
    const yawRate = (state.v / WHEELBASE) * Math.tan(state.steer) + pivot;
    const nextHeading = state.heading + yawRate * dt;
    const step = state.v * dt;
    const nx = state.x + Math.sin(nextHeading) * step, nz = state.z + Math.cos(nextHeading) * step;
    // Prüfpunkt: Vorderrad vorwärts, Anhängerheck rückwärts
    const reach = state.v >= 0 ? FRONT_REACH : -BACK_REACH;
    const px = nx + Math.sin(nextHeading) * reach, pz = nz + Math.cos(nextHeading) * reach;
    const blocker = Math.abs(step) > 1e-4 ? obstacleAt(px, pz, state.x, state.z, Math.abs(reach) + Math.abs(step)) : null;
    if (blocker) {
      state.v = 0;
      state.blockedFor = 1.2;
      state.heading += pivot * dt;
      setNote(`Halt: ${blocker} · lenken oder zurück`);
      return pivot;
    }
    state.heading = nextHeading; state.x = nx; state.z = nz;
    if (state.blockedFor > 0 && (state.blockedFor -= dt) <= 0) setNote("");
    return yawRate;
  }

  scene3d.onFrame((delta) => {
    if (!state.active) return;
    const dt = Math.min(0.05, delta);
    let yawRate = 0;
    if (state.phase === "intro") introCamera(dt);
    else { yawRate = physics(dt); chaseCamera(dt); }
    pose(dt, yawRate);
    camera.lookAt(controls.target);
    if ((streetTimer -= dt) <= 0) { streetTimer = 0.3; $street.textContent = streetName(state.x, state.z); }
    const kmh = Math.round(Math.abs(state.v) / KMH);
    $kmh.textContent = String(kmh);
    $surface.textContent = state.onRoad ? "Strasse" : "Gelände";
    $max.textContent = state.onRoad ? "40" : "25";
  });

  // Klingel: zwei kurze Töne, ohne Audiodatei
  let audio = null;
  function ring() {
    try {
      audio ??= new AudioContext();
      for (const [at, f] of [[0, 2100], [0.12, 2100]]) {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
        o.frequency.value = f; o.type = "triangle";
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.4);
      }
    } catch { /* ohne Ton weiterfahren */ }
  }

  window.addEventListener("keydown", (event) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (!state.active) {
      if ((event.key === "v" || event.key === "V") && !event.metaKey && !event.ctrlKey && !event.altKey) start();
      return;
    }
    if (event.key === "Escape") { stop(); return; }
    if (event.key === " ") { event.preventDefault(); ring(); return; }
    const key = KEYS[event.key];
    if (key) { event.preventDefault(); if (state.phase === "ride") keys.add(key); }
  });
  window.addEventListener("keyup", (event) => { const key = KEYS[event.key]; if (key) keys.delete(key); });
  window.addEventListener("blur", () => keys.clear());
  hud.querySelector("#ride-exit").addEventListener("click", stop);
  button?.addEventListener("click", () => (state.active ? stop() : start()));

  return { get active() { return state.active; }, start, stop, state };
}
