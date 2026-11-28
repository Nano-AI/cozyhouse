import * as THREE from 'three';
import type { FurnitureItemDef, VisitorDef } from '../data/schemas';
import {
  SPECIAL_CHARACTER_IDS,
  createSpecialCharacterRig,
} from '../visitors/SpecialCharacterMeshes';
import { VisitorMesh, type VisitorVariantIndex } from '../visitors/VisitorMesh';
import type { AssetLoader } from './AssetLoader';

type QueuedPreviewJob =
  | {
      kind: 'furniture';
      key: string;
      def: FurnitureItemDef;
      variantId: string;
      glb: THREE.Object3D | null;
      resolve: (dataUrl: string | null) => void;
    }
  | {
      kind: 'visitor';
      key: string;
      def: VisitorDef;
      variantIndex: VisitorVariantIndex;
      resolve: (dataUrl: string | null) => void;
    };

const MAX_RENDERS_PER_FRAME = 4;
const MAX_CACHE_ENTRIES = 300;

function normalizeVisitorVariant(variantIndex = 0): VisitorVariantIndex {
  return ((((Math.floor(variantIndex) % 3) + 3) % 3) as VisitorVariantIndex);
}

/**
 * Offscreen WebGL thumbnail renderer for furniture catalog cards, context bar,
 * surface style pickers, and visitor 3D head-and-shoulders portraits.
 * Renders lazily in a frame-budgeted rAF queue using a single offscreen context,
 * reusable Box3/Vector3 scratch objects, and an LRU-capped data URL cache.
 */
export class ModelPreviewRenderer {
  private readonly assetLoader: AssetLoader;
  private readonly size: number;

