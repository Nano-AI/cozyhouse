import * as THREE from 'three';
import { FLOOR_BASE_Y, type MergeSide, type ModelContext, type TabModelBuilder } from './ModelKit';

const WARM_OAK = '#C49A6C';
const OAK_DARK = '#A57E55';
const CREAM_LINEN = '#F7F1E7';
const BRASS = '#DFBC6E';

/**
 * Computes horizontal X span for a 2-tile-wide bed element.
 * On merged edges ('left' merges +X, 'right' merges -X, 'middle' merges both),
 * extends seamlessly to +-(1.0 - 0.002) = +-0.998 so adjacent beds converge with zero Z-fighting.
 */
function mergedBedSpanX(
  mergeSide: MergeSide | undefined,
  outerHalf: number,
  edgeHalf = 0.998,
): { w: number; cx: number; left: number; right: number } {
  const left = mergeSide === 'right' || mergeSide === 'middle' ? -edgeHalf : -outerHalf;
  const right = mergeSide === 'left' || mergeSide === 'middle' ? edgeHalf : outerHalf;
  return { w: right - left, cx: (left + right) / 2, left, right };
}

// ============================================================================
// BEDS (4) — bed_cozy, bed_canopy & bed_daybed support double-bed merging!
// ============================================================================

function buildBedCozy(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const mergeSide = ctx.mergeSide;
  const hasLeftEdge = mergeSide !== 'right' && mergeSide !== 'middle';
  const hasRightEdge = mergeSide !== 'left' && mergeSide !== 'middle';

  // Grounded wooden feet only on unmerged outer edges (plus centered support for middle span)
  const legXs: number[] = [];
  if (hasLeftEdge) legXs.push(-0.79);
  if (hasRightEdge) legXs.push(0.79);
  if (legXs.length === 0) legXs.push(0);
  for (const lx of legXs) {
    for (const lz of [-0.82, 0.82]) {
      ctx.cyl(0.042, 0.036, 0.12, 6, OAK_DARK, lx, baseY + 0.06, lz, { roughness: 0.72 });
    }
  }

  // Bed base frame cleanly between headboard (-0.82) and footboard (+0.84): y = [0.144 .. 0.294]
  const baseSpan = mergedBedSpanX(mergeSide, 0.87);
  ctx.box(baseSpan.w, 0.15, 1.66, WARM_OAK, baseSpan.cx, baseY + 0.195, 0.01, { roughness: 0.72 });

  // Sculpted slatted wooden headboard strictly behind bed frame (z = [-0.91 .. -0.82])
  const headSpan = mergedBedSpanX(mergeSide, 0.89);
  ctx.box(headSpan.w, 0.696, 0.09, WARM_OAK, headSpan.cx, baseY + 0.468, -0.865, {
    roughness: 0.72,
  });
  // Headboard cap strictly ON TOP of headboard: y = [0.840 .. 0.896]
  const capSpan = mergedBedSpanX(mergeSide, 0.91);
  ctx.box(capSpan.w, 0.056, 0.11, OAK_DARK, capSpan.cx, baseY + 0.844, -0.865, {
    roughness: 0.68,
  });
  // Headboard proud inset decorative panel (+0.014 proud of -0.82 face!)
  const insetSpan = mergedBedSpanX(mergeSide, 0.78, 0.992);
  ctx.box(insetSpan.w, 0.44, 0.024, shade(WARM_OAK, 0.1), insetSpan.cx, baseY + 0.54, -0.808, {
    roughness: 0.75,
  });
  // Footboard lip strictly in front of bed frame (z = [+0.84 .. +0.91])
  const footSpan = mergedBedSpanX(mergeSide, 0.88);
  ctx.box(footSpan.w, 0.24, 0.07, WARM_OAK, footSpan.cx, baseY + 0.24, 0.875, { roughness: 0.72 });

  // Plush mattress cleanly ON TOP of bed base: y = [0.294 .. 0.464] (top = 0.464 for sitting!)
  // Inset slightly (0.990) on merged edges so the proud outer duvet (0.998) never shares coplanar side faces
  const matSpan = mergedBedSpanX(mergeSide, 0.81, 0.990);
  ctx.box(matSpan.w, 0.17, 1.59, accent, matSpan.cx, baseY + 0.355, 0.015, { roughness: 0.88 });

  // Folded cozy duvet blanket proud of mattress (+0.020 top, +0.025 front, +0.008 merged side!)
  const duvetSpan = mergedBedSpanX(mergeSide, 0.84, 0.998);
  ctx.box(duvetSpan.w, 0.176, 1.13, primary, duvetSpan.cx, baseY + 0.372, 0.27, {
    roughness: 0.9,
  });
  // Turned-down top sheet cuff cleanly ON TOP of duvet/mattress: y = [0.484 .. 0.526]
  const cuffSpan = mergedBedSpanX(mergeSide, 0.83);
  ctx.box(cuffSpan.w, 0.042, 0.18, accent, cuffSpan.cx, baseY + 0.481, -0.24, { roughness: 0.9 });
  // Knitted throw runner cleanly ON TOP of duvet: y = [0.484 .. 0.524]
  const throwSpan = mergedBedSpanX(mergeSide, 0.855);
  ctx.box(throwSpan.w, 0.040, 0.28, shade(primary, -0.18), throwSpan.cx, baseY + 0.480, 0.62, {
    roughness: 0.94,
  });

  // Two plump angled pillows shifted slightly toward outer edge when converged into a double bed!
  const pillowShift = mergeSide === 'left' ? -0.07 : mergeSide === 'right' ? 0.07 : 0;
  ctx.box(0.66, 0.13, 0.36, accent, -0.39 + pillowShift, baseY + 0.515, -0.55, {
    rotX: 0.22,
    roughness: 0.92,
  });
  ctx.box(0.66, 0.13, 0.36, shade(primary, 0.28), 0.39 + pillowShift, baseY + 0.515, -0.55, {
    rotX: 0.22,
    roughness: 0.92,
  });
}

function buildBedCanopy(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const postH = 2.02;
  const topY = baseY + postH - 0.05;
  const mergeSide = ctx.mergeSide;
  const hasLeftEdge = mergeSide !== 'right' && mergeSide !== 'middle';
  const hasRightEdge = mergeSide !== 'left' && mergeSide !== 'middle';

  // Tall corner canopy posts + finials + side beams ONLY on unmerged outer edges!
  const postXs: number[] = [];
  if (hasLeftEdge) postXs.push(-0.84);
  if (hasRightEdge) postXs.push(0.84);
  for (const sx of postXs) {
    for (const sz of [-0.84, 0.84]) {
      ctx.cyl(0.034, 0.038, postH, 8, accent, sx, baseY + postH / 2, sz, { roughness: 0.68 });
      ctx.sphere(0.048, 7, shade(accent, -0.1), sx, baseY + postH + 0.02, sz, { roughness: 0.65 });
    }
    // Side canopy beam strictly between front/back crown beams (z = [-0.80 .. +0.80])
    ctx.box(0.055, 0.055, 1.60, accent, sx, topY, 0, { roughness: 0.68 });
  }
  if (postXs.length === 0) {
    // Hidden center floor feet for middle span support
    for (const sz of [-0.76, 0.76]) {
      ctx.cyl(0.032, 0.028, 0.14, 6, accent, 0, baseY + 0.07, sz, { roughness: 0.72 });
    }
  }

  // Front & back top canopy crown tie beams extend seamlessly across merged edge!
  const crownSpan = mergedBedSpanX(mergeSide, 0.86);
  ctx.box(crownSpan.w, 0.055, 0.055, accent, crownSpan.cx, topY, -0.84, { roughness: 0.68 });
  ctx.box(crownSpan.w, 0.055, 0.055, accent, crownSpan.cx, topY, 0.84, { roughness: 0.68 });

  // Bed frame base: y = [0.164 .. 0.304] & low slatted headboard strictly ON TOP behind mattress
  const baseSpan = mergedBedSpanX(mergeSide, 0.85);
  ctx.box(baseSpan.w, 0.14, 1.64, accent, baseSpan.cx, baseY + 0.21, 0, { roughness: 0.72 });
  const headSpan = mergedBedSpanX(mergeSide, 0.83);
  ctx.box(headSpan.w, 0.48, 0.072, shade(accent, -0.06), headSpan.cx, baseY + 0.52, -0.82, {
    roughness: 0.72,
  });

  // Plush mattress cleanly ON TOP of frame: y = [0.304 .. 0.464] (top = 0.464!)
  // Inset slightly (0.990) on merged edges so the proud duvet (0.998) has zero coplanar side faces
  const matSpan = mergedBedSpanX(mergeSide, 0.79, 0.990);
  ctx.box(matSpan.w, 0.16, 1.52, CREAM_LINEN, matSpan.cx, baseY + 0.36, 0.015, { roughness: 0.88 });
  // Pastel duvet proud above, in front (+0.025), and beside mattress: y = [0.314 .. 0.484]
  const duvetSpan = mergedBedSpanX(mergeSide, 0.82, 0.998);
  ctx.box(duvetSpan.w, 0.17, 1.08, primary, duvetSpan.cx, baseY + 0.375, 0.26, { roughness: 0.92 });

  // Pillows shifted subtly toward outer edge when merged
  const pillowShift = mergeSide === 'left' ? -0.07 : mergeSide === 'right' ? 0.07 : 0;
  ctx.box(0.60, 0.125, 0.33, CREAM_LINEN, -0.36 + pillowShift, baseY + 0.51, -0.52, {
    rotX: 0.2,
    roughness: 0.92,
  });
  ctx.box(0.60, 0.125, 0.33, shade(primary, 0.16), 0.36 + pillowShift, baseY + 0.51, -0.52, {
    rotX: 0.2,
    roughness: 0.92,
  });

  // Soft sheer overhead canopy fabric resting flush on top of crown beams
  const drapeCol = shade(primary, 0.14);
  const canopySpan = mergedBedSpanX(mergeSide, 0.82);
  ctx.box(canopySpan.w, 0.024, 1.62, drapeCol, canopySpan.cx, topY + 0.041, 0, {
    opacity: 0.68,
    roughness: 0.95,
    castShadow: false,
  });
  // Gathered corner curtain drapes connected continuously through mid tie-back cuffs!
  const drapeXs: number[] = [];
  if (hasLeftEdge) drapeXs.push(-0.78);
  if (hasRightEdge) drapeXs.push(0.78);
  for (const sx of drapeXs) {
    for (const sz of [-0.78, 0.78]) {
      ctx.cyl(0.105, 0.064, 1.06, 7, drapeCol, sx, topY - 0.53, sz, {
        opacity: 0.76,
        roughness: 0.95,
      });
      ctx.cyl(0.072, 0.072, 0.07, 7, shade(primary, -0.16), sx, topY - 1.06, sz, {
        roughness: 0.88,
      });
      ctx.cyl(0.064, 0.115, 0.66, 7, drapeCol, sx, baseY + 0.58, sz, {
        opacity: 0.76,
        roughness: 0.95,
      });
    }
  }
}

