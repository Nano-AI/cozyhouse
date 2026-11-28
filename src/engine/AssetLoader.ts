import * as THREE from 'three';
import type { FurnitureItemDef, FurnitureVariant, GameDataBundle } from '../data/schemas';
import { buildFurnitureModel } from '../models';
import type { MergeSide, ModelBuildOptions } from '../models/ModelKit';

export type AssetBuildOptions = ModelBuildOptions & {
  wallSurfaceColor?: string;
  wallSurfaceAccent?: string;
};

/**
 * Lazy asset & sculpted low-poly 3D model factory with prototype caching.
 *
 * Delegates every catalog item (placed in-world, ghost previews, and offscreen
 * UI thumbnails) to the unified procedural 3D model library (`src/models/`)
 * with zero floating text labels.
 *
 * Non-ghost prototypes are cached by `${def.id}__${variant.id}__${active ? 1 : 0}__${mergeSide ?? 'none'}`:
 * - Geometries are marked `userData.sharedGeo = true` and shared across all instances.
 * - Non-wall static items also share materials (`userData.sharedMat = true`).
 * - Structural walls & wall-mounted items clone materials per instance so per-wall
 *   cutaway opacity fading and corner anti-z-fighting never affect sibling walls.
 *
 * `loadModelLazy()` stays wired for optional compressed glTF/GLB swaps.
 */
export class AssetLoader {
  private readonly data: GameDataBundle;
  private glbCache = new Map<string, Promise<THREE.Object3D | null>>();
  private prototypeCache = new Map<string, THREE.Group>();
  /** Set true when compressed `.glb` models are deployed under `public/models/`. */
  private enableGlbLoading = false;

  constructor(data: GameDataBundle) {
    this.data = data;
  }

  setGlbLoadingEnabled(enabled: boolean): void {
    this.enableGlbLoading = enabled;
  }

  getPrototypeCacheSize(): number {
    return this.prototypeCache.size;
  }

  private resolveVariant(def: FurnitureItemDef, variantId: string): FurnitureVariant {
    return def.variants.find((v) => v.id === variantId) ?? def.variants[0];
  }

  /**
   * Returns the cached read-only prototype `THREE.Group` for
   * `(def.id, variantId, active, mergeSide, wallSurfaceColor, wallSurfaceAccent)`.
   * Callers MUST NOT mutate the returned prototype or attach it directly to the scene.
   */
  getOrBuildPrototype(
    def: FurnitureItemDef,
    variantId: string,
    active = false,
    mergeSide?: MergeSide,
    wallSurfaceColor?: string,
    wallSurfaceAccent?: string,
  ): THREE.Group {
    const variant = this.resolveVariant(def, variantId);
    const wallStyleSuffix =
      wallSurfaceColor || wallSurfaceAccent
        ? `__ws:${wallSurfaceColor ?? ''}:${wallSurfaceAccent ?? ''}`
        : '';
    const key = `${def.id}__${variant.id}__${active ? 1 : 0}__${mergeSide ?? 'none'}${wallStyleSuffix}`;
    const cached = this.prototypeCache.get(key);
    if (cached) {
      return cached;
    }

    const tabColor = this.data.tabsById.get(def.tab)?.color ?? '#D8CFC2';
    const buildOpts: AssetBuildOptions = {
      active,
      mergeSide,
      ...(wallSurfaceColor !== undefined ? { wallSurfaceColor } : {}),
      ...(wallSurfaceAccent !== undefined ? { wallSurfaceAccent } : {}),
    };
    const proto = buildFurnitureModel(def, variant, tabColor, buildOpts);
    proto.updateMatrixWorld(true);

    const shareMaterials = def.layer !== 'wall';
    proto.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        if (obj.geometry) {
          obj.geometry.userData.sharedGeo = true;
        }
        if (shareMaterials) {
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) {
              if (m) m.userData.sharedMat = true;
            }
          } else if (obj.material) {
            obj.material.userData.sharedMat = true;
          }
        }
      }
    });

    this.prototypeCache.set(key, proto);
    return proto;
  }

  private clonePrototypeInstance(proto: THREE.Group, cloneMaterials: boolean): THREE.Group {
    const instance = proto.clone(true);
    if (!cloneMaterials) {
      return instance;
    }

    const clonedMats = new Map<THREE.Material, THREE.Material>();
    const cloneMat = (mat: THREE.Material): THREE.Material => {
      let copy = clonedMats.get(mat);
      if (!copy) {
        copy = mat.clone();
        // Per-wall cloned materials are owned by the wall instance and disposed with it
        delete copy.userData.sharedMat;
        delete copy.userData.baseOpacity;
        delete copy.userData.baseTransparent;
        delete copy.userData.baseDepthWrite;
        clonedMats.set(mat, copy);
      }
      return copy;
    };

    instance.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((m) => cloneMat(m));
        } else if (obj.material) {
          obj.material = cloneMat(obj.material);
        }
      }
    });

    return instance;
  }

  /**
   * Builds (or clones from cache) a sculpted flat-shaded low-poly 3D Group for the given
   * catalog item and variant. Local origin is centered in X/Z at the item's base (y = 0),
   * except ceiling items which hang downward from y = 0.
   */
  createPlaceholderMesh(
    def: FurnitureItemDef,
    variantId: string,
    options?: AssetBuildOptions,
  ): THREE.Group {
    if (options?.ghost) {
      const variant = this.resolveVariant(def, variantId);
      const tabColor = this.data.tabsById.get(def.tab)?.color ?? '#D8CFC2';
      return buildFurnitureModel(def, variant, tabColor, options);
    }

    const proto = this.getOrBuildPrototype(
      def,
      variantId,
      Boolean(options?.active),
      options?.mergeSide,
      options?.wallSurfaceColor,
      options?.wallSurfaceAccent,
    );
    return this.clonePrototypeInstance(proto, def.layer === 'wall');
  }

  /**
   * Lazy GLB model loader hook. Never downloads models up front.
   * Returns `null` when GLB loading is disabled or when a model file does not yet exist.
   */
  async loadModelLazy(modelPath: string): Promise<THREE.Object3D | null> {
    if (!this.enableGlbLoading) return null;
    const cached = this.glbCache.get(modelPath);
    if (cached) {
      const resolved = await cached;
      return resolved ? resolved.clone(true) : null;
    }

    const promise = (async () => {
      try {
        const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        ]);
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(`./${modelPath}`);
        return gltf.scene;
      } catch {
        return null;
      }
    })();

    this.glbCache.set(modelPath, promise);
    const resolved = await promise;
    return resolved ? resolved.clone(true) : null;
  }

  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    for (const proto of this.prototypeCache.values()) {
      proto.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          if (obj.geometry) geos.add(obj.geometry);
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) {
              if (m) mats.add(m);
            }
          } else if (obj.material) {
            mats.add(obj.material);
          }
        }
      });
    }
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.prototypeCache.clear();
    this.glbCache.clear();
  }
}
