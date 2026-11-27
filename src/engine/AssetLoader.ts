import * as THREE from 'three';
import type { FurnitureItemDef, FurnitureVariant, GameDataBundle } from '../data/schemas';
import { WALL_THICKNESS } from './GridSystem';

/**
 * Lazy asset & placeholder mesh factory.
 *
 * Phase 1 uses minimalist pastel placeholders sized to each item's exact footprint,
 * colored by variant & tab, and labeled with the item's name.
 *
 * Phase 3 swaps in real compressed glTF/GLB models purely via `item.model` paths:
 * `tryLoadGlb()` is already wired as a lazy loader hook with zero upfront bundle cost.
 */
export class AssetLoader {
  private readonly data: GameDataBundle;
  private labelTextureCache = new Map<string, THREE.CanvasTexture>();
  private glbCache = new Map<string, Promise<THREE.Object3D | null>>();
  /** Set true in Phase 3 when compressed `.glb` models are deployed under `public/models/`. */
  private enableGlbLoading = false;

  constructor(data: GameDataBundle) {
    this.data = data;
  }

  setGlbLoadingEnabled(enabled: boolean): void {
    this.enableGlbLoading = enabled;
  }

  private getLabelTexture(text: string, badgeColor: string): THREE.CanvasTexture {
    const key = `${text}__${badgeColor}`;
    const existing = this.labelTextureCache.get(key);
    if (existing) return existing;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Soft pill background
      const r = 18;
      ctx.fillStyle = 'rgba(255, 251, 245, 0.92)';
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, r);
      ctx.fill();
      ctx.stroke();

      // Small tab color dot on left
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.arc(30, 32, 7, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      ctx.fillStyle = '#3D3732';
      ctx.font = '600 21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const clipped = text.length > 16 ? `${text.slice(0, 15)}…` : text;
      ctx.fillText(clipped, 46, 33);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.labelTextureCache.set(key, texture);
    return texture;
  }

