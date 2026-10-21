// Gleise: Schotterbett mit Schwellen (Textur), zwei Schienen im Normalspurabstand, auf das Gelände projiziert.
import * as THREE from "three";
import { buildRibbons } from "./draped.js";
import { walk } from "./roadmarks.js";

const BED_WIDTH = 3.6;
const SLEEPER_PITCH = 0.6;
const GAUGE = 1.435;
const RAIL_WIDTH = 0.14;
const BED_LIFT = 0.32;
const RAIL_LIFT = 0.42;

function bedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext("2d");
  g.fillStyle = "#8d8a84";
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 1400; i++) { // Schottersteine
    const shade = 90 + Math.random() * 90;
    g.fillStyle = `rgb(${shade},${shade - 3},${shade - 8})`;
    g.fillRect(Math.random() * 256, Math.random() * 64, 1 + Math.random() * 2.2, 1 + Math.random() * 1.6);
  }
  const left = 256 * 0.14, width = 256 * 0.72; // Schwelle 2.6 m von 3.6 m, 0.26 m von 0.6 m
  g.fillStyle = "#5e5b57";
  g.fillRect(left, 64 * 0.3, width, 64 * 0.4);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(left, 64 * 0.3, width, 2);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(left, 64 * 0.7 - 2, width, 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Band mit Texturkoordinaten: u quer (0..1), v = Laufmeter / Schwellenabstand. */
function bedGeometry(lines, terrain) {
  const positions = [], uvs = [], indices = [];
  for (const flat of lines) {
    const samples = walk(flat, 3);
    if (samples.length < 2) continue;
    const base = positions.length / 3;
    samples.forEach((s) => {
      for (const side of [1, -1]) {
        const x = s.x - s.tz * (BED_WIDTH / 2) * side, z = s.z + s.tx * (BED_WIDTH / 2) * side;
        positions.push(x, (terrain.heightAt(x, z) ?? 0) + BED_LIFT, z);
        uvs.push(side === 1 ? 0 : 1, s.d / SLEEPER_PITCH);
      }
    });
    for (let i = 0; i < samples.length - 1; i++) { const a = base + i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function offsetLines(lines, offset) {
  return lines.map((flat) => walk(flat, 3).flatMap((s) => [s.x - s.tz * offset, s.z + s.tx * offset]));
}

/** `lines`: Gleis-Polylinien [x0, z0, …]. Rückgabe: Gruppe mit Bett, Schienen und `rails` (nur in der Nähe sichtbar). */
export function buildTrack(lines, terrain) {
  const group = new THREE.Group();
  group.name = "track";
  const bed = new THREE.Mesh(bedGeometry(lines, terrain), new THREE.MeshStandardMaterial({
    map: bedTexture(), roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  bed.renderOrder = 3;
  bed.receiveShadow = true;
  const rails = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb4b8be, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  for (const side of [1, -1]) {
    const mesh = new THREE.Mesh(buildRibbons(offsetLines(lines, (GAUGE / 2) * side), { width: RAIL_WIDTH, lift: RAIL_LIFT, terrain, step: 3 }), steel);
    mesh.renderOrder = 4;
    mesh.receiveShadow = true;
    rails.add(mesh);
  }
  group.add(bed, rails);
  group.userData.rails = rails;
  return group;
}
