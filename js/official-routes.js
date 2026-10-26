import * as THREE from "three";
import { rasterGridGeometry } from "./demographics.js";
import {
  constructionUrl, parseConstructionSites, sitesInExtent, buildConstructionRibbons, buildRibbons, clipLines, renderLegend, nearestConstructionSite,
  renderConstructionInfo, renderConstructionLegend,
} from "./construction.js";

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
    id: "closures", title: "Sperrungen und Baustellen", layer: "ch.astra.wanderland-sperrungen_umleitungen",
    source: "ASTRA und Kantone (Wanderweg-Sperrungen), Tiefbauamt Kanton Schwyz (Baustellen Kantonsstrassen)", updated: "täglich",
    description: "Gemeldete Wegsperrungen, Umleitungen und Baustellen auf Kantonsstrassen. Keine Meldung ist keine Bestätigung für einen offenen Weg oder eine freie Strasse.",
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

const VELO_COLOR = "#d6246e";
// Vektordarstellung statt WMS-Bild: scharf bei jedem Zoom, auf Wegbreite.
const VECTOR_MODES = Object.freeze({
  hiking: {
    width: 4,
    item: (a) => {
      const alpine = a.hikingtype === "Alpinwanderweg";
      return { color: alpine ? "#1d5fbf" : "#f2c230", title: alpine ? "Alpinwanderweg" : "Wanderweg", rows: [["Quelle", "swisstopo swissTLM3D"]] };
    },
    legend: () => [{ label: "Wanderweg und Bergwanderweg", color: "#f2c230" }, { label: "Alpinwanderweg", color: "#1d5fbf" }],
  },
  cycling: {
    width: 6,
    item: (a) => ({
      color: VELO_COLOR,
      title: `Veloroute ${a.chmobil_route_number}`, rows: [["Name", a.chmobil_title]],
    }),
    legend: () => [{ label: "Veloland-Route (Anklicken für Name)", color: VELO_COLOR }],
  },
});

export function officialMapUrl(layer, east, north) {
  const params = new URLSearchParams({ lang: "de", center: `${Math.round(east)},${Math.round(north)}`, z: "10", bgLayer: "ch.swisstopo.pixelkarte-farbe", layers: layer });
  return `https://map.geo.admin.ch/#/map?${params}`;
}

