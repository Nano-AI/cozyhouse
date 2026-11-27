import * as THREE from 'three';
import { FLOOR_BASE_Y, type ModelContext, type TabModelBuilder } from './ModelKit';

/**
 * Connects two 3D points with a clean cylindrical segment (ropes, cables, wands).
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
 * Adds a pair of adorable triangular cat ears with soft pink inner ears to a head group.
 */
function addCatEars(
  ctx: ModelContext,
  parent: THREE.Object3D,
  leftColor: string,
  rightColor: string,
  innerColor: string,
  opts: {
    spreadX: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    tiltZ: number;
  },
): void {
  const sides: Array<{ sign: -1 | 1; color: string }> = [
    { sign: -1, color: leftColor },
    { sign: 1, color: rightColor },
  ];
  for (const s of sides) {
    ctx.cone(
      opts.radius,
      opts.height,
      4,
      s.color,
      s.sign * opts.spreadX,
      opts.y,
      opts.z,
      {
        rotY: Math.PI / 4,
        rotZ: -s.sign * opts.tiltZ,
        roughness: 0.88,
        parent,
      },
    );
    ctx.cone(
      opts.radius * 0.56,
      opts.height * 0.64,
      4,
      innerColor,
      s.sign * (opts.spreadX * 0.96),
      opts.y - opts.height * 0.08,
      opts.z + opts.radius * 0.36,
      {
        rotY: Math.PI / 4,
        rotZ: -s.sign * opts.tiltZ,
        roughness: 0.78,
        parent,
        castShadow: false,
      },
    );
  }
}

function buildCatTree(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const sisal = '#D8BE94';
  const sisalRing = '#C4A67A';
  const creamFleece = '#F7F1E7';

  // Plush carpeted base platform (y = 0.024 .. 0.082)
  ctx.box(0.76, 0.058, 0.72, primary, 0, baseY + 0.029, 0, { roughness: 0.92 });

  // Lower front-left & back-left sisal posts supporting the cubby
  ctx.cyl(0.050, 0.052, 0.50, 10, sisal, -0.22, baseY + 0.308, 0.16, { roughness: 0.95 });
  ctx.cyl(0.050, 0.052, 0.50, 10, sisal, -0.22, baseY + 0.308, -0.16, { roughness: 0.95 });

  // Tall main sisal scratching post on right-back up to top perch
  ctx.cyl(0.060, 0.064, 1.32, 10, sisal, 0.20, baseY + 0.718, -0.10, { roughness: 0.95 });
  for (const ry of [0.24, 0.52, 0.82, 1.12]) {
    ctx.torus(0.062, 0.009, 5, 10, sisalRing, 0.20, ry, -0.10, {
      rotX: Math.PI / 2,
      roughness: 0.96,
    });
  }

  // Cozy mid-level plush cubby house (y = 0.58 .. 0.98) with open front cave
  const cubX = -0.10;
  const cubZ = 0.02;
  const cubBase = 0.58;
  const cubH = 0.38;
  // Floor & roof (walls fit strictly between floor top 0.616 and roof bottom 0.940)
  ctx.box(0.46, 0.036, 0.44, primary, cubX, cubBase + 0.018, cubZ, { roughness: 0.92 });
  ctx.box(0.48, 0.040, 0.46, shade(primary, 0.08), cubX, cubBase + cubH, cubZ, { roughness: 0.92 });
  const wallH = 0.324;
  const wallY = cubBase + 0.036 + wallH / 2;
  // Left & right side walls (inset inside floor perimeter)
  ctx.box(0.034, wallH, 0.416, primary, cubX - 0.205, wallY, cubZ, { roughness: 0.92 });
  ctx.box(0.034, wallH, 0.416, primary, cubX + 0.205, wallY, cubZ, { roughness: 0.92 });
  // Back wall strictly between side walls
  ctx.box(0.376, wallH, 0.034, shade(primary, -0.08), cubX, wallY, cubZ - 0.191, {
    roughness: 0.92,
  });
  // Dark cozy interior recess strictly proud of back wall
  ctx.box(0.34, wallH - 0.04, 0.032, '#433B36', cubX, wallY, cubZ - 0.152);
  // Front wall frame around cute cubby entrance opening (strictly between side walls)
  ctx.box(0.092, wallH, 0.034, primary, cubX - 0.142, wallY, cubZ + 0.191, {
    roughness: 0.92,
  });
  ctx.box(0.092, wallH, 0.034, primary, cubX + 0.142, wallY, cubZ + 0.191, {
    roughness: 0.92,
  });
  ctx.box(0.192, 0.088, 0.034, primary, cubX, cubBase + 0.036 + wallH - 0.044, cubZ + 0.191, {
    roughness: 0.92,
  });

  // Side stepping ledge perch
  ctx.cyl(0.175, 0.175, 0.044, 12, shade(primary, 0.06), 0.24, 1.03, 0.12, { roughness: 0.9 });

  // Upper sisal post from cubby roof to top perch
  ctx.cyl(0.048, 0.050, 0.42, 10, sisal, -0.14, 1.19, -0.02, { roughness: 0.95 });

  // Top plush lounge perch — flat inner sitting surface sits at EXACTLY y = 1.45 (surfaceHeight)
  ctx.cyl(0.30, 0.29, 0.050, 14, primary, 0, 1.425, 0, { roughness: 0.92 });
  ctx.cyl(0.24, 0.24, 0.012, 12, creamFleece, 0, 1.448, 0, { roughness: 0.95 });
  ctx.torus(0.275, 0.042, 7, 16, shade(primary, 0.10), 0, 1.468, 0, {
    rotX: Math.PI / 2,
    roughness: 0.94,
  });

  // Dangling string + playful pastel pom-pom beneath top perch rim
  ctx.cyl(0.006, 0.006, 0.22, 5, '#D8C5A8', 0.22, 1.29, 0.18);
  ctx.sphere(0.046, 7, '#F2B8C6', 0.22, 1.17, 0.18, { roughness: 0.92 });
}

