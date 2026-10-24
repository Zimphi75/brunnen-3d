import * as THREE from "three";
import { extractRoofFaces } from "./pv.js";

const IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const LAYER = "ch.bfe.solarenergie-eignung-daecher";
const DATA_STATUS = "2023-02-21";
const cache = new Map();
const COLORS = [
  { test: /sehr gut/i, color: "#176b89" },
  { test: /gut/i, color: "#319b91" },
  { test: /mittel/i, color: "#d5a335" },
  { test: /gering|schlecht|ungeeignet/i, color: "#ae5d3d" },
];

const colorFor = (label) => COLORS.find((entry) => entry.test.test(label ?? ""))?.color ?? "#687b80";

function suitabilityColor(label) {
  return colorFor(label);
}

function identifyUrl(record) {
  const [east, north] = record.center;
  const params = new URLSearchParams({
    geometry: `${east},${north}`, geometryType: "esriGeometryPoint", layers: `all:${LAYER}`, sr: "2056", lang: "de",
    tolerance: "50", mapExtent: `${east - 500},${north - 500},${east + 500},${north + 500}`,
    imageDisplay: "512,512,96", returnGeometry: "true",
  });
  return `${IDENTIFY_URL}?${params}`;
}

export async function fetchSolarPotential(record, fetcher = fetch) {
  if (!record?.center?.every(Number.isFinite) || record.egid == null) {
    return { status: "unavailable", reason: "Für die Zuordnung fehlen EGID oder Koordinaten.", features: [], source: LAYER, dataStatus: DATA_STATUS };
  }
  const key = String(record.egid);
  if (fetcher === fetch && cache.has(key)) return cache.get(key);
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(identifyUrl(record), { signal: controller.signal });
      if (!response.ok) return { status: "unavailable", reason: "Die BFE-Solarpotenzialkarte ist momentan nicht erreichbar.", features: [], source: LAYER, dataStatus: DATA_STATUS };
      const data = await response.json();
      const features = (data.results ?? []).filter((feature) => Number(feature.attributes?.gwr_egid) === Number(record.egid)).flatMap((feature) => {
        const attributes = feature.attributes ?? {};
        const areaM2 = Number(attributes.flaeche);
        const annualKwh = Number(attributes.stromertrag);
        if (!Number.isFinite(areaM2) || !Number.isFinite(annualKwh) || !feature.geometry?.rings?.length) return [];
        return [{
          id: feature.featureId ?? feature.id,
          suitability: String(attributes.klasse_text ?? "Nicht eingestuft").split("##")[0],
          areaM2, annualKwh,
          winterKwh: Number.isFinite(Number(attributes.stromertrag_winterhalbjahr)) ? Number(attributes.stromertrag_winterhalbjahr) : null,
          azimuthDeg: Number.isFinite(Number(attributes.ausrichtung)) ? ((Number(attributes.ausrichtung) % 360) + 360) % 360 : null,
          slopeDeg: Number.isFinite(Number(attributes.neigung)) ? Number(attributes.neigung) : null,
          rings: feature.geometry.rings,
        }];
      });
      return features.length
        ? { status: "ready", features, roofAreaM2: features.reduce((sum, feature) => sum + feature.areaM2, 0), annualKwh: features.reduce((sum, feature) => sum + feature.annualKwh, 0), source: LAYER, dataStatus: DATA_STATUS }
        : { status: "unavailable", reason: "Für dieses Gebäude enthält die BFE-Karte keine zuordenbare Dachfläche.", features: [], source: LAYER, dataStatus: DATA_STATUS };
    } catch {
      return { status: "unavailable", reason: "Die BFE-Solarpotenzialkarte ist momentan nicht erreichbar.", features: [], source: LAYER, dataStatus: DATA_STATUS };
    } finally { clearTimeout(timer); }
  })();
  if (fetcher === fetch) cache.set(key, request);
  return request;
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function insidePolygon(point, rings) {
  return Boolean(rings.length && insideRing(point, rings[0]) && !rings.slice(1).some((ring) => insideRing(point, ring)));
}

