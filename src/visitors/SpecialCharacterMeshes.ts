import * as THREE from 'three';
import type { VisitorMood } from '../data/schemas';

export type SpecialPose =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'dance'
  | 'pet'
  | 'admire'
  | 'stumble'
  | 'thinker'
  | 'levitate'
  | 'kick'
  | 'ragdoll'
  | 'squeak'
  | 'eat'
  | 'sleep'
  | 'stare';

export interface SpecialCharacterRig {
  root: THREE.Group;
  bubbleHeight: number;
  setPose(pose: SpecialPose): void;
  setMood(mood: VisitorMood): void;
  setAuraActive?(active: boolean): void;
  triggerSqueakPulse?(): void;
  update(
    dt: number,
    elapsed: number,
    moveSpeed: number,
    isBlabbering?: boolean,
    seatY?: number,
  ): void;
  dispose(): void;
}

export const SPECIAL_CHARACTER_IDS = new Set([
  'viking',
  'squeaky_chicken',
  'gojo',
  'baki',
  'shakespeare',
  'philosopher',
  'john_wick',
  'rocky',
  'homer',
  'rick',
]);

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

/**
 * Shared disposable geometry/material builder enforcing 100% opaque character
 * materials (`transparent: false, depthWrite: true`, `flatShading: true`) so
 * every special character renders crisply with zero inside-out depth sorting.
 */
class RigBuilder {
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];

  trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  mat(
    color: string | number,
    roughness = 0.8,
    metalness = 0.04,
    emissive?: string | number,
    emissiveIntensity = 0,
  ): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness,
      flatShading: true,
      transparent: false,
      depthWrite: true,
    });
    if (emissive !== undefined && emissiveIntensity > 0) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    return this.trackMat(m);
  }

  private place(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: {
      rx?: number;
      ry?: number;
      rz?: number;
      sx?: number;
      sy?: number;
      sz?: number;
      castShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.trackGeo(geo), mat);
    mesh.position.set(x, y, z);
    if (opts?.rx || opts?.ry || opts?.rz) {
      mesh.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    }
    if (opts?.sx !== undefined || opts?.sy !== undefined || opts?.sz !== undefined) {
      mesh.scale.set(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
    }
    const isEmissive =
      mat instanceof THREE.MeshStandardMaterial &&
      mat.emissiveIntensity > 0 &&
      mat.emissive.r + mat.emissive.g + mat.emissive.b > 0;
    mesh.castShadow = !isEmissive && (opts?.castShadow ?? true);
    mesh.receiveShadow = true;
    if (opts?.name) mesh.name = opts.name;
    parent.add(mesh);
    return mesh;
  }

  box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: { rx?: number; ry?: number; rz?: number; castShadow?: boolean; name?: string },
  ): THREE.Mesh {
    return this.place(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z, opts);
  }

  cyl(
    parent: THREE.Object3D,
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: {
      rx?: number;
      ry?: number;
      rz?: number;
      sx?: number;
      sy?: number;
      sz?: number;
      castShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    return this.place(parent, new THREE.CylinderGeometry(rTop, rBot, h, segs), mat, x, y, z, opts);
  }

  sphere(
    parent: THREE.Object3D,
    r: number,
    segs: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: {
      rx?: number;
      ry?: number;
      rz?: number;
      sx?: number;
      sy?: number;
      sz?: number;
      castShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    return this.place(
      parent,
      new THREE.SphereGeometry(r, segs, Math.max(5, Math.round(segs * 0.75))),
      mat,
      x,
      y,
      z,
      opts,
    );
  }

  cone(
    parent: THREE.Object3D,
    r: number,
    h: number,
    segs: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: {
      rx?: number;
      ry?: number;
      rz?: number;
      sx?: number;
      sy?: number;
      sz?: number;
      castShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    return this.place(parent, new THREE.ConeGeometry(r, h, segs), mat, x, y, z, opts);
  }

  torus(
    parent: THREE.Object3D,
    r: number,
    tube: number,
    radialSegs: number,
    tubularSegs: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts?: {
      arc?: number;
      rx?: number;
      ry?: number;
      rz?: number;
      sx?: number;
      sy?: number;
      sz?: number;
      castShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    return this.place(
      parent,
      new THREE.TorusGeometry(r, tube, radialSegs, tubularSegs, opts?.arc ?? Math.PI * 2),
      mat,
      x,
      y,
      z,
      opts,
    );
  }

  rod(
    parent: THREE.Object3D,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    rTop: number,
    rBot: number,
    segs: number,
    mat: THREE.Material,
    castShadow = true,
  ): THREE.Mesh {
    const start = new THREE.Vector3(x1, y1, z1);
    const end = new THREE.Vector3(x2, y2, z2);
    const delta = end.clone().sub(start);
    const len = Math.max(0.005, delta.length());
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(rTop, rBot, len, segs)),
      mat,
    );
    mesh.position.copy(mid);
    const dir = delta.normalize();
    if (dir.y < -0.9999) {
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    } else {
      mesh.quaternion.setFromUnitVectors(UP_AXIS, dir);
    }
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Soft non-character ground shadow disc (kept hidden when sitting/levitating). */
  addGroundShadow(parent: THREE.Object3D, radius = 0.22): THREE.Mesh {
    const geo = this.trackGeo(new THREE.CircleGeometry(radius, 16));
    geo.rotateX(-Math.PI / 2);
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x453930,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.004;
    mesh.name = 'GroundShadow';
    parent.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}

/* ============================================================================
 * HUMANOID BASE RIG (used by 8 legendary humanoids with full elbow/knee joints)
 * Standing height ~1.30–1.42, soles flush at y = 0, facing +Z!
 * ============================================================================ */

interface HumanoidParts {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightKneePivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  leftHandAnchor: THREE.Group;
  rightHandAnchor: THREE.Group;
  mouthMesh: THREE.Mesh;
  leftBrow?: THREE.Mesh;
  rightBrow?: THREE.Mesh;
  shadowMesh: THREE.Mesh;
  capeMesh?: THREE.Object3D;
  auraGroup?: THREE.Group;
  auraOrbs?: THREE.Object3D[];
  sunglassesGroup?: THREE.Group;
  sixEyesGroup?: THREE.Group;
  donutProp?: THREE.Object3D;
  quillProp?: THREE.Object3D;
  portalGunProp?: THREE.Object3D;
}

interface HumanoidPalette {
  skin: string;
  pants: string;
  lowerLeg?: string; // bare legs for Baki / sandals for Socrates
  shoe: string;
  sole?: string;
  torso: string;
  sleeve?: string;
  forearm?: string; // bare arms for Baki / Homer / Socrates
  hand?: string;
  wristWrap?: string;
  ankleWrap?: string;
  bellyScale?: number;
  shoulderWidth?: number;
  headScaleY?: number;
  eyeWhite?: boolean;
  hideEyes?: boolean; // Gojo blindfold
  hideMouth?: boolean;
  mouthColor?: string;
  browColor?: string;
  stompWalk?: boolean;
}

function buildHumanoidSkeleton(
  b: RigBuilder,
  id: string,
  pal: HumanoidPalette,
): HumanoidParts {
  const root = new THREE.Group();
  root.name = `Special_${id}`;

  const shadowMesh = b.addGroundShadow(root, 0.22);

  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0;
  root.add(bodyPivot);

  const skinMat = b.mat(pal.skin, 0.82);
  const pantsMat = b.mat(pal.pants, 0.84);
  const lowerLegMat = b.mat(pal.lowerLeg ?? pal.pants, 0.84);
  const shoeMat = b.mat(pal.shoe, 0.72);
  const soleMat = b.mat(pal.sole ?? '#ECE6DC', 0.84);
  const torsoMat = b.mat(pal.torso, 0.8);
  const sleeveMat = b.mat(pal.sleeve ?? pal.torso, 0.8);
  const forearmMat = b.mat(pal.forearm ?? pal.sleeve ?? pal.torso, 0.82);
  const handMat = b.mat(pal.hand ?? pal.skin, 0.82);
  const eyeDarkMat = b.mat('#262220', 0.3);
  const eyeWhiteMat = b.mat('#FFFFFF', 0.25);

  // 1. Articulated 2-segment legs: hip y = 0.40, knee y = -0.19, sole bottom = -0.40 => world y = 0.000!
  const leftLegPivot = new THREE.Group();
  const rightLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.078, 0.40, 0);
  rightLegPivot.position.set(0.078, 0.40, 0);
  bodyPivot.add(leftLegPivot, rightLegPivot);

  const leftKneePivot = new THREE.Group();
  const rightKneePivot = new THREE.Group();

  const wrapMat = pal.ankleWrap ? b.mat(pal.ankleWrap, 0.88) : null;

  for (const [legPivot, kneePivot] of [
    [leftLegPivot, leftKneePivot],
    [rightLegPivot, rightKneePivot],
  ] as const) {
    // Hip ball + upper thigh
    b.sphere(legPivot, 0.052, 7, pantsMat, 0, -0.015, 0);
    b.cyl(legPivot, 0.052, 0.045, 0.19, 8, pantsMat, 0, -0.10, 0);

    // Knee joint
    kneePivot.position.set(0, -0.19, 0);
    legPivot.add(kneePivot);
    b.sphere(kneePivot, 0.045, 7, lowerLegMat, 0, 0, 0);
    // Lower shin
    b.cyl(kneePivot, 0.044, 0.038, 0.155, 8, lowerLegMat, 0, -0.085, 0);

    if (wrapMat) {
      b.cyl(kneePivot, 0.044, 0.043, 0.068, 8, wrapMat, 0, -0.132, 0);
    }

    // Shoe / Foot resting cleanly with bottom at y = -0.21 (total -0.40 from hip => y = 0.000!)
    b.box(kneePivot, 0.086, 0.048, 0.135, shoeMat, 0, -0.178, 0.022);
    b.box(kneePivot, 0.09, 0.016, 0.142, soleMat, 0, -0.202, 0.022);
  }

  // 2. Pelvis bridging hips to waist
  const bellyS = pal.bellyScale ?? 1.0;
  b.cyl(bodyPivot, 0.132 * bellyS, 0.138 * bellyS, 0.125, 10, pantsMat, 0, 0.42, 0, {
    sx: 1.05,
    sz: 0.88 * bellyS,
  });

  // 3. Torso pivot at waist y = 0.46
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.46, 0);
  bodyPivot.add(torsoPivot);

  const shoulderW = pal.shoulderWidth ?? 0.202;
  // Core torso volume
  b.cyl(torsoPivot, 0.142 * (shoulderW / 0.202), 0.132 * bellyS, 0.34, 10, torsoMat, 0, 0.175, 0, {
    sx: 1.04,
    sz: 0.84 * bellyS,
  });
  if (bellyS > 1.05) {
    // Cozy Homer round belly protrusion!
    b.sphere(torsoPivot, 0.135, 9, torsoMat, 0, 0.115, 0.052, { sx: 1.05, sy: 0.92, sz: 0.88 });
  }

  // 4. Articulated 2-segment arms with elbows & hand anchors
  const leftArmPivot = new THREE.Group();
  const rightArmPivot = new THREE.Group();
  leftArmPivot.position.set(-shoulderW, 0.295, 0);
  rightArmPivot.position.set(shoulderW, 0.295, 0);
  torsoPivot.add(leftArmPivot, rightArmPivot);

  // Soft shoulder caps bridging torso to arms cleanly
  b.sphere(torsoPivot, 0.052, 8, sleeveMat, -(shoulderW - 0.036), 0.295, 0, {
    sx: 1.15,
    sy: 0.92,
    sz: 0.95,
  });
  b.sphere(torsoPivot, 0.052, 8, sleeveMat, shoulderW - 0.036, 0.295, 0, {
    sx: 1.15,
    sy: 0.92,
    sz: 0.95,
  });

  const leftElbowPivot = new THREE.Group();
  const rightElbowPivot = new THREE.Group();
  const leftHandAnchor = new THREE.Group();
  const rightHandAnchor = new THREE.Group();
  const wristMat = pal.wristWrap ? b.mat(pal.wristWrap, 0.88) : null;

  for (const [armPivot, elbowPivot, handAnchor] of [
    [leftArmPivot, leftElbowPivot, leftHandAnchor],
    [rightArmPivot, rightElbowPivot, rightHandAnchor],
  ] as const) {
    // Upper arm
    b.sphere(armPivot, 0.044, 7, sleeveMat, 0, 0, 0);
    b.cyl(armPivot, 0.041, 0.036, 0.16, 8, sleeveMat, 0, -0.082, 0);

    // Elbow pivot
    elbowPivot.position.set(0, -0.162, 0);
    armPivot.add(elbowPivot);
    b.sphere(elbowPivot, 0.036, 7, forearmMat, 0, 0, 0);
    b.cyl(elbowPivot, 0.035, 0.031, 0.145, 8, forearmMat, 0, -0.074, 0);

    if (wristMat) {
      b.cyl(elbowPivot, 0.037, 0.036, 0.062, 8, wristMat, 0, -0.125, 0);
    }

    // Hand sphere + prop anchor
    b.sphere(elbowPivot, 0.036, 7, handMat, 0, -0.162, 0);
    handAnchor.position.set(0, -0.162, 0.015);
    elbowPivot.add(handAnchor);
  }

  // 5. Neck & Head Pivot (world y = 0.86)
  b.cyl(torsoPivot, 0.052, 0.058, 0.095, 8, skinMat, 0, 0.365, 0);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.40, 0);
  torsoPivot.add(headPivot);

  const headSY = pal.headScaleY ?? 1.0;
  // Stylized head sphere (front Z = 0.16 * 0.96 = 0.1536)
  b.sphere(headPivot, 0.16, 14, skinMat, 0, 0.16 * headSY, 0, {
    sx: 1.0,
    sy: headSY,
    sz: 0.96,
  });

  // Side ears cleanly proud of head X = ±0.16
  b.sphere(headPivot, 0.031, 7, skinMat, -0.162, 0.152 * headSY, -0.004, {
    sx: 0.65,
    sy: 1.0,
    sz: 0.8,
  });
  b.sphere(headPivot, 0.031, 7, skinMat, 0.162, 0.152 * headSY, -0.004, {
    sx: 0.65,
    sy: 1.0,
    sz: 0.8,
  });

  // Nose subtle bump
  b.sphere(headPivot, 0.019, 6, skinMat, 0, 0.142 * headSY, 0.159, {
    sx: 0.85,
    sy: 0.85,
    sz: 0.9,
  });

  // Eyes & Brows (strictly >= 0.008 proud of skull surface)
  let leftBrow: THREE.Mesh | undefined;
  let rightBrow: THREE.Mesh | undefined;
  if (!pal.hideEyes) {
    if (pal.eyeWhite) {
      // Big expressive cartoon white sclera eyes (Homer / Rick)
      b.sphere(headPivot, 0.044, 9, eyeWhiteMat, -0.046, 0.176 * headSY, 0.148, {
        sx: 0.95,
        sy: 1.0,
        sz: 0.72,
      });
      b.sphere(headPivot, 0.044, 9, eyeWhiteMat, 0.046, 0.176 * headSY, 0.148, {
        sx: 0.95,
        sy: 1.0,
        sz: 0.72,
      });
      b.sphere(headPivot, 0.015, 6, eyeDarkMat, -0.044, 0.176 * headSY, 0.181);
      b.sphere(headPivot, 0.015, 6, eyeDarkMat, 0.044, 0.176 * headSY, 0.181);
    } else {
      b.sphere(headPivot, 0.021, 8, eyeDarkMat, -0.056, 0.166 * headSY, 0.158, {
        sx: 0.92,
        sy: 1.1,
        sz: 0.52,
      });
      b.sphere(headPivot, 0.021, 8, eyeDarkMat, 0.056, 0.166 * headSY, 0.158, {
        sx: 0.92,
        sy: 1.1,
        sz: 0.52,
      });
      b.sphere(headPivot, 0.0065, 6, eyeWhiteMat, -0.049, 0.175 * headSY, 0.169);
      b.sphere(headPivot, 0.0065, 6, eyeWhiteMat, 0.063, 0.175 * headSY, 0.169);
    }

    if (pal.browColor) {
      const browMat = b.mat(pal.browColor, 0.8);
      leftBrow = b.box(headPivot, 0.046, 0.012, 0.012, browMat, -0.056, 0.212 * headSY, 0.156, {
        rz: 0.06,
      });
      rightBrow = b.box(headPivot, 0.046, 0.012, 0.012, browMat, 0.056, 0.212 * headSY, 0.156, {
        rz: -0.06,
      });
    }
  }

  // Mouth (scales dynamically when blabbering/eating/snoring)
  const mouthMat = b.mat(pal.mouthColor ?? '#3A2A24', 0.5);
  const mouthMesh = b.box(
    headPivot,
    0.052,
    0.012,
    0.012,
    mouthMat,
    0,
    0.104 * headSY,
    0.160,
  );
  if (pal.hideMouth) {
    mouthMesh.visible = false;
  }

  return {
    root,
    bodyPivot,
    torsoPivot,
    headPivot,
    leftLegPivot,
    rightLegPivot,
    leftKneePivot,
    rightKneePivot,
    leftArmPivot,
    rightArmPivot,
    leftElbowPivot,
    rightElbowPivot,
    leftHandAnchor,
    rightHandAnchor,
    mouthMesh,
    leftBrow,
    rightBrow,
    shadowMesh,
  };
}

