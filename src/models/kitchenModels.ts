import * as THREE from 'three';
import { FLOOR_BASE_Y, type ModelContext, type TabModelBuilder } from './ModelKit';

const BRASS = '#D5B36E';
const CHROME = '#DCE2E8';
const DARK_IRON = '#3E4147';
const PLINTH_DARK = '#544B45';
const PORCELAIN = '#FAF6EE';
const GLASS_TINT = '#DCEEF5';

/** Helper: subtle rising translucent steam puffs for active hot appliances. */
function addSteamPuffs(ctx: ModelContext, x: number, baseY: number, z: number): void {
  const puffs = [
    { dx: 0, dy: 0.04, dz: 0, r: 0.024, op: 0.55 },
    { dx: 0.018, dy: 0.095, dz: -0.01, r: 0.03, op: 0.42 },
    { dx: -0.012, dy: 0.155, dz: 0.012, r: 0.036, op: 0.28 },
  ];
  for (const p of puffs) {
    ctx.sphere(p.r, 6, '#FFFFFF', x + p.dx, baseY + p.dy, z + p.dz, {
      opacity: p.op,
      roughness: 0.95,
      castShadow: false,
      receiveShadow: false,
    });
  }
}

/** 1. kitchen_counter (2x1, surfaceHeight 0.90) */
function buildKitchenCounter(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.9;
  const topH = 0.056;
  const plinthH = 0.085;
  const bodyH = surfaceY - FLOOR_BASE_Y - plinthH - topH;
  const bodyY = FLOOR_BASE_Y + plinthH + bodyH / 2;
  const w = 1.98;
  const bodyD = 0.80;
  const topD = 0.88;
  const centerZ = -0.01;

  // Recessed toe-kick plinth
  ctx.box(w - 0.04, plinthH, bodyD - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, centerZ - 0.03, {
    roughness: 0.88,
  });

  // Main cabinet carcass
  ctx.box(w - 0.02, bodyH, bodyD, ctx.primary, 0, bodyY, centerZ);

  // 3 upper drawers + 3 lower shaker doors across front (+Z)
  const colCenters = [-0.63, 0, 0.63];
  const colW = 0.59;
  const frontZ = centerZ + bodyD / 2;
  const drawerH = 0.15;
  const drawerY = FLOOR_BASE_Y + plinthH + bodyH - drawerH / 2 - 0.025;
  const doorH = bodyH - drawerH - 0.075;
  const doorY = FLOOR_BASE_Y + plinthH + doorH / 2 + 0.022;
  const panelShade = ctx.shade(ctx.primary, -0.09);
  const frameShade = ctx.shade(ctx.primary, 0.04);

  for (const cx of colCenters) {
    // Upper drawer front + brass bar pull
    ctx.box(colW, drawerH, 0.022, frameShade, cx, drawerY, frontZ + 0.008);
    ctx.box(0.14, 0.018, 0.024, BRASS, cx, drawerY, frontZ + 0.026, {
      metalness: 0.72,
      roughness: 0.3,
    });

    // Lower shaker door outer rail + subtly proud inner panel + vertical pull
    ctx.box(colW, doorH, 0.022, frameShade, cx, doorY, frontZ + 0.008);
    ctx.box(colW - 0.10, doorH - 0.10, 0.010, panelShade, cx, doorY, frontZ + 0.021);
    const pullX = cx + (cx > 0 ? -colW * 0.34 : colW * 0.34);
    ctx.box(0.018, 0.12, 0.018, BRASS, pullX, doorY + doorH * 0.24, frontZ + 0.032, {
      metalness: 0.72,
      roughness: 0.3,
    });
  }

  // Overhanging stone/butcher-block countertop flush at exact surfaceHeight
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, centerZ + 0.01, {
    roughness: 0.52,
  });

  // Low rear backsplash rail tucked along -Z back edge (keeps center clear for surface items)
  ctx.box(w, 0.072, 0.036, ctx.shade(ctx.accent, -0.05), 0, surfaceY + 0.036, centerZ - topD / 2 + 0.028, {
    roughness: 0.56,
  });
}

/** 2. kitchen_counter_corner (1x1, surfaceHeight 0.90) */
function buildKitchenCounterCorner(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.9;
  const topH = 0.056;
  const plinthH = 0.085;
  const bodyH = surfaceY - FLOOR_BASE_Y - plinthH - topH;
  const bodyY = FLOOR_BASE_Y + plinthH + bodyH / 2;
  const w = 0.98;
  const bodyD = 0.80;
  const topD = 0.88;
  const centerZ = -0.01;

  // Recessed toe-kick
  ctx.box(w - 0.06, plinthH, bodyD - 0.06, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, centerZ - 0.02, {
    roughness: 0.88,
  });

  // Main corner carcass
  ctx.box(w - 0.02, bodyH, bodyD, ctx.primary, 0, bodyY, centerZ);

  const frameShade = ctx.shade(ctx.primary, 0.04);
  const panelShade = ctx.shade(ctx.primary, -0.09);
  const frontZ = centerZ + bodyD / 2;

  // Front shaker door (+Z) + top drawer
  const drawerH = 0.15;
  const drawerY = FLOOR_BASE_Y + plinthH + bodyH - drawerH / 2 - 0.025;
  const doorH = bodyH - drawerH - 0.075;
  const doorY = FLOOR_BASE_Y + plinthH + doorH / 2 + 0.022;

  ctx.box(0.84, drawerH, 0.022, frameShade, 0, drawerY, frontZ + 0.008);
  ctx.box(0.14, 0.018, 0.024, BRASS, 0, drawerY, frontZ + 0.026, { metalness: 0.72, roughness: 0.3 });

  ctx.box(0.84, doorH, 0.022, frameShade, 0, doorY, frontZ + 0.008);
  ctx.box(0.72, doorH - 0.10, 0.010, panelShade, 0, doorY, frontZ + 0.021);
  ctx.cyl(0.016, 0.016, 0.026, 8, BRASS, 0.30, doorY + doorH * 0.28, frontZ + 0.032, {
    rotX: Math.PI / 2,
    metalness: 0.72,
    roughness: 0.3,
  });

  // Subtle decorative side panel on +X so corner reads cleanly from right
  ctx.box(0.02, bodyH - 0.08, bodyD - 0.12, panelShade, (w - 0.02) / 2 + 0.005, bodyY, centerZ);

  // Overhanging countertop flush at exact surfaceHeight
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, centerZ + 0.01, {
    roughness: 0.52,
  });

  // L-shaped corner backsplash along back (-Z) and left (-X), meeting cleanly without corner overlap
  const splashColor = ctx.shade(ctx.accent, -0.05);
  const backSplashZ = centerZ - topD / 2 + 0.028;
  ctx.box(w, 0.072, 0.036, splashColor, 0, surfaceY + 0.036, backSplashZ, {
    roughness: 0.56,
  });
  const sideSplashStartZ = backSplashZ + 0.018;
  const sideSplashEndZ = centerZ + 0.01 + topD / 2 - 0.01;
  const sideSplashD = sideSplashEndZ - sideSplashStartZ;
  ctx.box(
    0.036,
    0.072,
    sideSplashD,
    splashColor,
    -w / 2 + 0.018,
    surfaceY + 0.036,
    (sideSplashStartZ + sideSplashEndZ) / 2,
    { roughness: 0.56 },
  );
}

