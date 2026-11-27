import * as THREE from 'three';
import { FLOOR_BASE_Y, type MeshOptions, type ModelContext, type TabModelBuilder } from './ModelKit';

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Adds a custom BufferGeometry mesh using `ctx.mat` so ghost mode, shadows,
 * flat shading, and material/geometry disposal match all ModelKit primitives.
 */
function addMesh(
  ctx: ModelContext,
  geometry: THREE.BufferGeometry,
  color: string | number,
  x: number,
  y: number,
  z: number,
  opts?: MeshOptions,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, ctx.mat(color, opts));
  mesh.position.set(x, y, z);
  if (opts?.rotX) mesh.rotation.x = opts.rotX;
  if (opts?.rotY) mesh.rotation.y = opts.rotY;
  if (opts?.rotZ) mesh.rotation.z = opts.rotZ;
  if (opts?.scaleX !== undefined || opts?.scaleY !== undefined || opts?.scaleZ !== undefined) {
    mesh.scale.set(opts.scaleX ?? 1, opts.scaleY ?? 1, opts.scaleZ ?? 1);
  }
  mesh.castShadow = !ctx.isGhost && (opts?.castShadow ?? true);
  mesh.receiveShadow = !ctx.isGhost && (opts?.receiveShadow ?? true);
  if (opts?.name) mesh.name = opts.name;
  (opts?.parent ?? ctx.group).add(mesh);
  return mesh;
}

/**
 * Places a cylinder rod connecting point A to point B cleanly in local space.
 */
function connectRod(
  ctx: ModelContext,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  radius: number,
  color: string | number,
  segs = 6,
  opts?: MeshOptions,
): THREE.Mesh {
  const start = new THREE.Vector3(x1, y1, z1);
  const end = new THREE.Vector3(x2, y2, z2);
  const delta = end.clone().sub(start);
  const len = Math.max(0.004, delta.length());
  const mid = start.clone().add(end).multiplyScalar(0.5);

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, segs),
    ctx.mat(color, opts),
  );
  mesh.position.copy(mid);
  const dir = delta.normalize();
  if (dir.y < -0.9999) {
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
  }
  mesh.castShadow = !ctx.isGhost && (opts?.castShadow ?? true);
  mesh.receiveShadow = !ctx.isGhost && (opts?.receiveShadow ?? true);
  if (opts?.name) mesh.name = opts.name;
  (opts?.parent ?? ctx.group).add(mesh);
  return mesh;
}

/* ============================================================================
 * 1. PLANTS (9 items)
 * ============================================================================ */

function buildWallVines(ctx: ModelContext): void {
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.14);
  const leafDark = ctx.shade(ctx.primary, -0.18);
  const stemColor = ctx.shade(ctx.primary, -0.28);

  // Slim oak mounting rail near top of wall mount
  ctx.box(0.84, 0.045, 0.04, '#C8A57E', 0, 0.37, 0.025, { roughness: 0.72 });
  // Small mounting pegs
  ctx.cyl(0.016, 0.016, 0.03, 6, '#A98560', -0.34, 0.37, 0.048, { rotX: Math.PI / 2 });
  ctx.cyl(0.016, 0.016, 0.03, 6, '#A98560', 0.34, 0.37, 0.048, { rotX: Math.PI / 2 });

  // 5 cascading vine strands of varied lengths and subtle wave
  const strands: Array<{ x: number; drop: number; sway: number; leaves: number }> = [
    { x: -0.32, drop: 0.56, sway: -0.04, leaves: 4 },
    { x: -0.16, drop: 0.74, sway: 0.03, leaves: 5 },
    { x: 0.0, drop: 0.66, sway: -0.02, leaves: 5 },
    { x: 0.16, drop: 0.78, sway: 0.04, leaves: 5 },
    { x: 0.32, drop: 0.50, sway: -0.03, leaves: 4 },
  ];

  const palette = [leafMain, leafLight, leafDark];

  for (let s = 0; s < strands.length; s++) {
    const st = strands[s];
    const topY = 0.36;
    const midY = topY - st.drop * 0.5;
    const botY = topY - st.drop;
    connectRod(ctx, st.x, topY, 0.042, st.x + st.sway, midY, 0.068, 0.008, stemColor, 5);
    connectRod(ctx, st.x + st.sway, midY, 0.068, st.x - st.sway * 0.5, botY, 0.056, 0.007, stemColor, 5);

    for (let i = 0; i < st.leaves; i++) {
      const t = (i + 0.5) / st.leaves;
      const ly = topY - st.drop * t;
      const side = (i + s) % 2 === 0 ? 1 : -1;
      const lx = st.x + st.sway * Math.sin(t * Math.PI) + side * 0.042;
      const lz = 0.068 + (i % 2) * 0.018;
      const col = palette[(s + i) % palette.length];
      ctx.sphere(0.054 - t * 0.012, 5, col, lx, ly, lz, {
        scaleX: 0.95,
        scaleY: 1.25,
        scaleZ: 0.42,
        rotZ: side * 0.45,
        rotX: 0.25,
        roughness: 0.68,
      });
    }
  }
}

function buildHangingIvy(ctx: ModelContext): void {
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.14);
  const leafDark = ctx.shade(ctx.primary, -0.18);
  const potColor = '#EFE5D6';
  const ropeColor = '#DFCDAE';

  // Ceiling rosette + brass hook
  ctx.cyl(0.055, 0.065, 0.025, 8, '#C9A775', 0, -0.012, 0, { metalness: 0.35, roughness: 0.4 });
  ctx.torus(0.022, 0.006, 5, 10, '#C9A775', 0, -0.042, 0, { metalness: 0.4, roughness: 0.35 });

  // 3 macrame cords descending to pot cradle
  const potTopY = -0.34;
  const potBotY = -0.52;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.4;
    const rx = Math.cos(a) * 0.155;
    const rz = Math.sin(a) * 0.155;
    connectRod(ctx, 0, -0.05, 0, rx, potTopY - 0.02, rz, 0.007, ropeColor, 5);
    connectRod(ctx, rx, potTopY - 0.02, rz, rx * 0.68, potBotY - 0.02, rz * 0.68, 0.006, ropeColor, 5);
  }
  // Macrame tassel under pot
  ctx.cone(0.026, 0.08, 6, ropeColor, 0, potBotY - 0.055, 0, { rotX: Math.PI });

  // Ceramic tapered hanging pot + rim + soil (soil cleanly proud inside rim)
  ctx.cyl(0.15, 0.105, 0.18, 9, potColor, 0, (potTopY + potBotY) / 2, 0, { roughness: 0.62 });
  ctx.torus(0.148, 0.014, 6, 12, ctx.shade(potColor, -0.08), 0, potTopY - 0.008, 0, { rotX: Math.PI / 2 });
  ctx.cyl(0.132, 0.132, 0.022, 8, '#5E4738', 0, potTopY - 0.006, 0, { roughness: 0.92 });

  // Lush leafy crown mound over pot rim
  ctx.sphere(0.13, 6, leafDark, 0, potTopY + 0.04, 0, { scaleX: 1.2, scaleY: 0.68, scaleZ: 1.2 });
  ctx.sphere(0.095, 6, leafLight, 0.07, potTopY + 0.07, 0.05, { scaleY: 0.72 });
  ctx.sphere(0.09, 6, leafMain, -0.08, potTopY + 0.06, -0.04, { scaleY: 0.72 });

  // 6 cascading vine trails draping below pot to y = -0.84
  const trailCount = 6;
  for (let i = 0; i < trailCount; i++) {
    const a = (i * Math.PI * 2) / trailCount + 0.25;
    const len = 0.28 + (i % 3) * 0.08;
    const r = 0.165;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    connectRod(ctx, x * 0.85, potTopY + 0.01, z * 0.85, x * 1.15, potTopY - len, z * 1.15, 0.006, leafDark, 4);
    for (let j = 0; j < 2; j++) {
      const f = 0.45 + j * 0.48;
      const col = (i + j) % 2 === 0 ? leafMain : leafLight;
      ctx.sphere(0.046 - j * 0.008, 5, col, x * (0.95 + f * 0.22), potTopY - len * f, z * (0.95 + f * 0.22), {
        scaleX: 1.1,
        scaleY: 0.8,
        scaleZ: 0.65,
        rotY: -a,
        rotZ: 0.35,
      });
    }
  }
}

function buildHangingFern(ctx: ModelContext): void {
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.14);
  const leafDark = ctx.shade(ctx.primary, -0.18);
  const potColor = ctx.accent;

  // Ceiling hook + brass chains
  ctx.cyl(0.048, 0.056, 0.024, 8, '#C8A572', 0, -0.012, 0, { metalness: 0.45, roughness: 0.35 });
  const potTopY = -0.45;
  const potBotY = -0.63;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    connectRod(ctx, 0, -0.025, 0, Math.cos(a) * 0.15, potTopY, Math.sin(a) * 0.15, 0.006, '#C8A572', 5, {
      metalness: 0.45,
      roughness: 0.35,
    });
  }

  // Rounded ribbed hanging basket pot
  ctx.cyl(0.16, 0.115, 0.17, 10, potColor, 0, (potTopY + potBotY) / 2, 0, { roughness: 0.7 });
  ctx.torus(0.155, 0.016, 6, 12, ctx.shade(potColor, -0.1), 0, potTopY - 0.01, 0, { rotX: Math.PI / 2 });
  ctx.cyl(0.14, 0.14, 0.025, 8, '#5C4537', 0, potTopY - 0.012, 0, { roughness: 0.92 });

  // Central fern rosette core
  ctx.sphere(0.13, 6, leafDark, 0, potTopY + 0.05, 0, { scaleX: 1.25, scaleY: 0.72, scaleZ: 1.25 });

  // 12 feathery arching fern fronds (6 upper arching, 6 lower cascading)
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const upperCol = i % 2 === 0 ? leafLight : leafMain;
    // Upper fountain frond
    const ux = Math.cos(a) * 0.17;
    const uz = Math.sin(a) * 0.17;
    ctx.cone(0.058, 0.28, 4, upperCol, ux, potTopY + 0.09, uz, {
      rotY: -a,
      rotZ: -1.12,
      scaleZ: 0.42,
      roughness: 0.7,
    });

    // Lower weeping frond reaching down to y ~ -0.74
    const la = a + Math.PI / 6;
    const lx = Math.cos(la) * 0.21;
    const lz = Math.sin(la) * 0.21;
    ctx.cone(0.062, 0.34, 4, i % 2 === 0 ? leafMain : leafDark, lx, potTopY - 0.08, lz, {
      rotY: -la,
      rotZ: -2.25,
      scaleZ: 0.38,
      roughness: 0.72,
    });
  }
}

function buildPottedMonstera(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const potColor = ctx.accent;
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.14);
  const leafDark = ctx.shade(ctx.primary, -0.18);
  const stemColor = ctx.shade(ctx.primary, -0.25);

  // Terracotta saucer + tapered pot + lip + rich soil (soil cleanly above lip top)
  ctx.cyl(0.20, 0.185, 0.028, 10, ctx.shade(potColor, -0.08), 0, baseY + 0.014, 0, { roughness: 0.74 });
  ctx.cyl(0.215, 0.155, 0.30, 10, potColor, 0, baseY + 0.178, 0, { roughness: 0.68 });
  ctx.cyl(0.23, 0.22, 0.048, 10, ctx.shade(potColor, 0.04), 0, baseY + 0.325, 0, { roughness: 0.65 });
  ctx.cyl(0.195, 0.195, 0.022, 9, '#5C4435', 0, baseY + 0.344, 0, { roughness: 0.94 });

  // 7 broad sculpted monstera leaves radiating on slender curving stems
  const leaves: Array<{ angle: number; reach: number; height: number; size: number; tilt: number; col: string }> = [
    { angle: 0.15, reach: 0.25, height: 0.88, size: 0.18, tilt: 0.55, col: leafMain },
    { angle: 1.05, reach: 0.24, height: 0.76, size: 0.17, tilt: 0.72, col: leafLight },
    { angle: 1.95, reach: 0.27, height: 0.96, size: 0.19, tilt: 0.48, col: leafDark },
    { angle: 2.85, reach: 0.22, height: 0.70, size: 0.16, tilt: 0.78, col: leafMain },
    { angle: 3.75, reach: 0.26, height: 0.84, size: 0.18, tilt: 0.60, col: leafLight },
    { angle: 4.65, reach: 0.23, height: 0.72, size: 0.16, tilt: 0.75, col: leafDark },
    { angle: 5.55, reach: 0.12, height: 0.99, size: 0.165, tilt: 0.32, col: leafMain },
  ];

  const soilY = baseY + 0.33;
  for (const lf of leaves) {
    const tx = Math.cos(lf.angle) * lf.reach;
    const tz = Math.sin(lf.angle) * lf.reach;
    const ty = baseY + lf.height;
    connectRod(ctx, Math.cos(lf.angle) * 0.04, soilY, Math.sin(lf.angle) * 0.04, tx, ty - 0.02, tz, 0.011, stemColor, 5);

    // Broad sculpted split-lobe monstera leaf blade (main blade + notched tip lobe)
    const leafGroup = new THREE.Group();
    leafGroup.position.set(tx, ty, tz);
    leafGroup.rotation.y = -lf.angle + Math.PI / 2;
    leafGroup.rotation.x = lf.tilt;
    ctx.group.add(leafGroup);

    ctx.sphere(lf.size, 6, lf.col, 0, 0, 0.03, {
      scaleX: 0.92,
      scaleY: 0.14,
      scaleZ: 1.15,
      roughness: 0.62,
      parent: leafGroup,
    });
    // Midrib vein highlight for crisp botanical readability
    ctx.box(0.016, 0.018, lf.size * 1.45, ctx.shade(lf.col, 0.16), 0, 0.014, 0.03, {
      roughness: 0.65,
      parent: leafGroup,
      castShadow: false,
    });
  }
}

