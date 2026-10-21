// Zeitachse: Gebäude nach Baujahr filtern, Wachstum abspielen, historische Karten (swisstopo Zeitreise) und Vergleich.
import * as THREE from "three";
import { buildYear } from "./buildings.js";

const WMS = "https://wms.geo.admin.ch/";
const MAP_YEARS = [1864, 1880, 1900, 1925, 1950, 1970, 1990, 2010, 2021];
const YEAR_MIN = 1850;

export function initHistory(ctx) {
  const { $, buildings, terrain, meta, reportError, layers, scene3d } = ctx;
  const box = $("#history-box");
  if (!buildings) { box.innerHTML = '<p class="note">Keine Gebäudedaten verfügbar.</p>'; return; }

  const knownYears = ctx.records.map((r) => buildYear(r)).filter(Boolean);
  const exact = knownYears.filter((y) => y.exact).length;
  const yearMax = new Date().getFullYear();
  const state = { year: yearMax, showUnknown: true, playing: false, mapYear: null, split: 0.5 };

  box.innerHTML = `
    <label class="layer-row"><input type="checkbox" id="hist-filter"><span class="name">Gebäude bis Jahr</span><output id="hist-year" class="count num">${yearMax}</output></label>
    <input type="range" id="hist-slider" min="${YEAR_MIN}" max="${yearMax}" step="1" value="${yearMax}" aria-label="Baujahr bis" style="width:100%" disabled>
    <label class="layer-row"><input type="checkbox" id="hist-unknown" checked><span class="name">Gebäude ohne Baujahr zeigen</span></label>
    <div class="seg"><button type="button" id="hist-play">Wachstum abspielen</button></div>
    <p class="note" id="hist-count"></p>
    <h2 style="margin-top:12px">Historische Karte</h2>
    <select id="hist-map" aria-label="Historische Karte" style="width:100%"><option value="">Aktuelles Luftbild</option>${MAP_YEARS.map((y) => `<option value="${y}">Landeskarte Stand ${y}</option>`).join("")}</select>
    <label class="layer-row"><input type="checkbox" id="hist-compare" disabled><span class="name">Vergleich mit heute (Trennlinie)</span></label>
    <p class="note" id="hist-note">Baujahre stammen aus dem GWR (${exact} exakt, übrige nur als Bauperiode). Gebäude ohne GWR-Angabe lassen sich nicht datieren. Historische Gebäude werden nicht rekonstruiert.</p>`;

  const filterBox = $("#hist-filter"), slider = $("#hist-slider"), yearOutput = $("#hist-year"), unknownBox = $("#hist-unknown");
  const count = $("#hist-count");

  function apply() {
    const active = filterBox.checked;
    slider.disabled = !active;
    yearOutput.textContent = active ? String(state.year) : "alle";
    const visible = buildings.applyFilter(active ? (record) => {
      const info = buildYear(record);
      return info ? info.year <= state.year : state.showUnknown;
    } : null);
    count.textContent = active ? `${visible.toLocaleString("de-CH")} von ${ctx.records.length.toLocaleString("de-CH")} Gebäuden sichtbar (Bauperioden: Periodenmitte).` : "";
  }
  filterBox.addEventListener("change", apply);
  unknownBox.addEventListener("change", () => { state.showUnknown = unknownBox.checked; apply(); });
  let pending = null;
  slider.addEventListener("input", () => {
    state.year = Number(slider.value);
    yearOutput.textContent = String(state.year);
    clearTimeout(pending);
    pending = setTimeout(apply, 60);
  });
  const playButton = $("#hist-play");
  playButton.addEventListener("click", () => {
    state.playing = !state.playing;
    playButton.textContent = state.playing ? "Anhalten" : "Wachstum abspielen";
    if (state.playing) { filterBox.checked = true; if (state.year >= yearMax) state.year = YEAR_MIN; }
    apply();
  });
  let lastStep = 0;
  scene3d.onFrame((_, now) => {
    if (!state.playing || now - lastStep < 140) return;
    lastStep = now;
    state.year += 2;
    if (state.year >= yearMax) { state.year = yearMax; state.playing = false; playButton.textContent = "Wachstum abspielen"; }
    slider.value = String(state.year);
    apply();
  });

  // Historische Karte als zweite Terraintextur; Trennlinie vergleicht links (Geschichte) und rechts (heute).
  const uniforms = terrain.uniforms;

  const compareBox = $("#hist-compare"), mapSelect = $("#hist-map"), note = $("#hist-note");
  const divider = document.createElement("div");
  divider.id = "compare-divider";
  divider.hidden = true;
  divider.innerHTML = '<span aria-hidden="true">↔</span>';
  $("#app").append(divider);

  function placeDivider() {
    const width = scene3d.renderer.domElement.clientWidth;
    divider.style.left = `${state.split * width}px`;
    const size = scene3d.renderer.getDrawingBufferSize(new THREE.Vector2());
    uniforms.uResolution.value.copy(size);
    uniforms.uSplit.value = state.mapYear ? (compareBox.checked ? state.split : 1.01) : 0;
    divider.hidden = !(state.mapYear && compareBox.checked);
  }
  scene3d.onFrame(() => { if (state.mapYear) placeDivider(); });
  let dragging = false;
  divider.addEventListener("pointerdown", (event) => { dragging = true; divider.setPointerCapture(event.pointerId); });
  divider.addEventListener("pointermove", (event) => { if (dragging) { state.split = Math.min(0.97, Math.max(0.03, event.clientX / scene3d.renderer.domElement.clientWidth)); placeDivider(); } });
  divider.addEventListener("pointerup", () => { dragging = false; });
  compareBox.addEventListener("change", placeDivider);

  const [minE, minN, maxE, maxN] = meta.ortho.extent;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const textures = new Map();
  async function loadMap(year) {
    if (textures.has(year)) return textures.get(year);
    const params = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "ch.swisstopo.zeitreihen", STYLES: "", SRS: "EPSG:2056",
      BBOX: `${minE},${minN},${maxE},${maxN}`, WIDTH: String(meta.ortho.width), HEIGHT: String(meta.ortho.height), FORMAT: "image/jpeg", TIME: `${year}1231`,
    });
    const texture = await loader.loadAsync(`${WMS}?${params}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
    textures.set(year, texture);
    return texture;
  }
  mapSelect.addEventListener("change", async () => {
    const year = Number(mapSelect.value) || null;
    state.mapYear = null;
    placeDivider();
    compareBox.disabled = true;
    if (!year) { note.textContent = note.dataset.base; return; }
    layers.setVisible("aerial", true);
    note.textContent = `Karte ${year} wird geladen …`;
    try {
      uniforms.uHistory.value = await loadMap(year);
      state.mapYear = year;
      compareBox.disabled = false;
      placeDivider();
      note.textContent = `Landeskarte, Stand bis ${year} (swisstopo Zeitreise). Je Blatt gilt die neueste Ausgabe bis zu diesem Jahr; Abdeckung und Genauigkeit variieren.`;
    } catch (error) {
      mapSelect.value = "";
      reportError(`Historische Karte ${year} konnte nicht geladen werden (swisstopo-WMS nicht erreichbar oder Bildgrösse nicht unterstützt).`, error);
      note.textContent = note.dataset.base;
    }
  });
  note.dataset.base = note.textContent;
  ctx.history = { state, apply };
  apply();
}
