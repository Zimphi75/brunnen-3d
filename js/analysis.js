// Messwerkzeuge (Distanz, Punktinformation) und Erweiterungspunkt für weitere Analysen.
import * as THREE from "three";
import { lv95ToWgs84, formatLv95 } from "./geo.js";

const ACCENT = 0xff7a1a;

export function initAnalysis(ctx) {
  const { $, scene3d, terrain, frame } = ctx;
  const toolList = $("#tool-list"), hint = $("#tool-hint");
  const overlay = new THREE.Group();
  overlay.name = "analysis";
  scene3d.scene.add(overlay);
  const tools = new Map();
  let active = null;

  /** Erweiterungspunkt: register({ id, label, hint, onClick({point, hit}), onDeactivate }) */
  function register(tool) {
    tools.set(tool.id, tool);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tool.label;
    button.dataset.tool = tool.id;
    button.addEventListener("click", () => activate(active === tool.id ? null : tool.id));
    toolList.append(button);
  }

  function activate(id) {
    if (active) tools.get(active)?.onDeactivate?.();
    active = id;
    toolList.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tool === id));
    hint.textContent = id ? tools.get(id).hint : "";
    scene3d.renderer.domElement.style.cursor = id ? "crosshair" : "";
    tools.get(id)?.onActivate?.();
  }

  ctx.clickHandlers.unshift(({ hit, ground }) => {
    if (!active) return false;
    const point = hit?.point ?? ground;
    if (!point) return true;
    tools.get(active).onClick({ point, hit });
    return true;
  });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && active) activate(null); });

  const marker = (point, color = ACCENT, size = 3.2) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    mesh.position.copy(point);
    mesh.renderOrder = 20;
    overlay.add(mesh);
    return mesh;
  };

  // --- Strecke messen
  const measure = { points: [], objects: [] };
  const clearMeasure = () => { measure.objects.forEach((o) => { overlay.remove(o); o.geometry?.dispose(); }); measure.objects = []; measure.points = []; };
  function drawMeasure() {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(measure.points.flatMap((p, i) => (i === 0 ? [p] : sampleSegment(measure.points[i - 1], p)))),
      new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }),
    );
    line.renderOrder = 19;
    overlay.add(line);
    measure.objects.push(line);
  }
  function sampleSegment(a, b) {
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / 8));
    const points = [];
    for (let i = 1; i <= count; i++) {
      const p = a.clone().lerp(b, i / count);
      p.y = (terrain.heightAt(p.x, p.z) ?? p.y) + 1;
      points.push(p);
    }
    return points;
  }
  function describeMeasure() {
    // Profil: Geländehöhe entlang der Polylinie in ca. 10-m-Schritten
    const samples = [];
    for (let i = 1; i < measure.points.length; i++) {
      const a = measure.points[i - 1], b = measure.points[i];
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
      for (let k = i === 1 ? 0 : 1; k <= count; k++) {
        const p = a.clone().lerp(b, k / count);
        samples.push({ x: p.x, z: p.z, h: terrain.heightAt(p.x, p.z) ?? p.y });
      }
    }
    let horizontal = 0, surface = 0, up = 0, down = 0;
    for (let i = 1; i < samples.length; i++) {
      const run = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      const rise = samples[i].h - samples[i - 1].h;
      horizontal += run;
      surface += Math.hypot(run, rise);
      if (rise > 0) up += rise; else down -= rise;
    }
    const heights = samples.map((s) => s.h);
    const first = measure.points[0], last = measure.points.at(-1);
    const elevationDiff = frame.elevation(last.y) - frame.elevation(first.y);
    const min = Math.min(...heights), max = Math.max(...heights);
    const svg = heights.length > 1 ? `<svg viewBox="0 0 200 50" width="100%" height="50" aria-label="Höhenprofil"><polyline fill="none" stroke="#ff7a1a" stroke-width="1.5" points="${
      heights.map((h, i) => `${(i / (heights.length - 1)) * 200},${48 - ((h - min) / Math.max(1, max - min)) * 44}`).join(" ")}"/></svg>` : "";
    ctx.inspector.render({
      title: "Distanzmessung",
      sub: `${measure.points.length} Punkte, Klick setzt weitere Punkte`,
      sections: [[
        ["Horizontal", `${horizontal.toFixed(0)} m`], ["Entlang Gelände (ca.)", `${Math.round(surface)} m`],
        ["Höhenunterschied Start/Ende", `${elevationDiff >= 0 ? "+" : ""}${elevationDiff.toFixed(1)} m`], ["Aufstieg / Abstieg", `${up.toFixed(0)} m / ${down.toFixed(0)} m`],
      ], [["Höhenprofil", `${svg}<small class="note">${Math.round(frame.elevation(min))} bis ${Math.round(frame.elevation(max))} m ü. M.</small>`, true]]],
      source: "Höhen: swissALTI3D (5-m-Raster, gemittelt)",
    });
  }
  register({
    id: "measure", label: "Strecke messen", hint: "Punkte im Gelände anklicken. Esc beendet, erneutes Antippen der Taste löscht die Messung.",
    onClick({ point }) { measure.points.push(point.clone()); measure.objects.push(marker(point)); if (measure.points.length > 1) drawMeasure(); describeMeasure(); },
    onDeactivate: clearMeasure, onActivate: clearMeasure,
  });

  // --- Punktinformation
  let pointMarker = null;
  register({
    id: "point", label: "Punkt abfragen", hint: "Klick zeigt Koordinaten und Höhe.",
    onClick({ point }) {
      if (pointMarker) { overlay.remove(pointMarker); pointMarker.geometry.dispose(); }
      pointMarker = marker(point, 0x1f6f8b);
      const { e, n } = frame.toLV95(point.x, point.z);
      const wgs = lv95ToWgs84(e, n);
      const ground = terrain.heightAt(point.x, point.z);
      ctx.inspector.render({
        title: "Punktinformation",
        sub: "Gewählter Punkt im Modell",
        sections: [[
          ["LV95 (E / N)", formatLv95(e, n)], ["WGS84 (Breite, Länge)", `${wgs.lat.toFixed(5)}, ${wgs.lon.toFixed(5)}`],
          ["Höhe Gelände", ground === null ? "ausserhalb" : `${frame.elevation(ground).toFixed(1)} m ü. M.`],
          ["Höhe Punkt", `${frame.elevation(point.y).toFixed(1)} m ü. M.`],
        ]],
        links: [{ label: "map.geo.admin.ch", href: `https://map.geo.admin.ch/#/map?lang=de&center=${Math.round(e)},${Math.round(n)}&z=13&bgLayer=ch.swisstopo.swissimage` }],
        source: "Höhe: swisstopo swissALTI3D (5-m-Raster); Position LV95 (EPSG:2056)",
      });
    },
    onDeactivate() { if (pointMarker) { overlay.remove(pointMarker); pointMarker = null; } },
  });

  ctx.analysis = { register, activate, overlay };
}
