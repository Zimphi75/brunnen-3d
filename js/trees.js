// Bäume: Laub- und Nadelbäume mit unregelmässigen Kronen, Artwahl und Kronenfarbe aus dem Luftbild, Wind, zwei Detailstufen.
// Gemessen sind Standort, Höhe und Kronenradius (Vegetationshöhenmodell). Art, Farbe und Form sind aus der Luftbildfarbe abgeleitet bzw. gestalterisch.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const HIGH_DETAIL_DISTANCE = 380;
const VISIBLE_DISTANCE = 3800;
const CONIFER_SHARE = 0.4; // Anteil der dunkelsten Baumkronen im Luftbild, die als Nadelbaum gezeichnet werden
const CONIFER_MIN_HEIGHT = 5;

const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
const hash3 = (x, y, z) => hash(Math.round(x * 997) + Math.round(z * 331), Math.round(y * 577));

// Format siehe pipeline/process_trees.py ("TRE1")
export function parseTrees(buffer) {
  const header = new Uint32Array(buffer, 0, 4);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "TRE1") throw new Error("trees.bin: unbekanntes Format");
  const count = header[2];
  const pad = (n) => n + ((4 - (n % 4)) % 4);
  let offset = 16;
  const x = new Float32Array(buffer, offset, count); offset += count * 4;
  const z = new Float32Array(buffer, offset, count); offset += count * 4;
  const height = new Uint8Array(buffer, offset, count); offset += pad(count);
  const radius = new Uint8Array(buffer, offset, count);
  return { count, x, z, height, radius };
}

let seed = 20240607;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Flache Schattierung, Helligkeit je Dreieck leicht gestreut; aCrown = 1: Krone (wird mit der Instanzfarbe getönt), 0: Stamm. */
function finish(geometry, shadeOf, crown, flatColor) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  const position = g.attributes.position, colors = new Float32Array(position.count * 3), color = new THREE.Color();
  for (let t = 0; t < position.count; t += 3) {
    const jitter = 0.93 + 0.14 * random();
    for (let k = 0; k < 3; k++) {
      if (flatColor) color.set(flatColor).multiplyScalar(0.85 + 0.3 * (position.getY(t + k) > 0.1 ? 1 : 0.8)); else { const s = shadeOf(position.getY(t + k), position.getX(t + k), position.getZ(t + k)); color.setRGB(s, s, s); }
      colors.set([color.r * jitter, color.g * jitter, color.b * jitter], (t + k) * 3);
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aCrown", new THREE.BufferAttribute(new Float32Array(position.count).fill(crown), 1));
  return g;
}

function blob(rx, ry, cx, cy, cz, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = 0.74 + 0.5 * hash3(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, p.getX(i) * f * rx + cx, p.getY(i) * f * ry + cy, p.getZ(i) * f * rx + cz);
  }
  const bottom = cy - ry * 1.1, top = cy + ry * 1.1;
  return finish(g, (y) => 0.58 + 0.62 * THREE.MathUtils.clamp((y - bottom) / (top - bottom), 0, 1), 1);
}

const trunk = (height, top, bottom, sides, open) => finish(new THREE.CylinderGeometry(top, bottom, height, sides, 1, open).translate(0, height / 2, 0), null, 0, "#5b4532");

function cone(radius, height, base, sides, tier, tiers) {
  const g = new THREE.ConeGeometry(radius, height, sides, 1, true).translate(0, height / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const rim = p.getY(i) < height * 0.1;
    const f = rim ? 0.86 + 0.26 * hash3(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) + base - (rim ? 0.02 * hash3(p.getZ(i), p.getY(i), p.getX(i)) : 0), p.getZ(i) * f);
  }
  const tierShade = 0.62 + 0.3 * (tier / Math.max(1, tiers - 1));
  return finish(g, (y) => tierShade * (0.8 + 0.3 * THREE.MathUtils.clamp((y - base) / height, 0, 1)), 1);
}