function buildPottedFiddleLeaf(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const potColor = ctx.accent;
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.14);
  const leafDark = ctx.shade(ctx.primary, -0.18);
  const bark = '#7B5C44';

  // Woven basket / ceramic floor planter with horizontal texture rings
  ctx.cyl(0.21, 0.165, 0.34, 10, potColor, 0, baseY + 0.17, 0, { roughness: 0.78 });
  ctx.torus(0.20, 0.014, 5, 12, ctx.shade(potColor, -0.12), 0, baseY + 0.29, 0, { rotX: Math.PI / 2 });
  ctx.torus(0.185, 0.013, 5, 12, ctx.shade(potColor, -0.10), 0, baseY + 0.16, 0, { rotX: Math.PI / 2 });
  ctx.cyl(0.19, 0.19, 0.03, 9, '#5A4335', 0, baseY + 0.33, 0, { roughness: 0.94 });

  // Tall woody trunk with subtle natural lean & two upper forks
  const trunkTopY = baseY + 1.06;
  connectRod(ctx, 0, baseY + 0.32, 0, 0.02, baseY + 0.72, -0.01, 0.032, bark, 7);
  connectRod(ctx, 0.02, baseY + 0.72, -0.01, -0.02, trunkTopY, 0.01, 0.026, bark, 6);
  connectRod(ctx, -0.01, baseY + 0.92, 0, 0.14, baseY + 1.24, 0.08, 0.018, bark, 5);
  connectRod(ctx, -0.02, baseY + 1.02, 0.01, -0.14, baseY + 1.30, -0.06, 0.018, bark, 5);

  // 10 lush oversized violin-shaped fiddle leaf paddles spiraling up the crown
  const pads: Array<{ x: number; y: number; z: number; ry: number; rx: number; s: number; col: string }> = [
    { x: 0.15, y: 0.88, z: 0.12, ry: 0.6, rx: 0.52, s: 0.15, col: leafDark },
    { x: -0.16, y: 0.94, z: 0.11, ry: -0.7, rx: 0.48, s: 0.155, col: leafMain },
    { x: 0.04, y: 1.02, z: -0.18, ry: 3.0, rx: 0.55, s: 0.15, col: leafDark },
    { x: 0.21, y: 1.12, z: -0.05, ry: 1.8, rx: 0.44, s: 0.165, col: leafMain },
    { x: -0.20, y: 1.16, z: -0.08, ry: -1.9, rx: 0.42, s: 0.16, col: leafLight },
    { x: 0.09, y: 1.24, z: 0.18, ry: 0.35, rx: 0.40, s: 0.165, col: leafLight },
    { x: -0.11, y: 1.32, z: 0.12, ry: -0.6, rx: 0.35, s: 0.15, col: leafMain },
    { x: 0.15, y: 1.38, z: -0.06, ry: 2.0, rx: 0.36, s: 0.155, col: leafDark },
    { x: -0.12, y: 1.44, z: -0.09, ry: -2.2, rx: 0.32, s: 0.145, col: leafLight },
    { x: 0.01, y: 1.49, z: 0.02, ry: 0.4, rx: 0.18, s: 0.14, col: leafLight },
  ];

  for (const p of pads) {
    ctx.sphere(p.s, 6, p.col, p.x, baseY + p.y, p.z, {
      scaleX: 0.78,
      scaleY: 0.24,
      scaleZ: 1.28,
      rotY: p.ry,
      rotX: p.rx,
      roughness: 0.58,
    });
  }
}

function buildPottedCactus(ctx: ModelContext): void {
  const potColor = ctx.accent;
  const cactusMain = ctx.primary;
  const cactusRib = ctx.shade(ctx.primary, -0.14);

  // Cute terracotta / ochre pot sitting at surface y = 0
  ctx.cyl(0.135, 0.10, 0.15, 9, potColor, 0, 0.075, 0, { roughness: 0.72 });
  ctx.cyl(0.148, 0.14, 0.032, 9, ctx.shade(potColor, 0.05), 0, 0.152, 0, { roughness: 0.68 });
  ctx.cyl(0.122, 0.122, 0.02, 8, '#D7BB93', 0, 0.162, 0, { roughness: 0.92 });
  // Tiny desert pebbles
  ctx.sphere(0.018, 5, '#BFA98A', 0.075, 0.172, 0.04, { scaleY: 0.6 });
  ctx.sphere(0.015, 5, '#9F8E78', -0.07, 0.172, 0.05, { scaleY: 0.6 });

  // Main ribbed saguaro column
  ctx.cyl(0.062, 0.058, 0.27, 8, cactusMain, 0, 0.30, 0, { roughness: 0.75 });
  ctx.sphere(0.062, 8, cactusMain, 0, 0.435, 0, { roughness: 0.75 });
  // Vertical rib ridges around main trunk (staggered slightly in height to avoid coplanar cap overlap)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    ctx.box(0.014, 0.252 - i * 0.008, 0.132, cactusRib, 0, 0.305, 0, { rotY: a, roughness: 0.78 });
  }

  // Left raised saguaro arm (higher)
  ctx.cyl(0.036, 0.038, 0.09, 7, cactusMain, -0.08, 0.31, 0, { rotZ: Math.PI / 2 });
  ctx.sphere(0.038, 6, cactusMain, -0.12, 0.31, 0);
  ctx.cyl(0.035, 0.037, 0.12, 7, cactusMain, -0.12, 0.37, 0);
  ctx.sphere(0.035, 6, cactusMain, -0.12, 0.43, 0);

  // Right raised saguaro arm (slightly lower)
  ctx.cyl(0.034, 0.036, 0.085, 7, cactusMain, 0.075, 0.265, 0.01, { rotZ: Math.PI / 2 });
  ctx.sphere(0.036, 6, cactusMain, 0.115, 0.265, 0.01);
  ctx.cyl(0.033, 0.035, 0.105, 7, cactusMain, 0.115, 0.318, 0.01);
  ctx.sphere(0.033, 6, cactusMain, 0.115, 0.37, 0.01);

  // Charming pink cactus flower blooming on top!
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    ctx.sphere(0.022, 5, '#F29BB2', Math.cos(a) * 0.022, 0.502, Math.sin(a) * 0.022, {
      scaleY: 0.65,
      roughness: 0.6,
    });
  }
  ctx.sphere(0.016, 5, '#F8DC78', 0, 0.512, 0, { roughness: 0.55 });
}

function buildPottedBonsai(ctx: ModelContext): void {
  const trayColor = ctx.accent;
  const leafMain = ctx.primary;
  const leafLight = ctx.shade(ctx.primary, 0.12);
  const leafDark = ctx.shade(ctx.primary, -0.14);
  const bark = '#6E503D';

  // Shallow rectangular bonsai dish on 4 tiny corner feet (sits at y = 0)
  for (const sx of [-0.145, 0.145]) {
    for (const sz of [-0.095, 0.095]) {
      ctx.box(0.042, 0.022, 0.036, ctx.shade(trayColor, -0.14), sx, 0.011, sz);
    }
  }
  ctx.box(0.36, 0.068, 0.25, trayColor, 0, 0.056, 0, { roughness: 0.52 });
  ctx.box(0.38, 0.018, 0.27, ctx.shade(trayColor, 0.08), 0, 0.094, 0, { roughness: 0.48 });
  // Mossy soil bed cleanly above tray rim + zen pebble
  ctx.box(0.32, 0.018, 0.21, '#6C845E', 0, 0.102, 0, { roughness: 0.92 });
  ctx.sphere(0.032, 5, '#B4ABA0', 0.10, 0.118, 0.04, { scaleX: 1.3, scaleY: 0.65, scaleZ: 0.9 });

  // Gnarled angled S-curve trunk + 3 sculpted branches
  connectRod(ctx, -0.04, 0.095, 0, -0.09, 0.19, 0.01, 0.03, bark, 6);
  connectRod(ctx, -0.09, 0.19, 0.01, 0.01, 0.29, -0.01, 0.024, bark, 6);
  connectRod(ctx, 0.01, 0.29, -0.01, 0.04, 0.36, 0.0, 0.018, bark, 5);
  // Side branches
  connectRod(ctx, -0.06, 0.22, 0.01, -0.16, 0.26, 0.03, 0.014, bark, 5);
  connectRod(ctx, -0.01, 0.28, -0.01, 0.14, 0.30, 0.02, 0.014, bark, 5);

  // 5 sculpted cloud foliage pads (fluffy flat-bottomed clouds)
  const pads: Array<{ x: number; y: number; z: number; r: number; sx: number; sy: number; col: string }> = [
    { x: -0.17, y: 0.28, z: 0.03, r: 0.095, sx: 1.25, sy: 0.58, col: leafDark },
    { x: 0.15, y: 0.32, z: 0.02, r: 0.09, sx: 1.25, sy: 0.56, col: leafMain },
    { x: -0.04, y: 0.36, z: -0.05, r: 0.088, sx: 1.2, sy: 0.58, col: leafMain },
    { x: 0.04, y: 0.39, z: 0.02, r: 0.105, sx: 1.3, sy: 0.56, col: leafLight },
    { x: 0.01, y: 0.42, z: -0.01, r: 0.068, sx: 1.2, sy: 0.54, col: leafLight },
  ];
  for (const p of pads) {
    ctx.sphere(p.r, 6, p.col, p.x, p.y, p.z, {
      scaleX: p.sx,
      scaleY: p.sy,
      scaleZ: p.sx * 0.88,
      roughness: 0.72,
    });
  }
}

function buildPottedSnakePlant(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const potColor = ctx.accent;
  const leafMain = ctx.primary;
  const leafDark = ctx.shade(ctx.primary, -0.2);
  const leafEdge = '#E1EAB4';
  const standWood = '#C8A27A';

  // Mid-century wooden dowel plant stand lifting the planter off FLOOR_BASE_Y
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const ox = Math.cos(a) * 0.185;
    const oz = Math.sin(a) * 0.185;
    ctx.cyl(0.018, 0.015, 0.24, 6, standWood, ox, baseY + 0.12, oz, { roughness: 0.74 });
  }
  ctx.box(0.36, 0.024, 0.026, standWood, 0, baseY + 0.085, 0, { rotY: Math.PI / 4 });
  ctx.box(0.36, 0.016, 0.026, standWood, 0, baseY + 0.085, 0, { rotY: -Math.PI / 4 });

  // Sleek cylindrical modern ceramic planter + soil
  ctx.cyl(0.175, 0.172, 0.26, 12, potColor, 0, baseY + 0.215, 0, { roughness: 0.56 });
  ctx.cyl(0.16, 0.16, 0.025, 10, '#5A4436', 0, baseY + 0.34, 0, { roughness: 0.92 });

  // 10 upright spiky variegated sansevieria sword blades
  const blades: Array<{ x: number; z: number; h: number; ry: number; rx: number; rz: number; col: string }> = [
    { x: 0.0, z: 0.0, h: 0.52, ry: 0.2, rx: 0.03, rz: -0.04, col: leafMain },
    { x: -0.05, z: 0.04, h: 0.46, ry: 0.7, rx: 0.10, rz: 0.08, col: leafDark },
    { x: 0.06, z: 0.03, h: 0.48, ry: -0.5, rx: 0.09, rz: -0.09, col: leafEdge },
    { x: -0.03, z: -0.06, h: 0.49, ry: 2.8, rx: -0.11, rz: 0.05, col: leafMain },
    { x: 0.07, z: -0.05, h: 0.43, ry: 2.2, rx: -0.12, rz: -0.09, col: leafDark },
    { x: -0.09, z: -0.01, h: 0.40, ry: 1.5, rx: 0.04, rz: 0.16, col: leafEdge },
    { x: 0.09, z: 0.0, h: 0.38, ry: -1.4, rx: 0.05, rz: -0.17, col: leafMain },
    { x: 0.01, z: 0.08, h: 0.35, ry: 0.1, rx: 0.18, rz: 0.02, col: leafDark },
    { x: -0.06, z: 0.07, h: 0.33, ry: 0.85, rx: 0.17, rz: 0.12, col: leafMain },
    { x: 0.04, z: -0.08, h: 0.36, ry: -2.7, rx: -0.17, rz: -0.06, col: leafEdge },
  ];

  const soilY = baseY + 0.335;
  for (const b of blades) {
    ctx.cone(0.048, b.h, 4, b.col, b.x, soilY + b.h / 2 - 0.02, b.z, {
      rotY: b.ry,
      rotX: b.rx,
      rotZ: b.rz,
      scaleZ: 0.24,
      roughness: 0.64,
    });
  }
}

function buildFlowerVase(ctx: ModelContext): void {
  const bloomMain = ctx.primary;
  const bloomAlt = ctx.shade(ctx.primary, 0.16);
  const vaseColor = ctx.accent;
  const stemGreen = '#74A37A';

  // Sculpted curved ceramic bud vase (sits at y = 0)
  ctx.cyl(0.066, 0.058, 0.028, 10, ctx.shade(vaseColor, -0.08), 0, 0.014, 0, { roughness: 0.52 });
  ctx.sphere(0.095, 10, vaseColor, 0, 0.095, 0, { scaleY: 0.92, roughness: 0.45 });
  ctx.cyl(0.046, 0.064, 0.075, 10, vaseColor, 0, 0.175, 0, { roughness: 0.45 });
  ctx.torus(0.048, 0.01, 6, 12, ctx.shade(vaseColor, 0.06), 0, 0.212, 0, { rotX: Math.PI / 2, roughness: 0.42 });

  // 6 wildflower stems with leaves & cheerful blooms reaching y ~ 0.42
  const flowers: Array<{ x: number; y: number; z: number; col: string; r: number }> = [
    { x: 0.0, y: 0.39, z: 0.0, col: bloomMain, r: 0.044 },
    { x: -0.085, y: 0.35, z: 0.045, col: bloomAlt, r: 0.040 },
    { x: 0.085, y: 0.36, z: 0.035, col: bloomMain, r: 0.041 },
    { x: -0.055, y: 0.34, z: -0.07, col: '#F6E8D8', r: 0.036 },
    { x: 0.06, y: 0.33, z: -0.065, col: bloomAlt, r: 0.038 },
    { x: 0.01, y: 0.31, z: 0.09, col: '#F2B8C2', r: 0.036 },
  ];

  for (let i = 0; i < flowers.length; i++) {
    const f = flowers[i];
    connectRod(ctx, f.x * 0.22, 0.18, f.z * 0.22, f.x, f.y - 0.01, f.z, 0.006, stemGreen, 5);
    // Blossom crown
    ctx.sphere(f.r, 6, f.col, f.x, f.y, f.z, { scaleY: 0.72, roughness: 0.62 });
    // Warm pollen center
    ctx.sphere(f.r * 0.42, 5, '#F5CE6C', f.x, f.y + f.r * 0.48, f.z, { roughness: 0.55 });
    // Small leaf along alternating stems
    if (i < 4) {
      ctx.sphere(0.032, 5, '#86B48B', f.x * 0.78, 0.255 + (i % 2) * 0.02, f.z * 0.78, {
        scaleX: 1.3,
        scaleY: 0.35,
        scaleZ: 0.6,
        rotY: i * 1.4,
        rotZ: 0.45,
      });
    }
  }
}

