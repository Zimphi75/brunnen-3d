// Fahrzeug-, Personen- und Hundemodelle für den simulierten Alltag, mit Materialien.
// Autos: glatt gewölbte Karosserie aus Querschnitten (Loft), Glas, Felgen, Leuchten, Lack mit Klarlack und Himmelsspiegelung.
// Personen und Hunde: Kastenfiguren mit Gehbewegung (Beine und Arme schwingen im Shader), Kleidung und Haut aus der Instanzfarbe.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, cylinder } from "./models.js";

const WHITE = "#ffffff";
const MAT = { paint: 0, glass: 1, rubber: 2, chrome: 3, lamp: 4 };
const lerp = (a, b, t) => a + (b - a) * t;
const signPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
const smooth = (t) => t * t * (3 - 2 * t);

/** Stückweise glatte Kurve durch Stützpunkte [[s, wert], …]. */
function curve(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) { const [s0, v0] = keys[i - 1], [s1, v1] = keys[i]; return lerp(v0, v1, smooth((s - s0) / (s1 - s0))); }
  }
  return keys[keys.length - 1][1];
}

function tagMaterial(geometry, code) {
  const n = geometry.attributes.position.count;
  geometry.setAttribute("aMat", new THREE.BufferAttribute(new Float32Array(n).fill(code), 1));
  return geometry;
}

/** Querschnittsfolge: `ring(station, k)` liefert [x, y] des k-ten Punkts; geschlossene Ringe, glatte Normalen. */
function loft(stations, ringSize, ring) {
  const positions = [];
  stations.forEach((station) => { for (let k = 0; k < ringSize; k++) { const [x, y] = ring(station, k); positions.push(x, y, station.z); } });
  const indices = [];
  for (let i = 0; i < stations.length - 1; i++) for (let k = 0; k < ringSize; k++) {
    const a = i * ringSize + k, b = i * ringSize + ((k + 1) % ringSize), c = a + ringSize, d = b + ringSize;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Orientierung prüfen: Normalen sollen vom Schwerpunkt weg zeigen
  const p = geometry.attributes.position, nrm = geometry.attributes.normal, centre = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) centre.add(new THREE.Vector3().fromBufferAttribute(p, i));
  centre.multiplyScalar(1 / p.count);
  let outward = 0;
  for (let i = 0; i < p.count; i++) outward += new THREE.Vector3().fromBufferAttribute(p, i).sub(centre).dot(new THREE.Vector3().fromBufferAttribute(nrm, i));
  if (outward < 0) { const flipped = indices.slice(); for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]]; geometry.setIndex(flipped); geometry.computeVertexNormals(); }
  const flat = geometry.toNonIndexed();
  flat.setAttribute("color", new THREE.BufferAttribute(new Float32Array(flat.attributes.position.count * 3).fill(1), 3));
  return flat;
}

const SPECS = {
  limousine: {
    L: 4.6, W: 1.82, sill: 0.24, wheel: 0.33, wheelbase: 0.295, belt: 0.98,
    top: [[0, 0.84], [0.08, 0.93], [0.2, 0.98], [0.7, 0.98], [0.8, 0.9], [0.93, 0.8], [1, 0.6]],
    roof: [[0.17, 0.98], [0.26, 1.34], [0.36, 1.44], [0.54, 1.44], [0.62, 1.36], [0.71, 1.0]], cabin: [0.17, 0.71], glassS: [0.26, 0.64], pillar: 0.46, frontGlass: true, rearGlass: true,
  },
  kompakt: {
    L: 3.95, W: 1.72, sill: 0.24, wheel: 0.31, wheelbase: 0.3, belt: 0.95,
    top: [[0, 0.98], [0.06, 1.0], [0.2, 0.95], [0.72, 0.95], [0.82, 0.88], [0.93, 0.78], [1, 0.6]],
    roof: [[0.04, 0.98], [0.12, 1.4], [0.24, 1.5], [0.55, 1.5], [0.65, 1.4], [0.75, 0.98]], cabin: [0.04, 0.75], glassS: [0.14, 0.7], pillar: 0.4, frontGlass: true, rearGlass: true,
  },
  suv: {
    L: 4.55, W: 1.9, sill: 0.3, wheel: 0.38, wheelbase: 0.29, belt: 1.12,
    top: [[0, 1.05], [0.06, 1.12], [0.2, 1.12], [0.7, 1.12], [0.8, 1.04], [0.93, 0.95], [1, 0.72]],
    roof: [[0.05, 1.12], [0.12, 1.66], [0.22, 1.74], [0.62, 1.74], [0.7, 1.64], [0.77, 1.14]], cabin: [0.05, 0.77], glassS: [0.14, 0.72], pillar: 0.42, frontGlass: true, rearGlass: true,
  },
  lieferwagen: {
    L: 5.3, W: 2.02, sill: 0.3, wheel: 0.35, wheelbase: 0.3, belt: 1.1,
    top: [[0, 1.1], [0.06, 1.12], [0.2, 1.12], [0.62, 1.12], [0.78, 0.98], [0.93, 0.88], [1, 0.66]],
    roof: [[0.02, 1.14], [0.07, 2.3], [0.2, 2.34], [0.58, 2.34], [0.68, 2.2], [0.78, 1.5], [0.85, 1.1]], cabin: [0.02, 0.85], glassS: [0.58, 0.78], pillar: 2, frontGlass: true, rearGlass: false,
  },
};

