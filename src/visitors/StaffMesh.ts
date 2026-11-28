import * as THREE from 'three';
import type { VisitorDef } from '../data/schemas';
import { SpeechBubble } from './SpeechBubble';
import { FLOOR_BASE_Y, VisitorMesh, type VisitorPose, type VisitorVariantIndex } from './VisitorMesh';

export type StaffRoleId = 'barista' | 'dj' | 'chef' | 'bartender';
export type StaffKindId = 'bot' | 'human';
export type StaffPose = 'idle' | 'walk' | 'work' | 'recharge' | 'sit' | 'dance' | 'stumble';

export interface StaffMeshConfig {
  id: string;
  role: StaffRoleId;
  kind: StaffKindId;
  name: string;
  accentColor?: string;
}

interface BotPalette {
  chassis: string;
  trim: string;
  trimDark: string;
  led: string;
  visor: string;
  accent: string;
}

const BOT_PALETTES: Record<StaffRoleId, BotPalette> = {
  barista: {
    chassis: '#F4EFE6',
    trim: '#C97D5D',
    trimDark: '#8F5039',
    led: '#FFE09E',
    visor: '#1E2129',
    accent: '#7A4E36',
  },
  dj: {
    chassis: '#F3EFF8',
    trim: '#A08CE8',
    trimDark: '#6955B2',
    led: '#7CEEFF',
    visor: '#1B1E2B',
    accent: '#68D9EC',
  },
  chef: {
    chassis: '#F4F1EA',
    trim: '#8ABF99',
    trimDark: '#5B8F6C',
    led: '#FFF0AD',
    visor: '#1E2326',
    accent: '#FAF7F0',
  },
  bartender: {
    chassis: '#F2F0EA',
    trim: '#7CC2B5',
    trimDark: '#4D8E82',
    led: '#FFCC80',
    visor: '#1D232A',
    accent: '#E89B7E',
  },
};

const HUMAN_STAFF_ARCHETYPES: Record<
  StaffRoleId,
  { archetypeId: string; color: string; variantIndex: VisitorVariantIndex }
> = {
  barista: { archetypeId: 'coffee_snob', color: '#C9A17E', variantIndex: 1 },
  dj: { archetypeId: 'party_goer', color: '#B49EE6', variantIndex: 0 },
  chef: { archetypeId: 'foodie', color: '#E8B884', variantIndex: 0 },
  bartender: { archetypeId: 'homebody', color: '#86B8B0', variantIndex: 0 },
};

function makeBotSyntheticVisitorDef(role: StaffRoleId): VisitorDef {
  const mapped = HUMAN_STAFF_ARCHETYPES[role];
  return {
    id: mapped.archetypeId,
    name: role,
    description: `Cozyhouse ${role}`,
    color: mapped.color,
    model: '',
    likedTags: [],
    dislikedTags: [],
    preferredInteractions: [],
    walkSpeed: 1.55,
    patienceSeconds: 999,
    voiceProfile: {
      basePitch: 320,
      pitchVariance: 45,
      syllableRate: 6.2,
      waveform: 'sine',
    },
  };
}

/**
 * 3D figurine for hireable staff — either:
 * - **Cozy Bot (`kind === 'bot'`)**: adorable low-poly pastel wheeled/hovering robot with glossy-matte
 *   cream chassis, role-colored pastel trim, dark visor with glowing `^ ^` LED eyes, bobbing glowing
 *   antenna, articulated arms, and role accessories (barista apron+mug, DJ glowing headphones,
 *   pleated chef toque, bartender bowtie+shaker).
 * - **Human Staff (`kind === 'human'`)**: reuses `VisitorMesh` with crisp role uniform overlays
 *   so human staff can walk, work, sit on couches/toilets on break, and dance seamlessly.
 */
export class StaffMesh {
  readonly root = new THREE.Group();
  readonly speechBubble: SpeechBubble;
  readonly kind: StaffKindId;
  readonly role: StaffRoleId;

  private readonly humanMesh: VisitorMesh | null = null;
  private humanRightHandProp: THREE.Group | null = null;

