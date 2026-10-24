import * as THREE from "three";
import { rasterGridGeometry } from "./demographics.js";

const WMS_URL = "https://wms.geo.admin.ch/";
const IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const ROUTE_ANALYSES = Object.freeze({
  hiking: {
    id: "hiking", title: "Amtliche Wanderwege", layer: "ch.swisstopo.swisstlm3d-wanderwege",
    source: "swisstopo swissTLM3D · Wanderwege", updated: "2026-07-28",
    description: "Wanderwege sind auf das Gelände projiziert. Die Karte zeigt den amtlichen Wegbestand.",
  },
  cycling: {
    id: "cycling", title: "Offizielle Velorouten", layer: "ch.astra.veloland",
    source: "ASTRA und SchweizMobil · Veloland Schweiz", updated: "2026-02-25",
    description: "Nationale, regionale und lokale Velorouten aus dem offiziellen Veloland-Datensatz.",
  },
  closures: {
    id: "closures", title: "Weg-Sperrungen", layer: "ch.astra.wanderland-sperrungen_umleitungen",
    source: "ASTRA und Kantone · Wanderweg-Sperrungen", updated: "täglich",
    description: "Gemeldete Sperrungen und Umleitungen. Keine Meldung ist keine Bestätigung für einen offenen Weg.",
  },
  flood: {
    id: "flood", title: "Hochwasser · grobe Übersicht", layer: "ch.bafu.aquaprotect_100", query: "wms",
    source: "BAFU · Aquaprotect 100", updated: "2008-12-18",
    description: "Grobe schweizweite Übersicht potenziell überschwemmter Gebiete bei seltenen Hochwasserabflüssen; keine aktuelle Warnung und keine parzellenscharfe Gefahrenkarte.",
  },
  roadNoise: {
    id: "roadNoise", title: "Strassenlärm am Tag", layer: "ch.bafu.laerm-strassenlaerm_tag", query: "wms",
    source: "BAFU · sonBASE-Modell", updated: "2021",
    description: "Modellierte Lärmbelastung am Tag, kein Messwert am Gebäude.",
  },
  railNoise: {
    id: "railNoise", title: "Bahnlärm am Tag", layer: "ch.bafu.laerm-bahnlaerm_tag", query: "wms",
    source: "BAFU · Eisenbahnlärm-Modell", updated: "2021",
    description: "Modellierte Lärmbelastung am Tag, kein Messwert am Gebäude.",
  },
});

export function officialRouteMapUrl(source, extent, width, height) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: source.layer, STYLES: "default",
    CRS: "EPSG:2056", BBOX: `${extent.minE},${extent.minN},${extent.maxE},${extent.maxN}`,
    WIDTH: String(width), HEIGHT: String(height), FORMAT: "image/png", TRANSPARENT: "true",
  });
  return `${WMS_URL}?${params}`;
}

function legendUrl(source) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetLegendGraphic", LAYER: source.layer,
    STYLE: "default", FORMAT: "image/png", SLD_VERSION: "1.1.0",
  });
  return `${WMS_URL}?${params}`;
}

function identifyUrl(source, east, north) {
  const params = new URLSearchParams({
    geometry: `${east},${north}`, geometryType: "esriGeometryPoint", layers: `all:${source.layer}`,
    sr: "2056", lang: "de", tolerance: "20", mapExtent: `${east - 200},${north - 200},${east + 200},${north + 200}`,
    imageDisplay: "256,256,96", returnGeometry: "true",
  });
  return `${IDENTIFY_URL}?${params}`;
}

function featureInfoUrl(source, east, north) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: source.layer, QUERY_LAYERS: source.layer,
    STYLES: "", CRS: "EPSG:2056", BBOX: `${east - 100},${north - 100},${east + 100},${north + 100}`,
    WIDTH: "256", HEIGHT: "256", I: "128", J: "128", FORMAT: "image/png", INFO_FORMAT: "application/json", FEATURE_COUNT: "3",
  });
  return `${WMS_URL}?${params}`;
}

function queryFeature(source, east, north) {
  const url = source.query === "wms" ? featureInfoUrl(source, east, north) : identifyUrl(source, east, north);
  return fetch(url).then((response) => response.ok ? response.json() : null).then((data) => source.query === "wms" ? data?.features?.[0] ?? null : data?.results?.[0] ?? null);
}

export function renderFeatureInfo(container, source, feature) {
  container.replaceChildren();
  const heading = document.createElement("strong");
  const attributes = feature?.attributes ?? {};
  const featureName = attributes.name ?? attributes.label ?? attributes.route_name;
  heading.textContent = featureName || (source.id === "closures" ? "Sperrhinweis" : "Wegabschnitt");
  if (source.id === "flood") heading.textContent = "Aquaprotect · grobe Übersicht";
  container.append(heading);
  if (!feature) {
    const note = document.createElement("p");
    note.textContent = source.id === "flood"
      ? "Aquaprotect zeigt an diesem Punkt keine ausgewiesene Fläche. Das ist keine Bestätigung, dass keine Hochwassergefahr besteht."
      : source.id === "closures"
      ? "Hier wurde keine Meldung gefunden. Das bestätigt nicht, dass ein Weg frei ist."
      : "Für diesen Punkt wurde kein passendes Objekt zurückgegeben.";
    container.append(note);
    return;
  }
  if (source.id === "flood") {
    const note = document.createElement("p");
    note.textContent = "Die Abfrage liefert keine eindeutige Gefahrenstufe für diesen einzelnen Standort. Aquaprotect ist eine grobe BAFU-Übersicht, keine aktuelle Warnung und keine parzellenscharfe Gefahrenkarte.";
    container.append(note);
    return;
  }
  if (source.query === "wms" && feature.properties?.value_0 != null) {
    const value = document.createElement("p");
    value.textContent = `Modellierter Rasterwert: ${feature.properties.value_0} dB(A). Referenzjahr 2021; kein Messwert am Gebäude.`;
    container.append(value);
    return;
  }
  const rows = [
    ["Wegart", attributes.hikingtype ?? attributes.route_type],
    ["Status", attributes.status ?? attributes.status_text],
    ["Gültig ab", attributes.valid_from ?? attributes.start_date],
    ["Gültig bis", attributes.valid_until ?? attributes.end_date],
    ["Umleitung", attributes.detour ?? attributes.description],
  ].filter(([, value]) => value != null && value !== "");
  if (rows.length) {
    const list = document.createElement("dl");
    for (const [label, value] of rows) {
      const term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label; detail.textContent = String(value); list.append(term, detail);
    }
    container.append(list);
  } else {
    const note = document.createElement("p");
    note.textContent = "Der Datensatz enthält für diesen Abschnitt keine zusätzlichen Angaben.";
    container.append(note);
  }
}

