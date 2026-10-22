// Gebäude: ein zusammengeführtes Mesh (ein Draw-Call), Darstellungsmodi, Dorfbild-Shader, eigener Picker.
import * as THREE from "three";
import { BUILDING_TABLE_STRIDE as STRIDE } from "./api.js";

const PERIODS = {
  8011: { from: null, to: 1918, mid: 1900, label: "vor 1919" },
  8012: { from: 1919, to: 1945, mid: 1932, label: "1919 bis 1945" },
  8013: { from: 1946, to: 1960, mid: 1953, label: "1946 bis 1960" },
  8014: { from: 1961, to: 1970, mid: 1966, label: "1961 bis 1970" },
  8015: { from: 1971, to: 1980, mid: 1976, label: "1971 bis 1980" },
  8016: { from: 1981, to: 1985, mid: 1983, label: "1981 bis 1985" },
  8017: { from: 1986, to: 1990, mid: 1988, label: "1986 bis 1990" },
  8018: { from: 1991, to: 1995, mid: 1993, label: "1991 bis 1995" },
  8019: { from: 1996, to: 2000, mid: 1998, label: "1996 bis 2000" },
  8020: { from: 2001, to: 2005, mid: 2003, label: "2001 bis 2005" },
  8021: { from: 2006, to: 2010, mid: 2008, label: "2006 bis 2010" },
  8022: { from: 2011, to: 2015, mid: 2013, label: "2011 bis 2015" },
  8023: { from: 2016, to: null, mid: 2019, label: "nach 2015" },
};

/** Baujahr aus GWR: exakt (GBAUJ) oder nur Bauperiode (GBAUP, dann Periodenmitte als Näherung). */
export function buildYear(record) {
  const gwr = record.gwr;
  if (!gwr) return null;
  if (gwr.yearBuilt) return { year: gwr.yearBuilt, exact: true, from: gwr.yearBuilt, to: gwr.yearBuilt };
  const period = PERIODS[gwr.periodBuilt];
  return period ? { year: period.mid, exact: false, label: period.label, from: period.from, to: period.to } : null;
}

const TYPE_GROUPS = [
  { id: "wohnen", label: "Wohnen", color: "#d98c5f", match: (c) => c >= 1110 && c <= 1130 },
  { id: "gastro", label: "Hotel und Gastronomie", color: "#b05a9c", match: (c) => c >= 1211 && c <= 1231 && c !== 1220 && c !== 1230 },
  { id: "buero", label: "Büro und Handel", color: "#4f81bd", match: (c) => c === 1220 || c === 1230 },
  { id: "industrie", label: "Industrie und Lager", color: "#7b7f86", match: (c) => c === 1251 || c === 1252 },
  { id: "verkehr", label: "Verkehr und Garagen", color: "#c9b037", match: (c) => c === 1241 || c === 1242 },
  { id: "oeffentlich", label: "Kultur, Bildung, Gesundheit, Sport", color: "#3e9c8d", match: (c) => c >= 1261 && c <= 1265 },
  { id: "land", label: "Landwirtschaft", color: "#79a64a", match: (c) => c === 1271 || (c >= 1276 && c <= 1278) },
  { id: "sakral", label: "Kirchen und Kultgebäude", color: "#8a5fc9", match: (c) => c === 1272 || c === 1273 },
  { id: "sonstige", label: "Sonstige Hochbauten", color: "#a0a39a", match: (c) => c === 1274 || c === 1275 },
];
const NO_DATA_COLOR = "#b9bcb4";

export function typeGroup(record) {
  const code = record.gwr?.class;
  return TYPE_GROUPS.find((group) => code && group.match(code)) ?? null;
}

const HEATING_GROUPS = [
  { label: "Heizöl", color: "#5a3d2b", match: (c) => c === 7530 },
  { label: "Gas", color: "#7b6fb0", match: (c) => c === 7520 },
  { label: "Wärmepumpe und Umweltwärme", color: "#6fb3cf", match: (c) => c >= 7501 && c <= 7513 },
  { label: "Holz", color: "#a8743f", match: (c) => c >= 7540 && c <= 7543 },
  { label: "Elektrizität", color: "#e2c048", match: (c) => c === 7560 },
  { label: "Fernwärme", color: "#c8432e", match: (c) => c >= 7580 && c <= 7582 },
  { label: "Sonne (thermisch)", color: "#f0d24a", match: (c) => c === 7570 },
  { label: "Abwärme", color: "#d77a9a", match: (c) => c === 7550 },
  { label: "Keine Heizung", color: "#e3e3dc", match: (c) => c === 7500 },
  { label: "Andere oder unbestimmt", color: "#b8b3a8", match: (c) => c === 7598 || c === 7599 },
];
export const heatingGroup = (record) => {
  const code = record.gwr?.heatEnergy;
  return code ? HEATING_GROUPS.find((g) => g.match(code)) ?? null : null;
};

