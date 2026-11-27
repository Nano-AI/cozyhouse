import * as THREE from 'three';
import { FLOOR_BASE_Y, type ModelContext, type TabModelBuilder } from './ModelKit';

const WARM_OAK = '#C49A6C';
const OAK_DARK = '#A57E55';
const CREAM_LINEN = '#F7F1E7';
const BRASS = '#DFBC6E';

// ============================================================================
// BEDS (4)
// ============================================================================

function buildBedCozy(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Grounded wooden feet & perimeter timber bed frame
  ctx.legs(1.74, 1.82, 0.12, 0.042, OAK_DARK, baseY, 0.08);
  ctx.box(1.74, 0.15, 1.82, WARM_OAK, 0, baseY + 0.195, 0, { roughness: 0.72 });

  // Sculpted slatted wooden headboard at -Z & slim footboard lip at +Z
  ctx.box(1.78, 0.68, 0.09, WARM_OAK, 0, baseY + 0.48, -0.87, { roughness: 0.72 });
  ctx.box(1.82, 0.06, 0.11, OAK_DARK, 0, baseY + 0.83, -0.87, { roughness: 0.68 });
  ctx.box(1.56, 0.46, 0.03, shade(WARM_OAK, 0.1), 0, baseY + 0.52, -0.82, { roughness: 0.75 });
  ctx.box(1.76, 0.24, 0.07, WARM_OAK, 0, baseY + 0.24, 0.88, { roughness: 0.72 });

  // Plush mattress
  ctx.box(1.62, 0.18, 1.70, accent, 0, baseY + 0.35, 0.0, { roughness: 0.88 });

  // Folded cozy duvet blanket covering lower two-thirds
  ctx.box(1.68, 0.19, 1.18, primary, 0, baseY + 0.38, 0.26, { roughness: 0.9 });
  // Turned-down top sheet cuff
  ctx.box(1.66, 0.065, 0.18, accent, 0, baseY + 0.47, -0.26, { roughness: 0.9 });
  // Knitted throw runner folded neatly across foot of bed
  ctx.box(1.70, 0.055, 0.28, shade(primary, -0.18), 0, baseY + 0.485, 0.62, { roughness: 0.94 });

  // Two plump angled pillows leaning against headboard
  ctx.box(0.68, 0.14, 0.38, accent, -0.39, baseY + 0.51, -0.56, {
    rotX: 0.22,
    roughness: 0.92,
  });
  ctx.box(0.68, 0.14, 0.38, shade(primary, 0.28), 0.39, baseY + 0.51, -0.56, {
    rotX: 0.22,
    roughness: 0.92,
  });
}

function buildBedCanopy(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const postH = 2.02;

  // 4 tall corner canopy posts + round top finials
  for (const sx of [-0.84, 0.84]) {
    for (const sz of [-0.84, 0.84]) {
      ctx.cyl(0.034, 0.038, postH, 8, accent, sx, baseY + postH / 2, sz, { roughness: 0.68 });
      ctx.sphere(0.048, 7, shade(accent, -0.1), sx, baseY + postH + 0.02, sz, { roughness: 0.65 });
    }
  }
  // 4 top canopy crown tie beams
  const topY = baseY + postH - 0.05;
  ctx.box(1.72, 0.055, 0.055, accent, 0, topY, -0.84, { roughness: 0.68 });
  ctx.box(1.72, 0.055, 0.055, accent, 0, topY, 0.84, { roughness: 0.68 });
  ctx.box(0.055, 0.055, 1.72, accent, -0.84, topY, 0, { roughness: 0.68 });
  ctx.box(0.055, 0.055, 1.72, accent, 0.84, topY, 0, { roughness: 0.68 });

  // Bed frame + low slatted headboard
  ctx.box(1.70, 0.15, 1.70, accent, 0, baseY + 0.22, 0, { roughness: 0.72 });
  ctx.box(1.66, 0.50, 0.075, shade(accent, -0.06), 0, baseY + 0.52, -0.82, { roughness: 0.72 });

  // Plush mattress, pastel duvet & pillows
  ctx.box(1.58, 0.17, 1.60, CREAM_LINEN, 0, baseY + 0.36, 0, { roughness: 0.88 });
  ctx.box(1.62, 0.18, 1.08, primary, 0, baseY + 0.39, 0.26, { roughness: 0.92 });
  ctx.box(0.62, 0.13, 0.34, CREAM_LINEN, -0.36, baseY + 0.51, -0.52, { rotX: 0.2, roughness: 0.92 });
  ctx.box(0.62, 0.13, 0.34, shade(primary, 0.16), 0.36, baseY + 0.51, -0.52, {
    rotX: 0.2,
    roughness: 0.92,
  });

  // Soft sheer overhead canopy fabric + 4 gathered corner drapes
  const drapeCol = shade(primary, 0.14);
  ctx.box(1.64, 0.032, 1.64, drapeCol, 0, topY + 0.032, 0, {
    opacity: 0.68,
    roughness: 0.95,
    castShadow: false,
  });
  for (const sx of [-0.79, 0.79]) {
    for (const sz of [-0.79, 0.79]) {
      ctx.cyl(0.11, 0.07, 1.05, 7, drapeCol, sx, topY - 0.54, sz, {
        opacity: 0.76,
        roughness: 0.95,
      });
      ctx.cyl(0.065, 0.12, 0.62, 7, drapeCol, sx, baseY + 0.56, sz, {
        opacity: 0.76,
        roughness: 0.95,
      });
    }
  }
}

