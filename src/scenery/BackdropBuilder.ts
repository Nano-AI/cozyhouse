import * as THREE from 'three';
import type {
  GameDataBundle,
  HouseState,
  SceneryViewDef,
  TimeOfDay,
  WeatherDef,
} from '../data/schemas';
import { canonicalWallEdgeKey, getEffectiveFootprint } from '../engine/GridSystem';
import {
  type LinearCloudFieldHandle,
  type SkyDomeHandle,
  computeNightGlowFactor,
  createLinearCloudField,
  createSkyDome,
  resolveTimeHour,
} from './SkyDome';

/** Ground plane cleanly separated below flat y = 0 floor tiles [0.004..0.024] (zero Z-fighting). */
const GROUND_Y = -0.025;
/** Expansive horizon terrain size (260 x 260) so edges never visibly end. */
const TERRAIN_SPAN = 260;
/** Deep street-canyon floor elevation for the elevated City apartment view. */
const CITY_STREET_Y = -34;

interface BoatNode {
  group: THREE.Group;
  baseY: number;
  phase: number;
}

interface WaveNode {
  mesh: THREE.Mesh;
  baseScaleX: number;
  baseScaleZ: number;
  phase: number;
}

interface GrassInstanceData {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  phase: number;
}

interface CompiledGrassItem {
  x: number;
  z: number;
  cs: number;
  ss: number;
  scale: number;
  phase: number;
}

interface SwayingGrassField {
  mesh: THREE.InstancedMesh;
  items: CompiledGrassItem[];
}

interface RiverFlowHandle {
  /** Pre-sampled river lookup table: [x, z, dirX, dirZ, rightX, rightZ] per sample. */
  lut: Float32Array;
  lutCount: number;
  streaksMesh: THREE.InstancedMesh;
  streaks: Array<{ baseU: number; speed: number; lateral: number; length: number; phase: number }>;
  shimmerMat: THREE.MeshStandardMaterial;
}

export interface BackdropHandle {
  root: THREE.Group;
  update(
    elapsed: number,
    dt: number,
    weather: WeatherDef,
    cameraPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
  ): void;
  applyWeatherTint(
    view: SceneryViewDef,
    weather: WeatherDef,
    timeOfDay?: TimeOfDay,
    timeHour?: number,
  ): void;
  applyTimeOfDay(timeOfDay: TimeOfDay, timeHour?: number): void;
  setLightning(intensity: number): void;
  dispose(): void;
}

export interface YardLifeHandle {
  root: THREE.Group;
  update(elapsed: number, dt: number, weather: WeatherDef, timeHour: number): void;
  dispose(): void;
}

type GroundTextureKind = 'grass' | 'sand' | 'concrete';

const sharedGroundTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generates a subtle, seamlessly tileable 128x128 procedural ground CanvasTexture
 * (high brightness 232..255 so it gently mottles the pastel material color without muddying it).
 * Returns `null` cleanly in headless Node environments without `document`.
 */
function getGroundTexture(
  kind: GroundTextureKind,
  repeatX = 38,
  repeatY = 38,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cacheKey = `${kind}|${repeatX}|${repeatY}`;
  const existing = sharedGroundTextureCache.get(cacheKey);
  if (existing) return existing;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#F6F6F4';
  ctx.fillRect(0, 0, size, size);

  const rand = seededRand(kind === 'grass' ? 911 : kind === 'sand' ? 922 : 933);

  if (kind === 'grass') {
    // Soft organic mottled meadow dappling (seamless wrap around edges)
    for (let i = 0; i < 64; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 6 + rand() * 14;
      const warm = i % 2 === 0;
      ctx.fillStyle = warm ? 'rgba(255, 252, 232, 0.22)' : 'rgba(182, 206, 168, 0.16)';
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Delicate fine grass-blade micro-speckles
    for (let i = 0; i < 240; i++) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 255, 245, 0.34)' : 'rgba(155, 186, 138, 0.24)';
      ctx.fillRect(x, y, 1, 2 + Math.floor(rand() * 2));
    }
  } else if (kind === 'sand') {
    // Gentle horizontal wind-rippled coastal sand + fine grain
    for (let row = 0; row < size; row += 8) {
      ctx.strokeStyle = 'rgba(220, 204, 174, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const wy = row + Math.sin((x / size) * Math.PI * 2 + row * 0.25) * 1.6;
        if (x === 0) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 252, 242, 0.36)' : 'rgba(204, 186, 152, 0.22)';
      ctx.fillRect(x, y, 1, 1);
    }
  } else {
    // Subtle architectural travertine/concrete patio variation + faint tile seams
    for (let i = 0; i < 90; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 4 + rand() * 10;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 253, 248, 0.18)' : 'rgba(195, 190, 184, 0.16)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(175, 170, 164, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.sharedTex = true;
  tex.needsUpdate = true;
  sharedGroundTextureCache.set(cacheKey, tex);
  return tex;
}

type GlowKind = 'window' | 'lamp' | 'avenue';

const COL_WIN_DAY = new THREE.Color('#F2EFE0');
const COL_WIN_NIGHT = new THREE.Color('#FFF5D0');
const COL_WIN_EM_DAY = new THREE.Color('#FFE8A3');
const COL_WIN_EM_NIGHT = new THREE.Color('#FFD47A');

const COL_LAMP_DAY = new THREE.Color('#F4F1E8');
const COL_LAMP_NIGHT = new THREE.Color('#FFF7DA');
const COL_LAMP_EM_DAY = new THREE.Color('#FFE499');
const COL_LAMP_EM_NIGHT = new THREE.Color('#FFDA80');

const COL_AVE_DAY = new THREE.Color('#E2E6EE');
const COL_AVE_NIGHT = new THREE.Color('#FFF1C8');
const COL_AVE_EM_DAY = new THREE.Color('#FFE8B0');
const COL_AVE_EM_NIGHT = new THREE.Color('#FFD282');

class PaletteMaterials {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly glowRegistry = new Map<THREE.MeshStandardMaterial, GlowKind>();

  get(
    hex: string | number,
    opts?: {
      roughness?: number;
      metalness?: number;
      emissive?: string | number;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
      side?: THREE.Side;
      glowKind?: GlowKind;
      groundTex?: GroundTextureKind;
      texRepeat?: number;
      polygonOffset?: boolean;
      polygonOffsetFactor?: number;
      polygonOffsetUnits?: number;
    },
  ): THREE.MeshStandardMaterial {
    const colorKey = typeof hex === 'number' ? hex.toString(16) : hex;
    const key = [
      colorKey,
      opts?.roughness ?? 0.9,
      opts?.metalness ?? 0.0,
      opts?.emissive ?? '',
      opts?.emissiveIntensity ?? 0,
      opts?.transparent ?? false,
      opts?.opacity ?? 1,
      opts?.side ?? THREE.FrontSide,
      opts?.glowKind ?? '',
      opts?.groundTex ?? '',
      opts?.texRepeat ?? '',
      opts?.polygonOffset ? `${opts.polygonOffsetFactor ?? 2}:${opts.polygonOffsetUnits ?? 2}` : '',
    ].join('|');

    const existing = this.cache.get(key);
    if (existing) return existing;

    const map = opts?.groundTex
      ? getGroundTexture(opts.groundTex, opts.texRepeat ?? 38, opts.texRepeat ?? 38)
      : null;

    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: opts?.roughness ?? 0.9,
      metalness: opts?.metalness ?? 0.0,
      flatShading: !map,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
      side: opts?.side ?? THREE.FrontSide,
      ...(opts?.polygonOffset
        ? {
            polygonOffset: true,
            polygonOffsetFactor: opts.polygonOffsetFactor ?? 2,
            polygonOffsetUnits: opts.polygonOffsetUnits ?? 2,
          }
        : {}),
      ...(map ? { map } : {}),
    });
    if (opts?.emissive !== undefined) {
      mat.emissive.set(opts.emissive);
      mat.emissiveIntensity = opts.emissiveIntensity ?? 0.35;
    }
    if (opts?.glowKind) {
      this.glowRegistry.set(mat, opts.glowKind);
    }
    this.cache.set(key, mat);
    return mat;
  }

  applyTimeOfDay(timeOfDay: TimeOfDay, timeHour?: number): void {
    const h = resolveTimeHour(timeOfDay, timeHour);
    const glow = computeNightGlowFactor(h);

    for (const [mat, kind] of this.glowRegistry.entries()) {
      if (kind === 'window') {
        mat.color.copy(COL_WIN_DAY).lerp(COL_WIN_NIGHT, glow);
        mat.emissive.copy(COL_WIN_EM_DAY).lerp(COL_WIN_EM_NIGHT, glow);
        mat.emissiveIntensity = 0.08 + glow * 1.04;
      } else if (kind === 'lamp') {
        mat.color.copy(COL_LAMP_DAY).lerp(COL_LAMP_NIGHT, glow);
        mat.emissive.copy(COL_LAMP_EM_DAY).lerp(COL_LAMP_EM_NIGHT, glow);
        mat.emissiveIntensity = 0.1 + glow * 1.18;
      } else if (kind === 'avenue') {
        mat.color.copy(COL_AVE_DAY).lerp(COL_AVE_NIGHT, glow);
        mat.emissive.copy(COL_AVE_EM_DAY).lerp(COL_AVE_EM_NIGHT, glow);
        mat.emissiveIntensity = 0.06 + glow * 0.84;
      }
    }
  }
}

export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.LineLoop ||
      obj instanceof THREE.Points
    ) {
      if (obj.geometry) geometries.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) materials.add(m);
      } else if (obj.material) {
        materials.add(obj.material);
      }
    }
  });

  for (const geo of geometries) geo.dispose();
  for (const mat of materials) mat.dispose();
}

/**
 * Deterministic PRNG for lush, repeatable landscape placement across reloads & resizes.
 */
function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zero-allocation variant of `rectPerimeterPoint` writing directly into `out`.
 */
export function rectPerimeterPointInto(
  angle: number,
  clearX: number,
  clearZ: number,
  offset: number,
  out: { x: number; z: number },
): void {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const denom = Math.max(Math.abs(dx) / clearX, Math.abs(dz) / clearZ, 0.0001);
  const tRect = 1 / denom;
  out.x = dx * (tRect + offset);
  out.z = dz * (tRect + offset);
}

/**
 * Projects a polar angle onto a point strictly `offset` units outside the
 * rectangular lot clearance `[-clearX, clearX] x [-clearZ, clearZ]`.
 */
export function rectPerimeterPoint(
  angle: number,
  clearX: number,
  clearZ: number,
  offset: number,
): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  rectPerimeterPointInto(angle, clearX, clearZ, offset, out);
  return out;
}

/**
 * Exact non-occlusion height cap across all 4 isometric 90° camera angles:
 * because the isometric projection ray has equal X, Y, Z slopes, an object at (x, z)
 * never projects over [-halfW, halfW] x [-halfD, halfD] if h <= max(|x|-halfW-pad, |z|-halfD-pad).
 */
function maxSafeHeight(
  x: number,
  z: number,
  halfW: number,
  halfD: number,
  pad = 1.6,
): number {
  return Math.max(0.5, Math.max(Math.abs(x) - (halfW + pad), Math.abs(z) - (halfD + pad)));
}

function isInsideRect(x: number, z: number, halfW: number, halfD: number, pad = 0): boolean {
  return Math.abs(x) < halfW + pad && Math.abs(z) < halfD + pad;
}

