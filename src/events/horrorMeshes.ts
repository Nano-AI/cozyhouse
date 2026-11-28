import * as THREE from 'three';

/**
 * Procedural low-poly models for the horror events (flat-shaded MeshStandardMaterial, box/cyl kit
 * like the rest of the cast). Every builder tracks what it allocates and frees it in dispose().
 * Local +Z is "front" for all rigs.
 */

type MeshOpts = { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; shadow?: boolean };

class Kit {
  readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.Material[] = [];
  readonly texs: THREE.Texture[] = [];

  mat(color: string, roughness = 0.8, metalness = 0.04, extra?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true, ...extra });
    this.mats.push(m);
    return m;
  }

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  tex<T extends THREE.Texture>(t: T): T {
    this.texs.push(t);
    return t;
  }

  mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, o?: MeshOpts): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(geo), mat);
    m.position.set(x, y, z);
    m.rotation.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0);
    m.scale.set(o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    m.castShadow = o?.shadow ?? true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  box(p: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, o?: MeshOpts): THREE.Mesh {
    return this.mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  }

  cyl(p: THREE.Object3D, rt: number, rb: number, h: number, segs: number, mat: THREE.Material, x: number, y: number, z: number, o?: MeshOpts): THREE.Mesh {
    return this.mesh(p, new THREE.CylinderGeometry(rt, rb, h, segs), mat, x, y, z, o);
  }

  sphere(p: THREE.Object3D, r: number, segs: number, mat: THREE.Material, x: number, y: number, z: number, o?: MeshOpts): THREE.Mesh {
    return this.mesh(p, new THREE.SphereGeometry(r, segs, Math.max(4, Math.round(segs * 0.7))), mat, x, y, z, o);
  }

  group(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
    this.texs.length = 0;
  }
}

export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  });
  return Math.round(tris);
}

