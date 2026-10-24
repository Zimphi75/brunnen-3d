// Points of Interest (OSM) und Ortsnamen: Marker, Beschriftungen, Auswahl.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";
import { createLabelLayer } from "./labels.js";
import { connectMarkerNavigation } from "./controls.js";

export const POI_COLORS = {
  "Einkauf": "#e08a2c", "Gastronomie": "#c0392b", "Tourismus": "#8e44ad", "Freizeit und Kultur": "#16a085", "Religion": "#7f8c8d",
  "Verkehr": "#2980b9", "Mobilität": "#287da0", "Öffentliche Einrichtungen": "#548477", "Verwaltung und Dienste": "#34495e", "Gesundheit": "#e84393", "Bildung": "#d4ac0d", "Historisch": "#a0522d", "Sonstiges": "#95a5a6",
};
export const POI_DISPLAY = Object.freeze({
  showDistanceMeters: 850, hysteresisMeters: 50, nearDistanceMeters: 300, nearHysteresisMeters: 30,
  fullOpacityDistanceMeters: 150, fadeInMs: 220, fadeOutMs: 190,
  overviewPx: 20, nearPx: 26, hoverPx: 28, maxMarkerPx: 34,
  touchTargetPx: 44, updateIntervalMs: 90, collisionPx: 38,
});

const SUBTYPES = {
  restaurant: "Restaurant", cafe: "Café", bar: "Bar", pub: "Pub", fast_food: "Imbiss", ice_cream: "Glacé", hotel: "Hotel", guest_house: "Gästehaus",
  hostel: "Herberge", camp_site: "Campingplatz", museum: "Museum", attraction: "Sehenswürdigkeit", viewpoint: "Aussichtspunkt", gallery: "Galerie",
  artwork: "Kunstwerk", information: "Information", place_of_worship: "Gotteshaus", school: "Schule", kindergarten: "Kindergarten", pharmacy: "Apotheke",
  doctors: "Arztpraxis", dentist: "Zahnarzt", post_office: "Post", bank: "Bank", townhall: "Gemeindehaus", ferry_terminal: "Schiffstation",
  supermarket: "Supermarkt", bakery: "Bäckerei", kiosk: "Kiosk", clothes: "Bekleidung", convenience: "Laden", hairdresser: "Coiffeur",
  playground: "Spielplatz", pitch: "Sportplatz", sports_centre: "Sportzentrum", swimming_pool: "Schwimmbad", marina: "Hafen", slipway: "Slip", park: "Park",
  monument: "Denkmal", memorial: "Gedenkstätte", castle: "Schloss", ruins: "Ruine", wayside_cross: "Wegkreuz", wayside_shrine: "Bildstock",
  toilets: "Öffentliche Toilette", drinking_water: "Trinkwasserstelle", defibrillator: "Defibrillator", recycling: "Recyclingstelle",
  waste_disposal: "Entsorgungsstelle", waste_transfer_station: "Entsorgungsstelle", parking: "Parkplatz", parking_space: "Parkplatz",
  parking_entrance: "Parkhauseinfahrt", bicycle_parking: "Veloparkplatz", motorcycle_parking: "Motorradparkplatz", charging_station: "E-Ladestation",
};
export const subtypeLabel = (value) => SUBTYPES[value] ?? value.replaceAll("_", " ");