  private makeMaterial(color: string, options?: { ghost?: boolean; emissive?: string; opacity?: number }): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
      transparent: options?.ghost || (options?.opacity !== undefined && options.opacity < 1),
      opacity: options?.opacity ?? (options?.ghost ? 0.58 : 1),
    });
    if (options?.emissive) {
      mat.emissive = new THREE.Color(options.emissive);
      mat.emissiveIntensity = 0.45;
    }
    return mat;
  }

  /**
   * Builds a clean low-poly placeholder Group for the given catalog item and variant.
   * Local origin is centered in X/Z at the item's base (y = 0), except ceiling items
   * which hang downward from y = 0.
   */
  createPlaceholderMesh(
    def: FurnitureItemDef,
    variantId: string,
    options?: { ghost?: boolean; ghostColor?: string; active?: boolean; hideLabel?: boolean },
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `Item_${def.id}`;

    const variant: FurnitureVariant =
      def.variants.find((v) => v.id === variantId) ?? def.variants[0];
    const tabColor = this.data.tabsById.get(def.tab)?.color ?? '#D8CFC2';
    const primaryColor = options?.ghostColor ?? variant.color;
    const accentColor = options?.ghostColor ?? variant.accentColor ?? tabColor;

    const [fw, fd] = def.footprint;
    const height = Math.max(0.05, def.height);
    const isGhost = Boolean(options?.ghost);
    const isActive = Boolean(options?.active);
    const glow =
      !isGhost && isActive && def.interaction?.type === 'toggle' ? primaryColor : undefined;

    const mainMat = this.makeMaterial(primaryColor, { ghost: isGhost, emissive: glow });
    const accentMat = this.makeMaterial(accentColor, { ghost: isGhost });

    if (def.layer === 'wall' && def.wallKind === 'structure') {
      this.buildWallStructurePlaceholder(group, def, mainMat, accentMat, isGhost, isActive);
    } else if (def.layer === 'wall' && def.wallKind === 'mounted') {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(fw * 0.76, height, 0.12),
        mainMat,
      );
      box.position.set(0, 0, 0.06);
      box.castShadow = !isGhost;
      box.receiveShadow = !isGhost;
      group.add(box);
    } else if (def.layer === 'ceiling') {
      // Hangs downward from y = 0
      const stemH = Math.min(0.32, height * 0.45);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, stemH, 6),
        accentMat,
      );
      stem.position.y = -stemH / 2;
      group.add(stem);

      const bodyH = Math.max(0.18, height - stemH);
      const bodyGeo =
        def.id === 'disco_ball'
          ? new THREE.IcosahedronGeometry(Math.min(fw, fd) * 0.28, 1)
          : new THREE.CylinderGeometry(fw * 0.24, fw * 0.3, bodyH, 8);
      const body = new THREE.Mesh(bodyGeo, mainMat);
      body.position.y = -stemH - bodyH / 2;
      body.castShadow = !isGhost;
      body.name = 'SpinTarget';
      group.add(body);
    } else if (def.layer === 'floor' && def.subLayer === 'tile') {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(fw - 0.02, height, fd - 0.02),
        mainMat,
      );
      tile.position.y = height / 2;
      tile.receiveShadow = !isGhost;
      group.add(tile);
    } else if (def.layer === 'floor' && def.subLayer === 'rug') {
      const rug = new THREE.Mesh(
        new THREE.BoxGeometry(fw - 0.14, height, fd - 0.14),
        mainMat,
      );
      rug.position.y = height / 2 + 0.08;
      rug.receiveShadow = !isGhost;
      group.add(rug);
    } else {
      // General floor furniture or surface item
      const inset = def.layer === 'surface' ? 0.32 : 0.14;
      const bw = Math.max(0.28, fw - inset);
      const bd = Math.max(0.28, fd - inset);

      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, height, bd), mainMat);
      body.position.y = height / 2 + (def.layer === 'floor' ? 0.08 : 0);
      body.castShadow = !isGhost;
      body.receiveShadow = !isGhost;
      body.name = 'SpinTarget';
      group.add(body);

      // Tab color accent band along top rim
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.92, Math.min(0.06, height * 0.15), bd * 0.92),
        accentMat,
      );
      band.position.y = height + (def.layer === 'floor' ? 0.08 : 0) + 0.015;
      band.receiveShadow = !isGhost;
      group.add(band);

      // Front directional pip (+Z side) so rotation is readable at a glance
      const pip = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(0.22, bw * 0.35), 0.05, 0.08),
        accentMat,
      );
      pip.position.set(0, height * 0.55 + (def.layer === 'floor' ? 0.08 : 0), bd / 2 + 0.03);
      group.add(pip);
    }

    // Readable floating name label for non-structural placeholders (skipped on floor tiles & plain walls to avoid clutter)
    const shouldShowLabel =
      !isGhost &&
      !options?.hideLabel &&
      def.subLayer !== 'tile' &&
      def.id !== 'wall_plain';

    if (shouldShowLabel) {
      const spriteMat = new THREE.SpriteMaterial({
        map: this.getLabelTexture(def.name, tabColor),
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const labelY =
        def.layer === 'ceiling'
          ? -height - 0.18
          : def.layer === 'wall' && def.wallKind === 'mounted'
            ? height / 2 + 0.25
            : height + 0.38;
      sprite.position.set(0, labelY, 0);
      sprite.scale.set(1.35, 0.34, 1);
      sprite.name = 'PlaceholderLabel';
      group.add(sprite);
    }

    return group;
  }

  private buildWallStructurePlaceholder(
    group: THREE.Group,
    def: FurnitureItemDef,
    mainMat: THREE.MeshStandardMaterial,
    accentMat: THREE.MeshStandardMaterial,
    isGhost: boolean,
    isActive: boolean,
  ): void {
    const h = def.height;
    const t = WALL_THICKNESS;

    if (def.id === 'window_wide') {
      // Bottom wall sill
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, t), accentMat);
      sill.position.y = 0.425;
      sill.castShadow = !isGhost;
      sill.receiveShadow = !isGhost;
      group.add(sill);

      // Top header
      const header = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, t), accentMat);
      header.position.y = h - 0.25;
      header.castShadow = !isGhost;
      group.add(header);

      // Side jambs
      for (const sx of [-0.44, 0.44]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, h - 1.35, t), accentMat);
        jamb.position.set(sx, 0.85 + (h - 1.35) / 2, 0);
        jamb.castShadow = !isGhost;
        group.add(jamb);
      }

      // Soft translucent sky-tinted glass pane
      const glassMat = this.makeMaterial(
        `#${mainMat.color.getHexString()}`,
        { ghost: isGhost, opacity: isGhost ? 0.4 : 0.42 },
      );
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.76, h - 1.35, t * 0.35), glassMat);
      glass.position.set(0, 0.85 + (h - 1.35) / 2, 0);
      group.add(glass);
      return;
    }

    if (def.id === 'door_wood') {
      // Header above door
      const header = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, t), accentMat);
      header.position.y = h - 0.275;
      header.castShadow = !isGhost;
      group.add(header);

      // Side frames
      for (const sx of [-0.45, 0.45]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, h - 0.55, t), accentMat);
        frame.position.set(sx, (h - 0.55) / 2, 0);
        frame.castShadow = !isGhost;
        group.add(frame);
      }

      // Door leaf hinged on left side (pivots open when toggled!)
      const pivot = new THREE.Group();
      pivot.position.set(-0.39, 0, 0);
      pivot.rotation.y = isActive ? -Math.PI * 0.42 : 0;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.78, h - 0.58, t * 0.65), mainMat);
      leaf.position.set(0.39, (h - 0.58) / 2, 0);
      leaf.castShadow = !isGhost;
      leaf.receiveShadow = !isGhost;
      pivot.add(leaf);
      group.add(pivot);
      return;
    }

    // Solid plain wall segment
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.02, h, t), mainMat);
    wall.position.y = h / 2;
    wall.castShadow = !isGhost;
    wall.receiveShadow = !isGhost;
    group.add(wall);
  }

  /**
   * Lazy GLB model loader hook for Phase 3. Never downloads models up front.
   * Returns `null` in Phase 1 (placeholders only) or when a model file does not yet exist.
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
    for (const tex of this.labelTextureCache.values()) {
      tex.dispose();
    }
    this.labelTextureCache.clear();
  }
}