/** 3. kitchen_island (2x1, surfaceHeight 0.92) */
function buildKitchenIsland(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.92;
  const topH = 0.064;
  const legH = 0.10;
  const bodyBottom = FLOOR_BASE_Y + legH;
  const bodyTop = surfaceY - topH;
  const bodyH = bodyTop - bodyBottom;
  const bodyW = 1.72;
  const bodyD = 0.66;
  const bodyZ = -0.06;

  // 4 chunky corner block feet + bottom plinth skirt
  for (const sx of [-bodyW / 2 + 0.07, bodyW / 2 - 0.07]) {
    for (const sz of [bodyZ - bodyD / 2 + 0.07, bodyZ + bodyD / 2 - 0.07]) {
      ctx.box(0.09, legH, 0.09, ctx.shade(ctx.primary, -0.14), sx, FLOOR_BASE_Y + legH / 2, sz);
    }
  }

  // Left half: closed paneled cabinet; Right half: open display shelf cubby!
  const leftW = bodyW * 0.52;
  const rightW = bodyW - leftW;
  const leftX = -bodyW / 2 + leftW / 2;
  const rightX = bodyW / 2 - rightW / 2;

  ctx.box(leftW, bodyH, bodyD, ctx.primary, leftX, bodyBottom + bodyH / 2, bodyZ);
  // Paneled shaker doors on front (+Z) of closed cabinet
  const panelShade = ctx.shade(ctx.primary, -0.1);
  for (const dx of [-0.21, 0.21]) {
    ctx.box(0.38, bodyH - 0.10, 0.022, ctx.shade(ctx.primary, 0.04), leftX + dx, bodyBottom + bodyH / 2, bodyZ + bodyD / 2 + 0.008);
    ctx.box(0.30, bodyH - 0.18, 0.010, panelShade, leftX + dx, bodyBottom + bodyH / 2, bodyZ + bodyD / 2 + 0.021);
    ctx.cyl(0.014, 0.014, 0.026, 8, BRASS, leftX + dx + (dx < 0 ? 0.13 : -0.13), bodyBottom + bodyH * 0.72, bodyZ + bodyD / 2 + 0.031, {
      rotX: Math.PI / 2,
      metalness: 0.72,
      roughness: 0.3,
    });
  }

  // Right half: open shelf framework with non-overlapping end/back panels & inset shelves
  const shelfT = 0.04;
  const endW = 0.05;
  const innerShelfW = rightW - endW;
  const innerShelfX = rightX - endW / 2;
  const backT = 0.04;
  const innerShelfD = bodyD - backT;
  const innerShelfZ = bodyZ + backT / 2;
  ctx.box(endW, bodyH, bodyD, ctx.primary, bodyW / 2 - endW / 2, bodyBottom + bodyH / 2, bodyZ);
  ctx.box(
    innerShelfW,
    bodyH,
    backT,
    ctx.shade(ctx.primary, -0.06),
    innerShelfX,
    bodyBottom + bodyH / 2,
    bodyZ - bodyD / 2 + backT / 2,
  );
  ctx.box(innerShelfW, shelfT, innerShelfD, ctx.primary, innerShelfX, bodyBottom + shelfT / 2, innerShelfZ);
  ctx.box(innerShelfW, shelfT, innerShelfD - 0.03, ctx.primary, innerShelfX, bodyBottom + bodyH * 0.50, innerShelfZ - 0.015);
  ctx.box(innerShelfW, 0.10, innerShelfD, ctx.primary, innerShelfX, bodyTop - 0.05, innerShelfZ);

  // Stocked open shelves: stacked ceramic bowls (lower) & pastel cookbooks (upper)
  const lowerShelfTop = bodyBottom + shelfT;
  ctx.cyl(0.11, 0.07, 0.06, 10, PORCELAIN, rightX - 0.16, lowerShelfTop + 0.03, bodyZ + 0.06, { roughness: 0.38 });
  ctx.cyl(0.095, 0.065, 0.052, 10, '#E9B9A6', rightX - 0.16, lowerShelfTop + 0.082, bodyZ + 0.06, { roughness: 0.42 });
  ctx.cyl(0.10, 0.09, 0.16, 10, '#BDD5C4', rightX + 0.16, lowerShelfTop + 0.08, bodyZ + 0.04, { roughness: 0.48 });

  const midShelfTop = bodyBottom + bodyH * 0.50 + shelfT / 2;
  const bookColors = ['#DF9887', '#EED492', '#A8C6B6'];
  for (let i = 0; i < 3; i++) {
    ctx.box(0.045, 0.21 - i * 0.014, 0.18, bookColors[i], rightX - 0.22 + i * 0.055, midShelfTop + (0.21 - i * 0.014) / 2, bodyZ + 0.04);
  }
  ctx.box(0.24, 0.045, 0.18, '#E6D6BE', rightX + 0.14, midShelfTop + 0.0225, bodyZ + 0.05);
  ctx.box(0.21, 0.04, 0.16, '#C8B9DC', rightX + 0.14, midShelfTop + 0.065, bodyZ + 0.05);

  // Breakfast-bar overhanging butcher-block countertop flush at exact surfaceHeight
  ctx.box(1.94, topH, 0.92, ctx.accent, 0, surfaceY - topH / 2, 0.01, {
    roughness: 0.55,
  });

  // Two wooden corbel brackets supporting the +Z breakfast-bar overhang (clear of shaker doors)
  for (const bx of [-0.66, 0.66]) {
    ctx.box(0.06, 0.14, 0.125, ctx.shade(ctx.primary, -0.08), bx, bodyTop - 0.07, bodyZ + bodyD / 2 + 0.095);
  }

  // Brass side towel bar with 2 mounting brackets + draped linen tea towel on +X end
  const barX = bodyW / 2 + 0.045;
  const barY = bodyTop - 0.10;
  for (const bz of [bodyZ - 0.16, bodyZ + 0.16]) {
    ctx.box(0.052, 0.018, 0.018, BRASS, bodyW / 2 + 0.022, barY, bz, {
      metalness: 0.75,
      roughness: 0.28,
    });
  }
  ctx.cyl(0.012, 0.012, 0.40, 8, BRASS, barX, barY, bodyZ, {
    rotX: Math.PI / 2,
    metalness: 0.75,
    roughness: 0.28,
  });
  ctx.box(0.026, 0.24, 0.20, '#F5EFE4', barX + 0.006, barY - 0.115, bodyZ + 0.02, { roughness: 0.9 });
  ctx.box(0.034, 0.032, 0.212, '#DF9E8D', barX + 0.006, barY - 0.195, bodyZ + 0.02, { roughness: 0.9 });
}