export function normalizePoi(poi) {
  const tags = poi.t ?? poi.tags ?? {};
  const pick = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
  const subtype = pick(poi.s, poi.subtype);
  const street = [pick(tags["addr:street"]), pick(tags["addr:housenumber"])].filter(Boolean).join(" ");
  const locality = [pick(tags["addr:postcode"]), pick(tags["addr:city"])].filter(Boolean).join(" ");
  const address = pick(tags.address) || [street, locality].filter(Boolean).join(", ");
  const socketLabels = [["socket:type2_combo", "CCS"], ["socket:ccs", "CCS"], ["socket:type2", "Typ 2"], ["socket:chademo", "CHAdeMO"], ["socket:schuko", "Haushaltssteckdose"]];
  const socketTypes = pick(tags.socket_types) || socketLabels.filter(([key]) => tags[key] && !["no", "0"].includes(tags[key])).map(([, label]) => label).filter((label, index, labels) => labels.indexOf(label) === index).join(", ");
  return {
    id: poi.id ?? `${poi.osmType?.[0] ?? "n"}${poi.osmId ?? ""}`,
    osmType: poi.osmType ?? ({ n: "node", w: "way", r: "relation" }[poi.id?.[0]] ?? "node"),
    osmId: poi.osmId ?? poi.id?.slice(1) ?? "",
    name: pick(poi.n, poi.name), category: pick(poi.c, poi.category) || "Sonstiges",
    subtype, subtypeLabel: SUBTYPES[subtype] ?? subtype.replaceAll("_", " "), x: poi.x, z: poi.z, lat: poi.lat, lon: poi.lon,
    address, openingHours: pick(tags.opening_hours, tags.openingHours),
    website: pick(tags.website, tags["contact:website"]), phone: pick(tags.phone, tags["contact:phone"]),
    email: pick(tags.email, tags["contact:email"]), description: pick(tags.description),
    properties: {
      cuisine: pick(tags.cuisine), wheelchair: pick(tags.wheelchair),
      outdoorSeating: pick(tags.outdoor_seating, tags.outdoorSeating), takeaway: pick(tags.takeaway),
      operator: pick(tags.operator), fee: pick(tags.fee), access: pick(tags.access),
      capacity: pick(tags.capacity), maxStay: pick(tags.maxstay), power: pick(tags.charge), socketTypes,
    },
  };
}

const CATEGORY_ICONS = {
  food: '<path d="M4 3v7m3-7v7M5.5 3v18M18 3c-2.2 2-3 4.2-3 7v2h3V3Zm0 9v9"/>',
  shop: '<path d="M4 8h16l-1.4 12H5.4L4 8Zm3 0 1-5h8l1 5M9 11v2m6-2v2"/>',
  stay: '<path d="M3 19V6m0 9h18v4m0-7v7M3 11h6a3 3 0 0 1 3 3v1M12 13h5a4 4 0 0 1 4 4"/>',
  culture: '<path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6M8 10h.01M16 10h.01"/>',
  nature: '<path d="m12 3 8 12h-5l4 6H5l4-6H4l8-12Zm0 12v6"/>',
  mobility: '<path d="M5 16V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8M5 12h14M7 16v3m10-3v3M8 9h.01M16 9h.01"/>',
  civic: '<path d="M3 20h18M5 20V9h14v11M3 9l9-6 9 6M9 12v5m6-5v5"/>',
};

function poiIcon(poi) {
  if (poi.category === "Einkauf") return "shop";
  if (poi.category === "Gastronomie") return "food";
  if (["Unterkunft", "hotel", "guest_house", "hostel", "camp_site"].includes(poi.subtype)) return "stay";
  if (["Verkehr", "Mobilität"].includes(poi.category)) return "mobility";
  if (["Freizeit und Kultur", "Tourismus", "Historisch"].includes(poi.category)) return "culture";
  if (["park", "garden", "nature_reserve"].includes(poi.subtype)) return "nature";
  return "civic";
}

function markerMarkup(poi) {
  const path = CATEGORY_ICONS[poiIcon(poi)].match(/d="([^"]+)/)[1];
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

function candidateOverlapsPanel(point, width, height, panels) {
  const x = (point.x * 0.5 + 0.5) * width, y = (-point.y * 0.5 + 0.5) * height;
  const radius = POI_DISPLAY.touchTargetPx / 2, markerHeight = POI_DISPLAY.maxMarkerPx + 16;
  return panels.some((rect) => x + radius > rect.left && x - radius < rect.right && y + 12 > rect.top && y - markerHeight < rect.bottom);
}

