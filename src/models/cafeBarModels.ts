import * as THREE from 'three';
import { FLOOR_BASE_Y, type ModelContext, type TabModelBuilder } from './ModelKit';

const BRASS = '#D8B770';
const CHROME = '#DCE2E8';
const DARK_IRON = '#3E4249';
const WALNUT = '#6E513E';
const PORCELAIN = '#FAF6EE';
const GLASS_CLEAR = '#E6F3F8';
const PLINTH_DARK = '#4F4640';

/** Helper: subtle rising translucent steam puffs for active coffee/espresso brewers. */
function addSteamPuffs(ctx: ModelContext, x: number, baseY: number, z: number): void {
  const puffs = [
    { dx: 0, dy: 0.035, dz: 0, r: 0.02, op: 0.55 },
    { dx: 0.015, dy: 0.08, dz: 0.01, r: 0.026, op: 0.4 },
    { dx: -0.01, dy: 0.13, dz: -0.008, r: 0.031, op: 0.25 },
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

/** 1. cafe_counter (2x1, surfaceHeight 0.96) */
function buildCafeCounter(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.96;
  const plinthH = 0.085;
  const topH = 0.062;
  const bodyH = surfaceY - FLOOR_BASE_Y - plinthH - topH;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyY = bodyBottom + bodyH / 2;
  const w = 1.96;
  const bodyD = 0.78;
  const topD = 0.90;

  // Recessed toe-kick plinth
  ctx.box(w - 0.06, plinthH, bodyD - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, -0.02);

  // Main warm wood cabinet carcass
  ctx.box(w - 0.04, bodyH, bodyD, ctx.shade(ctx.primary, -0.1), 0, bodyY, 0);

  // Vertical slatted wood front facade (+Z), inset cleanly from carcass sides
  const frontZ = bodyD / 2;
  const slatCount = 10;
  const slatSpan = w - 0.18;
  for (let i = 0; i < slatCount; i++) {
    const sx = -slatSpan / 2 + (i / (slatCount - 1)) * slatSpan;
    const tone = i % 2 === 0 ? ctx.primary : ctx.shade(ctx.primary, 0.05);
    ctx.box(0.092, bodyH - 0.08, 0.034, tone, sx, bodyY, frontZ + 0.012, { roughness: 0.7 });
  }

  // Top & bottom brushed brass front trim bands seated solidly into carcass and proud of slats
  ctx.box(w - 0.02, 0.026, 0.046, BRASS, 0, bodyBottom + bodyH - 0.02, frontZ + 0.015, {
    metalness: 0.72,
    roughness: 0.28,
  });
  ctx.box(w - 0.02, 0.026, 0.046, BRASS, 0, bodyBottom + 0.02, frontZ + 0.015, {
    metalness: 0.72,
    roughness: 0.28,
  });
  // Small framed menu trim plaque on right front
  ctx.box(0.35, 0.22, 0.024, '#565A62', 0.54, bodyY + 0.08, frontZ + 0.032);
  ctx.box(0.28, 0.018, 0.01, '#F5EFE4', 0.54, bodyY + 0.13, frontZ + 0.044);
  ctx.box(0.22, 0.014, 0.01, '#F0D594', 0.54, bodyY + 0.08, frontZ + 0.044);
  ctx.box(0.26, 0.014, 0.01, '#F5EFE4', 0.54, bodyY + 0.035, frontZ + 0.044);

  // Rear barista shelf nook detail (-Z) so all 4 camera angles look finished
  ctx.box(w - 0.22, 0.032, 0.18, ctx.primary, 0, bodyY - 0.04, -bodyD / 2 - 0.01);
  ctx.cyl(0.045, 0.038, 0.14, 8, PORCELAIN, -0.45, bodyY + 0.045, -bodyD / 2 - 0.01);
  ctx.cyl(0.045, 0.038, 0.14, 8, '#E9C4A4', -0.32, bodyY + 0.045, -bodyD / 2 - 0.01);

  // Overhanging cream marble countertop flush at exact surfaceHeight
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, 0.02, { roughness: 0.42 });
}

/** 2. espresso_machine (1x1, surface, h 0.48, toggle: brew shot) */
function buildEspressoMachine(ctx: ModelContext): void {
  // Polished stainless drip tray base grounded at local y = 0
  const baseH = 0.052;
  ctx.box(0.54, baseH, 0.44, CHROME, 0, baseH / 2, 0.01, { metalness: 0.74, roughness: 0.26 });
  // Dark slotted drip grate on front of tray
  ctx.box(0.44, 0.01, 0.16, DARK_IRON, 0, baseH + 0.004, 0.135, { roughness: 0.55, metalness: 0.4 });

  // Sculpted commercial enamel boiler housing
  const bodyW = 0.50;
  const bodyH = 0.35;
  const bodyD = 0.26;
  const bodyY = baseH + bodyH / 2;
  ctx.box(bodyW, bodyH, bodyD, ctx.primary, 0, bodyY, -0.075, { roughness: 0.36 });

  // Upper overhanging brew brow (stepped slightly below boiler top) + chrome side cheeks
  ctx.box(bodyW + 0.02, 0.112, 0.115, ctx.primary, 0, baseH + bodyH - 0.064, 0.112, { roughness: 0.36 });
  for (const sx of [-bodyW / 2 - 0.012, bodyW / 2 + 0.012]) {
    ctx.box(0.024, bodyH - 0.04, bodyD + 0.02, CHROME, sx, bodyY, -0.075, {
      metalness: 0.78,
      roughness: 0.24,
    });
  }

  // Cup warmer top gallery rail with grounded corner posts + 2 stacked porcelain espresso cups
  const topY = baseH + bodyH;
  ctx.box(bodyW - 0.06, 0.012, bodyD - 0.04, CHROME, 0, topY + 0.006, -0.075, { metalness: 0.75, roughness: 0.25 });
  ctx.box(bodyW - 0.06, 0.012, 0.012, CHROME, 0, topY + 0.048, -0.18, { metalness: 0.8, roughness: 0.2 });
  for (const sx of [-bodyW / 2 + 0.036, bodyW / 2 - 0.036]) {
    ctx.cyl(0.007, 0.007, 0.044, 6, CHROME, sx, topY + 0.028, -0.18, { metalness: 0.82, roughness: 0.2 });
    ctx.cyl(0.007, 0.007, 0.044, 6, CHROME, sx, topY + 0.028, -0.01, { metalness: 0.82, roughness: 0.2 });
    ctx.box(0.010, 0.010, 0.164, CHROME, sx, topY + 0.048, -0.091, { metalness: 0.8, roughness: 0.2 });
  }
  for (const cx of [-0.14, -0.03]) {
    ctx.cyl(0.034, 0.028, 0.052, 8, PORCELAIN, cx, topY + 0.034, -0.07, { roughness: 0.34 });
  }

  // Chrome group head + locked portafilter + angled walnut handle
  const groupX = -0.05;
  ctx.cyl(0.055, 0.052, 0.055, 10, CHROME, groupX, baseH + bodyH - 0.135, 0.115, {
    metalness: 0.84,
    roughness: 0.18,
  });
  ctx.cyl(0.048, 0.04, 0.036, 10, DARK_IRON, groupX, baseH + bodyH - 0.17, 0.115, {
    metalness: 0.65,
    roughness: 0.3,
  });
  // Portafilter handle extending toward +Z
  ctx.cyl(0.014, 0.018, 0.145, 7, WALNUT, groupX, baseH + bodyH - 0.175, 0.215, {
    rotX: Math.PI / 2 + 0.12,
    roughness: 0.62,
  });

  // Ceramic espresso cup + saucer sitting on drip grate directly under group head
  ctx.cyl(0.056, 0.042, 0.012, 10, PORCELAIN, groupX, baseH + 0.014, 0.115, { roughness: 0.32 });
  ctx.cyl(0.036, 0.028, 0.064, 10, PORCELAIN, groupX, baseH + 0.05, 0.115, { roughness: 0.32 });
  ctx.cyl(0.032, 0.032, 0.006, 10, '#5D3B24', groupX, baseH + 0.085, 0.115);

  // Articulated chrome steam wand on right side angling gently forward-outward toward steam tip
  ctx.cyl(0.01, 0.01, 0.16, 7, CHROME, 0.152, baseH + bodyH - 0.19, 0.118, {
    rotZ: 0.25,
    rotX: -0.18,
    metalness: 0.85,
    roughness: 0.18,
  });

  // Pressure gauge dial + warm glowing power LED on front brow
  ctx.cyl(0.032, 0.032, 0.016, 10, PORCELAIN, 0.13, baseH + bodyH - 0.055, 0.172, {
    rotX: Math.PI / 2,
    emissive: ctx.isActive ? '#FFE5B4' : undefined,
    emissiveIntensity: ctx.isActive ? 0.55 : 0,
  });
  ctx.sphere(0.015, 6, ctx.isActive ? '#FFAA3B' : '#7E848A', -0.18, baseH + bodyH - 0.055, 0.174, {
    emissive: ctx.isActive ? '#FF8A22' : undefined,
    emissiveIntensity: ctx.isActive ? 1.4 : 0,
    castShadow: false,
  });

  // Active brew state: rich espresso shot stream + rising steam puffs from steam wand!
  if (ctx.isActive) {
    ctx.cyl(0.006, 0.008, 0.098, 6, '#5A341C', groupX, baseH + 0.138, 0.115, {
      emissive: '#3D2212',
      emissiveIntensity: 0.35,
      castShadow: false,
    });
    addSteamPuffs(ctx, 0.175, baseH + 0.11, 0.13);
  }
}

/** 3. blender_smoothie (1x1, surface, h 0.44, spin: SpinTarget) */
function buildBlenderSmoothie(ctx: ModelContext): void {
  // Tapered pastel motor base grounded at local y = 0
  ctx.cyl(0.092, 0.116, 0.145, 10, ctx.primary, 0, 0.0725, 0, { roughness: 0.38 });
  // Dark rubber collar + coupling deck
  ctx.cyl(0.084, 0.094, 0.022, 10, DARK_IRON, 0, 0.154, 0, { roughness: 0.65 });

  // Front chrome speed dial + glowing power indicator LED
  ctx.cyl(0.024, 0.028, 0.022, 8, CHROME, 0, 0.076, 0.11, {
    rotX: Math.PI / 2,
    metalness: 0.8,
    roughness: 0.22,
  });
  ctx.sphere(0.012, 6, ctx.isActive ? '#76EDA8' : '#767C82', 0.048, 0.095, 0.104, {
    emissive: ctx.isActive ? '#4FE38E' : undefined,
    emissiveIntensity: ctx.isActive ? 1.35 : 0,
    castShadow: false,
  });

  // Smoothie liquid core inside pitcher (colored per variant: berry / mango / matcha!)
  const smoothieColor = ctx.shade(ctx.primary, 0.06);
  ctx.cyl(0.086, 0.064, 0.155, 10, smoothieColor, 0, 0.242, 0, {
    roughness: 0.42,
    castShadow: false,
  });

  // SpinTarget group: blender blades + whirling fruit vortex chunks!
  const spinGroup = new THREE.Group();
  spinGroup.name = 'SpinTarget';
  spinGroup.userData.spinAxis = 'y';
  spinGroup.userData.spinSpeed = 8.0;
  spinGroup.position.set(0, 0.24, 0);
  ctx.group.add(spinGroup);

  // Crossed stainless steel blades near pitcher bottom
  ctx.box(0.092, 0.01, 0.018, CHROME, 0, -0.056, 0, {
    parent: spinGroup,
    metalness: 0.85,
    roughness: 0.2,
  });
  ctx.box(0.018, 0.01, 0.092, CHROME, 0, -0.052, 0, {
    parent: spinGroup,
    metalness: 0.85,
    roughness: 0.2,
  });
  // Swirl foam crest & fruit chunks on smoothie surface so spinning is clearly visible!
  ctx.torus(0.052, 0.016, 6, 10, ctx.shade(ctx.primary, 0.26), 0, 0.078, 0, {
    parent: spinGroup,
    rotX: Math.PI / 2,
    castShadow: false,
  });
  ctx.sphere(0.022, 6, '#FFF7EE', 0.042, 0.088, 0.02, { parent: spinGroup, castShadow: false });
  ctx.sphere(0.02, 6, ctx.shade(ctx.primary, -0.18), -0.038, 0.086, -0.025, {
    parent: spinGroup,
    castShadow: false,
  });
  ctx.sphere(0.018, 6, '#F4DF8D', -0.01, 0.088, 0.044, { parent: spinGroup, castShadow: false });

  // Translucent tapered glass pitcher wrapping the smoothie
  ctx.cyl(0.104, 0.076, 0.235, 12, GLASS_CLEAR, 0, 0.282, 0, {
    opacity: 0.34,
    roughness: 0.14,
    castShadow: false,
  });
  // Sculpted side handle (+X), solidly anchored at both top and narrow tapered base
  ctx.box(0.058, 0.018, 0.022, ctx.accent, 0.115, 0.355, 0);
  ctx.box(0.022, 0.165, 0.022, ctx.accent, 0.138, 0.275, 0, { rotZ: -0.08 });
  ctx.box(0.068, 0.018, 0.022, ctx.accent, 0.104, 0.20, 0);

  // Snug dome lid + removable center filler cap
  ctx.cyl(0.092, 0.108, 0.032, 12, ctx.accent, 0, 0.408, 0, { roughness: 0.45 });
  ctx.cyl(0.036, 0.042, 0.026, 8, ctx.shade(ctx.primary, -0.1), 0, 0.432, 0, { roughness: 0.42 });
}

/** 4. smoothie_station (2x1, surfaceHeight 0.96) */
function buildSmoothieStation(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.96;
  const plinthH = 0.08;
  const topH = 0.058;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyTop = surfaceY - topH;
  const bodyH = bodyTop - bodyBottom;
  const w = 1.96;
  const bodyD = 0.80;
  const topD = 0.88;

  // Plinth base
  ctx.box(w - 0.06, plinthH, bodyD - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, -0.02);

  // Lower solid pastel counter base (below the front chilled fruit showcase!)
  const lowerH = bodyH * 0.56;
  ctx.box(w - 0.04, lowerH, bodyD, ctx.primary, 0, bodyBottom + lowerH / 2, 0, { roughness: 0.55 });

  // Cheerful striped ceramic tile panels on lower front (+Z)
  const frontZ = bodyD / 2;
  for (let i = 0; i < 6; i++) {
    const px = -0.75 + i * 0.30;
    const tileCol = i % 2 === 0 ? ctx.shade(ctx.primary, 0.12) : ctx.shade(ctx.primary, -0.06);
    ctx.box(0.24, lowerH - 0.09, 0.022, tileCol, px, bodyBottom + lowerH / 2, frontZ + 0.008, {
      roughness: 0.42,
    });
  }

  // Upper rear support wall strictly between left & right end cheeks (zero corner overlap)
  const vitrineH = bodyH - lowerH;
  const vitrineY = bodyBottom + lowerH + vitrineH / 2;
  ctx.box(w - 0.24, vitrineH, bodyD * 0.46, ctx.primary, 0, vitrineY, -bodyD * 0.27);
  for (const sx of [-(w - 0.04) / 2 + 0.05, (w - 0.04) / 2 - 0.05]) {
    ctx.box(0.10, vitrineH, bodyD, ctx.primary, sx, vitrineY, 0);
  }

  // Chilled display floor tray + 4 colorful fresh fruit bins tucked neatly beneath countertop!
  const trayY = bodyBottom + lowerH + 0.02;
  ctx.box(w - 0.22, 0.03, bodyD * 0.52, '#EBF2F5', 0, trayY, 0.17, { roughness: 0.3 });

  const binSpecs: [number, string, string][] = [
    [-0.58, '#E67A82', '#F29DA4'], // Strawberries
    [-0.19, '#F3B45C', '#F7CB82'], // Mango & citrus
    [0.20, '#96C97E', '#B7DF9E'], // Kiwi & lime
    [0.58, '#A992D8', '#C6B4EB'], // Acai & blueberries
  ];
  for (const [bx, c1, c2] of binSpecs) {
    // Stainless chilled bin pan
    ctx.box(0.32, 0.085, 0.28, CHROME, bx, trayY + 0.052, 0.18, { metalness: 0.65, roughness: 0.3 });
    // Fruit mounds overflowing cleanly inside bin
    ctx.sphere(0.068, 7, c1, bx - 0.06, trayY + 0.115, 0.19, { scaleY: 0.8 });
    ctx.sphere(0.062, 7, c2, bx + 0.055, trayY + 0.112, 0.17, { scaleY: 0.85 });
    ctx.sphere(0.054, 7, c1, bx, trayY + 0.128, 0.22, { scaleY: 0.78 });
  }

  // Clear angled glass showcase front pane (no shadow cast so fruits glow bright!)
  ctx.box(w - 0.22, vitrineH - 0.02, 0.02, GLASS_CLEAR, 0, vitrineY, frontZ - 0.01, {
    opacity: 0.28,
    roughness: 0.12,
    castShadow: false,
  });

  // Clean flat cream countertop flush at exact surfaceHeight (zero collision with blenders!)
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, 0.01, { roughness: 0.45 });
}

