// Velo mit Fahrer, gelbem Anhänger und Hund (Australian Shepherd) für den Velomodus.
// Gebaut aus Quadern, Zylindern und Ringen wie models.js; vorwärts = +z, Fahrer schaut nach +z.
// Bewegliche Teile: Räder, Kurbel und Beine, Lenker, Anhänger an der Deichsel, Hundekopf, Fahne.
import * as THREE from "three";

const mats = new Map();

/** Erzeugt das Modell. `update(dt, { speed, steer, yawRate, pitch, trailerDy, trailerPitch })` bewegt die Teile; `speed` in m/s. */
export function createBikeModel() {
  // ---------- Bausteine (wie models.js: Quader, Zylinder, Ring) ----------

  const mat = (hex, opts = {}) => {
    const key = hex + JSON.stringify(opts);
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75, metalness: 0.05, flatShading: true, ...opts }));
    return mats.get(key);
  };
  const mesh = (geo, hex, opts) => { const m = new THREE.Mesh(geo, mat(hex, opts)); m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, hex, x = 0, y = 0, z = 0, opts) => { const m = mesh(new THREE.BoxGeometry(w, h, d), hex, opts); m.position.set(x, y, z); return m; };
  const UP = new THREE.Vector3(0, 1, 0);
  /** Rohr von a nach b (Zylinder). */
  const tube = (a, b, r, hex, seg = 8) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
    const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), hex);
    m.position.copy(A).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
  };
  const setTube = (m, A, B) => {
    const dir = B.clone().sub(A), len = dir.length();
    m.position.copy(A).addScaledVector(dir, 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
  };
  const unitTube = (r, hex, seg = 8) => mesh(new THREE.CylinderGeometry(r, r, 1, seg), hex);

  /** Rad in der y-z-Ebene; die Gruppe dreht sich um x. */
  function wheel(radius, tyre, rimHex) {
    const g = new THREE.Group();
    const t = mesh(new THREE.TorusGeometry(radius, tyre, 8, 28), 0x1b1c1e); t.rotation.y = Math.PI / 2; g.add(t);
    const rim = mesh(new THREE.TorusGeometry(radius - tyre * 1.2, tyre * 0.35, 6, 28), rimHex, { metalness: 0.6, roughness: 0.35 }); rim.rotation.y = Math.PI / 2; g.add(rim);
    const hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10), 0x9aa0a6, { metalness: 0.6 }); hub.rotation.z = Math.PI / 2; g.add(hub);
    for (let i = 0; i < 8; i++) {
      const s = box(0.006, (radius - tyre) * 2, 0.006, 0xc8ccd0, 0, 0, 0, { metalness: 0.7, roughness: 0.3 });
      s.rotation.x = (i / 8) * Math.PI; g.add(s);
    }
    return g;
  }

  // ---------- Velo ----------
  // Vorwärts = +z, Fahrer schaut nach +z. Kamera "von hinten" steht bei -z.
  const FRAME = 0x5f6b34, DARK = 0x2a2d31;
  const rig = new THREE.Group(); rig.name = "velo";
  const bike = new THREE.Group(); rig.add(bike);
  const BB = [0, 0.32, -0.08], SEAT = [0, 0.85, -0.27], HEAD_T = [0, 0.87, 0.36], HEAD_B = [0, 0.73, 0.42], REAR = [0, 0.37, -0.53], FRONT = [0, 0.37, 0.58];
  bike.add(tube(BB, SEAT, 0.022, FRAME), tube(SEAT, HEAD_T, 0.02, FRAME), tube(BB, HEAD_B, 0.026, FRAME), tube(HEAD_B, HEAD_T, 0.028, FRAME));
  for (const x of [-0.055, 0.055]) {
    bike.add(tube([x * 0.5, BB[1], BB[2]], [x, REAR[1], REAR[2]], 0.012, FRAME));
    bike.add(tube([x * 0.3, SEAT[1] - 0.04, SEAT[2]], [x, REAR[1], REAR[2]], 0.011, FRAME));
  }
  // Gabel + Vorderrad drehen beim Lenken als Gruppe
  const steer = new THREE.Group(); steer.position.set(...HEAD_T); bike.add(steer);
  const rel = (p) => [p[0] - HEAD_T[0], p[1] - HEAD_T[1], p[2] - HEAD_T[2]];
  for (const x of [-0.05, 0.05]) steer.add(tube(rel([x * 0.4, HEAD_B[1], HEAD_B[2]]), rel([x, FRONT[1], FRONT[2]]), 0.012, FRAME));
  steer.add(tube(rel(HEAD_T), rel([0, 0.95, 0.32]), 0.016, DARK));
  steer.add(tube(rel([-0.38, 0.95, 0.3]), rel([0.38, 0.95, 0.3]), 0.014, DARK)); // breiter Lenker, 76 cm
  for (const s of [-1, 1]) steer.add(tube(rel([s * 0.29, 0.95, 0.3]), rel([s * 0.385, 0.95, 0.3]), 0.02, 0x111214)); // Griffe
  const frontWheel = wheel(0.33, 0.04, 0x9aa0a6); frontWheel.position.set(...rel(FRONT)); steer.add(frontWheel); // dicke Pneus
  const rearWheel = wheel(0.33, 0.04, 0x9aa0a6); rearWheel.position.set(...REAR); bike.add(rearWheel);
  // Schutzbleche, Sattel, Sattelstütze, Rücklicht
  bike.add(tube(SEAT, [0, 0.93, -0.3], 0.014, 0x9aa0a6));
  bike.add(box(0.14, 0.05, 0.26, 0x151618, 0, 0.955, -0.29));
  const fender = mesh(new THREE.TorusGeometry(0.4, 0.014, 4, 20, Math.PI * 0.75), DARK); fender.rotation.y = Math.PI / 2; fender.rotation.x = Math.PI * 0.2; fender.position.set(...REAR); bike.add(fender);
  bike.add(box(0.04, 0.03, 0.04, 0x2a2d31, 0, 0.86, -0.36), box(0.05, 0.03, 0.02, 0xd22b2b, 0, 0.86, -0.39, { emissive: 0x7a0f0f }));
  // Kurbel
  const crank = new THREE.Group(); crank.position.set(...BB); bike.add(crank);
  const chainring = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 20), 0x6e747a, { metalness: 0.6 }); chainring.rotation.z = Math.PI / 2; chainring.position.x = 0.06; crank.add(chainring);
  const CRANK = 0.17;
  const crankArmR = box(0.015, CRANK, 0.025, 0x6e747a, 0.08, -CRANK / 2, 0); crank.add(crankArmR);
  const crankArmL = box(0.015, CRANK, 0.025, 0x6e747a, -0.08, CRANK / 2, 0); crank.add(crankArmL);
  const pedalR = box(0.09, 0.02, 0.07, 0x1b1c1e); const pedalL = box(0.09, 0.02, 0.07, 0x1b1c1e); bike.add(pedalR, pedalL);

  // ---------- Fahrer ----------
  const SKIN = 0xd9a383, JERSEY = 0x2c4f8c, SHORTS = 0x1c1f24, SHOE = 0x3b3f45;
  const rider = new THREE.Group(); bike.add(rider);
  const hip = new THREE.Vector3(0, 1.0, -0.27), shoulder = new THREE.Vector3(0, 1.43, 0.05);
  const torso = unitTube(0.17, JERSEY, 8); torso.scale.set(1, 1, 0.6); rider.add(torso);
  setTube(torso, hip, shoulder); torso.scale.x = 1.15; torso.scale.z = 0.7;
  rider.add(box(0.3, 0.1, 0.2, SHORTS, 0, 0.99, -0.25));
  const neck = tube([0, 1.47, 0.08], [0, 1.53, 0.13], 0.05, SKIN); rider.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.6, 0.16); rider.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), SKIN));
  const HAIR = 0x5a3920, CAP = 0xcbb68f;
  // braune Haare: Hinterkopf und Seiten unter der Cap
  const hair = mesh(new THREE.SphereGeometry(0.106, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), HAIR); hair.rotation.x = -0.5; hair.position.set(0, 0.0, -0.012); head.add(hair);
  head.add(box(0.15, 0.05, 0.05, HAIR, 0, -0.06, -0.075));
  // beige Baseballcap mit Schild nach vorne
  const cap = mesh(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), CAP); cap.scale.set(1, 0.85, 1.05); cap.position.set(0, 0.03, 0); head.add(cap);
  const brim = box(0.17, 0.012, 0.11, CAP, 0, 0.03, 0.13); brim.rotation.x = 0.12; head.add(brim);
  head.add(box(0.04, 0.03, 0.012, 0xb19d76, 0, 0.035, -0.105)); // Verschluss hinten
  const capButton = mesh(new THREE.SphereGeometry(0.012, 6, 4), 0xb19d76); capButton.position.set(0, 0.12, 0); head.add(capButton);
  // Oakley-Sportbrille: durchgehendes Glas mit Iridium-Verspiegelung, schwarze Bügel bis zu den Ohren
  const lens = mesh(new THREE.CylinderGeometry(0.108, 0.108, 0.045, 16, 1, true, -1.15, 2.3), 0x2b4a8c, { metalness: 0.8, roughness: 0.15, side: THREE.DoubleSide, emissive: 0x0a1630 });
  lens.position.set(0, 0.0, 0.0); head.add(lens);
  head.add(box(0.2, 0.012, 0.012, 0x111214, 0, 0.024, 0.098));
  for (const s of [-1, 1]) { const arm = box(0.01, 0.012, 0.12, 0x111214, s * 0.104, 0.012, 0.0); arm.rotation.y = s * 0.1; head.add(arm); }
  // Arme
  for (const s of [-1, 1]) {
    const sh = new THREE.Vector3(0.19 * s, 1.41, 0.04), el = new THREE.Vector3(0.29 * s, 1.17, 0.17), gr = new THREE.Vector3(0.34 * s, 0.97, 0.3);
    const up = unitTube(0.045, JERSEY); setTube(up, sh, el); rider.add(up);
    const lo = unitTube(0.035, SKIN); setTube(lo, el, gr); rider.add(lo);
    rider.add(box(0.06, 0.05, 0.08, 0x1d1f22, gr.x, gr.y, gr.z));
  }
  // Beine (zweigliedrig, Fuss auf dem Pedal)
  const THIGH = 0.46, SHIN = 0.47;
  const legs = [-1, 1].map((s) => {
    const thigh = unitTube(0.062, SHORTS), shin = unitTube(0.045, SKIN), shoe = box(0.09, 0.07, 0.2, SHOE);
    rider.add(thigh, shin, shoe);
    return { s, thigh, shin, shoe };
  });
  const tmp = new THREE.Vector3();
  function poseLegs(angle) {
    const bb = new THREE.Vector3(...BB);
    const pedalPos = (phase) => new THREE.Vector3(0, -Math.cos(phase) * CRANK, -Math.sin(phase) * CRANK).add(bb); // vorwärts treten: oben nach vorne, unten nach hinten
    const pr = pedalPos(angle), pl = pedalPos(angle + Math.PI);
    pr.x = 0.12; pl.x = -0.12;
    pedalR.position.copy(pr); pedalL.position.copy(pl);
    for (const leg of legs) {
      const foot = (leg.s > 0 ? pr : pl).clone(); foot.y += 0.04;
      const h = new THREE.Vector3(0.1 * leg.s, hip.y - 0.02, hip.z);
      // 2D-IK in der y-z-Ebene, Knie nach vorne
      const dy = foot.y - h.y, dz = foot.z - h.z, d = Math.min(THIGH + SHIN - 0.001, Math.hypot(dy, dz));
      const a = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
      const base = Math.atan2(dz, dy);
      const knee = new THREE.Vector3(h.x * 0.9 + foot.x * 0.1, h.y + Math.cos(base - a) * THIGH, h.z + Math.sin(base - a) * THIGH);
      if (knee.z < h.z) { const b2 = base + a; knee.y = h.y + Math.cos(b2) * THIGH; knee.z = h.z + Math.sin(b2) * THIGH; }
      setTube(leg.thigh, h, knee); setTube(leg.shin, knee, foot);
      leg.shoe.position.copy(foot).add(tmp.set(0, -0.005, 0.03));
    }
    crank.rotation.x = angle;
  }

  // ---------- Anhänger (gelb) ----------
  const YELLOW = 0xffc61a, YELLOW_DARK = 0xe8ad10, CAGE = 0x3a3f45, MESH = 0x23272b;
  const trailer = new THREE.Group(); trailer.position.set(0, 0, -1.62); rig.add(trailer);
  // Hinweis: Dach offen, damit der Hund hinausschaut; vorne und an den Seiten Netzfenster
  const TW = 0.66, TL = 0.86, TB = 0.12, TH = 0.58;
  trailer.add(box(TW, 0.05, TL, YELLOW_DARK, 0, TB + 0.025, 0));                        // Boden
  for (const s of [-1, 1]) trailer.add(box(0.03, TH, TL, YELLOW, s * (TW / 2 - 0.015), TB + TH / 2, 0)); // Seitenwände
  trailer.add(box(TW, 0.32, 0.03, YELLOW, 0, TB + 0.16, TL / 2 - 0.015));               // Front unten
  trailer.add(box(TW, 0.26, 0.03, YELLOW, 0, TB + 0.13, -TL / 2 + 0.015));              // Heck unten
  trailer.add(box(TW - 0.06, TH - 0.26, 0.01, MESH, 0, TB + 0.26 + (TH - 0.26) / 2, -TL / 2 + 0.02, { transparent: true, opacity: 0.22, roughness: 0.9 })); // Netz hinten
  const meshMat = { transparent: true, opacity: 0.38, roughness: 0.9 };
  trailer.add(box(TW - 0.06, TH - 0.32, 0.01, MESH, 0, TB + 0.32 + (TH - 0.32) / 2, TL / 2 - 0.02, meshMat)); // Netz vorne
  for (const s of [-1, 1]) trailer.add(box(0.012, 0.2, TL - 0.2, MESH, s * (TW / 2 + 0.001), TB + 0.42, 0, meshMat)); // Seitenfenster
  // Überrollbügel (offenes Dach, damit der Hund hinausschaut)
  for (const z of [TL / 2 - 0.03, -TL / 2 + 0.03]) {
    trailer.add(tube([-TW / 2, TB + TH, z], [TW / 2, TB + TH, z], 0.016, CAGE));
  }
  for (const s of [-1, 1]) trailer.add(tube([s * TW / 2, TB + TH, -TL / 2 + 0.03], [s * TW / 2, TB + TH, TL / 2 - 0.03], 0.016, CAGE));
  // Räder aussen, mit Achse und Speichenschutz
  const tWheels = [-1, 1].map((s) => {
    const w = wheel(0.22, 0.03, 0x8d939a); w.position.set(s * (TW / 2 + 0.08), 0.22, -0.05); trailer.add(w);
    trailer.add(tube([s * (TW / 2), 0.22, -0.05], [s * (TW / 2 + 0.08), 0.22, -0.05], 0.012, CAGE));
    return w;
  });
  // Reflektoren und Rücklicht
  for (const s of [-1, 1]) trailer.add(box(0.07, 0.07, 0.01, 0xd22b2b, s * 0.22, TB + 0.16, -TL / 2 - 0.005, { emissive: 0x5a0a0a }));
  trailer.add(box(0.22, 0.05, 0.01, 0xd8dde2, 0, TB + 0.06, -TL / 2 - 0.005, { metalness: 0.3 }));
  // Deichsel zur linken Hinterachse
  const hitchBike = new THREE.Vector3(-0.07, 0.37, -0.53);
  const drawbar = unitTube(0.018, CAGE); rig.add(drawbar);
  const hitchCup = box(0.05, 0.05, 0.06, 0x111214); rig.add(hitchCup);
  // Fahne
  const pole = tube([-TW / 2 + 0.02, TB + TH, -TL / 2 + 0.05], [-TW / 2 + 0.02, 1.75, -TL / 2 + 0.05], 0.006, 0xe6e6e6); trailer.add(pole);
  // Rechteckige Fahne mit Logo (Bote der Urschweiz); Vorder- und Rückseite teilen die Form, die Rückseite
  // hat gespiegelte Texturkoordinaten, damit das Logo von beiden Seiten lesbar ist.
  const FLAG_L = 0.42, FLAG_H = 0.13, FLAG_SEG = 14;
  const flagGeo = new THREE.PlaneGeometry(FLAG_L, FLAG_H, FLAG_SEG, 1);
  flagGeo.translate(FLAG_L / 2, -FLAG_H / 2, 0);
  const flagPos = flagGeo.attributes.position.array;
  const flagRest = Float32Array.from(flagPos);               // x = Abstand vom Mast, y = Höhe
  const flagBackGeo = new THREE.BufferGeometry();
  flagBackGeo.setIndex(flagGeo.index);
  flagBackGeo.setAttribute("position", flagGeo.attributes.position);
  const uvBack = Float32Array.from(flagGeo.attributes.uv.array);
  for (let i = 0; i < uvBack.length; i += 2) uvBack[i] = 1 - uvBack[i];
  flagBackGeo.setAttribute("uv", new THREE.BufferAttribute(uvBack, 2));
  flagBackGeo.setAttribute("normal", flagGeo.attributes.normal);
  const flagTex = new THREE.TextureLoader().load("public/images/flag-bdu.png");
  flagTex.colorSpace = THREE.SRGBColorSpace; flagTex.anisotropy = 4;
  const flagMat = (side) => new THREE.MeshStandardMaterial({ map: flagTex, side, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveMap: flagTex, emissiveIntensity: 0.12 });
  const flag = new THREE.Group(); flag.position.set(-TW / 2 + 0.02, 1.75, -TL / 2 + 0.05); trailer.add(flag);
  for (const [geo, side] of [[flagGeo, THREE.FrontSide], [flagBackGeo, THREE.BackSide]]) {
    const m = new THREE.Mesh(geo, flagMat(side)); m.castShadow = true; flag.add(m);
  }

  // ---------- Hund: Australian Shepherd, braun mit weiss (red tri) ----------
  const FUR = 0x6b3a1f, FUR_DARK = 0x4e2914, WHITE = 0xf3efe6, COPPER = 0xb8662e, NOSE = 0x161210;
  const DOG_SCALE = 1.2;
  const dog = new THREE.Group(); dog.position.set(0, TB + 0.05, 0.04); dog.scale.setScalar(DOG_SCALE); trailer.add(dog);
  const dbox = (w, h, d, hex, x, y, z, rx = 0, parent = dog) => { const b = box(w, h, d, hex, x, y, z); b.rotation.x = rx; parent.add(b); return b; };
  dbox(0.3, 0.17, 0.32, FUR, 0, 0.09, -0.08);               // Hinterteil sitzend
  for (const s of [-1, 1]) dbox(0.08, 0.15, 0.2, FUR_DARK, s * 0.13, 0.08, -0.04);   // Oberschenkel
  dbox(0.24, 0.34, 0.2, FUR, 0, 0.32, 0.02, -0.28);         // Rumpf aufrecht
  dbox(0.2, 0.26, 0.06, WHITE, 0, 0.3, 0.12, -0.28);        // weisse Brust
  for (const s of [-1, 1]) {
    dbox(0.06, 0.24, 0.06, COPPER, s * 0.07, 0.12, 0.13);   // Vorderbeine kupfer
    dbox(0.065, 0.05, 0.09, WHITE, s * 0.07, 0.02, 0.16);   // weisse Pfoten
  }
  const ruff = mesh(new THREE.TorusGeometry(0.1, 0.045, 6, 12), WHITE); ruff.rotation.x = Math.PI / 2 - 0.3; ruff.position.set(0, 0.47, 0.06); dog.add(ruff); // weisser Kragen
  dbox(0.08, 0.05, 0.12, FUR, 0, 0.06, -0.26, 0.5);         // Stummelrute
  const dogHead = new THREE.Group(); dogHead.position.set(0, 0.56, 0.07); dog.add(dogHead);
  dbox(0.19, 0.16, 0.19, FUR, 0, 0.04, 0, 0, dogHead);      // Schädel
  dbox(0.045, 0.165, 0.1, WHITE, 0, 0.045, 0.052, 0, dogHead); // weisse Blesse (nur vorne)
  dbox(0.12, 0.09, 0.13, WHITE, 0, -0.005, 0.14, 0, dogHead);  // Schnauze
  dbox(0.05, 0.035, 0.03, NOSE, 0, 0.03, 0.21, 0, dogHead);    // Nase
  dbox(0.04, 0.012, 0.05, 0xd96b7a, 0, -0.05, 0.17, 0.3, dogHead); // Zunge
  for (const s of [-1, 1]) {
    dbox(0.04, 0.04, 0.03, COPPER, s * 0.065, 0.0, 0.1, 0, dogHead);   // kupferne Wangen
    dbox(0.03, 0.03, 0.01, NOSE, s * 0.055, 0.07, 0.096, 0, dogHead);  // Augen
    dbox(0.012, 0.012, 0.004, COPPER, s * 0.055, 0.1, 0.096, 0, dogHead); // Augenbrauenpunkt
    const ear = dbox(0.07, 0.09, 0.025, FUR_DARK, s * 0.09, 0.14, -0.02, 0, dogHead);  // Kippohren
    ear.rotation.z = -s * 0.5; ear.rotation.x = 0.35;
  }

  rig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const hitchTrailer = new THREE.Vector3(), trailerRest = new THREE.Vector3(0, 0, -1.62).sub(hitchBike);
  hitchTrailer.y = 0;
  let dist = 0, pedal = 0.6, time = 0, trailerAngle = 0;
  const HITCH_TO_AXLE = 1.15;

  function update(dt, { speed = 0, steer: steerAngle = 0, yawRate = 0, pitch = 0, trailerDy = 0, trailerPitch = 0 } = {}) {
    time += dt;
    dist += speed * dt;
    // vorwärts treten: Kurbel dreht im Sinn der Räder; im Leerlauf und rückwärts stehen die Pedale
    if (speed > 0.05) pedal += (speed / 0.37) * dt * 0.42;
    frontWheel.rotation.x = rearWheel.rotation.x = dist / 0.37;
    tWheels.forEach((w) => (w.rotation.x = dist / 0.25));
    poseLegs(pedal);
    const k = Math.min(1, Math.abs(speed) / 4);
    bike.rotation.x = pitch;
    bike.rotation.z = -steerAngle * Math.min(1, Math.abs(speed) / 6) * 0.35 + Math.sin(time * 1.3) * 0.012 * k;
    steer.rotation.y = steerAngle;
    rider.position.y = Math.abs(Math.sin(pedal)) * 0.008 * k;
    // Anhänger dreht um die Kupplung und folgt der Fahrtrichtung mit Verzögerung
    trailerAngle += (-yawRate - (speed / HITCH_TO_AXLE) * Math.sin(trailerAngle)) * dt;
    trailerAngle = THREE.MathUtils.clamp(trailerAngle, -1.1, 1.1);
    trailer.position.copy(trailerRest).applyAxisAngle(UP, trailerAngle).add(hitchBike);
    trailer.position.y = trailerDy;
    trailer.rotation.set(trailerPitch, trailerAngle, 0, "YXZ");
    trailer.updateMatrix();
    hitchTrailer.set(-0.28, 0.3, TL / 2 + 0.02).applyMatrix4(trailer.matrix);
    setTube(drawbar, hitchBike.clone().add(tmp.set(0, 0, -0.03)), hitchTrailer);
    hitchCup.position.copy(hitchBike);
    // Hund schaut sich um, Kopf wippt beim Fahren
    dogHead.rotation.y = Math.sin(time * 0.45) * 0.95 + Math.sin(time * 1.7) * 0.08;
    dogHead.rotation.x = Math.sin(time * 3.1) * 0.03 * k;
    dog.position.y = TB + 0.05 + DOG_SCALE * Math.abs(Math.sin(time * 6)) * 0.006 * k;
    // Fahne weht nach hinten und flattert, stärker mit Tempo (Welle läuft vom Mast zum freien Ende)
    flag.rotation.y = 0.55 + 0.85 * k + Math.sin(time * 1.9) * 0.12 * (1 - 0.5 * k);
    const amp = 0.012 + 0.03 * Math.min(1.5, Math.abs(speed) / 4);
    for (let i = 0; i < flagPos.length; i += 3) {
      const s = flagRest[i] / FLAG_L;
      flagPos[i + 2] = Math.sin(time * 9 - s * 7) * amp * s - 0.01 * s * s;
    }
    flagGeo.attributes.position.needsUpdate = true;
    flagGeo.computeVertexNormals();
  }
  update(0);
  return { group: rig, update, reset() { trailerAngle = 0; } };
}