/**
 * Wraps a customized `HumanoidParts` assembly into a full `SpecialCharacterRig`
 * supporting all 15 `SpecialPose`s, mood expression shifts, smooth levitation &
 * aura controls, and full geometry/material disposal.
 */
function createHumanoidRigController(
  b: RigBuilder,
  parts: HumanoidParts,
  opts: {
    id: string;
    baseBubbleHeight?: number;
    baseScale?: number;
    stompWalk?: boolean;
    hasAura?: boolean;
    defaultBrowTilt?: number;
  },
): SpecialCharacterRig {
  let pose: SpecialPose = 'idle';
  let mood: VisitorMood = 'neutral';
  let auraActive = false;
  let levitateHeight = 0;
  let squeakPulse = 0;
  let animPhase = Math.random() * Math.PI * 2;
  let blabberPhase = 0;
  const baseBubble = opts.baseBubbleHeight ?? 1.68;
  const baseScale = opts.baseScale ?? 1.06;
  const seatPelvisOffset = 0.365 * baseScale;

  const syncGojoEyes = (): void => {
    const unveiled = auraActive || pose === 'levitate' || levitateHeight > 0.08;
    if (parts.sunglassesGroup) {
      parts.sunglassesGroup.visible = !unveiled;
    }
    if (parts.sixEyesGroup) {
      parts.sixEyesGroup.visible = unveiled;
    }
  };

  const rig: SpecialCharacterRig = {
    root: parts.root,
    bubbleHeight: baseBubble,

    setPose(nextPose: SpecialPose): void {
      pose = nextPose;
      syncGojoEyes();
    },

    setMood(nextMood: VisitorMood): void {
      mood = nextMood;
      const baseTilt = opts.defaultBrowTilt ?? 0.06;
      const tilt =
        mood === 'delighted' || mood === 'happy'
          ? baseTilt - 0.08
          : mood === 'bored' || mood === 'leaving'
            ? baseTilt + 0.14
            : baseTilt;
      if (parts.leftBrow && parts.rightBrow) {
        parts.leftBrow.rotation.z = tilt;
        parts.rightBrow.rotation.z = -tilt;
      }
    },

    setAuraActive(active: boolean): void {
      auraActive = active;
      if (parts.auraGroup) {
        parts.auraGroup.visible = active || pose === 'levitate';
      }
      syncGojoEyes();
    },

    triggerSqueakPulse(): void {
      squeakPulse = 1.0;
    },

    update(
      dt: number,
      elapsed: number,
      moveSpeed: number,
      isBlabbering = false,
      seatY?: number,
    ): void {
      const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      const speed = Number.isFinite(moveSpeed) && moveSpeed > 0 ? moveSpeed : 1.45;

      // Decay any squeak bounce pulse
      if (squeakPulse > 0) {
        squeakPulse = Math.max(0, squeakPulse - safeDt * 2.1);
      }

      // Smooth Gojo levitation elevation (+1.65 units when levitating)
      const targetLev = pose === 'levitate' ? 1.65 : 0;
      levitateHeight = damp(levitateHeight, targetLev, 5.2, safeDt);

      // Update aura visuals & Gojo sunglasses ↔ crystalline cyan Six Eyes reveal!
      syncGojoEyes();
      if (parts.auraGroup) {
        const showAura = auraActive || pose === 'levitate' || levitateHeight > 0.08;
        parts.auraGroup.visible = showAura;
        if (showAura) {
          parts.auraGroup.rotation.y = safeElapsed * 1.4;
          if (parts.auraOrbs) {
            for (let i = 0; i < parts.auraOrbs.length; i++) {
              const a = safeElapsed * 2.2 + (i * Math.PI * 2) / parts.auraOrbs.length;
              const orb = parts.auraOrbs[i];
              orb.position.set(
                Math.cos(a) * 0.44,
                0.78 + Math.sin(a * 1.5 + i) * 0.16,
                Math.sin(a) * 0.44,
              );
            }
          }
        }
      }

      // Toggle Homer's pink donut visibility cleanly during eating / happy poses
      if (parts.donutProp) {
        parts.donutProp.visible =
          pose === 'eat' || pose === 'admire' || pose === 'dance' || pose === 'idle';
      }

      // Chatter mouth & head micro-bob when talking
      if (isBlabbering) {
        blabberPhase += safeDt * 16;
        const ch = 0.5 + 0.5 * Math.sin(blabberPhase);
        parts.mouthMesh.scale.set(1 + ch * 0.2, 0.85 + ch * 1.15, 1);
      } else if (pose === 'eat') {
        const chomp = 0.5 + 0.5 * Math.sin(safeElapsed * 15);
        parts.mouthMesh.scale.set(1.1, 0.7 + chomp * 1.6, 1.1);
      } else if (pose === 'sleep') {
        const snore = 0.5 + 0.5 * Math.sin(safeElapsed * 1.9);
        parts.mouthMesh.scale.set(0.95, 0.8 + snore * 1.3, 1);
      } else {
        parts.mouthMesh.scale.set(1, 1, 1);
      }
      const chatterTilt = isBlabbering ? Math.sin(blabberPhase * 0.45) * 0.05 : 0;

      // Seat elevation handling (works seamlessly whether root.y = seatY or root.y = 0)
      const isSeatPose = pose === 'sit' || pose === 'thinker' || pose === 'sleep';
      const targetWorldSeatY =
        isSeatPose && seatY !== undefined && seatY > 0.08
          ? seatY
          : isSeatPose && parts.root.position.y > 0.08
            ? parts.root.position.y
            : 0;
      const isSeatedElevated = isSeatPose && targetWorldSeatY > 0.08;
      const localSeatBase = isSeatedElevated ? targetWorldSeatY - parts.root.position.y : 0;

      // Ground shadow visibility (hidden when sitting elevated, levitating, or ragdolling)
      parts.shadowMesh.visible =
        !isSeatedElevated && levitateHeight < 0.15 && pose !== 'ragdoll';

      // Dynamic speech bubble height
      rig.bubbleHeight = isSeatedElevated
        ? baseBubble - 0.30
        : baseBubble + levitateHeight;

      // Reset body rotation & scale before applying pose
      parts.bodyPivot.rotation.set(0, 0, 0);
      parts.bodyPivot.scale.setScalar(baseScale);
      parts.leftElbowPivot.rotation.set(0, 0, 0);
      parts.rightElbowPivot.rotation.set(0, 0, 0);

      switch (pose) {
        case 'walk': {
          animPhase += safeDt * speed * (opts.stompWalk ? 5.6 : 6.4);
          const stride = Math.sin(animPhase);
          const stompBoost = opts.stompWalk ? 1.32 : 1.0;
          const hop = Math.abs(stride) * (opts.stompWalk ? 0.068 : 0.044);

          parts.bodyPivot.position.y = hop + levitateHeight;
          parts.leftLegPivot.rotation.set(stride * 0.42 * stompBoost, 0, 0);
          parts.rightLegPivot.rotation.set(-stride * 0.42 * stompBoost, 0, 0);
          parts.leftKneePivot.rotation.set(Math.max(0, -stride) * 0.34 * stompBoost, 0, 0);
          parts.rightKneePivot.rotation.set(Math.max(0, stride) * 0.34 * stompBoost, 0, 0);

          parts.torsoPivot.rotation.set(
            opts.stompWalk ? 0.07 : 0.045,
            stride * 0.07,
            stride * (opts.stompWalk ? 0.06 : 0.025),
          );
          parts.leftArmPivot.rotation.set(-stride * 0.44, 0, 0.09);
          parts.rightArmPivot.rotation.set(stride * 0.44, 0, -0.09);
          parts.leftElbowPivot.rotation.set(-0.24 - Math.max(0, stride) * 0.18, 0, 0);
          parts.rightElbowPivot.rotation.set(-0.24 - Math.max(0, -stride) * 0.18, 0, 0);
          parts.headPivot.rotation.set(-0.02 + chatterTilt, 0, -stride * 0.025);
          if (parts.capeMesh) {
            parts.capeMesh.rotation.x = 0.16 + Math.abs(stride) * 0.14;
          }
          break;
        }

        case 'levitate': {
          const floatBob = Math.sin(safeElapsed * 2.1) * 0.09;
          parts.bodyPivot.position.y = levitateHeight + floatBob;
          parts.bodyPivot.rotation.set(-0.08, Math.sin(safeElapsed * 0.7) * 0.12, 0);

          // Relaxed Honored One mid-air zen posture (one leg casually bent, arms floating palms-out)
          parts.leftLegPivot.rotation.set(-0.22 + Math.sin(safeElapsed * 1.4) * 0.06, 0.12, 0.1);
          parts.rightLegPivot.rotation.set(-0.55 - Math.sin(safeElapsed * 1.4) * 0.06, -0.18, -0.12);
          parts.leftKneePivot.rotation.set(0.32, 0, 0);
          parts.rightKneePivot.rotation.set(0.95, 0, 0);

          parts.torsoPivot.rotation.set(-0.14, 0, Math.sin(safeElapsed * 1.1) * 0.04);
          parts.leftArmPivot.rotation.set(-0.25, 0.18, 0.62 + Math.sin(safeElapsed * 1.8) * 0.08);
          parts.rightArmPivot.rotation.set(-0.25, -0.18, -0.62 - Math.sin(safeElapsed * 1.8) * 0.08);
          parts.leftElbowPivot.rotation.set(-0.48, 0, 0.18);
          parts.rightElbowPivot.rotation.set(-0.48, 0, -0.18);
          parts.headPivot.rotation.set(-0.24 + chatterTilt, Math.sin(safeElapsed * 0.9) * 0.08, 0);
          break;
        }

        case 'kick': {
          // Baki Hanma iconic flying high roundhouse kick!
          const cycle = Math.sin(safeElapsed * 5.2);
          const snap = 0.78 + 0.22 * Math.max(0, cycle);

          parts.bodyPivot.position.y = 0.22 * snap;
          parts.bodyPivot.rotation.set(-0.12, -0.45 * snap, 0.36 * snap);

          // Extended kicking right leg snapping high & straight forward-outward!
          parts.rightLegPivot.rotation.set(-1.58 * snap, -0.32, -0.58 * snap);
          parts.rightKneePivot.rotation.set(0.06, 0, 0);

          // Left support/chambered leg tucked dynamically
          parts.leftLegPivot.rotation.set(0.28 * snap, 0.18, 0.18);
          parts.leftKneePivot.rotation.set(0.75 * snap, 0, 0);

          // Leaning fighter torso + tight high martial-arts guard arms
          parts.torsoPivot.rotation.set(0.08, 0.42 * snap, -0.14);
          parts.leftArmPivot.rotation.set(-1.12, 0.35, 0.28);
          parts.rightArmPivot.rotation.set(-0.98, -0.25, -0.34);
          parts.leftElbowPivot.rotation.set(-1.18, 0, 0);
          parts.rightElbowPivot.rotation.set(-1.12, 0, 0);
          parts.headPivot.rotation.set(0.04, 0.28 * snap, -0.22 * snap);
          break;
        }

        case 'ragdoll': {
          // Hilarious comic airborne tumble / flailing ragdoll!
          const spin = safeElapsed * 10.5;
          parts.bodyPivot.position.y = 0.32 + Math.abs(Math.sin(spin * 0.5)) * 0.16;
          parts.bodyPivot.rotation.set(
            -1.18 + Math.sin(spin) * 0.35,
            Math.cos(spin * 0.7) * 0.5,
            Math.sin(spin * 1.2) * 0.65,
          );
          parts.leftLegPivot.rotation.set(Math.sin(spin * 1.4) * 0.75 - 0.3, 0, 0.38);
          parts.rightLegPivot.rotation.set(-Math.sin(spin * 1.4) * 0.75 - 0.3, 0, -0.38);
          parts.leftKneePivot.rotation.set(0.55 + Math.cos(spin) * 0.35, 0, 0);
          parts.rightKneePivot.rotation.set(0.55 - Math.cos(spin) * 0.35, 0, 0);

          parts.torsoPivot.rotation.set(-0.28, Math.sin(spin) * 0.25, Math.cos(spin) * 0.2);
          parts.leftArmPivot.rotation.set(-2.1 + Math.sin(spin * 1.6) * 0.5, 0, 0.65);
          parts.rightArmPivot.rotation.set(-2.1 - Math.sin(spin * 1.6) * 0.5, 0, -0.65);
          parts.leftElbowPivot.rotation.set(-0.45, 0, 0);
          parts.rightElbowPivot.rotation.set(-0.45, 0, 0);
          parts.headPivot.rotation.set(-0.35, Math.sin(spin) * 0.3, Math.cos(spin) * 0.25);
          break;
        }

        case 'thinker': {
          // Rodin's The Thinker! Seated cleanly on seatY, leaning forward, right elbow on knee & chin resting on right fist!
          const breathe = Math.sin(safeElapsed * 1.6) * 0.005;
          parts.bodyPivot.position.y = isSeatedElevated ? localSeatBase - seatPelvisOffset + breathe : 0.015 + breathe;

          // Seated legs spread slightly with knees bent forward cleanly
          parts.leftLegPivot.rotation.set(-1.42, 0.16, 0.04);
          parts.rightLegPivot.rotation.set(-1.42, -0.14, -0.04);
          parts.leftKneePivot.rotation.set(1.36, 0, 0);
          parts.rightKneePivot.rotation.set(1.36, 0, 0);

          // Deep contemplative forward lean
          parts.torsoPivot.rotation.set(0.36, 0.06, 0);
          // Right elbow propped forward toward knee, forearm flexed sharply upward so fist rests right beneath chin!
          parts.rightArmPivot.rotation.set(-1.05, 0.28, 0.22);
          parts.rightElbowPivot.rotation.set(-1.55, -0.25, 0.18);
          // Left forearm resting relaxed across left thigh
          parts.leftArmPivot.rotation.set(-0.68, -0.18, 0.16);
          parts.leftElbowPivot.rotation.set(-0.72, 0, 0);
          // Head bowed thoughtfully resting chin on right fist
          parts.headPivot.rotation.set(0.26 + chatterTilt, -0.04, 0.05);
          break;
        }

        case 'stare': {
          // Shakespeare / Rick intense analytical forward squint with quill / portal gun poised!
          const sway = Math.sin(safeElapsed * 1.5) * 0.05;
          parts.bodyPivot.position.y = Math.abs(Math.sin(safeElapsed * 1.4)) * 0.006;
          parts.leftLegPivot.rotation.set(-0.04, 0.06, 0);
          parts.rightLegPivot.rotation.set(0.04, -0.06, 0);
          parts.leftKneePivot.rotation.set(0.06, 0, 0);
          parts.rightKneePivot.rotation.set(0.06, 0, 0);

          parts.torsoPivot.rotation.set(0.22, sway, 0);
          parts.leftArmPivot.rotation.set(-0.32, 0.18, 0.14);
          parts.leftElbowPivot.rotation.set(-0.85, 0, 0);
          // Right arm poised upward with quill or portal gun!
          parts.rightArmPivot.rotation.set(-0.95 + Math.sin(safeElapsed * 2.4) * 0.06, -0.12, -0.16);
          parts.rightElbowPivot.rotation.set(-0.82, 0, 0);
          parts.headPivot.rotation.set(-0.14 + chatterTilt, sway * 1.5, 0.08);
          break;
        }

        case 'eat': {
          // Homer Simpson rapid joyful donut-chomping pose!
          const chompCycle = Math.sin(safeElapsed * 11.0);
          const eatLift = 0.5 + 0.5 * chompCycle;
          parts.bodyPivot.position.y = Math.abs(chompCycle) * 0.014;
          parts.leftLegPivot.rotation.set(0, 0.06, 0);
          parts.rightLegPivot.rotation.set(0, -0.06, 0);
          parts.leftKneePivot.rotation.set(0.05, 0, 0);
          parts.rightKneePivot.rotation.set(0.05, 0, 0);

          parts.torsoPivot.rotation.set(-0.04 + eatLift * 0.05, 0, chompCycle * 0.03);
          // Right arm repeatedly bringing donut right up to mouth!
          parts.rightArmPivot.rotation.set(-0.85 - eatLift * 0.55, 0.34, 0.16);
          parts.rightElbowPivot.rotation.set(-1.05 - eatLift * 0.55, 0, 0.14);
          // Left hand patting happy belly
          parts.leftArmPivot.rotation.set(-0.46, -0.35, -0.18);
          parts.leftElbowPivot.rotation.set(-0.92 + Math.sin(safeElapsed * 6) * 0.15, 0, 0);
          parts.headPivot.rotation.set(0.06 - eatLift * 0.14, 0, chompCycle * 0.05);
          break;
        }

        case 'sleep': {
          // Homer cozy couch/bed snooze — head tilted far back snoring rhythmically!
          const snore = Math.sin(safeElapsed * 1.9);
          const chestRise = (0.5 + 0.5 * snore) * 0.012;
          parts.bodyPivot.position.y = isSeatedElevated
            ? localSeatBase - seatPelvisOffset + chestRise
            : 0.015 + chestRise;

          parts.leftLegPivot.rotation.set(-1.42, 0.14, 0.06);
          parts.rightLegPivot.rotation.set(-1.42, -0.14, -0.06);
          parts.leftKneePivot.rotation.set(1.22, 0, 0);
          parts.rightKneePivot.rotation.set(1.22, 0, 0);

          parts.torsoPivot.rotation.set(-0.18 - chestRise * 1.4, 0, 0.04);
          parts.leftArmPivot.rotation.set(-0.34, 0, 0.22);
          parts.rightArmPivot.rotation.set(-0.34, 0, -0.22);
          parts.leftElbowPivot.rotation.set(-0.42, 0, 0);
          parts.rightElbowPivot.rotation.set(-0.42, 0, 0);
          // Head tilted way back snoring peacefully!
          parts.headPivot.rotation.set(-0.42 + snore * 0.07, 0.08, 0.12);
          break;
        }

        case 'sit': {
          const breathe = Math.abs(Math.sin(safeElapsed * 2.0)) * 0.006;
          parts.bodyPivot.position.y = isSeatedElevated
            ? localSeatBase - seatPelvisOffset + breathe
            : 0.015 + breathe;

          const swing = Math.sin(safeElapsed * 1.6) * 0.04;
          parts.leftLegPivot.rotation.set(-1.44, 0.08, 0);
          parts.rightLegPivot.rotation.set(-1.44, -0.08, 0);
          parts.leftKneePivot.rotation.set(1.34 + swing, 0, 0);
          parts.rightKneePivot.rotation.set(1.34 - swing, 0, 0);

          parts.torsoPivot.rotation.set(-0.05, 0, 0);
          parts.leftArmPivot.rotation.set(-0.46, 0, 0.14);
          parts.rightArmPivot.rotation.set(-0.46, 0, -0.14);
          parts.leftElbowPivot.rotation.set(-0.42, 0, 0);
          parts.rightElbowPivot.rotation.set(-0.42, 0, 0);
          parts.headPivot.rotation.set(0.03 + chatterTilt, Math.sin(safeElapsed * 1.0) * 0.12, 0);
          break;
        }

        case 'pet': {
          // Tender kneeling/crouching petting animation (John Wick's specialty!)
          const stroke = Math.sin(safeElapsed * 5.2);
          const kneelDrop = opts.id === 'john_wick' ? -0.14 : -0.05;
          parts.bodyPivot.position.y = Math.max(0, kneelDrop + 0.14) * 0 + (opts.id === 'john_wick' ? 0 : 0);

          if (opts.id === 'john_wick') {
            // Clean one-knee crouch keeping feet grounded >= y = 0
            parts.bodyPivot.position.y = 0;
            parts.leftLegPivot.rotation.set(-0.52, 0, 0);
            parts.leftKneePivot.rotation.set(0.58, 0, 0);
            parts.rightLegPivot.rotation.set(0.18, 0, 0);
            parts.rightKneePivot.rotation.set(0.42, 0, 0);
          } else {
            parts.leftLegPivot.rotation.set(-0.18, 0, 0);
            parts.rightLegPivot.rotation.set(-0.18, 0, 0);
            parts.leftKneePivot.rotation.set(0.24, 0, 0);
            parts.rightKneePivot.rotation.set(0.24, 0, 0);
          }

          parts.torsoPivot.rotation.set(0.36 + stroke * 0.04, 0, 0);
          parts.leftArmPivot.rotation.set(-0.55, 0.12, 0.12);
          parts.leftElbowPivot.rotation.set(-0.48, 0, 0);
          parts.rightArmPivot.rotation.set(-0.88 - stroke * 0.22, 0.08, -0.08);
          parts.rightElbowPivot.rotation.set(-0.25 + stroke * 0.18, 0, 0);
          parts.headPivot.rotation.set(0.22 + chatterTilt, stroke * 0.06, 0);
          break;
        }

        case 'dance': {
          animPhase += safeDt * 7.2;
          const beat = Math.sin(animPhase);
          const half = Math.sin(animPhase * 0.5);
          const bounce = Math.abs(beat) * 0.085;

          parts.bodyPivot.position.y = bounce;
          parts.leftLegPivot.rotation.set(beat * 0.22, 0, 0.05);
          parts.rightLegPivot.rotation.set(-beat * 0.22, 0, -0.05);
          parts.leftKneePivot.rotation.set(Math.max(0, -beat) * 0.22, 0, 0);
          parts.rightKneePivot.rotation.set(Math.max(0, beat) * 0.22, 0, 0);

          parts.torsoPivot.rotation.set(0.04, half * 0.22, half * 0.1);
          parts.leftArmPivot.rotation.set(-0.98 + beat * 0.42, 0, 0.26);
          parts.rightArmPivot.rotation.set(-0.98 - beat * 0.42, 0, -0.26);
          parts.leftElbowPivot.rotation.set(-0.62, 0, 0);
          parts.rightElbowPivot.rotation.set(-0.62, 0, 0);
          parts.headPivot.rotation.set(
            Math.abs(beat) * 0.08 + chatterTilt,
            -half * 0.14,
            half * 0.08,
          );
          break;
        }

        case 'stumble': {
          animPhase += safeDt * 24;
          const wob = Math.sin(animPhase);
          const hop = Math.abs(Math.sin(animPhase * 0.5)) * 0.085;
          parts.bodyPivot.position.y = hop;
          parts.bodyPivot.rotation.set(-0.22, 0, wob * 0.16);
          parts.leftLegPivot.rotation.set(-0.28 + wob * 0.2, 0, 0.1);
          parts.rightLegPivot.rotation.set(0.18 - wob * 0.2, 0, -0.1);
          parts.leftKneePivot.rotation.set(0.32, 0, 0);
          parts.rightKneePivot.rotation.set(0.22, 0, 0);
          parts.torsoPivot.rotation.set(-0.26, wob * 0.16, wob * 0.12);
          parts.leftArmPivot.rotation.set(-1.55 + wob * 0.45, 0, 0.35);
          parts.rightArmPivot.rotation.set(-1.55 - wob * 0.45, 0, -0.35);
          parts.headPivot.rotation.set(-0.18, wob * 0.22, -wob * 0.18);
          break;
        }

        case 'squeak': {
          const pop = Math.abs(Math.sin(safeElapsed * 10)) * 0.12 + squeakPulse * 0.08;
          parts.bodyPivot.position.y = pop;
          parts.torsoPivot.rotation.set(-0.12, 0, 0);
          parts.leftArmPivot.rotation.set(-1.1, 0, 0.42);
          parts.rightArmPivot.rotation.set(-1.1, 0, -0.42);
          parts.headPivot.rotation.set(-0.18, 0, 0);
          break;
        }

        case 'admire': {
          const sway = Math.sin(safeElapsed * 1.5);
          parts.bodyPivot.position.y = Math.abs(Math.sin(safeElapsed * 2.2)) * 0.008 + levitateHeight;
          parts.leftLegPivot.rotation.set(0, 0, 0);
          parts.rightLegPivot.rotation.set(0, 0, 0);
          parts.leftKneePivot.rotation.set(0, 0, 0);
          parts.rightKneePivot.rotation.set(0, 0, 0);

          parts.torsoPivot.rotation.set(0.04, sway * 0.08, 0);
          parts.leftArmPivot.rotation.set(-0.12, 0, 0.1);
          // Rick aims his portal gun / Shakespeare holds quill / others gesture admiringly
          if (opts.id === 'rick') {
            parts.rightArmPivot.rotation.set(-1.35 + Math.sin(safeElapsed * 2.5) * 0.06, -0.08, -0.06);
            parts.rightElbowPivot.rotation.set(-0.15, 0, 0);
          } else {
            parts.rightArmPivot.rotation.set(-0.42 + Math.sin(safeElapsed * 2.4) * 0.08, 0, -0.1);
            parts.rightElbowPivot.rotation.set(-0.52, 0, 0);
          }
          parts.headPivot.rotation.set(-0.04 + chatterTilt, sway * 0.14, sway * 0.03);
          break;
        }

        case 'idle':
        default: {
          const breathe = Math.abs(Math.sin(safeElapsed * 2.0)) * 0.006;
          parts.bodyPivot.position.y = breathe + levitateHeight;
          parts.leftLegPivot.rotation.set(0, 0, 0);
          parts.rightLegPivot.rotation.set(0, 0, 0);
          parts.leftKneePivot.rotation.set(0, 0, 0);
          parts.rightKneePivot.rotation.set(0, 0, 0);

          if (opts.id === 'baki') {
            // Loose Philly-shell martial arts guard stance!
            const bob = Math.sin(safeElapsed * 3.4) * 0.03;
            parts.bodyPivot.position.y = breathe + levitateHeight + 0.018;
            parts.leftLegPivot.rotation.set(-0.08, 0.14, 0.04);
            parts.rightLegPivot.rotation.set(0.12, -0.14, -0.04);
            parts.leftKneePivot.rotation.set(0.14, 0, 0);
            parts.rightKneePivot.rotation.set(0.12, 0, 0);
            parts.torsoPivot.rotation.set(0.06, -0.22 + bob, 0);
            // Lead left arm draped low across midsection (Philly shell!)
            parts.leftArmPivot.rotation.set(-0.42 + bob, -0.32, 0.18);
            parts.leftElbowPivot.rotation.set(-1.18, 0.45, 0);
            // Rear right hand poised near jaw/chin
            parts.rightArmPivot.rotation.set(-0.92 - bob, 0.24, -0.14);
            parts.rightElbowPivot.rotation.set(-1.35, -0.25, 0);
            parts.headPivot.rotation.set(0.06 + chatterTilt, 0.22, -0.04);
          } else {
            parts.torsoPivot.rotation.set(0, 0, 0);
            parts.leftArmPivot.rotation.set(0, 0, 0.08);
            parts.rightArmPivot.rotation.set(
              opts.id === 'rick' ? -0.35 : 0,
              0,
              -0.08,
            );
            parts.leftElbowPivot.rotation.set(-0.12, 0, 0);
            parts.rightElbowPivot.rotation.set(opts.id === 'rick' ? -0.45 : -0.12, 0, 0);
            parts.headPivot.rotation.set(
              chatterTilt,
              Math.sin(safeElapsed * 1.1) * 0.11,
              0,
            );
          }
          if (parts.capeMesh) {
            parts.capeMesh.rotation.x = 0.08 + Math.sin(safeElapsed * 1.6) * 0.03;
          }
          break;
        }
      }
    },

    dispose(): void {
      b.dispose();
    },
  };

  return rig;
}