/** 5. bar_counter (2x1, surfaceHeight 1.02) */
function buildBarCounter(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 1.02;
  const plinthH = 0.085;
  const topH = 0.066;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyH = surfaceY - bodyBottom - topH;
  const bodyY = bodyBottom + bodyH / 2;
  const w = 1.98;
  const bodyD = 0.74;
  const topD = 0.92;
  const bodyZ = -0.04;

  // Dark recessed toe-kick plinth
  ctx.box(w - 0.06, plinthH, bodyD - 0.08, '#38322E', 0, FLOOR_BASE_Y + plinthH / 2, bodyZ - 0.02);

  // Main lounge bar carcass
  ctx.box(w - 0.04, bodyH, bodyD, ctx.shade(ctx.primary, -0.14), 0, bodyY, bodyZ, { roughness: 0.62 });

  // Sculpted fluted/ribbed lounge front panels (+Z) framed in brass
  const frontZ = bodyZ + bodyD / 2;
  const ribCount = 9;
  const ribSpan = w - 0.18;
  for (let i = 0; i < ribCount; i++) {
    const rx = -ribSpan / 2 + (i / (ribCount - 1)) * ribSpan;
    ctx.cyl(0.052, 0.052, bodyH - 0.10, 8, ctx.primary, rx, bodyY, frontZ + 0.008, { roughness: 0.55 });
  }
  // Upper & lower brass inlay rails cleanly proud of carcass sides
  ctx.box(w - 0.02, 0.03, 0.048, BRASS, 0, bodyBottom + bodyH - 0.03, frontZ + 0.028, {
    metalness: 0.78,
    roughness: 0.25,
  });
  ctx.box(w - 0.02, 0.03, 0.048, BRASS, 0, bodyBottom + 0.03, frontZ + 0.028, {
    metalness: 0.78,
    roughness: 0.25,
  });

  // Iconic tubular brushed brass footrail along bottom front (+Z) with 3 mounting brackets!
  const railZ = frontZ + 0.12;
  const railY = FLOOR_BASE_Y + 0.14;
  ctx.cyl(0.018, 0.018, w - 0.10, 8, BRASS, 0, railY, railZ, {
    rotZ: Math.PI / 2,
    metalness: 0.82,
    roughness: 0.22,
  });
  for (const bx of [-0.76, 0, 0.76]) {
    ctx.box(0.024, 0.024, 0.12, BRASS, bx, railY, frontZ + 0.06, { metalness: 0.8, roughness: 0.24 });
    ctx.cyl(0.016, 0.022, railY - FLOOR_BASE_Y, 6, BRASS, bx, FLOOR_BASE_Y + (railY - FLOOR_BASE_Y) / 2, railZ, {
      metalness: 0.8,
      roughness: 0.24,
    });
  }

  // Rear bartender speed-rail shelf detail (-Z)
  ctx.box(w - 0.24, 0.03, 0.14, ctx.shade(ctx.primary, -0.06), 0, bodyY - 0.06, bodyZ - bodyD / 2 - 0.02);

  // Thick generous overhanging bar top flush at exact surfaceHeight
  ctx.box(w, topH, topD, ctx.accent, 0, surfaceY - topH / 2, 0.02, { roughness: 0.42 });
  // Subtle dark under-lip shadow reveal tucked under the front overhang (clear of carcass & brass rail)
  ctx.box(w - 0.06, 0.020, 0.11, ctx.shade(ctx.primary, -0.22), 0, surfaceY - topH - 0.010, frontZ + 0.086);
}

