// Renderer, Kamera, Navigation und Nachbearbeitung (Ambient Occlusion, Bloom).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.25 : 2));
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
  composer.addPass(new OutputPass());

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
  let panBounds = null;
  let lastFrame = performance.now();
  let fps = 60;
  let frameInfo = { calls: 0, triangles: 0 };
  let renderingPaused = false;

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
    // Nahebene folgt dem Abstand zum Blickpunkt: hält die Tiefenauflösung hoch.
    const distance = camera.position.distanceTo(controls.target);
    const near = THREE.MathUtils.clamp(distance / 150, 0.5, 60);
    if (Math.abs(near - camera.near) > near * 0.1) { camera.near = near; camera.updateProjectionMatrix(); }
    for (const callback of frameCallbacks) {
      try { callback(delta, now, distance); }
      catch (error) {
        console.error("3D-Frame-Callback entfernt:", error);
        frameCallbacks.delete(callback);
      }
    }
    if (aoPass) aoPass.enabled = settings.ambientOcclusion;
    bloomPass.enabled = settings.bloom;
    // Während des Ladens nicht rendern: Sonst kompiliert jedes neu hinzugefügte Objekt seine Shader synchron
    // im nächsten Frame und blockiert den Browser. Die Shader werden stattdessen per compileAsync vorbereitet.
    if (!renderingPaused) {
      renderer.info.reset();
      composer.render(delta);
      frameInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    renderer, scene, camera, controls, composer, settings, aoExcluded,
    hasAmbientOcclusion: Boolean(aoPass),
    set panBounds(value) { panBounds = value; },
    get renderingPaused() { return renderingPaused; },
    set renderingPaused(value) { renderingPaused = Boolean(value); },
    onFrame(callback) { frameCallbacks.add(callback); return () => frameCallbacks.delete(callback); },
    get fps() { return fps; },
    renderInfo: () => ({ ...frameInfo, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}
