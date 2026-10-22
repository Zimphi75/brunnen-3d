// Datenebenen aus public/data: Strassen, Wege, Bahn, Gewässer, Bäume, Gemeindegrenze.
import * as THREE from "three";
import { buildRibbons, buildPolygonMesh, buildCurtain } from "./draped.js";
import { loadOptionalJson, loadOptionalBinary } from "./api.js";
import { createSegmentIndex, createBlocker } from "./roadindex.js";
import { parseTrees, buildTrees } from "./trees.js";
import { markingLines, roadWidth } from "./roadmarks.js";
import { buildTrack } from "./track.js";
import { buildCrosswalks } from "./crosswalks.js";
import { Bridges } from "./bridges.js";

const ROAD_STYLE = {
  motorway: { width: 11, color: "#7a7f86" }, primary: { width: 8, color: "#8a8f95" }, secondary: { width: 7, color: "#969a9f" },
  tertiary: { width: 6, color: "#a4a7aa" }, minor: { width: 5, color: "#b3b5b6" }, service: { width: 3.5, color: "#bdbfbf" },
  track: { width: 3, color: "#a58f6c" }, path: { width: 1.6, color: "#a0693b" },
  rail: { width: 3.4, color: "#3a3c40" }, aerialway: { width: 0.6, color: "#222222" },
};
const ROAD_GROUPS = {
  roads: ["motorway", "primary", "secondary", "tertiary", "minor", "service"],
  paths: ["track", "path"],
  rail: ["rail", "aerialway"],
};

function overlayMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

const nodeKey = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;
const BLEND_LENGTH = 12;

/** Durchschnittsfarbe aller Strassen und Wege, die an einem Endknoten zusammentreffen. */
function nodeColors(roads) {
  const nodes = new Map();
  const add = (x, z, color) => {
    const key = nodeKey(x, z), entry = nodes.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    entry.r += color.r; entry.g += color.g; entry.b += color.b; entry.n++;
    nodes.set(key, entry);
  };
  for (const road of roads) {
    const style = ROAD_STYLE[road.c];
    if (!style || road.t || road.c === "rail" || road.c === "aerialway") continue;
    const color = new THREE.Color(style.color);
    add(road.p[0], road.p[1], color);
    add(road.p[road.p.length - 2], road.p[road.p.length - 1], color);
  }
  return nodes;
}

/** Vertexfarbe einer Strasse: an den Enden gleitet sie in die Durchschnittsfarbe der anschliessenden Strassentypen. */
function blendColors(road, nodes) {
  const own = new THREE.Color(ROAD_STYLE[road.c].color);
  const ends = [nodes.get(nodeKey(road.p[0], road.p[1])), nodes.get(nodeKey(road.p[road.p.length - 2], road.p[road.p.length - 1]))];
  const target = (entry) => (entry ? new THREE.Color(entry.r / entry.n, entry.g / entry.n, entry.b / entry.n) : own);
  const [startColor, endColor] = [target(ends[0]), target(ends[1])];
  return (s, total) => {
    const color = own.clone();
    if (s < BLEND_LENGTH) color.lerp(startColor, 0.95 * (1 - s / BLEND_LENGTH) ** 1.5);
    if (total - s < BLEND_LENGTH) color.lerp(endColor, 0.95 * (1 - (total - s) / BLEND_LENGTH) ** 1.5);
    return color;
  };
}