/** 6. bar_stool (1x1, h 0.72, bounce) */
function buildBarStool(ctx: ModelContext): void {
  const totalH = 0.72;
  const cushionH = 0.085;
  const panH = 0.028;
  const legTopY = totalH - cushionH - panH;
  const legH = legTopY - FLOOR_BASE_Y;
  const legSpread = 0.16;

  // 4 slender splayed dark walnut legs + brass ferrules
  const dirs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  for (const [dx, dz] of dirs) {
    ctx.cyl(0.02, 0.015, legH - 0.004, 7, WALNUT, dx * legSpread, FLOOR_BASE_Y + legH / 2 + 0.002, dz * legSpread, {
      rotZ: dx * 0.11,
      rotX: -dz * 0.11,
    });
    ctx.cyl(0.016, 0.014, 0.045, 7, BRASS, dx * (legSpread + 0.031), FLOOR_BASE_Y + 0.0225, dz * (legSpread + 0.031), {
      metalness: 0.78,
      roughness: 0.26,
    });
  }

  // Circular brushed brass footrest ring tying the 4 legs together
  ctx.torus(0.22, 0.013, 6, 16, BRASS, 0, FLOOR_BASE_Y + 0.22, 0, {
    rotX: Math.PI / 2,
    metalness: 0.8,
    roughness: 0.24,
  });

  // Wooden seat underside pan
  ctx.cyl(0.205, 0.19, panH, 14, WALNUT, 0, legTopY + panH / 2, 0);

  // Plush round upholstered seat cushion + piped rim torus + center tuft button
  ctx.cyl(0.22, 0.215, cushionH - 0.015, 14, ctx.primary, 0, legTopY + panH + (cushionH - 0.015) / 2, 0, {
    roughness: 0.86,
  });
  ctx.torus(0.208, 0.016, 6, 14, ctx.shade(ctx.primary, 0.06), 0, totalH - 0.016, 0, {
    rotX: Math.PI / 2,
    roughness: 0.86,
  });
  ctx.cyl(0.026, 0.026, 0.012, 8, ctx.shade(ctx.primary, -0.14), 0, totalH - 0.006, 0, { roughness: 0.82 });
}

/** 7. pastry_case (1x1, surfaceHeight 0.95, toggle: case light) */
function buildPastryCase(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.95;
  const plinthH = 0.07;
  const cabTopY = 0.48;
  const cabH = cabTopY - FLOOR_BASE_Y - plinthH;
  const w = 0.92;
  const d = 0.80;

  // Recessed base plinth + lower patisserie counter cabinet
  ctx.box(w - 0.06, plinthH, d - 0.08, PLINTH_DARK, 0, FLOOR_BASE_Y + plinthH / 2, -0.02);
  ctx.box(w, cabH, d, ctx.primary, 0, FLOOR_BASE_Y + plinthH + cabH / 2, 0);
  // Decorative front panel inset on lower cabinet
  ctx.box(w - 0.14, cabH - 0.10, 0.02, ctx.shade(ctx.primary, -0.09), 0, FLOOR_BASE_Y + plinthH + cabH / 2, d / 2 + 0.008);
  ctx.box(0.18, 0.018, 0.024, BRASS, 0, FLOOR_BASE_Y + plinthH + cabH * 0.72, d / 2 + 0.024, {
    metalness: 0.74,
    roughness: 0.28,
  });

  // Interior display deck + upper glass shelf resting on brass side support ledges
  const tray1Y = cabTopY + 0.016;
  const tray2Y = cabTopY + 0.23;
  ctx.box(w - 0.06, 0.026, d - 0.06, ctx.accent, 0, tray1Y, 0, { roughness: 0.45 });
  ctx.box(w - 0.064, 0.02, d - 0.16, GLASS_CLEAR, 0, tray2Y, -0.04, {
    opacity: 0.46,
    roughness: 0.15,
    castShadow: false,
  });
  for (const sx of [-w / 2 + 0.024, w / 2 - 0.024]) {
    ctx.box(0.018, 0.016, d - 0.16, BRASS, sx, tray2Y - 0.014, -0.035, {
      metalness: 0.74,
      roughness: 0.28,
    });
  }

  // Miniature pastries on lower tray: 2 golden croissants + strawberry fruit tart
  for (const cx of [-0.22, -0.01]) {
    ctx.sphere(0.056, 7, '#DFA258', cx, tray1Y + 0.045, 0.08, { scaleX: 1.45, scaleY: 0.72, scaleZ: 0.85 });
    ctx.sphere(0.036, 6, '#C8853C', cx - 0.055, tray1Y + 0.036, 0.11, { scaleY: 0.75 });
    ctx.sphere(0.036, 6, '#C8853C', cx + 0.055, tray1Y + 0.036, 0.11, { scaleY: 0.75 });
  }
  // Berry fruit tart on right of lower tray
  ctx.cyl(0.082, 0.072, 0.036, 10, '#E3B97D', 0.24, tray1Y + 0.03, 0.06);
  ctx.sphere(0.062, 8, '#DF697B', 0.24, tray1Y + 0.055, 0.06, { scaleY: 0.55 });

  // Miniature pastries on upper tray: 2 pastel frosted cupcakes + cocoa mini-cake
  const cupcakes: [number, string][] = [
    [-0.22, '#F3BCC9'],
    [0.0, '#B8DFC9'],
  ];
  for (const [cx, frost] of cupcakes) {
    ctx.cyl(0.046, 0.036, 0.046, 8, '#EEDEC6', cx, tray2Y + 0.033, -0.02);
    ctx.cone(0.048, 0.056, 8, frost, cx, tray2Y + 0.08, -0.02);
  }
  // Mini chocolate glaze cake
  ctx.cyl(0.075, 0.075, 0.068, 10, '#8A634C', 0.22, tray2Y + 0.044, -0.02);
  ctx.sphere(0.018, 6, '#E25D6E', 0.22, tray2Y + 0.086, -0.02);

  // Brass corner frame pillars starting cleanly above lower display deck + flat top cap
  const deckTopY = tray1Y + 0.013;
  const vitrineH = surfaceY - 0.028 - deckTopY;
  const vitrineMidY = deckTopY + vitrineH / 2;
  for (const sx of [-w / 2 + 0.024, w / 2 - 0.024]) {
    ctx.box(0.028, vitrineH, 0.028, BRASS, sx, vitrineMidY, -d / 2 + 0.024, { metalness: 0.74, roughness: 0.28 });
    // Angled front brass frame struts
    ctx.box(0.024, vitrineH + 0.02, 0.024, BRASS, sx, vitrineMidY, d / 2 - 0.075, {
      rotX: -0.22,
      metalness: 0.74,
      roughness: 0.28,
    });
  }
  // Flat top cap shelf at exact surfaceHeight
  ctx.box(w, 0.028, d - 0.14, ctx.primary, 0, surfaceY - 0.014, -0.06, { roughness: 0.45 });

  // Translucent angled front glass + side glass panes (castShadow: false so pastries stay crisp!)
  ctx.box(w - 0.06, vitrineH + 0.02, 0.016, GLASS_CLEAR, 0, vitrineMidY, d / 2 - 0.075, {
    rotX: -0.22,
    opacity: 0.26,
    roughness: 0.12,
    castShadow: false,
  });
  for (const sx of [-w / 2 + 0.016, w / 2 - 0.016]) {
    ctx.box(0.016, vitrineH - 0.02, d - 0.16, GLASS_CLEAR, sx, vitrineMidY, -0.04, {
      opacity: 0.22,
      roughness: 0.12,
      castShadow: false,
    });
  }

  // Warm bakery showcase LED light bar tucked under top roof
  ctx.box(
    w - 0.16,
    0.016,
    0.036,
    ctx.isActive ? '#FFE9B3' : '#CFC8BC',
    0,
    surfaceY - 0.036,
    0.04,
    {
      emissive: ctx.isActive ? '#FFD175' : undefined,
      emissiveIntensity: ctx.isActive ? 1.35 : 0,
      castShadow: false,
    },
  );
}