function isWithinShadowRange(x: number, z: number): boolean {
  return Math.abs(x) <= 22 && Math.abs(z) <= 22;
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotY = 0,
  castShadow = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addEndlessGround(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  hex: string,
  y = GROUND_Y,
  span = TERRAIN_SPAN,
  groundTex?: GroundTextureKind,
): void {
  const geo = new THREE.PlaneGeometry(span, span);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    mats.get(hex, {
      roughness: 0.96,
      groundTex,
      texRepeat: 42,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  mesh.position.y = y;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/**
 * Builds a crisp low-poly multi-blade grass tuft BufferGeometry (3 angled triangular blades,
 * grounded at y = 0) for ultra-fast InstancedMesh meadows and woodland undergrowth.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const blades: Array<{ angle: number; h: number; w: number; lean: number }> = [
    { angle: 0.2, h: 0.34, w: 0.055, lean: 0.09 },
    { angle: 2.25, h: 0.28, w: 0.05, lean: 0.1 },
    { angle: 4.35, h: 0.31, w: 0.052, lean: 0.08 },
    { angle: 1.15, h: 0.22, w: 0.044, lean: 0.11 },
  ];

  for (const b of blades) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const px = -sa * b.w;
    const pz = ca * b.w;
    const tx = ca * b.lean;
    const tz = sa * b.lean;
    // Double-sided blade (2 triangles)
    positions.push(
      -px, 0, -pz,
      px, 0, pz,
      tx, b.h, tz,
      px, 0, pz,
      -px, 0, -pz,
      tx, b.h, tz,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function writeGrassShearMatrix(
  arr: Float32Array,
  idx: number,
  it: CompiledGrassItem,
  swayX: number,
  swayZ: number,
): void {
  const o = idx * 16;
  arr[o] = it.cs;
  arr[o + 1] = 0;
  arr[o + 2] = -it.ss;
  arr[o + 3] = 0;
  arr[o + 4] = swayX * it.scale;
  arr[o + 5] = it.scale;
  arr[o + 6] = swayZ * it.scale;
  arr[o + 7] = 0;
  arr[o + 8] = it.ss;
  arr[o + 9] = 0;
  arr[o + 10] = it.cs;
  arr[o + 11] = 0;
  arr[o + 12] = it.x;
  arr[o + 13] = GROUND_Y + 0.003;
  arr[o + 14] = it.z;
  arr[o + 15] = 1;
}

function createInstancedGrassField(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  items: GrassInstanceData[],
  colorHex: string,
): SwayingGrassField | null {
  if (items.length === 0) return null;
  const geo = createGrassTuftGeometry();
  const mat = mats.get(colorHex, { roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const compiled: CompiledGrassItem[] = new Array(items.length);
  const arr = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const c: CompiledGrassItem = {
      x: it.x,
      z: it.z,
      cs: Math.cos(it.rotY) * it.scale,
      ss: Math.sin(it.rotY) * it.scale,
      scale: it.scale,
      phase: it.phase,
    };
    compiled[i] = c;
    writeGrassShearMatrix(arr, i, c, 0, 0);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);

  return { mesh, items: compiled };
}

function addLayeredOakTree(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  scale: number,
  foliageHex: string,
  foliageLightHex: string,
  trunkHex = '#9E785B',
  baseY = GROUND_Y,
): void {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const shadow = isWithinShadowRange(x, z);

  const trunkH = 0.72 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * scale, 0.14 * scale, trunkH, 6),
    mats.get(trunkHex, { roughness: 0.94 }),
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = shadow;
  g.add(trunk);

  const mainMat = mats.get(foliageHex, { roughness: 0.88 });
  const lightMat = mats.get(foliageLightHex, { roughness: 0.86 });

  const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.52 * scale, 0), mainMat);
  c1.position.set(0, trunkH + 0.36 * scale, 0);
  c1.scale.set(1.12, 0.85, 1.08);
  c1.castShadow = shadow;
  c1.receiveShadow = true;
  g.add(c1);

  const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36 * scale, 0), lightMat);
  c2.position.set(0.32 * scale, trunkH + 0.28 * scale, 0.2 * scale);
  c2.castShadow = shadow;
  g.add(c2);

  const c3 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34 * scale, 0), mainMat);
  c3.position.set(-0.3 * scale, trunkH + 0.24 * scale, -0.18 * scale);
  g.add(c3);

  parent.add(g);
}

function addCypressTree(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  scale: number,
  foliageHex: string,
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  const shadow = isWithinShadowRange(x, z);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, 0.45 * scale, 6),
    mats.get('#8D6C52', { roughness: 0.94 }),
  );
  trunk.position.y = 0.22 * scale;
  g.add(trunk);

  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(0.34 * scale, 1.85 * scale, 7),
    mats.get(foliageHex, { roughness: 0.88 }),
  );
  spire.position.y = 1.25 * scale;
  spire.castShadow = shadow;
  spire.receiveShadow = true;
  g.add(spire);

  parent.add(g);
}

function addRock(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  scale: number,
  rockHex: string,
  mossHex?: string,
  baseY = GROUND_Y,
): void {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.42 * scale, 0),
    mats.get(rockHex, { roughness: 0.95 }),
  );
  rock.position.set(x, baseY + 0.14 * scale, z);
  rock.scale.set(1.25, 0.62, 1.0);
  rock.rotation.set(0.2, x * 0.7 + z, 0.1);
  rock.receiveShadow = true;
  parent.add(rock);

  if (mossHex) {
    const moss = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.25 * scale, 0),
      mats.get(mossHex, { roughness: 0.9 }),
    );
    moss.position.set(x + 0.05 * scale, baseY + 0.3 * scale, z);
    moss.scale.set(1.1, 0.4, 0.95);
    parent.add(moss);
  }
}

function addWildflowers(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  colors: string[],
): void {
  for (let i = 0; i < colors.length; i++) {
    const angle = (i / colors.length) * Math.PI * 2 + x;
    const petal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.055, 0),
      mats.get(colors[i], { roughness: 0.75 }),
    );
    petal.position.set(x + Math.cos(angle) * 0.14, GROUND_Y + 0.12, z + Math.sin(angle) * 0.14);
    parent.add(petal);
  }
}

function addInstancedPines(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  spots: Array<{ x: number; z: number; scale: number; rotY: number }>,
  foliageHex: string,
  trunkHex = '#8C6C52',
): void {
  if (spots.length === 0) return;

  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.13, 0.52, 6);
  const tier1Geo = new THREE.ConeGeometry(0.64, 0.92, 7);
  const tier2Geo = new THREE.ConeGeometry(0.49, 0.84, 7);
  const tier3Geo = new THREE.ConeGeometry(0.32, 0.68, 7);

  const trunkMat = mats.get(trunkHex, { roughness: 0.94 });
  const foliageMat = mats.get(foliageHex, { roughness: 0.88 });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const t1Mesh = new THREE.InstancedMesh(tier1Geo, foliageMat, spots.length);
  const t2Mesh = new THREE.InstancedMesh(tier2Geo, foliageMat, spots.length);
  const t3Mesh = new THREE.InstancedMesh(tier3Geo, foliageMat, spots.length);

  t1Mesh.receiveShadow = true;
  t2Mesh.receiveShadow = true;
  trunkMesh.frustumCulled = false;
  t1Mesh.frustumCulled = false;
  t2Mesh.frustumCulled = false;
  t3Mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    dummy.rotation.set(0, s.rotY, 0);
    dummy.scale.setScalar(s.scale);

    dummy.position.set(s.x, GROUND_Y + 0.26 * s.scale, s.z);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(s.x, GROUND_Y + 0.88 * s.scale, s.z);
    dummy.updateMatrix();
    t1Mesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(s.x, GROUND_Y + 1.42 * s.scale, s.z);
    dummy.updateMatrix();
    t2Mesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(s.x, GROUND_Y + 1.88 * s.scale, s.z);
    dummy.updateMatrix();
    t3Mesh.setMatrixAt(i, dummy.matrix);
  }

  trunkMesh.instanceMatrix.needsUpdate = true;
  t1Mesh.instanceMatrix.needsUpdate = true;
  t2Mesh.instanceMatrix.needsUpdate = true;
  t3Mesh.instanceMatrix.needsUpdate = true;
  trunkMesh.matrixAutoUpdate = false;
  trunkMesh.updateMatrix();
  t1Mesh.matrixAutoUpdate = false;
  t1Mesh.updateMatrix();
  t2Mesh.matrixAutoUpdate = false;
  t2Mesh.updateMatrix();
  t3Mesh.matrixAutoUpdate = false;
  t3Mesh.updateMatrix();
  parent.add(trunkMesh, t1Mesh, t2Mesh, t3Mesh);
}

function addInstancedBirches(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  spots: Array<{ x: number; z: number; scale: number; rotY: number }>,
  foliageHex: string,
): void {
  if (spots.length === 0) return;

  const trunkGeo = new THREE.CylinderGeometry(0.065, 0.095, 1.0, 6);
  const crownGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const trunkMat = mats.get('#EFECE3', { roughness: 0.9 });
  const foliageMat = mats.get(foliageHex, { roughness: 0.86 });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crownMesh = new THREE.InstancedMesh(crownGeo, foliageMat, spots.length);
  crownMesh.receiveShadow = true;
  trunkMesh.frustumCulled = false;
  crownMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    dummy.rotation.set(0, s.rotY, 0);
    dummy.scale.setScalar(s.scale);

    dummy.position.set(s.x, GROUND_Y + 0.5 * s.scale, s.z);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(s.x, GROUND_Y + 1.24 * s.scale, s.z);
    dummy.scale.set(s.scale * 1.05, s.scale * 0.92, s.scale * 1.05);
    dummy.updateMatrix();
    crownMesh.setMatrixAt(i, dummy.matrix);
  }

  trunkMesh.instanceMatrix.needsUpdate = true;
  crownMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.matrixAutoUpdate = false;
  trunkMesh.updateMatrix();
  crownMesh.matrixAutoUpdate = false;
  crownMesh.updateMatrix();
  parent.add(trunkMesh, crownMesh);
}

function addFenceSpan(
  parent: THREE.Object3D,
  fenceMat: THREE.Material,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  skipEndPosts = false,
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const rotY = -Math.atan2(dz, dx);

  // Strict thickness hierarchy (rails 0.032 < pickets 0.048 < posts 0.096) eliminates coplanar faces
  addBox(parent, len, 0.052, 0.032, fenceMat, cx, GROUND_Y + 0.36, cz, rotY);
  addBox(parent, len, 0.052, 0.032, fenceMat, cx, GROUND_Y + 0.16, cz, rotY);

  const steps = Math.max(2, Math.round(len / 0.58));
  for (let i = 0; i <= steps; i++) {
    if (skipEndPosts && (i === 0 || i === steps)) continue;
    const t = i / steps;
    const px = x1 + dx * t;
    const pz = z1 + dz * t;
    const isPost = i % 3 === 0 || i === steps;
    addBox(
      parent,
      isPost ? 0.096 : 0.064,
      isPost ? 0.52 : 0.42,
      isPost ? 0.096 : 0.048,
      fenceMat,
      px,
      GROUND_Y + (isPost ? 0.27 : 0.22),
      pz,
      rotY,
    );
  }
}

function addSuburbanHome(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  rotY: number,
  wallHex: string,
  roofHex: string,
  variant: number,
  scale = 1,
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  g.rotation.y = rotY;
  const shadow = isWithinShadowRange(x, z);

  const w = (variant === 1 ? 2.8 : variant === 2 ? 2.3 : 2.5) * scale;
  const h = (variant === 2 ? 1.85 : 1.32) * scale;
  const d = (variant === 1 ? 2.0 : 1.9) * scale;

  addBox(g, w, h, d, mats.get(wallHex, { roughness: 0.88 }), 0, h / 2 + 0.008, 0, 0, shadow);

  // Varied pitched roof silhouettes
  const roofH = (variant === 2 ? 0.92 : 1.02) * scale;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.8, roofH, 4),
    mats.get(roofHex, { roughness: 0.85 }),
  );
  roof.position.y = h + roofH / 2 - 0.02;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  roof.castShadow = shadow;
  roof.receiveShadow = true;
  g.add(roof);

  // Side garage or porch wing cleanly abutted without intersecting main walls
  if (variant === 1) {
    const gW = 1.14 * scale;
    const gH = 0.95 * scale;
    const gD = 1.5 * scale;
    const gX = w / 2 + gW / 2 + 0.004 * scale;
    const gZ = 0.08 * scale;
    addBox(g, gW, gH, gD, mats.get(wallHex, { roughness: 0.9 }), gX, gH / 2 + 0.008, gZ, 0, shadow);
    addBox(
      g,
      0.82 * scale,
      0.72 * scale,
      0.06,
      mats.get('#EAE5DC', { roughness: 0.85 }),
      gX,
      0.38 * scale,
      gZ + gD / 2 + 0.032,
    );
  } else {
    // Cozy front porch awning strictly outside front facade
    addBox(
      g,
      1.15 * scale,
      0.1 * scale,
      0.62 * scale,
      mats.get('#EFEAE0', { roughness: 0.86 }),
      -0.35 * scale,
      0.95 * scale,
      d / 2 + 0.314 * scale,
    );
  }

  // Chimney
  addBox(g, 0.26 * scale, 0.55 * scale, 0.26 * scale, mats.get('#D9C6B8', { roughness: 0.92 }), 0.55 * scale, h + 0.48 * scale, -0.25 * scale);

  // Door & warm glowing windows cleanly proud of wall faces (zero facade Z-fighting)
  const doorMat = mats.get('#B5896B', { roughness: 0.85 });
  const winMat = mats.get('#FFF2C2', {
    roughness: 0.4,
    emissive: '#FFE8A3',
    emissiveIntensity: 0.08,
    glowKind: 'window',
  });
  addBox(g, 0.4 * scale, 0.66 * scale, 0.06, doorMat, -0.35 * scale, 0.35 * scale, d / 2 + 0.032);
  addBox(g, 0.44 * scale, 0.36 * scale, 0.06, winMat, 0.48 * scale, 0.68 * scale, d / 2 + 0.032);
  addBox(g, 0.48 * scale, 0.36 * scale, 0.06, winMat, 0, 0.68 * scale, -d / 2 - 0.032);
  if (variant === 2) {
    addBox(g, 0.4 * scale, 0.34 * scale, 0.06, winMat, -0.42 * scale, 1.38 * scale, d / 2 + 0.032);
    addBox(g, 0.4 * scale, 0.34 * scale, 0.06, winMat, 0.42 * scale, 1.38 * scale, d / 2 + 0.032);
  }

  parent.add(g);
}

function addStreetLamp(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
): void {
  const poleMat = mats.get('#6E747B', { roughness: 0.7, metalness: 0.2 });
  const bulbMat = mats.get('#FFF4CF', {
    roughness: 0.3,
    emissive: '#FFE499',
    emissiveIntensity: 0.1,
    glowKind: 'lamp',
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 1.85, 6), poleMat);
  pole.position.set(x, GROUND_Y + 0.92, z);
  parent.add(pole);

  const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), bulbMat);
  lamp.position.set(x, GROUND_Y + 1.9, z);
  parent.add(lamp);
}

function buildSuburbs(
  root: THREE.Group,
  mats: PaletteMaterials,
  view: SceneryViewDef,
  halfW: number,
  halfD: number,
  grassFields: SwayingGrassField[],
): void {
  addEndlessGround(root, mats, view.groundColor, GROUND_Y, TERRAIN_SPAN, 'grass');

  // Player's private fenced property hugging cleanly around the rectangular lot
  const fenceX = halfW + 1.45;
  const fenceZ = halfD + 1.45;
  const fenceMat = mats.get('#F6F2E8', { roughness: 0.86 });
  const gateHalf = 1.15;

  addFenceSpan(root, fenceMat, -fenceX, -fenceZ + 0.05, -fenceX, fenceZ - 0.05, true);
  addFenceSpan(root, fenceMat, fenceX, -fenceZ + 0.05, fenceX, fenceZ - 0.05, true);
  addFenceSpan(root, fenceMat, -fenceX, fenceZ, fenceX, fenceZ);
  addFenceSpan(root, fenceMat, -fenceX, -fenceZ, -gateHalf, -fenceZ);
  addFenceSpan(root, fenceMat, gateHalf, -fenceZ, fenceX, -fenceZ);

  // Stepping-stone path stopping cleanly before the neighborhood sidewalk + mailbox
  const stoneMat = mats.get('#DFD7CA', { roughness: 0.94 });
  const sidewalkZ = -(halfD + 4.2);
  for (let z = -fenceZ; z >= sidewalkZ + 0.88; z -= 0.72) {
    addBox(root, 0.78, 0.026, 0.44, stoneMat, 0, GROUND_Y + 0.029, z);
  }
  addBox(root, 0.07, 0.5, 0.07, mats.get('#8F6E54'), gateHalf + 0.45, GROUND_Y + 0.26, sidewalkZ + 0.88);
  addBox(root, 0.22, 0.16, 0.34, mats.get('#D97F6C'), gateHalf + 0.45, GROUND_Y + 0.592, sidewalkZ + 0.88);

  // ENDLESS straight quiet residential street & sidewalks (strict vertical & curb separation)
  const roadZ = -(halfD + 6.45);
  const farSidewalkZ = -(halfD + 8.7);
  const sidewalkMat = mats.get('#EBE6DD', { roughness: 0.92 });
  const roadMat = mats.get('#CECBC4', { roughness: 0.95 });
  const dashMat = mats.get('#F6F3EC', { roughness: 0.82 });

  addBox(root, TERRAIN_SPAN, 0.044, 1.24, sidewalkMat, 0, GROUND_Y + 0.034, sidewalkZ);
  addBox(root, TERRAIN_SPAN, 0.02, 3.16, roadMat, 0, GROUND_Y + 0.014, roadZ);
  addBox(root, TERRAIN_SPAN, 0.044, 1.24, sidewalkMat, 0, GROUND_Y + 0.034, farSidewalkZ);

  for (let x = -124; x <= 124; x += 2.6) {
    addBox(root, 1.1, 0.02, 0.09, dashMat, x, GROUND_Y + 0.038, roadZ);
  }

  // Continuous varied neighborhood across the street (15 homes stretching past the horizon!)
  const wallPalette = ['#F7E3AF', '#BFE0EE', '#F2C6C2', '#C7E5D0', '#DDD4EC', '#F4D4B5'];
  const roofPalette = ['#DF8C76', '#8498B3', '#D9AC65', '#7FA88B', '#9D8DA8'];
  const drivewayMat = mats.get('#D9D4CA', { roughness: 0.94 });
  const carColors = ['#E88A78', '#80B6D8', '#F2CE74', '#8FC49E', '#C9A4D8'];

  const acrossZ = -(halfD + 12.6);
  let houseIdx = 0;
  for (let hx = -72; hx <= 72; hx += 9.6) {
    const wall = wallPalette[houseIdx % wallPalette.length];
    const roof = roofPalette[(houseIdx * 2) % roofPalette.length];
    const variant = houseIdx % 3;
    addSuburbanHome(root, mats, hx, acrossZ, 0, wall, roof, variant, 1.04);

    // Connecting driveway trimmed strictly before far sidewalk edge & occasional parked car
    addBox(root, 1.45, 0.024, 2.2, drivewayMat, hx + 1.5, GROUND_Y + 0.024, acrossZ + 2.15);
    if (houseIdx % 3 === 1) {
      const carC = carColors[houseIdx % carColors.length];
      addBox(root, 0.65, 0.25, 1.1, mats.get(carC, { roughness: 0.65 }), hx + 1.5, GROUND_Y + 0.165, acrossZ + 2.25);
      addBox(root, 0.54, 0.16, 0.56, mats.get('#F7F9FA', { roughness: 0.45 }), hx + 1.5, GROUND_Y + 0.372, acrossZ + 2.2);
    }

    // Neighbor side yard fences & shade trees
    addFenceSpan(root, fenceMat, hx + 4.8, acrossZ - 2.6, hx + 4.8, acrossZ + 2.5);
    addLayeredOakTree(root, mats, hx - 3.6, acrossZ + 1.5, 1.0 + (houseIdx % 2) * 0.18, '#90C496', '#A7D69F');
    houseIdx++;
  }

  // Same-side neighbor houses flanking left and right of the player's fenced lot
  const sameSideZ = -(halfD - 1.2);
  const sideStep = 10.5;
  for (let side of [-1, 1]) {
    const startX = side * (fenceX + 5.8);
    for (let k = 0; k < 5; k++) {
      const hx = startX + side * k * sideStep;
      const idx = houseIdx + k;
      addSuburbanHome(
        root,
        mats,
        hx,
        sameSideZ,
        Math.PI,
        wallPalette[idx % wallPalette.length],
        roofPalette[(idx + 1) % roofPalette.length],
        idx % 3,
        1.02,
      );
      addBox(root, 1.4, 0.024, 2.64, drivewayMat, hx - side * 1.4, GROUND_Y + 0.024, -(halfD + 2.22));
      addFenceSpan(root, fenceMat, hx + side * 4.9, sameSideZ - 2.6, hx + side * 4.9, sameSideZ + 5.0);
      addLayeredOakTree(root, mats, hx + side * 3.5, sameSideZ + 4.2, 1.08, '#87BC8E', '#A1D199');
    }
    houseIdx += 5;
  }

  // Streetlamps & street trees along the endless boulevard
  for (let sx = -68; sx <= 68; sx += 11.5) {
    addStreetLamp(root, mats, sx, sidewalkZ + 0.85);
    if (Math.abs(sx) > 2.4) {
      addLayeredOakTree(root, mats, sx + 4.2, sidewalkZ + 1.45, 0.92, '#94C79B', '#AED9A3');
    }
  }

  // Cozy backyard garden trees, hedges & gentle distant grassy hills behind the lot
  const rand = seededRand(42);
  for (let i = 0; i < 24; i++) {
    const x = (rand() * 2 - 1) * 58;
    const z = fenceZ + 2.5 + rand() * 34;
    addLayeredOakTree(
      root,
      mats,
      x,
      z,
      0.95 + rand() * 0.45,
      i % 2 === 0 ? '#8BC093' : '#9ACA98',
      '#AED9A4',
    );
  }

  const hedgeMat = mats.get('#82B68A', { roughness: 0.9 });
  addBox(root, 1.8, 0.44, 0.46, hedgeMat, -fenceX - 0.65, GROUND_Y + 0.23, fenceZ * 0.42, Math.PI / 2, true);
  addBox(root, 1.8, 0.44, 0.46, hedgeMat, fenceX + 0.65, GROUND_Y + 0.23, fenceZ * 0.42, Math.PI / 2, true);
  addBox(root, 2.2, 0.44, 0.46, hedgeMat, -fenceX * 0.35, GROUND_Y + 0.23, fenceZ + 0.65, 0, true);
  addBox(root, 2.2, 0.44, 0.46, hedgeMat, fenceX * 0.35, GROUND_Y + 0.23, fenceZ + 0.65, 0, true);

  const flowerPalette = ['#F6DB7D', '#EEABBA', '#B7D4F2'];
  addWildflowers(root, mats, -gateHalf - 0.85, -fenceZ - 0.6, flowerPalette);
  addWildflowers(root, mats, gateHalf + 0.85, -fenceZ - 0.6, flowerPalette);

  // Subtle instanced grass tufts across the surrounding lawns
  const tufts: GrassInstanceData[] = [];
  for (let i = 0; i < 140; i++) {
    const gx = (rand() * 2 - 1) * 44;
    const gz = (rand() * 2 - 1) * 44;
    if (isInsideRect(gx, gz, fenceX + 0.4, fenceZ + 0.4)) continue;
    if (gz > farSidewalkZ - 0.8 && gz < sidewalkZ + 0.8) continue;
    tufts.push({
      x: gx,
      z: gz,
      rotY: rand() * Math.PI * 2,
      scale: 0.72 + rand() * 0.42,
      phase: rand() * Math.PI * 2,
    });
  }
  const field = createInstancedGrassField(root, mats, tufts, '#98C486');
  if (field) grassFields.push(field);
}

function addSkyscraperFromStreet(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  w: number,
  d: number,
  topY: number,
  bodyHex: string,
  accentHex: string,
  opts?: { rooftopGarden?: boolean; waterTower?: boolean; spire?: boolean; setback?: boolean },
): void {
  const height = topY - CITY_STREET_Y;
  if (height <= 3) return;

  const g = new THREE.Group();
  g.position.set(x, CITY_STREET_Y, z);

  addBox(g, w, height, d, mats.get(bodyHex, { roughness: 0.84 }), 0, height / 2 + 0.01, 0);
  addBox(g, w + 0.24, 0.24, d + 0.24, mats.get(accentHex, { roughness: 0.78 }), 0, height - 0.07, 0);

  // Warm illuminated apartment / office window ribbons (proud +0.04 per face, staggered heights)
  const winMat = mats.get('#FFF1C4', {
    roughness: 0.34,
    emissive: '#FFE299',
    emissiveIntensity: 0.08,
    glowKind: 'window',
  });
  const bandStart = Math.max(6, height - 22);
  for (let wy = bandStart; wy <= height - 0.9; wy += 1.45) {
    addBox(g, w * 0.76, 0.38, d + 0.08, winMat, 0, wy, 0);
    addBox(g, w + 0.08, 0.34, d * 0.76, winMat, 0, wy, 0);
  }

  let capTop = height + 0.05;
  if (opts?.setback) {
    const sbH = 1.6;
    addBox(g, w * 0.68, sbH, d * 0.68, mats.get(accentHex, { roughness: 0.8 }), 0, capTop + sbH / 2 + 0.004, 0);
    capTop += sbH + 0.004;
  }

  if (opts?.spire) {
    addBox(g, 0.2, 1.8, 0.2, mats.get('#E2E6EC', { roughness: 0.55, metalness: 0.2 }), 0, capTop + 0.904, 0);
  } else {
    addBox(g, 0.75, 0.42, 0.62, mats.get('#C4C8CF', { roughness: 0.8 }), -w * 0.18, capTop + 0.214, -d * 0.16);
  }

  if (opts?.waterTower) {
    const wx = w * 0.22;
    const wz = d * 0.2;
    addBox(g, 0.36, 0.44, 0.36, mats.get('#8D847B', { roughness: 0.88 }), wx, capTop + 0.224, wz);
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.55, 8),
      mats.get('#D6B896', { roughness: 0.85 }),
    );
    tank.position.set(wx, capTop + 0.725, wz);
    g.add(tank);
  }

  if (opts?.rooftopGarden) {
    addLayeredOakTree(g, mats, -w * 0.18, d * 0.18, 0.65, '#8BC091', '#A6D6A0', '#96775D', capTop + 0.01);
    addLayeredOakTree(g, mats, w * 0.2, -d * 0.16, 0.55, '#99CA96', '#B3DDA9', '#96775D', capTop + 0.01);
  }

  parent.add(g);
}

function buildCity(
  root: THREE.Group,
  mats: PaletteMaterials,
  halfW: number,
  halfD: number,
): void {
  const shaftW = halfW * 2 + 0.46;
  const shaftD = halfD * 2 + 0.46;
  const shaftTopY = -0.055;
  const shaftHeight = shaftTopY - CITY_STREET_Y;

  // Endless atmospheric urban floor far below (260x260)
  addEndlessGround(root, mats, '#727D90', CITY_STREET_Y);

  // Endless orthogonal city avenues staggered in Y so intersections never Z-fight
  const avenueMat = mats.get('#5A6476', { roughness: 0.94 });
  const glowLaneMat = mats.get('#E2E6EE', {
    roughness: 0.7,
    emissive: '#FFE8B0',
    emissiveIntensity: 0.06,
    glowKind: 'avenue',
  });
  const avX = [-(halfW + 3.8), halfW + 3.8, -(halfW + 17.5), halfW + 17.5, -(halfW + 34), halfW + 34];
  const avZ = [-(halfD + 3.8), halfD + 3.8, -(halfD + 17.5), halfD + 17.5, -(halfD + 34), halfD + 34];

  for (const zPos of avZ) {
    addBox(root, TERRAIN_SPAN, 0.04, 2.8, avenueMat, 0, CITY_STREET_Y + 0.036, zPos);
    for (let x = -110; x <= 110; x += 4.2) {
      if (avX.some((ax) => Math.abs(x - ax) < 2.3)) continue;
      addBox(root, 1.2, 0.018, 0.14, glowLaneMat, x, CITY_STREET_Y + 0.072, zPos);
    }
  }
  for (const xPos of avX) {
    addBox(root, 2.8, 0.04, TERRAIN_SPAN, avenueMat, xPos, CITY_STREET_Y + 0.064, 0);
    for (let z = -110; z <= 110; z += 4.2) {
      if (avZ.some((az) => Math.abs(z - az) < 2.3)) continue;
      addBox(root, 0.14, 0.018, 1.2, glowLaneMat, xPos, CITY_STREET_Y + 0.1, z);
    }
  }

  // Sleek elevated apartment building shaft below textured rooftop terrace (clean separation below y = 0)
  const shaftGroup = new THREE.Group();
  const concreteMat = mats.get('#DBD6CE', { roughness: 0.86 });
  const ledgeMat = mats.get('#EFEAE2', { roughness: 0.82 });
  const mullionMat = mats.get('#B7B1A9', { roughness: 0.84 });
  const railGlassMat = mats.get('#CBE2F2', {
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
  });
  const aptWinMat = mats.get('#FFF1C4', {
    roughness: 0.3,
    emissive: '#FFE099',
    emissiveIntensity: 0.08,
    glowKind: 'window',
  });

  // Main shaft deck stopping cleanly at y = -0.055 below the rooftop terrace surface
  addBox(
    shaftGroup,
    shaftW,
    shaftHeight,
    shaftD,
    concreteMat,
    0,
    CITY_STREET_Y + shaftHeight / 2,
    0,
  );

  // Textured concrete/travertine rooftop terrace strictly at y = -0.022 (+0.033 above shaft, -0.026 below floor tiles)
  const terraceGeo = new THREE.PlaneGeometry(shaftW, shaftD);
  terraceGeo.rotateX(-Math.PI / 2);
  const terraceMesh = new THREE.Mesh(
    terraceGeo,
    mats.get('#E2DDD5', {
      roughness: 0.9,
      groundTex: 'concrete',
      texRepeat: Math.max(4, Math.round(Math.max(halfW, halfD) * 0.7)),
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  terraceMesh.position.y = -0.022;
  terraceMesh.receiveShadow = true;
  shaftGroup.add(terraceMesh);

  // Sleek rooftop terrace glass parapet rails trimmed cleanly between corner pilasters (zero overlap)
  const parX = halfW + 0.18;
  const parZ = halfD + 0.18;
  const innerRailW = Math.max(0.2, parX * 2 - 0.36);
  const innerRailD = Math.max(0.2, parZ * 2 - 0.36);
  addBox(shaftGroup, innerRailW, 0.2, 0.05, railGlassMat, 0, 0.09, -parZ);
  addBox(shaftGroup, innerRailW, 0.2, 0.05, railGlassMat, 0, 0.09, parZ);
  addBox(shaftGroup, 0.05, 0.2, innerRailD, railGlassMat, -parX, 0.09, 0);
  addBox(shaftGroup, 0.05, 0.2, innerRailD, railGlassMat, parX, 0.09, 0);
  addBox(shaftGroup, innerRailW, 0.036, 0.07, ledgeMat, 0, 0.21, -parZ);
  addBox(shaftGroup, innerRailW, 0.036, 0.07, ledgeMat, 0, 0.21, parZ);
  addBox(shaftGroup, 0.07, 0.036, innerRailD, ledgeMat, -parX, 0.21, 0);
  addBox(shaftGroup, 0.07, 0.036, innerRailD, ledgeMat, parX, 0.21, 0);

  // Corner structural pilasters proud of shaft corners and clear of parapet rails
  const pilasterH = 0.24 - (CITY_STREET_Y + 0.01);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        shaftGroup,
        0.34,
        pilasterH,
        0.34,
        ledgeMat,
        sx * parX,
        CITY_STREET_Y + 0.01 + pilasterH / 2,
        sz * parZ,
      );
    }
  }

  // Horizontal story ledges & warm apartment window bays (protruding & staggered heights)
  const floorStep = 3.2;
  for (let story = 0; story < 10; story++) {
    const slabY = -0.22 - story * floorStep;
    addBox(shaftGroup, shaftW + 0.34, 0.24, shaftD + 0.34, ledgeMat, 0, slabY, 0);
    if (story < 9) {
      const winY = slabY - floorStep * 0.5;
      const baysW = Math.max(3, Math.round(halfW / 2.2));
      const baysD = Math.max(3, Math.round(halfD / 2.2));
      for (let b = 0; b < baysW; b++) {
        const bx = -shaftW * 0.38 + (b / Math.max(1, baysW - 1)) * (shaftW * 0.76);
        addBox(shaftGroup, (shaftW * 0.58) / baysW, 1.46, shaftD + 0.08, aptWinMat, bx, winY, 0);
      }
      for (let b = 0; b < baysD; b++) {
        const bz = -shaftD * 0.38 + (b / Math.max(1, baysD - 1)) * (shaftD * 0.76);
        addBox(shaftGroup, shaftW + 0.08, 1.4, (shaftD * 0.58) / baysD, aptWinMat, 0, winY, bz);
      }
      addBox(shaftGroup, 0.22, floorStep - 0.28, shaftD + 0.14, mullionMat, 0, winY, 0);
      addBox(shaftGroup, shaftW + 0.14, floorStep - 0.34, 0.22, mullionMat, 0, winY, 0);
    }
  }
  root.add(shaftGroup);

  // Dense multi-tiered endless urban skyline stretching into horizon haze
  const nearPalette: Array<[string, string]> = [
    ['#AEC6DC', '#C9DCEC'],
    ['#E8B7AB', '#F3CFC7'],
    ['#C8C3D9', '#DFDBE9'],
    ['#ECE0C5', '#F6EEDC'],
    ['#B2CFC2', '#CDE3D8'],
  ];
  const farPalette: Array<[string, string]> = [
    ['#9BB4CE', '#B4C9DE'],
    ['#C9B7C5', '#DDD0DA'],
    ['#A7BED1', '#C0D2E2'],
    ['#C4C5D6', '#D7D8E5'],
  ];

  const clearX = halfW + 1.0;
  const clearZ = halfD + 1.0;
  const placedTowers: Array<{ x: number; z: number; hw: number; hd: number }> = [];
  const resolveTowerSpot = (
    angle: number,
    baseOffset: number,
    tw: number,
    td: number,
  ): { x: number; z: number } => {
    const hw = tw / 2 + 0.45;
    const hd = td / 2 + 0.45;
    let offset = baseOffset;
    for (let attempt = 0; attempt < 6; attempt++) {
      const pt = rectPerimeterPoint(angle, clearX, clearZ, offset);
      let overlaps = false;
      for (let j = 0; j < placedTowers.length; j++) {
        const t = placedTowers[j];
        if (Math.abs(pt.x - t.x) < hw + t.hw && Math.abs(pt.z - t.z) < hd + t.hd) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        placedTowers.push({ x: pt.x, z: pt.z, hw, hd });
        return pt;
      }
      offset += 2.6;
    }
    const fallback = rectPerimeterPoint(angle, clearX, clearZ, offset);
    placedTowers.push({ x: fallback.x, z: fallback.z, hw, hd });
    return fallback;
  };

  // Tier 1: Immediate neighboring roofs & mid-rise buildings
  const tier1Count = 12;
  for (let i = 0; i < tier1Count; i++) {
    const angle = (i / tier1Count) * Math.PI * 2 + 0.26;
    const tw = 4.2 + (i % 2) * 0.9;
    const td = 4.0 + ((i + 1) % 2) * 0.9;
    const pt = resolveTowerSpot(angle, 5.8 + (i % 2) * 2.1, tw, td);
    const [body, acc] = nearPalette[i % nearPalette.length];
    const desiredTop = -3.8 + (i % 3) * 1.9;
    const topY = Math.min(desiredTop, maxSafeHeight(pt.x, pt.z, halfW, halfD, 2.8));
    addSkyscraperFromStreet(
      root,
      mats,
      pt.x,
      pt.z,
      tw,
      td,
      topY,
      body,
      acc,
      { rooftopGarden: i % 2 === 0, waterTower: i % 3 === 1 },
    );
  }

  // Tier 2: Tall mid-skyline towers
  const tier2Count = 18;
  for (let i = 0; i < tier2Count; i++) {
    const angle = (i / tier2Count) * Math.PI * 2 + 0.11;
    const tw = 4.8 + (i % 3) * 0.8;
    const td = 4.6 + ((i + 1) % 3) * 0.8;
    const pt = resolveTowerSpot(angle, 13.5 + (i % 3) * 3.0, tw, td);
    const [body, acc] = nearPalette[(i + 2) % nearPalette.length];
    const hasSpire = i % 2 === 0;
    const hasSetback = i % 3 === 0;
    const crownExtra = (hasSetback ? 1.6 : 0) + (hasSpire ? 1.8 : 0.45);
    const desiredTop = 4.2 + (i % 4) * 2.1;
    const topY = Math.min(desiredTop, maxSafeHeight(pt.x, pt.z, halfW, halfD, 3.4) - crownExtra);
    addSkyscraperFromStreet(
      root,
      mats,
      pt.x,
      pt.z,
      tw,
      td,
      topY,
      body,
      acc,
      { spire: hasSpire, setback: hasSetback, waterTower: i % 4 === 1 },
    );
  }

  // Tier 3: Distant horizon skyscrapers melting into the skybox
  const tier3Count = 26;
  for (let i = 0; i < tier3Count; i++) {
    const angle = (i / tier3Count) * Math.PI * 2 + 0.05;
    const tw = 6.2 + (i % 3) * 1.4;
    const td = 6.0 + ((i + 2) % 3) * 1.4;
    const pt = resolveTowerSpot(angle, 26.5 + (i % 4) * 5.8, tw, td);
    const [body, acc] = farPalette[i % farPalette.length];
    const hasSpire = i % 3 === 0;
    const hasSetback = i % 2 === 0;
    const crownExtra = (hasSetback ? 1.6 : 0) + (hasSpire ? 1.8 : 0.45);
    const desiredTop = 10.5 + (i % 5) * 3.1;
    const topY = Math.min(desiredTop, maxSafeHeight(pt.x, pt.z, halfW, halfD, 4.5) - crownExtra);
    addSkyscraperFromStreet(
      root,
      mats,
      pt.x,
      pt.z,
      tw,
      td,
      topY,
      body,
      acc,
      { spire: hasSpire, setback: hasSetback },
    );
  }
}

/**
 * Builds a smooth curved ribbon BufferGeometry along a CatmullRomCurve3 with
 * verified upward (+Y) normals so water and sculpted banks catch sunlight cleanly.
 */
function buildCurveRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  segments: number,
  profile: Array<{ offset: number; y: number }>,
): THREE.BufferGeometry {
  const cols = profile.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(u);
    const len = Math.hypot(tan.x, tan.z) || 1;
    // Right perpendicular in XZ plane
    const rx = -tan.z / len;
    const rz = tan.x / len;

    for (let c = 0; c < cols; c++) {
      const prof = profile[c];
      positions.push(p.x + rx * prof.offset, prof.y, p.z + rz * prof.offset);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const d = (i + 1) * cols + c;
      const e = d + 1;
      // Verified upward +Y winding: (a, b, d) and (b, e, d)
      indices.push(a, b, d, b, e, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function addDramaticPeak(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  baseRadius: number,
  height: number,
  rockHex: string,
  ridgeHex: string,
  snowThreshold = 0.56,
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  const rotY = x * 0.23 + z * 0.17;
  const facets = 7;

  // Non-overlapping lower rock frustum + upper snow cap (seamless edge-to-edge, zero Z-fighting!)
  const rockH = height * snowThreshold;
  const snowH = height - rockH;
  const snowBaseR = baseRadius * (1 - snowThreshold);

  const rock = new THREE.Mesh(
    new THREE.CylinderGeometry(snowBaseR, baseRadius, rockH, facets, 1, true),
    mats.get(rockHex, { roughness: 0.93 }),
  );
  rock.position.y = rockH / 2;
  rock.rotation.y = rotY;
  rock.receiveShadow = true;
  g.add(rock);

  const snow = new THREE.Mesh(
    new THREE.ConeGeometry(snowBaseR, snowH, facets, 1, true),
    mats.get('#F5F9FD', { roughness: 0.78 }),
  );
  snow.position.y = rockH + snowH / 2;
  snow.rotation.y = rotY;
  g.add(snow);

  // Secondary shoulder ridge buttress (also split cleanly into rock frustum + snow cap when tall)
  const subH = height * 0.66;
  const subR = baseRadius * 0.72;
  const shX = Math.cos(rotY) * baseRadius * 0.42;
  const shZ = Math.sin(rotY) * baseRadius * 0.42;
  const shRot = rotY + 0.5;

  if (height >= 12) {
    const subRockH = subH * 0.66;
    const subSnowH = subH - subRockH;
    const subSnowR = subR * 0.34;

    const shoulder = new THREE.Mesh(
      new THREE.CylinderGeometry(subSnowR, subR, subRockH, 6, 1, true),
      mats.get(ridgeHex, { roughness: 0.94 }),
    );
    shoulder.position.set(shX, subRockH / 2, shZ);
    shoulder.rotation.y = shRot;
    shoulder.receiveShadow = true;
    g.add(shoulder);

    const subSnow = new THREE.Mesh(
      new THREE.ConeGeometry(subSnowR, subSnowH, 6, 1, true),
      mats.get('#F2F7FC', { roughness: 0.8 }),
    );
    subSnow.position.set(shX, subRockH + subSnowH / 2, shZ);
    subSnow.rotation.y = shRot;
    g.add(subSnow);
  } else {
    const shoulder = new THREE.Mesh(
      new THREE.ConeGeometry(subR, subH, 6, 1, true),
      mats.get(ridgeHex, { roughness: 0.94 }),
    );
    shoulder.position.set(shX, subH / 2, shZ);
    shoulder.rotation.y = shRot;
    shoulder.receiveShadow = true;
    g.add(shoulder);
  }

  parent.add(g);
}

function buildMountains(
  root: THREE.Group,
  mats: PaletteMaterials,
  view: SceneryViewDef,
  halfW: number,
  halfD: number,
  grassFields: SwayingGrassField[],
): RiverFlowHandle {
  // Lush continuous alpine valley meadow (260x260 — ZERO gray void!)
  addEndlessGround(root, mats, view.groundColor, GROUND_Y, TERRAIN_SPAN, 'grass');

  const clearX = halfW + 1.8;
  const clearZ = halfD + 1.8;

  // REAL ANIMATED CURVED ALPINE RIVER via CatmullRomCurve3
  // Passes safely outside even extreme rectangular lots (e.g. 36x12 or 12x36)
  const rx = halfW + 5.2;
  const rz = halfD + 4.8;
  const riverCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-115, 0, rz + 28),
      new THREE.Vector3(-rx - 28, 0, rz + 12),
      new THREE.Vector3(-rx - 3.5, 0, halfD * 0.45),
      new THREE.Vector3(-rx - 1.2, 0, -rz - 0.6),
      new THREE.Vector3(-halfW * 0.35, 0, -rz - 1.6),
      new THREE.Vector3(halfW * 0.55, 0, -rz - 2.6),
      new THREE.Vector3(rx + 6.5, 0, -rz - 7.5),
      new THREE.Vector3(rx + 32, 0, -rz - 20),
      new THREE.Vector3(115, 0, -rz - 34),
    ],
    false,
    'catmullrom',
    0.5,
  );
  const riverSamples = riverCurve.getSpacedPoints(80);
  const isNearRiver = (x: number, z: number, pad = 3.2): boolean => {
    const padSq = pad * pad;
    for (let i = 0; i < riverSamples.length; i += 2) {
      const dx = x - riverSamples[i].x;
      const dz = z - riverSamples[i].z;
      if (dx * dx + dz * dz < padSq) return true;
    }
    return false;
  };

  // Non-overlapping sculpted valley grass & mossy slope patches strictly clear of river
  const patchPalette = ['#A8C49B', '#BED2A9', '#9DBB93'];
  const placedPatches: Array<{ x: number; z: number; r: number }> = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + 0.3;
    const r = 4.2 + (i % 3) * 1.4;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 8 + (i % 3) * 8.5);
    if (isNearRiver(pt.x, pt.z, r + 3.1)) continue;
    let overlaps = false;
    for (let j = 0; j < placedPatches.length; j++) {
      const p = placedPatches[j];
      const minD = r + p.r + 0.3;
      const dx = pt.x - p.x;
      const dz = pt.z - p.z;
      if (dx * dx + dz * dz < minD * minD) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    placedPatches.push({ x: pt.x, z: pt.z, r });
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(r, 10),
      mats.get(patchPalette[i % patchPalette.length], { roughness: 0.96 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(pt.x, GROUND_Y + 0.022 + (i % 3) * 0.004, pt.z);
    patch.receiveShadow = true;
    root.add(patch);
  }

  // Sculpted pebbly & mossy riverbanks flanking both sides of the curve (strictly separated Y layers)
  const bankGeo = buildCurveRibbonGeometry(riverCurve, 130, [
    { offset: -2.75, y: GROUND_Y + 0.018 },
    { offset: -1.95, y: GROUND_Y + 0.115 },
    { offset: -1.35, y: GROUND_Y + 0.02 },
    { offset: 1.35, y: GROUND_Y + 0.02 },
    { offset: 1.95, y: GROUND_Y + 0.115 },
    { offset: 2.75, y: GROUND_Y + 0.018 },
  ]);
  const bankMesh = new THREE.Mesh(bankGeo, mats.get('#9DA89B', { roughness: 0.94 }));
  bankMesh.receiveShadow = true;
  root.add(bankMesh);

  // Shallow luminous aqua water layer (+0.030 above bed)
  const shallowGeo = buildCurveRibbonGeometry(riverCurve, 130, [
    { offset: -1.55, y: GROUND_Y + 0.05 },
    { offset: 1.55, y: GROUND_Y + 0.05 },
  ]);
  const shallowMat = mats.get('#7ACDD9', { roughness: 0.32, metalness: 0.08 });
  const shallowMesh = new THREE.Mesh(shallowGeo, shallowMat);
  shallowMesh.receiveShadow = true;
  root.add(shallowMesh);

  // Deeper glacier-turquoise center stream (+0.026 above shallow water)
  const deepGeo = buildCurveRibbonGeometry(riverCurve, 130, [
    { offset: -0.92, y: GROUND_Y + 0.076 },
    { offset: 0.92, y: GROUND_Y + 0.076 },
  ]);
  const deepMesh = new THREE.Mesh(
    deepGeo,
    mats.get('#4EAAC6', { roughness: 0.25, metalness: 0.1 }),
  );
  root.add(deepMesh);

  // Flowing animated white-water foam chevrons/streaks gliding along the river spline!
  const streakCount = 42;
  const streakGeo = new THREE.BoxGeometry(0.14, 0.016, 1.05);
  const streakMat = mats.get('#F2FBFC', {
    roughness: 0.4,
    transparent: true,
    opacity: 0.72,
  });
  const streaksMesh = new THREE.InstancedMesh(streakGeo, streakMat, streakCount);
  streaksMesh.frustumCulled = false;
  streaksMesh.matrixAutoUpdate = false;
  streaksMesh.updateMatrix();
  root.add(streaksMesh);

  const rand = seededRand(108);
  const streaks: RiverFlowHandle['streaks'] = [];
  for (let i = 0; i < streakCount; i++) {
    streaks.push({
      baseU: i / streakCount + rand() * 0.02,
      speed: 0.022 + rand() * 0.014,
      lateral: (rand() * 2 - 1) * 0.88,
      length: 0.65 + rand() * 0.85,
      phase: rand() * Math.PI * 2,
    });
  }

  // Smooth alpine river boulders along the banks
  for (let i = 10; i < 70; i += 4) {
    const pt = riverSamples[i];
    const next = riverSamples[Math.min(79, i + 1)];
    const tx = next.x - pt.x;
    const tz = next.z - pt.z;
    const l = Math.hypot(tx, tz) || 1;
    const side = i % 8 === 0 ? 1 : -1;
    const bx = pt.x + (-tz / l) * side * (1.85 + rand() * 0.45);
    const bz = pt.z + (tx / l) * side * (1.85 + rand() * 0.45);
    if (!isInsideRect(bx, bz, halfW + 1.2, halfD + 1.2)) {
      addRock(root, mats, bx, bz, 0.65 + rand() * 0.55, '#8E99A2', '#7FAE7C');
    }
  }

  // MULTI-LAYER TOWERING DRAMATIC MOUNTAIN RANGE (heights 6..38, guaranteed non-occluding!)
  const rockMain = ['#8092A5', '#8C9EAE', '#75879B', '#93A3B2'];
  const rockRidge = ['#6E8093', '#7A8C9F', '#65778B', '#8495A5'];

  // Layer 1: Foothills & valley ridges (offset +7..+14)
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + 0.18;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 8.5 + (i % 3) * 2.2);
    if (isNearRiver(pt.x, pt.z, 4.6)) continue;
    const h = Math.min(4.8 + (i % 4) * 1.4, maxSafeHeight(pt.x, pt.z, halfW, halfD, 2.4));
    addDramaticPeak(
      root,
      mats,
      pt.x,
      pt.z,
      3.6 + (i % 3) * 0.6,
      h,
      rockMain[i % rockMain.length],
      rockRidge[i % rockRidge.length],
      0.68,
    );
  }

  // Layer 2: Bold mid-range alpine peaks (offset +18..+28, h = 13..22)
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2 + 0.08;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 19.5 + (i % 3) * 3.8);
    if (isNearRiver(pt.x, pt.z, 6.2)) continue;
    const h = Math.min(14.5 + (i % 4) * 2.4, maxSafeHeight(pt.x, pt.z, halfW, halfD, 3.6));
    addDramaticPeak(
      root,
      mats,
      pt.x,
      pt.z,
      6.6 + (i % 3) * 1.3,
      h,
      rockMain[(i + 1) % rockMain.length],
      rockRidge[(i + 1) % rockRidge.length],
      0.58,
    );
  }

  // Layer 3: Colossal snow-capped alpine range encircling the horizon (offset +34..+60, h = 24..38)
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2 + 0.04;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 36.0 + (i % 4) * 6.8);
    const h = Math.min(24.0 + (i % 5) * 3.4, maxSafeHeight(pt.x, pt.z, halfW, halfD, 5.2));
    addDramaticPeak(
      root,
      mats,
      pt.x,
      pt.z,
      11.5 + (i % 3) * 2.4,
      h,
      rockMain[(i + 2) % rockMain.length],
      rockRidge[(i + 2) % rockRidge.length],
      0.54,
    );
  }

  // Dense alpine conifer forests sweeping down into the valley (InstancedMesh)
  const darkPines: Array<{ x: number; z: number; scale: number; rotY: number }> = [];
  const lightPines: Array<{ x: number; z: number; scale: number; rotY: number }> = [];
  for (let i = 0; i < 190; i++) {
    const angle = rand() * Math.PI * 2;
    const offset = 2.0 + rand() * 24.0;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, offset);
    if (isNearRiver(pt.x, pt.z, 3.2)) continue;
    const scale = Math.min(0.85 + rand() * 0.95, maxSafeHeight(pt.x, pt.z, halfW, halfD, 1.4) / 2.2);
    if (scale < 0.55) continue;
    const spot = { x: pt.x, z: pt.z, scale, rotY: rand() * Math.PI * 2 };
    if (i % 2 === 0) darkPines.push(spot);
    else lightPines.push(spot);
  }
  addInstancedPines(root, mats, darkPines, '#5C8D76', '#7A6352');
  addInstancedPines(root, mats, lightPines, '#70A085', '#7A6352');

  // Alpine meadow grass tufts
  const tufts: GrassInstanceData[] = [];
  for (let i = 0; i < 160; i++) {
    const angle = rand() * Math.PI * 2;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 0.9 + rand() * 14);
    if (isNearRiver(pt.x, pt.z, 2.8)) continue;
    tufts.push({
      x: pt.x,
      z: pt.z,
      rotY: rand() * Math.PI * 2,
      scale: 0.7 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
    });
  }
  const field = createInstancedGrassField(root, mats, tufts, '#8BB57E');
  if (field) grassFields.push(field);

  // Pre-sample river spline LUT (160 points: x, z, dirX, dirZ, rightX, rightZ)
  // so river streak animation runs in O(1) with zero per-frame spline binary searches.
  const lutCount = 160;
  const lut = new Float32Array((lutCount + 1) * 6);
  const tmpPt = new THREE.Vector3();
  const tmpTan = new THREE.Vector3();
  for (let i = 0; i <= lutCount; i++) {
    const u = i / lutCount;
    riverCurve.getPointAt(u, tmpPt);
    riverCurve.getTangentAt(u, tmpTan);
    const len = Math.hypot(tmpTan.x, tmpTan.z) || 1;
    const dx = tmpTan.x / len;
    const dz = tmpTan.z / len;
    const base = i * 6;
    lut[base] = tmpPt.x;
    lut[base + 1] = tmpPt.z;
    lut[base + 2] = dx;
    lut[base + 3] = dz;
    lut[base + 4] = -dz;
    lut[base + 5] = dx;
  }

  return {
    lut,
    lutCount,
    streaksMesh,
    streaks,
    shimmerMat: shallowMat,
  };
}