function buildBedDaybed(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const mergeSide = ctx.mergeSide;
  const hasLeftEdge = mergeSide !== 'right' && mergeSide !== 'middle';
  const hasRightEdge = mergeSide !== 'left' && mergeSide !== 'middle';

  // Tapered wooden legs only on unmerged outer sides (or center for middle)
  const legXs: number[] = [];
  if (hasLeftEdge) legXs.push(-0.83);
  if (hasRightEdge) legXs.push(0.83);
  if (legXs.length === 0) legXs.push(0);
  for (const lx of legXs) {
    for (const lz of [-0.35, 0.35]) {
      ctx.cyl(0.032, 0.028, 0.18, 6, OAK_DARK, lx, baseY + 0.09, lz, { roughness: 0.72 });
    }
  }

  // Slatted daybed base platform: y = [0.204 .. 0.304]
  const baseSpan = mergedBedSpanX(mergeSide, 0.91);
  ctx.box(baseSpan.w, 0.10, 0.84, WARM_OAK, baseSpan.cx, baseY + 0.23, 0, { roughness: 0.72 });

  // Back top rail: y = [0.724 .. 0.784] & vertical spindles strictly between base (0.304) and rail (0.724)
  const backSpan = mergedBedSpanX(mergeSide, 0.92);
  ctx.box(backSpan.w, 0.06, 0.064, WARM_OAK, backSpan.cx, baseY + 0.73, -0.39, { roughness: 0.7 });
  const spindleCount = 5;
  const spStart = backSpan.left + 0.14;
  const spEnd = backSpan.right - 0.14;
  for (let i = 0; i < spindleCount; i++) {
    const x = spStart + (i / (spindleCount - 1)) * (spEnd - spStart);
    ctx.box(0.045, 0.42, 0.04, OAK_DARK, x, baseY + 0.49, -0.39, { roughness: 0.72 });
  }

  // Slatted side arm rails & side cylindrical bolsters ONLY on unmerged outer edges!
  const armXs: number[] = [];
  if (hasLeftEdge) armXs.push(-0.88);
  if (hasRightEdge) armXs.push(0.88);
  for (const sx of armXs) {
    // Arm top rail stops cleanly in front of back rail (z = [-0.355 .. +0.42])
    ctx.box(0.06, 0.054, 0.775, WARM_OAK, sx, baseY + 0.627, 0.0325, { roughness: 0.7 });
    // Arm vertical spindles strictly between base (0.304) and arm rail (0.624)
    ctx.box(0.045, 0.32, 0.05, OAK_DARK, sx, baseY + 0.44, 0.38, { roughness: 0.72 });
    ctx.box(0.045, 0.32, 0.04, OAK_DARK, sx, baseY + 0.44, 0, { roughness: 0.72 });
    // Cylindrical bolster tucked inside outer arm cleanly on top of mattress
    const bx = sx > 0 ? 0.73 : -0.73;
    ctx.cyl(0.09, 0.09, 0.62, 9, accent, bx, baseY + 0.53, 0.03, {
      rotX: Math.PI / 2,
      roughness: 0.92,
    });
  }

  // Tailored bench mattress cleanly ON TOP of base: y = [0.304 .. 0.464] (top = 0.464!)
  const matSpan = mergedBedSpanX(mergeSide, 0.845);
  ctx.box(matSpan.w, 0.16, 0.74, primary, matSpan.cx, baseY + 0.36, 0.02, { roughness: 0.9 });

  // Two plush back pillows shifted slightly toward outer edge when merged
  const pillowShift = mergeSide === 'left' ? -0.08 : mergeSide === 'right' ? 0.08 : 0;
  ctx.box(0.54, 0.27, 0.14, accent, -0.32 + pillowShift, baseY + 0.575, -0.23, {
    rotX: -0.16,
    roughness: 0.92,
  });
  ctx.box(0.54, 0.27, 0.14, shade(primary, 0.15), 0.32 + pillowShift, baseY + 0.575, -0.23, {
    rotX: -0.16,
    roughness: 0.92,
  });

  // Cozy folded throw draped cleanly over outer front corner (non-overlapping top + flap!)
  if (mergeSide !== 'middle') {
    const throwX = mergeSide === 'left' ? -0.40 : 0.40;
    const throwCol = shade(accent, -0.1);
    // Top fold strictly above mattress (0.464): y = [0.468 .. 0.508], z = [-0.05 .. +0.395]
    ctx.box(0.40, 0.040, 0.445, throwCol, throwX, baseY + 0.464, 0.1725, { roughness: 0.95 });
    // Front hanging flap strictly in front of mattress & top fold: z = [+0.395 .. +0.435]
    ctx.box(0.40, 0.24, 0.040, throwCol, throwX, baseY + 0.364, 0.415, { roughness: 0.95 });
  }
}

function buildBedLoft(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const postH = 1.80;

  // 4 tall loft timber corner posts proudly outside inner deck
  for (const sx of [-0.865, 0.865]) {
    for (const sz of [-0.845, 0.845]) {
      ctx.box(0.074, postH, 0.074, accent, sx, baseY + postH / 2, sz, { roughness: 0.72 });
    }
  }
  // Upper loft platform deck strictly between posts: y = [1.149 .. 1.259]
  const deckY = baseY + 1.18;
  ctx.box(1.66, 0.11, 1.62, accent, 0, deckY, 0, { roughness: 0.72 });

  // Upper safety guardrails strictly spanning between inner post faces
  const railY = deckY + 0.36;
  ctx.box(1.656, 0.055, 0.048, accent, 0, railY, -0.845, { roughness: 0.72 });
  ctx.box(0.048, 0.055, 1.616, accent, -0.865, railY, 0, { roughness: 0.72 });
  ctx.box(0.048, 0.055, 1.616, accent, 0.865, railY, 0, { roughness: 0.72 });
  ctx.box(1.14, 0.055, 0.048, accent, -0.258, railY, 0.845, { roughness: 0.72 });
  ctx.box(1.14, 0.04, 0.04, shade(accent, -0.06), -0.258, deckY + 0.20, 0.845, { roughness: 0.74 });

  // Built-in climb ladder cleanly proud on front-right (+Z = 0.895, clear of posts!)
  const ladCol = shade(accent, -0.1);
  ctx.box(0.044, 1.24, 0.044, ladCol, 0.36, baseY + 0.62, 0.895, { roughness: 0.72 });
  ctx.box(0.044, 1.24, 0.044, ladCol, 0.76, baseY + 0.62, 0.895, { roughness: 0.72 });
  for (let i = 0; i < 4; i++) {
    ctx.box(0.356, 0.036, 0.042, ladCol, 0.56, baseY + 0.24 + i * 0.29, 0.895, { roughness: 0.72 });
  }

  // Upper mattress cleanly ON TOP of deck: y = [1.259 .. 1.389]
  ctx.box(1.60, 0.13, 1.56, CREAM_LINEN, 0, deckY + 0.12, 0, { roughness: 0.9 });
  // Duvet proud above & beside mattress: y = [1.269 .. 1.409]
  ctx.box(1.63, 0.14, 1.08, primary, 0, deckY + 0.135, 0.22, { roughness: 0.92 });
  ctx.box(0.58, 0.11, 0.32, CREAM_LINEN, -0.40, deckY + 0.245, -0.52, {
    rotX: 0.18,
    roughness: 0.92,
  });

  // Cozy under-loft chill futon strictly grounded on short legs & non-overlapping (seat top = 0.424!)
  for (const fx of [-0.72, 0.36]) {
    for (const fz of [-0.62, -0.06]) {
      ctx.cyl(0.022, 0.018, 0.045, 4, shade(accent, -0.2), fx, baseY + 0.0225, fz, {
        roughness: 0.72,
      });
    }
  }
  ctx.box(1.22, 0.12, 0.68, shade(accent, -0.12), -0.18, baseY + 0.105, -0.34, { roughness: 0.74 });
  ctx.box(1.18, 0.20, 0.64, shade(primary, 0.12), -0.18, baseY + 0.264, -0.32, { roughness: 0.92 });
  ctx.box(1.18, 0.34, 0.14, primary, -0.18, baseY + 0.54, -0.58, { rotX: -0.14, roughness: 0.92 });
  ctx.box(0.28, 0.22, 0.09, CREAM_LINEN, -0.52, baseY + 0.48, -0.42, {
    rotY: 0.3,
    rotZ: 0.2,
    roughness: 0.92,
  });
  // Cute round floor pouf underneath
  ctx.cyl(0.22, 0.23, 0.18, 10, shade(primary, -0.12), -0.32, baseY + 0.09, 0.36, {
    roughness: 0.94,
  });
}

// ============================================================================
// SEATING (5) — clean cushion tops (0.42..0.49) & strictly zero coplanar overlap
// ============================================================================

