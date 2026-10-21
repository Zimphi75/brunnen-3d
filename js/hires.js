// Hochauflösendes Luftbild (SWISSIMAGE, WMS) als Kachel um den Blickpunkt, aufgeblendet auf das 2-m-Gelände-Luftbild.
import * as THREE from "three";

const SIZE = 700;       // Kantenlänge der Kachel in m
const PIXELS = 2048;    // ca. 0.34 m pro Pixel
const GRID = 100;       // Kachelmitte rastert auf 100 m, damit Texturen wiederverwendet werden
const MAX_CACHE = 4;
const FULL_DISTANCE = 1500, FADE_DISTANCE = 700;

export function initHires(ctx) {
  const { terrain, scene3d, frame, layers, reportError } = ctx;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const cache = new Map();
  const state = { enabled: true, failed: false, current: null, loading: null, layer: "ch.swisstopo.swissimage", format: "image/jpeg" };

  function rectFor(key) {
    const [gx, gz] = key.split(":").map(Number);
    return { minX: gx * GRID - SIZE / 2 + GRID / 2, minZ: gz * GRID - SIZE / 2 + GRID / 2 };
  }

  async function load(key) {
    const cacheKey = `${state.layer}|${key}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const { minX, minZ } = rectFor(key);
    const minE = minX + frame.originE, maxE = minE + SIZE;
    const maxN = frame.originN - minZ, minN = maxN - SIZE;
    const params = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: state.layer, STYLES: "", SRS: "EPSG:2056",
      BBOX: `${minE},${minN},${maxE},${maxN}`, WIDTH: String(PIXELS), HEIGHT: String(PIXELS), FORMAT: state.format,
    });
    const texture = await loader.loadAsync(`https://wms.geo.admin.ch/?${params}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // Zeile 0 = Norden = kleinstes z
    texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
    cache.set(cacheKey, texture);
    while (cache.size > MAX_CACHE) {
      const [oldKey, oldTexture] = cache.entries().next().value;
      if (oldTexture !== state.current?.texture) { oldTexture.dispose(); cache.delete(oldKey); } else break;
    }
    return texture;
  }

  function apply(key, texture) {
    const { minX, minZ } = rectFor(key);
    terrain.uniforms.uHires.value = texture;
    terrain.uniforms.uHiresRect.value.set(minX, minZ, SIZE, SIZE);
    state.current = { key, texture };
  }

  let last = 0;
  scene3d.onFrame((_, now, distance) => {
    const u = terrain.uniforms;
    const mix = state.enabled && state.current ? THREE.MathUtils.clamp((FULL_DISTANCE + FADE_DISTANCE - distance) / FADE_DISTANCE, 0, 1) : 0;
    u.uHiresMix.value = mix;
    if (!state.enabled || state.failed || state.loading || now - last < 700 || distance > FULL_DISTANCE + FADE_DISTANCE) return;
    last = now;
    const target = scene3d.controls.target;
    const key = `${Math.round(target.x / GRID)}:${Math.round(target.z / GRID)}`;
    const cur = state.current;
    if (cur) {
      const { minX, minZ } = rectFor(cur.key);
      const inside = target.x > minX + SIZE * 0.2 && target.x < minX + SIZE * 0.8 && target.z > minZ + SIZE * 0.2 && target.z < minZ + SIZE * 0.8;
      if (inside) return;
    }
    const requested = state.layer;
    state.loading = load(key).then((texture) => { if (requested === state.layer) apply(key, texture); }).catch((error) => {
      state.failed = true;
      console.warn("Hochauflösendes Luftbild:", error);
      reportError("Hochauflösendes Luftbild (swisstopo-WMS) nicht erreichbar; es bleibt beim 2-m-Luftbild.", error);
    }).finally(() => { state.loading = null; });
  });

  layers.add({
    id: "hires", label: "Luftbild scharf (Nähe)", color: "#4f6f4a", visible: true,
    apply: (v) => { state.enabled = v; },
  });
  /** Wechselt die WMS-Ebene der Nahkachel (Luftbild oder Landeskarte). */
  state.setSource = (layer, format) => {
    state.layer = layer; state.format = format; state.failed = false; state.current = null; last = 0;
    terrain.uniforms.uHiresMix.value = 0;
  };
  ctx.hires = state;
}
