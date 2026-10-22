// Jahresfilter und neutrale Zeitreise fuer den heutigen registrierten Gebaeudebestand.
import { buildYear, isDemolished } from "./buildings.js";

export const YEAR_MIN = 1850;
export const SLOWDOWN_YEAR = 1980;

export function automaticTimeSpeed(year) {
  const progress = Math.max(0, Math.min(1, (year - YEAR_MIN) / (SLOWDOWN_YEAR - YEAR_MIN)));
  return 0.5 + 2.5 * (1 - progress) ** 2;
}

export function buildingVisibleAtYear(record, year) {
  const date = buildYear(record);
  return Boolean(date && (date.from ?? YEAR_MIN) <= year);
}

export function initHistory(ctx) {
  const { $, buildings, terrain, layers, scene3d } = ctx;
  const panel = $("#time-travel-panel");
  const slider = $("#timeline-slider"), yearLabel = $("#timeline-year"), countLabel = $("#timeline-count");
  const mapLabel = $("#timeline-map"), playButton = $("#timeline-play"), speedSelect = $("#timeline-speed");
  const infoPanel = $("#timeline-info"), infoButton = $("#timeline-info-toggle");
  const yearMax = new Date().getFullYear();
  const state = { year: yearMax, progressYear: yearMax, playing: false, speed: 1, autoSpeed: 0.5, active: false };
  let saved = null;
  const rateOutput = $("#timeline-rate");

  function updateRate() {
    state.autoSpeed = automaticTimeSpeed(state.progressYear) * state.speed;
    const label = `${state.autoSpeed.toFixed(1)}×`;
    if (rateOutput.textContent !== label) rateOutput.textContent = label;
  }

  if (!buildings) {
    const timeTravelButton = $("#details-time-travel");
    if (timeTravelButton) timeTravelButton.disabled = true;
    $("[data-quick='timeline']").disabled = true;
    ctx.history = { state, enter() {}, exit() {} };
    return;
  }

  const uniforms = terrain.uniforms;

  function applyModernLayers() {
    const showCurrentSimulations = state.year >= yearMax && saved;
    for (const id of ["ambient", "vehicles"]) {
      const visible = Boolean(showCurrentSimulations && saved.layers[id]);
      if (layers.isVisible(id) !== visible) layers.setVisible(id, visible);
    }
  }

  function applyYear() {
    const visible = buildings.applyFilter((record) => buildingVisibleAtYear(record, state.year));
    buildings.setTimeTravel(state.progressYear, state.active && state.progressYear < yearMax);
    const arrived = ctx.records.filter((record) => {
      const date = buildYear(record);
      const earliest = date?.from ?? YEAR_MIN;
      return !isDemolished(record) && date && earliest > 1900 && earliest <= state.year;
    }).length;
    yearLabel.textContent = String(state.year);
    slider.value = String(state.progressYear);
    countLabel.textContent = `${visible.toLocaleString("de-CH")} Gebäude sichtbar · ${arrived.toLocaleString("de-CH")} hinzugekommen seit 1900`;
    applyModernLayers();
    if (state.active) mapLabel.textContent = "Neutraler Geländeboden · keine historischen Karten";
  }

  function setYear(year) {
    state.progressYear = Math.max(YEAR_MIN, Math.min(yearMax, Number(year)));
    const nextYear = Math.floor(state.progressYear);
    if (nextYear !== state.year) {
      state.year = nextYear;
      applyYear();
    } else {
      yearLabel.textContent = String(state.year);
      slider.value = String(state.progressYear);
      buildings.setTimeTravel(state.progressYear, state.active && state.progressYear < yearMax);
    }
    updateRate();
  }

  function enter() {
    if (state.active) return;
    saved = {
      layers: layers.snapshot(),
      ground: ctx.ground?.state.mode ?? "sim",
      colorMode: $("#color-mode").value,
      buildingFilter: buildings.lastPredicate,
      cameraPosition: scene3d.camera.position.clone(),
      cameraTarget: scene3d.controls.target.clone(),
      damping: scene3d.controls.enableDamping,
      time: { ...ctx.timeState },
      weatherPreset: ctx.weather?.state.preset ?? "live",
      weatherEffect: ctx.weather?.state.effect ?? null,
      neutralGround: uniforms.uNeutralGround.value,
      inspector: {
        visible: !$("#inspector").hidden,
        selectedBuilding: buildings.selected,
        content: $("#inspector-body").innerHTML,
        className: $("#inspector-body").className,
      },
    };
    state.active = true;
    state.playing = false;
    ctx.rig?.stop();
    ctx.cancelTimeTransition?.();
    const view = ctx.rig?.currentView();
    if (view) {
      scene3d.controls.enableDamping = false;
      const fade = $("#scene-transition");
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduceMotion) fade.classList.add("is-covering");
      ctx.rig.flyTo({ target: scene3d.controls.target.clone(), distance: Math.min(view.distance, 3200), heading: view.heading, tilt: Math.PI / 180, instant: true });
      if (!reduceMotion) requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove("is-covering")));
    }
    state.year = yearMax;
    state.progressYear = yearMax;
    $("#layers-panel").hidden = true;
    $("#quick-panel").hidden = true;
    $("#sky-panel").hidden = true;
    $("#inspector").hidden = true;
    buildings.select(-1);
    ctx.parcels?.selectBuilding(-1);
    $("#clock-btn").setAttribute("aria-expanded", "false");
    panel.hidden = false;
    $("#timeline-year-display").hidden = false;
    infoPanel.hidden = true;
    infoButton.setAttribute("aria-expanded", "false");
    document.body.classList.add("time-travel-active");
    uniforms.uNeutralGround.value = 1;
    uniforms.uSplit.value = 0;
    mapLabel.textContent = "Neutraler Geländeboden · keine historischen Karten";
    ctx.setClearTime?.();
    ctx.weather?.setPreset("clear");
    $("#weather-mode").querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.k === "clear")));
    $("#weather-effect-chips").querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.k === "none")));
    for (const layer of layers.entries()) {
      if (layer.id !== "terrain" && layer.id !== "buildings" && layer.visible) layers.setVisible(layer.id, false);
    }
    ctx.setNeutralLake?.(true);
    layers.setVisible("terrain", true);
    layers.setVisible("buildings", true);
    const colorMode = $("#color-mode");
    colorMode.value = "dorf";
    colorMode.dispatchEvent(new Event("change", { bubbles: true }));
    applyYear();
  }

  function stopPlayback() {
    state.playing = false;
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "Zeitreise abspielen");
    playButton.title = "Abspielen";
  }

  function exit() {
    if (!state.active || !saved) return;
    const restore = saved;
    stopPlayback();
    state.active = false;
    ctx.rig?.stop();
    $("#scene-transition").classList.remove("is-covering");
    scene3d.camera.position.copy(restore.cameraPosition);
    scene3d.controls.target.copy(restore.cameraTarget);
    scene3d.controls.enableDamping = restore.damping;
    scene3d.controls.update();
    panel.hidden = true;
    $("#timeline-year-display").hidden = true;
    infoPanel.hidden = true;
    infoButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("time-travel-active");
    uniforms.uSplit.value = 0;
    uniforms.uNeutralGround.value = restore.neutralGround;
    buildings.setTimeTravel(yearMax, false);
    $("#color-mode").value = restore.colorMode;
    $("#color-mode").dispatchEvent(new Event("change", { bubbles: true }));
    Object.assign(ctx.timeState, restore.time);
    ctx.applyTime?.();
    const timePlay = $("#btn-play");
    timePlay.textContent = ctx.timeState.playing ? "❚❚" : "▶";
    timePlay.classList.toggle("on", ctx.timeState.playing);
    ctx.weather?.setPreset(restore.weatherPreset);
    if (restore.weatherEffect) ctx.weather?.setEffect(restore.weatherEffect);
    $("#weather-mode").querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.k === restore.weatherPreset)));
    $("#weather-effect-chips").querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.k === (restore.weatherEffect ?? "none"))));
    buildings.applyFilter(restore.buildingFilter ?? null);
    if (ctx.ground?.state.mode !== restore.ground) void ctx.ground?.set(restore.ground);
    ctx.setNeutralLake?.(false);
    layers.restore(restore.layers);
    if (restore.inspector.visible) {
      if (restore.inspector.selectedBuilding >= 0) ctx.selectBuilding(restore.inspector.selectedBuilding);
      else {
        $("#inspector-body").innerHTML = restore.inspector.content;
        $("#inspector-body").className = restore.inspector.className;
        $("#inspector").hidden = false;
      }
    }
    saved = null;
  }

  slider.min = String(YEAR_MIN);
  slider.max = String(yearMax);
  slider.addEventListener("input", () => { stopPlayback(); setYear(Number(slider.value)); });
  speedSelect.addEventListener("change", () => { state.speed = Number(speedSelect.value) || 1; });
  playButton.addEventListener("click", () => {
    if (!state.active) return;
    if (state.playing) { stopPlayback(); return; }
    if (state.year >= yearMax) setYear(YEAR_MIN);
    state.speed = Number(speedSelect.value) || 1;
    updateRate();
    state.playing = true;
    playButton.textContent = "Ⅱ";
    playButton.setAttribute("aria-label", "Zeitreise pausieren");
    playButton.title = "Pause";
  });
  $("#timeline-restart").addEventListener("click", () => { stopPlayback(); setYear(YEAR_MIN); });
  $("#timeline-exit").addEventListener("click", exit);
  infoButton.addEventListener("click", () => {
    infoPanel.hidden = !infoPanel.hidden;
    infoButton.setAttribute("aria-expanded", String(!infoPanel.hidden));
  });

  scene3d.onFrame((delta) => {
    if (!state.active || !state.playing) return;
    state.autoSpeed = automaticTimeSpeed(state.progressYear) * state.speed;
    const label = `${state.autoSpeed.toFixed(1)}×`;
    if (rateOutput.textContent !== label) rateOutput.textContent = label;
    setYear(state.progressYear + delta * state.autoSpeed * 5);
    if (state.progressYear >= yearMax) {
      stopPlayback();
    }
  });

  ctx.history = { state, enter, exit, setYear };
  const timeTravelButton = $("#details-time-travel");
  if (timeTravelButton) timeTravelButton.disabled = false;
  $("[data-quick='timeline']").disabled = false;
}