function buildCatCondoTower(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const caveDark = '#3E3631';

  // Weighted circular wood base plinth (y = 0.024 .. 0.074)
  ctx.cyl(0.36, 0.38, 0.050, 14, accent, 0, baseY + 0.025, 0, { roughness: 0.78 });

  // 3 stacked cylindrical plush hideaway drums with birch wood divider collars
  const tiers = [
    { yBot: 0.074, h: 0.48, doorRotY: 0 },
    { yBot: 0.590, h: 0.48, doorRotY: 0.48 },
    { yBot: 1.106, h: 0.48, doorRotY: -0.18 },
  ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const cy = t.yBot + t.h / 2;
    const drumCol = i === 1 ? shade(primary, -0.05) : primary;

    ctx.cyl(0.30, 0.30, t.h, 14, drumCol, 0, cy, 0, { roughness: 0.92 });

    // Wood collar divider ring above each drum
    ctx.cyl(0.325, 0.325, 0.036, 14, accent, 0, t.yBot + t.h + 0.018, 0, { roughness: 0.76 });

    // Cozy arched peekaboo entrance opening oriented cleanly outward
    const doorGroup = new THREE.Group();
    doorGroup.position.set(0, cy - 0.04, 0);
    doorGroup.rotation.y = t.doorRotY;
    ctx.group.add(doorGroup);

    // Recessed dark arch interior (non-coplanar depths so arch cap & box never Z-fight)
    ctx.box(0.18, 0.17, 0.056, caveDark, 0, -0.02, 0.278, { parent: doorGroup });
    ctx.cyl(0.09, 0.09, 0.046, 10, caveDark, 0, 0.065, 0.276, {
      rotX: Math.PI / 2,
      parent: doorGroup,
    });
    // Wood arch trim sill
    ctx.box(0.22, 0.024, 0.036, accent, 0, -0.105, 0.300, { parent: doorGroup });

    // Subtle interior cushion peek inside upper & bottom caves
    if (i !== 1) {
      ctx.box(0.14, 0.026, 0.040, '#F7F1E7', 0, -0.088, 0.292, { parent: doorGroup });
    }
  }

  // Middle tier sisal wrap scratching accent stripe on left side
  ctx.torus(0.298, 0.014, 6, 14, '#D6BC92', 0, 0.72, 0, { rotX: Math.PI / 2 });
  ctx.torus(0.298, 0.014, 6, 14, '#D6BC92', 0, 0.94, 0, { rotX: Math.PI / 2 });

  // Top plush crown cushion — flat top sits at EXACTLY y = 1.65 (surfaceHeight)
  ctx.cyl(0.285, 0.285, 0.028, 14, '#F7F1E7', 0, 1.636, 0, { roughness: 0.95 });
  ctx.torus(0.292, 0.036, 7, 16, primary, 0, 1.662, 0, {
    rotX: Math.PI / 2,
    roughness: 0.94,
  });
}

