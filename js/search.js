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
    syncShare();
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

  // Teilen: Deeplink (?adresse=…) zur aktuell gezeigten Adresse per E-Mail, WhatsApp oder Zwischenablage
  // Knopf und Menü werden hier erzeugt: So passt das Markup immer zum Skript, auch wenn der Browser noch eine
  // ältere index.html im Cache hat (GitHub Pages cacht 10 Minuten).
  const box = input.closest(".search");
  box.querySelector("#search-share")?.remove();
  box.querySelector("#share-menu")?.remove();
  box.insertAdjacentHTML("beforeend", `
    <button type="button" class="icon-btn" id="search-share" aria-label="Link zu dieser Adresse teilen" title="Teilen" aria-haspopup="menu" aria-expanded="false" aria-controls="share-menu" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.8 7.4-4.4M8.3 13.2l7.4 4.4"/></svg>
    </button>
    <div id="share-menu" role="menu" hidden>
      <button type="button" role="menuitem" data-share="native" hidden>Teilen …</button>
      <button type="button" role="menuitem" data-share="mail">Per E-Mail</button>
      <button type="button" role="menuitem" data-share="whatsapp">Per WhatsApp</button>
      <button type="button" role="menuitem" data-share="copy">Link kopieren</button>
    </div>`);
  const shareButton = box.querySelector("#search-share"), shareMenu = box.querySelector("#share-menu");
  const shareUrl = () => {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("adresse", input.value.trim());
    return url.toString();
  };
  const closeShareMenu = () => { shareMenu.hidden = true; shareButton.setAttribute("aria-expanded", "false"); };
  const syncShare = () => {
    const visible = input.value.trim().length >= 2;
    shareButton.hidden = !visible;
    box.classList.toggle("can-share", visible);
    if (!visible) closeShareMenu();
  };
  ctx.setSearchLabel = (label) => { input.value = label ?? ""; list.hidden = true; syncShare(); };
  if (navigator.share) shareMenu.querySelector('[data-share="native"]').hidden = false;
  shareButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = shareMenu.hidden;
    shareMenu.hidden = !open;
    shareButton.setAttribute("aria-expanded", String(open));
    if (open) shareMenu.querySelector("button:not([hidden])")?.focus();
  });
  shareMenu.addEventListener("click", async (event) => {
    const kind = event.target.closest("button[data-share]")?.dataset.share;
    if (!kind) return;
    const label = input.value.trim(), url = shareUrl(), text = `${label} in Brunnen 3D`;
    if (kind === "native") { try { await navigator.share({ title: text, url }); } catch {} }
    else if (kind === "mail") location.href = `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}:\n${url}`)}`;
    else if (kind === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`, "_blank", "noopener");
    else if (kind === "copy") {
      const button = event.target.closest("button");
      try { await navigator.clipboard.writeText(url); button.textContent = "Link kopiert ✓"; }
      catch { window.prompt("Link kopieren:", url); }
      setTimeout(() => { button.textContent = "Link kopieren"; closeShareMenu(); }, 1200);
      return;
    }
    closeShareMenu();
  });
  document.addEventListener("click", (event) => { if (!shareMenu.hidden && !event.target.closest("#share-menu, #search-share")) closeShareMenu(); });
  shareMenu.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeShareMenu(); shareButton.focus(); } });

  input.addEventListener("input", () => {
    syncShare();
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
