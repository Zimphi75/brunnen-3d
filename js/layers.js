// Ebenenverwaltung (Ein-/Ausschalten, Verfügbarkeit, Zähler).

const LAYER_GROUPS = [
  { id: "base", label: "Karte, Gebäude & Grundstücke", open: true, layers: ["terrain", "buildings", "boundary", "parcels", "planning-use", "planning-overlays"] },
  { id: "register", label: "Register", open: true, layers: ["register"] },
  { id: "mobility", label: "Mobilität & Verkehr", layers: ["roads", "paths", "rail", "transport-lines", "stops"] },
  { id: "places", label: "Orte & Natur", layers: ["pois", "labels", "water", "trees"] },
  { id: "demographics", label: "Bevölkerung & Arbeit", layers: ["demography-population", "demography-employment"] },
  { id: "energy", label: "Energie", layers: ["pv"] },
  { id: "analysis", label: "Simulationsebenen", layers: ["ambient", "vehicles"] },
  { id: "display", label: "Darstellungsebenen", layers: ["lamps", "hires", "weather", "shadows", "ao", "bloom"] },
  { id: "other", label: "Weitere Ebenen", layers: [] },
];
const LAYER_TILE_LABELS = {
  "planning-use": "Grundnutzung",
  "planning-overlays": "Überlagerungen",
  "demography-population": "Einwohner",
  "demography-employment": "Arbeitsplätze",
};
const LAYER_SOURCES = {
  terrain: "swisstopo swissALTI3D, 5-m-Höhenraster",
  buildings: "swisstopo swissBUILDINGS3D 3.0 Beta; BFS Gebäude- und Wohnungsregister (GWR); SWISSIMAGE für Dachfarben",
  boundary: "swisstopo swissBOUNDARIES3D",
  parcels: "Amt für Geoinformation Kanton Schwyz, Amtliche Vermessung",
  "planning-use": "ÖREB-Fachdaten Nutzungsplanung, Kanton Schwyz und Gemeinde Ingenbohl",
  "planning-overlays": "ÖREB-Fachdaten Nutzungsplanung, Kanton Schwyz und Gemeinde Ingenbohl",
  register: "Bundesamt für Statistik (BFS), Gebäude- und Wohnungsregister (GWR)",
  roads: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  paths: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  rail: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  "transport-lines": "OpenStreetMap-Mitwirkende; Fahrplandaten von transport.opendata.ch",
  stops: "OpenStreetMap-Mitwirkende; Fahrplandaten von transport.opendata.ch",
  pois: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  labels: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  water: "OpenStreetMap-Mitwirkende (ODbL 1.0)",
  trees: "WSL/BAFU Vegetationshöhenmodell NFI (2025), ergänzt mit OSM-Einzelbäumen",
  "demography-population": "Bundesamt für Statistik (BFS), STATPOP via GeoAdmin; 100-m-Raster",
  "demography-employment": "Bundesamt für Statistik (BFS), STATENT via GeoAdmin; 100-m-Raster",
  pv: "Bundesamt für Energie (BFE), Elektrizitätsproduktionsanlagen; Modulbelegung simuliert",
  ambient: "Simulation aus Strassenklassen und Bebauung; keine Verkehrs- oder Personenzählungen",
  vehicles: "Fahrplansimulation aus OpenStreetMap und transport.opendata.ch; keine gemessenen Fahrzeugpositionen",
  lamps: "OpenStreetMap-Mitwirkende; zusätzliche Standorte aus Strassen mit lit=yes abgeleitet",
  hires: "swisstopo SWISSIMAGE 10 cm",
  weather: "Open-Meteo-Wettermodell; sichtbare Wettereffekte sind simuliert",
  shadows: "Sonnenstand aus Datum und Ort; Schattenwurf im 3D-Modell berechnet",
  ao: "Im 3D-Modell berechneter Darstellungseffekt, keine externe Datenquelle",
  bloom: "Im 3D-Modell berechneter Darstellungseffekt, keine externe Datenquelle",
};
let sourceInfoPopup;

export function showSourceInfo(source, anchor) {
  if (!sourceInfoPopup) {
    sourceInfoPopup = document.createElement("div");
    sourceInfoPopup.className = "source-info-popup";
    sourceInfoPopup.setAttribute("role", "status");
    sourceInfoPopup.setAttribute("aria-live", "polite");
    const text = document.createElement("p");
    text.className = "source-info-text";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn source-info-close";
    close.setAttribute("aria-label", "Quelleninfo schliessen");
    close.textContent = "×";
    close.addEventListener("click", () => { sourceInfoPopup.hidden = true; });
    sourceInfoPopup.addEventListener("pointerdown", (event) => event.stopPropagation());
    sourceInfoPopup.append(text, close);
    document.body.append(sourceInfoPopup);
    document.addEventListener("pointerdown", (event) => {
      if (!sourceInfoPopup.contains(event.target) && !event.target.closest?.(".selector-source-icon")) sourceInfoPopup.hidden = true;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") sourceInfoPopup.hidden = true;
    });
  }
  sourceInfoPopup.querySelector(".source-info-text").textContent = `Datenquelle: ${source}`;
  sourceInfoPopup.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  sourceInfoPopup.style.left = `${left}px`;
  sourceInfoPopup.style.width = `${width}px`;
  const height = sourceInfoPopup.getBoundingClientRect().height;
  const below = rect.bottom + 8;
  const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8);
  sourceInfoPopup.style.top = `${top}px`;
}