const STATUS_COLORS = { 1001: "#3a8ad6", 1002: "#5bb3d1", 1003: "#e0a020", 1004: "#7d8b86", 1005: "#a0522d", 1007: "#c0392b", 1008: "#bbbbbb" };
export const isDemolished = (record) => [1007, 1008].includes(record.gwr?.status);

// --- Dorfbild: gestalterische Fassaden, Dachfarbe aus dem Luftbild -----------------------------------------------

export function hash01(text, salt = "") {
  let h = 2166136261;
  const s = salt + text;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const FACADES = [["#f1ede2", 24], ["#ece3cc", 16], ["#e6d3a3", 12], ["#eadfae", 8], ["#e5c8ad", 9], ["#d9d6cf", 12], ["#d5dcc6", 5], ["#d1dae0", 5], ["#c9b49a", 4], ["#b9b3a8", 5]];
const WOOD_FACADES = ["#8b6a47", "#6e4e33", "#a47e55", "#7a5738"];
const ROOF_FALLBACKS = ["#8a4a38", "#5b4a40", "#4a4f57", "#7d7f82"];

function pickWeighted(table, h) {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [value, weight] of table) { acc += weight / total; if (h <= acc) return value; }
  return table[table.length - 1][0];
}

/**
 * Fassade, Fensterläden und Holzanteil sind gestalterisch (kein offener Datensatz enthält Fassadenfarben):
 * stabil aus der Gebäude-ID und der GWR-Nutzung abgeleitet.
 */
export function facadeStyle(record) {
  const cls = record.gwr?.class;
  const year = buildYear(record)?.year ?? 1980;
  const h = hash01(record.id, "fassade");
  let kind = "putz";
  if ([1271, 1276, 1277, 1278].includes(cls) || (year < 1920 && (record.footprintArea ?? 100) < 220 && h < 0.35)) kind = "holz";
  if (cls === 1242 || record.type === "Lagertank") kind = "beton";
  if ([1251, 1252].includes(cls)) kind = "metall";
  if (cls === 1272 || ["Kapelle", "Sakrales Gebaeude", "Sakraler Turm"].includes(record.type)) kind = "kirche";
  const color = kind === "holz" ? WOOD_FACADES[Math.floor(hash01(record.id, "holz") * WOOD_FACADES.length)]
    : kind === "beton" ? "#b8b6b0" : kind === "metall" ? "#c4c8cc" : kind === "kirche" ? "#f1efe8" : pickWeighted(FACADES, h);
  const hs = hash01(record.id, "laden");
  const hasShutters = kind === "putz" || kind === "holz";
  const shutter = !hasShutters ? 0 : hs < 0.35 ? 0 : hs < 0.6 ? 1 : hs < 0.8 ? 2 : hs < 0.9 ? 3 : 4;
  return { kind, color, shutter, wood: kind === "holz" };
}

/** Dachfarbe aus dem Luftbild (Median der Dachpixel), für die Darstellung leicht gesättigt und abgedunkelt. */
export function roofColor(record) {
  if (!record.roofColor) return { hex: ROOF_FALLBACKS[Math.floor(hash01(record.id, "dach") * ROOF_FALLBACKS.length)], measured: false };
  const c = new THREE.Color(record.roofColor);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.55), Math.max(0.1, hsl.l * 0.85));
  return { hex: `#${c.getHexString()}`, measured: true };
}

/** Geschosse für die Fensterreihen: GWR-Wert, sonst aus Traufhöhe geschätzt (nur Darstellung). */
export function floorsOf(record) {
  const gwr = record.gwr?.floors;
  if (gwr >= 1 && gwr <= 14) return { count: gwr, estimated: false };
  const eave = record.roofMin != null && record.groundElevation != null ? record.roofMin - record.groundElevation : (record.height ?? 6) * 0.75;
  return { count: Math.max(1, Math.min(10, Math.round(eave / 2.9))), estimated: true };
}

