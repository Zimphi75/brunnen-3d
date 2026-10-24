// STATPOP/STATENT 100-m raster overlays and cell-level lookup through GeoAdmin.
import * as THREE from "three";
import { buildRibbons } from "./draped.js";

const CELL_SIZE = 100;
const WMS_URL = "https://wms.geo.admin.ch/";
const IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const SOURCES = {
  population: {
    id: "demography-population",
    layer: "ch.bfs.volkszaehlung-bevoelkerungsstatistik_einwohner",
    label: "Einwohner",
    year: "2024",
    resultKey: "population",
    name: "STATPOP",
    unit: "Einwohner",
    color: 0x4d8dc4,
  },
  employment: {
    id: "demography-employment",
    layer: "ch.bfs.betriebszaehlungen-beschaeftigte_vollzeitaequivalente",
    label: "Arbeitsplätze",
    year: "2023",
    resultKey: "employment",
    name: "STATENT",
    unit: "Vollzeitäquivalente",
    color: 0xd28a37,
  },
};

const fmt = (value) => Number(value).toLocaleString("de-CH");

async function getJson(url, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function identifyUrl(source, east, north) {
  const params = new URLSearchParams({
    geometry: `${east},${north}`, geometryType: "esriGeometryPoint", layers: `all:${source.layer}`, sr: "2056", lang: "de", tolerance: "0",
    mapExtent: `${east - 100},${north - 100},${east + 100},${north + 100}`, imageDisplay: "200,200,96", returnGeometry: "true",
  });
  return `${IDENTIFY_URL}?${params}`;
}

function latestCell(result) {
  const candidates = result?.results ?? [];
  const feature = candidates.filter((item) => item.attributes?.number != null && Number.isFinite(Number(item.attributes.number)))
    .sort((a, b) => Number(b.attributes.i_year) - Number(a.attributes.i_year))[0];
  if (!feature) return null;
  return {
    value: Number(feature.attributes.number),
    year: Number(feature.attributes.i_year),
    bounds: feature.bbox,
    geometry: feature.geometry,
  };
}

export async function fetchDemographicCell(center, fetcher = fetch) {
  if (!Array.isArray(center) || !center.slice(0, 2).every(Number.isFinite)) return { population: null, employment: null, cellSizeM: CELL_SIZE };
  const [east, north] = center;
  const [populationResult, employmentResult] = await Promise.all([
    getJson(identifyUrl(SOURCES.population, east, north), fetcher),
    getJson(identifyUrl(SOURCES.employment, east, north), fetcher),
  ]);
  const population = latestCell(populationResult);
  const employment = latestCell(employmentResult);
  const cell = population ?? employment;
  return {
    population: population ? { value: population.value, year: population.year } : null,
    employment: employment ? { value: employment.value, year: employment.year } : null,
    cellSizeM: CELL_SIZE,
    bounds: cell?.bounds ?? null,
    geometry: cell?.geometry ?? null,
  };
}

export function rasterGridGeometry(terrain, frame, bounds) {
  const { min_e: minE, min_n: minN, nx, ny, cell } = bounds;
  const maxE = minE + (nx - 1) * cell, maxN = minN + (ny - 1) * cell;
  const width = maxE - minE, height = maxN - minN;
  const columns = Math.ceil(width / CELL_SIZE), rows = Math.ceil(height / CELL_SIZE), rowSize = columns + 1;
  const positions = new Float32Array((rows + 1) * rowSize * 3);
  const uvs = new Float32Array((rows + 1) * rowSize * 2);
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    const north = Math.max(minN, maxN - row * CELL_SIZE);
    for (let column = 0; column <= columns; column++) {
      const east = Math.min(maxE, minE + column * CELL_SIZE);
      const local = frame.toLocal(east, north);
      const index = row * rowSize + column;
      positions.set([local.x, (terrain.heightAt(local.x, local.z) ?? 0) + 1.2, local.z], index * 3);
      uvs.set([(east - minE) / width, (north - minN) / height], index * 2);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * rowSize + column, b = a + 1, c = a + rowSize, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, extent: { minE, minN, maxE, maxN, width, height }, columns, rows };
}

function mapUrl(source, extent, columns, rows) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: source.layer, STYLES: "default", CRS: "EPSG:2056",
    BBOX: `${extent.minE},${extent.minN},${extent.maxE},${extent.maxN}`,
    WIDTH: String(columns * 10), HEIGHT: String(rows * 10), FORMAT: "image/png", TRANSPARENT: "true", TIME: source.year,
  });
  return `${WMS_URL}?${params}`;
}

