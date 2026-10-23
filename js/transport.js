// Öffentlicher Verkehr: Haltestellen, Linien, Abfahrten (Fahrplan/Echtzeitprognose) und Fahrplansimulation.
// Gemessene Fahrzeugpositionen stehen über die offene API nicht zur Verfügung; simulierte Fahrzeuge sind klar gekennzeichnet.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";
import { wgs84ToLv95 } from "./geo.js";
import { buildRibbons } from "./draped.js";
import { model, MODEL_MATERIAL } from "./models.js";
import { zurichParts } from "./sky.js";
import { roadsidePosition } from "./roadmarks.js";

const API = "https://transport.opendata.ch/v1";
const MODE = {
  train: { label: "Bahn", color: "#d62828" },
  bus: { label: "Bus", color: "#f0a500" },
  ferry: { label: "Schiff", color: "#1d70b8" },
};
const cache = new Map();

async function apiGet(path, ttl = 60000) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.time < ttl) return hit.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cache.set(path, { time: Date.now(), data });
    return data;
  } finally { clearTimeout(timer); }
}

const clock = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });

export const fetchStationboard = (station, extra = "") => apiGet(`/stationboard?station=${encodeURIComponent(station)}&limit=12${extra}`);

function nearestOnPolyline(flat, x, z) {
  let best = { distance: Infinity, arc: 0 }, arc = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const [x0, z0, x1, z1] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
    const dx = x1 - x0, dz = z1 - z0, length = Math.hypot(dx, dz) || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (length * length)));
    const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
    if (d < best.distance) best = { distance: d, arc: arc + t * length };
    arc += length;
  }
  return best;
}

function pointAtArc(flat, target) {
  let arc = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const dx = flat[i + 2] - flat[i], dz = flat[i + 3] - flat[i + 1], length = Math.hypot(dx, dz);
    if (arc + length >= target) { const t = (target - arc) / (length || 1); return { x: flat[i] + dx * t, z: flat[i + 1] + dz * t, heading: Math.atan2(dx, dz) }; }
    arc += length;
  }
  return null;
}

/** Lage und Ausrichtung eines Haltestellenmodells: Front zeigt zur Strasse, zum Gleis oder (Schiff) zum See. */
export function stopPlacement(stop, terrain, ctx) {
  let { x, z } = stop;
  let heading = 0;
  if (stop.m === "bus") {
    const roadside = roadsidePosition(x, z, ctx.roads, ctx.roadIndex, 25);
    x = roadside.x;
    z = roadside.z;
    const road = ctx.roadIndex?.nearest(x, z, 25);
    if (road) heading = Math.atan2(road.x - x, road.z - z);
  } else if (stop.m === "train") {
    const rail = ctx.railIndex?.nearest(x, z, 40);
    if (rail) {
      const nx = -rail.tz, nz = rail.tx;
      const side = rail.distance > 2 ? Math.sign((x - rail.x) * nx + (z - rail.z) * nz) || 1 : 1;
      x = rail.x + nx * side * 3.6; z = rail.z + nz * side * 3.6; // Bahnsteig neben dem Gleis
      heading = Math.atan2(-nx * side, -nz * side);
    }
  } else if (stop.m === "ferry") {
    let best = { h: Infinity, dx: 0, dz: 1 };
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      const h = terrain.heightAt(x + dx * 30, z + dz * 30);
      if (h !== null && h < best.h) best = { h, dx, dz };
    }
    heading = Math.atan2(best.dx, best.dz);
    x -= best.dx * 8; z -= best.dz * 8; // Steg beginnt am Ufer
  }
  const ground = terrain.heightAt(x, z) ?? 0;
  return { x, z, y: stop.m === "ferry" ? ground + 0.1 : ground, heading };
}

