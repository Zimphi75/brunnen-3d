// Sonnenstand (SunCalc-Algorithmus), Himmel, Beleuchtung, Schattenwurf und Tag-Nacht-Modus.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const OBLIQUITY = RAD * 23.4397;

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + 2440588 - 2451545;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

/** Sonnenstand: azimuth in Radiant ab Süden (positiv nach Westen), altitude in Radiant über dem Horizont. */
export function sunPosition(date, latitude, longitude) {
  const lw = RAD * -longitude, phi = RAD * latitude, d = toDays(date);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = declination(L, 0), ra = rightAscension(L, 0);
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  return {
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
  };
}

/** Sonnenauf- und -untergang (lokale Suche in 2-Minuten-Schritten, Höhe -0.833°). */
export function sunTimes(date, latitude, longitude) {
  const start = new Date(date); start.setUTCHours(0, 0, 0, 0);
  let rise = null, set = null, previous = null;
  for (let minute = 0; minute <= 1440; minute += 2) {
    const t = new Date(start.getTime() + minute * 60000);
    const altitude = sunPosition(t, latitude, longitude).altitude / RAD + 0.833;
    if (previous !== null) {
      if (previous < 0 && altitude >= 0 && !rise) rise = t;
      if (previous >= 0 && altitude < 0 && !set) set = t;
    }
    previous = altitude;
  }
  return { rise, set };
}

const ZONE = "Europe/Zurich";

export function zurichParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, minutes: +parts.hour * 60 + +parts.minute };
}

/** Datum und Minuten seit Mitternacht (Zeit in Zürich) -> Date. */
export function zurichToDate(year, month, day, minutes) {
  let guess = new Date(Date.UTC(year, month - 1, day, 0, minutes));
  for (let i = 0; i < 2; i++) {
    const p = zurichParts(guess);
    const delta = (Date.UTC(year, month - 1, day, 0, minutes) - Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes));
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function createSky({ scene, renderer, camera, latitude, longitude }) {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.5;
  uniforms.rayleigh.value = 1.3;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.8;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 9000;
  scene.add(sun, sun.target);

  const moon = new THREE.DirectionalLight(0x8fa8d8, 0);
  moon.position.set(-1500, 2500, -1500);
  scene.add(moon);

  const hemisphere = new THREE.HemisphereLight(0xcfe3ff, 0x6a7360, 0.8);
  scene.add(hemisphere);

  scene.fog = new THREE.FogExp2(0xbfd4e4, 0.00004);

  const state = {
    date: new Date(), altitude: 0, azimuth: 0, direction: new THREE.Vector3(0, 1, 0),
    cloudCover: 0, fogBoost: 0, shadows: true, dayFactor: 1,
  };

  function apply() {
    const { azimuth, altitude } = sunPosition(state.date, latitude, longitude);
    state.azimuth = azimuth;
    state.altitude = altitude;
    // x = Ost, y = oben, z = Süd (lokales System: z = -Nord)
    state.direction.set(-Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(azimuth) * Math.cos(altitude));
    const degrees = altitude / RAD;
    const day = smoothstep(-6, 8, degrees);
    state.dayFactor = day;
    const cloud = 1 - 0.6 * state.cloudCover;
    uniforms.sunPosition.value.copy(state.direction);
    uniforms.rayleigh.value = 0.4 + 1.2 * day;
    sun.intensity = 2.5 * smoothstep(-1, 14, degrees) * cloud;
    sun.color.setRGB(1, 0.78 + 0.22 * smoothstep(2, 22, degrees), 0.55 + 0.45 * smoothstep(2, 28, degrees));
    hemisphere.intensity = (0.08 + 0.6 * day) * (1 + 0.6 * state.cloudCover);
    moon.intensity = 0.22 * (1 - day);
    renderer.toneMappingExposure = 0.5 + 0.45 * day;
    const fogColor = new THREE.Color().setRGB(0.04, 0.06, 0.1).lerp(new THREE.Color(0.75, 0.83, 0.9), day);
    scene.fog.color.copy(fogColor);
    scene.fog.density = 0.00004 + 0.0004 * state.fogBoost;
    sun.castShadow = state.shadows && degrees > 1.5;
  }

  /** Schattenkamera folgt dem Blickpunkt; Position wird auf Texel gerastert gegen Flimmern. */
  function update(target, distance) {
    const extent = THREE.MathUtils.clamp(distance * 0.9, 250, 2800);
    const cam = sun.shadow.camera;
    if (Math.abs(cam.right - extent) > 1) {
      cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * extent) / sun.shadow.mapSize.x;
    const snapped = new THREE.Vector3(Math.round(target.x / texel) * texel, target.y, Math.round(target.z / texel) * texel);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(state.direction, 4000);
    sun.target.updateMatrixWorld();
    sky.position.copy(camera.position);
  }

  return {
    state, sun, hemisphere, moon,
    setDate(date) { state.date = date; apply(); },
    setCloudCover(value) { state.cloudCover = value; apply(); },
    setFogBoost(value) { state.fogBoost = value; apply(); },
    setShadows(enabled) { state.shadows = enabled; apply(); },
    update,
    times: (date) => sunTimes(date, latitude, longitude),
  };
}