function buildBedDaybed(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Tapered wooden legs + slatted daybed base
  ctx.legs(1.80, 0.84, 0.18, 0.032, OAK_DARK, baseY, 0.07);
  ctx.box(1.82, 0.10, 0.84, WARM_OAK, 0, baseY + 0.23, 0, { roughness: 0.72 });

  // Back top rail & 5 slatted vertical spindles
  ctx.box(1.84, 0.06, 0.065, WARM_OAK, 0, baseY + 0.73, -0.39, { roughness: 0.7 });
  for (let i = 0; i < 5; i++) {
    const x = -0.78 + i * 0.39;
    ctx.box(0.045, 0.46, 0.04, OAK_DARK, x, baseY + 0.49, -0.39, { roughness: 0.72 });
  }
  // Left & right slatted arm rails
  for (const sx of [-0.88, 0.88]) {
    ctx.box(0.06, 0.055, 0.84, WARM_OAK, sx, baseY + 0.63, 0, { roughness: 0.7 });
    ctx.box(0.045, 0.36, 0.05, OAK_DARK, sx, baseY + 0.44, 0.38, { roughness: 0.72 });
    ctx.box(0.045, 0.36, 0.04, OAK_DARK, sx, baseY + 0.44, 0, { roughness: 0.72 });
  }

  // Tailored bench mattress
  ctx.box(1.72, 0.16, 0.76, primary, 0, baseY + 0.36, 0.02, { roughness: 0.9 });

  // Two cylindrical side bolster cushions
  for (const sx of [-0.73, 0.73]) {
    ctx.cyl(0.092, 0.092, 0.64, 9, accent, sx, baseY + 0.51, 0.02, {
      rotX: Math.PI / 2,
      roughness: 0.92,
    });
  }
  // Two plush back pillows reclining back against spindles (-Z)
  ctx.box(0.56, 0.28, 0.15, accent, -0.32, baseY + 0.56, -0.24, { rotX: -0.16, roughness: 0.92 });
  ctx.box(0.56, 0.28, 0.15, shade(primary, 0.15), 0.32, baseY + 0.56, -0.24, {
    rotX: -0.16,
    roughness: 0.92,
  });

  // Cozy folded throw draped over front-right corner
  const throwCol = shade(accent, -0.1);
  ctx.box(0.42, 0.045, 0.50, throwCol, 0.40, baseY + 0.455, 0.16, { roughness: 0.95 });
  ctx.box(0.42, 0.24, 0.045, throwCol, 0.40, baseY + 0.34, 0.41, { roughness: 0.95 });
}