const deciduousHigh = () => mergeGeometries([
  trunk(0.4, 0.035, 0.07, 6, false),
  blob(0.86, 0.27, 0, 0.66, 0, 1), blob(0.5, 0.18, 0.45, 0.56, 0.14, 1), blob(0.46, 0.17, -0.4, 0.58, -0.22, 1), blob(0.4, 0.15, 0.05, 0.84, -0.18, 1),
]);
const deciduousLow = () => mergeGeometries([trunk(0.4, 0.04, 0.07, 4, true), blob(1, 0.3, 0, 0.66, 0, 0)]);
const coniferHigh = () => {
  const parts = [trunk(0.24, 0.03, 0.06, 5, false)];
  const tiers = 5;
  for (let i = 0; i < tiers; i++) parts.push(cone(0.98 * (1 - i * 0.17), 0.3 - i * 0.015, 0.12 + i * 0.165, 9, i, tiers));
  return mergeGeometries(parts);
};
const coniferLow = () => mergeGeometries([trunk(0.2, 0.03, 0.06, 4, true), cone(1, 0.6, 0.12, 6, 0, 2), cone(0.6, 0.45, 0.5, 6, 1, 2)]);

/** Luftbildfarbe an Baumpositionen (Mittel aus 3 × 3 Pixeln, sRGB 0..1). */
function orthoSampler(texture, terrain) {
  const image = texture?.image;
  if (!image?.width) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  return (x, z) => {
    const px = Math.round(((x - terrain.minX) / terrain.width) * (canvas.width - 1));
    const py = Math.round(((terrain.maxZ - z) / terrain.depth) * (canvas.height - 1));
    let r = 0, gr = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = px + dx, iy = py + dy;
      if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) continue;
      const o = (iy * canvas.width + ix) * 4;
      r += data[o]; gr += data[o + 1]; b += data[o + 2]; n++;
    }
    return n ? [r / n / 255, gr / n / 255, b / n / 255] : [0.2, 0.3, 0.15];
  };
}

