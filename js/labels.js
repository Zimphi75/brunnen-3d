// HTML-Beschriftungen, die an 3D-Positionen haften (nur nahe Punkte, begrenzte Anzahl).
import * as THREE from "three";
import { esc } from "./inspector.js";

export function createLabelLayer({ container, camera, canvas, terrain }) {
  const pool = [];
  const projected = new THREE.Vector3();
  const layersPanel = document.querySelector("#layers-panel");

  function acquire(index) {
    if (!pool[index]) {
      const element = document.createElement("div");
      element.className = "plabel";
      container.append(element);
      pool[index] = element;
    }
    return pool[index];
  }

  /**
   * items: [{ x, z, y?, text, className? }]; zeichnet bis zu `limit` Einträge, nächste zuerst.
   * Verdeckte Punkte werden nicht geprüft; Entfernungsgrenze vermeidet Überfüllung.
   */
  function render(items, { maxDistance = 900, limit = 28 } = {}) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const candidates = [];
    for (const item of items) {
      const y = item.y ?? (terrain.heightAt(item.x, item.z) ?? 0) + (item.lift ?? 6);
      const distance = camera.position.distanceTo(projected.set(item.x, y, item.z));
      if (distance > (item.maxDistance ?? maxDistance)) continue;
      projected.project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) continue;
      candidates.push({ item, distance, sx: (projected.x * 0.5 + 0.5) * width, sy: (-projected.y * 0.5 + 0.5) * height });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const placed = [];
    let used = 0;
    const panelRect = layersPanel && !layersPanel.hidden ? layersPanel.getBoundingClientRect() : null;
    for (const c of candidates) {
      if (used >= limit) break;
      // grobe Kollisionsvermeidung zwischen Beschriftungen
      if (placed.some((p) => Math.abs(p.sx - c.sx) < 70 && Math.abs(p.sy - c.sy) < 14)) continue;
      const element = acquire(used);
      element.hidden = false;
      element.className = `plabel ${c.item.className ?? ""}`;
      if (element.dataset.text !== c.item.text) { element.innerHTML = esc(c.item.text); element.dataset.text = c.item.text; }
      element.style.transform = `translate(${c.sx.toFixed(0)}px, ${c.sy.toFixed(0)}px) translate(-50%, -100%)`;
      if (panelRect) {
        const labelRect = element.getBoundingClientRect();
        if (labelRect.left < panelRect.right && labelRect.right > panelRect.left && labelRect.top < panelRect.bottom && labelRect.bottom > panelRect.top) {
          element.hidden = true;
          continue;
        }
      }
      placed.push(c);
      used++;
    }
    for (let i = used; i < pool.length; i++) pool[i].hidden = true;
  }

  return { render, clear: () => pool.forEach((el) => { el.hidden = true; }) };
}