function buildRoadGroups(roads, terrain, roadIndex, bridges, crossings) {
  const groups = {};
  const nodes = nodeColors(roads);
  const vertexMaterial = () => { const m = overlayMaterial(0xffffff); m.vertexColors = true; return m; };
  for (const [group, kinds] of Object.entries(ROAD_GROUPS)) {
    const container = new THREE.Group();
    container.name = group;
    for (const kind of kinds) {
      const members = roads.map((road, index) => ({ road, index })).filter(({ road }) => road.c === kind && !road.t);
      const lines = members.map((m) => m.road.p);
      if (!lines.length) continue;
      const heightFns = members.map((m) => bridges?.heightFn(m.index) ?? null);
      if (kind === "rail") { container.add(buildTrack(lines, terrain, { heightFns })); continue; }
      const style = ROAD_STYLE[kind];
      const widths = kind === "motorway" || kind === "primary" || kind === "secondary" ? members.map((m) => roadWidth(m.road)) : null;
      const blend = kind !== "aerialway";
      const mesh = new THREE.Mesh(buildRibbons(lines, {
        width: style.width, widths, lift: 0.3, terrain, step: kind === "aerialway" ? 25 : 8, heightFns,
        colors: blend ? members.map((m) => blendColors(m.road, nodes)) : null,
      }), blend ? vertexMaterial() : overlayMaterial(style.color));
      mesh.receiveShadow = true;
      mesh.renderOrder = kind === "path" || kind === "track" ? 1 : 2;
      container.add(mesh);
    }
    if (group === "roads") {
      const { dashes, edges, dashMeta, edgeMeta } = markingLines(roads, roadIndex);
      const paint = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      const markings = new THREE.Group();
      markings.name = "markings";
      for (const [lines, meta, width] of [[dashes, dashMeta, 0.15], [edges, edgeMeta, 0.12]]) {
        if (!lines.length) continue;
        const mesh = new THREE.Mesh(buildRibbons(lines, {
          width, lift: 0.34, terrain, step: 8, heightFns: meta.map((m) => bridges?.heightFn(m.owner) ?? null), sStarts: meta.map((m) => m.s0),
        }), paint);
        mesh.renderOrder = 3;
        mesh.receiveShadow = true;
        markings.add(mesh);
      }
      if (crossings?.length) markings.add(buildCrosswalks(crossings, terrain, paint));
      container.add(markings);
      container.userData.markings = markings;
      if (bridges?.count) container.add(bridges.build());
    }
    groups[group] = container;
  }
  return groups;
}