/* ============================================================================
 * 1. BJORN THE VIKING (`viking`)
 * ============================================================================ */

function buildVikingRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'viking', {
    skin: '#F0CCB4',
    pants: '#4E4036',
    shoe: '#523A2A',
    sole: '#3A2A1E',
    torso: '#7D5438',
    sleeve: '#6B462E',
    forearm: '#593A27',
    browColor: '#C8552B',
    shoulderWidth: 0.214,
    stompWalk: true,
    hideMouth: true, // hidden beneath majestic braided beard & mustache!
  });

  const ironMat = b.mat('#5D6570', 0.42, 0.5);
  const brassMat = b.mat('#CFA75A', 0.36, 0.52);
  const hornMat = b.mat('#F5EDD8', 0.58);
  const beardMat = b.mat('#C8552B', 0.86);
  const beardDarkMat = b.mat('#A8411E', 0.86);
  const furMat = b.mat('#EAE0D0', 0.92);
  const capeMat = b.mat('#9B3B32', 0.86);
  const beltMat = b.mat('#3D2B20', 0.72);
  const woodMat = b.mat('#B38252', 0.78);

  // Gleaming forged-iron Viking Spangenhelm helmet + brass brow band + decorative rivets + nose guard
  b.sphere(parts.headPivot, 0.172, 12, ironMat, 0, 0.214, -0.006, {
    sx: 1.03,
    sy: 0.74,
    sz: 1.02,
  });
  b.torus(parts.headPivot, 0.168, 0.018, 6, 16, brassMat, 0, 0.222, -0.004, {
    rx: Math.PI / 2,
  });
  // Gleaming brass rivets around helmet brow band (pops in 3D PFP!)
  for (const a of [-0.55, 0, 0.55]) {
    b.sphere(parts.headPivot, 0.012, 6, brassMat, Math.sin(a) * 0.176, 0.224, Math.cos(a) * 0.172);
  }
  // Vertical helmet crest ridge & crisp iron nose guard
  b.box(parts.headPivot, 0.026, 0.145, 0.028, brassMat, 0, 0.295, 0.02, { rx: 0.18 });
  b.box(parts.headPivot, 0.024, 0.072, 0.02, ironMat, 0, 0.184, 0.168);

  // 2 iconic gleaming curved ivory Viking horns (2-segment swept horns on left & right!)
  for (const side of [-1, 1]) {
    b.rod(
      parts.headPivot,
      side * 0.158,
      0.240,
      0.0,
      side * 0.258,
      0.285,
      0.018,
      0.024,
      0.038,
      7,
      hornMat,
    );
    b.cone(parts.headPivot, 0.024, 0.128, 7, hornMat, side * 0.268, 0.348, 0.025, {
      rz: -side * 0.26,
      rx: 0.08,
    });
    // Brass horn cuff ring
    b.torus(parts.headPivot, 0.038, 0.01, 5, 10, brassMat, side * 0.166, 0.244, 0.002, {
      ry: Math.PI / 2,
      rz: side * 0.35,
    });
  }

  // Rich braided fiery-red beard + sculpted curling mustache + twin braided tails with gold rings
  b.sphere(parts.headPivot, 0.108, 8, beardMat, 0, 0.070, 0.118, {
    sx: 1.24,
    sy: 0.96,
    sz: 0.74,
  });
  // Curling twin mustache wings
  b.sphere(parts.headPivot, 0.042, 7, beardDarkMat, -0.052, 0.116, 0.156, {
    sx: 1.45,
    sy: 0.56,
    sz: 0.65,
    rz: 0.18,
  });
  b.sphere(parts.headPivot, 0.042, 7, beardDarkMat, 0.052, 0.116, 0.156, {
    sx: 1.45,
    sy: 0.56,
    sz: 0.65,
    rz: -0.18,
  });
  for (const side of [-1, 1]) {
    b.cyl(parts.headPivot, 0.038, 0.024, 0.15, 7, beardMat, side * 0.052, -0.026, 0.142, {
      rz: side * 0.08,
    });
    b.torus(parts.headPivot, 0.028, 0.009, 5, 8, brassMat, side * 0.056, -0.068, 0.142, {
      rx: Math.PI / 2,
    });
  }

  // Thick leather Viking belt + large square brass buckle
  b.cyl(parts.torsoPivot, 0.148, 0.150, 0.058, 10, beltMat, 0, 0.048, 0, {
    sx: 1.06,
    sz: 0.88,
  });
  b.box(parts.torsoPivot, 0.068, 0.052, 0.026, brassMat, 0, 0.048, 0.138);

  // Plush fur-trimmed shoulder mantle + crimson Viking cloak on back
  for (const [fx, fz] of [
    [-0.14, 0.06],
    [0.14, 0.06],
    [-0.17, -0.04],
    [0.17, -0.04],
    [-0.08, -0.11],
    [0.08, -0.11],
    [0, -0.12],
  ] as const) {
    b.sphere(parts.torsoPivot, 0.068, 7, furMat, fx, 0.315, fz, {
      sx: 1.15,
      sy: 0.72,
      sz: 1.05,
    });
  }
  const capePivot = new THREE.Group();
  capePivot.position.set(0, 0.31, -0.13);
  parts.torsoPivot.add(capePivot);
  b.box(capePivot, 0.34, 0.44, 0.028, capeMat, 0, -0.22, -0.015);
  parts.capeMesh = capePivot;

  // Fur boot cuffs on both legs
  b.cyl(parts.leftKneePivot, 0.052, 0.052, 0.048, 8, furMat, 0, -0.13, 0);
  b.cyl(parts.rightKneePivot, 0.052, 0.052, 0.048, 8, furMat, 0, -0.13, 0);

  // Iconic Round Wooden Viking Shield strapped onto his back (strictly clear of cape!)
  const shieldGroup = new THREE.Group();
  shieldGroup.position.set(0.02, 0.16, -0.185);
  shieldGroup.rotation.y = Math.PI;
  parts.torsoPivot.add(shieldGroup);
  b.cyl(shieldGroup, 0.195, 0.195, 0.026, 12, woodMat, 0, 0, 0, { rx: Math.PI / 2 });
  b.torus(shieldGroup, 0.195, 0.015, 6, 14, ironMat, 0, 0, 0);
  // Painted red cross bars & raised steel center boss
  b.box(shieldGroup, 0.34, 0.062, 0.008, capeMat, 0, 0, 0.017);
  b.box(shieldGroup, 0.062, 0.34, 0.008, capeMat, 0, 0, 0.023);
  b.sphere(shieldGroup, 0.052, 8, ironMat, 0, 0, 0.025, { sz: 0.65 });

  return createHumanoidRigController(b, parts, {
    id: 'viking',
    baseBubbleHeight: 1.72,
    stompWalk: true,
    defaultBrowTilt: -0.12,
  });
}