function addRollingHill(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  radius: number,
  height: number,
  hex: string,
): void {
  const hill = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 1),
    mats.get(hex, { roughness: 0.95 }),
  );
  hill.position.set(x, GROUND_Y - height * 0.25, z);
  hill.scale.set(1.3, height / radius, 1.05);
  hill.rotation.y = x * 0.25 + z * 0.3;
  hill.receiveShadow = true;
  parent.add(hill);
}

function addHayBale(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  rotY: number,
): void {
  const bale = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.52, 8),
    mats.get('#E6C973', { roughness: 0.92 }),
  );
  bale.position.set(x, GROUND_Y + 0.3, z);
  bale.rotation.set(Math.PI / 2, 0, rotY);
  bale.castShadow = isWithinShadowRange(x, z);
  parent.add(bale);
}

function addBarnAndSilo(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  rotY: number,
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  g.rotation.y = rotY;
  const shadow = isWithinShadowRange(x, z);

  addBox(g, 2.5, 1.5, 1.9, mats.get('#D47D6D', { roughness: 0.88 }), 0, 0.758, 0, 0, shadow);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 1.0, 4),
    mats.get('#AD6153', { roughness: 0.88 }),
  );
  roof.position.y = 1.96;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.12, 1, 0.86);
  roof.castShadow = shadow;
  g.add(roof);

  // Cream barn doors & warm hayloft + side windows cleanly proud of walls
  const barnWinMat = mats.get('#FFF0C0', {
    roughness: 0.4,
    emissive: '#FFE099',
    emissiveIntensity: 0.08,
    glowKind: 'window',
  });
  addBox(g, 0.85, 0.92, 0.06, mats.get('#F6F0E4', { roughness: 0.85 }), 0, 0.48, 0.985);
  addBox(g, 0.42, 0.34, 0.06, barnWinMat, 0, 1.22, 0.985);
  addBox(g, 0.06, 0.36, 0.44, barnWinMat, 1.285, 0.85, 0);
  addBox(g, 0.06, 0.36, 0.44, barnWinMat, -1.285, 0.85, 0);

  // Tall farmhouse silo
  const silo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 2.3, 10),
    mats.get('#EBE7DF', { roughness: 0.82 }),
  );
  silo.position.set(1.75, 1.158, -0.2);
  silo.castShadow = shadow;
  g.add(silo);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.48, 10),
    mats.get('#A4B4BF', { roughness: 0.75 }),
  );
  cap.position.set(1.75, 2.555, -0.2);
  g.add(cap);

  parent.add(g);
}

