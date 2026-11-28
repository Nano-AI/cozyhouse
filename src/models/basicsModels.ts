import * as THREE from 'three';
import { WALL_THICKNESS } from '../engine/GridSystem';
import { type MergeSide, type ModelContext, type TabModelBuilder } from './ModelKit';

const WALL_CREAM = '#F5EFE4';
const BRASS = '#DFBC6E';
const BRASS_DARK = '#C49D4C';
const DARK_WOOD = '#8C6B4B';

/**
 * Removes duplicate consecutive vertices and trailing wrap-around vertex from a 2D polygon ring.
 */
function cleanRing2D(pts: THREE.Vector2[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (out.length === 0 || p.distanceToSquared(out[out.length - 1]) > 1e-10) {
      out.push(p.clone());
    }
  }
  while (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) <= 1e-10) {
    out.pop();
  }
  return out;
}

/**
 * Builds a watertight, solid flat-shaded extruded BufferGeometry centered on Z = 0
 * directly via THREE.ShapeUtils.triangulateShape.
 *
 * NOTE: Three.js r175 has a known bug where `THREE.ExtrudeGeometry({ bevelEnabled: false })`
 * skips populating `contractedContourVertices`, emitting 0 front/back cap triangles!
 * Building caps + sidewalls explicitly guarantees 100% solid front (+Z), back (-Z), and
 * outward sidewall faces with clean box-projected UVs and exact flat normals.
 */
