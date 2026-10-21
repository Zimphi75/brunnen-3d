// Einstiegspunkt: lädt Daten, baut die Szene und verbindet die Module.
import * as THREE from "three";
import { createFrame, formatLv95, wgs84ToLv95 } from "./geo.js";
import { loadJson, loadOptionalJson, loadBinary, loadOptionalBinary, parseDem, parseBuildings, createProgress } from "./api.js";
import { createScene } from "./scene.js";
import { Terrain } from "./terrain.js";
import { Buildings, COLOR_MODES } from "./buildings.js";
import { createCameraRig, createPicker } from "./controls.js";
import { createLayerManager } from "./layers.js";
import { createInspector } from "./inspector.js";
import { createSky, zurichParts, zurichToDate } from "./sky.js";
import { initDataLayers } from "./features.js";
import { initPois } from "./pois.js";
import { initSearch } from "./search.js";
import { initAnalysis } from "./analysis.js";
import { initTransport } from "./transport.js";
import { initWeather } from "./weather.js";
import { initHistory } from "./history.js";

const $ = (selector) => document.querySelector(selector);
const errors = [];

function reportError(message, error) {
  console.error(message, error ?? "");
  errors.push(message);
  const banner = $("#error-banner");
  banner.hidden = false;
  banner.innerHTML = `<strong>Hinweis</strong><ul>${errors.map((m) => `<li>${m.replace(/[<>&]/g, "")}</li>`).join("")}</ul>`;
}

function setLoading(fraction, text) {
  $("#loading-bar").style.width = `${Math.round(fraction * 100)}%`;
  if (text) $("#loading-text").textContent = text;
}

const PRESETS = [
  { id: "gemeinde", label: "Gemeinde Ingenbohl", local: [0, 0], distance: 9500, heading: 15, tilt: 62 },
  { id: "bahnhof", label: "Brunnen Bahnhof", wgs: [46.9992, 8.6101], distance: 650, heading: 0, tilt: 58 },
  { id: "hafen", label: "Brunnen Hafen", wgs: [46.9936, 8.6053], distance: 750, heading: 20, tilt: 62 },
  { id: "kloster", label: "Kloster Ingenbohl", wgs: [46.9991, 8.6161], distance: 520, heading: 330, tilt: 58 },
];

async function start() {
  const progress = createProgress(setLoading)
    .add("meta", 0.5).add("dem", 1).add("terrain", 2).add("ortho", 2).add("buildings", 2);

  const meta = await loadJson("metadata.json");
  const frame = createFrame(meta);
  progress.finish("meta", "Gelände wird geladen …");

  const scene3d = createScene($("#scene"));
  const { scene, camera, controls } = scene3d;
  const ctx = { meta, frame, scene3d, errors, reportError, $ };

  const dem = parseDem(await loadBinary("dem.bin"), meta);
  progress.finish("dem", "Gelände wird aufgebaut …");

  const terrain = new Terrain(dem, frame);
  ctx.terrain = terrain;
  scene.add(terrain.group);
  const home = frame.toLocal(...Object.values(wgs84ToLv95(46.9992, 8.6101)));
  const textureLoader = new THREE.TextureLoader();
  const orthoPromise = textureLoader.loadAsync("public/data/ortho.jpg").then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
    terrain.setTexture(texture);
    ctx.orthoTexture = texture;
    progress.finish("ortho");
    return texture;
  }).catch((error) => { reportError("Luftbild (ortho.jpg) fehlt oder ist fehlerhaft. Pipeline: python -m pipeline.process_terrain", error); progress.finish("ortho"); });

  await terrain.build({ nearCenter: home, nearRadius: 2600, onProgress: (f) => setLoading(0.15 + 0.45 * f, "Gelände wird aufgebaut …") });
  progress.finish("terrain", "Gebäude werden geladen …");

  const [buildingBuffer, records, codes, addresses] = await Promise.all([
    loadOptionalBinary("buildings3d.bin"), loadOptionalJson("buildings.json"), loadOptionalJson("codes.json"), loadOptionalJson("addresses.json"),
  ]);
  let buildings = null;
  if (buildingBuffer && records) {
    try {
      buildings = new Buildings(parseBuildings(buildingBuffer, records.buildings), records.buildings);
      scene.add(buildings.mesh);
    } catch (error) { reportError(`Gebäudedaten fehlerhaft: ${error.message}`, error); }
  } else {
    reportError("Gebäudedaten fehlen. Pipeline: python -m pipeline.process_buildings");
  }
  progress.finish("buildings");
  await orthoPromise;
  Object.assign(ctx, { buildings, records: records?.buildings ?? [], codes: codes ?? {}, addresses: addresses ?? [] });

  await setupUi(ctx);
  $("#loading").classList.add("done");
  setTimeout(() => $("#loading").remove(), 700);
  window.brunnen = ctx; // Debug- und Testzugriff
}

