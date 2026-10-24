import { showSourceInfo } from "./layers.js";

const TRAFFIC_LAYERS = ["roads", "paths", "rail", "transport-lines", "stops"];
const BUILDING_MODE_SOURCES = {
  dorf: "swisstopo swissBUILDINGS3D; Dachfarbe aus SWISSIMAGE. Fassaden und Fenster sind gestalterisch.",
  neutral: "Einfarbige Darstellung ohne zusätzliche Datenquelle.",
  type: "BFS Gebäude- und Wohnungsregister (GWR), Gebäudeklasse",
  year: "BFS Gebäude- und Wohnungsregister (GWR), Baujahr oder angenäherte Bauperiode",
  height: "swisstopo swissBUILDINGS3D, Gebäudehöhe",
  floors: "BFS Gebäude- und Wohnungsregister (GWR), Geschosszahl",
  dwellings: "BFS Gebäude- und Wohnungsregister (GWR), Wohnungszahl",
  heating: "BFS Gebäude- und Wohnungsregister (GWR), Heizenergie",
  status: "BFS Gebäude- und Wohnungsregister (GWR), Registerstatus",
};

export function initMapNavigation(ctx) {
  const $ = (selector) => document.querySelector(selector);
  const dock = $("#map-dock"), baseCards = $("#base-map-cards"), quickPanel = $("#quick-panel"), quickTitle = $("#quick-title"), quickContent = $("#quick-content");
  const details = $("#layers-panel"), colorSelect = $("#color-mode");
  const mobileToolsToggle = $("#mobile-tools-toggle");
  const closeMobileTools = () => {
    document.body.classList.remove("mobile-tools-open");
    mobileToolsToggle?.setAttribute("aria-expanded", "false");
  };
  mobileToolsToggle?.addEventListener("click", () => {
    const open = document.body.classList.toggle("mobile-tools-open");
    mobileToolsToggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("mobile-tools-open") || event.target.closest("#brand, #clock-btn, #view-panel, #sky-panel")) return;
    closeMobileTools();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileTools(); });
  const quickButtons = [...dock.querySelectorAll("[data-quick]")];
  const disclosureButtons = quickButtons.filter((button) => ["buildings", "traffic"].includes(button.dataset.quick));
  $("#app").append(quickPanel);

  function syncGround(mode) {
    dock.querySelectorAll("[data-base]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.base === mode)));
      baseCards.querySelectorAll("[data-base]").forEach((button) => {
        const selected = button.dataset.base === mode;
        button.setAttribute("aria-pressed", String(selected));
        if (selected) button.title = `Kartentyp auswählen (${button.textContent.trim()})`;
      });
  }
  const previousGroundChange = ctx.onGroundModeChange;
  ctx.onGroundModeChange = (mode) => { previousGroundChange?.(mode); syncGround(mode); };
  syncGround(ctx.ground.state.mode ?? "sim");
  $("#topo-preview").src = ctx.ground.previewUrl();
  function setBaseCardsOpen(open) {
    baseCards.dataset.open = String(open);
    dock.dataset.mapOpen = String(open);
    dock.dataset.expanded = String(open);
    baseCards.setAttribute("aria-expanded", String(open));
    if (open) {
      closeQuick();
    }
    baseCards.querySelectorAll("[data-base]").forEach((button) => {
      const selected = button.dataset.base === ctx.ground.state.mode;
      button.tabIndex = open || selected ? 0 : -1;
      button.setAttribute("aria-expanded", String(open && selected));
    });
  }
  baseCards.querySelectorAll("[data-base]").forEach((button) => button.addEventListener("click", () => {
    if (baseCards.dataset.open !== "true") { setBaseCardsOpen(true); return; }
    if (button.getAttribute("aria-pressed") === "true") { setBaseCardsOpen(false); return; }
    void ctx.ground.set(button.dataset.base);
      setBaseCardsOpen(false);
  }));
  const modeSwatches = {
    dorf: "dorf", neutral: "neutral", type: "usage", year: "year", height: "height",
    floors: "floors", dwellings: "dwellings", heating: "heat", status: "status",
  };
  function syncBuildingModes() {
    const layer = ctx.layers.get("buildings");
    const enabled = Boolean(layer?.available && layer.visible);
    document.querySelectorAll("[data-building-mode]").forEach((button) => {
      const selected = button.dataset.buildingMode === colorSelect.value;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !enabled;
    });
    document.querySelectorAll(".building-mode-controls").forEach((controls) => {
      controls.disabled = !enabled;
      controls.classList.toggle("is-collapsed", !enabled);
    });
    $("#color-legend").classList.toggle("is-disabled", !enabled);
    if (!enabled && colorSelect.value !== "dorf") {
      colorSelect.value = "dorf";
      colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function populateBuildingModes(container) {
    container.replaceChildren();
    container.classList.add("building-mode-grid");
    for (const option of colorSelect.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "building-mode-tile";
      button.dataset.buildingMode = option.value;
      button.setAttribute("aria-pressed", String(option.value === colorSelect.value));
      const source = BUILDING_MODE_SOURCES[option.value] ?? "Keine externe Datenquelle dokumentiert";
      button.setAttribute("aria-label", `${option.textContent}. Datenquelle: ${source}`);
      button.title = `Datenquelle: ${source}`;
      const preview = document.createElement("span");
      preview.className = `building-mode-preview preview-${modeSwatches[option.value] ?? "neutral"}`;
      preview.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "building-mode-label";
      label.textContent = option.textContent;
      const sourceIcon = document.createElement("span");
      sourceIcon.className = "selector-source-icon";
      sourceIcon.setAttribute("aria-hidden", "true");
      sourceIcon.textContent = "i";
      button.append(preview, label, sourceIcon);
      button.addEventListener("click", (event) => {
        const sourceIcon = event.target.closest(".selector-source-icon");
        if (sourceIcon) {
          event.preventDefault();
          showSourceInfo(source, sourceIcon);
          return;
        }
        if (button.disabled) return;
        colorSelect.value = option.value === colorSelect.value && option.value !== "dorf" ? "dorf" : option.value;
        colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
        syncBuildingModes();
      });
      container.append(button);
    }
  }
  function syncQuickLegend() {
    quickContent.querySelectorAll(".quick-building-legend").forEach((legend) => {
      legend.innerHTML = $("#color-legend").innerHTML;
      legend.classList.toggle("is-disabled", !ctx.layers.get("buildings")?.visible);
    });
  }
  colorSelect.addEventListener("change", () => { syncBuildingModes(); syncQuickLegend(); });

  function layerControls(ids, className = "quick-layer-list", asTiles = false) {
    const list = document.createElement("div");
    list.className = className;
    for (const id of ids) {
      const item = ctx.layers.get(id);
      if (!item) continue;
      if (asTiles) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "layer-row";
        tile.dataset.layer = id;
        tile.disabled = !item.available;
        tile.setAttribute("aria-pressed", String(item.visible));
        tile.setAttribute("aria-label", `${item.label}${item.count ? `, ${item.count}` : ""}. Datenquelle: ${item.source}`);
        tile.title = `Datenquelle: ${item.source}${item.available ? "" : ` · ${item.note ?? "Daten nicht verfügbar"}`}`;
        const info = document.createElement("span");
        info.className = "layer-row-info";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = item.label;
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = item.count ?? "";
        const sourceIcon = document.createElement("span");
        sourceIcon.className = "selector-source-icon";
        sourceIcon.setAttribute("aria-hidden", "true");
        sourceIcon.textContent = "i";
        info.append(name, count);
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.setAttribute("aria-hidden", "true");
        swatch.style.background = item.color;
        tile.append(swatch, info, sourceIcon);
        tile.addEventListener("click", (event) => {
          const sourceButton = event.target.closest(".selector-source-icon");
          if (sourceButton) {
            event.preventDefault();
            showSourceInfo(item.source, sourceButton);
            return;
          }
          ctx.layers.setVisible(id, !ctx.layers.isVisible(id));
        });
        list.append(tile);
        continue;
      }
      const label = document.createElement("label");
      label.className = id === "buildings" ? "building-toggle-bar quick-building-toggle" : "quick-layer-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.visible;
      checkbox.disabled = !item.available;
      checkbox.dataset.layer = id;
      if (id === "buildings") {
        checkbox.className = "building-toggle-input";
        checkbox.setAttribute("aria-label", "Gebäude einblenden");
      }
      checkbox.addEventListener("change", () => ctx.layers.setVisible(id, checkbox.checked));
      if (id === "buildings") {
        const track = document.createElement("span");
        track.className = "building-toggle-track";
        track.setAttribute("aria-hidden", "true");
        label.append(checkbox, track);
        list.append(label);
        continue;
      }
      const name = document.createElement("span");
      name.textContent = item.label;
      label.append(checkbox, name);
      list.append(label);
    }
    return list;
  }

  function renderQuickLayers() {
    if (quickPanel.hidden) return;
    quickContent.querySelectorAll("[data-layer]").forEach((control) => {
      const layer = ctx.layers.get(control.dataset.layer);
      if (!layer) return;
      control.disabled = !layer.available;
      if (control instanceof HTMLInputElement) control.checked = layer.visible;
      else {
        control.setAttribute("aria-pressed", String(layer.visible));
        control.setAttribute("aria-label", `${layer.label}${layer.count ? `, ${layer.count}` : ""}. Datenquelle: ${layer.source}`);
        control.title = `Datenquelle: ${layer.source}${layer.available ? "" : ` · ${layer.note ?? "Daten nicht verfügbar"}`}`;
      }
    });
  }

  function syncQuickButtons() {
    const layer = ctx.layers.get("buildings");
    const button = dock.querySelector('[data-quick="buildings"]');
    if (!button) return;
    button.disabled = !layer?.available;
    button.title = "Gebäude und Darstellung einstellen";
  }

  function closeQuick() {
    quickPanel.hidden = true;
    disclosureButtons.forEach((button) => button.setAttribute("aria-expanded", "false"));
  }
  function setDetailsOpen(open) {
    details.hidden = !open;
    document.body.classList.toggle("map-details-open", open);
    dock.querySelector('[data-quick="layers"]')?.setAttribute("aria-expanded", String(open));
    if (open) {
      details.querySelectorAll(".layer-group").forEach((group) => { group.open = true; });
      setBaseCardsOpen(false);
    }
  }
  function openTimeTravel() {
    closeQuick();
    setDetailsOpen(false);
    ctx.history?.enter?.();
  }
  function openQuick(key) {
    if (key === "layers") {
      closeQuick();
      setDetailsOpen(true);
      $("#details-close").focus({ preventScroll: true });
      return;
    }
    if (key === "timeline") { openTimeTravel(); return; }
    const current = !quickPanel.hidden && quickPanel.dataset.mode === key;
    if (current) { closeQuick(); return; }
    quickPanel.dataset.mode = key;
    quickTitle.textContent = key === "buildings" ? "Gebäude" : "Verkehr";
    quickContent.replaceChildren();
    if (key === "buildings") {
      quickContent.append(layerControls(["buildings"], "quick-layer-list"));
      const heading = document.createElement("div");
      heading.className = "label";
      heading.textContent = "Darstellung";
      quickContent.append(heading);
      const controls = document.createElement("fieldset");
      controls.className = "building-mode-controls";
      controls.disabled = !ctx.layers.get("buildings")?.visible;
      controls.classList.toggle("is-collapsed", controls.disabled);
      const modes = document.createElement("div");
      modes.setAttribute("role", "group");
      modes.setAttribute("aria-label", "Gebäudefärbung");
      populateBuildingModes(modes);
      const legend = document.createElement("div");
      legend.className = "legend quick-building-legend";
      controls.append(modes, legend);
      quickContent.append(controls);
      syncQuickLegend();
    } else {
      quickContent.append(layerControls(TRAFFIC_LAYERS, "quick-layer-list", true));
    }
    quickPanel.hidden = false;
    disclosureButtons.forEach((button) => button.setAttribute("aria-expanded", String(button.dataset.quick === key)));
    renderQuickLayers();
  }

  ctx.closeMapPanels = () => {
    closeQuick();
    setDetailsOpen(false);
    setBaseCardsOpen(false);
  };

  quickButtons.forEach((button) => button.addEventListener("click", () => {
    openQuick(button.dataset.quick);
  }));
  dock.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") setBaseCardsOpen(true); });
  dock.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch" && !quickPanel.contains(event.relatedTarget) && !details.contains(event.relatedTarget) && !event.relatedTarget?.closest?.(".source-info-popup")) setBaseCardsOpen(false);
  });
  $("#quick-close").addEventListener("click", closeQuick);
  $("#details-close").addEventListener("click", () => {
    setDetailsOpen(false);
    dock.querySelector('[data-quick="layers"]')?.focus({ preventScroll: true });
  });
  document.addEventListener("pointerdown", (event) => {
    if (baseCards.dataset.open === "true" && !dock.contains(event.target) && !quickPanel.contains(event.target) && !details.contains(event.target)) setBaseCardsOpen(false);
    if (!details.hidden && !details.contains(event.target) && !dock.contains(event.target)) setDetailsOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!quickPanel.hidden) closeQuick();
    else if (!details.hidden) { setDetailsOpen(false); dock.querySelector('[data-quick="layers"]')?.focus({ preventScroll: true }); }
    else if (baseCards.dataset.open === "true") { setBaseCardsOpen(false); baseCards.querySelector('[aria-pressed="true"]')?.focus(); }
    else if (document.body.classList.contains("time-travel-active")) {
      const info = document.querySelector("#timeline-info");
      if (info && !info.hidden) {
        info.hidden = true;
        document.querySelector("#timeline-info-toggle")?.setAttribute("aria-expanded", "false");
      } else ctx.history?.exit?.();
    }
  });
  ctx.layers.subscribe(() => { renderQuickLayers(); syncBuildingModes(); syncQuickButtons(); syncQuickLegend(); });
  syncQuickButtons();
}