function addWindmill(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  rotY: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  g.rotation.y = rotY;
  const shadow = isWithinShadowRange(x, z);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.68, 2.35, 8),
    mats.get('#F3EDE0', { roughness: 0.88 }),
  );
  tower.position.y = 1.18;
  tower.castShadow = shadow;
  g.add(tower);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.54, 8),
    mats.get('#D98878', { roughness: 0.85 }),
  );
  cap.position.y = 2.58;
  g.add(cap);

  const blades = new THREE.Group();
  blades.userData.dynamicBackdrop = true;
  blades.position.set(0, 2.02, 0.5);
  const sailMat = mats.get('#FAF6ED', { roughness: 0.8 });
  const armMat = mats.get('#B58E6C', { roughness: 0.88 });
  for (let i = 0; i < 4; i++) {
    const bladeWrap = new THREE.Group();
    bladeWrap.rotation.z = (i * Math.PI) / 2;
    const arm = addBox(bladeWrap, 0.08, 1.2, 0.05, armMat, 0, 0.6, 0);
    const sail = addBox(bladeWrap, 0.28, 0.88, 0.03, sailMat, 0.14, 0.7, 0.02);
    arm.matrixAutoUpdate = false;
    arm.updateMatrix();
    sail.matrixAutoUpdate = false;
    sail.updateMatrix();
    bladeWrap.matrixAutoUpdate = false;
    bladeWrap.updateMatrix();
    blades.add(bladeWrap);
  }
  g.add(blades);
  parent.add(g);
  return blades;
}