/** 4. fridge_tall (1x1, h 1.90, toggle: open fridge) */
function buildFridgeTall(ctx: ModelContext): void {
  const feetH = 0.055;
  const bodyW = 0.80;
  const bodyD = 0.72;
  const bodyH = 1.68;
  const bodyBottom = FLOOR_BASE_Y + feetH;
  const bodyY = bodyBottom + bodyH / 2;
  const bodyZ = -0.03;

  // 4 short rubber/chrome feet
  ctx.legs(bodyW - 0.06, bodyD - 0.06, feetH, 0.035, DARK_IRON, FLOOR_BASE_Y, 0.07);

  // Main retro fridge shell
  ctx.box(bodyW, bodyH, bodyD, ctx.primary, 0, bodyY, bodyZ, { roughness: 0.38 });

  // Sculpted rounded retro SMEG crown cap (2 stepped beveled tiers)
  const capBaseY = bodyBottom + bodyH;
  ctx.box(bodyW - 0.04, 0.075, bodyD - 0.04, ctx.shade(ctx.primary, 0.04), 0, capBaseY + 0.0375, bodyZ, {
    roughness: 0.36,
  });
  ctx.box(bodyW - 0.14, 0.055, bodyD - 0.14, ctx.shade(ctx.primary, 0.08), 0, capBaseY + 0.10, bodyZ, {
    roughness: 0.34,
  });

  // Lower freezer door (always closed, recessed gasket + horizontal chrome handle)
  const frontZ = bodyZ + bodyD / 2;
  const freezerH = 0.56;
  const freezerY = bodyBottom + freezerH / 2 + 0.02;
  ctx.box(bodyW - 0.04, freezerH, 0.02, '#4A4947', 0, freezerY, frontZ + 0.008);
  ctx.box(bodyW - 0.02, freezerH - 0.015, 0.055, ctx.shade(ctx.primary, 0.02), 0, freezerY, frontZ + 0.036, {
    roughness: 0.35,
  });
  // Freezer chrome horizontal bar handle (brackets inset in height so zero coplanar faces)
  ctx.box(0.32, 0.024, 0.026, CHROME, 0, freezerY + freezerH * 0.32, frontZ + 0.084, {
    metalness: 0.82,
    roughness: 0.2,
  });
  for (const hx of [-0.13, 0.13]) {
    ctx.box(0.022, 0.014, 0.022, CHROME, hx, freezerY + freezerH * 0.32, frontZ + 0.062, {
      metalness: 0.82,
      roughness: 0.2,
    });
  }

  // Upper main fridge door (pivots open slightly when isActive to reveal warm glowing shelves!)
  const upperH = 1.04;
  const upperY = bodyBottom + freezerH + 0.06 + upperH / 2;

  if (ctx.isActive) {
    // Glowing warm fridge interior backing proud of solid shell + 2 shelves + milk & pastel jars
    ctx.box(bodyW - 0.10, upperH - 0.08, 0.014, '#FFF7DF', 0, upperY, frontZ + 0.006, {
      emissive: '#FFE8AD',
      emissiveIntensity: 0.85,
      roughness: 0.5,
      castShadow: false,
    });
    const shelf1Y = upperY - 0.22;
    const shelf2Y = upperY + 0.12;
    for (const sy of [shelf1Y, shelf2Y]) {
      ctx.box(bodyW - 0.16, 0.02, 0.10, GLASS_TINT, 0, sy, frontZ + 0.064, { opacity: 0.72 });
    }
    ctx.box(0.10, 0.21, 0.08, '#A9CCE3', -0.14, shelf1Y + 0.115, frontZ + 0.062);
    ctx.cyl(0.048, 0.048, 0.14, 8, '#EFA89B', 0.12, shelf1Y + 0.08, frontZ + 0.062);
    ctx.cyl(0.052, 0.052, 0.15, 8, '#B8DCBF', -0.04, shelf2Y + 0.085, frontZ + 0.062);
  }

  const doorPivot = new THREE.Group();
  doorPivot.position.set(-bodyW / 2 + 0.01, upperY, frontZ + 0.02);
  doorPivot.rotation.y = ctx.isActive ? -0.62 : 0;
  ctx.group.add(doorPivot);

  const doorCX = bodyW / 2 - 0.01;
  ctx.box(bodyW - 0.04, upperH, 0.02, '#4A4947', doorCX, 0, -0.01, { parent: doorPivot });
  ctx.box(bodyW - 0.02, upperH - 0.015, 0.055, ctx.shade(ctx.primary, 0.02), doorCX, 0, 0.016, {
    parent: doorPivot,
    roughness: 0.35,
  });

  // Retro chrome upper horizontal handle + classic badge strip
  ctx.box(0.32, 0.024, 0.026, CHROME, doorCX, -upperH * 0.34, 0.064, {
    parent: doorPivot,
    metalness: 0.82,
    roughness: 0.2,
  });
  for (const hx of [-0.13, 0.13]) {
    ctx.box(0.022, 0.014, 0.022, CHROME, doorCX + hx, -upperH * 0.34, 0.044, {
      parent: doorPivot,
      metalness: 0.82,
      roughness: 0.2,
    });
  }
  ctx.box(0.20, 0.026, 0.012, CHROME, doorCX, upperH * 0.28, 0.048, {
    parent: doorPivot,
    metalness: 0.85,
    roughness: 0.18,
  });

  // Cute pastel sticky note + round fridge magnet on door
  ctx.box(0.11, 0.11, 0.008, '#F6E299', doorCX - 0.18, upperH * 0.04, 0.046, {
    parent: doorPivot,
    rotZ: 0.08,
    roughness: 0.9,
  });
  ctx.cyl(0.018, 0.018, 0.014, 8, '#E07F77', doorCX - 0.18, upperH * 0.08, 0.052, {
    parent: doorPivot,
    rotX: Math.PI / 2,
  });
}

/** 5. fridge_retro (1x1, surfaceHeight 0.88, toggle: chill drinks) */
function buildFridgeRetro(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.88;
  const feetH = 0.05;
  const bodyW = 0.74;
  const bodyD = 0.68;
  const capH = 0.045;
  const bodyH = surfaceY - FLOOR_BASE_Y - feetH - capH;
  const bodyBottom = FLOOR_BASE_Y + feetH;
  const bodyY = bodyBottom + bodyH / 2;
  const bodyZ = -0.02;

  // 4 short chrome feet
  ctx.legs(bodyW - 0.06, bodyD - 0.06, feetH, 0.032, CHROME, FLOOR_BASE_Y, 0.06);

  // Compact glossy retro shell
  ctx.box(bodyW, bodyH, bodyD, ctx.primary, 0, bodyY, bodyZ, { roughness: 0.34 });

  // Rounded beveled top deck flush at exact surfaceHeight (flat top supports items!)
  ctx.box(bodyW - 0.05, capH, bodyD - 0.05, ctx.shade(ctx.primary, 0.06), 0, surfaceY - capH / 2, bodyZ, {
    roughness: 0.34,
  });

  // Front recessed seal + chunky rounded door
  const frontZ = bodyZ + bodyD / 2;
  if (ctx.isActive) {
    // Cool frosty interior backing proud of shell + glass shelf + 2 chilled cans standing on it
    ctx.box(bodyW - 0.10, bodyH - 0.10, 0.014, '#D6F3FF', 0, bodyY, frontZ + 0.006, {
      emissive: '#9EE2FF',
      emissiveIntensity: 0.85,
      castShadow: false,
    });
    const miniShelfY = bodyY - 0.18;
    ctx.box(bodyW - 0.16, 0.018, 0.095, GLASS_TINT, 0, miniShelfY, frontZ + 0.062, { opacity: 0.72 });
    ctx.cyl(0.042, 0.042, 0.14, 8, '#F2A39A', -0.10, miniShelfY + 0.079, frontZ + 0.06);
    ctx.cyl(0.042, 0.042, 0.14, 8, '#A9DFC8', 0.08, miniShelfY + 0.079, frontZ + 0.06);
  }

  const doorPivot = new THREE.Group();
  doorPivot.position.set(bodyW / 2 - 0.02, bodyY, frontZ + 0.02);
  doorPivot.rotation.y = ctx.isActive ? 0.45 : 0;
  ctx.group.add(doorPivot);

  const doorCX = -(bodyW / 2 - 0.02);
  ctx.box(bodyW - 0.04, bodyH - 0.04, 0.02, '#4A4947', doorCX, 0, -0.01, { parent: doorPivot });
  ctx.box(bodyW - 0.02, bodyH - 0.05, 0.056, ctx.shade(ctx.primary, 0.03), doorCX, 0, 0.018, {
    parent: doorPivot,
    roughness: 0.32,
  });

  // Iconic vertical chrome retro handle on left side + horizontal chrome crest
  ctx.box(0.024, 0.28, 0.026, CHROME, doorCX - bodyW * 0.34, 0.05, 0.068, {
    parent: doorPivot,
    metalness: 0.85,
    roughness: 0.18,
  });
  for (const hy of [-0.11, 0.11]) {
    ctx.box(0.014, 0.022, 0.022, CHROME, doorCX - bodyW * 0.34, 0.05 + hy, 0.048, {
      parent: doorPivot,
      metalness: 0.85,
      roughness: 0.18,
    });
  }
  ctx.box(0.22, 0.026, 0.014, CHROME, doorCX + 0.04, bodyH * 0.28, 0.05, {
    parent: doorPivot,
    metalness: 0.85,
    roughness: 0.18,
  });

  // Cool chill indicator LED on upper right bezel
  ctx.sphere(0.016, 6, ctx.isActive ? '#8AE8FF' : '#9CA4AA', doorCX + bodyW * 0.34, bodyH * 0.34, 0.052, {
    parent: doorPivot,
    emissive: ctx.isActive ? '#63DCFF' : undefined,
    emissiveIntensity: ctx.isActive ? 1.3 : 0,
    castShadow: false,
  });
}