/* ============================================================================
 * 2. SCREAMING YELLOW RUBBER CHICKEN (`squeaky_chicken`)
 * ============================================================================ */

function buildSqueakyChickenRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const root = new THREE.Group();
  root.name = 'Special_squeaky_chicken';

  const shadowMesh = b.addGroundShadow(root, 0.21);

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const yellowMat = b.mat('#F8EF18', 0.4, 0.06); // Dave's Hot Chicken iconic bright vinyl yellow!
  const yellowShadeMat = b.mat('#E5D40C', 0.46, 0.04);
  const orangeMat = b.mat('#F57E20', 0.54);
  const redMat = b.mat('#C8102E', 0.42); // Fiery Dave's Hot Chicken red beak, comb & wattles!
  const throatMat = b.mat('#6B0A1A', 0.85);
  const tongueMat = b.mat('#F2788A', 0.65);
  const whiteMat = b.mat('#FFFFFF', 0.22);
  const blackMat = b.mat('#15151A', 0.2);

  // 1. Orange legs & 3-toed webbed rubber chicken feet (bottom flush at y = 0.000!)
  const leftLegPivot = new THREE.Group();
  const rightLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.075, 0.26, 0);
  rightLegPivot.position.set(0.075, 0.26, 0);
  bodyPivot.add(leftLegPivot, rightLegPivot);

  for (const legPivot of [leftLegPivot, rightLegPivot]) {
    b.cyl(legPivot, 0.022, 0.018, 0.24, 7, orangeMat, 0, -0.12, 0);
    // Flat webbed foot pad (y = -0.248, h = 0.024 -> bottom -0.26 => world y = 0.000!)
    b.box(legPivot, 0.065, 0.024, 0.095, orangeMat, 0, -0.248, 0.025);
    // 3 splayed webbed toes
    b.box(legPivot, 0.024, 0.02, 0.085, orangeMat, -0.036, -0.25, 0.068, { ry: 0.38 });
    b.box(legPivot, 0.024, 0.02, 0.095, orangeMat, 0, -0.25, 0.078);
    b.box(legPivot, 0.024, 0.02, 0.085, orangeMat, 0.036, -0.25, 0.068, { ry: -0.38 });
  }

  // 2. Plump pear-shaped rubber chicken body
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.26, 0);
  bodyPivot.add(torsoGroup);

  b.sphere(torsoGroup, 0.195, 12, yellowMat, 0, 0.165, -0.01, {
    sx: 0.94,
    sy: 1.15,
    sz: 1.05,
  });
  b.cyl(torsoGroup, 0.115, 0.175, 0.22, 10, yellowMat, 0, 0.30, 0);
  // Cute perky tail feathers at back (-Z)
  b.cone(torsoGroup, 0.055, 0.13, 5, yellowShadeMat, 0, 0.21, -0.21, { rx: -0.85, sz: 0.55 });
  b.cone(torsoGroup, 0.042, 0.105, 5, yellowMat, -0.035, 0.24, -0.19, { rx: -0.7, rz: 0.25, sz: 0.5 });
  b.cone(torsoGroup, 0.042, 0.105, 5, yellowMat, 0.035, 0.24, -0.19, { rx: -0.7, rz: -0.25, sz: 0.5 });

  // 3. Floppy little yellow rubber wings
  const leftWingPivot = new THREE.Group();
  const rightWingPivot = new THREE.Group();
  leftWingPivot.position.set(-0.175, 0.255, 0.0);
  rightWingPivot.position.set(0.175, 0.255, 0.0);
  torsoGroup.add(leftWingPivot, rightWingPivot);
  b.sphere(leftWingPivot, 0.075, 7, yellowShadeMat, -0.025, -0.065, -0.01, {
    sx: 0.42,
    sy: 1.35,
    sz: 0.92,
    rz: 0.18,
  });
  b.sphere(rightWingPivot, 0.075, 7, yellowShadeMat, 0.025, -0.065, -0.01, {
    sx: 0.42,
    sy: 1.35,
    sz: 0.92,
    rz: -0.18,
  });

  // 4. Long skinny stretchable rubber neck!
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.38, 0.015);
  torsoGroup.add(neckPivot);

  const neckStretchGroup = new THREE.Group();
  neckPivot.add(neckStretchGroup);
  b.cyl(neckStretchGroup, 0.048, 0.072, 0.36, 9, yellowMat, 0, 0.18, 0);
  // Subtle rubber squeaker-neck crease rings
  b.torus(neckStretchGroup, 0.062, 0.008, 5, 10, yellowShadeMat, 0, 0.08, 0, { rx: Math.PI / 2 });
  b.torus(neckStretchGroup, 0.055, 0.008, 5, 10, yellowShadeMat, 0, 0.20, 0, { rx: Math.PI / 2 });

  // 5. Tilted screaming head anchored at top of stretchable neck
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.36, 0.01);
  neckPivot.add(headPivot);

  b.sphere(headPivot, 0.122, 11, yellowMat, 0, 0.095, 0.01, { sx: 0.94, sy: 1.08, sz: 1.05 });

  // Big floppy scalloped fiery-red comb (4 lush rounded lobes arching across crown!)
  b.sphere(headPivot, 0.046, 7, redMat, 0, 0.232, 0.058, { sx: 0.46, sy: 1.18, sz: 0.88, rx: 0.18 });
  b.sphere(headPivot, 0.052, 7, redMat, 0, 0.252, 0.008, { sx: 0.46, sy: 1.3, sz: 0.94 });
  b.sphere(headPivot, 0.048, 7, redMat, 0, 0.24, -0.045, { sx: 0.46, sy: 1.2, sz: 0.9, rx: -0.2 });
  b.sphere(headPivot, 0.04, 7, redMat, 0, 0.205, -0.095, { sx: 0.45, sy: 1.05, sz: 0.85, rx: -0.45 });

  // Giant bulging cartoon white googly eyes with crisp dark pupils & sparkle dots!
  b.sphere(headPivot, 0.058, 10, whiteMat, -0.072, 0.142, 0.096, { sx: 0.96, sy: 1.06, sz: 0.84 });
  b.sphere(headPivot, 0.058, 10, whiteMat, 0.072, 0.142, 0.096, { sx: 0.96, sy: 1.06, sz: 0.84 });
  b.torus(headPivot, 0.056, 0.006, 5, 12, yellowShadeMat, -0.072, 0.142, 0.088, { ry: -0.35 });
  b.torus(headPivot, 0.056, 0.006, 5, 12, yellowShadeMat, 0.072, 0.142, 0.088, { ry: 0.35 });
  b.sphere(headPivot, 0.025, 7, blackMat, -0.064, 0.148, 0.140);
  b.sphere(headPivot, 0.026, 7, blackMat, 0.076, 0.134, 0.140);
  b.sphere(headPivot, 0.008, 5, whiteMat, -0.056, 0.158, 0.162);
  b.sphere(headPivot, 0.008, 5, whiteMat, 0.084, 0.144, 0.162);

  // Dark open screaming throat interior + tiny pink tongue!
  b.sphere(headPivot, 0.062, 8, throatMat, 0, 0.062, 0.112, { sx: 1.08, sy: 0.88, sz: 0.74 });
  b.sphere(headPivot, 0.032, 6, tongueMat, 0, 0.042, 0.138, { sx: 1.15, sy: 0.45, sz: 1.1 });

  // Oversized fiery-red articulated wide-open screaming beak!
  const upperBeakPivot = new THREE.Group();
  upperBeakPivot.position.set(0, 0.098, 0.118);
  headPivot.add(upperBeakPivot);
  b.cone(upperBeakPivot, 0.068, 0.175, 7, redMat, 0, 0.018, 0.084, {
    rx: Math.PI / 2 - 0.18,
    sx: 1.12,
    sz: 0.56,
  });

  const lowerBeakPivot = new THREE.Group();
  lowerBeakPivot.position.set(0, 0.038, 0.116);
  headPivot.add(lowerBeakPivot);
  b.cone(lowerBeakPivot, 0.062, 0.16, 7, redMat, 0, -0.018, 0.078, {
    rx: Math.PI / 2 + 0.28,
    sx: 1.05,
    sz: 0.52,
  });
  // Prominent twin dangling fiery-red chin wattles hanging below lower beak!
  b.sphere(lowerBeakPivot, 0.028, 7, redMat, -0.026, -0.068, 0.016, { sy: 1.48, sx: 0.78 });
  b.sphere(lowerBeakPivot, 0.028, 7, redMat, 0.026, -0.068, 0.016, { sy: 1.48, sx: 0.78 });

  let pose: SpecialPose = 'idle';
  let squeakPulse = 0;
  let levitateHeight = 0;
  let animPhase = Math.random() * Math.PI * 2;

  const rig: SpecialCharacterRig = {
    root,
    bubbleHeight: 1.62,

    setPose(nextPose: SpecialPose): void {
      pose = nextPose;
    },

    setMood(_mood: VisitorMood): void {
      // Chicken's screaming joy is eternal!
    },

    triggerSqueakPulse(): void {
      squeakPulse = 1.0;
    },

    update(
      dt: number,
      elapsed: number,
      moveSpeed: number,
      isBlabbering = false,
      seatY?: number,
    ): void {
      const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      const speed = Number.isFinite(moveSpeed) && moveSpeed > 0 ? moveSpeed : 1.5;

      if (squeakPulse > 0) {
        squeakPulse = Math.max(0, squeakPulse - safeDt * 1.8);
      }

      const targetLev = pose === 'levitate' ? 1.65 : 0;
      levitateHeight = damp(levitateHeight, targetLev, 5.0, safeDt);

      const isSeatPose = pose === 'sit' || pose === 'thinker' || pose === 'sleep';
      const targetWorldSeatY =
        isSeatPose && seatY !== undefined && seatY > 0.08
          ? seatY
          : isSeatPose && root.position.y > 0.08
            ? root.position.y
            : 0;
      const isSeatedElevated = isSeatPose && targetWorldSeatY > 0.08;
      const localSeatBase = isSeatedElevated ? targetWorldSeatY - root.position.y : 0;

      shadowMesh.visible = !isSeatedElevated && levitateHeight < 0.15 && pose !== 'ragdoll';

      // Compute active screaming squeak intensity (from pose OR triggerSqueakPulse OR blabber!)
      const activeSqueak =
        pose === 'squeak'
          ? 0.65 + 0.35 * Math.abs(Math.sin(safeElapsed * 11))
          : Math.max(squeakPulse, isBlabbering ? 0.35 + 0.25 * Math.sin(safeElapsed * 18) : 0);

      const neckScaleY = 1.0 + activeSqueak * 0.42;
      neckStretchGroup.scale.set(1 - activeSqueak * 0.12, neckScaleY, 1 - activeSqueak * 0.12);
      headPivot.position.y = 0.36 * neckScaleY;

      // Snap beak wide open during squeak!
      upperBeakPivot.rotation.x = -0.18 - activeSqueak * 0.42;
      lowerBeakPivot.rotation.x = 0.24 + activeSqueak * 0.56;

      // Rubber body squash & rebound during squeak pulse
      const squash = squeakPulse > 0.5 ? (squeakPulse - 0.5) * 0.48 : 0;
      const stretch = squeakPulse > 0 && squeakPulse <= 0.5 ? squeakPulse * 0.3 : activeSqueak * 0.1;
      torsoGroup.scale.set(
        1 + squash - stretch * 0.45,
        1 - squash * 0.9 + stretch,
        1 + squash - stretch * 0.45,
      );

      rig.bubbleHeight = 1.62 + levitateHeight + activeSqueak * 0.18;

      bodyPivot.rotation.set(0, 0, 0);
      neckPivot.rotation.set(0, 0, 0);

      switch (pose) {
        case 'squeak': {
          const hop = Math.abs(Math.sin(safeElapsed * 11)) * 0.14;
          bodyPivot.position.y = hop;
          neckPivot.rotation.set(-0.22 - activeSqueak * 0.18, 0, Math.sin(safeElapsed * 22) * 0.14);
          headPivot.rotation.set(-0.26, 0, Math.sin(safeElapsed * 24) * 0.12);
          leftWingPivot.rotation.set(0, 0, 0.72 + Math.sin(safeElapsed * 26) * 0.55);
          rightWingPivot.rotation.set(0, 0, -0.72 - Math.sin(safeElapsed * 26) * 0.55);
          leftLegPivot.rotation.set(-hop * 1.4, 0, 0);
          rightLegPivot.rotation.set(-hop * 1.4, 0, 0);
          break;
        }

        case 'walk': {
          animPhase += safeDt * speed * 7.8;
          const stride = Math.sin(animPhase);
          const hop = Math.abs(stride) * 0.06;
          bodyPivot.position.y = hop;
          bodyPivot.rotation.set(0.06, 0, stride * 0.08);
          leftLegPivot.rotation.set(stride * 0.52, 0, 0);
          rightLegPivot.rotation.set(-stride * 0.52, 0, 0);
          neckPivot.rotation.set(0.1 + Math.abs(stride) * 0.08, 0, -stride * 0.08);
          headPivot.rotation.set(-0.08, stride * 0.1, 0);
          leftWingPivot.rotation.set(0, 0, 0.22 + Math.abs(stride) * 0.32);
          rightWingPivot.rotation.set(0, 0, -0.22 - Math.abs(stride) * 0.32);
          break;
        }

        case 'dance': {
          const beat = Math.sin(safeElapsed * 8.5);
          bodyPivot.position.y = Math.abs(beat) * 0.11;
          bodyPivot.rotation.set(0, beat * 0.25, beat * 0.14);
          leftLegPivot.rotation.set(beat * 0.35, 0, 0);
          rightLegPivot.rotation.set(-beat * 0.35, 0, 0);
          leftWingPivot.rotation.set(0, 0, 0.65 + beat * 0.45);
          rightWingPivot.rotation.set(0, 0, -0.65 + beat * 0.45);
          neckPivot.rotation.set(-0.12, 0, -beat * 0.18);
          headPivot.rotation.set(-0.15, beat * 0.18, 0);
          break;
        }

        case 'ragdoll': {
          const spin = safeElapsed * 12;
          bodyPivot.position.y = 0.35 + Math.abs(Math.sin(spin * 0.5)) * 0.18;
          bodyPivot.rotation.set(-1.1 + Math.sin(spin) * 0.4, spin * 0.4, Math.cos(spin) * 0.7);
          neckPivot.rotation.set(Math.sin(spin * 1.4) * 0.45, 0, Math.cos(spin * 1.4) * 0.45);
          leftWingPivot.rotation.set(0, 0, 1.15);
          rightWingPivot.rotation.set(0, 0, -1.15);
          leftLegPivot.rotation.set(0.5, 0, 0.35);
          rightLegPivot.rotation.set(-0.5, 0, -0.35);
          break;
        }

        case 'sit':
        case 'thinker':
        case 'sleep': {
          bodyPivot.position.y = isSeatedElevated ? localSeatBase - 0.24 : 0;
          leftLegPivot.rotation.set(-1.25, 0.15, 0);
          rightLegPivot.rotation.set(-1.25, -0.15, 0);
          neckPivot.rotation.set(pose === 'sleep' ? 0.35 : -0.05, 0, 0);
          headPivot.rotation.set(pose === 'sleep' ? 0.25 : 0, Math.sin(safeElapsed) * 0.12, 0);
          leftWingPivot.rotation.set(0, 0, 0.12);
          rightWingPivot.rotation.set(0, 0, -0.12);
          break;
        }

        case 'levitate': {
          bodyPivot.position.y = levitateHeight + Math.sin(safeElapsed * 2.2) * 0.08;
          leftLegPivot.rotation.set(-0.35, 0, 0.15);
          rightLegPivot.rotation.set(-0.35, 0, -0.15);
          leftWingPivot.rotation.set(0, 0, 0.85 + Math.sin(safeElapsed * 3) * 0.15);
          rightWingPivot.rotation.set(0, 0, -0.85 - Math.sin(safeElapsed * 3) * 0.15);
          neckPivot.rotation.set(-0.18, 0, 0);
          headPivot.rotation.set(-0.2, 0, 0);
          break;
        }

        case 'stumble': {
          const w = Math.sin(safeElapsed * 24);
          bodyPivot.position.y = Math.abs(Math.sin(safeElapsed * 12)) * 0.09;
          bodyPivot.rotation.set(-0.2, 0, w * 0.2);
          leftWingPivot.rotation.set(0, 0, 0.95 + w * 0.35);
          rightWingPivot.rotation.set(0, 0, -0.95 + w * 0.35);
          neckPivot.rotation.set(-0.2, 0, -w * 0.25);
          break;
        }

        default: {
          // Idle / admire / eat / stare / pet / kick
          const bob = Math.abs(Math.sin(safeElapsed * 2.6)) * 0.012;
          bodyPivot.position.y = bob + levitateHeight;
          leftLegPivot.rotation.set(0, 0, 0);
          rightLegPivot.rotation.set(0, 0, 0);
          neckPivot.rotation.set(-0.08 - activeSqueak * 0.15, 0, Math.sin(safeElapsed * 1.8) * 0.06);
          headPivot.rotation.set(-0.12, Math.sin(safeElapsed * 1.4) * 0.16, 0.06);
          leftWingPivot.rotation.set(0, 0, 0.18 + activeSqueak * 0.65);
          rightWingPivot.rotation.set(0, 0, -0.18 - activeSqueak * 0.65);
          break;
        }
      }
    },

    dispose(): void {
      b.dispose();
    },
  };

  return rig;
}

