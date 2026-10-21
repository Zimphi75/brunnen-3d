// Fussgängerstreifen: weisse Balken quer über die Fahrbahn an markierten Übergängen aus OSM (crossing=zebra/marked).
import * as THREE from "three";

const STRIPE = 0.5, GAP = 0.5, LENGTH = 3.2, LIFT = 0.35;

/** `crossings`: [x, z, Strassenwinkel, Fahrbahnbreite, Art]. Die Balken liegen längs der Fahrtrichtung nebeneinander. */
export function buildCrosswalks(crossings, terrain, material) {
  const positions = [];
  for (const [x, z, angle, width] of crossings) {
    const tx = Math.cos(angle), tz = Math.sin(angle), nx = -tz, nz = tx;
    const count = Math.max(3, Math.floor((width - 0.6) / (STRIPE + GAP)));
    const start = -((count - 1) * (STRIPE + GAP)) / 2;
    for (let i = 0; i < count; i++) {
      const centre = start + i * (STRIPE + GAP);
      const corner = (along, across) => { const px = x + tx * along + nx * across, pz = z + tz * along + nz * across; return [px, (terrain.heightAt(px, pz) ?? 0) + LIFT, pz]; };
      const a = corner(-LENGTH / 2, centre - STRIPE / 2), b = corner(LENGTH / 2, centre - STRIPE / 2), c = corner(LENGTH / 2, centre + STRIPE / 2), d = corner(-LENGTH / 2, centre + STRIPE / 2);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "crosswalks";
  mesh.renderOrder = 4;
  mesh.receiveShadow = true;
  return mesh;
}