/** 6. stove_oven (1x1, surfaceHeight 0.90, toggle: simmer pot) */
function buildStoveOven(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.9;
  const plinthH = 0.08;
  const cooktopH = 0.034;
  const bodyH = surfaceY - FLOOR_BASE_Y - plinthH - cooktopH;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyY = bodyBottom + bodyH / 2;
  const w = 0.96;
  const d = 0.84;
  const centerZ = -0.01;

  // Plinth base
  ctx.box(w - 0.04, plinthH, d - 0.06, DARK_IRON, 0, FLOOR_BASE_Y + plinthH / 2, centerZ - 0.02);

  // Main enamel range body
  ctx.box(w, bodyH, d, ctx.primary, 0, bodyY, centerZ, { roughness: 0.45 });

  // Cooktop deck flush at exact surfaceHeight
  ctx.box(w, cooktopH, d + 0.02, '#4A4D52', 0, surfaceY - cooktopH / 2, centerZ + 0.005, {
    roughness: 0.55,
    metalness: 0.25,
  });

  // 4 circular stove burners (glow warm ember orange when isActive!)
  const burnerCoords: [number, number, number][] = [
    [-0.22, -0.17, 0.125],
    [0.22, -0.17, 0.105],
    [-0.22, 0.17, 0.105],
    [0.22, 0.17, 0.13],
  ];
  for (const [bx, bz, br] of burnerCoords) {
    // Dark cast-iron outer burner ring
    ctx.torus(br, 0.014, 6, 12, '#2B2D31', bx, surfaceY + 0.006, centerZ + bz, {
      rotX: Math.PI / 2,
      roughness: 0.65,
      metalness: 0.35,
    });
    // Inner glowing coil disc
    ctx.cyl(
      br * 0.72,
      br * 0.72,
      0.01,
      10,
      ctx.isActive ? '#FF8742' : '#32353A',
      bx,
      surfaceY + 0.005,
      centerZ + bz,
      {
        emissive: ctx.isActive ? '#FF5A14' : undefined,
        emissiveIntensity: ctx.isActive ? 1.25 : 0,
        roughness: 0.5,
      },
    );
  }

  // Rear raised control backsplash panel (-Z) with 5 knobs & tiny center clock
  const backZ = centerZ - d / 2 + 0.045;
  ctx.box(w, 0.14, 0.08, ctx.primary, 0, surfaceY + 0.07, backZ, { roughness: 0.45 });
  ctx.box(w - 0.04, 0.032, 0.094, ctx.accent, 0, surfaceY + 0.156, backZ, { roughness: 0.4 });
  for (const kx of [-0.34, -0.20, 0.20, 0.34]) {
    ctx.cyl(0.028, 0.032, 0.032, 8, DARK_IRON, kx, surfaceY + 0.072, backZ + 0.045, {
      rotX: Math.PI / 2,
      metalness: 0.4,
      roughness: 0.4,
    });
  }
  // Center retro oven timer clock
  ctx.cyl(0.042, 0.042, 0.018, 10, PORCELAIN, 0, surfaceY + 0.072, backZ + 0.042, {
    rotX: Math.PI / 2,
    emissive: ctx.isActive ? '#FFE5A3' : undefined,
    emissiveIntensity: ctx.isActive ? 0.55 : 0,
  });

  // Front oven door (+Z) with window, chrome handle & lower warming drawer
  const frontZ = centerZ + d / 2;
  const ovenY = bodyBottom + bodyH * 0.58;
  const ovenH = bodyH * 0.58;
  ctx.box(w - 0.08, ovenH, 0.03, ctx.shade(ctx.primary, 0.05), 0, ovenY, frontZ + 0.015, {
    roughness: 0.42,
  });
  // Oven glass window (glows warm golden-amber inside when isActive!)
  ctx.box(
    w - 0.26,
    ovenH - 0.14,
    0.018,
    ctx.isActive ? '#FFB55E' : '#2C3138',
    0,
    ovenY - 0.015,
    frontZ + 0.028,
    {
      roughness: 0.18,
      metalness: 0.2,
      emissive: ctx.isActive ? '#FF8B2E' : undefined,
      emissiveIntensity: ctx.isActive ? 0.95 : 0,
    },
  );
  // Tubular chrome oven door handle
  ctx.cyl(0.014, 0.014, w - 0.26, 8, CHROME, 0, ovenY + ovenH * 0.38, frontZ + 0.068, {
    rotZ: Math.PI / 2,
    metalness: 0.82,
    roughness: 0.2,
  });
  for (const sx of [-0.30, 0.30]) {
    ctx.box(0.022, 0.022, 0.04, CHROME, sx, ovenY + ovenH * 0.38, frontZ + 0.045, {
      metalness: 0.82,
      roughness: 0.2,
    });
  }

  // Lower broiler/storage drawer
  const drawerY = bodyBottom + bodyH * 0.13;
  ctx.box(w - 0.08, bodyH * 0.20, 0.026, ctx.shade(ctx.primary, -0.05), 0, drawerY, frontZ + 0.013);
  ctx.box(0.24, 0.018, 0.022, CHROME, 0, drawerY + 0.02, frontZ + 0.032, {
    metalness: 0.8,
    roughness: 0.22,
  });

  if (ctx.isActive) {
    addSteamPuffs(ctx, 0.22, surfaceY + 0.02, centerZ + 0.17);
  }
}

/** 7. kitchen_sink (1x1, h 0.90, toggle: run tap) */
function buildKitchenSink(ctx: ModelContext): void {
  const topY = 0.90;
  const plinthH = 0.085;
  const topH = 0.056;
  const bodyH = topY - FLOOR_BASE_Y - plinthH - topH;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const w = 0.98;
  const bodyD = 0.80;
  const topD = 0.88;
  const centerZ = -0.01;
  const frontZ = centerZ + bodyD / 2;

  // Toe-kick plinth
  ctx.box(w - 0.04, plinthH, bodyD - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, centerZ - 0.03);

  // Lower cabinet base (below farmhouse apron basin)
  const lowerCabH = bodyH - 0.18;
  ctx.box(w - 0.02, lowerCabH, bodyD, ctx.primary, 0, bodyBottom + lowerCabH / 2, centerZ);
  // Double under-sink cabinet doors + brass knobs
  const doorH = lowerCabH - 0.06;
  const doorY = bodyBottom + lowerCabH / 2;
  for (const sx of [-0.22, 0.22]) {
    ctx.box(0.41, doorH, 0.022, ctx.shade(ctx.primary, 0.04), sx, doorY, frontZ + 0.008);
    ctx.box(0.32, doorH - 0.09, 0.010, ctx.shade(ctx.primary, -0.09), sx, doorY, frontZ + 0.021);
    ctx.cyl(0.014, 0.014, 0.024, 8, BRASS, sx > 0 ? 0.08 : -0.08, doorY + doorH * 0.30, frontZ + 0.031, {
      rotX: Math.PI / 2,
      metalness: 0.72,
      roughness: 0.3,
    });
  }

  // Side countertop piers flanking the recessed farmhouse basin
  const basinW = 0.64;
  const sideW = (w - basinW) / 2;
  const basinTopY = topY - 0.006;
  const basinFloorY = bodyBottom + lowerCabH + 0.004;
  const basinH = basinTopY - basinFloorY;

  // Left & right upper cabinet + countertop surrounds
  for (const sx of [-(basinW / 2 + sideW / 2), basinW / 2 + sideW / 2]) {
    ctx.box(sideW, 0.18, bodyD, ctx.primary, sx, bodyBottom + lowerCabH + 0.09, centerZ);
    ctx.box(sideW, topH, topD, ctx.accent, sx, topY - topH / 2, centerZ + 0.01, { roughness: 0.52 });
  }
  // Rear countertop deck behind basin (supports faucet, cleanly clear of basin back)
  ctx.box(basinW - 0.008, 0.18 + topH, 0.22, ctx.accent, 0, topY - (0.18 + topH) / 2, centerZ - topD / 2 + 0.12, {
    roughness: 0.52,
  });

  // Porcelain apron-front farmhouse basin (strictly non-overlapping walls & floor!)
  const basinZ = centerZ + 0.09;
  const basinD = 0.56;
  const wallT = 0.038;
  // Iconic proud white ceramic apron front (+Z)
  ctx.box(basinW + 0.016, basinH, 0.048, PORCELAIN, 0, basinFloorY + basinH / 2, basinZ + basinD / 2, {
    roughness: 0.24,
  });
  // Basin bottom floor tucked strictly inside porcelain walls (zero overlap)
  ctx.box(basinW - wallT * 2 - 0.012, 0.036, basinD - 0.096, '#ECE7DD', 0, basinFloorY + 0.018, basinZ - 0.004, {
    roughness: 0.28,
  });
  // Back porcelain wall
  ctx.box(basinW - 0.012, basinH, wallT, PORCELAIN, 0, basinFloorY + basinH / 2, basinZ - basinD / 2 + wallT / 2, {
    roughness: 0.24,
  });
  // Left & right inner porcelain walls strictly between front apron & back wall
  const innerSideD = basinD - 0.048 - wallT - 0.004;
  for (const sx of [-basinW / 2 + wallT / 2 + 0.006, basinW / 2 - wallT / 2 - 0.006]) {
    ctx.box(wallT, basinH - 0.004, innerSideD, PORCELAIN, sx, basinFloorY + basinH / 2, basinZ - 0.004, {
      roughness: 0.24,
    });
  }
  // Metallic drain ring in basin center
  ctx.cyl(0.042, 0.042, 0.008, 10, CHROME, 0, basinFloorY + 0.042, basinZ, {
    metalness: 0.8,
    roughness: 0.25,
  });

  // Curved gooseneck metallic faucet (true 180° semicircular arch!) + dual lever tap handles
  const faucetZ = centerZ - 0.26;
  ctx.cyl(0.03, 0.036, 0.025, 8, CHROME, 0, topY + 0.012, faucetZ, { metalness: 0.82, roughness: 0.2 });
  ctx.cyl(0.016, 0.018, 0.22, 8, CHROME, 0, topY + 0.12, faucetZ, { metalness: 0.82, roughness: 0.2 });
  const archMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.015, 6, 12, Math.PI),
    ctx.mat(CHROME, { metalness: 0.82, roughness: 0.2 }),
  );
  archMesh.position.set(0, topY + 0.23, faucetZ + 0.085);
  archMesh.rotation.y = Math.PI / 2;
  archMesh.castShadow = !ctx.isGhost;
  archMesh.receiveShadow = !ctx.isGhost;
  ctx.group.add(archMesh);
  ctx.cyl(0.015, 0.018, 0.055, 8, CHROME, 0, topY + 0.205, faucetZ + 0.17, {
    metalness: 0.82,
    roughness: 0.2,
  });
  // Dual tap handles
  for (const hx of [-0.11, 0.11]) {
    ctx.cyl(0.018, 0.022, 0.048, 8, BRASS, hx, topY + 0.024, faucetZ + 0.01, {
      metalness: 0.75,
      roughness: 0.26,
    });
    ctx.box(0.055, 0.014, 0.014, BRASS, hx + (hx > 0 ? 0.022 : -0.022), topY + 0.050, faucetZ + 0.01, {
      metalness: 0.75,
      roughness: 0.26,
    });
  }
  // Tiny pastel hand soap dispenser on corner ledge
  ctx.cyl(0.032, 0.036, 0.10, 8, '#B8D8C8', 0.34, topY + 0.05, faucetZ + 0.03, { roughness: 0.38 });
  ctx.cyl(0.01, 0.01, 0.03, 6, CHROME, 0.34, topY + 0.115, faucetZ + 0.03, { metalness: 0.75 });
  ctx.box(0.012, 0.01, 0.034, CHROME, 0.34, topY + 0.128, faucetZ + 0.044, { metalness: 0.75 });

  // Running water stream + basin splash ripple when active!
  if (ctx.isActive) {
    const streamTop = topY + 0.18;
    const streamBot = basinFloorY + 0.05;
    const streamH = streamTop - streamBot;
    ctx.cyl(0.014, 0.02, streamH, 8, '#9BE0F5', 0, streamBot + streamH / 2, faucetZ + 0.17, {
      opacity: 0.68,
      roughness: 0.12,
      emissive: '#7FD6F5',
      emissiveIntensity: 0.25,
      castShadow: false,
    });
    ctx.cyl(0.08, 0.08, 0.012, 10, '#C2EEFA', 0, basinFloorY + 0.05, faucetZ + 0.17, {
      opacity: 0.55,
      roughness: 0.15,
      castShadow: false,
    });
  }
}