/* ============================================================================
 * 2. MUSIC & ART (6 items)
 * ============================================================================ */

function buildVinylRecordsStack(ctx: ModelContext): void {
  const sleeveColors = [
    ctx.primary,
    ctx.accent,
    '#F1E5D1',
    ctx.shade(ctx.primary, -0.18),
    '#A9C9B6',
  ];

  // Low oak countertop display stand / cradle (rails sit cleanly atop base, zero side overlap)
  ctx.box(0.38, 0.026, 0.28, '#C8A27A', 0, 0.013, 0, { roughness: 0.72 });
  ctx.box(0.372, 0.044, 0.024, '#B58E66', 0, 0.048, 0.124, { roughness: 0.74 });
  ctx.box(0.372, 0.044, 0.024, '#B58E66', 0, 0.048, -0.124, { roughness: 0.74 });

  // 5 neatly offset leaning square album sleeves
  for (let i = 0; i < 5; i++) {
    const zPos = -0.075 + i * 0.038;
    const xOff = (i % 2 === 0 ? -0.018 : 0.016) + (i - 2) * 0.005;
    const lean = -0.14 + i * 0.015;
    ctx.box(0.285, 0.285, 0.016, sleeveColors[i], xOff, 0.165, zPos, {
      rotX: lean,
      roughness: 0.76,
    });
  }

  // Minimalist album art graphic patch on the frontmost sleeve
  ctx.box(0.18, 0.14, 0.008, '#FAF4EA', 0.01, 0.19, 0.09, { rotX: -0.08, castShadow: false });
  ctx.cyl(0.044, 0.044, 0.008, 10, ctx.primary, 0.01, 0.195, 0.098, {
    rotX: Math.PI / 2 - 0.08,
    castShadow: false,
  });

  // Glossy black vinyl LP disc peeking out of the right side of the front sleeve!
  ctx.cyl(0.132, 0.132, 0.007, 16, '#23252A', 0.135, 0.178, 0.062, {
    rotX: Math.PI / 2 - 0.1,
    roughness: 0.28,
    metalness: 0.22,
  });
  ctx.cyl(0.044, 0.044, 0.016, 10, ctx.primary, 0.135, 0.178, 0.062, {
    rotX: Math.PI / 2 - 0.1,
    roughness: 0.55,
  });
  ctx.cyl(0.009, 0.009, 0.025, 8, '#EDE5D8', 0.135, 0.178, 0.062, {
    rotX: Math.PI / 2 - 0.1,
  });
}

function buildRecordWallDisplay(ctx: ModelContext): void {
  const c1 = ctx.primary;
  const c2 = ctx.shade(ctx.primary, 0.16);
  const c3 = '#F2E7D6';
  const c4 = '#A8C6D6';
  const railColor = '#C9A47B';
  const frameDark = ctx.accent;

  // Two slim floating display ledges mounted at z = 0.02
  ctx.box(0.80, 0.026, 0.055, railColor, 0, 0.01, 0.032, { roughness: 0.7 });
  ctx.box(0.80, 0.026, 0.055, railColor, 0, -0.34, 0.032, { roughness: 0.7 });

  // 2x2 grid of framed pastel album sleeves
  const sleeves: Array<{ x: number; y: number; bg: string; art: string; shape: 'circle' | 'bar' }> = [
    { x: -0.19, y: 0.185, bg: c1, art: '#FAF4EA', shape: 'circle' },
    { x: 0.15, y: 0.185, bg: c3, art: c1, shape: 'bar' },
    { x: -0.19, y: -0.165, bg: c4, art: '#F4DCA0', shape: 'bar' },
    { x: 0.19, y: -0.165, bg: c2, art: frameDark, shape: 'circle' },
  ];

  for (const s of sleeves) {
    // Slim dark outer frame
    ctx.box(0.30, 0.30, 0.02, frameDark, s.x, s.y, 0.024, { roughness: 0.6 });
    // Album cover face
    ctx.box(0.268, 0.268, 0.012, s.bg, s.x, s.y, 0.035, { roughness: 0.75 });
    // Minimalist album art graphic
    if (s.shape === 'circle') {
      ctx.cyl(0.068, 0.068, 0.008, 10, s.art, s.x, s.y, 0.044, {
        rotX: Math.PI / 2,
        castShadow: false,
      });
    } else {
      ctx.box(0.18, 0.075, 0.008, s.art, s.x, s.y + 0.03, 0.044, { castShadow: false });
      ctx.box(0.14, 0.026, 0.008, frameDark, s.x, s.y - 0.05, 0.044, { castShadow: false });
    }
  }

  // Mounted glossy black vinyl LP peeking out to the right of top-right sleeve (cleanly stepped Z)
  ctx.cyl(0.125, 0.125, 0.01, 16, '#23252B', 0.31, 0.185, 0.026, {
    rotX: Math.PI / 2,
    roughness: 0.26,
    metalness: 0.24,
  });
  ctx.cyl(0.042, 0.042, 0.008, 10, c1, 0.31, 0.185, 0.035, { rotX: Math.PI / 2 });
  ctx.cyl(0.009, 0.009, 0.008, 8, '#EFE7DA', 0.31, 0.185, 0.043, { rotX: Math.PI / 2 });
}

function buildRecordPlayer(ctx: ModelContext): void {
  const plinth = ctx.primary;
  const trim = ctx.accent;

  // 4 tiny dark isolation feet (sits at surface y = 0)
  for (const sx of [-0.23, 0.23]) {
    for (const sz of [-0.17, 0.17]) {
      ctx.cyl(0.022, 0.02, 0.016, 6, '#3B3734', sx, 0.008, sz);
    }
  }

  // Main wooden/retro plinth cabinet
  ctx.box(0.56, 0.092, 0.44, plinth, 0, 0.062, 0, { roughness: 0.66 });
  // Recessed metallic deck plate on top
  ctx.box(0.51, 0.012, 0.39, ctx.shade(trim, 0.18), 0, 0.112, 0, {
    roughness: 0.4,
    metalness: 0.3,
  });

  // Front controls: power LED + pitch slider + volume knob
  ctx.sphere(0.011, 6, ctx.isActive ? '#8EE3A4' : '#7A7672', -0.22, 0.072, 0.222, {
    emissive: ctx.isActive ? '#70E08E' : undefined,
    emissiveIntensity: ctx.isActive ? 1.1 : 0,
  });
  ctx.cyl(0.018, 0.02, 0.018, 8, '#D7C4A3', 0.20, 0.125, 0.145, { metalness: 0.4, roughness: 0.35 });
  ctx.box(0.022, 0.012, 0.075, '#4A4D54', 0.15, 0.122, 0.135);

  // Spinning vinyl platter sub-group named `SpinTarget`!
  const spinGroup = new THREE.Group();
  spinGroup.name = 'SpinTarget';
  spinGroup.userData.spinAxis = 'y';
  spinGroup.userData.spinSpeed = 2.4;
  spinGroup.position.set(-0.055, 0.122, 0.012);
  ctx.group.add(spinGroup);

  // Brushed aluminum platter rim
  ctx.cyl(0.172, 0.176, 0.016, 18, '#B8BEC6', 0, 0.008, 0, {
    metalness: 0.55,
    roughness: 0.3,
    parent: spinGroup,
  });
  // Black vinyl LP disc
  ctx.cyl(0.164, 0.164, 0.006, 18, '#22242A', 0, 0.020, 0, {
    roughness: 0.26,
    metalness: 0.22,
    parent: spinGroup,
  });
  // Subtle groove sheen ring
  ctx.torus(0.118, 0.003, 5, 18, '#3B3F4A', 0, 0.025, 0, {
    rotX: Math.PI / 2,
    roughness: 0.22,
    metalness: 0.35,
    parent: spinGroup,
    castShadow: false,
  });
  // Colored center record label + off-center white marker (strictly stepped Y)
  ctx.cyl(0.054, 0.054, 0.006, 12, '#E59479', 0, 0.026, 0, {
    roughness: 0.65,
    parent: spinGroup,
  });
  ctx.box(0.036, 0.005, 0.012, '#FAF3E6', 0.025, 0.032, 0, {
    parent: spinGroup,
    castShadow: false,
  });
  // Chrome center spindle
  ctx.cyl(0.007, 0.007, 0.020, 6, '#DCE1E8', 0, 0.040, 0, {
    metalness: 0.75,
    roughness: 0.2,
    parent: spinGroup,
  });

  // Metallic tonearm assembly on right side (swung over vinyl when active!)
  ctx.cyl(0.036, 0.04, 0.032, 10, '#C6CCD4', 0.195, 0.132, -0.115, {
    metalness: 0.6,
    roughness: 0.28,
  });
  const armEndX = ctx.isActive ? 0.065 : 0.185;
  const armEndZ = ctx.isActive ? 0.075 : 0.095;
  connectRod(ctx, 0.195, 0.15, -0.115, armEndX, 0.154, armEndZ, 0.0065, '#D2D7DF', 6, {
    metalness: 0.7,
    roughness: 0.24,
  });
  // Headshell cartridge
  ctx.box(0.024, 0.018, 0.042, '#353840', armEndX - 0.006, 0.15, armEndZ + 0.012, {
    rotY: ctx.isActive ? 0.45 : 0.05,
  });

  // Propped-open translucent acrylic dust cover angled at rear hinge (peaking cleanly at ~0.32)
  const coverGroup = new THREE.Group();
  coverGroup.position.set(0, 0.112, -0.215);
  coverGroup.rotation.x = -0.52;
  ctx.group.add(coverGroup);
  ctx.box(0.54, 0.01, 0.41, '#E4F0F7', 0, 0.016, 0.205, {
    opacity: 0.28,
    roughness: 0.12,
    metalness: 0.1,
    parent: coverGroup,
    castShadow: false,
  });
  // Slim silver rear hinges
  ctx.box(0.045, 0.022, 0.024, '#C6CCD4', -0.18, 0.005, 0, {
    metalness: 0.55,
    roughness: 0.3,
    parent: coverGroup,
  });
  ctx.box(0.045, 0.022, 0.024, '#C6CCD4', 0.18, 0.005, 0, {
    metalness: 0.55,
    roughness: 0.3,
    parent: coverGroup,
  });
}

function buildPosterIndie(ctx: ModelContext): void {
  const posterBg = ctx.primary;
  const paper = ctx.accent;
  const deepWave = ctx.shade(ctx.primary, -0.22);
  const midWave = ctx.shade(ctx.primary, -0.10);

  // Slim oak poster hanger bars at top & bottom
  ctx.box(0.60, 0.032, 0.028, '#C8A37B', 0, 0.375, 0.024, { roughness: 0.7 });
  ctx.box(0.60, 0.028, 0.028, '#C8A37B', 0, -0.375, 0.024, { roughness: 0.7 });

  // Crisp paper backing + printed poster art field (strictly stepped Z layers)
  ctx.box(0.56, 0.72, 0.014, paper, 0, 0, 0.02, { roughness: 0.85 });
  ctx.box(0.49, 0.64, 0.006, posterBg, 0, 0, 0.031, { roughness: 0.82, castShadow: false });

  // Geometric mid-century gig poster art: glowing sun disc + layered stylized waves
  ctx.cyl(0.115, 0.115, 0.006, 14, '#FAF0D1', 0, 0.12, 0.039, {
    rotX: Math.PI / 2,
    roughness: 0.75,
    castShadow: false,
  });
  ctx.torus(0.155, 0.008, 5, 16, paper, 0, 0.12, 0.041, { castShadow: false });

  // Layered angled geometric wave/dune bands across lower half (0.006 Z separation each)
  ctx.box(0.47, 0.13, 0.005, midWave, -0.01, -0.08, 0.039, { rotZ: 0.08, castShadow: false });
  ctx.box(0.47, 0.14, 0.005, deepWave, 0.01, -0.18, 0.045, { rotZ: -0.06, castShadow: false });
  ctx.box(0.47, 0.09, 0.005, '#3B4252', 0, -0.26, 0.051, { castShadow: false });

  // Crisp graphic bar accents at header/footer (abstract typography motif, zero real text)
  ctx.box(0.32, 0.018, 0.005, paper, 0, 0.27, 0.039, { castShadow: false });
  ctx.box(0.20, 0.012, 0.005, paper, 0, -0.26, 0.057, { castShadow: false });
}

function buildFramedArt(ctx: ModelContext): void {
  const frameColor = ctx.accent;
  const leafColor = ctx.primary;
  const leafDark = ctx.shade(ctx.primary, -0.22);
  const w = 0.58;
  const h = 0.72;
  const rim = 0.04;

  // Gallery wooden/brass 4-piece recessed frame
  ctx.box(w, rim, 0.048, frameColor, 0, h / 2 - rim / 2, 0.034, { roughness: 0.58 });
  ctx.box(w, rim, 0.048, frameColor, 0, -h / 2 + rim / 2, 0.034, { roughness: 0.58 });
  ctx.box(rim, h - rim * 2, 0.048, frameColor, -w / 2 + rim / 2, 0, 0.034, { roughness: 0.58 });
  ctx.box(rim, h - rim * 2, 0.048, frameColor, w / 2 - rim / 2, 0, 0.034, { roughness: 0.58 });

  // Matte backing board strictly inside frame rails (non-coplanar back) + warm museum passe-partout
  ctx.box(w - rim * 2, h - rim * 2, 0.016, '#F8F3EB', 0, 0, 0.026, { roughness: 0.88 });
  // Inner recessed pastel art canvas
  ctx.box(0.38, 0.50, 0.005, ctx.shade(leafColor, 0.55), 0, 0, 0.038, {
    roughness: 0.85,
    castShadow: false,
  });

  // Minimalist terracotta/cream organic arch shape as a single seamless extruded solid
  const archShape = new THREE.Shape();
  archShape.moveTo(-0.11, -0.17);
  archShape.lineTo(0.11, -0.17);
  archShape.lineTo(0.11, 0.05);
  archShape.absarc(0, 0.05, 0.11, 0, Math.PI, false);
  archShape.closePath();
  addMesh(
    ctx,
    new THREE.ExtrudeGeometry(archShape, { depth: 0.005, bevelEnabled: false, curveSegments: 12 }),
    '#EAD4BF',
    0.02,
    0,
    0.042,
    { castShadow: false },
  );

  // Minimalist botanical leaf branch composition in subtle 3D relief
  connectRod(ctx, -0.03, -0.18, 0.052, 0.01, 0.16, 0.052, 0.007, leafDark, 5, { castShadow: false });
  const leafSpecs: Array<{ x: number; y: number; rz: number; col: string }> = [
    { x: -0.065, y: -0.06, rz: 0.72, col: leafColor },
    { x: 0.065, y: -0.01, rz: -0.68, col: leafDark },
    { x: -0.06, y: 0.06, rz: 0.62, col: leafDark },
    { x: 0.06, y: 0.10, rz: -0.58, col: leafColor },
    { x: 0.01, y: 0.185, rz: -0.08, col: leafColor },
  ];
  for (const lf of leafSpecs) {
    ctx.sphere(0.052, 6, lf.col, lf.x, lf.y, 0.054, {
      scaleX: 0.65,
      scaleY: 1.2,
      scaleZ: 0.22,
      rotZ: lf.rz,
      castShadow: false,
    });
  }
}

