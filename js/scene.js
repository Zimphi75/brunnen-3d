// Renderer, Kamera, Navigation und Nachbearbeitung (Ambient Occlusion, Bloom).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { hardenTouchPointers } from "./controls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export function createScene(canvas, { lowPower = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    throw new Error(`WebGL ist nicht verfügbar (${error.message}). Bitte einen aktuellen Browser mit Hardwarebeschleunigung verwenden.`);
  }
  // Desktop höchstens 1.5: volle Retina-Auflösung (2×) mit AO und Bloom drückt die Bildrate auf etwa 18 fps.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.25 : 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8abce3);

  const camera = new THREE.PerspectiveCamera(50, 1, 2, 40000);
  camera.position.set(0, 3000, 4000);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 15;
  controls.maxDistance = 16000;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = false;
  // Kartenbedienung: Ziehen verschiebt, rechte Taste oder Umschalt/Strg dreht, Rad zoomt; Pfeiltasten verschieben.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.keyPanSpeed = 22;
  controls.listenToKeyEvents(canvas);
  // Trackpad-Pinch kommt als Wheel-Event mit ctrlKey und sehr kleinen Deltas; ohne Verst\u00e4rkung zoomt es kaum.
  canvas.addEventListener("wheel", (event) => { controls.zoomSpeed = event.ctrlKey ? 14 : 1; }, { capture: true });
  // Safari liefert Pinch nur als gesture-Events; in Wheel-Deltas umrechnen.
  let gestureScale = 1;
  canvas.addEventListener("gesturestart", (event) => { gestureScale = event.scale; });
  canvas.addEventListener("gesturechange", (event) => {
    const deltaY = (gestureScale - event.scale) * 1000;
    gestureScale = event.scale;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, clientX: event.clientX, clientY: event.clientY, bubbles: true, cancelable: true }));
  });
  const touchPointers = hardenTouchPointers(canvas); // nach OrbitControls registrieren
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  let aoPass = null;
  try {
    aoPass = new GTAOPass(scene, camera, 1, 1);
    aoPass.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 4, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    aoPass.blendIntensity = 0.9;
    composer.addPass(aoPass);
  } catch (error) {
    console.warn("Ambient Occlusion nicht verfügbar:", error);
  }
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.9);
  bloomPass.enabled = false;
  composer.addPass(bloomPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  /**
   * Shader der Nachbearbeitung (AO, Bloom, Ausgabe) sind nicht Teil der Szene und würden erst beim ersten Bild
   * synchron kompiliert (zusammen rund 4 s auf einem Mac). Für compileAsync als Vollbild-Quads in Hilfsszenen,
   * je mit dem Renderziel, in das der Pass später zeichnet (Zwischenpuffer oder Bildschirm).
   */
  function postProcessingScenes() {
    const quad = (material) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); mesh.frustumCulled = false; return mesh; };
    const offscreen = new THREE.Scene(), screen = new THREE.Scene();
    for (const pass of composer.passes) {
      const materials = new Set();
      for (const value of Object.values(pass)) {
        if (value?.isMaterial) materials.add(value);
        else if (Array.isArray(value)) value.forEach((item) => { if (item?.isMaterial) materials.add(item); });
        else if (value?.material?.isMaterial) materials.add(value.material);
      }
      materials.forEach((material) => (pass === outputPass ? screen : offscreen).add(quad(material)));
    }
    return [{ scene: offscreen, target: composer.readBuffer }, { scene: screen, target: null }];
  }

  const settings = { ambientOcclusion: true, bloom: false };
  // Transparente Überlagerungen (Wasser, Grenzvorhang, Regen, Markierungen) dürfen die AO-Tiefe nicht verfälschen.
  const aoExcluded = new Set();
  if (aoPass) {
    const originalRender = aoPass.render.bind(aoPass);
    aoPass.render = (...args) => {
      const hidden = [...aoExcluded].filter((object) => object.visible);
      hidden.forEach((object) => { object.visible = false; });
      originalRender(...args);
      hidden.forEach((object) => { object.visible = true; });
    };
  }
  const frameCallbacks = new Set();
  const frameStats = new Map();
  let panBounds = null;
  let groundAt = null;
  const GROUND_CLEARANCE = 3;   // Kamera mindestens so hoch über dem Gelände (m)
  const GROUND_PROBE = 4;       // Gelände rund um die Kamera mitprüfen, damit die Nahebene nicht in Hänge schneidet
  /** Hält Blickpunkt und Kamera über dem Gelände: kein Zoomen oder Schwenken unter den Boden. */
  function keepAboveGround() {
    if (!groundAt) return;
    const t = controls.target, p = camera.position;
    const below = groundAt(t.x, t.z);
    if (below !== null && t.y < below) { const dy = below - t.y; t.y += dy; p.y += dy; }
    let ground = -Infinity;
    for (const [dx, dz] of [[0, 0], [GROUND_PROBE, 0], [-GROUND_PROBE, 0], [0, GROUND_PROBE], [0, -GROUND_PROBE]]) {
      const h = groundAt(p.x + dx, p.z + dz);
      if (h !== null && h > ground) ground = h;
    }
    if (ground > -Infinity && p.y < ground + GROUND_CLEARANCE) p.y = ground + GROUND_CLEARANCE;
  }
  let lastFrame = performance.now();
  let fps = 60;
  let frameInfo = { calls: 0, triangles: 0 };
  let renderingPaused = false;
  let suspended = false; // z. B. während das Intro-Video läuft

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function frame(now) {
    const delta = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    fps += (1 / Math.max(delta, 1e-3) - fps) * 0.05;
    controls.update();
    if (panBounds) {
      const t = controls.target;
      const dx = Math.min(panBounds.maxX, Math.max(panBounds.minX, t.x)) - t.x;
      const dz = Math.min(panBounds.maxZ, Math.max(panBounds.minZ, t.z)) - t.z;
      if (dx || dz) { t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
    }
    keepAboveGround();
    // Nahebene folgt dem Abstand zum Blickpunkt: hält die Tiefenauflösung hoch.
    const distance = camera.position.distanceTo(controls.target);
    const near = THREE.MathUtils.clamp(distance / 150, 0.5, 60);
    if (Math.abs(near - camera.near) > near * 0.1) { camera.near = near; camera.updateProjectionMatrix(); }
    for (const callback of frameCallbacks) {
      const started = performance.now();
      try { callback(delta, now, distance); }
      catch (error) {
        console.error("3D-Frame-Callback entfernt:", error);
        frameCallbacks.delete(callback);
      }
      const spent = performance.now() - started;
      const stat = frameStats.get(callback);
      if (stat) { stat.total += spent; stat.calls++; if (spent > stat.max) stat.max = spent; }
    }
    if (aoPass) aoPass.enabled = settings.ambientOcclusion;
    bloomPass.enabled = settings.bloom;
    // Während des Ladens nicht rendern: Sonst kompiliert jedes neu hinzugefügte Objekt seine Shader synchron
    // im nächsten Frame und blockiert den Browser. Die Shader werden stattdessen per compileAsync vorbereitet.
    if (!renderingPaused && !suspended) {
      renderer.info.reset();
      composer.render(delta);
      frameInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    renderer, scene, camera, controls, composer, settings, aoExcluded, postProcessingScenes, touchPointers,
    hasAmbientOcclusion: Boolean(aoPass),
    set panBounds(value) { panBounds = value; },
    set groundAt(fn) { groundAt = fn; },
    /** Auflösungsfaktor begrenzen (z. B. 1.25 im leichten Modus) und Puffer neu anlegen. */
    setMaxPixelRatio(max) { renderer.setPixelRatio(Math.min(window.devicePixelRatio, max)); resize(); },
    get renderingPaused() { return renderingPaused; },
    set renderingPaused(value) { renderingPaused = Boolean(value); },
    get suspended() { return suspended; },
    set suspended(value) { suspended = Boolean(value); },
    onFrame(callback) {
      // Herkunft (Datei:Zeile) für die Leistungsmessung merken, siehe frameStats()
      const origin = (new Error().stack ?? "").split("\n").map((line) => line.match(/\/js\/([\w-]+\.js)[^:]*:(\d+)/)).filter(Boolean)[1];
      frameStats.set(callback, { origin: origin ? `${origin[1]}:${origin[2]}` : "?", total: 0, calls: 0, max: 0 });
      frameCallbacks.add(callback);
      return () => { frameCallbacks.delete(callback); frameStats.delete(callback); };
    },
    /** Rechenzeit je Bild-Callback (Konsole: brunnen.scene3d.frameStats()); reset=true setzt die Zähler zurück. */
    frameStats(reset = false) {
      const rows = [...frameStats.values()].map((stat) => ({ origin: stat.origin, avgMs: +(stat.total / Math.max(1, stat.calls)).toFixed(2), maxMs: +stat.max.toFixed(1), calls: stat.calls }));
      if (reset) for (const stat of frameStats.values()) { stat.total = 0; stat.calls = 0; stat.max = 0; }
      return rows.sort((a, b) => b.maxMs - a.maxMs);
    },
    get fps() { return fps; },
    renderInfo: () => ({ ...frameInfo, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}
