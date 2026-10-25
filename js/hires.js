// Hochauflösendes Luftbild (SWISSIMAGE, WMS) als Kachel um den Blickpunkt, aufgeblendet auf das 2-m-Gelände-Luftbild.
import * as THREE from "three";

const SIZE = 700;       // Kantenlänge der Kachel in m
const GRID = 100;       // Kachelmitte rastert auf 100 m, damit Texturen wiederverwendet werden
const SETTLE_MS = 350;  // erst laden und hochladen, wenn die Kamera so lange ruht
// Auf Handys und schwachen Geräten kleinere Kacheln (0.68 statt 0.34 m pro Pixel, ein Viertel des Grafikspeichers)
// und weniger Kacheln im Speicher: Das Hochladen einer 2048er-Kachel blockierte dort beim Zoomen und Verschieben.
const quality = (lowPower) => lowPower ? { pixels: 1024, maxCache: 2, anisotropy: 4 } : { pixels: 2048, maxCache: 4, anisotropy: 16 };
const FULL_DISTANCE = 1500, FADE_DISTANCE = 700;

export function initHires(ctx) {
  const { terrain, scene3d, frame, layers, reportError } = ctx;
  const { pixels: PIXELS, maxCache: MAX_CACHE, anisotropy } = quality(ctx.lowPower);
  const cache = new Map();
  // Bewegung und Gesten verfolgen: Kacheln nur bei ruhender Kamera nachladen und auf die Grafikkarte legen.
  let interacting = false, lastMove = 0;
  const lastTarget = new THREE.Vector3(), lastPosition = new THREE.Vector3();
  scene3d.controls.addEventListener("start", () => { interacting = true; });
  scene3d.controls.addEventListener("end", () => { interacting = false; lastMove = performance.now(); });

  /** Bild laden und vorab dekodieren (img.decode() arbeitet ausserhalb des Hauptthreads), statt beim Hochladen. */
  async function loadImage(url) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = url;
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    return image;
  }
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
    const texture = new THREE.Texture(await loadImage(`https://wms.geo.admin.ch/?${params}`));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // Zeile 0 = Norden = kleinstes z
    texture.anisotropy = Math.min(anisotropy, scene3d.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    cache.set(cacheKey, texture);
    while (cache.size > MAX_CACHE) {
      const [oldKey, oldTexture] = cache.entries().next().value;
      if (oldTexture !== state.current?.texture) { oldTexture.dispose(); cache.delete(oldKey); } else break;
    }
    return texture;
  }

  function apply(key, texture) {
    const { minX, minZ } = rectFor(key);
    // Hochladen hier gezielt auslösen (Kamera ruht), nicht mitten in einer Geste beim nächsten Bild.
    scene3d.renderer.initTexture?.(texture);
    terrain.uniforms.uHires.value = texture;
    terrain.uniforms.uHiresRect.value.set(minX, minZ, SIZE, SIZE);
    state.current = { key, texture };
  }

  let last = 0;
  scene3d.onFrame((_, now, distance) => {
    const u = terrain.uniforms;
    const mix = state.enabled && state.current ? THREE.MathUtils.clamp((FULL_DISTANCE + FADE_DISTANCE - distance) / FADE_DISTANCE, 0, 1) : 0;
    u.uHiresMix.value = mix;
    // Während des Start-Zeitraffers keine Luftbildkacheln laden: Dekodieren und GPU-Upload erzeugen sichtbare Ruckler.
    const target = scene3d.controls.target, position = scene3d.camera.position;
    if (target.distanceToSquared(lastTarget) > 0.25 || position.distanceToSquared(lastPosition) > 0.25) {
      lastMove = now;
      lastTarget.copy(target);
      lastPosition.copy(position);
    }
    const settled = !interacting && now - lastMove > SETTLE_MS;
    if (!state.enabled || state.failed || state.loading || !settled || ctx.cancelTimeTransition || now - last < 700 || distance > FULL_DISTANCE + FADE_DISTANCE) return;
    last = now;
    const key = `${Math.round(target.x / GRID)}:${Math.round(target.z / GRID)}`;
    const cur = state.current;
    if (cur) {
      const { minX, minZ } = rectFor(cur.key);
      const inside = target.x > minX + SIZE * 0.2 && target.x < minX + SIZE * 0.8 && target.z > minZ + SIZE * 0.2 && target.z < minZ + SIZE * 0.8;
      if (inside) return;
    }
    const requested = state.layer;
    state.loading = load(key).then(async (texture) => {
      // Während des Ladens wieder bewegt? Mit dem Hochladen warten, bis die Kamera erneut ruht.
      while (interacting || performance.now() - lastMove < SETTLE_MS) await new Promise((resolve) => setTimeout(resolve, 100));
      if (requested === state.layer) apply(key, texture);
    }).catch((error) => {
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