function lerpColor(stops, t) {
  const clamped = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(clamped));
  return stops[i].clone().lerp(stops[i + 1], clamped - i);
}
const ramp = (hexes) => hexes.map((hex) => new THREE.Color(hex));
const YEAR_RAMP = ramp(["#2c3e8c", "#2a7ab0", "#35a58f", "#a2c64a", "#f2c63a", "#e8783a", "#c0392b"]);
const HEIGHT_RAMP = ramp(["#e7e3d5", "#e8c98f", "#e0955a", "#b8492f", "#6b2036"]);
const COUNT_RAMP = ramp(["#e9f1d3", "#b9d98a", "#5fb36b", "#2a8a7a", "#1f4e79"]);
const YEAR_RANGE = [1850, 2025];

export const COLOR_MODES = [
  { id: "dorf", label: "Dorfbild (realistisch)" },
  { id: "neutral", label: "Neutral (einfarbig)" },
  { id: "type", label: "Nutzung" },
  { id: "year", label: "Baujahr" },
  { id: "height", label: "Gebäudehöhe" },
  { id: "floors", label: "Anzahl Geschosse" },
  { id: "dwellings", label: "Wohnungen" },
  { id: "heating", label: "Heizenergie" },
  { id: "status", label: "Status im Register" },
];

const SELECT_COLOR = new THREE.Color("#ff9d1c");
const HOVER_COLOR = new THREE.Color("#ffd27a");

const VERTEX_DECLARATIONS = "attribute vec3 aFaceUv; attribute float aSurface; attribute vec4 aInfo; attribute vec2 aBuildPeriod;\nvarying vec3 vFaceUv; varying float vSurface; varying vec4 vInfo; varying vec2 vBuildPeriod;\n";
const FRAGMENT_DECLARATIONS = `
uniform float uDetail; uniform float uNight; uniform float uTimelineYear; uniform float uTimelineFade;
varying vec3 vFaceUv; varying float vSurface; varying vec4 vInfo; varying vec2 vBuildPeriod;
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rectMask(vec2 p, vec2 c, vec2 h, float aa){ vec2 d = abs(p - c) - h; return 1.0 - smoothstep(-aa, aa, max(d.x, d.y)); }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
vec3 shutterColor(float i){
  if (i < 1.5) return srgb(vec3(0.19, 0.36, 0.20));
  if (i < 2.5) return srgb(vec3(0.36, 0.22, 0.13));
  if (i < 3.5) return srgb(vec3(0.38, 0.46, 0.55));
  return srgb(vec3(0.60, 0.17, 0.13));
}
`;
const COLOR_CHUNK = `
vec3 windowGlow = vec3(0.0);
float glassMask = 0.0;
if (uDetail > 0.5) {
  float seed = vInfo.w / 255.0;
  float u = vFaceUv.x, v = vFaceUv.y;
  float aa = clamp(max(fwidth(u), fwidth(v)) * 0.8, 0.002, 1.0);
  float far = clamp(aa * 6.0, 0.0, 1.0);
  if (vSurface < 0.5) {
    float L = vFaceUv.z, floors = vInfo.x, shutterIdx = vInfo.y, wood = vInfo.z;
    if (wood > 0.5) {
      float pl = abs(fract(v / 0.2) - 0.5);
      diffuseColor.rgb *= 1.0 - 0.2 * smoothstep(0.43, 0.5, pl) * (1.0 - far);
    } else {
      diffuseColor.rgb *= 0.95 + 0.08 * hash21(floor(vec2(u, v) * 5.0)) * (1.0 - far);
    }
    diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(0.2, 0.6, v));
    float spacing = 2.5 + 0.9 * fract(seed * 7.13);
    float cols = floor((L - 1.3) / spacing);
    float floorH = 2.8;
    if (cols >= 1.0 && v > 0.15 && v < floors * floorH + 0.2) {
      float off = 0.5 * (L - cols * spacing);
      float cu = (u - off) / spacing;
      float ci = floor(cu);
      float fi = floor(v / floorH);
      if (ci >= 0.0 && ci < cols && fi < floors) {
        vec2 p = vec2((fract(cu) - 0.5) * spacing, v - fi * floorH);
        float doorCol = floor(fract(seed * 13.7) * cols);
        if (fi < 0.5 && ci == doorCol && wood < 0.5) {
          float door = rectMask(p, vec2(0.0, 1.05), vec2(0.55, 1.05), aa);
          float frame = rectMask(p, vec2(0.0, 1.1), vec2(0.65, 1.1), aa);
          diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.92)), frame);
          diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.30, 0.22, 0.16)), door);
        } else {
          vec2 c = vec2(0.0, 1.55);
          vec2 gh = vec2(0.45, 0.62);
          float glass = rectMask(p, c, gh, aa);
          float frame = rectMask(p, c, gh + 0.08, aa);
          float sill = rectMask(p, vec2(0.0, 0.88), vec2(0.58, 0.04), aa);
          float shut = 0.0;
          if (shutterIdx > 0.5 && spacing > 2.45) {
            shut = max(rectMask(p, vec2(-0.82, 1.55), vec2(0.24, 0.66), aa), rectMask(p, vec2(0.82, 1.55), vec2(0.24, 0.66), aa));
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, shutterColor(shutterIdx), shut);
          diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.93)), max(frame, sill));
          diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.16, 0.22, 0.28)) + vec3(0.04, 0.06, 0.09) * (1.0 - uNight), glass);
          glassMask = glass;
          float lit = step(0.52, hash21(vec2(ci + seed * 100.0, fi + 7.0)));
          windowGlow = glass * lit * uNight * vec3(1.0, 0.72, 0.38) * 1.6;
        }
      }
    }
  } else if (vSurface < 1.5) {
    float rowH = 0.36, colW = 0.24;
    float row = v / rowH;
    float ri = floor(row);
    float cu = u / colW + 0.5 * mod(ri, 2.0);
    float ci = floor(cu);
    vec2 f = vec2(fract(cu), fract(row));
    float edge = 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.22, f.y));
    float side = 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.06, min(f.x, 1.0 - f.x)));
    float variation = 0.92 + 0.16 * hash21(vec2(ci, ri) + seed * 31.0);
    float fade = clamp(max(fwidth(v), fwidth(u)) / rowH, 0.0, 1.0);
    diffuseColor.rgb *= mix(edge * side * variation, 0.9, fade);
  } else if (vSurface > 2.5) {
    diffuseColor.rgb *= 0.9 + 0.2 * hash21(floor(vec2(u, v) * 6.0)) * (1.0 - far);
  }
}
`;