/** 8. chalkboard_menu (1x1, wall mounted, h 0.85) */
function buildChalkboardMenu(ctx: ModelContext): void {
  const w = 0.78;
  const h = 0.82;
  const frameT = 0.052;
  const boardD = 0.026;
  const frameD = 0.046;

  // Matte charcoal slate board inset strictly inside the 4 frame rails (non-coplanar back)
  ctx.box(w - frameT * 2, h - frameT * 2, boardD, ctx.shade(ctx.primary, -0.38), 0, 0, 0.010 + boardD / 2, {
    roughness: 0.92,
  });

  // 4 mitered outer wooden frame rails (accent = oak / matcha / cream)
  ctx.box(w, frameT, frameD, ctx.accent, 0, h / 2 - frameT / 2, frameD / 2);
  ctx.box(w, frameT, frameD, ctx.accent, 0, -h / 2 + frameT / 2, frameD / 2);
  ctx.box(frameT, h - frameT * 2, frameD, ctx.accent, -w / 2 + frameT / 2, 0, frameD / 2);
  ctx.box(frameT, h - frameT * 2, frameD, ctx.accent, w / 2 - frameT / 2, 0, frameD / 2);

  // Small bottom chalk ledge tray + 2 pastel chalk sticks
  ctx.box(w - 0.08, 0.022, 0.072, ctx.shade(ctx.accent, -0.08), 0, -h / 2 + 0.02, 0.056);
  ctx.cyl(0.008, 0.008, 0.075, 6, '#FAF6EE', -0.14, -h / 2 + 0.038, 0.072, { rotZ: Math.PI / 2 });
  ctx.cyl(0.008, 0.008, 0.06, 6, '#F2B8C4', 0.08, -h / 2 + 0.038, 0.072, { rotZ: Math.PI / 2 });

  // Graphic pastel chalk coffee cup motif + menu line strokes (zero text strings!)
  const chalkZ = 0.010 + boardD + 0.006;
  // Chalk header coffee cup
  ctx.box(0.10, 0.082, 0.008, '#F6F1E5', 0, 0.22, chalkZ, { roughness: 0.95 });
  ctx.torus(0.024, 0.007, 5, 8, '#F6F1E5', 0.056, 0.224, chalkZ, { roughness: 0.95 });
  ctx.box(0.15, 0.012, 0.008, '#F6F1E5', 0, 0.172, chalkZ, { roughness: 0.95 });
  // Tiny wavy steam lines above cup
  ctx.box(0.01, 0.042, 0.008, '#F2D89B', -0.022, 0.29, chalkZ, { rotZ: -0.18 });
  ctx.box(0.01, 0.048, 0.008, '#F2D89B', 0.022, 0.295, chalkZ, { rotZ: 0.16 });

  // Chalk divider + 4 stylized menu bars with pastel price dots
  ctx.box(0.50, 0.012, 0.008, '#EAB9B0', 0, 0.115, chalkZ);
  const rows: [number, number, string][] = [
    [0.035, 0.34, '#F6F1E5'],
    [-0.055, 0.28, '#BFE0CE'],
    [-0.145, 0.36, '#F6F1E5'],
    [-0.235, 0.26, '#F2D89B'],
  ];
  for (const [ry, rw, rc] of rows) {
    ctx.box(rw, 0.022, 0.008, rc, -0.24 + rw / 2, ry, chalkZ, { roughness: 0.95 });
    ctx.box(0.06, 0.022, 0.008, '#F2D89B', 0.20, ry, chalkZ, { roughness: 0.95 });
  }
}

/** 9. cafe_bistro_table (1x1, surfaceHeight 0.76) */
function buildCafeBistroTable(ctx: ModelContext): void {
  const surfaceY = ctx.def.surfaceHeight ?? 0.76;
  const topH = 0.04;
  const stemTopY = surfaceY - topH;
  const mountPlateH = 0.026;
  const stemH = stemTopY - FLOOR_BASE_Y - 0.08 - mountPlateH;

  // Flared cast-iron Parisian pedestal foot + 4 arched spider feet at FLOOR_BASE_Y
  ctx.cyl(0.072, 0.14, 0.08, 10, DARK_IRON, 0, FLOOR_BASE_Y + 0.04, 0, {
    metalness: 0.58,
    roughness: 0.42,
  });
  for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const fx = Math.cos(ang) * 0.18;
    const fz = Math.sin(ang) * 0.18;
    ctx.box(0.18, 0.038, 0.046, DARK_IRON, fx, FLOOR_BASE_Y + 0.022, fz, {
      rotY: -ang,
      metalness: 0.58,
      roughness: 0.42,
    });
  }

  // Slender turned central column + decorative brass collar + under-table mounting plate
  ctx.cyl(0.034, 0.044, stemH, 10, DARK_IRON, 0, FLOOR_BASE_Y + 0.08 + stemH / 2, 0, {
    metalness: 0.58,
    roughness: 0.42,
  });
  ctx.cyl(0.056, 0.052, 0.036, 10, BRASS, 0, FLOOR_BASE_Y + 0.22, 0, {
    metalness: 0.76,
    roughness: 0.26,
  });
  ctx.cyl(0.18, 0.12, 0.026, 10, DARK_IRON, 0, stemTopY - 0.013, 0, {
    metalness: 0.55,
    roughness: 0.44,
  });

  // Round marble/oak/sage tabletop flush at exact surfaceHeight
  const rimColor = ctx.variant.accentColor ?? ctx.shade(ctx.primary, -0.14);
  ctx.cyl(0.43, 0.43, topH, 16, ctx.primary, 0, surfaceY - topH / 2, 0, {
    roughness: ctx.variant.id === 'marble' ? 0.34 : 0.62,
  });
  // Crisp Parisian brass / beveled edge banding ring flush with tabletop
  ctx.torus(0.432, 0.014, 6, 18, rimColor, 0, surfaceY - topH / 2, 0, {
    rotX: Math.PI / 2,
    metalness: ctx.variant.id === 'marble' ? 0.76 : 0.08,
    roughness: ctx.variant.id === 'marble' ? 0.26 : 0.62,
  });
}

/** 10. cafe_booth (2x1, h 0.95, bounce) */
function buildCafeBooth(ctx: ModelContext): void {
  const w = 1.90;
  const d = 0.84;
  const plinthH = 0.12;
  const seatH = 0.29;
  const seatTopY = FLOOR_BASE_Y + plinthH + seatH;

  // Grounded walnut wooden plinth base tucked flush between the end cheek panels & rear wall
  ctx.box(w - 0.12, plinthH, d - 0.17, WALNUT, 0, FLOOR_BASE_Y + plinthH / 2, 0.015);

  // Plush bench seat box + rounded front cushion roll + cream diner piping
  ctx.box(w - 0.12, seatH, d - 0.14, ctx.primary, 0, FLOOR_BASE_Y + plinthH + seatH / 2, 0.03, {
    roughness: 0.85,
  });
  ctx.cyl(0.072, 0.072, w - 0.12, 10, ctx.shade(ctx.primary, 0.05), 0, seatTopY - 0.072, d / 2 - 0.03, {
    rotZ: Math.PI / 2,
    roughness: 0.85,
  });
  ctx.box(w - 0.12, 0.022, 0.024, ctx.accent, 0, seatTopY - 0.012, d / 2 - 0.015, { roughness: 0.78 });

  // Tall channel-tufted banquette backrest (-Z): 5 vertical plush rounded cushions
  const backH = 0.56;
  const backY = seatTopY + backH / 2 - 0.04;
  const backZ = -d / 2 + 0.15;
  // Solid rear wood panel strictly between end cheeks, slightly below cushion top (zero coplanar faces)
  const rearH = 0.895 - FLOOR_BASE_Y;
  ctx.box(w - 0.12, rearH, 0.056, WALNUT, 0, FLOOR_BASE_Y + rearH / 2, -d / 2 + 0.068);

  const channelCount = 5;
  const chanW = (w - 0.18) / channelCount;
  for (let i = 0; i < channelCount; i++) {
    const cx = -(w - 0.18) / 2 + chanW * (i + 0.5);
    const tone = i % 2 === 0 ? ctx.primary : ctx.shade(ctx.primary, 0.04);
    ctx.box(chanW - 0.022, backH - 0.06, 0.18, tone, cx, backY, backZ + 0.02, { roughness: 0.86 });
  }
  // Retro cream horizontal head-roll accent band along top of backrest
  ctx.cyl(0.072, 0.072, w - 0.14, 10, ctx.accent, 0, 0.95 - 0.072, backZ + 0.02, {
    rotZ: Math.PI / 2,
    roughness: 0.82,
  });

  // Sculpted wooden end cheek panels framing both outer ends cleanly without overlap
  for (const sx of [-w / 2 + 0.03, w / 2 - 0.03]) {
    ctx.box(0.06, 0.44, d - 0.08, WALNUT, sx, FLOOR_BASE_Y + 0.22, 0);
    ctx.box(0.06, 0.476, 0.26, WALNUT, sx, FLOOR_BASE_Y + 0.44 + 0.238, backZ);
  }
}