function buildWater(water, terrain) {
  const group = new THREE.Group();
  group.name = "water";
  const lakeGroup = new THREE.Group();
  lakeGroup.name = "neutral-lake";
  const otherGroup = new THREE.Group();
  otherGroup.name = "other-waters";
  group.add(lakeGroup, otherGroup);
  const lake = water.areas.filter((a) => a.k === "lake");
  const other = water.areas.filter((a) => a.k !== "lake");
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f7396, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const lakeMaterial = material.clone();
  lakeMaterial.opacity = 0.5;
  lakeMaterial.depthWrite = false;
  for (const area of lake) {
    // Seespiegel: Median der Geländehöhe entlang des Ufers
    const heights = [];
    const ring = area.rings[0];
    for (let i = 0; i < ring.length; i += 2) { const h = terrain.heightAt(ring[i], ring[i + 1]); if (h !== null) heights.push(h); }
    heights.sort((a, b) => a - b);
    const level = (heights[Math.floor(heights.length / 2)] ?? 3) + 0.05;
    const mesh = new THREE.Mesh(buildPolygonMesh([area.rings], { terrain, level }), lakeMaterial);
    mesh.renderOrder = 4;
    lakeGroup.add(mesh);
  }
  if (other.length) {
    const mesh = new THREE.Mesh(buildPolygonMesh(other.map((a) => a.rings), { terrain, lift: 0.15 }), material);
    mesh.renderOrder = 4;
    otherGroup.add(mesh);
  }
  const widths = { river: 6, canal: 4, stream: 1.8 };
  const streams = water.streams;
  if (streams.length) {
    const mesh = new THREE.Mesh(
      buildRibbons(streams.map((s) => s.p), { widths: streams.map((s) => widths[s.k] ?? 1.8), lift: 0.2, terrain, step: 10 }),
      new THREE.MeshStandardMaterial({ color: 0x3f86ad, roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    mesh.renderOrder = 4;
    otherGroup.add(mesh);
  }
  group.userData.neutralLake = lakeGroup;
  group.userData.otherWaters = otherGroup;
  group.userData.lakeMaterial = lakeMaterial;
  return group;
}

export async function initDataLayers(ctx) {
  const { terrain, scene3d, layers, reportError } = ctx;
  const scene = scene3d.scene;
  const [roadsFile, waterFile, treeBuffer, municipality, crossingFile] = await Promise.all([
    loadOptionalJson("roads.json"), loadOptionalJson("water.json"), loadOptionalBinary("trees.bin"), loadOptionalJson("municipality.json"), loadOptionalJson("crossings.json"),
  ]);
  ctx.municipality = municipality;
  ctx.roads = roadsFile?.roads ?? [];
  ctx.roadIndex = createSegmentIndex(ctx.roads, (r) => ROAD_GROUPS.roads.includes(r.c) && !r.t);
  ctx.railIndex = createSegmentIndex(ctx.roads, (r) => r.c === "rail" && !r.t);

  const safe = (label, builder) => { try { return builder(); } catch (error) { reportError(`${label}: ${error.message}`, error); return null; } };

  ctx.bridges = safe("Brücken", () => new Bridges(ctx.roads, terrain));
  ctx.crossings = crossingFile?.crossings ?? [];
  const roadGroups = roadsFile ? safe("Strassen", () => buildRoadGroups(roadsFile.roads, terrain, ctx.roadIndex, ctx.bridges, ctx.crossings)) : null;
  if (!roadsFile) reportError("roads.json fehlt (Pipeline: python -m pipeline.process_osm)");
  const count = (kinds) => roadsFile ? roadsFile.roads.filter((r) => kinds.includes(r.c) && !r.t).length.toLocaleString("de-CH") : "";
  for (const [id, label, color] of [["roads", "Strassen", "#8a8f95"], ["paths", "Wege und Pfade", "#a0693b"], ["rail", "Bahn und Seilbahnen", "#3a3c40"]]) {
    layers.add({
      id, label, color, available: Boolean(roadGroups), note: "roads.json fehlt", count: count(ROAD_GROUPS[id]), visible: id !== "paths",
      apply: (v) => { if (!roadGroups) return; roadGroups[id].visible = v; if (v && !roadGroups[id].parent) scene.add(roadGroups[id]); },
    });
  }

  if (roadGroups) {
    // dünne Linien flimmern aus der Ferne: nur in der Nähe zeichnen
    scene3d.onFrame((_, __, distance) => {
      roadGroups.roads.userData.markings.visible = distance < 700;
      roadGroups.rail.children.find((c) => c.name === "track")?.userData.rails && (roadGroups.rail.children.find((c) => c.name === "track").userData.rails.visible = distance < 1500);
    });
  }

  const waterGroup = waterFile ? safe("Gewässer", () => buildWater(waterFile, terrain)) : null;
  if (waterGroup) scene3d.aoExcluded.add(waterGroup);
  ctx.setNeutralLake = (active) => {
    if (!waterGroup) return;
    const lake = waterGroup.userData.neutralLake;
    const other = waterGroup.userData.otherWaters;
    waterGroup.visible = active || layers.isVisible("water");
    lake.visible = active || layers.isVisible("water");
    other.visible = !active && layers.isVisible("water");
    waterGroup.userData.lakeMaterial.opacity = active ? 0.98 : 0.5;
    waterGroup.userData.lakeMaterial.depthWrite = active;
  };
  layers.add({
    id: "water", label: "Gewässer", color: "#2f7396", available: Boolean(waterGroup), note: "water.json fehlt",
    apply: (v) => { if (!waterGroup) return; waterGroup.visible = v; if (v && !waterGroup.parent) scene.add(waterGroup); },
  });

  const treeLayer = treeBuffer ? safe("Bäume", () => buildTrees({ trees: parseTrees(treeBuffer), terrain, ortho: ctx.orthoTexture, scene3d, ctx, blocked: createBlocker(ctx.roads, waterFile) })) : null;
  layers.add({
    id: "trees", label: "Bäume", color: "#3f7a3a", available: Boolean(treeLayer), note: "trees.bin fehlt (Pipeline: process_trees)",
    count: treeLayer ? treeLayer.count.toLocaleString("de-CH") : "",
    apply: (v) => { if (!treeLayer) return; treeLayer.group.visible = v; if (v && !treeLayer.group.parent) scene.add(treeLayer.group); },
  });
  const curtain = municipality ? safe("Gemeindegrenze", () => {
    const rings = municipality.polygons.map((rings) => rings[0]);
    return buildCurtain(rings, { terrain, height: 120, color: "#ff5a36" });
  }) : null;
  if (curtain) scene3d.aoExcluded.add(curtain);
  layers.add({
    id: "boundary", label: "Gemeindegrenze", color: "#e0472b", available: Boolean(curtain), note: "municipality.json fehlt",
    apply: (v) => { if (!curtain) return; curtain.visible = v; if (v && !curtain.parent) scene.add(curtain); },
  });
}