function buildSofaPlush(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  ctx.legs(1.72, 0.76, 0.12, 0.032, OAK_DARK, baseY, 0.08);
  // Upholstered base deck: y = [0.144 .. 0.284], z = [-0.25 .. +0.39]
  ctx.box(1.74, 0.14, 0.64, shade(primary, -0.09), 0, baseY + 0.19, 0.07, { roughness: 0.88 });
  // Back frame strictly behind base deck & armrests: z = [-0.40 .. -0.25], y = [0.144 .. 0.804]
  ctx.box(1.74, 0.66, 0.15, shade(primary, -0.07), 0, baseY + 0.45, -0.325, { roughness: 0.88 });

  // Padded side armrests cleanly ON TOP of base deck (y = [0.284 .. 0.594]), in front of back frame
  for (const sx of [-0.79, 0.79]) {
    ctx.box(0.16, 0.31, 0.64, shade(primary, -0.04), sx, baseY + 0.415, 0.07, { roughness: 0.9 });
    ctx.cyl(0.08, 0.08, 0.62, 8, primary, sx, baseY + 0.57, 0.07, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
  }
  // Two plump seat cushions cleanly ON TOP of deck (+0.004 proud): y = [0.288 .. 0.452] (top = 0.452!)
  for (const sx of [-0.355, 0.355]) {
    ctx.box(0.69, 0.164, 0.62, primary, sx, baseY + 0.346, 0.08, { roughness: 0.9 });
  }
  // Two plump reclining back cushions cleanly above seat & in front of back frame
  for (const sx of [-0.355, 0.355]) {
    ctx.box(0.68, 0.34, 0.16, shade(primary, 0.06), sx, baseY + 0.61, -0.155, {
      rotX: -0.14,
      roughness: 0.92,
    });
  }
  // Cozy cream accent throw pillow tucked in left corner
  ctx.box(0.25, 0.23, 0.095, CREAM_LINEN, -0.54, baseY + 0.55, 0.0, {
    rotY: 0.35,
    rotZ: 0.24,
    roughness: 0.94,
  });
}

function buildSofaSectional(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Low wooden feet under L-footprint: y = [0.024 .. 0.124]
  const footCoords: Array<[number, number]> = [
    [-0.82, -0.82],
    [0.82, -0.82],
    [0.82, -0.14],
    [-0.82, 0.82],
    [-0.14, 0.82],
  ];
  for (const [fx, fz] of footCoords) {
    ctx.cyl(0.032, 0.026, 0.10, 6, OAK_DARK, fx, baseY + 0.05, fz, { roughness: 0.72 });
  }

  // Strictly non-overlapping L-shaped base plinth: y = [0.124 .. 0.274]
  // Back run spans z = [-0.89 .. -0.08]; chaise run spans z = [-0.08 .. +0.89]
  ctx.box(1.80, 0.15, 0.81, accent, 0, baseY + 0.175, -0.485, { roughness: 0.88 });
  ctx.box(0.84, 0.15, 0.97, accent, -0.48, baseY + 0.175, 0.405, { roughness: 0.88 });

  // Strictly non-overlapping backrest & armrests sitting ON TOP of base plinth (y >= 0.274)
  // Backrest spans full width at z = [-0.89 .. -0.72]
  ctx.box(1.80, 0.54, 0.17, accent, 0, baseY + 0.52, -0.805, { roughness: 0.88 });
  // Left wrap armrest starts strictly in front of backrest at z = [-0.72 .. +0.32]
  ctx.box(0.17, 0.44, 1.04, accent, -0.815, baseY + 0.47, -0.20, { roughness: 0.88 });
  // Right end armrest starts strictly in front of backrest at z = [-0.72 .. -0.08]
  ctx.box(0.17, 0.36, 0.64, accent, 0.815, baseY + 0.43, -0.40, { roughness: 0.88 });

  // Plump seat cushions cleanly ON TOP of plinth (+0.004 proud): y = [0.278 .. 0.448] (top = 0.448!)
  ctx.box(0.75, 0.17, 0.64, primary, 0.335, baseY + 0.339, -0.39, { roughness: 0.92 });
  ctx.box(0.67, 0.17, 0.64, primary, -0.385, baseY + 0.339, -0.39, { roughness: 0.92 });
  ctx.box(0.78, 0.17, 0.94, primary, -0.46, baseY + 0.339, 0.415, { roughness: 0.92 });

  // Plump backrest cushions cleanly above seat cushions & clear of frames
  ctx.box(0.72, 0.34, 0.16, shade(primary, 0.05), 0.34, baseY + 0.60, -0.625, {
    rotX: -0.13,
    roughness: 0.92,
  });
  ctx.box(0.66, 0.34, 0.16, shade(primary, 0.05), -0.38, baseY + 0.60, -0.625, {
    rotX: -0.13,
    roughness: 0.92,
  });
  ctx.box(0.16, 0.32, 0.62, shade(primary, 0.04), -0.635, baseY + 0.59, -0.12, {
    rotZ: 0.13,
    roughness: 0.92,
  });

  // Two contrasting throw pillows nestled in the corner
  ctx.box(0.27, 0.24, 0.095, '#EAB7A0', -0.48, baseY + 0.545, -0.45, {
    rotY: 0.78,
    rotZ: 0.18,
    roughness: 0.94,
  });
  ctx.box(0.24, 0.22, 0.09, CREAM_LINEN, 0.56, baseY + 0.535, -0.46, {
    rotY: -0.38,
    rotZ: -0.2,
    roughness: 0.94,
  });
}

function buildLoveseatTufted(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  ctx.legs(1.60, 0.70, 0.15, 0.028, OAK_DARK, baseY, 0.08);
  // Base deck: y = [0.174 .. 0.304]
  ctx.box(1.62, 0.13, 0.74, shade(primary, -0.08), 0, baseY + 0.215, 0, { roughness: 0.88 });
  // Plush single bench seat cushion cleanly ON TOP (+0.004 proud): y = [0.308 .. 0.464] (top = 0.464!)
  ctx.box(1.36, 0.156, 0.60, primary, 0, baseY + 0.362, 0.06, { roughness: 0.9 });

  // Curved flared rolled armrests sitting ON TOP of base deck & in front of backrest
  for (const dir of [-1, 1] as const) {
    ctx.box(0.14, 0.29, 0.58, shade(primary, -0.05), dir * 0.75, baseY + 0.425, 0.06, {
      rotZ: dir * -0.12,
      roughness: 0.9,
    });
    ctx.cyl(0.084, 0.084, 0.58, 9, primary, dir * 0.78, baseY + 0.58, 0.06, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
  }

  // Tufted contoured backrest strictly ON TOP of base deck behind cushion: z = [-0.37 .. -0.22]
  ctx.box(1.44, 0.44, 0.15, primary, 0, baseY + 0.50, -0.295, { rotX: -0.05, roughness: 0.9 });
  // Scalloped curved crown cylinders slightly narrower in Z (0.136 vs 0.15 -> zero coplanar overlap!)
  for (const [cx, r] of [
    [-0.44, 0.24],
    [0, 0.27],
    [0.44, 0.24],
  ] as const) {
    ctx.cyl(r, r, 0.136, 10, shade(primary, 0.03), cx, baseY + 0.67, -0.30, {
      rotX: Math.PI / 2,
      scaleZ: 0.56,
      roughness: 0.9,
    });
  }

  // Six tactile tufted button dimples proudly offset in front of backrest (-0.212)
  const btnCol = shade(primary, -0.24);
  for (const bx of [-0.42, 0, 0.42]) {
    for (const by of [0.50, 0.64]) {
      ctx.sphere(0.024, 6, btnCol, bx, baseY + by, -0.205, { roughness: 0.85 });
    }
  }
}

function buildArmchairPlush(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const cz = -0.08;

  // 4 angled mid-century reading chair legs: y = [0.024 .. 0.184]
  for (const sx of [-0.28, 0.28]) {
    for (const sz of [cz - 0.23, cz + 0.23]) {
      ctx.cyl(0.024, 0.017, 0.16, 6, OAK_DARK, sx, baseY + 0.08, sz, {
        rotZ: sx > 0 ? 0.1 : -0.1,
        rotX: sz > cz ? -0.08 : 0.08,
        roughness: 0.72,
      });
    }
  }
  // Chair base deck: y = [0.184 .. 0.304]
  ctx.box(0.68, 0.12, 0.60, shade(primary, -0.08), 0, baseY + 0.22, cz, { roughness: 0.88 });
  // Plush seat cushion cleanly ON TOP (+0.004 proud): y = [0.308 .. 0.454] (top = 0.454!)
  ctx.box(0.50, 0.146, 0.46, primary, 0, baseY + 0.357, cz + 0.06, { roughness: 0.92 });

  // Wingback backrest strictly ON TOP of base behind seat: z = [cz - 0.30 .. cz - 0.17]
  ctx.box(0.66, 0.54, 0.13, primary, 0, baseY + 0.55, cz - 0.235, { rotX: -0.08, roughness: 0.9 });
  for (const sx of [-0.305, 0.305]) {
    // Armrests strictly ON TOP of base deck & strictly in front of backrest: z = [cz - 0.165 .. cz + 0.295]
    ctx.box(0.10, 0.23, 0.46, shade(primary, -0.06), sx, baseY + 0.395, cz + 0.065, {
      roughness: 0.9,
    });
    ctx.cyl(0.052, 0.052, 0.46, 8, primary, sx, baseY + 0.515, cz + 0.065, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
    // Sculpted side wing cheeks strictly ON TOP of armrests (y = [0.57 .. 0.84])
    ctx.box(0.095, 0.27, 0.19, shade(primary, -0.04), sx, baseY + 0.685, cz - 0.085, {
      roughness: 0.9,
    });
  }
  // Lumbar pillow reclining cleanly in front of backrest
  ctx.box(0.36, 0.19, 0.09, CREAM_LINEN, 0, baseY + 0.515, cz - 0.10, {
    rotX: -0.12,
    roughness: 0.94,
  });

  // Compact tucked matching ottoman footstool in front (+Z, stays cleanly within 1x1)
  ctx.box(0.42, 0.11, 0.20, shade(primary, 0.06), 0, baseY + 0.145, 0.33, { roughness: 0.92 });
  for (const ox of [-0.15, 0.15]) {
    ctx.cyl(0.018, 0.014, 0.09, 6, OAK_DARK, ox, baseY + 0.045, 0.33, { roughness: 0.72 });
  }
}

function buildBeanbagPuff(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Wide plush bottom pouf base grounded cleanly at FLOOR_BASE_Y
  ctx.sphere(0.38, 10, shade(primary, -0.05), 0, baseY + 0.195, 0.02, {
    scaleX: 1.06,
    scaleY: 0.51,
    scaleZ: 1.06,
    roughness: 0.94,
  });
  // 5 radial soft pleated lobe puffs around the perimeter
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const col = i % 2 === 0 ? primary : shade(primary, 0.05);
    ctx.sphere(0.20, 8, col, Math.cos(a) * 0.22, baseY + 0.22, Math.sin(a) * 0.22 + 0.02, {
      scaleX: 1.0,
      scaleY: 0.68,
      scaleZ: 1.0,
      roughness: 0.94,
    });
  }
  // Slouchy back teardrop hump
  ctx.sphere(0.26, 9, primary, 0, baseY + 0.34, -0.10, {
    scaleX: 0.94,
    scaleY: 0.84,
    scaleZ: 0.88,
    roughness: 0.94,
  });
  // Gathered top peak + stitched fabric button
  ctx.cone(0.105, 0.13, 7, shade(primary, 0.07), 0, baseY + 0.48, -0.14, {
    rotX: -0.26,
    roughness: 0.94,
  });
  ctx.sphere(0.028, 6, shade(primary, -0.18), 0, baseY + 0.52, -0.155, { roughness: 0.9 });
  // Cozy seated dimple cushion (top ~0.39 for comfy low beanbag sitting!)
  ctx.sphere(0.23, 8, shade(primary, -0.08), 0, baseY + 0.295, 0.12, {
    scaleX: 1.04,
    scaleY: 0.30,
    scaleZ: 0.9,
    roughness: 0.95,
  });
}

// ============================================================================
// DESKS & OFFICE CHAIR (3) — surfaceHeight exact for desks, SpinTarget for chair
// ============================================================================

function buildDeskStudy(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.76; // 0.76 exact!
  const slabH = 0.052;
  const underY = topY - slabH; // 0.708

  // Desktop slab flush at exact y = 0.76
  ctx.box(1.84, slabH, 0.84, primary, 0, topY - slabH / 2, 0, { roughness: 0.65 });
  // Knee-well under-apron strictly to the left of right pedestal (x = [-0.84 .. +0.28])
  ctx.box(1.12, 0.036, 0.72, shade(primary, -0.1), -0.28, underY - 0.018, 0, { roughness: 0.72 });
  // Center pencil drawer strictly below under-apron: y = [0.606 .. 0.672]
  ctx.box(0.84, 0.066, 0.68, shade(primary, -0.04), -0.22, underY - 0.069, 0.01, {
    roughness: 0.72,
  });
  ctx.sphere(0.02, 6, BRASS, -0.22, underY - 0.069, 0.365, {
    roughness: 0.28,
    metalness: 0.68,
  });

  // Left tapered splayed legs cleanly stopping under apron + lower stretcher
  const legH = underY - 0.036 - baseY;
  for (const sz of [-0.32, 0.32]) {
    ctx.cyl(0.03, 0.02, legH, 6, shade(primary, -0.14), -0.80, baseY + legH / 2, sz, {
      rotZ: -0.04,
      roughness: 0.7,
    });
  }
  ctx.box(0.034, 0.034, 0.62, shade(primary, -0.16), -0.81, baseY + 0.16, 0, { roughness: 0.72 });

  // Right 3-drawer pedestal unit strictly below desktop slab (y = [0.114 .. 0.708])
  const cabH = underY - (baseY + 0.09);
  const cabCy = baseY + 0.09 + cabH / 2;
  ctx.box(0.56, cabH, 0.74, accent, 0.56, cabCy, 0, { roughness: 0.72 });
  for (const dx of [0.34, 0.78]) {
    for (const dz of [-0.30, 0.30]) {
      ctx.cyl(0.024, 0.018, 0.09, 6, shade(primary, -0.16), dx, baseY + 0.045, dz, {
        roughness: 0.7,
      });
    }
  }
  // 3 sculpted drawer fronts cleanly proud (+0.024) of cabinet front (+0.370)
  for (let i = 0; i < 3; i++) {
    const dy = baseY + 0.19 + i * 0.19;
    ctx.box(0.50, 0.155, 0.024, shade(accent, -0.05), 0.56, dy, 0.382, { roughness: 0.74 });
    ctx.box(0.13, 0.018, 0.024, BRASS, 0.56, dy, 0.406, { roughness: 0.28, metalness: 0.68 });
  }

  // Subtle wooden pen tray cleanly ON TOP of desktop at back-left corner
  ctx.box(0.24, 0.016, 0.075, shade(primary, -0.16), -0.68, topY + 0.008, -0.33, {
    roughness: 0.72,
  });
}

function buildDeskCompact(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.76; // 0.76 exact!
  const slabH = 0.048;
  const underY = topY - slabH; // 0.712

  // Desktop slab flush at exact y = 0.76
  ctx.box(0.88, slabH, 0.78, primary, 0, topY - slabH / 2, 0, { roughness: 0.66 });
  // Four tapered legs stopping cleanly below desktop
  ctx.legs(0.84, 0.74, underY - baseY, 0.025, shade(primary, -0.15), baseY, 0.07);

  // Under-desk open cubby with strictly non-overlapping bottom, back & divider
  const cubbyBot = underY - 0.146; // bottom top at underY - 0.120
  ctx.box(0.76, 0.026, 0.66, shade(primary, -0.08), 0, cubbyBot, 0, { roughness: 0.72 });
  const bayH = underY - (cubbyBot + 0.013);
  const bayCy = cubbyBot + 0.013 + bayH / 2;
  ctx.box(0.76, bayH, 0.024, shade(primary, -0.12), 0, bayCy, -0.318, { roughness: 0.75 });
  ctx.box(0.024, bayH, 0.634, shade(primary, -0.1), 0, bayCy, 0.012, { roughness: 0.74 });

  // Right mini drawer cleanly inside right bay, front proudly at +0.346 (+0.016 past cubby!)
  ctx.box(0.34, bayH - 0.010, 0.62, shade(primary, 0.06), 0.195, bayCy, 0.036, {
    roughness: 0.72,
  });
  ctx.sphere(0.019, 6, BRASS, 0.195, bayCy, 0.362, {
    roughness: 0.28,
    metalness: 0.68,
  });
  // Cute stacked notebooks cleanly ON TOP of cubby floor (strictly stacked!)
  const floorTop = cubbyBot + 0.013;
  ctx.box(0.26, 0.032, 0.32, '#FAF3E7', -0.20, floorTop + 0.016, 0.06, { roughness: 0.85 });
  ctx.box(0.23, 0.026, 0.28, '#E8B1A2', -0.21, floorTop + 0.045, 0.04, {
    rotY: 0.12,
    roughness: 0.85,
  });

  // Compact ceramic pencil cup tucked cleanly ON TOP of back-right corner
  ctx.cyl(0.038, 0.032, 0.09, 8, CREAM_LINEN, 0.33, topY + 0.045, -0.29, { roughness: 0.45 });
  ctx.cyl(0.008, 0.008, 0.12, 5, '#E49888', 0.32, topY + 0.095, -0.295, { rotZ: 0.22 });
  ctx.cyl(0.008, 0.008, 0.115, 5, '#8EB8A4', 0.345, topY + 0.092, -0.282, { rotZ: -0.18 });
}

function buildChairOffice(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const metalCol = '#6C727A';

  // Stationary 5-star caster base + pneumatic gas stem
  ctx.cyl(0.048, 0.052, 0.055, 8, metalCol, 0, baseY + 0.068, 0, {
    roughness: 0.38,
    metalness: 0.48,
  });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    ctx.box(0.26, 0.026, 0.032, accent, dx * 0.16, baseY + 0.062, dz * 0.16, {
      rotY: -a,
      roughness: 0.45,
      metalness: 0.22,
    });
    // Caster wheel & vertical caster stem touching FLOOR_BASE_Y cleanly
    ctx.cyl(0.012, 0.012, 0.030, 3, metalCol, dx * 0.27, baseY + 0.044, dz * 0.27, {
      roughness: 0.45,
      metalness: 0.4,
    });
    ctx.cyl(0.024, 0.024, 0.026, 7, '#464B52', dx * 0.27, baseY + 0.024, dz * 0.27, {
      rotZ: Math.PI / 2,
      rotY: -a,
      roughness: 0.6,
    });
  }
  // Pneumatic stem cleanly stops at seat shell underside (y = 0.382)
  ctx.cyl(0.032, 0.036, 0.29, 8, metalCol, 0, baseY + 0.213, 0, {
    roughness: 0.32,
    metalness: 0.62,
  });

  // Spinning upper chair seat + backrest + armrests
  const spin = new THREE.Group();
  spin.name = 'SpinTarget';
  spin.userData.spinAxis = 'y';
  spin.userData.spinSpeed = 2.2;
  ctx.group.add(spin);

  // Molded seat shell: y = [0.382 .. 0.422], cushion cleanly ON TOP: y = [0.422 .. 0.486] (top = 0.486!)
  ctx.box(0.48, 0.040, 0.46, accent, 0, baseY + 0.378, 0.01, { parent: spin, roughness: 0.55 });
  ctx.box(0.45, 0.064, 0.43, primary, 0, baseY + 0.430, 0.02, { parent: spin, roughness: 0.88 });

  // Under-seat L-bracket + backrest support spine bolted cleanly to seat shell
  ctx.box(0.088, 0.032, 0.14, accent, 0, baseY + 0.378, -0.20, { parent: spin, roughness: 0.52 });
  ctx.box(0.088, 0.34, 0.040, accent, 0, baseY + 0.54, -0.242, {
    parent: spin,
    rotX: -0.09,
    roughness: 0.52,
  });
  ctx.box(0.44, 0.36, 0.084, primary, 0, baseY + 0.695, -0.195, {
    parent: spin,
    rotX: -0.09,
    roughness: 0.88,
  });
  ctx.box(0.35, 0.09, 0.036, shade(primary, 0.1), 0, baseY + 0.59, -0.142, {
    parent: spin,
    rotX: -0.09,
    roughness: 0.9,
  });

  // Curved armrests clearly outside seat pan (+-0.262), armcaps strictly ON TOP of risers!
  for (const sx of [-0.262, 0.262]) {
    ctx.box(0.034, 0.19, 0.038, accent, sx, baseY + 0.495, -0.01, { parent: spin, roughness: 0.52 });
    ctx.box(0.055, 0.034, 0.30, shade(accent, -0.1), sx, baseY + 0.607, 0.02, {
      parent: spin,
      roughness: 0.65,
    });
  }
}

// ============================================================================
// STORAGE (2) — strictly non-overlapping carcass & proud drawers/panels
// ============================================================================

function buildWardrobeTall(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Grounded plinth base: y = [0.024 .. 0.134]
  ctx.box(1.74, 0.11, 0.78, shade(primary, -0.14), 0, baseY + 0.055, 0, { roughness: 0.74 });

  // Cabinet carcass strictly ON TOP of plinth with zero corner overlap!
  const carBase = baseY + 0.11; // 0.134
  const sideH = 1.72; // up to 1.854
  for (const sx of [-0.83, 0.83]) {
    ctx.box(0.06, sideH, 0.76, primary, sx, carBase + sideH / 2, 0, { roughness: 0.72 });
  }
  // Back panel strictly between left & right sides (w = 1.60)
  ctx.box(1.60, sideH, 0.055, shade(primary, -0.12), 0, carBase + sideH / 2, -0.352, {
    roughness: 0.78,
  });
  // Top carcass lid strictly ON TOP of sides: y = [1.854 .. 1.914]
  ctx.box(1.72, 0.06, 0.76, primary, 0, carBase + sideH + 0.03, 0, { roughness: 0.72 });
  // Sculpted overhanging crown cornice strictly ON TOP of lid: y = [1.914 .. 1.996]
  ctx.box(1.84, 0.082, 0.86, shade(primary, -0.08), 0, carBase + sideH + 0.101, 0, {
    roughness: 0.68,
  });

  // Mid divider shelf strictly between sides: y = [0.474 .. 0.514]
  ctx.box(1.596, 0.040, 0.69, shade(primary, -0.06), 0, carBase + 0.36, 0.02, { roughness: 0.74 });

  // Bottom wide drawer strictly between sides & below divider, front proudly at +0.398 (+0.018!)
  ctx.box(1.58, 0.31, 0.70, shade(primary, 0.05), 0, carBase + 0.175, 0.048, { roughness: 0.72 });
  for (const kx of [-0.42, 0.42]) {
    ctx.sphere(0.028, 7, BRASS, kx, carBase + 0.175, 0.418, { roughness: 0.28, metalness: 0.68 });
  }

  // Interior hanging rail & cozy pastel garments (shown when peeking inside!)
  if (ctx.isActive) {
    ctx.cyl(0.016, 0.016, 1.56, 7, BRASS, 0, carBase + 1.54, -0.04, {
      rotZ: Math.PI / 2,
      roughness: 0.3,
      metalness: 0.65,
    });
    const shirts: Array<[number, string, number]> = [
      [-0.50, '#E8A89A', 0.64],
      [-0.18, '#B6CFB9', 0.72],
      [0.16, '#F0DFAA', 0.62],
      [0.48, '#A9C4DB', 0.70],
    ];
    for (const [sx, col, sh] of shirts) {
      ctx.box(0.24, sh, 0.34, col, sx, carBase + 1.50 - sh / 2, -0.04, { roughness: 0.92 });
    }
  }

  // Left & right shaker-paneled tall wardrobe doors cleanly proud in front of carcass (z = 0.402)
  const doorH = 1.32;
  const doorY = carBase + 0.39 + doorH / 2;
  const openAngle = ctx.isActive ? 0.56 : 0;

  for (const side of [-1, 1] as const) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 0.80, 0, 0.402);
    hinge.rotation.y = side * openAngle;
    ctx.group.add(hinge);

    const cx = -side * 0.395;
    ctx.box(0.775, doorH, 0.042, primary, cx, doorY, 0, { parent: hinge, roughness: 0.72 });
    // Recessed decorative shaker panel (+0.008 proud per face!)
    ctx.box(0.58, doorH - 0.24, 0.058, shade(primary, -0.08), cx, doorY, 0, {
      parent: hinge,
      roughness: 0.76,
    });
    // Vertical brass handle firmly mounted to door stile via flush standoff pegs
    ctx.cyl(0.014, 0.014, 0.19, 6, BRASS, -side * 0.71, doorY - 0.06, 0.040, {
      parent: hinge,
      roughness: 0.28,
      metalness: 0.68,
    });
    for (const dy of [-0.125, 0.005]) {
      ctx.box(0.016, 0.016, 0.026, BRASS, -side * 0.71, doorY + dy, 0.027, {
        parent: hinge,
        roughness: 0.3,
        metalness: 0.65,
      });
    }
  }
}

