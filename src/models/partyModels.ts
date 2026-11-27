import * as THREE from 'three';
import { FLOOR_BASE_Y, type ModelContext, type TabModelBuilder } from './ModelKit';

/**
 * Helper to place an angled cylinder segment connecting two 3D points.
 */
function addSegment(
  ctx: ModelContext,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  color: string | number,
  segs = 6,
  opts?: {
    roughness?: number;
    metalness?: number;
    parent?: THREE.Object3D;
    castShadow?: boolean;
  },
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const mesh = ctx.cyl(radius, radius, len, segs, color, mid.x, mid.y, mid.z, {
    roughness: opts?.roughness,
    metalness: opts?.metalness,
    parent: opts?.parent,
    castShadow: opts?.castShadow,
  });
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/**
 * Helper to add a custom BufferGeometry mesh using ModelKit material & shadow rules.
 */
function addCustomMesh(
  ctx: ModelContext,
  geometry: THREE.BufferGeometry,
  color: string | number,
  x: number,
  y: number,
  z: number,
  opts?: {
    roughness?: number;
    metalness?: number;
    emissive?: string | number;
    emissiveIntensity?: number;
    opacity?: number;
    flatShading?: boolean;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    parent?: THREE.Object3D;
    name?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;
  },
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

function buildDjBooth(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const darkSlate = '#3B404B';
  const deckTopColor = '#464C58';
  const brightTint = shade(primary, 0.24);
  const deepTint = shade(primary, -0.18);

  // Recessed kickplate plinth
  ctx.box(1.74, 0.08, 0.72, darkSlate, 0, baseY + 0.04, 0, { roughness: 0.72 });

  // Sculpted main booth cabinet (y = 0.104 .. 0.994)
  ctx.box(1.80, 0.89, 0.78, primary, 0, baseY + 0.08 + 0.445, 0, { roughness: 0.65 });

  // Architectural side frame pillars for crisp silhouette (inset slightly from top/bottom to avoid coplanar Z-fighting)
  for (const sx of [-0.88, 0.88]) {
    ctx.box(0.08, 0.878, 0.82, deepTint, sx, baseY + 0.08 + 0.445, 0.01, { roughness: 0.62 });
  }

  // Front recessed fascia bay (+Z)
  ctx.box(1.56, 0.72, 0.036, '#2F3440', 0, baseY + 0.52, 0.396, { roughness: 0.6 });

  // Top & bottom illuminated pastel fascia LED rails
  const ledGlow = isActive ? 1.05 : 0.22;
  ctx.box(1.52, 0.034, 0.028, brightTint, 0, baseY + 0.852, 0.424, {
    emissive: primary,
    emissiveIntensity: ledGlow,
    roughness: 0.3,
  });
  ctx.box(1.52, 0.034, 0.028, brightTint, 0, baseY + 0.198, 0.424, {
    emissive: primary,
    emissiveIntensity: ledGlow,
    roughness: 0.3,
  });

  // 3 bold geometric VU equalizer bars on the front fascia
  const eqHeights = [0.34, 0.54, 0.40];
  const eqColors = ['#9FE0DC', brightTint, '#F2B8C8'];
  for (let i = 0; i < 3; i++) {
    const ex = (i - 1) * 0.36;
    const eh = eqHeights[i];
    const col = eqColors[i];
    ctx.box(0.18, eh, 0.028, col, ex, baseY + 0.232 + eh / 2, 0.422, {
      emissive: col,
      emissiveIntensity: isActive ? 0.98 : 0.16,
      roughness: 0.32,
    });
  }

  // Top counter deck slab — flat top sits right at y = 1.05 (surfaceHeight)
  const deckY = 1.05;
  ctx.box(1.88, 0.056, 0.86, deckTopColor, 0, deckY - 0.028, 0, {
    roughness: 0.45,
    metalness: 0.15,
  });
  ctx.box(1.89, 0.018, 0.03, brightTint, 0, deckY - 0.018, 0.43, {
    emissive: isActive ? primary : undefined,
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });

  // Center DJ mixer console
  ctx.box(0.40, 0.028, 0.44, '#2E323D', 0, deckY + 0.014, 0.03, { roughness: 0.52 });
  // 4 channel fader caps
  const faderOffsets = [-0.04, 0.05, -0.02, 0.03];
  for (let i = 0; i < 4; i++) {
    const fx = -0.12 + i * 0.08;
    ctx.box(0.028, 0.018, 0.026, '#DCE3EC', fx, deckY + 0.035, 0.06 + faderOffsets[i], {
      metalness: 0.5,
      roughness: 0.3,
    });
  }
  // Crossfader knob at front of mixer
  ctx.box(0.024, 0.018, 0.030, brightTint, 0.02, deckY + 0.035, 0.19);
  // Lit pastel cue pad strips along rear of mixer
  for (let i = 0; i < 2; i++) {
    const padCol = i === 0 ? primary : '#9FE0DC';
    ctx.box(0.135, 0.012, 0.058, padCol, i === 0 ? -0.085 : 0.085, deckY + 0.032, -0.11, {
      emissive: padCol,
      emissiveIntensity: isActive ? 1.05 : 0.2,
      roughness: 0.3,
    });
  }

  // Twin vinyl turntables (each spinning platter sub-group named 'SpinTarget')
  const deckPositions = [-0.56, 0.56];
  for (let d = 0; d < 2; d++) {
    const dx = deckPositions[d];
    const labelColor = d === 0 ? primary : accent;

    // Turntable brushed plinth
    ctx.box(0.48, 0.026, 0.44, '#4B515E', dx, deckY + 0.013, 0.03, {
      roughness: 0.42,
      metalness: 0.28,
    });

    // Spinning platter group centered at spindle so rotation.y spins cleanly in place
    const platter = new THREE.Group();
    platter.name = 'SpinTarget';
    platter.userData.spinAxis = 'y';
    platter.userData.spinSpeed = 2.4;
    platter.position.set(dx - 0.02, deckY + 0.032, 0.03);
    ctx.group.add(platter);

    ctx.cyl(0.178, 0.184, 0.014, 16, '#C8CFD8', 0, 0, 0, {
      metalness: 0.65,
      roughness: 0.28,
      parent: platter,
    });
    ctx.cyl(0.168, 0.168, 0.006, 18, '#22252C', 0, 0.011, 0, {
      roughness: 0.28,
      metalness: 0.15,
      parent: platter,
    });
    ctx.cyl(0.060, 0.060, 0.006, 12, labelColor, 0, 0.017, 0, {
      emissive: isActive ? labelColor : undefined,
      emissiveIntensity: 0.38,
      roughness: 0.45,
      parent: platter,
    });
    // Cue marker stripe on label so vinyl spin is unmistakable
    ctx.box(0.028, 0.005, 0.012, '#FFFFFF', 0.036, 0.0225, 0, { parent: platter });

    // Metallic tonearm pivot + angled arm (cleanly clear of platter rim)
    const pivotX = dx + 0.194;
    const pivotZ = -0.115;
    ctx.cyl(0.024, 0.028, 0.036, 8, '#C8CFD8', pivotX, deckY + 0.042, pivotZ, {
      metalness: 0.72,
      roughness: 0.25,
    });
    addSegment(
      ctx,
      new THREE.Vector3(pivotX, deckY + 0.056, pivotZ),
      new THREE.Vector3(dx + 0.100, deckY + 0.050, 0.115),
      0.008,
      '#DCE3EC',
      6,
      { metalness: 0.78, roughness: 0.2 },
    );
  }

  // Cozy DJ headphones resting on right front corner
  ctx.torus(0.072, 0.012, 6, 12, '#353A45', 0.84, deckY + 0.028, 0.28, {
    rotX: Math.PI / 2,
    rotZ: 0.4,
  });
  ctx.cyl(0.038, 0.038, 0.028, 10, primary, 0.78, deckY + 0.024, 0.32, {
    rotZ: Math.PI / 2,
  });
  ctx.cyl(0.038, 0.038, 0.028, 10, primary, 0.88, deckY + 0.024, 0.22, {
    rotZ: Math.PI / 2,
  });
}

function buildSpeakerTower(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // 4 tapered isolation feet
  ctx.legs(0.52, 0.44, 0.056, 0.026, '#484D58', baseY, 0.06);

  // Main tall acoustic tower cabinet (y = 0.08 .. 1.35)
  const cabH = 1.27;
  const cabY = baseY + 0.056 + cabH / 2;
  ctx.box(0.54, cabH, 0.46, primary, 0, cabY, 0, { roughness: 0.68 });

  // Subtle top bevel cap
  ctx.box(0.50, 0.024, 0.42, shade(primary, 0.12), 0, baseY + 0.056 + cabH + 0.008, 0, {
    roughness: 0.6,
  });

  // Recessed matte dark acoustic front baffle (+Z)
  ctx.box(0.46, 1.18, 0.032, '#323640', 0, cabY, 0.224, { roughness: 0.82 });

  // Upper silk-dome tweeter (y = 1.15)
  const twY = 1.15;
  ctx.torus(0.062, 0.012, 6, 14, accent, 0, twY, 0.242, {
    metalness: 0.45,
    roughness: 0.3,
  });
  ctx.cyl(0.056, 0.056, 0.016, 12, '#22252C', 0, twY, 0.236, { rotX: Math.PI / 2 });
  ctx.sphere(0.030, 8, '#D6DCE5', 0, twY, 0.244, {
    scaleZ: 0.5,
    metalness: 0.6,
    roughness: 0.25,
  });

  // Two recessed woofers (mid at y = 0.82, bass at y = 0.45)
  const drivers = [
    { y: 0.82, r: 0.128 },
    { y: 0.45, r: 0.146 },
  ];
  for (const drv of drivers) {
    // Outer metallic/accent surround trim ring
    ctx.torus(drv.r, 0.016, 6, 16, accent, 0, drv.y, 0.244, {
      metalness: 0.35,
      roughness: 0.32,
    });
    // Rubber roll surround
    ctx.torus(drv.r * 0.86, 0.012, 6, 14, '#21242B', 0, drv.y, 0.242, {
      roughness: 0.5,
    });
    // Recessed concave woofer cone pointing inward (-Z)
    ctx.cone(drv.r * 0.84, 0.062, 14, '#292D36', 0, drv.y, 0.222, {
      rotX: -Math.PI / 2,
      roughness: 0.6,
    });
    // Central glossy dust cap dome
    ctx.sphere(drv.r * 0.34, 8, '#3E4350', 0, drv.y, 0.236, {
      scaleZ: 0.52,
      roughness: 0.3,
      metalness: 0.28,
    });
  }

  // Bottom bass reflex port slot + tiny power indicator LED
  ctx.box(0.26, 0.052, 0.03, '#191B21', 0, 0.18, 0.234);
  ctx.box(0.28, 0.012, 0.032, accent, 0, 0.148, 0.238, { metalness: 0.3 });
  ctx.sphere(0.012, 6, '#9AE6B4', 0.175, 1.24, 0.246, {
    emissive: '#9AE6B4',
    emissiveIntensity: 0.85,
  });
}

function buildSubwooferBox(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // 4 chunky rubber vibration feet
  ctx.legs(0.64, 0.60, 0.042, 0.042, '#343842', baseY, 0.08);

  // Stout bass enclosure cube (y = 0.066 .. 0.676)
  const boxH = 0.61;
  const boxY = baseY + 0.042 + boxH / 2;
  ctx.box(0.66, boxH, 0.62, primary, 0, boxY, 0, { roughness: 0.7 });

  // Chamfered top cap + side accent protective rails
  ctx.box(0.60, 0.022, 0.56, shade(primary, 0.10), 0, baseY + 0.042 + boxH + 0.008, 0);
  for (const sx of [-0.33, 0.33]) {
    ctx.box(0.024, 0.10, 0.20, '#363A45', sx, boxY + 0.04, 0);
  }

  // Recessed front baffle
  ctx.box(0.58, 0.53, 0.03, '#2D313B', 0, boxY, 0.302, { roughness: 0.82 });

  // Huge recessed front woofer (y = 0.42)
  const wY = 0.42;
  ctx.torus(0.202, 0.020, 7, 18, accent, 0, wY, 0.322, {
    metalness: 0.35,
    roughness: 0.3,
  });
  ctx.torus(0.176, 0.018, 6, 16, '#1E2128', 0, wY, 0.320, { roughness: 0.48 });
  ctx.cone(0.168, 0.085, 16, '#282C35', 0, wY, 0.292, {
    rotX: -Math.PI / 2,
    roughness: 0.62,
  });
  ctx.sphere(0.066, 9, '#3E4452', 0, wY, 0.314, {
    scaleZ: 0.55,
    roughness: 0.28,
    metalness: 0.3,
  });

  // Wide front bass reflex port slot
  ctx.box(0.44, 0.062, 0.032, '#17191F', 0, 0.145, 0.312);
  ctx.box(0.46, 0.012, 0.035, accent, 0, 0.108, 0.316);

  // Subtle status LED on upper right bezel
  ctx.sphere(0.013, 6, accent, 0.23, 0.60, 0.322, {
    emissive: accent,
    emissiveIntensity: 0.9,
  });
}

function buildFloorUplight(ctx: ModelContext): void {
  const { primary, isActive, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const housingColor = '#4E5563';

  // Weighted circular floor plate
  ctx.cyl(0.17, 0.19, 0.028, 12, housingColor, 0, baseY + 0.014, 0, {
    metalness: 0.45,
    roughness: 0.42,
  });

  // Twin U-yoke floor bracket arms & tension thumb-knobs
  for (const sx of [-0.135, 0.135]) {
    ctx.box(0.026, 0.17, 0.05, '#626A79', sx, baseY + 0.10, 0, {
      metalness: 0.5,
      roughness: 0.38,
    });
    ctx.cyl(0.024, 0.024, 0.028, 8, primary, sx * 1.18, baseY + 0.165, 0, {
      rotZ: Math.PI / 2,
      roughness: 0.4,
    });
  }

  // Angled PAR-can fixture group tilting slightly forward & upward (+Z / +Y)
  const can = new THREE.Group();
  can.position.set(0, baseY + 0.165, 0);
  can.rotation.x = 0.28;
  ctx.group.add(can);

  ctx.cyl(0.114, 0.092, 0.20, 12, housingColor, 0, 0.02, 0, {
    metalness: 0.55,
    roughness: 0.34,
    parent: can,
  });
  // Rear cooling cap
  ctx.cyl(0.088, 0.072, 0.036, 12, '#393E4A', 0, -0.095, 0, {
    metalness: 0.5,
    roughness: 0.4,
    parent: can,
  });
  // Pastel rim collar
  ctx.torus(0.114, 0.014, 6, 14, primary, 0, 0.114, 0, {
    rotX: Math.PI / 2,
    roughness: 0.4,
    parent: can,
  });

  // Recessed LED lens disc (cleanly proud of PAR-can rim)
  const lensCol = isActive ? '#FFFFFF' : shade(primary, 0.18);
  ctx.cyl(0.096, 0.096, 0.012, 12, lensCol, 0, 0.128, 0, {
    emissive: isActive ? primary : undefined,
    emissiveIntensity: isActive ? 1.35 : 0,
    roughness: 0.16,
    parent: can,
  });

  // 3 tiny LED emitter pearls inside lens
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.sphere(0.018, 6, isActive ? '#FFFFFF' : primary, Math.cos(a) * 0.042, 0.138, Math.sin(a) * 0.042, {
      emissive: isActive ? primary : undefined,
      emissiveIntensity: isActive ? 1.5 : 0,
      parent: can,
    });
  }

  // Soft open-ended translucent upward glow cone when active
  if (isActive) {
    const outerCone = addCustomMesh(
      ctx,
      new THREE.CylinderGeometry(0.25, 0.094, 0.50, 14, 1, true),
      primary,
      0,
      0.38,
      0,
      {
        opacity: 0.13,
        emissive: primary,
        emissiveIntensity: 0.8,
        roughness: 0.12,
        castShadow: false,
        receiveShadow: false,
        parent: can,
      },
    );
    (outerCone.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;

    const innerCone = addCustomMesh(
      ctx,
      new THREE.CylinderGeometry(0.145, 0.068, 0.36, 12, 1, true),
      shade(primary, 0.28),
      0,
      0.31,
      0,
      {
        opacity: 0.18,
        emissive: primary,
        emissiveIntensity: 1.0,
        roughness: 0.12,
        castShadow: false,
        receiveShadow: false,
        parent: can,
      },
    );
    (innerCone.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }
}

function buildDiscoBall(ctx: ModelContext): void {
  const { primary, isActive, shade } = ctx;

  // Ceiling canopy & hanging metallic rod
  ctx.cyl(0.105, 0.125, 0.026, 12, '#CFD6E0', 0, -0.013, 0, {
    metalness: 0.68,
    roughness: 0.24,
  });
  ctx.cyl(0.015, 0.015, 0.22, 8, '#B6BFC9', 0, -0.12, 0, {
    metalness: 0.75,
    roughness: 0.22,
  });
  ctx.cyl(0.044, 0.056, 0.032, 10, '#D8DFE8', 0, -0.23, 0, {
    metalness: 0.72,
    roughness: 0.22,
  });

  // Spinning faceted mirror sphere sub-group
  const spinGroup = new THREE.Group();
  spinGroup.name = 'SpinTarget';
  spinGroup.userData.spinAxis = 'y';
  spinGroup.userData.spinSpeed = 1.6;
  spinGroup.position.set(0, -0.44, 0);
  ctx.group.add(spinGroup);

  addCustomMesh(ctx, new THREE.IcosahedronGeometry(0.205, 1), primary, 0, 0, 0, {
    metalness: 0.78,
    roughness: 0.16,
    flatShading: true,
    emissive: isActive ? primary : undefined,
    emissiveIntensity: isActive ? 0.32 : 0,
    parent: spinGroup,
  });

  // Bright mirror glint tiles oriented strictly radially outward in local spinGroup space
  const sparkleColors = ['#FFFFFF', shade(primary, 0.35), '#FFF4D6', '#E5F7FF'];
  const tileSpecs: Array<{ lat: number; lon: number; idx: number }> = [
    { lat: 0, lon: 0, idx: 0 },
    { lat: 0, lon: Math.PI / 3, idx: 1 },
    { lat: 0, lon: (2 * Math.PI) / 3, idx: 2 },
    { lat: 0, lon: Math.PI, idx: 0 },
    { lat: 0, lon: (4 * Math.PI) / 3, idx: 3 },
    { lat: 0, lon: (5 * Math.PI) / 3, idx: 1 },
    { lat: 0.58, lon: 0.5, idx: 0 },
    { lat: 0.58, lon: 2.6, idx: 2 },
    { lat: 0.58, lon: 4.7, idx: 3 },
    { lat: -0.58, lon: 1.5, idx: 1 },
    { lat: -0.58, lon: 3.6, idx: 0 },
    { lat: -0.58, lon: 5.7, idx: 2 },
  ];

  const rTile = 0.204;
  const zForward = new THREE.Vector3(0, 0, 1);
  for (const spec of tileSpecs) {
    const cosLat = Math.cos(spec.lat);
    const tx = rTile * cosLat * Math.cos(spec.lon);
    const ty = rTile * Math.sin(spec.lat);
    const tz = rTile * cosLat * Math.sin(spec.lon);
    const col = sparkleColors[spec.idx];
    const tile = ctx.box(0.048, 0.048, 0.010, col, tx, ty, tz, {
      metalness: 0.65,
      roughness: 0.12,
      emissive: isActive ? col : undefined,
      emissiveIntensity: isActive ? 1.15 : 0,
      parent: spinGroup,
      castShadow: false,
    });
    const outward = new THREE.Vector3(tx, ty, tz).normalize();
    if (outward.z < -0.9999) {
      tile.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    } else {
      tile.quaternion.setFromUnitVectors(zForward, outward);
    }
  }

  // Bottom metallic finial pearl
  ctx.sphere(0.022, 6, '#DFE5EE', 0, -0.212, 0, {
    metalness: 0.78,
    roughness: 0.2,
    parent: spinGroup,
  });
}

function buildLedStripWall(ctx: ModelContext): void {
  const { primary, isActive, shade } = ctx;

  // Slim anodized aluminum wall channel protruding +Z from mounting clips (strictly non-coplanar)
  ctx.box(0.88, 0.068, 0.032, '#565E6B', 0, 0, 0.028, {
    metalness: 0.52,
    roughness: 0.35,
  });

  // Twin mounting clips & tiny power hub end-cap
  for (const sx of [-0.34, 0.34]) {
    ctx.box(0.045, 0.092, 0.012, '#3F4550', sx, 0, 0.006, { metalness: 0.4 });
  }
  ctx.box(0.044, 0.052, 0.040, '#3F4550', 0.464, 0, 0.024);

  // 7 segmented pastel LED diffuser cells
  const segPalette = [
    shade(primary, 0.22),
    primary,
    shade(primary, 0.10),
    '#FFFFFF',
    shade(primary, 0.10),
    primary,
    shade(primary, 0.22),
  ];
  for (let i = 0; i < 7; i++) {
    const sx = (i - 3) * 0.118;
    const col = segPalette[i];
    ctx.box(0.104, 0.042, 0.020, isActive ? col : shade(primary, 0.16), sx, 0, 0.054, {
      emissive: isActive ? primary : undefined,
      emissiveIntensity: isActive ? (i === 3 ? 1.35 : 1.05) : 0,
      roughness: 0.22,
    });
  }

  // Ambient pastel wall-wash glow halo when active
  if (isActive) {
    ctx.box(0.92, 0.18, 0.022, primary, 0, 0, 0.014, {
      opacity: 0.24,
      emissive: primary,
      emissiveIntensity: 0.85,
      castShadow: false,
      receiveShadow: false,
    });
  }
}

function buildFogMachine(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // 4 stubby rubber feet
  ctx.legs(0.38, 0.44, 0.032, 0.028, '#383C46', baseY, 0.05);

  // Compact industrial pastel chassis
  const bodyY = baseY + 0.032 + 0.105;
  ctx.box(0.40, 0.21, 0.46, primary, 0, bodyY, 0, {
    roughness: 0.52,
    metalness: 0.18,
  });
  ctx.box(0.36, 0.024, 0.42, shade(primary, 0.14), 0, bodyY + 0.114, 0, {
    roughness: 0.48,
  });

  // Side ventilation louver slats
  for (const sx of [-0.204, 0.204]) {
    for (let i = -1; i <= 1; i++) {
      ctx.box(0.012, 0.018, 0.18, '#464C58', sx, bodyY + i * 0.042, -0.02);
    }
  }

  // Top arched carry handle (reaches ~0.34)
  for (const sx of [-0.145, 0.145]) {
    ctx.box(0.022, 0.072, 0.026, '#505765', sx, bodyY + 0.145, 0, {
      metalness: 0.5,
      roughness: 0.35,
    });
  }
  ctx.cyl(0.015, 0.015, 0.31, 8, '#505765', 0, bodyY + 0.178, 0, {
    rotZ: Math.PI / 2,
    metalness: 0.5,
    roughness: 0.35,
  });

  // Rear clear fluid reservoir tank + blue-mint fog juice
  ctx.box(0.24, 0.13, 0.10, '#DFF0F6', 0, bodyY - 0.01, -0.26, {
    opacity: 0.55,
    roughness: 0.14,
  });
  ctx.box(0.21, 0.082, 0.076, '#A6E0E8', 0, bodyY - 0.028, -0.26, {
    roughness: 0.25,
  });
  ctx.cyl(0.026, 0.026, 0.028, 8, '#464C58', 0, bodyY + 0.068, -0.26);

  // Front discharge plate, nozzle, and status indicator LED
  ctx.box(0.32, 0.145, 0.024, '#414754', 0, bodyY, 0.236, { roughness: 0.5 });
  ctx.cyl(0.036, 0.046, 0.072, 10, '#C5CDD8', 0, bodyY, 0.272, {
    rotX: Math.PI / 2,
    metalness: 0.68,
    roughness: 0.26,
  });
  ctx.cyl(0.024, 0.024, 0.02, 8, '#1E2026', 0, bodyY, 0.305, { rotX: Math.PI / 2 });
  ctx.sphere(0.014, 6, isActive ? '#6EE7B7' : '#7A818E', 0.115, bodyY + 0.042, 0.254, {
    emissive: isActive ? '#6EE7B7' : undefined,
    emissiveIntensity: 1.2,
  });

  // Drifting translucent puffy mist clouds when active
  if (isActive) {
    const puffs = [
      { x: 0.0, y: bodyY + 0.01, z: 0.36, r: 0.075, op: 0.48 },
      { x: -0.06, y: bodyY + 0.06, z: 0.44, r: 0.105, op: 0.40 },
      { x: 0.07, y: bodyY + 0.05, z: 0.47, r: 0.095, op: 0.38 },
      { x: 0.0, y: bodyY + 0.12, z: 0.54, r: 0.125, op: 0.30 },
      { x: -0.09, y: bodyY + 0.15, z: 0.59, r: 0.10, op: 0.24 },
      { x: 0.08, y: bodyY + 0.17, z: 0.61, r: 0.09, op: 0.20 },
    ];
    for (const p of puffs) {
      ctx.sphere(p.r, 7, accent, p.x, p.y, p.z, {
        scaleX: 1.18,
        scaleY: 0.85,
        scaleZ: 1.12,
        opacity: p.op,
        emissive: accent,
        emissiveIntensity: 0.24,
        roughness: 0.9,
        castShadow: false,
        receiveShadow: false,
      });
    }
  }
}

function buildPartySpotlight(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;

  // Ceiling canopy & twin hanger rods
  ctx.cyl(0.09, 0.10, 0.024, 10, accent, 0, -0.012, 0, {
    metalness: 0.55,
    roughness: 0.35,
  });
  for (const sx of [-0.24, 0.24]) {
    ctx.cyl(0.014, 0.014, 0.16, 6, accent, sx, -0.09, 0, {
      metalness: 0.6,
      roughness: 0.3,
    });
  }

  // Mini lighting truss bar (upper & lower rails + cross struts)
  ctx.box(0.76, 0.022, 0.062, accent, 0, -0.172, 0, { metalness: 0.58, roughness: 0.32 });
  ctx.box(0.76, 0.022, 0.062, accent, 0, -0.228, 0, { metalness: 0.58, roughness: 0.32 });
  for (const sx of [-0.34, -0.11, 0.11, 0.34]) {
    ctx.box(0.020, 0.056, 0.048, shade(accent, -0.12), sx, -0.20, 0, {
      metalness: 0.55,
      roughness: 0.35,
    });
  }

  // 3 angled mini spotlight cans suspended under the truss, aiming down-and-forward (+Z)
  // Note: local lens sits at -Y, so negative rotX tilts (0, -1, 0) toward +Z into the room.
  // Dynamic volumetric beams are projected by SceneManager's LightProjectionRig.
  const canConfigs = [
    { x: -0.26, rotZ: -0.24, rotX: -0.26 },
    { x: 0.0, rotZ: 0.0, rotX: -0.22 },
    { x: 0.26, rotZ: 0.24, rotX: -0.26 },
  ];
  for (const cfg of canConfigs) {
    // Mounting yoke stem
    ctx.box(0.022, 0.045, 0.022, '#535A68', cfg.x, -0.258, 0);

    const can = new THREE.Group();
    can.position.set(cfg.x, -0.30, 0);
    can.rotation.z = cfg.rotZ;
    can.rotation.x = cfg.rotX;
    ctx.group.add(can);

    ctx.cyl(0.046, 0.062, 0.13, 10, accent, 0, 0, 0, {
      metalness: 0.55,
      roughness: 0.34,
      parent: can,
    });
    ctx.torus(0.062, 0.010, 6, 12, primary, 0, -0.062, 0, {
      rotX: Math.PI / 2,
      emissive: isActive ? primary : undefined,
      emissiveIntensity: isActive ? 0.55 : 0,
      parent: can,
    });
    ctx.cyl(0.054, 0.054, 0.014, 10, isActive ? '#FFFFFF' : shade(primary, 0.2), 0, -0.068, 0, {
      emissive: isActive ? primary : undefined,
      emissiveIntensity: isActive ? 1.5 : 0,
      roughness: 0.16,
      parent: can,
    });
  }
}

function buildKaraokeMic(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Heavy round weighted stage base
  ctx.cyl(0.175, 0.205, 0.040, 14, '#464C58', 0, baseY + 0.020, 0, {
    metalness: 0.48,
    roughness: 0.38,
  });
  ctx.cyl(0.054, 0.074, 0.036, 10, accent, 0, baseY + 0.052, 0, {
    metalness: 0.55,
    roughness: 0.32,
  });

  // Telescoping vertical stand pole
  ctx.cyl(0.020, 0.022, 0.68, 8, accent, 0, baseY + 0.40, 0, {
    metalness: 0.62,
    roughness: 0.28,
  });
  ctx.cyl(0.032, 0.032, 0.054, 8, '#3A3F4A', 0, baseY + 0.74, 0, { roughness: 0.6 });
  ctx.cyl(0.014, 0.014, 0.36, 8, '#D2D9E2', 0, baseY + 0.94, 0, {
    metalness: 0.78,
    roughness: 0.2,
  });

  // Boom pivot clutch at y = 1.14 (mic bulb peaks cleanly at ~1.45)
  const pivotY = 1.14;
  ctx.cyl(0.026, 0.026, 0.058, 8, '#3A3F4A', 0, pivotY, 0, { rotZ: Math.PI / 2 });

  // Angled boom arm + handheld microphone pointing up-forward (+Z)
  const boom = new THREE.Group();
  boom.position.set(0, pivotY, 0);
  boom.rotation.x = 1.02;
  ctx.group.add(boom);

  ctx.cyl(0.011, 0.011, 0.44, 8, '#D2D9E2', 0, 0.04, 0, {
    metalness: 0.78,
    roughness: 0.2,
    parent: boom,
  });
  // Rear counterweight cap
  ctx.cyl(0.022, 0.018, 0.052, 8, '#464C58', 0, -0.185, 0, { parent: boom });
  // Mic clip cradle
  ctx.box(0.046, 0.048, 0.048, '#383D47', 0, 0.245, -0.022, { parent: boom });
  // Glossy handheld mic barrel
  ctx.cyl(0.026, 0.017, 0.165, 10, primary, 0, 0.285, -0.046, {
    metalness: 0.35,
    roughness: 0.28,
    parent: boom,
  });
  // Metallic grille belt ring
  ctx.torus(0.028, 0.006, 6, 12, '#E4EAF2', 0, 0.368, -0.046, {
    rotX: Math.PI / 2,
    metalness: 0.8,
    roughness: 0.2,
    parent: boom,
  });
  // Metallic mesh spherical mic bulb
  addCustomMesh(ctx, new THREE.IcosahedronGeometry(0.048, 1), '#DCE2EA', 0, 0.408, -0.046, {
    metalness: 0.74,
    roughness: 0.26,
    parent: boom,
  });
  ctx.torus(0.047, 0.005, 6, 14, shade(primary, 0.18), 0, 0.408, -0.046, {
    rotX: Math.PI / 2,
    metalness: 0.7,
    roughness: 0.22,
    parent: boom,
  });
}

function buildVinylCrate(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const darkWood = shade(primary, -0.14);

  // Solid wooden crate floor
  ctx.box(0.47, 0.024, 0.43, darkWood, 0, baseY + 0.012, 0, { roughness: 0.84 });

  // 4 corner posts tucked strictly inside slats so zero faces overlap
  for (const sx of [-0.218, 0.218]) {
    for (const sz of [-0.198, 0.198]) {
      ctx.box(0.032, 0.276, 0.032, darkWood, sx, baseY + 0.162, sz, { roughness: 0.82 });
    }
  }

  // Front & back horizontal slats (3 slats with clean gaps)
  const slatYs = [baseY + 0.068, baseY + 0.162, baseY + 0.256];
  for (const sz of [-0.226, 0.226]) {
    for (const sy of slatYs) {
      ctx.box(0.512, 0.060, 0.018, primary, 0, sy, sz, { roughness: 0.8 });
    }
  }
  // Left & right slats stopping cleanly short of front/back slats (z = ±0.215)
  for (const sx of [-0.246, 0.246]) {
    ctx.box(0.018, 0.060, 0.428, primary, sx, slatYs[0], 0, { roughness: 0.8 });
    ctx.box(0.018, 0.060, 0.428, primary, sx, slatYs[1], 0, { roughness: 0.8 });
    ctx.box(0.018, 0.042, 0.428, primary, sx, slatYs[2] + 0.01, 0, { roughness: 0.8 });
  }

  // 8 colorful angled vinyl sleeves tucked inside the crate
  const sleeveColors = [
    '#F0B6C2',
    '#F2DC99',
    '#A8D8C6',
    accent,
    '#A8C7E2',
    '#EBA994',
    '#EFE6D8',
    accent,
  ];
  for (let i = 0; i < sleeveColors.length; i++) {
    const t = i / (sleeveColors.length - 1);
    const sz = -0.155 + t * 0.31;
    const tilt = -0.15 + t * 0.26;
    const hVar = 0.375 + (i % 3) * 0.012;
    ctx.box(0.39, hVar, 0.014, sleeveColors[i], (i % 2 === 0 ? -0.008 : 0.008), baseY + 0.03 + hVar / 2, sz, {
      rotX: tilt,
      roughness: 0.65,
    });
  }

  // Album cover geometric graphic accent cleanly proud of front-most sleeve
  ctx.box(0.18, 0.16, 0.014, '#FAF5EC', -0.04, baseY + 0.31, 0.174, { rotX: 0.11 });
  ctx.cyl(0.045, 0.045, 0.014, 10, '#F0B298', -0.04, baseY + 0.31, 0.184, {
    rotX: Math.PI / 2 + 0.11,
  });

  // Black vinyl record disc peeking playfully out of a sleeve (label cleanly proud on both faces)
  ctx.cyl(0.155, 0.155, 0.008, 16, '#23262E', 0.075, baseY + 0.295, 0.09, {
    rotX: Math.PI / 2 + 0.05,
    roughness: 0.28,
    metalness: 0.18,
  });
  ctx.cyl(0.046, 0.046, 0.018, 10, '#F4C698', 0.075, baseY + 0.295, 0.09, {
    rotX: Math.PI / 2 + 0.05,
  });
}

function buildDanceFloorTile(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;

  // Slim dark metallic grid housing strictly in y = [0.004 .. 0.018], inset 0.002+ per side
  ctx.box(0.992, 0.014, 0.992, '#3E434F', 0, 0.011, 0, {
    metalness: 0.45,
    roughness: 0.42,
    castShadow: false,
  });

  // 3x3 geometric glowing disco acrylic tiles strictly in y = [0.018 .. 0.024]
  const cornerCol = shade(primary, -0.10);
  const centerCol = shade(accent, 0.20);
  for (let gx = -1; gx <= 1; gx++) {
    for (let gz = -1; gz <= 1; gz++) {
      const isCenter = gx === 0 && gz === 0;
      const isCross = gx === 0 || gz === 0;
      const tileColor = isCenter ? centerCol : isCross ? primary : cornerCol;
      const glowStrength = isCenter ? 1.35 : isCross ? 1.0 : 0.68;

      ctx.box(0.278, 0.006, 0.278, tileColor, gx * 0.305, 0.021, gz * 0.305, {
        emissive: isActive ? tileColor : undefined,
        emissiveIntensity: isActive ? glowStrength : 0,
        roughness: 0.22,
        metalness: 0.08,
        castShadow: false,
      });
    }
  }
}

function buildBalloonArch(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Twin weighted anchor base plates + short gold riser stubs
  for (const sx of [-0.78, 0.78]) {
    ctx.cyl(0.16, 0.18, 0.036, 12, '#F4EDE2', sx, baseY + 0.018, 0, { roughness: 0.65 });
    ctx.torus(0.165, 0.012, 6, 14, '#DFC388', sx, baseY + 0.034, 0, {
      rotX: Math.PI / 2,
      metalness: 0.45,
      roughness: 0.3,
    });
    ctx.cyl(0.018, 0.018, 0.24, 6, '#DFC388', sx, baseY + 0.14, 0, {
      metalness: 0.5,
      roughness: 0.3,
    });
  }

  const palette = [
    primary,
    accent,
    '#F7F0E4',
    shade(primary, 0.16),
    '#EFE0A8',
    shade(accent, -0.06),
  ];

  // 11 primary arch balloons spanning the graceful 2x1 doorway arch (top ~2.10)
  const mainCount = 11;
  for (let i = 0; i < mainCount; i++) {
    const t = i / (mainCount - 1);
    const angle = Math.PI * (0.96 - t * 0.92);
    const bx = 0.78 * Math.cos(angle);
    const by = baseY + 0.19 + 1.69 * Math.sin(angle);
    const bz = (i % 2 === 0 ? 1 : -1) * 0.045;
    const r = 0.165 + (i % 3 === 1 ? 0.035 : 0);
    const col = palette[i % palette.length];
    const isPearl = col === '#EFE0A8';

    ctx.sphere(r, 8, col, bx, by, bz, {
      scaleX: 1.04,
      scaleY: 1.10,
      scaleZ: 0.96,
      roughness: isPearl ? 0.28 : 0.42,
      metalness: isPearl ? 0.25 : 0.05,
    });
  }

  // 6 organic cluster accent balloons for lush boutique garland fullness
  const clusters = [
    { x: -0.76, y: baseY + 0.46, z: 0.13, r: 0.135, c: 1 },
    { x: -0.58, y: baseY + 1.38, z: 0.14, r: 0.145, c: 4 },
    { x: -0.22, y: baseY + 1.80, z: -0.13, r: 0.13, c: 2 },
    { x: 0.20, y: baseY + 1.82, z: 0.13, r: 0.14, c: 0 },
    { x: 0.62, y: baseY + 1.30, z: -0.13, r: 0.14, c: 4 },
    { x: 0.74, y: baseY + 0.52, z: 0.13, r: 0.13, c: 3 },
  ];
  for (const cl of clusters) {
    const col = palette[cl.c];
    const isPearl = col === '#EFE0A8';
    ctx.sphere(cl.r, 8, col, cl.x, cl.y, cl.z, {
      scaleX: 1.06,
      scaleY: 1.06,
      scaleZ: 0.94,
      roughness: isPearl ? 0.28 : 0.44,
      metalness: isPearl ? 0.24 : 0.04,
    });
  }
}

function buildStringLights(ctx: ModelContext): void {
  const { primary, isActive, variant, shade } = ctx;
  const cableColor = '#3F444E';
  const spanHalf = 0.88;

  const cableY = (x: number): number => {
    const u = x / spanHalf;
    return -0.025 - 0.195 * (1 - u * u);
  };

  // Ceiling anchor clips
  for (const sx of [-spanHalf, spanHalf]) {
    ctx.cyl(0.028, 0.022, 0.032, 8, cableColor, sx, -0.016, 0, {
      metalness: 0.4,
      roughness: 0.4,
    });
  }

  // Graceful catenary cord built from 8 connected segments
  const segCount = 8;
  for (let i = 0; i < segCount; i++) {
    const x0 = -spanHalf + (i / segCount) * (spanHalf * 2);
    const x1 = -spanHalf + ((i + 1) / segCount) * (spanHalf * 2);
    addSegment(
      ctx,
      new THREE.Vector3(x0, cableY(x0), 0),
      new THREE.Vector3(x1, cableY(x1), 0),
      0.008,
      cableColor,
      5,
      { castShadow: false },
    );
  }

  // 6 glowing fairy/Edison bulbs hanging smoothly along the catenary
  const pastelBulbs = [primary, '#B2E4D2', '#F6DF9C', '#CEB5E8', '#F4C1A8', '#B6D9EE'];
  const bulbXs = [-0.68, -0.41, -0.14, 0.14, 0.41, 0.68];
  for (let i = 0; i < bulbXs.length; i++) {
    const bx = bulbXs[i];
    const by = cableY(bx);
    const bulbCol =
      variant.id === 'pastel'
        ? pastelBulbs[i % pastelBulbs.length]
        : i % 2 === 0
          ? primary
          : shade(primary, 0.18);

    // Socket cap + drop neck
    ctx.cyl(0.015, 0.018, 0.034, 7, '#4B505B', bx, by - 0.018, 0, {
      metalness: 0.45,
      roughness: 0.35,
    });
    // Teardrop glass bulb
    ctx.sphere(0.042, 7, isActive ? shade(bulbCol, 0.25) : bulbCol, bx, by - 0.068, 0, {
      scaleY: 1.24,
      emissive: isActive ? bulbCol : undefined,
      emissiveIntensity: isActive ? 1.28 : 0,
      roughness: 0.2,
      castShadow: false,
    });
    // Soft warm glow halo when active
    if (isActive) {
      ctx.sphere(0.076, 7, bulbCol, bx, by - 0.068, 0, {
        opacity: 0.20,
        emissive: bulbCol,
        emissiveIntensity: 0.85,
        castShadow: false,
        receiveShadow: false,
      });
    }
  }
}

function buildLaserBar(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;

  // Ceiling mounting brackets & twin hanger struts
  for (const sx of [-0.62, 0.62]) {
    ctx.box(0.10, 0.024, 0.10, accent, sx, -0.012, 0, { metalness: 0.55, roughness: 0.35 });
    ctx.cyl(0.015, 0.015, 0.092, 6, accent, sx, -0.068, 0, { metalness: 0.6, roughness: 0.3 });
  }

  // Sleek 2-tile wide metallic laser bar housing
  ctx.box(1.56, 0.11, 0.14, accent, 0, -0.18, 0, {
    metalness: 0.56,
    roughness: 0.34,
  });
  // Top accent spine & pastel end caps
  ctx.box(1.48, 0.016, 0.08, shade(accent, -0.15), 0, -0.117, 0, { metalness: 0.5 });
  for (const sx of [-0.795, 0.795]) {
    ctx.box(0.032, 0.116, 0.148, primary, sx, -0.18, 0, { roughness: 0.4 });
  }
  // Dark recessed underside aperture strip
  ctx.box(1.44, 0.024, 0.098, '#282C36', 0, -0.242, 0, { roughness: 0.6 });

  // Front (+Z) sleek LED status accent strip
  ctx.box(1.42, 0.022, 0.012, isActive ? shade(primary, 0.25) : shade(primary, -0.15), 0, -0.18, 0.074, {
    emissive: isActive ? primary : undefined,
    emissiveIntensity: isActive ? 1.15 : 0,
    roughness: 0.22,
    castShadow: false,
  });

  // 5 emitter aperture diodes (dynamic volumetric laser beams projected by SceneManager's LightProjectionRig)
  const emitterXs = [-0.54, -0.27, 0, 0.27, 0.54];
  for (let i = 0; i < emitterXs.length; i++) {
    const ex = emitterXs[i];
    ctx.cyl(0.028, 0.028, 0.018, 8, isActive ? '#FFFFFF' : primary, ex, -0.256, 0, {
      emissive: isActive ? primary : undefined,
      emissiveIntensity: isActive ? 1.55 : 0,
      roughness: 0.18,
    });
  }
}

export const buildPartyModel: TabModelBuilder = (ctx: ModelContext): boolean => {
  switch (ctx.def.id) {
    case 'dj_booth':
      buildDjBooth(ctx);
      return true;
    case 'speaker_tower':
      buildSpeakerTower(ctx);
      return true;
    case 'subwoofer_box':
      buildSubwooferBox(ctx);
      return true;
    case 'floor_uplight':
      buildFloorUplight(ctx);
      return true;
    case 'disco_ball':
      buildDiscoBall(ctx);
      return true;
    case 'led_strip_wall':
      buildLedStripWall(ctx);
      return true;
    case 'fog_machine':
      buildFogMachine(ctx);
      return true;
    case 'party_spotlight':
      buildPartySpotlight(ctx);
      return true;
    case 'karaoke_mic':
      buildKaraokeMic(ctx);
      return true;
    case 'vinyl_crate':
      buildVinylCrate(ctx);
      return true;
    case 'dance_floor_tile':
      buildDanceFloorTile(ctx);
      return true;
    case 'balloon_arch':
      buildBalloonArch(ctx);
      return true;
    case 'string_lights':
      buildStringLights(ctx);
      return true;
    case 'laser_bar':
      buildLaserBar(ctx);
      return true;
    default:
      return false;
  }
};