function carHigh(spec) {
  const { L, W, sill, belt } = spec;
  const hw = (s) => (W / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * s - 1), 6)), 0.42);
  const stations = [];
  for (let i = 0; i <= 34; i++) { const s = i / 34; stations.push({ s, z: (s - 0.5) * L }); }
  const bodyRing = ({ s }, k) => {
    const a = (k / 20) * Math.PI * 2, y0 = sill + 0.14 * Math.pow(Math.abs(2 * s - 1), 4), y1 = curve(spec.top, s);
    return [hw(s) * signPow(Math.cos(a), 2 / 3.6), (y0 + y1) / 2 + ((y1 - y0) / 2) * signPow(Math.sin(a), 2 / 3.6)];
  };
  const body = loft(stations, 20, bodyRing);
  tagMaterial(body, MAT.paint);

  const [sa, sb] = spec.cabin, NS = 24, RING = 24;
  const cabinStations = [];
  for (let i = 0; i <= NS; i++) { const s = lerp(sa, sb, i / NS); cabinStations.push({ s, z: (s - 0.5) * L }); }
  const roofY = (s) => curve(spec.roof, s);
  const cabinRing = ({ s }, k) => {
    const a = (k / RING) * Math.PI * 2, top = roofY(s), height = Math.max(0.012, top - belt + 0.02);
    const x = Math.cos(a), y = Math.sin(a);
    const narrow = y > 0 ? lerp(0.9, 0.7, y) : 0.9;
    return [hw(s) * narrow * signPow(x, 2 / 3), belt - 0.02 + height / 2 + (height / 2) * signPow(y, 2 / 3)];
  };
  const cabin = loft(cabinStations, RING, cabinRing);
  // Glas nach Gitterfeldern (Station i, Ringpunkt k) statt nach Lage: saubere, gerade Fensterränder
  const iOf = (s) => Math.round(((s - sa) / (sb - sa)) * NS);
  const sideFrom = iOf(spec.glassS[0]), sideTo = iOf(spec.glassS[1]), pillar = iOf(spec.pillar);
  const frontFrom = iOf(spec.roof[spec.roof.length - 2][0]), rearTo = iOf(spec.roof[1][0]);
  const cabinMat = new Float32Array(cabin.attributes.position.count);
  for (let quad = 0; quad < NS * RING; quad++) {
    const i = Math.floor(quad / RING), k = quad % RING;
    const side = (k === 2 || k === 3 || k === 8 || k === 9) && i >= sideFrom && i < sideTo && Math.abs(i - pillar) > 0;
    const front = spec.frontGlass && i >= frontFrom && k >= 3 && k <= 8;
    const rear = spec.rearGlass && i < rearTo && k >= 3 && k <= 8;
    const code = side || front || rear ? MAT.glass : MAT.paint;
    for (let v = 0; v < 6; v++) cabinMat[quad * 6 + v] = code;
  }
  cabin.setAttribute("aMat", new THREE.BufferAttribute(cabinMat, 1));

  const wheelZ = spec.wheelbase * L, wheelX = (W / 2) * 0.92, r = spec.wheel;
  const parts = [body, cabin];
  const wheels = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const x = sx * wheelX, z = sz * wheelZ;
    wheels.push(tagMaterial(cylinder(r, r, 0.23, 16, "#141517", x, r - 0.115, z, [0, 0, Math.PI / 2]), MAT.rubber));
    wheels.push(tagMaterial(cylinder(r * 0.68, r * 0.68, 0.235, 14, "#c9ced4", x + sx * 0.004, r - 0.1175, z, [0, 0, Math.PI / 2]), MAT.chrome));
    wheels.push(tagMaterial(cylinder(r * 0.2, r * 0.2, 0.245, 8, "#6b7078", x + sx * 0.008, r - 0.1225, z, [0, 0, Math.PI / 2]), MAT.chrome));
    const archX = sx * (hw(0.5 + sz * spec.wheelbase) + 0.004);
    wheels.push(tagMaterial(cylinder(r * 1.22, r * 1.22, 0.02, 16, "#08090a", archX, r - 0.01, z, [0, 0, Math.PI / 2]), MAT.rubber));
  }
  parts.push(...wheels);
  const front = L / 2, rear = -L / 2, lampY = curve(spec.top, 0.97) - 0.12;
  const detail = [
    [box(W * 0.86, 0.2, 0.2, "#26292d", 0, 0.3, front - 0.1), MAT.rubber], [box(W * 0.86, 0.2, 0.2, "#26292d", 0, 0.3, rear + 0.1), MAT.rubber],
    [box(W * 0.46, 0.14, 0.05, "#0c0d0f", 0, 0.5, front - 0.02), MAT.rubber], [box(W * 0.48, 0.02, 0.055, "#c9ced4", 0, 0.58, front - 0.02), MAT.chrome],
    [box(0.4, 0.1, 0.07, "#fff4d6", W / 2 - 0.3, lampY, front - 0.04), MAT.lamp], [box(0.4, 0.1, 0.07, "#fff4d6", -(W / 2 - 0.3), lampY, front - 0.04), MAT.lamp],
    [box(0.38, 0.1, 0.07, "#d11414", W / 2 - 0.28, curve(spec.top, 0.04) - 0.1, rear + 0.04), MAT.lamp], [box(0.38, 0.1, 0.07, "#d11414", -(W / 2 - 0.28), curve(spec.top, 0.04) - 0.1, rear + 0.04), MAT.lamp],
    [box(0.52, 0.12, 0.02, "#e8e8e2", 0, 0.42, front + 0.0), MAT.rubber], [box(0.52, 0.12, 0.02, "#e8e8e2", 0, 0.5, rear - 0.0), MAT.rubber],
    [box(0.1, 0.08, 0.17, "#ffffff", W / 2 + 0.03, belt + 0.06, (sb - 0.5) * L - 0.15), MAT.paint], [box(0.1, 0.08, 0.17, "#ffffff", -(W / 2 + 0.03), belt + 0.06, (sb - 0.5) * L - 0.15), MAT.paint],
  ];
  for (const [g, code] of detail) parts.push(tagMaterial(g, code));
  const merged = mergeGeometries(parts.map((g) => { if (!g.attributes.color) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; }));
  merged.computeBoundingSphere();
  return merged;
}