function buildRoofOverlay(ctx, record, potential) {
  const buildingIndex = ctx.records.findIndex((entry) => entry === record || entry.id === record.id);
  if (buildingIndex < 0 || !ctx.buildings?.data) return null;
  const faces = extractRoofFaces(ctx.buildings.data, buildingIndex);
  const positions = [], colors = [];
  let matchedFaces = 0;
  for (const feature of potential.features) {
    const rings = feature.rings.map((ring) => ring.map(([east, north]) => {
      const point = ctx.frame.toLocal(east, north);
      return { x: point.x, z: point.z };
    }));
    const color = new THREE.Color(suitabilityColor(feature.suitability));
    for (const face of faces) {
      if (!insidePolygon(face.centroid, rings)) continue;
      matchedFaces++;
      for (const triangle of face.tris) for (const point of triangle) {
        const lifted = point.clone().addScaledVector(face.normal, 0.28);
        positions.push(lifted.x, lifted.y, lifted.z);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 14;
  mesh.name = "bfe-solar-roof-suitability";
  return { mesh, matchedFaces };
}

function renderPotentialResults(container, potential, matchedFaces) {
  container.replaceChildren();
  const summary = document.createElement("p");
  summary.className = "walking-results-summary";
  summary.textContent = `${potential.features.length} BFE-Dachflächen · ${matchedFaces} 3D-Dachflächen zugeordnet`;
  container.append(summary);
  const legend = document.createElement("div");
  legend.className = "solar-potential-key";
  for (const suitability of [...new Set(potential.features.map((feature) => feature.suitability))]) {
    const item = document.createElement("span"), swatch = document.createElement("i"), label = document.createElement("b");
    swatch.style.background = colorFor(suitability);
    label.textContent = suitability;
    item.append(swatch, label);
    legend.append(item);
  }
  container.append(legend);
  for (const feature of potential.features.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "solar-potential-result";
    row.style.setProperty("--solar-color", colorFor(feature.suitability));
    const label = document.createElement("b");
    label.textContent = feature.suitability;
    const detail = document.createElement("span");
    detail.textContent = `${Math.round(feature.areaM2)} m² · ${Math.round(feature.annualKwh).toLocaleString("de-CH")} kWh/Jahr${feature.slopeDeg == null ? "" : ` · ${Math.round(feature.slopeDeg)}° Neigung`}`;
    row.append(label, detail);
    container.append(row);
  }
  const note = document.createElement("p");
  note.className = "solar-potential-note";
  note.textContent = `BFE-Modellwert, kein gemessener Ertrag und keine Garantie für eine Anlage. Datenstand ${DATA_STATUS}.`;
  container.append(note);
}

export function initSolarPotential(ctx) {
  const overlay = new THREE.Group();
  overlay.name = "solar-potential";
  ctx.scene3d.scene.add(overlay);
  ctx.scene3d.aoExcluded.add(overlay);
  const panel = document.querySelector("#demographic-analysis");
  const title = document.querySelector("#demographic-analysis-title");
  const description = document.querySelector("#demographic-analysis-description");
  const legend = document.querySelector(".demographic-analysis-legend");
  const legendLabel = legend.querySelector("span");
  const legendImage = document.querySelector("#demographic-analysis-legend");
  const viewControls = document.querySelector(".demographic-analysis-views");
  const timeControls = document.querySelector("#walking-analysis-controls");
  const results = document.querySelector("#walking-analysis-results");
  const cellInfo = document.querySelector("#demographic-cell-info");
  let activeRecord = null, activeMesh = null;

  function deactivate() {
    activeRecord = null;
    if (activeMesh) {
      overlay.remove(activeMesh.mesh);
      activeMesh.mesh.geometry.dispose();
      activeMesh.mesh.material.dispose();
      activeMesh = null;
    }
    results.hidden = true;
    if (!ctx.demographics?.activeLayer() && !ctx.walking?.active) panel.hidden = true;
  }

  async function activate(record, providedPotential = null) {
    deactivate();
    activeRecord = record;
    panel.hidden = false;
    title.textContent = "Solarpotenzial auf dem Dach";
    description.textContent = "BFE-Modellwerte für das ausgewählte Gebäude; Dachflächen werden nur bei sicherer Zuordnung eingefärbt.";
    legend.hidden = false;
    legendLabel.textContent = "Eignung der Dachfläche";
    legendImage.hidden = true;
    viewControls.hidden = true;
    timeControls.hidden = true;
    cellInfo.hidden = true;
    results.hidden = false;
    results.textContent = "BFE-Solarpotenzial wird geladen …";
    const potential = providedPotential ?? await fetchSolarPotential(record);
    if (activeRecord !== record) return false;
    if (potential.status !== "ready") {
      results.textContent = potential.reason;
      return false;
    }
    activeMesh = buildRoofOverlay(ctx, record, potential);
    if (activeMesh) overlay.add(activeMesh.mesh);
    renderPotentialResults(results, potential, activeMesh?.matchedFaces ?? 0);
    return true;
  }

  ctx.solarPotential = {
    forBuilding: fetchSolarPotential,
    activate,
    deactivate,
    get active() { return Boolean(activeRecord); },
  };
  return ctx.solarPotential;
}