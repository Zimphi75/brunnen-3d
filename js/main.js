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
import { initParcels } from "./parcels.js";
import { initPois } from "./pois.js";
import { initTransport } from "./transport.js";
import { initLighting } from "./lighting.js";
import { initPv } from "./pv.js";
import { initRegister } from "./register.js";
import { initSearch } from "./search.js";
import { initAnalysis } from "./analysis.js";
import { initWeather } from "./weather.js";
import { initHistory } from "./history.js";
import { initHires } from "./hires.js";
import { initGround } from "./ground.js";
import { initAmbient } from "./ambient.js";
import { initAlmanac } from "./almanac.js";
import { buildLocationRating } from "./location-rating.js";
import { fetchBuildingEnvironment } from "./environment.js";
import { initDemographicLayers } from "./demographics.js";

const $ = (selector) => document.querySelector(selector);
const errors = [];
const lowPower = matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
const LOADING_MESSAGES = [
  "Die Höhenlinien bekommen noch ihre Frisur.",
  "Wir zählen die Häuser. Die letzten stehen etwas verstreut.",
  "Die Bäume ordnen ihre Kronen.",
  "Ein paar Berge rücken noch ins Bild.",
  "Die Daten nehmen den schönen Umweg.",
];
let loadingMessageTimer;

function startLoadingMessages() {
  const note = $("#loading-note");
  let index = 0;
  const update = () => { note.textContent = LOADING_MESSAGES[index++ % LOADING_MESSAGES.length]; };
  update();
  loadingMessageTimer = setInterval(update, 2600);
}

function animateNightToLive(ctx) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const endDate = ctx.simDate();
  const endParts = zurichParts(endDate);
  let startDate = zurichToDate(endParts.year, endParts.month, endParts.day, 4 * 60);
  if (startDate >= endDate) {
    const previousDay = zurichParts(new Date(endDate.getTime() - 36 * 3600 * 1000));
    startDate = zurichToDate(previousDay.year, previousDay.month, previousDay.day, 4 * 60);
  }
  Object.assign(ctx.timeState, zurichParts(startDate));
  ctx.applyTime();

  const duration = 10;
  let elapsed = 0, lastUpdate = 0, removeFrame = () => {};
  const interrupt = () => {
    removeFrame();
    for (const [id, event] of [["#time-slider", "input"], ["#date-input", "change"], ["#btn-now", "click"], ["#btn-play", "click"]]) {
      $(id).removeEventListener(event, interrupt);
    }
  };
  const onFrame = (delta) => {
    elapsed = Math.min(duration, elapsed + delta);
    if (elapsed - lastUpdate < 0.1 && elapsed < duration) return;
    lastUpdate = elapsed;
    const t = elapsed / duration;
    const eased = t * t * (3 - 2 * t);
    const time = new Date(startDate.getTime() + (endDate.getTime() - startDate.getTime()) * eased);
    Object.assign(ctx.timeState, zurichParts(time));
    ctx.applyTime();
    if (t >= 1) interrupt();
  };
  removeFrame = ctx.scene3d.onFrame(onFrame);
  for (const [id, event] of [["#time-slider", "input"], ["#date-input", "change"], ["#btn-now", "click"], ["#btn-play", "click"]]) {
    $(id).addEventListener(event, interrupt);
  }
}

function reportError(message, error) {
  console.error(message, error ?? "");
  errors.push(message);
  const banner = $("#error-banner");
  banner.hidden = false;
  banner.innerHTML = `<strong>Hinweis</strong><ul>${errors.map((m) => `<li>${m.replace(/[<>&]/g, "")}</li>`).join("")}</ul>`;
  setTimeout(() => { if (errors.length === 1) banner.hidden = true; }, 12000);
}

function setLoading(fraction, text) {
  $("#loading-bar").style.width = `${Math.round(fraction * 100)}%`;
  if (text) $("#loading-text").textContent = text;
}

const PRESETS = [
  { id: "gemeinde", label: "Gemeinde Ingenbohl", local: [0, 0], distance: 7000, heading: 15, tilt: 62 },
  { id: "bahnhof", label: "Brunnen Bahnhof", wgs: [46.9992, 8.6101], distance: 650, heading: 0, tilt: 58 },
  { id: "hafen", label: "Brunnen Hafen", wgs: [46.9936, 8.6053], distance: 750, heading: 20, tilt: 62 },
  { id: "kloster", label: "Kloster Ingenbohl", wgs: [46.9991, 8.6161], distance: 520, heading: 330, tilt: 58 },
];