function buildNeonSign(ctx: ModelContext): void {
  const neon = ctx.primary;
  const active = ctx.isActive;
  const tubeColor = active ? ctx.shade(neon, 0.45) : ctx.shade(neon, 0.32);
  const tubeOpts: MeshOptions = {
    roughness: active ? 0.18 : 0.3,
    metalness: 0.05,
    emissive: active ? neon : undefined,
    emissiveIntensity: active ? 1.45 : 0,
    castShadow: false,
  };

  // Smoked translucent acrylic backing plate + 4 brushed chrome corner standoffs
  ctx.box(0.68, 0.48, 0.016, '#2A2E38', 0, 0, 0.028, {
    opacity: 0.56,
    roughness: 0.22,
    metalness: 0.1,
    castShadow: false,
  });
  for (const sx of [-0.30, 0.30]) {
    for (const sy of [-0.20, 0.20]) {
      ctx.cyl(0.012, 0.012, 0.036, 6, '#C4CBD4', sx, sy, 0.024, {
        rotX: Math.PI / 2,
        metalness: 0.65,
        roughness: 0.25,
      });
    }
  }
  // Delicate dangling power cord from bottom right
  connectRod(ctx, 0.26, -0.24, 0.025, 0.30, -0.32, 0.02, 0.005, '#3E424C', 4, { castShadow: false });

  // Sculptural glowing neon heart centerpiece (2 upper half-torus lobes + 2 lower diagonal tubes)
  const zTube = 0.052;
  addMesh(ctx, new THREE.TorusGeometry(0.088, 0.016, 7, 14, Math.PI), tubeColor, -0.088, 0.055, zTube, tubeOpts);
  addMesh(ctx, new THREE.TorusGeometry(0.088, 0.016, 7, 14, Math.PI), tubeColor, 0.088, 0.055, zTube, tubeOpts);
  connectRod(ctx, -0.175, 0.055, zTube, 0, -0.155, zTube, 0.016, tubeColor, 7, tubeOpts);
  connectRod(ctx, 0.175, 0.055, zTube, 0, -0.155, zTube, 0.016, tubeColor, 7, tubeOpts);
  ctx.sphere(0.017, 6, tubeColor, 0, -0.155, zTube, tubeOpts);
  ctx.sphere(0.017, 6, tubeColor, 0, 0.055, zTube, tubeOpts);

  // Cute neon sparkle star accent on right + mini wave bar on left
  const sparkColor = active ? '#FFF5D6' : '#DCE2EA';
  const sparkOpts: MeshOptions = {
    roughness: 0.2,
    emissive: active ? '#FFE299' : undefined,
    emissiveIntensity: active ? 1.25 : 0,
    castShadow: false,
  };
  ctx.box(0.018, 0.11, 0.020, sparkColor, 0.245, 0.11, zTube, sparkOpts);
  ctx.box(0.11, 0.018, 0.010, sparkColor, 0.245, 0.11, zTube, sparkOpts);
  // Subtle wavy pulse underline on bottom-left
  connectRod(ctx, -0.27, -0.09, zTube, -0.21, -0.05, zTube, 0.011, sparkColor, 5, sparkOpts);
  connectRod(ctx, -0.21, -0.05, zTube, -0.16, -0.10, zTube, 0.011, sparkColor, 5, sparkOpts);

  // Soft translucent neon aura halo when lit!
  if (active) {
    ctx.sphere(0.22, 8, neon, 0, -0.01, 0.044, {
      scaleX: 1.25,
      scaleY: 1.0,
      scaleZ: 0.16,
      opacity: 0.22,
      emissive: neon,
      emissiveIntensity: 0.95,
      castShadow: false,
      receiveShadow: false,
    });
  }
}

/* ============================================================================
 * 3. LIGHTING (6 items)
 * ============================================================================ */

function buildTableLamp(ctx: ModelContext): void {
  const shadeColor = ctx.primary;
  const stemColor = '#F4ECE0';
  const active = ctx.isActive;

  // Iconic mid-century mushroom lamp (Nessino / Panthella silhouette, height ~0.42)
  // Glossy flared trumpet base & slim neck
  ctx.cyl(0.068, 0.105, 0.045, 12, stemColor, 0, 0.022, 0, { roughness: 0.32 });
  ctx.cyl(0.048, 0.072, 0.18, 12, stemColor, 0, 0.13, 0, { roughness: 0.34 });
  // Brass accent ring + tiny pull switch bead
  ctx.torus(0.05, 0.008, 6, 12, '#D7B77D', 0, 0.22, 0, {
    rotX: Math.PI / 2,
    metalness: 0.55,
    roughness: 0.3,
  });
  ctx.sphere(0.012, 6, '#D7B77D', 0.055, 0.195, 0.03, { metalness: 0.55, roughness: 0.3 });

  // Warm glowing inner bulb & diffuser underneath the mushroom dome
  ctx.sphere(0.065, 8, active ? '#FFF5CC' : '#EAE3D6', 0, 0.248, 0, {
    scaleY: 0.72,
    roughness: 0.25,
    emissive: active ? '#FFE18A' : undefined,
    emissiveIntensity: active ? 1.35 : 0,
    castShadow: false,
  });

  // Broad sculpted glossy mushroom dome cap (layered hemisphere + brim + finial)
  const capOpts: MeshOptions = {
    roughness: 0.28,
    metalness: 0.04,
    emissive: active ? shadeColor : undefined,
    emissiveIntensity: active ? 0.52 : 0,
  };
  ctx.cyl(0.17, 0.20, 0.065, 14, shadeColor, 0, 0.282, 0, capOpts);
  ctx.sphere(0.172, 12, shadeColor, 0, 0.312, 0, {
    scaleY: 0.62,
    ...capOpts,
  });
  // Glossy brass/pastel top finial cap
  ctx.cyl(0.022, 0.028, 0.014, 8, '#D7B77D', 0, 0.418, 0, {
    metalness: 0.5,
    roughness: 0.3,
  });
}

function buildLampFloorArc(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const shadeColor = ctx.primary;
  const metalColor = ctx.accent;
  const active = ctx.isActive;

  // Heavy cylindrical veined marble floor base (offset slightly back so arch sweeps forward!)
  ctx.cyl(0.165, 0.175, 0.13, 12, '#EFECE5', 0, baseY + 0.065, -0.20, { roughness: 0.36 });
  ctx.cyl(0.152, 0.158, 0.018, 12, '#DCD6CA', 0, baseY + 0.135, -0.20, { roughness: 0.42 });

  // Tall sweeping metallic arch stem reaching height ~1.90
  const metalOpts: MeshOptions = { metalness: 0.48, roughness: 0.32 };
  const pts: Array<[number, number, number]> = [
    [0, baseY + 0.13, -0.20],
    [0, baseY + 1.38, -0.20],
    [0, baseY + 1.66, -0.15],
    [0, baseY + 1.83, -0.02],
    [0, baseY + 1.86, 0.13],
    [0, baseY + 1.75, 0.24],
    [0, baseY + 1.62, 0.26],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1, z1] = pts[i];
    const [x2, y2, z2] = pts[i + 1];
    connectRod(ctx, x1, y1, z1, x2, y2, z2, i === 0 ? 0.022 : 0.017, metalColor, 7, metalOpts);
  }

  // Suspended hemispherical dome shade overhanging at +Z
  const sx = 0;
  const sy = baseY + 1.54;
  const sz = 0.26;
  ctx.cyl(0.036, 0.044, 0.055, 8, metalColor, sx, sy + 0.075, sz, metalOpts);
  ctx.sphere(0.165, 12, shadeColor, sx, sy + 0.01, sz, {
    scaleY: 0.62,
    roughness: 0.4,
    emissive: active ? shadeColor : undefined,
    emissiveIntensity: active ? 0.36 : 0,
  });
  ctx.cyl(0.165, 0.195, 0.08, 12, shadeColor, sx, sy - 0.032, sz, {
    roughness: 0.42,
    emissive: active ? shadeColor : undefined,
    emissiveIntensity: active ? 0.42 : 0,
  });

  // Glowing warm diffuser bulb under the dome
  ctx.sphere(0.068, 8, active ? '#FFF3C4' : '#EAE4D8', sx, sy - 0.068, sz, {
    scaleY: 0.7,
    emissive: active ? '#FFE18C' : undefined,
    emissiveIntensity: active ? 1.35 : 0,
    castShadow: false,
  });
}

function buildLampPendant(ctx: ModelContext): void {
  const paper = ctx.primary;
  const trim = ctx.accent;
  const active = ctx.isActive;

  // Ceiling canopy & slim braided cord hanging downward from y = 0
  ctx.cyl(0.055, 0.065, 0.024, 10, trim, 0, -0.012, 0, { roughness: 0.55 });
  ctx.cyl(0.01, 0.01, 0.20, 6, ctx.shade(trim, -0.25), 0, -0.12, 0, { roughness: 0.85 });

  // Top wooden collar + bottom finial ring
  ctx.cyl(0.068, 0.08, 0.026, 10, trim, 0, -0.225, 0, { roughness: 0.62 });
  ctx.cyl(0.055, 0.045, 0.022, 10, trim, 0, -0.545, 0, { roughness: 0.62 });
  ctx.sphere(0.018, 6, trim, 0, -0.568, 0, { roughness: 0.6 });

  // Pleated rice-paper lantern globe (Noguchi Akari aesthetic)
  ctx.sphere(0.215, 12, paper, 0, -0.385, 0, {
    scaleX: 1.06,
    scaleY: 0.78,
    scaleZ: 1.06,
    roughness: 0.82,
    emissive: active ? '#FFE4AD' : undefined,
    emissiveIntensity: active ? 0.68 : 0,
  });

  // 4 delicate bamboo horizontal rib rings wrapping the rice paper lantern
  const ribColor = ctx.shade(trim, -0.14);
  const ribs: Array<{ y: number; r: number }> = [
    { y: -0.295, r: 0.188 },
    { y: -0.355, r: 0.222 },
    { y: -0.415, r: 0.222 },
    { y: -0.475, r: 0.186 },
  ];
  for (const rb of ribs) {
    ctx.torus(rb.r, 0.006, 5, 16, ribColor, 0, rb.y, 0, {
      rotX: Math.PI / 2,
      roughness: 0.7,
      castShadow: false,
    });
  }
}

function buildFairyLights(ctx: ModelContext): void {
  const bulbColor = ctx.primary;
  const active = ctx.isActive;
  const wireColor = '#735E4C';

  // Two brass mounting pins at upper corners (wall mounted, centered y = 0)
  ctx.cyl(0.014, 0.014, 0.032, 6, '#C9A46B', -0.42, 0.15, 0.025, { rotX: Math.PI / 2, metalness: 0.5 });
  ctx.cyl(0.014, 0.014, 0.032, 6, '#C9A46B', 0.42, 0.15, 0.025, { rotX: Math.PI / 2, metalness: 0.5 });

  // Delicate catenary draped cord across 7 warm bulbs
  const bulbCount = 7;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < bulbCount; i++) {
    const t = i / (bulbCount - 1); // 0..1
    const u = t * 2 - 1; // -1..1
    const x = u * 0.40;
    const sag = (1 - u * u) * 0.24;
    const y = 0.14 - sag;
    const z = 0.036 + (1 - u * u) * 0.024;
    pts.push([x, y, z]);
  }

  connectRod(ctx, -0.42, 0.15, 0.03, pts[0][0], pts[0][1], pts[0][2], 0.0055, wireColor, 4, { castShadow: false });
  connectRod(ctx, pts[bulbCount - 1][0], pts[bulbCount - 1][1], pts[bulbCount - 1][2], 0.42, 0.15, 0.03, 0.0055, wireColor, 4, { castShadow: false });
  for (let i = 0; i < bulbCount - 1; i++) {
    connectRod(ctx, pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], 0.0055, wireColor, 4, {
      castShadow: false,
    });
  }

  // 7 tiny warm fairy bulbs dangling from mini brass sockets
  for (let i = 0; i < bulbCount; i++) {
    const [bx, by, bz] = pts[i];
    const drop = i % 2 === 1 ? 0.055 : 0.032;
    if (i % 2 === 1) {
      connectRod(ctx, bx, by, bz, bx, by - drop + 0.02, bz + 0.006, 0.004, wireColor, 4, { castShadow: false });
    }
    ctx.cyl(0.01, 0.011, 0.018, 6, '#C4A068', bx, by - drop + 0.018, bz + 0.006, {
      metalness: 0.45,
      roughness: 0.35,
      castShadow: false,
    });
    ctx.sphere(0.024, 6, active ? ctx.shade(bulbColor, 0.35) : '#E9E2D4', bx, by - drop - 0.005, bz + 0.006, {
      scaleY: 1.2,
      roughness: 0.22,
      emissive: active ? bulbColor : undefined,
      emissiveIntensity: active ? 1.45 : 0,
      castShadow: false,
    });
    if (active) {
      ctx.sphere(0.048, 6, bulbColor, bx, by - drop - 0.005, bz + 0.006, {
        opacity: 0.22,
        emissive: bulbColor,
        emissiveIntensity: 0.9,
        castShadow: false,
        receiveShadow: false,
      });
    }
  }
}

