// Datenebenen aus public/data: Strassen, Wege, Bahn, Gewässer, Bäume, Gemeindegrenze.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildRibbons, buildPolygonMesh, buildCurtain } from "./draped.js";
import { loadOptionalJson, loadOptionalBinary } from "./api.js";

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

function buildRoadGroups(roads, terrain) {
  const groups = {};
  for (const [group, kinds] of Object.entries(ROAD_GROUPS)) {
    const container = new THREE.Group();
    container.name = group;
    for (const kind of kinds) {
      const lines = roads.filter((r) => r.c === kind && !r.t).map((r) => r.p);
      if (!lines.length) continue;
      const style = ROAD_STYLE[kind];
      const mesh = new THREE.Mesh(buildRibbons(lines, { width: style.width, lift: kind === "rail" ? 0.35 : 0.3, terrain, step: kind === "aerialway" ? 25 : 8 }), overlayMaterial(style.color));
      mesh.receiveShadow = true;
      mesh.renderOrder = kind === "rail" ? 3 : kind === "path" || kind === "track" ? 1 : 2;
      container.add(mesh);
    }
    groups[group] = container;
  }
  return groups;
}

function buildWater(water, terrain) {
  const group = new THREE.Group();
  group.name = "water";
  const lake = water.areas.filter((a) => a.k === "lake");
  const other = water.areas.filter((a) => a.k !== "lake");
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f7396, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  for (const area of lake) {
    // Seespiegel: Median der Geländehöhe entlang des Ufers
    const heights = [];
    const ring = area.rings[0];
    for (let i = 0; i < ring.length; i += 2) { const h = terrain.heightAt(ring[i], ring[i + 1]); if (h !== null) heights.push(h); }
    heights.sort((a, b) => a - b);
    const level = (heights[Math.floor(heights.length / 2)] ?? 3) + 0.05;
    const mesh = new THREE.Mesh(buildPolygonMesh([area.rings], { terrain, level }), material);
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  if (other.length) {
    const mesh = new THREE.Mesh(buildPolygonMesh(other.map((a) => a.rings), { terrain, lift: 0.15 }), material);
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  const widths = { river: 6, canal: 4, stream: 1.8 };
  const streams = water.streams;
  if (streams.length) {
    const mesh = new THREE.Mesh(
      buildRibbons(streams.map((s) => s.p), { widths: streams.map((s) => widths[s.k] ?? 1.8), lift: 0.2, terrain, step: 10 }),
      new THREE.MeshStandardMaterial({ color: 0x3f86ad, roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  return group;
}

// Format siehe pipeline/process_trees.py ("TRE1")
function parseTrees(buffer) {
  const header = new Uint32Array(buffer, 0, 4);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "TRE1") throw new Error("trees.bin: unbekanntes Format");
  const count = header[2];
  const pad = (n) => n + ((4 - (n % 4)) % 4);
  let offset = 16;
  const x = new Float32Array(buffer, offset, count); offset += count * 4;
  const z = new Float32Array(buffer, offset, count); offset += count * 4;
  const height = new Uint8Array(buffer, offset, count); offset += pad(count);
  const radius = new Uint8Array(buffer, offset, count);
  return { count, x, z, height, radius };
}

function treeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.08, 0.12, 0.35, 5).translate(0, 0.175, 0);
  const crown = new THREE.ConeGeometry(1, 0.85, 6).translate(0, 0.35 + 0.425, 0);
  const paint = (geometry, hex) => {
    const color = new THREE.Color(hex);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry.toNonIndexed();
  };
  return mergeGeometries([paint(trunk, "#6b4a2e"), paint(crown, "#ffffff")]);
}

function buildTrees(trees, terrain) {
  const group = new THREE.Group();
  group.name = "trees";
  const geometry = treeGeometry();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const cellSize = 500;
  const cells = new Map();
  for (let i = 0; i < trees.count; i++) {
    const key = `${Math.floor(trees.x[i] / cellSize)}:${Math.floor(trees.z[i] / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), color = new THREE.Color();
  const meshes = [];
  for (const members of cells.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, members.length);
    members.forEach((tree, slot) => {
      const h = trees.height[tree] / 2, r = trees.radius[tree] / 4;
      const ground = terrain.heightAt(trees.x[tree], trees.z[tree]) ?? 0;
      matrix.compose(new THREE.Vector3(trees.x[tree], ground, trees.z[tree]), quaternion, new THREE.Vector3(r, h, r));
      mesh.setMatrixAt(slot, matrix);
      // deterministische leichte Farbvariation aus der Position (rein gestalterisch)
      const jitter = ((Math.sin(trees.x[tree] * 12.9898 + trees.z[tree] * 78.233) * 43758.5453) % 1 + 1) % 1;
      color.setHSL(0.26 + 0.05 * jitter, 0.38, 0.1 + 0.07 * jitter);
      mesh.setColorAt(slot, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
  }
  return { group, meshes };
}

export async function initDataLayers(ctx) {
  const { terrain, scene3d, layers, reportError } = ctx;
  const scene = scene3d.scene;
  const [roadsFile, waterFile, treeBuffer, municipality] = await Promise.all([
    loadOptionalJson("roads.json"), loadOptionalJson("water.json"), loadOptionalBinary("trees.bin"), loadOptionalJson("municipality.json"),
  ]);
  ctx.municipality = municipality;

  const safe = (label, builder) => { try { return builder(); } catch (error) { reportError(`${label}: ${error.message}`, error); return null; } };

  const roadGroups = roadsFile ? safe("Strassen", () => buildRoadGroups(roadsFile.roads, terrain)) : null;
  if (!roadsFile) reportError("roads.json fehlt (Pipeline: python -m pipeline.process_osm)");
  const count = (kinds) => roadsFile ? roadsFile.roads.filter((r) => kinds.includes(r.c) && !r.t).length.toLocaleString("de-CH") : "";
  for (const [id, label, color] of [["roads", "Strassen", "#8a8f95"], ["paths", "Wege und Pfade", "#a0693b"], ["rail", "Bahn und Seilbahnen", "#3a3c40"]]) {
    layers.add({
      id, label, color, available: Boolean(roadGroups), note: "roads.json fehlt", count: count(ROAD_GROUPS[id]), visible: id !== "paths",
      apply: (v) => { if (!roadGroups) return; roadGroups[id].visible = v; if (v && !roadGroups[id].parent) scene.add(roadGroups[id]); },
    });
  }

  const waterGroup = waterFile ? safe("Gewässer", () => buildWater(waterFile, terrain)) : null;
  if (waterGroup) scene3d.aoExcluded.add(waterGroup);
  layers.add({
    id: "water", label: "Gewässer", color: "#2f7396", available: Boolean(waterGroup), note: "water.json fehlt",
    apply: (v) => { if (!waterGroup) return; waterGroup.visible = v; if (v && !waterGroup.parent) scene.add(waterGroup); },
  });

  const treeLayer = treeBuffer ? safe("Bäume", () => buildTrees(parseTrees(treeBuffer), terrain)) : null;
  layers.add({
    id: "trees", label: "Bäume", color: "#3f7a3a", available: Boolean(treeLayer), note: "trees.bin fehlt (Pipeline: process_trees)",
    count: treeLayer ? treeLayer.meshes.reduce((s, m) => s + m.count, 0).toLocaleString("de-CH") : "",
    apply: (v) => { if (!treeLayer) return; treeLayer.group.visible = v; if (v && !treeLayer.group.parent) scene.add(treeLayer.group); },
  });
  if (treeLayer) {
    // nur Baumzellen in Blicknähe zeichnen
    let last = 0;
    scene3d.onFrame((_, now) => {
      if (now - last < 400 || !treeLayer.group.visible) return;
      last = now;
      const target = scene3d.controls.target;
      for (const mesh of treeLayer.meshes) {
        const sphere = mesh.boundingSphere;
        mesh.visible = sphere.center.distanceTo(target) - sphere.radius < 3800;
      }
    });
  }

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
