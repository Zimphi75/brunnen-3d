// Ebenenverwaltung (Ein-/Ausschalten, Verfügbarkeit, Zähler).

const LAYER_GROUPS = [
  { id: "base", label: "Karte, Gebäude & Grundstücke", open: true, layers: ["terrain", "buildings", "boundary", "parcels", "planning-use", "planning-overlays", "register"] },
  { id: "mobility", label: "Mobilität & Verkehr", layers: ["roads", "paths", "rail", "transport-lines", "stops", "lamps"] },
  { id: "places", label: "Orte & Natur", layers: ["pois", "labels", "water", "trees"] },
  { id: "demographics", label: "Bevölkerung & Arbeit", layers: ["demography-population", "demography-employment"] },
  { id: "energy", label: "Energie", layers: ["pv"] },
  { id: "simulation", label: "Simulationen", layers: ["ambient", "vehicles", "weather"] },
  { id: "display", label: "Licht & Bildqualität", layers: ["hires", "shadows", "ao", "bloom"] },
  { id: "other", label: "Weitere Ebenen", layers: [] },
];

export function createLayerManager(container) {
  const layers = new Map();
  const groups = new Map();
  const groupForLayer = new Map();

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
    container.append(section);
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
      row = document.createElement("label");
      row.className = "layer-row";
      row.innerHTML = '<input type="checkbox"><span class="swatch"></span><span class="name"></span><span class="count"></span>';
      row.querySelector("input").addEventListener("change", (event) => setVisible(layer.id, event.target.checked));
      layer.group.rows.append(row);
      layer.row = row;
    }
    const input = row.querySelector("input");
    input.checked = layer.visible;
    input.disabled = !layer.available;
    row.classList.toggle("disabled", !layer.available);
    row.title = layer.available ? "" : layer.note ?? "Daten nicht verfügbar";
    row.querySelector(".swatch").style.background = layer.color;
    row.querySelector(".name").textContent = layer.label;
    row.querySelector(".count").textContent = layer.count ?? "";
    renderGroup(layer.group);
  }

  function setVisible(id, visible) {
    const layer = layers.get(id);
    if (!layer || !layer.available) return;
    layer.visible = visible;
    layer.apply?.(visible);
    render(layer);
  }

  return {
    add(definition) {
      const group = groups.get(definition.group ?? groupForLayer.get(definition.id) ?? "other");
      const layer = { visible: true, available: true, ...definition, group };
      group.items.push(layer);
      layers.set(layer.id, layer);
      render(layer);
      if (layer.available) layer.apply?.(layer.visible);
      return layer;
    },
    update(id, patch) {
      const layer = layers.get(id);
      if (!layer) return;
      Object.assign(layer, patch);
      render(layer);
      if (layer.available) layer.apply?.(layer.visible);
    },
    setVisible,
    isVisible: (id) => layers.get(id)?.visible ?? false,
  };
}