function buildCountryside(
  root: THREE.Group,
  mats: PaletteMaterials,
  view: SceneryViewDef,
  halfW: number,
  halfD: number,
  grassFields: SwayingGrassField[],
): THREE.Group {
  const clearX = halfW + 1.5;
  const clearZ = halfD + 1.5;

  // Endless sunlit pasture terrain (260x260)
  addEndlessGround(root, mats, view.groundColor, GROUND_Y, TERRAIN_SPAN, 'grass');

  // Expansive pastoral patchwork fields with 3-tier elevation separation (>= 0.020 between overlaps)
  const fields: Array<[number, number, number, number, string, number, number]> = [
    [-halfW * 0.55, -(halfD + 8.5), 14, 10, '#E8D695', 0.04, 0],
    [halfW * 0.75, -(halfD + 9.2), 16, 11, '#BED297', -0.03, 1],
    [-(halfW + 10.5), 2.0, 12, 18, '#E6D492', 0.02, 1],
    [halfW + 10.8, -2.5, 13, 18, '#D8C794', 0.05, 0],
    [-2.0, halfD + 10.5, 18, 12, '#BED297', -0.02, 0],
    [-(halfW + 24), -(halfD + 18), 24, 18, '#DDD096', 0.06, 2],
    [halfW + 24, halfD + 18, 22, 18, '#C3D59A', -0.05, 1],
  ];
  for (const [fx, fz, fw, fd, hex, rot, tier] of fields) {
    addBox(
      root,
      fw,
      0.016,
      fd,
      mats.get(hex, { roughness: 0.96 }),
      fx,
      GROUND_Y + 0.018 + tier * 0.02,
      fz,
      rot,
    );
  }

  // Winding dirt farm lane elevated cleanly above all patchwork fields (+0.024 above tier 2)
  const dirtMat = mats.get('#D7C29E', { roughness: 0.96 });
  addBox(root, TERRAIN_SPAN, 0.02, 1.6, dirtMat, 0, GROUND_Y + 0.08, -(halfD + 15.5), 0.03);

  // Rolling golden-green distant hills (no giant blobby bushes!)
  const hillGreens = ['#BDD197', '#CBD89D', '#B6CC92', '#C7D59A'];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + 0.22;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 15.5 + (i % 3) * 10.5);
    const h = Math.min(3.8 + (i % 4) * 1.6, maxSafeHeight(pt.x, pt.z, halfW, halfD, 4.0));
    addRollingHill(root, mats, pt.x, pt.z, 8.5 + (i % 3) * 3.2, h, hillGreens[i % hillGreens.length]);
  }

  // Barn & silo on West pasture, spinning wooden windmill on North meadow
  addBarnAndSilo(root, mats, -(halfW + 5.2), -halfD * 0.42, Math.PI * 0.35);
  const windmillBlades = addWindmill(root, mats, halfW * 0.45, -(halfD + 5.4), Math.PI * 0.14);

  // Split-rail wooden pasture fences cleanly hugging the rectangular lot (zero corner overlap)
  const fenceMat = mats.get('#B5906D', { roughness: 0.92 });
  const fenceX = halfW + 1.85;
  const fenceZ = halfD + 1.85;
  const railSpans: Array<[number, number, number, number, boolean]> = [
    [-fenceX, -fenceZ, -1.5, -fenceZ, false],
    [1.8, -fenceZ, fenceX, -fenceZ, false],
    [-fenceX, -fenceZ + 0.05, -fenceX, fenceZ - 0.05, true],
    [fenceX, -fenceZ + 0.05, fenceX, fenceZ - 0.05, true],
    [-fenceX, fenceZ, fenceX, fenceZ, false],
  ];
  for (const [x1, z1, x2, z2, skipEnds] of railSpans) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const rot = -Math.atan2(dz, dx);
    addBox(root, len, 0.055, 0.04, fenceMat, (x1 + x2) / 2, GROUND_Y + 0.36, (z1 + z2) / 2, rot);
    addBox(root, len, 0.055, 0.04, fenceMat, (x1 + x2) / 2, GROUND_Y + 0.18, (z1 + z2) / 2, rot);
    const posts = Math.max(2, Math.round(len / 2.2));
    for (let i = 0; i <= posts; i++) {
      if (skipEnds && (i === 0 || i === posts)) continue;
      const t = i / posts;
      addBox(root, 0.096, 0.5, 0.096, fenceMat, x1 + dx * t, GROUND_Y + 0.26, z1 + dz * t);
    }
  }

  // Hay rolls
  addHayBale(root, mats, -(fenceX + 1.4), 1.4, 0.4);
  addHayBale(root, mats, -(fenceX + 2.1), 2.3, -0.2);
  addHayBale(root, mats, fenceX + 1.6, -2.2, 0.7);
  addHayBale(root, mats, fenceX + 2.0, halfD * 0.65, 0.1);
  addHayBale(root, mats, -2.4, fenceZ + 1.8, 0.5);

  // Realistic layered oak & cypress tree groves (NO giant bush blobs!)
  const rand = seededRand(77);
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2 + rand() * 0.15;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 3.2 + (i % 4) * 5.2);
    if (i % 3 === 0) {
      addCypressTree(root, mats, pt.x, pt.z, 1.0 + rand() * 0.45, '#729E6E');
    } else {
      addLayeredOakTree(root, mats, pt.x, pt.z, 0.95 + rand() * 0.45, '#89B87E', '#A4CE8E');
    }
  }

  // HUNDREDS of instanced crisp low-poly swaying grass blade tufts + delicate wildflowers!
  const greenTufts: GrassInstanceData[] = [];
  const goldenTufts: GrassInstanceData[] = [];
  for (let i = 0; i < 340; i++) {
    const angle = rand() * Math.PI * 2;
    const offset = 0.7 + rand() * 24;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, offset);
    const data: GrassInstanceData = {
      x: pt.x,
      z: pt.z,
      rotY: rand() * Math.PI * 2,
      scale: 0.75 + rand() * 0.65,
      phase: rand() * Math.PI * 2,
    };
    if (i % 3 === 0) goldenTufts.push(data);
    else greenTufts.push(data);
  }
  const f1 = createInstancedGrassField(root, mats, greenTufts, '#8BB776');
  const f2 = createInstancedGrassField(root, mats, goldenTufts, '#D7BE6B');
  if (f1) grassFields.push(f1);
  if (f2) grassFields.push(f2);

  // Instanced delicate meadow wildflower dots
  const flowerColors = ['#F7DF7E', '#F0A8B8', '#FAF6E8'];
  const flowerGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const dummy = new THREE.Object3D();
  for (let c = 0; c < flowerColors.length; c++) {
    const count = 52;
    const mesh = new THREE.InstancedMesh(
      flowerGeo,
      mats.get(flowerColors[c], { roughness: 0.75 }),
      count,
    );
    mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const pt = rectPerimeterPoint(angle, clearX, clearZ, 0.9 + rand() * 18);
      dummy.position.set(pt.x, GROUND_Y + 0.14, pt.z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.setScalar(0.8 + rand() * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  }

  return windmillBlades;
}

function addPalmTree(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  scale: number,
  leanAngle: number,
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  const shadow = isWithinShadowRange(x, z);

  const trunkMat = mats.get('#C9A57C', { roughness: 0.92 });
  const leafMat = mats.get('#8DCA8C', { roughness: 0.84 });

  let curX = 0;
  let curY = 0;
  let curZ = 0;
  for (let i = 0; i < 4; i++) {
    const segH = 0.5 * scale;
    const tilt = (i + 1) * 0.08;
    const dx = Math.cos(leanAngle) * tilt * 0.35 * scale;
    const dz = Math.sin(leanAngle) * tilt * 0.35 * scale;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry((0.09 - i * 0.012) * scale, (0.11 - i * 0.012) * scale, segH, 6),
      trunkMat,
    );
    seg.position.set(curX + dx * 0.5, curY + segH * 0.5, curZ + dz * 0.5);
    seg.rotation.z = -Math.cos(leanAngle) * tilt;
    seg.rotation.x = Math.sin(leanAngle) * tilt;
    seg.castShadow = shadow;
    g.add(seg);
    curX += dx;
    curY += segH * 0.94;
    curZ += dz;
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + leanAngle;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.22 * scale, 1.08 * scale, 4), leafMat);
    frond.position.set(
      curX + Math.cos(a) * 0.45 * scale,
      curY + 0.06 * scale,
      curZ + Math.sin(a) * 0.45 * scale,
    );
    frond.rotation.order = 'YXZ';
    frond.rotation.y = -a + Math.PI / 2;
    frond.rotation.x = Math.PI * 0.44;
    frond.scale.set(1, 1, 0.32);
    frond.castShadow = shadow;
    g.add(frond);
  }

  parent.add(g);
}