function buildDresserWide(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.85; // 0.85 exact!
  const topH = 0.052;
  const legH = 0.12;

  // Tapered feet: y = [0.024 .. 0.144]
  ctx.legs(1.74, 0.76, legH, 0.032, shade(primary, -0.18), baseY, 0.08);

  // Main wooden dresser body strictly between legs & tabletop: y = [0.144 .. 0.798]
  const bodyH = topY - topH - (baseY + legH);
  const bodyCy = baseY + legH + bodyH / 2;
  ctx.box(1.76, bodyH, 0.76, primary, 0, bodyCy, 0, { roughness: 0.72 });

  // Overhanging tabletop strictly ON TOP flush at exact y = 0.85
  ctx.box(1.84, topH, 0.84, shade(primary, 0.06), 0, topY - topH / 2, 0, { roughness: 0.65 });

  // Three wide horizontal drawers cleanly proud (+0.028) of body front (+0.380)
  const drawerStep = bodyH / 3;
  for (let i = 0; i < 3; i++) {
    const dy = baseY + legH + drawerStep * (i + 0.5);
    ctx.box(1.62, drawerStep - 0.036, 0.028, accent, 0, dy, 0.394, { roughness: 0.72 });
    for (const kx of [-0.46, 0.46]) {
      ctx.sphere(0.025, 7, BRASS, kx, dy, 0.422, { roughness: 0.28, metalness: 0.68 });
    }
  }
}