/** Einfache Fassung für grössere Entfernungen. */
function carLow(spec) {
  const { L, W, belt, sill } = spec;
  const roofTop = Math.max(...spec.roof.map(([, y]) => y)), [sa, sb] = spec.cabin, cabinLength = (sb - sa) * L * 0.85, shift = ((sa + sb) / 2 - 0.5) * L;
  const parts = [
    [box(W, belt - sill, L, WHITE, 0, sill, 0), MAT.paint], [box(W - 0.24, roofTop - belt, cabinLength, WHITE, 0, belt, shift), MAT.paint],
    [box(W - 0.2, (roofTop - belt) * 0.6, cabinLength + 0.06, "#0b1118", 0, belt + (roofTop - belt) * 0.18, shift), MAT.glass],
    [box(0.34, 0.1, 0.06, "#fff4d6", W / 2 - 0.3, belt - 0.3, L / 2), MAT.lamp], [box(0.34, 0.1, 0.06, "#fff4d6", -(W / 2 - 0.3), belt - 0.3, L / 2), MAT.lamp],
    [box(0.34, 0.1, 0.06, "#d11414", W / 2 - 0.3, belt - 0.25, -L / 2), MAT.lamp], [box(0.34, 0.1, 0.06, "#d11414", -(W / 2 - 0.3), belt - 0.25, -L / 2), MAT.lamp],
  ];
  const z = spec.wheelbase * L;
  for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push([cylinder(spec.wheel, spec.wheel, 0.23, 8, "#141517", sx * (W / 2 - 0.12), spec.wheel - 0.115, sz * z, [0, 0, Math.PI / 2]), MAT.rubber]);
  const merged = mergeGeometries(parts.map(([g, code]) => tagMaterial(g, code)));
  merged.computeBoundingSphere();
  return merged;
}