// ---------------------------------------------------------------------------
// 2D canvas art: the scratched sepia family photo
// ---------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Sepia family photo: four darker silhouettes, faces scratched out with pale gouges. */
function drawFamilyPhoto(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 7): void {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#e2c595');
  bg.addColorStop(1, '#b08c5c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // faint room behind them: a doorway and a wainscot line
  ctx.fillStyle = 'rgba(70,48,28,0.25)';
  ctx.fillRect(w * 0.68, h * 0.12, w * 0.2, h * 0.5);
  ctx.fillRect(0, h * 0.58, w, h * 0.03);
  // figures: two adults behind, two children in front
  const figs = [
    { x: 0.32, top: 0.2, hw: 0.13, hr: 0.075 },
    { x: 0.66, top: 0.17, hw: 0.14, hr: 0.08 },
    { x: 0.22, top: 0.46, hw: 0.1, hr: 0.06 },
    { x: 0.5, top: 0.5, hw: 0.09, hr: 0.055 },
  ];
  for (const f of figs) {
    const cx = f.x * w;
    const headY = f.top * h + f.hr * w;
    ctx.fillStyle = 'rgba(46,30,17,0.94)';
    ctx.beginPath();
    ctx.arc(cx, headY, f.hr * w, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const bodyTop = headY + f.hr * w * 0.9;
    ctx.moveTo(cx - f.hw * w * 0.55, bodyTop);
    ctx.lineTo(cx + f.hw * w * 0.55, bodyTop);
    ctx.lineTo(cx + f.hw * w, h * 1.02);
    ctx.lineTo(cx - f.hw * w, h * 1.02);
    ctx.closePath();
    ctx.fill();
    // scratched-out face: dense pale gouges over the head
    ctx.strokeStyle = '#fbf3e2';
    ctx.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      ctx.lineWidth = (1.4 + rnd() * 2.4) * (w / 128);
      ctx.beginPath();
      const r = f.hr * w * 1.15;
      ctx.moveTo(cx - r + rnd() * r * 0.5, headY - r + rnd() * r * 2);
      ctx.lineTo(cx + rnd() * r * 0.3 - r * 0.15, headY - r * 0.2 + rnd() * r * 0.4);
      ctx.lineTo(cx + r - rnd() * r * 0.5, headY - r + rnd() * r * 2);
      ctx.stroke();
    }
  }
  // age: specks, a crease, dark vignette
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,26,14,0.35)' : 'rgba(250,240,220,0.3)';
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  ctx.strokeStyle = 'rgba(245,232,205,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.37);
  ctx.lineTo(w, h * 0.33);
  ctx.stroke();
  const vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(30,18,8,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// The Last Guest
// ---------------------------------------------------------------------------

export interface LastGuestPose {
  /** World distance walked this frame (drives the long, slow stride). */
  stride: number;
  /** Stutter-freeze: hold the exact pose. */
  frozen: boolean;
  duck: number;
  sit: number;
  seatY: number;
  /** Both arms lift slowly toward whoever he is closing on. */
  reach: number;
  headYaw: number;
  headRoll: number;
  /** World direction toward the viewer: when set, the picture-frame face is aimed square along it. */
  faceDir?: THREE.Vector3;
}

export interface LastGuestRig {
  root: THREE.Group;
  bouquet: THREE.Group;
  update(dt: number, pose: LastGuestPose): void;
  dispose(): void;
}

const LG_HIP = 1.04;

export function createLastGuestRig(): LastGuestRig {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'LastGuest';

  const suit = kit.mat('#252a36', 0.3, 0.16);
  const suitDark = kit.mat('#171a22', 0.34, 0.12);
  const shirt = kit.mat('#cdc9bd', 0.5);
  const tie = kit.mat('#0b0b0e', 0.32, 0.1);
  const skin = kit.mat('#a3a8ab', 0.62);
  const hair = kit.mat('#111216', 0.22, 0.2);
  const shoe = kit.mat('#0c0c0e', 0.2, 0.22);
  const gold = kit.mat('#8a7342', 0.55, 0.42);
  const goldDark = kit.mat('#5c4b2a', 0.6, 0.38);
  const backing = kit.mat('#2a2119', 0.9);
  const paper = kit.mat('#a8977a', 0.92);
  const stem = kit.mat('#5a5f49', 0.85);
  const petalMats = [kit.mat('#8d6b63', 0.9), kit.mat('#7d6c76', 0.9), kit.mat('#6e5646', 0.9)];
  const bud = kit.mat('#45362f', 0.9);
  const drip = kit.mat('#9fb4c4', 0.1, 0.1, { transparent: true, opacity: 0.75 });

  const [pc, pctx] = canvas(160, 200);
  drawFamilyPhoto(pctx, 160, 200);
  const photoTex = kit.tex(new THREE.CanvasTexture(pc));
  photoTex.colorSpace = THREE.SRGBColorSpace;
  const photo = kit.mat('#ffffff', 0.92, 0, { map: photoTex, emissiveMap: photoTex, emissive: '#ffffff', emissiveIntensity: 0.45, flatShading: false });

  const body = kit.group(root, 0, 0, 0);

  // Legs: long thin trousers, knee pivots, narrow glossy shoes
  const legs: Array<{ hip: THREE.Group; knee: THREE.Group }> = [];
  for (const side of [-1, 1]) {
    const hip = kit.group(body, side * 0.085, LG_HIP, 0);
    kit.box(hip, 0.105, 0.54, 0.12, suit, 0, -0.27, 0);
    const knee = kit.group(hip, 0, -0.53, 0);
    kit.box(knee, 0.095, 0.5, 0.105, suit, 0, -0.25, 0);
    kit.box(knee, 0.1, 0.03, 0.11, suitDark, 0, -0.47, 0); // wet, clinging hem
    kit.box(knee, 0.11, 0.065, 0.27, shoe, 0, -0.5, 0.065);
    legs.push({ hip, knee });
  }
  kit.box(body, 0.27, 0.15, 0.16, suit, 0, LG_HIP + 0.02, 0);

  // Torso (bends forward to duck under door frames)
  const spine = kit.group(body, 0, LG_HIP + 0.05, 0);
  kit.box(spine, 0.27, 0.3, 0.165, suit, 0, 0.15, 0);
  kit.box(spine, 0.33, 0.3, 0.18, suit, 0, 0.44, 0);
  kit.box(spine, 0.29, 0.22, 0.17, suit, 0, -0.05, -0.005, { rx: -0.05 }); // coat tails
  kit.box(spine, 0.085, 0.27, 0.012, shirt, 0, 0.45, 0.092);
  kit.box(spine, 0.034, 0.25, 0.012, tie, 0, 0.42, 0.1);
  kit.box(spine, 0.05, 0.04, 0.02, tie, 0, 0.56, 0.1);
  for (const side of [-1, 1]) {
    kit.box(spine, 0.055, 0.26, 0.012, suitDark, side * 0.062, 0.46, 0.096, { rz: side * -0.32 });
    kit.box(spine, 0.07, 0.045, 0.012, shirt, side * 0.042, 0.565, 0.104, { rz: side * 0.95 }); // limp collar points
    kit.box(spine, 0.11, 0.05, 0.175, suit, side * 0.15, 0.585, 0, { rz: side * -0.3 }); // sloped shoulders
    kit.box(spine, 0.06, 0.008, 0.012, suitDark, side * 0.1, 0.3, 0.093); // pocket flaps
  }
  kit.cyl(spine, 0.058, 0.064, 0.045, 8, shirt, 0, 0.6, 0.005);

  // Arms: far too long, hanging limp, spidery pale fingers
  const arms: Array<{ shoulder: THREE.Group; elbow: THREE.Group }> = [];
  let leftHand: THREE.Group | null = null;
  for (const side of [-1, 1]) {
    const shoulder = kit.group(spine, side * 0.2, 0.57, 0);
    shoulder.rotation.z = side * 0.05;
    kit.box(shoulder, 0.075, 0.52, 0.085, suit, 0, -0.26, 0);
    const elbow = kit.group(shoulder, 0, -0.51, 0);
    kit.box(elbow, 0.068, 0.5, 0.078, suit, 0, -0.25, 0);
    kit.box(elbow, 0.074, 0.03, 0.084, shirt, 0, -0.485, 0);
    const hand = kit.group(elbow, 0, -0.51, 0);
    kit.box(hand, 0.055, 0.1, 0.028, skin, 0, -0.05, 0);
    for (let f = 0; f < 4; f++) {
      kit.box(hand, 0.011, 0.14, 0.013, skin, -0.019 + f * 0.0127, -0.165, 0.004, { rx: 0.12 });
    }
    kit.box(hand, 0.011, 0.07, 0.012, skin, side * -0.032, -0.07, 0.012, { rz: side * 0.4 });
    arms.push({ shoulder, elbow });
    if (side === -1) leftHand = hand;
  }

  // Neck & head; the face is entirely hidden behind an ornate dull-gold picture frame
  const neck = kit.group(spine, 0, 0.6, 0);
  kit.cyl(neck, 0.042, 0.048, 0.17, 7, skin, 0, 0.08, 0);
  const head = kit.group(neck, 0, 0.16, 0);
  kit.box(head, 0.2, 0.25, 0.21, hair, 0, 0.12, -0.01); // slicked, soaked hair all round; no face to see
  kit.mesh(head, new THREE.SphereGeometry(0.125, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 0.2, -0.02, { sx: 0.9, sy: 0.7, sz: 0.95 });
  kit.box(head, 0.2, 0.16, 0.04, hair, 0, 0.16, -0.11);
  const frame = kit.group(head, 0, 0.13, 0.135);
  frame.rotation.x = -0.06;
  kit.box(frame, 0.4, 0.5, 0.012, backing, 0, 0, -0.012);
  kit.mesh(frame, new THREE.PlaneGeometry(0.32, 0.4), photo, 0, 0, 0.002, { shadow: false });
  for (const sy of [-1, 1]) {
    kit.box(frame, 0.43, 0.055, 0.038, gold, 0, sy * 0.226, 0.008);
    kit.box(frame, 0.34, 0.016, 0.022, goldDark, 0, sy * 0.198, 0.013);
  }
  for (const sx of [-1, 1]) {
    kit.box(frame, 0.055, 0.4, 0.038, gold, sx * 0.188, 0, 0.008);
    kit.box(frame, 0.016, 0.38, 0.022, goldDark, sx * 0.163, 0, 0.013);
    for (const sy of [-1, 1]) {
      kit.sphere(frame, 0.028, 6, goldDark, sx * 0.2, sy * 0.24, 0.032);
      kit.box(frame, 0.034, 0.034, 0.012, gold, sx * 0.18, sy * 0.215, 0.032, { rz: Math.PI / 4 });
    }
    kit.sphere(frame, 0.016, 5, gold, sx * 0.188, 0, 0.032);
  }
  kit.mesh(frame, new THREE.TorusGeometry(0.055, 0.014, 4, 8, Math.PI), gold, 0, 0.25, 0.008);
  kit.sphere(frame, 0.024, 6, goldDark, 0, 0.31, 0.01);
  kit.sphere(frame, 0.018, 5, gold, 0, -0.258, 0.02);

  // Wilted bouquet held upright in front of him in the left hand, heads drooping over the wrap
  const bouquet = new THREE.Group();
  bouquet.name = 'WiltedBouquet';
  (leftHand ?? root).add(bouquet);
  bouquet.position.set(0, -0.07, 0.03);
  kit.mesh(bouquet, new THREE.ConeGeometry(0.09, 0.26, 7, 1, true), paper, 0, 0.08, 0, { rx: Math.PI });
  kit.box(bouquet, 0.05, 0.03, 0.05, stem, 0, -0.06, 0);
  const heads = 7;
  for (let i = 0; i < heads; i++) {
    const a = (i / heads) * Math.PI * 2 + 0.3;
    const yawG = kit.group(bouquet, 0, 0, 0);
    yawG.rotation.y = Math.PI / 2 - a;
    const r = i === 0 ? 0.01 : 0.055;
    kit.cyl(yawG, 0.005, 0.006, 0.12, 3, stem, 0, 0.24, r * 0.7, { rx: 0.45, shadow: false });
    const bloom = kit.group(yawG, 0, 0.27 + (i % 2) * 0.02, r + 0.035);
    bloom.rotation.x = 1.7 + (i % 3) * 0.25; // heads hang down past the stem
    kit.sphere(bloom, 0.026, 6, bud, 0, 0, 0, { shadow: false });
    for (let q = 0; q < 5; q++) {
      const pa = (q / 5) * Math.PI * 2;
      kit.box(bloom, 0.04, 0.008, 0.062, petalMats[(i + q) % 3], Math.cos(pa) * 0.036, -0.012, Math.sin(pa) * 0.036, {
        ry: -pa + Math.PI / 2,
        rx: 0.75 + (q % 2) * 0.3,
        shadow: false,
      });
    }
  }

  // Water dripping off the soaked coat
  const dripGeo = kit.geo(new THREE.BoxGeometry(0.012, 0.03, 0.012));
  const drips: Array<{ m: THREE.Mesh; t: number; x: number; y: number; z: number }> = [];
  const dripSpots: Array<[number, number, number]> = [
    [-0.12, LG_HIP - 0.1, 0.06],
    [0.13, LG_HIP - 0.08, -0.05],
    [-0.2, 0.62, 0.02],
    [0.21, 0.6, 0.01],
  ];
  dripSpots.forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(dripGeo, drip);
    m.castShadow = false;
    root.add(m);
    drips.push({ m, t: i * 0.37, x, y, z });
  });

  let phase = 0;
  let gait = 0;
  const faceTmp = new THREE.Vector3();
  const update = (dt: number, p: LastGuestPose): void => {
    for (const d of drips) {
      d.t += dt;
      const k = (d.t % 1.3) / 1.3;
      const fall = Math.min(1, k * 1.6);
      d.m.visible = k < 0.62;
      d.m.position.set(d.x, d.y * (1 - fall * fall) + 0.02, d.z);
    }
    if (p.frozen) return;
    phase += p.stride * ((Math.PI * 2) / 1.75);
    gait += ((p.stride > 1e-5 ? 1 : 0) - gait) * (1 - Math.exp(-5 * dt));
    const sit = p.sit;
    const walk = (1 - sit) * gait;
    const stand = 1 - sit;
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);
    for (let i = 0; i < 2; i++) {
      const ph = i === 0 ? phase : phase + Math.PI;
      const swing = -0.46 * Math.sin(ph) * walk;
      const kneeBend = (0.06 + 0.8 * Math.max(0, Math.cos(ph))) * walk;
      legs[i].hip.rotation.x = swing - p.duck * 0.28 * stand - (Math.PI / 2) * sit;
      legs[i].hip.rotation.z = (i === 0 ? -1 : 1) * 0.04 * sit;
      legs[i].knee.rotation.x = kneeBend + p.duck * 0.55 * stand + (Math.PI / 2) * sit;
    }
    const bob = -0.028 * Math.abs(cosP) * walk;
    body.position.y = bob - p.duck * 0.11 * stand + (p.seatY + 0.07 - LG_HIP) * sit;
    spine.rotation.x = 0.07 + p.duck * 0.72 + 0.16 * sit;
    spine.rotation.z = 0.03 * sinP * walk;
    // left arm cradles the bouquet; the right hangs limp and lifts slowly toward whoever he nears
    const [l, r] = arms;
    l.shoulder.rotation.x = -0.12 + 0.04 * sinP * walk - 0.15 * sit - p.duck * 0.3 - p.reach * 0.25;
    l.elbow.rotation.x = -0.72 - 0.4 * sit;
    r.shoulder.rotation.x = -0.1 * sinP * walk - p.reach * 1.2 - 0.28 * sit - p.duck * 0.4;
    r.elbow.rotation.x = -0.12 - p.reach * 0.15 - 1.0 * sit;
    if (bouquet.parent === leftHand) {
      bouquet.rotation.set(-(l.shoulder.rotation.x + l.elbow.rotation.x + spine.rotation.x), 0, 0.12);
    }
    neck.rotation.x = 0.1 + p.duck * 0.45 + 0.3 * sit - p.reach * 0.15;
    head.rotation.set(0, p.headYaw, p.headRoll);
    if (p.faceDir) {
      root.updateMatrixWorld(true);
      head.getWorldPosition(faceTmp);
      head.lookAt(faceTmp.add(p.faceDir)); // +Z (the photo) toward the viewer
      head.rotateZ(p.headRoll);
    }
  };

  update(0, { stride: 0, frozen: false, duck: 0, sit: 0, seatY: 0, reach: 0, headYaw: 0, headRoll: 0.2 });

  return {
    root,
    bouquet,
    update,
    dispose: () => kit.dispose(),
  };
}