/** 8. microwave_oven (1x1, surface, h 0.36, toggle: warm snack) */
function buildMicrowaveOven(ctx: ModelContext): void {
  const feetH = 0.018;
  const w = 0.58;
  const h = 0.33;
  const d = 0.38;
  const bodyY = feetH + h / 2;

  // 4 little rubber feet at local y = 0
  ctx.legs(w - 0.06, d - 0.06, feetH, 0.02, DARK_IRON, 0, 0.04);

  // Retro pastel outer casing
  ctx.box(w, h, d, ctx.primary, 0, bodyY, 0, { roughness: 0.42 });
  // Subtle rounded top cap highlight
  ctx.box(w - 0.04, 0.016, d - 0.04, ctx.shade(ctx.primary, 0.06), 0, feetH + h + 0.008, 0, {
    roughness: 0.4,
  });

  const frontZ = d / 2;
  // Left door assembly
  const doorW = 0.38;
  const doorX = -0.075;
  ctx.box(doorW, h - 0.04, 0.024, ctx.accent, doorX, bodyY, frontZ + 0.01, { roughness: 0.45 });

  // Window pane (glows warm golden amber when active!)
  ctx.box(
    doorW - 0.07,
    h - 0.11,
    0.016,
    ctx.isActive ? '#FFCA72' : '#313A42',
    doorX - 0.01,
    bodyY,
    frontZ + 0.02,
    {
      roughness: 0.18,
      metalness: 0.18,
      emissive: ctx.isActive ? '#FF9D38' : undefined,
      emissiveIntensity: ctx.isActive ? 0.95 : 0,
    },
  );
  // Subtle snack bowl silhouette visible inside when warm
  if (ctx.isActive) {
    ctx.cyl(0.055, 0.04, 0.048, 8, '#F5EFE4', doorX - 0.01, bodyY - 0.05, frontZ + 0.026, {
      emissive: '#FFE0A6',
      emissiveIntensity: 0.4,
      castShadow: false,
    });
  }

  // Curved chrome vertical door handle
  ctx.cyl(0.011, 0.011, h - 0.13, 8, CHROME, doorX + doorW / 2 - 0.016, bodyY, frontZ + 0.044, {
    metalness: 0.85,
    roughness: 0.18,
  });
  for (const hy of [-0.075, 0.075]) {
    ctx.box(0.016, 0.016, 0.024, CHROME, doorX + doorW / 2 - 0.016, bodyY + hy, frontZ + 0.032, {
      metalness: 0.85,
      roughness: 0.18,
    });
  }

  // Right control column: digital clock + 2 retro dials + push-open bar
  const ctrlX = 0.205;
  ctx.box(0.125, h - 0.04, 0.018, ctx.shade(ctx.primary, -0.07), ctrlX, bodyY, frontZ + 0.008);
  // Clock screen
  ctx.box(0.095, 0.046, 0.014, '#24302C', ctrlX, bodyY + 0.088, frontZ + 0.018, {
    emissive: ctx.isActive ? '#74E8B6' : '#3C6E5B',
    emissiveIntensity: ctx.isActive ? 1.15 : 0.22,
  });
  // Two rotary timer/power dials
  for (const dy of [0.015, -0.052]) {
    ctx.cyl(0.024, 0.028, 0.022, 8, CHROME, ctrlX, bodyY + dy, frontZ + 0.024, {
      rotX: Math.PI / 2,
      metalness: 0.72,
      roughness: 0.26,
    });
  }
  // Bottom release button
  ctx.box(0.082, 0.032, 0.02, ctx.accent, ctrlX, bodyY - 0.112, frontZ + 0.02);
}

/** 9. dishwasher_unit (1x1, surfaceHeight 0.90, toggle: start wash) */
function buildDishwasherUnit(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.9;
  const plinthH = 0.085;
  const topH = 0.056;
  const bodyH = surfaceY - FLOOR_BASE_Y - plinthH - topH;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyY = bodyBottom + bodyH / 2;
  const w = 0.98;
  const bodyD = 0.80;
  const topD = 0.88;
  const centerZ = -0.01;
  const frontZ = centerZ + bodyD / 2;

  // Toe-kick plinth
  ctx.box(w - 0.04, plinthH, bodyD - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, centerZ - 0.03);

  // Main appliance carcass
  ctx.box(w - 0.02, bodyH, bodyD, ctx.shade(ctx.primary, -0.06), 0, bodyY, centerZ, { roughness: 0.45 });

  // Lower sleek front door panel
  const fasciaH = 0.13;
  const doorH = bodyH - fasciaH - 0.02;
  const doorY = bodyBottom + doorH / 2 + 0.01;
  ctx.box(w - 0.06, doorH, 0.03, ctx.primary, 0, doorY, frontZ + 0.015, {
    roughness: 0.38,
    metalness: ctx.variant.id === 'silver' ? 0.35 : 0.06,
  });

  // Upper control fascia bar
  const fasciaY = bodyBottom + bodyH - fasciaH / 2 - 0.006;
  ctx.box(w - 0.06, fasciaH, 0.032, ctx.shade(ctx.primary, -0.14), 0, fasciaY, frontZ + 0.016, {
    roughness: 0.4,
  });

  // Recessed grip handle pocket + chrome bar (inset cleanly inside pocket height)
  ctx.box(0.32, 0.048, 0.018, DARK_IRON, -0.10, fasciaY, frontZ + 0.028);
  ctx.box(0.30, 0.016, 0.026, CHROME, -0.10, fasciaY + 0.008, frontZ + 0.040, {
    metalness: 0.82,
    roughness: 0.2,
  });

  // Cycle selector knob + 3 status LEDs (glow lively mint/amber when active!)
  ctx.cyl(0.026, 0.028, 0.024, 8, CHROME, 0.20, fasciaY, frontZ + 0.036, {
    rotX: Math.PI / 2,
    metalness: 0.78,
    roughness: 0.24,
  });
  const ledColors = ['#69E8A2', '#FFD166', '#89D4F5'];
  for (let i = 0; i < 3; i++) {
    const lit = ctx.isActive && i <= 1;
    ctx.sphere(0.013, 6, lit ? ledColors[i] : '#5A6066', 0.30 + i * 0.042, fasciaY, frontZ + 0.034, {
      emissive: lit ? ledColors[i] : undefined,
      emissiveIntensity: lit ? 1.35 : 0,
      castShadow: false,
    });
  }

  // Overhanging countertop flush at exact surfaceHeight + rear backsplash
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, centerZ + 0.01, { roughness: 0.52 });
  ctx.box(w, 0.072, 0.036, ctx.shade(ctx.accent, -0.05), 0, surfaceY + 0.036, centerZ - topD / 2 + 0.028, {
    roughness: 0.56,
  });
}

