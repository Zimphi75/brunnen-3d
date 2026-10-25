// Suche nach Adressen, Strassen, Gebäuden (EGID), Points of Interest und Orten.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";
import { wgs84ToLv95, formatLv95 } from "./geo.js";

const normalize = (text) => String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ß", "ss").replace(/[^a-z0-9., ]/g, " ").replace(/\s+/g, " ").trim();

export async function initSearch(ctx) {
  const { $, frame, buildings, rig } = ctx;
  const roads = (await loadOptionalJson("roads.json"))?.roads ?? [];
  const index = [];

  // Adressen (GWR): [Bezeichnung, E, N, Gebäudeindex]
  for (const [label, e, n, building] of ctx.addresses) index.push({ type: "Adresse", label, e, n, building });
  // Strassen: je Name ein Treffer am mittleren Punkt des längsten Abschnitts
  const streets = new Map();
  for (const road of roads) {
    if (!road.n || !["motorway", "primary", "secondary", "tertiary", "minor", "service"].includes(road.c)) continue;
    const current = streets.get(road.n);
    if (!current || road.p.length > current.p.length) streets.set(road.n, road);
  }
  for (const [name, road] of streets) {
    const mid = Math.floor(road.p.length / 4) * 2;
    index.push({ type: "Strasse", label: name, x: road.p[mid], z: road.p[mid + 1] });
  }
  for (const [i, poi] of ctx.pois.entries()) index.push({ type: "POI", label: poi.n, x: poi.x, z: poi.z, poi: i, hint: poi.c });
  for (const place of ctx.places) index.push({ type: "Ort", label: place.n, x: place.x, z: place.z });
  ctx.records.forEach((record, i) => { if (record.egid) index.push({ type: "Gebäude", label: `EGID ${record.egid}`, building: i, e: record.center[0], n: record.center[1], hint: record.name ?? "" }); });
  for (const entry of index) entry.key = normalize(entry.label);

  const input = $("#search-input"), list = $("#search-results");
  let results = [], active = -1;

  function search(query) {
    const text = normalize(query);
    if (text.length < 2) return [];
    const tokens = text.split(" ");
    const scored = [];
    for (const entry of index) {
      if (!tokens.every((token) => entry.key.includes(token))) continue;
      const score = (entry.key.startsWith(text) ? 0 : entry.key.split(" ").some((word) => word.startsWith(tokens[0])) ? 1 : 2) + (entry.type === "Ort" ? -0.5 : 0) + entry.key.length / 200;
      scored.push([score, entry]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 12).map((s) => s[1]);
  }

  function coordinatesQuery(query) {
    // LV95 (2'690'000 1'207'000) oder WGS84 (47.0, 8.61) direkt eingeben
    const numbers = query.replace(/['’]/g, "").match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!numbers || numbers.length !== 2) return null;
    if (numbers[0] > 2e6 && numbers[1] > 1e6) return { e: numbers[0], n: numbers[1] };
    if (numbers[0] > 45 && numbers[0] < 48 && numbers[1] > 5 && numbers[1] < 11) return wgs84ToLv95(numbers[0], numbers[1]);
    return null;
  }

  function render() {
    list.hidden = results.length === 0;
    list.innerHTML = "";
    results.forEach((entry, i) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      item.className = i === active ? "active" : "";
      const name = document.createElement("span"); name.textContent = entry.label;
      const kind = document.createElement("small"); kind.textContent = entry.hint ? `${entry.type} · ${entry.hint}` : entry.type;
      item.append(name, kind);
      item.addEventListener("mousedown", (event) => { event.preventDefault(); choose(entry); });
      list.append(item);
    });
  }

  function choose(entry) {
    // Aus dem Velomodus: Modus beenden und direkt zum gewählten Objekt fliegen
    if (ctx.ride?.active) ctx.ride.stop({ flyBack: false });
    list.hidden = true;
    input.value = entry.label;
    let target;
    if (entry.e !== undefined) { const p = frame.toLocal(entry.e, entry.n); target = new THREE.Vector3(p.x, 0, p.z); } else target = new THREE.Vector3(entry.x, 0, entry.z);
    if (entry.building !== undefined && entry.building >= 0 && buildings) {
      target = buildings.center(entry.building).setY(0);
      ctx.selectBuilding(entry.building);
      rig.flyTo({ target, distance: 160, heading: rig.currentView().heading, tilt: THREE.MathUtils.degToRad(55) });
    } else {
      rig.flyTo({ target, distance: entry.type === "Ort" ? 1200 : entry.type === "Strasse" ? 500 : 220, heading: rig.currentView().heading, tilt: THREE.MathUtils.degToRad(55) });
      if (entry.type === "POI") ctx.showPoi(entry.poi);
    }
  }
  ctx.searchChoose = choose;

  input.addEventListener("input", () => {
    const coordinates = coordinatesQuery(input.value);
    results = coordinates
      ? [{ type: "Koordinate", label: `LV95 ${formatLv95(coordinates.e, coordinates.n)}`, e: coordinates.e, n: coordinates.n }]
      : search(input.value);
    active = -1;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); render(); event.preventDefault(); }
    else if (event.key === "ArrowUp") { active = Math.max(0, active - 1); render(); event.preventDefault(); }
    else if (event.key === "Enter" && results.length) choose(results[Math.max(0, active)]);
    else if (event.key === "Escape") { list.hidden = true; input.blur(); }
  });
  input.addEventListener("blur", () => { list.hidden = true; });
  input.addEventListener("focus", () => { if (results.length) render(); });
  ctx.search = search;
  ctx.searchIndexSize = index.length;
}