function buildLampDesk(ctx: ModelContext): void {
  const body = ctx.primary;
  const trim = ctx.accent;
  const active = ctx.isActive;

  // Weighted stepped circular desk base (sits at surface y = 0)
  ctx.cyl(0.092, 0.105, 0.028, 12, body, 0, 0.014, -0.05, { roughness: 0.42 });
  ctx.cyl(0.068, 0.082, 0.016, 10, ctx.shade(body, -0.08), 0, 0.036, -0.05, { roughness: 0.45 });
  // Tiny metallic rocker switch button resting cleanly forward of upper tier
  ctx.box(0.022, 0.012, 0.018, trim, 0.045, 0.034, 0.044, { metalness: 0.4, roughness: 0.35 });

  // Articulated architect swing-arm (base pivot -> rear elbow -> upper wrist)
  const metalOpts: MeshOptions = { metalness: 0.42, roughness: 0.36 };
  connectRod(ctx, -0.014, 0.04, -0.055, -0.014, 0.23, -0.145, 0.008, trim, 6, metalOpts);
  connectRod(ctx, 0.014, 0.04, -0.055, 0.014, 0.23, -0.145, 0.008, trim, 6, metalOpts);
  // Elbow tension knob
  ctx.cyl(0.022, 0.022, 0.046, 8, body, 0, 0.23, -0.145, { rotZ: Math.PI / 2, roughness: 0.45 });

  // Upper swing arm reaching forward (+Z)
  connectRod(ctx, 0, 0.23, -0.145, 0, 0.395, 0.05, 0.01, trim, 6, metalOpts);
  ctx.sphere(0.018, 6, trim, 0, 0.395, 0.05, metalOpts);

  // Angled conical architect shade pointing forward-downward (+Z, -Y) onto desk
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.38, 0.065);
  headGroup.rotation.x = -0.45;
  ctx.group.add(headGroup);

  ctx.cyl(0.026, 0.032, 0.045, 8, trim, 0, 0.03, 0, { parent: headGroup, ...metalOpts });
  ctx.cyl(0.034, 0.095, 0.11, 10, body, 0, -0.035, 0, {
    roughness: 0.4,
    emissive: active ? body : undefined,
    emissiveIntensity: active ? 0.22 : 0,
    parent: headGroup,
  });
  // Warm bulb nestled inside cone
  ctx.sphere(0.038, 7, active ? '#FFF4C8' : '#ECE6DA', 0, -0.075, 0, {
    emissive: active ? '#FFE28A' : undefined,
    emissiveIntensity: active ? 1.4 : 0,
    parent: headGroup,
    castShadow: false,
  });
  // Soft warm light cone cast downward when active
  if (active) {
    ctx.cyl(0.075, 0.145, 0.18, 10, '#FFE9A8', 0, -0.17, 0, {
      opacity: 0.16,
      emissive: '#FFE499',
      emissiveIntensity: 0.7,
      parent: headGroup,
      castShadow: false,
      receiveShadow: false,
    });
  }
}

function buildLampLava(ctx: ModelContext): void {
  const wax = ctx.primary;
  const metal = ctx.accent;
  const active = ctx.isActive;
  const metalOpts: MeshOptions = { metalness: 0.58, roughness: 0.28 };

  // Retro tapered hourglass metallic base (sits at y = 0)
  ctx.cyl(0.052, 0.088, 0.092, 12, metal, 0, 0.046, 0, metalOpts);
  ctx.cyl(0.084, 0.052, 0.05, 12, metal, 0, 0.117, 0, metalOpts);

  // Floating pastel lava wax blobs inside the glass vessel
  const blobColor = active ? ctx.shade(wax, 0.18) : wax;
  const blobOpts: MeshOptions = {
    roughness: 0.34,
    emissive: active ? wax : undefined,
    emissiveIntensity: active ? 1.15 : 0,
    castShadow: false,
  };
  // Melted wax pool at bottom of glass
  ctx.sphere(0.062, 8, blobColor, 0, 0.168, 0, { scaleY: 0.56, ...blobOpts });
  // Rising & drifting lava blobs
  ctx.sphere(0.036, 7, blobColor, -0.022, 0.232, 0.016, { scaleY: 1.28, ...blobOpts });
  ctx.sphere(0.026, 7, ctx.shade(blobColor, 0.12), 0.024, 0.278, -0.012, { scaleY: 1.18, ...blobOpts });
  ctx.sphere(0.031, 7, blobColor, 0.005, 0.332, 0.01, { scaleY: 1.24, ...blobOpts });
  ctx.sphere(0.018, 6, ctx.shade(blobColor, 0.16), -0.015, 0.305, -0.018, blobOpts);

  // Clear tapered glass rocket vessel surrounding the blobs
  ctx.cyl(0.048, 0.084, 0.245, 12, active ? ctx.shade(wax, 0.45) : '#E2EDF2', 0, 0.264, 0, {
    opacity: 0.34,
    roughness: 0.12,
    metalness: 0.08,
    emissive: active ? wax : undefined,
    emissiveIntensity: active ? 0.28 : 0,
    castShadow: false,
  });

  // Tapered metallic rocket top cap (reaches height ~0.46)
  ctx.cyl(0.028, 0.05, 0.072, 12, metal, 0, 0.422, 0, metalOpts);
  ctx.cyl(0.026, 0.028, 0.008, 10, ctx.shade(metal, -0.1), 0, 0.46, 0, metalOpts);
}

/* ============================================================================
 * 4. BOOKSHELVES, CURTAINS, MIRRORS, RUGS (7 items)
 * ============================================================================ */

function buildBookshelfTall(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const wood = ctx.primary;
  const woodBack = ctx.shade(wood, -0.12);
  const w = 0.84;
  const h = 1.72;
  const d = 0.38;

  // Frame: bottom plinth, top crown cap, non-overlapping side panels & recessed back panel
  const plinthH = 0.075;
  const crownH = 0.052;
  const sideH = h - plinthH - crownH;
  const sideY = baseY + plinthH + sideH / 2;
  ctx.box(w, plinthH, d, ctx.shade(wood, -0.06), 0, baseY + plinthH / 2, 0, { roughness: 0.74 });
  ctx.box(w + 0.03, crownH, d + 0.03, wood, 0, baseY + h - crownH / 2, 0, { roughness: 0.68 });
  ctx.box(0.042, sideH, d, wood, -w / 2 + 0.021, sideY, 0, { roughness: 0.72 });
  ctx.box(0.042, sideH, d, wood, w / 2 - 0.021, sideY, 0, { roughness: 0.72 });
  ctx.box(w - 0.086, sideH, 0.024, woodBack, 0, sideY, -d / 2 + 0.018, { roughness: 0.8 });

  // 3 interior shelves strictly between side panels and in front of back panel
  const shelfYs = [baseY + 0.46, baseY + 0.86, baseY + 1.26];
  for (const sy of shelfYs) {
    ctx.box(w - 0.086, 0.032, d - 0.038, wood, 0, sy, 0.016, { roughness: 0.72 });
  }

  // Packed colorful varied books across all 4 tiers (upright + leaning!)
  const shelfBases = [baseY + 0.075, baseY + 0.476, baseY + 0.876, baseY + 1.276];
  const bookPalette = ['#DF9A87', '#94BFA2', '#E8CB84', '#98B5CE', '#E8BCC2', '#C5B0D8', '#D7A87E'];

  // Tier 0 (bottom): upright row + small horizontal stack
  const tier0 = [
    { x: -0.31, bw: 0.055, bh: 0.28, c: bookPalette[0] },
    { x: -0.25, bw: 0.048, bh: 0.25, c: bookPalette[1] },
    { x: -0.19, bw: 0.06, bh: 0.30, c: bookPalette[3] },
    { x: -0.125, bw: 0.052, bh: 0.26, c: bookPalette[2] },
    { x: -0.05, bw: 0.05, bh: 0.27, c: bookPalette[4], lean: 0.22 },
  ];
  for (const b of tier0) {
    ctx.box(b.bw, b.bh, 0.22, b.c, b.x, shelfBases[0] + b.bh / 2, 0.03, { rotZ: b.lean ?? 0 });
  }
  ctx.box(0.24, 0.048, 0.21, '#EFE5D6', 0.21, shelfBases[0] + 0.024, 0.03);
  ctx.box(0.21, 0.044, 0.19, bookPalette[5], 0.20, shelfBases[0] + 0.07, 0.03);

  // Tier 1: dense right-aligned colorful books + leaning accent
  const tier1 = [
    { x: 0.31, bw: 0.055, bh: 0.29, c: bookPalette[3] },
    { x: 0.25, bw: 0.05, bh: 0.24, c: bookPalette[2] },
    { x: 0.19, bw: 0.058, bh: 0.28, c: bookPalette[0] },
    { x: 0.125, bw: 0.052, bh: 0.26, c: bookPalette[6] },
    { x: 0.045, bw: 0.048, bh: 0.25, c: bookPalette[1], lean: -0.24 },
  ];
  for (const b of tier1) {
    ctx.box(b.bw, b.bh, 0.22, b.c, b.x, shelfBases[1] + b.bh / 2, 0.03, { rotZ: b.lean ?? 0 });
  }
  // Ceramic bookend sphere on left of Tier 1
  ctx.sphere(0.065, 7, '#EFE6D8', -0.24, shelfBases[1] + 0.062, 0.04);

  // Tier 2: mini potted trailing plant on left + colorful books on right
  ctx.cyl(0.07, 0.052, 0.10, 8, '#D68E72', -0.22, shelfBases[2] + 0.05, 0.04);
  ctx.sphere(0.078, 6, '#8DC09A', -0.22, shelfBases[2] + 0.125, 0.04, { scaleY: 0.85 });
  ctx.sphere(0.045, 5, '#A1CFA9', -0.17, shelfBases[2] + 0.065, 0.11);
  const tier2 = [
    { x: 0.04, bw: 0.055, bh: 0.26, c: bookPalette[4] },
    { x: 0.105, bw: 0.058, bh: 0.29, c: bookPalette[5] },
    { x: 0.17, bw: 0.05, bh: 0.23, c: bookPalette[2] },
    { x: 0.23, bw: 0.055, bh: 0.27, c: bookPalette[0] },
    { x: 0.295, bw: 0.055, bh: 0.25, c: bookPalette[3] },
  ];
  for (const b of tier2) {
    ctx.box(b.bw, b.bh, 0.22, b.c, b.x, shelfBases[2] + b.bh / 2, 0.03);
  }

  // Tier 3 (top): left books + cute framed photo / vase accent
  const tier3 = [
    { x: -0.31, bw: 0.056, bh: 0.27, c: bookPalette[1] },
    { x: -0.245, bw: 0.055, bh: 0.24, c: bookPalette[0] },
    { x: -0.18, bw: 0.058, bh: 0.28, c: bookPalette[2] },
    { x: -0.105, bw: 0.05, bh: 0.25, c: bookPalette[3], lean: 0.2 },
  ];
  for (const b of tier3) {
    ctx.box(b.bw, b.bh, 0.22, b.c, b.x, shelfBases[3] + b.bh / 2, 0.03, { rotZ: b.lean ?? 0 });
  }
  ctx.cyl(0.045, 0.062, 0.16, 8, '#E9DFCF', 0.20, shelfBases[3] + 0.08, 0.04);
}

function buildBookshelfLow(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.85;
  const wood = ctx.primary;
  const woodDark = ctx.shade(wood, -0.12);
  const accent = ctx.accent;

  const w = 1.84;
  const d = 0.46;
  const legH = 0.11;
  const bottomY = baseY + legH;
  const boardH = 0.044;
  const topBoardBotY = topY - boardH;
  const innerH = topBoardBotY - (bottomY + boardH);

  // 4 tapered mid-century legs touching FLOOR_BASE_Y
  ctx.legs(w, d, legH, 0.026, woodDark, baseY, 0.11);

  // Bottom board + flat top surface flush at EXACTLY `surfaceHeight` (0.85)
  ctx.box(w, boardH, d, wood, 0, bottomY + boardH / 2, 0, { roughness: 0.7 });
  ctx.box(w + 0.02, boardH, d + 0.02, wood, 0, topY - boardH / 2, 0, { roughness: 0.66 });

  // Outer side walls, center divider, recessed solid back panel, and split left/right mid shelves
  const innerMidY = bottomY + boardH + innerH / 2;
  ctx.box(0.044, innerH, d, wood, -w / 2 + 0.022, innerMidY, 0, { roughness: 0.72 });
  ctx.box(0.044, innerH, d, wood, w / 2 - 0.022, innerMidY, 0, { roughness: 0.72 });
  ctx.box(w - 0.09, innerH, 0.024, woodDark, 0, innerMidY, -d / 2 + 0.018, { roughness: 0.8 });
  ctx.box(0.038, innerH, d - 0.036, wood, 0, innerMidY, 0.015, { roughness: 0.72 });
  const halfShelfW = (w - 0.088 - 0.040) / 2;
  ctx.box(halfShelfW, 0.03, d - 0.038, wood, -(0.020 + halfShelfW / 2), innerMidY, 0.015, { roughness: 0.72 });
  ctx.box(halfShelfW, 0.03, d - 0.038, wood, 0.020 + halfShelfW / 2, innerMidY, 0.015, { roughness: 0.72 });

  // Cubby contents!
  const lowerFloor = bottomY + boardH;
  const upperFloor = innerMidY + 0.015;

  // Bottom-left cubby: colorful upright art books
  const blBooks = [
    { x: -0.78, bw: 0.06, bh: 0.24, c: accent },
    { x: -0.71, bw: 0.055, bh: 0.21, c: '#E5A894' },
    { x: -0.645, bw: 0.062, bh: 0.25, c: '#E9CD88' },
    { x: -0.575, bw: 0.055, bh: 0.22, c: '#9EB8CF' },
    { x: -0.495, bw: 0.052, bh: 0.23, c: '#E8BDC3', lean: 0.2 },
    { x: -0.22, bw: 0.24, bh: 0.05, c: '#F1E6D6' },
    { x: -0.21, bw: 0.20, bh: 0.046, c: accent, yOff: 0.05 },
  ];
  for (const b of blBooks) {
    ctx.box(b.bw, b.bh, 0.24, b.c, b.x, lowerFloor + b.bh / 2 + (b.yOff ?? 0), 0.04, {
      rotZ: b.lean ?? 0,
    });
  }

  // Bottom-right cubby: woven seagrass storage basket with front handle cutout!
  ctx.box(0.56, 0.23, 0.34, '#D6B990', 0.46, lowerFloor + 0.115, 0.03, { roughness: 0.88 });
  ctx.box(0.58, 0.026, 0.36, '#C4A478', 0.46, lowerFloor + 0.232, 0.03, { roughness: 0.86 });
  ctx.box(0.14, 0.038, 0.025, '#8A6F50', 0.46, lowerFloor + 0.165, 0.202);

  // Top-left cubby: cute ceramic bowl + stacked coffee-table books
  ctx.cyl(0.095, 0.065, 0.09, 9, '#F1E8DA', -0.64, upperFloor + 0.045, 0.04, { roughness: 0.52 });
  ctx.box(0.32, 0.05, 0.24, '#DF9D8C', -0.28, upperFloor + 0.025, 0.04);
  ctx.box(0.28, 0.046, 0.22, accent, -0.27, upperFloor + 0.073, 0.04);

  // Top-right cubby: upright colorful books + leaning book
  const trBooks = [
    { x: 0.16, bw: 0.058, bh: 0.23, c: '#94BFA2' },
    { x: 0.225, bw: 0.052, bh: 0.20, c: '#F1E6D6' },
    { x: 0.29, bw: 0.06, bh: 0.24, c: '#E5A894' },
    { x: 0.355, bw: 0.055, bh: 0.21, c: accent },
    { x: 0.42, bw: 0.056, bh: 0.23, c: '#C6B0D8' },
    { x: 0.50, bw: 0.05, bh: 0.22, c: '#E9CD88', lean: 0.22 },
  ];
  for (const b of trBooks) {
    ctx.box(b.bw, b.bh, 0.23, b.c, b.x, upperFloor + b.bh / 2, 0.04, { rotZ: b.lean ?? 0 });
  }
}

