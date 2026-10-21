// Aktuelle Wetterdaten (Open-Meteo): Anzeige, Bewölkung, Nebel, Regen- und Schneepartikel.
import * as THREE from "three";

const API = "https://api.open-meteo.com/v1/forecast?latitude=47.0045&longitude=8.6136&timezone=Europe%2FZurich"
  + "&current=temperature_2m,weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,is_day";

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
    cloud: (current.cloud_cover ?? 0) / 100,
  };
}

export function initWeather(ctx) {
  const { $, scene3d, sky, layers } = ctx;
  const info = $("#weather-info");
  const COUNT = 5000, BOX = 500, HEIGHT = 260;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 6);
  const offsets = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) offsets.set([Math.random() * BOX - BOX / 2, Math.random() * HEIGHT, Math.random() * BOX - BOX / 2], i * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xaec6e0, transparent: true, opacity: 0.5, depthWrite: false });
  const particles = new THREE.LineSegments(geometry, material);
  particles.frustumCulled = false;
  particles.visible = false;
  scene3d.scene.add(particles);
  scene3d.aoExcluded.add(particles);

  const state = { condition: null, effects: true, mode: "none", wind: 0 };

  function updateParticles(delta) {
    if (state.mode === "none" || !state.effects) { particles.visible = false; return; }
    particles.visible = true;
    const centre = scene3d.controls.target;
    const snow = state.mode === "snow";
    const fall = snow ? 6 : 55, length = snow ? 0.6 : 3.2;
    const sway = Math.min(8, state.wind * 0.3);
    for (let i = 0; i < COUNT; i++) {
      let y = offsets[i * 3 + 1] - fall * delta;
      if (y < 0) y += HEIGHT;
      offsets[i * 3 + 1] = y;
      const x = centre.x + offsets[i * 3], z = centre.z + offsets[i * 3 + 2];
      const baseY = centre.y + y;
      const lean = sway * 0.05 * length;
      positions.set([x, baseY, z, x - lean, baseY + length, z], i * 6);
    }
    geometry.attributes.position.needsUpdate = true;
    material.color.set(snow ? 0xffffff : 0xaec6e0);
    material.opacity = snow ? 0.8 : 0.45;
  }
  scene3d.onFrame((delta) => updateParticles(delta));

  function apply() {
    const condition = state.condition;
    if (!condition || !state.effects) {
      sky.setCloudCover(0); sky.setFogBoost(0); state.mode = "none";
      return;
    }
    sky.setCloudCover(condition.cloud);
    sky.setFogBoost(condition.fog ? 1 : 0);
    state.mode = condition.snow ? "snow" : condition.rain ? "rain" : "none";
  }

  async function refresh() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(API, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { current } = await response.json();
      state.condition = weatherCondition(current);
      state.wind = current.wind_speed_10m ?? 0;
      info.textContent = `Aktuell: ${current.temperature_2m.toFixed(1)} °C, ${state.condition.text}, Wind ${Math.round(state.wind)} km/h (Open-Meteo)`;
      apply();
    } catch (error) {
      state.condition = null;
      info.textContent = "Wetterdaten momentan nicht verfügbar";
      apply();
      console.warn("Open-Meteo:", error);
    }
  }

  layers.add({ id: "weather", label: "Wettereffekte", color: "#7fa6c9", visible: true, apply: (v) => { state.effects = v; apply(); } });
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  ctx.weather = { state, refresh };
}
