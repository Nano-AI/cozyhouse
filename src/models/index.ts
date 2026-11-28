import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CatalogTabId, FurnitureItemDef, FurnitureVariant } from '../data/schemas';
import {
  FLOOR_BASE_Y,
  createModelContext,
  type ModelBuildOptions,
  type ModelContext,
  type TabModelBuilder,
} from './ModelKit';
import { buildBasicsModel } from './basicsModels';
import { buildCafeBarModel } from './cafeBarModels';
import { buildDecorModel } from './decorModels';
import { buildKitchenModel } from './kitchenModels';
import { buildLivingModel } from './livingModels';
import { buildPartyModel } from './partyModels';
import { buildPetsModel } from './petsModels';

const BUILDERS_BY_TAB: Record<CatalogTabId, TabModelBuilder> = {
  basics: buildBasicsModel,
  living: buildLivingModel,
  kitchen: buildKitchenModel,
  cafe_bar: buildCafeBarModel,
  party: buildPartyModel,
  decor: buildDecorModel,
  pets: buildPetsModel,
};

function buildFallbackModel(ctx: ModelContext): void {
  const { def, primary, accent } = ctx;
  const [fw, fd] = def.footprint;
  const h = Math.max(0.06, def.height);

  if (def.layer === 'floor' && def.subLayer === 'tile') {
    ctx.box(fw - 0.004, 0.02, fd - 0.004, primary, 0, 0.014, 0, {
      castShadow: false,
    });
    return;
  }

  if (def.layer === 'floor' && def.subLayer === 'rug') {
    ctx.box(fw - 0.1, 0.016, fd - 0.1, primary, 0, 0.032 + 0.008, 0, { castShadow: false });
    return;
  }

  if (def.layer === 'wall' && def.wallKind === 'structure') {
    ctx.box(1.0, h, 0.14, primary, 0, h / 2, 0);
    return;
  }

  if (def.layer === 'wall' && def.wallKind === 'mounted') {
    ctx.box(fw * 0.72, h, 0.1, primary, 0, 0, 0.05, { name: 'SpinTarget' });
    return;
  }

  if (def.layer === 'ceiling') {
    const stemH = Math.min(0.28, h * 0.4);
    ctx.cyl(0.02, 0.02, stemH, 6, accent, 0, -stemH / 2, 0);
    const bodyH = Math.max(0.16, h - stemH);
    ctx.cyl(fw * 0.22, fw * 0.28, bodyH, 8, primary, 0, -stemH - bodyH / 2, 0, {
      name: 'SpinTarget',
    });
    return;
  }

  const baseY = def.layer === 'floor' ? FLOOR_BASE_Y : 0;
  const inset = def.layer === 'surface' ? 0.28 : 0.14;
  const bw = Math.max(0.24, fw - inset);
  const bd = Math.max(0.24, fd - inset);
  ctx.box(bw, h, bd, primary, 0, baseY + h / 2, 0, { name: 'SpinTarget' });
  ctx.box(bw * 0.92, Math.min(0.05, h * 0.14), bd * 0.92, accent, 0, baseY + h + 0.01, 0);
}

const DYNAMIC_SUBTREE_NAMES = new Set(['SpinTarget', 'DoorPivot', 'ToiletLidPivot']);