function buildBookshelfWall(ctx: ModelContext): void {
  const wood = ctx.primary;
  const accent = ctx.accent;

  // Floating wooden ledge mounted on wall (back at z = 0.015)
  ctx.box(0.80, 0.044, 0.22, wood, 0, -0.10, 0.125, { roughness: 0.7 });
  // Slim rear lip strictly atop ledge & underside brackets strictly below ledge (non-coplanar backs)
  ctx.box(0.788, 0.048, 0.022, ctx.shade(wood, -0.08), 0, -0.054, 0.032, { roughness: 0.72 });
  ctx.box(0.036, 0.056, 0.14, ctx.shade(wood, -0.16), -0.28, -0.150, 0.095);
  ctx.box(0.036, 0.056, 0.14, ctx.shade(wood, -0.16), 0.28, -0.150, 0.095);

  const ledgeTop = -0.078;
  // Minimalist arched brass bookends flanking the books
  ctx.box(0.024, 0.15, 0.12, '#D4B47A', -0.32, ledgeTop + 0.075, 0.13, { metalness: 0.45, roughness: 0.35 });
  ctx.box(0.024, 0.15, 0.12, '#D4B47A', 0.10, ledgeTop + 0.075, 0.13, { metalness: 0.45, roughness: 0.35 });

  // Colorful books (4 upright + 1 leaning)
  const books = [
    { x: -0.275, bw: 0.048, bh: 0.21, c: accent },
    { x: -0.22, bw: 0.052, bh: 0.19, c: '#F1E6D6' },
    { x: -0.162, bw: 0.054, bh: 0.22, c: '#97B7CE' },
    { x: -0.105, bw: 0.048, bh: 0.18, c: '#EBD08A' },
    { x: -0.025, bw: 0.046, bh: 0.20, c: '#9DC4A6', lean: 0.22 },
  ];
  for (const b of books) {
    ctx.box(b.bw, b.bh, 0.16, b.c, b.x, ledgeTop + b.bh / 2, 0.135, { rotZ: b.lean ?? 0 });
  }

  // Tiny potted succulent accent on right end of wall shelf
  ctx.cyl(0.055, 0.042, 0.078, 8, '#EFE6D8', 0.26, ledgeTop + 0.039, 0.135);
  ctx.sphere(0.058, 6, '#90BF9A', 0.26, ledgeTop + 0.095, 0.135, { scaleY: 0.72 });
}

function buildCurtainsLinen(ctx: ModelContext): void {
  const linen = ctx.primary;
  const linenFold = ctx.shade(linen, -0.07);
  const rodColor = ctx.accent;

  // Curtain rod across top (y = +0.85, framing a 1-tile window) + brackets + round finials
  ctx.cyl(0.016, 0.016, 1.02, 8, rodColor, 0, 0.855, 0.085, { rotZ: Math.PI / 2, roughness: 0.55 });
  ctx.sphere(0.034, 8, rodColor, -0.52, 0.855, 0.085, { roughness: 0.5 });
  ctx.sphere(0.034, 8, rodColor, 0.52, 0.855, 0.085, { roughness: 0.5 });
  ctx.box(0.028, 0.048, 0.085, ctx.shade(rodColor, -0.15), -0.44, 0.855, 0.048);
  ctx.box(0.028, 0.048, 0.085, ctx.shade(rodColor, -0.15), 0.44, 0.855, 0.048);

  // Left & right pleated draped linen panels with soft mid-height tiebacks
  for (const side of [-1, 1]) {
    const cx = side * 0.34;
    // Upper pleated header & 3 vertical folds stopping cleanly inside tieback
    ctx.cyl(0.032, 0.028, 0.92, 6, linen, cx - side * 0.065, 0.39, 0.085, { scaleZ: 0.85, roughness: 0.88 });
    ctx.cyl(0.034, 0.026, 0.92, 6, linenFold, cx, 0.39, 0.105, { scaleZ: 0.85, roughness: 0.9 });
    ctx.cyl(0.032, 0.024, 0.92, 6, linen, cx + side * 0.065, 0.39, 0.082, { scaleZ: 0.85, roughness: 0.88 });

    // Lower gently flared pleated drape starting cleanly below tieback
    ctx.cyl(0.028, 0.042, 0.80, 6, linen, cx - side * 0.06, -0.50, 0.088, {
      rotZ: side * 0.04,
      scaleZ: 0.9,
      roughness: 0.88,
    });
    ctx.cyl(0.028, 0.044, 0.80, 6, linenFold, cx + side * 0.01, -0.50, 0.11, {
      rotZ: -side * 0.02,
      scaleZ: 0.9,
      roughness: 0.9,
    });
    ctx.cyl(0.026, 0.04, 0.80, 6, linen, cx + side * 0.075, -0.50, 0.085, {
      rotZ: -side * 0.05,
      scaleZ: 0.9,
      roughness: 0.88,
    });

    // Warm woven tieback sash cinching the panel at waist height
    ctx.box(0.18, 0.046, 0.088, rodColor, cx, -0.09, 0.092, { rotZ: side * 0.12, roughness: 0.78 });
  }
}

function buildMirrorArch(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const glass = ctx.primary;
  const frame = ctx.accent;
  const isBrass = ctx.variant.id === 'brass';
  const frameOpts: MeshOptions = {
    metalness: isBrass ? 0.55 : 0.06,
    roughness: isBrass ? 0.3 : 0.65,
  };

  // Gently reclined standing arch mirror group pivoted at base
  const body = new THREE.Group();
  body.position.set(0, baseY, 0.05);
  body.rotation.x = -0.085;
  ctx.group.add(body);

  const r = 0.295; // total width ~0.62, top reaches ~1.74
  const rectH = 1.40;
  const archY = rectH;

  // Frame: left/right vertical rails resting cleanly atop bottom sill + curved semi-circular arch crown
  const sillH = 0.046;
  const sideRailH = rectH - sillH;
  ctx.box(0.042, sideRailH, 0.048, frame, -r, sillH + sideRailH / 2, 0, { ...frameOpts, parent: body });
  ctx.box(0.042, sideRailH, 0.048, frame, r, sillH + sideRailH / 2, 0, { ...frameOpts, parent: body });
  ctx.box(r * 2 + 0.042, sillH, 0.052, frame, 0, sillH / 2, 0, { ...frameOpts, parent: body });
  addMesh(ctx, new THREE.TorusGeometry(r, 0.024, 7, 18, Math.PI), frame, 0, archY, 0, {
    ...frameOpts,
    parent: body,
  });

  // Seamless single-piece extruded backing arch (zero seam or coplanar overlap)
  const backShape = new THREE.Shape();
  const backR = r - 0.018;
  backShape.moveTo(-backR, sillH);
  backShape.lineTo(backR, sillH);
  backShape.lineTo(backR, archY);
  backShape.absarc(0, archY, backR, 0, Math.PI, false);
  backShape.closePath();
  addMesh(
    ctx,
    new THREE.ExtrudeGeometry(backShape, { depth: 0.016, bevelEnabled: false, curveSegments: 16 }),
    ctx.shade(frame, -0.2),
    0,
    0,
    -0.022,
    { parent: body },
  );

  // Seamless single-piece extruded reflective sky-tinted glass arch cleanly proud of backing
  const glassShape = new THREE.Shape();
  const glassR = r - 0.022;
  glassShape.moveTo(-glassR, sillH + 0.002);
  glassShape.lineTo(glassR, sillH + 0.002);
  glassShape.lineTo(glassR, archY);
  glassShape.absarc(0, archY, glassR, 0, Math.PI, false);
  glassShape.closePath();
  addMesh(
    ctx,
    new THREE.ExtrudeGeometry(glassShape, { depth: 0.010, bevelEnabled: false, curveSegments: 16 }),
    glass,
    0,
    0,
    0.002,
    {
      roughness: 0.1,
      metalness: 0.36,
      parent: body,
      castShadow: false,
    },
  );

  // Subtle diagonal pale-white specular highlight streaks on glass
  ctx.box(0.052, 0.56, 0.004, '#F5FBFF', -0.05, 1.12, 0.018, {
    rotZ: -0.58,
    opacity: 0.55,
    roughness: 0.1,
    parent: body,
    castShadow: false,
  });
  ctx.box(0.022, 0.44, 0.004, '#F5FBFF', 0.05, 0.96, 0.018, {
    rotZ: -0.58,
    opacity: 0.42,
    roughness: 0.1,
    parent: body,
    castShadow: false,
  });

  // Rear easel stand prop leg touching FLOOR_BASE_Y
  connectRod(ctx, 0, baseY + 1.12, -0.07, 0, baseY + 0.015, -0.34, 0.018, ctx.shade(frame, -0.14), 6, frameOpts);
  connectRod(ctx, 0, baseY + 0.42, -0.01, 0, baseY + 0.42, -0.23, 0.008, '#9A8B7A', 5);
}

function buildMirrorRound(ctx: ModelContext): void {
  const glass = ctx.primary;
  const frame = ctx.accent;
  const isBrass = ctx.variant.id === 'brass';
  const frameOpts: MeshOptions = {
    metalness: isBrass ? 0.55 : 0.06,
    roughness: isBrass ? 0.3 : 0.62,
  };
  const cy = -0.06;
  const r = 0.245;

  // Circular mirror frame (drum + sculpted rim torus)
  ctx.cyl(r + 0.018, r + 0.018, 0.036, 18, frame, 0, cy, 0.032, {
    rotX: Math.PI / 2,
    ...frameOpts,
  });
  ctx.torus(r + 0.004, 0.02, 7, 20, frame, 0, cy, 0.048, frameOpts);

  // Reflective sky-tinted circular glass face (cleanly proud of drum)
  ctx.cyl(r - 0.008, r - 0.008, 0.010, 18, glass, 0, cy, 0.052, {
    rotX: Math.PI / 2,
    roughness: 0.1,
    metalness: 0.36,
    castShadow: false,
  });

  // Crisp diagonal specular reflection glints
  ctx.box(0.044, 0.34, 0.004, '#F6FCFF', -0.04, cy + 0.02, 0.061, {
    rotZ: -0.62,
    opacity: 0.56,
    roughness: 0.1,
    castShadow: false,
  });
  ctx.box(0.018, 0.26, 0.004, '#F6FCFF', 0.055, cy - 0.03, 0.061, {
    rotZ: -0.62,
    opacity: 0.4,
    roughness: 0.1,
    castShadow: false,
  });

  // Cognac leather hanging strap looping up to turned wall peg knob!
  const pegY = 0.305;
  connectRod(ctx, -r - 0.005, cy + 0.04, 0.034, 0, pegY, 0.034, 0.011, '#B37B54', 5, { roughness: 0.72 });
  connectRod(ctx, r + 0.005, cy + 0.04, 0.034, 0, pegY, 0.034, 0.011, '#B37B54', 5, { roughness: 0.72 });
  ctx.cyl(0.026, 0.022, 0.042, 8, frame, 0, pegY, 0.032, { rotX: Math.PI / 2, ...frameOpts });
}

function buildRugRunner(ctx: ModelContext): void {
  const baseY = 0.032;
  const main = ctx.primary;
  const accent = ctx.accent;
  const border = ctx.shade(main, -0.1);
  const w = 0.76;
  const len = 2.66;

  // Flat woven hallway runner base sitting strictly at y >= 0.032 (clear of floor tiles & grid!)
  ctx.box(w, 0.012, len, main, 0, baseY + 0.006, 0, { roughness: 0.92, castShadow: false });
  // Subtle woven outer border side trim (raised 0.005 above base, stopping clear of end stripe bands)
  ctx.box(0.055, 0.005, 1.76, border, -w / 2 + 0.035, baseY + 0.0145, 0, { roughness: 0.94, castShadow: false });
  ctx.box(0.055, 0.005, 1.76, border, w / 2 - 0.035, baseY + 0.0145, 0, { roughness: 0.94, castShadow: false });

  // End geometric stripe bands (strictly beyond z = ±0.88 so zero overlap with side borders)
  for (const sz of [-1, 1]) {
    ctx.box(w - 0.04, 0.005, 0.085, accent, 0, baseY + 0.0145, sz * 1.16, { roughness: 0.94, castShadow: false });
    ctx.box(w - 0.08, 0.005, 0.042, border, 0, baseY + 0.0145, sz * 1.03, { roughness: 0.94, castShadow: false });
    ctx.box(w - 0.08, 0.005, 0.032, accent, 0, baseY + 0.0145, sz * 0.94, { roughness: 0.94, castShadow: false });
  }

  // 3 geometric woven diamond medallions running down the runner center (strictly layered heights)
  for (const dz of [-0.56, 0, 0.56]) {
    ctx.box(0.24, 0.005, 0.24, accent, 0, baseY + 0.0145, dz, {
      rotY: Math.PI / 4,
      roughness: 0.94,
      castShadow: false,
    });
    ctx.box(0.11, 0.005, 0.11, border, 0, baseY + 0.0195, dz, {
      rotY: Math.PI / 4,
      roughness: 0.94,
      castShadow: false,
    });
  }

  // Fringe tassels starting strictly outside rug short ends
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const tx = -0.28 + i * 0.14;
      ctx.box(0.026, 0.008, 0.09, accent, tx, baseY + 0.005, sz * (len / 2 + 0.049), {
        roughness: 0.95,
        castShadow: false,
      });
    }
  }
}