function legendUrl(source) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetLegendGraphic", LAYER: source.layer,
    STYLE: "default", FORMAT: "image/png", SLD_VERSION: "1.1.0", TIME: source.year,
  });
  return `${WMS_URL}?${params}`;
}

function makeCellHighlight(cellGeometry, terrain, frame) {
  const ring = cellGeometry?.rings?.[0];
  if (!ring?.length) return null;
  const line = [];
  for (const [east, north] of ring) {
    const local = frame.toLocal(east, north);
    line.push(local.x, local.z);
  }
  const geometry = buildRibbons([line], { width: 4, lift: 3, terrain, step: 5 });
  const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffd14a, side: THREE.DoubleSide, depthWrite: false }));
  outline.name = "demographic-cell-selection";
  outline.renderOrder = 10;
  return outline;
}

function renderCellInfo(container, data, loading = false, { title: heading = "Werte dieser 100-m-Zelle", scope = "in der 100-m-Zelle" } = {}) {
  container.replaceChildren();
  container.hidden = false;
  const title = document.createElement("strong");
  title.textContent = loading ? "Lade Angaben …" : heading;
  container.append(title);
  if (loading) return;
  // Gleiche Darstellung wie «Leben in der Nachbarschaft» im Gebäudeprofil: zwei grosse Zahlen nebeneinander.
  const stats = document.createElement("div");
  stats.className = "demographic-stats";
  for (const [label, value] of [
    [`Menschen ${scope}`, data.population?.value],
    [`Vollzeit-Arbeitsplätze ${scope}`, data.employment?.value],
  ]) {
    const stat = document.createElement("div");
    const number = document.createElement("b");
    number.textContent = value != null ? fmt(value) : "–";
    const name = document.createElement("span");
    name.textContent = value != null ? label : `${label}: keine Angabe`;
    stat.append(number, name);
    stats.append(stat);
  }
  container.append(stats);
  const years = [data.population?.year && `Einwohner ${data.population.year}`, data.employment?.year && `Arbeitsplätze ${data.employment.year}`].filter(Boolean);
  if (years.length) {
    const small = document.createElement("small");
    small.textContent = `Stand: ${years.join(", ")}`;
    container.append(small);
  }
}