/* ============================================================================
 * 3. SATORU GOJO (`gojo`)
 * ============================================================================ */

function buildGojoRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'gojo', {
    skin: '#F6E2D4',
    pants: '#1B2130',
    shoe: '#16181F',
    sole: '#2B2F3B',
    torso: '#1D2436',
    sleeve: '#1D2436',
    hideEyes: true, // custom JJK S2 round dark sunglasses ↔ glowing crystalline cyan Six Eyes!
    mouthColor: '#7B4C48',
  });

  const hairMat = b.mat('#F6F9FF', 0.64);
  const hairShadeMat = b.mat('#E0E8F6', 0.68);
  const collarMat = b.mat('#263047', 0.76);
  const buttonMat = b.mat('#D8DCE6', 0.28, 0.68);
  const lensMat = b.mat('#12151E', 0.16, 0.36);
  const frameMat = b.mat('#3A3F4D', 0.3, 0.55);
  const whiteMat = b.mat('#FFFFFF', 0.22);
  const sixEyeCyanMat = b.mat('#5CE1FF', 0.14, 0.05, '#38D6FF', 1.55);
  const pupilMat = b.mat('#0B2738', 0.2);

  // Dark navy Jujutsu High mandarin high-collar uniform + gleaming swirl button
  b.cyl(parts.torsoPivot, 0.095, 0.112, 0.098, 10, collarMat, 0, 0.355, 0.005);
  b.cyl(parts.torsoPivot, 0.016, 0.016, 0.014, 8, buttonMat, 0.038, 0.335, 0.106, {
    rx: Math.PI / 2,
  });
  b.cyl(parts.torsoPivot, 0.145, 0.156, 0.10, 10, collarMat, 0, 0.02, 0, { sx: 1.05, sz: 0.88 });

  // Confident asymmetric smirk
  parts.mouthMesh.position.set(0.004, 0.104, 0.160);
  parts.mouthMesh.rotation.z = 0.09;

  // JJK Season 2 small round dark tinted sunglasses (visible when walking/idle, hidden when ascending!)
  const sunglassesGroup = new THREE.Group();
  sunglassesGroup.name = 'GojoSunglasses';
  parts.headPivot.add(sunglassesGroup);
  for (const sx of [-0.058, 0.058]) {
    b.cyl(sunglassesGroup, 0.042, 0.042, 0.012, 12, lensMat, sx, 0.168, 0.174, {
      rx: Math.PI / 2,
    });
    b.torus(sunglassesGroup, 0.043, 0.006, 5, 14, frameMat, sx, 0.168, 0.175);
    // Crisp tiny white glass glint on lens
    b.box(sunglassesGroup, 0.014, 0.006, 0.004, whiteMat, sx - 0.012, 0.180, 0.182, {
      rz: 0.45,
      castShadow: false,
    });
  }
  // Nose bridge & sleek side temple arms reaching ears
  b.box(sunglassesGroup, 0.036, 0.008, 0.008, frameMat, 0, 0.172, 0.175);
  b.rod(sunglassesGroup, -0.098, 0.170, 0.172, -0.162, 0.168, 0.006, 0.005, 0.005, 5, frameMat);
  b.rod(sunglassesGroup, 0.098, 0.170, 0.172, 0.162, 0.168, 0.006, 0.005, 0.005, 5, frameMat);
  parts.sunglassesGroup = sunglassesGroup;

  // Glowing bright crystalline cyan Six Eyes (#5CE1FF) + snow-white lashes (unveiled on levitate / setAuraActive!)
  const sixEyesGroup = new THREE.Group();
  sixEyesGroup.name = 'GojoSixEyes';
  sixEyesGroup.visible = false;
  parts.headPivot.add(sixEyesGroup);
  for (const side of [-1, 1]) {
    const sx = side * 0.056;
    // White sclera base
    b.sphere(sixEyesGroup, 0.031, 8, whiteMat, sx, 0.168, 0.153, {
      sx: 1.06,
      sy: 0.82,
      sz: 0.48,
      castShadow: false,
    });
    // Glowing crystalline cyan Six Eyes iris!
    b.cyl(sixEyesGroup, 0.022, 0.022, 0.008, 12, sixEyeCyanMat, sx, 0.168, 0.167, {
      rx: Math.PI / 2,
      castShadow: false,
    });
    // Crisp dark pupil + bright starlight catchlight
    b.sphere(sixEyesGroup, 0.009, 6, pupilMat, sx, 0.168, 0.173, { castShadow: false });
    b.sphere(sixEyesGroup, 0.006, 5, whiteMat, sx + 0.007, 0.174, 0.179, { castShadow: false });
    // Iconic snow-white upper eyelashes & subtle white brow!
    b.box(sixEyesGroup, 0.058, 0.011, 0.012, hairMat, sx, 0.194, 0.162, {
      rz: -side * 0.08,
      castShadow: false,
    });
    b.box(sixEyesGroup, 0.048, 0.009, 0.01, hairShadeMat, sx, 0.214, 0.156, {
      rz: -side * 0.06,
      castShadow: false,
    });
  }
  parts.sixEyesGroup = sixEyesGroup;

  // Wild fluffed/spiky snow-white hair (JJK Season 2 Honored One silhouette!)
  b.sphere(parts.headPivot, 0.168, 11, hairShadeMat, 0, 0.228, -0.025, {
    sx: 1.07,
    sy: 0.82,
    sz: 1.03,
  });
  const spikes: Array<[number, number, number, number, number, number, number, boolean]> = [
    [0, 0.365, 0.015, 0.066, 0.185, -0.06, 0.0, true],
    [-0.086, 0.355, 0.04, 0.058, 0.17, 0.16, 0.34, true],
    [0.086, 0.355, 0.04, 0.058, 0.17, 0.16, -0.34, true],
    [-0.142, 0.315, -0.01, 0.054, 0.15, -0.05, 0.58, false],
    [0.142, 0.315, -0.01, 0.054, 0.15, -0.05, -0.58, false],
    // Windswept white bangs & temple locks framing his sunglasses / Six Eyes!
    [-0.072, 0.275, 0.128, 0.042, 0.115, 0.78, 0.28, true],
    [0.015, 0.285, 0.132, 0.044, 0.11, 0.72, -0.1, true],
    [0.084, 0.268, 0.124, 0.040, 0.11, 0.76, -0.32, true],
    [-0.155, 0.205, 0.045, 0.036, 0.11, 0.32, 0.92, false],
    [0.155, 0.205, 0.045, 0.036, 0.11, 0.32, -0.92, false],
    [-0.068, 0.335, -0.095, 0.056, 0.16, -0.46, 0.28, false],
    [0.068, 0.335, -0.095, 0.056, 0.16, -0.46, -0.28, false],
    [0, 0.255, -0.15, 0.068, 0.15, -0.84, 0, false],
  ];
  for (const [x, y, z, r, h, rx, rz, bright] of spikes) {
    b.cone(parts.headPivot, r, h, 5, bright ? hairMat : hairShadeMat, x, y, z, { rx, rz });
  }

  // Radiant Golden-Cyan Honored One Celestial Aura Group + 3 orbiting Blue/Red/Purple orbs!
  const auraGroup = new THREE.Group();
  auraGroup.visible = false;
  parts.bodyPivot.add(auraGroup);

  const haloMat = b.mat('#C8F6FF', 0.15, 0.1, '#5CE1FF', 1.6);
  const goldHaloMat = b.mat('#FFF0B8', 0.15, 0.2, '#FFD97A', 1.45);
  b.torus(auraGroup, 0.34, 0.022, 8, 22, haloMat, 0, 1.08, -0.18, { castShadow: false });
  b.torus(auraGroup, 0.42, 0.013, 6, 22, goldHaloMat, 0, 1.08, -0.18, { castShadow: false });

  const orbBlue = b.sphere(
    auraGroup,
    0.058,
    8,
    b.mat('#8AD2FF', 0.15, 0.05, '#3A9DFF', 1.6),
    0.44,
    0.8,
    0,
    { castShadow: false },
  );
  const orbRed = b.sphere(
    auraGroup,
    0.058,
    8,
    b.mat('#FF8CA2', 0.15, 0.05, '#FF3E62', 1.6),
    -0.22,
    0.8,
    0.38,
    { castShadow: false },
  );
  const orbPurple = b.sphere(
    auraGroup,
    0.066,
    8,
    b.mat('#DC9EFF', 0.15, 0.05, '#A848FF', 1.7),
    -0.22,
    0.8,
    -0.38,
    { castShadow: false },
  );

  parts.auraGroup = auraGroup;
  parts.auraOrbs = [orbBlue, orbRed, orbPurple];

  return createHumanoidRigController(b, parts, {
    id: 'gojo',
    baseBubbleHeight: 1.72,
    hasAura: true,
  });
}

/* ============================================================================
 * 4. BAKI HANMA (`baki`)
 * ============================================================================ */

function buildBakiRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'baki', {
    skin: '#E6B48F',
    pants: '#D62828', // bright red arena fighting trunks!
    lowerLeg: '#E6B48F', // bare muscular legs
    shoe: '#E6B48F', // barefoot underground arena fighter!
    sole: '#D49E79',
    torso: '#E6B48F', // SHIRTLESS sculpted muscular fighter torso!
    sleeve: '#E6B48F',
    forearm: '#E6B48F',
    wristWrap: '#F6F3EC',
    ankleWrap: '#F6F3EC',
    browColor: '#582B1B',
    shoulderWidth: 0.22,
  });

  const skinShadeMat = b.mat('#D8A27D', 0.8);
  const scarMat = b.mat('#C27C68', 0.78);
  const trunksMat = b.mat('#D62828', 0.76);
  const whiteTrimMat = b.mat('#F7F4EE', 0.82);
  const hairMat = b.mat('#763E28', 0.74);
  const hairDarkMat = b.mat('#582B1B', 0.78);

  // Sculpted muscular pectorals, defined abs & trapezius shoulder caps
  b.box(parts.torsoPivot, 0.11, 0.095, 0.042, skinShadeMat, -0.064, 0.252, 0.118);
  b.box(parts.torsoPivot, 0.11, 0.095, 0.042, skinShadeMat, 0.064, 0.252, 0.118);
  for (const ay of [0.168, 0.112, 0.062]) {
    b.box(parts.torsoPivot, 0.056, 0.04, 0.024, skinShadeMat, -0.036, ay, 0.116);
    b.box(parts.torsoPivot, 0.056, 0.04, 0.024, skinShadeMat, 0.036, ay, 0.116);
  }
  // Subtle signature Baki crisscross battle scars across chest, shoulder, brow & cheek!
  b.box(parts.torsoPivot, 0.092, 0.011, 0.009, scarMat, -0.052, 0.248, 0.145, { rz: -0.45 });
  b.box(parts.torsoPivot, 0.062, 0.01, 0.009, scarMat, -0.048, 0.248, 0.149, { rz: 0.55 });
  b.box(parts.torsoPivot, 0.065, 0.01, 0.009, scarMat, 0.068, 0.165, 0.138, { rz: 0.35 });
  b.box(parts.rightArmPivot, 0.012, 0.055, 0.014, scarMat, 0.042, -0.03, 0.012, { rx: 0.32 });
  // Signature brow nick scar & tiny mole under lower lip (crisp in 3D PFP!)
  b.box(parts.headPivot, 0.011, 0.038, 0.012, scarMat, -0.062, 0.222, 0.164, { rz: 0.25 });
  b.sphere(parts.headPivot, 0.007, 5, b.mat('#4C3428', 0.6), 0.026, 0.088, 0.165);

  // Bright red arena fighting trunks waistband + white sporty trim + loose short cuffs
  b.cyl(parts.torsoPivot, 0.146, 0.15, 0.052, 10, whiteTrimMat, 0, 0.024, 0, {
    sx: 1.06,
    sz: 0.88,
  });
  b.cyl(parts.leftLegPivot, 0.064, 0.068, 0.135, 8, trunksMat, 0, -0.075, 0);
  b.cyl(parts.rightLegPivot, 0.064, 0.068, 0.135, 8, trunksMat, 0, -0.075, 0);
  b.box(parts.leftLegPivot, 0.016, 0.125, 0.022, whiteTrimMat, -0.066, -0.075, 0);
  b.box(parts.rightLegPivot, 0.016, 0.125, 0.022, whiteTrimMat, 0.066, -0.075, 0);

  // Spiky chestnut Hanma top hair + longer layered shaggy hair locks draping down the back!
  b.sphere(parts.headPivot, 0.168, 10, hairMat, 0, 0.205, -0.025, {
    sx: 1.05,
    sy: 0.86,
    sz: 1.02,
  });
  const spikes: Array<[number, number, number, number, number, number, number, boolean]> = [
    [0, 0.34, 0.0, 0.064, 0.155, -0.1, 0, true],
    [-0.088, 0.325, 0.03, 0.056, 0.145, 0.18, 0.38, true],
    [0.088, 0.325, 0.03, 0.056, 0.145, 0.18, -0.38, true],
    [-0.148, 0.255, -0.015, 0.054, 0.14, 0.0, 0.78, false],
    [0.148, 0.255, -0.015, 0.054, 0.14, 0.0, -0.78, false],
    [-0.065, 0.268, 0.128, 0.044, 0.105, 0.72, 0.22, true],
    [0.065, 0.268, 0.128, 0.044, 0.105, 0.72, -0.22, true],
    // Longer spiky back locks cascading cleanly behind nape/collar!
    [-0.095, 0.11, -0.148, 0.056, 0.185, -1.25, 0.22, false],
    [0.095, 0.11, -0.148, 0.056, 0.185, -1.25, -0.22, false],
    [0, 0.135, -0.162, 0.064, 0.195, -1.22, 0, false],
    [-0.145, 0.125, -0.085, 0.046, 0.145, -0.75, 0.65, false],
    [0.145, 0.125, -0.085, 0.046, 0.145, -0.75, -0.65, false],
  ];
  for (const [x, y, z, r, h, rx, rz, bright] of spikes) {
    b.cone(parts.headPivot, r, h, 5, bright ? hairMat : hairDarkMat, x, y, z, { rx, rz });
  }

  return createHumanoidRigController(b, parts, {
    id: 'baki',
    baseBubbleHeight: 1.68,
    defaultBrowTilt: -0.2, // fierce fighter brow!
  });
}

/* ============================================================================
 * 5. WILLIAM SHAKESPEARE (`shakespeare`)
 * ============================================================================ */

function buildShakespeareRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'shakespeare', {
    skin: '#F2D6C0',
    pants: '#46293E',
    lowerLeg: '#EDE4D3', // Tudor cream hose
    shoe: '#3A2C26',
    sole: '#261C18',
    torso: '#6E3B5C', // plum velvet doublet
    sleeve: '#7F476C',
    forearm: '#6E3B5C',
    browColor: '#4B3426',
  });

  const hairMat = b.mat('#4B3426', 0.82);
  const ruffMat = b.mat('#FAF6EE', 0.86);
  const goldMat = b.mat('#DFB864', 0.35, 0.55);
  const velvetTrimMat = b.mat('#8E5279', 0.78);
  const quillMat = b.mat('#FAF7F0', 0.68);

  // Iconic balding dome crown framed by fluffy curly dark side locks & back curls!
  const curls: Array<[number, number, number, number]> = [
    [-0.155, 0.195, -0.01, 0.058],
    [-0.162, 0.125, -0.025, 0.056],
    [0.155, 0.195, -0.01, 0.058],
    [0.162, 0.125, -0.025, 0.056],
    [-0.105, 0.165, -0.135, 0.068],
    [0.105, 0.165, -0.135, 0.068],
    [0, 0.155, -0.152, 0.072],
    [0, 0.095, -0.142, 0.062],
  ];
  for (const [cx, cy, cz, cr] of curls) {
    b.sphere(parts.headPivot, cr, 7, hairMat, cx, cy, cz);
  }
  // Pointed Elizabethan goatee + crisp thin mustache + tiny gold hoop earring on left ear!
  b.box(parts.headPivot, 0.088, 0.014, 0.016, hairMat, 0, 0.12, 0.16);
  b.cone(parts.headPivot, 0.036, 0.075, 6, hairMat, 0, 0.052, 0.145, { rx: Math.PI });
  b.torus(parts.headPivot, 0.016, 0.005, 5, 8, goldMat, -0.168, 0.118, 0.004, { ry: Math.PI / 2 });

  // Prominent pleated white Elizabethan neck ruff with crisp alternating shadow pleats!
  const ruffShadowMat = b.mat('#EAE2D4', 0.88);
  b.torus(parts.torsoPivot, 0.132, 0.036, 7, 16, ruffMat, 0, 0.366, 0.005, {
    rx: Math.PI / 2,
    sy: 0.72,
  });
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI * 2) / 10;
    b.sphere(
      parts.torsoPivot,
      0.038,
      6,
      i % 2 === 0 ? ruffMat : ruffShadowMat,
      Math.cos(a) * 0.142,
      0.366 + (i % 2 === 0 ? 0.006 : -0.004),
      Math.sin(a) * 0.142 + 0.005,
      { sy: 0.65 },
    );
  }

  // Plum velvet doublet front gold piping, buttons & puffed Tudor shoulder rolls
  b.box(parts.torsoPivot, 0.022, 0.30, 0.018, goldMat, 0, 0.175, 0.132);
  for (const by of [0.09, 0.16, 0.23, 0.29]) {
    b.sphere(parts.torsoPivot, 0.012, 6, goldMat, 0, by, 0.143);
  }
  b.sphere(parts.leftArmPivot, 0.068, 8, velvetTrimMat, 0, -0.025, 0, { sx: 1.05, sy: 0.92 });
  b.sphere(parts.rightArmPivot, 0.068, 8, velvetTrimMat, 0, -0.025, 0, { sx: 1.05, sy: 0.92 });
  // Puffy Tudor breeches on upper legs
  b.sphere(parts.leftLegPivot, 0.072, 8, b.mat('#46293E', 0.82), 0, -0.075, 0, { sy: 1.25 });
  b.sphere(parts.rightLegPivot, 0.072, 8, b.mat('#46293E', 0.82), 0, -0.075, 0, { sy: 1.25 });

  // Feathered white quill pen held upright in right hand!
  const quillGroup = new THREE.Group();
  quillGroup.position.set(0.01, 0.01, 0.02);
  quillGroup.rotation.set(0.35, 0, -0.25);
  parts.rightHandAnchor.add(quillGroup);
  b.cyl(quillGroup, 0.006, 0.003, 0.24, 6, goldMat, 0, 0.09, 0);
  b.cone(quillGroup, 0.036, 0.19, 5, quillMat, 0.008, 0.21, -0.005, {
    rz: -0.18,
    sz: 0.28,
  });
  parts.quillProp = quillGroup;

  return createHumanoidRigController(b, parts, {
    id: 'shakespeare',
    baseBubbleHeight: 1.68,
    baseScale: 1.09,
  });
}

/* ============================================================================
 * 6. SOCRATES THE PHILOSOPHER (`philosopher`)
 * ============================================================================ */

function buildPhilosopherRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'philosopher', {
    skin: '#E5BE9E',
    pants: '#EFE7D8', // cream Greek chiton/toga skirt
    lowerLeg: '#E5BE9E',
    shoe: '#8D6242', // leather Greek sandals
    sole: '#6B482F',
    torso: '#F3ECE0',
    sleeve: '#E5BE9E', // bare right shoulder/arm classically draped!
    forearm: '#E5BE9E',
    browColor: '#EAE6DF',
    hideMouth: true, // sculpted underneath lush Greek beard
  });

  const togaMat = b.mat('#F3ECE0', 0.88);
  const togaFoldMat = b.mat('#E4DAC8', 0.9);
  const goldTrimMat = b.mat('#D5B062', 0.42, 0.4);
  const hairWhiteMat = b.mat('#EEEAE2', 0.86);
  const hairSilverMat = b.mat('#DAD6CE', 0.86);
  const leatherMat = b.mat('#8D6242', 0.78);

  // Draped cream Greek toga wrap over left shoulder + diagonal fold across chest + gold key border!
  b.rod(parts.torsoPivot, -0.145, 0.33, 0.085, 0.125, 0.04, 0.132, 0.044, 0.048, 7, togaFoldMat);
  b.rod(parts.torsoPivot, -0.145, 0.33, -0.075, 0.125, 0.04, -0.118, 0.044, 0.048, 7, togaFoldMat);
  // Left shoulder draped sleeve fold + gleaming golden Greek fibula clasp
  b.sphere(parts.leftArmPivot, 0.062, 8, togaMat, 0.01, -0.02, 0, { sx: 1.12, sy: 1.05 });
  b.cyl(parts.torsoPivot, 0.024, 0.024, 0.012, 8, goldTrimMat, -0.132, 0.335, 0.078, {
    rx: Math.PI / 2 - 0.25,
  });
  // Flowing lower toga drape with golden hem stripe
  b.cyl(parts.bodyPivot, 0.145, 0.192, 0.25, 10, togaMat, 0, 0.335, 0, { sx: 1.05, sz: 0.94 });
  b.torus(parts.bodyPivot, 0.186, 0.012, 5, 14, goldTrimMat, 0, 0.222, 0, { rx: Math.PI / 2 });
  // Leather Greek sandal ankle straps
  b.torus(parts.leftKneePivot, 0.043, 0.008, 5, 10, leatherMat, 0, -0.135, 0, { rx: Math.PI / 2 });
  b.torus(parts.rightKneePivot, 0.043, 0.008, 5, 10, leatherMat, 0, -0.135, 0, { rx: Math.PI / 2 });

  // Thoughtful creased philosopher brow & bushy white eyebrows (crisp in 3D PFP!)
  const browCreaseMat = b.mat('#C89D7D', 0.85);
  b.box(parts.headPivot, 0.088, 0.009, 0.012, browCreaseMat, 0, 0.238, 0.162);
  b.box(parts.headPivot, 0.072, 0.008, 0.012, browCreaseMat, 0, 0.258, 0.156);
  b.box(parts.headPivot, 0.064, 0.022, 0.024, hairWhiteMat, -0.056, 0.205, 0.162, { rz: 0.1 });
  b.box(parts.headPivot, 0.064, 0.022, 0.024, hairWhiteMat, 0.056, 0.205, 0.162, { rz: -0.1 });

  // Classic receding curly white philosopher hair ring + majestic curly white beard!
  for (const [hx, hy, hz, hr] of [
    [-0.148, 0.205, -0.02, 0.056],
    [0.148, 0.205, -0.02, 0.056],
    [-0.125, 0.165, -0.115, 0.064],
    [0.125, 0.165, -0.115, 0.064],
    [0, 0.175, -0.148, 0.072],
    [0, 0.235, -0.11, 0.062],
  ] as const) {
    b.sphere(parts.headPivot, hr, 7, hairSilverMat, hx, hy, hz);
  }
  // Majestic curly white beard cascading over chin
  b.sphere(parts.headPivot, 0.105, 8, hairWhiteMat, 0, 0.075, 0.116, {
    sx: 1.24,
    sy: 0.92,
    sz: 0.72,
  });
  b.sphere(parts.headPivot, 0.078, 7, hairWhiteMat, 0, 0.008, 0.126, {
    sx: 1.05,
    sy: 1.05,
    sz: 0.68,
  });
  b.sphere(parts.headPivot, 0.054, 6, hairSilverMat, -0.068, 0.045, 0.115);
  b.sphere(parts.headPivot, 0.054, 6, hairSilverMat, 0.068, 0.045, 0.115);
  // Thick thoughtful white mustache
  b.box(parts.headPivot, 0.135, 0.028, 0.036, hairWhiteMat, 0, 0.115, 0.158);

  return createHumanoidRigController(b, parts, {
    id: 'philosopher',
    baseBubbleHeight: 1.68,
    baseScale: 1.09,
    defaultBrowTilt: 0.08,
  });
}

/* ============================================================================
 * 7. JOHN WICK (`john_wick`)
 * ============================================================================ */

function buildJohnWickRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'john_wick', {
    skin: '#EED2BE',
    pants: '#1A1C21',
    shoe: '#131418',
    sole: '#22242C',
    torso: '#1B1D22', // jet-black tailored Continental suit
    sleeve: '#1B1D22',
    forearm: '#1B1D22',
    browColor: '#1E1F26',
  });

  const shirtMat = b.mat('#F7F7FA', 0.78);
  const lapelMat = b.mat('#262932', 0.68);
  const tieMat = b.mat('#121318', 0.42);
  const silverMat = b.mat('#D0D5DE', 0.25, 0.75);
  const hairMat = b.mat('#1D1E24', 0.74);
  const beardMat = b.mat('#25262E', 0.82);

  // Tailored black suit details: crisp white collar points, V-shirt front, sleek black tie + silver tie bar, notched lapels!
  b.box(parts.torsoPivot, 0.105, 0.195, 0.016, shirtMat, 0, 0.248, 0.128);
  b.box(parts.torsoPivot, 0.056, 0.042, 0.018, shirtMat, -0.044, 0.338, 0.122, { rz: 0.38 });
  b.box(parts.torsoPivot, 0.056, 0.042, 0.018, shirtMat, 0.044, 0.338, 0.122, { rz: -0.38 });
  b.box(parts.torsoPivot, 0.028, 0.175, 0.012, tieMat, 0, 0.232, 0.141);
  b.box(parts.torsoPivot, 0.036, 0.009, 0.008, silverMat, 0, 0.228, 0.151);
  // Crisp suit lapels
  b.box(parts.torsoPivot, 0.044, 0.21, 0.018, lapelMat, -0.064, 0.235, 0.132, { rz: -0.18 });
  b.box(parts.torsoPivot, 0.044, 0.21, 0.018, lapelMat, 0.064, 0.235, 0.132, { rz: 0.18 });
  // Lower suit jacket hem
  b.cyl(parts.torsoPivot, 0.146, 0.156, 0.12, 10, b.mat('#1B1D22', 0.74), 0, 0.015, 0, {
    sx: 1.05,
    sz: 0.88,
  });
  // Crisp white shirt cuffs peeking from suit sleeves
  b.cyl(parts.leftElbowPivot, 0.034, 0.034, 0.022, 8, shirtMat, 0, -0.136, 0);
  b.cyl(parts.rightElbowPivot, 0.034, 0.034, 0.022, 8, shirtMat, 0, -0.136, 0);

  // Sleek shoulder-length dark parted hair sweeping smoothly past jaw & behind neck!
  b.sphere(parts.headPivot, 0.168, 11, hairMat, 0, 0.202, -0.018, {
    sx: 1.04,
    sy: 0.88,
    sz: 1.02,
  });
  // Long sleek side curtain locks framing jaw
  b.box(parts.headPivot, 0.046, 0.255, 0.132, hairMat, -0.156, 0.105, -0.012, { rz: 0.06 });
  b.box(parts.headPivot, 0.046, 0.255, 0.132, hairMat, 0.156, 0.105, -0.012, { rz: -0.06 });
  // Swept center-parted front bangs
  b.box(parts.headPivot, 0.095, 0.048, 0.052, hairMat, -0.062, 0.268, 0.114, { rx: 0.22, rz: 0.22 });
  b.box(parts.headPivot, 0.095, 0.048, 0.052, hairMat, 0.062, 0.268, 0.114, { rx: 0.22, rz: -0.22 });
  // Back curtain hair down to collar
  b.box(parts.headPivot, 0.265, 0.265, 0.075, hairMat, 0, 0.10, -0.142);

  // Tidy sculpted dark beard & mustache
  b.sphere(parts.headPivot, 0.095, 8, beardMat, 0, 0.088, 0.092, {
    sx: 1.28,
    sy: 0.72,
    sz: 0.78,
  });
  b.box(parts.headPivot, 0.092, 0.016, 0.016, beardMat, 0, 0.122, 0.158);

  return createHumanoidRigController(b, parts, {
    id: 'john_wick',
    baseBubbleHeight: 1.70,
    baseScale: 1.08,
    defaultBrowTilt: -0.1,
  });
}