export function createLayerManager(container, groupContainers = {}) {
  const layers = new Map();
  const groups = new Map();
  const groupForLayer = new Map();
  const listeners = new Set();
  const entries = () => [...layers.values()].map(({ id, label, visible, available, group }) => ({ id, label, visible, available, group: group.id }));
  const notify = () => listeners.forEach((listener) => listener(entries()));

  for (const definition of LAYER_GROUPS) {
    const section = document.createElement("details");
    section.className = "layer-group";
    section.open = Boolean(definition.open);
    section.hidden = true;
    const summary = document.createElement("summary");
    summary.className = "layer-group-summary";
    const title = document.createElement("span");
    title.textContent = definition.label;
    const count = document.createElement("span");
    count.className = "layer-group-count";
    summary.append(title, count);
    const rows = document.createElement("div");
    rows.className = "layer-group-rows";
    section.append(summary, rows);
    (groupContainers[definition.id] ?? container).append(section);
    groups.set(definition.id, { ...definition, section, count, rows, items: [] });
    for (const id of definition.layers) groupForLayer.set(id, definition.id);
  }

  function renderGroup(group) {
    const enabled = group.items.filter((layer) => layer.visible).length;
    group.count.textContent = `${enabled}/${group.items.length}`;
    group.section.hidden = group.items.length === 0;
  }

  function render(layer) {
    let row = layer.row;
    if (!row) {
      row = document.createElement("button");
      row.type = "button";
      row.className = "layer-row";
      row.innerHTML = '<span class="swatch" aria-hidden="true"></span><span class="selector-source-icon" aria-hidden="true">i</span><span class="layer-row-info"><span class="name"></span><span class="count"></span></span>';
      row.addEventListener("click", (event) => {
        const sourceIcon = event.target.closest(".selector-source-icon");
        if (sourceIcon) {
          event.preventDefault();
          showSourceInfo(layer.source, sourceIcon);
          return;
        }
        setVisible(layer.id, !layer.visible);
      });
      layer.group.rows.append(row);
      layer.row = row;
    }
    row.disabled = !layer.available;
    row.setAttribute("aria-pressed", String(layer.visible));
    row.setAttribute("aria-label", `${layer.label}${layer.count ? `, ${layer.count}` : ""}. Datenquelle: ${layer.source}`);
    row.classList.toggle("disabled", !layer.available);
    row.title = `Datenquelle: ${layer.source}${layer.available ? "" : ` · ${layer.note ?? "Daten nicht verfügbar"}`}`;
    row.querySelector(".swatch").style.background = layer.color;
    row.querySelector(".name").textContent = LAYER_TILE_LABELS[layer.id] ?? layer.label;
    row.querySelector(".count").textContent = layer.count ?? "";
    renderGroup(layer.group);
  }

  function setVisible(id, visible) {
    const layer = layers.get(id);
    if (!layer || !layer.available) return;
    layer.visible = visible;
    layer.apply?.(visible);
    render(layer);
    notify();
  }

  return {
    add(definition) {
      const group = groups.get(definition.group ?? groupForLayer.get(definition.id) ?? "other");
      const layer = { visible: true, available: true, ...definition, group };
      layer.source ??= LAYER_SOURCES[layer.id] ?? "Keine externe Datenquelle dokumentiert";
      group.items.push(layer);
      layers.set(layer.id, layer);
      render(layer);
      if (layer.available) layer.apply?.(layer.visible);
      notify();
      return layer;
    },
    update(id, patch) {
      const layer = layers.get(id);
      if (!layer) return;
      Object.assign(layer, patch);
      render(layer);
      if (layer.available) layer.apply?.(layer.visible);
      notify();
    },
    setVisible,
    isVisible: (id) => layers.get(id)?.visible ?? false,
    get: (id) => {
      const layer = layers.get(id);
      return layer ? { id: layer.id, label: layer.label, tileLabel: LAYER_TILE_LABELS[layer.id] ?? layer.label, color: layer.color, count: layer.count, visible: layer.visible, available: layer.available, note: layer.note, source: layer.source } : null;
    },
    entries,
    snapshot: () => Object.fromEntries([...layers].map(([id, layer]) => [id, layer.visible])),
    restore(snapshot) { for (const [id, visible] of Object.entries(snapshot ?? {})) setVisible(id, visible); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