/** 11. coffee_grinder (1x1, surface, h 0.42, spin: SpinTarget) */
function buildCoffeeGrinder(ctx: ModelContext): void {
  // Compact weighted grinder base at local y = 0
  ctx.box(0.22, 0.036, 0.28, ctx.primary, 0, 0.018, 0, { roughness: 0.46 });
  // Portafilter catch tray + grounds dosing cup on front (+Z), cleanly clear of housing
  ctx.cyl(0.042, 0.036, 0.078, 9, ctx.accent, 0, 0.075, 0.098, { roughness: 0.42 });

  // Vertical motor housing column
  ctx.box(0.175, 0.19, 0.155, ctx.primary, 0, 0.131, -0.035, { roughness: 0.44 });
  // Front angled chrome dosing chute seated into housing and projecting over catch cup
  ctx.box(0.056, 0.052, 0.095, CHROME, 0, 0.175, 0.066, {
    rotX: 0.42,
    metalness: 0.8,
    roughness: 0.22,
  });
  // Side grind-size dial + flush-mounted power LED on front housing face
  ctx.cyl(0.028, 0.03, 0.024, 8, CHROME, 0.095, 0.15, -0.03, {
    rotZ: Math.PI / 2,
    metalness: 0.78,
    roughness: 0.24,
  });
  ctx.sphere(0.011, 6, ctx.isActive ? '#FFB24C' : '#6A6E72', -0.054, 0.115, 0.045, {
    emissive: ctx.isActive ? '#FF9028' : undefined,
    emissiveIntensity: ctx.isActive ? 1.3 : 0,
    castShadow: false,
  });

  // Dark grind-adjustment collar ring centered cleanly over housing
  ctx.cyl(0.068, 0.074, 0.032, 10, DARK_IRON, 0, 0.24, -0.035, { roughness: 0.55 });

  // SpinTarget group inside clear bean hopper: burr cone + roasted coffee beans!
  const spinGroup = new THREE.Group();
  spinGroup.name = 'SpinTarget';
  spinGroup.userData.spinAxis = 'y';
  spinGroup.userData.spinSpeed = 5.0;
  spinGroup.position.set(0, 0.31, -0.035);
  ctx.group.add(spinGroup);

  ctx.cone(0.036, 0.044, 8, CHROME, 0, -0.035, 0, {
    parent: spinGroup,
    metalness: 0.8,
    roughness: 0.25,
  });
  const beans: [number, number, number, string][] = [
    [-0.036, 0.005, 0.022, '#4A3122'],
    [0.034, 0.012, -0.018, '#5C3E2C'],
    [0.008, 0.022, 0.038, '#422B1E'],
    [-0.022, 0.02, -0.034, '#634431'],
    [0.044, 0.024, 0.024, '#4E3424'],
    [-0.042, 0.028, -0.008, '#573B2A'],
  ];
  for (const [bx, by, bz, bc] of beans) {
    ctx.sphere(0.024, 6, bc, bx, by, bz, {
      parent: spinGroup,
      scaleX: 1.25,
      scaleY: 0.78,
      scaleZ: 0.88,
      roughness: 0.52,
      castShadow: false,
    });
  }

  // Clear conical glass bean hopper + snug dark top lid
  ctx.cyl(0.108, 0.052, 0.145, 12, GLASS_CLEAR, 0, 0.326, -0.035, {
    opacity: 0.34,
    roughness: 0.14,
    castShadow: false,
  });
  ctx.cyl(0.112, 0.114, 0.022, 12, DARK_IRON, 0, 0.408, -0.035, { roughness: 0.55 });
}

/** 12. pourover_stand (1x1, surface, h 0.36, toggle: drip brew) */
function buildPouroverStand(ctx: ModelContext): void {
  const isBrass = ctx.variant.id === 'brass';
  const standOpts = {
    metalness: isBrass ? 0.76 : 0.06,
    roughness: isBrass ? 0.26 : 0.62,
  };

  // Flat wooden/brass drip base tray at local y = 0 + dark silicone mat
  ctx.box(0.32, 0.026, 0.24, ctx.primary, 0, 0.013, 0, standOpts);
  ctx.cyl(0.088, 0.088, 0.006, 12, DARK_IRON, 0, 0.029, 0.01, { roughness: 0.8 });

  // Minimalist arch frame: two vertical columns stopping cleanly under crossbeam + forward neck
  for (const sx of [-0.115, 0.115]) {
    ctx.cyl(0.012, 0.014, 0.217, 8, ctx.primary, sx, 0.026 + 0.1085, -0.05, standOpts);
  }
  ctx.box(0.245, 0.018, 0.024, ctx.primary, 0, 0.252, -0.05, standOpts);
  ctx.box(0.02, 0.014, 0.046, ctx.primary, 0, 0.252, -0.015, standOpts);
  ctx.torus(0.062, 0.01, 6, 14, ctx.primary, 0, 0.252, 0.02, {
    ...standOpts,
    rotX: Math.PI / 2,
  });

  // Clear glass carafe server sitting underneath + brewed coffee liquid inside
  const brewH = ctx.isActive ? 0.085 : 0.052;
  ctx.cyl(0.062, 0.076, brewH, 10, '#5A3620', 0, 0.035 + brewH / 2, 0.02, {
    roughness: 0.25,
    castShadow: false,
  });
  ctx.cyl(0.052, 0.086, 0.145, 12, ctx.accent, 0, 0.105, 0.02, {
    opacity: 0.38,
    roughness: 0.12,
    castShadow: false,
  });
  // Glass handle on carafe (+X)
  ctx.torus(0.036, 0.008, 5, 10, ctx.accent, 0.082, 0.11, 0.02, {
    opacity: 0.55,
    roughness: 0.18,
    castShadow: false,
  });

  // Inverted conical V60 ceramic dripper + folded paper filter + dark coffee grounds bed
  ctx.cyl(0.082, 0.018, 0.092, 12, PORCELAIN, 0, 0.298, 0.02, { roughness: 0.34 });
  ctx.cyl(0.074, 0.022, 0.078, 10, '#EFE4D2', 0, 0.310, 0.02, { roughness: 0.9 });
  ctx.cyl(0.058, 0.044, 0.016, 10, '#4F3322', 0, 0.330, 0.02, { roughness: 0.88 });

  // Active drip stream + gentle steam wisps!
  if (ctx.isActive) {
    ctx.cyl(0.005, 0.006, 0.135, 6, '#6E4226', 0, 0.18, 0.02, {
      emissive: '#4D2C16',
      emissiveIntensity: 0.3,
      castShadow: false,
    });
    addSteamPuffs(ctx, 0, 0.335, 0.02);
  }
}

/** 13. cocktail_shaker (1x1, surface, h 0.34, bounce) */
function buildCocktailShaker(ctx: ModelContext): void {
  const metalOpts = { metalness: 0.8, roughness: 0.22 };

  // Round dark walnut serving tray grounded at local y = 0 + raised metallic rim
  ctx.cyl(0.22, 0.21, 0.016, 14, WALNUT, 0, 0.008, 0, { roughness: 0.62 });
  ctx.torus(0.218, 0.01, 6, 16, ctx.primary, 0, 0.018, 0, {
    ...metalOpts,
    rotX: Math.PI / 2,
  });

  // Cobbler cocktail shaker tin (left-back)
  const sx = -0.075;
  const sz = -0.045;
  ctx.cyl(0.056, 0.042, 0.195, 12, ctx.primary, sx, 0.016 + 0.0975, sz, metalOpts);
  ctx.cyl(0.034, 0.056, 0.055, 12, ctx.shade(ctx.primary, 0.06), sx, 0.016 + 0.222, sz, metalOpts);
  ctx.cyl(0.026, 0.032, 0.042, 10, ctx.primary, sx, 0.016 + 0.27, sz, metalOpts);

  // Double-sided hourglass jigger (front-left)
  const jx = -0.09;
  const jz = 0.095;
  ctx.cyl(0.012, 0.026, 0.044, 8, ctx.primary, jx, 0.016 + 0.022, jz, metalOpts);
  ctx.cyl(0.032, 0.012, 0.056, 8, ctx.primary, jx, 0.016 + 0.072, jz, metalOpts);

  // Elegant coupe cocktail glass (right-front)
  const gx = 0.09;
  const gz = 0.035;
  ctx.cyl(0.048, 0.052, 0.01, 10, GLASS_CLEAR, gx, 0.021, gz, { opacity: 0.52, roughness: 0.14 });
  ctx.cyl(0.008, 0.008, 0.115, 8, GLASS_CLEAR, gx, 0.082, gz, { opacity: 0.52, roughness: 0.14 });
  // Translucent coupe bowl + blush peach cocktail liquid
  ctx.cyl(0.078, 0.022, 0.062, 12, GLASS_CLEAR, gx, 0.168, gz, {
    opacity: 0.36,
    roughness: 0.12,
    castShadow: false,
  });
  ctx.cyl(0.068, 0.028, 0.036, 12, '#F39E96', gx, 0.168, gz, {
    roughness: 0.24,
    castShadow: false,
  });
  // Sunny citrus wheel slice perched on coupe rim + cherry garnish
  ctx.cyl(0.028, 0.028, 0.01, 10, '#F5C056', gx + 0.066, 0.20, gz - 0.01, {
    rotX: 0.35,
    rotZ: -0.5,
  });
  ctx.sphere(0.014, 6, '#DE596B', gx - 0.015, 0.188, gz + 0.015);
}