const CONSTRUCTION_MAP_URL = "https://www.sz.ch/behoerden/verwaltung/baudepartement/tiefbauamt/baustellen.html/8756-8758-8802-9276-9290-10050";

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
  const { scene3d, terrain, frame, meta, inspector, layers } = ctx;
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
  let sitesPromise = null, sites = [];
  let closuresPromise = null, wayClosures = [];
  const vectorGroups = new Map(), vectorPromises = new Map(), vectorItems = new Map();
  const overlayOn = { closures: false, hiking: false, cycling: false };
  const overlayShown = (key) => activeMode === key || overlayOn[key];

  function syncOverlays() {
    constructionMesh.visible = overlayShown("closures");
    for (const [key, ribbons] of vectorGroups) ribbons.visible = overlayShown(key);
  }
  const links = document.createElement("p");
  links.className = "official-links";
  links.hidden = true;
  walkingResults.after(links);

  function showLinks(id) {
    links.replaceChildren();
    const entries = [];
    if (id === "hiking" || id === "cycling" || id === "closures") {
      entries.push(["In der amtlichen Karte öffnen", () => {
        const target = scene3d.controls.target, { e, n } = frame.toLV95(target.x, target.z);
        return officialMapUrl(ROUTE_ANALYSES[id].layer, e, n);
      }]);
    }
    if (id === "closures") entries.push(["Baustellenkarte Kanton Schwyz", () => CONSTRUCTION_MAP_URL]);
    for (const [label, href] of entries) {
      const link = document.createElement("a");
      link.textContent = label; link.href = href(); link.target = "_blank"; link.rel = "noopener noreferrer";
      link.style.cssText = "display:block;margin-top:6px";
      // Ansicht kann sich seit der Aktivierung verändert haben.
      link.addEventListener("click", () => { link.href = href(); });
      links.append(link);
    }
    links.hidden = !entries.length;
  }

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

  const constructionMesh = new THREE.Group();
  constructionMesh.name = "construction-sites";
  constructionMesh.visible = false;
  group.add(constructionMesh);

  function loadConstruction() {
    if (!sitesPromise) {
      sitesPromise = fetch(constructionUrl()).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).then((text) => {
        sites = sitesInExtent(parseConstructionSites(text), grid.extent);
        constructionMesh.add(buildConstructionRibbons(sites, terrain, frame));
        return sites;
      }).catch((error) => {
        sitesPromise = null;
        throw error;
      });
    }
    return sitesPromise;
  }

  function loadWayClosures() {
    if (!closuresPromise) {
      const { minE, minN, maxE, maxN } = grid.extent;
      const params = new URLSearchParams({
        geometryType: "esriGeometryEnvelope", geometry: `${minE},${minN},${maxE},${maxN}`, layers: `all:${ROUTE_ANALYSES.closures.layer}`,
        sr: "2056", tolerance: "0", returnGeometry: "true", lang: "de", limit: "200",
      });
      closuresPromise = fetch(`${IDENTIFY_URL}?${params}`).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then((data) => {
        wayClosures = (data.results ?? []).map((result) => ({
          title: result.attributes.title_de, abstract: result.attributes.abstract_de, duration: result.attributes.duration_de,
          reason: result.attributes.reason_de, provider: result.attributes.content_provider_de,
          detour: result.attributes.sperrungen_type === "detour", lines: clipLines(result.geometry?.paths ?? [], grid.extent),
        })).filter((item) => item.lines.length);
        constructionMesh.add(buildRibbons(wayClosures.map((item) => ({ lines: item.lines, color: item.detour ? "#2f7fd8" : "#b3121b" })), terrain, frame));
        return wayClosures;
      }).catch((error) => {
        closuresPromise = null;
        throw error;
      });
    }
    return closuresPromise;
  }

  function renderWayClosureInfo(container, item) {
    container.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = item.title || "Sperrhinweis";
    const list = document.createElement("dl");
    for (const [label, value] of [["Art", item.detour ? "Umleitung" : "Gesperrter Wegabschnitt"], ["Grund", item.reason], ["Dauer", item.duration], ["Hinweis", item.abstract]].filter(([, v]) => v)) {
      const term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label; detail.textContent = value; list.append(term, detail);
    }
    const note = document.createElement("p");
    note.textContent = `Quelle: ${item.provider || "ASTRA und Kantone"} · Wanderland Schweiz.`;
    container.append(heading, list, note);
  }

  function loadVector(id) {
    if (!vectorPromises.has(id)) {
      const mode = VECTOR_MODES[id], { minE, minN, maxE, maxN } = grid.extent;
      const params = new URLSearchParams({
        geometryType: "esriGeometryEnvelope", geometry: `${minE},${minN},${maxE},${maxN}`, layers: `all:${ROUTE_ANALYSES[id].layer}`,
        sr: "2056", tolerance: "0", returnGeometry: "true", lang: "de", limit: "200",
      });
      vectorPromises.set(id, fetch(`${IDENTIFY_URL}?${params}`).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then((data) => {
        const items = (data.results ?? []).map((result) => ({ ...mode.item(result.attributes), lines: clipLines(result.geometry?.paths ?? [], grid.extent) })).filter((item) => item.lines.length);
        const ribbons = buildRibbons(items.map((item) => ({ lines: item.lines, color: item.color, width: mode.width })), terrain, frame);
        ribbons.visible = false;
        group.add(ribbons);
        vectorGroups.set(id, ribbons);
        vectorItems.set(id, items);
        return items;
      }).catch((error) => {
        vectorPromises.delete(id);
        throw error;
      }));
    }
    return vectorPromises.get(id);
  }

  function renderVectorInfo(container, item) {
    container.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = item.title;
    const list = document.createElement("dl");
    for (const [label, value] of item.rows ?? []) {
      const term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label; detail.textContent = value; list.append(term, detail);
    }
    container.append(heading, list);
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
    syncOverlays();
    panel.hidden = false;
    modeSelect.value = id;
    title.textContent = source.title;
    description.textContent = `${source.description} Quelle: ${source.source} · Stand ${source.updated}.`;
    legend.hidden = false;
    legendLabel.textContent = "Legende";
    legendImage.hidden = id === "closures" || id in VECTOR_MODES;
    legendImage.alt = `Legende: ${source.title}`;
    if (!legendImage.hidden) legendImage.src = legendUrl(source);
    viewControls.hidden = true;
    timeControls.hidden = true;
    categoryFilter.hidden = true;
    walkingResults.hidden = false;
    cellInfo.hidden = true;
    walkingResults.replaceChildren();
    showLinks(id);
    const status = document.createElement("p");
    status.className = "walking-results-summary";
    status.textContent = source.id === "closures"
      ? "Wegabschnitte und Baustellen auf der Karte anklicken. Eine fehlende Meldung bestätigt keine Begehbarkeit."
      : "Wegabschnitte auf der Karte anklicken, um die verfügbaren Angaben zu sehen.";
    walkingResults.append(status);
    if (source.id === "closures") {
      const heading = document.createElement("p");
      heading.className = "walking-results-summary";
      heading.textContent = "Sperrungen und Baustellen";
      walkingResults.append(heading);
      renderConstructionLegend(walkingResults, [{ label: "Gesperrter Wanderweg", color: "#b3121b" }, { label: "Umleitung", color: "#2f7fd8" }]);
      void Promise.allSettled([loadWayClosures(), loadConstruction()]).then(([ways, works]) => {
        if (activeMode !== id) return;
        syncOverlays();
        if (ways.status === "rejected" || works.status === "rejected") {
          heading.textContent = "Nicht alle Meldungen sind momentan erreichbar.";
          return;
        }
        const count = ways.value.length + works.value.length;
        heading.textContent = count ? `${count} Meldungen im Kartenausschnitt` : "Aktuell keine Meldungen im Kartenausschnitt";
      });
    }
    if (id in VECTOR_MODES) {
      const mode = VECTOR_MODES[id];
      const heading = document.createElement("p");
      heading.className = "walking-results-summary";
      heading.textContent = "Wird geladen …";
      walkingResults.append(heading);
      void loadVector(id).then((items) => {
        if (activeMode !== id) return;
        syncOverlays();
        heading.textContent = items.length ? `${items.length} Abschnitte im Kartenausschnitt` : "Keine Abschnitte im Kartenausschnitt";
        renderLegend(walkingResults, mode.legend(items));
      }).catch(() => {
        if (activeMode !== id) return;
        heading.textContent = "Diese Kartenquelle ist momentan nicht erreichbar.";
      });
    }
    if (id !== "closures" && !(id in VECTOR_MODES)) void loadTexture(source).then((texture) => {
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
    syncOverlays();
    links.hidden = true;
    if (!ctx.demographics?.activeLayer() && !ctx.walking?.active) panel.hidden = true;
  }

  ctx.clickHandlers.unshift(({ ground }) => {
    if (!activeMode || !ground) return false;
    const source = ROUTE_ANALYSES[activeMode];
    const { e, n } = frame.toLV95(ground.x, ground.z);
    const site = activeMode === "closures" ? nearestConstructionSite(sites, e, n) : null;
    if (site) {
      requestId++;
      renderConstructionInfo(walkingResults, site);
      return true;
    }
    const way = activeMode === "closures" ? nearestConstructionSite(wayClosures, e, n) : null;
    if (way) {
      requestId++;
      renderWayClosureInfo(walkingResults, way);
      return true;
    }
    const route = vectorItems.has(activeMode) ? nearestConstructionSite(vectorItems.get(activeMode), e, n, 20) : null;
    if (route) {
      requestId++;
      renderVectorInfo(walkingResults, route);
      return true;
    }
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

  // Ebenen im Ebenenmenü: gleiche Bänder ohne Analysepanel.
  for (const [key, label, color] of [["closures", "Sperrungen und Baustellen", "#d62828"], ["hiking", "Wanderwege (amtlich)", "#f2c230"], ["cycling", "Velorouten", "#d6246e"]]) {
    layers.add({
      id: `route-${key}`, label, color, visible: false, note: "Kartenquelle nicht verfügbar",
      apply: (visible) => {
        overlayOn[key] = visible;
        syncOverlays();
        if (!visible) return;
        const loading = key === "closures" ? Promise.allSettled([loadWayClosures(), loadConstruction()]) : loadVector(key);
        void Promise.resolve(loading).then(syncOverlays).catch(() => {});
      },
    });
  }

  ctx.officialRoutes = { activate, deactivate, get active() { return activeMode; } };
  return ctx.officialRoutes;
}