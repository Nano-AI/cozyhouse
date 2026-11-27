import * as THREE from 'three';
import { WALL_THICKNESS } from '../engine/GridSystem';
import { type ModelContext, type TabModelBuilder } from './ModelKit';

const WALL_CREAM = '#F4EDE2';
const BRASS = '#DFBC6E';
const BRASS_DARK = '#C49D4C';
const DARK_WOOD = '#8C6B4B';

/** Helper to extrude a 2D XY shape symmetrically centered on Z = 0. */
function extrudeCentered(
  ctx: ModelContext,
  shape: THREE.Shape,
  depth: number,
  color: string | number,
  opts?: {
    x?: number;
    y?: number;
    z?: number;
    roughness?: number;
    metalness?: number;
    opacity?: number;
    curveSegments?: number;
    castShadow?: boolean;
    receiveShadow?: boolean;
    parent?: THREE.Object3D;
    name?: string;
  },
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: opts?.curveSegments ?? 12,
  });
  geo.translate(0, 0, -depth / 2);
  const mat = ctx.mat(color, {
    roughness: opts?.roughness,
    metalness: opts?.metalness,
    opacity: opts?.opacity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(opts?.x ?? 0, opts?.y ?? 0, opts?.z ?? 0);
  mesh.castShadow = !ctx.isGhost && (opts?.castShadow ?? true);
  mesh.receiveShadow = !ctx.isGhost && (opts?.receiveShadow ?? true);
  if (opts?.name) mesh.name = opts.name;
  (opts?.parent ?? ctx.group).add(mesh);
  return mesh;
}

/** Standard matching baseboard + top crown molding for full-height wall segments. */
function addWallMoldings(
  ctx: ModelContext,
  wallColor: string,
  h: number,
  opts?: { skipBaseboard?: boolean; baseboardTrim?: string; crownTrim?: string },
): void {
  const t = WALL_THICKNESS;
  if (!opts?.skipBaseboard) {
    const baseColor = opts?.baseboardTrim ?? ctx.shade(wallColor, 0.12);
    ctx.box(1.0, 0.125, t + 0.026, baseColor, 0, 0.0625, 0, { roughness: 0.72 });
    ctx.box(1.0, 0.018, t + 0.032, ctx.shade(baseColor, -0.09), 0, 0.132, 0, { roughness: 0.75 });
  }
  const crownColor = opts?.crownTrim ?? ctx.shade(wallColor, 0.14);
  ctx.box(1.0, 0.055, t + 0.028, crownColor, 0, h - 0.055, 0, { roughness: 0.72 });
  ctx.box(1.0, 0.032, t + 0.048, ctx.shade(crownColor, 0.06), 0, h - 0.016, 0, { roughness: 0.7 });
}

/** Creates a 1.0 x h rectangular wall shape with an arched opening cutout from floor or sill. */
function makeWallWithArchOpening(
  h: number,
  openHalfW: number,
  bottomY: number,
  springY: number,
): THREE.Shape {
  const shape = new THREE.Shape();
  if (bottomY <= 0.001) {
    // Walkthrough doorway arch starting right at floor y = 0
    shape.moveTo(-0.5, 0);
    shape.lineTo(-openHalfW, 0);
    shape.lineTo(-openHalfW, springY);
    shape.absarc(0, springY, openHalfW, Math.PI, 0, true);
    shape.lineTo(openHalfW, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, h);
    shape.lineTo(-0.5, h);
    shape.closePath();
  } else {
    // Window arch cutout starting above sill bottomY
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, h);
    shape.lineTo(-0.5, h);
    shape.closePath();

    const hole = new THREE.Path();
    hole.moveTo(-openHalfW, bottomY);
    hole.lineTo(openHalfW, bottomY);
    hole.lineTo(openHalfW, springY);
    hole.absarc(0, springY, openHalfW, 0, Math.PI, false);
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

/** Creates a hollow arched casing trim rim tracing an arch opening. */
function makeArchTrimShape(
  innerR: number,
  trimW: number,
  bottomY: number,
  springY: number,
): THREE.Shape {
  const outerR = innerR + trimW;
  const shape = new THREE.Shape();
  shape.moveTo(-outerR, bottomY);
  shape.lineTo(-innerR, bottomY);
  shape.lineTo(-innerR, springY);
  shape.absarc(0, springY, innerR, Math.PI, 0, true);
  shape.lineTo(innerR, bottomY);
  shape.lineTo(outerR, bottomY);
  shape.lineTo(outerR, springY);
  shape.absarc(0, springY, outerR, 0, Math.PI, false);
  shape.closePath();
  return shape;
}

// ============================================================================
// FLOOR TILES (6) — slim 0.024 total height, flat-shaded tactile surface relief
// ============================================================================

function buildFloorWood(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Dark seam backing slab
  ctx.box(1.0, 0.018, 1.0, shade(primary, -0.22), 0, 0.009, 0, {
    roughness: 0.88,
    castShadow: false,
  });
  // 4 longitudinal hardwood plank lanes with staggered end joints
  const lanes: Array<{ x: number; splitZ: number; toneA: number; toneB: number }> = [
    { x: -0.372, splitZ: 0.14, toneA: 0.03, toneB: -0.05 },
    { x: -0.124, splitZ: -0.20, toneA: -0.03, toneB: 0.05 },
    { x: 0.124, splitZ: 0.24, toneA: 0.04, toneB: -0.04 },
    { x: 0.372, splitZ: -0.12, toneA: -0.06, toneB: 0.02 },
  ];
  const plankW = 0.234;
  const gap = 0.012;
  for (const lane of lanes) {
    const lenA = lane.splitZ - -0.494 - gap / 2;
    const czA = -0.494 + lenA / 2;
    ctx.box(plankW, 0.006, lenA, shade(primary, lane.toneA), lane.x, 0.021, czA, {
      roughness: 0.72,
      castShadow: false,
    });
    const lenB = 0.494 - lane.splitZ - gap / 2;
    const czB = 0.494 - lenB / 2;
    ctx.box(plankW, 0.006, lenB, shade(primary, lane.toneB), lane.x, 0.021, czB, {
      roughness: 0.74,
      castShadow: false,
    });
  }
}

function buildFloorHerringbone(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  ctx.box(1.0, 0.018, 1.0, shade(accent, -0.2), 0, 0.009, 0, {
    roughness: 0.86,
    castShadow: false,
  });
  // Two neat vertical chevron columns of angled parquet slats inside [-0.49, +0.49]
  const colCenters = [-0.25, 0.25];
  const zRows = [-0.32, 0.0, 0.32];
  const slatL = 0.24;
  const slatW = 0.095;
  for (let c = 0; c < colCenters.length; c++) {
    const cx = colCenters[c];
    for (let r = 0; r < zRows.length; r++) {
      const rz = zRows[r];
      const leftColor = (r + c) % 2 === 0 ? primary : shade(primary, 0.06);
      const rightColor = (r + c) % 2 === 0 ? accent : shade(accent, -0.05);
      ctx.box(slatL, 0.006, slatW, leftColor, cx - 0.11, 0.021, rz, {
        rotY: Math.PI / 4,
        roughness: 0.68,
        castShadow: false,
      });
      ctx.box(slatL, 0.006, slatW, rightColor, cx + 0.11, 0.021, rz, {
        rotY: -Math.PI / 4,
        roughness: 0.72,
        castShadow: false,
      });
    }
  }
}

function buildFloorTile(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Grout backing
  ctx.box(1.0, 0.017, 1.0, shade(primary, -0.18), 0, 0.0085, 0, {
    roughness: 0.9,
    castShadow: false,
  });
  // 2x2 glazed ceramic tiles
  const coords: Array<[number, number, number]> = [
    [-0.25, -0.25, 0.0],
    [0.25, -0.25, 0.04],
    [-0.25, 0.25, 0.03],
    [0.25, 0.25, -0.02],
  ];
  for (const [x, z, tone] of coords) {
    ctx.box(0.464, 0.007, 0.464, shade(primary, tone), x, 0.0205, z, {
      roughness: 0.34,
      metalness: 0.04,
      castShadow: false,
    });
  }
  // Small decorative center diamond cabochon
  ctx.box(0.085, 0.0075, 0.085, shade(primary, -0.12), 0, 0.0208, 0, {
    rotY: Math.PI / 4,
    roughness: 0.4,
    castShadow: false,
  });
}

function buildFloorTerrazzo(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  ctx.box(1.0, 0.016, 1.0, shade(primary, -0.14), 0, 0.008, 0, {
    roughness: 0.85,
    castShadow: false,
  });
  ctx.box(0.986, 0.007, 0.986, primary, 0, 0.0195, 0, {
    roughness: 0.46,
    castShadow: false,
  });
  // Scattered sculpted pastel terrazzo stone chips
  const chips: Array<[number, number, number, number, number, string]> = [
    [-0.34, -0.32, 0.11, 0.07, 0.4, accent],
    [-0.08, -0.38, 0.08, 0.08, 1.1, '#E7C888'],
    [0.28, -0.30, 0.12, 0.08, -0.5, shade(accent, -0.18)],
    [-0.38, -0.02, 0.09, 0.11, 0.8, '#B8CFC0'],
    [-0.12, -0.08, 0.13, 0.08, -0.3, shade(accent, -0.1)],
    [0.18, -0.05, 0.08, 0.09, 0.6, '#D99E8C'],
    [0.39, 0.04, 0.09, 0.07, 1.3, accent],
    [-0.26, 0.24, 0.12, 0.09, -0.7, '#9FAFC2'],
    [0.02, 0.19, 0.09, 0.07, 0.3, accent],
    [0.32, 0.28, 0.11, 0.10, 0.9, '#E6C68A'],
    [-0.38, 0.38, 0.08, 0.07, -0.4, shade(accent, -0.2)],
    [0.10, 0.38, 0.10, 0.07, 0.5, '#B8CFC0'],
  ];
  for (const [x, z, w, d, rotY, col] of chips) {
    ctx.box(w, 0.0028, d, col, x, 0.0232, z, {
      rotY,
      roughness: 0.5,
      castShadow: false,
    });
  }
}

function buildFloorStone(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Earthy recessed mortar bed
  ctx.box(1.0, 0.016, 1.0, shade(primary, -0.26), 0, 0.008, 0, {
    roughness: 0.95,
    castShadow: false,
  });
  // Interlocking sculpted flagstone slabs
  const stones: Array<[number, number, number, number, number, number, number]> = [
    [-0.25, -0.28, 0.44, 0.36, 0.008, 0.04, 0.02],
    [0.24, -0.31, 0.44, 0.30, 0.0075, -0.06, -0.03],
    [-0.31, 0.10, 0.32, 0.32, 0.0082, -0.04, -0.02],
    [0.06, 0.04, 0.34, 0.30, 0.0078, 0.07, 0.03],
    [0.36, 0.08, 0.20, 0.36, 0.0076, -0.08, 0.01],
    [-0.20, 0.38, 0.52, 0.18, 0.008, 0.02, -0.02],
    [0.27, 0.37, 0.36, 0.20, 0.0078, -0.03, 0.02],
  ];
  for (const [x, z, w, d, h, tone, rotY] of stones) {
    ctx.box(w, h, d, shade(primary, tone), x, 0.016 + h / 2, z, {
      rotY,
      roughness: 0.86,
      castShadow: false,
    });
  }
}

function buildFloorCheckerboard(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  ctx.box(1.0, 0.017, 1.0, shade(primary, -0.2), 0, 0.0085, 0, {
    roughness: 0.88,
    castShadow: false,
  });
  const cells: Array<[number, number, string]> = [
    [-0.25, -0.25, primary],
    [0.25, -0.25, accent],
    [-0.25, 0.25, accent],
    [0.25, 0.25, primary],
  ];
  for (const [x, z, col] of cells) {
    ctx.box(0.478, 0.007, 0.478, col, x, 0.0205, z, {
      roughness: 0.36,
      metalness: 0.04,
      castShadow: false,
    });
  }
}

// ============================================================================
// WALLS (6) — architectural full height 2.6 (1.15 for half-wall), thick 0.14
// ============================================================================

function buildWallPlain(ctx: ModelContext): void {
  const { primary } = ctx;
  const h = ctx.def.height;
  ctx.box(1.0, h, WALL_THICKNESS, primary, 0, h / 2, 0, { roughness: 0.86 });
  addWallMoldings(ctx, primary, h);
}

function buildWallBrick(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  // Recessed mortar core
  ctx.box(1.0, h, t - 0.012, accent, 0, h / 2, 0, { roughness: 0.92 });
  // Grounded stone/wood baseboard and cap cornice
  ctx.box(1.0, 0.14, t + 0.026, shade(primary, -0.22), 0, 0.07, 0, { roughness: 0.8 });
  ctx.box(1.0, 0.065, t + 0.032, shade(primary, -0.18), 0, h - 0.0325, 0, { roughness: 0.78 });

  // 7 staggered 3D relief brick courses spanning both wall faces
  const brickD = t + 0.018;
  const brickH = 0.235;
  const startY = 0.30;
  const stepY = 0.32;
  for (let row = 0; row < 7; row++) {
    const cy = startY + row * stepY;
    const toneShift = (row % 3 - 1) * 0.045;
    if (row % 2 === 0) {
      const xs = [-0.335, 0, 0.335];
      for (let i = 0; i < xs.length; i++) {
        const col = shade(primary, toneShift + (i === 1 ? 0.04 : -0.03));
        ctx.box(0.295, brickH, brickD, col, xs[i], cy, 0, { roughness: 0.84 });
      }
    } else {
      ctx.box(0.13, brickH, brickD, shade(primary, toneShift - 0.04), -0.425, cy, 0, {
        roughness: 0.84,
      });
      ctx.box(0.32, brickH, brickD, shade(primary, toneShift + 0.05), -0.17, cy, 0, {
        roughness: 0.84,
      });
      ctx.box(0.32, brickH, brickD, shade(primary, toneShift - 0.02), 0.17, cy, 0, {
        roughness: 0.84,
      });
      ctx.box(0.13, brickH, brickD, shade(primary, toneShift + 0.03), 0.425, cy, 0, {
        roughness: 0.84,
      });
    }
  }
}

function buildWallWainscot(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const railY = 0.98;

  // Upper smooth plaster wall
  ctx.box(1.0, h - railY, t, primary, 0, railY + (h - railY) / 2, 0, { roughness: 0.86 });
  // Lower wainscot paneling base
  ctx.box(1.0, railY, t + 0.008, accent, 0, railY / 2, 0, { roughness: 0.76 });
  // Baseboard skirting
  ctx.box(1.0, 0.13, t + 0.03, shade(accent, -0.09), 0, 0.065, 0, { roughness: 0.72 });
  // Sculpted chair rail ledge
  ctx.box(1.0, 0.065, t + 0.048, shade(accent, 0.08), 0, railY + 0.015, 0, { roughness: 0.68 });

  // Two side-by-side framed wainscoting shaker panels
  for (const sx of [-0.24, 0.24]) {
    ctx.box(0.38, 0.64, t + 0.022, shade(accent, 0.09), sx, 0.54, 0, { roughness: 0.74 });
    ctx.box(0.28, 0.52, t + 0.03, shade(accent, -0.05), sx, 0.54, 0, { roughness: 0.78 });
  }
  // Matching crown molding
  addWallMoldings(ctx, primary, h, { skipBaseboard: true });
}

function buildWallGlassPartition(ctx: ModelContext): void {
  const { primary, accent } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameOpts = { roughness: 0.42, metalness: 0.28 };

  // Bottom solid kick-plinth and top transom beam
  ctx.box(1.0, 0.15, t, accent, 0, 0.075, 0, frameOpts);
  ctx.box(1.0, 0.11, t, accent, 0, h - 0.055, 0, frameOpts);
  // Outer vertical stiles
  for (const sx of [-0.465, 0.465]) {
    ctx.box(0.07, h - 0.26, t - 0.01, accent, sx, h / 2 + 0.02, 0, frameOpts);
  }
  // Center vertical mullion + 3 horizontal muntin bars (2x4 factory grid)
  ctx.box(0.042, h - 0.26, t * 0.68, accent, 0, h / 2 + 0.02, 0, frameOpts);
  for (const my of [0.74, 1.34, 1.94]) {
    ctx.box(0.88, 0.038, t * 0.68, accent, 0, my, 0, frameOpts);
  }
  // Translucent glass panel
  ctx.box(0.86, h - 0.28, 0.024, primary, 0, h / 2 + 0.02, 0, {
    opacity: 0.36,
    roughness: 0.12,
    metalness: 0.12,
    castShadow: false,
  });
}

function buildWallArch(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const openHalfW = 0.34;
  const springY = 1.76;

  // Main extruded wall with smooth semicircular arch opening
  const wallShape = makeWallWithArchOpening(h, openHalfW, 0, springY);
  extrudeCentered(ctx, wallShape, t, primary, { roughness: 0.85, curveSegments: 14 });

  // Sculpted arch surround trim rim on both faces
  const trimShape = makeArchTrimShape(openHalfW - 0.005, 0.045, 0.13, springY);
  extrudeCentered(ctx, trimShape, t + 0.024, shade(primary, 0.1), {
    roughness: 0.74,
    curveSegments: 14,
  });

  // Baseboard cuffs on the left & right piers
  for (const sx of [-0.42, 0.42]) {
    ctx.box(0.16, 0.13, t + 0.028, shade(primary, 0.12), sx, 0.065, 0, { roughness: 0.72 });
  }
  // Top crown molding
  addWallMoldings(ctx, primary, h, { skipBaseboard: true });
}

function buildWallHalf(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height; // 1.15
  const t = WALL_THICKNESS;
  const capH = 0.075;
  const bodyH = h - capH;

  // Main half-wall body
  ctx.box(1.0, bodyH, t, primary, 0, bodyH / 2, 0, { roughness: 0.84 });
  // Baseboard
  ctx.box(1.0, 0.13, t + 0.028, shade(primary, -0.07), 0, 0.065, 0, { roughness: 0.74 });
  // Twin shaker decorative panels
  for (const sx of [-0.24, 0.24]) {
    ctx.box(0.38, 0.66, t + 0.016, shade(primary, -0.06), sx, 0.56, 0, { roughness: 0.8 });
    ctx.box(0.3, 0.56, t + 0.022, shade(primary, 0.04), sx, 0.56, 0, { roughness: 0.78 });
  }
  // Underside corbel trim + overhanging wooden cap ledge flush at y = 1.15
  ctx.box(1.0, 0.028, t + 0.036, shade(accent, -0.14), 0, bodyH - 0.01, 0, { roughness: 0.68 });
  ctx.box(1.0, capH, t + 0.075, accent, 0, h - capH / 2, 0, { roughness: 0.62 });
}

// ============================================================================
// DOORS (4) — DoorPivot hinged at x = -0.39, rotation.y = isActive ? -0.44π : 0
// ============================================================================

function addStandardDoorWallFrame(ctx: ModelContext, h: number, openH: number): void {
  const { accent, shade } = ctx;
  const t = WALL_THICKNESS;
  const headH = h - openH;
  // Surrounding wall header + side piers
  ctx.box(1.0, headH, t, accent, 0, openH + headH / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.45, 0.45]) {
    ctx.box(0.1, openH, t, accent, sx, openH / 2, 0, { roughness: 0.86 });
  }
  // Raised casing jambs & lintel
  const trimCol = shade(accent, -0.08);
  ctx.box(0.92, 0.06, t + 0.028, trimCol, 0, openH + 0.02, 0, { roughness: 0.72 });
  for (const sx of [-0.415, 0.415]) {
    ctx.box(0.05, openH, t + 0.026, trimCol, sx, openH / 2, 0, { roughness: 0.72 });
  }
  // Threshold plate
  ctx.box(0.78, 0.022, t + 0.02, DARK_WOOD, 0, 0.011, 0, { roughness: 0.65 });
  // Crown trim
  addWallMoldings(ctx, accent, h, { skipBaseboard: true });
}

function buildDoorWood(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const openH = 2.08;
  addStandardDoorWallFrame(ctx, h, openH);

  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.position.set(-0.39, 0, 0);
  pivot.rotation.y = ctx.isActive ? -Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafH = openH - 0.03;
  const leafD = 0.064;
  // Main solid wood door leaf
  ctx.box(0.78, leafH, leafD, primary, 0.39, 0.022 + leafH / 2, 0, {
    parent: pivot,
    roughness: 0.72,
  });
  // Upper & lower recessed shaker molding panels (visible on both faces)
  for (const [py, ph] of [
    [1.48, 0.76],
    [0.58, 0.64],
  ] as const) {
    ctx.box(0.56, ph + 0.04, leafD + 0.008, shade(primary, 0.08), 0.39, py, 0, {
      parent: pivot,
      roughness: 0.72,
    });
    ctx.box(0.48, ph - 0.04, leafD + 0.015, shade(primary, -0.11), 0.39, py, 0, {
      parent: pivot,
      roughness: 0.78,
    });
  }
  // Brass escutcheon plate + round doorknobs on both sides
  ctx.box(0.045, 0.12, leafD + 0.018, BRASS_DARK, 0.69, 1.0, 0, {
    parent: pivot,
    roughness: 0.32,
    metalness: 0.62,
  });
  for (const sz of [-0.056, 0.056]) {
    ctx.sphere(0.035, 8, BRASS, 0.69, 1.0, sz, {
      parent: pivot,
      roughness: 0.28,
      metalness: 0.68,
    });
  }
}

function buildDoorCafeGlass(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const openH = 2.08;
  addStandardDoorWallFrame(ctx, h, openH);

  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.position.set(-0.39, 0, 0);
  pivot.rotation.y = ctx.isActive ? -Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafD = 0.064;
  // Lower painted solid panel + brushed brass kickplate
  ctx.box(0.78, 0.86, leafD, primary, 0.39, 0.452, 0, { parent: pivot, roughness: 0.72 });
  ctx.box(0.72, 0.13, leafD + 0.01, BRASS_DARK, 0.39, 0.095, 0, {
    parent: pivot,
    roughness: 0.35,
    metalness: 0.55,
  });
  // Upper window door stiles & top rail
  ctx.box(0.095, 1.18, leafD, primary, 0.0475, 1.47, 0, { parent: pivot, roughness: 0.72 });
  ctx.box(0.095, 1.18, leafD, primary, 0.7325, 1.47, 0, { parent: pivot, roughness: 0.72 });
  ctx.box(0.78, 0.095, leafD, primary, 0.39, 2.015, 0, { parent: pivot, roughness: 0.72 });
  // Cross mullions inside upper glass
  ctx.box(0.034, 1.1, leafD * 0.7, shade(primary, 0.08), 0.39, 1.43, 0, {
    parent: pivot,
    roughness: 0.7,
  });
  ctx.box(0.6, 0.034, leafD * 0.7, shade(primary, 0.08), 0.39, 1.45, 0, {
    parent: pivot,
    roughness: 0.7,
  });
  // Translucent café glass pane
  ctx.box(0.6, 1.1, 0.022, '#CBE6F2', 0.39, 1.43, 0, {
    parent: pivot,
    opacity: 0.38,
    roughness: 0.12,
    metalness: 0.1,
    castShadow: false,
  });
  // Cute wooden hanging café door sign plaque
  ctx.box(0.24, 0.11, 0.032, '#FAF2E3', 0.39, 1.24, 0, { parent: pivot, roughness: 0.76 });
  // Vertical brass café push/pull handles on both sides
  for (const sz of [-0.056, 0.056]) {
    ctx.cyl(0.016, 0.016, 0.26, 7, BRASS, 0.69, 1.02, sz, {
      parent: pivot,
      roughness: 0.28,
      metalness: 0.68,
    });
  }
}

function buildDoorArched(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const openHalfW = 0.39;
  const springY = 1.68;

  // Extruded wall with exact arched doorway cutout
  const wallShape = makeWallWithArchOpening(h, openHalfW, 0, springY);
  extrudeCentered(ctx, wallShape, t, accent, { roughness: 0.86, curveSegments: 14 });

  // Sculpted arched frame trim molding
  const trimShape = makeArchTrimShape(openHalfW - 0.004, 0.048, 0.02, springY);
  extrudeCentered(ctx, trimShape, t + 0.026, shade(accent, -0.09), {
    roughness: 0.74,
    curveSegments: 14,
  });

  // Threshold & crown molding
  ctx.box(0.78, 0.022, t + 0.02, DARK_WOOD, 0, 0.011, 0, { roughness: 0.65 });
  addWallMoldings(ctx, accent, h, { skipBaseboard: true });

  // Hinged arched wood door leaf inside DoorPivot
  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.position.set(-0.39, 0, 0);
  pivot.rotation.y = ctx.isActive ? -Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafD = 0.064;
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0.006, 0.022);
  leafShape.lineTo(0.774, 0.022);
  leafShape.lineTo(0.774, springY);
  leafShape.absarc(0.39, springY, 0.384, 0, Math.PI, false);
  leafShape.closePath();
  extrudeCentered(ctx, leafShape, leafD, primary, {
    parent: pivot,
    roughness: 0.72,
    curveSegments: 14,
  });

  // Subtle recessed arched accent panel
  const insetShape = new THREE.Shape();
  insetShape.moveTo(0.12, 0.24);
  insetShape.lineTo(0.66, 0.24);
  insetShape.lineTo(0.66, springY - 0.04);
  insetShape.absarc(0.39, springY - 0.04, 0.27, 0, Math.PI, false);
  insetShape.closePath();
  extrudeCentered(ctx, insetShape, leafD + 0.012, shade(primary, -0.09), {
    parent: pivot,
    roughness: 0.78,
    curveSegments: 12,
  });

  // Cottage iron hinge straps & brass knob
  for (const hy of [0.46, 1.48]) {
    ctx.box(0.22, 0.042, leafD + 0.018, '#5E5B57', 0.12, hy, 0, {
      parent: pivot,
      roughness: 0.48,
      metalness: 0.5,
    });
  }
  for (const sz of [-0.056, 0.056]) {
    ctx.sphere(0.036, 8, BRASS, 0.68, 0.98, sz, {
      parent: pivot,
      roughness: 0.28,
      metalness: 0.68,
    });
  }
}