async function start() {
  const started = performance.now();
  startLoadingMessages();
  const progress = createProgress(setLoading).add("meta", 0.5).add("dem", 1).add("terrain", 2).add("ortho", 2).add("buildings", 2);

  const meta = await loadJson("metadata.json");
  const frame = createFrame(meta);
  progress.finish("meta", "Gelände wird geladen …");

  const scene3d = createScene($("#scene"));
  if (lowPower) scene3d.settings.ambientOcclusion = false;
  const ctx = { meta, frame, scene3d, errors, reportError, $, lowPower };

  const dem = parseDem(await loadBinary("dem.bin"), meta);
  progress.finish("dem", "Gelände wird aufgebaut …");

  const terrain = new Terrain(dem, frame);
  ctx.terrain = terrain;
  scene3d.scene.add(terrain.group);
  scene3d.panBounds = { minX: terrain.minX, maxX: terrain.minX + terrain.width, minZ: terrain.maxZ - terrain.depth, maxZ: terrain.maxZ };
  const home = frame.toLocal(...Object.values(wgs84ToLv95(46.9992, 8.6101)));
  const orthoPromise = new THREE.TextureLoader().loadAsync("public/data/ortho.jpg").then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
    terrain.setTexture(texture);
    ctx.orthoTexture = texture;
    progress.finish("ortho");
  }).catch((error) => { reportError("Luftbild (ortho.jpg) fehlt oder ist fehlerhaft. Pipeline: python -m pipeline.process_terrain", error); progress.finish("ortho"); });

  await terrain.build({ nearCenter: home, nearRadius: lowPower ? 900 : 1500, onProgress: (f) => setLoading(0.15 + 0.45 * f, "Gelände wird aufgebaut …") });
  progress.finish("terrain", "Gebäude werden geladen …");

  const [buildingBuffer, records, codes, addresses] = await Promise.all([
    loadOptionalBinary("buildings3d.bin"), loadOptionalJson("buildings.json"), loadOptionalJson("codes.json"), loadOptionalJson("addresses.json"),
  ]);
  let buildings = null;
  if (buildingBuffer && records) {
    try {
      buildings = new Buildings(parseBuildings(buildingBuffer, records.buildings), records.buildings, codes ?? {});
      scene3d.scene.add(buildings.mesh);
    } catch (error) { reportError(`Gebäudedaten fehlerhaft: ${error.message}`, error); }
  } else {
    reportError("Gebäudedaten fehlen. Pipeline: python -m pipeline.process_buildings");
  }
  progress.finish("buildings");
  await orthoPromise;
  Object.assign(ctx, { buildings, records: records?.buildings ?? [], codes: codes ?? {}, addresses: addresses ?? [] });

  await setupUi(ctx);
  animateNightToLive(ctx);
  ctx.readyAt = performance.now() - started;
  const originView = ctx.presets.find((preset) => preset.id === "gemeinde");
  const destination = new THREE.Vector3(-50, ctx.terrain.heightAt(-50, 400) ?? 0, 400);
  ctx.rig.spiralTo({
    startTarget: originView.target.clone(), startDistance: originView.distance, startHeading: originView.heading, startTilt: originView.tilt,
    target: destination, distance: 1400, heading: originView.heading, tilt: THREE.MathUtils.degToRad(40), duration: 10, turns: 1,
    instant: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  clearInterval(loadingMessageTimer);
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
  const home = () => { select.value = "gemeinde"; goPreset("gemeinde"); };
  $("#btn-reset").addEventListener("click", home);
  $("#btn-top").addEventListener("click", () => rig.topDown());
  $("#btn-oblique").addEventListener("click", () => rig.oblique());
  $("#btn-rotate-ccw").addEventListener("click", () => rig.rotate(-90));
  $("#btn-rotate-cw").addEventListener("click", () => rig.rotate(90));
  const initialView = presets.find((preset) => preset.id === "gemeinde");
  rig.flyTo({ target: initialView.target.clone(), distance: initialView.distance, heading: initialView.heading, tilt: initialView.tilt, instant: true });

  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem("brunnen3d-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#btn-theme").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("brunnen3d-theme", root.dataset.theme);
  });

  // Ebenen
  const layers = createLayerManager($("#layer-list"));
  ctx.layers = layers;
  layers.add({ id: "terrain", label: "Gelände", color: "#8a9a73", apply: (v) => { terrain.group.visible = v; } });
  layers.add({
    id: "buildings", label: "Gebäude", color: "#d8cfc0", available: Boolean(buildings), note: "buildings3d.bin fehlt",
    count: buildings ? (buildings.data.count - buildings.stats().hiddenDemolished).toLocaleString("de-CH") : "", apply: (v) => { if (buildings) buildings.mesh.visible = v; },
  });
  await initDataLayers(ctx);
  await initParcels(ctx);

  // Darstellung (Gebäudefarben)
  const modeSelect = $("#color-mode"), legendBox = $("#color-legend");
  modeSelect.innerHTML = COLOR_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
  const renderLegend = () => {
    legendBox.innerHTML = (buildings?.legend() ?? []).map((e) => e.note
      ? `<div class="note">${e.note}</div>`
      : `<div class="item"><span class="swatch" style="background:${e.color}"></span>${e.label}</div>`).join("");
  };
  modeSelect.disabled = !buildings;
  modeSelect.addEventListener("change", () => { buildings.setColorMode(modeSelect.value); renderLegend(); });

  // Inspector, Hover, Auswahl
  const addressesByBuilding = new Map();
  ctx.addresses.forEach(([label, , , index]) => {
    if (index >= 0) { if (!addressesByBuilding.has(index)) addressesByBuilding.set(index, []); addressesByBuilding.get(index).push(label); }
  });
  ctx.addressesByBuilding = addressesByBuilding;
  const inspector = createInspector({ panel: $("#inspector"), body: $("#inspector-body"), closeButton: $("#inspector-close"), codes: ctx.codes, onClose: () => { buildings?.select(-1); ctx.parcels?.selectBuilding(-1); } });
  ctx.inspector = inspector;
  const environmentalCache = new Map();
  const demographicCache = new Map();
  let environmentalRequestId = 0;
    const classPeers = new Map();
    ctx.records.forEach((record) => {
      const classCode = record.gwr?.class;
      if (!record.inMunicipality || !classCode) return;
      if (!classPeers.has(classCode)) classPeers.set(classCode, []);
      classPeers.get(classCode).push(record);
    });
    const buildingComparison = (record) => {
      const peers = classPeers.get(record.gwr?.class) ?? [];
      const definitions = [["Grundfläche GWR", "footprintAreaGwr", "m²", 0], ["Geschosse", "floors", "", 0], ["Wohnungen", "dwellings", "", 0]];
      const metrics = definitions.flatMap(([label, key, unit, digits]) => {
        const value = record.gwr?.[key];
        const values = peers.map((peer) => peer.gwr?.[key]).filter(Number.isFinite).sort((a, b) => a - b);
        if (!Number.isFinite(value) || values.length < 10) return [];
        const atOrBelow = values.filter((peerValue) => peerValue <= value).length;
        const bins = key === "footprintAreaGwr"
          ? [...Array.from({ length: 10 }, (_, i) => ({ min: i * 100, max: (i + 1) * 100, label: `${i * 100}-${(i + 1) * 100}` })), { min: 1000, max: Infinity, label: "1'000+" }]
          : key === "floors"
            ? [...Array.from({ length: 10 }, (_, i) => ({ min: i + 1, max: i + 2, label: String(i + 1) })), { min: 11, max: Infinity, label: "11+" }]
            : [{ min: 0, max: 1, label: "0" }, { min: 1, max: 3, label: "1-2" }, ...Array.from({ length: 4 }, (_, i) => ({ min: i + 3, max: i + 4, label: String(i + 3) })), { min: 7, max: 9, label: "7-8" }, { min: 9, max: 11, label: "9-10" }, { min: 11, max: 16, label: "11-15" }, { min: 16, max: 21, label: "16-20" }, { min: 21, max: Infinity, label: "21+" }];
        const histogram = bins.map((bin) => ({ ...bin, count: values.filter((peerValue) => peerValue >= bin.min && peerValue < bin.max).length, selected: value >= bin.min && value < bin.max }));
        const mean = values.reduce((sum, peerValue) => sum + peerValue, 0) / values.length;
        const deviation = Math.sqrt(values.reduce((sum, peerValue) => sum + (peerValue - mean) ** 2, 0) / values.length);
        const skewness = deviation ? values.reduce((sum, peerValue) => sum + ((peerValue - mean) / deviation) ** 3, 0) / values.length : 0;
        const distribution = skewness > 0.8 ? "rechtsschief" : skewness < -0.8 ? "linksschief" : "annähernd symmetrisch";
        return [{ label, value, unit, digits, percentile: Math.round((100 * atOrBelow) / values.length), median: values[Math.floor(values.length / 2)], count: values.length, histogram, distribution }];
      });
      if (!metrics.length) return null;
      return { group: ctx.codes.GKLAS?.[record.gwr.class] ?? `GWR-Klasse ${record.gwr.class}`, count: peers.length, metrics };
    };
    const nearbyForBuilding = (record) => {
      if (!ctx.pois || !ctx.transport?.stops) return [];
      const point = frame.toLocal(record.center[0], record.center[1]);
      const closest = (items, predicate) => items.filter(predicate).map((item) => ({ item, distance: Math.round(Math.hypot(item.x - point.x, item.z - point.z)) })).sort((a, b) => a.distance - b.distance)[0];
      const results = [];
      const supermarket = closest(ctx.pois, (poi) => poi.s === "supermarket");
      if (supermarket) results.push({ label: "Supermarkt", name: supermarket.item.n, distance: supermarket.distance });
      for (const [mode, label] of [["bus", "Bushaltestelle"], ["train", "Bahnhof"]]) {
        const stop = closest(ctx.transport.stops, (entry) => entry.m === mode);
        if (stop) results.push({ label, name: stop.item.n, distance: stop.distance });
      }
      return results;
    };
  ctx.selectBuilding = (index) => {
    buildings.select(index);
    ctx.parcels?.selectBuilding(index);
    const record = ctx.records[index];
    const requestId = ++environmentalRequestId;
    const demographicCellKey = `${Math.floor(record.center[0] / 100) * 100}:${Math.floor(record.center[1] / 100) * 100}`;
    const cacheKey = record.egid ?? record.id;
    const osmSource = ctx.sources?.datasets?.find((dataset) => dataset.title.startsWith("OpenStreetMap"));
    inspector.showBuilding(record, {
      addresses: addressesByBuilding.get(index) ?? [], elevationOffset: frame.elevationOffset, pv: ctx.pv?.byBuilding.get(index) ?? [],
      comparison: buildingComparison(record), nearby: nearbyForBuilding(record), gwrExportDate: meta.statistics?.gwrExportDate,
      rating: buildLocationRating({ record, frame, pois: ctx.pois ?? [], stops: ctx.transport?.stops ?? [], places: ctx.places ?? [], osmSource }),
      environmental: { status: "loading", indicators: [] },
      demographics: { status: "loading" },
    });
    let environmental = environmentalCache.get(cacheKey);
    if (!environmental) {
      environmental = fetchBuildingEnvironment(record.center);
      environmentalCache.set(cacheKey, environmental);
    }
    void environmental.then((result) => {
      if (requestId === environmentalRequestId) inspector.updateBuildingEnvironment(result);
    });
    let demographics = demographicCache.get(demographicCellKey);
    if (!demographics) {
      demographics = ctx.demographics.forBuilding(record).catch(() => ({ population: null, employment: null, cellSizeM: 100, bounds: null, geometry: null }));
      demographicCache.set(demographicCellKey, demographics);
    }
    void demographics.then((result) => {
      if (requestId === environmentalRequestId) inspector.updateBuildingDemographics({ ...result, status: "ready" });
    });
  };

  const providers = [];
  if (buildings) providers.push({ kind: "building", enabled: () => buildings.mesh.visible, pick: (ray) => buildings.pick(ray) });
  ctx.providers = providers;
  ctx.clickHandlers = [];
  initDemographicLayers(ctx);
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
      buildings?.select(-1);
      ctx.parcels?.selectBuilding(-1);
      if (hit?.kind === "building") ctx.selectBuilding(hit.index);
      else if (hit?.kind === "poi") ctx.showPoi(hit.index);
      else if (hit?.kind === "stop") ctx.showStop(hit.index);
      else if (hit?.kind === "vehicle") ctx.showVehicle(hit.mesh);
      else if (hit?.kind === "register") ctx.showRegisterOnly(hit.index);
      else if (!hit) inspector.hide();
    },
  });
  let lastStatus = 0;
  scene3d.onFrame((_, now) => {
    if (now - lastStatus < 500) return;
    lastStatus = now;
    status.textContent = `${statusText}${statusText ? " · " : ""}${scene3d.fps.toFixed(0)} fps`;
  });

  // Sonne und Zeit
  const [lat, lon] = [47.0045, 8.6136];
  const sky = createSky({ scene: scene3d.scene, renderer: scene3d.renderer, camera, latitude: lat, longitude: lon, shadowMapSize: lowPower ? 2048 : 4096 });
  ctx.sky = sky;
  scene3d.onFrame((delta, _now, distance) => sky.update(controls.target, distance));

  const slider = $("#time-slider"), label = $("#time-label"), dateInput = $("#date-input"), sunInfo = $("#sun-info");
  const state = { year: 0, month: 0, day: 0, minutes: 0, playing: false };
  const pad = (n) => String(n).padStart(2, "0");
  const timeFormat = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
  ctx.simDate = () => zurichToDate(state.year, state.month, state.day, state.minutes);
  const applyTime = () => {
    const date = ctx.simDate();
    sky.setDate(date);
    const clock = `${pad(Math.floor(state.minutes / 60))}:${pad(Math.floor(state.minutes % 60))}`;
    slider.value = String(Math.round(state.minutes));
    label.textContent = clock;
    $("#clock-time").textContent = clock;
    dateInput.value = `${state.year}-${pad(state.month)}-${pad(state.day)}`;
    const times = sky.times(date);
    const altitude = sky.state.altitude * 180 / Math.PI;
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
  const clockButton = $("#clock-btn"), skyPanel = $("#sky-panel");
  clockButton.addEventListener("click", () => { skyPanel.hidden = !skyPanel.hidden; clockButton.setAttribute("aria-expanded", String(!skyPanel.hidden)); });
  setNow();
  ctx.timeState = state;
  ctx.applyTime = applyTime;

  await initPois(ctx);
  await initTransport(ctx);
  await initLighting(ctx);
  await initPv(ctx);
  await initRegister(ctx);
  await initSearch(ctx);
  initAnalysis(ctx);
  initHires(ctx);
  initGround(ctx);
  initAmbient(ctx);
  initHistory(ctx);

  // Wetter: Vorgaben als Auswahl, Anzeige im Zeitfeld
  ctx.onWeatherChange = ({ live, source, preset, condition }) => {
    const temp = live ? `${live.temperature_2m.toFixed(0)} °C` : "";
    let text = "kein Wetter";
    if (source === "preset") text = `Vorschau · ${ctx.weather.PRESETS[preset].label}`;
    else if (source === "live") text = `${temp} · ${condition.text}`;
    else if (source === "outside") text = "Wetter nur für jetzt";
    $("#clock-wx").textContent = text;
  };
  initWeather(ctx);
  const chips = $("#weather-chips");
  chips.innerHTML = Object.entries(ctx.weather.PRESETS).map(([key, p]) => `<button type="button" role="radio" data-k="${key}" aria-checked="${key === "live"}">${p.label}</button>`).join("");
  chips.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    ctx.weather.setPreset(button.dataset.k);
    chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === button)));
  });

  layers.add({ id: "shadows", label: "Schattenwurf", color: "#555", visible: true, apply: (v) => sky.setShadows(v) });
  layers.add({ id: "ao", label: "Ambient Occlusion", color: "#777", visible: scene3d.hasAmbientOcclusion && !lowPower, available: scene3d.hasAmbientOcclusion, note: "Nicht verfügbar", apply: (v) => { scene3d.settings.ambientOcclusion = v; } });
  await initAlmanac(ctx);

  window.addEventListener("keydown", (event) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (event.key === "q" || event.key === "Q") rig.rotate(-20);
    else if (event.key === "e" || event.key === "E") rig.rotate(20);
    else if (event.key === "t" || event.key === "T") rig.topDown();
    else if (event.key === "h" || event.key === "H") home();
    else if (event.key === "/") { event.preventDefault(); $("#search-input").focus(); }
  });

  ctx.performanceReport = async (seconds = 2) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return {
      fps: Math.round(scene3d.fps), ...scene3d.renderInfo(), terrain: terrain.stats(), buildings: buildings?.stats(),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, readyAfterMs: Math.round(ctx.readyAt ?? 0),
    };
  };
  renderLegend();
  void meta;
  console.info(`Brunnen 3D bereit: ${buildings?.stats().buildings ?? 0} Gebäude, ${terrain.stats().triangles} Geländedreiecke`);
}

start().catch((error) => {
  clearInterval(loadingMessageTimer);
  reportError(`Start fehlgeschlagen: ${error.message}`, error);
  $("#loading-text").textContent = "Start fehlgeschlagen.";
});
