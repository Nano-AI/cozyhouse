import * as THREE from 'three';
import type { FurnitureItemDef, FurnitureVariant } from '../data/schemas';
import { getSurfaceTextures, inferSurfaceTextureKind } from './TextureKit';

export const FLOOR_BASE_Y = 0.024;
export const MAX_METALNESS = 0.42;

export type MergeSide = 'left' | 'right' | 'middle';

export interface ModelBuildOptions {
  ghost?: boolean;
  ghostColor?: string;
  active?: boolean;
  hideLabel?: boolean;
  mergeSide?: MergeSide;
  wallSurfaceColor?: string;
  wallSurfaceAccent?: string;
}

export interface MatOptions {
  roughness?: number;
  metalness?: number;
  emissive?: string | number;
  emissiveIntensity?: number;
  opacity?: number;
  flatShading?: boolean;
}

export interface MeshOptions extends MatOptions {
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  name?: string;
  parent?: THREE.Object3D;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** `torus` only: sweep angle in radians (default full circle). */
  arc?: number;
  /** `sphere` only: polar sweep from the top pole (Math.PI / 2 = upper dome); rings scale with it. */
  thetaLength?: number;
  /** `sphere` only: explicit ring count along the polar sweep. */
  rings?: number;
}

export interface ModelContext {
  group: THREE.Group;
  def: FurnitureItemDef;
  variant: FurnitureVariant;
  primary: string;
  accent: string;
  isGhost: boolean;
  isActive: boolean;
  mergeSide?: MergeSide;
  wallSurfaceColor?: string;
  wallSurfaceAccent?: string;
  mat(color: string | number, opts?: MatOptions): THREE.MeshStandardMaterial;
  box(
    w: number,
    h: number,
    d: number,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh;
  cyl(
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh;
  sphere(
    r: number,
    segs: number,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh;
  cone(
    r: number,
    h: number,
    segs: number,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh;
  torus(
    r: number,
    tube: number,
    radialSegs: number,
    tubularSegs: number,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh;
  legs(
    w: number,
    d: number,
    h: number,
    radius: number,
    color: string | number,
    baseY?: number,
    inset?: number,
  ): void;
  shade(hex: string, amt: number): string;
}

export type TabModelBuilder = (ctx: ModelContext) => boolean;

const WHITE = new THREE.Color(0xffffff);
const BLACK = new THREE.Color(0x000000);

export function shadeHex(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const norm = Math.abs(amt) > 1 ? amt / 100 : amt;
  const clamped = Math.max(-1, Math.min(1, norm));
  if (clamped >= 0) {
    c.lerp(WHITE, clamped);
  } else {
    c.lerp(BLACK, -clamped);
  }
  return `#${c.getHexString()}`;
}

export function createModelContext(
  group: THREE.Group,
  def: FurnitureItemDef,
  variant: FurnitureVariant,
  tabColor: string,
  options?: ModelBuildOptions,
): ModelContext {
  const isGhost = Boolean(options?.ghost);
  const isActive = Boolean(options?.active);
  const ghostColor = options?.ghostColor;
  const primary = ghostColor ?? variant.color;
  const accent = ghostColor ?? variant.accentColor ?? tabColor;

  const matCache = new Map<string, THREE.MeshStandardMaterial>();

  const mat = (color: string | number, opts?: MatOptions): THREE.MeshStandardMaterial => {
    const resolvedColor = isGhost && ghostColor ? ghostColor : color;
    const baseOpacity = opts?.opacity ?? 1;
    const opacity = isGhost ? Math.min(baseOpacity, 0.55) : baseOpacity;
    const transparent = isGhost || opacity < 1;
    const roughness = opts?.roughness ?? 0.78;
    const rawMetalness = opts?.metalness ?? 0.04;
    const metalness = Math.max(0, Math.min(MAX_METALNESS, rawMetalness));
    const flatShading = opts?.flatShading ?? true;
    const depthWrite = isGhost ? true : opacity >= 0.7;
    const hasEmissive = !isGhost && opts?.emissive !== undefined;
    const emissiveHex = hasEmissive ? new THREE.Color(opts!.emissive!).getHexString() : '';
    const emissiveIntensity = hasEmissive ? (opts?.emissiveIntensity ?? 0.55) : 0;

    const colorObj = new THREE.Color(resolvedColor);
    const texKind = inferSurfaceTextureKind(
      def,
      roughness,
      rawMetalness,
      opacity,
      isGhost,
      hasEmissive,
    );
    const cacheKey = `${colorObj.getHexString()}|${Math.round(roughness * 1000)}|${Math.round(metalness * 1000)}|${flatShading ? 1 : 0}|${Math.round(opacity * 1000)}|${transparent ? 1 : 0}|${depthWrite ? 1 : 0}|${emissiveHex}|${Math.round(emissiveIntensity * 1000)}|${texKind ?? ''}`;

    const cached = matCache.get(cacheKey);
    if (cached) return cached;

    const texPair = texKind ? getSurfaceTextures(texKind) : null;

    const material = new THREE.MeshStandardMaterial({
      color: colorObj,
      roughness,
      metalness,
      flatShading,
      transparent,
      opacity,
      depthWrite,
      map: texPair?.map ?? null,
      bumpMap: texPair?.bumpMap ?? null,
      bumpScale: texPair?.bumpScale ?? 0,
    });

    if (hasEmissive) {
      material.emissive = new THREE.Color(opts!.emissive!);
      material.emissiveIntensity = emissiveIntensity;
    }

    matCache.set(cacheKey, material);
    return material;
  };

  const placeMesh = (
    geometry: THREE.BufferGeometry,
    color: string | number,
    x: number,
    y: number,
    z: number,
    opts?: MeshOptions,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, mat(color, opts));
    mesh.position.set(x, y, z);
    if (opts?.rotX) mesh.rotation.x = opts.rotX;
    if (opts?.rotY) mesh.rotation.y = opts.rotY;
    if (opts?.rotZ) mesh.rotation.z = opts.rotZ;
    if (opts?.scaleX !== undefined || opts?.scaleY !== undefined || opts?.scaleZ !== undefined) {
      mesh.scale.set(opts.scaleX ?? 1, opts.scaleY ?? 1, opts.scaleZ ?? 1);
    }
    const isGlowing = isActive && opts?.emissive !== undefined;
    const defaultCast = def.layer !== 'ceiling';
    mesh.castShadow = !isGhost && !isGlowing && (opts?.castShadow ?? defaultCast);
    mesh.receiveShadow = !isGhost && (opts?.receiveShadow ?? true);
    if (opts?.name) mesh.name = opts.name;
    (opts?.parent ?? group).add(mesh);
    return mesh;
  };

  const box: ModelContext['box'] = (w, h, d, color, x, y, z, opts) =>
    placeMesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, opts);

  const cyl: ModelContext['cyl'] = (rTop, rBot, h, segs, color, x, y, z, opts) =>
    placeMesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), color, x, y, z, opts);

  const sphere: ModelContext['sphere'] = (r, segs, color, x, y, z, opts) => {
    const theta = opts?.thetaLength;
    const rings =
      opts?.rings ??
      (theta ? Math.max(2, Math.round((segs * 0.75 * theta) / Math.PI)) : Math.max(4, Math.round(segs * 0.75)));
    return placeMesh(
      new THREE.SphereGeometry(r, segs, rings, 0, Math.PI * 2, 0, theta ?? Math.PI),
      color,
      x,
      y,
      z,
      opts,
    );
  };

  const cone: ModelContext['cone'] = (r, h, segs, color, x, y, z, opts) =>
    placeMesh(new THREE.ConeGeometry(r, h, segs), color, x, y, z, opts);

  const torus: ModelContext['torus'] = (r, tube, radialSegs, tubularSegs, color, x, y, z, opts) =>
    placeMesh(new THREE.TorusGeometry(r, tube, radialSegs, tubularSegs, opts?.arc), color, x, y, z, opts);

  const legs: ModelContext['legs'] = (
    w,
    d,
    h,
    radius,
    color,
    baseY = FLOOR_BASE_Y,
    inset = 0.08,
  ) => {
    const ox = Math.max(0.02, w / 2 - inset);
    const oz = Math.max(0.02, d / 2 - inset);
    const cy = baseY + h / 2;
    for (const sx of [-ox, ox]) {
      for (const sz of [-oz, oz]) {
        cyl(radius, radius * 0.88, h, 6, color, sx, cy, sz);
      }
    }
  };

  return {
    group,
    def,
    variant,
    primary,
    accent,
    isGhost,
    isActive,
    mergeSide: options?.mergeSide,
    wallSurfaceColor: options?.wallSurfaceColor,
    wallSurfaceAccent: options?.wallSurfaceAccent,
    mat,
    box,
    cyl,
    sphere,
    cone,
    torus,
    legs,
    shade: shadeHex,
  };
}
