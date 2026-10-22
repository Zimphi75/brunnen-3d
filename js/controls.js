// Kamerasteuerung (Voreinstellungen, Flug) und Zeigerinteraktion (Hover, Auswahl).
import * as THREE from "three";

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCameraRig({ camera, controls, terrain, onFrame }) {
  let animation = null;
  const spherical = new THREE.Spherical();

  function place(target, distance, heading, tilt) {
    // heading: Blickrichtung in Radiant ab Nord im Uhrzeigersinn; tilt: Winkel von der Senkrechten
    const offset = new THREE.Vector3().setFromSphericalCoords(distance, tilt, 0);
    const horizontal = new THREE.Vector2(offset.x, offset.z).length();
    // Kamera steht entgegen der Blickrichtung: Nord = -z, Ost = +x
    const back = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading));
    return new THREE.Vector3(target.x + back.x * horizontal, target.y + offset.y, target.z + back.z * horizontal);
  }

  function targetOnTerrain(target) {
    const ground = terrain.heightAt(target.x, target.z);
    const result = target.clone();
    if (ground !== null && (target.y === undefined || target.y < ground)) result.y = ground;
    return result;
  }

  function flyTo({ target, distance, heading = 0, tilt = THREE.MathUtils.degToRad(55), duration = 1.4, instant = false, onComplete }) {
    const to = targetOnTerrain(target);
    const destination = place(to, distance, heading, tilt);
    if (instant) {
      animation = null;
      camera.position.copy(destination);
      controls.target.copy(to);
      controls.update();
      onComplete?.();
      return;
    }
    animation = {
      t: 0, duration,
      fromPosition: camera.position.clone(), toPosition: destination,
      fromTarget: controls.target.clone(), toTarget: to, onComplete,
    };
  }

  onFrame((delta) => {
    const current = animation;
    if (!current) return;
    current.t = Math.min(1, current.t + delta / current.duration);
    const k = ease(current.t);
    camera.position.lerpVectors(current.fromPosition, current.toPosition, k);
    controls.target.lerpVectors(current.fromTarget, current.toTarget, k);
    if (current.t >= 1) {
      animation = null;
      current.onComplete?.();
    }
  });
  controls.addEventListener("start", () => { animation = null; });

  function currentView() {
    spherical.setFromVector3(camera.position.clone().sub(controls.target));
    const toTarget = controls.target.clone().sub(camera.position);
    return { distance: spherical.radius, tilt: spherical.phi, heading: Math.atan2(toTarget.x, -toTarget.z) };
  }

  return {
    flyTo,
    currentView,
    rotate(degrees) { const v = currentView(); flyTo({ target: controls.target.clone(), distance: v.distance, heading: v.heading + THREE.MathUtils.degToRad(degrees), tilt: v.tilt, duration: 0.45 }); },
    topDown() { const v = currentView(); flyTo({ target: controls.target.clone(), distance: v.distance, heading: v.heading, tilt: THREE.MathUtils.degToRad(1), duration: 0.9 }); },
    oblique() { const v = currentView(); flyTo({ target: controls.target.clone(), distance: v.distance, heading: v.heading, tilt: THREE.MathUtils.degToRad(58), duration: 0.9 }); },
    stop() { animation = null; },
  };
}

/**
 * Zeigerinteraktion. Provider liefern bei Strahlen-Tests {distance, ...}; der nächste gewinnt,
 * das Gelände dient als Rückfall für Koordinaten und Höhe.
 */
export function createPicker({ canvas, camera, terrain, providers, onHover, onClick }) {
  const ray = new THREE.Ray();
  const ndc = new THREE.Vector3();
  let pending = null;
  let down = null;

  function rayFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1, 0.5).unproject(camera);
    ray.origin.copy(camera.position);
    ray.direction.copy(ndc.sub(camera.position).normalize());
    return ray;
  }

  function pickAt(event) {
    const currentRay = rayFromEvent(event);
    let best = null;
    for (const provider of providers) {
      if (!provider.enabled()) continue;
      const hit = provider.pick(currentRay);
      if (hit && (!best || hit.distance < best.distance)) best = { ...hit, kind: provider.kind };
    }
    const ground = terrain.raycast(currentRay);
    if (best && ground && ground.distanceTo(currentRay.origin) < best.distance - 1) best = null; // vom Gelände verdeckt
    return { hit: best, ground, ray: currentRay };
  }

  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons) return;
    pending = event;
    requestAnimationFrame(() => {
      if (!pending) return;
      const result = pickAt(pending);
      pending = null;
      onHover(result, event);
    });
  });
  canvas.addEventListener("pointerleave", () => onHover({ hit: null, ground: null }, null));
  canvas.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY, time: performance.now() }; });
  canvas.addEventListener("pointerup", (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const quick = performance.now() - down.time < 500;
    down = null;
    if (moved < 5 && quick && event.button === 0) onClick(pickAt(event), event);
  });
}
