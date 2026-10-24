import { zurichParts } from "./sky.js";

const NO_DATA = "Keine aktuellen Daten";
const POLLEN = [
  ["alder_pollen", "Erle"], ["birch_pollen", "Birke"], ["grass_pollen", "Gräser"],
  ["mugwort_pollen", "Beifuss"], ["olive_pollen", "Olive"], ["ragweed_pollen", "Ambrosia"],
];

export function moonPhaseName(phase) {
  if (!Number.isFinite(phase)) return null;
  const normalized = ((phase % 1) + 1) % 1;
  return normalized < 0.03 || normalized > 0.97 ? "Neumond"
    : normalized < 0.22 ? "Zunehmende Sichel"
      : normalized < 0.28 ? "Erstes Viertel"
        : normalized < 0.47 ? "Zunehmender Mond"
          : normalized < 0.53 ? "Vollmond"
            : normalized < 0.72 ? "Abnehmender Mond"
              : normalized < 0.78 ? "Letztes Viertel" : "Abnehmende Sichel";
}

export function moonIllumination(phase) {
  if (!Number.isFinite(phase)) return null;
  const normalized = ((phase % 1) + 1) % 1;
  return (1 - Math.cos(2 * Math.PI * normalized)) / 2;
}

export function initTimeWeatherPanel(ctx) {
  const $ = (selector) => document.querySelector(selector);
  const panel = $("#sky-panel"), button = $("#clock-btn");
  const simulationTime = $("#simulation-time-controls"), simulationWeather = $("#simulation-weather-controls");
  const modeButtons = [...document.querySelectorAll("#display-mode [data-mode]")];
  const timeFormat = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
  const dateTimeFormat = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" });
  const dateFormat = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium" });
  const state = { mode: "live", simulation: null };
  ctx.timeWeatherMode = state.mode;
  let lastLiveMinute = "";
  let lastSimulationDate = "";

  const setText = (selector, value) => {
    const element = $(selector);
    if (element && element.textContent !== String(value)) element.textContent = String(value);
  };
  const fmt = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : NO_DATA;
  const sourceTime = (value) => typeof value === "string" ? value.replace("T", " ").slice(0, 16) : NO_DATA;
  const sourceDateTime = (value) => {
    const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1]}, ${match[4]}` : NO_DATA;
  };
  const sourceClock = (value) => typeof value === "string" && value.includes("T") ? value.slice(11, 16) : NO_DATA;
  const clockKey = (date) => {
    const p = zurichParts(date);
    return `${p.year}-${p.month}-${p.day}-${Math.floor(p.minutes / 1)}`;
  };
  const compass = (degrees) => {
    if (!Number.isFinite(degrees)) return NO_DATA;
    return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  };

  function openPanel(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function updateWeather() {
    const simulated = state.mode === "simulation";
    const clearMode = state.mode === "clear";
    $("#weather-model-metrics").hidden = simulated || clearMode;
    $("#weather-source-note").hidden = simulated || clearMode;
    $("#weather-info").hidden = simulated || clearMode;
    $("#weather-unavailable-note").hidden = !simulated;
    $("#clear-weather-summary").hidden = !clearMode;
    if (simulated) return;

    const live = ctx.weather?.state.live;
    if (clearMode) {
      const time = ctx.weather?.state.liveTime;
      const summary = live && time
        ? `Live-Modell · ${sourceDateTime(time)} · ${fmt(live.temperature_2m, 1)} °C · ${live.text}`
        : "Keine aktuellen Wettermodellwerte verfügbar.";
      setText("#clear-weather-summary", summary);
      return;
    }
    setText("#weather-temperature", Number.isFinite(live?.temperature_2m) ? `${fmt(live.temperature_2m, 1)} °C` : NO_DATA);
    setText("#weather-apparent", Number.isFinite(live?.apparent_temperature) ? `${fmt(live.apparent_temperature, 1)} °C` : NO_DATA);
    setText("#weather-humidity", Number.isFinite(live?.relative_humidity_2m) ? `${fmt(live.relative_humidity_2m)} %` : NO_DATA);
    setText("#weather-wind", Number.isFinite(live?.wind_speed_10m)
      ? `${fmt(live.wind_speed_10m)} km/h · ${compass(live.wind_direction_10m)}` : NO_DATA);
    setText("#weather-clouds", Number.isFinite(live?.cloud_cover) ? `${fmt(live.cloud_cover)} %` : NO_DATA);
    setText("#weather-description", live?.text ?? NO_DATA);
    const weatherNote = state.mode === "clear"
      ? "Aktuelle Modellwerte · nur Information, die Szene bleibt wetterunabhängig."
      : state.mode === "simulation"
        ? "Aktuelle Modellwerte für jetzt · nicht für das simulierte Datum."
        : "Modellwerte · Open-Meteo · CC BY 4.0";
    const weatherTime = ctx.weather?.state.liveTime;
    setText("#weather-source-note", `${weatherNote}${weatherTime ? ` · Modellzeit ${sourceTime(weatherTime)}` : ""}`);
  }

  function updateSolar() {
    const { times, altitude, azimuth } = ctx.solarDisplay ?? {};
    setText("#sunrise-value", times.rise ? timeFormat.format(times.rise) : NO_DATA);
    setText("#sunset-value", times.set ? timeFormat.format(times.set) : NO_DATA);
    setText("#sun-altitude-value", Number.isFinite(altitude) ? `${fmt(altitude)}°` : NO_DATA);
    setText("#sun-azimuth-value", Number.isFinite(azimuth) ? `${fmt(azimuth)}°` : NO_DATA);
    setText("#astronomy-source-note", state.mode === "clear"
      ? "Sonne astronomisch berechnet · Szene bleibt auf helles Tageslicht fixiert."
      : "Sonne astronomisch berechnet · Mondphase und Mondzeiten: Open-Meteo.");

    const daily = ctx.weather?.state.daily;
    const phase = daily?.moonPhase;
      if (!Number.isFinite(phase)) {
        setText("#moon-phase-value", NO_DATA);
        setText("#moon-light-value", NO_DATA);
      } else {
        setText("#moon-phase-value", moonPhaseName(phase));
        setText("#moon-light-value", `${Math.round(moonIllumination(phase) * 100)} % · berechnet`);
    }
    const moonTimes = daily
      ? `Mondaufgang ${sourceClock(daily.moonrise)} · Monduntergang ${sourceClock(daily.moonset)} · ${daily.date}`
      : "Mondaufgang und Monduntergang: Keine aktuellen Daten";
    setText("#moon-times-value", moonTimes);
  }

  function updateAirQuality() {
    const air = ctx.weather?.state.air;
    const current = air?.status === "ready" ? air.current : null;
    const setConcentration = (selector, key) => setText(selector,
      Number.isFinite(current?.[key]) ? `${fmt(current[key], 1)} μg/m³` : NO_DATA);
    const aqi = current?.european_aqi;
    const category = !Number.isFinite(aqi) ? NO_DATA : aqi < 20 ? "gut" : aqi < 40 ? "mässig" : aqi < 60 ? "mittel" : aqi < 80 ? "schlecht" : aqi <= 100 ? "sehr schlecht" : "extrem schlecht";
    setText("#air-aqi", Number.isFinite(aqi) ? `${fmt(aqi)} EAQI · ${category}` : NO_DATA);
    setConcentration("#air-pm25", "pm2_5");
    setConcentration("#air-pm10", "pm10");
    setConcentration("#air-ozone", "ozone");
    setText("#air-uv", Number.isFinite(current?.uv_index) ? fmt(current.uv_index, 1) : NO_DATA);

    const reportedPollen = POLLEN.flatMap(([key, label]) => Number.isFinite(current?.[key]) ? [{ key, label, value: current[key] }] : []);
    const highest = [...reportedPollen].sort((a, b) => b.value - a.value)[0];
    setText("#air-pollen", highest ? `${fmt(highest.value, 1)} Körner/m³ · ${highest.value === 0 ? "Modellwert" : highest.label}` : NO_DATA);
    const species = $("#pollen-species");
    species.replaceChildren();
    for (const [key, label] of POLLEN) {
      const row = document.createElement("div"), name = document.createElement("span"), value = document.createElement("strong");
      name.textContent = label;
      value.textContent = Number.isFinite(current?.[key]) ? `${fmt(current[key], 1)} Körner/m³` : NO_DATA;
      row.append(name, value);
      species.append(row);
    }
    const location = Number.isFinite(air?.latitude) && Number.isFinite(air?.longitude)
      ? ` · Rasterzentrum ${air.latitude.toFixed(3)}, ${air.longitude.toFixed(3)}${Number.isFinite(air.elevation) ? ` · ${Math.round(air.elevation)} m` : ""}` : "";
    const modelTime = air?.status === "ready" ? sourceTime(air.time) : NO_DATA;
    const fetched = air?.updatedAt ? timeFormat.format(new Date(air.updatedAt)) : "";
    setText("#air-source-note", `CAMS-Modell · Open-Meteo · ca. 11 km, nicht gebäudescharf · Modellzeit ${modelTime}${location}${fetched ? ` · Abfrage ${fetched}` : ""}`);
  }

  function renderClock() {
    if (state.mode === "live" && ctx.cancelTimeTransition) return;
    const now = new Date();
    const time = ctx.timeState;
    const modeLabels = { live: "Live", clear: "Hell & klar", simulation: "Simulation" };
    if (state.mode === "live") {
      $("#clock-time").textContent = timeFormat.format(now);
      $("#clock-wx").textContent = ctx.weather?.state.live
        ? `${Math.round(ctx.weather.state.live.temperature_2m)} °C · ${ctx.weather.state.live.text}` : NO_DATA;
      setText("#live-time-summary", `Ortszeit Brunnen · ${dateTimeFormat.format(now)}`);
    } else if (state.mode === "clear") {
      $("#clock-time").textContent = "Hell & klar";
      $("#clock-wx").textContent = "Standardansicht";
    } else {
      const currentTime = `${String(Math.floor(time.minutes / 60)).padStart(2, "0")}:${String(Math.floor(time.minutes % 60)).padStart(2, "0")}`;
      $("#clock-time").textContent = currentTime;
      $("#clock-wx").textContent = "Simulation";
    }
    button.setAttribute("aria-label", `Zeit und Wetter einstellen · ${modeLabels[state.mode]}`);
  }

  function updateTimeSectionDate() {
    const modeDate = state.mode === "simulation" ? ctx.simDate() : now;
  }

  function renderChrome() {
    const modeLabels = { live: "Live", clear: "Hell & klar", simulation: "Simulation" };
    modeButtons.forEach((modeButton) => modeButton.setAttribute("aria-pressed", String(modeButton.dataset.mode === state.mode)));
    simulationTime.hidden = state.mode !== "simulation";
    simulationTime.disabled = state.mode !== "simulation";
    simulationWeather.hidden = state.mode !== "simulation";
    simulationWeather.disabled = state.mode !== "simulation";
    $("#live-time-summary").hidden = state.mode !== "live";
    $("#clear-mode-summary").hidden = state.mode !== "clear";
    $("#solar-section").hidden = state.mode === "clear";
    $("#air-quality-section").hidden = state.mode === "clear";
    renderClock();
    const modeDate = state.mode === "simulation" ? ctx.simDate() : new Date();
    $("#time-section").setAttribute("aria-label", `${modeLabels[state.mode]} · ${dateFormat.format(modeDate)}`);
    if (state.mode === "simulation") lastSimulationDate = `${ctx.timeState.year}-${ctx.timeState.month}-${ctx.timeState.day}`;
  }

  function render() {
    renderChrome();
    updateWeather();
    updateSolar();
    updateAirQuality();
  }

  function syncWeatherRadios() {
    const preset = ctx.weather.state.preset;
    const effect = ctx.weather.state.effect ?? "none";
    $("#weather-mode").querySelectorAll("button").forEach((item) => item.setAttribute("aria-checked", String(item.dataset.k === preset)));
    $("#weather-effect-chips").querySelectorAll("button").forEach((item) => item.setAttribute("aria-checked", String(item.dataset.k === effect)));
  }

  function saveSimulation() {
    state.simulation = {
      time: { ...ctx.timeState, playing: false },
      weatherPreset: ctx.weather.state.preset,
      weatherEffect: ctx.weather.state.effect,
      weatherEffectsEnabled: ctx.weather.state.effects,
    };
  }

  function restoreSimulation() {
    if (!state.simulation) {
      ctx.setNow();
      ctx.weather.setPreset("live");
      return;
    }
    Object.assign(ctx.timeState, state.simulation.time, { playing: false });
    ctx.applyTime();
    ctx.weather.setPreset(state.simulation.weatherPreset);
    if (state.simulation.weatherEffect) ctx.weather.setEffect(state.simulation.weatherEffect);
    ctx.layers.setVisible("weather", state.simulation.weatherEffectsEnabled);
  }

  function setMode(mode) {
    if (!["live", "clear", "simulation"].includes(mode) || state.mode === mode) return;
    if (state.mode === "simulation") saveSimulation();
    ctx.cancelTimeTransition?.();
    ctx.stopTimePlayback?.();
    state.mode = mode;
    ctx.timeWeatherMode = mode;
    if (mode === "live") {
      ctx.setNow();
      ctx.weather.setPreset("live");
    } else if (mode === "clear") {
      ctx.setClearTime();
      ctx.weather.setPreset("clear");
    } else {
      restoreSimulation();
    }
    syncWeatherRadios();
    render();
  }

  function snapshot() {
    return {
      mode: state.mode,
      time: { ...ctx.timeState },
      weather: {
        preset: ctx.weather.state.preset,
        effect: ctx.weather.state.effect,
        effectsEnabled: ctx.weather.state.effects,
      },
    };
  }

  function setAnalysisClear() {
    setMode("clear");
    ctx.weather.setEffect(null);
    ctx.layers.setVisible("weather", false);
    syncWeatherRadios();
    render();
  }

  function restore(snapshotState, { restoreWeatherEffects = true } = {}) {
    if (!snapshotState) return;
    setMode(snapshotState.mode);
    if (snapshotState.mode === "simulation" && snapshotState.time) {
      const wasPlaying = snapshotState.time.playing;
      Object.assign(ctx.timeState, snapshotState.time, { playing: false });
      ctx.applyTime();
      if (wasPlaying) $("#btn-play").click();
    }
    ctx.weather.setPreset(snapshotState.weather.preset);
    ctx.weather.setEffect(snapshotState.weather.effect);
    if (restoreWeatherEffects) ctx.layers.setVisible("weather", snapshotState.weather.effectsEnabled);
    syncWeatherRadios();
    render();
  }

  modeButtons.forEach((modeButton) => modeButton.addEventListener("click", () => setMode(modeButton.dataset.mode)));
  button.addEventListener("click", () => openPanel(panel.hidden));
  $("#clock-close").addEventListener("click", () => { openPanel(false); button.focus({ preventScroll: true }); });
  document.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) openPanel(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      openPanel(false);
      button.focus({ preventScroll: true });
    }
  });

  lastLiveMinute = clockKey(new Date());
  ctx.scene3d.onFrame(() => {
    if (state.mode !== "live" || ctx.cancelTimeTransition || ctx.timeState.playing || ctx.history?.state.active) return;
    const now = new Date();
    const key = clockKey(now);
    if (key === lastLiveMinute) return;
    lastLiveMinute = key;
    ctx.setNow();
  });

  ctx.refreshTimeWeatherPanel = render;
  ctx.refreshWeatherPanel = () => { updateWeather(); if (state.mode === "live") renderClock(); };
  ctx.refreshAirQualityPanel = updateAirQuality;
  ctx.onTimeChange = () => {
    updateSolar();
    if (state.mode === "simulation") {
      const dateKey = `${ctx.timeState.year}-${ctx.timeState.month}-${ctx.timeState.day}`;
      if (dateKey !== lastSimulationDate) {
        lastSimulationDate = dateKey;
        const modeDate = ctx.simDate();
        $("#time-section").setAttribute("aria-label", `Simulation · ${dateFormat.format(modeDate)}`);
      }
    } else if (state.mode === "clear" || !ctx.cancelTimeTransition) {
      renderClock();
    }
  };
  render();
  syncWeatherRadios();
  return { state, setMode, render, snapshot, setAnalysisClear, restore };
}