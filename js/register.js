// Registergebäude ohne 3D-Modell (GWR): nur Registerdaten und Koordinate, Form schematisch. Standardmässig ausgeblendet.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";

export async function initRegister(ctx) {
  const { scene3d, terrain, frame, layers } = ctx;
  const data = await loadOptionalJson("gwr_unmatched.json");
  const items = (data?.buildings ?? []).filter((b) => b.inMunicipality);
  ctx.registerOnly = items;

  const group = new THREE.Group();
  group.name = "register-only";
  const boxes = [];
  if (items.length) {
    const material = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.55, roughness: 0.8, depthWrite: false });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, items.length);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    items.forEach((item, i) => {
      const p = frame.toLocal(item.e, item.n);
      const side = THREE.MathUtils.clamp(Math.sqrt(item.gwr.footprintAreaGwr ?? 16), 3, 30);
      const height = THREE.MathUtils.clamp((item.gwr.floors ?? 1) * 2.9, 2.5, 20);
      const ground = terrain.heightAt(p.x, p.z) ?? 0;
      matrix.compose(new THREE.Vector3(p.x, ground + height / 2, p.z), quaternion, new THREE.Vector3(side, height, side));
      mesh.setMatrixAt(i, matrix);
      const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(p.x, ground + height / 2, p.z), new THREE.Vector3(side, height, side));
      boxes.push(box);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
    scene3d.aoExcluded.add(group);
  }

  const hit = new THREE.Vector3();
  ctx.providers.push({
    kind: "register", enabled: () => group.visible && group.parent !== null,
    pick(ray) {
      let best = null;
      boxes.forEach((box, index) => {
        if (ray.intersectBox(box, hit)) {
          const distance = ray.origin.distanceTo(hit);
          if (!best || distance < best.distance) best = { index, distance, point: hit.clone() };
        }
      });
      return best;
    },
  });

  ctx.showRegisterOnly = (index) => {
    const item = items[index];
    const gwr = item.gwr, codes = ctx.codes;
    const label = (group, code) => (code ? codes[group]?.[code] ?? `Code ${code}` : null);
    const row = (key, value) => [key, value ?? "nicht erfasst"];
    ctx.inspector.render({
      title: item.address ?? `Gebäude EGID ${item.egid}`,
      sub: "Registergebäude ohne 3D-Modell",
      tags: [{ text: "Kein 3D-Modell: Lage aus GWR-Koordinate, Form schematisch", warn: true }],
      sections: [[
        row("Gebäudeklasse", label("GKLAS", gwr.class)), row("Kategorie", label("GKAT", gwr.category)),
        row("Baujahr", gwr.yearBuilt ?? label("GBAUP", gwr.periodBuilt)), row("Geschosse", gwr.floors), row("Grundfläche GWR (m²)", gwr.footprintAreaGwr),
        ["EGID", item.egid],
      ]],
      source: "BFS GWR (Gebäude- und Wohnungsregister). swissBUILDINGS3D enthält dieses Gebäude nicht, meist weil es ein Kleinbau ist.",
    });
  };

  layers.add({
    id: "register", label: "Register ohne 3D-Modell", color: "#9fb4c4", visible: false, available: items.length > 0, note: "gwr_unmatched.json fehlt",
    count: items.length ? String(items.length) : "",
    apply: (v) => { group.visible = v; if (v && !group.parent) scene3d.scene.add(group); },
  });
}
