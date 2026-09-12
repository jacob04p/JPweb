/* ==========================================================================
   scene.js — procedural high-bypass turbofan, exploded view, drag physics.
   Everything is generated at runtime: NACA airfoil blade profiles with
   root-to-tip twist, 15 spooled stages across two counter-rotating spools,
   annular combustor, painted spinner, CFD-style flow streaks that heat from
   blue-grey intake air to red-orange exhaust, and a shock-diamond plume.
   The engine's longitudinal axis is local +X; explode offsets run fore/aft.
   ========================================================================== */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const TAU = Math.PI * 2;
const ACCENT = 0xff4d00;
const BG = 0x0b0c0e;

/* ---------- Blade airfoil + twist ---------- */

// NACA 4-digit symmetric thickness distribution (closed trailing edge).
function airfoilShape(chord, thick) {
  const yt = (x) =>
    5 * thick *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * chord - 0.45 * chord;
    pts.push([x, yt(i / n) * chord]);
  }
  for (let i = n - 1; i > 0; i--) {
    const x = (i / n) * chord - 0.45 * chord;
    pts.push([x, -yt(i / n) * chord]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  return shape;
}

/* Blade: airfoil profile extruded radially, then twisted about the radial
   axis with linearly-varying angle and chord taper toward the tip. */
function bladeGeometry({ chord, length, thick, twistRoot, twistTip, taper }) {
  const geo = new THREE.ExtrudeGeometry(airfoilShape(chord, thick), {
    depth: length,
    bevelEnabled: false,
    steps: 12,
    curveSegments: 4,
  });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = THREE.MathUtils.clamp(pos.getZ(i) / length, 0, 1);
    const ang = THREE.MathUtils.lerp(twistRoot, twistTip, u);
    const s = THREE.MathUtils.lerp(1, taper, u);
    const c = Math.cos(ang), sn = Math.sin(ang);
    pos.setXYZ(i, (x * c - y * sn) * s, (x * sn + y * c) * s, pos.getZ(i));
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- Explode target bookkeeping ---------- */
class Part {
  constructor(object3d, dir, spin = null) {
    this.obj = object3d;
    this.home = object3d.position.clone();
    this.dir = dir.clone();
    this.spin = spin; // fn(t) -> rotation about engine axis
  }
}

/* ---------- Spinner spiral texture (canvas, no assets) ---------- */
function spinnerTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#ff4d00";
  ctx.lineWidth = 30;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-10, 235);
  ctx.bezierCurveTo(90, 190, 120, 110, 266, 30);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ========================================================================== */

export function initMechanism(canvas, opts = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    console.warn("WebGL unavailable — continuing without the 3D stage.", e);
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(BG, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 46, 135);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
  camera.position.set(0, 4, 47);

  /* ---------- Lights ---------- */
  const key = new THREE.DirectionalLight(0xfff2e2, 2.6);
  key.position.set(18, 26, 30);
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACCENT, 1.8);
  rim.position.set(-26, 8, -22);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8fa3b8, 0.5);
  fill.position.set(-12, -18, 14);
  scene.add(fill);

  /* ---------- Materials ---------- */
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9ba0a8, metalness: 0.95, roughness: 0.3 });
  const fanMat = new THREE.MeshStandardMaterial({ color: 0xb4b9c0, metalness: 0.95, roughness: 0.26 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0.9, roughness: 0.42 });
  const turbMat = new THREE.MeshStandardMaterial({ color: 0x847a6d, metalness: 0.85, roughness: 0.46 });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x3d4046, metalness: 0.9, roughness: 0.5 });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x2e3136, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide,
    emissive: 0xff4d00, emissiveIntensity: 0,
  });

  /* ---------- Assembly ---------- */
  const assembly = new THREE.Group();
  scene.add(assembly);
  const core = new THREE.Group(); // engine local frame; +X = forward
  core.position.set(19, 1, 0); // stations +4.4..-38.3 -> centered, biased right
  assembly.add(core);

  const parts = [];

  // Spool laws: N1 (fan + LP shaft + LP turbine), N2 counter-rotating HP core.
  const N1 = 1.6, N2 = -4.4;
  const spinN1 = (t) => N1 * t;
  const spinN2 = (t) => N2 * t;

  /* ----- Bladed stage builder (disc + instanced twisted blades) ----- */
  function makeStage({ x, hubR, discW, count, geo, mat, spin }) {
    const g = new THREE.Group();
    g.position.x = x;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.02, discW, 36), discMat);
    disc.rotation.z = Math.PI / 2;
    g.add(disc);

    const inst = new THREE.InstancedMesh(geo, mat, count);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(),
          Q = new THREE.Quaternion(), QP = new THREE.Quaternion(),
          S = new THREE.Vector3(1, 1, 1);
    const Z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const radial = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
      Q.setFromUnitVectors(Z, radial);
      QP.setFromAxisAngle(radial, 0.5); // blade stagger about its radial axis
      Q.premultiply(QP);
      P.copy(radial).multiplyScalar(hubR - 0.15);
      M.compose(P, Q, S);
      inst.setMatrixAt(i, M);
    }
    g.add(inst);
    core.add(g);
    parts.push(new Part(g, new THREE.Vector3(), spin));
    return g;
  }

  /* ----- Blade geometries (one per class, instanced per stage) ----- */
  const fanBlade = bladeGeometry({ chord: 2.3, length: 6.6, thick: 0.18, twistRoot: 0.35, twistTip: 1.0, taper: 0.5 });
  const ogvBlade = bladeGeometry({ chord: 1.5, length: 6.0, thick: 0.2, twistRoot: 0.3, twistTip: 0.7, taper: 0.7 });
  const turbBlade = bladeGeometry({ chord: 1.05, length: 2.9, thick: 0.26, twistRoot: 0.55, twistTip: 0.9, taper: 0.65 });
  const lptBlade = bladeGeometry({ chord: 1.15, length: 3.4, thick: 0.26, twistRoot: 0.5, twistTip: 0.85, taper: 0.7 });

  const DX = (x) => new THREE.Vector3(x, 0, 0);

  /* ----- Fan + spinner ----- */
  const spinner = new THREE.Mesh(
    new THREE.ConeGeometry(2.1, 3.4, 40),
    new THREE.MeshStandardMaterial({ map: spinnerTexture(), metalness: 0.55, roughness: 0.42 })
  );
  spinner.rotation.z = -Math.PI / 2; // point +X
  spinner.position.set(2.2, 0, 0);
  core.add(spinner);
  parts.push(new Part(spinner, DX(16), spinN1));

  makeStage({ x: 0, hubR: 2.3, discW: 1.2, count: 20, geo: fanBlade, mat: fanMat, spin: spinN1 });
  parts[parts.length - 1].dir = DX(11);

  /* ----- Outlet guide vanes (static ring right behind the fan) ----- */
  const ogv = new THREE.Group();
  ogv.position.set(-1.8, 0, 0);
  {
    const inst = new THREE.InstancedMesh(ogvBlade, bladeMat, 18);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(),
          Q = new THREE.Quaternion(), QP = new THREE.Quaternion(),
          S = new THREE.Vector3(1, 1, 1);
    const Z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const radial = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
      Q.setFromUnitVectors(Z, radial);
      QP.setFromAxisAngle(radial, -0.4);
      Q.premultiply(QP);
      P.copy(radial).multiplyScalar(2.4);
      M.compose(P, Q, S);
      inst.setMatrixAt(i, M);
    }
    ogv.add(inst);
  }
  core.add(ogv);
  parts.push(new Part(ogv, DX(8.5), null));

  /* ----- Stage maps -----
     Compressor annulus converges like a real gas path: blade tips step
     down and hubs rise slightly every stage, so each row's blades are cut
     to a shorter length with a slimmer chord. LP (N1, 5 stages) then HP
     (N2, 6 stages), explode offsets graduating from forward to aft. */
  const lpc = [
    { x: -4.2, hub: 2.0, tip: 4.85, chord: 0.95, dir: 7.2 },
    { x: -5.7, hub: 2.02, tip: 4.6, chord: 0.9, dir: 5.8 },
    { x: -7.2, hub: 2.04, tip: 4.35, chord: 0.86, dir: 4.4 },
    { x: -8.7, hub: 2.06, tip: 4.12, chord: 0.82, dir: 3.0 },
    { x: -10.2, hub: 2.08, tip: 3.9, chord: 0.78, dir: 1.6 },
  ];
  for (const s of lpc) {
    const geo = bladeGeometry({ chord: s.chord, length: s.tip - s.hub, thick: 0.24, twistRoot: 0.5, twistTip: 0.95, taper: 0.6 });
    makeStage({ x: s.x, hubR: s.hub, discW: 0.55, count: 26, geo, mat: bladeMat, spin: spinN1 });
    parts[parts.length - 1].dir = DX(s.dir);
  }
  const hpc = [
    { x: -12.0, hub: 2.1, tip: 3.75, chord: 0.68, dir: 1.5 },
    { x: -13.3, hub: 2.12, tip: 3.62, chord: 0.66, dir: 1.1 },
    { x: -14.6, hub: 2.14, tip: 3.5, chord: 0.64, dir: 0.7 },
    { x: -15.9, hub: 2.16, tip: 3.42, chord: 0.62, dir: 0.3 },
    { x: -17.2, hub: 2.18, tip: 3.36, chord: 0.6, dir: 0.0 },
    { x: -18.5, hub: 2.2, tip: 3.3, chord: 0.58, dir: -0.4 },
  ];
  for (const s of hpc) {
    const geo = bladeGeometry({ chord: s.chord, length: s.tip - s.hub, thick: 0.24, twistRoot: 0.5, twistTip: 0.95, taper: 0.6 });
    makeStage({ x: s.x, hubR: s.hub, discW: 0.48, count: 34, geo, mat: bladeMat, spin: spinN2 });
    parts[parts.length - 1].dir = DX(s.dir);
  }

  /* ----- Annular combustor + fuel injectors + fire ----- */
  const combustor = new THREE.Group();
  combustor.position.set(-20.6, 0, 0);
  let glowRing, glowCore, cLight;
  {
    const can = new THREE.Mesh(new THREE.TorusGeometry(2.9, 1.05, 18, 48), caseMat);
    can.rotation.y = Math.PI / 2;
    combustor.add(can);

    // Emissive inner liner — the visible heat of the can.
    glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.9, 0.7, 16, 40),
      new THREE.MeshStandardMaterial({
        color: 0x140a04, emissive: 0xff5a1a, emissiveIntensity: 1.4,
        roughness: 0.6, metalness: 0.2,
      })
    );
    glowRing.rotation.y = Math.PI / 2;
    combustor.add(glowRing);

    // Additive fire volume inside the can.
    glowCore = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffb36b, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    combustor.add(glowCore);

    // Firelight — flickers and paints the nearby stages orange.
    cLight = new THREE.PointLight(0xff6a1a, 0, 26, 2);
    combustor.add(cLight);

    const injGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const inj = new THREE.Mesh(injGeo, discMat);
      inj.position.set(0.9, Math.cos(a) * 3.0, Math.sin(a) * 3.0);
      inj.rotation.x = Math.PI / 2;
      inj.rotation.y = -a;
      combustor.add(inj);
    }
  }
  core.add(combustor);
  parts.push(new Part(combustor, new THREE.Vector3(0, 1.6, 0), null));

  /* ----- Turbines: HP (N2, 3 stages) then LP (N1, 3 stages) ----- */
  const hpt = [
    { x: -22.6, hubR: 1.9, dir: -0.8 },
    { x: -23.9, hubR: 1.9, dir: -1.6 },
    { x: -25.2, hubR: 1.92, dir: -2.4 },
  ];
  const lpt = [
    { x: -26.8, hubR: 2.05, dir: -3.4 },
    { x: -28.4, hubR: 2.1, dir: -4.6 },
    { x: -30.0, hubR: 2.15, dir: -5.8 },
  ];
  for (const s of hpt) {
    makeStage({ x: s.x, hubR: s.hubR, discW: 0.55, count: 34, geo: turbBlade, mat: turbMat, spin: spinN2 });
    parts[parts.length - 1].dir = DX(s.dir);
  }
  for (const s of lpt) {
    makeStage({ x: s.x, hubR: s.hubR, discW: 0.6, count: 32, geo: lptBlade, mat: turbMat, spin: spinN1 });
    parts[parts.length - 1].dir = DX(s.dir);
  }

  /* ----- Shaft (N1) ----- */
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 31, 20), discMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(-15.5, 0, 0);
  core.add(shaft);
  parts.push(new Part(shaft, DX(-6), spinN1));

  /* ----- Exhaust nozzle + tail cone ----- */
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 1.5, 5, 40, 1, true), nozzleMat);
  nozzle.rotation.z = -Math.PI / 2;
  nozzle.position.set(-33.5, 0, 0);
  core.add(nozzle);
  parts.push(new Part(nozzle, DX(-12), null));

  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(1.25, 3.2, 32),
    new THREE.MeshStandardMaterial({ color: ACCENT, metalness: 0.4, roughness: 0.45 })
  );
  tail.rotation.z = Math.PI / 2; // point -X
  tail.position.set(-36.7, 0, 0);
  core.add(tail);
  parts.push(new Part(tail, DX(-15), null));

  /* ----- Exhaust plume: additive cones + shock diamonds ----- */
  function plumeTexture(stripeDepth) {
    // Grayscale luminance canvas -> used as alphaMap (green channel).
    const c = document.createElement("canvas");
    c.width = 64; c.height = 256;
    const ctx = c.getContext("2d");
    for (let y = 0; y < 256; y++) {
      const t = y / 255; // 0 at nozzle exit, 1 at tail
      const fade = Math.pow(1 - t, 1.7);
      const diamonds = 1 - stripeDepth * (0.5 + 0.5 * Math.sin(t * Math.PI * 14)) * (1 - t);
      const v = Math.round(255 * Math.max(0, Math.min(1, fade * diamonds)));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, 64, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const plume = new THREE.Group();
  plume.position.set(-41.5, 0, 0);
  const plumeOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 2.7, 11, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff5a1a, alphaMap: plumeTexture(0.28), transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  plumeOuter.rotation.z = -Math.PI / 2;
  plume.add(plumeOuter);

  const plumeInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.3, 8.5, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc28a, alphaMap: plumeTexture(0.5), transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  plumeInner.rotation.z = -Math.PI / 2;
  plume.add(plumeInner);

  const eLight = new THREE.PointLight(0xff4d00, 0, 20, 2);
  eLight.position.set(4, 0, 0); // just aft of the nozzle exit, in plume space
  plume.add(eLight);

  core.add(plume);
  parts.push(new Part(plume, DX(-12), null));

  /* ----- Case frames (lift off upward when exploded); radii ride just
     above the convergent compressor tip line, then flare at the turbine ----- */
  const frames = [
    { x: -1.8, R: 9.1 },
    { x: -6.5, R: 4.95 },
    { x: -12.8, R: 4.15 },
    { x: -19.2, R: 3.85 },
    { x: -28.5, R: 5.6 },
  ];
  for (const f of frames) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(f.R, 0.16, 10, 72), caseMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(f.x, 0, 0);
    core.add(ring);
    parts.push(new Part(ring, new THREE.Vector3(0, 7, 0), null));
  }

  /* ----- Airflow visualization: streak particles through core + bypass -----
     Each particle is a curved, velocity-stretched line segment advected along
     the engine axis. Channel (core vs bypass) is set by entry radius. Color
     ramps blue-grey (intake) -> warm grey (compression) -> fire orange
     (combustor) -> deep red decay (plume); bypass stays a cold blue sheath. */
  const FLOW_N = 780;
  const flowGeom = new THREE.BufferGeometry();
  const flowPos = new Float32Array(FLOW_N * 6);
  const flowCol = new Float32Array(FLOW_N * 6);
  flowGeom.setAttribute("position", new THREE.BufferAttribute(flowPos, 3).setUsage(THREE.DynamicDrawUsage));
  flowGeom.setAttribute("color", new THREE.BufferAttribute(flowCol, 3).setUsage(THREE.DynamicDrawUsage));
  const flowMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flowLines = new THREE.LineSegments(flowGeom, flowMat);
  flowLines.frustumCulled = false;
  core.add(flowLines);

  // Per-particle state: x along axis, entry radius, base angle, speed jitter.
  const fx = new Float32Array(FLOW_N);
  const fr = new Float32Array(FLOW_N);
  const fth = new Float32Array(FLOW_N);
  const fjit = new Float32Array(FLOW_N);
  for (let i = 0; i < FLOW_N; i++) {
    fx[i] = 20 - Math.random() * 70;
    fr[i] = 2.4 + Math.random() * 6.6;
    fth[i] = Math.random() * TAU;
    fjit[i] = 0.8 + Math.random() * 0.45;
  }

  const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;

  function turbAmp(x) {
    if (x > -19) return 0.05;
    if (x > -26) return 0.5 * Math.sin(Math.PI * (x + 26) / 7); // combustor bustle
    if (x > -37) return 0.05;
    if (x > -42) return lerp(0.1, 0.9, (-37 - x) / 5);          // plume shear
    return lerp(0.9, 0.45, clamp((-42 - x) / 8, 0, 1));
  }

  // [radius, axial speed] for a particle of entry radius rIn at station x.
  // The core path funnels into the compressor annulus, converges with the
  // gas path (rt), blows through the combustor, and accelerates to the nozzle.
  function coreProfile(x, rIn, rc) {
    const rt = 2.75 + (rc - 2.6) * 0.3; // converged radius through the HP stages
    if (x >= 2) return [rIn * (0.95 + 0.05 * clamp((x - 2) / 12, 0, 1)), 0.30];
    if (x >= 0) return [rIn, 0.55];
    if (x >= -4.5) { const t = -x / 4.5; return [lerp(rIn, rc, t), 1.1 + 0.4 * t]; }
    if (x >= -12) return [lerp(rc, rt, (-4.5 - x) / 7.5), 1.55];  // LP convergence
    if (x >= -19) return [rt, 1.55];                              // HP stages
    if (x >= -22) return [rt * 1.08, 3.2];                        // combustor blast
    if (x >= -30) return [rt * 1.08, 3.0];                        // turbine
    if (x >= -33) return [lerp(rt * 1.08, rt * 0.62, (-30 - x) / 3), 3.6];
    if (x >= -36) return [lerp(rt * 0.62, rt * 0.42, (-33 - x) / 3), 4.2];
    if (x >= -40) return [lerp(rt * 0.42, rt * 0.52, (-36 - x) / 4), 3.9];
    return [lerp(rt * 0.52, rt * 0.66, clamp((-40 - x) / 10, 0, 1)), lerp(3.9, 2.6, clamp((-40 - x) / 10, 0, 1))];
  }

  function bypassProfile(x, rIn, rb) {
    if (x >= 2) return [rIn * (0.95 + 0.05 * clamp((x - 2) / 12, 0, 1)), 0.30];
    if (x >= -1.8) return [rIn, x >= 0 ? 0.55 : 1.3];
    if (x >= -9.5) { const t = (-1.8 - x) / 7.7; return [lerp(rIn, rb, t), 1.6]; }
    if (x >= -17.5) return [rb, 1.7];
    if (x >= -28.5) return [rb * 0.96, 1.8];
    if (x >= -33) return [rb, 2.0];
    if (x >= -37) return [lerp(rb, rb * 0.88, (-33 - x) / 4), 2.2];
    return [lerp(rb * 0.88, rb * 0.72, clamp((-37 - x) / 13, 0, 1)), lerp(2.1, 1.4, clamp((-37 - x) / 13, 0, 1))];
  }

  // Cold intake blue -> grey compression warm-up -> fire -> decaying red.
  const COLD = [0.32, 0.5, 0.85];
  const WARM = [0.58, 0.54, 0.55];

  function flowColor(x, bypass, flick, out) {
    if (bypass) {
      const fade = clamp((x + 50) / 14, 0, 1); // fades into the far plume
      out[0] = COLD[0] * 0.9 * fade;
      out[1] = COLD[1] * 0.9 * fade;
      out[2] = COLD[2] * 0.9 * fade;
      return;
    }
    if (x > -13) { out[0] = COLD[0]; out[1] = COLD[1]; out[2] = COLD[2]; return; }
    if (x > -19) { // compression heating
      const t = (-13 - x) / 6;
      out[0] = lerp(COLD[0], WARM[0], t); out[1] = lerp(COLD[1], WARM[1], t); out[2] = lerp(COLD[2], WARM[2], t);
      return;
    }
    if (x > -22.5) { // in the fire
      const g = 0.8 + 0.45 * flick;
      out[0] = 1.15 * g; out[1] = 0.52 * g; out[2] = 0.16 * g;
      return;
    }
    const u = clamp((-22.5 - x) / 27.5, 0, 1); // turbine -> plume decay
    out[0] = lerp(1.05, 0.62, u);
    out[1] = lerp(0.42, 0.1, u);
    out[2] = lerp(0.12, 0.03, u) * (1 - u * 0.5);
  }

  const colTmp = [0, 0, 0];
  function flowUpdate(dt, tSec, flick, strength) {
    const K = 6.5 * (reduced ? 0 : 1);
    for (let i = 0; i < FLOW_N; i++) {
      const bypass = fr[i] > 4.8;
      const rc = 2.6 + ((fr[i] - 2.4) / 2.4) * 1.4;
      const rb = 6.1 + ((fr[i] - 4.8) / 4.2) * 2.9;

      let respawned = false;
      if (fx[i] <= -50) {
        fx[i] = 20 + Math.random() * 6;
        fr[i] = 2.4 + Math.random() * 6.6;
        fth[i] = Math.random() * TAU;
        fjit[i] = 0.8 + Math.random() * 0.45;
        respawned = true;
      } else {
        const v0 = bypass ? bypassProfile(fx[i], fr[i], rb) : coreProfile(fx[i], fr[i], rc);
        fx[i] -= v0[1] * dt * K * fjit[i];
      }

      const p2 = bypass ? bypassProfile(fx[i], fr[i], rb) : coreProfile(fx[i], fr[i], rc);
      const sw = bypass
        ? 0.10 * Math.min(30, Math.max(0, -fx[i])) + 0.02 * Math.max(0, -fx[i] - 30)
        : 0.26 * Math.min(16, Math.max(0, -fx[i])) + 0.06 * Math.max(0, -fx[i] - 16);
      const theta = fth[i] + sw;
      let r = p2[0] + Math.sin(tSec * (9 + fjit[i] * 5) + theta * 3 + fx[i] * 0.35) * turbAmp(fx[i]);
      r = Math.max(r, 0.35);

      const fadeIn = clamp((20 - fx[i]) / 5, 0, 1);
      const y = r * Math.cos(theta), z = r * Math.sin(theta);
      const o = i * 6;
      // head
      flowPos[o] = fx[i]; flowPos[o + 1] = y; flowPos[o + 2] = z;
      // tail: upstream point, curved by the local swirl gradient
      const streak = respawned ? 0.5 : clamp(p2[1] * 0.5, 0.3, 2.2);
      const swGrad = bypass ? 0.10 : 0.26;
      const th2 = theta - swGrad * streak;
      const y2 = r * Math.cos(th2), z2 = r * Math.sin(th2);
      flowPos[o + 3] = fx[i] + streak; flowPos[o + 4] = y2; flowPos[o + 5] = z2;

      flowColor(fx[i], bypass, flick, colTmp);
      flowCol[o] = colTmp[0] * 1.05 * fadeIn;
      flowCol[o + 1] = colTmp[1] * 1.05 * fadeIn;
      flowCol[o + 2] = colTmp[2] * 1.05 * fadeIn;
      flowCol[o + 3] = colTmp[0] * 0.4 * fadeIn;
      flowCol[o + 4] = colTmp[1] * 0.4 * fadeIn;
      flowCol[o + 5] = colTmp[2] * 0.4 * fadeIn;
    }
    flowGeom.attributes.position.needsUpdate = true;
    flowGeom.attributes.color.needsUpdate = true;
    flowMat.opacity = 0.95 * strength;
  }

  flowUpdate(0, 0, 0.85, 1); // prime buffers before first render

  /* ----- CAD cage + corner ticks ----- */
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(46, 22, 21)),
    new THREE.LineBasicMaterial({ color: 0xe8e6e1, transparent: true, opacity: 0.13 })
  );
  cage.position.set(2.5, 0, 0);
  assembly.add(cage);
  parts.push(new Part(cage, new THREE.Vector3(0, 5, 0)));

  const tickMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(sx * 23, sy * 11 - sy * 3, 10.5),
        new THREE.Vector3(sx * 23, sy * 11, 10.5),
        new THREE.Vector3(sx * 23 - sx * 3, sy * 11, 10.5),
      ]);
      cage.add(new THREE.Line(g, tickMat));
    }
  }

  /* ---------- Particles ---------- */
  const pGeo = new THREE.BufferGeometry();
  const N = 420;
  const pPos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 34 + Math.random() * 46;
    const th = Math.random() * TAU;
    const ph = Math.acos(2 * Math.random() - 1);
    pPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.55;
    pPos[i * 3 + 2] = r * Math.cos(ph) * 0.5;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const points = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({ color: 0xe8e6e1, size: 0.09, transparent: true, opacity: 0.5 })
  );
  scene.add(points);

  /* ---------- Grid floor ---------- */
  const grid = new THREE.GridHelper(160, 64, 0x33363c, 0x1d1f23);
  grid.position.y = -18;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  /* ---------- State ---------- */
  const state = {
    t: 0,
    throttle: reduced ? 0 : 1,
    explode: 0,
    explodeTarget: 0,
    rotY: -0.62,
    rotX: -0.07,
    velY: 0,
    velX: 0,
    dragging: false,
    mouse: { x: 0, y: 0 },
    ambient: false,
    dirty: true,
  };

  /* ---------- Public API (unchanged surface) ---------- */
  const api = {
    setExplode(p) {
      state.explodeTarget = THREE.MathUtils.clamp(p, 0, 1);
      state.dirty = true;
    },
    nudge(dx, dy) {
      state.rotY += dx;
      state.rotX = THREE.MathUtils.clamp(state.rotX + dy, -1.1, 1.1);
      state.velY = dx;
      state.velX = dy;
      state.dirty = true;
    },
    setDragging(d) {
      state.dragging = d;
    },
    setAmbient(a) {
      state.ambient = a;
    },
    onFrame: null,
  };

  addEventListener("pointermove", (e) => {
    state.mouse.x = (e.clientX / innerWidth) * 2 - 1;
    state.mouse.y = (e.clientY / innerHeight) * 2 - 1;
    state.dirty = true;
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    state.dirty = true;
  }
  addEventListener("resize", resize);
  resize();

  /* ---------- Loop ---------- */
  let last = performance.now();
  let visible = true;
  let frameNo = 0;
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) { last = performance.now(); state.dirty = true; }
  });

  const ease = (t) => t * t * (3 - 2 * t);
  const N1_MAX = 2.4; // rad/s at 100% N1

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible) return;

    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const idleSpin = !state.dragging && !reduced;
    if (idleSpin) {
      state.rotY += 0.04 * dt; // slow turntable
    } else if (!state.dragging) {
      state.velY *= 0.94;
      state.velX *= 0.94;
      state.rotY += state.velY;
      state.rotX = THREE.MathUtils.clamp(state.rotX + state.velX, -1.1, 1.1);
    }

    state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 4.5);
    const runFactor = state.throttle * (1 + state.explode * 0.5); // run-up on disassembly
    state.t += dt * runFactor;

    const p = ease(state.explode);
    for (const part of parts) {
      part.obj.position.copy(part.home).addScaledVector(part.dir, p);
      if (part.spin) part.obj.rotation.x = part.spin(state.t);
    }

    /* Combustion: pseudo-random flicker drives every emissive surface,
       the plume, and the two firelights. Heat rises with disassembly. */
    const flick = reduced
      ? 0.85
      : 0.72 + 0.18 * Math.sin(state.t * 29) + 0.1 * Math.sin(state.t * 47 + 1.3);
    const heat = 0.7 + 0.6 * p;
    glowRing.material.emissiveIntensity = (1.0 + 1.6 * flick) * heat;
    glowCore.material.opacity = 0.26 * flick * heat;
    cLight.intensity = 36 * flick * heat;
    nozzleMat.emissiveIntensity = (0.15 + 0.3 * flick) * heat;
    plumeOuter.material.opacity = 0.42 * flick * heat;
    plumeInner.material.opacity = 0.34 * flick * heat;
    eLight.intensity = 22 * flick * heat;
    flowUpdate(dt, state.t, flick, 1 - 0.55 * p);

    grid.material.opacity = 0.55 * (1 - p);

    assembly.rotation.set(state.rotX, state.rotY, 0);

    // Camera: parallax + explode dolly.
    const px = state.mouse.x * 1.6;
    const py = -state.mouse.y * 1.0;
    camera.position.x += (px - camera.position.x) * 0.04;
    camera.position.y += (4 + py + p * 5 - camera.position.y) * 0.04;
    camera.position.z += (47 + p * 15 - camera.position.z) * 0.05;
    camera.lookAt(2.5, 1, 0); // aim left of center -> engine rides right, clear of the headline

    points.rotation.y = now * 0.0000125;

    const moving =
      state.throttle > 0 ||
      state.dragging ||
      Math.abs(state.velY) > 0.0004 ||
      Math.abs(state.explodeTarget - state.explode) > 0.001 ||
      idleSpin;

    // In ambient mode the stage is barely visible — render at low duty cycle.
    const idle = state.ambient && !state.dragging && state.explode < 0.01;
    const skip = idle && !state.dirty && frameNo % 8 !== 0;
    frameNo++;

    if (!skip && (moving || state.dirty || !reduced)) {
      renderer.render(scene, camera);
      state.dirty = false;
    }
    if (api.onFrame) {
      const n1 = (Math.abs(N1) * runFactor / N1_MAX) * 100;
      // Real spools don't scale linearly; keep N2 high at idle, topping out
      // just past 100 at full run-up.
      const n2 = Math.min(101.4, n1 * 0.85 + 15 + Math.sin(now * 0.0007) * 0.6);
      const egt = 510 + 195 * p + Math.sin(now * 0.0012) * 8;
      api.onFrame({
        n1: Math.min(n1, 100.5),
        n2,
        egt: Math.max(egt, 0),
        explode: state.explode,
      });
    }
  }
  requestAnimationFrame(tick);

  renderer.render(scene, camera);
  return api;
}
