// Points of Interest (OSM) und Ortsnamen: Marker, Beschriftungen, Auswahl.
import * as THREE from "three";
import { loadOptionalJson } from "./api.js";
import { createLabelLayer } from "./labels.js";

export const POI_COLORS = {
  "Einkauf": "#e08a2c", "Gastronomie": "#c0392b", "Tourismus": "#8e44ad", "Freizeit und Kultur": "#16a085", "Religion": "#7f8c8d",
  "Verkehr": "#2980b9", "Verwaltung und Dienste": "#34495e", "Gesundheit": "#e84393", "Bildung": "#d4ac0d", "Historisch": "#a0522d", "Sonstiges": "#95a5a6",
};

const SUBTYPES = {
  restaurant: "Restaurant", cafe: "Café", bar: "Bar", pub: "Pub", fast_food: "Imbiss", ice_cream: "Glacé", hotel: "Hotel", guest_house: "Gästehaus",
  hostel: "Herberge", camp_site: "Campingplatz", museum: "Museum", attraction: "Sehenswürdigkeit", viewpoint: "Aussichtspunkt", gallery: "Galerie",
  artwork: "Kunstwerk", information: "Information", place_of_worship: "Gotteshaus", school: "Schule", kindergarten: "Kindergarten", pharmacy: "Apotheke",
  doctors: "Arztpraxis", dentist: "Zahnarzt", post_office: "Post", bank: "Bank", townhall: "Gemeindehaus", ferry_terminal: "Schiffstation",
  supermarket: "Supermarkt", bakery: "Bäckerei", kiosk: "Kiosk", clothes: "Bekleidung", convenience: "Laden", hairdresser: "Coiffeur",
  playground: "Spielplatz", pitch: "Sportplatz", sports_centre: "Sportzentrum", swimming_pool: "Schwimmbad", marina: "Hafen", slipway: "Slip", park: "Park",
  monument: "Denkmal", memorial: "Gedenkstätte", castle: "Schloss", ruins: "Ruine", wayside_cross: "Wegkreuz", wayside_shrine: "Bildstock",
};
export const subtypeLabel = (value) => SUBTYPES[value] ?? value.replaceAll("_", " ");

export async function initPois(ctx) {
  const { scene3d, terrain, layers, $ } = ctx;
  const [poiFile, placeFile] = await Promise.all([loadOptionalJson("pois.json"), loadOptionalJson("places.json")]);
  const pois = poiFile?.pois ?? [];
  const places = placeFile?.places ?? [];
  ctx.pois = pois;
  ctx.places = places;

  const group = new THREE.Group();
  group.name = "pois";
  let mesh = null;
  const pinHeight = 14;
  const positions = pois.map((poi) => new THREE.Vector3(poi.x, (terrain.heightAt(poi.x, poi.z) ?? 0) + pinHeight / 2, poi.z));
  if (pois.length) {
    const geometry = new THREE.ConeGeometry(1.6, pinHeight, 8).rotateX(Math.PI);
    mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), pois.length);
    const matrix = new THREE.Matrix4(), scaleVector = new THREE.Vector3(), baseY = pois.map((poi) => terrain.heightAt(poi.x, poi.z) ?? 0);
    ctx.poiScale = 1;
    const placePins = (scale) => {
      scaleVector.set(scale, scale, scale);
      pois.forEach((poi, i) => {
        matrix.compose(new THREE.Vector3(poi.x, baseY[i] + pinHeight * scale / 2, poi.z), new THREE.Quaternion(), scaleVector);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    pois.forEach((poi, i) => mesh.setColorAt(i, new THREE.Color(POI_COLORS[poi.c] ?? "#95a5a6")));
    placePins(1);
    // Pins schrumpfen beim Heranzoomen, damit sie Gebäude nicht verdecken.
    scene3d.onFrame((_, now, distance) => {
      const wanted = THREE.MathUtils.clamp(distance / 500, 0.25, 1);
      if (Math.abs(wanted - ctx.poiScale) > 0.06) { ctx.poiScale = wanted; placePins(wanted); }
    });
    mesh.castShadow = true;
    group.add(mesh);
  }

  const labels = createLabelLayer({ container: $("#labels"), camera: scene3d.camera, canvas: $("#scene"), terrain });
  const placeItems = places.map((place) => ({
    x: place.x, z: place.z, text: place.n, lift: 40,
    className: place.k === "village" || place.k === "town" ? "big" : "",
    maxDistance: place.k === "village" || place.k === "town" ? 14000 : place.k === "hamlet" || place.k === "peak" ? 5000 : 1800,
  }));
  const poiItems = pois.map((poi) => ({ x: poi.x, z: poi.z, text: poi.n, lift: pinHeight + 3, maxDistance: 450 }));
  let labelsOn = true;
  let last = 0;
  scene3d.onFrame((_, now) => {
    if (now - last < 120) return;
    last = now;
    if (!labelsOn) { labels.clear(); return; }
    labels.render([...placeItems, ...(group.visible ? poiItems : [])], { limit: 34 });
  });

  layers.add({
    id: "pois", label: "Points of Interest", color: "#c0392b", available: pois.length > 0, note: "pois.json fehlt", count: pois.length ? String(pois.length) : "",
    visible: true, apply: (v) => { group.visible = v; if (v && !group.parent) scene3d.scene.add(group); },
  });
  layers.add({ id: "labels", label: "Ortsnamen", color: "#444444", available: places.length > 0, note: "places.json fehlt", visible: true, apply: (v) => { labelsOn = v; } });

  if (mesh) {
    const closest = new THREE.Vector3();
    ctx.providers.push({
      kind: "poi",
      enabled: () => group.visible,
      pick(ray) {
        let best = null;
        for (let i = 0; i < positions.length; i++) {
          const alongRay = ray.direction.dot(closest.copy(positions[i]).sub(ray.origin));
          if (alongRay < 0) continue;
          const tolerance = Math.max(4, alongRay * 0.012);
          if (ray.distanceSqToPoint(positions[i]) < tolerance * tolerance && (!best || alongRay < best.distance)) {
            best = { index: i, distance: alongRay, point: positions[i].clone() };
          }
        }
        return best;
      },
    });
  }

  ctx.showPoi = (index) => {
    const poi = pois[index];
    const extras = poi.t ?? {};
    const rows = [["Kategorie", poi.c], ["Art", subtypeLabel(poi.s)]];
    if (extras.address) rows.push(["Adresse", extras.address]);
    if (extras.opening_hours) rows.push(["Öffnungszeiten", extras.opening_hours]);
    if (extras.cuisine) rows.push(["Küche", extras.cuisine.replaceAll(";", ", ")]);
    if (extras.wheelchair) rows.push(["Rollstuhlgängig", { yes: "ja", no: "nein", limited: "eingeschränkt" }[extras.wheelchair] ?? extras.wheelchair]);
    const links = /^https?:\/\//.test(extras.website ?? "") ? [{ label: "Website", href: extras.website }] : [];
    ctx.inspector.render({ title: poi.n, sub: `${subtypeLabel(poi.s)} · Point of Interest`, sections: [rows], links, source: "OpenStreetMap-Mitwirkende (ODbL)" });
  };
}