function isInsideDynamicSubtree(obj: THREE.Object3D, root: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur && cur !== root) {
    if (DYNAMIC_SUBTREE_NAMES.has(cur.name)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * Bucket signature groups static meshes that can share a single draw call via
 * baked linear vertex colors (identical shading params, opacity, emissive, shadow flags).
 */
function getMergeSignature(mesh: THREE.Mesh): string | null {
  if (Array.isArray(mesh.material)) return null;
  const mat = mesh.material;
  const shadowKey = `${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;

  if (mat instanceof THREE.MeshStandardMaterial) {
    if (mat.alphaMap || mat.normalMap || mat.roughnessMap || mat.vertexColors) {
      return null;
    }
    // Quantize roughness/metalness to 0.05 steps so matte pastel surfaces coalesce cleanly
    const roughQ = Math.round(mat.roughness * 20);
    const metalQ = Math.round(mat.metalness * 20);
    return [
      'std',
      roughQ,
      metalQ,
      mat.flatShading ? 1 : 0,
      Math.round(mat.opacity * 1000),
      mat.transparent ? 1 : 0,
      mat.depthWrite ? 1 : 0,
      mat.side,
      mat.emissive.getHexString(),
      Math.round(mat.emissiveIntensity * 1000),
      mat.map?.uuid ?? '',
      mat.bumpMap?.uuid ?? '',
      Math.round((mat.bumpScale ?? 0) * 1000),
      shadowKey,
    ].join('|');
  }

  if (mat instanceof THREE.MeshBasicMaterial) {
    if (mat.map || mat.alphaMap || mat.vertexColors) return null;
    return [
      'basic',
      Math.round(mat.opacity * 1000),
      mat.transparent ? 1 : 0,
      mat.depthWrite ? 1 : 0,
      mat.side,
      mat.blending,
      shadowKey,
    ].join('|');
  }

  return null;
}

function ensureBoxProjectedUvs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    if (ny >= nx && ny >= nz) {
      uvs[i * 2] = px;
      uvs[i * 2 + 1] = pz;
    } else if (nx >= nz) {
      uvs[i * 2] = pz;
      uvs[i * 2 + 1] = py;
    } else {
      uvs[i * 2] = px;
      uvs[i * 2 + 1] = py;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function normalizeForMerge(
  geo: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  bakeColor: THREE.Color | null,
  keepUv: boolean,
): THREE.BufferGeometry | null {
  if (!geo.getAttribute('position')) return null;
  let working = geo.clone();
  working.applyMatrix4(worldMatrix);
  if (working.index !== null) {
    const nonIndexed = working.toNonIndexed();
    working.dispose();
    working = nonIndexed;
  }
  if (!working.getAttribute('normal')) {
    working.computeVertexNormals();
  }
  for (const attrName of Object.keys(working.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && !(keepUv && attrName === 'uv')) {
      working.deleteAttribute(attrName);
    }
  }
  if (keepUv && !working.getAttribute('uv')) {
    ensureBoxProjectedUvs(working);
  }
  if (bakeColor) {
    const count = working.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const r = bakeColor.r;
    const g = bakeColor.g;
    const b = bakeColor.b;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
    }
    working.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return working;
}

interface MergeBucket {
  templateMat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  castShadow: boolean;
  receiveShadow: boolean;
  meshes: THREE.Mesh[];
}

/**
 * Merges static non-animated sub-meshes sharing shading/shadow parameters into
 * a single vertex-colored draw call per material group, cutting draw calls 6x-10x
 * while leaving SpinTarget and DoorPivot subtrees completely intact.
 */
function mergeStaticMeshes(group: THREE.Group): void {
  group.updateMatrixWorld(true);

  const buckets = new Map<string, MergeBucket>();
  const keptMaterials = new Set<THREE.Material>();

  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh) return;
    if (isInsideDynamicSubtree(obj, group)) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => keptMaterials.add(m));
      else keptMaterials.add(obj.material);
      return;
    }

    const sig = getMergeSignature(obj);
    if (!sig) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => keptMaterials.add(m));
      else keptMaterials.add(obj.material);
      return;
    }

    let bucket = buckets.get(sig);
    if (!bucket) {
      bucket = {
        templateMat: obj.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
        castShadow: obj.castShadow,
        receiveShadow: obj.receiveShadow,
        meshes: [],
      };
      buckets.set(sig, bucket);
    }
    bucket.meshes.push(obj);
  });

  // Preserve materials referenced by single-mesh buckets
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) {
      keptMaterials.add(bucket.templateMat);
    }
  }

  const discardedMaterials = new Set<THREE.Material>();

  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;

    // Check if all meshes in this bucket share the exact same color
    const firstHex = bucket.templateMat.color.getHex();
    let multiColor = false;
    for (let i = 1; i < bucket.meshes.length; i++) {
      const m = bucket.meshes[i].material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if (m.color.getHex() !== firstHex) {
        multiColor = true;
        break;
      }
    }

    const keepUv =
      bucket.templateMat instanceof THREE.MeshStandardMaterial
        ? Boolean(bucket.templateMat.map || bucket.templateMat.bumpMap)
        : Boolean(bucket.templateMat.map);

    const geos: THREE.BufferGeometry[] = [];
    let valid = true;
    for (const mesh of bucket.meshes) {
      const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      const norm = normalizeForMerge(
        mesh.geometry,
        mesh.matrixWorld,
        multiColor ? m.color : null,
        keepUv,
      );
      if (!norm) {
        valid = false;
        break;
      }
      geos.push(norm);
    }

    if (!valid || geos.length < 2) {
      geos.forEach((g) => g.dispose());
      keptMaterials.add(bucket.templateMat);
      continue;
    }

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) {
      keptMaterials.add(bucket.templateMat);
      continue;
    }

    let finalMat: THREE.Material;
    if (multiColor) {
      if (bucket.templateMat instanceof THREE.MeshStandardMaterial) {
        const tm = bucket.templateMat;
        finalMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: tm.roughness,
          metalness: tm.metalness,
          flatShading: tm.flatShading,
          transparent: tm.transparent,
          opacity: tm.opacity,
          depthWrite: tm.depthWrite,
          side: tm.side,
          emissive: tm.emissive.clone(),
          emissiveIntensity: tm.emissiveIntensity,
          map: tm.map,
          bumpMap: tm.bumpMap,
          bumpScale: tm.bumpScale,
        });
      } else {
        const tm = bucket.templateMat;
        finalMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: tm.transparent,
          opacity: tm.opacity,
          depthWrite: tm.depthWrite,
          side: tm.side,
          blending: tm.blending,
        });
      }
    } else {
      finalMat = bucket.templateMat;
      keptMaterials.add(finalMat);
    }

    for (const mesh of bucket.meshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material;
      if (!keptMaterials.has(mat)) {
        discardedMaterials.add(mat);
      }
    }

    const mergedMesh = new THREE.Mesh(merged, finalMat);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    group.add(mergedMesh);
  }

  for (const m of discardedMaterials) {
    m.dispose();
  }

  // Prune any empty non-animated helper groups left after merging
  const pruneEmptyGroups = (parent: THREE.Object3D): void => {
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const child = parent.children[i];
      if (child instanceof THREE.Group && !DYNAMIC_SUBTREE_NAMES.has(child.name)) {
        pruneEmptyGroups(child);
        if (child.children.length === 0) {
          parent.remove(child);
        }
      }
    }
  };
  pruneEmptyGroups(group);
}

export function buildFurnitureModel(
  def: FurnitureItemDef,
  variant: FurnitureVariant,
  tabColor: string,
  options?: ModelBuildOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Item_${def.id}`;

  const ctx = createModelContext(group, def, variant, tabColor, options);
  const builder = BUILDERS_BY_TAB[def.tab];
  const handled = builder ? builder(ctx) : false;

  if (!handled) {
    buildFallbackModel(ctx);
  }

  // Enforce shadow safety across all builders (including any raw THREE.Mesh children):
  // ceiling items, ghost previews, and active emissive light meshes never cast dark stray shadows.
  const isCeiling = def.layer === 'ceiling';
  const isActive = Boolean(options?.active);
  const isGhost = Boolean(options?.ghost);
  if (isCeiling || isActive || isGhost) {
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (isGhost || isCeiling) {
        obj.castShadow = false;
        return;
      }
      if (isActive) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const hasEmissive = mats.some(
          (m) =>
            m instanceof THREE.MeshStandardMaterial &&
            m.emissive.getHex() !== 0 &&
            m.emissiveIntensity > 0,
        );
        if (hasEmissive) {
          obj.castShadow = false;
        }
      }
    });
  }

  // Merge static sub-meshes by shading + shadow signature (with linear vertex color baking)
  mergeStaticMeshes(group);

  return group;
}

export { FLOOR_BASE_Y, createModelContext } from './ModelKit';
export type { MergeSide, ModelBuildOptions, ModelContext, TabModelBuilder } from './ModelKit';