/** 14. neon_drink_menu (1x1, wall mounted, h 0.65, toggle: toggle neon) */
function buildNeonDrinkMenu(ctx: ModelContext): void {
  const w = 0.80;
  const h = 0.60;
  const backD = 0.03;

  // Sleek dark smoked-acrylic wall backing flush at z = 0
  ctx.box(w, h, backD, '#2B2F39', 0, 0, backD / 2, { roughness: 0.45 });

  // 4 corner brass wall standoff pins
  for (const sx of [-w / 2 + 0.045, w / 2 - 0.045]) {
    for (const sy of [-h / 2 + 0.045, h / 2 - 0.045]) {
      ctx.cyl(0.012, 0.012, 0.022, 6, BRASS, sx, sy, backD + 0.008, {
        rotX: Math.PI / 2,
        metalness: 0.78,
        roughness: 0.25,
      });
    }
  }

  const lit = ctx.isActive;
  const tubeZ = backD + 0.022;
  const tubeColor = lit ? ctx.shade(ctx.primary, 0.18) : ctx.shade(ctx.primary, -0.2);
  const tubeOpts = {
    emissive: lit ? ctx.primary : ctx.primary,
    emissiveIntensity: lit ? 1.45 : 0.1,
    roughness: 0.22,
    castShadow: false,
  };
  const altColor = ctx.variant.id === 'mint' ? '#F7B4C6' : '#A6EAD6';
  const altOpts = {
    emissive: altColor,
    emissiveIntensity: lit ? 1.4 : 0.1,
    roughness: 0.22,
    castShadow: false,
  };
  const warmColor = '#FFF0CC';
  const warmOpts = {
    emissive: warmColor,
    emissiveIntensity: lit ? 1.25 : 0.08,
    roughness: 0.25,
    castShadow: false,
  };

  // Outer glowing neon border frame tubes + dark acrylic mounting standoff clips
  const bw = w - 0.10;
  const bh = h - 0.10;
  ctx.cyl(0.011, 0.011, bw, 6, tubeColor, 0, bh / 2, tubeZ, { ...tubeOpts, rotZ: Math.PI / 2 });
  ctx.cyl(0.011, 0.011, bw, 6, tubeColor, 0, -bh / 2, tubeZ, { ...tubeOpts, rotZ: Math.PI / 2 });
  ctx.cyl(0.011, 0.011, bh, 6, tubeColor, -bw / 2, 0, tubeZ, tubeOpts);
  ctx.cyl(0.011, 0.011, bh, 6, tubeColor, bw / 2, 0, tubeZ, tubeOpts);

  const addNeonClip = (cx: number, cy: number): void => {
    ctx.cyl(0.007, 0.007, 0.026, 6, '#1E222A', cx, cy, backD + 0.011, {
      rotX: Math.PI / 2,
      roughness: 0.6,
      castShadow: false,
    });
  };
  addNeonClip(0, bh / 2);
  addNeonClip(0, -bh / 2);

  // Sculpted neon martini cocktail glass on left side + mounting clips
  const mx = -0.17;
  ctx.cyl(0.011, 0.011, 0.22, 6, tubeColor, mx, 0.11, tubeZ, { ...tubeOpts, rotZ: Math.PI / 2 });
  ctx.cyl(0.011, 0.011, 0.18, 6, tubeColor, mx - 0.052, 0.032, tubeZ, { ...tubeOpts, rotZ: 0.62 });
  ctx.cyl(0.011, 0.011, 0.18, 6, tubeColor, mx + 0.052, 0.032, tubeZ, { ...tubeOpts, rotZ: -0.62 });
  ctx.cyl(0.011, 0.011, 0.14, 6, tubeColor, mx, -0.105, tubeZ, tubeOpts);
  ctx.cyl(0.011, 0.011, 0.12, 6, tubeColor, mx, -0.17, tubeZ, { ...tubeOpts, rotZ: Math.PI / 2 });
  addNeonClip(mx, 0.11);
  addNeonClip(mx, -0.17);
  // Contrasting glowing neon garnish olive/cherry + stirrer stick
  ctx.cyl(0.008, 0.008, 0.11, 6, altColor, mx + 0.032, 0.11, tubeZ + 0.004, { ...altOpts, rotZ: -0.45 });
  ctx.sphere(0.022, 7, altColor, mx + 0.012, 0.072, tubeZ + 0.006, altOpts);

  // 3 staggered glowing neon drink-menu line bars on right side + mounting clips
  const lineSpecs: [number, number][] = [
    [0.10, 0.26],
    [0.0, 0.21],
    [-0.10, 0.24],
  ];
  for (const [ly, lw] of lineSpecs) {
    ctx.cyl(0.011, 0.011, lw, 6, warmColor, 0.03 + lw / 2, ly, tubeZ, {
      ...warmOpts,
      rotZ: Math.PI / 2,
    });
    addNeonClip(0.03 + lw / 2, ly);
  }
}

/** 15. bottle_shelf (1x1, wall mounted, h 0.60) */
function buildBottleShelf(ctx: ModelContext): void {
  const w = 0.84;
  const shelfD = 0.19;
  const isBrass = ctx.variant.id === 'brass';
  const shelfOpts = {
    metalness: isBrass ? 0.68 : 0.05,
    roughness: isBrass ? 0.3 : 0.62,
  };

  // Two wall-mounted horizontal shelves + brass side brackets & guard rails
  const tierYs = [-0.24, 0.06];
  for (const ty of tierYs) {
    ctx.box(w, 0.03, shelfD, ctx.primary, 0, ty, shelfD / 2, shelfOpts);
    for (const sx of [-w / 2 + 0.06, w / 2 - 0.06]) {
      ctx.box(0.02, 0.06, shelfD - 0.03, BRASS, sx, ty - 0.04, shelfD / 2, { metalness: 0.76, roughness: 0.26 });
    }
    // Slender front brass bottle guard rail anchored into shelf by twin end-posts
    ctx.cyl(0.006, 0.006, w - 0.06, 6, BRASS, 0, ty + 0.052, shelfD - 0.014, {
      rotZ: Math.PI / 2,
      metalness: 0.78,
      roughness: 0.24,
    });
    for (const px of [-w / 2 + 0.034, w / 2 - 0.034]) {
      ctx.cyl(0.006, 0.006, 0.044, 6, BRASS, px, ty + 0.034, shelfD - 0.014, {
        metalness: 0.78,
        roughness: 0.24,
      });
    }
  }

  // 7 colorful translucent glass bar bottles (4 bottom tier, 3 top tier)
  const bottles: { x: number; y: number; r: number; h: number; col: string; cap: string }[] = [
    // Bottom tier (4 bottles)
    { x: -0.30, y: tierYs[0] + 0.015, r: 0.044, h: 0.175, col: '#D99455', cap: '#6B462B' },
    { x: -0.10, y: tierYs[0] + 0.015, r: 0.048, h: 0.155, col: ctx.accent, cap: BRASS },
    { x: 0.10, y: tierYs[0] + 0.015, r: 0.040, h: 0.195, col: '#E38B96', cap: '#FAF5EC' },
    { x: 0.30, y: tierYs[0] + 0.015, r: 0.046, h: 0.165, col: '#84B8D8', cap: CHROME },
    // Top tier (3 bottles)
    { x: -0.24, y: tierYs[1] + 0.015, r: 0.046, h: 0.185, col: '#95C49B', cap: '#C99B6B' },
    { x: 0.01, y: tierYs[1] + 0.015, r: 0.052, h: 0.16, col: '#E9C46C', cap: '#6B462B' },
    { x: 0.25, y: tierYs[1] + 0.015, r: 0.042, h: 0.195, col: '#B79AD6', cap: BRASS },
  ];

  for (const b of bottles) {
    // Glass bottle body
    ctx.cyl(b.r, b.r * 1.04, b.h, 8, b.col, b.x, b.y + b.h / 2, 0.10, {
      opacity: 0.82,
      roughness: 0.18,
    });
    // Bottle neck + cork/cap
    ctx.cyl(b.r * 0.36, b.r * 0.56, 0.062, 7, b.col, b.x, b.y + b.h + 0.028, 0.10, {
      opacity: 0.82,
      roughness: 0.18,
    });
    ctx.cyl(b.r * 0.4, b.r * 0.36, 0.024, 7, b.cap, b.x, b.y + b.h + 0.065, 0.10);
    // Crisp cream paper label band
    ctx.cyl(b.r * 1.03, b.r * 1.04, b.h * 0.38, 8, '#F6F0E4', b.x, b.y + b.h * 0.48, 0.10, {
      roughness: 0.88,
    });
  }
}