/** 10. dining_table (2x2, surfaceHeight 0.78) */
function buildDiningTable(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.78;
  const topW = 1.80;
  const topD = 1.54;
  const topH = 0.052;
  const bevelH = 0.02;
  const apronH = 0.078;
  const legTopY = surfaceY - topH - bevelH;
  const legH = legTopY - FLOOR_BASE_Y;

  // Thick beveled solid-wood tabletop flush at exact surfaceHeight
  ctx.box(topW, topH, topD, ctx.primary, 0, surfaceY - topH / 2, 0, { roughness: 0.62 });
  // Under-bevel chamfer slab for refined dining table silhouette
  ctx.box(topW - 0.06, bevelH, topD - 0.06, ctx.shade(ctx.primary, -0.08), 0, surfaceY - topH - bevelH / 2, 0, {
    roughness: 0.68,
  });

  // Recessed structural apron rail frame
  const apronW = topW - 0.24;
  const apronD = topD - 0.24;
  const apronY = legTopY - apronH / 2;
  const apronColor = ctx.shade(ctx.primary, -0.12);
  ctx.box(apronW, apronH, 0.05, apronColor, 0, apronY, apronD / 2 - 0.025);
  ctx.box(apronW, apronH, 0.05, apronColor, 0, apronY, -apronD / 2 + 0.025);
  ctx.box(0.05, apronH, apronD - 0.10, apronColor, -apronW / 2 + 0.025, apronY, 0);
  ctx.box(0.05, apronH, apronD - 0.10, apronColor, apronW / 2 - 0.025, apronY, 0);

  // 4 sturdy tapered legs with brass foot ferrules
  const ox = apronW / 2 - 0.04;
  const oz = apronD / 2 - 0.04;
  const legColor = ctx.shade(ctx.primary, -0.06);
  for (const sx of [-ox, ox]) {
    for (const sz of [-oz, oz]) {
      ctx.cyl(0.046, 0.032, legH - 0.004, 8, legColor, sx, FLOOR_BASE_Y + legH / 2 + 0.002, sz, {
        rotZ: sx > 0 ? 0.04 : -0.04,
        rotX: sz > 0 ? -0.04 : 0.04,
      });
      // Warm brass foot ferrule seated flush on FLOOR_BASE_Y
      ctx.cyl(0.034, 0.031, 0.055, 8, BRASS, sx * 1.015, FLOOR_BASE_Y + 0.0275, sz * 1.015, {
        metalness: 0.72,
        roughness: 0.3,
      });
    }
  }
}

/** 11. dining_chair (1x1, h 0.86, bounce) */
function buildDiningChair(ctx: ModelContext): void {
  const seatY = 0.44;
  const seatW = 0.46;
  const seatD = 0.44;
  const legH = seatY - FLOOR_BASE_Y;
  const frameDark = ctx.shade(ctx.primary, -0.09);

  // 4 subtly splayed tapered legs
  const legPos: [number, number, number, number][] = [
    [-0.18, -0.17, -0.06, 0.05],
    [0.18, -0.17, 0.06, 0.05],
    [-0.18, 0.17, -0.06, -0.06],
    [0.18, 0.17, 0.06, -0.06],
  ];
  for (const [lx, lz, rz, rx] of legPos) {
    ctx.cyl(0.024, 0.017, legH - 0.004, 7, frameDark, lx, FLOOR_BASE_Y + legH / 2 + 0.002, lz, {
      rotZ: rz,
      rotX: rx,
    });
  }

  // H-stretcher rails between legs
  const stretchY = FLOOR_BASE_Y + legH * 0.36;
  ctx.cyl(0.011, 0.011, 0.34, 6, frameDark, -0.18, stretchY, 0, { rotX: Math.PI / 2 });
  ctx.cyl(0.011, 0.011, 0.34, 6, frameDark, 0.18, stretchY, 0, { rotX: Math.PI / 2 });
  ctx.cyl(0.011, 0.011, 0.35, 6, frameDark, 0, stretchY, 0, { rotZ: Math.PI / 2 });

  // Sculpted wooden seat base + plush upholstered seat cushion
  ctx.box(seatW, 0.036, seatD, ctx.primary, 0, seatY, 0.01, { roughness: 0.65 });
  ctx.box(seatW - 0.06, 0.044, seatD - 0.06, ctx.accent, 0, seatY + 0.036, 0.015, { roughness: 0.9 });

  // Slightly raked Windsor spindle backrest (-Z)
  const backTilt = -0.11;
  const backH = 0.41;
  const backBaseY = seatY + 0.01;
  const backZ = -seatD / 2 + 0.04;

  // Outer vertical stiles
  for (const sx of [-0.19, 0.19]) {
    ctx.cyl(0.019, 0.022, backH, 7, ctx.primary, sx, backBaseY + backH / 2, backZ - 0.02, {
      rotX: backTilt,
    });
  }
  // 3 slender central spindles
  for (const sx of [-0.095, 0, 0.095]) {
    ctx.cyl(0.011, 0.012, backH - 0.04, 6, ctx.primary, sx, backBaseY + (backH - 0.03) / 2, backZ - 0.02, {
      rotX: backTilt,
    });
  }
  // Curved/contoured top crest rail
  ctx.box(seatW + 0.01, 0.072, 0.036, ctx.primary, 0, backBaseY + backH - 0.02, backZ - 0.046, {
    rotX: backTilt,
  });
}