function buildBedLoft(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const postH = 1.80;

  // 4 tall loft timber corner posts
  for (const sx of [-0.86, 0.86]) {
    for (const sz of [-0.84, 0.84]) {
      ctx.box(0.075, postH, 0.075, accent, sx, baseY + postH / 2, sz, { roughness: 0.72 });
    }
  }
  // Upper loft sleeping platform deck
  const deckY = baseY + 1.18;
  ctx.box(1.80, 0.11, 1.74, accent, 0, deckY, 0, { roughness: 0.72 });

  // Upper safety guardrails (back, sides, and partial front leaving ladder climb gap)
  const railY = deckY + 0.36;
  ctx.box(1.78, 0.055, 0.05, accent, 0, railY, -0.84, { roughness: 0.72 });
  ctx.box(0.05, 0.055, 1.72, accent, -0.86, railY, 0, { roughness: 0.72 });
  ctx.box(0.05, 0.055, 1.72, accent, 0.86, railY, 0, { roughness: 0.72 });
  ctx.box(1.16, 0.055, 0.05, accent, -0.28, railY, 0.84, { roughness: 0.72 });
  ctx.box(1.16, 0.04, 0.04, shade(accent, -0.06), -0.28, deckY + 0.20, 0.84, { roughness: 0.74 });

  // Built-in climb ladder on front-right (+X, +Z)
  const ladCol = shade(accent, -0.1);
  ctx.box(0.045, 1.24, 0.045, ladCol, 0.36, baseY + 0.62, 0.86, { roughness: 0.72 });
  ctx.box(0.045, 1.24, 0.045, ladCol, 0.76, baseY + 0.62, 0.86, { roughness: 0.72 });
  for (let i = 0; i < 4; i++) {
    ctx.box(0.40, 0.036, 0.045, ladCol, 0.56, baseY + 0.24 + i * 0.29, 0.86, { roughness: 0.72 });
  }

  // Upper mattress, duvet & pillow
  ctx.box(1.64, 0.13, 1.60, CREAM_LINEN, 0, deckY + 0.12, 0, { roughness: 0.9 });
  ctx.box(1.66, 0.14, 1.12, primary, 0, deckY + 0.145, 0.22, { roughness: 0.92 });
  ctx.box(0.60, 0.11, 0.32, CREAM_LINEN, -0.40, deckY + 0.24, -0.54, { rotX: 0.18, roughness: 0.92 });

  // Cozy under-loft chill futon tucked underneath along back-left
  ctx.box(1.24, 0.12, 0.70, shade(accent, -0.12), -0.18, baseY + 0.10, -0.34, { roughness: 0.74 });
  ctx.box(1.18, 0.15, 0.66, shade(primary, 0.12), -0.18, baseY + 0.23, -0.32, { roughness: 0.92 });
  ctx.box(1.18, 0.36, 0.15, primary, -0.18, baseY + 0.46, -0.60, { rotX: -0.16, roughness: 0.92 });
  ctx.box(0.28, 0.22, 0.10, CREAM_LINEN, -0.52, baseY + 0.42, -0.44, {
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
// SEATING (5)
// ============================================================================

function buildSofaPlush(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  ctx.legs(1.74, 0.78, 0.12, 0.032, OAK_DARK, baseY, 0.08);
  // Upholstered base deck
  ctx.box(1.74, 0.15, 0.78, shade(primary, -0.09), 0, baseY + 0.195, 0, { roughness: 0.88 });
  // Two plump seat cushions
  for (const sx of [-0.365, 0.365]) {
    ctx.box(0.71, 0.155, 0.65, primary, sx, baseY + 0.34, 0.055, { roughness: 0.9 });
  }
  // Padded side armrests with rounded top bolster cylinders
  for (const sx of [-0.79, 0.79]) {
    ctx.box(0.17, 0.34, 0.78, shade(primary, -0.04), sx, baseY + 0.42, 0, { roughness: 0.9 });
    ctx.cyl(0.085, 0.085, 0.76, 8, primary, sx, baseY + 0.59, 0, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
  }
  // Back frame + two plump reclining back cushions
  ctx.box(1.74, 0.54, 0.15, shade(primary, -0.07), 0, baseY + 0.52, -0.32, { roughness: 0.88 });
  for (const sx of [-0.365, 0.365]) {
    ctx.box(0.69, 0.35, 0.17, shade(primary, 0.06), sx, baseY + 0.61, -0.18, {
      rotX: -0.14,
      roughness: 0.92,
    });
  }
  // Cozy cream accent throw pillow tucked in left corner
  ctx.box(0.26, 0.24, 0.10, CREAM_LINEN, -0.56, baseY + 0.53, -0.02, {
    rotY: 0.35,
    rotZ: 0.24,
    roughness: 0.94,
  });
}

function buildSofaSectional(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Low wooden feet under L-footprint
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

  // L-shaped base plinth (back sofa run + left-side chaise)
  ctx.box(1.80, 0.15, 0.82, accent, 0, baseY + 0.175, -0.48, { roughness: 0.88 });
  ctx.box(0.84, 0.15, 0.98, accent, -0.48, baseY + 0.175, 0.40, { roughness: 0.88 });

  // Plump seat cushions
  ctx.box(0.76, 0.16, 0.70, primary, 0.34, baseY + 0.33, -0.41, { roughness: 0.92 });
  ctx.box(0.76, 0.16, 0.70, primary, -0.44, baseY + 0.33, -0.41, { roughness: 0.92 });
  ctx.box(0.78, 0.16, 0.94, primary, -0.45, baseY + 0.33, 0.42, { roughness: 0.92 });

  // Wrap-around backrests & armrests
  ctx.box(1.80, 0.56, 0.17, accent, 0, baseY + 0.51, -0.81, { roughness: 0.88 });
  ctx.box(0.17, 0.48, 1.18, accent, -0.82, baseY + 0.46, -0.28, { roughness: 0.88 });
  ctx.box(0.17, 0.38, 0.82, accent, 0.81, baseY + 0.41, -0.48, { roughness: 0.88 });

  // Plump backrest cushions reclining cleanly against the L-corner frame
  ctx.box(0.74, 0.35, 0.17, shade(primary, 0.05), 0.34, baseY + 0.59, -0.66, {
    rotX: -0.13,
    roughness: 0.92,
  });
  ctx.box(0.72, 0.35, 0.17, shade(primary, 0.05), -0.41, baseY + 0.59, -0.66, {
    rotX: -0.13,
    roughness: 0.92,
  });
  ctx.box(0.17, 0.34, 0.64, shade(primary, 0.04), -0.66, baseY + 0.58, -0.14, {
    rotZ: 0.13,
    roughness: 0.92,
  });

  // Two contrasting throw pillows nestled in the corner
  ctx.box(0.28, 0.25, 0.10, '#EAB7A0', -0.52, baseY + 0.53, -0.48, {
    rotY: 0.78,
    rotZ: 0.18,
    roughness: 0.94,
  });
  ctx.box(0.24, 0.22, 0.09, CREAM_LINEN, 0.58, baseY + 0.52, -0.48, {
    rotY: -0.38,
    rotZ: -0.2,
    roughness: 0.94,
  });
}

function buildLoveseatTufted(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Tapered splayed wooden legs
  ctx.legs(1.62, 0.72, 0.15, 0.028, OAK_DARK, baseY, 0.08);
  // Base deck & plush single bench seat cushion
  ctx.box(1.64, 0.13, 0.74, shade(primary, -0.08), 0, baseY + 0.215, 0, { roughness: 0.88 });
  ctx.box(1.38, 0.15, 0.64, primary, 0, baseY + 0.345, 0.05, { roughness: 0.9 });

  // Curved flared rolled armrests
  for (const dir of [-1, 1] as const) {
    ctx.box(0.15, 0.32, 0.70, shade(primary, -0.05), dir * 0.75, baseY + 0.42, 0, {
      rotZ: dir * -0.14,
      roughness: 0.9,
    });
    ctx.cyl(0.088, 0.088, 0.70, 9, primary, dir * 0.78, baseY + 0.58, 0, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
  }

  // Tufted contoured backrest with scalloped curved crown (total height ~0.84)
  ctx.box(1.44, 0.44, 0.16, primary, 0, baseY + 0.52, -0.29, { rotX: -0.06, roughness: 0.9 });
  for (const [cx, r] of [
    [-0.44, 0.24],
    [0, 0.27],
    [0.44, 0.24],
  ] as const) {
    ctx.cyl(r, r, 0.15, 10, shade(primary, 0.03), cx, baseY + 0.67, -0.30, {
      rotX: Math.PI / 2,
      scaleZ: 0.56,
      roughness: 0.9,
    });
  }

  // Six tactile tufted button dimples across the backrest
  const btnCol = shade(primary, -0.24);
  for (const bx of [-0.42, 0, 0.42]) {
    for (const by of [0.50, 0.64]) {
      ctx.sphere(0.025, 6, btnCol, bx, baseY + by, -0.205, { roughness: 0.85 });
    }
  }
}

function buildArmchairPlush(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const cz = -0.08;

  // 4 angled mid-century reading chair legs
  for (const sx of [-0.29, 0.29]) {
    for (const sz of [cz - 0.24, cz + 0.24]) {
      ctx.cyl(0.024, 0.017, 0.16, 6, OAK_DARK, sx, baseY + 0.08, sz, {
        rotZ: sx > 0 ? 0.1 : -0.1,
        rotX: sz > cz ? -0.08 : 0.08,
        roughness: 0.72,
      });
    }
  }
  // Chair base + plush seat cushion
  ctx.box(0.68, 0.13, 0.60, shade(primary, -0.08), 0, baseY + 0.215, cz, { roughness: 0.88 });
  ctx.box(0.54, 0.13, 0.52, primary, 0, baseY + 0.33, cz + 0.03, { roughness: 0.92 });

  // Wingback backrest + sculpted side wing cheeks
  ctx.box(0.64, 0.54, 0.14, primary, 0, baseY + 0.56, cz - 0.23, { rotX: -0.1, roughness: 0.9 });
  for (const sx of [-0.31, 0.31]) {
    ctx.box(0.10, 0.30, 0.22, shade(primary, -0.04), sx, baseY + 0.66, cz - 0.14, {
      roughness: 0.9,
    });
    // Rounded armrests
    ctx.box(0.11, 0.23, 0.56, shade(primary, -0.06), sx, baseY + 0.42, cz + 0.01, {
      roughness: 0.9,
    });
    ctx.cyl(0.056, 0.056, 0.56, 8, primary, sx, baseY + 0.535, cz + 0.01, {
      rotX: Math.PI / 2,
      roughness: 0.9,
    });
  }
  // Lumbar pillow reclining cleanly against the wingback backrest
  ctx.box(0.36, 0.19, 0.09, CREAM_LINEN, 0, baseY + 0.48, cz - 0.10, {
    rotX: -0.12,
    roughness: 0.94,
  });

  // Compact tucked matching ottoman footstool in front (+Z, stays within 1x1)
  ctx.box(0.42, 0.11, 0.20, shade(primary, 0.06), 0, baseY + 0.145, 0.33, { roughness: 0.92 });
  for (const ox of [-0.15, 0.15]) {
    ctx.cyl(0.018, 0.014, 0.09, 6, OAK_DARK, ox, baseY + 0.045, 0.33, { roughness: 0.72 });
  }
}

function buildBeanbagPuff(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Wide plush bottom pouf base grounded cleanly at FLOOR_BASE_Y
  ctx.sphere(0.38, 10, shade(primary, -0.05), 0, baseY + 0.19, 0.02, {
    scaleX: 1.06,
    scaleY: 0.5,
    scaleZ: 1.06,
    roughness: 0.94,
  });
  // 5 radial soft pleated lobe puffs around the perimeter
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const col = i % 2 === 0 ? primary : shade(primary, 0.05);
    ctx.sphere(0.20, 8, col, Math.cos(a) * 0.22, baseY + 0.21, Math.sin(a) * 0.22 + 0.02, {
      scaleX: 1.0,
      scaleY: 0.66,
      scaleZ: 1.0,
      roughness: 0.94,
    });
  }
  // Slouchy back teardrop hump
  ctx.sphere(0.26, 9, primary, 0, baseY + 0.32, -0.10, {
    scaleX: 0.94,
    scaleY: 0.82,
    scaleZ: 0.88,
    roughness: 0.94,
  });
  // Gathered top peak + stitched fabric button
  ctx.cone(0.105, 0.13, 7, shade(primary, 0.07), 0, baseY + 0.46, -0.14, {
    rotX: -0.26,
    roughness: 0.94,
  });
  ctx.sphere(0.028, 6, shade(primary, -0.18), 0, baseY + 0.50, -0.155, { roughness: 0.9 });
  // Cozy seated dimple cushion
  ctx.sphere(0.23, 8, shade(primary, -0.08), 0, baseY + 0.25, 0.13, {
    scaleX: 1.04,
    scaleY: 0.28,
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

  // Desktop slab flush at y = topY
  ctx.box(1.84, slabH, 0.84, primary, 0, topY - slabH / 2, 0, { roughness: 0.65 });
  // Slim under-apron + center pencil drawer
  ctx.box(1.74, 0.042, 0.74, shade(primary, -0.1), 0, topY - slabH - 0.021, 0, { roughness: 0.72 });
  ctx.box(0.84, 0.068, 0.70, shade(primary, -0.04), -0.18, topY - slabH - 0.036, 0.01, {
    roughness: 0.72,
  });
  ctx.sphere(0.02, 6, BRASS, -0.18, topY - slabH - 0.036, 0.375, {
    roughness: 0.28,
    metalness: 0.68,
  });

  // Left tapered splayed legs + lower side stretcher
  const legH = topY - slabH - baseY;
  for (const sz of [-0.32, 0.32]) {
    ctx.cyl(0.03, 0.02, legH, 6, shade(primary, -0.14), -0.80, baseY + legH / 2, sz, {
      rotZ: -0.05,
      roughness: 0.7,
    });
  }
  ctx.box(0.035, 0.035, 0.64, shade(primary, -0.16), -0.81, baseY + 0.16, 0, { roughness: 0.72 });

  // Right 3-drawer pedestal unit on short feet
  const cabH = topY - slabH - (baseY + 0.09);
  const cabCy = baseY + 0.09 + cabH / 2;
  ctx.box(0.56, cabH, 0.74, accent, 0.56, cabCy, 0, { roughness: 0.72 });
  for (const dx of [0.34, 0.78]) {
    for (const dz of [-0.30, 0.30]) {
      ctx.cyl(0.024, 0.018, 0.09, 6, shade(primary, -0.16), dx, baseY + 0.045, dz, {
        roughness: 0.7,
      });
    }
  }
  // 3 sculpted drawer fronts with brass bar pulls
  for (let i = 0; i < 3; i++) {
    const dy = baseY + 0.19 + i * 0.19;
    ctx.box(0.50, 0.155, 0.026, shade(accent, -0.05), 0.56, dy, 0.375, { roughness: 0.74 });
    ctx.box(0.13, 0.018, 0.026, BRASS, 0.56, dy, 0.396, { roughness: 0.28, metalness: 0.68 });
  }

  // Subtle wooden pen tray tucked at back-left corner
  ctx.box(0.24, 0.016, 0.075, shade(primary, -0.16), -0.68, topY + 0.008, -0.33, {
    roughness: 0.72,
  });
}

function buildDeskCompact(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.76; // 0.76 exact!
  const slabH = 0.048;

  // Desktop slab flush at y = topY
  ctx.box(0.88, slabH, 0.78, primary, 0, topY - slabH / 2, 0, { roughness: 0.66 });
  // Four tapered legs
  ctx.legs(0.84, 0.74, topY - slabH - baseY, 0.025, shade(primary, -0.15), baseY, 0.07);

  // Under-desk open cubby + mini right drawer
  const cubbyBotY = topY - slabH - 0.14;
  ctx.box(0.80, 0.026, 0.68, shade(primary, -0.08), 0, cubbyBotY, 0, { roughness: 0.72 });
  ctx.box(0.80, 0.13, 0.026, shade(primary, -0.12), 0, cubbyBotY + 0.07, -0.33, { roughness: 0.75 });
  ctx.box(0.026, 0.13, 0.68, shade(primary, -0.1), 0, cubbyBotY + 0.07, 0, { roughness: 0.74 });
  // Right mini drawer + brass knob
  ctx.box(0.36, 0.115, 0.64, shade(primary, 0.06), 0.20, cubbyBotY + 0.068, 0.01, {
    roughness: 0.72,
  });
  ctx.sphere(0.019, 6, BRASS, 0.20, cubbyBotY + 0.068, 0.345, {
    roughness: 0.28,
    metalness: 0.68,
  });
  // Cute stacked notebook peeking from left open cubby
  ctx.box(0.26, 0.036, 0.34, '#FAF3E7', -0.20, cubbyBotY + 0.032, 0.06, { roughness: 0.85 });
  ctx.box(0.24, 0.028, 0.30, '#E8B1A2', -0.21, cubbyBotY + 0.064, 0.04, {
    rotY: 0.12,
    roughness: 0.85,
  });

  // Compact ceramic pencil cup tucked neatly in back-right corner (keeps center clear for surface items!)
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
    ctx.box(0.28, 0.028, 0.034, accent, dx * 0.15, baseY + 0.062, dz * 0.15, {
      rotY: -a,
      roughness: 0.45,
      metalness: 0.22,
    });
    // Caster wheel touching FLOOR_BASE_Y
    ctx.cyl(0.024, 0.024, 0.026, 7, '#464B52', dx * 0.27, baseY + 0.024, dz * 0.27, {
      rotZ: Math.PI / 2,
      rotY: -a,
      roughness: 0.6,
    });
  }
  ctx.cyl(0.032, 0.036, 0.32, 8, metalCol, 0, baseY + 0.24, 0, {
    roughness: 0.32,
    metalness: 0.62,
  });

  // Spinning upper chair seat + backrest + armrests
  const spin = new THREE.Group();
  spin.name = 'SpinTarget';
  spin.userData.spinAxis = 'y';
  spin.userData.spinSpeed = 2.2;
  ctx.group.add(spin);

  // Molded seat shell & contoured upholstered seat cushion
  ctx.box(0.49, 0.045, 0.47, accent, 0, baseY + 0.40, 0.01, { parent: spin, roughness: 0.55 });
  ctx.box(0.46, 0.075, 0.44, primary, 0, baseY + 0.455, 0.02, { parent: spin, roughness: 0.88 });

  // Backrest support spine + contoured backrest cushion
  ctx.box(0.09, 0.36, 0.042, accent, 0, baseY + 0.58, -0.23, {
    parent: spin,
    rotX: -0.1,
    roughness: 0.52,
  });
  ctx.box(0.44, 0.37, 0.088, primary, 0, baseY + 0.71, -0.20, {
    parent: spin,
    rotX: -0.09,
    roughness: 0.88,
  });
  ctx.box(0.36, 0.09, 0.04, shade(primary, 0.1), 0, baseY + 0.60, -0.155, {
    parent: spin,
    roughness: 0.9,
  });

  // Curved armrests
  for (const sx of [-0.255, 0.255]) {
    ctx.box(0.036, 0.18, 0.04, accent, sx, baseY + 0.51, -0.02, { parent: spin, roughness: 0.52 });
    ctx.box(0.055, 0.036, 0.30, shade(accent, -0.1), sx, baseY + 0.605, 0.02, {
      parent: spin,
      roughness: 0.65,
    });
  }
}

// ============================================================================
// STORAGE (2)
// ============================================================================

function buildWardrobeTall(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Plinth base
  ctx.box(1.74, 0.11, 0.78, shade(primary, -0.14), 0, baseY + 0.055, 0, { roughness: 0.74 });

  // Cabinet carcass (hollow interior alcove so opening doors reveals clothes!)
  const carH = 1.78;
  const carBase = baseY + 0.11;
  ctx.box(1.72, carH, 0.06, shade(primary, -0.12), 0, carBase + carH / 2, -0.35, {
    roughness: 0.78,
  });
  for (const sx of [-0.83, 0.83]) {
    ctx.box(0.06, carH, 0.76, primary, sx, carBase + carH / 2, 0, { roughness: 0.72 });
  }
  ctx.box(1.72, 0.06, 0.76, primary, 0, carBase + carH - 0.03, 0, { roughness: 0.72 });
  // Mid divider shelf above bottom drawer
  ctx.box(1.66, 0.05, 0.72, shade(primary, -0.06), 0, carBase + 0.36, 0, { roughness: 0.74 });

  // Bottom wide drawer with dual brass knobs
  ctx.box(1.60, 0.30, 0.72, shade(primary, 0.05), 0, carBase + 0.18, 0.02, { roughness: 0.72 });
  for (const kx of [-0.42, 0.42]) {
    ctx.sphere(0.028, 7, BRASS, kx, carBase + 0.18, 0.40, { roughness: 0.28, metalness: 0.68 });
  }

  // Sculpted overhanging crown cornice (top = ~2.00)
  ctx.box(1.84, 0.085, 0.86, shade(primary, -0.08), 0, carBase + carH + 0.04, 0, {
    roughness: 0.68,
  });

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

  // Left & right shaker-paneled tall wardrobe doors (swing slightly open when isActive!)
  const doorH = 1.33;
  const doorY = carBase + 0.39 + doorH / 2;
  const openAngle = ctx.isActive ? 0.56 : 0;

  for (const side of [-1, 1] as const) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 0.80, 0, 0.37);
    hinge.rotation.y = side * openAngle;
    ctx.group.add(hinge);

    const cx = -side * 0.395;
    ctx.box(0.78, doorH, 0.045, primary, cx, doorY, 0, { parent: hinge, roughness: 0.72 });
    // Recessed decorative shaker panel
    ctx.box(0.58, doorH - 0.24, 0.052, shade(primary, -0.08), cx, doorY, 0, {
      parent: hinge,
      roughness: 0.76,
    });
    // Vertical brass handle near center seam
    ctx.cyl(0.014, 0.014, 0.19, 6, BRASS, -side * 0.71, doorY - 0.06, 0.042, {
      parent: hinge,
      roughness: 0.28,
      metalness: 0.68,
    });
  }
}

function buildDresserWide(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.85; // 0.85 exact!
  const topH = 0.052;
  const legH = 0.12;

  // Tapered feet
  ctx.legs(1.74, 0.76, legH, 0.032, shade(primary, -0.18), baseY, 0.08);

  // Main wooden dresser body
  const bodyH = topY - topH - (baseY + legH);
  const bodyCy = baseY + legH + bodyH / 2;
  ctx.box(1.76, bodyH, 0.76, primary, 0, bodyCy, 0, { roughness: 0.72 });

  // Overhanging tabletop flush at exact y = 0.85
  ctx.box(1.84, topH, 0.84, shade(primary, 0.06), 0, topY - topH / 2, 0, { roughness: 0.65 });

  // Three wide horizontal drawers with dual brass knobs
  const drawerStep = bodyH / 3;
  for (let i = 0; i < 3; i++) {
    const dy = baseY + legH + drawerStep * (i + 0.5);
    ctx.box(1.62, drawerStep - 0.036, 0.036, accent, 0, dy, 0.382, { roughness: 0.72 });
    for (const kx of [-0.46, 0.46]) {
      ctx.sphere(0.025, 7, BRASS, kx, dy, 0.415, { roughness: 0.28, metalness: 0.68 });
    }
  }
}

// ============================================================================
// MEDIA & TVs (3) — TVs are surface layer (local y = 0), glow warmly when active
// ============================================================================

function buildTvWidescreen(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;

  // Pedestal base & slim stand neck resting cleanly on surface y = 0
  ctx.box(0.38, 0.026, 0.22, accent, 0, 0.013, 0, { roughness: 0.45, metalness: 0.22 });
  ctx.box(0.075, 0.10, 0.04, shade(accent, -0.12), 0, 0.07, -0.01, {
    roughness: 0.45,
    metalness: 0.22,
  });

  // Slim flat-screen bezel housing + rear electronics plate
  const screenY = 0.36;
  ctx.box(0.84, 0.49, 0.042, accent, 0, screenY, 0, { roughness: 0.46, metalness: 0.12 });
  ctx.box(0.54, 0.28, 0.026, shade(accent, -0.15), 0, screenY - 0.02, -0.028, { roughness: 0.55 });

  // Display screen (dark glossy off-state vs warmly glowing cozy scenery on-state!)
  if (isActive) {
    ctx.box(0.77, 0.42, 0.012, primary, 0, screenY, 0.02, {
      emissive: primary,
      emissiveIntensity: 0.62,
      roughness: 0.2,
      castShadow: false,
    });
    // Cozy glowing miniature sunset hill scene on screen
    ctx.box(0.74, 0.14, 0.008, '#95C9A8', 0, screenY - 0.13, 0.027, {
      emissive: '#95C9A8',
      emissiveIntensity: 0.55,
      castShadow: false,
    });
    ctx.cyl(0.068, 0.068, 0.008, 10, '#FBE29D', 0.18, screenY + 0.07, 0.027, {
      rotX: Math.PI / 2,
      emissive: '#FBE29D',
      emissiveIntensity: 0.85,
      castShadow: false,
    });
    ctx.box(0.18, 0.055, 0.008, '#FFFDF8', -0.16, screenY + 0.09, 0.027, {
      emissive: '#FFFDF8',
      emissiveIntensity: 0.7,
      castShadow: false,
    });
    // Green power LED
    ctx.box(0.024, 0.012, 0.014, '#7BD88F', 0.34, screenY - 0.225, 0.022, {
      emissive: '#7BD88F',
      emissiveIntensity: 0.9,
      castShadow: false,
    });
  } else {
    ctx.box(0.77, 0.42, 0.012, '#2C3440', 0, screenY, 0.02, {
      roughness: 0.16,
      metalness: 0.18,
      castShadow: false,
    });
    // Standby red LED dot
    ctx.box(0.024, 0.012, 0.014, '#D96B6B', 0.34, screenY - 0.225, 0.022, {
      emissive: '#D96B6B',
      emissiveIntensity: 0.45,
      castShadow: false,
    });
  }
}

function buildTvRetro(ctx: ModelContext): void {
  const { primary, accent, shade, isActive } = ctx;

  // 4 stubby vintage feet sitting on surface y = 0
  ctx.legs(0.56, 0.36, 0.048, 0.022, OAK_DARK, 0, 0.06);

  // Rounded boxy CRT pastel casing + tapered cathode-tube back
  const bodyY = 0.235;
  ctx.box(0.60, 0.37, 0.38, primary, 0, bodyY, 0, { roughness: 0.56 });
  ctx.box(0.42, 0.27, 0.14, shade(primary, -0.14), 0, bodyY, -0.23, { roughness: 0.62 });
  // Cream front face bezel
  ctx.box(0.55, 0.32, 0.03, accent, 0, bodyY, 0.185, { roughness: 0.64 });

  // Slightly bulbous curved CRT glass screen on left of bezel
  const screenX = -0.065;
  if (isActive) {
    ctx.sphere(0.165, 10, '#B5E4EA', screenX, bodyY, 0.19, {
      scaleX: 1.18,
      scaleY: 0.84,
      scaleZ: 0.22,
      emissive: '#AEE1E8',
      emissiveIntensity: 0.72,
      roughness: 0.18,
      castShadow: false,
    });
    // Glowing pastel retro test-pattern color stripes
    const stripes: Array<[number, string]> = [
      [-0.10, '#F5C4A0'],
      [0.0, '#F8E39A'],
      [0.10, '#A6D9B8'],
    ];
    for (const [sx, col] of stripes) {
      ctx.box(0.075, 0.16, 0.012, col, screenX + sx, bodyY, 0.224, {
        emissive: col,
        emissiveIntensity: 0.78,
        castShadow: false,
      });
    }
  } else {
    ctx.sphere(0.165, 10, '#36444B', screenX, bodyY, 0.19, {
      scaleX: 1.18,
      scaleY: 0.84,
      scaleZ: 0.22,
      roughness: 0.18,
      metalness: 0.14,
      castShadow: false,
    });
  }

  // Right-side rotary channel/volume dials & speaker vents
  for (const dy of [0.31, 0.225]) {
    ctx.cyl(0.032, 0.034, 0.028, 8, '#5E554D', 0.195, dy, 0.205, {
      rotX: Math.PI / 2,
      roughness: 0.45,
    });
    ctx.cyl(0.016, 0.016, 0.032, 6, BRASS, 0.195, dy, 0.21, {
      rotX: Math.PI / 2,
      roughness: 0.3,
      metalness: 0.65,
    });
  }
  for (const sy of [0.115, 0.142, 0.169]) {
    ctx.box(0.095, 0.012, 0.012, shade(accent, -0.25), 0.195, sy, 0.203, { roughness: 0.75 });
  }

  // Iconic V-shaped metallic rabbit-ear antennas on top
  ctx.cyl(0.042, 0.048, 0.026, 8, '#5E646E', 0, 0.43, -0.02, {
    roughness: 0.4,
    metalness: 0.4,
  });
  for (const dir of [-1, 1] as const) {
    ctx.cyl(0.008, 0.01, 0.20, 6, '#C5CCD4', dir * 0.072, 0.505, -0.02, {
      rotZ: dir * -0.52,
      roughness: 0.22,
      metalness: 0.78,
    });
    ctx.sphere(0.016, 6, '#D6DCE3', dir * 0.122, 0.59, -0.02, {
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

  // 4 splayed mid-century tapered legs
  for (const sx of [-0.79, 0.79]) {
    for (const sz of [-0.26, 0.26]) {
      ctx.cyl(0.028, 0.018, legH, 6, shade(primary, -0.2), sx, baseY + legH / 2, sz, {
        rotZ: sx > 0 ? 0.1 : -0.1,
        roughness: 0.7,
      });
    }
  }

  // Credenza cabinet body + flush top slab at y = 0.56
  ctx.box(1.80, cabH, 0.70, primary, 0, cabCy, 0, { roughness: 0.72 });
  ctx.box(1.86, topH, 0.76, shade(primary, 0.05), 0, topY - topH / 2, 0, { roughness: 0.65 });

  // Left half: slatted tambour/cane sliding cabinet door
  const doorCol = ctx.variant.accentColor ? accent : shade(primary, 0.09);
  ctx.box(0.80, cabH - 0.06, 0.028, doorCol, -0.44, cabCy, 0.352, { roughness: 0.76 });
  for (let i = 0; i < 6; i++) {
    ctx.box(0.022, cabH - 0.08, 0.016, shade(doorCol, -0.14), -0.76 + i * 0.125, cabCy, 0.368, {
      roughness: 0.78,
    });
  }
  ctx.box(0.022, 0.09, 0.022, BRASS, -0.09, cabCy, 0.374, { roughness: 0.28, metalness: 0.68 });

  // Right half: open recessed shelf cubby with media player box & mini books
  ctx.box(0.80, cabH - 0.07, 0.06, shade(primary, -0.34), 0.44, cabCy, 0.33, { roughness: 0.85 });
  ctx.box(0.80, 0.026, 0.09, primary, 0.44, cabCy, 0.345, { roughness: 0.72 });
  // Compact slate media console box on upper shelf
  ctx.box(0.46, 0.055, 0.14, '#59616C', 0.40, cabCy + 0.042, 0.33, { roughness: 0.45 });
  ctx.box(0.025, 0.014, 0.014, '#7CD892', 0.58, cabCy + 0.042, 0.402, {
    emissive: '#7CD892',
    emissiveIntensity: 0.6,
  });
  // Two standing art/record sleeves on lower right shelf
  ctx.box(0.055, 0.115, 0.12, '#E6A796', 0.18, cabCy - 0.075, 0.33, { roughness: 0.82 });
  ctx.box(0.055, 0.115, 0.12, '#B5CEBC', 0.245, cabCy - 0.075, 0.33, { roughness: 0.82 });
}

// ============================================================================
// TABLES & RUG (3) — exact surfaceHeight for tables, y = 0.028 for rug
// ============================================================================

function buildCoffeeTableLow(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const topY = ctx.def.surfaceHeight ?? 0.44; // 0.44 exact!
  const slabH = 0.048;

  // Rounded-bevel tabletop flush at exact y = 0.44
  ctx.box(1.74, slabH, 0.74, primary, 0, topY - slabH / 2, 0, { roughness: 0.64 });
  ctx.box(1.66, 0.024, 0.66, shade(primary, -0.1), 0, topY - slabH - 0.012, 0, { roughness: 0.7 });

  // 4 gracefully splayed mid-century wooden legs
  const legH = topY - slabH - baseY;
  for (const sx of [-0.74, 0.74]) {
    for (const sz of [-0.26, 0.26]) {
      ctx.cyl(0.028, 0.019, legH, 6, shade(primary, -0.15), sx, baseY + legH / 2, sz, {
        rotZ: sx > 0 ? 0.11 : -0.11,
        rotX: sz > 0 ? -0.07 : 0.07,
        roughness: 0.7,
      });
    }
  }

  // Lower slatted magazine shelf
  const shelfY = baseY + 0.15;
  for (const sz of [-0.23, 0.23]) {
    ctx.box(1.44, 0.024, 0.036, shade(primary, -0.12), 0, shelfY, sz, { roughness: 0.72 });
  }
  for (let i = 0; i < 6; i++) {
    const sx = -0.60 + i * 0.24;
    ctx.box(0.085, 0.02, 0.48, shade(primary, -0.05), sx, shelfY + 0.016, 0, { roughness: 0.7 });
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
  ctx.torus(0.375, 0.013, 6, 16, shade(primary, 0.08), 0, topY + 0.004, 0, {
    rotX: Math.PI / 2,
    roughness: 0.6,
  });
  // Under-table hub apron
  ctx.cyl(0.21, 0.19, 0.032, 10, shade(primary, -0.1), 0, topY - topH - 0.016, 0, {
    roughness: 0.72,
  });

  // 3 splayed tapered tripod wooden legs (120 degrees apart)
  const legH = topY - topH - baseY;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const pivot = new THREE.Group();
    pivot.position.set(dx * 0.20, baseY + legH / 2 + 0.004, dz * 0.20);
    pivot.rotation.y = -a;
    ctx.group.add(pivot);
    ctx.cyl(0.025, 0.017, legH * 0.985, 6, WARM_OAK, 0, 0, 0, {
      parent: pivot,
      rotZ: 0.14,
      roughness: 0.7,
    });
  }
  // Delicate horizontal tripod tie ring
  ctx.torus(0.205, 0.012, 6, 12, OAK_DARK, 0, baseY + 0.17, 0, {
    rotX: Math.PI / 2,
    roughness: 0.72,
  });
}

function buildRugWoven(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const rugY = 0.028; // Art Bible: rugs sit cleanly at y = 0.028

  // Main thick woven rug body (3x2 footprint -> 2.70 x 1.82 + tassels = 2.90 x 1.82)
  ctx.box(2.70, 0.016, 1.82, primary, 0, rugY + 0.008, 0, {
    roughness: 0.96,
    castShadow: false,
  });
  // Layered contrasting woven border & warm inner field
  ctx.box(2.48, 0.004, 1.60, shade(primary, -0.15), 0, rugY + 0.0175, 0, {
    roughness: 0.96,
    castShadow: false,
  });
  ctx.box(2.22, 0.004, 1.36, shade(primary, 0.14), 0, rugY + 0.0205, 0, {
    roughness: 0.96,
    castShadow: false,
  });

  // End geometric stripes
  for (const sx of [-1.02, 1.02]) {
    ctx.box(0.085, 0.0045, 1.54, shade(primary, -0.22), sx, rugY + 0.022, 0, {
      roughness: 0.96,
      castShadow: false,
    });
  }
  // 3 woven diamond motifs down the center
  for (const dx of [-0.62, 0, 0.62]) {
    ctx.box(0.32, 0.0045, 0.32, shade(primary, -0.2), dx, rugY + 0.023, 0, {
      rotY: Math.PI / 4,
      roughness: 0.96,
      castShadow: false,
    });
    ctx.box(0.14, 0.0045, 0.14, CREAM_LINEN, dx, rugY + 0.0255, 0, {
      rotY: Math.PI / 4,
      roughness: 0.96,
      castShadow: false,
    });
  }

  // Fringed cream tassels along both short ends (-X and +X)
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 7; i++) {
      const tz = -0.75 + i * 0.25;
      ctx.box(0.11, 0.008, 0.044, CREAM_LINEN, side * 1.40, rugY + 0.005, tz, {
        roughness: 0.96,
        castShadow: false,
      });
    }
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

    default:
      return false;
  }
};
