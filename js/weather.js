// Wetter: Open-Meteo live (nur für «jetzt») oder Vorgaben. Wirkt im ganzen Blickfeld:
// Himmel und Nebel global, Niederschlag als Bildschirm-Overlay plus 3D-Partikelvolumen, das mit dem Kameraabstand mitwächst.
import * as THREE from "three";

const API = "https://api.open-meteo.com/v1/forecast?latitude=47.0045&longitude=8.6136&timezone=Europe%2FZurich"
  + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,is_day"
  + "&daily=sunrise,sunset,moonrise,moonset,moon_phase&forecast_days=1";
const AIR_API = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=47.0045&longitude=8.6136&timezone=Europe%2FZurich"
  + "&current=european_aqi,pm2_5,pm10,ozone,uv_index,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen";
const AIR_REFRESH_MS = 60 * 60 * 1000;

const CODE_TEXT = {
  0: "klar", 1: "überwiegend klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel",
  51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 56: "gefrierender Nieselregen", 57: "starker gefrierender Nieselregen",
  61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefrierender Regen", 67: "starker gefrierender Regen",
  71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel",
  80: "leichte Regenschauer", 81: "Regenschauer", 82: "heftige Regenschauer", 85: "leichte Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit starkem Hagel",
};
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export function weatherCondition(current) {
  const code = current.weather_code;
  return {
    text: CODE_TEXT[code] ?? `Code ${code}`,
    rain: RAIN_CODES.has(code) || current.rain > 0,
    snow: SNOW_CODES.has(code) || current.snowfall > 0,
    fog: code === 45 || code === 48,
    storm: code >= 95,
    cloud: (current.cloud_cover ?? 0) / 100,
    heavy: [65, 67, 75, 82, 86, 99].includes(code),
  };
}

export const PRESETS = {
  live: { label: "Live" },
  clear: { label: "Klar", current: { weather_code: 0, cloud_cover: 5 } },
  cloudy: { label: "Bewölkt", current: { weather_code: 3, cloud_cover: 95 } },
  rain: { label: "Regen", current: { weather_code: 63, cloud_cover: 100 } },
  snow: { label: "Schnee", current: { weather_code: 73, cloud_cover: 100 } },
  fog: { label: "Nebel", current: { weather_code: 45, cloud_cover: 100 } },
  storm: { label: "Gewitter", current: { weather_code: 95, cloud_cover: 100 } },
};

function addEffect(base, effect) {
  if (!effect) return base;
  const simulated = weatherCondition(PRESETS[effect].current);
  const condition = base ?? weatherCondition(PRESETS.clear.current);
  return {
    ...condition,
    text: simulated.text,
    rain: condition.rain || simulated.rain,
    snow: condition.snow || simulated.snow,
    fog: condition.fog || simulated.fog,
    storm: condition.storm || simulated.storm,
    cloud: Math.max(condition.cloud, simulated.cloud),
    heavy: condition.heavy || simulated.heavy,
  };
}

/** Live-Wetter gilt nur nahe an der aktuellen Zeit; für andere Zeitpunkte gibt es keine Messung. */
export const LIVE_WINDOW_MS = 2 * 3600 * 1000;

const VERTEX = `
uniform vec3 uCenter; uniform float uR; uniform float uTime; uniform float uFall; uniform float uLen; uniform float uWind; uniform float uSize;
attribute vec3 aSeed; attribute float aEnd;
void main(){
  float y = fract(aSeed.y - uTime * uFall / (1.4 * uR));
  vec3 world = uCenter + vec3((aSeed.x - 0.5) * 2.0 * uR, (y - 0.15) * 1.4 * uR, (aSeed.z - 0.5) * 2.0 * uR);
  world.x += uWind * (1.0 - y) * 0.15 * uR;
  world += vec3(uWind * 0.35, 1.0, 0.0) * aEnd * uLen;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 260.0 / max(1.0, -mv.z), 1.5, 6.0);
}`;
const FRAGMENT = "uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, uOpacity); }";

