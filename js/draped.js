// Auf das Gelände projizierte Bänder und Flächen (Strassen, Bäche, Linien, Wasser, Grenze).
import * as THREE from "three";

/** Polylinien [x0, z0, x1, z1, ...] -> Bandgeometrie, Höhe je Eckpunkt aus dem Gelände. */
export function buildRibbons(polylines, { width, lift, terrain, step = 8, widths = null }) {
  const positions = [];
  const indices = [];
  polylines.forEach((flat, lineIndex) => {
    const points = resample(flat, step);
    if (points.length < 2) return;
    const lineWidth = widths ? widths[lineIndex] : width;
    const base = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      let tx = next[0] - prev[0], tz = next[1] - prev[1];
      const length = Math.hypot(tx, tz) || 1;
      tx /= length; tz /= length;
      const nx = -tz * lineWidth / 2, nz = tx * lineWidth / 2;
      for (const side of [1, -1]) {
        const x = points[i][0] + nx * side, z = points[i][1] + nz * side;
        positions.push(x, (terrain.heightAt(x, z) ?? points[i][2] ?? 0) + lift, z);
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function resample(flat, step) {
  const out = [];
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x0 = flat[i], z0 = flat[i + 1], x1 = flat[i + 2], z1 = flat[i + 3];
    const count = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < count; k++) out.push([x0 + ((x1 - x0) * k) / count, z0 + ((z1 - z0) * k) / count]);
  }
  out.push([flat[flat.length - 2], flat[flat.length - 1]]);
  return out;
}

/** Polygon mit Löchern (Ringe als flache Listen) -> triangulierte Fläche. Höhe: konstant oder aus dem Gelände. */
export function buildPolygonMesh(polygons, { terrain, lift = 0.1, level = null }) {
  const positions = [];
  const indices = [];
  for (const rings of polygons) {
    const vectors = rings.map((flat) => {
      const ring = [];
      for (let i = 0; i < flat.length; i += 2) ring.push(new THREE.Vector2(flat[i], flat[i + 1]));
      if (ring.length > 1 && ring[0].equals(ring[ring.length - 1])) ring.pop();
      return ring;
    });
    const [outer, ...holes] = vectors;
    if (outer.length < 3) continue;
    const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
    const base = positions.length / 3;
    for (const point of [outer, ...holes].flat()) {
      positions.push(point.x, level ?? (terrain.heightAt(point.x, point.y) ?? 0) + lift, point.y);
    }
    for (const [a, b, c] of triangles) indices.push(base + a, base + c, base + b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Senkrechter, nach oben ausblendender Vorhang entlang von Ringen (Gemeindegrenze). */
export function buildCurtain(rings, { terrain, height, color }) {
  const positions = [];
  const alphas = [];
  const indices = [];
  for (const flat of rings) {
    const points = resample(flat, 25);
    const base = positions.length / 3;
    for (const [x, z] of points) {
      const ground = terrain.heightAt(x, z) ?? 0;
      positions.push(x, ground - 5, z, x, ground + height, z);
      alphas.push(0.22, 0);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) } },
    vertexShader: "attribute float alpha; varying float vAlpha; void main(){ vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 color; varying float vAlpha; void main(){ gl_FragColor = vec4(color, vAlpha); }",
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  return new THREE.Mesh(geometry, material);
}