  // Cozy Bot rig pivots & animated glowing materials
  private readonly bodyPivot = new THREE.Group();
  private readonly wheelPivot = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly antennaPivot = new THREE.Group();
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private ledMat: THREE.MeshStandardMaterial | null = null;
  private chestLedMat: THREE.MeshStandardMaterial | null = null;
  private antennaTipMat: THREE.MeshStandardMaterial | null = null;
  private baseLedHex = '#FFE09E';

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private animPhase = Math.random() * Math.PI * 2;
  private pulsePhase = Math.random() * Math.PI * 2;
  private rechargeSpin = 0;

  constructor(config: StaffMeshConfig, variantSeed = 0) {
    this.kind = config.kind;
    this.role = config.role;
    this.root.name = `Staff_${config.kind}_${config.role}_${config.id}`;

    if (config.kind === 'human') {
      const mapped = HUMAN_STAFF_ARCHETYPES[config.role];
      const vIdx = ((mapped.variantIndex + variantSeed) % 3) as VisitorVariantIndex;
      this.humanMesh = new VisitorMesh(makeBotSyntheticVisitorDef(config.role), vIdx);
      this.speechBubble = this.humanMesh.speechBubble;
      this.root.add(this.humanMesh.root);
      this.attachHumanUniformAccessories(this.humanMesh, config.role);
    } else {
      this.speechBubble = new SpeechBubble();
      this.speechBubble.setBaseHeight(1.48);
      this.buildCozyBot(config.role, config.accentColor);
      this.root.add(this.speechBubble.sprite);
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private makeMat(hex: string, roughness = 0.65, metalness = 0.08): THREE.MeshStandardMaterial {
    return this.trackMat(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex),
        roughness,
        metalness,
        flatShading: true,
        transparent: false,
        depthWrite: true,
      }),
    );
  }

  private makeGlowMat(hex: string, emissiveIntensity = 0.85): THREE.MeshStandardMaterial {
    return this.trackMat(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex),
        emissive: new THREE.Color(hex),
        emissiveIntensity,
        roughness: 0.25,
        metalness: 0.05,
        flatShading: true,
        transparent: false,
        depthWrite: true,
      }),
    );
  }

  private addBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addCyl(
    parent: THREE.Object3D,
    rt: number,
    rb: number,
    h: number,
    seg: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addSphere(
    parent: THREE.Object3D,
    r: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    segW = 10,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(r, segW, Math.max(6, segW - 2))),
      mat,
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * Builds the adorable low-poly pastel Cozy Bot rig (100% opaque, flat-shaded, zero Z-fighting).
   */
  private buildCozyBot(role: StaffRoleId, accentOverride?: string): void {
    const palette = BOT_PALETTES[role];
    const trimHex = accentOverride || palette.trim;
    this.baseLedHex = palette.led;

    this.root.add(this.bodyPivot);
    this.bodyPivot.position.y = FLOOR_BASE_Y;

    // Soft ground shadow disc matching 0.42 body footprint
    const shadowGeo = this.trackGeo(new THREE.CircleGeometry(0.2, 16));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x453930,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
      }),
    );
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = FLOOR_BASE_Y + 0.004;
    this.root.add(shadow);

    const chassisMat = this.makeMat(palette.chassis, 0.36, 0.08);
    const trimMat = this.makeMat(trimHex, 0.48, 0.12);
    const trimDarkMat = this.makeMat(palette.trimDark, 0.52, 0.14);
    const metalMat = this.makeMat('#D2C7B8', 0.32, 0.55);
    const tireMat = this.makeMat('#403B38', 0.72, 0.1);
    const visorMat = this.makeMat(palette.visor, 0.16, 0.36);
    const accentMat = this.makeMat(palette.accent, 0.65, 0.12);
    const blushMat = this.makeGlowMat('#FF9EB5', 0.45);

    this.ledMat = this.makeGlowMat(palette.led, 0.95);
    this.chestLedMat = this.makeGlowMat(palette.led, 0.85);
    this.antennaTipMat = this.makeGlowMat(palette.led, 1.0);

    // 1. Wheeled Hover-Pod Base (bottom of roller touches y = 0.0 on FLOOR_BASE_Y cleanly at every spin angle!)
    this.wheelPivot.position.set(0, 0.072, 0);
    this.bodyPivot.add(this.wheelPivot);
    this.addSphere(this.wheelPivot, 0.072, tireMat, 0, 0, 0, 1, 1, 1, 10);
    this.addCyl(this.wheelPivot, 0.052, 0.052, 0.036, 10, metalMat, -0.115, 0, 0).rotation.z =
      Math.PI / 2;
    this.addCyl(this.wheelPivot, 0.052, 0.052, 0.036, 10, metalMat, 0.115, 0, 0).rotation.z =
      Math.PI / 2;

    // Lower flared pastel hover skirt
    this.addCyl(this.bodyPivot, 0.148, 0.172, 0.135, 12, trimMat, 0, 0.145, 0);
    const hoverRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.156, 0.016, 6, 16)),
      metalMat,
    );
    hoverRing.rotation.x = Math.PI / 2;
    hoverRing.position.set(0, 0.215, 0);
    hoverRing.castShadow = true;
    this.bodyPivot.add(hoverRing);

    // 2. Rounded Cream Torso Chassis (hinged at y = 0.22)
    this.torsoPivot.position.set(0, 0.22, 0);
    this.bodyPivot.add(this.torsoPivot);

    // Waist trim collar
    this.addCyl(this.torsoPivot, 0.142, 0.136, 0.055, 12, trimDarkMat, 0, 0.028, 0);
    // Main cream rounded body
    this.addCyl(this.torsoPivot, 0.162, 0.146, 0.26, 12, chassisMat, 0, 0.17, 0);
    this.addSphere(this.torsoPivot, 0.162, chassisMat, 0, 0.295, 0, 1, 0.44, 0.94, 12);
    // Back battery backpack detail
    this.addBox(this.torsoPivot, 0.15, 0.16, 0.055, trimMat, 0, 0.175, -0.155);
    this.addBox(this.torsoPivot, 0.1, 0.04, 0.015, this.chestLedMat, 0, 0.205, -0.186);

    // Front chest recessed bezel & glowing status indicator
    this.addBox(this.torsoPivot, 0.145, 0.09, 0.026, trimDarkMat, 0, 0.175, 0.15);
    this.addBox(this.torsoPivot, 0.115, 0.058, 0.014, visorMat, 0, 0.175, 0.162);
    this.addSphere(this.torsoPivot, 0.019, this.chestLedMat, 0, 0.175, 0.174, 1.3, 0.9, 0.6, 8);

    // 3. Articulated Stubby Robot Arms (strictly outside chassis at x = ±0.20)
    this.leftArmPivot.position.set(-0.202, 0.24, 0);
    this.rightArmPivot.position.set(0.202, 0.24, 0);
    this.torsoPivot.add(this.leftArmPivot, this.rightArmPivot);

    this.buildBotArm(this.leftArmPivot, trimMat, chassisMat, metalMat);
    this.buildBotArm(this.rightArmPivot, trimMat, chassisMat, metalMat);

    // 4. Rounded Head + Glossy Visor + Glowing `^ ^` LED Eyes + Bobbing Antenna
    this.headPivot.position.set(0, 0.355, 0);
    this.torsoPivot.add(this.headPivot);

    // Neck joint ring
    this.addCyl(this.headPivot, 0.068, 0.075, 0.055, 10, metalMat, 0, 0.018, 0);

    // Rounded cute TV-style head housing
    this.addBox(this.headPivot, 0.31, 0.225, 0.24, chassisMat, 0, 0.155, 0);
    this.addSphere(this.headPivot, 0.148, chassisMat, 0, 0.245, 0, 1.02, 0.34, 0.82, 12);
    // Side ear caps
    const leftCap = this.addCyl(this.headPivot, 0.054, 0.054, 0.042, 10, trimMat, -0.17, 0.155, 0);
    leftCap.rotation.z = Math.PI / 2;
    const rightCap = this.addCyl(this.headPivot, 0.054, 0.054, 0.042, 10, trimMat, 0.17, 0.155, 0);
    rightCap.rotation.z = Math.PI / 2;

    // Dark glossy face visor (strictly proud of front face z=0.12 -> z=0.125..0.149)
    this.addBox(this.headPivot, 0.258, 0.156, 0.024, visorMat, 0, 0.155, 0.125);

    // Glowing pastel `^ ^` happy LED eyes strictly proud at z = 0.142
    this.buildHappyChevronEye(-0.062, 0.168, 0.142, this.ledMat);
    this.buildHappyChevronEye(0.062, 0.168, 0.142, this.ledMat);
    // Cute blush dots & smiling LED mouth
    this.addSphere(this.headPivot, 0.015, blushMat, -0.095, 0.126, 0.141, 1.25, 0.72, 0.45, 6);
    this.addSphere(this.headPivot, 0.015, blushMat, 0.095, 0.126, 0.141, 1.25, 0.72, 0.45, 6);
    this.addBox(this.headPivot, 0.044, 0.011, 0.009, this.ledMat, 0, 0.118, 0.142);

    // Bobbing antenna with glowing pastel tip orb (slightly rear-offset for chef so toque sits cleanly!)
    this.antennaPivot.position.set(role === 'chef' ? -0.085 : 0, 0.285, role === 'chef' ? -0.055 : 0);
    this.headPivot.add(this.antennaPivot);
    this.addCyl(this.antennaPivot, 0.018, 0.024, 0.026, 8, trimDarkMat, 0, 0.01, 0);
    this.addCyl(this.antennaPivot, 0.008, 0.011, 0.135, 6, metalMat, 0, 0.082, 0);
    this.addSphere(this.antennaPivot, 0.032, this.antennaTipMat, 0, 0.162, 0, 1, 1, 1, 8);

    // 5. Role Badges & Accessories
    if (role === 'barista') {
      // Cute café apron panel + tiny steaming espresso mug in right hand
      this.addBox(this.torsoPivot, 0.175, 0.135, 0.02, accentMat, 0, 0.08, 0.156);
      this.addBox(this.torsoPivot, 0.08, 0.035, 0.014, chassisMat, 0, 0.085, 0.17);
      // Chunky trim-coloured mug with handle and a dark coffee surface, big enough to read
      const mugCup = this.addCyl(this.rightArmPivot, 0.05, 0.042, 0.085, 8, trimMat, 0, -0.215, 0.056);
      mugCup.rotation.x = 0.25;
      this.addCyl(this.rightArmPivot, 0.041, 0.041, 0.012, 8, accentMat, 0, -0.176, 0.066).rotation.x = 0.25;
      this.addBox(this.rightArmPivot, 0.03, 0.046, 0.018, trimDarkMat, 0.058, -0.213, 0.056, 0.25);
    } else if (role === 'dj') {
      // Glowing pastel DJ headphones arched cleanly over head
      const band = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.185, 0.02, 6, 16, Math.PI)),
        trimDarkMat,
      );
      band.position.set(0, 0.165, 0);
      band.castShadow = true;
      this.headPivot.add(band);
      const cupL = this.addCyl(this.headPivot, 0.062, 0.062, 0.044, 10, trimMat, -0.195, 0.158, 0);
      cupL.rotation.z = Math.PI / 2;
      const cupR = this.addCyl(this.headPivot, 0.062, 0.062, 0.044, 10, trimMat, 0.195, 0.158, 0);
      cupR.rotation.z = Math.PI / 2;
      const glowL = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.048, 0.01, 6, 12)), this.ledMat);
      glowL.rotation.y = Math.PI / 2;
      glowL.position.set(-0.219, 0.158, 0);
      const glowR = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.048, 0.01, 6, 12)), this.ledMat);
      glowR.rotation.y = Math.PI / 2;
      glowR.position.set(0.219, 0.158, 0);
      this.headPivot.add(glowL, glowR);
    } else if (role === 'chef') {
      // Tall pleated white chef toque + wooden stirring spoon in right hand
      const toqueMat = this.makeMat('#FAF7F0', 0.85, 0.02);
      this.addCyl(this.headPivot, 0.095, 0.088, 0.085, 10, toqueMat, 0.01, 0.325, 0.01);
      this.addSphere(this.headPivot, 0.078, toqueMat, 0.01, 0.405, 0.01, 1.25, 0.92, 1.18, 10);
      this.addSphere(this.headPivot, 0.056, toqueMat, -0.052, 0.39, 0.032, 1, 0.9, 1, 8);
      this.addSphere(this.headPivot, 0.056, toqueMat, 0.068, 0.39, 0.028, 1, 0.9, 1, 8);
      this.addSphere(this.headPivot, 0.054, toqueMat, 0.01, 0.392, -0.045, 1, 0.9, 1, 8);
      // Wooden stirring spoon in right hand
      const woodMat = this.makeMat('#C99A6B', 0.78, 0.04);
      this.addCyl(this.rightArmPivot, 0.013, 0.015, 0.2, 6, woodMat, 0, -0.2, 0.07).rotation.x = 0.65;
      this.addSphere(this.rightArmPivot, 0.04, woodMat, 0, -0.142, 0.158, 1, 0.5, 1.3, 7);
    } else if (role === 'bartender') {
      // Cute bowtie at upper chest + shiny cocktail shaker in right hand
      const bowL = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.032, 0.058, 6)), accentMat);
      bowL.rotation.z = -Math.PI / 2;
      bowL.position.set(-0.032, 0.275, 0.165);
      const bowR = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.032, 0.058, 6)), accentMat);
      bowR.rotation.z = Math.PI / 2;
      bowR.position.set(0.032, 0.275, 0.165);
      const knot = this.addSphere(this.torsoPivot, 0.018, trimDarkMat, 0, 0.275, 0.168, 1, 1, 0.8, 6);
      this.torsoPivot.add(bowL, bowR, knot);
      // Metallic cocktail shaker in right hand
      // (low metalness: there is no environment map, so a mirror-like metal would render black)
      const shakerMat = this.makeMat('#E3EAEE', 0.3, 0.25);
      const shaker = this.addCyl(this.rightArmPivot, 0.034, 0.044, 0.13, 8, shakerMat, 0, -0.21, 0.056);
      shaker.rotation.x = 0.32;
      const cap = this.addCyl(this.rightArmPivot, 0.02, 0.03, 0.04, 8, trimMat, 0, -0.132, 0.082);
      cap.rotation.x = 0.32;
    }
  }

  private buildHappyChevronEye(x: number, y: number, z: number, mat: THREE.Material): void {
    this.addBox(this.headPivot, 0.034, 0.011, 0.008, mat, x - 0.012, y, z, 0, 0, 0.56);
    this.addBox(this.headPivot, 0.034, 0.011, 0.008, mat, x + 0.012, y, z, 0, 0, -0.56);
  }

  private buildBotArm(
    pivot: THREE.Group,
    trimMat: THREE.Material,
    chassisMat: THREE.Material,
    metalMat: THREE.Material,
  ): void {
    this.addSphere(pivot, 0.044, trimMat, 0, 0, 0, 1, 1, 1, 8);
    this.addCyl(pivot, 0.032, 0.028, 0.145, 8, chassisMat, 0, -0.088, 0);
    this.addCyl(pivot, 0.034, 0.034, 0.022, 8, metalMat, 0, -0.155, 0);
    this.addSphere(pivot, 0.036, trimMat, 0, -0.182, 0, 1, 0.9, 1.05, 8);
  }

  /**
   * Attaches crisp non-coplanar role uniform accessories directly to a Human Staff's `VisitorMesh`
   * pivots so they move naturally with walk, work, sit, and dance animations!
   */
  private attachHumanUniformAccessories(mesh: VisitorMesh, role: StaffRoleId): void {
    if (role === 'barista') {
      const apronMat = this.makeMat('#6B4635', 0.82, 0.04);
      const badgeMat = this.makeMat('#F5E6D0', 0.72, 0.06);
      const capMat = this.makeMat('#7D533C', 0.8, 0.04);
      // Apron bib & waist panel clearly proud of torso front (z = 0.132)
      this.addBox(mesh.torsoPivot, 0.21, 0.24, 0.016, apronMat, 0, 0.135, 0.134);
      this.addBox(mesh.torsoPivot, 0.08, 0.055, 0.012, badgeMat, 0, 0.11, 0.146);
      this.addApronStraps(mesh, apronMat);
      // Take-away cup with a kraft sleeve in the right hand (hidden while sipping break coffee cup)
      const propGroup = new THREE.Group();
      this.addCyl(propGroup, 0.034, 0.027, 0.085, 8, badgeMat, 0, -0.262, 0.05);
      this.addCyl(propGroup, 0.034, 0.03, 0.034, 8, capMat, 0, -0.262, 0.05);
      mesh.rightArmPivot.add(propGroup);
      this.humanRightHandProp = propGroup;
      // Café visor cap perched on forehead
      this.addCyl(mesh.headPivot, 0.162, 0.165, 0.042, 12, capMat, 0, 0.245, 0.01);
      this.addBox(mesh.headPivot, 0.175, 0.014, 0.095, capMat, 0, 0.23, 0.178, 0.14);
    } else if (role === 'dj') {
      const bandMat = this.makeMat('#7D6BC9', 0.45, 0.22);
      const cupMat = this.makeMat('#2C283B', 0.35, 0.25);
      const glowMat = this.makeGlowMat('#78EEFF', 0.9);
      const band = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.176, 0.018, 6, 16, Math.PI)),
        bandMat,
      );
      band.position.set(0, 0.175, 0);
      mesh.headPivot.add(band);
      const cupL = this.addCyl(mesh.headPivot, 0.052, 0.052, 0.036, 10, cupMat, -0.186, 0.155, 0);
      cupL.rotation.z = Math.PI / 2;
      const cupR = this.addCyl(mesh.headPivot, 0.052, 0.052, 0.036, 10, cupMat, 0.186, 0.155, 0);
      cupR.rotation.z = Math.PI / 2;
      const ringL = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.04, 0.008, 6, 12)), glowMat);
      ringL.rotation.y = Math.PI / 2;
      ringL.position.set(-0.207, 0.155, 0);
      const ringR = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.04, 0.008, 6, 12)), glowMat);
      ringR.rotation.y = Math.PI / 2;
      ringR.position.set(0.207, 0.155, 0);
      mesh.headPivot.add(ringL, ringR);
    } else if (role === 'chef') {
      const whiteMat = this.makeMat('#FAF7F0', 0.84, 0.02);
      const goldMat = this.makeMat('#E3BE6E', 0.35, 0.55);
      // Tall pleated chef toque cleanly above hair (y >= 0.31)
      this.addCyl(mesh.headPivot, 0.105, 0.095, 0.09, 10, whiteMat, 0, 0.34, 0);
      this.addSphere(mesh.headPivot, 0.082, whiteMat, 0, 0.425, 0, 1.24, 0.92, 1.18, 10);
      this.addSphere(mesh.headPivot, 0.058, whiteMat, -0.062, 0.41, 0.025, 1, 0.9, 1, 8);
      this.addSphere(mesh.headPivot, 0.058, whiteMat, 0.062, 0.41, 0.025, 1, 0.9, 1, 8);
      // Crisp white chef apron bib + brass buttons
      this.addBox(mesh.torsoPivot, 0.21, 0.24, 0.016, whiteMat, 0, 0.135, 0.134);
      this.addSphere(mesh.torsoPivot, 0.012, goldMat, -0.045, 0.21, 0.146, 1, 1, 0.6, 6);
      this.addSphere(mesh.torsoPivot, 0.012, goldMat, 0.045, 0.21, 0.146, 1, 1, 0.6, 6);
      this.addApronStraps(mesh, whiteMat);
      // Wooden spoon in the right hand
      const woodMat = this.makeMat('#C99A6B', 0.78, 0.04);
      this.addCyl(mesh.rightArmPivot, 0.011, 0.013, 0.19, 6, woodMat, 0, -0.25, 0.07).rotation.x = 0.65;
      this.addSphere(mesh.rightArmPivot, 0.036, woodMat, 0, -0.195, 0.152, 1, 0.5, 1.3, 7);
    } else if (role === 'bartender') {
      const vestMat = this.makeMat('#3B4B52', 0.78, 0.08);
      const bowMat = this.makeMat('#F0A28B', 0.68, 0.06);
      const goldMat = this.makeMat('#E3BE6E', 0.35, 0.55);
      // Vest panels + cute pastel bowtie at collar
      this.addBox(mesh.torsoPivot, 0.22, 0.22, 0.016, vestMat, 0, 0.14, 0.132);
      this.addSphere(mesh.torsoPivot, 0.011, goldMat, 0, 0.19, 0.144, 1, 1, 0.6, 6);
      this.addSphere(mesh.torsoPivot, 0.011, goldMat, 0, 0.135, 0.144, 1, 1, 0.6, 6);
      const bowL = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.026, 0.046, 6)), bowMat);
      bowL.rotation.z = -Math.PI / 2;
      bowL.position.set(-0.026, 0.275, 0.146);
      const bowR = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.026, 0.046, 6)), bowMat);
      bowR.rotation.z = Math.PI / 2;
      bowR.position.set(0.026, 0.275, 0.146);
      const knot = this.addSphere(mesh.torsoPivot, 0.014, bowMat, 0, 0.275, 0.15, 1, 1, 0.8, 6);
      mesh.torsoPivot.add(bowL, bowR, knot);
      // Cocktail shaker in the right hand
      const shakerMat = this.makeMat('#E3EAEE', 0.3, 0.25);
      this.addCyl(mesh.rightArmPivot, 0.03, 0.038, 0.11, 8, shakerMat, 0, -0.27, 0.052);
      this.addCyl(mesh.rightArmPivot, 0.018, 0.027, 0.034, 8, vestMat, 0, -0.198, 0.052);
    }
  }

  /** Two neck straps running from the apron bib up over the shoulders. */
  private addApronStraps(mesh: VisitorMesh, mat: THREE.Material): void {
    this.addBox(mesh.torsoPivot, 0.026, 0.11, 0.016, mat, -0.072, 0.298, 0.128, 0, 0, 0.3);
    this.addBox(mesh.torsoPivot, 0.026, 0.11, 0.016, mat, 0.072, 0.298, 0.128, 0, 0, -0.3);
  }

  setScalePop(scale: number): void {
    const s = Math.max(0.001, scale);
    if (this.humanMesh) {
      this.humanMesh.setScalePop(s);
    } else {
      this.root.scale.set(s, s, s);
    }
  }

  setHoldingCoffee(holding: boolean): void {
    this.humanMesh?.setHoldingCoffee(holding);
    if (this.humanRightHandProp) {
      this.humanRightHandProp.visible = !holding;
    }
  }

  updateAnimation(dt: number, pose: StaffPose, walkSpeed: number, seatBlend = 0): void {
    if (this.humanMesh) {
      const mappedPose: VisitorPose =
        pose === 'recharge' ? 'idle' : pose;
      this.humanMesh.updateAnimation(dt, mappedPose, walkSpeed, seatBlend);
      return;
    }

    this.speechBubble.update(dt);
    this.pulsePhase += dt * 3.4;

    // Gentle soft LED pulse (bright mint-gold during recharging!)
    const isRecharging = pose === 'recharge';
    if (this.ledMat && this.chestLedMat && this.antennaTipMat) {
      const ledColor = isRecharging ? '#9AF5AE' : this.baseLedHex;
      this.ledMat.color.set(ledColor);
      this.ledMat.emissive.set(ledColor);
      this.chestLedMat.color.set(ledColor);
      this.chestLedMat.emissive.set(ledColor);
      this.antennaTipMat.color.set(ledColor);
      this.antennaTipMat.emissive.set(ledColor);

      const pulse = 0.78 + Math.sin(this.pulsePhase * (isRecharging ? 2.8 : 1.0)) * 0.28;
      this.ledMat.emissiveIntensity = pulse;
      this.chestLedMat.emissiveIntensity = isRecharging ? pulse * 1.35 : pulse * 0.85;
      this.antennaTipMat.emissiveIntensity = isRecharging ? pulse * 1.45 : pulse;
    }

    this.bodyPivot.rotation.set(0, 0, 0);

    switch (pose) {
      case 'walk': {
        this.animPhase += dt * walkSpeed * 6.0;
        const bob = Math.abs(Math.sin(this.animPhase)) * 0.022;
        const sway = Math.sin(this.animPhase);

        this.bodyPivot.position.y = FLOOR_BASE_Y + bob;
        this.wheelPivot.rotation.x += dt * walkSpeed * 8.5;
        this.torsoPivot.rotation.set(0.095, sway * 0.04, sway * 0.03);
        this.leftArmPivot.rotation.set(-sway * 0.34, 0, 0.1);
        this.rightArmPivot.rotation.set(sway * 0.34, 0, -0.1);
        this.headPivot.rotation.set(-0.04, 0, -sway * 0.03);
        this.antennaPivot.rotation.set(-0.18 + Math.sin(this.animPhase * 1.3) * 0.08, 0, -sway * 0.12);
        break;
      }

      case 'work': {
        this.animPhase += dt * (this.role === 'dj' ? 7.6 : 6.4);
        const beat = Math.sin(this.animPhase);
        const halfBeat = Math.sin(this.animPhase * 0.5);

        this.bodyPivot.position.y = FLOOR_BASE_Y + Math.abs(beat) * 0.028;
        this.torsoPivot.rotation.set(0.08 + Math.abs(beat) * 0.03, halfBeat * 0.12, halfBeat * 0.05);

        if (this.role === 'bartender') {
          // Brisk cocktail shaker bounce!
          this.leftArmPivot.rotation.set(-0.75 + beat * 0.18, 0.16, 0.1);
          this.rightArmPivot.rotation.set(-1.35 + Math.sin(this.animPhase * 2.0) * 0.38, -0.18, -0.12);
        } else if (this.role === 'dj') {
          // Deck-mixing & rhythmic head bob!
          this.leftArmPivot.rotation.set(-0.95 + beat * 0.35, 0.15, 0.16);
          this.rightArmPivot.rotation.set(-0.95 - beat * 0.35, -0.15, -0.16);
        } else {
          // Barista brewing / Chef stirring!
          this.leftArmPivot.rotation.set(-0.78 + beat * 0.24, 0.12, 0.1);
          this.rightArmPivot.rotation.set(-0.98 - beat * 0.3, -0.16, -0.1);
        }

        this.headPivot.rotation.set(Math.abs(beat) * 0.06, -halfBeat * 0.12, halfBeat * 0.07);
        this.antennaPivot.rotation.set(beat * 0.16, 0, halfBeat * 0.18);
        break;
      }

      case 'recharge': {
        this.animPhase += dt * 7.0;
        this.rechargeSpin += dt * Math.PI * 1.65;
        const levitate = 0.045 + Math.sin(this.animPhase) * 0.028;

        this.bodyPivot.position.y = FLOOR_BASE_Y + levitate;
        this.bodyPivot.rotation.y = this.rechargeSpin;
        this.torsoPivot.rotation.set(0, 0, Math.sin(this.animPhase * 0.5) * 0.08);
        this.leftArmPivot.rotation.set(-0.65, 0, 0.42);
        this.rightArmPivot.rotation.set(-0.65, 0, -0.42);
        this.headPivot.rotation.set(-0.1, 0, Math.sin(this.animPhase * 0.7) * 0.14);
        this.antennaPivot.rotation.set(Math.sin(this.animPhase * 1.5) * 0.22, 0, Math.cos(this.animPhase * 1.5) * 0.22);
        break;
      }

      case 'dance': {
        this.animPhase += dt * 7.2;
        const beat = Math.sin(this.animPhase);
        this.bodyPivot.position.y = FLOOR_BASE_Y + Math.abs(beat) * 0.05;
        this.torsoPivot.rotation.set(0.03, beat * 0.16, beat * 0.08);
        this.leftArmPivot.rotation.set(-1.05 + beat * 0.4, 0, 0.24);
        this.rightArmPivot.rotation.set(-1.05 - beat * 0.4, 0, -0.24);
        this.headPivot.rotation.set(Math.abs(beat) * 0.08, -beat * 0.12, beat * 0.08);
        this.antennaPivot.rotation.set(beat * 0.2, 0, -beat * 0.2);
        break;
      }

      case 'idle':
      default: {
        this.animPhase += dt * 2.4;
        const hover = Math.sin(this.animPhase) * 0.012;
        this.bodyPivot.position.y = FLOOR_BASE_Y + Math.max(0, hover);
        this.torsoPivot.rotation.set(0, 0, 0);
        this.leftArmPivot.rotation.set(-0.08, 0, 0.1);
        this.rightArmPivot.rotation.set(-0.08, 0, -0.1);
        this.headPivot.rotation.set(0, Math.sin(this.animPhase * 0.6) * 0.12, Math.sin(this.animPhase * 0.4) * 0.04);
        this.antennaPivot.rotation.set(Math.sin(this.animPhase) * 0.08, 0, Math.cos(this.animPhase * 0.7) * 0.08);
        break;
      }
    }
  }

  dispose(): void {
    if (this.humanMesh) {
      this.humanMesh.dispose();
    } else {
      this.speechBubble.dispose();
    }
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}