function buildScratchPost(ctx: ModelContext): void {
  const { primary, accent, variant, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Square carpeted base platform
  ctx.box(0.48, 0.056, 0.48, accent, 0, baseY + 0.028, 0, { roughness: 0.92 });
  ctx.box(0.41, 0.016, 0.41, shade(accent, 0.10), 0, baseY + 0.060, 0, { roughness: 0.94 });

  // Tall textured sisal scratching cylinder
  ctx.cyl(0.085, 0.092, 0.58, 12, primary, 0, baseY + 0.346, 0, { roughness: 0.95 });

  // Horizontal twine collar texture rings
  const ringCol = shade(primary, -0.10);
  for (let i = 0; i < 5; i++) {
    ctx.torus(0.088, 0.010, 5, 12, ringCol, 0, baseY + 0.13 + i * 0.105, 0, {
      rotX: Math.PI / 2,
      roughness: 0.96,
    });
  }

  // Charming mini side branch on the Cactus variant
  if (variant.id === 'cactus') {
    ctx.cyl(0.044, 0.048, 0.12, 8, primary, -0.115, baseY + 0.34, 0, { rotZ: Math.PI / 2 });
    ctx.cyl(0.042, 0.044, 0.15, 8, primary, -0.165, baseY + 0.41, 0);
    ctx.sphere(0.043, 7, primary, -0.165, baseY + 0.485, 0);
  }

  // Plush rounded top cap
  ctx.cyl(0.108, 0.104, 0.042, 12, accent, 0, baseY + 0.656, 0, { roughness: 0.9 });

  // Curved teaser spring/string arcing out to a dangling plush pom-pom ball
  const p0 = new THREE.Vector3(0.02, baseY + 0.675, 0.01);
  const p1 = new THREE.Vector3(0.11, baseY + 0.745, 0.04);
  const p2 = new THREE.Vector3(0.175, baseY + 0.70, 0.07);
  const p3 = new THREE.Vector3(0.175, baseY + 0.58, 0.07);
  addSegment(ctx, p0, p1, 0.008, '#D8C5A8', 5);
  addSegment(ctx, p1, p2, 0.007, '#D8C5A8', 5);
  addSegment(ctx, p2, p3, 0.006, '#D8C5A8', 5);

  ctx.sphere(0.052, 8, '#F2B8C6', 0.175, baseY + 0.545, 0.07, { roughness: 0.92 });
}

function buildCatFeatherWand(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;

  // Cute round wooden/felt toy rest puck sitting flush at y = 0 (surface item)
  ctx.cyl(0.088, 0.098, 0.036, 12, shade(accent, -0.06), -0.14, 0.018, 0.02, {
    roughness: 0.82,
  });

  // Slim angled wooden dowel wand leaning up playfully
  const handleStart = new THREE.Vector3(-0.20, 0.024, 0.04);
  const handleTip = new THREE.Vector3(0.10, 0.275, -0.03);
  addSegment(ctx, handleStart, handleTip, 0.013, accent, 8, { roughness: 0.76 });

  // Soft pastel grip wrap near handle base
  addSegment(
    ctx,
    handleStart,
    new THREE.Vector3(-0.11, 0.098, 0.02),
    0.016,
    primary,
    8,
    { roughness: 0.85 },
  );

  // Curving teaser string arching up to y ~ 0.34 and dropping down to feathers
  const s1 = new THREE.Vector3(0.165, 0.335, 0.005);
  const s2 = new THREE.Vector3(0.215, 0.265, 0.045);
  const bellPos = new THREE.Vector3(0.215, 0.165, 0.06);
  addSegment(ctx, handleTip, s1, 0.005, '#F4EFE6', 5, { castShadow: false });
  addSegment(ctx, s1, s2, 0.005, '#F4EFE6', 5, { castShadow: false });
  addSegment(ctx, s2, bellPos, 0.005, '#F4EFE6', 5, { castShadow: false });

  // Tiny gold jingle bell
  ctx.sphere(0.022, 7, '#F0CF7A', bellPos.x, bellPos.y, bellPos.z, {
    metalness: 0.65,
    roughness: 0.26,
  });

  // Colorful pastel feather cluster fluttering beneath the bell
  const feathers = [
    { dx: 0.0, dz: 0.0, rotZ: 0.0, rotX: 0.12, len: 0.13, col: primary },
    { dx: -0.032, dz: 0.012, rotZ: 0.38, rotX: 0.08, len: 0.115, col: '#F6DF9C' },
    { dx: 0.032, dz: 0.014, rotZ: -0.36, rotX: 0.10, len: 0.115, col: '#B5E2D0' },
    { dx: -0.018, dz: -0.022, rotZ: 0.22, rotX: -0.26, len: 0.105, col: shade(primary, 0.20) },
    { dx: 0.020, dz: -0.020, rotZ: -0.22, rotX: -0.22, len: 0.105, col: '#D4BEEB' },
  ];
  for (const f of feathers) {
    ctx.cone(0.024, f.len, 5, f.col, bellPos.x + f.dx, bellPos.y - 0.062, bellPos.z + f.dz, {
      rotX: Math.PI + f.rotX,
      rotZ: f.rotZ,
      scaleZ: 0.38,
      roughness: 0.85,
    });
  }
}

function buildCatTunnel(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const r = 0.180;
  const cy = baseY + r + 0.022;
  const len = 1.50;

  // Open hollow outer crinkle fabric cylinder
  const outerGeo = new THREE.CylinderGeometry(r, r, len, 12, 1, true);
  const outerMat = ctx.mat(primary, { roughness: 0.88 });
  outerMat.side = THREE.FrontSide;
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.position.set(0, cy, 0);
  outerMesh.rotation.z = Math.PI / 2;
  outerMesh.castShadow = !ctx.isGhost;
  outerMesh.receiveShadow = !ctx.isGhost;
  ctx.group.add(outerMesh);

  // Dark cozy inner tunnel lining (BackSide so you see straight through hollow ends!)
  const innerGeo = new THREE.CylinderGeometry(r - 0.010, r - 0.010, len - 0.01, 12, 1, true);
  const innerMat = ctx.mat(shade(primary, -0.36), { roughness: 0.94 });
  innerMat.side = THREE.BackSide;
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.position.set(0, cy, 0);
  innerMesh.rotation.z = Math.PI / 2;
  ctx.group.add(innerMesh);

  // 6 collapsible structural wire-ribbed fabric rings
  const ringXs = [-0.745, -0.45, -0.15, 0.15, 0.45, 0.745];
  for (let i = 0; i < ringXs.length; i++) {
    const isEnd = i === 0 || i === ringXs.length - 1;
    ctx.torus(
      r,
      isEnd ? 0.022 : 0.014,
      6,
      14,
      isEnd ? accent : shade(primary, -0.09),
      ringXs[i],
      cy,
      0,
      { rotY: Math.PI / 2, roughness: 0.88 },
    );
  }

  // Top center circular peekaboo cutout hole + plush rim
  ctx.torus(0.105, 0.018, 6, 12, accent, 0, cy + r - 0.004, 0, {
    rotX: Math.PI / 2,
    roughness: 0.88,
  });
  ctx.cyl(0.095, 0.095, 0.016, 12, '#3B3432', 0, cy + r - 0.008, 0);

  // Playful dangling pom-pom toy inside right open tunnel rim
  ctx.cyl(0.005, 0.005, 0.085, 5, accent, 0.73, cy + r - 0.055, 0.02);
  ctx.sphere(0.036, 7, shade(accent, -0.08), 0.73, cy + r - 0.11, 0.02, { roughness: 0.92 });
}

function buildCatBallTrack(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Weighted base platter
  ctx.cyl(0.305, 0.325, 0.026, 16, shade(primary, -0.09), 0, baseY + 0.013, 0, {
    roughness: 0.52,
  });

  // Tier 1 circular donut groove (outer wall + inner wall framing channel at r = 0.24)
  ctx.torus(0.286, 0.034, 7, 18, primary, 0, baseY + 0.056, 0, {
    rotX: Math.PI / 2,
    roughness: 0.48,
  });
  ctx.torus(0.194, 0.030, 7, 16, shade(primary, 0.07), 0, baseY + 0.056, 0, {
    rotX: Math.PI / 2,
    roughness: 0.48,
  });

  // Tier 2 upper smaller circular track rim + central smooth cap hub
  ctx.torus(0.202, 0.026, 7, 16, shade(primary, 0.14), 0, baseY + 0.120, 0, {
    rotX: Math.PI / 2,
    roughness: 0.46,
  });
  ctx.cyl(0.120, 0.140, 0.125, 14, primary, 0, baseY + 0.082, 0, { roughness: 0.5 });
  ctx.sphere(0.118, 10, shade(primary, 0.18), 0, baseY + 0.142, 0, {
    scaleY: 0.42,
    roughness: 0.45,
  });
  // Cute mini paw topper nub reaching height ~0.22
  ctx.cyl(0.008, 0.008, 0.03, 5, '#D8C5A8', 0, baseY + 0.178, 0);
  ctx.sphere(0.024, 7, accent, 0, baseY + 0.194, 0, { roughness: 0.65 });

  // Spinning ball group centered at track origin so rotation.y orbits balls inside grooves!
  const spinGroup = new THREE.Group();
  spinGroup.name = 'SpinTarget';
  spinGroup.userData.spinAxis = 'y';
  spinGroup.userData.spinSpeed = 3.2;
  spinGroup.position.set(0, baseY, 0);
  ctx.group.add(spinGroup);

  // Lower groove rolling ball
  ctx.sphere(0.040, 8, accent, 0.24, 0.064, 0, {
    roughness: 0.28,
    metalness: 0.08,
    parent: spinGroup,
  });
  // Upper groove rolling ball (opposite side)
  ctx.sphere(0.035, 8, '#FFE08A', -0.162, 0.128, 0.015, {
    roughness: 0.28,
    metalness: 0.08,
    parent: spinGroup,
  });
}

function buildPetBedRound(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Soft base cushion footprint
  ctx.cyl(0.35, 0.37, 0.048, 16, shade(primary, -0.10), 0, baseY + 0.024, 0, {
    roughness: 0.92,
  });

  // Sunken soft fleece inner sleeping pillow
  ctx.sphere(0.275, 12, accent, 0, baseY + 0.082, 0, {
    scaleY: 0.24,
    roughness: 0.95,
  });
  // Subtle quilted center tuft button
  ctx.cyl(0.026, 0.026, 0.012, 8, shade(primary, -0.06), 0, baseY + 0.148, 0, {
    roughness: 0.9,
  });

  // Plump continuous doughnut bolster rim
  ctx.torus(0.305, 0.096, 8, 18, primary, 0, baseY + 0.118, 0, {
    rotX: Math.PI / 2,
    scaleZ: 0.86,
    roughness: 0.94,
  });

  // 5 sculpted overlapping pillowy bolster puffs around back & sides (leaving front chin-dip)
  const puffAngles = [-2.35, -1.55, -0.78, 0.78, 1.55];
  for (let i = 0; i < puffAngles.length; i++) {
    const a = puffAngles[i];
    // Angle 0 points -Z (back), ±PI/2 are sides
    const px = Math.sin(a) * 0.305;
    const pz = -Math.cos(a) * 0.305;
    ctx.sphere(0.112, 8, i % 2 === 0 ? shade(primary, 0.05) : primary, px, baseY + 0.155, pz, {
      scaleX: 1.06,
      scaleY: 0.86,
      scaleZ: 1.06,
      roughness: 0.95,
    });
  }
  // Center back crown bolster puff
  ctx.sphere(0.118, 8, shade(primary, 0.06), 0, baseY + 0.162, -0.305, {
    scaleX: 1.15,
    scaleY: 0.88,
    scaleZ: 0.98,
    roughness: 0.95,
  });

  // Cute stitched woven label tag on front bolster lip
  ctx.box(0.068, 0.042, 0.018, '#CAA47D', 0, baseY + 0.095, 0.392, { roughness: 0.85 });
}

function buildPetBowls(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Soft placemat underneath bowls
  ctx.box(0.70, 0.012, 0.42, '#EFE8DC', 0, baseY + 0.006, 0, {
    roughness: 0.9,
    castShadow: false,
  });

  // Raised wooden twin-bowl stand
  const deckY = baseY + 0.092;
  ctx.box(0.60, 0.028, 0.32, accent, 0, deckY, 0, { roughness: 0.78 });
  ctx.legs(0.56, 0.28, 0.072, 0.020, shade(accent, -0.10), baseY + 0.012, 0.045);

  // Left ceramic bowl (food with kibble mound)
  const lx = -0.145;
  ctx.cyl(0.114, 0.094, 0.072, 12, primary, lx, baseY + 0.100, 0, { roughness: 0.28 });
  ctx.torus(0.107, 0.014, 6, 14, shade(primary, 0.12), lx, baseY + 0.134, 0, {
    rotX: Math.PI / 2,
    roughness: 0.26,
  });
  ctx.sphere(0.088, 8, '#9A6E49', lx, baseY + 0.122, 0, { scaleY: 0.42, roughness: 0.88 });
  // Individual crunchy kibble pellets on top
  const pellets = [
    { dx: -0.025, dz: 0.018, c: '#7D5535' },
    { dx: 0.028, dz: -0.012, c: '#B38359' },
    { dx: 0.004, dz: 0.032, c: '#8B603D' },
    { dx: -0.018, dz: -0.028, c: '#B38359' },
    { dx: 0.018, dz: 0.015, c: '#7D5535' },
  ];
  for (const p of pellets) {
    ctx.sphere(0.018, 5, p.c, lx + p.dx, baseY + 0.148, p.dz, { roughness: 0.9 });
  }

  // Right ceramic bowl (translucent pastel blue water)
  const rx = 0.145;
  ctx.cyl(0.114, 0.094, 0.072, 12, primary, rx, baseY + 0.100, 0, { roughness: 0.28 });
  ctx.torus(0.107, 0.014, 6, 14, shade(primary, 0.12), rx, baseY + 0.134, 0, {
    rotX: Math.PI / 2,
    roughness: 0.26,
  });
  ctx.cyl(0.098, 0.092, 0.026, 12, '#8AD8F0', rx, baseY + 0.129, 0, {
    opacity: 0.74,
    roughness: 0.10,
    metalness: 0.08,
  });
  // Subtle crisp white water shimmer highlight
  ctx.box(0.044, 0.005, 0.014, '#FFFFFF', rx - 0.022, baseY + 0.146, 0.024, {
    rotY: 0.42,
    castShadow: false,
  });
}

function buildPetAutoFeeder(ctx: ModelContext): void {
  const { primary, accent, isActive, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const hopperZ = -0.07;

  // Modern rounded lower dispenser housing
  ctx.cyl(0.148, 0.168, 0.18, 12, primary, 0, baseY + 0.090, hopperZ, { roughness: 0.46 });
  ctx.box(0.24, 0.042, 0.22, shade(primary, -0.06), 0, baseY + 0.021, 0.02, { roughness: 0.55 });

  // Pastel front control bezel + indicator light & timer display
  ctx.box(0.155, 0.105, 0.032, accent, 0, baseY + 0.122, 0.074, { roughness: 0.45 });
  ctx.sphere(0.015, 6, isActive ? '#6EE7B7' : '#8A919E', -0.040, baseY + 0.142, 0.095, {
    emissive: isActive ? '#6EE7B7' : undefined,
    emissiveIntensity: 1.35,
  });
  ctx.box(0.072, 0.024, 0.012, isActive ? '#B8F6DE' : '#4E5562', 0.022, baseY + 0.142, 0.092, {
    emissive: isActive ? '#6EE7B7' : undefined,
    emissiveIntensity: 0.9,
  });
  // Recessed dispenser chute mouth
  ctx.box(0.085, 0.042, 0.024, '#3F444E', 0, baseY + 0.062, 0.082);

  // Clear translucent upper kibble hopper
  ctx.cyl(0.136, 0.140, 0.185, 12, '#E2F0F5', 0, baseY + 0.270, hopperZ, {
    opacity: 0.36,
    roughness: 0.12,
    castShadow: false,
  });
  // Visible warm brown kibble fill inside hopper
  ctx.cyl(0.116, 0.120, 0.125, 10, '#9A6E49', 0, baseY + 0.242, hopperZ, { roughness: 0.9 });
  ctx.sphere(0.112, 8, '#A97B54', 0, baseY + 0.300, hopperZ, {
    scaleY: 0.35,
    roughness: 0.9,
  });

  // Fitted top lid + latch tab (reaches ~0.42)
  ctx.cyl(0.146, 0.142, 0.036, 12, accent, 0, baseY + 0.374, hopperZ, { roughness: 0.48 });
  ctx.box(0.064, 0.016, 0.036, shade(accent, -0.14), 0, baseY + 0.396, hopperZ);

  // Protruding front tray + brushed stainless steel bowl
  ctx.cyl(0.136, 0.148, 0.048, 12, primary, 0, baseY + 0.024, 0.145, { roughness: 0.48 });
  ctx.cyl(0.114, 0.098, 0.044, 12, '#D8E0E8', 0, baseY + 0.036, 0.145, {
    metalness: 0.65,
    roughness: 0.22,
  });

  // Kibble inside bowl — generous fresh mound + tumbling morsels when active!
  const moundH = isActive ? 0.56 : 0.30;
  ctx.sphere(0.088, 8, '#9A6E49', 0, baseY + 0.046, 0.145, {
    scaleY: moundH,
    roughness: 0.9,
  });
  if (isActive) {
    ctx.sphere(0.016, 5, '#B38359', -0.015, baseY + 0.095, 0.108);
    ctx.sphere(0.015, 5, '#7D5535', 0.016, baseY + 0.112, 0.098);
  }
}

function buildLitterBox(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const baseY = FLOOR_BASE_Y;

  // Front paw-catching litter mat
  ctx.box(0.38, 0.012, 0.17, '#DBD2C5', 0, baseY + 0.006, 0.34, {
    roughness: 0.92,
    castShadow: false,
  });

  // Lower base tray pan + wide rim lip
  ctx.box(0.52, 0.14, 0.56, accent, 0, baseY + 0.070, -0.02, { roughness: 0.58 });
  ctx.box(0.56, 0.028, 0.60, shade(accent, 0.08), 0, baseY + 0.144, -0.02, { roughness: 0.55 });

  // Pale oat-sand litter bed inside pan
  ctx.box(0.42, 0.03, 0.46, '#E4D5BC', 0, baseY + 0.085, -0.02, { roughness: 0.95 });

  // Rounded domed pastel hood enclosure (scaleZ squashes vertical axis after rotX = PI/2)
  ctx.box(0.50, 0.22, 0.54, primary, 0, baseY + 0.264, -0.02, { roughness: 0.52 });
  ctx.cyl(0.248, 0.248, 0.535, 10, primary, 0, baseY + 0.365, -0.02, {
    rotX: Math.PI / 2,
    scaleZ: 0.28,
    roughness: 0.52,
  });

  // Top ventilation filter grille & subtle recessed carry handle
  ctx.box(0.18, 0.018, 0.10, '#6B727E', 0, baseY + 0.432, -0.08, { roughness: 0.6 });
  ctx.box(0.14, 0.020, 0.024, shade(primary, -0.14), 0, baseY + 0.440, 0.06);

  // Arched front entryway (+Z) with strictly layered depths to prevent Z-fighting
  const doorZ = 0.252;
  ctx.box(0.26, 0.19, 0.032, accent, 0, baseY + 0.195, doorZ);
  ctx.cyl(0.13, 0.13, 0.022, 12, accent, 0, baseY + 0.285, doorZ - 0.001, { rotX: Math.PI / 2 });
  ctx.box(0.21, 0.17, 0.024, '#3B3633', 0, baseY + 0.190, doorZ + 0.022);
  ctx.cyl(0.105, 0.105, 0.020, 12, '#3B3633', 0, baseY + 0.275, doorZ + 0.022, {
    rotX: Math.PI / 2,
  });
  // Swinging semi-translucent cat flap
  ctx.box(0.195, 0.19, 0.012, '#F7F3EC', 0, baseY + 0.225, doorZ + 0.040, {
    opacity: 0.46,
    rotX: 0.10,
    roughness: 0.2,
    castShadow: false,
  });

  // Mini pastel litter scoop hooked neatly on the right side (+X)
  ctx.cyl(0.012, 0.012, 0.03, 6, shade(primary, -0.16), 0.262, baseY + 0.30, 0.02, {
    rotZ: Math.PI / 2,
  });
  ctx.cyl(0.011, 0.011, 0.13, 6, accent, 0.278, baseY + 0.245, 0.02);
  ctx.box(0.022, 0.095, 0.078, shade(accent, -0.06), 0.282, baseY + 0.145, 0.02);
}

function buildCatWallShelf(ctx: ModelContext): void {
  const { primary, shade } = ctx;
  const bracketWood = shade(primary, -0.16);

  // Floating wood perch shelf (wall at z = 0, protruding +Z)
  ctx.box(0.76, 0.044, 0.34, primary, 0, 0.032, 0.17, { roughness: 0.76 });

  // Soft plush carpeted pad on top
  ctx.box(0.68, 0.028, 0.27, '#F6F0E5', 0, 0.068, 0.175, { roughness: 0.94 });

  // Cute subtle cat-ear wood trim accents along back edge (offset from shelf back z = 0)
  ctx.box(0.70, 0.032, 0.028, shade(primary, -0.08), 0, 0.070, 0.022);
  for (const sx of [-0.26, 0.26]) {
    ctx.cone(0.022, 0.046, 4, primary, sx, 0.098, 0.032, { rotY: Math.PI / 4 });
  }

  // Two sleek angled triangular brackets strictly underneath shelf
  for (const sx of [-0.24, 0.24]) {
    ctx.box(0.034, 0.136, 0.026, bracketWood, sx, -0.058, 0.020, { roughness: 0.78 });
    addSegment(
      ctx,
      new THREE.Vector3(sx, -0.098, 0.036),
      new THREE.Vector3(sx, 0.010, 0.24),
      0.014,
      bracketWood,
      6,
    );
  }

  // Tiny hanging pom-pom toy dangling under right corner
  ctx.cyl(0.005, 0.005, 0.09, 5, '#D8C5A8', 0.28, -0.032, 0.27);
  ctx.sphere(0.034, 7, '#F2B8C6', 0.28, -0.088, 0.27, { roughness: 0.92 });
}

function buildCeilingCatwalk(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;
  const ropeCol = '#D8C29C';

  // 4 ceiling brass eye-hooks + vertical braided suspension ropes
  for (const sx of [-0.76, 0.76]) {
    for (const sz of [-0.17, 0.17]) {
      ctx.cyl(0.026, 0.022, 0.028, 8, '#D2B27C', sx, -0.014, sz, {
        metalness: 0.55,
        roughness: 0.3,
      });
      ctx.cyl(0.013, 0.013, 0.49, 6, ropeCol, sx, -0.26, sz, { roughness: 0.94 });
    }
  }

  // 9 wooden rope-bridge planks with a gentle cozy hammock sag in the center
  const plankCount = 9;
  const plankY = (x: number): number => {
    const u = x / 0.78;
    return -0.502 - 0.036 * (1 - u * u);
  };
  for (let i = 0; i < plankCount; i++) {
    const px = -0.76 + (i / (plankCount - 1)) * 1.52;
    const py = plankY(px);
    ctx.box(0.145, 0.034, 0.40, i % 2 === 0 ? primary : shade(primary, 0.05), px, py, 0, {
      roughness: 0.8,
    });
  }

  // Longitudinal underside support ropes + upper side safety ropes
  for (const sz of [-0.16, 0.16]) {
    addSegment(
      ctx,
      new THREE.Vector3(-0.76, -0.52, sz),
      new THREE.Vector3(0, -0.555, sz),
      0.011,
      ropeCol,
      5,
    );
    addSegment(
      ctx,
      new THREE.Vector3(0, -0.555, sz),
      new THREE.Vector3(0.76, -0.52, sz),
      0.011,
      ropeCol,
      5,
    );
    // Mid-height side guard ropes
    addSegment(
      ctx,
      new THREE.Vector3(-0.76, -0.32, sz),
      new THREE.Vector3(0, -0.36, sz),
      0.009,
      ropeCol,
      5,
    );
    addSegment(
      ctx,
      new THREE.Vector3(0, -0.36, sz),
      new THREE.Vector3(0.76, -0.32, sz),
      0.009,
      ropeCol,
      5,
    );
  }

  // Cozy plush cat-nap runner pad laid across the middle planks
  ctx.box(0.72, 0.022, 0.30, accent, 0, -0.508, 0, { roughness: 0.94 });
}

function buildWindowHammock(ctx: ModelContext): void {
  const { primary, accent, shade } = ctx;

  // 4 realistic translucent silicone suction cups pressed to wall/window (z = 0)
  for (const sx of [-0.28, 0.28]) {
    for (const sy of [-0.085, 0.11]) {
      ctx.cyl(0.036, 0.044, 0.026, 10, '#E4EDF2', sx, sy, 0.014, {
        rotX: Math.PI / 2,
        opacity: 0.78,
        roughness: 0.2,
      });
    }
  }

  // U-shaped tubular hammock frame extending +Z
  for (const sx of [-0.28, 0.28]) {
    ctx.cyl(0.016, 0.016, 0.34, 8, accent, sx, -0.085, 0.19, {
      rotX: Math.PI / 2,
      roughness: 0.5,
      metalness: 0.25,
    });
  }
  ctx.cyl(0.016, 0.016, 0.58, 8, accent, 0, -0.085, 0.36, {
    rotZ: Math.PI / 2,
    roughness: 0.5,
    metalness: 0.25,
  });

  // Twin taut steel suspension cables from upper suction cups to front frame corners
  for (const sx of [-0.28, 0.28]) {
    addSegment(
      ctx,
      new THREE.Vector3(sx, 0.11, 0.024),
      new THREE.Vector3(sx, -0.085, 0.355),
      0.006,
      '#B8C2CE',
      5,
      { metalness: 0.75, roughness: 0.22 },
    );
  }

  // Slung cozy fabric hammock sling with a gentle comfortable middle dip (non-coplanar widths)
  ctx.box(0.54, 0.022, 0.11, primary, 0, -0.086, 0.085, { rotX: 0.18, roughness: 0.92 });
  ctx.box(0.528, 0.022, 0.13, shade(primary, 0.05), 0, -0.104, 0.195, { roughness: 0.94 });
  ctx.box(0.54, 0.022, 0.11, primary, 0, -0.086, 0.305, { rotX: -0.18, roughness: 0.92 });

  // Soft rolled chin-rest fleece edge along front rail
  ctx.cyl(0.028, 0.028, 0.53, 8, shade(primary, 0.14), 0, -0.064, 0.345, {
    rotZ: Math.PI / 2,
    roughness: 0.95,
  });
}

function buildCatCalico(ctx: ModelContext): void {
  const { primary, variant, shade } = ctx;
  const baseY = FLOOR_BASE_Y;
  const innerEar = '#F2A6B4';
  const noseCol = '#F090A4';

  const isCalico = variant.id === 'calico';
  const isTuxedo = variant.id === 'tuxedo';

  const baseCoat = isCalico ? '#F7F1E7' : primary;
  const bibCol = isCalico ? '#FAF6EE' : isTuxedo ? '#F7F3EC' : '#F9EFE2';
  const pawCol = bibCol;
  const patchA = isCalico ? '#E79F68' : isTuxedo ? shade(primary, -0.16) : '#CF7E49';
  const patchB = isCalico ? '#4E4542' : patchA;
  const collarCol = isCalico ? '#E58D99' : isTuxedo ? '#94C9B8' : '#96BBE0';

  // Seated rounded haunches & upright teardrop torso
  ctx.sphere(0.112, 9, baseCoat, 0, baseY + 0.106, -0.025, {
    scaleX: 1.05,
    scaleY: 0.95,
    scaleZ: 1.15,
    roughness: 0.88,
  });
  ctx.cyl(0.076, 0.102, 0.168, 9, baseCoat, 0, baseY + 0.175, 0.015, {
    rotX: 0.14,
    roughness: 0.88,
  });
  // Fluffy chest bib
  ctx.sphere(0.068, 8, bibCol, 0, baseY + 0.165, 0.076, {
    scaleY: 1.16,
    scaleZ: 0.65,
    roughness: 0.92,
  });

  // Coat patches / tabby saddle accents
  if (isCalico) {
    ctx.sphere(0.072, 7, patchA, -0.068, baseY + 0.125, -0.035, {
      scaleX: 0.72,
      scaleY: 0.95,
      scaleZ: 1.1,
    });
    ctx.sphere(0.065, 7, patchB, 0.064, baseY + 0.145, -0.06, {
      scaleX: 0.75,
      scaleY: 0.88,
      scaleZ: 1.0,
    });
  } else if (!isTuxedo) {
    // Ginger back tabby markings
    ctx.sphere(0.068, 7, patchA, 0, baseY + 0.155, -0.078, {
      scaleX: 1.1,
      scaleY: 0.55,
      scaleZ: 0.7,
    });
  }

  // Neat upright front legs & dainty oval paws
  for (const sx of [-0.046, 0.046]) {
    ctx.cyl(0.026, 0.023, 0.148, 7, baseCoat, sx, baseY + 0.084, 0.098, { roughness: 0.88 });
    ctx.sphere(0.031, 7, pawCol, sx, baseY + 0.020, 0.126, {
      scaleY: 0.65,
      scaleZ: 1.24,
      roughness: 0.9,
    });
  }

  // Cozy collar + tiny gold bell
  ctx.torus(0.064, 0.012, 6, 12, collarCol, 0, baseY + 0.252, 0.040, {
    rotX: Math.PI / 2 + 0.14,
    roughness: 0.7,
  });
  ctx.sphere(0.016, 6, '#F2CA66', 0, baseY + 0.236, 0.106, {
    metalness: 0.68,
    roughness: 0.24,
  });

  // Alert rounded head looking slightly upward toward the viewer
  const head = new THREE.Group();
  head.position.set(0, baseY + 0.324, 0.052);
  head.rotation.x = -0.14;
  ctx.group.add(head);

  ctx.sphere(0.095, 10, baseCoat, 0, 0, 0, {
    scaleX: 1.08,
    scaleY: 0.94,
    scaleZ: 0.98,
    roughness: 0.88,
    parent: head,
  });

  // Calico head patches (ginger over left brow, charcoal over right ear)
  if (isCalico) {
    ctx.sphere(0.052, 7, patchA, -0.048, 0.036, 0.025, { scaleZ: 0.85, parent: head });
    ctx.sphere(0.048, 7, patchB, 0.052, 0.032, -0.01, { scaleZ: 0.85, parent: head });
  }

  // Pointed triangular ears with pink inner ears
  addCatEars(
    ctx,
    head,
    isCalico ? patchA : baseCoat,
    isCalico ? patchB : baseCoat,
    innerEar,
    {
      spreadX: 0.064,
      y: 0.086,
      z: -0.004,
      radius: 0.038,
      height: 0.076,
      tiltZ: 0.22,
    },
  );

  // Cute muzzle cheek puffs, pink nose, and expressive sparkling eyes
  for (const sx of [-0.023, 0.023]) {
    ctx.sphere(0.026, 7, bibCol, sx, -0.022, 0.082, { scaleZ: 0.72, parent: head });
  }
  ctx.cone(0.013, 0.014, 3, noseCol, 0, -0.008, 0.098, {
    rotX: Math.PI / 2,
    parent: head,
  });
  for (const sx of [-0.038, 0.038]) {
    ctx.sphere(0.015, 7, '#231F24', sx, 0.014, 0.084, { roughness: 0.12, parent: head });
    ctx.sphere(0.0055, 5, '#FFFFFF', sx + 0.004, 0.020, 0.096, {
      castShadow: false,
      parent: head,
    });
  }

  // Graceful curved tail wrapping around the right flank toward front paws
  const tailPts = [
    { x: 0.02, y: baseY + 0.054, z: -0.132, r: 0.030, col: baseCoat },
    { x: 0.105, y: baseY + 0.042, z: -0.105, r: 0.028, col: isCalico ? patchB : baseCoat },
    { x: 0.145, y: baseY + 0.034, z: -0.010, r: 0.026, col: isCalico ? patchA : baseCoat },
    { x: 0.120, y: baseY + 0.030, z: 0.088, r: 0.024, col: bibCol },
  ];
  for (const tp of tailPts) {
    ctx.sphere(tp.r, 7, tp.col, tp.x, tp.y, tp.z, { scaleY: 0.85, roughness: 0.9 });
  }
}

function buildCatSleepy(ctx: ModelContext): void {
  const { primary, accent } = ctx;
  const baseY = FLOOR_BASE_Y;
  const innerEar = '#F2AAB6';

  // Cozy coiled sleeping croissant body built from 3 plump overlapping spheres
  ctx.sphere(0.132, 10, primary, -0.035, baseY + 0.104, -0.055, {
    scaleX: 1.24,
    scaleY: 0.76,
    scaleZ: 0.92,
    roughness: 0.92,
  });
  ctx.sphere(0.112, 9, primary, -0.125, baseY + 0.088, 0.040, {
    scaleX: 0.96,
    scaleY: 0.72,
    scaleZ: 1.08,
    roughness: 0.92,
  });
  ctx.sphere(0.116, 9, primary, 0.098, baseY + 0.096, -0.035, {
    scaleX: 1.0,
    scaleY: 0.76,
    scaleZ: 1.04,
    roughness: 0.92,
  });

  // Soft tabby accent stripes curving gently across the cozy back
  for (let i = -1; i <= 1; i++) {
    ctx.sphere(0.045, 7, accent, -0.035 + i * 0.068, baseY + 0.168, -0.055, {
      scaleX: 0.45,
      scaleY: 0.55,
      scaleZ: 1.45,
      roughness: 0.92,
    });
  }

  // Sleepy rounded head tucked sweetly on the front-right side of the coil
  const head = new THREE.Group();
  head.position.set(0.058, baseY + 0.104, 0.096);
  head.rotation.set(0.12, -0.22, -0.16);
  ctx.group.add(head);

  ctx.sphere(0.086, 10, primary, 0, 0, 0, {
    scaleX: 1.08,
    scaleY: 0.90,
    scaleZ: 0.96,
    roughness: 0.9,
    parent: head,
  });

  addCatEars(ctx, head, primary, primary, innerEar, {
    spreadX: 0.056,
    y: 0.072,
    z: -0.010,
    radius: 0.033,
    height: 0.062,
    tiltZ: 0.30,
  });

  // Peaceful closed snooze eyes, tiny pink nose & plush cheeks
  for (const sx of [-0.034, 0.034]) {
    ctx.box(0.026, 0.007, 0.008, '#383034', sx, 0.004, 0.080, {
      rotZ: sx < 0 ? 0.16 : -0.16,
      parent: head,
    });
    ctx.sphere(0.022, 6, accent, sx * 0.68, -0.020, 0.074, { scaleZ: 0.7, parent: head });
  }
  ctx.cone(0.011, 0.012, 3, '#F094A8', 0, -0.008, 0.088, {
    rotX: Math.PI / 2,
    parent: head,
  });

  // Tiny tucked paw peeking under the chin
  ctx.sphere(0.030, 7, accent, 0.018, baseY + 0.030, 0.168, {
    scaleY: 0.62,
    scaleZ: 1.15,
    roughness: 0.92,
  });

  // Fluffy tail curled gracefully across the front and tucked near the nose!
  const tailPts = [
    { x: -0.135, y: baseY + 0.050, z: 0.118, r: 0.034, col: primary },
    { x: -0.055, y: baseY + 0.048, z: 0.180, r: 0.032, col: primary },
    { x: 0.032, y: baseY + 0.054, z: 0.194, r: 0.029, col: accent },
    { x: 0.095, y: baseY + 0.068, z: 0.168, r: 0.025, col: accent },
  ];
  for (const tp of tailPts) {
    ctx.sphere(tp.r, 7, tp.col, tp.x, tp.y, tp.z, { scaleY: 0.84, roughness: 0.94 });
  }
}

function buildCatKitten(ctx: ModelContext): void {
  const { primary, accent, variant } = ctx;
  const baseY = FLOOR_BASE_Y;
  const innerEar = '#F4AAB8';

  const isSiamese = variant.id === 'siamese';
  const isMarmalade = variant.id === 'marmalade';
  const earCol = isSiamese || !isMarmalade ? accent : primary;
  const pawCol = isSiamese ? accent : isMarmalade ? accent : primary;
  const tailCol = isSiamese ? accent : primary;

  // Compact playful kitten torso + fluffy chest
  ctx.sphere(0.078, 9, primary, 0, baseY + 0.086, -0.020, {
    scaleX: 0.96,
    scaleY: 0.92,
    scaleZ: 1.24,
    roughness: 0.9,
  });
  ctx.sphere(0.052, 7, isMarmalade ? accent : primary, 0, baseY + 0.094, 0.048, {
    scaleZ: 0.72,
    roughness: 0.92,
  });

  // Back tucked haunches
  for (const sx of [-0.050, 0.050]) {
    ctx.sphere(0.050, 7, primary, sx, baseY + 0.054, -0.052, { roughness: 0.9 });
    ctx.sphere(0.024, 6, pawCol, sx * 1.05, baseY + 0.021, -0.018, {
      scaleY: 0.65,
      scaleZ: 1.2,
    });
  }

  // Left planted front leg & paw
  ctx.cyl(0.020, 0.018, 0.095, 7, primary, -0.044, baseY + 0.056, 0.062, { roughness: 0.9 });
  ctx.sphere(0.025, 7, pawCol, -0.044, baseY + 0.021, 0.082, {
    scaleY: 0.65,
    scaleZ: 1.2,
  });

  // Right RAISED playful batting paw!
  addSegment(
    ctx,
    new THREE.Vector3(0.042, baseY + 0.094, 0.056),
    new THREE.Vector3(0.072, baseY + 0.128, 0.140),
    0.018,
    primary,
    7,
  );
  ctx.sphere(0.026, 7, pawCol, 0.076, baseY + 0.130, 0.150, { roughness: 0.9 });

  // Tiny pastel yarn ball right underneath the batting paw
  ctx.sphere(0.036, 8, '#F2B4C4', 0.105, baseY + 0.042, 0.175, { roughness: 0.92 });
  ctx.torus(0.036, 0.005, 5, 10, '#E397AA', 0.105, baseY + 0.042, 0.175, {
    rotX: 0.7,
    rotY: 0.4,
  });

  // Big expressive playful kitten head with cute head tilt
  const head = new THREE.Group();
  head.position.set(0, baseY + 0.198, 0.044);
  head.rotation.set(-0.14, 0.08, 0.14);
  ctx.group.add(head);

  ctx.sphere(0.086, 10, primary, 0, 0, 0, {
    scaleX: 1.06,
    scaleY: 0.96,
    scaleZ: 0.96,
    roughness: 0.9,
    parent: head,
  });

  // Siamese cocoa face mask
  if (isSiamese) {
    ctx.sphere(0.044, 8, accent, 0, -0.010, 0.058, {
      scaleX: 1.12,
      scaleY: 0.86,
      scaleZ: 0.65,
      parent: head,
    });
  }

  // Oversized perky kitten ears with pink inner triangles
  addCatEars(ctx, head, earCol, earCol, innerEar, {
    spreadX: 0.058,
    y: 0.080,
    z: -0.004,
    radius: 0.040,
    height: 0.082,
    tiltZ: 0.24,
  });

  // Big sparkling kitten eyes, pink nose & cheeks
  for (const sx of [-0.034, 0.034]) {
    ctx.sphere(0.017, 7, '#231F24', sx, 0.012, 0.076, { roughness: 0.1, parent: head });
    ctx.sphere(0.0065, 5, '#FFFFFF', sx + 0.005, 0.018, 0.089, {
      castShadow: false,
      parent: head,
    });
    if (!isSiamese) {
      ctx.sphere(0.022, 6, isMarmalade ? accent : '#F6F1E9', sx * 0.65, -0.022, 0.074, {
        scaleZ: 0.7,
        parent: head,
      });
    }
  }
  ctx.cone(0.012, 0.012, 3, '#F292A6', 0, -0.008, 0.088, {
    rotX: Math.PI / 2,
    parent: head,
  });

  // Perky upright happy question-mark tail (reaches height ~0.33)
  const t0 = new THREE.Vector3(0, baseY + 0.102, -0.102);
  const t1 = new THREE.Vector3(0, baseY + 0.215, -0.132);
  const t2 = new THREE.Vector3(0, baseY + 0.295, -0.118);
  const t3 = new THREE.Vector3(0.028, baseY + 0.305, -0.082);
  addSegment(ctx, t0, t1, 0.018, tailCol, 7);
  addSegment(ctx, t1, t2, 0.016, tailCol, 7);
  addSegment(ctx, t2, t3, 0.015, accent, 7);
  ctx.sphere(0.018, 6, accent, t3.x, t3.y, t3.z, { roughness: 0.92 });
}

function buildCatLoaf(ctx: ModelContext): void {
  const { primary, accent, variant, shade } = ctx;
  const innerEar = variant.id === 'milk' ? accent : '#F2AAB6';
  const pawCol = variant.id === 'milk' ? '#FAF6F0' : accent;

  // Plump compact bread-loaf torso sitting squarely at y = 0 (surface item!)
  ctx.sphere(0.142, 11, primary, 0, 0.102, -0.012, {
    scaleX: 0.92,
    scaleY: 0.70,
    scaleZ: 1.24,
    roughness: 0.9,
  });
  // Flush underside cushion so loaf hugs tables, counters & cat trees seamlessly
  ctx.cyl(0.112, 0.118, 0.036, 12, shade(primary, 0.08), 0, 0.018, -0.012, {
    scaleZ: 1.22,
    roughness: 0.92,
  });

  // Toasted golden crust highlight for Brioche, or cozy chest bib for Sesame
  if (variant.id === 'brioche') {
    ctx.sphere(0.105, 9, shade(primary, -0.10), 0, 0.138, -0.025, {
      scaleX: 0.85,
      scaleY: 0.52,
      scaleZ: 1.25,
      roughness: 0.88,
    });
  } else if (variant.id === 'sesame') {
    ctx.sphere(0.068, 8, accent, 0, 0.082, 0.125, {
      scaleX: 0.95,
      scaleY: 0.85,
      scaleZ: 0.55,
      roughness: 0.92,
    });
  }

  // Two tiny tucked front paw nubs peeking snugly beneath the loaf chest
  for (const sx of [-0.046, 0.046]) {
    ctx.sphere(0.028, 7, pawCol, sx, 0.022, 0.146, {
      scaleX: 1.15,
      scaleY: 0.65,
      scaleZ: 0.9,
      roughness: 0.92,
    });
  }

  // Plump rounded head nestled snugly into the loaf shoulders
  const head = new THREE.Group();
  head.position.set(0, 0.152, 0.140);
  ctx.group.add(head);

  ctx.sphere(0.086, 10, primary, 0, 0, 0, {
    scaleX: 1.10,
    scaleY: 0.92,
    scaleZ: 0.95,
    roughness: 0.9,
    parent: head,
  });

  addCatEars(ctx, head, primary, primary, innerEar, {
    spreadX: 0.056,
    y: 0.072,
    z: -0.004,
    radius: 0.033,
    height: 0.060,
    tiltZ: 0.20,
  });

  // Ultra-content happy half-moon squint eyes (^ ^)
  for (const sx of [-0.036, 0.036]) {
    ctx.box(0.017, 0.006, 0.007, '#362E32', sx - 0.006, 0.012, 0.079, {
      rotZ: 0.45,
      parent: head,
    });
    ctx.box(0.017, 0.006, 0.007, '#362E32', sx + 0.006, 0.012, 0.083, {
      rotZ: -0.45,
      parent: head,
    });
    // Soft rosy blush dots on plump cheeks
    ctx.sphere(0.015, 6, '#F4B2BE', sx * 1.52, -0.014, 0.066, {
      scaleZ: 0.45,
      castShadow: false,
      parent: head,
    });
  }
  // Tiny pink nose + cream muzzle puffs
  for (const sx of [-0.019, 0.019]) {
    ctx.sphere(0.022, 6, pawCol, sx, -0.020, 0.076, { scaleZ: 0.72, parent: head });
  }
  ctx.cone(0.011, 0.012, 3, '#F094A8', 0, -0.006, 0.088, {
    rotX: Math.PI / 2,
    parent: head,
  });

  // Fluffy tail tucked neatly along the right flank of the loaf
  const tailPts = [
    { x: 0.115, y: 0.034, z: -0.105, r: 0.028 },
    { x: 0.132, y: 0.034, z: -0.012, r: 0.026 },
    { x: 0.115, y: 0.036, z: 0.076, r: 0.024 },
  ];
  for (let i = 0; i < tailPts.length; i++) {
    const tp = tailPts[i];
    ctx.sphere(tp.r, 7, i === 2 ? pawCol : primary, tp.x, tp.y, tp.z, {
      scaleY: 0.8,
      roughness: 0.92,
    });
  }
}

export const buildPetsModel: TabModelBuilder = (ctx: ModelContext): boolean => {
  switch (ctx.def.id) {
    case 'cat_tree':
      buildCatTree(ctx);
      return true;
    case 'cat_condo_tower':
      buildCatCondoTower(ctx);
      return true;
    case 'scratch_post':
      buildScratchPost(ctx);
      return true;
    case 'cat_feather_wand':
      buildCatFeatherWand(ctx);
      return true;
    case 'cat_tunnel':
      buildCatTunnel(ctx);
      return true;
    case 'cat_ball_track':
      buildCatBallTrack(ctx);
      return true;
    case 'pet_bed_round':
      buildPetBedRound(ctx);
      return true;
    case 'pet_bowls':
      buildPetBowls(ctx);
      return true;
    case 'pet_auto_feeder':
      buildPetAutoFeeder(ctx);
      return true;
    case 'litter_box':
      buildLitterBox(ctx);
      return true;
    case 'cat_wall_shelf':
      buildCatWallShelf(ctx);
      return true;
    case 'ceiling_catwalk':
      buildCeilingCatwalk(ctx);
      return true;
    case 'window_hammock':
      buildWindowHammock(ctx);
      return true;
    case 'cat_calico':
      buildCatCalico(ctx);
      return true;
    case 'cat_sleepy':
      buildCatSleepy(ctx);
      return true;
    case 'cat_kitten':
      buildCatKitten(ctx);
      return true;
    case 'cat_loaf':
      buildCatLoaf(ctx);
      return true;
    default:
      return false;
  }
};