/** 12. pantry_shelf (1x1, h 1.85) */
function buildPantryShelf(ctx: ModelContext): void {
  const totalH = 1.70;
  const w = 0.84;
  const d = 0.46;
  const postW = 0.045;
  const baseY = FLOOR_BASE_Y;
  const frameDark = ctx.shade(ctx.primary, -0.09);

  // 4 tall corner posts
  for (const sx of [-w / 2 + postW / 2, w / 2 - postW / 2]) {
    for (const sz of [-d / 2 + postW / 2, d / 2 - postW / 2]) {
      ctx.box(postW, totalH, postW, frameDark, sx, baseY + totalH / 2, sz);
    }
  }

  // Subtle slatted rear back panel strictly between rear corner posts
  ctx.box(w - postW * 2 - 0.004, totalH - 0.08, 0.018, ctx.shade(ctx.primary, 0.08), 0, baseY + totalH / 2, -d / 2 + 0.014);

  // 5 horizontal shelf planks starting cleanly in front of rear panel
  const shelfYs = [baseY + 0.07, baseY + 0.46, baseY + 0.86, baseY + 1.26, baseY + 1.66];
  const shelfT = 0.032;
  for (const sy of shelfYs) {
    ctx.box(w - 0.02, shelfT, d - 0.046, ctx.primary, 0, sy, 0.013);
  }

  // Shelf 1 (bottom): woven rattan basket + tall olive oil bottle
  const s1 = shelfYs[0] + shelfT / 2;
  ctx.box(0.36, 0.22, 0.30, '#CFA675', -0.14, s1 + 0.11, 0.02, { roughness: 0.9 });
  ctx.box(0.37, 0.028, 0.31, '#B88D5E', -0.14, s1 + 0.21, 0.02, { roughness: 0.9 });
  ctx.cyl(0.05, 0.06, 0.24, 8, '#8BA676', 0.20, s1 + 0.12, 0.03, { roughness: 0.35 });
  ctx.cyl(0.02, 0.022, 0.07, 6, '#8BA676', 0.20, s1 + 0.27, 0.03, { roughness: 0.35 });

  // Shelf 2: folded pastel linens + ceramic utensil crock
  const s2 = shelfYs[1] + shelfT / 2;
  const linenColors = ['#F5EFE4', '#EAB7A9', '#B9D7C8'];
  for (let i = 0; i < 3; i++) {
    ctx.box(0.30, 0.056, 0.26, linenColors[i], -0.16, s2 + 0.028 + i * 0.058, 0.02, { roughness: 0.92 });
  }
  ctx.cyl(0.085, 0.075, 0.18, 9, PORCELAIN, 0.18, s2 + 0.09, 0.02, { roughness: 0.38 });
  ctx.box(0.022, 0.10, 0.014, '#C69767', 0.16, s2 + 0.21, 0.02, { rotZ: 0.18 });
  ctx.box(0.022, 0.11, 0.014, '#C69767', 0.21, s2 + 0.215, 0.01, { rotZ: -0.15 });

  // Shelf 3: 3 dry-goods pantry canisters with wooden lids
  const s3 = shelfYs[2] + shelfT / 2;
  const jarSpecs: [number, number, number, string][] = [
    [-0.23, 0.068, 0.22, '#F4ECDD'],
    [0.0, 0.072, 0.26, '#EFC2BC'],
    [0.23, 0.065, 0.19, '#B9D6C6'],
  ];
  for (const [jx, jr, jh, jc] of jarSpecs) {
    ctx.cyl(jr, jr, jh, 9, jc, jx, s3 + jh / 2, 0.02, { roughness: 0.38 });
    ctx.cyl(jr * 1.04, jr * 1.04, 0.026, 9, '#C59A6C', jx, s3 + jh + 0.013, 0.02);
  }

  // Shelf 4: pastel enamel breadbox/tins + ceramic pitcher
  const s4 = shelfYs[3] + shelfT / 2;
  ctx.box(0.32, 0.20, 0.24, '#EED698', -0.16, s4 + 0.10, 0.02, { roughness: 0.42 });
  ctx.cyl(0.065, 0.082, 0.21, 9, ctx.accent, 0.18, s4 + 0.105, 0.02, { roughness: 0.38 });

  // Top cap shelf: decorative bowl + little potted kitchen herb
  const s5 = shelfYs[4] + shelfT / 2;
  ctx.cyl(0.11, 0.065, 0.075, 10, '#E3A490', -0.16, s5 + 0.0375, 0.02, { roughness: 0.42 });
  ctx.cyl(0.068, 0.052, 0.09, 8, '#D7947A', 0.18, s5 + 0.045, 0.02);
  ctx.sphere(0.082, 7, '#8AB586', 0.18, s5 + 0.125, 0.02, { scaleY: 0.85 });
}

/** 13. spice_rack (1x1, wall mounted, h 0.48) */
function buildSpiceRack(ctx: ModelContext): void {
  const w = 0.78;
  const h = 0.44;
  const backD = 0.024;
  const shelfD = 0.135;

  // Wooden backing board flush at z = 0, protruding +Z
  ctx.box(w, h, backD, ctx.shade(ctx.primary, -0.06), 0, 0, backD / 2);

  // Two wooden side cheeks + two horizontal shelves starting strictly in front of backing board
  const frontDepth = shelfD - backD;
  const frontCenterZ = backD + frontDepth / 2;
  for (const sx of [-w / 2 + 0.018, w / 2 - 0.018]) {
    ctx.box(0.032, h - 0.010, frontDepth, ctx.primary, sx, 0, frontCenterZ);
  }
  const lowerY = -0.16;
  const upperY = 0.045;
  for (const sy of [lowerY, upperY]) {
    ctx.box(w - 0.072, 0.024, frontDepth, ctx.primary, 0, sy, frontCenterZ);
    // Slender brass front retainer bar so jars stay tucked in
    ctx.cyl(0.007, 0.007, w - 0.06, 6, BRASS, 0, sy + 0.055, shelfD - 0.012, {
      rotZ: Math.PI / 2,
      metalness: 0.72,
      roughness: 0.28,
    });
  }

  // 5 colorful miniature spice jars on lower shelf with cork stoppers
  const spiceColors = ['#DC7A64', '#E9C36A', '#8AB584', '#F4EFE7', '#A590BE'];
  for (let i = 0; i < 5; i++) {
    const jx = -0.26 + i * 0.13;
    const jh = 0.105 + (i % 2) * 0.015;
    ctx.cyl(0.038, 0.04, jh, 8, spiceColors[i], jx, lowerY + 0.012 + jh / 2, 0.075, {
      roughness: 0.34,
    });
    // Cork stopper
    ctx.cyl(0.028, 0.025, 0.026, 7, '#C49A6A', jx, lowerY + 0.012 + jh + 0.012, 0.075);
  }

  // Upper shelf: 3 cute seasoning tins + mini mortar bowl
  const upperColors = [ctx.accent, '#B7D3C5', '#E8B9B8'];
  for (let i = 0; i < 3; i++) {
    const tx = -0.22 + i * 0.15;
    ctx.box(0.09, 0.11, 0.08, upperColors[i], tx, upperY + 0.012 + 0.055, 0.075, { roughness: 0.45 });
  }
  ctx.cyl(0.05, 0.034, 0.068, 8, PORCELAIN, 0.23, upperY + 0.012 + 0.034, 0.075, { roughness: 0.4 });
}

/** 14. electric_kettle (1x1, surface, h 0.32, toggle: boil water) */
function buildElectricKettle(ctx: ModelContext): void {
  const baseH = 0.032;
  const bodyH = 0.205;
  const bodyBottom = baseH;

  // Slim matte dark heating dock at local y = 0 + recessed contact ring
  ctx.box(0.27, baseH, 0.27, DARK_IRON, 0, baseH / 2, 0, { roughness: 0.65 });
  ctx.cyl(0.118, 0.122, 0.008, 12, '#2C2E32', 0, baseH + 0.003, 0, { roughness: 0.55 });
  // Indicator LED pill on front of dock
  ctx.box(
    0.045,
    0.012,
    0.016,
    ctx.isActive ? '#FF9C42' : '#6A6E74',
    0.075,
    baseH * 0.55,
    0.136,
    {
      emissive: ctx.isActive ? '#FF7B24' : undefined,
      emissiveIntensity: ctx.isActive ? 1.35 : 0,
      castShadow: false,
    },
  );

  // Tapered matte kettle carafe body
  ctx.cyl(0.088, 0.114, bodyH, 12, ctx.primary, 0, bodyBottom + bodyH / 2, 0, {
    roughness: ctx.variant.id === 'copper' ? 0.28 : 0.42,
    metalness: ctx.variant.id === 'copper' ? 0.58 : 0.1,
  });

  // Collar rim + domed lid + wooden/accent lid knob
  const lidY = bodyBottom + bodyH;
  ctx.cyl(0.092, 0.092, 0.014, 12, CHROME, 0, lidY + 0.006, 0, { metalness: 0.78, roughness: 0.25 });
  ctx.cyl(0.062, 0.086, 0.026, 10, ctx.primary, 0, lidY + 0.024, 0, { roughness: 0.42 });
  ctx.cyl(0.024, 0.018, 0.032, 8, ctx.accent, 0, lidY + 0.05, 0, { roughness: 0.6 });

  // Sculpted S-curve gooseneck spout on +X side (3 crisp angled segments)
  const spoutColor = ctx.primary;
  const spoutMatOpts = {
    roughness: ctx.variant.id === 'copper' ? 0.28 : 0.4,
    metalness: ctx.variant.id === 'copper' ? 0.58 : 0.14,
  };
  ctx.cyl(0.013, 0.02, 0.09, 8, spoutColor, 0.125, bodyBottom + 0.055, 0, {
    ...spoutMatOpts,
    rotZ: -1.1,
  });
  ctx.cyl(0.011, 0.013, 0.155, 8, spoutColor, 0.175, bodyBottom + 0.145, 0, {
    ...spoutMatOpts,
    rotZ: -0.22,
  });
  ctx.cyl(0.009, 0.012, 0.062, 8, spoutColor, 0.21, bodyBottom + 0.22, 0, {
    ...spoutMatOpts,
    rotZ: -0.92,
  });

  // Counterbalanced ergonomic handle on -X side
  ctx.box(0.075, 0.022, 0.024, ctx.accent, -0.125, bodyBottom + 0.165, 0);
  ctx.box(0.026, 0.155, 0.028, ctx.accent, -0.155, bodyBottom + 0.098, 0, { rotZ: 0.1 });
  ctx.box(0.055, 0.02, 0.024, ctx.accent, -0.12, bodyBottom + 0.034, 0);

  if (ctx.isActive) {
    addSteamPuffs(ctx, 0.235, bodyBottom + 0.245, 0);
  }
}