  private renderer: THREE.WebGLRenderer | null = null;
  private rendererFailed = false;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);

  // Reusable math scratch objects (zero per-thumbnail allocations)
  private readonly boxScratch = new THREE.Box3();
  private readonly meshBoxScratch = new THREE.Box3();
  private readonly centerScratch = new THREE.Vector3();
  private readonly dirScratch = new THREE.Vector3();
  private readonly cornerScratch = new THREE.Vector3();
  private readonly fallbackMin = new THREE.Vector3(-0.4, 0, -0.4);
  private readonly fallbackMax = new THREE.Vector3(0.4, 0.8, 0.4);
  private readonly visitorCenter = new THREE.Vector3(0, 0.94, 0.02);
  private readonly visitorDir = new THREE.Vector3(0.32, 0.14, 1.0).normalize();
  private readonly rockyDir = new THREE.Vector3(0.32, 0.42, 1.0).normalize();

  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly queue: QueuedPreviewJob[] = [];
  private rafId = 0;
  private disposed = false;

  constructor(assetLoader: AssetLoader, size = 112) {
    this.assetLoader = assetLoader;
    this.size = size;

    const hemi = new THREE.HemisphereLight(0xfff8ef, 0xd8cec2, 1.15);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2dc, 1.1);
    key.position.set(6, 10, 8);
    this.scene.add(key);

    // Offset ~14° off the preview camera's mirror vector so glossy horizontal top faces never blow out to white
    const fill = new THREE.DirectionalLight(0xdce8f7, 0.4);
    fill.position.set(-7.4, 4.4, -4.1);
    this.scene.add(fill);
  }

  private getCacheEntry(key: string): string | null {
    const value = this.cache.get(key);
    if (value === undefined) return null;
    // Promote hot entry to MRU tail
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  private setCacheEntry(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  getCachedPreview(itemId: string, variantId: string): string | null {
    return this.getCacheEntry(`${itemId}__${variantId}`);
  }

  renderPreview(def: FurnitureItemDef, variantId: string): Promise<string | null> {
    if (this.disposed || this.rendererFailed) {
      return Promise.resolve(null);
    }

    const key = `${def.id}__${variantId}`;
    const cached = this.getCacheEntry(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const glb = await this.assetLoader.loadModelLazy(def.model);
      if (this.disposed || this.rendererFailed) {
        return null;
      }
      return new Promise<string | null>((resolve) => {
        this.queue.push({ kind: 'furniture', key, def, variantId, glb, resolve });
        this.scheduleFlush();
      });
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  getCachedVisitorPortrait(visitorId: string, variantIndex = 0): string | null {
    const norm = normalizeVisitorVariant(variantIndex);
    return this.getCacheEntry(`visitor__${visitorId}__${norm}`);
  }

  renderVisitorPortrait(def: VisitorDef, variantIndex = 0): Promise<string | null> {
    if (this.disposed || this.rendererFailed) {
      return Promise.resolve(null);
    }

    const norm = normalizeVisitorVariant(variantIndex);
    const key = `visitor__${def.id}__${norm}`;
    const cached = this.getCacheEntry(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = new Promise<string | null>((resolve) => {
      this.queue.push({ kind: 'visitor', key, def, variantIndex: norm, resolve });
      this.scheduleFlush();
    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    if (this.rendererFailed || this.disposed) return null;

    try {
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(this.size, this.size, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;
      return renderer;
    } catch {
      this.rendererFailed = true;
      return null;
    }
  }

  private scheduleFlush(): void {
    if (this.rafId !== 0 || this.disposed) return;
    this.rafId = requestAnimationFrame(this.flushQueue);
  }

  private flushQueue = (): void => {
    this.rafId = 0;
    if (this.disposed) return;

    let rendered = 0;
    while (this.queue.length > 0 && rendered < MAX_RENDERS_PER_FRAME) {
      const job = this.queue.shift()!;
      const dataUrl =
        job.kind === 'visitor'
          ? this.renderVisitorSingle(job.def, job.variantIndex)
          : this.renderSingle(job.def, job.variantId, job.glb);
      if (dataUrl) {
        this.setCacheEntry(job.key, dataUrl);
      }
      job.resolve(dataUrl);
      rendered += 1;
    }

    if (this.queue.length > 0 && !this.disposed) {
      this.scheduleFlush();
    } else if (this.renderer) {
      // Release transient render list object references once idle
      this.renderer.renderLists.dispose();
    }
  };

  private writeViewDirection(def: FurnitureItemDef, out: THREE.Vector3): THREE.Vector3 {
    if (def.layer === 'wall' && def.wallKind === 'structure') {
      return out.set(0.55, 0.42, 1.15).normalize();
    }
    if (def.layer === 'wall' && def.wallKind === 'mounted') {
      return out.set(0.45, 0.3, 1.2).normalize();
    }
    if (def.layer === 'ceiling') {
      return out.set(1, 0.42, 1).normalize();
    }
    if (def.layer === 'floor' && (def.subLayer === 'tile' || def.subLayer === 'rug')) {
      return out.set(1, 1.05, 1).normalize();
    }
    return out.set(1, 0.82, 1).normalize();
  }

  private frameCamera(box: THREE.Box3, def: FurnitureItemDef): void {
    box.getCenter(this.centerScratch);
    this.writeViewDirection(def, this.dirScratch);

    this.camera.position.copy(this.centerScratch).addScaledVector(this.dirScratch, 20);
    this.camera.lookAt(this.centerScratch);
    this.camera.updateMatrixWorld(true);

    const { min, max } = box;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let ix = 0; ix < 2; ix++) {
      const x = ix === 0 ? min.x : max.x;
      for (let iy = 0; iy < 2; iy++) {
        const y = iy === 0 ? min.y : max.y;
        for (let iz = 0; iz < 2; iz++) {
          const z = iz === 0 ? min.z : max.z;
          this.cornerScratch.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          if (this.cornerScratch.x < minX) minX = this.cornerScratch.x;
          if (this.cornerScratch.x > maxX) maxX = this.cornerScratch.x;
          if (this.cornerScratch.y < minY) minY = this.cornerScratch.y;
          if (this.cornerScratch.y > maxY) maxY = this.cornerScratch.y;
        }
      }
    }

    const span = Math.max(maxX - minX, maxY - minY, 0.25) * 1.16;
    const half = span / 2;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    this.camera.left = cx - half;
    this.camera.right = cx + half;
    this.camera.top = cy + half;
    this.camera.bottom = cy - half;
    this.camera.near = 0.1;
    this.camera.far = 60;
    this.camera.updateProjectionMatrix();
  }

  private disposeTemporaryMesh(root: THREE.Object3D): void {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        if (obj.geometry && !obj.geometry.userData?.sharedGeo) {
          geos.add(obj.geometry);
        }
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) {
            if (m && !m.userData?.sharedMat) mats.add(m);
          }
        } else if (obj.material && !obj.material.userData?.sharedMat) {
          mats.add(obj.material);
        }
      }
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }

  private renderSingle(
    def: FurnitureItemDef,
    variantId: string,
    glb: THREE.Object3D | null,
  ): string | null {
    const renderer = this.ensureRenderer();
    if (!renderer) return null;

    const mesh =
      glb ??
      this.assetLoader.createPlaceholderMesh(def, variantId, {
        hideLabel: true,
        active: def.interaction?.type === 'toggle' && def.tags.includes('light'),
      });

    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);

    try {
      this.boxScratch.setFromObject(mesh);
      if (this.boxScratch.isEmpty()) {
        this.boxScratch.set(this.fallbackMin, this.fallbackMax);
      }
      this.frameCamera(this.boxScratch, def);
      renderer.render(this.scene, this.camera);
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    } finally {
      this.scene.remove(mesh);
      if (!glb) {
        this.disposeTemporaryMesh(mesh);
      }
    }
  }

  private computeVisibleBounds(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
    out.makeEmpty();
    const walk = (obj: THREE.Object3D): void => {
      if (!obj.visible) return;
      if (obj instanceof THREE.Mesh && obj.geometry) {
        if (!obj.geometry.boundingBox) {
          obj.geometry.computeBoundingBox();
        }
        if (obj.geometry.boundingBox) {
          this.meshBoxScratch.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
          out.union(this.meshBoxScratch);
        }
      }
      for (let i = 0; i < obj.children.length; i++) {
        walk(obj.children[i]);
      }
    };
    walk(root);
    return out;
  }

  private framePortraitFromBox(
    box: THREE.Box3,
    viewDir: THREE.Vector3,
    padScale: number,
    minHalf: number,
  ): void {
    box.getCenter(this.centerScratch);
    this.camera.position.copy(this.centerScratch).addScaledVector(viewDir, 12);
    this.camera.lookAt(this.centerScratch);
    this.camera.updateMatrixWorld(true);

    const { min, max } = box;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let ix = 0; ix < 2; ix++) {
      const x = ix === 0 ? min.x : max.x;
      for (let iy = 0; iy < 2; iy++) {
        const y = iy === 0 ? min.y : max.y;
        for (let iz = 0; iz < 2; iz++) {
          const z = iz === 0 ? min.z : max.z;
          this.cornerScratch.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
          if (this.cornerScratch.x < minX) minX = this.cornerScratch.x;
          if (this.cornerScratch.x > maxX) maxX = this.cornerScratch.x;
          if (this.cornerScratch.y < minY) minY = this.cornerScratch.y;
          if (this.cornerScratch.y > maxY) maxY = this.cornerScratch.y;
        }
      }
    }

    const half = Math.max(minHalf, (Math.max(maxX - minX, maxY - minY) * padScale) / 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    this.camera.left = cx - half;
    this.camera.right = cx + half;
    this.camera.top = cy + half;
    this.camera.bottom = cy - half;
    this.camera.near = 0.1;
    this.camera.far = 40;
    this.camera.updateProjectionMatrix();
  }

  private renderVisitorSingle(
    def: VisitorDef,
    variantIndex: VisitorVariantIndex,
  ): string | null {
    const renderer = this.ensureRenderer();
    if (!renderer) return null;

    if (SPECIAL_CHARACTER_IDS.has(def.id)) {
      const rig = createSpecialCharacterRig(def.id);
      if (rig) {
        rig.setPose('idle');
        rig.update(0, 0, 0);
        this.scene.add(rig.root);
        rig.root.updateMatrixWorld(true);

        try {
          this.computeVisibleBounds(rig.root, this.boxScratch);
          if (this.boxScratch.isEmpty()) {
            this.boxScratch.set(this.fallbackMin, this.fallbackMax);
          }

          if (def.id === 'rocky') {
            // Full-body 3/4 portrait for Rocky's pentagonal carapace + 5 articulated legs
            this.framePortraitFromBox(this.boxScratch, this.rockyDir, 1.14, 0.42);
          } else {
            // Head & upper-shoulders 3/4 portrait preserving horns, comb, and tall hair cleanly
            const topY = this.boxScratch.max.y;
            this.boxScratch.min.y = Math.max(this.boxScratch.min.y, topY - 0.66);
            this.framePortraitFromBox(this.boxScratch, this.visitorDir, 1.12, 0.34);
          }

          renderer.render(this.scene, this.camera);
          return renderer.domElement.toDataURL('image/png');
        } catch {
          return null;
        } finally {
          this.scene.remove(rig.root);
          rig.dispose();
        }
      }
    }

    const visitor = new VisitorMesh(def, variantIndex);
    visitor.speechBubble.sprite.visible = false;
    this.scene.add(visitor.root);
    visitor.root.updateMatrixWorld(true);

    try {
      // Head-and-shoulders 3/4 portrait framing
      this.camera.position.copy(this.visitorCenter).addScaledVector(this.visitorDir, 12);
      this.camera.lookAt(this.visitorCenter);
      this.camera.updateMatrixWorld(true);

      const half = 0.34;
      this.camera.left = -half;
      this.camera.right = half;
      this.camera.top = half;
      this.camera.bottom = -half;
      this.camera.near = 0.1;
      this.camera.far = 40;
      this.camera.updateProjectionMatrix();

      renderer.render(this.scene, this.camera);
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    } finally {
      this.scene.remove(visitor.root);
      visitor.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.resolve(null);
    }
    this.inflight.clear();
    this.cache.clear();
    if (this.renderer) {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
