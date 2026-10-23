import * as THREE from "three";
import { figureMaterial, pedestrianGeometry } from "./vehicles.js";

const TARGET_EGID = 190196936;
const TARGET_ADDRESS = "Mettlenweg 1, 6440 Brunnen";
const SIGN_TEXT = "Finnova Elite Offsite Headquarter";

function nearestRoadPoint(roads, name, x, z) {
  let nearest = null;
  for (const road of roads) {
    if (road.n !== name) continue;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x0 = road.p[i], z0 = road.p[i + 1], dx = road.p[i + 2] - x0, dz = road.p[i + 3] - z0;
      const t = THREE.MathUtils.clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const point = { x: x0 + dx * t, z: z0 + dz * t };
      const distance = Math.hypot(x - point.x, z - point.z);
      if (!nearest || distance < nearest.distance) nearest = { ...point, distance };
    }
  }
  return nearest;
}

function wallDepthAt(buildings, index, nx, nz, u, y) {
  const { table, positions, surfaces, faces } = buildings.data;
  const stride = 6, vertexStart = table[index * stride], faceStart = table[index * stride + 4], faceCount = table[index * stride + 5];
  let depth = -Infinity, vertex = vertexStart;
  for (let face = faceStart; face < faceStart + faceCount; face++) {
    const size = faces[face];
    if (surfaces[vertex] === 0 && size >= 3) {
      for (let triangle = 1; triangle < size - 1; triangle++) {
        const points = [0, triangle, triangle + 1].map((offset) => {
          const start = (vertex + offset) * 3;
          return [positions[start], positions[start + 1], positions[start + 2]];
        });
        const [a, b, c] = points;
        const ab = b.map((value, axis) => value - a[axis]), ac = c.map((value, axis) => value - a[axis]);
        const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const normalLength = Math.hypot(...normal) || 1;
        const facing = (normal[0] * nx + normal[2] * nz) / normalLength;
        if (Math.abs(normal[1] / normalLength) > 0.15 || facing < 0.7) continue;
        const projected = points.map((point) => [point[0] * nz - point[2] * nx, point[1]]);
        const [[u0, y0], [u1, y1], [u2, y2]] = projected;
        const denominator = (y1 - y2) * (u0 - u2) + (u2 - u1) * (y0 - y2);
        if (Math.abs(denominator) < 1e-9) continue;
        const w0 = ((y1 - y2) * (u - u2) + (u2 - u1) * (y - y2)) / denominator;
        const w1 = ((y2 - y0) * (u - u2) + (u0 - u2) * (y - y2)) / denominator;
        const w2 = 1 - w0 - w1;
        if (Math.min(w0, w1, w2) < -0.02) continue;
        depth = Math.max(depth, points.reduce((sum, point, i) => sum + [w0, w1, w2][i] * (point[0] * nx + point[2] * nz), 0));
      }
    }
    vertex += size;
  }
  return depth;
}