export function initDemographicLayers(ctx) {
  const { scene3d, terrain, frame, meta, layers, clickHandlers } = ctx;
  const grid = rasterGridGeometry(terrain, frame, meta.dem.extent);
  const group = new THREE.Group();
  group.name = "demographic-raster-overlays";
  scene3d.scene.add(group);
  scene3d.aoExcluded.add(group);
  const overlays = new Map();
  const mapPromises = new Map();
  const cellCache = new Map();
  const analysisPanel = document.querySelector("#demographic-analysis");
  const legendTitle = document.querySelector("#demographic-analysis-title");
  const legendDescription = document.querySelector("#demographic-analysis-description");
  const legendImage = document.querySelector("#demographic-analysis-legend");
  const legend = legendImage.closest(".demographic-analysis-legend");
  const analysisMode = document.querySelector("#analysis-mode");
  const cellInfo = document.querySelector("#demographic-cell-info");
  const viewControls = document.querySelector(".demographic-analysis-views");
  const walkingControls = document.querySelector("#walking-analysis-controls");
  const walkingCategoryFilter = document.querySelector("#walking-category-filter");
  const walkingResults = document.querySelector("#walking-analysis-results");
  let activeLayer = null, selection = null, clickRequest = 0;

  function clearSelection() {
    if (!selection) return;
    group.remove(selection);
    selection.geometry.dispose();
    selection.material.dispose();
    selection = null;
  }

  function activate(source, visible) {
    const mesh = overlays.get(source.id);
    if (!visible) {
      mesh.visible = false;
      if (activeLayer === source.id) {
        activeLayer = null;
        clearSelection();
        cellInfo.hidden = true;
        analysisPanel.hidden = true;
      }
      return;
    }
    const other = Object.values(SOURCES).find((candidate) => candidate.id !== source.id);
    if (layers.isVisible(other.id)) layers.setVisible(other.id, false);
    activeLayer = source.id;
    mesh.visible = false;
    analysisPanel.hidden = false;
    analysisMode.value = source.id;
    legend.hidden = false;
    legendImage.hidden = false;
    viewControls.hidden = false;
    walkingControls.hidden = true;
    walkingCategoryFilter.hidden = true;
    walkingResults.hidden = true;
    legendTitle.textContent = source.name === "STATPOP" ? "Einwohner" : "Arbeitsplätze";
    legendDescription.textContent = source.name === "STATPOP" ? "Einwohner in der 100-m-Zelle, keine Gebäudezahl" : "Arbeitsplätze in der 100-m-Zelle";
    if (legendImage.dataset.layer !== source.id) {
      legendImage.dataset.layer = source.id;
      legendImage.alt = `Farblegende: ${source.name === "STATPOP" ? "Einwohner" : "Arbeitsplätze"}`;
      legendImage.src = legendUrl(source);
    }
    const promise = mapPromises.get(source.id) ?? new THREE.TextureLoader().loadAsync(mapUrl(source, grid.extent, grid.columns, grid.rows));
    mapPromises.set(source.id, promise);
    void promise.then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = scene3d.renderer.capabilities.getMaxAnisotropy();
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
      if (activeLayer === source.id && layers.isVisible(source.id)) mesh.visible = true;
    }).catch((error) => {
      mesh.visible = false;
      legend.hidden = true;
      mapPromises.delete(source.id);
      legend.dataset.loaded = "";
      layers.update(source.id, { available: false, note: "GeoAdmin-WMS derzeit nicht erreichbar" });
      console.warn(`GeoAdmin ${source.name}:`, error);
    });
  }

  for (const source of Object.values(SOURCES)) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(grid.geometry, material);
    mesh.name = source.id;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    group.add(mesh);
    overlays.set(source.id, mesh);
    const layer = layers.add({
      id: source.id, label: source.label, color: `#${source.color.toString(16).padStart(6, "0")}`,
      count: source.year, visible: false, apply: (visible) => activate(source, visible),
      note: "GeoAdmin-WMS nicht verfügbar",
    });
  }

  async function loadCell(center) {
    const eastCell = Math.floor(center[0] / CELL_SIZE) * CELL_SIZE;
    const northCell = Math.floor(center[1] / CELL_SIZE) * CELL_SIZE;
    const key = `${eastCell}:${northCell}`;
    if (!cellCache.has(key)) cellCache.set(key, fetchDemographicCell(center));
    return cellCache.get(key);
  }

  clickHandlers.unshift(({ ground }) => {
    if (!activeLayer || !ground) return false;
    const { e, n } = frame.toLV95(ground.x, ground.z);
    const { min_e: minE, min_n: minN, nx, ny, cell } = meta.dem.extent;
    const maxE = minE + (nx - 1) * cell, maxN = minN + (ny - 1) * cell;
    if (e < minE || e > maxE || n < minN || n > maxN) return false;
    const request = ++clickRequest;
    clearSelection();
    renderCellInfo(cellInfo, null, true);
    void loadCell([e, n]).then((data) => {
      if (request !== clickRequest || !activeLayer) return;
      selection = makeCellHighlight(data.geometry, terrain, frame);
      if (selection) group.add(selection);
      renderCellInfo(cellInfo, data);
    });
    return true;
  });

  ctx.demographics = {
    async forBuilding(record) { return loadCell(record.center); },
    resetSelection() { clickRequest++; clearSelection(); cellInfo.hidden = true; },
    deactivateBuildingCell() {
      clickRequest++;
      clearSelection();
      cellInfo.hidden = true;
    },
    async highlightBuildingCell(record) {
      if (!activeLayer) return false;
      const request = ++clickRequest;
      clearSelection();
      renderCellInfo(cellInfo, null, true);
      const data = await loadCell(record.center);
      if (request !== clickRequest || !activeLayer) return false;
      selection = makeCellHighlight(data.geometry, terrain, frame);
      if (selection) group.add(selection);
      renderCellInfo(cellInfo, data, false, { title: "Leben in der Nachbarschaft" });
      return true;
    },
    async activateBuildingCell(record) {
      layers.setVisible(SOURCES.population.id, true);
      return this.highlightBuildingCell(record);
    },
    activeLayer: () => activeLayer,
  };
}