function buildDoorSliding(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const openH = 2.16;

  // Surrounding wall header, slim jambs & crown
  ctx.box(1.0, h - openH, t, accent, 0, openH + (h - openH) / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.47, 0.47]) {
    ctx.box(0.06, openH, t, accent, sx, openH / 2, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, accent, h, { skipBaseboard: true });

  // Top & bottom metal/wood sliding tracks
  const trackCol = shade(primary, -0.2);
  ctx.box(0.88, 0.038, t + 0.01, trackCol, 0, 0.019, 0, { roughness: 0.5, metalness: 0.2 });
  ctx.box(0.88, 0.042, t + 0.01, trackCol, 0, openH - 0.021, 0, { roughness: 0.5, metalness: 0.2 });

  const panelH = openH - 0.08;
  const panelCy = 0.04 + panelH / 2;

  // Helper to build a slim framed patio glass door leaf
  const addPatioLeaf = (cx: number, cz: number, parent: THREE.Object3D, withHandle: boolean) => {
    const w = 0.46;
    const d = 0.04;
    const rail = 0.048;
    ctx.box(w, rail, d, primary, cx, 0.04 + rail / 2, cz, { parent, roughness: 0.58 });
    ctx.box(w, rail, d, primary, cx, 0.04 + panelH - rail / 2, cz, { parent, roughness: 0.58 });
    ctx.box(rail, panelH - rail * 2, d, primary, cx - w / 2 + rail / 2, panelCy, cz, {
      parent,
      roughness: 0.58,
    });
    ctx.box(rail, panelH - rail * 2, d, primary, cx + w / 2 - rail / 2, panelCy, cz, {
      parent,
      roughness: 0.58,
    });
    ctx.box(w - rail * 2, panelH - rail * 2, 0.016, '#C7E5F2', cx, panelCy, cz, {
      parent,
      opacity: 0.35,
      roughness: 0.1,
      metalness: 0.12,
      castShadow: false,
    });
    if (withHandle) {
      for (const dz of [-0.03, 0.03]) {
        ctx.box(0.022, 0.26, 0.024, BRASS, cx - w / 2 + 0.052, 1.04, cz + dz, {
          parent,
          roughness: 0.3,
          metalness: 0.65,
        });
      }
    }
  };

  // Fixed left glass leaf on rear track
  addPatioLeaf(-0.21, -0.022, ctx.group, false);

  // Sliding right glass leaf on front track (slides open along track when isActive!)
  const slider = new THREE.Group();
  slider.name = 'DoorPivot';
  slider.position.set(ctx.isActive ? -0.34 : 0, 0, 0);
  ctx.group.add(slider);
  addPatioLeaf(0.21, 0.022, slider, true);
}