async function setupUi(ctx) {
  const { scene3d, terrain, buildings, frame, meta } = ctx;
  const { camera, controls } = scene3d;

  const rig = createCameraRig({ camera, controls, terrain, onFrame: scene3d.onFrame });
  ctx.rig = rig;

  const presets = PRESETS.map((preset) => {
    const local = preset.local
      ? new THREE.Vector3(preset.local[0], 0, preset.local[1])
      : (({ e, n }) => { const p = frame.toLocal(e, n); return new THREE.Vector3(p.x, 0, p.z); })(wgs84ToLv95(...preset.wgs));
    return { ...preset, target: local, heading: THREE.MathUtils.degToRad(preset.heading), tilt: THREE.MathUtils.degToRad(preset.tilt) };
  });
  ctx.presets = presets;
  const select = $("#preset-select");
  select.innerHTML = presets.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  const goPreset = (id, instant = false) => {
    const preset = presets.find((p) => p.id === id);
    if (preset) rig.flyTo({ target: preset.target.clone(), distance: preset.distance, heading: preset.heading, tilt: preset.tilt, instant });
  };
  select.addEventListener("change", () => goPreset(select.value));
  $("#btn-reset").addEventListener("click", () => { select.value = "gemeinde"; goPreset("gemeinde"); });
  $("#btn-top").addEventListener("click", () => rig.topDown());
  $("#btn-oblique").addEventListener("click", () => rig.oblique());
  goPreset("gemeinde", true);

  const root = document.documentElement;
  const storedTheme = localStorage.getItem("brunnen3d-theme");
  root.dataset.theme = storedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#btn-theme").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("brunnen3d-theme", root.dataset.theme);
  });

  // Ebenen
  const layers = createLayerManager($("#layer-list"));
  ctx.layers = layers;
  layers.add({ id: "terrain", label: "Gelände", color: "#8a9a73", apply: (v) => { terrain.group.visible = v; } });
  layers.add({
    id: "aerial", label: "Luftbild", color: "#4f6f4a", available: Boolean(ctx.orthoTexture),
    note: "ortho.jpg fehlt", apply: (v) => terrain.setTexture(v ? ctx.orthoTexture : null),
  });
  layers.add({
    id: "buildings", label: "Gebäude", color: "#d8cfc0", available: Boolean(buildings), note: "buildings3d.bin fehlt",
    count: buildings ? buildings.data.count.toLocaleString("de-CH") : "", apply: (v) => { if (buildings) buildings.mesh.visible = v; },
  });

  await initDataLayers(ctx);

  // Gebäudefarben
  const modeBox = $("#color-mode");
  const legendBox = $("#color-legend");
  const renderLegend = () => {
    legendBox.innerHTML = (buildings?.legend() ?? []).map((e) => e.note
      ? `<div class="note">${e.note}</div>`
      : `<div class="item"><span class="swatch" style="background:${e.color}"></span>${e.label}</div>`).join("");
  };
  modeBox.innerHTML = COLOR_MODES.map((m) => `<button type="button" data-mode="${m.id}" role="radio">${m.label}</button>`).join("");
  const markMode = () => modeBox.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === buildings?.mode);
    b.setAttribute("aria-checked", String(b.dataset.mode === buildings?.mode));
  });
  modeBox.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !buildings) return;
    buildings.setColorMode(button.dataset.mode);
    markMode(); renderLegend();
  });
  markMode();

  // Inspector, Hover, Auswahl
  const addressesByBuilding = new Map();
  ctx.addresses.forEach(([label, , , index]) => {
    if (index >= 0) { if (!addressesByBuilding.has(index)) addressesByBuilding.set(index, []); addressesByBuilding.get(index).push(label); }
  });
  ctx.addressesByBuilding = addressesByBuilding;
  const inspector = createInspector({
    panel: $("#inspector"), body: $("#inspector-body"), closeButton: $("#inspector-close"), codes: ctx.codes,
    onClose: () => buildings?.select(-1),
  });
  ctx.inspector = inspector;

  const selectBuilding = (index) => {
    buildings.select(index);
    inspector.showBuilding(ctx.records[index], { addresses: addressesByBuilding.get(index) ?? [], elevationOffset: frame.elevationOffset });
  };
  ctx.selectBuilding = selectBuilding;

  const providers = [];
  if (buildings) providers.push({ kind: "building", enabled: () => buildings.mesh.visible, pick: (ray) => buildings.pick(ray) });
  ctx.providers = providers;
  ctx.clickHandlers = [];

  const status = $("#statusbar");
  let statusText = "";
  const canvas = $("#scene");
  createPicker({
    canvas, camera, terrain, providers,
    onHover({ hit, ground }) {
      buildings?.hover(hit?.kind === "building" ? hit.index : -1);
      canvas.style.cursor = hit ? "pointer" : "";
      const point = hit?.point ?? ground;
      if (point) {
        const { e, n } = frame.toLV95(point.x, point.z);
        statusText = `LV95 ${formatLv95(e, n)} · ${Math.round(frame.elevation(point.y))} m ü. M.`;
      }
    },
    onClick({ hit, ground, ray }, event) {
      for (const handler of ctx.clickHandlers) if (handler({ hit, ground, ray, event })) return;
      if (hit?.kind === "building") selectBuilding(hit.index);
      else if (hit?.kind === "poi") { buildings?.select(-1); ctx.showPoi(hit.index); }
      else if (hit?.kind === "stop") { buildings?.select(-1); ctx.showStop(hit.index); }
      else if (hit?.kind === "vehicle") { buildings?.select(-1); ctx.showVehicle(hit.mesh); }
      else if (!hit) { buildings?.select(-1); inspector.hide(); }
    },
  });
  let lastStatus = 0;
  scene3d.onFrame((_, now) => {
    if (now - lastStatus < 500) return;
    lastStatus = now;
    status.textContent = `${statusText}${statusText ? " · " : ""}${scene3d.fps.toFixed(0)} fps`;
  });

  // Sonne und Zeit
  const [lon, lat] = [8.6136, 47.0045];
  const sky = createSky({ scene: scene3d.scene, renderer: scene3d.renderer, camera, latitude: lat, longitude: lon });
  ctx.sky = sky;
  scene3d.onFrame((delta, _now, distance) => sky.update(controls.target, distance));

  const slider = $("#time-slider"), label = $("#time-label"), dateInput = $("#date-input"), sunInfo = $("#sun-info");
  const state = { year: 0, month: 0, day: 0, minutes: 0, playing: false };
  const pad = (n) => String(n).padStart(2, "0");
  const timeFormat = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
  const applyTime = () => {
    const date = zurichToDate(state.year, state.month, state.day, state.minutes);
    sky.setDate(date);
    slider.value = String(Math.round(state.minutes));
    label.textContent = `${pad(Math.floor(state.minutes / 60))}:${pad(Math.floor(state.minutes % 60))}`;
    dateInput.value = `${state.year}-${pad(state.month)}-${pad(state.day)}`;
    const times = sky.times(date);
    const altitude = (sky.state.altitude * 180 / Math.PI);
    const azimuth = (((sky.state.azimuth * 180 / Math.PI) + 180) % 360 + 360) % 360;
    sunInfo.textContent = `Sonne ${altitude.toFixed(0)}° / ${azimuth.toFixed(0)}°` + (times.rise ? ` · ↑ ${timeFormat.format(times.rise)} ↓ ${timeFormat.format(times.set)}` : "");
  };
  const setNow = () => {
    const now = zurichParts(new Date());
    Object.assign(state, { year: now.year, month: now.month, day: now.day, minutes: now.minutes });
    applyTime();
  };
  slider.addEventListener("input", () => { state.minutes = Number(slider.value); applyTime(); });
  dateInput.addEventListener("change", () => {
    const [y, m, d] = dateInput.value.split("-").map(Number);
    if (y) { Object.assign(state, { year: y, month: m, day: d }); applyTime(); }
  });
  $("#btn-now").addEventListener("click", setNow);
  const play = $("#btn-play");
  play.addEventListener("click", () => {
    state.playing = !state.playing;
    play.textContent = state.playing ? "❚❚" : "▶";
    play.classList.toggle("on", state.playing);
  });
  scene3d.onFrame((delta) => {
    if (!state.playing) return;
    state.minutes = (state.minutes + delta * 20) % 1440; // 1 s = 20 min
    applyTime();
  });
  setNow();
  ctx.timeState = state;
  ctx.applyTime = applyTime;

  await initPois(ctx);
  await initTransport(ctx);
  await initSearch(ctx);
  initAnalysis(ctx);
  initWeather(ctx);
  initHistory(ctx);

  renderLegend();
  console.info(`Brunnen 3D bereit: ${buildings?.stats().buildings ?? 0} Gebäude, ${terrain.stats().triangles} Geländedreiecke`);
}

start().catch((error) => {
  reportError(`Start fehlgeschlagen: ${error.message}`, error);
  $("#loading-text").textContent = "Start fehlgeschlagen.";
});