// ============================================================================
// MEDIA & TVs (3) — TVs sit at local y = 0, strictly layered screens (zero flicker)
// ============================================================================

function buildTvWidescreen(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;

  // Pedestal base (y = 0..0.026) + neck strictly ON TOP (y = 0.026..0.115)
  ctx.box(0.38, 0.026, 0.22, accent, 0, 0.013, 0, { roughness: 0.45, metalness: 0.22 });
  ctx.box(0.075, 0.089, 0.04, shade(accent, -0.12), 0, 0.0705, -0.01, {
    roughness: 0.45,
    metalness: 0.22,
  });

  // Slim flat-screen bezel housing strictly ON TOP of neck: y = [0.115 .. 0.605], front at +0.021
  const screenY = 0.36;
  ctx.box(0.84, 0.49, 0.042, accent, 0, screenY, 0, { roughness: 0.46, metalness: 0.12 });
  // Rear electronics plate strictly BEHIND bezel: z = [-0.047 .. -0.021]
  ctx.box(0.54, 0.28, 0.026, shade(accent, -0.15), 0, screenY - 0.02, -0.034, { roughness: 0.55 });

  // Display screen cleanly proud IN FRONT of bezel: z = [+0.021 .. +0.029] (+0.008!)
  if (isActive) {
    ctx.box(0.77, 0.42, 0.008, primary, 0, screenY, 0.025, {
      emissive: primary,
      emissiveIntensity: 0.62,
      roughness: 0.2,
      castShadow: false,
    });
    // Cozy glowing miniature sunset hill scene strictly IN FRONT of screen: z = [+0.029 .. +0.036]
    ctx.box(0.74, 0.14, 0.007, '#95C9A8', 0, screenY - 0.13, 0.0325, {
      emissive: '#95C9A8',
      emissiveIntensity: 0.55,
      castShadow: false,
    });
    ctx.cyl(0.068, 0.068, 0.007, 10, '#FBE29D', 0.18, screenY + 0.07, 0.0325, {
      rotX: Math.PI / 2,
      emissive: '#FBE29D',
      emissiveIntensity: 0.85,
      castShadow: false,
    });
    ctx.box(0.18, 0.055, 0.007, '#FFFDF8', -0.16, screenY + 0.09, 0.0325, {
      emissive: '#FFFDF8',
      emissiveIntensity: 0.7,
      castShadow: false,
    });
    // Green power LED cleanly proud of bezel
    ctx.box(0.024, 0.012, 0.009, '#7BD88F', 0.34, screenY - 0.225, 0.0255, {
      emissive: '#7BD88F',
      emissiveIntensity: 0.9,
      castShadow: false,
    });
  } else {
    ctx.box(0.77, 0.42, 0.008, '#2C3440', 0, screenY, 0.025, {
      roughness: 0.16,
      metalness: 0.18,
      castShadow: false,
    });
    ctx.box(0.024, 0.012, 0.009, '#D96B6B', 0.34, screenY - 0.225, 0.0255, {
      emissive: '#D96B6B',
      emissiveIntensity: 0.45,
      castShadow: false,
    });
  }
}

function buildTvRetro(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;

  // 4 stubby vintage feet sitting on surface y = [0 .. 0.048]
  ctx.legs(0.56, 0.36, 0.048, 0.022, OAK_DARK, 0, 0.06);

  // Rounded boxy CRT pastel casing strictly ON TOP of feet: y = [0.048 .. 0.418], z = [-0.19 .. +0.19]
  const bodyY = 0.233;
  ctx.box(0.60, 0.37, 0.38, primary, 0, bodyY, 0, { roughness: 0.56 });
  // Tapered cathode-tube housing strictly BEHIND chassis: z = [-0.33 .. -0.19]
  ctx.box(0.42, 0.27, 0.14, shade(primary, -0.14), 0, bodyY, -0.26, { roughness: 0.62 });
  // Cream front face bezel strictly IN FRONT of chassis: z = [+0.190 .. +0.214]
  ctx.box(0.55, 0.32, 0.024, accent, 0, bodyY, 0.202, { roughness: 0.64 });

  // Slightly bulbous curved CRT glass screen proudly emerging from bezel (+0.214 .. +0.244)
  const screenX = -0.065;
  if (isActive) {
    ctx.sphere(0.165, 10, '#B5E4EA', screenX, bodyY, 0.206, {
      scaleX: 1.18,
      scaleY: 0.84,
      scaleZ: 0.23,
      emissive: '#AEE1E8',
      emissiveIntensity: 0.72,
      roughness: 0.18,
      castShadow: false,
    });
    // Glowing pastel retro test-pattern stripes cleanly proud of curved screen (+0.248)
    const stripes: Array<[number, string]> = [
      [-0.10, '#F5C4A0'],
      [0.0, '#F8E39A'],
      [0.10, '#A6D9B8'],
    ];
    for (const [sx, col] of stripes) {
      ctx.box(0.072, 0.15, 0.008, col, screenX + sx, bodyY, 0.248, {
        emissive: col,
        emissiveIntensity: 0.78,
        castShadow: false,
      });
    }
  } else {
    ctx.sphere(0.165, 10, '#36444B', screenX, bodyY, 0.206, {
      scaleX: 1.18,
      scaleY: 0.84,
      scaleZ: 0.23,
      roughness: 0.18,
      metalness: 0.14,
      castShadow: false,
    });
  }

  // Right-side rotary channel/volume dials & speaker vents cleanly IN FRONT of bezel (+0.214)
  for (const dy of [0.31, 0.225]) {
    ctx.cyl(0.032, 0.034, 0.020, 8, '#5E554D', 0.195, dy, 0.224, {
      rotX: Math.PI / 2,
      roughness: 0.45,
    });
    ctx.cyl(0.016, 0.016, 0.014, 6, BRASS, 0.195, dy, 0.241, {
      rotX: Math.PI / 2,
      roughness: 0.3,
      metalness: 0.65,
    });
  }
  for (const sy of [0.115, 0.142, 0.169]) {
    ctx.box(0.095, 0.012, 0.010, shade(accent, -0.25), 0.195, sy, 0.219, { roughness: 0.75 });
  }

  // Iconic V-shaped metallic rabbit-ear antennas strictly ON TOP of chassis (y = 0.418)
  ctx.cyl(0.042, 0.048, 0.026, 8, '#5E646E', 0, 0.431, -0.02, {
    roughness: 0.4,
    metalness: 0.4,
  });
  for (const dir of [-1, 1] as const) {
    ctx.cyl(0.008, 0.01, 0.20, 6, '#C5CCD4', dir * 0.072, 0.506, -0.02, {
      rotZ: dir * -0.52,
      roughness: 0.22,
      metalness: 0.78,
    });
    ctx.sphere(0.016, 6, '#D6DCE3', dir * 0.122, 0.591, -0.02, {
      roughness: 0.22,
      metalness: 0.78,
    });
  }
}

function buildMediaConsole(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.56; // 0.56 exact!
  const legH = 0.14;
  const topH = 0.038;
  const cabH = topY - topH - (baseY + legH);
  const cabCy = baseY + legH + cabH / 2;

  // 4 splayed mid-century tapered legs: y = [0.024 .. 0.164]
  for (const sx of [-0.79, 0.79]) {
    for (const sz of [-0.26, 0.26]) {
      ctx.cyl(0.028, 0.018, legH, 6, shade(primary, -0.2), sx, baseY + legH / 2, sz, {
        rotZ: sx > 0 ? 0.1 : -0.1,
        roughness: 0.7,
      });
    }
  }

  // Credenza cabinet body (y = [0.164 .. 0.522], front at +0.350) + flush top slab at y = 0.56
  ctx.box(1.80, cabH, 0.70, primary, 0, cabCy, 0, { roughness: 0.72 });
  ctx.box(1.86, topH, 0.76, shade(primary, 0.05), 0, topY - topH / 2, 0, { roughness: 0.65 });

  // Left half: slatted tambour/cane sliding door cleanly proud (+0.022) of front (+0.350)
  const doorCol = ctx.variant.accentColor ? accent : shade(primary, 0.09);
  ctx.box(0.80, cabH - 0.06, 0.022, doorCol, -0.44, cabCy, 0.361, { roughness: 0.76 });
  for (let i = 0; i < 6; i++) {
    ctx.box(0.022, cabH - 0.08, 0.012, shade(doorCol, -0.14), -0.76 + i * 0.125, cabCy, 0.378, {
      roughness: 0.78,
    });
  }
  ctx.box(0.022, 0.09, 0.016, BRASS, -0.09, cabCy, 0.380, { roughness: 0.28, metalness: 0.68 });

  // Right half: open shelf cubby cleanly layered in front of +0.350 (zero coplanar overlap!)
  ctx.box(0.80, cabH - 0.07, 0.012, shade(primary, -0.34), 0.44, cabCy, 0.356, { roughness: 0.85 });
  ctx.box(0.80, 0.024, 0.048, primary, 0.44, cabCy, 0.386, { roughness: 0.72 });
  // Compact slate media console box cleanly ON TOP of divider shelf
  ctx.box(0.46, 0.052, 0.044, '#59616C', 0.40, cabCy + 0.038, 0.384, { roughness: 0.45 });
  ctx.box(0.024, 0.012, 0.008, '#7CD892', 0.58, cabCy + 0.038, 0.410, {
    emissive: '#7CD892',
    emissiveIntensity: 0.6,
  });
  // Two standing art/record sleeves cleanly inside lower right shelf
  ctx.box(0.052, 0.11, 0.042, '#E6A796', 0.18, cabCy - 0.074, 0.383, { roughness: 0.82 });
  ctx.box(0.052, 0.11, 0.042, '#B5CEBC', 0.248, cabCy - 0.074, 0.383, { roughness: 0.82 });
}