function setMarkerVisible(marker, visible, opacity = 0) {
  marker.classList.toggle("is-visible", visible);
  const alpha = opacity.toFixed(3);
  if (marker.style.getPropertyValue("--poi-opacity") !== alpha) marker.style.setProperty("--poi-opacity", alpha);
  const hidden = String(!visible);
  if (marker.getAttribute("aria-hidden") !== hidden) marker.setAttribute("aria-hidden", hidden);
  marker.tabIndex = visible ? 0 : -1;
}

function resolveMarkerHeight(index, pois, positions, groundHeights, resolvedHeights, verticalRay, buildings) {
  if (resolvedHeights[index]) return;
  resolvedHeights[index] = 1;
  if (!buildings) return;
  const poi = pois[index], originY = groundHeights[index] + 500;
  verticalRay.origin.set(poi.x, originY, poi.z);
  const hit = buildings.pick(verticalRay);
  if (hit && hit.distance < 500) positions[index].y = hit.point.y + 2;
}

export async function initPois(ctx) {
  const { scene3d, terrain, layers, $ } = ctx;
  const [poiFile, placeFile] = await Promise.all([loadOptionalJson("pois.json"), loadOptionalJson("places.json")]);
  const pois = (poiFile?.pois ?? []).map(normalizePoi);
  const places = placeFile?.places ?? [];
  ctx.pois = pois;
  ctx.places = places;
  const visibleCategories = new Set(pois.map((poi) => poi.category));
  let poiLayerVisible = true;

  const markerLayer = document.createElement("div");
  markerLayer.className = "poi-marker-layer";
  markerLayer.style.setProperty("--poi-touch-target", `${POI_DISPLAY.touchTargetPx}px`);
  markerLayer.style.setProperty("--poi-fade-in", `${POI_DISPLAY.fadeInMs}ms`);
  markerLayer.style.setProperty("--poi-fade-out", `${POI_DISPLAY.fadeOutMs}ms`);
  $("#labels").append(markerLayer);
  connectMarkerNavigation(markerLayer, $("#scene"));
  const groundHeights = pois.map((poi) => terrain.heightAt(poi.x, poi.z) ?? 0);
  const positions = pois.map((poi, index) => new THREE.Vector3(poi.x, groundHeights[index] + 2, poi.z));
  const resolvedHeights = new Uint8Array(pois.length);
  const occluded = new Int8Array(pois.length).fill(-1);
  const verticalRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const sightRay = new THREE.Ray();
  const sightDirection = new THREE.Vector3();
  let lastOcclusionCheck = -Infinity;
  let occlusionCursor = 0;
  const markers = pois.map((poi, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "poi-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.style.setProperty("--poi-color", POI_COLORS[poi.category] ?? "#66736c");
    marker.innerHTML = `<span class="poi-glass-stem" aria-hidden="true"></span>${markerMarkup(poi)}`;
    marker.setAttribute("aria-label", `${poi.name}, ${poi.category}${poi.subtype ? `, ${subtypeLabel(poi.subtype)}` : ""}`);
    marker.dataset.poiIndex = String(index);
    marker.addEventListener("click", (event) => { event.stopPropagation(); ctx.showPoi(index); });
    markerLayer.append(marker);
    return marker;
  });
  let selected = -1;
  const nearStates = new Uint8Array(pois.length);
  const visibleStates = new Uint8Array(pois.length);
  const projected = new THREE.Vector3();
  let lastUpdate = 0;
  ctx.clearPoiSelection = () => { selected = -1; markers.forEach((marker) => marker.classList.remove("is-selected")); };
  ctx.selectPoi = (index) => {
    selected = index;
    markers.forEach((marker, itemIndex) => marker.classList.toggle("is-selected", itemIndex === index));
  };
  scene3d.onFrame((_, now) => {
    if (now - lastUpdate < POI_DISPLAY.updateIntervalMs) return;
    lastUpdate = now;
    if (markerLayer.hidden || !poiLayerVisible) return;
    const canvas = $("#scene"), width = canvas.clientWidth, height = canvas.clientHeight;
    const refreshOcclusion = now - lastOcclusionCheck >= 180;
    const occlusionStart = occlusionCursor;
    let occlusionBudget = refreshOcclusion ? 8 : 0;
    if (refreshOcclusion) {
      lastOcclusionCheck = now;
      occlusionCursor = (occlusionCursor + 8) % Math.max(1, pois.length);
    }
    const inspectorPanel = $("#inspector");
    const blockers = [...document.querySelectorAll(".panel:not([hidden])")]
      .filter((panel) => panel !== inspectorPanel)
      .map((panel) => panel.getBoundingClientRect());
    const candidates = [];
    for (let step = 0; step < pois.length; step++) {
      const index = (occlusionStart + step) % pois.length;
      const marker = markers[index];
      const point = positions[index];
      const isSelected = marker.classList.contains("is-selected");
      if (!visibleCategories.has(pois[index].category)) { setMarkerVisible(marker, false); continue; }
      let distance = scene3d.camera.position.distanceTo(point);
      const visibilityLimit = visibleStates[index] ? POI_DISPLAY.showDistanceMeters + POI_DISPLAY.hysteresisMeters : POI_DISPLAY.showDistanceMeters;
      visibleStates[index] = Number(distance < visibilityLimit);
      const nearLimit = nearStates[index] ? POI_DISPLAY.nearDistanceMeters + POI_DISPLAY.nearHysteresisMeters : POI_DISPLAY.nearDistanceMeters;
      nearStates[index] = Number(distance < nearLimit);
      if (!visibleStates[index] && !isSelected) {
        setMarkerVisible(marker, false);
        occluded[index] = -1;
        if (marker.dataset.name) marker.dataset.name = "";
        continue;
      }
      if (nearStates[index] || isSelected) resolveMarkerHeight(index, pois, positions, groundHeights, resolvedHeights, verticalRay, ctx.buildings);
      distance = scene3d.camera.position.distanceTo(point);
      projected.copy(point).project(scene3d.camera);
      if (candidateOverlapsPanel(projected, width, height, blockers)) { setMarkerVisible(marker, false); continue; }
      if (projected.z > 1 || projected.z < -1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) {
        setMarkerVisible(marker, false);
        continue;
      }
      if (!isSelected && refreshOcclusion && occluded[index] < 0 && occlusionBudget > 0) {
        occlusionBudget--;
        sightRay.origin.copy(scene3d.camera.position);
        sightRay.direction.copy(sightDirection.copy(point).sub(scene3d.camera.position).normalize());
        const terrainHit = terrain.raycast(sightRay, Math.max(0, distance - 2));
        occluded[index] = Number(terrainHit && terrainHit.distanceTo(sightRay.origin) < distance - 2);
      }
      if (!isSelected && occluded[index] === 1) { setMarkerVisible(marker, false); continue; }
      const opacity = isSelected ? 1 : THREE.MathUtils.clamp(
        (POI_DISPLAY.showDistanceMeters - distance) / (POI_DISPLAY.showDistanceMeters - POI_DISPLAY.fullOpacityDistanceMeters), 0, 1,
      );
      if (opacity <= 0) { setMarkerVisible(marker, false); continue; }
      candidates.push({ index, distance, opacity, x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height });
    }
    candidates.sort((a, b) => (markers[a.index].classList.contains("is-selected") ? -1 : markers[b.index].classList.contains("is-selected") ? 1 : a.distance - b.distance));
    const occupied = new Map();
    for (const candidate of candidates) {
      const marker = markers[candidate.index];
      const cellX = Math.floor(candidate.x / 46), cellY = Math.floor(candidate.y / 46);
      const emphasized = marker.matches(":hover, :focus-visible");
      const isSelected = marker.classList.contains("is-selected");
      const priority = isSelected || emphasized;
      let overlaps = false;
      for (let x = cellX - 1; x <= cellX + 1 && !overlaps; x++) {
        for (let y = cellY - 1; y <= cellY + 1 && !overlaps; y++) {
          for (const placed of occupied.get(`${x}:${y}`) ?? []) {
            if (Math.hypot(placed.x - candidate.x, placed.y - candidate.y) < POI_DISPLAY.collisionPx) { overlaps = true; break; }
          }
        }
      }
      if (!priority && overlaps) { setMarkerVisible(marker, false); continue; }
      const cell = `${cellX}:${cellY}`;
      if (!occupied.has(cell)) occupied.set(cell, []);
      occupied.get(cell).push(candidate);
      setMarkerVisible(marker, true, candidate.opacity);
      marker.classList.toggle("is-near", Boolean(nearStates[candidate.index]));
      const size = `${isSelected ? POI_DISPLAY.maxMarkerPx : emphasized ? POI_DISPLAY.hoverPx : nearStates[candidate.index] ? POI_DISPLAY.nearPx : POI_DISPLAY.overviewPx}px`;
      if (marker.style.getPropertyValue("--poi-size") !== size) marker.style.setProperty("--poi-size", size);
      const transform = `translate(${candidate.x.toFixed(1)}px, ${candidate.y.toFixed(1)}px) translate(-50%, -100%)`;
      if (marker.style.transform !== transform) marker.style.transform = transform;
      const name = isSelected || priority ? pois[candidate.index].name : "";
      if (marker.dataset.name !== name) marker.dataset.name = name;
    }
  });

  const labels = createLabelLayer({ container: $("#labels"), camera: scene3d.camera, canvas: $("#scene"), terrain });
  const placeItems = places.map((place) => ({
    x: place.x, z: place.z, text: place.n, lift: 40,
    className: place.k === "village" || place.k === "town" ? "big" : "",
    maxDistance: place.k === "village" || place.k === "town" ? 14000 : place.k === "hamlet" || place.k === "peak" ? 5000 : 1800,
  }));
  let labelsOn = true;
  let last = 0;
  scene3d.onFrame((_, now) => {
    if (now - last < 120) return;
    last = now;
    if (!labelsOn) { labels.clear(); return; }
    labels.render(placeItems, { limit: 34 });
  });

  layers.add({
    id: "pois", label: "Points of Interest", color: "#c0392b", available: pois.length > 0, note: "pois.json fehlt", count: pois.length ? String(pois.length) : "",
    visible: true, apply: (v) => { poiLayerVisible = v; markerLayer.hidden = !v; },
  });
  const categoryCounts = new Map();
  pois.forEach((poi) => categoryCounts.set(poi.category, (categoryCounts.get(poi.category) ?? 0) + 1));
  [...categoryCounts].sort(([a], [b]) => a.localeCompare(b, "de-CH")).forEach(([category, count], index) => {
    const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(index);
    layers.add({
      id: `poi-category-${slug}`, group: "places", label: category, color: POI_COLORS[category] ?? "#66736c",
      available: true, count: String(count), visible: true, source: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
      apply: (visible) => { if (visible) visibleCategories.add(category); else visibleCategories.delete(category); },
    });
  });
  layers.add({ id: "labels", label: "Ortsnamen", color: "#444444", available: places.length > 0, note: "places.json fehlt", visible: true, apply: (v) => { labelsOn = v; } });

  ctx.showPoi = (index) => {
    const poi = pois[index];
    if (!poi) return;
    resolveMarkerHeight(index, pois, positions, groundHeights, resolvedHeights, verticalRay, ctx.buildings);
    ctx.selectPoi(index);
    ctx.inspector.showPoi(poi);
    ctx.onPoiSelected?.(index, positions[index]);
  };
}