export async function initTransport(ctx) {
  const { scene3d, terrain, frame, layers } = ctx;
  const data = await loadOptionalJson("transport.json");
  const stops = data?.stops ?? [];
  const lines = data?.lines ?? [];
  ctx.transport = { stops, lines };
  const scene = scene3d.scene;

  // Linien
  const lineGroup = new THREE.Group();
  scene3d.aoExcluded.add(lineGroup);
  for (const [mode, style] of Object.entries(MODE)) {
    const polylines = lines.filter((l) => l.m === mode).flatMap((l) => l.lines);
    if (!polylines.length) continue;
    const mesh = new THREE.Mesh(
      buildRibbons(polylines, { width: mode === "train" ? 4.5 : 3.5, lift: 0.6 + (mode === "train" ? 0.1 : 0), terrain, step: 10 }),
      new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: mode === "bus" ? 0.8 : 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    mesh.renderOrder = 6;
    lineGroup.add(mesh);
  }
  layers.add({
    id: "transport-lines", label: "ÖV-Linien", color: "#d62828", available: lines.length > 0, note: "transport.json fehlt", count: lines.length ? String(lines.length) : "", visible: false,
    apply: (v) => { lineGroup.visible = v; if (v && !lineGroup.parent) scene.add(lineGroup); },
  });

  // Haltestellen als Modelle: Mast mit Haltestellenschild und Fahrplan (Wartehäuschen nur, wenn OSM es verzeichnet), Bahnsteig, Schiffsteg.
  const stopGroup = new THREE.Group();
  const placements = stops.map((stop) => stopPlacement(stop, terrain, ctx));
  const stopPositions = placements.map((p) => new THREE.Vector3(p.x, p.y + 2.2, p.z));
  const variants = new Map();
  stops.forEach((stop, i) => {
    const key = stop.m === "bus" ? `bus:${stop.shelter}:${stop.bench}` : stop.m;
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(i);
  });
  const matrix = new THREE.Matrix4(), axis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [key, members] of variants) {
    const [mode, shelter, bench] = key.split(":");
    const geometry = mode === "bus" ? model("busStop", { shelter: shelter === "true", bench: bench === "true" }) : mode === "train" ? model("trainPlatform") : model("ferryPier");
    const mesh = new THREE.InstancedMesh(geometry, MODEL_MATERIAL, members.length);
    members.forEach((stopIndex, slot) => {
      const p = placements[stopIndex];
      matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(axis, p.heading), one);
      mesh.setMatrixAt(slot, matrix);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stopGroup.add(mesh);
  }
  layers.add({
    id: "stops", label: "Haltestellen", color: "#f0a500", available: stops.length > 0, note: "transport.json fehlt", count: stops.length ? String(stops.length) : "", visible: true,
    apply: (v) => { stopGroup.visible = v; if (v && !stopGroup.parent) scene.add(stopGroup); },
  });

  const closest = new THREE.Vector3();
  ctx.providers.push({
    kind: "stop", enabled: () => stopGroup.visible,
    pick(ray) {
      let best = null;
      stopPositions.forEach((position, index) => {
        const along = ray.direction.dot(closest.copy(position).sub(ray.origin));
        if (along < 0) return;
        const tolerance = Math.max(8, along * 0.014);
        if (ray.distanceSqToPoint(position) < tolerance * tolerance && (!best || along < best.distance)) best = { index, distance: along, point: position.clone() };
      });
      return best;
    },
  });

  async function showStop(index) {
    const stop = stops[index];
    const render = (extra) => ctx.inspector.render({
      title: stop.name ?? stop.n, sub: `${MODE[stop.m].label}-Haltestelle`,
      tags: [{ text: MODE[stop.m].label }],
      sections: extra.sections ?? [], links: extra.links ?? [],
      source: "Lage: OpenStreetMap-Mitwirkende (ODbL). Abfahrten: transport.opendata.ch (opentransportdata.swiss)",
    });
    render({ sections: [[["Abfahrten", "werden geladen …"]]] });
    try {
      const board = await fetchStationboard(stop.n);
      const resolved = board.station?.name ?? stop.n;
      const rows = board.stationboard.slice(0, 8).map((journey) => {
        const planned = journey.stop.departure;
        const predicted = journey.stop.prognosis?.departure;
        const time = clock.format(new Date(predicted ?? planned));
        const delay = journey.stop.delay ? ` (+${journey.stop.delay} min)` : "";
        const kind = predicted ? "Echtzeitprognose" : "Fahrplan";
        const label = `${journey.category ?? ""}${journey.number ?? ""} ${journey.to}`.trim();
        return [`${time}${delay}`, `${label}${journey.stop.platform ? ` · Gl./Kante ${journey.stop.platform}` : ""} <span class="tag">${kind}</span>`, true];
      });
      render({
        sections: [[["Zuordnung", `API-Haltestelle: ${resolved}`]], rows.length ? rows : [["Abfahrten", "keine in den nächsten Stunden"]]],
        links: [{ label: "Fahrplan SBB", href: `https://www.sbb.ch/de?stops=${encodeURIComponent(resolved)}` }],
      });
    } catch (error) {
      render({ sections: [[["Abfahrten", "momentan nicht verfügbar (Netzwerk oder API)"]]] });
      console.warn("Stationboard:", error);
    }
  }
  ctx.showStop = showStop;

  // Fahrplansimulation
  const vehicles = new THREE.Group();
  const simulated = { journeys: [], loaded: false, loading: false };
  const railLines = lines.filter((l) => l.m === "train").flatMap((l) => l.lines);
  const busLines = lines.filter((l) => l.m === "bus").flatMap((l) => l.lines);
  const ferryLines = lines.filter((l) => l.m === "ferry").flatMap((l) => l.lines);
  const polylinesFor = { train: railLines, bus: busLines, ferry: ferryLines };

  function lv95Local(coordinate) {
    const { e, n } = wgs84ToLv95(coordinate.x, coordinate.y);
    const p = frame.toLocal(e, n);
    return { x: p.x, z: p.z };
  }

  async function loadJourneys() {
    if (simulated.loading) return;
    simulated.loading = true;
    const now = zurichParts(new Date(Date.now() - 25 * 60000));
    const stamp = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")} ${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}`;
    const stations = [["Brunnen", "train"], ["Brunnen (See)", "ferry"], ["Brunnen, Bahnhof", "bus"]];
    const journeys = [];
    for (const [station, mode] of stations) {
      try {
        const board = await apiGet(`/stationboard?station=${encodeURIComponent(station)}&limit=30&datetime=${encodeURIComponent(stamp)}`, 5 * 60000);
        for (const journey of board.stationboard) {
          const pass = (journey.passList ?? []).filter((p) => p.station?.coordinate?.x && (p.departure || p.arrival));
          if (pass.length < 2) continue;
          journeys.push({ mode, name: `${journey.category ?? ""}${journey.number ?? ""}`.trim(), to: journey.to, pass: pass.map((p) => ({ ...lv95Local(p.station.coordinate), name: p.station.name, arrival: Date.parse(p.arrival ?? p.departure), departure: Date.parse(p.departure ?? p.arrival) })) });
        }
      } catch (error) { console.warn(`Fahrplansimulation (${station}):`, error); }
    }
    simulated.journeys = journeys; simulated.loaded = true; simulated.loading = false;
    simulated.nextLoad = Date.now() + 5 * 60000;
  }

  function positionOf(journey, time) {
    for (let i = 0; i + 1 < journey.pass.length; i++) {
      const a = journey.pass[i], b = journey.pass[i + 1];
      if (time < a.departure || time > b.arrival) continue;
      const t = (time - a.departure) / Math.max(1, b.arrival - a.departure);
      const polylines = polylinesFor[journey.mode];
      let best = null;
      for (const poly of polylines) {
        const pa = nearestOnPolyline(poly, a.x, a.z), pb = nearestOnPolyline(poly, b.x, b.z);
        const fit = Math.max(pa.distance, pb.distance);
        if (fit < 250 && (!best || fit < best.fit)) best = { poly, pa, pb, fit };
      }
      if (journey.mode === "ferry" && !best) return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, b.z - a.z), from: a.name, to: b.name };
      if (!best) return null; // ohne passende Liniengeometrie nicht zeichnen
      const point = pointAtArc(best.poly, best.pa.arc + (best.pb.arc - best.pa.arc) * t);
      return point && { ...point, from: a.name, to: b.name };
    }
    return null;
  }

  const meshes = new Map();
  let enabled = false;
  scene3d.onFrame(() => {
    if (!enabled) return;
    if (!simulated.loaded) { loadJourneys(); return; }
    if (Date.now() > simulated.nextLoad) loadJourneys();
    const time = Date.now();
    const alive = new Set();
    simulated.journeys.forEach((journey, id) => {
      const position = positionOf(journey, time);
      if (!position) return;
      alive.add(id);
      let mesh = meshes.get(id);
      if (!mesh) {
        const geometry = journey.mode === "train" ? model("sbbTrain", 3) : journey.mode === "bus" ? model("postBus") : model("lakeShip");
        mesh = new THREE.Mesh(geometry, MODEL_MATERIAL);
        mesh.castShadow = true; mesh.userData.journey = journey;
        vehicles.add(mesh); meshes.set(id, mesh);
      }
      const ground = terrain.heightAt(position.x, position.z) ?? 0;
      mesh.position.set(position.x, ground + (journey.mode === "ferry" ? -0.4 : journey.mode === "train" ? 0.4 : 0.05), position.z);
      mesh.rotation.y = position.heading;
      mesh.userData.position = position;
    });
    for (const [id, mesh] of meshes) if (!alive.has(id)) { vehicles.remove(mesh); meshes.delete(id); }
  });
  layers.add({
    id: "vehicles", label: "Fahrzeuge (Fahrplansimulation)", color: "#8e44ad", visible: true, available: lines.length > 0,
    note: "Positionen aus dem Fahrplan berechnet, keine Live-Daten",
    apply: (v) => { enabled = v; vehicles.visible = v; if (v && !vehicles.parent) scene.add(vehicles); },
  });
  ctx.providers.push({
    kind: "vehicle", enabled: () => enabled,
    pick(ray) {
      let best = null;
      for (const mesh of meshes.values()) {
        const along = ray.direction.dot(closest.copy(mesh.position).sub(ray.origin));
        if (along < 0) continue;
        const tolerance = Math.max(12, along * 0.015);
        if (ray.distanceSqToPoint(mesh.position) < tolerance * tolerance && (!best || along < best.distance)) best = { mesh, distance: along, point: mesh.position.clone() };
      }
      return best;
    },
  });
  ctx.showVehicle = (mesh) => {
    const { journey, position } = mesh.userData;
    ctx.inspector.render({
      title: `${journey.name} nach ${journey.to}`, sub: `${MODE[journey.mode].label} · Fahrplanbasierte Simulation`,
      tags: [{ text: "Simulierte Position, keine Live-Position", warn: true }],
      sections: [[["Abschnitt", `${position.from} → ${position.to}`], ["Methode", "lineare Interpolation der Fahrplanzeiten entlang der OSM-Liniengeometrie"], ["Echtzeit", "nicht berücksichtigt (keine Verspätungen)"]]],
      source: "Fahrplan: transport.opendata.ch (opentransportdata.swiss); Liniengeometrie: OpenStreetMap",
    });
  };
}