// ============================================================================
// TABLES & RUG (3) — exact surfaceHeight for tables, strictly y >= 0.032 for rug
// ============================================================================

function buildCoffeeTableLow(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.44; // 0.44 exact!
  const slabH = 0.048;

  // Rounded-bevel tabletop flush at exact y = 0.44, under-apron strictly below (y = 0.368..0.392)
  ctx.box(1.74, slabH, 0.74, primary, 0, topY - slabH / 2, 0, { roughness: 0.64 });
  ctx.box(1.66, 0.024, 0.66, shade(primary, -0.1), 0, topY - slabH - 0.012, 0, { roughness: 0.7 });

  // 4 gracefully splayed mid-century wooden legs cleanly stopping under apron
  const legH = topY - slabH - 0.012 - baseY;
  for (const sx of [-0.74, 0.74]) {
    for (const sz of [-0.26, 0.26]) {
      ctx.cyl(0.028, 0.019, legH, 6, shade(primary, -0.15), sx, baseY + legH / 2, sz, {
        rotZ: sx > 0 ? 0.11 : -0.11,
        rotX: sz > 0 ? -0.07 : 0.07,
        roughness: 0.7,
      });
    }
  }

  // Lower slatted magazine shelf: side rails (y = 0.162..0.186) & cross slats strictly ON TOP (0.186..0.206)!
  const shelfY = baseY + 0.15;
  for (const sz of [-0.23, 0.23]) {
    ctx.box(1.44, 0.024, 0.036, shade(primary, -0.12), 0, shelfY, sz, { roughness: 0.72 });
  }
  for (let i = 0; i < 6; i++) {
    const sx = -0.60 + i * 0.24;
    ctx.box(0.085, 0.020, 0.48, shade(primary, -0.05), sx, shelfY + 0.022, 0, { roughness: 0.7 });
  }
}

function buildSideTableRound(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.54; // 0.54 exact!
  const topH = 0.042;

  // Round tray tabletop flush at exact y = 0.54
  ctx.cyl(0.39, 0.375, topH, 16, primary, 0, topY - topH / 2, 0, { roughness: 0.64 });
  // Subtle outer raised tray lip around perimeter (center stays open & flush at 0.54!)
  ctx.torus(0.375, 0.013, 6, 16, shade(primary, 0.08), 0, topY + 0.005, 0, {
    rotX: Math.PI / 2,
    roughness: 0.6,
  });
  // Under-table hub apron strictly below tabletop: y = [0.466 .. 0.498]
  ctx.cyl(0.21, 0.19, 0.032, 10, shade(primary, -0.1), 0, topY - topH - 0.016, 0, {
    roughness: 0.72,
  });

  // 3 splayed tapered tripod wooden legs cleanly meeting FLOOR_BASE_Y (minY = 0.024)
  const legH = topY - topH - baseY;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const pivot = new THREE.Group();
    pivot.position.set(dx * 0.20, baseY + legH / 2 - 0.001, dz * 0.20);
    pivot.rotation.y = -a;
    ctx.group.add(pivot);
    ctx.cyl(0.025, 0.017, legH * 1.006, 6, WARM_OAK, 0, 0, 0, {
      parent: pivot,
      rotZ: 0.14,
      roughness: 0.7,
    });
  }
  ctx.torus(0.205, 0.012, 6, 12, OAK_DARK, 0, baseY + 0.17, 0, {
    rotX: Math.PI / 2,
    roughness: 0.72,
  });
}

function buildRugWoven(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  // Strictly y >= 0.032 (+0.008 above floor tiles!), every layer >= 0.005 raised & zero coplanar overlap!
  const rugY = 0.032;

  // Main woven rug body: y = [0.032 .. 0.044]
  ctx.box(2.70, 0.012, 1.82, primary, 0, rugY + 0.006, 0, {
    roughness: 0.96,
    castShadow: false,
  });
  // Contrasting woven border strictly ON TOP: y = [0.044 .. 0.049]
  ctx.box(2.48, 0.005, 1.60, shade(primary, -0.15), 0, rugY + 0.0145, 0, {
    roughness: 0.96,
    castShadow: false,
  });
  // Warm inner field strictly ON TOP: y = [0.049 .. 0.054]
  ctx.box(2.22, 0.005, 1.36, shade(primary, 0.14), 0, rugY + 0.0195, 0, {
    roughness: 0.96,
    castShadow: false,
  });

  // End geometric stripes strictly ON TOP of inner field: y = [0.054 .. 0.059]
  for (const sx of [-0.98, 0.98]) {
    ctx.box(0.085, 0.005, 1.30, shade(primary, -0.22), sx, rugY + 0.0245, 0, {
      roughness: 0.96,
      castShadow: false,
    });
  }
  // 3 woven diamond motifs strictly ON TOP of inner field: y = [0.054 .. 0.059] & [0.059 .. 0.064]
  for (const dx of [-0.58, 0, 0.58]) {
    ctx.box(0.30, 0.005, 0.30, shade(primary, -0.2), dx, rugY + 0.0245, 0, {
      rotY: Math.PI / 4,
      roughness: 0.96,
      castShadow: false,
    });
    ctx.box(0.14, 0.005, 0.14, CREAM_LINEN, dx, rugY + 0.0295, 0, {
      rotY: Math.PI / 4,
      roughness: 0.96,
      castShadow: false,
    });
  }

  // Fringed cream tassels cleanly abutting both short ends (x = +-1.350..+-1.460), zero overlap!
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 7; i++) {
      const tz = -0.75 + i * 0.25;
      ctx.box(0.11, 0.008, 0.044, CREAM_LINEN, side * 1.406, rugY + 0.005, tz, {
        roughness: 0.96,
        castShadow: false,
      });
    }
  }
}

// ============================================================================
// BATHROOM (6) — toilet_cozy, bathroom_sink, bathtub_clawfoot, shower_glass,
//                towel_rack, bath_mat
// ============================================================================

function buildToiletCozy(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;
  const baseY = FLOOR_BASE_Y;
  const porcelainOpts = { roughness: 0.28, metalness: 0.04 };

  // Flared porcelain floor plinth + contoured pedestal stem touching FLOOR_BASE_Y
  ctx.cyl(0.14, 0.175, 0.06, 12, shade(primary, -0.05), 0, baseY + 0.03, 0.03, porcelainOpts);
  ctx.cyl(0.165, 0.125, 0.21, 12, primary, 0, baseY + 0.165, 0.04, porcelainOpts);

  // Sculpted toilet bowl rim (top at y = baseY + 0.39 = 0.414)
  ctx.cyl(0.205, 0.15, 0.12, 12, primary, 0, baseY + 0.33, 0.055, {
    scaleX: 0.94,
    scaleZ: 1.12,
    ...porcelainOpts,
  });
  // Clean blue water surface recessed inside bowl
  ctx.cyl(0.15, 0.135, 0.014, 10, '#A8D8EA', 0, baseY + 0.372, 0.065, {
    scaleX: 0.92,
    scaleZ: 1.08,
    roughness: 0.14,
    castShadow: false,
  });

  // Contoured porcelain seat ring sitting cleanly on bowl rim (seat top ~0.44)
  ctx.torus(0.165, 0.025, 7, 14, accent, 0, baseY + 0.402, 0.06, {
    rotX: Math.PI / 2,
    scaleX: 0.93,
    scaleZ: 1.10,
    roughness: 0.32,
  });

  // Rear support column + rectangular porcelain tank + beveled tank lid
  ctx.box(0.20, 0.38, 0.14, shade(primary, -0.04), 0, baseY + 0.19, -0.20, porcelainOpts);
  ctx.box(0.38, 0.34, 0.19, primary, 0, baseY + 0.55, -0.22, porcelainOpts);
  ctx.box(0.42, 0.038, 0.22, shade(primary, 0.05), 0, baseY + 0.739, -0.22, porcelainOpts);

  // Chrome flush lever mounted cleanly on left side of tank
  ctx.cyl(0.022, 0.024, 0.024, 8, '#C4CBD2', -0.198, baseY + 0.65, -0.18, {
    rotZ: Math.PI / 2,
    roughness: 0.25,
    metalness: 0.72,
  });
  ctx.box(0.016, 0.016, 0.085, '#D2D8DE', -0.214, baseY + 0.65, -0.145, {
    rotX: -0.12,
    roughness: 0.24,
    metalness: 0.75,
  });

  // Hinge bar + hinged ToiletLidPivot (closed at rotX = 0, opens cleanly in front of tank z = -0.125!)
  ctx.cyl(0.014, 0.014, 0.18, 6, '#C4CBD2', 0, baseY + 0.415, -0.105, {
    rotZ: Math.PI / 2,
    roughness: 0.3,
    metalness: 0.65,
  });
  const lidOpenAngle = -(Math.PI / 2 - 0.08);
  const lidPivot = new THREE.Group();
  lidPivot.name = 'ToiletLidPivot';
  lidPivot.position.set(0, baseY + 0.428, -0.100);
  lidPivot.userData.openAngle = lidOpenAngle;
  lidPivot.rotation.x = isActive ? lidOpenAngle : 0;
  ctx.group.add(lidPivot);

  ctx.cyl(0.175, 0.175, 0.022, 12, shade(primary, 0.03), 0, 0.008, 0.168, {
    parent: lidPivot,
    scaleX: 0.98,
    scaleZ: 1.04,
    ...porcelainOpts,
  });
}

