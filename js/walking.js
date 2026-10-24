import * as THREE from "three";
import { buildRibbons } from "./draped.js";
import { buildWalkingGraph, shortestWalkRoutes, walkingRouteTo, walkingSegmentsWithin } from "./routing.js";

const MINUTE_OPTIONS = [5, 10, 15];
const fmt = (value) => Number(value).toLocaleString("de-CH");

function targetRows(ctx, search, minutes, category = "all") {
  const targets = [
    ...(ctx.pois ?? []).map((poi, index) => ({ kind: "poi", index, x: poi.x, z: poi.z, name: poi.name, category: poi.category, subtype: poi.subtypeLabel })),
    ...(ctx.transport?.stops ?? []).map((stop, index) => ({ kind: "stop", index, x: stop.x, z: stop.z, name: stop.name ?? stop.n, category: "Mobilität", subtype: "ÖV-Haltestelle" })),
  ];
  return targets.flatMap((target) => {
    if (category !== "all" && target.category !== category) return [];
    const route = walkingRouteTo(search, target);
    return route && route.minutes <= minutes ? [{ ...target, route }] : [];
  }).sort((a, b) => a.route.minutes - b.route.minutes || a.route.distanceM - b.route.distanceM);
}

export function initWalkingAnalysis(ctx) {
  const graph = buildWalkingGraph(ctx.roads);
  const overlay = new THREE.Group();
  overlay.name = "walking-reachability";
  ctx.scene3d.scene.add(overlay);
  ctx.scene3d.aoExcluded.add(overlay);

  const panel = document.querySelector("#demographic-analysis");
  const title = document.querySelector("#demographic-analysis-title");
  const description = document.querySelector("#demographic-analysis-description");
  const legend = document.querySelector(".demographic-analysis-legend");
  const legendImage = document.querySelector("#demographic-analysis-legend");
  const cellInfo = document.querySelector("#demographic-cell-info");
  const viewControls = document.querySelector(".demographic-analysis-views");
  const timeControls = document.querySelector("#walking-analysis-controls");
  const categoryFilter = document.querySelector("#walking-category-filter");
  const categorySelect = document.querySelector("#walking-category");
  const results = document.querySelector("#walking-analysis-results");
  const timeButtons = [...timeControls.querySelectorAll("[data-walking-minutes]")];
  const material = new THREE.MeshBasicMaterial({ color: 0xd7552a, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide });
  let mesh = null, routeMesh = null, activeRecord = null, activeSearch = null, activeMinutes = 5;

  function clearOverlay() {
    if (!mesh) return;
    overlay.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  }

  function clearRoute() {
    if (!routeMesh) return;
    overlay.remove(routeMesh);
    routeMesh.geometry.dispose();
    routeMesh.material.dispose();
    routeMesh = null;
  }

  function showRoute(points) {
    clearRoute();
    if (points.length < 2) return;
    routeMesh = new THREE.Mesh(
      buildRibbons([points.flat()], { width: 4, lift: 4, terrain: ctx.terrain, step: 5 }),
      new THREE.MeshBasicMaterial({ color: 0x137b82, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }),
    );
    routeMesh.renderOrder = 15;
    overlay.add(routeMesh);
  }

  function renderResults() {
    results.replaceChildren();
    const rows = targetRows(ctx, activeSearch, activeMinutes, categorySelect.value);
    const targetLookup = new Map();
    const summary = document.createElement("p");
    summary.className = "walking-results-summary";
    summary.textContent = rows.length
      ? `Die nächsten ${Math.min(rows.length, 8)} von ${rows.length} erfassten Orten im ${activeMinutes}-Minuten-Wegenetz.`
      : "Im vorbereiteten Wegenetz wurde kein erreichbares Ziel gefunden.";
    results.append(summary);
    rows.slice(0, 8).forEach((target) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "walking-result";
      button.dataset.targetKind = target.kind;
      button.dataset.targetIndex = String(target.index);
      button.dataset.targetKey = `${target.kind}:${target.index}`;
      targetLookup.set(button.dataset.targetKey, target);
      const copy = document.createElement("span");
      const name = document.createElement("b");
      const category = document.createElement("small");
      name.textContent = target.name || target.category;
      category.textContent = `${target.category}${target.subtype ? ` · ${target.subtype}` : ""}`;
      copy.append(name, category);
      const distance = document.createElement("strong");
      distance.textContent = `${target.route.minutes} min · ${fmt(target.route.distanceM)} m`;
      button.append(copy, distance);
      results.append(button);
    });
    results._targetLookup = targetLookup;
  }

  function setMinutes(minutes) {
    if (!MINUTE_OPTIONS.includes(minutes) || !activeRecord) return false;
    const previousMinutes = activeMinutes;
    activeMinutes = minutes;
    clearRoute();
    timeButtons.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.walkingMinutes) === minutes)));
    activeSearch = shortestWalkRoutes(graph, ctx.frame.toLocal(activeRecord.center[0], activeRecord.center[1]), minutes);
    clearOverlay();
    if (activeSearch) {
      const lines = walkingSegmentsWithin(activeSearch, minutes);
      if (lines.length) {
        mesh = new THREE.Mesh(buildRibbons(lines, { width: 2.1, lift: 2, terrain: ctx.terrain, step: 12 }), material);
        mesh.renderOrder = 12;
        overlay.add(mesh);
      }
    }
    if (minutes > previousMinutes && ctx.rig) {
      const view = ctx.rig.currentView();
      const distance = Math.max(view.distance, 650 * (minutes / 5) * 1.35);
      if (distance > view.distance) {
        ctx.rig.flyTo({ target: ctx.scene3d.controls.target.clone(), distance, heading: view.heading, tilt: view.tilt, duration: 0.8 });
      }
    }
    title.textContent = `Zu Fuss in ${minutes} Minuten`;
    description.textContent = "Hervorgehoben sind erreichbare Wegabschnitte, keine pauschalen Umkreise.";
    legend.hidden = true;
    legendImage.hidden = true;
    cellInfo.hidden = true;
    viewControls.hidden = true;
    timeControls.hidden = false;
    categoryFilter.hidden = false;
    results.hidden = false;
    if (!activeSearch) {
      results.textContent = graph.nodeCount ? "Kein Fussweg in der Nähe des Gebäudes gefunden." : "Für diesen Kartenausschnitt sind keine Fusswege geladen.";
    } else renderResults();
    panel.hidden = false;
    return Boolean(activeSearch);
  }

  timeButtons.forEach((button) => button.addEventListener("click", () => setMinutes(Number(button.dataset.walkingMinutes))));
  categorySelect.addEventListener("change", renderResults);
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-target-kind]");
    if (!button) return;
    const target = results._targetLookup?.get(button.dataset.targetKey);
    if (target) showRoute(target.route.points);
    const index = Number(button.dataset.targetIndex);
    ctx.inspector?.suspendBuildingProfile?.();
    if (button.dataset.targetKind === "poi") ctx.showPoi?.(index);
    else ctx.showStop?.(index);
  });

  ctx.walking = {
    get active() { return Boolean(activeRecord); },
    get graph() { return graph; },
    routesFrom(record, targets) {
      if (!record?.center || !targets?.length) return [];
      const local = ctx.frame.toLocal(record.center[0], record.center[1]);
      const search = shortestWalkRoutes(graph, local);
      return targets.map((target) => search ? walkingRouteTo(search, target) : null);
    },
    activate(record, minutes = 5) {
      activeRecord = record;
      return setMinutes(minutes);
    },
    setMinutes,
    deactivate() {
      activeRecord = null;
      activeSearch = null;
      clearOverlay();
      clearRoute();
      timeControls.hidden = true;
      categoryFilter.hidden = true;
      results.hidden = true;
      if (!ctx.demographics?.activeLayer()) panel.hidden = true;
    },
  };
}