/* ============================================================================
 * 8. ROCKY THE ERIDIAN (`rocky` — Project Hail Mary)
 * Pentagonal dark rocky carapace (NO eyes!), metallic tan Eridian tool belt,
 * 5 articulated 2-segment rocky legs at 72° intervals with joyful scurry + jazz hands!
 * ============================================================================ */

function buildRockyRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const root = new THREE.Group();
  root.name = 'Special_rocky';

  const shadowMesh = b.addGroundShadow(root, 0.34);

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const rockDarkMat = b.mat('#47433F', 0.92, 0.08); // heavy dark basalt grey
  const rockBrownMat = b.mat('#6E5B4B', 0.9, 0.1); // warm mineral umber-brown
  const rockHematiteMat = b.mat('#8A5342', 0.88, 0.14); // subtle rust-hematite rock facets!
  const rockFacetMat = b.mat('#746B62', 0.88, 0.12);
  const shirtMat = b.mat('#5F6B50', 0.86, 0.04); // Ryland Grace's custom greenish-brown 5-armhole cloth shirt!
  const shirtHemMat = b.mat('#4C573F', 0.88, 0.04);
  const toolMetalMat = b.mat('#C6A778', 0.38, 0.45);

  // Elevated heavy pentagonal mineral-rock carapace (legs support it cleanly at y = 0.44!)
  const carapaceGroup = new THREE.Group();
  carapaceGroup.position.set(0, 0.44, 0);
  bodyPivot.add(carapaceGroup);

  // Core 5-sided stone carapace body (STRICTLY ZERO EYES, ZERO FACE — Eridians use sonar!)
  b.cyl(carapaceGroup, 0.245, 0.278, 0.165, 5, rockDarkMat, 0, 0, 0);
  // Layered mineral-rock dorsal dome (dark grey, umber brown & rust hematite rock plates!)
  b.cyl(carapaceGroup, 0.145, 0.24, 0.125, 5, rockBrownMat, 0, 0.142, 0);
  b.cyl(carapaceGroup, 0.165, 0.248, 0.068, 5, rockDarkMat, 0, -0.108, 0);

  // Sculpted jagged multi-mineral basalt/umber/hematite facets around dorsal crown
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + Math.PI / 5;
    const facetMat =
      i === 0 || i === 3 ? rockHematiteMat : i % 2 === 0 ? rockFacetMat : rockBrownMat;
    b.sphere(
      carapaceGroup,
      0.072,
      5,
      facetMat,
      Math.cos(a) * 0.158,
      0.142,
      Math.sin(a) * 0.158,
      { sx: 1.28, sy: 0.68, sz: 0.96, ry: -a },
    );
  }
  // Central radiator vent ridge on top of carapace
  b.cyl(carapaceGroup, 0.084, 0.108, 0.048, 5, rockFacetMat, 0, 0.222, 0);
  b.cyl(carapaceGroup, 0.052, 0.068, 0.025, 5, rockHematiteMat, 0, 0.252, 0);

  // Ryland Grace's custom greenish-brown 5-armhole cloth shirt (#5F6B50) wrapped cleanly around mid-carapace!
  b.cyl(carapaceGroup, 0.262, 0.286, 0.132, 5, shirtMat, 0, -0.008, 0);
  b.torus(carapaceGroup, 0.258, 0.02, 5, 5, shirtHemMat, 0, 0.058, 0, { rx: Math.PI / 2 });
  b.torus(carapaceGroup, 0.282, 0.02, 5, 5, shirtHemMat, 0, -0.072, 0, { rx: Math.PI / 2 });
  // Small woven utility pocket & xenonite clasp pinned onto shirt front
  b.box(carapaceGroup, 0.076, 0.068, 0.026, shirtHemMat, 0, 0.005, 0.268);
  b.box(carapaceGroup, 0.042, 0.018, 0.014, toolMetalMat, 0, 0.026, 0.284);

  // 5 Articulated 2-segment rocky legs radiating cleanly at 72° intervals (through 5 cloth armhole cuffs!)
  // Leg 0 (+36°) and Leg 4 (-36°) face forward (+Z) for "JAZZ HANDS" waving!
  interface RockyLeg {
    angle: number;
    hipPivot: THREE.Group;
    kneePivot: THREE.Group;
    isFront: boolean;
  }
  const legs: RockyLeg[] = [];
  const legAngles = [
    Math.PI * 0.2, // Front-right (+36°)
    Math.PI * 0.6, // Mid-right (+108°)
    Math.PI, // Rear (180°)
    -Math.PI * 0.6, // Mid-left (-108°)
    -Math.PI * 0.2, // Front-left (-36°)
  ];

  for (let i = 0; i < 5; i++) {
    const angle = legAngles[i];
    const isFront = i === 0 || i === 4;

    const legRoot = new THREE.Group();
    legRoot.rotation.y = angle;
    carapaceGroup.add(legRoot);

    // Cloth armhole cuff sleeve framing each leg socket on the 5-armhole shirt!
    b.torus(legRoot, 0.056, 0.016, 5, 8, shirtHemMat, 0, -0.02, 0.238);

    // Hip mounted on outer carapace edge (local +Z points radially outward!)
    const hipPivot = new THREE.Group();
    hipPivot.position.set(0, -0.02, 0.225);
    legRoot.add(hipPivot);

    b.sphere(hipPivot, 0.048, 6, rockDarkMat, 0, 0, 0);
    // Upper rocky femur angling slightly up-and-outward to knee at (0, +0.08, +0.21)
    b.rod(hipPivot, 0, 0, 0, 0, 0.08, 0.21, 0.036, 0.045, 6, i % 2 === 0 ? rockBrownMat : rockDarkMat);

    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, 0.08, 0.21);
    hipPivot.add(kneePivot);

    b.sphere(kneePivot, 0.045, 6, rockHematiteMat, 0, 0, 0);
    // Lower rocky tibia descending from knee down to 3-fingered rocky hand/claw resting at y = 0.000!
    b.rod(kneePivot, 0, 0, 0, 0, -0.47, 0.07, 0.024, 0.036, 6, rockDarkMat);
    // Wrist knuckle + 3 distinct small triangular rock fingers/claws (visible during jazz hands!)
    b.sphere(kneePivot, 0.032, 6, rockFacetMat, 0, -0.478, 0.07, { sy: 0.62, sz: 1.15 });
    for (const [cx, cry] of [
      [-0.028, 0.36],
      [0, 0],
      [0.028, -0.36],
    ] as const) {
      b.cone(kneePivot, 0.014, 0.056, 3, rockBrownMat, cx, -0.486, 0.114, {
        rx: Math.PI / 2,
        ry: cry,
      });
    }

    legs.push({ angle, hipPivot, kneePivot, isFront });
  }

  let pose: SpecialPose = 'idle';
  let levitateHeight = 0;
  let animPhase = Math.random() * Math.PI * 2;

  const rig: SpecialCharacterRig = {
    root,
    bubbleHeight: 1.22,

    setPose(nextPose: SpecialPose): void {
      pose = nextPose;
    },

    setMood(_mood: VisitorMood): void {
      // Eridian mood shines through joyful carapace tilt & jazz hands!
    },

    update(
      dt: number,
      elapsed: number,
      moveSpeed: number,
      isBlabbering = false,
      seatY?: number,
    ): void {
      const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      const speed = Number.isFinite(moveSpeed) && moveSpeed > 0 ? moveSpeed : 1.7;

      const targetLev = pose === 'levitate' ? 1.65 : 0;
      levitateHeight = damp(levitateHeight, targetLev, 5.0, safeDt);

      const isSeatPose = pose === 'sit' || pose === 'thinker' || pose === 'sleep';
      const targetWorldSeatY =
        isSeatPose && seatY !== undefined && seatY > 0.08
          ? seatY
          : isSeatPose && root.position.y > 0.08
            ? root.position.y
            : 0;
      const isSeatedElevated = isSeatPose && targetWorldSeatY > 0.08;
      const localSeatBase = isSeatedElevated ? targetWorldSeatY - root.position.y : 0;

      shadowMesh.visible = !isSeatedElevated && levitateHeight < 0.15 && pose !== 'ragdoll';
      rig.bubbleHeight = 1.22 + levitateHeight;

      bodyPivot.rotation.set(0, 0, 0);
      carapaceGroup.rotation.set(0, 0, 0);
      const talkBob = isBlabbering ? Math.sin(safeElapsed * 16) * 0.024 : 0;

      switch (pose) {
        case 'walk': {
          // Joyful alternating pentapod spider scurry!
          animPhase += safeDt * speed * 11.5;
          const phaseOffsets = [0, Math.PI, 0.4 * Math.PI, 1.4 * Math.PI, 0.8 * Math.PI];
          bodyPivot.position.y = Math.abs(Math.sin(animPhase)) * 0.032 + talkBob;
          carapaceGroup.rotation.set(
            Math.sin(animPhase) * 0.05,
            0,
            Math.cos(animPhase) * 0.06,
          );
          for (let i = 0; i < 5; i++) {
            const p = animPhase + phaseOffsets[i];
            const lift = Math.max(0, Math.sin(p));
            const sweep = Math.cos(p);
            legs[i].hipPivot.rotation.set(-lift * 0.44, sweep * 0.28, 0);
            legs[i].kneePivot.rotation.set(lift * 0.34, 0, 0);
          }
          break;
        }

        case 'admire':
        case 'dance':
        case 'pet':
        case 'squeak': {
          // Iconic happy Eridian "JAZZ HANDS!" front-leg wave!
          const jazz = Math.sin(safeElapsed * 14);
          const bounce = Math.abs(Math.sin(safeElapsed * 6.5)) * 0.045;
          bodyPivot.position.y = bounce + talkBob;
          carapaceGroup.rotation.set(-0.24, Math.sin(safeElapsed * 3.2) * 0.12, 0);
          for (let i = 0; i < 5; i++) {
            if (legs[i].isFront) {
              // Both front legs raised high waving enthusiastically!
              const sign = i === 0 ? 1 : -1;
              legs[i].hipPivot.rotation.set(-1.35 + jazz * 0.18 * sign, jazz * 0.38 * sign, 0);
              legs[i].kneePivot.rotation.set(-0.82 + jazz * 0.25, 0, 0);
            } else {
              // Rear 3 legs braced steadily supporting excited tilt!
              legs[i].hipPivot.rotation.set(0.12, 0, 0);
              legs[i].kneePivot.rotation.set(-0.1, 0, 0);
            }
          }
          break;
        }

        case 'sit':
        case 'thinker':
        case 'sleep': {
          const restY = isSeatedElevated ? localSeatBase - 0.18 : -0.16;
          bodyPivot.position.y = restY + Math.sin(safeElapsed * 1.8) * 0.008;
          for (let i = 0; i < 5; i++) {
            legs[i].hipPivot.rotation.set(-0.52, 0, 0);
            legs[i].kneePivot.rotation.set(0.58, 0, 0);
          }
          break;
        }

        case 'ragdoll': {
          const spin = safeElapsed * 11;
          bodyPivot.position.y = 0.36 + Math.abs(Math.sin(spin * 0.5)) * 0.15;
          bodyPivot.rotation.set(Math.PI + Math.sin(spin) * 0.4, spin * 0.5, Math.cos(spin) * 0.5);
          for (let i = 0; i < 5; i++) {
            legs[i].hipPivot.rotation.set(-0.8 + Math.sin(spin + i) * 0.45, 0, 0);
            legs[i].kneePivot.rotation.set(-0.4, 0, 0);
          }
          break;
        }

        case 'levitate': {
          bodyPivot.position.y = levitateHeight + Math.sin(safeElapsed * 2.1) * 0.08;
          carapaceGroup.rotation.y = Math.sin(safeElapsed * 0.8) * 0.25;
          for (let i = 0; i < 5; i++) {
            legs[i].hipPivot.rotation.set(0.32 + Math.sin(safeElapsed * 2 + i) * 0.12, 0, 0);
            legs[i].kneePivot.rotation.set(-0.18, 0, 0);
          }
          break;
        }

        default: {
          // Idle / stumble / stare / eat / kick
          const breathe = Math.sin(safeElapsed * 2.4) * 0.014;
          bodyPivot.position.y = breathe + talkBob + levitateHeight;
          carapaceGroup.rotation.set(0, Math.sin(safeElapsed * 1.2) * 0.1, 0);
          for (let i = 0; i < 5; i++) {
            const tap = i === 0 ? Math.max(0, Math.sin(safeElapsed * 4.5)) * 0.12 : 0;
            legs[i].hipPivot.rotation.set(-tap, 0, 0);
            legs[i].kneePivot.rotation.set(tap * 0.8, 0, 0);
          }
          break;
        }
      }
    },

    dispose(): void {
      b.dispose();
    },
  };

  return rig;
}

/* ============================================================================
 * 9. HOMER SIMPSON (`homer`)
 * ============================================================================ */

function buildHomerRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'homer', {
    skin: '#FFD93D', // iconic bright yellow skin!
    pants: '#4E7CC2', // classic blue pants
    shoe: '#343840',
    sole: '#22252C',
    torso: '#F7F6F2', // crisp white polo shirt
    sleeve: '#F7F6F2',
    forearm: '#FFD93D', // short-sleeve yellow forearms!
    bellyScale: 1.18, // cozy Homer belly!
    headScaleY: 1.14, // iconic taller bald Simpson cranium!
    eyeWhite: true,
    mouthColor: '#693B2C',
  });

  const blackMat = b.mat('#1D1D22', 0.65);
  const muzzleMat = b.mat('#D9B382', 0.86);
  const poloCollarMat = b.mat('#ECEAE3', 0.82);
  const yellowMat = b.mat('#FFD93D', 0.82);

  // Iconic tan circular beard stubble muzzle wrapping lower jaw!
  b.sphere(parts.headPivot, 0.106, 10, muzzleMat, 0, 0.105, 0.095, {
    sx: 1.08,
    sy: 0.78,
    sz: 0.88,
  });
  // Shift mouth slightly proud of muzzle front!
  parts.mouthMesh.position.set(0, 0.095, 0.192);

  // Sleepy yellow upper eyelids over cartoon white eyes
  b.box(parts.headPivot, 0.072, 0.022, 0.032, yellowMat, -0.046, 0.228, 0.165, { rx: 0.18 });
  b.box(parts.headPivot, 0.072, 0.022, 0.032, yellowMat, 0.046, 0.228, 0.165, { rx: 0.18 });
  // Plump yellow cartoon nose sitting cleanly above muzzle
  b.sphere(parts.headPivot, 0.028, 7, yellowMat, 0, 0.162, 0.188, { sx: 0.9, sy: 0.85, sz: 1.25 });

  // THE TWO ICONIC CURVED BLACK TOP HAIRS on bald yellow dome (bold enough to read crisply in 3D PFPs!)
  b.torus(parts.headPivot, 0.06, 0.011, 6, 12, blackMat, 0, 0.354, 0.024, {
    arc: Math.PI,
    ry: Math.PI / 2,
  });
  b.torus(parts.headPivot, 0.06, 0.011, 6, 12, blackMat, 0, 0.354, -0.034, {
    arc: Math.PI,
    ry: Math.PI / 2,
  });

  // ICONIC ZIG-ZAG "M" SIDE HAIRS over both ears!
  for (const side of [-1, 1]) {
    const sx = side * 0.165;
    b.rod(parts.headPivot, sx, 0.212, 0.032, sx, 0.268, 0.008, 0.0085, 0.0085, 5, blackMat);
    b.rod(parts.headPivot, sx, 0.268, 0.008, sx, 0.215, -0.018, 0.0085, 0.0085, 5, blackMat);
    b.rod(parts.headPivot, sx, 0.215, -0.018, sx, 0.265, -0.044, 0.0085, 0.0085, 5, blackMat);
    b.rod(parts.headPivot, sx, 0.265, -0.044, sx, 0.210, -0.068, 0.0085, 0.0085, 5, blackMat);
  }

  // Folded white polo shirt V-collar flaps
  b.box(parts.torsoPivot, 0.068, 0.045, 0.028, poloCollarMat, -0.052, 0.335, 0.125, {
    rz: 0.35,
    rx: -0.18,
  });
  b.box(parts.torsoPivot, 0.068, 0.045, 0.028, poloCollarMat, 0.052, 0.335, 0.125, {
    rz: -0.35,
    rx: -0.18,
  });

  // Pink-frosted sprinkled donut held in right hand!
  const donutGroup = new THREE.Group();
  donutGroup.position.set(0, -0.01, 0.038);
  donutGroup.rotation.x = Math.PI / 3;
  parts.rightHandAnchor.add(donutGroup);
  b.torus(donutGroup, 0.044, 0.019, 7, 12, b.mat('#E6B67A', 0.8), 0, 0, 0);
  b.torus(donutGroup, 0.044, 0.016, 6, 12, b.mat('#F58FB3', 0.45), 0, 0, 0.009);
  b.box(donutGroup, 0.014, 0.006, 0.008, b.mat('#FFF394', 0.4), 0.032, 0.022, 0.025, { rz: 0.5 });
  b.box(donutGroup, 0.014, 0.006, 0.008, b.mat('#7ED8F7', 0.4), -0.034, 0.014, 0.025, { rz: -0.4 });
  b.box(donutGroup, 0.014, 0.006, 0.008, b.mat('#9AF09A', 0.4), 0.008, -0.038, 0.025, { rz: 0.2 });
  parts.donutProp = donutGroup;

  return createHumanoidRigController(b, parts, {
    id: 'homer',
    baseBubbleHeight: 1.72,
  });
}

/* ============================================================================
 * 10. RICK SANCHEZ (`rick`)
 * ============================================================================ */

function buildRickRig(): SpecialCharacterRig {
  const b = new RigBuilder();
  const parts = buildHumanoidSkeleton(b, 'rick', {
    skin: '#EBD3C1',
    pants: '#7A5B47', // chestnut-brown pants
    shoe: '#2B2D34',
    sole: '#1D1E24',
    torso: '#B6E5EE', // pale cyan inner shirt
    sleeve: '#F5F7FA', // white lab coat sleeves!
    forearm: '#F5F7FA',
    headScaleY: 1.08,
    eyeWhite: true,
    mouthColor: '#5C443B',
  });

  const hairMat = b.mat('#9ED5F0', 0.72);
  const hairShadeMat = b.mat('#82BFE0', 0.74);
  const coatMat = b.mat('#F5F7FA', 0.78);
  const beltMat = b.mat('#4A3528', 0.74);
  const buckleMat = b.mat('#DFC05B', 0.35, 0.52);
  const gunWhiteMat = b.mat('#E6ECF2', 0.45, 0.15);
  const gunDarkMat = b.mat('#2A2D36', 0.55, 0.25);
  const portalGlowMat = b.mat('#8CFF5C', 0.15, 0.05, '#39FF14', 1.65);

  // Iconic thick pale sky-blue UNIBROW straight across forehead + scientist drool & subtle eye bags!
  b.box(parts.headPivot, 0.174, 0.025, 0.024, hairShadeMat, 0, 0.238, 0.158);
  b.box(parts.headPivot, 0.058, 0.008, 0.012, b.mat('#C9B0A0', 0.8), -0.046, 0.145, 0.162);
  b.box(parts.headPivot, 0.058, 0.008, 0.012, b.mat('#C9B0A0', 0.8), 0.046, 0.145, 0.162);
  b.sphere(parts.headPivot, 0.013, 6, b.mat('#A8E69A', 0.4), 0.028, 0.098, 0.166, { sy: 1.4 });

  // Iconic spiky radial pale sky-blue Rick hair (7 unmistakable star-spikes around cranium!)
  b.sphere(parts.headPivot, 0.162, 10, hairShadeMat, 0, 0.215, -0.042, {
    sx: 1.04,
    sy: 0.9,
    sz: 0.92,
  });
  const rickSpikes: Array<[number, number, number, number, number, number, number, boolean]> = [
    [0, 0.39, -0.02, 0.068, 0.20, -0.15, 0, true],
    [-0.125, 0.355, -0.02, 0.064, 0.19, -0.12, 0.55, true],
    [0.125, 0.355, -0.02, 0.064, 0.19, -0.12, -0.55, true],
    [-0.195, 0.245, -0.03, 0.060, 0.18, -0.1, 1.15, false],
    [0.195, 0.245, -0.03, 0.060, 0.18, -0.1, -1.15, false],
    [-0.165, 0.125, -0.05, 0.054, 0.155, -0.18, 1.72, false],
    [0.165, 0.125, -0.05, 0.054, 0.155, -0.18, -1.72, false],
    [0, 0.255, -0.185, 0.072, 0.19, -1.15, 0, false],
  ];
  for (const [x, y, z, r, h, rx, rz, bright] of rickSpikes) {
    b.cone(parts.headPivot, r, h, 5, bright ? hairMat : hairShadeMat, x, y, z, { rx, rz });
  }

  // Open white lab coat (left/right front flaps leaving pale cyan shirt visible + long coat tails!)
  b.box(parts.torsoPivot, 0.088, 0.44, 0.165, coatMat, -0.128, 0.125, -0.01);
  b.box(parts.torsoPivot, 0.088, 0.44, 0.165, coatMat, 0.128, 0.125, -0.01);
  b.box(parts.torsoPivot, 0.32, 0.46, 0.055, coatMat, 0, 0.12, -0.118);
  // Crisp upturned lab coat lapels
  b.box(parts.torsoPivot, 0.048, 0.14, 0.022, coatMat, -0.082, 0.285, 0.132, { rz: -0.22 });
  b.box(parts.torsoPivot, 0.048, 0.14, 0.022, coatMat, 0.082, 0.285, 0.132, { rz: 0.22 });
  // Dark brown belt + golden buckle
  b.box(parts.torsoPivot, 0.21, 0.04, 0.032, beltMat, 0, 0.03, 0.122);
  b.box(parts.torsoPivot, 0.054, 0.046, 0.022, buckleMat, 0, 0.03, 0.136);

  // Iconic GLOWING GREEN PORTAL GUN held in right hand!
  const gunGroup = new THREE.Group();
  gunGroup.position.set(0, -0.015, 0.045);
  gunGroup.rotation.x = Math.PI / 2;
  parts.rightHandAnchor.add(gunGroup);

  // Grip + white futuristic chassis + red dimension dial
  b.box(gunGroup, 0.034, 0.085, 0.038, gunDarkMat, 0, -0.035, 0.01, { rx: 0.25 });
  b.box(gunGroup, 0.054, 0.048, 0.145, gunWhiteMat, 0, 0.018, 0.052);
  b.cyl(gunGroup, 0.014, 0.014, 0.012, 8, b.mat('#E84B3C', 0.4), 0, 0.022, -0.022, { rx: Math.PI / 2 });
  // Glowing neon-green portal fluid dome bulb mounted on top!
  b.cyl(gunGroup, 0.024, 0.024, 0.058, 9, portalGlowMat, 0, 0.062, 0.048, { castShadow: false });
  b.sphere(gunGroup, 0.024, 8, portalGlowMat, 0, 0.09, 0.048, { castShadow: false });
  // 3 glowing green front emitter prongs
  for (const [ex, ey] of [
    [0, 0.034],
    [-0.018, 0.008],
    [0.018, 0.008],
  ] as const) {
    b.sphere(gunGroup, 0.011, 6, portalGlowMat, ex, ey, 0.13, { castShadow: false });
  }
  parts.portalGunProp = gunGroup;

  return createHumanoidRigController(b, parts, {
    id: 'rick',
    baseBubbleHeight: 1.74,
    baseScale: 1.04,
  });
}

/* ============================================================================
 * FACTORY DISPATCH
 * ============================================================================ */

export function createSpecialCharacterRig(visitorId: string): SpecialCharacterRig | null {
  switch (visitorId) {
    case 'viking':
      return buildVikingRig();
    case 'squeaky_chicken':
      return buildSqueakyChickenRig();
    case 'gojo':
      return buildGojoRig();
    case 'baki':
      return buildBakiRig();
    case 'shakespeare':
      return buildShakespeareRig();
    case 'philosopher':
      return buildPhilosopherRig();
    case 'john_wick':
      return buildJohnWickRig();
    case 'rocky':
      return buildRockyRig();
    case 'homer':
      return buildHomerRig();
    case 'rick':
      return buildRickRig();
    default:
      return null;
  }
}

/* ============================================================================
 * SWIRLING NEON-GREEN DIMENSIONAL PORTAL (`createGreenPortalMesh`)
 * Iconic Rick & Morty vertical swirling neon-green oval vortex (~1.85 tall)
 * ============================================================================ */

export function createGreenPortalMesh(): {
  group: THREE.Group;
  update(dt: number, elapsed: number, openFactor: number): void;
  dispose(): void;
} {
  const b = new RigBuilder();
  const group = new THREE.Group();
  group.name = 'GreenPortal';

  // Vertical oval frame centered at y = 0.96 (spans y = ~0.04 to ~1.88, height ~1.84!)
  const portalCenter = new THREE.Group();
  portalCenter.position.set(0, 0.96, 0);
  portalCenter.scale.set(0.68, 1.0, 1.0); // classic vertical oval proportion (~1.26 wide × 1.84 tall)
  group.add(portalCenter);

  const deepGreenMat = b.mat('#145E1A', 0.35, 0.05, '#0F4D14', 0.85);
  const neonGreenMat = b.mat('#39FF14', 0.2, 0.05, '#32EE10', 1.45);
  const limeMat = b.mat('#A8FF3E', 0.18, 0.05, '#96F52E', 1.55);
  const coreMat = b.mat('#E6FF8C', 0.15, 0.05, '#C8FF5C', 1.7);

  // Outer bumpy emerald portal rim
  const outerRingGroup = new THREE.Group();
  portalCenter.add(outerRingGroup);
  b.torus(outerRingGroup, 0.80, 0.064, 8, 24, deepGreenMat, 0, 0, 0, { castShadow: false });
  const rimBlobs: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI * 2) / 10;
    const blob = b.sphere(
      outerRingGroup,
      0.078 + (i % 2) * 0.022,
      6,
      i % 2 === 0 ? neonGreenMat : deepGreenMat,
      Math.cos(a) * 0.80,
      Math.sin(a) * 0.80,
      0,
      { sz: 0.45, castShadow: false },
    );
    rimBlobs.push(blob);
  }

  // Mid swirling neon-green vortex layer
  const midRingGroup = new THREE.Group();
  portalCenter.add(midRingGroup);
  b.cyl(midRingGroup, 0.80, 0.80, 0.022, 22, deepGreenMat, 0, 0, 0, {
    rx: Math.PI / 2,
    castShadow: false,
  });
  b.torus(midRingGroup, 0.68, 0.062, 7, 20, neonGreenMat, 0, 0, 0.018, { castShadow: false });
  b.torus(midRingGroup, 0.68, 0.062, 7, 20, neonGreenMat, 0, 0, -0.018, { castShadow: false });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    b.torus(midRingGroup, 0.46, 0.044, 6, 12, limeMat, Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.026, {
      arc: Math.PI * 0.72,
      rz: a,
      castShadow: false,
    });
    b.torus(midRingGroup, 0.46, 0.044, 6, 12, limeMat, Math.cos(a) * 0.16, Math.sin(a) * 0.16, -0.026, {
      arc: Math.PI * 0.72,
      rz: a,
      castShadow: false,
    });
  }

  // Inner rapid counter-rotating bright acid-lime & yellow-green core
  const innerGroup = new THREE.Group();
  portalCenter.add(innerGroup);
  b.torus(innerGroup, 0.34, 0.052, 7, 16, limeMat, 0, 0, 0.032, { castShadow: false });
  b.torus(innerGroup, 0.34, 0.052, 7, 16, limeMat, 0, 0, -0.032, { castShadow: false });
  b.cyl(innerGroup, 0.25, 0.25, 0.055, 14, coreMat, 0, 0, 0, {
    rx: Math.PI / 2,
    castShadow: false,
  });

  // Floating bubbling neon portal droplets around vortex edge
  const droplets: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const drop = b.sphere(
      portalCenter,
      0.038,
      6,
      i % 2 === 0 ? limeMat : neonGreenMat,
      Math.cos(a) * 0.96,
      Math.sin(a) * 0.96,
      (i % 2 === 0 ? 1 : -1) * 0.06,
      { castShadow: false },
    );
    droplets.push(drop);
  }

  return {
    group,

    update(dt: number, elapsed: number, openFactor: number): void {
      const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
      const clamped = clamp(Number.isFinite(openFactor) ? openFactor : 0, 0, 1.15);

      group.visible = clamped > 0.004;
      if (!group.visible) return;

      const s = Math.max(0.005, clamped);
      const pulse = 1 + Math.sin(safeElapsed * 5.2) * 0.03;
      portalCenter.scale.set(0.70 * s * pulse, 1.0 * s * (2 - pulse), Math.max(0.05, s));

      outerRingGroup.rotation.z += safeDt * 1.1;
      midRingGroup.rotation.z -= safeDt * 2.4;
      innerGroup.rotation.z += safeDt * 3.8;

      for (let i = 0; i < rimBlobs.length; i++) {
        const sc = 0.85 + 0.25 * Math.sin(safeElapsed * 6.5 + i * 1.3);
        rimBlobs[i].scale.set(sc, sc, 0.45);
      }
      for (let i = 0; i < droplets.length; i++) {
        const a = safeElapsed * 1.9 + (i * Math.PI * 2) / droplets.length;
        const rad = 0.84 + Math.sin(safeElapsed * 4.2 + i) * 0.05;
        droplets[i].position.set(
          Math.cos(a) * rad,
          Math.sin(a) * rad,
          Math.sin(safeElapsed * 3.5 + i) * 0.08,
        );
      }
    },

    dispose(): void {
      b.dispose();
    },
  };
}