function buildSolidExtrudeGeometry(
  shape: THREE.Shape,
  depth: number,
  curveSegments = 12,
): THREE.BufferGeometry {
  const extracted = shape.extractPoints(curveSegments);
  const contour = cleanRing2D(extracted.shape);
  if (THREE.ShapeUtils.isClockWise(contour)) {
    contour.reverse();
  }

  const holes: THREE.Vector2[][] = [];
  for (const rawHole of extracted.holes) {
    const hole = cleanRing2D(rawHole);
    if (hole.length < 3) continue;
    if (!THREE.ShapeUtils.isClockWise(hole)) {
      hole.reverse();
    }
    holes.push(hole);
  }

  const allPts: THREE.Vector2[] = [...contour];
  for (const h of holes) {
    for (const p of h) allPts.push(p);
  }

  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const halfD = depth / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    au: number,
    av: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    bv: number,
    cx: number,
    cy: number,
    cz: number,
    cu: number,
    cv: number,
    nx: number,
    ny: number,
    nz: number,
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(au, av, bu, bv, cu, cv);
  };

  // Front (+Z) and Back (-Z) solid cap faces
  for (let i = 0; i < faces.length; i++) {
    const [ia, ib, ic] = faces[i];
    const pA = allPts[ia];
    const pB = allPts[ib];
    const pC = allPts[ic];
    if (!pA || !pB || !pC) continue;
    // Ensure CCW in XY plane so front cap normal points strictly +Z
    const area2 = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x);
    const b = area2 >= 0 ? pB : pC;
    const c = area2 >= 0 ? pC : pB;

    pushTri(
      pA.x, pA.y, halfD, pA.x, pA.y,
      b.x, b.y, halfD, b.x, b.y,
      c.x, c.y, halfD, c.x, c.y,
      0, 0, 1,
    );
    pushTri(
      pA.x, pA.y, -halfD, pA.x, pA.y,
      c.x, c.y, -halfD, c.x, c.y,
      b.x, b.y, -halfD, b.x, b.y,
      0, 0, -1,
    );
  }

  // Extruded sidewalls for outer CCW contour and each CW hole
  const rings = [contour, ...holes];
  for (const ring of rings) {
    let dist = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p0 = ring[i];
      const p1 = ring[(i + 1) % n];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Right-hand normal: outward for CCW outer contour, inward-into-cutout for CW hole
      const nx = dy / len;
      const ny = -dx / len;
      const u0 = dist;
      const u1 = dist + len;
      dist = u1;

      pushTri(
        p0.x, p0.y, halfD, u0, halfD,
        p0.x, p0.y, -halfD, u0, -halfD,
        p1.x, p1.y, -halfD, u1, -halfD,
        nx, ny, 0,
      );
      pushTri(
        p0.x, p0.y, halfD, u0, halfD,
        p1.x, p1.y, -halfD, u1, -halfD,
        p1.x, p1.y, halfD, u1, halfD,
        nx, ny, 0,
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

/** Helper to extrude a 2D XY shape solidly and symmetrically centered on Z = 0. */
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
  const geo = buildSolidExtrudeGeometry(shape, depth, opts?.curveSegments ?? 12);
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

/**
 * Standard matching baseboard + top crown molding for full-height wall segments.
 * Inset 0.004 per horizontal end (w = 0.992) and offset >= 0.006 per face to eliminate Z-fighting.
 */
function addWallMoldings(
  ctx: ModelContext,
  wallColor: string,
  h: number,
  opts?: { skipBaseboard?: boolean; baseboardTrim?: string; crownTrim?: string },
): void {
  const t = WALL_THICKNESS;
  const trimW = 0.990;
  if (!opts?.skipBaseboard) {
    const baseColor = opts?.baseboardTrim ?? ctx.shade(wallColor, 0.12);
    // Baseboard cleanly clear of y = 0: y = [0.006 .. 0.122], +0.014 proud per face
    ctx.box(trimW, 0.116, t + 0.028, baseColor, 0, 0.064, 0, { roughness: 0.72 });
    // Cap bead strictly above baseboard: y = [0.122 .. 0.140], +0.020 proud per face
    ctx.box(trimW, 0.018, t + 0.04, ctx.shade(baseColor, -0.09), 0, 0.131, 0, { roughness: 0.75 });
  }
  const crownColor = opts?.crownTrim ?? ctx.shade(wallColor, 0.14);
  // Two non-overlapping stepped crown tiers cleanly below wall top y = h - 0.006
  ctx.box(trimW, 0.050, t + 0.028, crownColor, 0, h - 0.064, 0, { roughness: 0.72 });
  ctx.box(trimW, 0.033, t + 0.048, ctx.shade(crownColor, 0.06), 0, h - 0.0225, 0, { roughness: 0.7 });
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
// FLOOR TILES (6) — strictly y = [0.004 .. 0.024], footprint 0.996 x 0.996
// ============================================================================

function buildFloorWood(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Dark seam backing slab: y = [0.004 .. 0.017], inset 0.002 per side
  ctx.box(0.996, 0.013, 0.996, shade(primary, -0.22), 0, 0.0105, 0, {
    roughness: 0.88,
    castShadow: false,
  });
  // 4 longitudinal hardwood plank lanes strictly above backing: y = [0.017 .. 0.024]
  const lanes: Array<{ x: number; splitZ: number; toneA: number; toneB: number }> = [
    { x: -0.371, splitZ: 0.14, toneA: 0.03, toneB: -0.05 },
    { x: -0.124, splitZ: -0.20, toneA: -0.03, toneB: 0.05 },
    { x: 0.124, splitZ: 0.24, toneA: 0.04, toneB: -0.04 },
    { x: 0.371, splitZ: -0.12, toneA: -0.06, toneB: 0.02 },
  ];
  const plankW = 0.232;
  const gap = 0.014;
  const bound = 0.492;
  for (const lane of lanes) {
    const lenA = lane.splitZ - -bound - gap / 2;
    const czA = -bound + lenA / 2;
    ctx.box(plankW, 0.007, lenA, shade(primary, lane.toneA), lane.x, 0.0205, czA, {
      roughness: 0.72,
      castShadow: false,
    });
    const lenB = bound - lane.splitZ - gap / 2;
    const czB = bound - lenB / 2;
    ctx.box(plankW, 0.007, lenB, shade(primary, lane.toneB), lane.x, 0.0205, czB, {
      roughness: 0.74,
      castShadow: false,
    });
  }
}

function buildFloorHerringbone(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  // Backing slab: y = [0.004 .. 0.017]
  ctx.box(0.996, 0.013, 0.996, shade(accent, -0.2), 0, 0.0105, 0, {
    roughness: 0.86,
    castShadow: false,
  });
  // Two non-overlapping chevron columns of angled parquet slats: y = [0.017 .. 0.024]
  // Half-extent of (0.205, 0.086) at 45 deg = 0.1029 < offset 0.115 -> strictly zero overlap!
  const colCenters = [-0.25, 0.25];
  const zRows = [-0.32, 0.0, 0.32];
  const slatL = 0.205;
  const slatW = 0.086;
  for (let c = 0; c < colCenters.length; c++) {
    const cx = colCenters[c];
    for (let r = 0; r < zRows.length; r++) {
      const rz = zRows[r];
      const leftColor = (r + c) % 2 === 0 ? primary : shade(primary, 0.06);
      const rightColor = (r + c) % 2 === 0 ? accent : shade(accent, -0.05);
      ctx.box(slatL, 0.007, slatW, leftColor, cx - 0.115, 0.0205, rz, {
        rotY: Math.PI / 4,
        roughness: 0.68,
        castShadow: false,
      });
      ctx.box(slatL, 0.007, slatW, rightColor, cx + 0.115, 0.0205, rz, {
        rotY: -Math.PI / 4,
        roughness: 0.72,
        castShadow: false,
      });
    }
  }
}

function buildFloorTile(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Grout backing: y = [0.004 .. 0.017]
  ctx.box(0.996, 0.013, 0.996, shade(primary, -0.18), 0, 0.0105, 0, {
    roughness: 0.9,
    castShadow: false,
  });
  // 2x2 glazed ceramic tiles: y = [0.017 .. 0.0235], inner gap 0.044
  const coords: Array<[number, number, number]> = [
    [-0.248, -0.248, 0.0],
    [0.248, -0.248, 0.04],
    [-0.248, 0.248, 0.03],
    [0.248, 0.248, -0.02],
  ];
  for (const [x, z, tone] of coords) {
    ctx.box(0.452, 0.0065, 0.452, shade(primary, tone), x, 0.02025, z, {
      roughness: 0.34,
      metalness: 0.04,
      castShadow: false,
    });
  }
  // Small center diamond cabochon strictly inside the 0.044 grout cross: y = [0.017 .. 0.024]
  ctx.box(0.052, 0.007, 0.052, shade(primary, -0.12), 0, 0.0205, 0, {
    rotY: Math.PI / 4,
    roughness: 0.4,
    castShadow: false,
  });
}

function buildFloorTerrazzo(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  // Edge grout rim: y = [0.004 .. 0.014]
  ctx.box(0.996, 0.010, 0.996, shade(primary, -0.14), 0, 0.009, 0, {
    roughness: 0.85,
    castShadow: false,
  });
  // Smooth terrazzo slab cleanly above rim: y = [0.014 .. 0.0205]
  ctx.box(0.980, 0.0065, 0.980, primary, 0, 0.01725, 0, {
    roughness: 0.46,
    castShadow: false,
  });
  // Scattered non-overlapping pastel terrazzo stone chips strictly on top: y = [0.0205 .. 0.024]
  const chips: Array<[number, number, number, number, number, string]> = [
    [-0.34, -0.32, 0.10, 0.065, 0.4, accent],
    [-0.08, -0.38, 0.075, 0.075, 1.1, '#E7C888'],
    [0.28, -0.30, 0.11, 0.075, -0.5, shade(accent, -0.18)],
    [-0.38, -0.02, 0.085, 0.10, 0.8, '#B8CFC0'],
    [-0.12, -0.08, 0.12, 0.075, -0.3, shade(accent, -0.1)],
    [0.18, -0.05, 0.075, 0.085, 0.6, '#D99E8C'],
    [0.39, 0.04, 0.085, 0.065, 1.3, accent],
    [-0.26, 0.24, 0.11, 0.085, -0.7, '#9FAFC2'],
    [0.02, 0.19, 0.085, 0.065, 0.3, accent],
    [0.32, 0.28, 0.10, 0.09, 0.9, '#E6C68A'],
    [-0.38, 0.38, 0.075, 0.065, -0.4, shade(accent, -0.2)],
    [0.10, 0.38, 0.095, 0.065, 0.5, '#B8CFC0'],
  ];
  for (const [x, z, w, d, rotY, col] of chips) {
    ctx.box(w, 0.0035, d, col, x, 0.02225, z, {
      rotY,
      roughness: 0.5,
      castShadow: false,
    });
  }
}

function buildFloorStone(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Earthy recessed mortar bed: y = [0.004 .. 0.016]
  ctx.box(0.996, 0.012, 0.996, shade(primary, -0.26), 0, 0.010, 0, {
    roughness: 0.95,
    castShadow: false,
  });
  // Non-overlapping sculpted flagstone slabs strictly above mortar: y = [0.016 .. 0.024]
  const stones: Array<[number, number, number, number, number, number, number]> = [
    [-0.25, -0.28, 0.43, 0.35, 0.008, 0.04, 0.02],
    [0.24, -0.31, 0.43, 0.29, 0.0074, -0.06, -0.02],
    [-0.31, 0.10, 0.31, 0.31, 0.008, -0.04, -0.02],
    [0.06, 0.04, 0.33, 0.29, 0.0076, 0.07, 0.02],
    [0.36, 0.08, 0.19, 0.35, 0.0074, -0.08, 0.01],
    [-0.20, 0.38, 0.51, 0.17, 0.0078, 0.02, -0.01],
    [0.27, 0.38, 0.35, 0.17, 0.0076, -0.03, 0.01],
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
  // Grout backing: y = [0.004 .. 0.017]
  ctx.box(0.996, 0.013, 0.996, shade(primary, -0.2), 0, 0.0105, 0, {
    roughness: 0.88,
    castShadow: false,
  });
  // 2x2 checks strictly above grout: y = [0.017 .. 0.024]
  const cells: Array<[number, number, string]> = [
    [-0.248, -0.248, primary],
    [0.248, -0.248, accent],
    [-0.248, 0.248, accent],
    [0.248, 0.248, primary],
  ];
  for (const [x, z, col] of cells) {
    ctx.box(0.470, 0.007, 0.470, col, x, 0.0205, z, {
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
  // Recessed mortar core (faces at +-0.062)
  ctx.box(1.0, h, t - 0.016, accent, 0, h / 2, 0, { roughness: 0.92 });
  // Baseboard & top cornice inset 0.005 per side, clear of y = 0 & y = h by 0.006
  ctx.box(0.990, 0.132, t + 0.028, shade(primary, -0.22), 0, 0.072, 0, { roughness: 0.8 });
  ctx.box(0.990, 0.060, t + 0.032, shade(primary, -0.18), 0, h - 0.036, 0, { roughness: 0.78 });

  // 7 staggered 3D relief brick courses spanning both wall faces (+0.016 proud of mortar!)
  const brickD = t + 0.016;
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
  const railY = 0.96;

  // Full structural wall core (upper plaster + lower wainscot core, cleanly stacked!)
  ctx.box(1.0, h - railY, t, primary, 0, railY + (h - railY) / 2, 0, { roughness: 0.86 });
  ctx.box(1.0, railY, t, accent, 0, railY / 2, 0, { roughness: 0.78 });

  // Wainscot cladding proudly offset +0.008 per face, cleanly below railY (0.954)
  ctx.box(0.990, railY - 0.138, t + 0.016, accent, 0, 0.132 + (railY - 0.138) / 2, 0, {
    roughness: 0.76,
  });
  // Baseboard skirting cleanly clear of y = 0: y = [0.006 .. 0.132], +0.016 per face
  ctx.box(0.990, 0.126, t + 0.032, shade(accent, -0.09), 0, 0.069, 0, { roughness: 0.72 });
  // Sculpted chair rail ledge cleanly above railY seam: y = [0.966 .. 1.028], +0.024 per face
  ctx.box(0.990, 0.062, t + 0.048, shade(accent, 0.08), 0, railY + 0.037, 0, { roughness: 0.68 });

  // Two side-by-side framed wainscoting shaker panels (+0.007 then +0.006 proud per face!)
  for (const sx of [-0.24, 0.24]) {
    ctx.box(0.38, 0.64, t + 0.030, shade(accent, 0.09), sx, 0.54, 0, { roughness: 0.74 });
    ctx.box(0.28, 0.52, t + 0.042, shade(accent, -0.05), sx, 0.54, 0, { roughness: 0.78 });
  }
  addWallMoldings(ctx, primary, h, { skipBaseboard: true });
}

function buildWallGlassPartition(ctx: ModelContext): void {
  const { primary, accent } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const frameOpts = { roughness: 0.42, metalness: 0.28 };
  const innerH = h - 0.26;
  const innerCy = 0.15 + innerH / 2;

  // Bottom solid kick-plinth (y = 0..0.15) and top transom beam (y = h - 0.11..h)
  ctx.box(1.0, 0.15, t, accent, 0, 0.075, 0, frameOpts);
  ctx.box(1.0, 0.11, t, accent, 0, h - 0.055, 0, frameOpts);
  // Outer vertical stiles strictly between plinth and transom (zero overlap!)
  for (const sx of [-0.465, 0.465]) {
    ctx.box(0.07, innerH, t - 0.012, accent, sx, innerCy, 0, frameOpts);
  }
  // Center vertical mullion (d = 0.092) & 3 horizontal muntin bars (d = 0.076 -> +0.008 Z separation!)
  ctx.box(0.042, innerH, 0.092, accent, 0, innerCy, 0, frameOpts);
  for (const my of [0.74, 1.34, 1.94]) {
    ctx.box(0.86, 0.038, 0.076, accent, 0, my, 0, frameOpts);
  }
  // Translucent glass panel cleanly centered & inset from mullions/stiles (d = 0.022)
  ctx.box(0.844, innerH - 0.014, 0.022, primary, 0, innerCy, 0, {
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

  // Sculpted arch surround trim rim on both faces (+0.012 per face, starts cleanly above baseboard)
  const trimShape = makeArchTrimShape(openHalfW - 0.005, 0.045, 0.132, springY);
  extrudeCentered(ctx, trimShape, t + 0.024, shade(primary, 0.1), {
    roughness: 0.74,
    curveSegments: 14,
  });

  // Baseboard cuffs on the left & right piers (inset 0.004 from +-0.5, y = [0.002..0.132])
  for (const sx of [-0.418, 0.418]) {
    ctx.box(0.156, 0.13, t + 0.032, shade(primary, 0.12), sx, 0.067, 0, { roughness: 0.72 });
  }
  addWallMoldings(ctx, primary, h, { skipBaseboard: true });
}

function buildWallHalf(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height; // 1.15
  const t = WALL_THICKNESS;
  const capH = 0.075;
  const bodyH = h - capH; // 1.075

  // Main half-wall body
  ctx.box(1.0, bodyH, t, primary, 0, bodyH / 2, 0, { roughness: 0.84 });
  // Baseboard inset 0.004 per side: y = [0.002 .. 0.132]
  ctx.box(0.992, 0.13, t + 0.028, shade(primary, -0.07), 0, 0.067, 0, { roughness: 0.74 });
  // Twin shaker decorative panels (+0.008 then +0.006 proud per face!)
  for (const sx of [-0.24, 0.24]) {
    ctx.box(0.38, 0.66, t + 0.016, shade(primary, -0.06), sx, 0.56, 0, { roughness: 0.8 });
    ctx.box(0.30, 0.56, t + 0.028, shade(primary, 0.04), sx, 0.56, 0, { roughness: 0.78 });
  }
  // Underside corbel trim cleanly below bodyH top seam: y = [1.038 .. 1.068]
  ctx.box(0.990, 0.030, t + 0.036, shade(accent, -0.14), 0, bodyH - 0.022, 0, { roughness: 0.68 });
  // Overhanging wooden cap ledge flush at y = 1.15, inset 0.002 per side so adjacent half-walls never clash
  ctx.box(0.996, capH, t + 0.075, accent, 0, h - capH / 2, 0, { roughness: 0.62 });
}

// ============================================================================
// DOORS (4) — Single & Merged Double-Door Support + DoorPivot animation hooks
// ============================================================================

interface DoorGeometrySpec {
  hasLeftJamb: boolean;
  hasRightJamb: boolean;
  pivotX: number;
  swingSign: -1 | 1;
  leafDir: 1 | -1; // direction leaf extends from pivotX (+1 rightward, -1 leftward)
  leafW: number;
  openLeft: number;
  openRight: number;
}

function getSwingDoorSpec(mergeSide: MergeSide | undefined): DoorGeometrySpec {
  if (mergeSide === 'left') {
    return {
      hasLeftJamb: true,
      hasRightJamb: false,
      pivotX: -0.39,
      swingSign: -1,
      leafDir: 1,
      leafW: 0.876,
      openLeft: -0.39,
      openRight: 0.498,
    };
  }
  if (mergeSide === 'right') {
    return {
      hasLeftJamb: false,
      hasRightJamb: true,
      pivotX: 0.39,
      swingSign: 1,
      leafDir: -1,
      leafW: 0.876,
      openLeft: -0.498,
      openRight: 0.39,
    };
  }
  if (mergeSide === 'middle') {
    return {
      hasLeftJamb: false,
      hasRightJamb: false,
      pivotX: -0.485,
      swingSign: -1,
      leafDir: 1,
      leafW: 0.96,
      openLeft: -0.498,
      openRight: 0.498,
    };
  }
  return {
    hasLeftJamb: true,
    hasRightJamb: true,
    pivotX: -0.39,
    swingSign: -1,
    leafDir: 1,
    leafW: 0.78,
    openLeft: -0.39,
    openRight: 0.39,
  };
}

function addStandardDoorWallFrame(
  ctx: ModelContext,
  h: number,
  openH: number,
  spec: DoorGeometrySpec,
): void {
  const { accent, shade } = ctx;
  const t = WALL_THICKNESS;
  const headH = h - openH;
  // Full wall header above opening
  ctx.box(1.0, headH, t, accent, 0, openH + headH / 2, 0, { roughness: 0.86 });

  const trimCol = shade(accent, -0.08);
  // Outer wall piers & jamb casings only on unmerged edges (clear of y = 0 & openH by 0.006!)
  if (spec.hasLeftJamb) {
    ctx.box(0.10, openH, t, accent, -0.45, openH / 2, 0, { roughness: 0.86 });
    ctx.box(0.05, openH - 0.012, t + 0.026, trimCol, -0.415, openH / 2, 0, {
      roughness: 0.72,
    });
  }
  if (spec.hasRightJamb) {
    ctx.box(0.10, openH, t, accent, 0.45, openH / 2, 0, { roughness: 0.86 });
    ctx.box(0.05, openH - 0.012, t + 0.026, trimCol, 0.415, openH / 2, 0, {
      roughness: 0.72,
    });
  }

  // Raised header lintel cleanly above openH seam (+0.006) & inset 0.006 from merged seam
  const lintelL = spec.hasLeftJamb ? -0.46 : -0.494;
  const lintelR = spec.hasRightJamb ? 0.46 : 0.494;
  ctx.box(lintelR - lintelL, 0.058, t + 0.032, trimCol, (lintelL + lintelR) / 2, openH + 0.035, 0, {
    roughness: 0.72,
  });

  // Threshold plate across opening: y = [0.002 .. 0.024]
  const thrW = spec.openRight - spec.openLeft;
  ctx.box(thrW, 0.022, t + 0.022, DARK_WOOD, (spec.openLeft + spec.openRight) / 2, 0.013, 0, {
    roughness: 0.65,
  });

  addWallMoldings(ctx, accent, h, { skipBaseboard: true });
}

function buildDoorWood(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const h = ctx.def.height;
  const openH = 2.08;
  const spec = getSwingDoorSpec(ctx.mergeSide);
  addStandardDoorWallFrame(ctx, h, openH, spec);

  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.userData.swingSign = spec.swingSign;
  pivot.position.set(spec.pivotX, 0, 0);
  pivot.rotation.y = ctx.isActive ? spec.swingSign * Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafH = openH - 0.034;
  const leafD = 0.062;
  const cx = spec.leafDir * (spec.leafW / 2);
  // Main solid wood door leaf
  ctx.box(spec.leafW, leafH, leafD, primary, cx, 0.024 + leafH / 2, 0, {
    parent: pivot,
    roughness: 0.72,
  });
  // Upper & lower recessed shaker molding panels (+0.007 then +0.006 proud per face!)
  const panelOuterW = spec.leafW - 0.22;
  const panelInnerW = spec.leafW - 0.30;
  for (const [py, ph] of [
    [1.48, 0.76],
    [0.58, 0.64],
  ] as const) {
    ctx.box(panelOuterW, ph + 0.04, leafD + 0.014, shade(primary, 0.08), cx, py, 0, {
      parent: pivot,
      roughness: 0.72,
    });
    ctx.box(panelInnerW, ph - 0.04, leafD + 0.026, shade(primary, -0.11), cx, py, 0, {
      parent: pivot,
      roughness: 0.78,
    });
  }
  // Brass escutcheon plate + round doorknobs near meeting edge on both sides
  const knobX = spec.leafDir * (spec.leafW - 0.09);
  ctx.box(0.044, 0.12, leafD + 0.028, BRASS_DARK, knobX, 1.0, 0, {
    parent: pivot,
    roughness: 0.32,
    metalness: 0.62,
  });
  for (const sz of [-0.060, 0.060]) {
    ctx.sphere(0.035, 8, BRASS, knobX, 1.0, sz, {
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
  const spec = getSwingDoorSpec(ctx.mergeSide);
  addStandardDoorWallFrame(ctx, h, openH, spec);

  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.userData.swingSign = spec.swingSign;
  pivot.position.set(spec.pivotX, 0, 0);
  pivot.rotation.y = ctx.isActive ? spec.swingSign * Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafD = 0.062;
  const cx = spec.leafDir * (spec.leafW / 2);
  const stileW = 0.092;
  const glassW = spec.leafW - stileW * 2;

  // Lower painted solid panel: y = [0.024 .. 0.884]
  ctx.box(spec.leafW, 0.86, leafD, primary, cx, 0.454, 0, { parent: pivot, roughness: 0.72 });
  // Brushed brass kickplate (+0.008 proud per face)
  ctx.box(spec.leafW - 0.06, 0.13, leafD + 0.016, BRASS_DARK, cx, 0.098, 0, {
    parent: pivot,
    roughness: 0.35,
    metalness: 0.55,
  });
  // Upper window door stiles strictly between lower panel (0.884) and top rail (1.964)
  const midH = 1.08;
  const midCy = 0.884 + midH / 2;
  ctx.box(stileW, midH, leafD, primary, spec.leafDir * (stileW / 2), midCy, 0, {
    parent: pivot,
    roughness: 0.72,
  });
  ctx.box(stileW, midH, leafD, primary, spec.leafDir * (spec.leafW - stileW / 2), midCy, 0, {
    parent: pivot,
    roughness: 0.72,
  });
  // Top rail strictly above stiles: y = [1.964 .. 2.058]
  ctx.box(spec.leafW, 0.094, leafD, primary, cx, 2.011, 0, { parent: pivot, roughness: 0.72 });

  // Cross mullions with distinct Z depth (vertical 0.048 vs horizontal 0.034 -> +0.007 per face!)
  ctx.box(0.032, midH - 0.004, 0.048, shade(primary, 0.08), cx, midCy, 0, {
    parent: pivot,
    roughness: 0.7,
  });
  ctx.box(glassW - 0.004, 0.032, 0.034, shade(primary, 0.08), cx, midCy + 0.02, 0, {
    parent: pivot,
    roughness: 0.7,
  });
  // Translucent café glass pane cleanly inset inside mullions & stiles (d = 0.020)
  ctx.box(glassW - 0.014, midH - 0.014, 0.020, '#CBE6F2', cx, midCy, 0, {
    parent: pivot,
    opacity: 0.38,
    roughness: 0.12,
    metalness: 0.1,
    castShadow: false,
  });
  // Wooden hanging café door sign plaque proudly clear of mullions (d = 0.060)
  ctx.box(0.24, 0.11, 0.060, '#FAF2E3', cx, 1.24, 0, { parent: pivot, roughness: 0.76 });
  // Vertical brass café push/pull handles with flush standoff pegs on both sides
  const handleX = spec.leafDir * (spec.leafW - 0.09);
  for (const sz of [-0.056, 0.056]) {
    ctx.cyl(0.015, 0.015, 0.26, 7, BRASS, handleX, 1.02, sz, {
      parent: pivot,
      roughness: 0.28,
      metalness: 0.68,
    });
  }
  for (const hy of [0.92, 1.12]) {
    ctx.box(0.018, 0.018, 0.112, BRASS_DARK, handleX, hy, 0, {
      parent: pivot,
      roughness: 0.3,
      metalness: 0.65,
    });
  }
}

function buildDoorArched(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const h = ctx.def.height;
  const t = WALL_THICKNESS;
  const mergeSide = ctx.mergeSide;
  const spec = getSwingDoorSpec(mergeSide);
  const leafD = 0.062;

  if (mergeSide === 'left' || mergeSide === 'right') {
    // Grand converged double arch spanning both doors seamlessly across the center seam!
    const isLeft = mergeSide === 'left';
    const R = 0.89; // from outer jamb (-0.39) to center seam (+0.50)
    const springY = 1.42;
    const apexY = springY + R; // 2.31 (leaves 0.29 spandrel below h = 2.60)

    const wallShape = new THREE.Shape();
    if (isLeft) {
      wallShape.moveTo(-0.5, 0);
      wallShape.lineTo(-0.39, 0);
      wallShape.lineTo(-0.39, springY);
      wallShape.absarc(0.5, springY, R, Math.PI, Math.PI / 2, true);
      wallShape.lineTo(0.5, h);
      wallShape.lineTo(-0.5, h);
      wallShape.closePath();
    } else {
      wallShape.moveTo(-0.5, apexY);
      wallShape.absarc(-0.5, springY, R, Math.PI / 2, 0, true);
      wallShape.lineTo(0.39, 0);
      wallShape.lineTo(0.5, 0);
      wallShape.lineTo(0.5, h);
      wallShape.lineTo(-0.5, h);
      wallShape.closePath();
    }
    extrudeCentered(ctx, wallShape, t, accent, { roughness: 0.86, curveSegments: 16 });

    // Sculpted quarter-arch surround trim rim (+0.013 per face, inset 0.002 from center seam)
    const trimW = 0.048;
    const innerR = R - 0.004;
    const outerR = innerR + trimW;
    const trimShape = new THREE.Shape();
    if (isLeft) {
      trimShape.moveTo(-0.39 - trimW, 0.002);
      trimShape.lineTo(-0.39 + 0.004, 0.002);
      trimShape.lineTo(-0.39 + 0.004, springY);
      trimShape.absarc(0.5, springY, innerR, Math.PI, Math.PI / 2 + 0.003, true);
      trimShape.lineTo(0.498, springY + outerR);
      trimShape.absarc(0.5, springY, outerR, Math.PI / 2 + 0.003, Math.PI, false);
      trimShape.closePath();
    } else {
      trimShape.moveTo(-0.498, springY + outerR);
      trimShape.lineTo(-0.498, springY + innerR);
      trimShape.absarc(-0.5, springY, innerR, Math.PI / 2 - 0.003, 0, true);
      trimShape.lineTo(0.39 - 0.004, 0.002);
      trimShape.lineTo(0.39 + trimW, 0.002);
      trimShape.lineTo(0.39 + trimW, springY);
      trimShape.absarc(-0.5, springY, outerR, 0, Math.PI / 2 - 0.003, false);
      trimShape.closePath();
    }
    extrudeCentered(ctx, trimShape, t + 0.026, shade(accent, -0.09), {
      roughness: 0.74,
      curveSegments: 16,
    });

    // Threshold & crown molding
    const thrW = spec.openRight - spec.openLeft;
    ctx.box(thrW, 0.022, t + 0.022, DARK_WOOD, (spec.openLeft + spec.openRight) / 2, 0.013, 0, {
      roughness: 0.65,
    });
    addWallMoldings(ctx, accent, h, { skipBaseboard: true });

    // Hinged unified single-piece quarter-arch door leaf inside DoorPivot
    const pivot = new THREE.Group();
    pivot.name = 'DoorPivot';
    pivot.userData.swingSign = spec.swingSign;
    pivot.position.set(spec.pivotX, 0, 0);
    pivot.rotation.y = ctx.isActive ? spec.swingSign * Math.PI * 0.44 : 0;
    ctx.group.add(pivot);

    const leafBotY = 0.032;
    const leafR = R - 0.014; // 0.876
    const angPad = 0.014;
    const leafEdgeX = 0.89 - leafR * Math.sin(angPad); // ~0.8777 (exact vertical edge at arc end!)
    const leafTopMeetY = springY + leafR * Math.cos(angPad);

    const leafShape = new THREE.Shape();
    if (isLeft) {
      leafShape.moveTo(0.014, leafBotY);
      leafShape.lineTo(leafEdgeX, leafBotY);
      leafShape.lineTo(leafEdgeX, leafTopMeetY);
      leafShape.absarc(0.89, springY, leafR, Math.PI / 2 + angPad, Math.PI, false);
      leafShape.closePath();
    } else {
      leafShape.moveTo(-leafEdgeX, leafBotY);
      leafShape.lineTo(-0.014, leafBotY);
      leafShape.lineTo(-0.014, springY);
      leafShape.absarc(-0.89, springY, leafR, 0, Math.PI / 2 - angPad, false);
      leafShape.lineTo(-leafEdgeX, leafBotY);
      leafShape.closePath();
    }
    extrudeCentered(ctx, leafShape, leafD, primary, {
      parent: pivot,
      roughness: 0.72,
      curveSegments: 16,
    });

    // Matching curved quarter-arch recessed accent panel cleanly proud (+0.007 per face)
    const inPad = 0.11;
    const inR = leafR - inPad;
    const inAngPad = 0.14;
    const inEdgeX = 0.89 - inR * Math.sin(inAngPad);
    const inTopY = springY + inR * Math.cos(inAngPad);
    const panelShape = new THREE.Shape();
    if (isLeft) {
      panelShape.moveTo(0.014 + inPad, 0.20);
      panelShape.lineTo(inEdgeX, 0.20);
      panelShape.lineTo(inEdgeX, inTopY);
      panelShape.absarc(0.89, springY, inR, Math.PI / 2 + inAngPad, Math.PI, false);
      panelShape.closePath();
    } else {
      panelShape.moveTo(-inEdgeX, 0.20);
      panelShape.lineTo(-0.014 - inPad, 0.20);
      panelShape.lineTo(-0.014 - inPad, springY);
      panelShape.absarc(-0.89, springY, inR, 0, Math.PI / 2 - inAngPad, false);
      panelShape.lineTo(-inEdgeX, 0.20);
      panelShape.closePath();
    }
    extrudeCentered(ctx, panelShape, leafD + 0.014, shade(primary, -0.09), {
      parent: pivot,
      roughness: 0.78,
      curveSegments: 14,
    });

    // Sleek flush brass barrel hinges along hinge edge & brass doorknob near center seam
    for (const hy of [0.42, 1.24]) {
      ctx.cyl(0.014, 0.014, 0.09, 7, BRASS_DARK, spec.leafDir * 0.014, hy, 0, {
        parent: pivot,
        roughness: 0.34,
        metalness: 0.62,
      });
    }
    const knobX = spec.leafDir * (leafEdgeX - 0.085);
    ctx.box(0.040, 0.11, leafD + 0.024, BRASS_DARK, knobX, 0.98, 0, {
      parent: pivot,
      roughness: 0.32,
      metalness: 0.62,
    });
    for (const sz of [-0.056, 0.056]) {
      ctx.sphere(0.034, 8, BRASS, knobX, 0.98, sz, {
        parent: pivot,
        roughness: 0.28,
        metalness: 0.68,
      });
    }
    return;
  }

  if (mergeSide === 'middle') {
    // Middle bay of a 3+ arched door span: solid header y = 2.26..2.60 matching arch crown!
    const midOpenH = 2.26;
    addStandardDoorWallFrame(ctx, h, midOpenH, spec);
    const pivot = new THREE.Group();
    pivot.name = 'DoorPivot';
    pivot.userData.swingSign = spec.swingSign;
    pivot.position.set(spec.pivotX, 0, 0);
    pivot.rotation.y = ctx.isActive ? spec.swingSign * Math.PI * 0.44 : 0;
    ctx.group.add(pivot);

    const cx = spec.leafW / 2;
    const leafH = midOpenH - 0.044;
    ctx.box(spec.leafW, leafH, leafD, primary, cx, 0.032 + leafH / 2, 0, {
      parent: pivot,
      roughness: 0.72,
    });
    ctx.box(spec.leafW - 0.24, leafH - 0.36, leafD + 0.014, shade(primary, -0.09), cx, 0.032 + leafH / 2, 0, {
      parent: pivot,
      roughness: 0.78,
    });
    for (const sz of [-0.056, 0.056]) {
      ctx.sphere(0.034, 8, BRASS, spec.leafW - 0.09, 0.98, sz, {
        parent: pivot,
        roughness: 0.28,
        metalness: 0.68,
      });
    }
    return;
  }

  // Standalone single arched cottage door
  const openHalfW = 0.39;
  const springY = 1.68;

  const wallShape = makeWallWithArchOpening(h, openHalfW, 0, springY);
  extrudeCentered(ctx, wallShape, t, accent, { roughness: 0.86, curveSegments: 16 });

  const trimShape = makeArchTrimShape(openHalfW - 0.004, 0.048, 0.006, springY);
  extrudeCentered(ctx, trimShape, t + 0.026, shade(accent, -0.09), {
    roughness: 0.74,
    curveSegments: 16,
  });

  ctx.box(0.78, 0.022, t + 0.022, DARK_WOOD, 0, 0.013, 0, { roughness: 0.65 });
  addWallMoldings(ctx, accent, h, { skipBaseboard: true });

  const pivot = new THREE.Group();
  pivot.name = 'DoorPivot';
  pivot.userData.swingSign = -1;
  pivot.position.set(-0.39, 0, 0);
  pivot.rotation.y = ctx.isActive ? -Math.PI * 0.44 : 0;
  ctx.group.add(pivot);

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0.008, 0.032);
  leafShape.lineTo(0.772, 0.032);
  leafShape.lineTo(0.772, springY);
  leafShape.absarc(0.39, springY, 0.382, 0, Math.PI, false);
  leafShape.closePath();
  extrudeCentered(ctx, leafShape, leafD, primary, {
    parent: pivot,
    roughness: 0.72,
    curveSegments: 16,
  });

  const insetShape = new THREE.Shape();
  insetShape.moveTo(0.12, 0.22);
  insetShape.lineTo(0.66, 0.22);
  insetShape.lineTo(0.66, springY - 0.04);
  insetShape.absarc(0.39, springY - 0.04, 0.27, 0, Math.PI, false);
  insetShape.closePath();
  extrudeCentered(ctx, insetShape, leafD + 0.014, shade(primary, -0.09), {
    parent: pivot,
    roughness: 0.78,
    curveSegments: 14,
  });

  // Sleek flush brass barrel hinges & brass doorknob + escutcheon
  for (const hy of [0.42, 1.38]) {
    ctx.cyl(0.014, 0.014, 0.09, 7, BRASS_DARK, 0.014, hy, 0, {
      parent: pivot,
      roughness: 0.34,
      metalness: 0.62,
    });
  }
  ctx.box(0.040, 0.11, leafD + 0.024, BRASS_DARK, 0.68, 0.98, 0, {
    parent: pivot,
    roughness: 0.32,
    metalness: 0.62,
  });
  for (const sz of [-0.056, 0.056]) {
    ctx.sphere(0.034, 8, BRASS, 0.68, 0.98, sz, {
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
  const mergeSide = ctx.mergeSide;
  const hasLeftJamb = mergeSide !== 'right' && mergeSide !== 'middle';
  const hasRightJamb = mergeSide !== 'left' && mergeSide !== 'middle';

  // Surrounding wall header & outer jambs only on unmerged sides
  ctx.box(1.0, h - openH, t, accent, 0, openH + (h - openH) / 2, 0, { roughness: 0.86 });
  if (hasLeftJamb) {
    ctx.box(0.06, openH, t, accent, -0.47, openH / 2, 0, { roughness: 0.86 });
  }
  if (hasRightJamb) {
    ctx.box(0.06, openH, t, accent, 0.47, openH / 2, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, accent, h, { skipBaseboard: true });

  // Top & bottom sliding tracks spanning cleanly across opening (inset 0.002 on merged edges!)
  const trkL = hasLeftJamb ? -0.44 : -0.498;
  const trkR = hasRightJamb ? 0.44 : 0.498;
  const trkW = trkR - trkL;
  const trkCx = (trkL + trkR) / 2;
  const trackCol = shade(primary, -0.2);
  ctx.box(trkW, 0.036, t + 0.012, trackCol, trkCx, 0.020, 0, { roughness: 0.5, metalness: 0.2 });
  ctx.box(trkW, 0.040, t + 0.012, trackCol, trkCx, openH - 0.020, 0, {
    roughness: 0.5,
    metalness: 0.2,
  });

  const panelBot = 0.038;
  const panelTop = openH - 0.040;
  const panelH = panelTop - panelBot;
  const panelCy = panelBot + panelH / 2;

  const addPatioLeaf = (
    cx: number,
    w: number,
    cz: number,
    parent: THREE.Object3D,
    handleSide: 'left' | 'right' | 'none',
  ) => {
    const d = 0.038;
    const rail = 0.048;
    // Top & bottom horizontal rails
    ctx.box(w, rail, d, primary, cx, panelBot + rail / 2, cz, { parent, roughness: 0.58 });
    ctx.box(w, rail, d, primary, cx, panelTop - rail / 2, cz, { parent, roughness: 0.58 });
    // Left & right vertical stiles strictly between top & bottom rails (zero overlap!)
    const stileH = panelH - rail * 2;
    ctx.box(rail, stileH, d, primary, cx - w / 2 + rail / 2, panelCy, cz, {
      parent,
      roughness: 0.58,
    });
    ctx.box(rail, stileH, d, primary, cx + w / 2 - rail / 2, panelCy, cz, {
      parent,
      roughness: 0.58,
    });
    // Clear glass pane centered cleanly inside frame
    ctx.box(w - rail * 2 - 0.004, stileH - 0.004, 0.016, '#C7E5F2', cx, panelCy, cz, {
      parent,
      opacity: 0.35,
      roughness: 0.1,
      metalness: 0.12,
      castShadow: false,
    });
    if (handleSide !== 'none') {
      const hx = handleSide === 'left' ? cx - w / 2 + 0.052 : cx + w / 2 - 0.052;
      for (const dz of [-0.026, 0.026]) {
        ctx.box(0.022, 0.26, 0.020, BRASS, hx, 1.04, cz + dz, {
          parent,
          roughness: 0.3,
          metalness: 0.65,
        });
      }
    }
  };

  if (mergeSide === 'left' || mergeSide === 'right') {
    // Bi-parting double patio slider: full-bay sliding glass leaf parting outward symmetrically!
    const isLeft = mergeSide === 'left';
    const slideSign = isLeft ? -1 : 1;
    const slider = new THREE.Group();
    slider.name = 'DoorPivot';
    slider.userData.isSliding = true;
    slider.userData.slideSign = slideSign;
    slider.userData.swingSign = slideSign;
    slider.position.set(ctx.isActive ? slideSign * 0.62 : 0, 0, 0);
    ctx.group.add(slider);

    const leafW = 0.91;
    const leafCx = isLeft ? 0.035 : -0.035;
    addPatioLeaf(leafCx, leafW, isLeft ? 0.028 : -0.028, slider, isLeft ? 'right' : 'left');
    return;
  }

  if (mergeSide === 'middle') {
    const slider = new THREE.Group();
    slider.name = 'DoorPivot';
    slider.userData.isSliding = true;
    slider.userData.slideSign = -1;
    slider.userData.swingSign = -1;
    slider.position.set(ctx.isActive ? -0.62 : 0, 0, 0);
    ctx.group.add(slider);
    addPatioLeaf(0, 0.96, 0.028, slider, 'right');
    return;
  }

  // Standalone single sliding patio door: fixed left leaf (rear track) + sliding right leaf (front track)
  addPatioLeaf(-0.21, 0.45, -0.028, ctx.group, 'none');

  const slider = new THREE.Group();
  slider.name = 'DoorPivot';
  slider.userData.isSliding = true;
  slider.userData.slideSign = -1;
  slider.userData.swingSign = -1;
  slider.position.set(ctx.isActive ? -0.36 : 0, 0, 0);
  ctx.group.add(slider);
  addPatioLeaf(0.21, 0.45, 0.028, slider, 'left');
}

// ============================================================================
// WINDOWS (5) — wall surround + strictly non-overlapping casing, mullions, glass
// ============================================================================

function resolveWindowFrameColor(ctx: ModelContext): string {
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

  // Wall surround (strictly non-overlapping bottom, top & side piers)
  ctx.box(1.0, sillY, t, WALL_CREAM, 0, sillY / 2, 0, { roughness: 0.86 });
  ctx.box(1.0, h - topY, t, WALL_CREAM, 0, topY + (h - topY) / 2, 0, { roughness: 0.86 });
  for (const sx of [-0.45, 0.45]) {
    ctx.box(0.10, openH, t, WALL_CREAM, sx, openCy, 0, { roughness: 0.86 });
  }
  addWallMoldings(ctx, WALL_CREAM, h);

  // Deep protruding sill strictly below casing jambs: y = [0.835 .. 0.895]
  ctx.box(0.92, 0.06, t + 0.088, frameCol, 0, 0.865, 0, { roughness: 0.62 });
  // Top casing strictly above jambs: y = [2.090 .. 2.145]
  ctx.box(0.88, 0.055, t + 0.042, frameCol, 0, 2.1175, 0, { roughness: 0.65 });
  // Side casing jambs strictly between sill (0.895) and top casing (2.090)
  const jambH = 2.090 - 0.895;
  const jambCy = 0.895 + jambH / 2;
  for (const sx of [-0.395, 0.395]) {
    ctx.box(0.055, jambH, t + 0.030, frameCol, sx, jambCy, 0, { roughness: 0.65 });
  }
  // Cross mullions with distinct Z depth (vertical 0.082 vs horizontal 0.066 -> +0.008 per face!)
  const mullionCol = shade(frameCol, -0.06);
  ctx.box(0.034, jambH - 0.004, 0.082, mullionCol, 0, jambCy, 0, { roughness: 0.65 });
  ctx.box(0.73, 0.034, 0.066, mullionCol, 0, jambCy + 0.06, 0, { roughness: 0.65 });

  // Translucent sky-tinted glass pane cleanly inset inside mullions
  ctx.box(0.716, jambH - 0.014, 0.022, primary, 0, jambCy, 0, {
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

  // Deep protruding sill: y = [0.825 .. 0.885]
  ctx.box(0.88, 0.06, t + 0.088, frameCol, 0, 0.855, 0, { roughness: 0.62 });
  // Sculpted arched casing rim strictly starting above sill at y = 0.885
  const trimShape = makeArchTrimShape(openHalfW - 0.005, 0.048, 0.885, springY);
  extrudeCentered(ctx, trimShape, t + 0.032, frameCol, { roughness: 0.64, curveSegments: 14 });

  // Cross mullions with distinct Z depth (horizontal 0.080 vs vertical 0.064 -> +0.008 per face!)
  const mullionCol = shade(frameCol, -0.06);
  ctx.box(openHalfW * 2 - 0.01, 0.036, 0.080, mullionCol, 0, springY, 0, { roughness: 0.65 });
  const vLen = springY - 0.888 + openHalfW - 0.02;
  ctx.box(0.034, vLen, 0.064, mullionCol, 0, 0.888 + vLen / 2, 0, { roughness: 0.65 });

  // Exact arched glass pane cleanly inside mullions
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-openHalfW + 0.01, 0.888);
  glassShape.lineTo(openHalfW - 0.01, 0.888);
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

  // Exterior 3-facet protruding bay box (-Z projection): strictly clear of seatY (0.72) & topY (2.14)!
  ctx.box(0.88, 0.064, 0.30, frameCol, 0, seatY - 0.038, -0.12, { roughness: 0.68 });
  ctx.box(0.92, 0.074, 0.34, frameCol, 0, topY + 0.043, -0.12, { roughness: 0.66 });
  ctx.box(0.76, 0.056, 0.24, shade(frameCol, -0.12), 0, topY + 0.108, -0.13, { roughness: 0.7 });

  // Vertical bay corner posts strictly inside +-0.42 opening & clear of floor/roof seams
  const postH = openH - 0.012;
  for (const sx of [-0.395, 0.395]) {
    ctx.box(0.044, postH, 0.044, frameCol, sx, openCy, -0.05, { roughness: 0.62 });
  }
  for (const sx of [-0.26, 0.26]) {
    ctx.box(0.044, postH, 0.044, frameCol, sx, openCy, -0.24, { roughness: 0.62 });
  }

  // Center rear glass pane (d = 0.020, inset from mullion ends) + horizontal transom mullion (d = 0.038)
  ctx.box(0.456, postH - 0.012, 0.020, primary, 0, openCy, -0.24, {
    opacity: 0.38,
    roughness: 0.1,
    metalness: 0.12,
    castShadow: false,
  });
  ctx.box(0.474, 0.032, 0.038, frameCol, 0, openCy + 0.14, -0.24, { roughness: 0.65 });

  for (const dir of [-1, 1] as const) {
    ctx.box(0.21, postH - 0.012, 0.020, primary, dir * 0.328, openCy, -0.145, {
      rotY: dir * -0.9,
      opacity: 0.38,
      roughness: 0.1,
      metalness: 0.12,
      castShadow: false,
    });
  }

  // Interior cozy cushioned window seat sill (+Z facing into room, strictly clear of bay posts!)
  ctx.box(0.82, 0.054, 0.24, frameCol, 0, seatY + 0.033, 0.12, { roughness: 0.64 });
  ctx.box(0.76, 0.072, 0.26, '#EFE2CE', 0, seatY + 0.096, 0.08, { roughness: 0.9 });
  // Cozy corner seat pillow cleanly on top of cushion
  ctx.box(0.18, 0.18, 0.09, '#E4B29D', -0.27, seatY + 0.222, 0.06, {
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

  // Sculpted circular porthole rim on both faces
  const isMetallic = ctx.variant.id === 'brass';
  const rimOpts = { roughness: isMetallic ? 0.32 : 0.62, metalness: isMetallic ? 0.58 : 0.08 };
  for (const sz of [-t / 2 - 0.010, t / 2 + 0.010]) {
    ctx.torus(radius, 0.038, 7, 16, frameCol, 0, centerY, sz, rimOpts);
  }
  // Crossbar mullions with distinct Z depth (horizontal 0.082 vs vertical 0.066 -> +0.008 per face!)
  ctx.box(radius * 1.92, 0.030, 0.082, shade(frameCol, -0.08), 0, centerY, 0, rimOpts);
  ctx.box(0.030, radius * 1.92, 0.066, shade(frameCol, -0.08), 0, centerY, 0, rimOpts);

  // Circular translucent sky glass disc cleanly inside crossbars
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

  // Horizontal ribbon casing frame: sill below (1.855..1.903), top above (2.338..2.380), jambs strictly between!
  ctx.box(0.94, 0.048, t + 0.068, frameCol, 0, 1.879, 0, { roughness: 0.62 });
  ctx.box(0.92, 0.042, t + 0.036, frameCol, 0, 2.359, 0, { roughness: 0.64 });
  const innerH = 2.338 - 1.903;
  const innerCy = 1.903 + innerH / 2;
  for (const sx of [-0.43, 0.43]) {
    ctx.box(0.042, innerH, t + 0.028, frameCol, sx, innerCy, 0, { roughness: 0.64 });
  }
  // Two vertical rhythm mullions strictly between sill & top trim
  const mullionCol = shade(frameCol, -0.06);
  for (const mx of [-0.145, 0.145]) {
    ctx.box(0.032, innerH - 0.004, 0.074, mullionCol, mx, innerCy, 0, { roughness: 0.65 });
  }
  // Translucent ribbon glass cleanly inset inside mullions
  ctx.box(0.806, innerH - 0.016, 0.022, primary, 0, innerCy, 0, {
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