/* ============================================================================
 * 5. PLUSHIES & COZY ACCENTS (9 items)
 * ============================================================================ */

function buildPlushieBear(ctx: ModelContext): void {
  const fur = ctx.primary;
  const patch = ctx.accent;
  const dark = '#362B26';

  // Plump seated teddy torso + oval belly patch (sits flush at surface y = 0)
  ctx.sphere(0.112, 9, fur, 0, 0.112, -0.01, { scaleX: 1.02, scaleY: 0.96, scaleZ: 0.92, roughness: 0.88 });
  ctx.sphere(0.072, 7, patch, 0, 0.108, 0.055, { scaleX: 0.92, scaleY: 1.0, scaleZ: 0.62, roughness: 0.9 });

  // Seated stubby legs pointing forward (+Z) with light paw pads
  for (const sx of [-0.072, 0.072]) {
    ctx.sphere(0.05, 7, fur, sx, 0.044, 0.082, { scaleX: 0.85, scaleY: 0.82, scaleZ: 1.25, roughness: 0.88 });
    ctx.sphere(0.031, 6, patch, sx, 0.044, 0.132, { scaleZ: 0.45, roughness: 0.9 });
  }

  // Stubby cozy arms hugging slightly forward
  for (const sx of [-1, 1]) {
    ctx.sphere(0.044, 7, fur, sx * 0.115, 0.135, 0.025, {
      scaleX: 0.78,
      scaleY: 1.18,
      scaleZ: 0.82,
      rotZ: sx * 0.42,
      rotX: -0.35,
      roughness: 0.88,
    });
  }

  // Cute round head + round teddy ears with inner ear pads
  ctx.sphere(0.102, 9, fur, 0, 0.255, 0.0, { scaleX: 1.06, scaleY: 0.95, scaleZ: 0.96, roughness: 0.88 });
  for (const sx of [-0.082, 0.082]) {
    ctx.sphere(0.04, 7, fur, sx, 0.335, -0.005, { scaleZ: 0.62, roughness: 0.88 });
    ctx.sphere(0.023, 6, patch, sx, 0.335, 0.015, { scaleZ: 0.4, roughness: 0.9 });
  }

  // Protruding snout, dark button nose & button eyes
  ctx.sphere(0.044, 7, patch, 0, 0.236, 0.082, { scaleX: 1.15, scaleY: 0.82, scaleZ: 0.78, roughness: 0.88 });
  ctx.sphere(0.016, 6, dark, 0, 0.248, 0.114, { scaleX: 1.25, scaleY: 0.85, roughness: 0.35 });
  ctx.sphere(0.013, 6, dark, -0.042, 0.272, 0.088, { roughness: 0.25 });
  ctx.sphere(0.013, 6, dark, 0.042, 0.272, 0.088, { roughness: 0.25 });

  // Little cozy bow tie at neck
  ctx.box(0.068, 0.022, 0.02, '#E498A0', 0, 0.172, 0.082, { roughness: 0.78 });
}

function buildPlushieCat(ctx: ModelContext): void {
  const body = ctx.primary;
  const cream = ctx.accent;
  const dark = '#362D30';

  // Squishy round mochi-bun body (sits flush at y = 0)
  ctx.sphere(0.142, 10, body, 0, 0.124, 0, { scaleX: 1.16, scaleY: 0.86, scaleZ: 1.02, roughness: 0.86 });
  // Cream belly bib
  ctx.sphere(0.092, 7, cream, 0, 0.088, 0.086, { scaleX: 1.05, scaleY: 0.82, scaleZ: 0.6, roughness: 0.88 });

  // Tiny tucked front mochi paws
  ctx.sphere(0.034, 6, cream, -0.062, 0.036, 0.125, { scaleX: 1.1, scaleY: 0.75, scaleZ: 0.9 });
  ctx.sphere(0.034, 6, cream, 0.062, 0.036, 0.125, { scaleX: 1.1, scaleY: 0.75, scaleZ: 0.9 });

  // Pointed triangular cat ears with soft pink inner triangles
  for (const sx of [-1, 1]) {
    ctx.cone(0.052, 0.095, 4, body, sx * 0.085, 0.245, 0.008, {
      rotZ: -sx * 0.28,
      rotY: Math.PI / 4,
      scaleZ: 0.68,
      roughness: 0.86,
    });
    ctx.cone(0.028, 0.054, 4, '#F4AEBA', sx * 0.082, 0.242, 0.032, {
      rotZ: -sx * 0.28,
      rotY: Math.PI / 4,
      scaleZ: 0.4,
      roughness: 0.84,
    });
  }

  // Kawaii face: dark eyes, pink nose, rosy blushing cheeks & whiskers
  ctx.sphere(0.015, 6, dark, -0.055, 0.142, 0.132, { roughness: 0.25 });
  ctx.sphere(0.015, 6, dark, 0.055, 0.142, 0.132, { roughness: 0.25 });
  ctx.sphere(0.013, 5, '#E994A6', 0, 0.125, 0.144, { scaleX: 1.25, scaleY: 0.8 });
  ctx.sphere(0.026, 6, '#F4A6B4', -0.094, 0.118, 0.114, { scaleX: 1.2, scaleY: 0.72, scaleZ: 0.4 });
  ctx.sphere(0.026, 6, '#F4A6B4', 0.094, 0.118, 0.114, { scaleX: 1.2, scaleY: 0.72, scaleZ: 0.4 });

  // Cute stubby tail curled up at back
  ctx.sphere(0.036, 6, body, 0, 0.082, -0.148, { scaleX: 0.75, scaleY: 1.25, scaleZ: 0.85, rotX: -0.4 });
}

function buildPlushieFrog(ctx: ModelContext): void {
  const frog = ctx.primary;
  const belly = ctx.accent;
  const dark = '#2F332F';

  // Chubby round frog plush body (sits flush at y = 0)
  ctx.sphere(0.138, 10, frog, 0, 0.121, 0, { scaleX: 1.18, scaleY: 0.86, scaleZ: 1.0, roughness: 0.86 });
  // Broad cream/blush belly patch
  ctx.sphere(0.096, 8, belly, 0, 0.086, 0.082, { scaleX: 1.14, scaleY: 0.78, scaleZ: 0.58, roughness: 0.88 });

  // Splayed chubby frog legs & tiny front paws
  for (const sx of [-1, 1]) {
    ctx.sphere(0.056, 7, frog, sx * 0.132, 0.048, 0.032, {
      scaleX: 0.9,
      scaleY: 0.72,
      scaleZ: 1.28,
      rotY: sx * 0.45,
      roughness: 0.86,
    });
    ctx.sphere(0.03, 6, frog, sx * 0.068, 0.04, 0.125, { scaleY: 0.8 });
  }

  // Iconic big perched frog eye domes on top of head!
  for (const sx of [-0.075, 0.075]) {
    ctx.sphere(0.052, 8, frog, sx, 0.238, 0.032, { roughness: 0.86 });
    ctx.sphere(0.036, 7, '#FBF8F2', sx, 0.24, 0.064, { scaleZ: 0.65, roughness: 0.5 });
    ctx.sphere(0.02, 6, dark, sx, 0.242, 0.082, { scaleZ: 0.6, roughness: 0.25 });
  }

  // Rosy frog cheeks & wide happy smile
  ctx.sphere(0.025, 6, '#F2A7B3', -0.098, 0.145, 0.106, { scaleX: 1.25, scaleY: 0.72, scaleZ: 0.42 });
  ctx.sphere(0.025, 6, '#F2A7B3', 0.098, 0.145, 0.106, { scaleX: 1.25, scaleY: 0.72, scaleZ: 0.42 });
  ctx.box(0.095, 0.014, 0.014, '#445846', 0, 0.152, 0.136, { roughness: 0.7 });
  ctx.box(0.028, 0.012, 0.014, '#445846', -0.052, 0.16, 0.132, { rotZ: -0.45, roughness: 0.7 });
  ctx.box(0.028, 0.012, 0.014, '#445846', 0.052, 0.16, 0.132, { rotZ: 0.45, roughness: 0.7 });
}

function buildPlushieCloud(ctx: ModelContext): void {
  const cloud = ctx.primary;
  const puffLight = ctx.shade(cloud, 0.05);
  const blush = ctx.accent;
  const dark = '#3C363A';

  // Sculpted fluffy multi-puff cloud pillow resting upright flush at y = 0 facing +Z (height ~0.32)
  ctx.sphere(0.115, 9, cloud, 0, 0.115, 0, { scaleX: 1.35, scaleY: 1.0, scaleZ: 0.78, roughness: 0.9 });
  ctx.sphere(0.105, 9, puffLight, 0.01, 0.205, -0.005, { scaleX: 1.1, scaleY: 0.98, scaleZ: 0.76, roughness: 0.9 });
  ctx.sphere(0.092, 8, cloud, -0.118, 0.148, 0, { scaleX: 1.05, scaleY: 0.95, scaleZ: 0.74, roughness: 0.9 });
  ctx.sphere(0.092, 8, cloud, 0.125, 0.142, 0, { scaleX: 1.05, scaleY: 0.95, scaleZ: 0.74, roughness: 0.9 });
  ctx.sphere(0.075, 7, puffLight, -0.165, 0.082, 0.005, { scaleX: 1.05, scaleY: 0.9, scaleZ: 0.72, roughness: 0.9 });
  ctx.sphere(0.075, 7, puffLight, 0.168, 0.08, 0.005, { scaleX: 1.05, scaleY: 0.9, scaleZ: 0.72, roughness: 0.9 });

  // Sweet sleepy-smiling face on front puff (+Z)
  ctx.box(0.032, 0.012, 0.012, dark, -0.055, 0.148, 0.088, { rotZ: 0.18 });
  ctx.box(0.032, 0.012, 0.012, dark, 0.055, 0.148, 0.088, { rotZ: -0.18 });
  ctx.sphere(0.024, 6, blush, -0.094, 0.122, 0.084, { scaleX: 1.25, scaleY: 0.72, scaleZ: 0.38 });
  ctx.sphere(0.024, 6, blush, 0.094, 0.122, 0.084, { scaleX: 1.25, scaleY: 0.72, scaleZ: 0.38 });
  ctx.box(0.042, 0.011, 0.012, dark, 0, 0.118, 0.09);

  // Cute plush golden star charm tucked onto upper right puff
  ctx.sphere(0.028, 5, '#F5D688', 0.145, 0.222, 0.048, { scaleZ: 0.55, roughness: 0.7 });
}

function buildWallClock(ctx: ModelContext): void {
  const faceColor = ctx.primary;
  const rimColor = ctx.accent;
  const handColor = '#3E3731';
  const r = 0.23;

  // Circular clock body & sculpted oak/pastel bezel (wall mounted, centered at y = 0)
  ctx.cyl(r, r, 0.048, 20, rimColor, 0, 0, 0.036, { rotX: Math.PI / 2, roughness: 0.62 });
  ctx.torus(r - 0.004, 0.022, 7, 22, rimColor, 0, 0, 0.058, { roughness: 0.58 });

  // Crisp minimalist clock dial face
  ctx.cyl(r - 0.022, r - 0.022, 0.01, 20, faceColor, 0, 0, 0.062, {
    rotX: Math.PI / 2,
    roughness: 0.82,
    castShadow: false,
  });

  // 12, 3, 6, 9 cardinal hour tick bars + 4 diagonal dots
  ctx.box(0.016, 0.042, 0.008, handColor, 0, 0.162, 0.07, { castShadow: false });
  ctx.box(0.016, 0.042, 0.008, handColor, 0, -0.162, 0.07, { castShadow: false });
  ctx.box(0.042, 0.016, 0.008, handColor, 0.162, 0, 0.07, { castShadow: false });
  ctx.box(0.042, 0.016, 0.008, handColor, -0.162, 0, 0.07, { castShadow: false });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.cyl(0.008, 0.008, 0.008, 6, '#8B7F74', Math.cos(a) * 0.165, Math.sin(a) * 0.165, 0.07, {
      rotX: Math.PI / 2,
      castShadow: false,
    });
  }

  // Static hour hand pointing toward ~10 o'clock
  const hourPivot = new THREE.Group();
  hourPivot.position.set(0, 0, 0.074);
  hourPivot.rotation.z = 0.92;
  ctx.group.add(hourPivot);
  ctx.box(0.016, 0.105, 0.008, handColor, 0, 0.042, 0, { parent: hourPivot, castShadow: false });

  // Winding minute hand inside `SpinTarget` spinning clockwise around Z on the +Z clock face!
  const spinTarget = new THREE.Group();
  spinTarget.name = 'SpinTarget';
  spinTarget.userData.spinAxis = 'z';
  spinTarget.userData.spinSpeed = -0.6;
  spinTarget.position.set(0, 0, 0.082);
  ctx.group.add(spinTarget);

  // Minute hand pointing toward 12 o'clock (+Y), rotating clockwise (-Z)
  ctx.box(0.012, 0.14, 0.008, handColor, 0, 0.07, 0, { parent: spinTarget, castShadow: false });
  // Slim brass accent counterweight tail strictly below center pivot (-Y)
  ctx.box(0.007, 0.044, 0.008, '#D7A366', 0, -0.022, 0, { parent: spinTarget, castShadow: false });

  // Center brass pin cap
  ctx.cyl(0.016, 0.016, 0.014, 8, '#D7B574', 0, 0, 0.088, {
    rotX: Math.PI / 2,
    metalness: 0.55,
    roughness: 0.3,
  });
}

