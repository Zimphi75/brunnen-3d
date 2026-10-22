// Bodenansicht: simulierter Boden (Vorgabe), Luftbild oder Landeskarte; Karte und Luftbild werden in Blicknähe scharf nachgeladen.
import * as THREE from "three";

const WMS = "https://wms.geo.admin.ch/";
const MODES = {
  sim: { label: "Simulation (Vorgabe)", shader: 0, layer: "ch.swisstopo.swissimage", format: "image/jpeg", note: "Wiese, Waldboden, Fels und befestigte Flächen sind aus der Luftbildfarbe klassiert und mit zufälligem Detail überzogen. Nicht gemessen: Halme, Muster und Farbnuancen." },
  aerial: { label: "Luftbild (SWISSIMAGE)", shader: 1, layer: "ch.swisstopo.swissimage", format: "image/jpeg", note: "Luftbild swisstopo, global 2 m, in Blicknähe bis 0.3 m." },
  map: { label: "Landeskarte (swisstopo)", shader: 1, layer: "ch.swisstopo.pixelkarte-farbe", format: "image/png", note: "Landeskarte swisstopo (Pixelkarte farbig); in Blicknähe wird sie schärfer nachgeladen." },
};

export function initGround(ctx) {
  const { $, terrain, meta, scene3d, reportError } = ctx;
  const select = $("#ground-mode"), note = $("#ground-note");
  select.innerHTML = Object.entries(MODES).map(([id, m]) => `<option value="${id}">${m.label}</option>`).join("");
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  let mapTexture = null;
  const state = { mode: null };
  let request = 0;

  function mapUrl(width = meta.ortho.width, height = meta.ortho.height) {
    const [minE, minN, maxE, maxN] = meta.ortho.extent;
    const params = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: MODES.map.layer, STYLES: "", SRS: "EPSG:2056",
      BBOX: `${minE},${minN},${maxE},${maxN}`, WIDTH: String(width), HEIGHT: String(height), FORMAT: MODES.map.format,
    });
    return `${WMS}?${params}`;
  }

  async function loadMap() {
    if (mapTexture) return mapTexture;
    mapTexture = await loader.loadAsync(mapUrl());
    mapTexture.colorSpace = THREE.SRGBColorSpace;
    mapTexture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
    return mapTexture;
  }

  async function set(mode) {
    const definition = MODES[mode];
    if (!definition) return;
    const currentRequest = ++request;
    note.textContent = definition.note;
    let texture = ctx.orthoTexture;
    if (mode === "map") {
      note.textContent = "Landeskarte wird geladen …";
      try { texture = await loadMap(); } catch (error) {
        if (currentRequest !== request) return;
        reportError("Landeskarte (swisstopo-WMS) nicht erreichbar; es bleibt bei der vorherigen Bodenansicht.", error);
        select.value = state.mode ?? "sim";
        note.textContent = MODES[select.value].note;
        return;
      }
      if (currentRequest !== request) return;
      note.textContent = definition.note;
    }
    if (!texture) { reportError("Luftbild fehlt; Boden ohne Textur."); return; }
    terrain.setTexture(texture);
    terrain.uniforms.uGroundMode.value = definition.shader;
    ctx.hires?.setSource(definition.layer, definition.format);
    state.mode = mode;
    select.value = mode;
    localStorage.setItem("brunnen3d-ground", mode);
    ctx.onGroundModeChange?.(mode);
  }

  select.addEventListener("change", () => set(select.value));
  set("sim");
  ctx.ground = { set, state, MODES, previewUrl: () => mapUrl(320, 220) };
}