function buildBathroomSink(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Tapered wooden vanity legs: y = [0.024 .. 0.144]
  ctx.legs(0.76, 0.56, 0.12, 0.028, shade(primary, -0.18), baseY, 0.07);

  // Pastel wooden vanity cabinet carcass: y = [0.144 .. 0.764]
  ctx.box(0.78, 0.62, 0.58, primary, 0, baseY + 0.43, -0.04, { roughness: 0.72 });
  // Twin proud shaker cabinet doors (+0.022 past front +0.250) + brass knobs
  for (const sx of [-0.18, 0.18]) {
    ctx.box(0.33, 0.43, 0.022, shade(primary, 0.07), sx, baseY + 0.38, 0.261, { roughness: 0.74 });
    ctx.sphere(0.021, 7, BRASS, sx > 0 ? 0.055 : -0.055, baseY + 0.42, 0.282, {
      roughness: 0.28,
      metalness: 0.68,
    });
  }
  // Top faux apron panel + brass bar pull
  ctx.box(0.70, 0.095, 0.022, shade(primary, 0.05), 0, baseY + 0.665, 0.261, { roughness: 0.72 });
  ctx.box(0.11, 0.016, 0.020, BRASS, 0, baseY + 0.665, 0.282, { roughness: 0.28, metalness: 0.68 });

  // Crisp porcelain vanity top (y = [0.764 .. 0.812]) & rear backsplash curb
  const porcelainOpts = { roughness: 0.28, metalness: 0.04 };
  ctx.box(0.84, 0.048, 0.64, accent, 0, baseY + 0.764, -0.04, porcelainOpts);
  ctx.box(0.84, 0.072, 0.036, accent, 0, baseY + 0.824, -0.342, porcelainOpts);

  // Sculpted vessel porcelain basin resting cleanly ON TOP of counter
  ctx.cyl(0.225, 0.17, 0.092, 12, accent, 0, baseY + 0.834, 0.01, {
    scaleX: 1.14,
    scaleZ: 0.90,
    ...porcelainOpts,
  });
  // Recessed interior basin water/glaze well & chrome drain disc
  ctx.cyl(0.18, 0.155, 0.012, 10, '#D4EBF4', 0, baseY + 0.876, 0.01, {
    scaleX: 1.10,
    scaleZ: 0.86,
    roughness: 0.16,
    castShadow: false,
  });
  ctx.cyl(0.024, 0.024, 0.008, 8, '#9DA6B0', 0, baseY + 0.884, 0.01, {
    roughness: 0.25,
    metalness: 0.72,
    castShadow: false,
  });

  // Curved brass gooseneck faucet + twin handles mounted behind basin
  const brassOpts = { roughness: 0.26, metalness: 0.68 };
  ctx.cyl(0.024, 0.028, 0.022, 8, BRASS, 0, baseY + 0.799, -0.23, brassOpts);
  // Low gooseneck: stem y = [0.810 .. 0.918], flattened half-loop crown tops out at 0.952
  // (world 0.976, inside the declared 0.98 height), spout tip stops 0.02 above the basin well
  ctx.cyl(0.013, 0.015, 0.108, 7, BRASS, 0, baseY + 0.864, -0.23, brassOpts);
  ctx.torus(0.062, 0.013, 6, 5, BRASS, 0, baseY + 0.918, -0.168, {
    arc: Math.PI,
    rotY: Math.PI / 2,
    scaleY: 0.45,
    ...brassOpts,
  });
  ctx.cyl(0.013, 0.011, 0.014, 7, BRASS, 0, baseY + 0.911, -0.106, brassOpts);
  for (const hx of [-0.09, 0.09]) {
    ctx.cyl(0.014, 0.018, 0.042, 7, BRASS, hx, baseY + 0.809, -0.23, brassOpts);
    ctx.box(0.052, 0.012, 0.014, BRASS, hx, baseY + 0.834, -0.23, brassOpts);
  }

  // Cute pastel ceramic soap pump on right corner of counter
  ctx.cyl(0.038, 0.042, 0.095, 8, '#EAB7A4', 0.29, baseY + 0.836, -0.17, { roughness: 0.42 });
  ctx.cyl(0.012, 0.016, 0.026, 6, BRASS, 0.29, baseY + 0.896, -0.17, brassOpts);
  ctx.box(0.012, 0.010, 0.036, BRASS, 0.29, baseY + 0.912, -0.155, brassOpts);

  // Active shimmering running water stream & basin splash ring when toggled on!
  if (isActive) {
    ctx.cyl(0.010, 0.015, 0.026, 7, '#7AD2F0', 0, baseY + 0.893, -0.106, {
      opacity: 0.78,
      emissive: '#7AD2F0',
      emissiveIntensity: 0.35,
      roughness: 0.12,
      castShadow: false,
    });
    ctx.torus(0.058, 0.009, 6, 12, '#BCECFB', 0, baseY + 0.888, -0.10, {
      rotX: Math.PI / 2,
      opacity: 0.82,
      emissive: '#9BE0F8',
      emissiveIntensity: 0.3,
      castShadow: false,
    });
  }
}

function buildBathtubClawfoot(ctx: ModelContext): void {
  const { primary, accent, isActive, isGhost } = ctx;
  const baseY = FLOOR_BASE_Y;
  const enamelOpts = { roughness: 0.3, metalness: 0.04 };
  const brassOpts = { roughness: 0.26, metalness: 0.68 };
  const TX = -0.08; // tub centre, nudged left to leave room for the filler
  const SX = 2.1; // stretches the round lathe into a long double-ended oval

  // Hollow tub = two lathed shells: painted outside, white enamel roll-top + basin inside.
  const lathe = (pts: Array<[number, number]>, color: string): void => {
    const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, baseY + y)), 14);
    const mesh = new THREE.Mesh(geo, ctx.mat(color, enamelOpts));
    mesh.position.x = TX;
    mesh.scale.x = SX;
    mesh.castShadow = !isGhost;
    mesh.receiveShadow = !isGhost;
    ctx.group.add(mesh);
  };
  lathe(
    [[0, 0.13], [0.2, 0.13], [0.27, 0.17], [0.31, 0.26], [0.33, 0.4], [0.34, 0.52]],
    primary,
  );
  lathe(
    [[0.34, 0.52], [0.36, 0.55], [0.355, 0.59], [0.33, 0.605], [0.31, 0.585], [0.305, 0.54],
      [0.29, 0.4], [0.255, 0.27], [0.19, 0.2], [0, 0.19]],
    '#FAF6EE',
  );

  // 4 splayed brass ball-and-claw feet meeting the curved underside
  for (const fx of [-0.46, 0.46]) {
    for (const fz of [-0.17, 0.17]) {
      ctx.sphere(0.038, 6, accent, TX + fx, baseY + 0.038, fz, brassOpts);
      ctx.cyl(0.024, 0.034, 0.15, 6, accent, TX + fx * 0.97, baseY + 0.11, fz * 0.95, {
        rotZ: fx > 0 ? 0.22 : -0.22,
        rotX: fz > 0 ? -0.22 : 0.22,
        ...brassOpts,
      });
    }
  }

  // Freestanding brass filler at +X: standpipe, cross handles, gooseneck over the rim
  ctx.cyl(0.05, 0.06, 0.036, 8, accent, 0.85, baseY + 0.018, 0, brassOpts);
  ctx.cyl(0.018, 0.022, 0.70, 8, accent, 0.85, baseY + 0.37, 0, brassOpts);
  for (const hz of [-0.07, 0.07]) {
    ctx.cyl(0.013, 0.013, 0.06, 6, accent, 0.85, baseY + 0.62, hz, { rotX: Math.PI / 2, ...brassOpts });
  }
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 8, Math.PI), ctx.mat(accent, brassOpts));
  neck.position.set(0.73, baseY + 0.72, 0);
  neck.castShadow = !isGhost;
  ctx.group.add(neck);
  ctx.cyl(0.016, 0.013, 0.05, 7, accent, 0.61, baseY + 0.70, 0, brassOpts);

  // Rubber duck perched on the front of the roll-top rim
  const dx = TX - 0.25;
  const dy = baseY + 0.642;
  const dz = 0.31;
  ctx.sphere(0.046, 8, '#F6D45E', dx, dy, dz, { scaleX: 1.25, scaleY: 0.86, scaleZ: 0.94, roughness: 0.4 });
  ctx.sphere(0.034, 8, '#F8DB6E', dx + 0.038, dy + 0.044, dz, { roughness: 0.38 });
  ctx.cone(0.015, 0.032, 6, '#EE8A4B', dx + 0.072, dy + 0.042, dz, { rotZ: -Math.PI / 2, roughness: 0.45 });
  for (const ez of [-0.016, 0.016]) {
    ctx.sphere(0.006, 5, '#2E2A26', dx + 0.058, dy + 0.054, dz + ez, { roughness: 0.3 });
  }

  // Bubble bath on: water fills the basin and foam heaps up toward the rim
  if (isActive) {
    ctx.cyl(0.298, 0.298, 0.02, 14, '#B5E2F0', TX, baseY + 0.45, 0, {
      scaleX: SX,
      roughness: 0.14,
      castShadow: false,
    });
    const foam: Array<[number, number, number, number]> = [
      [-0.42, 0.48, -0.06, 0.12],
      [-0.2, 0.48, 0.08, 0.13],
      [0.02, 0.48, -0.07, 0.14],
      [0.24, 0.48, 0.06, 0.13],
      [0.42, 0.48, -0.04, 0.11],
      [-0.08, 0.55, 0.02, 0.09],
      [0.16, 0.55, -0.01, 0.08],
    ];
    foam.forEach(([bx, by, bz, br], i) => {
      ctx.sphere(br, 7, i % 2 === 0 ? '#FFFDF9' : '#EEF8FC', TX + bx, baseY + by, bz, {
        scaleX: 1.15,
        scaleY: 0.6,
        scaleZ: 1.1,
        roughness: 0.24,
        castShadow: false,
      });
    });
  }
}