function addBeachUmbrella(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  colorA: string,
  colorB = '#FFF8EE',
): void {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y + 0.01, z);
  const shadow = isWithinShadowRange(x, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 1.15, 6),
    mats.get('#E6D5BA', { roughness: 0.85 }),
  );
  pole.position.y = 0.57;
  pole.castShadow = shadow;
  g.add(pole);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.76, 0.34, 8),
    mats.get(colorA, { roughness: 0.78 }),
  );
  canopy.position.y = 1.08;
  canopy.castShadow = shadow;
  g.add(canopy);

  const stripe = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.2, 4),
    mats.get(colorB, { roughness: 0.78 }),
  );
  stripe.position.y = 1.19;
  stripe.rotation.y = Math.PI / 4;
  g.add(stripe);

  addBox(g, 0.85, 0.024, 0.48, mats.get(colorA, { roughness: 0.9 }), 0.55, 0.022, 0.25, 0.3);
  parent.add(g);
}

function addSailboat(
  parent: THREE.Object3D,
  mats: PaletteMaterials,
  x: number,
  z: number,
  rotY: number,
  hullHex: string,
  boats: BoatNode[],
): void {
  const g = new THREE.Group();
  g.userData.dynamicBackdrop = true;
  const baseY = GROUND_Y - 0.08;
  g.position.set(x, baseY, z);
  g.rotation.y = rotY;

  const hull = addBox(g, 1.35, 0.26, 0.58, mats.get(hullHex, { roughness: 0.75 }), 0, 0.1, 0);
  const mast = addBox(g, 0.06, 1.35, 0.06, mats.get('#D9C3A5', { roughness: 0.85 }), 0, 0.82, 0);
  hull.matrixAutoUpdate = false;
  hull.updateMatrix();
  mast.matrixAutoUpdate = false;
  mast.updateMatrix();

  const sail = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.15, 3),
    mats.get('#FFFDF8', { roughness: 0.7 }),
  );
  sail.position.set(0.12, 0.92, 0);
  sail.scale.set(0.9, 1, 0.16);
  sail.matrixAutoUpdate = false;
  sail.updateMatrix();
  g.add(sail);

  parent.add(g);
  boats.push({ group: g, baseY, phase: x * 0.4 + z * 0.3 });
}

function buildBeach(
  root: THREE.Group,
  mats: PaletteMaterials,
  view: SceneryViewDef,
  halfW: number,
  halfD: number,
  boats: BoatNode[],
  waves: WaveNode[],
  grassFields: SwayingGrassField[],
): void {
  const clearX = halfW + 1.4;
  const clearZ = halfD + 1.4;

  // Endless turquoise ocean (260x260) cleanly below lagoon/foam/sand layers
  addEndlessGround(root, mats, '#5BB8CC', GROUND_Y - 0.14);

  // Wide shallow aqua coastal lagoon (+0.045 above deep ocean)
  const shallowGeo = new THREE.CircleGeometry(1, 32);
  shallowGeo.rotateX(-Math.PI / 2);
  const shallow = new THREE.Mesh(shallowGeo, mats.get('#8EE0DF', { roughness: 0.38 }));
  shallow.position.y = GROUND_Y - 0.095;
  shallow.scale.set(halfW * 1.55 + 11.5, 1, halfD * 1.55 + 11.5);
  shallow.receiveShadow = true;
  root.add(shallow);

  // Flush warm sandy shore island (top exactly at GROUND_Y = -0.025, +0.070 above lagoon)
  const sandGeo = new THREE.CylinderGeometry(1, 1.07, 0.07, 16);
  const sand = new THREE.Mesh(
    sandGeo,
    mats.get(view.groundColor, {
      roughness: 0.95,
      groundTex: 'sand',
      texRepeat: 8,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  const sandScaleX = halfW * 1.42 + 4.4;
  const sandScaleZ = halfD * 1.42 + 4.4;
  sand.position.y = GROUND_Y - 0.035;
  sand.scale.set(sandScaleX, 1, sandScaleZ);
  sand.rotation.y = Math.PI / 16;
  sand.receiveShadow = true;
  root.add(sand);

  // Animated translucent rolling sea-foam wave rings (+0.029 above lagoon, strictly outside sand)
  const foamMat = mats.get('#F4FCFC', {
    roughness: 0.45,
    transparent: true,
    opacity: 0.58,
  });
  foamMat.depthWrite = false;
  for (let i = 0; i < 4; i++) {
    const ringGeo = new THREE.RingGeometry(1, 1.022, 36);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, foamMat);
    ring.userData.dynamicBackdrop = true;
    ring.renderOrder = 1;
    ring.position.y = GROUND_Y - 0.066;
    const sx = sandScaleX + 1.2 + i * 2.2;
    const sz = sandScaleZ + 1.2 + i * 2.2;
    ring.scale.set(sx, 1, sz);
    root.add(ring);
    waves.push({ mesh: ring, baseScaleX: sx, baseScaleZ: sz, phase: i * 1.65 });
  }

  // Cozy wooden pier extending into the turquoise lagoon on the North (-Z) cove
  const pierMat = mats.get('#C9A882', { roughness: 0.9 });
  const pierZStart = -(sandScaleZ - 1.2);
  for (let i = 0; i < 8; i++) {
    addBox(root, 1.85, 0.08, 0.48, pierMat, 0, GROUND_Y + 0.08, pierZStart - i * 0.58);
  }
  const pierLanternMat = mats.get('#FFF4CF', {
    roughness: 0.3,
    emissive: '#FFE499',
    emissiveIntensity: 0.1,
    glowKind: 'lamp',
  });
  for (let i = 0; i <= 3; i++) {
    const pz = pierZStart - i * 1.4;
    if (i < 3) {
      // Support pilings terminate cleanly below pier planks (bottom of planks = GROUND_Y + 0.04)
      addBox(root, 0.12, 0.44, 0.12, mats.get('#9B7B5C'), -0.82, GROUND_Y - 0.184, pz);
      addBox(root, 0.12, 0.44, 0.12, mats.get('#9B7B5C'), 0.82, GROUND_Y - 0.184, pz);
    } else {
      // End lantern posts sit cleanly outboard of pier planks with lanterns resting on top
      addBox(root, 0.12, 0.64, 0.12, mats.get('#9B7B5C'), -0.99, GROUND_Y - 0.08, pz);
      addBox(root, 0.12, 0.64, 0.12, mats.get('#9B7B5C'), 0.99, GROUND_Y - 0.08, pz);
      addBox(root, 0.16, 0.2, 0.16, pierLanternMat, -0.99, GROUND_Y + 0.344, pz);
      addBox(root, 0.16, 0.2, 0.16, pierLanternMat, 0.99, GROUND_Y + 0.344, pz);
    }
  }

  // Curved palm trees & beach umbrellas around the rectangular shore
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.25;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 1.8 + (i % 2) * 1.0);
    if (Math.abs(pt.x) < 2.2 && pt.z < -halfD) continue;
    addPalmTree(root, mats, pt.x, pt.z, 0.96 + (i % 3) * 0.1, angle + Math.PI * 0.4);
  }

  const umbrellaColors = ['#F29A8A', '#72C9C9', '#F5CB76', '#F29A8A'];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.68;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 1.85);
    addBeachUmbrella(root, mats, pt.x, pt.z, umbrellaColors[i]);
  }

  // Surfboards, coastal rocks & dune sea-grass tufts
  addBox(root, 0.34, 1.05, 0.08, mats.get('#78CAD2', { roughness: 0.55 }), clearX + 0.8, GROUND_Y + 0.48, -clearZ - 0.5, 0.4, true);
  addBox(root, 0.34, 0.95, 0.08, mats.get('#F5B78A', { roughness: 0.55 }), clearX + 1.3, GROUND_Y + 0.42, -clearZ - 0.2, 0.6, true);
  addRock(root, mats, -clearX - 2.6, -halfD * 0.65, 1.05, '#C4BCAF');
  addRock(root, mats, clearX + 2.6, -halfD * 0.55, 0.95, '#C4BCAF');

  const rand = seededRand(303);
  const duneGrass: GrassInstanceData[] = [];
  for (let i = 0; i < 60; i++) {
    const angle = rand() * Math.PI * 2;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 1.2 + rand() * 2.4);
    duneGrass.push({ x: pt.x, z: pt.z, rotY: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.45, phase: rand() * Math.PI * 2 });
  }
  const f = createInstancedGrassField(root, mats, duneGrass, '#A5C184');
  if (f) grassFields.push(f);

  // Sailboats bobbing across the open turquoise sea
  const boatColors = ['#F2A28D', '#F4D58D', '#9AD4D2', '#F2A28D', '#E8B5C8'];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.55;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 10.5 + (i % 3) * 5.2);
    addSailboat(root, mats, pt.x, pt.z, angle + 1.1, boatColors[i % boatColors.length], boats);
  }
}