function findStreetFacingWall(buildings, index, toward) {
  const { table, positions, surfaces, faces } = buildings.data;
  const stride = 6, vertexStart = table[index * stride], faceStart = table[index * stride + 4], faceCount = table[index * stride + 5];
  const candidates = new Map();
  let vertex = vertexStart;
  for (let face = faceStart; face < faceStart + faceCount; face++) {
    const size = faces[face];
    if (surfaces[vertex] === 0 && size >= 3) {
      const offset = vertex * 3;
      const ax = positions[offset], ay = positions[offset + 1], az = positions[offset + 2];
      const bx = positions[offset + 3], by = positions[offset + 4], bz = positions[offset + 5];
      const cx = positions[offset + 6], cy = positions[offset + 7], cz = positions[offset + 8];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const nx0 = aby * acz - abz * acy, ny0 = abz * acx - abx * acz, nz0 = abx * acy - aby * acx;
      const length = Math.hypot(nx0, ny0, nz0) || 1;
      const nx = nx0 / length, ny = ny0 / length, nz = nz0 / length;
      const facing = nx * toward.x + nz * toward.z;
      if (Math.abs(ny) < 0.15 && facing > 0.7) {
        const plane = (nx * ax + nz * az + nx * bx + nz * bz + nx * cx + nz * cz) / 3;
        const key = `${Math.round(nx * 100)}:${Math.round(nz * 100)}:${Math.round(plane * 5)}`;
        const group = candidates.get(key) ?? { nx, nz, plane: 0, planes: 0, minU: Infinity, maxU: -Infinity, minY: Infinity, maxY: -Infinity, facing };
        group.plane += plane;
        group.planes++;
        for (let i = 0; i < size; i++) {
          const x = positions[(vertex + i) * 3], y = positions[(vertex + i) * 3 + 1], z = positions[(vertex + i) * 3 + 2];
          const u = x * nz - z * nx;
          group.minU = Math.min(group.minU, u);
          group.maxU = Math.max(group.maxU, u);
          group.minY = Math.min(group.minY, y);
          group.maxY = Math.max(group.maxY, y);
        }
        candidates.set(key, group);
      }
    }
    vertex += size;
  }
  const wall = [...candidates.values()]
    .filter((candidate) => candidate.maxU - candidate.minU >= 6 && candidate.maxY - candidate.minY >= 6)
    .sort((a, b) => (b.maxU - b.minU) * (b.maxY - b.minY) * b.facing - (a.maxU - a.minU) * (a.maxY - a.minY) * a.facing)[0];
  if (!wall) return null;
  const u = (wall.minU + wall.maxU) / 2;
  const y = wall.minY + (wall.maxY - wall.minY) * 0.72;
  const averagePlane = wall.plane / wall.planes;
  const plane = wallDepthAt(buildings, index, wall.nx, wall.nz, u, y);
  const depth = (Number.isFinite(plane) ? plane : averagePlane) + 0.35;
  return {
    x: wall.nx * (depth + 0.12) + wall.nz * u,
    y,
    z: wall.nz * (depth + 0.12) - wall.nx * u,
    nx: wall.nx,
    nz: wall.nz,
    width: Math.min(7.2, (wall.maxU - wall.minU) * 0.55),
  };
}

function signTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(35, 47, 52, 0.9)";
  context.beginPath();
  context.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 16);
  context.fill();
  context.strokeStyle = "rgba(236, 223, 190, 0.9)";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#fff8e8";
  context.font = "600 88px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(SIGN_TEXT, canvas.width / 2, canvas.height / 2, canvas.width - 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function addMettlenwegSign(ctx) {
  const index = ctx.records.findIndex((record) => record.egid === TARGET_EGID);
  const address = ctx.addresses.find(([label]) => label === TARGET_ADDRESS);
  if (index < 0 || !address || !ctx.buildings?.mesh || !ctx.roads?.length) return null;

  const addressPoint = ctx.frame.toLocal(address[1], address[2]);
  const roadPoint = nearestRoadPoint(ctx.roads, "Mettlenweg", addressPoint.x, addressPoint.z);
  if (!roadPoint) return null;
  let dx = roadPoint.x - addressPoint.x, dz = roadPoint.z - addressPoint.z;
  let length = Math.hypot(dx, dz);
  if (length < 1) {
    const center = ctx.buildings.center(index);
    dx = roadPoint.x - center.x;
    dz = roadPoint.z - center.z;
    length = Math.hypot(dx, dz) || 1;
  }
  const wall = findStreetFacingWall(ctx.buildings, index, { x: dx / length, z: dz / length });
  if (!wall) return null;

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(wall.width, 1.15),
    new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, depthTest: false, depthWrite: false, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
  );
  sign.name = "mettlenweg-1-easter-egg";
  sign.position.set(wall.x, wall.y, wall.z);
  sign.rotation.y = Math.atan2(wall.nx, wall.nz);
  sign.renderOrder = 4;
  sign.frustumCulled = false;
  ctx.buildings.mesh.add(sign);
  return sign;
}

const GERSAUER_ADDRESS = "Gersauerstrasse 83.2, 6440 Brunnen";
const GROUP_IMAGE = "public/images/gersauerstrasse-83-2-original.png";

function lakeDirection(areas, x, z) {
  const ring = areas?.find((area) => area.k === "lake")?.rings?.[0];
  if (!ring?.length) return { x: -Math.SQRT1_2, z: Math.SQRT1_2 };
  let nearest = { distance: Infinity, x, z };
  for (let i = 0; i + 3 < ring.length; i += 2) {
    const x0 = ring[i], z0 = ring[i + 1], dx = ring[i + 2] - x0, dz = ring[i + 3] - z0;
    const t = THREE.MathUtils.clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = x0 + dx * t, pz = z0 + dz * t, distance = Math.hypot(px - x, pz - z);
    if (distance < nearest.distance) nearest = { distance, x: px, z: pz };
  }
  const length = Math.hypot(nearest.x - x, nearest.z - z) || 1;
  return { x: (nearest.x - x) / length, z: (nearest.z - z) / length };
}

function photoOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "gersauer-photo-overlay";
  overlay.className = "easter-photo-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Originalfoto des Finnova Offsite");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "easter-photo-close";
  closeButton.setAttribute("aria-label", "Foto schliessen");
  closeButton.textContent = "Schliessen";
  const image = document.createElement("img");
  image.alt = "Finnova-Team beim Offsite in Brunnen";
  image.hidden = true;
  const missing = document.createElement("p");
  missing.className = "easter-photo-missing";
  missing.hidden = true;
  missing.textContent = `Originalbild fehlt. Datei erwartet: ${GROUP_IMAGE}`;
  image.addEventListener("error", () => { image.hidden = true; missing.hidden = false; });
  const close = () => { overlay.hidden = true; image.removeAttribute("src"); };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) close(); });
  overlay.append(closeButton, image, missing);
  document.body.append(overlay);

  return () => {
    image.hidden = false;
    missing.hidden = true;
    overlay.hidden = false;
    image.src = GROUP_IMAGE;
    closeButton.focus();
  };
}

export function addGersauerPeople(ctx) {
  const address = ctx.addresses.find(([label]) => label === GERSAUER_ADDRESS);
  const addressPoint = address && ctx.frame.toLocal(address[1], address[2]);
  const recordIndex = address?.[3] ?? -1;
  if (!addressPoint || !ctx.buildings?.data || !ctx.ambient?.group || !ctx.providers || !ctx.clickHandlers) return null;

  const direction = lakeDirection(ctx.waterData?.areas, addressPoint.x, addressPoint.z);
  const center = ctx.buildings.center(recordIndex);
  const { positions, table } = ctx.buildings.data;
  const start = table[recordIndex * 6], count = table[recordIndex * 6 + 1];
  let frontExtent = 0;
  for (let vertex = start; vertex < start + count; vertex++) {
    const x = positions[vertex * 3], z = positions[vertex * 3 + 2];
    frontExtent = Math.max(frontExtent, (x - center.x) * direction.x + (z - center.z) * direction.z);
  }

  const groupCenter = frontExtent + 3.5;
  const side = { x: -direction.z, z: direction.x };
  const geometry = pedestrianGeometry(5);
  const material = figureMaterial({ pantsColor: "#08090b" });
  const figures = new THREE.InstancedMesh(geometry, material, 5);
  figures.name = "gersauer-83-2-people";
  figures.castShadow = true;
  figures.receiveShadow = true;
  figures.frustumCulled = false;

  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const rotation = Math.atan2(direction.x, direction.z);
  quaternion.setFromAxisAngle(up, rotation);
  for (let i = 0; i < 5; i++) {
    const across = (i - 2) * 1.05;
    const x = center.x + direction.x * groupCenter + side.x * across;
    const z = center.z + direction.z * groupCenter + side.z * across;
    const y = (ctx.terrain.heightAt(x, z) ?? center.y) + 0.34;
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(1.04, 1.04, 1.04));
    figures.setMatrixAt(i, matrix);
    figures.setColorAt(i, new THREE.Color("#fff"));
  }
  figures.instanceMatrix.needsUpdate = true;
  if (figures.instanceColor) figures.instanceColor.needsUpdate = true;
  geometry.getAttribute("aPhase").needsUpdate = true;
  ctx.ambient.group.add(figures);

  const raycaster = new THREE.Raycaster();
  ctx.providers.push({
    kind: "gersauer-people",
    enabled: () => ctx.ambient.group.visible && figures.visible,
    pick(ray) {
      raycaster.ray.copy(ray);
      const hit = raycaster.intersectObject(figures, false)[0];
      return hit ? { distance: hit.distance, point: hit.point.clone() } : null;
    },
  });
  const openPhoto = photoOverlay();
  ctx.clickHandlers.push(({ hit }) => {
    if (hit?.kind !== "gersauer-people") return false;
    openPhoto();
    return true;
  });
  return figures;
}