function buildTapestryWoven(ctx: ModelContext): void {
  const mountainMain = ctx.primary;
  const mountainDeep = ctx.shade(ctx.primary, -0.18);
  const sunAccent = ctx.accent;
  const fabric = '#F4ECDE';
  const wood = '#C49D72';

  // Wooden wall peg + triangular cotton hanging cord + top dowel rod
  ctx.cyl(0.016, 0.016, 0.032, 6, wood, 0, 0.44, 0.025, { rotX: Math.PI / 2 });
  connectRod(ctx, 0, 0.44, 0.032, -0.28, 0.355, 0.034, 0.006, '#DFD3BE', 4, { castShadow: false });
  connectRod(ctx, 0, 0.44, 0.032, 0.28, 0.355, 0.034, 0.006, '#DFD3BE', 4, { castShadow: false });
  ctx.cyl(0.016, 0.016, 0.72, 8, wood, 0, 0.355, 0.035, { rotZ: Math.PI / 2, roughness: 0.7 });

  // Woven oat fabric tapestry body
  ctx.box(0.58, 0.68, 0.022, fabric, 0, 0.005, 0.028, { roughness: 0.94 });

  // Layered tactile woven mountain & glowing pastel sun composition
  ctx.cyl(0.088, 0.088, 0.012, 14, sunAccent, 0.08, 0.14, 0.042, {
    rotX: Math.PI / 2,
    roughness: 0.88,
    castShadow: false,
  });
  // Back mountain peak
  ctx.cone(0.24, 0.28, 3, mountainMain, -0.05, -0.02, 0.044, {
    scaleZ: 0.12,
    roughness: 0.92,
    castShadow: false,
  });
  // Foreground overlapping ridge
  ctx.cone(0.22, 0.23, 3, mountainDeep, 0.08, -0.06, 0.048, {
    scaleZ: 0.12,
    roughness: 0.92,
    castShadow: false,
  });
  // Woven geometric bottom border bands
  ctx.box(0.58, 0.068, 0.012, mountainMain, 0, -0.22, 0.043, { roughness: 0.92, castShadow: false });
  ctx.box(0.58, 0.028, 0.012, sunAccent, 0, -0.285, 0.044, { roughness: 0.92, castShadow: false });

  // 7 knotted yarn fringe tassels draping from bottom edge
  for (let i = 0; i < 7; i++) {
    const fx = -0.24 + i * 0.08;
    const flen = i % 2 === 0 ? 0.115 : 0.095;
    ctx.cyl(0.012, 0.009, flen, 5, '#EDE2CF', fx, -0.335 - flen / 2, 0.03, {
      roughness: 0.95,
      castShadow: false,
    });
  }
}

function buildScentedCandle(ctx: ModelContext): void {
  const jarTint = ctx.primary;
  const labelColor = ctx.accent;
  const active = ctx.isActive;

  // Warm wooden coaster saucer (sits at surface y = 0)
  ctx.cyl(0.096, 0.092, 0.014, 12, '#C8A379', 0, 0.007, 0, { roughness: 0.74 });

  // Solid creamy wax core inside jar
  ctx.cyl(0.068, 0.064, 0.125, 12, '#FAF2E1', 0, 0.084, 0, {
    roughness: 0.55,
    emissive: active ? '#FFCA6B' : undefined,
    emissiveIntensity: active ? 0.35 : 0,
  });

  // Frosted glass tumbler jar surrounding the wax
  ctx.cyl(0.078, 0.072, 0.155, 12, jarTint, 0, 0.094, 0, {
    opacity: 0.52,
    roughness: 0.24,
    metalness: 0.05,
    emissive: active ? jarTint : undefined,
    emissiveIntensity: active ? 0.24 : 0,
  });
  // Apothecary front wrap label facing +Z
  ctx.box(0.076, 0.062, 0.012, labelColor, 0, 0.088, 0.074, { roughness: 0.85, castShadow: false });
  ctx.box(0.048, 0.012, 0.006, '#6E5F53', 0, 0.094, 0.081, { castShadow: false });
  ctx.box(0.032, 0.007, 0.006, '#A38F7D', 0, 0.076, 0.081, { castShadow: false });

  // Cotton wick
  ctx.cyl(0.004, 0.004, 0.022, 5, '#3A312C', 0, 0.156, 0, { castShadow: false });

  // Glowing layered teardrop candle flame when active!
  if (active) {
    ctx.cone(0.017, 0.044, 7, '#FFAA3B', 0, 0.192, 0, {
      emissive: '#FF9E2C',
      emissiveIntensity: 1.4,
      roughness: 0.2,
      castShadow: false,
    });
    ctx.sphere(0.016, 6, '#FFF2B2', 0, 0.175, 0, {
      emissive: '#FFE88A',
      emissiveIntensity: 1.5,
      castShadow: false,
    });
    ctx.sphere(0.042, 7, '#FFCB6B', 0, 0.188, 0, {
      opacity: 0.22,
      emissive: '#FFB84D',
      emissiveIntensity: 0.9,
      castShadow: false,
      receiveShadow: false,
    });
  }
}

function buildGlassTerrarium(ctx: ModelContext): void {
  const mossMain = ctx.primary;
  const mossDark = ctx.shade(mossMain, -0.18);
  const pebble = ctx.accent;
  const brass = '#C6A368';
  const brassOpts: MeshOptions = { metalness: 0.52, roughness: 0.34 };

  // Pentagonal brass base tray (sits at surface y = 0)
  ctx.cyl(0.145, 0.138, 0.022, 5, brass, 0, 0.011, 0, brassOpts);
  // Layered dark soil + pale river pebble drainage layer
  ctx.cyl(0.128, 0.124, 0.036, 5, '#5E493A', 0, 0.038, 0, { roughness: 0.94 });
  ctx.sphere(0.026, 5, pebble, -0.068, 0.064, 0.048, { scaleX: 1.2, scaleY: 0.65 });
  ctx.sphere(0.022, 5, '#E3D7C5', 0.066, 0.062, 0.044, { scaleY: 0.65 });
  ctx.sphere(0.02, 5, pebble, 0.01, 0.062, 0.075, { scaleY: 0.6 });

  // Lush sculpted green moss mound + miniature fern/succulent rosettes inside
  ctx.sphere(0.095, 7, mossMain, -0.01, 0.088, -0.01, { scaleX: 1.18, scaleY: 0.62, scaleZ: 1.12, roughness: 0.9 });
  ctx.sphere(0.062, 6, mossDark, 0.048, 0.082, 0.018, { scaleY: 0.65, roughness: 0.9 });
  // Miniature rosette & fern shoots fanning radially outward
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    ctx.cone(0.024, 0.085, 4, i % 2 === 0 ? '#7EB385' : mossMain, Math.cos(a) * 0.035, 0.145, Math.sin(a) * 0.035, {
      rotZ: -Math.cos(a) * 0.35,
      rotX: Math.sin(a) * 0.35,
      scaleZ: 0.45,
      castShadow: false,
    });
  }
  // Tiny whimsical red-cap terrarium mushroom!
  ctx.cyl(0.007, 0.008, 0.032, 5, '#F5ECE0', -0.045, 0.118, 0.036, { castShadow: false });
  ctx.cone(0.02, 0.02, 6, '#E4897B', -0.045, 0.14, 0.036, { castShadow: false });

  // Faceted geometric pentagonal crystal glass dome enclosure
  ctx.cyl(0.145, 0.142, 0.14, 5, '#D7EEF6', 0, 0.092, 0, {
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
  ctx.cyl(0.038, 0.145, 0.165, 5, '#D7EEF6', 0, 0.244, 0, {
    opacity: 0.3,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });

  // Soldered brass geometric wireframe ribs framing the 5 faceted corners!
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + Math.PI / 10;
    const x = Math.cos(a) * 0.144;
    const z = Math.sin(a) * 0.144;
    const tx = Math.cos(a) * 0.038;
    const tz = Math.sin(a) * 0.038;
    connectRod(ctx, x, 0.02, z, x, 0.162, z, 0.005, brass, 4, brassOpts);
    connectRod(ctx, x, 0.162, z, tx, 0.326, tz, 0.005, brass, 4, brassOpts);
  }
  // Brass top crown pentagon ring
  ctx.torus(0.038, 0.0055, 5, 5, brass, 0, 0.326, 0, { rotX: Math.PI / 2, ...brassOpts });
}

function buildCeramicVaseTall(ctx: ModelContext): void {
  const baseY = FLOOR_BASE_Y;
  const ceramic = ctx.primary;
  const ceramicShade = ctx.shade(ceramic, -0.08);
  const plume = ctx.accent;
  const plumeLight = ctx.shade(plume, 0.12);
  const reedStem = '#B99B72';

  // Sculpted ribbed Mediterranean amphora floor vase (sits flush on FLOOR_BASE_Y)
  ctx.cyl(0.115, 0.098, 0.055, 12, ceramicShade, 0, baseY + 0.0275, 0, { roughness: 0.62 });
  ctx.sphere(0.172, 12, ceramic, 0, baseY + 0.215, 0, { scaleX: 1.0, scaleY: 1.08, scaleZ: 1.0, roughness: 0.56 });
  // Subtle ceramic ribbed glaze bands around belly
  ctx.torus(0.172, 0.009, 5, 14, ceramicShade, 0, baseY + 0.225, 0, { rotX: Math.PI / 2, roughness: 0.6 });
  ctx.torus(0.16, 0.008, 5, 14, ceramicShade, 0, baseY + 0.16, 0, { rotX: Math.PI / 2, roughness: 0.6 });

  // Slender neck + flared amphora lip collar
  ctx.cyl(0.072, 0.105, 0.11, 12, ceramic, 0, baseY + 0.395, 0, { roughness: 0.56 });
  ctx.torus(0.074, 0.014, 6, 12, ceramicShade, 0, baseY + 0.45, 0, { rotX: Math.PI / 2, roughness: 0.55 });

  // Twin graceful amphora side handles
  addMesh(ctx, new THREE.TorusGeometry(0.068, 0.013, 6, 12, Math.PI), ceramicShade, -0.115, baseY + 0.335, 0, {
    rotZ: Math.PI / 2,
    roughness: 0.58,
  });
  addMesh(ctx, new THREE.TorusGeometry(0.068, 0.013, 6, 12, Math.PI), ceramicShade, 0.115, baseY + 0.335, 0, {
    rotZ: -Math.PI / 2,
    roughness: 0.58,
  });

  // 5 tall gracefully fanned dried pampas grass reeds & fluffy plumes reaching height ~0.72!
  const reeds: Array<{ tx: number; ty: number; tz: number; col: string }> = [
    { tx: 0.0, ty: baseY + 0.64, tz: 0.0, col: plumeLight },
    { tx: -0.10, ty: baseY + 0.61, tz: 0.04, col: plume },
    { tx: 0.10, ty: baseY + 0.62, tz: -0.03, col: plumeLight },
    { tx: -0.045, ty: baseY + 0.58, tz: -0.08, col: plume },
    { tx: 0.055, ty: baseY + 0.57, tz: 0.075, col: '#F2E7D3' },
  ];
  for (const rd of reeds) {
    connectRod(ctx, rd.tx * 0.25, baseY + 0.42, rd.tz * 0.25, rd.tx, rd.ty - 0.04, rd.tz, 0.006, reedStem, 5);
    // Feathery tapered pampas plume
    ctx.cone(0.036, 0.135, 6, rd.col, rd.tx, rd.ty, rd.tz, {
      rotZ: -rd.tx * 1.4,
      rotX: rd.tz * 1.4,
      roughness: 0.94,
    });
    ctx.sphere(0.032, 6, rd.col, rd.tx * 0.9, rd.ty - 0.055, rd.tz * 0.9, {
      scaleY: 1.35,
      roughness: 0.94,
    });
  }
}

/* ============================================================================
 * DISPATCH REGISTRY (all 37 Interior Decor items)
 * ============================================================================ */

const DECOR_BUILDERS: Record<string, (ctx: ModelContext) => void> = {
  // Plants (9)
  wall_vines: buildWallVines,
  hanging_ivy: buildHangingIvy,
  hanging_fern: buildHangingFern,
  potted_monstera: buildPottedMonstera,
  potted_fiddle_leaf: buildPottedFiddleLeaf,
  potted_cactus: buildPottedCactus,
  potted_bonsai: buildPottedBonsai,
  potted_snake_plant: buildPottedSnakePlant,
  flower_vase: buildFlowerVase,

  // Music & Art (6)
  vinyl_records_stack: buildVinylRecordsStack,
  record_wall_display: buildRecordWallDisplay,
  record_player: buildRecordPlayer,
  poster_indie: buildPosterIndie,
  framed_art: buildFramedArt,
  neon_sign: buildNeonSign,

  // Lighting (6)
  table_lamp: buildTableLamp,
  lamp_floor_arc: buildLampFloorArc,
  lamp_pendant: buildLampPendant,
  fairy_lights: buildFairyLights,
  lamp_desk: buildLampDesk,
  lamp_lava: buildLampLava,

  // Bookshelves, Curtains, Mirrors, Rugs (7)
  bookshelf_tall: buildBookshelfTall,
  bookshelf_low: buildBookshelfLow,
  bookshelf_wall: buildBookshelfWall,
  curtains_linen: buildCurtainsLinen,
  mirror_arch: buildMirrorArch,
  mirror_round: buildMirrorRound,
  rug_runner: buildRugRunner,

  // Plushies & Cozy Accents (9)
  plushie_bear: buildPlushieBear,
  plushie_cat: buildPlushieCat,
  plushie_frog: buildPlushieFrog,
  plushie_cloud: buildPlushieCloud,
  wall_clock: buildWallClock,
  tapestry_woven: buildTapestryWoven,
  scented_candle: buildScentedCandle,
  glass_terrarium: buildGlassTerrarium,
  ceramic_vase_tall: buildCeramicVaseTall,
};

export const buildDecorModel: TabModelBuilder = (ctx) => {
  const builder = DECOR_BUILDERS[ctx.def.id];
  if (!builder) return false;
  builder(ctx);
  return true;
};
