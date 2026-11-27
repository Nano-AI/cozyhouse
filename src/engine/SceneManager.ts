import * as THREE from 'three';
import type { GameDataBundle, HouseState, PlacedItem, SceneryViewDef, WeatherDef } from '../data/schemas';
import type { HouseStore } from '../state/houseStore';
import { AssetLoader } from './AssetLoader';
import {
  GridVisual,
  WALL_THICKNESS,
  getEffectiveFootprint,
  tileToWorldCenter,
  wallEdgeToWorldTransform,
} from './GridSystem';
import { IsometricCamera } from './IsometricCamera';

interface RenderedItemEntry {
  uid: string;
  item: PlacedItem;
  group: THREE.Group;
  bounceTime: number;
}

export class SceneManager {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly isoCamera: IsometricCamera;
  readonly assetLoader: AssetLoader;
  readonly gridVisual: GridVisual;
  readonly itemsRoot = new THREE.Group();
  readonly overlayRoot = new THREE.Group();

  private readonly store: HouseStore;
  private readonly data: GameDataBundle;
  private readonly ambientLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;

  private renderedItems = new Map<string, RenderedItemEntry>();
  private selectionRing: THREE.LineLoop;
  private rafId = 0;
  private lastTime = performance.now();
  private tickHooks = new Set<(dt: number) => void>();
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    store: HouseStore,
    onCameraQuarterChange?: (quarter: number) => void,
  ) {
    this.container = container;
    this.store = store;
    this.data = store.data;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#EFECE4');

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    container.appendChild(this.renderer.domElement);

    this.isoCamera = new IsometricCamera(width, height, onCameraQuarterChange);
    const initialState = store.getState();
    this.isoCamera.setPanLimit(initialState.gridWidth, initialState.gridDepth);

    // Warm indoor/diorama lighting with soft shadows
    this.ambientLight = new THREE.HemisphereLight(0xfff7ed, 0xd8cec2, 0.95);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 1.18);
    this.sunLight.position.set(14, 22, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 60;
    const d = 14;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0xdce8f7, 0.35);
    this.fillLight.position.set(-12, 10, -10);
    this.scene.add(this.fillLight);

    this.assetLoader = new AssetLoader(this.data);
    this.gridVisual = new GridVisual(initialState.gridWidth, initialState.gridDepth);
    this.scene.add(this.gridVisual.group);

    this.itemsRoot.name = 'PlacedItemsRoot';
    this.overlayRoot.name = 'PlacementOverlayRoot';
    this.scene.add(this.itemsRoot);
    this.scene.add(this.overlayRoot);

    this.selectionRing = this.createSelectionRing();
    this.selectionRing.visible = false;
    this.overlayRoot.add(this.selectionRing);

    this.syncFromState(initialState);

    store.on('houseChanged', ({ state }) => this.syncFromState(state));
    store.on('selectionChanged', ({ selectedUid }) => this.updateSelectionHighlight(selectedUid));
    store.on('itemInteracted', ({ item }) => {
      const entry = this.renderedItems.get(item.uid);
      if (entry) {
        entry.bounceTime = 0.001;
      }
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.startLoop();
  }

  private createSelectionRing(): THREE.LineLoop {
    const pts = [
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xe07a5f, linewidth: 2 });
    return new THREE.LineLoop(geo, mat);
  }

  addTickHook(fn: (dt: number) => void): () => void {
    this.tickHooks.add(fn);
    return () => this.tickHooks.delete(fn);
  }

  applyAtmosphere(view: SceneryViewDef, weather: WeatherDef): void {
    const skyColor = new THREE.Color(view.fogColor).multiply(new THREE.Color(weather.skyTint));
    this.scene.background = skyColor;
    this.gridVisual.setYardColor(view.groundColor);
    this.sunLight.color.set(view.sunColor);
    this.sunLight.intensity = view.sunIntensity * weather.lightMultiplier;
    this.ambientLight.color.set(view.ambientColor);
    this.ambientLight.intensity = view.ambientIntensity * (0.75 + 0.25 * weather.lightMultiplier);
  }

  getItemObject(uid: string): THREE.Group | undefined {
    return this.renderedItems.get(uid)?.group;
  }

  getInteractableMeshes(): THREE.Object3D[] {
    return this.itemsRoot.children;
  }

  private computeItemWorldPosition(
    item: PlacedItem,
    state: HouseState,
  ): { x: number; y: number; z: number; rotY: number } | null {
    const def = this.data.itemsById.get(item.itemId);
    if (!def) return null;

    if (def.layer === 'wall') {
      const mountOffset = def.wallKind === 'mounted' ? WALL_THICKNESS / 2 + 0.01 : 0;
      const t = wallEdgeToWorldTransform(
        item.x,
        item.z,
        item.rotation,
        state.gridWidth,
        state.gridDepth,
        mountOffset,
      );
      return { x: t.wx, y: item.y, z: t.wz, rotY: t.rotY };
    }

    const eff = getEffectiveFootprint(def, item.rotation);
    const center = tileToWorldCenter(
      item.x,
      item.z,
      eff.w,
      eff.d,
      state.gridWidth,
      state.gridDepth,
    );
    return {
      x: center.wx,
      y: item.y,
      z: center.wz,
      rotY: -item.rotation * (Math.PI / 2),
    };
  }

  syncFromState(state: HouseState): void {
    const nextIds = new Set(state.items.map((it) => it.uid));

    // Remove deleted items
    for (const [uid, entry] of this.renderedItems.entries()) {
      if (!nextIds.has(uid)) {
        this.itemsRoot.remove(entry.group);
        this.disposeGroup(entry.group);
        this.renderedItems.delete(uid);
      }
    }

    // Add or update items
    for (const item of state.items) {
      const def = this.data.itemsById.get(item.itemId);
      if (!def) continue;

      const existing = this.renderedItems.get(item.uid);
      const needsRebuild =
        !existing ||
        existing.item.itemId !== item.itemId ||
        existing.item.variantId !== item.variantId ||
        existing.item.active !== item.active;

      let group: THREE.Group;
      let bounceTime = existing?.bounceTime ?? 0;

      if (needsRebuild) {
        if (existing) {
          this.itemsRoot.remove(existing.group);
          this.disposeGroup(existing.group);
        }
        group = this.assetLoader.createPlaceholderMesh(def, item.variantId, {
          active: item.active,
        });
        group.userData.itemUid = item.uid;
        group.traverse((child) => {
          child.userData.itemUid = item.uid;
        });
        this.itemsRoot.add(group);
      } else {
        group = existing.group;
      }

      const transform = this.computeItemWorldPosition(item, state);
      if (transform) {
        group.position.set(transform.x, transform.y, transform.z);
        group.rotation.set(0, transform.rotY, 0);
      }

      this.renderedItems.set(item.uid, {
        uid: item.uid,
        item: { ...item },
        group,
        bounceTime,
      });
    }

    this.updateSelectionHighlight(this.store.getSelectedUid());
  }

  updateSelectionHighlight(selectedUid: string | null): void {
    if (!selectedUid) {
      this.selectionRing.visible = false;
      return;
    }
    const item = this.store.getItem(selectedUid);
    if (!item) {
      this.selectionRing.visible = false;
      return;
    }
    const def = this.data.itemsById.get(item.itemId);
    const transform = this.computeItemWorldPosition(item, this.store.getState());
    if (!def || !transform) {
      this.selectionRing.visible = false;
      return;
    }

    const eff = getEffectiveFootprint(def, item.rotation);
    this.selectionRing.visible = true;
    this.selectionRing.position.set(
      transform.x,
      def.layer === 'ceiling' ? 0.06 : Math.max(0.06, transform.y + 0.06),
      transform.z,
    );
    if (def.layer === 'wall') {
      this.selectionRing.scale.set(1.06, 1, 0.34);
      this.selectionRing.rotation.y = transform.rotY;
    } else {
      this.selectionRing.scale.set(eff.w + 0.08, 1, eff.d + 0.08);
      this.selectionRing.rotation.y = 0;
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      } else if (obj instanceof THREE.Sprite) {
        // Keep shared cached label texture alive; only dispose SpriteMaterial
        obj.material.dispose();
      }
    });
  }

  private handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.isoCamera.resize(width, height);
    this.renderer.setSize(width, height);
  }

  private startLoop(): void {
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.isoCamera.update(dt);

      // Animate interactive items (spinners and click bounces)
      for (const entry of this.renderedItems.values()) {
        const def = this.data.itemsById.get(entry.item.itemId);
        if (entry.item.active && def?.interaction?.type === 'spin') {
          const spinTarget = entry.group.getObjectByName('SpinTarget');
          if (spinTarget) {
            spinTarget.rotation.y += dt * 1.8;
          }
        }
        if (entry.bounceTime > 0) {
          entry.bounceTime += dt;
          const duration = 0.28;
          if (entry.bounceTime >= duration) {
            entry.bounceTime = 0;
            entry.group.scale.set(1, 1, 1);
          } else {
            const t = entry.bounceTime / duration;
            const s = 1 + Math.sin(t * Math.PI) * 0.12;
            entry.group.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
          }
        }
      }

      for (const hook of this.tickHooks) {
        hook(dt);
      }

      this.renderer.render(this.scene, this.isoCamera.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const entry of this.renderedItems.values()) {
      this.disposeGroup(entry.group);
    }
    this.renderedItems.clear();
    this.gridVisual.dispose();
    this.assetLoader.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