function buildShowerGlass(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;
  const baseY = FLOOR_BASE_Y;
  const frameOpts = { roughness: 0.34, metalness: 0.58 };
  const glassOpts = { opacity: 0.34, roughness: 0.10, metalness: 0.10, castShadow: false };

  // Raised tiled shower pan grounded on FLOOR_BASE_Y: y = [0.024 .. 0.104]
  ctx.box(0.88, 0.08, 0.88, '#F3ECE1', 0, baseY + 0.04, 0, { roughness: 0.65 });
  // Recessed mosaic shower floor tile inlay strictly ON TOP: y = [0.104 .. 0.114]
  ctx.box(0.76, 0.010, 0.76, '#D8E7E4', 0, baseY + 0.085, 0, { roughness: 0.42, castShadow: false });
  // Center circular chrome drain strictly ON TOP: y = [0.114 .. 0.120]
  ctx.cyl(0.046, 0.046, 0.006, 10, '#9DA6B0', 0, baseY + 0.093, 0, {
    roughness: 0.28,
    metalness: 0.65,
    castShadow: false,
  });

  // Solid rear tiled wet-wall panel (-Z) strictly BETWEEN rear posts (x = [-0.40..+0.40], zero overlap!)
  const wallH = 2.12;
  const wallCy = baseY + 0.08 + wallH / 2;
  ctx.box(0.80, wallH - 0.012, 0.040, '#FAF5EC', 0, wallCy, -0.416, { roughness: 0.55 });
  for (const ty of [0.58, 1.12, 1.66]) {
    ctx.box(0.78, 0.018, 0.010, '#DCE5DF', 0, baseY + ty, -0.391, { roughness: 0.5 });
  }
  // Built-in corner bath caddy shelf with two cute pastel shampoo bottles
  ctx.box(0.28, 0.022, 0.11, accent, -0.22, baseY + 1.16, -0.338, frameOpts);
  ctx.cyl(0.028, 0.030, 0.12, 8, '#E8B5A2', -0.28, baseY + 1.231, -0.335, { roughness: 0.45 });
  ctx.cyl(0.024, 0.026, 0.10, 8, '#AED4C2', -0.18, baseY + 1.221, -0.335, { roughness: 0.45 });

  // 4 sleek vertical metal enclosure corner posts: y = [0.104 .. 2.224]
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.42, 0.42]) {
      ctx.box(0.036, wallH, 0.036, accent, sx, wallCy, sz, frameOpts);
    }
  }
  // Top perimeter metal frame rails strictly between corner posts
  const topY = baseY + 0.08 + wallH - 0.018;
  ctx.box(0.800, 0.034, 0.034, accent, 0, topY, 0.42, frameOpts);
  ctx.box(0.034, 0.034, 0.800, accent, -0.42, topY, 0, frameOpts);
  ctx.box(0.034, 0.034, 0.800, accent, 0.42, topY, 0, frameOpts);

  // Translucent glass enclosure walls strictly inside posts & top rails (zero coplanar seams!)
  const glassH = wallH - 0.056;
  const glassCy = baseY + 0.088 + glassH / 2;
  ctx.box(0.018, glassH, 0.796, primary, -0.42, glassCy, 0, glassOpts);
  ctx.box(0.018, glassH, 0.796, primary, 0.42, glassCy, 0, glassOpts);
  // Front fixed/door glass panel covering left 60% for airy walk-in look + vertical handle
  ctx.box(0.48, glassH, 0.018, primary, -0.16, glassCy, 0.42, glassOpts);
  ctx.cyl(0.012, 0.012, 0.26, 6, accent, 0.03, baseY + 1.08, 0.448, frameOpts);
  for (const dy of [-0.10, 0.10]) {
    ctx.box(0.014, 0.014, 0.034, accent, 0.03, baseY + 1.08 + dy, 0.431, frameOpts);
  }

  // Brass/metal shower riser pipe, mixer control valve & overhead rainfall showerhead
  ctx.cyl(0.042, 0.046, 0.024, 10, accent, 0, baseY + 1.06, -0.38, {
    rotX: Math.PI / 2,
    ...frameOpts,
  });
  ctx.box(0.018, 0.075, 0.022, shade(accent, -0.1), 0, baseY + 1.06, -0.358, frameOpts);
  ctx.cyl(0.014, 0.014, 1.04, 7, accent, 0, baseY + 1.58, -0.365, frameOpts);
  ctx.cyl(0.014, 0.014, 0.34, 7, accent, 0, baseY + 2.09, -0.20, {
    rotX: Math.PI / 2,
    ...frameOpts,
  });
  ctx.cyl(0.11, 0.125, 0.026, 12, accent, 0, baseY + 2.065, -0.04, frameOpts);

  // Active shimmering water stream lines cascading down when shower is ON!
  if (isActive) {
    const drops: Array<[number, number]> = [
      [-0.06, -0.08],
      [0.06, -0.08],
      [-0.07, 0.01],
      [0.0, -0.03],
      [0.07, 0.01],
      [0.0, 0.04],
    ];
    for (const [wx, wz] of drops) {
      ctx.cyl(0.008, 0.010, 1.90, 5, '#80D6F5', wx, baseY + 1.09, wz, {
        opacity: 0.56,
        emissive: '#80D6F5',
        emissiveIntensity: 0.4,
        roughness: 0.12,
        castShadow: false,
      });
    }
    ctx.torus(0.16, 0.012, 6, 12, '#B6ECFC', 0, baseY + 0.105, -0.02, {
      rotX: Math.PI / 2,
      opacity: 0.7,
      emissive: '#9BE2FA',
      emissiveIntensity: 0.3,
      castShadow: false,
    });
  }
}

function buildTowelRack(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  // Wall-mounted item: back flush at z = 0, facing +Z into the room, centered around y = 0!
  const brassOpts = { roughness: 0.28, metalness: 0.68 };

  // Upper bar (y = +0.13, z = +0.115) & lower bar (y = -0.07, z = +0.075) — staggered depths!
  const bars: Array<{ y: number; z: number }> = [
    { y: 0.13, z: 0.115 },
    { y: -0.07, z: 0.075 },
  ];
  for (const bar of bars) {
    for (const sx of [-0.30, 0.30]) {
      // Flush wall rosette anchored right at z = [0 .. 0.018]
      ctx.cyl(0.026, 0.030, 0.018, 8, BRASS, sx, bar.y, 0.009, {
        rotX: Math.PI / 2,
        ...brassOpts,
      });
      // Horizontal standoff arm spanning z = [0.018 .. bar.z]
      const armLen = bar.z - 0.018;
      ctx.cyl(0.010, 0.011, armLen, 6, BRASS, sx, bar.y, 0.018 + armLen / 2, {
        rotX: Math.PI / 2,
        ...brassOpts,
      });
    }
    // Horizontal brass towel rail
    ctx.cyl(0.011, 0.011, 0.64, 8, BRASS, 0, bar.y, bar.z, {
      rotZ: Math.PI / 2,
      ...brassOpts,
    });
  }

  // Draped folded bath towel hanging softly over upper bar (left-shifted)
  const tx1 = -0.08;
  ctx.cyl(0.022, 0.022, 0.34, 8, primary, tx1, 0.13, 0.115, {
    rotZ: Math.PI / 2,
    roughness: 0.94,
  });
  ctx.box(0.34, 0.31, 0.016, primary, tx1, -0.025, 0.131, { roughness: 0.95 });
  ctx.box(0.33, 0.26, 0.014, shade(primary, -0.08), tx1, 0.0, 0.098, { roughness: 0.95 });
  // Subtle woven hem stripe strictly in front of front cloth (+0.139 .. +0.145)
  ctx.box(0.34, 0.028, 0.006, shade(primary, -0.18), tx1, -0.135, 0.142, { roughness: 0.94 });

  // Smaller folded hand towel draped over lower bar (right-shifted, staggered depth)
  const tx2 = 0.14;
  ctx.cyl(0.020, 0.020, 0.22, 8, accent, tx2, -0.07, 0.075, {
    rotZ: Math.PI / 2,
    roughness: 0.94,
  });
  ctx.box(0.22, 0.22, 0.014, accent, tx2, -0.18, 0.090, { roughness: 0.95 });
  ctx.box(0.21, 0.18, 0.012, shade(accent, -0.08), tx2, -0.16, 0.060, { roughness: 0.95 });
  ctx.box(0.22, 0.022, 0.006, shade(accent, -0.16), tx2, -0.255, 0.100, { roughness: 0.94 });
}

function buildBathMat(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  // Strictly y >= 0.032 (+0.008 above floor tiles!), zero coplanar overlap!
  const matY = 0.032;

  // Plush tufted bath mat core: y = [0.032 .. 0.048]
  ctx.box(0.70, 0.016, 0.48, primary, 0, matY + 0.008, 0, {
    roughness: 0.96,
    castShadow: false,
  });
  // Soft scalloped cloud-puff trim along long & short edges (bottom at 0.033 >= 0.032!)
  for (const sz of [-0.235, 0.235]) {
    for (const sx of [-0.24, -0.08, 0.08, 0.24]) {
      ctx.sphere(0.078, 8, shade(primary, 0.04), sx, matY + 0.011, sz, {
        thetaLength: Math.PI / 2,
        rings: 2,
        scaleX: 1.0,
        scaleY: 0.12,
        scaleZ: 0.85,
        roughness: 0.96,
        castShadow: false,
      });
    }
  }
  for (const sx of [-0.345, 0.345]) {
    for (const sz of [-0.11, 0.11]) {
      ctx.sphere(0.078, 8, shade(primary, 0.04), sx, matY + 0.011, sz, {
        thetaLength: Math.PI / 2,
        rings: 2,
        scaleX: 0.85,
        scaleY: 0.12,
        scaleZ: 1.0,
        roughness: 0.96,
        castShadow: false,
      });
    }
  }
  // Raised plush ribbed stripe texture strictly ON TOP of mat core: y = [0.048 .. 0.054]
  for (const rz of [-0.14, 0, 0.14]) {
    ctx.box(0.58, 0.006, 0.064, accent, 0, matY + 0.019, rz, {
      roughness: 0.96,
      castShadow: false,
    });
  }
}

// ============================================================================
// DISPATCHER
// ============================================================================

export const buildLivingModel: TabModelBuilder = (ctx: ModelContext): boolean => {
  switch (ctx.def.id) {
    // Beds (4)
    case 'bed_cozy':
      buildBedCozy(ctx);
      return true;
    case 'bed_canopy':
      buildBedCanopy(ctx);
      return true;
    case 'bed_daybed':
      buildBedDaybed(ctx);
      return true;
    case 'bed_loft':
      buildBedLoft(ctx);
      return true;

    // Seating (5)
    case 'sofa_plush':
      buildSofaPlush(ctx);
      return true;
    case 'sofa_sectional':
      buildSofaSectional(ctx);
      return true;
    case 'loveseat_tufted':
      buildLoveseatTufted(ctx);
      return true;
    case 'armchair_plush':
      buildArmchairPlush(ctx);
      return true;
    case 'beanbag_puff':
      buildBeanbagPuff(ctx);
      return true;

    // Desks & Chair (3)
    case 'desk_study':
      buildDeskStudy(ctx);
      return true;
    case 'desk_compact':
      buildDeskCompact(ctx);
      return true;
    case 'chair_office':
      buildChairOffice(ctx);
      return true;

    // Storage (2)
    case 'wardrobe_tall':
      buildWardrobeTall(ctx);
      return true;
    case 'dresser_wide':
      buildDresserWide(ctx);
      return true;

    // Media & TVs (3)
    case 'tv_widescreen':
      buildTvWidescreen(ctx);
      return true;
    case 'tv_retro':
      buildTvRetro(ctx);
      return true;
    case 'media_console':
      buildMediaConsole(ctx);
      return true;

    // Tables & Rug (3)
    case 'coffee_table_low':
      buildCoffeeTableLow(ctx);
      return true;
    case 'side_table_round':
      buildSideTableRound(ctx);
      return true;
    case 'rug_woven':
      buildRugWoven(ctx);
      return true;

    // Bathroom (6)
    case 'toilet_cozy':
      buildToiletCozy(ctx);
      return true;
    case 'bathroom_sink':
      buildBathroomSink(ctx);
      return true;
    case 'bathtub_clawfoot':
      buildBathtubClawfoot(ctx);
      return true;
    case 'shower_glass':
      buildShowerGlass(ctx);
      return true;
    case 'towel_rack':
      buildTowelRack(ctx);
      return true;
    case 'bath_mat':
      buildBathMat(ctx);
      return true;

    default:
      return false;
  }
};