/** 16. menu_easel (1x1, floor, h 1.15) */
function buildMenuEasel(ctx: ModelContext): void {
  const frameW = 0.64;
  const legH = 1.12;
  const tilt = 0.19;
  const slateColor = ctx.shade(ctx.accent, -0.36);

  // Two hinged A-frame boards leaning together at top apex (front +Z and rear -Z)
  for (const side of [1, -1]) {
    const face = new THREE.Group();
    face.position.set(0, FLOOR_BASE_Y + 0.552, side * 0.13);
    face.rotation.x = side * -tilt;
    ctx.group.add(face);

    // Left & right full-length wooden A-frame legs
    for (const sx of [-frameW / 2 + 0.03, frameW / 2 - 0.03]) {
      ctx.box(0.052, legH, 0.036, ctx.primary, sx, 0, 0, { parent: face });
    }
    // Top & lower cross rails strictly between legs (zero corner overlap)
    ctx.box(frameW - 0.112, 0.056, 0.038, ctx.primary, 0, 0.50, 0, { parent: face });
    ctx.box(frameW - 0.112, 0.052, 0.038, ctx.primary, 0, -0.30, 0, { parent: face });

    // Slate chalkboard panel
    ctx.box(frameW - 0.112, 0.744, 0.018, slateColor, 0, 0.10, 0, { parent: face, roughness: 0.92 });

    // Chalk café icon & menu lines on front (+Z) face
    if (side === 1) {
      const cz = 0.014;
      // Pastel chalk coffee cup emblem header
      ctx.box(0.11, 0.085, 0.008, '#F7F1E3', 0, 0.30, cz, { parent: face, roughness: 0.95 });
      ctx.torus(0.026, 0.007, 5, 8, '#F7F1E3', 0.06, 0.305, cz, { parent: face });
      ctx.box(0.16, 0.012, 0.008, '#F2D68D', 0, 0.25, cz, { parent: face });
      // Stylized chalk menu lines
      ctx.box(0.36, 0.022, 0.008, '#F2C2BA', 0, 0.14, cz, { parent: face });
      ctx.box(0.32, 0.018, 0.008, '#F7F1E3', -0.02, 0.04, cz, { parent: face });
      ctx.box(0.38, 0.018, 0.008, '#BCE0CD', 0.01, -0.06, cz, { parent: face });
      ctx.box(0.28, 0.018, 0.008, '#F2D68D', -0.03, -0.16, cz, { parent: face });
    }
  }

  // Brass apex hinge bar + two side brass A-frame chain stays
  ctx.cyl(0.018, 0.018, frameW + 0.02, 8, BRASS, 0, FLOOR_BASE_Y + 1.07, 0, {
    rotZ: Math.PI / 2,
    metalness: 0.76,
    roughness: 0.26,
  });
  for (const sx of [-frameW / 2 + 0.056, frameW / 2 - 0.056]) {
    ctx.box(0.012, 0.012, 0.34, BRASS, sx, FLOOR_BASE_Y + 0.24, 0, {
      metalness: 0.76,
      roughness: 0.26,
    });
  }
}

/** 17. cup_stack (1x1, surface, h 0.28) */
function buildCupStack(ctx: ModelContext): void {
  // Left tower: ceramic saucer + 3 neatly stacked pastel coffee mugs with playfully angled handles
  const stackX = -0.065;
  ctx.cyl(0.095, 0.072, 0.014, 12, ctx.accent, stackX, 0.007, -0.01, { roughness: 0.34 });

  const mugSpecs = [
    { y: 0.014, col: ctx.primary, rotY: 0.35 },
    { y: 0.098, col: ctx.accent, rotY: 1.45 },
    { y: 0.182, col: ctx.shade(ctx.primary, 0.08), rotY: -0.55 },
  ];
  for (const m of mugSpecs) {
    const mugGroup = new THREE.Group();
    mugGroup.position.set(stackX, m.y, -0.01);
    mugGroup.rotation.y = m.rotY;
    ctx.group.add(mugGroup);

    ctx.cyl(0.056, 0.048, 0.082, 10, m.col, 0, 0.041, 0, { parent: mugGroup, roughness: 0.34 });
    ctx.cyl(0.046, 0.046, 0.006, 10, ctx.shade(m.col, -0.15), 0, 0.085, 0, { parent: mugGroup });
    ctx.torus(0.026, 0.008, 5, 10, m.col, 0.056, 0.042, 0, { parent: mugGroup, roughness: 0.34 });
  }

  // Right companion: standalone fresh latte cup on saucer with latte foam heart disc!
  const cupX = 0.115;
  const cupZ = 0.055;
  ctx.cyl(0.082, 0.062, 0.014, 12, ctx.accent, cupX, 0.007, cupZ, { roughness: 0.34 });
  ctx.cyl(0.054, 0.042, 0.076, 10, ctx.primary, cupX, 0.052, cupZ, { roughness: 0.34 });
  ctx.torus(0.024, 0.008, 5, 10, ctx.primary, cupX + 0.054, 0.054, cupZ, { roughness: 0.34 });
  // Rich espresso crema + pale steamed milk art dot (strictly layered heights)
  ctx.cyl(0.046, 0.046, 0.006, 10, '#A67954', cupX, 0.093, cupZ, { roughness: 0.48 });
  ctx.cyl(0.02, 0.02, 0.005, 8, '#FAF5EC', cupX, 0.0985, cupZ, { roughness: 0.55 });
}

/** 18. cake_stand (1x1, surface, h 0.34, bounce) */
function buildCakeStand(ctx: ModelContext): void {
  // Turned ceramic pedestal stand grounded at local y = 0
  ctx.cyl(0.068, 0.095, 0.022, 12, ctx.accent, 0, 0.011, 0, { roughness: 0.32 });
  ctx.cyl(0.032, 0.044, 0.065, 10, ctx.shade(ctx.accent, -0.04), 0, 0.054, 0, { roughness: 0.32 });
  ctx.cyl(0.175, 0.16, 0.018, 16, ctx.accent, 0, 0.094, 0, { roughness: 0.3 });

  const platterTop = 0.103;
  // Layered frosted pastel cake seated on platter
  const cakeR = 0.118;
  const cakeH = 0.105;
  ctx.cyl(cakeR, cakeR, cakeH, 14, ctx.primary, 0, platterTop + cakeH / 2, 0, { roughness: 0.72 });
  // Cream filling stripe around cake equator
  ctx.cyl(cakeR + 0.003, cakeR + 0.003, 0.022, 14, '#FFF8EE', 0, platterTop + cakeH * 0.48, 0, {
    roughness: 0.78,
  });
  // 6 whipped cream frosting rosettes ringing the cake top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.sphere(0.024, 6, '#FFF9F0', Math.cos(a) * 0.082, platterTop + cakeH + 0.012, Math.sin(a) * 0.082, {
      roughness: 0.75,
      castShadow: false,
    });
  }
  // Center ruby berry crown + tiny mint leaf
  ctx.sphere(0.026, 7, '#DF5569', 0, platterTop + cakeH + 0.022, 0, { scaleY: 1.15, roughness: 0.42 });
  ctx.box(0.03, 0.008, 0.018, '#87B97E', 0.024, platterTop + cakeH + 0.032, 0, { rotZ: 0.38 });

  // Translucent crystal glass cloche dome (true upper hemisphere!) + round glass finial knob
  ctx.cyl(0.155, 0.158, 0.112, 16, GLASS_CLEAR, 0, platterTop + 0.056, 0, {
    opacity: 0.24,
    roughness: 0.1,
    castShadow: false,
  });
  const domeCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    ctx.mat(GLASS_CLEAR, { opacity: 0.24, roughness: 0.1 }),
  );
  domeCap.position.set(0, platterTop + 0.112, 0);
  domeCap.scale.set(1, 0.68, 1);
  domeCap.castShadow = false;
  domeCap.receiveShadow = !ctx.isGhost;
  ctx.group.add(domeCap);
  ctx.sphere(0.022, 8, GLASS_CLEAR, 0, platterTop + 0.228, 0, {
    opacity: 0.48,
    roughness: 0.12,
    castShadow: false,
  });
}