function particleSystem(count, asLines) {
  const geometry = new THREE.BufferGeometry();
  const per = asLines ? 2 : 1, verts = count * per;
  const seeds = new Float32Array(verts * 3), ends = new Float32Array(verts);
  for (let i = 0; i < count; i++) {
    const seed = [Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < per; k++) { seeds.set(seed, (i * per + k) * 3); ends[i * per + k] = asLines ? k : 0; }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
  const uniforms = {
    uCenter: { value: new THREE.Vector3() }, uR: { value: 200 }, uTime: { value: 0 }, uFall: { value: 50 }, uLen: { value: 3 },
    uWind: { value: 0.1 }, uSize: { value: 1 }, uColor: { value: new THREE.Color(0xaec6e0) }, uOpacity: { value: 0.4 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
  const object = asLines ? new THREE.LineSegments(geometry, material) : new THREE.Points(geometry, material);
  object.frustumCulled = false;
  object.visible = false;
  return { object, uniforms };
}

export function initWeather(ctx) {
  const { $, scene3d, sky, layers } = ctx;
  const info = $("#weather-info");
  const state = {
    live: null, liveTime: null, daily: null,
    air: { status: "loading", current: null, time: null, latitude: null, longitude: null, elevation: null, updatedAt: null },
    preset: "live", effect: null, effects: true, flash: 0, condition: null, source: "none",
  };

  const rain = particleSystem(9000, true), snow = particleSystem(5000, false);
  for (const p of [rain, snow]) { scene3d.scene.add(p.object); scene3d.aoExcluded.add(p.object); }
  snow.uniforms.uColor.value.set(0xffffff);

  // Bildschirm-Overlay: deckt das ganze Blickfeld ab, unabhängig vom Kameraabstand.
  const overlay = document.createElement("canvas");
  overlay.id = "weather-overlay";
  $("#app").insertBefore(overlay, $("#labels"));
  const g = overlay.getContext("2d");
  const drops = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.8 }));
  const flash = $("#flash");
  function fitOverlay() { overlay.width = overlay.clientWidth; overlay.height = overlay.clientHeight; }
  new ResizeObserver(fitOverlay).observe(overlay);
  fitOverlay();

  const simDate = () => ctx.simDate?.() ?? new Date();

  function effective() {
    let result;
    if (state.preset === "clear") result = { condition: weatherCondition(PRESETS.clear.current), source: "clear" };
    else if (state.live && Math.abs(simDate() - Date.now()) <= LIVE_WINDOW_MS) result = { condition: weatherCondition(state.live), source: "live" };
    else result = { condition: null, source: state.live ? "outside" : "none" };
    if (state.effect) result = { condition: addEffect(result.condition, state.effect), source: "simulation" };
    return result;
  }

  let lastUpdate = 0, intensity = 0, mode = "none";
  scene3d.onFrame((delta, now, distance) => {
    if (now - lastUpdate > 500) {
      lastUpdate = now;
      const { condition, source } = effective();
      state.condition = condition; state.source = source;
      const on = state.effects && condition;
      sky.setCloudCover(on ? condition.cloud : 0);
      sky.setFogBoost(on && condition.fog ? 1 : 0);
      mode = on ? (condition.snow ? "snow" : condition.rain ? "rain" : "none") : "none";
      intensity = on ? (condition.heavy ? 1 : condition.snow || condition.rain ? 0.7 : 0) : 0;
      describe();
    }
    const R = THREE.MathUtils.clamp(distance * 0.8, 70, 1600);
    const center = scene3d.controls.target;
    const wind = Math.min(0.5, (state.live?.wind_speed_10m ?? 5) / 60);
    for (const [system, kind] of [[rain, "rain"], [snow, "snow"]]) {
      const show = mode === kind && distance < 5000;
      system.object.visible = show;
      if (!show) continue;
      const u = system.uniforms;
      u.uCenter.value.set(center.x, center.y + R * 0.2, center.z);
      u.uR.value = R; u.uTime.value += delta; u.uWind.value = wind;
      u.uFall.value = kind === "rain" ? 40 + R * 0.12 : 4 + R * 0.01;
      u.uLen.value = kind === "rain" ? 1.5 + R * 0.025 : 0;
      u.uSize.value = kind === "snow" ? 1 + R * 0.004 : 1;
      u.uOpacity.value = (kind === "rain" ? 0.32 : 0.8) * (0.6 + 0.4 * intensity);
    }
    drawOverlay(delta);
  });

  function drawOverlay(delta) {
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (state.condition?.storm && state.flash <= 0 && Math.random() < 0.004) state.flash = 0.25;
    if (state.flash > 0) { state.flash -= delta; flash.style.opacity = String(Math.max(0, Math.min(0.5, state.flash * 2.4))); } else flash.style.opacity = "0";
    if (mode === "none") return;
    const w = overlay.width, h = overlay.height, snowMode = mode === "snow";
    g.strokeStyle = `rgba(210,225,240,${0.22 + 0.25 * intensity})`;
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = 1;
    const count = Math.floor(drops.length * (0.5 + 0.5 * intensity));
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.y += d.v * delta * (snowMode ? 0.12 : 1.1);
      d.x += snowMode ? Math.sin(d.y * 20 + i) * 0.0008 : -0.05 * delta;
      if (d.y > 1.02) { d.y = -0.02; d.x = Math.random(); }
      if (d.x < 0) d.x += 1;
      const x = d.x * w, y = d.y * h;
      g.beginPath();
      if (snowMode) { g.arc(x, y, 1.6 + d.v, 0, 6.3); g.fill(); } else { g.moveTo(x, y); g.lineTo(x + 2, y - 12 - d.v * 6); g.stroke(); }
    }
  }

  function describe() {
    const current = effective();
    state.condition = current.condition;
    state.source = current.source;
    const live = state.live;
    const base = live ? `${live.temperature_2m.toFixed(1)} °C, ${weatherCondition(live).text}, Wind ${Math.round(live.wind_speed_10m)} km/h` : "Wetterdaten nicht verfügbar";
    if (state.source === "clear") info.textContent = "Klar: helle Tageszeit, kein Wetter.";
    else if (state.source === "simulation") info.textContent = `Simulation: ${PRESETS[state.effect].label}. Live: ${base}`;
    else if (state.source === "outside") info.textContent = "Zeit weicht von jetzt ab: kein Live-Wetter (Vorgabe wählbar)";
    else info.textContent = live ? `Live: ${base} (Open-Meteo)` : base;
    ctx.onWeatherChange?.({ ...state, base, effect: state.effect });
  }

  async function refresh() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(API, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { current, daily } = await response.json();
      state.live = { ...weatherCondition(current), ...current };
      state.liveTime = current.time ?? null;
      state.daily = daily?.time?.[0] ? {
        date: daily.time[0], sunrise: daily.sunrise?.[0] ?? null, sunset: daily.sunset?.[0] ?? null,
        moonrise: daily.moonrise?.[0] ?? null, moonset: daily.moonset?.[0] ?? null, moonPhase: daily.moon_phase?.[0] ?? null,
      } : null;
      lastUpdate = 0;
    } catch (error) {
      state.live = null;
      state.liveTime = null;
      state.daily = null;
      console.warn("Open-Meteo:", error);
    }
    describe();
  }

  async function refreshAirQuality() {
    const previous = state.air;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let response;
      try { response = await fetch(AIR_API, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.air = {
        status: data.current ? "ready" : "unavailable", current: data.current ?? null,
        time: data.current?.time ?? null, latitude: data.latitude ?? null, longitude: data.longitude ?? null,
        elevation: data.elevation ?? null, updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      state.air = { ...previous, status: "unavailable", current: null, time: null, updatedAt: new Date().toISOString() };
      console.warn("Open-Meteo Air Quality:", error);
    }
    ctx.onAirQualityChange?.(state.air);
  }

  layers.add({ id: "weather", label: "Wettereffekte", color: "#7fa6c9", visible: true, apply: (v) => { state.effects = v; lastUpdate = 0; } });
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  refreshAirQuality();
  setInterval(refreshAirQuality, AIR_REFRESH_MS);
  ctx.weather = {
    state, refresh, refreshAirQuality, PRESETS,
    setPreset(key) {
      if (key !== "live" && key !== "clear") return;
      state.preset = key;
      state.effect = null;
      lastUpdate = 0;
      describe();
    },
    setEffect(key) {
      state.effect = ["rain", "snow", "fog"].includes(key) ? key : null;
      lastUpdate = 0;
      describe();
    },
  };
}