function buildForest(
  root: THREE.Group,
  mats: PaletteMaterials,
  view: SceneryViewDef,
  halfW: number,
  halfD: number,
  grassFields: SwayingGrassField[],
): void {
  const clearX = halfW + 1.5;
  const clearZ = halfD + 1.5;

  // Endless mossy woodland floor (260x260)
  addEndlessGround(root, mats, view.groundColor, GROUND_Y, TERRAIN_SPAN, 'grass');

  // Curving dirt woodland trail heading out through the trees (cleanly elevated above mossy floor)
  const pathMat = mats.get('#D6C8AC', { roughness: 0.95 });
  for (let i = 0; i < 16; i++) {
    const z = -(halfD + 1.6) - i * 1.9;
    const x = Math.sin(i * 0.45) * 2.2;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.026, 7), pathMat);
    pad.position.set(x, GROUND_Y + 0.028, z);
    pad.receiveShadow = true;
    root.add(pad);
  }

  // Dense multi-ring instanced pine & birch woodland stretching seamlessly to the horizon
  const rand = seededRand(512);
  const darkPines: Array<{ x: number; z: number; scale: number; rotY: number }> = [];
  const lightPines: Array<{ x: number; z: number; scale: number; rotY: number }> = [];
  const birches: Array<{ x: number; z: number; scale: number; rotY: number }> = [];

  for (let i = 0; i < 240; i++) {
    const angle = rand() * Math.PI * 2;
    const offset = 2.0 + Math.pow(rand(), 0.85) * 44.0;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, offset);
    // Keep woodland trail corridor open
    if (pt.z < -halfD && Math.abs(pt.x - Math.sin((-pt.z - halfD) * 0.23) * 2.2) < 2.2) continue;
    const desiredScale = 0.95 + Math.min(1.6, offset / 22) + rand() * 0.55;
    const scale = Math.min(desiredScale, maxSafeHeight(pt.x, pt.z, halfW, halfD, 1.5) / 2.2);
    if (scale < 0.6) continue;

    const spot = { x: pt.x, z: pt.z, scale, rotY: rand() * Math.PI * 2 };
    if (i % 4 === 0) birches.push(spot);
    else if (i % 2 === 0) darkPines.push(spot);
    else lightPines.push(spot);
  }
  addInstancedPines(root, mats, darkPines, '#639872');
  addInstancedPines(root, mats, lightPines, '#7AB383');
  addInstancedBirches(root, mats, birches, '#B0D595');

  // Mossy boulders, fallen log & woodland wildflower patches
  const flowerColors = ['#F7DF8D', '#EFA8B8', '#B8D4F2'];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.38;
    const rPt = rectPerimeterPoint(angle, clearX, clearZ, 1.8 + (i % 3) * 1.4);
    addRock(root, mats, rPt.x, rPt.z, 0.85 + (i % 2) * 0.25, '#92A094', '#7EB078');
    const fPt = rectPerimeterPoint(angle + 0.2, clearX, clearZ, 1.3);
    addWildflowers(root, mats, fPt.x, fPt.z, flowerColors);
  }

  // Instanced swaying woodland ferns & grass tufts
  const fernTufts: GrassInstanceData[] = [];
  for (let i = 0; i < 200; i++) {
    const angle = rand() * Math.PI * 2;
    const pt = rectPerimeterPoint(angle, clearX, clearZ, 0.9 + rand() * 20);
    fernTufts.push({
      x: pt.x,
      z: pt.z,
      rotY: rand() * Math.PI * 2,
      scale: 0.85 + rand() * 0.65,
      phase: rand() * Math.PI * 2,
    });
  }
  const field = createInstancedGrassField(root, mats, fernTufts, '#78AA74');
  if (field) grassFields.push(field);
}

interface MergeBucket {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  meshes: THREE.Mesh[];
}

/**
 * Merges static non-animated backdrop meshes sharing the same material and shadow flags
 * into consolidated BufferGeometries, then freezes `matrixAutoUpdate = false` on all
 * static nodes so GPU draw calls drop by 15x–65x with zero visual change.
 */