/** 19. tip_jar (1x1, surface, h 0.24, bounce) */
function buildTipJar(ctx: ModelContext): void {
  // Solid thick glass base disc at local y = 0
  ctx.cyl(0.092, 0.095, 0.018, 12, ctx.primary, 0, 0.009, 0, {
    opacity: 0.56,
    roughness: 0.16,
    castShadow: false,
  });

  // Pile of golden & silver coins resting inside the jar bottom
  const coins: [number, number, number, number, string][] = [
    [-0.032, 0.026, 0.024, 0.12, '#ECCD68'],
    [0.034, 0.026, -0.018, -0.15, '#D7DEE6'],
    [0.004, 0.034, 0.012, 0.28, '#ECCD68'],
    [-0.018, 0.038, -0.028, -0.22, '#F2D980'],
    [0.028, 0.04, 0.028, 0.18, '#D7DEE6'],
  ];
  for (const [cx, cy, cz, rz, cc] of coins) {
    ctx.cyl(0.022, 0.022, 0.009, 8, cc, cx, cy, cz, {
      rotZ: rz,
      metalness: 0.78,
      roughness: 0.24,
      castShadow: false,
    });
  }

  // 3 folded crisp pastel-green & mint bills poking cheerfully upward inside the jar
  ctx.box(0.052, 0.13, 0.014, '#9AC8A0', -0.026, 0.105, 0.01, { rotZ: 0.22, rotY: 0.3, castShadow: false });
  ctx.box(0.052, 0.145, 0.014, '#B5DBBA', 0.02, 0.118, -0.012, { rotZ: -0.18, rotY: -0.4, castShadow: false });
  ctx.box(0.048, 0.12, 0.014, '#88BA90', 0.005, 0.10, 0.028, { rotZ: 0.08, rotY: 0.8, castShadow: false });

  // Wide-mouth mason glass jar wall
  ctx.cyl(0.094, 0.098, 0.175, 12, ctx.primary, 0, 0.105, 0, {
    opacity: 0.34,
    roughness: 0.14,
    castShadow: false,
  });
  // Threaded metallic collar rim at jar mouth
  ctx.torus(0.086, 0.012, 6, 14, CHROME, 0, 0.196, 0, {
    rotX: Math.PI / 2,
    metalness: 0.8,
    roughness: 0.24,
  });

  // Warm kraft paper front band + cute heart/coin pip (readable with zero text!)
  ctx.box(0.11, 0.068, 0.012, '#F4ECDC', 0, 0.095, 0.096, { roughness: 0.9 });
  ctx.sphere(0.016, 6, '#E48B92', 0, 0.095, 0.104, { scaleY: 0.9 });
}

/** 20. diner_jukebox (1x1, floor, h 1.45, toggle: play track) */
function buildDinerJukebox(ctx: ModelContext): void {
  const w = 0.78;
  const d = 0.62;
  const plinthH = 0.08;
  const bodyBottom = FLOOR_BASE_Y + plinthH;
  const bodyH = 0.96;
  const archCenterY = bodyBottom + bodyH;
  const archR = w / 2;
  const frontZ = d / 2;

  // Grounded vintage wood plinth base
  ctx.box(w + 0.02, plinthH, d + 0.02, WALNUT, 0, FLOOR_BASE_Y + plinthH / 2, 0);

  // Main retro enamel lower cabinet body
  ctx.box(w, bodyH, d, ctx.primary, 0, bodyBottom + bodyH / 2, 0, { roughness: 0.42 });

  // Iconic Wurlitzer semi-circular arched top drum!
  ctx.cyl(archR - 0.002, archR - 0.002, d - 0.002, 16, ctx.primary, 0, archCenterY, 0, {
    rotX: Math.PI / 2,
    roughness: 0.4,
  });

  const lit = ctx.isActive;
  const neonColor = ctx.accent; // Warm butter-gold #F2DF9F
  const neonOpts = {
    emissive: lit ? neonColor : neonColor,
    emissiveIntensity: lit ? 1.35 : 0.12,
    roughness: 0.22,
    castShadow: false,
  };
  const pinkAccent = ctx.variant.id === 'coral' ? '#9EE6DC' : '#F4A6BE';
  const pinkOpts = {
    emissive: pinkAccent,
    emissiveIntensity: lit ? 1.25 : 0.1,
    roughness: 0.24,
    castShadow: false,
  };

  // Glowing semicircular upper arch neon rim halo + chrome crown arch (arc = Math.PI!)
  const neonArch = new THREE.Mesh(
    new THREE.TorusGeometry(archR - 0.048, 0.024, 6, 16, Math.PI),
    ctx.mat(neonColor, neonOpts),
  );
  neonArch.position.set(0, archCenterY, frontZ + 0.008);
  ctx.group.add(neonArch);

  const chromeArch = new THREE.Mesh(
    new THREE.TorusGeometry(archR - 0.006, 0.018, 6, 16, Math.PI),
    ctx.mat(CHROME, { metalness: 0.85, roughness: 0.18 }),
  );
  chromeArch.position.set(0, archCenterY, frontZ + 0.004);
  chromeArch.castShadow = !ctx.isGhost;
  ctx.group.add(chromeArch);

  // Glowing twin vertical neon bubble pilasters framing left & right edges
  for (const sx of [-w / 2 + 0.048, w / 2 - 0.048]) {
    ctx.cyl(0.028, 0.028, bodyH - 0.02, 8, neonColor, sx, bodyBottom + bodyH / 2, frontZ + 0.006, neonOpts);
    ctx.cyl(0.016, 0.016, bodyH - 0.16, 8, pinkAccent, sx * 0.80, bodyBottom + bodyH / 2, frontZ + 0.012, pinkOpts);
  }

  // Recessed arched glass record showcase window cleanly above title display + vinyl disc inside!
  ctx.cyl(0.195, 0.195, 0.026, 14, lit ? '#FFF5DC' : '#3C424C', 0, archCenterY + 0.085, frontZ + 0.002, {
    rotX: Math.PI / 2,
    emissive: lit ? '#FFE099' : undefined,
    emissiveIntensity: lit ? 0.65 : 0,
  });
  ctx.cyl(0.125, 0.125, 0.014, 12, '#222428', 0, archCenterY + 0.09, frontZ + 0.022, {
    rotX: Math.PI / 2,
    roughness: 0.3,
  });
  ctx.cyl(0.042, 0.042, 0.010, 10, ctx.primary, 0, archCenterY + 0.09, frontZ + 0.034, {
    rotX: Math.PI / 2,
  });

  // Illuminated horizontal song-title flip-card display strip + selector buttons
  const titleY = bodyBottom + bodyH * 0.78;
  ctx.box(0.50, 0.16, 0.03, '#FAF4E4', 0, titleY, frontZ + 0.012, {
    emissive: lit ? '#FFE8B0' : undefined,
    emissiveIntensity: lit ? 0.85 : 0,
  });
  // Brushed chrome selector button housing bar + 5 colorful push-buttons seated cleanly inside
  ctx.box(0.48, 0.054, 0.022, CHROME, 0, titleY - 0.125, frontZ + 0.010, {
    metalness: 0.84,
    roughness: 0.2,
  });
  const btnColors = ['#E88A80', '#F2D27C', '#9AD4BE', '#9BBCE3', '#D4A8E0'];
  for (let i = 0; i < 5; i++) {
    ctx.box(0.066, 0.034, 0.020, btnColors[i], -0.17 + i * 0.085, titleY - 0.125, frontZ + 0.022, {
      emissive: lit ? btnColors[i] : undefined,
      emissiveIntensity: lit ? 0.55 : 0,
    });
  }

  // Lower acoustic speaker grille with strictly layered vertical ribs & horizontal bumper
  const grillY = bodyBottom + bodyH * 0.28;
  const grillH = 0.42;
  ctx.box(0.48, grillH, 0.020, '#3A3533', 0, grillY, frontZ + 0.010, { roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const rx = -0.16 + i * 0.08;
    ctx.box(0.018, grillH - 0.03, 0.014, CHROME, rx, grillY, frontZ + 0.027, {
      metalness: 0.84,
      roughness: 0.2,
    });
  }
  // Chrome horizontal accent bumper strictly in front of vertical ribs
  ctx.box(0.50, 0.036, 0.016, CHROME, 0, grillY, frontZ + 0.042, {
    metalness: 0.86,
    roughness: 0.18,
  });
}

export const buildCafeBarModel: TabModelBuilder = (ctx) => {
  switch (ctx.def.id) {
    case 'cafe_counter':
      buildCafeCounter(ctx);
      return true;
    case 'espresso_machine':
      buildEspressoMachine(ctx);
      return true;
    case 'blender_smoothie':
      buildBlenderSmoothie(ctx);
      return true;
    case 'smoothie_station':
      buildSmoothieStation(ctx);
      return true;
    case 'bar_counter':
      buildBarCounter(ctx);
      return true;
    case 'bar_stool':
      buildBarStool(ctx);
      return true;
    case 'pastry_case':
      buildPastryCase(ctx);
      return true;
    case 'chalkboard_menu':
      buildChalkboardMenu(ctx);
      return true;
    case 'cafe_bistro_table':
      buildCafeBistroTable(ctx);
      return true;
    case 'cafe_booth':
      buildCafeBooth(ctx);
      return true;
    case 'coffee_grinder':
      buildCoffeeGrinder(ctx);
      return true;
    case 'pourover_stand':
      buildPouroverStand(ctx);
      return true;
    case 'cocktail_shaker':
      buildCocktailShaker(ctx);
      return true;
    case 'neon_drink_menu':
      buildNeonDrinkMenu(ctx);
      return true;
    case 'bottle_shelf':
      buildBottleShelf(ctx);
      return true;
    case 'menu_easel':
      buildMenuEasel(ctx);
      return true;
    case 'cup_stack':
      buildCupStack(ctx);
      return true;
    case 'cake_stand':
      buildCakeStand(ctx);
      return true;
    case 'tip_jar':
      buildTipJar(ctx);
      return true;
    case 'diner_jukebox':
      buildDinerJukebox(ctx);
      return true;
    default:
      return false;
  }
};