// ============================================================================
// WINDOWS (5) — wall surround + sculpted sill, casing, mullions, translucent glass
// ============================================================================

function resolveWindowFrameColor(ctx: ModelContext): string {
  // If variant frame is very close to the default cream wall, brighten slightly for crisp trim read
  return ctx.accent.toLowerCase() === '#f5efe4' || ctx.accent.toLowerCase() === '#f4ede2'
    ? '#FAF7F1'
    : ctx.accent;
}

function buildWindowWide(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameCol = resolveWindowFrameColor(ctx);
  const sillY = 0.86;
  const topY = 2.12;
  const openH = topY - sillY;
  const openCy = sillY + openH / 2;

  // Wall surround
  ctx.box(1.0, sillY, t, WALL_CREAM, 0, sillY / 2, 0, { roughness: 0.86 });
  ctx.box(1.0, h - topY, t, WALL_CREAM, 0, topY + (h - topY) / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.45, 0.45]) {
    ctx.box(0.1, openH, t, WALL_CREAM, sx, openCy, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, WALL_CREAM, h);

  // Outer casing frame & deep protruding sill
  ctx.box(0.92, 0.06, t + 0.085, frameCol, 0, sillY + 0.015, 0, { roughness: 0.62 });
  ctx.box(0.88, 0.055, t + 0.036, frameCol, 0, topY - 0.015, 0, { roughness: 0.65 });
  for (const sx of [-0.395, 0.395]) {
    ctx.box(0.055, openH, t + 0.032, frameCol, sx, openCy, 0, { roughness: 0.65 });
  }
  // Cross mullions
  const mullionCol = shade(frameCol, -0.06);
  ctx.box(0.034, openH - 0.06, t * 0.56, mullionCol, 0, openCy, 0, { roughness: 0.65 });
  ctx.box(0.76, 0.034, t * 0.56, mullionCol, 0, openCy + 0.06, 0, { roughness: 0.65 });

  // Translucent sky-tinted glass pane
  ctx.box(0.75, openH - 0.07, 0.022, primary, 0, openCy, 0, {
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
}

function buildWindowArched(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameCol = resolveWindowFrameColor(ctx);
  const sillY = 0.88;
  const springY = 1.74;
  const openHalfW = 0.37;

  // Extruded wall with exact arched window cutout
  const wallShape = makeWallWithArchOpening(h, openHalfW, sillY, springY);
  extrudeCentered(ctx, wallShape, t, WALL_CREAM, { roughness: 0.86, curveSegments: 14 });
  addWallMoldings(ctx, WALL_CREAM, h);

  // Sculpted arched casing rim & deep protruding sill
  const trimShape = makeArchTrimShape(openHalfW - 0.005, 0.048, sillY, springY);
  extrudeCentered(ctx, trimShape, t + 0.032, frameCol, { roughness: 0.64, curveSegments: 14 });
  ctx.box(0.88, 0.06, t + 0.085, frameCol, 0, sillY - 0.01, 0, { roughness: 0.62 });

  // Mullions: horizontal spring-line transom + center vertical mullion
  const mullionCol = shade(frameCol, -0.06);
  ctx.box(openHalfW * 2, 0.036, t * 0.56, mullionCol, 0, springY, 0, { roughness: 0.65 });
  ctx.box(0.034, springY - sillY + openHalfW - 0.02, t * 0.56, mullionCol, 0, sillY + (springY - sillY + openHalfW) / 2, 0, {
    roughness: 0.65,
  });

  // Exact arched glass pane
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-openHalfW + 0.01, sillY + 0.01);
  glassShape.lineTo(openHalfW - 0.01, sillY + 0.01);
  glassShape.lineTo(openHalfW - 0.01, springY);
  glassShape.absarc(0, springY, openHalfW - 0.01, 0, Math.PI, false);
  glassShape.closePath();
  extrudeCentered(ctx, glassShape, 0.022, primary, {
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
    curveSegments: 14,
  });
}

function buildWindowBay(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameCol = resolveWindowFrameColor(ctx);
  const seatY = 0.72;
  const topY = 2.14;
  const openH = topY - seatY;
  const openCy = seatY + openH / 2;

  // Surrounding flat wall frame
  ctx.box(1.0, seatY, t, WALL_CREAM, 0, seatY / 2, 0, { roughness: 0.86 });
  ctx.box(1.0, h - topY, t, WALL_CREAM, 0, topY + (h - topY) / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.46, 0.46]) {
    ctx.box(0.08, openH, t, WALL_CREAM, sx, openCy, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, WALL_CREAM, h);

  // Exterior 3-facet protruding bay box (-Z projection)
  // Bay floor base & mini overhanging bay roof canopy
  ctx.box(0.88, 0.075, 0.32, frameCol, 0, seatY - 0.02, -0.1, { roughness: 0.68 });
  ctx.box(0.92, 0.08, 0.36, frameCol, 0, topY + 0.02, -0.11, { roughness: 0.66 });
  ctx.box(0.76, 0.06, 0.24, shade(frameCol, -0.12), 0, topY + 0.085, -0.12, { roughness: 0.7 });

  // Vertical bay corner posts (front pair at wall line, rear pair at bay projection)
  for (const sx of [-0.41, 0.41]) {
    ctx.box(0.048, openH, 0.048, frameCol, sx, openCy, -0.05, { roughness: 0.62 });
  }
  for (const sx of [-0.26, 0.26]) {
    ctx.box(0.048, openH, 0.048, frameCol, sx, openCy, -0.24, { roughness: 0.62 });
  }

  // Center rear glass pane + angled left & right bay glass panes
  ctx.box(0.49, openH - 0.06, 0.022, primary, 0, openCy, -0.24, {
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
  ctx.box(0.49, 0.032, 0.036, frameCol, 0, openCy + 0.14, -0.24, { roughness: 0.65 });

  for (const dir of [-1, 1] as const) {
    ctx.box(0.24, openH - 0.06, 0.022, primary, dir * 0.335, openCy, -0.145, {
      rotY: dir * -0.9,
      opacity: 0.38,
      roughness: 0.1,
      metalness: 0.12,
      castShadow: false,
    });
  }

  // Interior cozy cushioned window seat sill (+Z facing into room)
  ctx.box(0.86, 0.06, 0.26, frameCol, 0, seatY + 0.01, 0.09, { roughness: 0.64 });
  ctx.box(0.78, 0.075, 0.32, '#EFE2CE', 0, seatY + 0.072, 0.03, { roughness: 0.9 });
  // Cozy corner seat pillow
  ctx.box(0.18, 0.18, 0.09, '#E4B29D', -0.28, seatY + 0.18, 0.03, {
    rotY: 0.42,
    rotZ: 0.18,
    roughness: 0.92,
  });
}

function buildWindowRound(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameCol = resolveWindowFrameColor(ctx);
  const centerY = 1.48;
  const radius = 0.32;

  // Extruded wall with exact circular porthole hole
  const wallShape = new THREE.Shape();
  wallShape.moveTo(-0.5, 0);
  wallShape.lineTo(0.5, 0);
  wallShape.lineTo(0.5, h);
  wallShape.lineTo(-0.5, h);
  wallShape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, centerY, radius, 0, Math.PI * 2, true);
  wallShape.holes.push(hole);

  extrudeCentered(ctx, wallShape, t, WALL_CREAM, { roughness: 0.86, curveSegments: 16 });
  addWallMoldings(ctx, WALL_CREAM, h);

  // Sculpted circular porthole rim on both faces + inner brass/wood liner sleeve
  const isMetallic = ctx.variant.id === 'brass';
  const rimOpts = { roughness: isMetallic ? 0.32 : 0.62, metalness: isMetallic ? 0.58 : 0.08 };
  for (const sz of [-t / 2 - 0.008, t / 2 + 0.008]) {
    ctx.torus(radius, 0.038, 7, 16, frameCol, 0, centerY, sz, rimOpts);
  }
  // Crossbar mullions
  ctx.box(radius * 1.94, 0.03, t * 0.56, shade(frameCol, -0.08), 0, centerY, 0, rimOpts);
  ctx.box(0.03, radius * 1.94, t * 0.56, shade(frameCol, -0.08), 0, centerY, 0, rimOpts);

  // Circular translucent sky glass disc
  ctx.cyl(radius - 0.006, radius - 0.006, 0.022, 16, primary, 0, centerY, 0, {
    rotX: Math.PI / 2,
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
}

function buildWindowClerestory(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameCol = resolveWindowFrameColor(ctx);
  const sillY = 1.88;
  const topY = 2.36;
  const openH = topY - sillY;
  const openCy = sillY + openH / 2;

  // Tall solid lower wall + narrow top header + slim outer piers
  ctx.box(1.0, sillY, t, WALL_CREAM, 0, sillY / 2, 0, { roughness: 0.86 });
  ctx.box(1.0, h - topY, t, WALL_CREAM, 0, topY + (h - topY) / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.47, 0.47]) {
    ctx.box(0.06, openH, t, WALL_CREAM, sx, openCy, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, WALL_CREAM, h);

  // Horizontal ribbon casing frame & slim sill
  ctx.box(0.94, 0.048, t + 0.065, frameCol, 0, sillY + 0.01, 0, { roughness: 0.62 });
  ctx.box(0.92, 0.042, t + 0.032, frameCol, 0, topY - 0.01, 0, { roughness: 0.64 });
  for (const sx of [-0.43, 0.43]) {
    ctx.box(0.042, openH, t + 0.03, frameCol, sx, openCy, 0, { roughness: 0.64 });
  }
  // Two vertical rhythm mullions dividing ribbon into 3 panes
  const mullionCol = shade(frameCol, -0.06);
  for (const mx of [-0.145, 0.145]) {
    ctx.box(0.032, openH - 0.04, t * 0.55, mullionCol, mx, openCy, 0, { roughness: 0.65 });
  }
  // Translucent ribbon glass
  ctx.box(0.84, openH - 0.06, 0.022, primary, 0, openCy, 0, {
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
}

// ============================================================================
// DISPATCHER
// ============================================================================

export const buildBasicsModel: TabModelBuilder = (ctx: ModelContext): boolean => {
  switch (ctx.def.id) {
    // Floors (6)
    case 'floor_wood':
      buildFloorWood(ctx);
      return true;
    case 'floor_herringbone':
      buildFloorHerringbone(ctx);
      return true;
    case 'floor_tile':
      buildFloorTile(ctx);
      return true;
    case 'floor_terrazzo':
      buildFloorTerrazzo(ctx);
      return true;
    case 'floor_stone':
      buildFloorStone(ctx);
      return true;
    case 'floor_checkerboard':
      buildFloorCheckerboard(ctx);
      return true;

    // Walls (6)
    case 'wall_plain':
      buildWallPlain(ctx);
      return true;
    case 'wall_brick':
      buildWallBrick(ctx);
      return true;
    case 'wall_wainscot':
      buildWallWainscot(ctx);
      return true;
    case 'wall_glass_partition':
      buildWallGlassPartition(ctx);
      return true;
    case 'wall_arch':
      buildWallArch(ctx);
      return true;
    case 'wall_half':
      buildWallHalf(ctx);
      return true;

    // Doors (4)
    case 'door_wood':
      buildDoorWood(ctx);
      return true;
    case 'door_cafe_glass':
      buildDoorCafeGlass(ctx);
      return true;
    case 'door_arched':
      buildDoorArched(ctx);
      return true;
    case 'door_sliding':
      buildDoorSliding(ctx);
      return true;

    // Windows (5)
    case 'window_wide':
      buildWindowWide(ctx);
      return true;
    case 'window_arched':
      buildWindowArched(ctx);
      return true;
    case 'window_bay':
      buildWindowBay(ctx);
      return true;
    case 'window_round':
      buildWindowRound(ctx);
      return true;
    case 'window_clerestory':
      buildWindowClerestory(ctx);
      return true;

    default:
      return false;
  }
};