/** 15. toaster_pastel (1x1, surface, h 0.28, bounce/active: toast pops up!) */
function buildToasterPastel(ctx: ModelContext): void {
  const feetH = 0.018;
  const bodyW = 0.36;
  const bodyH = 0.195;
  const bodyD = 0.24;
  const bodyY = feetH + bodyH / 2;

  // 4 chrome feet at local y = 0 + polished chrome bottom skirt
  ctx.legs(bodyW - 0.06, bodyD - 0.05, feetH, 0.016, CHROME, 0, 0.035);
  ctx.box(bodyW + 0.01, 0.022, bodyD + 0.01, CHROME, 0, feetH + 0.011, 0, {
    metalness: 0.82,
    roughness: 0.22,
  });

  // Chunky retro rounded-shoulder pastel shell
  ctx.box(bodyW, bodyH - 0.035, bodyD, ctx.primary, 0, bodyY - 0.005, 0, { roughness: 0.36 });
  // Tapered upper shoulder cap
  ctx.box(bodyW - 0.032, 0.044, bodyD - 0.032, ctx.shade(ctx.primary, 0.05), 0, feetH + bodyH - 0.014, 0, {
    roughness: 0.34,
  });

  // Top chrome trim plate + twin dark toast slots
  const topY = feetH + bodyH + 0.008;
  ctx.box(bodyW - 0.07, 0.01, bodyD - 0.065, CHROME, 0, topY, 0, { metalness: 0.82, roughness: 0.2 });

  const slotColor = ctx.isActive ? '#FF8742' : '#2E2B2A';
  const toastPop = ctx.isActive ? 0.088 : 0.038;
  for (const sz of [-0.044, 0.044]) {
    ctx.box(0.24, 0.008, 0.034, slotColor, 0, topY + 0.009, sz, {
      emissive: ctx.isActive ? '#FF5E18' : undefined,
      emissiveIntensity: ctx.isActive ? 1.1 : 0,
    });
    // Toasted golden bread slice (peeks out at rest; pops high when isActive!)
    ctx.box(0.192, 0.104, 0.020, '#DFAA6A', 0, topY - 0.024 + toastPop, sz, { roughness: 0.9 });
    // Crust crown arch cleanly proud of bread slice
    ctx.box(0.204, 0.026, 0.030, '#B57B3E', 0, topY + 0.040 + toastPop, sz, { roughness: 0.88 });
  }

  // Side chrome toast lever & browning knob (+X side)
  const leverY = ctx.isActive ? feetH + bodyH * 0.64 : feetH + bodyH * 0.42;
  ctx.box(0.014, 0.11, 0.022, DARK_IRON, bodyW / 2 + 0.002, bodyY, 0);
  ctx.box(0.044, 0.018, 0.034, CHROME, bodyW / 2 + 0.022, leverY, 0, {
    metalness: 0.84,
    roughness: 0.18,
  });
  ctx.cyl(0.024, 0.026, 0.02, 8, CHROME, bodyW / 2 + 0.01, feetH + 0.06, 0.068, {
    rotZ: Math.PI / 2,
    metalness: 0.8,
    roughness: 0.22,
  });

  // Retro chrome logo pill on front (+Z)
  ctx.box(0.11, 0.02, 0.01, CHROME, 0, bodyY + 0.01, bodyD / 2 + 0.004, {
    metalness: 0.85,
    roughness: 0.2,
  });
}

/** 16. fruit_bowl (1x1, surface, h 0.24) */
function buildFruitBowl(ctx: ModelContext): void {
  // Sculpted ceramic pedestal base at local y = 0
  ctx.cyl(0.072, 0.095, 0.024, 12, ctx.primary, 0, 0.012, 0, { roughness: 0.36 });
  ctx.cyl(0.048, 0.062, 0.042, 10, ctx.shade(ctx.primary, -0.05), 0, 0.045, 0, { roughness: 0.38 });

  // Wide tapered open ceramic bowl + rolled lip torus
  ctx.cyl(0.195, 0.095, 0.095, 14, ctx.primary, 0, 0.112, 0, { roughness: 0.34 });
  ctx.cyl(0.175, 0.088, 0.016, 14, ctx.shade(ctx.primary, -0.14), 0, 0.158, 0, { roughness: 0.45 });
  ctx.torus(0.192, 0.012, 6, 14, ctx.shade(ctx.primary, 0.05), 0, 0.16, 0, {
    rotX: Math.PI / 2,
    roughness: 0.32,
  });

  // Piled pastel low-poly fruits!
  // Rosy apple 1 + stem + leaf
  ctx.sphere(0.056, 8, '#DF7A6F', -0.065, 0.165, 0.045, { roughness: 0.46 });
  ctx.cyl(0.005, 0.006, 0.028, 5, '#6B4C35', -0.065, 0.222, 0.045, { rotZ: 0.18 });
  ctx.box(0.032, 0.008, 0.018, '#87B57C', -0.048, 0.226, 0.045, { rotZ: 0.35 });

  // Sunny orange 1 & 2 (accented warm citrus)
  ctx.sphere(0.055, 8, ctx.accent, 0.065, 0.162, 0.055, { roughness: 0.65 });
  ctx.sphere(0.052, 8, '#F2AE5C', 0.012, 0.168, -0.065, { roughness: 0.65 });

  // Tapered pastel green pear (sphere belly + cone neck)
  ctx.sphere(0.048, 8, '#B8CF7E', 0.072, 0.175, -0.032, { scaleY: 1.05, roughness: 0.55 });
  ctx.cone(0.034, 0.068, 7, '#B8CF7E', 0.08, 0.225, -0.036, { rotZ: -0.22, roughness: 0.55 });

  // Blush peach & sunny banana cluster tucked at left-back
  ctx.sphere(0.050, 8, '#F0B298', -0.075, 0.165, -0.052, { roughness: 0.68 });
  ctx.sphere(0.046, 8, '#F2D674', -0.005, 0.205, 0.01, { scaleX: 1.45, scaleY: 0.68, scaleZ: 0.72, roughness: 0.62 });
}

export const buildKitchenModel: TabModelBuilder = (ctx) => {
  switch (ctx.def.id) {
    case 'kitchen_counter':
      buildKitchenCounter(ctx);
      return true;
    case 'kitchen_counter_corner':
      buildKitchenCounterCorner(ctx);
      return true;
    case 'kitchen_island':
      buildKitchenIsland(ctx);
      return true;
    case 'fridge_tall':
      buildFridgeTall(ctx);
      return true;
    case 'fridge_retro':
      buildFridgeRetro(ctx);
      return true;
    case 'stove_oven':
      buildStoveOven(ctx);
      return true;
    case 'kitchen_sink':
      buildKitchenSink(ctx);
      return true;
    case 'microwave_oven':
      buildMicrowaveOven(ctx);
      return true;
    case 'dishwasher_unit':
      buildDishwasherUnit(ctx);
      return true;
    case 'dining_table':
      buildDiningTable(ctx);
      return true;
    case 'dining_chair':
      buildDiningChair(ctx);
      return true;
    case 'pantry_shelf':
      buildPantryShelf(ctx);
      return true;
    case 'spice_rack':
      buildSpiceRack(ctx);
      return true;
    case 'electric_kettle':
      buildElectricKettle(ctx);
      return true;
    case 'toaster_pastel':
      buildToasterPastel(ctx);
      return true;
    case 'fruit_bowl':
      buildFruitBowl(ctx);
      return true;
    default:
      return false;
  }
};