export const CAR_KINDS = [
  { id: "limousine", weight: 0.42 }, { id: "kompakt", weight: 0.3 }, { id: "suv", weight: 0.17 }, { id: "lieferwagen", weight: 0.11 },
].map((k) => ({ ...k, high: carHigh(SPECS[k.id]), low: carLow(SPECS[k.id]) }));

export function carMaterial(envMap) {
  const uniforms = { uNightGlow: { value: 0 } };
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06, envMap, envMapIntensity: 1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = "attribute float aMat; varying float vMat;\n" + shader.vertexShader
      .replace("#include <color_vertex>", "vColor = vec3( 1.0 ); vColor *= color; if ( aMat < 0.5 ) vColor *= instanceColor.xyz; vMat = aMat;");
    shader.fragmentShader = "varying float vMat; uniform float uNightGlow;\n" + shader.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\n if ( vMat > 0.5 && vMat < 1.5 ) diffuseColor.rgb = vec3( 0.012, 0.018, 0.027 );")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = vMat < 0.5 ? 0.3 : vMat < 1.5 ? 0.04 : vMat < 2.5 ? 0.85 : vMat < 3.5 ? 0.22 : 0.15;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = vMat < 0.5 ? 0.45 : vMat < 1.5 ? 0.9 : vMat < 2.5 ? 0.0 : vMat < 3.5 ? 0.95 : 0.0;")
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n material.clearcoat = vMat < 0.5 ? 1.0 : 0.0;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n if ( vMat > 3.5 ) totalEmissiveRadiance += vColor.rgb * ( 0.12 + uNightGlow * 2.2 );");
  };
  material.customProgramCacheKey = () => "cars-v2";
  return { material, uniforms };
}

// --- Personen und Hunde --------------------------------------------------------------------------------------------------

