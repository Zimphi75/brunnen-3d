// Nachtbeleuchtung: Strassenlaternen (Masten, leuchtende Köpfe, Lichtflecken auf dem Boden, wenige echte Lichtquellen),
// beleuchtete Fenster (über den Gebäude-Shader) und automatischer Leuchteffekt bei Dunkelheit.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";
import { model, MODEL_MATERIAL } from "./models.js";
import { roadsidePosition } from "./roadmarks.js";

const POOL_SIZE = 8;
const WARM = new THREE.Color(1.0, 0.78, 0.45);

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export async function initLighting(ctx) {
  const { scene3d, terrain, sky, layers, buildings } = ctx;
  const data = await loadOptionalJson("lamps.json");
  const lamps = data?.lamps ?? [];
  const group = new THREE.Group();
  group.name = "street-lamps";
  const lights = [];
  const heads = [];
  const state = { bloom: true, lampsOn: true, night: 0 };

  if (lamps.length) {
    const poles = new THREE.InstancedMesh(model("streetLampPole"), MODEL_MATERIAL, lamps.length);
    const headMaterial = new THREE.MeshBasicMaterial({ color: WARM.clone(), toneMapped: false });
    const headMesh = new THREE.InstancedMesh(model("streetLampHead"), headMaterial, lamps.length);
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: WARM.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: false,
    });
    const glowGeometry = new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2);
    const glow = new THREE.InstancedMesh(glowGeometry, glowMaterial, lamps.length);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    lamps.forEach(([x, z], i) => {
      const roadside = roadsidePosition(x, z, ctx.roads, ctx.roadIndex, 40);
      const road = ctx.roadIndex?.nearest(roadside.x, roadside.z, 40);
      const heading = road ? Math.atan2(road.x - roadside.x, road.z - roadside.z) : 0;
      const ground = terrain.heightAt(roadside.x, roadside.z) ?? 0;
      quaternion.setFromAxisAngle(up, heading);
      matrix.compose(new THREE.Vector3(roadside.x, ground, roadside.z), quaternion, one);
      poles.setMatrixAt(i, matrix);
      headMesh.setMatrixAt(i, matrix);
      const reach = Math.min(road ? Math.hypot(road.x - roadside.x, road.z - roadside.z) : 3, 4);
      matrix.compose(new THREE.Vector3(roadside.x + Math.sin(heading) * reach, ground + 0.3, roadside.z + Math.cos(heading) * reach), new THREE.Quaternion(), one);
      glow.setMatrixAt(i, matrix);
      heads.push(new THREE.Vector3(roadside.x + Math.sin(heading) * 1.25, ground + 6.05, roadside.z + Math.cos(heading) * 1.25));
    });
    for (const mesh of [poles, headMesh, glow]) { mesh.computeBoundingSphere(); mesh.frustumCulled = false; }
    poles.castShadow = true;
    glow.renderOrder = 9;
    group.add(poles, headMesh, glow);
    scene3d.scene.add(group);
    scene3d.aoExcluded.add(glow);
    state.parts = { headMaterial, glowMaterial };

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffc27a, 0, 42, 2);
      light.visible = false;
      scene3d.scene.add(light);
      lights.push(light);
    }
  }

  let lastPool = 0;
  scene3d.onFrame((_, now) => {
    const night = sky.state.night;
    state.night = night;
    buildings?.setNight(night);
    scene3d.settings.bloom = state.bloom && night > 0.3;
    if (!state.parts) return;
    const on = state.lampsOn;
    group.visible = on;
    state.parts.headMaterial.color.copy(WARM).multiplyScalar(0.25 + 3.4 * night);
    state.parts.glowMaterial.opacity = on ? 0.62 * night : 0;
    if (now - lastPool < 400) return;
    lastPool = now;
    const target = scene3d.controls.target;
    const near = heads.map((p, i) => [p.distanceToSquared(target), i]).sort((a, b) => a[0] - b[0]).slice(0, POOL_SIZE);
    lights.forEach((light, k) => {
      const entry = near[k];
      light.visible = on && night > 0.02 && Boolean(entry) && entry[0] < 260 * 260;
      if (!entry) return;
      light.position.copy(heads[entry[1]]);
      light.intensity = 110 * night;
    });
  });

  const real = lamps.filter((l) => l[2] === 0).length;
  layers.add({
    id: "lamps", label: "Strassenlaternen", color: "#f0c060", available: lamps.length > 0, note: "lamps.json fehlt",
    count: lamps.length ? `${real} OSM + ${lamps.length - real} mod.` : "", apply: (v) => { state.lampsOn = v; },
  });
  layers.add({ id: "bloom", label: "Leuchten bei Nacht", color: "#f0c060", visible: true, apply: (v) => { state.bloom = v; } });
  ctx.lighting = state;
}