function installMaterial() {
  const uniforms = { uWindTime: { value: 0 }, uWindStrength: { value: 1 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = "attribute float aCrown; uniform float uWindTime; uniform float uWindStrength;\n" + shader.vertexShader
      .replace("#include <color_vertex>", "vColor = vec3( 1.0 ); vColor *= color; vColor *= mix( vec3( 1.0 ), instanceColor.xyz, aCrown );")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float sway = position.y * position.y * aCrown;
        float phase = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
        transformed.x += sin( uWindTime * 1.4 + phase ) * 0.035 * sway * uWindStrength;
        transformed.z += cos( uWindTime * 1.1 + phase * 1.3 ) * 0.025 * sway * uWindStrength;`);
  };
  material.customProgramCacheKey = () => "trees-v2";
  return { material, uniforms };
}

export function buildTrees({ trees, terrain, ortho, scene3d, ctx }) {
  const group = new THREE.Group();
  group.name = "trees";
  const sampler = orthoSampler(ortho, terrain);

  const samples = new Float32Array(trees.count * 3);
  const luminance = new Float32Array(trees.count);
  for (let i = 0; i < trees.count; i++) {
    const [r, g, b] = sampler ? sampler(trees.x[i], trees.z[i]) : [0.2, 0.3, 0.15];
    samples.set([r, g, b], i * 3);
    luminance[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const tall = [];
  for (let i = 0; i < trees.count; i++) if (trees.height[i] / 2 >= CONIFER_MIN_HEIGHT) tall.push(luminance[i]);
  tall.sort((a, b) => a - b);
  const threshold = sampler && tall.length ? tall[Math.floor(tall.length * CONIFER_SHARE)] : -1;

  const geometries = { deciduousHigh: deciduousHigh(), deciduousLow: deciduousLow(), coniferHigh: coniferHigh(), coniferLow: coniferLow() };
  const { material, uniforms } = installMaterial();

  const cellSize = 500, cells = new Map();
  for (let i = 0; i < trees.count; i++) {
    const key = `${Math.floor(trees.x[i] / cellSize)}:${Math.floor(trees.z[i] / cellSize)}`;
    if (!cells.has(key)) cells.set(key, { gx: Math.floor(trees.x[i] / cellSize), gz: Math.floor(trees.z[i] / cellSize), members: [] });
    cells.get(key).members.push(i);
  }

  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), color = new THREE.Color(), hsl = {};
  const entries = [];
  let coniferCount = 0;
  for (const { gx, gz, members } of cells.values()) {
    const bySpecies = { deciduous: [], conifer: [] };
    for (const tree of members) {
      const conifer = trees.height[tree] / 2 >= CONIFER_MIN_HEIGHT && luminance[tree] <= threshold;
      bySpecies[conifer ? "conifer" : "deciduous"].push(tree);
    }
    const meshes = [];
    for (const [species, list] of Object.entries(bySpecies)) {
      if (!list.length) continue;
      const high = new THREE.InstancedMesh(geometries[`${species}High`], material, list.length);
      const low = new THREE.InstancedMesh(geometries[`${species}Low`], material, list.length);
      list.forEach((tree, slot) => {
        const x = trees.x[tree], z = trees.z[tree];
        const jitter = hash(x, z), jitter2 = hash(z + 3.1, x - 1.7);
        const h = trees.height[tree] / 2;
        let r = trees.radius[tree] / 4;
        const conifer = species === "conifer";
        const horizontal = conifer ? Math.max(r * 0.75, 0.15 * h) : Math.max(r, 0.26 * h) * (0.9 + 0.3 * jitter2);
        const ground = terrain.heightAt(x, z) ?? 0;
        matrix.compose(new THREE.Vector3(x, ground - 0.1, z), quaternion.setFromAxisAngle(up, jitter * 6.283), new THREE.Vector3(horizontal, h * (0.92 + 0.16 * jitter2), horizontal));
        high.setMatrixAt(slot, matrix); low.setMatrixAt(slot, matrix);
        const [sr, sg, sb] = [samples[tree * 3], samples[tree * 3 + 1], samples[tree * 3 + 2]];
        color.setRGB(sr, sg, sb, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
        const sampleHue = THREE.MathUtils.clamp(hsl.h, 0.17, 0.36);
        if (conifer) color.setHSL(THREE.MathUtils.lerp(0.37 + 0.04 * jitter, sampleHue, 0.2), 0.34 + 0.16 * jitter2, 0.2 + 0.08 * jitter, THREE.SRGBColorSpace);
        else color.setHSL(THREE.MathUtils.lerp(0.235 + 0.075 * jitter, sampleHue, 0.25), 0.42 + 0.22 * jitter2, 0.24 + 0.12 * jitter + 0.1 * (luminance[tree] - 0.3), THREE.SRGBColorSpace);
        high.setColorAt(slot, color); low.setColorAt(slot, color);
        if (conifer) coniferCount++;
      });
      // beide Detailstufen teilen Matrizen und Farben
      low.instanceMatrix = high.instanceMatrix;
      low.instanceColor = high.instanceColor;
      for (const mesh of [high, low]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.visible = false; group.add(mesh); }
      high.castShadow = true;
      meshes.push({ high, low });
    }
    entries.push({ meshes, cx: (gx + 0.5) * cellSize, cz: (gz + 0.5) * cellSize });
  }

  let last = 0;
  scene3d.onFrame((delta, now) => {
    uniforms.uWindTime.value = now / 1000;
    const wind = ctx.weather?.state.live?.wind_speed_10m ?? 6;
    uniforms.uWindStrength.value = THREE.MathUtils.clamp(0.6 + wind / 14, 0.6, 2.6);
    if (now - last < 350 || !group.visible) return;
    last = now;
    const target = scene3d.controls.target;
    for (const { meshes, cx, cz } of entries) {
      const near = Math.hypot(cx - target.x, cz - target.z) - cellSize * 0.71;
      for (const { high, low } of meshes) {
        high.visible = near < HIGH_DETAIL_DISTANCE;
        low.visible = !high.visible && near < VISIBLE_DISTANCE;
      }
    }
  });
  return { group, count: trees.count, conifers: coniferCount, threshold };
}
