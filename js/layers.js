// Ebenenverwaltung (Ein-/Ausschalten, Verfügbarkeit, Zähler).

export function createLayerManager(container) {
  const layers = new Map();

  function render(layer) {
    let row = layer.row;
    if (!row) {
      row = document.createElement("label");
      row.className = "layer-row";
      row.innerHTML = '<input type="checkbox"><span class="swatch"></span><span class="name"></span><span class="count"></span>';
      row.querySelector("input").addEventListener("change", (event) => setVisible(layer.id, event.target.checked));
      container.append(row);
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
      const layer = { visible: true, available: true, ...definition };
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