export class Buildings {
  constructor(data, records, codes = {}) {
    this.data = data;
    this.records = records;
    this.codes = codes;
    this.mode = "dorf";
    this.selected = -1;
    this.hovered = -1;
    this.hideDemolished = true;
    this.visibleMask = new Uint8Array(data.count).fill(1);
    this.uniforms = { uDetail: { value: 1 }, uNight: { value: 0 }, uTimelineYear: { value: 2026 }, uTimelineFade: { value: 0 } };
    this.#createGeometry();
    this.#computeBounds();
    this.#computeFaceAttributes();
    this.setColorMode("dorf");
    this.applyFilter(null);
  }

  #createGeometry() {
    const { positions, indices, vertexCount } = this.data;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(vertexCount * 3), 3, true));
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.geometry = geometry;
    this.fullIndices = indices;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceUv = aFaceUv; vSurface = aSurface; vInfo = aInfo; vBuildPeriod = aBuildPeriod;");
      shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader
        .replace("#include <color_fragment>", `#include <color_fragment>
          if (uTimelineFade > 0.5) {
            float reveal = vBuildPeriod.y > vBuildPeriod.x
              ? smoothstep(0.0, 1.0, (uTimelineYear - vBuildPeriod.x) / (vBuildPeriod.y - vBuildPeriod.x))
              : clamp(0.18 + (uTimelineYear - vBuildPeriod.x) * 0.82, 0.0, 1.0);
            float threshold = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            if (threshold > reveal) discard;
          }
          ${COLOR_CHUNK}`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, glassMask);")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += windowGlow;");
    };
    this.material.customProgramCacheKey = () => "buildings-village";
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "buildings";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }

  #computeBounds() {
    const { table, positions, count } = this.data;
    this.bounds = new Float32Array(count * 6);
    for (let b = 0; b < count; b++) {
      const start = table[b * STRIDE], length = table[b * STRIDE + 1];
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let v = start; v < start + length; v++) {
        const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      this.bounds.set([minX, minY, minZ, maxX, maxY, maxZ], b * 6);
    }
  }

  /** Je ebene Fläche: Texturkoordinaten (Wand: Länge/Höhe in m; Dach: quer/entlang des Hangs), Flächenart, Stilangaben. */
  #computeFaceAttributes() {
    const { table, positions, surfaces, faces, count, vertexCount } = this.data;
    const normals = this.geometry.attributes.normal.array;
    const uv = new Float32Array(vertexCount * 3);
    const surface = new Uint8Array(vertexCount);
    const info = new Uint8Array(vertexCount * 4);
    const buildPeriods = new Float32Array(vertexCount * 2);
    this.styles = new Array(count);
    for (let b = 0; b < count; b++) {
      const record = this.records[b];
      const style = facadeStyle(record);
      const yearInfo = buildYear(record);
      const yearStart = yearInfo ? yearInfo.from ?? 1850 : 9999;
      const yearEnd = yearInfo ? yearInfo.to ?? new Date().getFullYear() : 9999;
      const floors = floorsOf(record).count;
      this.styles[b] = { ...style, floors };
      const seed = Math.round(hash01(record.id, "seed") * 255);
      const baseY = this.bounds[b * 6 + 1];
      let vertex = table[b * STRIDE];
      const faceEnd = table[b * STRIDE + 4] + table[b * STRIDE + 5];
      for (let f = table[b * STRIDE + 4]; f < faceEnd; f++) {
        const size = faces[f];
        const nx = normals[vertex * 3], ny = normals[vertex * 3 + 1], nz = normals[vertex * 3 + 2];
        let kind = surfaces[vertex];
        let tx = 0, ty = 0, tz = 0, dx = 0, dy = 0, dz = 0;
        if (kind === 0) {
          const length = Math.hypot(nx, nz) || 1;
          tx = nz / length; tz = -nx / length; // horizontale Tangente entlang der Wand
        } else if (kind === 1 && ny < 0.96) {
          dx = -nx * ny; dy = 1 - ny * ny; dz = -nz * ny; // Fallrichtung des Dachs
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          tx = dy * nz - dz * ny; ty = dz * nx - dx * nz; tz = dx * ny - dy * nx; // Quertangente d x n
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
        } else if (kind === 1) kind = 3; // Flachdach
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity;
        const us = new Float32Array(size), vs = new Float32Array(size);
        for (let i = 0; i < size; i++) {
          const k = (vertex + i) * 3;
          const x = positions[k], y = positions[k + 1], z = positions[k + 2];
          let u, v;
          if (kind === 0) { u = x * tx + z * tz; v = y - baseY; }
          else if (kind === 1) { u = x * tx + y * ty + z * tz; v = x * dx + y * dy + z * dz; }
          else { u = x; v = z; }
          us[i] = u; vs[i] = v;
          if (u < uMin) uMin = u; if (u > uMax) uMax = u; if (v < vMin) vMin = v;
        }
        const length = uMax - uMin;
        for (let i = 0; i < size; i++) {
          const o = vertex + i;
          uv[o * 3] = us[i] - uMin;
          uv[o * 3 + 1] = kind === 0 ? vs[i] : vs[i] - vMin;
          uv[o * 3 + 2] = length;
          surface[o] = kind;
          info[o * 4] = floors; info[o * 4 + 1] = style.shutter; info[o * 4 + 2] = style.wood ? 1 : 0; info[o * 4 + 3] = seed;
          buildPeriods[o * 2] = yearStart;
          buildPeriods[o * 2 + 1] = yearEnd;
        }
        vertex += size;
      }
    }
    this.geometry.setAttribute("aFaceUv", new THREE.BufferAttribute(uv, 3));
    this.geometry.setAttribute("aSurface", new THREE.BufferAttribute(surface, 1));
    this.geometry.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
    this.geometry.setAttribute("aBuildPeriod", new THREE.BufferAttribute(buildPeriods, 2));
  }

  center(index) {
    const b = this.bounds.subarray(index * 6, index * 6 + 6);
    return new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  }

  /** Farben je Flächenart für ein Gebäude im aktuellen Modus. */
  colorsFor(index) {
    const record = this.records[index];
    const c = (hex) => new THREE.Color(hex);
    let wall, roof;
    switch (this.mode) {
      case "dorf":
        wall = c(this.styles[index].color);
        roof = c(roofColor(record).hex);
        break;
      case "year": {
        const info = buildYear(record);
        wall = info ? lerpColor(YEAR_RAMP, (info.year - YEAR_RANGE[0]) / (YEAR_RANGE[1] - YEAR_RANGE[0])) : c(NO_DATA_COLOR);
        break;
      }
      case "height":
        wall = record.height == null ? c(NO_DATA_COLOR) : lerpColor(HEIGHT_RAMP, (record.height - 3) / 27);
        break;
      case "type":
        wall = c(typeGroup(record)?.color ?? NO_DATA_COLOR);
        break;
      case "floors":
        wall = record.gwr?.floors ? lerpColor(COUNT_RAMP, (record.gwr.floors - 1) / 7) : c(NO_DATA_COLOR);
        break;
      case "dwellings":
        wall = record.gwr?.dwellings ? lerpColor(COUNT_RAMP, Math.log(record.gwr.dwellings) / Math.log(30)) : c(NO_DATA_COLOR);
        break;
      case "heating":
        wall = c(heatingGroup(record)?.color ?? NO_DATA_COLOR);
        break;
      case "status":
        wall = c(STATUS_COLORS[record.gwr?.status] ?? NO_DATA_COLOR);
        break;
      default:
        wall = c("#d6d0c4");
    }
    roof ??= wall.clone().multiplyScalar(this.mode === "neutral" ? 0.6 : 0.82);
    return { wall, roof, floor: wall.clone().multiplyScalar(0.7) };
  }

  setColorMode(mode) {
    this.mode = mode;
    this.uniforms.uDetail.value = mode === "dorf" ? 1 : 0;
    for (let b = 0; b < this.data.count; b++) this.#paint(b, null);
    this.#paint(this.selected, SELECT_COLOR);
    this.#paint(this.hovered, HOVER_COLOR);
    this.geometry.attributes.color.needsUpdate = true;
  }

  setNight(value) { this.uniforms.uNight.value = value; }

  setTimeTravel(year, enabled) {
    this.uniforms.uTimelineYear.value = year;
    this.uniforms.uTimelineFade.value = enabled ? 1 : 0;
  }

  legend() {
    const swatches = (items) => items.map(([color, label]) => ({ color, label }));
    const style = (c) => c.getStyle();
    switch (this.mode) {
      case "dorf":
        return swatches([["#f1ede2", "Putzfassade"], ["#8b6a47", "Holzfassade"], ["#b8b6b0", "Garage, Beton"], ["#8a4a38", "Dachfarbe aus Luftbild"]])
          .concat([{ note: "Fassaden, Fensterläden und Fenster sind gestalterisch (keine offene Datenquelle). Dachfarbe: Luftbild SWISSIMAGE. Geometrie und Höhe: swissBUILDINGS3D." }]);
      case "year":
        return swatches([[style(YEAR_RAMP[0]), "1850 oder früher"], [style(YEAR_RAMP[2]), "um 1920"], [style(YEAR_RAMP[4]), "um 1970"], [style(YEAR_RAMP[6]), "2025"], [NO_DATA_COLOR, "kein Baujahr im GWR"]])
          .concat([{ note: "Bauperioden werden mit der Periodenmitte dargestellt (Näherung)." }]);
      case "height":
        return swatches([[style(HEIGHT_RAMP[0]), "3 m"], [style(HEIGHT_RAMP[2]), "15 m"], [style(HEIGHT_RAMP[4]), "30 m und mehr"]]);
      case "type":
        return swatches(TYPE_GROUPS.map((g) => [g.color, g.label]).concat([[NO_DATA_COLOR, "kein GWR-Eintrag"]]));
      case "floors":
        return swatches([[style(COUNT_RAMP[0]), "1 Geschoss"], [style(COUNT_RAMP[2]), "4 Geschosse"], [style(COUNT_RAMP[4]), "8 und mehr"], [NO_DATA_COLOR, "keine Angabe im GWR"]]);
      case "dwellings":
        return swatches([[style(COUNT_RAMP[0]), "1 Wohnung"], [style(COUNT_RAMP[2]), "ca. 5 Wohnungen"], [style(COUNT_RAMP[4]), "30 und mehr"], [NO_DATA_COLOR, "keine Angabe im GWR"]]);
      case "heating":
        return swatches(HEATING_GROUPS.map((g) => [g.color, g.label]).concat([[NO_DATA_COLOR, "keine Angabe im GWR"]]));
      case "status":
        return swatches([["#7d8b86", "Bestehend"], ["#e0a020", "Im Bau"], [NO_DATA_COLOR, "unbekannt"]])
          .concat([{ note: "Als abgebrochen registrierte Gebäude sind im Modell ausgeblendet." }]);
      default:
        return [];
    }
  }

  #paint(index, override) {
    if (index < 0) return;
    const { table, surfaces } = this.data;
    const colors = this.geometry.attributes.color.array;
    const base = this.colorsFor(index);
    const wall = override ?? base.wall;
    const roof = override ? override.clone().multiplyScalar(0.9) : base.roof;
    const floor = override ? wall : base.floor;
    const start = table[index * STRIDE], end = start + table[index * STRIDE + 1];
    for (let v = start; v < end; v++) {
      const color = surfaces[v] === 1 ? roof : surfaces[v] === 2 ? floor : wall;
      colors[v * 3] = Math.round(color.r * 255);
      colors[v * 3 + 1] = Math.round(color.g * 255);
      colors[v * 3 + 2] = Math.round(color.b * 255);
    }
  }

  select(index) {
    if (this.selected === index) return;
    const previous = this.selected;
    this.selected = index;
    this.#paint(previous, null);
    if (previous === this.hovered) this.#paint(previous, HOVER_COLOR);
    this.#paint(index, SELECT_COLOR);
    this.geometry.attributes.color.needsUpdate = true;
  }

  hover(index) {
    if (this.hovered === index) return;
    const previous = this.hovered;
    this.hovered = index;
    if (previous >= 0 && previous !== this.selected) this.#paint(previous, null);
    if (index >= 0 && index !== this.selected) this.#paint(index, HOVER_COLOR);
    this.geometry.attributes.color.needsUpdate = true;
  }

  /** Sichtbarkeit je Gebäude (Zeitachse, Filter, abgebrochene Gebäude): baut die Indexliste neu. */
  applyFilter(predicate) {
    this.lastPredicate = predicate;
    const { table, count } = this.data;
    const target = this.geometry.index.array;
    let cursor = 0, visibleCount = 0;
    for (let b = 0; b < count; b++) {
      const record = this.records[b];
      const visible = (!this.hideDemolished || !isDemolished(record)) && (predicate ? predicate(record, b) : true);
      this.visibleMask[b] = visible ? 1 : 0;
      if (!visible) continue;
      visibleCount++;
      const from = table[b * STRIDE + 2], length = table[b * STRIDE + 3];
      target.set(this.fullIndices.subarray(from, from + length), cursor);
      cursor += length;
    }
    this.geometry.index.needsUpdate = true;
    this.geometry.setDrawRange(0, cursor);
    return visibleCount;
  }

  /** Schnellster Treffer entlang eines Strahls: AABB-Vorfilter, dann Dreiecke der Kandidaten. */
  pick(ray) {
    const { table, positions, indices, count } = this.data;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const candidates = [];
    for (let b = 0; b < count; b++) {
      if (!this.visibleMask[b]) continue;
      const o = b * 6;
      box.min.set(this.bounds[o], this.bounds[o + 1], this.bounds[o + 2]);
      box.max.set(this.bounds[o + 3], this.bounds[o + 4], this.bounds[o + 5]);
      if (ray.intersectBox(box, hit)) candidates.push([ray.origin.distanceTo(hit), b]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
    let best = null;
    for (const [boxDistance, index] of candidates) {
      if (best && boxDistance > best.distance) break;
      const first = table[index * STRIDE + 2], last = first + table[index * STRIDE + 3];
      for (let k = first; k < last; k += 3) {
        a.fromArray(positions, indices[k] * 3);
        b2.fromArray(positions, indices[k + 1] * 3);
        c.fromArray(positions, indices[k + 2] * 3);
        if (ray.intersectTriangle(a, b2, c, false, hit)) {
          const distance = ray.origin.distanceTo(hit);
          if (!best || distance < best.distance) best = { index, distance, point: hit.clone() };
        }
      }
    }
    return best;
  }

  stats() {
    return { buildings: this.data.count, triangles: this.data.indexCount / 3, vertices: this.data.vertexCount, hiddenDemolished: this.records.filter(isDemolished).length };
  }
}