/** Teil mit Farbrolle (0 fest, 1 Instanzfarbe, 2 Hose, 3 Haut, 4 Haar) und Schwung um einen Drehpunkt (limb: ±1, pivot: Höhe). */
function part(geometry, tint, limb = 0, pivot = 0) {
  const n = geometry.attributes.position.count;
  geometry.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  geometry.setAttribute("aLimb", new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  geometry.setAttribute("aPivot", new THREE.BufferAttribute(new Float32Array(n).fill(pivot), 1));
  return geometry;
}

function withPhase(geometry, count) {
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  return geometry;
}

export function pedestrianGeometry(count) {
  const shoe = "#1c1c1e";
  const g = mergeGeometries([
    part(box(0.15, 0.84, 0.17, WHITE, 0.1, 0, 0), 2, 1, 0.84), part(box(0.15, 0.84, 0.17, WHITE, -0.1, 0, 0), 2, -1, 0.84),
    part(box(0.15, 0.07, 0.27, shoe, 0.1, 0, 0.05), 0, 1, 0.84), part(box(0.15, 0.07, 0.27, shoe, -0.1, 0, 0.05), 0, -1, 0.84),
    part(box(0.45, 0.62, 0.26, WHITE, 0, 0.82, 0), 1),
    part(box(0.095, 0.6, 0.12, WHITE, 0.27, 0.8, 0), 1, -1, 1.38), part(box(0.095, 0.6, 0.12, WHITE, -0.27, 0.8, 0), 1, 1, 1.38),
    part(box(0.085, 0.1, 0.1, WHITE, 0.27, 0.72, 0), 3, -1, 1.38), part(box(0.085, 0.1, 0.1, WHITE, -0.27, 0.72, 0), 3, 1, 1.38),
    part(box(0.1, 0.09, 0.1, WHITE, 0, 1.43, 0), 3), part(box(0.19, 0.23, 0.21, WHITE, 0, 1.47, 0), 3),
    part(box(0.2, 0.09, 0.22, WHITE, 0, 1.64, 0), 4), part(box(0.2, 0.2, 0.05, WHITE, 0, 1.47, -0.09), 4),
  ]);
  return withPhase(g, count);
}

export function dogGeometry(count) {
  const nose = "#26201d", collar = "#b52424";
  const g = mergeGeometries([
    part(box(0.2, 0.26, 0.5, WHITE, 0, 0.17, -0.02), 1), part(box(0.22, 0.3, 0.22, WHITE, 0, 0.15, 0.15), 1),
    part(box(0.13, 0.2, 0.1, WHITE, 0, 0.36, 0.27), 1), part(box(0.145, 0.15, 0.17, WHITE, 0, 0.47, 0.36), 1), part(box(0.08, 0.08, 0.11, nose, 0, 0.46, 0.5), 0),
    part(box(0.04, 0.1, 0.06, WHITE, 0.065, 0.6, 0.33), 1), part(box(0.04, 0.1, 0.06, WHITE, -0.065, 0.6, 0.33), 1),
    part(box(0.04, 0.04, 0.22, WHITE, 0, 0.5, -0.4, [-0.7, 0, 0]), 1), part(box(0.15, 0.035, 0.12, collar, 0, 0.4, 0.28), 0),
    part(box(0.06, 0.3, 0.06, WHITE, 0.07, 0, 0.17), 1, 1, 0.3), part(box(0.06, 0.3, 0.06, WHITE, -0.07, 0, 0.17), 1, -1, 0.3),
    part(box(0.06, 0.3, 0.06, WHITE, 0.07, 0, -0.18), 1, -1, 0.3), part(box(0.06, 0.3, 0.06, WHITE, -0.07, 0, -0.18), 1, 1, 0.3),
  ]);
  return withPhase(g, count);
}

export function figureMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float aTint; attribute float aLimb; attribute float aPivot; attribute float aPhase;\n` + shader.vertexShader
      .replace("#include <color_vertex>", `vColor = vec3( 1.0 ); vColor *= color;
        vec3 ic = instanceColor.xyz;
        float h1 = fract( sin( dot( ic, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
        vec3 trouser = h1 < 0.4 ? vec3( 0.07, 0.09, 0.17 ) : h1 < 0.7 ? vec3( 0.05, 0.05, 0.06 ) : vec3( 0.26, 0.22, 0.14 );
        vec3 skin = h1 < 0.25 ? vec3( 0.52, 0.34, 0.26 ) : h1 < 0.5 ? vec3( 0.38, 0.24, 0.18 ) : h1 < 0.75 ? vec3( 0.6, 0.42, 0.32 ) : vec3( 0.2, 0.12, 0.09 );
        vec3 hair = h1 < 0.3 ? vec3( 0.02, 0.015, 0.015 ) : h1 < 0.55 ? vec3( 0.08, 0.045, 0.02 ) : h1 < 0.75 ? vec3( 0.34, 0.22, 0.07 ) : vec3( 0.3, 0.3, 0.3 );
        if ( aTint > 3.5 ) vColor *= hair; else if ( aTint > 2.5 ) vColor *= skin; else if ( aTint > 1.5 ) vColor *= trouser; else if ( aTint > 0.5 ) vColor *= ic;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        if ( aLimb != 0.0 ) {
          float swing = aLimb * sin( aPhase ) * 0.55;
          float dy = transformed.y - aPivot, cs = cos( swing ), sn = sin( swing );
          float ny = aPivot + dy * cs - transformed.z * sn;
          transformed.z = dy * sn + transformed.z * cs;
          transformed.y = ny;
        }`);
  };
  material.customProgramCacheKey = () => "figures-v1";
  return material;
}
