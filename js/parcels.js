// Amtliche Vermessung: Parzellenumrisse und Verknüpfung zur Gebäudeauswahl.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";

function lineGeometry(parcels, terrain) {
  const positions = [];
  for (const parcel of parcels) {
    for (const ring of parcel.rings ?? []) {
      const points = ring.map(([x, z]) => [x, (terrain.heightAt(x, z) ?? 0) + 0.6, z]);
      for (let i = 1; i < points.length; i++) positions.push(...points[i - 1], ...points[i]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export async function initParcels(ctx) {
  const { scene3d, terrain, layers, records } = ctx;
  const [data, planningData] = await Promise.all([loadOptionalJson("parcels.json"), loadOptionalJson("planning.json")]);
  const parcels = data?.parcels ?? [];
  const planning = planningData?.features ?? [];
  const byId = new Map(parcels.map((parcel) => [parcel.id, parcel]));
  const group = new THREE.Group();
  group.name = "parcels";
  scene3d.aoExcluded.add(group);

  const boundaries = new THREE.LineSegments(
    lineGeometry(parcels, terrain),
    new THREE.LineBasicMaterial({ color: 0xe8d574, transparent: true, opacity: 0.5 }),
  );
  const selected = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff9d1c, depthTest: false }),
  );
  selected.renderOrder = 20;
  group.add(boundaries, selected);

  function selectBuilding(index) {
    selected.geometry.dispose();
    const linked = (records[index]?.parcels ?? []).map((parcel) => byId.get(parcel.id)).filter(Boolean);
    selected.geometry = lineGeometry(linked, terrain);
  }

  layers.add({
    id: "parcels", label: "Parzellen", color: "#e8d574", available: parcels.length > 0,
    note: "parcels.json fehlt (Pipeline: python -m pipeline.run_all parcels)",
    count: parcels.length ? parcels.length.toLocaleString("de-CH") : "", visible: false,
    apply: (visible) => {
      group.visible = visible;
      if (visible && !group.parent) scene3d.scene.add(group);
    },
  });
  const planningGroups = {};
  const planLayers = {
    grundnutzung: { id: "planning-use", label: "Nutzungsplanung: Grundnutzung", color: "#4aa58d" },
    ueberlagernd: { id: "planning-overlays", label: "Nutzungsplanung: Überlagerungen", color: "#d77a42" },
  };
  for (const [kind, definition] of Object.entries(planLayers)) {
    const features = planning.filter((feature) => feature.kind === kind);
    const planGroup = new THREE.Group();
    planGroup.name = definition.id;
    const lines = new THREE.LineSegments(
      lineGeometry(features, terrain),
      new THREE.LineBasicMaterial({ color: definition.color, transparent: true, opacity: 0.8 }),
    );
    planGroup.add(lines);
    scene3d.aoExcluded.add(planGroup);
    planningGroups[kind] = planGroup;
    layers.add({
      id: definition.id, label: definition.label, color: definition.color,
      available: features.length > 0, note: "planning.json fehlt oder enthält keine Flächen",
      count: features.length ? features.length.toLocaleString("de-CH") : "", visible: false,
      apply: (visible) => {
        planGroup.visible = visible;
        if (visible && !planGroup.parent) scene3d.scene.add(planGroup);
      },
    });
  }
  ctx.parcels = { selectBuilding, records: parcels, planning, planningGroups };
}