/** Falling dust (one InstancedMesh per vanish); it settles into a little pile and stays until disposed. */
export class DustBurst {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly parts: Array<{ p: THREE.Vector3; v: THREE.Vector3; spin: number; s: number }> = [];
  private readonly tmp = new THREE.Object3D();
  age = 0;
  readonly life = 2.6;

  constructor(center: THREE.Vector3, height: number, color: string, count = 70) {
    this.geo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.95, flatShading: true });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.castShadow = false;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.2;
      this.parts.push({
        p: new THREE.Vector3(center.x + Math.cos(a) * r, 0.1 + Math.random() * height, center.z + Math.sin(a) * r),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.25, -0.1 - Math.random() * 0.3, (Math.random() - 0.5) * 0.25),
        spin: Math.random() * 6,
        s: 0.5 + Math.random() * 1.1,
      });
    }
    this.update(0);
  }

  /** Returns false once finished. */
  update(dt: number): boolean {
    this.age += dt;
    const k = this.age / this.life;
    for (let i = 0; i < this.parts.length; i++) {
      const q = this.parts[i];
      q.v.y -= 0.9 * dt;
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.04) {
        q.p.y = 0.04;
        q.v.set(q.v.x * 0.3, 0, q.v.z * 0.3);
      }
      this.tmp.position.copy(q.p);
      this.tmp.rotation.set(q.spin * this.age, q.spin * 0.7 * this.age, 0);
      this.tmp.scale.setScalar(q.s * (1 - Math.min(1, k) * 0.35));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return k < 1;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// HUD portraits (2D canvas, matching the 3/4 head-and-shoulders card thumbnails)
// ---------------------------------------------------------------------------

let lastGuestPortrait: string | null = null;

export function getLastGuestPortrait(): string {
  if (lastGuestPortrait) return lastGuestPortrait;
  const [c, ctx] = canvas(128, 128);
  // shoulders: soaked charcoal suit, white collar, black tie
  ctx.fillStyle = '#252a36';
  ctx.beginPath();
  ctx.moveTo(14, 128);
  ctx.quadraticCurveTo(22, 92, 64, 90);
  ctx.quadraticCurveTo(106, 92, 114, 128);
  ctx.fill();
  ctx.fillStyle = '#cdc9bd';
  ctx.beginPath();
  ctx.moveTo(52, 92);
  ctx.lineTo(64, 120);
  ctx.lineTo(76, 92);
  ctx.fill();
  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(61, 96, 6, 32);
  ctx.fillStyle = '#a3a8ab';
  ctx.fillRect(58, 78, 12, 16);
  // gilt frame over the face
  ctx.save();
  ctx.translate(64, 50);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#5c4b2a';
  ctx.fillRect(-27, -35, 54, 70);
  ctx.fillStyle = '#8a7342';
  ctx.fillRect(-25, -33, 50, 66);
  ctx.save();
  ctx.translate(-18, -26);
  drawFamilyPhoto(ctx, 36, 52, 11);
  ctx.restore();
  ctx.strokeStyle = '#5c4b2a';
  ctx.lineWidth = 2;
  ctx.strokeRect(-18, -26, 36, 52);
  ctx.fillStyle = '#6e5a32';
  for (const [x, y] of [[-25, -33], [25, -33], [-25, 33], [25, 33]]) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  lastGuestPortrait = c.toDataURL('image/png');
  return lastGuestPortrait;
}
