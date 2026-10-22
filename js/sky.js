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

const SCRATCH_COLOR = new THREE.Color();

export function createSky({ scene, renderer, camera, latitude, longitude, shadowMapSize = 4096 }) {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 2.6;
  uniforms.rayleigh.value = 2.2;
  uniforms.mieCoefficient.value = 0.0025;
  uniforms.mieDirectionalG.value = 0.8;
  sky.visible = false;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
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

  // Sterne: einfache Punktwolke, nur bei Dunkelheit sichtbar (gestalterisch, keine Sternkarte).
  const starPositions = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const u = Math.random(), v = Math.random() * 0.97 + 0.03; // nur obere Halbkugel
    const phi = 2 * Math.PI * u, y = v, r = Math.sqrt(1 - y * y);
    starPositions.set([Math.cos(phi) * r * 15000, y * 15000, Math.sin(phi) * r * 15000], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  scene.add(stars);

  const state = {
    date: new Date(), altitude: 0, azimuth: 0, direction: new THREE.Vector3(0, 1, 0),
    cloudCover: 0, fogBoost: 0, shadows: true, dayFactor: 1, night: 0,
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
    state.night = 1 - smoothstep(-7, 2, degrees);
    const cloud = 1 - 0.6 * state.cloudCover;
    uniforms.sunPosition.value.copy(state.direction);
    uniforms.rayleigh.value = 0.5 + 1.7 * day;
    sun.intensity = 2.5 * smoothstep(-1, 14, degrees) * cloud;
    sun.color.setRGB(1, 0.78 + 0.22 * smoothstep(2, 22, degrees), 0.55 + 0.45 * smoothstep(2, 28, degrees));
    hemisphere.intensity = (0.55 + 0.25 * day) * (1 + 0.6 * state.cloudCover * day);
    hemisphere.color.set(0x3a5086).lerp(SCRATCH_COLOR.set(0xcfe3ff), day);
    hemisphere.groundColor.set(0x141a24).lerp(SCRATCH_COLOR.set(0x6a7360), day);
    moon.intensity = 1.1 * (1 - day);
    renderer.toneMappingExposure = 0.85 + 0.1 * day;
    const fogColor = new THREE.Color(0x101827).lerp(SCRATCH_COLOR.set(0x8abce3), day);
    scene.fog.color.copy(fogColor);
    // Bei Nacht liefert der Preetham-Himmel einen braunen Ton; dann ersetzt ein dunkles Blau den Himmel.
    sky.visible = false;
    scene.background = scene.background.set(0x070b16).lerp(SCRATCH_COLOR.set(0x8abce3), day);
    starMaterial.opacity = Math.max(0, 1 - state.cloudCover) * Math.pow(state.night, 2) * 0.9;
    stars.visible = starMaterial.opacity > 0.01;
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
    stars.position.copy(camera.position);
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