function mergeStaticBackdropMeshes(staticRoot: THREE.Group): void {
  staticRoot.updateMatrixWorld(true);

  const buckets = new Map<string, MergeBucket>();
  const collect = (obj: THREE.Object3D): void => {
    if (obj.userData?.dynamicBackdrop) return;
    if (obj instanceof THREE.InstancedMesh) {
      obj.matrixAutoUpdate = false;
      obj.updateMatrix();
      return;
    }
    if (obj instanceof THREE.Mesh && !Array.isArray(obj.material)) {
      const key = `${obj.material.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          material: obj.material,
          castShadow: obj.castShadow,
          receiveShadow: obj.receiveShadow,
          meshes: [],
        };
        buckets.set(key, bucket);
      }
      bucket.meshes.push(obj);
      return;
    }
    for (let i = 0; i < obj.children.length; i++) {
      collect(obj.children[i]);
    }
  };
  collect(staticRoot);

  const removedMeshes: THREE.Mesh[] = [];
  const candidateDisposeGeos = new Set<THREE.BufferGeometry>();

  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) {
      const single = bucket.meshes[0];
      single.matrixAutoUpdate = false;
      single.updateMatrix();
      continue;
    }

    let totalVerts = 0;
    let keepUvs = true;
    const prepared: THREE.BufferGeometry[] = [];
    for (let i = 0; i < bucket.meshes.length; i++) {
      const m = bucket.meshes[i];
      const src = m.geometry;
      const tmp = src.index ? src.toNonIndexed() : src.clone();
      if (!tmp.getAttribute('normal')) {
        tmp.computeVertexNormals();
      }
      if (!tmp.getAttribute('uv')) {
        keepUvs = false;
      }
      tmp.applyMatrix4(m.matrixWorld);
      const posAttr = tmp.getAttribute('position');
      totalVerts += posAttr.count;
      prepared.push(tmp);
      removedMeshes.push(m);
      candidateDisposeGeos.add(src);
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = keepUvs ? new Float32Array(totalVerts * 2) : null;
    let offset = 0;
    let uvOffset = 0;

    for (let i = 0; i < prepared.length; i++) {
      const g = prepared[i];
      const posArr = g.getAttribute('position').array as ArrayLike<number>;
      const normArr = g.getAttribute('normal').array as ArrayLike<number>;
      positions.set(posArr, offset);
      normals.set(normArr, offset);
      offset += posArr.length;
      if (uvs) {
        const uvArr = g.getAttribute('uv').array as ArrayLike<number>;
        uvs.set(uvArr, uvOffset);
        uvOffset += uvArr.length;
      }
      g.dispose();
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) {
      mergedGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    mergedGeo.computeBoundingBox();
    mergedGeo.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.matrixAutoUpdate = false;
    mergedMesh.updateMatrix();
    staticRoot.add(mergedMesh);
  }

  // Detach original leaf meshes and prune empty static wrapper groups
  for (let i = 0; i < removedMeshes.length; i++) {
    const m = removedMeshes[i];
    m.parent?.remove(m);
  }

  const pruneAndFreeze = (obj: THREE.Object3D): boolean => {
    if (obj.userData?.dynamicBackdrop) return false;
    for (let i = obj.children.length - 1; i >= 0; i--) {
      const child = obj.children[i];
      if (pruneAndFreeze(child)) {
        obj.remove(child);
      }
    }
    if (obj !== staticRoot && obj instanceof THREE.Group && obj.children.length === 0) {
      return true;
    }
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
    return false;
  };
  pruneAndFreeze(staticRoot);

  // Dispose only source geometries no longer referenced by any remaining object
  const keptGeos = new Set<THREE.BufferGeometry>();
  staticRoot.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      keptGeos.add(obj.geometry);
    }
  });
  for (const g of candidateDisposeGeos) {
    if (!keptGeos.has(g)) {
      g.dispose();
    }
  }
}

export function buildBackdropForView(
  view: SceneryViewDef,
  weather: WeatherDef,
  gridWidth = 16,
  gridDepth = 16,
  timeOfDay: TimeOfDay = 'day',
  timeHour?: number,
): BackdropHandle {
  const root = new THREE.Group();
  root.name = 'SceneryBackdropRoot';
  root.matrixAutoUpdate = false;
  root.updateMatrix();

  const mats = new PaletteMaterials();
  const halfW = gridWidth / 2;
  const halfD = gridDepth / 2;

  const worldGroup = new THREE.Group();
  worldGroup.name = 'BackdropWorldGroup';

  const boats: BoatNode[] = [];
  const waves: WaveNode[] = [];
  const grassFields: SwayingGrassField[] = [];
  let windmillBlades: THREE.Group | null = null;
  let riverFlow: RiverFlowHandle | null = null;

  switch (view.id) {
    case 'city':
      buildCity(worldGroup, mats, halfW, halfD);
      break;
    case 'beach':
      buildBeach(worldGroup, mats, view, halfW, halfD, boats, waves, grassFields);
      break;
    case 'forest':
      buildForest(worldGroup, mats, view, halfW, halfD, grassFields);
      break;
    case 'mountains':
      riverFlow = buildMountains(worldGroup, mats, view, halfW, halfD, grassFields);
      break;
    case 'countryside':
      windmillBlades = buildCountryside(worldGroup, mats, view, halfW, halfD, grassFields);
      break;
    case 'suburbs':
    default:
      buildSuburbs(worldGroup, mats, view, halfW, halfD, grassFields);
      break;
  }

  mergeStaticBackdropMeshes(worldGroup);

  const skyDome: SkyDomeHandle = createSkyDome(view, weather, timeOfDay, timeHour);
  root.add(skyDome.group);

  const cloudField: LinearCloudFieldHandle = createLinearCloudField(weather, timeOfDay, timeHour);
  root.add(cloudField.group);
  root.add(worldGroup);

  mats.applyTimeOfDay(timeOfDay, timeHour);

  let grassAccum = 0;

  return {
    root,
    applyWeatherTint(
      activeView: SceneryViewDef,
      activeWeather: WeatherDef,
      activeTimeOfDay: TimeOfDay = 'day',
      activeTimeHour?: number,
    ) {
      skyDome.configure(activeView, activeWeather, activeTimeOfDay, activeTimeHour);
      cloudField.applyThemeTint(activeWeather, activeTimeOfDay, activeTimeHour);
    },
    applyTimeOfDay(activeTimeOfDay: TimeOfDay, activeTimeHour?: number) {
      mats.applyTimeOfDay(activeTimeOfDay, activeTimeHour);
    },
    setLightning(intensity: number) {
      skyDome.setLightning(intensity);
    },
    update(
      elapsed: number,
      dt: number,
      activeWeather: WeatherDef,
      cameraPos: THREE.Vector3,
      cameraForward: THREE.Vector3,
    ) {
      skyDome.update(elapsed, cameraPos, cameraForward);
      cloudField.update(elapsed, dt, activeWeather, cameraPos, cameraForward);

      if (windmillBlades) {
        windmillBlades.rotation.z -= dt * (0.65 + activeWeather.windStrength * 2.4);
      }

      for (let i = 0; i < boats.length; i++) {
        const boat = boats[i];
        const wave = Math.sin(elapsed * 1.4 + boat.phase);
        boat.group.position.y = boat.baseY + wave * 0.045;
        boat.group.rotation.z = Math.cos(elapsed * 1.1 + boat.phase) * 0.04;
      }

      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        const pulse = 1 + Math.sin(elapsed * 1.15 + w.phase) * 0.022;
        w.mesh.scale.set(w.baseScaleX * pulse, 1, w.baseScaleZ * pulse);
      }

      // O(1) LUT flowing white-water shimmer streaks along the curved alpine river spline
      if (riverFlow) {
        const arr = riverFlow.streaksMesh.instanceMatrix.array as Float32Array;
        const lut = riverFlow.lut;
        const lutCount = riverFlow.lutCount;
        const streaks = riverFlow.streaks;

        for (let i = 0; i < streaks.length; i++) {
          const st = streaks[i];
          const u = (st.baseU + elapsed * st.speed) % 1;
          const fIdx = u * lutCount;
          const idx0 = fIdx | 0;
          const idx1 = idx0 < lutCount ? idx0 + 1 : lutCount;
          const frac = fIdx - idx0;
          const b0 = idx0 * 6;
          const b1 = idx1 * 6;

          const px = lut[b0] + (lut[b1] - lut[b0]) * frac;
          const pz = lut[b0 + 1] + (lut[b1 + 1] - lut[b0 + 1]) * frac;
          const dx = lut[b0 + 2] + (lut[b1 + 2] - lut[b0 + 2]) * frac;
          const dz = lut[b0 + 3] + (lut[b1 + 3] - lut[b0 + 3]) * frac;
          const rx = lut[b0 + 4] + (lut[b1 + 4] - lut[b0 + 4]) * frac;
          const rz = lut[b0 + 5] + (lut[b1 + 5] - lut[b0 + 5]) * frac;

          const pulse = 0.72 + Math.sin(elapsed * 2.8 + st.phase) * 0.28;
          const len = st.length;
          const o = i * 16;

          arr[o] = dz * pulse;
          arr[o + 1] = 0;
          arr[o + 2] = -dx * pulse;
          arr[o + 3] = 0;
          arr[o + 4] = 0;
          arr[o + 5] = 1;
          arr[o + 6] = 0;
          arr[o + 7] = 0;
          arr[o + 8] = dx * len;
          arr[o + 9] = 0;
          arr[o + 10] = dz * len;
          arr[o + 11] = 0;
          arr[o + 12] = px + rx * st.lateral;
          arr[o + 13] = GROUND_Y + 0.096;
          arr[o + 14] = pz + rz * st.lateral;
          arr[o + 15] = 1;
        }
        riverFlow.streaksMesh.instanceMatrix.needsUpdate = true;
        riverFlow.shimmerMat.roughness = 0.28 + Math.sin(elapsed * 1.8) * 0.06;
      }

      // Throttled (~24 Hz) direct-shear wind-wave sway on instanced grass & fern tufts
      if (grassFields.length > 0) {
        grassAccum += dt;
        if (grassAccum >= 0.041) {
          grassAccum = 0;
          const swayAmp = 0.09 + activeWeather.windStrength * 0.22;
          const swayFreq = 1.6 + activeWeather.windStrength * 1.8;
          const basePhase = elapsed * swayFreq;
          for (let f = 0; f < grassFields.length; f++) {
            const field = grassFields[f];
            const arr = field.mesh.instanceMatrix.array as Float32Array;
            const items = field.items;
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              const wave = Math.sin(basePhase + it.phase + it.x * 0.15) * swayAmp;
              writeGrassShearMatrix(arr, i, it, wave, wave * 0.5);
            }
            field.mesh.instanceMatrix.needsUpdate = true;
          }
        }
      }
    },
    dispose() {
      disposeObjectTree(root);
    },
  };
}

const YARD_LIFE_VIEWS = new Set(['suburbs', 'countryside', 'forest', 'mountains']);

const YARD_GRASS_COLOR_BY_VIEW: Record<string, string> = {
  suburbs: '#92BC7F',
  countryside: '#9BB973',
  forest: '#75A370',
  mountains: '#88AE7A',
};

/**
 * Compact layout signature so `YardLifeRoot` only rebuilds when floor/wall occupancy,
 * lot dimensions, or view changes (never on light toggles, weather, or time-slider drags).
 */
export function computeYardLayoutSignature(
  state: HouseState,
  data: GameDataBundle,
  viewId: string,
): string {
  if (!YARD_LIFE_VIEWS.has(viewId)) return 'none';
  const parts: string[] = [viewId, String(state.gridWidth), String(state.gridDepth)];
  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i];
    const def = data.itemsById.get(it.itemId);
    if (!def) continue;
    if (def.layer === 'floor' || (def.layer === 'wall' && def.wallKind === 'structure')) {
      parts.push(`${it.itemId}:${it.x},${it.z},${it.rotation}`);
    }
  }
  return parts.join('|');
}

interface ButterflyState {
  cx: number;
  cz: number;
  ampX: number;
  ampZ: number;
  baseY: number;
  speed: number;
  flapSpeed: number;
  phase: number;
}

function createButterflyWingGeometry(): THREE.BufferGeometry {
  // Single wing extending along +X from hinge x = 0 so scaling/rotating around Z flaps naturally
  const positions = new Float32Array([
    // Upper forewing
    0, 0, 0.01,
    0.095, 0.015, 0.065,
    0.04, 0.008, -0.02,
    // Lower hindwing
    0, 0, -0.005,
    0.072, 0.008, -0.055,
    0.012, 0, -0.048,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds living swaying grass tufts, tiny clover/wildflower specks, and gentle daytime
 * butterflies strictly on unbuilt exterior yard tiles inside the player's lot (<= 3 draw calls).
 */
export function buildYardLife(
  state: HouseState,
  data: GameDataBundle,
  view: SceneryViewDef,
): YardLifeHandle | null {
  if (!YARD_LIFE_VIEWS.has(view.id)) return null;

  const w = state.gridWidth;
  const d = state.gridDepth;
  const halfW = w / 2;
  const halfD = d / 2;

  // 1. Mark tiles occupied by any floor item (floor tile, rug, or floor furniture)
  const occupied = new Uint8Array(w * d);
  const wallEdges = new Set<string>();

  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i];
    const def = data.itemsById.get(it.itemId);
    if (!def) continue;

    if (def.layer === 'wall' && def.wallKind === 'structure') {
      wallEdges.add(canonicalWallEdgeKey(it.x, it.z, it.rotation));
      continue;
    }

    if (def.layer === 'floor') {
      const eff = getEffectiveFootprint(def, it.rotation);
      const x0 = Math.max(0, Math.floor(it.x));
      const z0 = Math.max(0, Math.floor(it.z));
      const x1 = Math.min(w, Math.ceil(it.x + eff.w));
      const z1 = Math.min(d, Math.ceil(it.z + eff.d));
      for (let gx = x0; gx < x1; gx++) {
        for (let gz = z0; gz < z1; gz++) {
          occupied[gz * w + gx] = 1;
        }
      }
    }
  }

  // 2. Flood-fill exterior tiles from the outside lot border across non-walled edges
  // so grass never sprouts inside an enclosed 4-walled room even if floor tiles are deleted.
  const exterior = new Uint8Array(w * d);
  const queue: number[] = [];
  const trySeed = (x: number, z: number, borderRot: 0 | 1 | 2 | 3) => {
    const idx = z * w + x;
    if (exterior[idx] || occupied[idx]) return;
    if (wallEdges.has(canonicalWallEdgeKey(x, z, borderRot))) return;
    exterior[idx] = 1;
    queue.push(idx);
  };

  for (let x = 0; x < w; x++) {
    trySeed(x, 0, 0);
    trySeed(x, d - 1, 2);
  }
  for (let z = 0; z < d; z++) {
    trySeed(0, z, 3);
    trySeed(w - 1, z, 1);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % w;
    const cz = (cur / w) | 0;

    // North (rot 0 -> cz - 1)
    if (cz > 0 && !wallEdges.has(canonicalWallEdgeKey(cx, cz, 0))) {
      const ni = (cz - 1) * w + cx;
      if (!exterior[ni] && !occupied[ni]) {
        exterior[ni] = 1;
        queue.push(ni);
      }
    }
    // East (rot 1 -> cx + 1)
    if (cx + 1 < w && !wallEdges.has(canonicalWallEdgeKey(cx, cz, 1))) {
      const ni = cz * w + (cx + 1);
      if (!exterior[ni] && !occupied[ni]) {
        exterior[ni] = 1;
        queue.push(ni);
      }
    }
    // South (rot 2 -> cz + 1)
    if (cz + 1 < d && !wallEdges.has(canonicalWallEdgeKey(cx, cz, 2))) {
      const ni = (cz + 1) * w + cx;
      if (!exterior[ni] && !occupied[ni]) {
        exterior[ni] = 1;
        queue.push(ni);
      }
    }
    // West (rot 3 -> cx - 1)
    if (cx > 0 && !wallEdges.has(canonicalWallEdgeKey(cx, cz, 3))) {
      const ni = cz * w + (cx - 1);
      if (!exterior[ni] && !occupied[ni]) {
        exterior[ni] = 1;
        queue.push(ni);
      }
    }
  }

  const openTiles: Array<{ wx: number; wz: number; isEdge: boolean }> = [];
  for (let gz = 0; gz < d; gz++) {
    for (let gx = 0; gx < w; gx++) {
      if (!exterior[gz * w + gx]) continue;
      openTiles.push({
        wx: gx + 0.5 - halfW,
        wz: gz + 0.5 - halfD,
        isEdge: gx === 0 || gx === w - 1 || gz === 0 || gz === d - 1,
      });
    }
  }

  if (openTiles.length === 0) return null;

  const root = new THREE.Group();
  root.name = 'YardLifeRoot';
  root.matrixAutoUpdate = false;
  root.updateMatrix();

  const rand = seededRand(w * 73 + d * 137 + view.id.charCodeAt(0) * 19);
  const compiledGrass: CompiledGrassItem[] = [];
  const flowerSpots: Array<{ x: number; z: number; scale: number; colorIdx: number }> = [];

  for (let i = 0; i < openTiles.length; i++) {
    const tile = openTiles[i];
    // Tastefully cozy density: 2-3 soft tufts on edge tiles, 1-2 on inner lawn tiles
    const tuftCount = tile.isEdge ? 2 + (rand() > 0.45 ? 1 : 0) : 1 + (rand() > 0.35 ? 1 : 0);
    for (let k = 0; k < tuftCount; k++) {
      const tx = tile.wx + (rand() - 0.5) * 0.78;
      const tz = tile.wz + (rand() - 0.5) * 0.78;
      const rotY = rand() * Math.PI * 2;
      const scale = (tile.isEdge ? 0.62 : 0.48) + rand() * 0.34;
      compiledGrass.push({
        x: tx,
        z: tz,
        cs: Math.cos(rotY) * scale,
        ss: Math.sin(rotY) * scale,
        scale,
        phase: rand() * Math.PI * 2,
      });
    }

    if (rand() < (tile.isEdge ? 0.42 : 0.22)) {
      flowerSpots.push({
        x: tile.wx + (rand() - 0.5) * 0.72,
        z: tile.wz + (rand() - 0.5) * 0.72,
        scale: 0.7 + rand() * 0.45,
        colorIdx: Math.floor(rand() * 3),
      });
    }
  }

  // Draw Call 1: Subtle swaying lawn grass tufts
  const grassGeo = createGrassTuftGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    color: YARD_GRASS_COLOR_BY_VIEW[view.id] ?? '#92BC7F',
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, compiledGrass.length);
  grassMesh.name = 'YardGrassInstances';
  grassMesh.receiveShadow = true;
  grassMesh.frustumCulled = false;
  grassMesh.matrixAutoUpdate = false;
  grassMesh.updateMatrix();

  const grassArr = grassMesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < compiledGrass.length; i++) {
    writeGrassShearMatrix(grassArr, i, compiledGrass[i], 0, 0);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  root.add(grassMesh);

  // Draw Call 2: Delicate pastel clover / wildflower specks (per-instance colored)
  if (flowerSpots.length > 0) {
    const flGeo = new THREE.IcosahedronGeometry(0.042, 0);
    const flMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.82,
      metalness: 0.0,
      flatShading: true,
    });
    const flMesh = new THREE.InstancedMesh(flGeo, flMat, flowerSpots.length);
    flMesh.name = 'YardWildflowerInstances';
    flMesh.frustumCulled = false;
    flMesh.matrixAutoUpdate = false;
    flMesh.updateMatrix();

    const palette = [
      new THREE.Color('#FAF6E6'),
      new THREE.Color('#F7DF84'),
      new THREE.Color('#F2B2C2'),
    ];
    const flArr = flMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < flowerSpots.length; i++) {
      const f = flowerSpots[i];
      const o = i * 16;
      flArr[o] = f.scale; flArr[o + 1] = 0; flArr[o + 2] = 0; flArr[o + 3] = 0;
      flArr[o + 4] = 0; flArr[o + 5] = f.scale * 0.7; flArr[o + 6] = 0; flArr[o + 7] = 0;
      flArr[o + 8] = 0; flArr[o + 9] = 0; flArr[o + 10] = f.scale; flArr[o + 11] = 0;
      flArr[o + 12] = f.x; flArr[o + 13] = GROUND_Y + 0.08; flArr[o + 14] = f.z; flArr[o + 15] = 1;
      flMesh.setColorAt(i, palette[f.colorIdx % palette.length]);
    }
    flMesh.instanceMatrix.needsUpdate = true;
    if (flMesh.instanceColor) flMesh.instanceColor.needsUpdate = true;
    root.add(flMesh);
  }

  // Draw Call 3: 3-4 gentle fluttering pastel butterflies over open yard lawn
  const butterflyCount = Math.min(4, Math.max(2, Math.floor(openTiles.length / 26)));
  const butterflies: ButterflyState[] = [];
  for (let i = 0; i < butterflyCount; i++) {
    const anchor = openTiles[Math.floor(((i + 0.5) / butterflyCount) * openTiles.length)];
    butterflies.push({
      cx: anchor.wx,
      cz: anchor.wz,
      ampX: 0.75 + rand() * 0.85,
      ampZ: 0.75 + rand() * 0.85,
      baseY: 0.55 + rand() * 0.45,
      speed: 0.45 + rand() * 0.25,
      flapSpeed: 12.5 + rand() * 4.5,
      phase: rand() * Math.PI * 2,
    });
  }

  const wingGeo = createButterflyWingGeometry();
  const wingMat = new THREE.MeshBasicMaterial({
    color: '#FFFFFF',
    side: THREE.DoubleSide,
  });
  const butterflyMesh = new THREE.InstancedMesh(wingGeo, wingMat, butterflies.length * 2);
  butterflyMesh.name = 'YardButterflyInstances';
  butterflyMesh.frustumCulled = false;
  butterflyMesh.matrixAutoUpdate = false;
  butterflyMesh.updateMatrix();

  const bColors = [
    new THREE.Color('#FFE58F'),
    new THREE.Color('#F7B8CC'),
    new THREE.Color('#BFE3F7'),
    new THREE.Color('#E3C8F7'),
  ];
  for (let i = 0; i < butterflies.length; i++) {
    const col = bColors[i % bColors.length];
    butterflyMesh.setColorAt(i * 2, col);
    butterflyMesh.setColorAt(i * 2 + 1, col);
  }
  if (butterflyMesh.instanceColor) butterflyMesh.instanceColor.needsUpdate = true;
  root.add(butterflyMesh);

  let grassAccum = 0;

  return {
    root,
    update(elapsed: number, dt: number, weather: WeatherDef, timeHour: number) {
      // Throttled (~24 Hz) zero-alloc wind sway for yard grass
      grassAccum += dt;
      if (grassAccum >= 0.041) {
        grassAccum = 0;
        const swayAmp = 0.08 + weather.windStrength * 0.2;
        const swayFreq = 1.6 + weather.windStrength * 1.8;
        const basePhase = elapsed * swayFreq;
        for (let i = 0; i < compiledGrass.length; i++) {
          const it = compiledGrass[i];
          const wave = Math.sin(basePhase + it.phase + it.x * 0.18) * swayAmp;
          writeGrassShearMatrix(grassArr, i, it, wave, wave * 0.5);
        }
        grassMesh.instanceMatrix.needsUpdate = true;
      }

      // Gentle daytime clear-weather fluttering butterflies
      const showButterflies = weather.id === 'clear' && timeHour >= 6.8 && timeHour <= 19.2;
      butterflyMesh.visible = showButterflies;
      if (!showButterflies) return;

      const bArr = butterflyMesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < butterflies.length; i++) {
        const b = butterflies[i];
        const t = elapsed * b.speed + b.phase;
        const px = b.cx + Math.sin(t) * b.ampX;
        const pz = b.cz + Math.sin(t * 2.0) * 0.5 * b.ampZ;
        const py = b.baseY + Math.sin(t * 2.7 + b.phase) * 0.14;

        // Heading tangent along figure-8 path
        const vx = Math.cos(t) * b.ampX;
        const vz = Math.cos(t * 2.0) * b.ampZ;
        const vLen = Math.hypot(vx, vz) || 1;
        const dirX = vx / vLen;
        const dirZ = vz / vLen;

        const flap = Math.sin(elapsed * b.flapSpeed + b.phase) * 0.82;
        const cf = Math.cos(flap);
        const sf = Math.sin(flap);

        // Right wing (+X rotated by +flap around local Z, then aligned to heading)
        const oR = i * 2 * 16;
        bArr[oR] = dirZ * cf;
        bArr[oR + 1] = sf;
        bArr[oR + 2] = -dirX * cf;
        bArr[oR + 3] = 0;
        bArr[oR + 4] = -dirZ * sf;
        bArr[oR + 5] = cf;
        bArr[oR + 6] = dirX * sf;
        bArr[oR + 7] = 0;
        bArr[oR + 8] = dirX;
        bArr[oR + 9] = 0;
        bArr[oR + 10] = dirZ;
        bArr[oR + 11] = 0;
        bArr[oR + 12] = px;
        bArr[oR + 13] = py;
        bArr[oR + 14] = pz;
        bArr[oR + 15] = 1;

        // Left wing (mirrored across X with symmetric flap)
        const oL = (i * 2 + 1) * 16;
        bArr[oL] = -dirZ * cf;
        bArr[oL + 1] = sf;
        bArr[oL + 2] = dirX * cf;
        bArr[oL + 3] = 0;
        bArr[oL + 4] = dirZ * sf;
        bArr[oL + 5] = cf;
        bArr[oL + 6] = -dirX * sf;
        bArr[oL + 7] = 0;
        bArr[oL + 8] = dirX;
        bArr[oL + 9] = 0;
        bArr[oL + 10] = dirZ;
        bArr[oL + 11] = 0;
        bArr[oL + 12] = px;
        bArr[oL + 13] = py;
        bArr[oL + 14] = pz;
        bArr[oL + 15] = 1;
      }
      butterflyMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      disposeObjectTree(root);
    },
  };
}