export function initOfficialRouteAnalyses(ctx) {
  const { scene3d, terrain, frame, meta, inspector } = ctx;
  const grid = rasterGridGeometry(terrain, frame, meta.dem.extent);
  const group = new THREE.Group();
  group.name = "official-route-analyses";
  scene3d.scene.add(group);
  scene3d.aoExcluded.add(group);
  const panel = document.querySelector("#demographic-analysis");
  const title = document.querySelector("#demographic-analysis-title");
  const description = document.querySelector("#demographic-analysis-description");
  const modeSelect = document.querySelector("#analysis-mode");
  const legend = document.querySelector(".demographic-analysis-legend");
  const legendLabel = legend.querySelector("span");
  const legendImage = document.querySelector("#demographic-analysis-legend");
  const viewControls = document.querySelector(".demographic-analysis-views");
  const timeControls = document.querySelector("#walking-analysis-controls");
  const categoryFilter = document.querySelector("#walking-category-filter");
  const walkingResults = document.querySelector("#walking-analysis-results");
  const cellInfo = document.querySelector("#demographic-cell-info");
  const meshes = new Map();
  const textures = new Map();
  const mapPromises = new Map();
  let activeMode = null, requestId = 0;

  for (const source of Object.values(ROUTE_ANALYSES)) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(grid.geometry, material);
    mesh.name = source.id;
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.visible = false;
    group.add(mesh);
    meshes.set(source.id, mesh);
  }

  function loadTexture(source) {
    if (textures.has(source.id)) return Promise.resolve(textures.get(source.id));
    if (!mapPromises.has(source.id)) {
      const width = Math.min(1536, Math.max(256, grid.columns * 10));
      const height = Math.max(128, Math.round(width * grid.extent.height / grid.extent.width));
      mapPromises.set(source.id, new THREE.TextureLoader().loadAsync(officialRouteMapUrl(source, grid.extent, width, height)).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
        textures.set(source.id, texture);
        return texture;
      }).catch((error) => {
        mapPromises.delete(source.id);
        throw error;
      }));
    }
    return mapPromises.get(source.id);
  }

  function activate(id) {
    const source = ROUTE_ANALYSES[id];
    if (!source) return false;
    activeMode = id;
    const request = ++requestId;
    for (const [key, mesh] of meshes) mesh.visible = key === id && textures.has(key);
    panel.hidden = false;
    modeSelect.value = id;
    title.textContent = source.title;
    description.textContent = `${source.description} Quelle: ${source.source} · Stand ${source.updated}.`;
    legend.hidden = false;
    legendLabel.textContent = "Legende";
    legendImage.hidden = false;
    legendImage.alt = `Legende: ${source.title}`;
    legendImage.src = legendUrl(source);
    viewControls.hidden = true;
    timeControls.hidden = true;
    categoryFilter.hidden = true;
    walkingResults.hidden = false;
    cellInfo.hidden = true;
    walkingResults.replaceChildren();
    const status = document.createElement("p");
    status.className = "walking-results-summary";
    status.textContent = source.id === "closures"
      ? "Wegabschnitte auf der Karte anklicken. Eine fehlende Meldung bestätigt keine Begehbarkeit."
      : "Wegabschnitte auf der Karte anklicken, um die verfügbaren Angaben zu sehen.";
    walkingResults.append(status);
    void loadTexture(source).then((texture) => {
      if (activeMode !== id || request !== requestId) return;
      const mesh = meshes.get(id);
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
      mesh.visible = true;
    }).catch(() => {
      if (activeMode !== id || request !== requestId) return;
      status.textContent = "Diese Kartenquelle ist momentan nicht erreichbar.";
    });
    return true;
  }

  function deactivate() {
    activeMode = null;
    requestId++;
    meshes.forEach((mesh) => { mesh.visible = false; });
    if (!ctx.demographics?.activeLayer() && !ctx.walking?.active) panel.hidden = true;
  }

  ctx.clickHandlers.unshift(({ ground }) => {
    if (!activeMode || !ground) return false;
    const source = ROUTE_ANALYSES[activeMode];
    const { e, n } = frame.toLV95(ground.x, ground.z);
    const request = ++requestId;
    renderFeatureInfo(walkingResults, source, null);
    void queryFeature(source, e, n).then((feature) => {
      if (request !== requestId || !activeMode) return;
      renderFeatureInfo(walkingResults, source, feature);
    }).catch(() => {
      if (request !== requestId || !activeMode) return;
      renderFeatureInfo(walkingResults, source, null);
    });
    return true;
  });

  ctx.officialRoutes = { activate, deactivate, get active() { return activeMode; } };
  return ctx.officialRoutes;
}