import * as THREE from 'three';
import type { FurnitureItemDef, PlacedItem, RotationQuarter } from '../data/schemas';
import type { EraseFilter, HouseStore } from '../state/houseStore';
import {
  CEILING_HEIGHT,
  WALL_THICKNESS,
  canonicalWallEdgeKey,
  getEffectiveFootprint,
  nearestEdgeRotation,
  tileToWorldCenter,
  validatePlacement,
  wallEdgeToWorldTransform,
  worldToTileFloat,
} from './GridSystem';
import type { SceneManager } from './SceneManager';

export type CursorState =
  | 'default'
  | 'pointer'
  | 'pan'
  | 'panning'
  | 'person'
  | 'interact'
  | 'select'
  | 'move'
  | 'place'
  | 'place-invalid'
  | 'erase'
  | 'marquee';

export interface HoverItemInfo {
  uid: string;
  itemId: string;
  name: string;
  clientX: number;
  clientY: number;
  kind?: 'item' | 'interact' | 'person';
  subtitle?: string;
}

export interface HoverPersonInfo {
  instanceId: string;
  clientX: number;
  clientY: number;
}

interface ResolvedPlacementTarget {
  x: number;
  y: number;
  z: number;
  rotation: RotationQuarter;
  parentUid?: string;
  valid: boolean;
  reason?: string;
}

const VALID_GHOST_COLOR = '#7BC8A4';
const INVALID_GHOST_COLOR = '#E57F74';
const DRAG_THRESHOLD_PX = 9;
const WALL_OUTER_MARGIN = 0.85;

/**
 * Trackpad-first input & 4-layer placement controller supporting Live Mode vs Build/Edit Mode:
 * - Live Mode: click interactive items to toggle/spin/bounce, click-drag anywhere to pan
 * - Edit Mode: hover shows 3D outline + cursor tooltip, click selects, direct drag moves any non-tile item
 * - Two-finger scroll: pan camera; Trackpad pinch: zoom smoothly
 */
export class PlacementController {
  private readonly sceneManager: SceneManager;
  private readonly store: HouseStore;
  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlaneMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly groundIntersectVec = new THREE.Vector3();

  private ghostGroup: THREE.Group | null = null;
  private ghostGuideRing: THREE.LineLoop;
  private wallEdgeGuideBar: THREE.Mesh;
  private lastGhostItemKey = '';
  private lastGhostColor = '';
  private ghostVisualRotY = 0;
  private ghostTargetRotY = 0;
  private ghostBaseY = 0;
  private ghostHopProgress = 1;
  private currentTarget: ResolvedPlacementTarget | null = null;
  private lastPointerClientX: number | null = null;
  private lastPointerClientY: number | null = null;
  private lastCanvasPointerClientX: number | null = null;
  private lastCanvasPointerClientY: number | null = null;
  private lastHoverCoord: { gx: number; gz: number } | null = null;
  private unsubTickHook: (() => void) | null = null;

  // Pointer gesture tracking
  private isPointerDown = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };
  private dragKind: 'none' | 'pan' | 'drag-item' | 'paint' | 'marquee' | 'erase' = 'none';
  private pointerDownItemUid: string | null = null;
  private didDrag = false;

  // Batch paint / marquee / erase tracking
  private paintedKeys = new Set<string>();
  private marqueeEl: HTMLDivElement | null = null;
  private marqueeBaseSelection: string[] = [];
  private erasedAnyInBatch = false;
  private dragBatchOpen = false;

  // Active touch points for pinch-to-zoom & simultaneous two-finger pan on touchscreens
  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;
  private lastPinchCenter: { x: number; y: number } | null = null;
  private pinchCancelled = false;

  // rAF hover raycasting throttle
  private pendingHover: { clientX: number; clientY: number; overCanvas: boolean } | null = null;
  private hoverRafId = 0;

  private onHoverHint?: (hint: string | null) => void;
  private onHoverItem?: (info: HoverItemInfo | null) => void;
  private onHoverPerson?: (info: HoverPersonInfo | null) => void;
  private cursorOverride: CursorState | null = null;
  private currentCursorState: CursorState = 'pan';
  private unsubViewMode: (() => void) | null = null;

  constructor(
    sceneManager: SceneManager,
    store: HouseStore,
    onHoverHint?: (hint: string | null) => void,
    onHoverItem?: (info: HoverItemInfo | null) => void,
  ) {
    this.sceneManager = sceneManager;
    this.store = store;
    this.canvas = sceneManager.renderer.domElement;
    this.onHoverHint = onHoverHint;
    this.onHoverItem = onHoverItem;

    this.ghostGuideRing = this.createCeilingDropRing();
    this.ghostGuideRing.visible = false;
    this.sceneManager.overlayRoot.add(this.ghostGuideRing);

    this.wallEdgeGuideBar = this.createWallEdgeGuideBar();
    this.wallEdgeGuideBar.visible = false;
    this.sceneManager.overlayRoot.add(this.wallEdgeGuideBar);

    this.store.on(
      'modeChanged',
      ({ mode, placementItemId, placementVariantId, placementRotation }) => {
        this.closeDragBatch();
        this.cancelPendingHover();
        this.hideMarquee();
        this.sceneManager.setHoverOutlineUid(null);
        this.sceneManager.setEraseHoverUid(null);
        this.sceneManager.setMovingHiddenUid(mode === 'move' ? this.store.getSelectedUid() : null);
        this.onHoverItem?.(null);
        this.onHoverPerson?.(null);

        if ((mode === 'place' || mode === 'move') && placementItemId) {
          const def = this.store.data.itemsById.get(placementItemId);
          const variantId = placementVariantId ?? def?.variants[0]?.id;
          if (def && variantId) {
            const movingUid =
              mode === 'move' ? (this.store.getSelectedUid() ?? undefined) : undefined;
            const nextItemKey = `${def.id}__${variantId}`;
            const isSameGhostItem =
              this.ghostGroup !== null && this.lastGhostItemKey === nextItemKey;

            if (!isSameGhostItem) {
              this.clearGhost();
            }

            let target: ResolvedPlacementTarget | null = null;
            const px = this.lastCanvasPointerClientX ?? this.lastPointerClientX;
            const py = this.lastCanvasPointerClientY ?? this.lastPointerClientY;
            if (px !== null && py !== null) {
              this.updatePointerNdc(px, py);
              target = this.resolvePlacementTarget(def, placementRotation, movingUid);
            }
            if (!target) {
              const fallbackCoord =
                this.lastHoverCoord ??
                (movingUid
                  ? (() => {
                      const sel = this.store.getItem(movingUid);
                      return sel ? { gx: sel.x, gz: sel.z } : null;
                    })()
                  : null);
              if (fallbackCoord) {
                target = this.resolveTargetAtGridCoord(
                  def,
                  fallbackCoord.gx,
                  fallbackCoord.gz,
                  placementRotation,
                  movingUid,
                );
              }
            }

            if (target) {
              this.currentTarget = target;
              this.lastHoverCoord = { gx: target.x, gz: target.z };
              this.renderGhost(def, variantId, target, isSameGhostItem);
            } else if (isSameGhostItem && this.ghostGroup) {
              this.ghostTargetRotY = -placementRotation * (Math.PI / 2);
              this.ghostHopProgress = 0;
            } else {
              this.onHoverHint?.(null);
            }
            this.refreshBaselineCursor();
            return;
          }
        }

        this.clearGhost();
        this.onHoverHint?.(null);
        this.refreshBaselineCursor();
      },
    );

    this.store.on('editModeChanged', ({ editMode }) => {
      if (!editMode) {
        this.closeDragBatch();
        this.cancelPendingHover();
        this.clearGhost();
        this.hideMarquee();
        this.sceneManager.setHoverOutlineUid(null);
        this.sceneManager.setEraseHoverUid(null);
        this.sceneManager.setMovingHiddenUid(null);
        this.onHoverHint?.(null);
        this.onHoverItem?.(null);
        this.onHoverPerson?.(null);
      }
      this.refreshBaselineCursor();
    });

    this.unsubViewMode = this.sceneManager.onCameraViewModeChange(() => {
      if (this.sceneManager.getCameraViewMode() !== 'isometric') {
        this.cancelPendingHover();
        this.onHoverItem?.(null);
        this.onHoverPerson?.(null);
      }
      this.refreshBaselineCursor();
    });

    this.setCanvasCursor(this.resolveBaselineCursor());
    this.unsubTickHook = this.sceneManager.addTickHook((dt) => this.update(dt));
    this.bindEvents();
  }

  setOnHoverPerson(cb: ((info: HoverPersonInfo | null) => void) | undefined): void {
    this.onHoverPerson = cb;
  }

  setCursorOverride(state: CursorState | null): void {
    this.cursorOverride = state;
    if (state) {
      this.onHoverItem?.(null);
      this.onHoverPerson?.(null);
    }
    this.refreshBaselineCursor();
  }

  private setCanvasCursor(next: CursorState): void {
    if (next === this.currentCursorState && this.canvas.dataset?.cursor === next) {
      return;
    }
    this.currentCursorState = next;
    if (this.canvas.dataset) {
      this.canvas.dataset.cursor = next;
    }
  }

  private resolveBaselineCursor(): CursorState {
    if (this.cursorOverride) {
      return this.cursorOverride;
    }
    if (this.sceneManager.getCameraViewMode?.() !== 'isometric') {
      return this.sceneManager.isPovDragging?.() ? 'panning' : 'pan';
    }
    if (this.isPointerDown && this.dragKind !== 'none') {
      switch (this.dragKind) {
        case 'pan':
          return 'panning';
        case 'drag-item':
          return 'move';
        case 'marquee':
          return 'marquee';
        case 'erase':
          return 'erase';
        case 'paint':
          return this.currentTarget && !this.currentTarget.valid ? 'place-invalid' : 'place';
      }
    }
    if (this.store.isEditMode()) {
      const mode = this.store.getModeState().mode;
      if (mode === 'place') {
        return this.currentTarget && !this.currentTarget.valid ? 'place-invalid' : 'place';
      }
      if (mode === 'erase') return 'erase';
      if (mode === 'move') return 'move';
      if (mode === 'bulk-select') return 'marquee';
      return 'pan';
    }
    return 'pan';
  }

  private refreshBaselineCursor(): void {
    this.setCanvasCursor(this.resolveBaselineCursor());
  }

  private update(dt: number): void {
    if (!this.ghostGroup || !this.ghostGroup.visible) return;
    const clampedDt = Math.min(Math.max(dt, 0), 0.05);

    // Smooth shortest-angle spring rotation toward target quarter turn
    const diff = Math.atan2(
      Math.sin(this.ghostTargetRotY - this.ghostVisualRotY),
      Math.cos(this.ghostTargetRotY - this.ghostVisualRotY),
    );
    if (Math.abs(diff) > 0.0008) {
      const factor = 1 - Math.exp(-18 * clampedDt);
      this.ghostVisualRotY += diff * factor;
    } else {
      this.ghostVisualRotY = this.ghostTargetRotY;
    }
    this.ghostGroup.rotation.y = this.ghostVisualRotY;

    // Playful +0.08 Y settle hop on rotation
    if (this.ghostHopProgress < 1) {
      this.ghostHopProgress = Math.min(1, this.ghostHopProgress + clampedDt / 0.18);
      const hop = Math.sin(this.ghostHopProgress * Math.PI) * 0.08;
      this.ghostGroup.position.y = this.ghostBaseY + hop;
    } else if (this.ghostGroup.position.y !== this.ghostBaseY) {
      this.ghostGroup.position.y = this.ghostBaseY;
    }
  }

  private createCeilingDropRing(): THREE.LineLoop {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36));
    }
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x7bc8a4 }),
    );
  }

  private createWallEdgeGuideBar(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(1.0, 0.032, 0.14);
    const mat = new THREE.MeshBasicMaterial({
      color: VALID_GHOST_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerleave', this.handleCanvasLeave);
    this.canvas.addEventListener('lostpointercapture', this.handlePointerCancel);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('wheel', this.handleWindowWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private beginDragBatch(): void {
    if (this.dragBatchOpen) return;
    this.dragBatchOpen = true;
    this.store.beginBatch();
  }

  private closeDragBatch(reason?: string): void {
    if (!this.dragBatchOpen) return;
    this.dragBatchOpen = false;
    this.store.endBatch(reason);
  }

  private resolveActiveDragBatchReason(): string | undefined {
    if (this.dragKind === 'paint') {
      return this.paintedKeys.size > 0 ? 'place' : undefined;
    }
    if (this.dragKind === 'erase') {
      return this.erasedAnyInBatch ? 'delete' : undefined;
    }
    return undefined;
  }

  private cancelPendingHover(): void {
    this.pendingHover = null;
    if (this.hoverRafId !== 0) {
      cancelAnimationFrame(this.hoverRafId);
      this.hoverRafId = 0;
    }
  }

  /**
   * Blocks macOS two-finger horizontal trackpad swipes from triggering browser Back/Forward
   * history navigation across the viewport and at horizontal scroll edges of HUD panels.
   */
  private handleWindowWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaX) === 0) return;
    if (e.target === this.canvas) {
      e.preventDefault();
      return;
    }
    let el = e.target as HTMLElement | null;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const ox = style.overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        const atLeft = el.scrollLeft <= 0 && e.deltaX < 0;
        const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaX > 0;
        if (!atLeft && !atRight) {
          return;
        }
        e.preventDefault();
        return;
      }
      el = el.parentElement;
    }
    e.preventDefault();
  };

  private resolveHitUid(hit: THREE.Intersection): string | undefined {
    const sm = this.sceneManager as SceneManager & {
      resolveHitUid?: (intersection: THREE.Intersection) => string | undefined;
    };
    if (typeof sm.resolveHitUid === 'function') {
      return sm.resolveHitUid(hit);
    }
    const instUids = hit.object.userData.instanceUids as string[] | undefined;
    if (instUids && hit.instanceId !== undefined) {
      return instUids[hit.instanceId];
    }
    return hit.object.userData.itemUid as string | undefined;
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleCanvasLeave = (): void => {
    this.cancelPendingHover();
    if (!this.isPointerDown) {
      this.sceneManager.setHoverOutlineUid(null);
      this.sceneManager.setEraseHoverUid(null);
      this.onHoverItem?.(null);
      this.onHoverPerson?.(null);
      this.refreshBaselineCursor();
    }
  };

  private updatePointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private isFloorTile(itemId: string): boolean {
    const def = this.store.data.itemsById.get(itemId);
    return Boolean(def && def.layer === 'floor' && def.subLayer === 'tile');
  }

  private raycastItemUid(ignoreUid?: string): { uid: string; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);

    const isLiveMode = !this.store.isEditMode();
    interface CandidateHit {
      uid: string;
      point: THREE.Vector3;
      distance: number;
      def: FurnitureItemDef;
      isCutaway: boolean;
      isTile: boolean;
    }

    const candidates: CandidateHit[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      if (hit.object instanceof THREE.Sprite) continue;
      const uid = this.resolveHitUid(hit);
      if (!uid || uid === ignoreUid || seen.has(uid)) continue;
      const item = this.store.getItem(uid);
      if (!item) continue;
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
      seen.add(uid);

      const obj = this.sceneManager.getItemObject(uid);
      const isCutaway = Boolean(obj?.userData.isTranslucentCutaway);
      candidates.push({
        uid,
        point: hit.point,
        distance: hit.distance,
        def,
        isCutaway,
        isTile: def.layer === 'floor' && def.subLayer === 'tile',
      });
    }

    if (candidates.length === 0) return null;

    if (isLiveMode) {
      const nonCutaway = candidates.filter((c) => !c.isCutaway);
      if (nonCutaway.length > 0) {
        const first = nonCutaway[0];
        if (first.def.interaction) {
          return { uid: first.uid, point: first.point };
        }
        const firstIsPassive =
          first.def.layer === 'wall' ||
          first.def.subLayer === 'tile' ||
          first.def.subLayer === 'rug' ||
          first.def.surfaceHeight !== undefined;
        for (let i = 1; i < nonCutaway.length; i++) {
          const c = nonCutaway[i];
          if (c.def.interaction && (c.distance - first.distance <= 1.8 || firstIsPassive)) {
            return { uid: c.uid, point: c.point };
          }
        }
        // No non-cutaway interactive item behind: allow clicking a door on a cutaway wall
        const cutawayDoor = candidates.find((c) => c.isCutaway && c.def.tags.includes('door'));
        if (cutawayDoor) {
          return { uid: cutawayDoor.uid, point: cutawayDoor.point };
        }
        return { uid: first.uid, point: first.point };
      }

      const cutawayInteractive = candidates.find((c) => c.def.interaction);
      if (cutawayInteractive) {
        return { uid: cutawayInteractive.uid, point: cutawayInteractive.point };
      }
      return { uid: candidates[0].uid, point: candidates[0].point };
    }

    // Edit Mode ('select' / 'bulk-select'): prefer non-cutaway interior items over translucent front walls & floor tiles
    const interiorItem = candidates.find((c) => !c.isCutaway && !c.isTile);
    if (interiorItem) {
      return { uid: interiorItem.uid, point: interiorItem.point };
    }

    // Clicking an unobstructed portion of a translucent front wall selects that wall cleanly
    const cutawayWall = candidates.find((c) => c.isCutaway && !c.isTile);
    if (cutawayWall) {
      return { uid: cutawayWall.uid, point: cutawayWall.point };
    }

    return { uid: candidates[0].uid, point: candidates[0].point };
  }

  private raycastGround(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hits = this.raycaster.intersectObject(this.sceneManager.gridVisual.groundPlane, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  private raycastGroundPlane(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlaneMath, this.groundIntersectVec);
    return hit ? hit.clone() : null;
  }

  private isPaintablePlacement(def: FurnitureItemDef): boolean {
    return (
      (def.layer === 'wall' && def.wallKind === 'structure') ||
      (def.layer === 'floor' && def.subLayer === 'tile')
    );
  }

  private getPaintKey(def: FurnitureItemDef, target: ResolvedPlacementTarget): string {
    if (def.layer === 'wall') {
      return canonicalWallEdgeKey(target.x, target.z, target.rotation);
    }
    return `${target.x}:${target.z}`;
  }

  private matchesEraseFilter(item: PlacedItem, filter: EraseFilter): boolean {
    if (filter === 'all') return true;
    const def = this.store.data.itemsById.get(item.itemId);
    if (!def) return false;
    const isFloor = def.layer === 'floor' && (def.subLayer === 'tile' || def.subLayer === 'rug');
    const isWall = def.layer === 'wall';
    if (filter === 'floor') return isFloor;
    if (filter === 'wall') return isWall;
    return !isFloor && !isWall;
  }

  private raycastEraseUid(filter: EraseFilter): string | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);
    for (const hit of hits) {
      if (hit.object instanceof THREE.Sprite) continue;
      const uid = this.resolveHitUid(hit);
      if (!uid) continue;
      const item = this.store.getItem(uid);
      if (item && this.matchesEraseFilter(item, filter)) {
        return uid;
      }
    }
    return null;
  }

  /**
   * Resolves the snapped placement target for any of the 4 layers
   * (`floor`, `wall` structure/mounted, `ceiling`, `surface`).
   */
  private resolvePlacementTarget(
    def: FurnitureItemDef,
    preferredRotation: RotationQuarter,
    movingUid?: string,
  ): ResolvedPlacementTarget | null {
    const state = this.store.getState();
    const ignoreUids = movingUid ? new Set([movingUid]) : undefined;

    // 1. Surface layer: raycast supporting furniture first (skipping movingUid & other surface items),
    //    then fall back to ground-plane tile lookup for rock-solid tabletop dragging!
    if (def.layer === 'surface') {
      this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
      const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);

      let supportItem: PlacedItem | undefined;
      let hitPoint: THREE.Vector3 | null = null;

      for (const hit of hits) {
        if (hit.object instanceof THREE.Sprite) continue;
        const uid = this.resolveHitUid(hit);
        if (!uid || uid === movingUid) continue;
        const candidate = this.store.getItem(uid);
        const cDef = candidate ? this.store.data.itemsById.get(candidate.itemId) : undefined;
        if (!candidate || !cDef || cDef.layer === 'surface') continue;
        if (cDef.surfaceHeight !== undefined) {
          supportItem = candidate;
          hitPoint = hit.point;
          break;
        }
      }

      // Ground-plane fallback if cursor briefly misses a thin tabletop mesh
      if (!supportItem) {
        const planePt = this.raycastGroundPlane();
        if (planePt) {
          const { fx, fz } = worldToTileFloat(planePt.x, planePt.z, state.gridWidth, state.gridDepth);
          const gx = Math.floor(fx);
          const gz = Math.floor(fz);
          let bestHeight = -1;
          for (const candidate of state.items) {
            if (candidate.uid === movingUid) continue;
            const cDef = this.store.data.itemsById.get(candidate.itemId);
            if (!cDef || cDef.layer === 'surface' || cDef.surfaceHeight === undefined) continue;
            const cEff = getEffectiveFootprint(cDef, candidate.rotation);
            if (
              gx >= candidate.x &&
              gx < candidate.x + cEff.w &&
              gz >= candidate.z &&
              gz < candidate.z + cEff.d &&
              cDef.surfaceHeight > bestHeight
            ) {
              bestHeight = cDef.surfaceHeight;
              supportItem = candidate;
              hitPoint = planePt;
            }
          }
        }
      }

      if (supportItem && hitPoint) {
        const sDef = this.store.data.itemsById.get(supportItem.itemId)!;
        const { fx, fz } = worldToTileFloat(hitPoint.x, hitPoint.z, state.gridWidth, state.gridDepth);
        const eff = getEffectiveFootprint(def, preferredRotation);
        const sEff = getEffectiveFootprint(sDef, supportItem.rotation);
        const tx = THREE.MathUtils.clamp(
          Math.floor(fx),
          supportItem.x,
          supportItem.x + sEff.w - eff.w,
        );
        const tz = THREE.MathUtils.clamp(
          Math.floor(fz),
          supportItem.z,
          supportItem.z + sEff.d - eff.d,
        );
        const y = sDef.surfaceHeight!;
        const check = validatePlacement(
          state,
          this.store.data,
          { itemId: def.id, x: tx, y, z: tz, rotation: preferredRotation, parentUid: supportItem.uid },
          ignoreUids,
        );
        return {
          x: tx,
          y,
          z: tz,
          rotation: preferredRotation,
          parentUid: supportItem.uid,
          valid: check.valid,
          reason: check.reason,
        };
      }

      const groundPt = this.raycastGround();
      if (!groundPt) return null;
      const { fx, fz } = worldToTileFloat(groundPt.x, groundPt.z, state.gridWidth, state.gridDepth);
      const tx = THREE.MathUtils.clamp(Math.floor(fx), 0, state.gridWidth - 1);
      const tz = THREE.MathUtils.clamp(Math.floor(fz), 0, state.gridDepth - 1);
      return {
        x: tx,
        y: 0.25,
        z: tz,
        rotation: preferredRotation,
        valid: false,
        reason: 'Place on a counter, table, or shelf',
      };
    }

    // 2. Wall-mounted decor: snap onto any structural wall hit
    if (def.layer === 'wall' && def.wallKind === 'mounted') {
      this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
      const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);

      for (const hit of hits) {
        if (hit.object instanceof THREE.Sprite) continue;
        const uid = this.resolveHitUid(hit);
        if (!uid || uid === movingUid) continue;
        const wall = this.store.getItem(uid);
        const wDef = wall ? this.store.data.itemsById.get(wall.itemId) : undefined;
        if (wall && wDef && wDef.layer === 'wall' && wDef.wallKind === 'structure') {
          const y = def.mountHeight ?? 1.5;
          const check = validatePlacement(
            state,
            this.store.data,
            {
              itemId: def.id,
              x: wall.x,
              y,
              z: wall.z,
              rotation: wall.rotation,
              parentUid: wall.uid,
            },
            ignoreUids,
          );
          return {
            x: wall.x,
            y,
            z: wall.z,
            rotation: wall.rotation,
            parentUid: wall.uid,
            valid: check.valid,
            reason: check.reason,
          };
        }
      }

      const groundPt = this.raycastGround();
      if (!groundPt) return null;
      const { fx, fz } = worldToTileFloat(groundPt.x, groundPt.z, state.gridWidth, state.gridDepth);
      const edge = nearestEdgeRotation(
        THREE.MathUtils.clamp(fx, 0, state.gridWidth - 0.01),
        THREE.MathUtils.clamp(fz, 0, state.gridDepth - 0.01),
      );
      return {
        x: edge.x,
        y: def.mountHeight ?? 1.5,
        z: edge.z,
        rotation: edge.rotation,
        valid: false,
        reason: 'Hover a wall to mount',
      };
    }

    // 3. Structural wall / door / window: snap to nearest tile edge including outer lot borders
    if (def.layer === 'wall' && def.wallKind === 'structure') {
      const groundPt = this.raycastGroundPlane();
      if (!groundPt) return null;
      const { fx, fz } = worldToTileFloat(groundPt.x, groundPt.z, state.gridWidth, state.gridDepth);
      if (
        fx < -WALL_OUTER_MARGIN ||
        fz < -WALL_OUTER_MARGIN ||
        fx >= state.gridWidth + WALL_OUTER_MARGIN ||
        fz >= state.gridDepth + WALL_OUTER_MARGIN
      ) {
        return null;
      }

      let edge: { x: number; z: number; rotation: RotationQuarter };
      if (fx < 0) {
        edge = {
          x: 0,
          z: THREE.MathUtils.clamp(Math.floor(fz), 0, state.gridDepth - 1),
          rotation: 3,
        };
      } else if (fx >= state.gridWidth) {
        edge = {
          x: state.gridWidth - 1,
          z: THREE.MathUtils.clamp(Math.floor(fz), 0, state.gridDepth - 1),
          rotation: 1,
        };
      } else if (fz < 0) {
        edge = {
          x: THREE.MathUtils.clamp(Math.floor(fx), 0, state.gridWidth - 1),
          z: 0,
          rotation: 0,
        };
      } else if (fz >= state.gridDepth) {
        edge = {
          x: THREE.MathUtils.clamp(Math.floor(fx), 0, state.gridWidth - 1),
          z: state.gridDepth - 1,
          rotation: 2,
        };
      } else {
        edge = nearestEdgeRotation(fx, fz);
      }

      const check = validatePlacement(
        state,
        this.store.data,
        { itemId: def.id, x: edge.x, y: 0, z: edge.z, rotation: edge.rotation },
        ignoreUids,
      );
      return {
        x: edge.x,
        y: 0,
        z: edge.z,
        rotation: edge.rotation,
        valid: check.valid,
        reason: check.reason,
      };
    }

    // 4. Floor & Ceiling layers: snap to grid cell
    const groundPt = this.raycastGround();
    if (!groundPt) return null;
    const { fx, fz } = worldToTileFloat(groundPt.x, groundPt.z, state.gridWidth, state.gridDepth);
    const eff = getEffectiveFootprint(def, preferredRotation);
    const tx = Math.floor(fx - (eff.w - 1) / 2);
    const tz = Math.floor(fz - (eff.d - 1) / 2);
    const y = def.layer === 'ceiling' ? CEILING_HEIGHT : 0;

    const check = validatePlacement(
      state,
      this.store.data,
      { itemId: def.id, x: tx, y, z: tz, rotation: preferredRotation },
      ignoreUids,
    );

    return {
      x: tx,
      y,
      z: tz,
      rotation: preferredRotation,
      valid: check.valid,
      reason: check.reason,
    };
  }

  private resolveTargetAtGridCoord(
    def: FurnitureItemDef,
    gx: number,
    gz: number,
    preferredRotation: RotationQuarter,
    movingUid?: string,
  ): ResolvedPlacementTarget {
    const state = this.store.getState();
    const ignoreUids = movingUid ? new Set([movingUid]) : undefined;

    if (def.layer === 'wall' && def.wallKind === 'structure') {
      const x = THREE.MathUtils.clamp(gx, 0, state.gridWidth - 1);
      const z = THREE.MathUtils.clamp(gz, 0, state.gridDepth - 1);
      const check = validatePlacement(
        state,
        this.store.data,
        { itemId: def.id, x, y: 0, z, rotation: preferredRotation },
        ignoreUids,
      );
      return {
        x,
        y: 0,
        z,
        rotation: preferredRotation,
        valid: check.valid,
        reason: check.reason,
      };
    }

    if (def.layer === 'surface') {
      const prevParent = this.currentTarget?.parentUid;
      if (prevParent) {
        const support = this.store.getItem(prevParent);
        const sDef = support ? this.store.data.itemsById.get(support.itemId) : undefined;
        if (support && sDef && sDef.surfaceHeight !== undefined) {
          const eff = getEffectiveFootprint(def, preferredRotation);
          const sEff = getEffectiveFootprint(sDef, support.rotation);
          const tx = THREE.MathUtils.clamp(gx, support.x, support.x + Math.max(0, sEff.w - eff.w));
          const tz = THREE.MathUtils.clamp(gz, support.z, support.z + Math.max(0, sEff.d - eff.d));
          const y = sDef.surfaceHeight;
          const check = validatePlacement(
            state,
            this.store.data,
            { itemId: def.id, x: tx, y, z: tz, rotation: preferredRotation, parentUid: support.uid },
            ignoreUids,
          );
          return {
            x: tx,
            y,
            z: tz,
            rotation: preferredRotation,
            parentUid: support.uid,
            valid: check.valid,
            reason: check.reason,
          };
        }
      }
      const x = THREE.MathUtils.clamp(gx, 0, state.gridWidth - 1);
      const z = THREE.MathUtils.clamp(gz, 0, state.gridDepth - 1);
      return {
        x,
        y: 0.25,
        z,
        rotation: preferredRotation,
        valid: false,
        reason: 'Place on a counter, table, or shelf',
      };
    }

    if (def.layer === 'wall' && def.wallKind === 'mounted') {
      const prevParent = this.currentTarget?.parentUid;
      const y = def.mountHeight ?? 1.5;
      if (prevParent) {
        const wall = this.store.getItem(prevParent);
        if (wall) {
          const check = validatePlacement(
            state,
            this.store.data,
            { itemId: def.id, x: wall.x, y, z: wall.z, rotation: wall.rotation, parentUid: wall.uid },
            ignoreUids,
          );
          return {
            x: wall.x,
            y,
            z: wall.z,
            rotation: wall.rotation,
            parentUid: wall.uid,
            valid: check.valid,
            reason: check.reason,
          };
        }
      }
      return {
        x: THREE.MathUtils.clamp(gx, 0, state.gridWidth - 1),
        y,
        z: THREE.MathUtils.clamp(gz, 0, state.gridDepth - 1),
        rotation: preferredRotation,
        valid: false,
        reason: 'Hover a wall to mount',
      };
    }

    const eff = getEffectiveFootprint(def, preferredRotation);
    const tx = THREE.MathUtils.clamp(gx, 0, Math.max(0, state.gridWidth - eff.w));
    const tz = THREE.MathUtils.clamp(gz, 0, Math.max(0, state.gridDepth - eff.d));
    const y = def.layer === 'ceiling' ? CEILING_HEIGHT : 0;
    const check = validatePlacement(
      state,
      this.store.data,
      { itemId: def.id, x: tx, y, z: tz, rotation: preferredRotation },
      ignoreUids,
    );
    return {
      x: tx,
      y,
      z: tz,
      rotation: preferredRotation,
      valid: check.valid,
      reason: check.reason,
    };
  }

  private renderGhost(
    def: FurnitureItemDef,
    variantId: string,
    target: ResolvedPlacementTarget,
    triggerRotateHop = false,
  ): void {
    const state = this.store.getState();
    const ghostColor = target.valid ? VALID_GHOST_COLOR : INVALID_GHOST_COLOR;
    const itemKey = `${def.id}__${variantId}`;
    let freshlyCreated = false;

    if (!this.ghostGroup || this.lastGhostItemKey !== itemKey) {
      this.clearGhost();
      this.ghostGroup = this.sceneManager.assetLoader.createPlaceholderMesh(def, variantId, {
        ghost: true,
        ghostColor,
        hideLabel: true,
      });
      this.sceneManager.overlayRoot.add(this.ghostGroup);
      this.lastGhostItemKey = itemKey;
      this.lastGhostColor = ghostColor;
      freshlyCreated = true;
    } else if (this.lastGhostColor !== ghostColor) {
      this.lastGhostColor = ghostColor;
      this.ghostGroup.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if ('color' in m && m.color instanceof THREE.Color) {
            m.color.set(ghostColor);
          }
        }
      });
    }

    let nextTargetRotY = 0;
    this.ghostBaseY = target.y;

    if (def.layer === 'wall') {
      const mountOffset = def.wallKind === 'mounted' ? WALL_THICKNESS / 2 + 0.01 : 0;
      const t = wallEdgeToWorldTransform(
        target.x,
        target.z,
        target.rotation,
        state.gridWidth,
        state.gridDepth,
        mountOffset,
      );
      nextTargetRotY = t.rotY;
      this.ghostGroup.position.x = t.wx;
      this.ghostGroup.position.z = t.wz;
      this.ghostGuideRing.visible = false;

      if (def.wallKind === 'structure') {
        this.wallEdgeGuideBar.visible = true;
        this.wallEdgeGuideBar.position.set(t.wx, 0.048, t.wz);
        this.wallEdgeGuideBar.rotation.set(0, t.rotY, 0);
        (this.wallEdgeGuideBar.material as THREE.MeshBasicMaterial).color.set(ghostColor);
      } else {
        this.wallEdgeGuideBar.visible = false;
      }
    } else {
      this.wallEdgeGuideBar.visible = false;
      const eff = getEffectiveFootprint(def, target.rotation);
      const c = tileToWorldCenter(target.x, target.z, eff.w, eff.d, state.gridWidth, state.gridDepth);
      nextTargetRotY = -target.rotation * (Math.PI / 2);
      this.ghostGroup.position.x = c.wx;
      this.ghostGroup.position.z = c.wz;

      if (def.layer === 'ceiling') {
        this.ghostGuideRing.visible = true;
        this.ghostGuideRing.position.set(c.wx, 0.05, c.wz);
        (this.ghostGuideRing.material as THREE.LineBasicMaterial).color.set(ghostColor);
      } else {
        this.ghostGuideRing.visible = false;
      }
    }

    const angleChanged =
      Math.abs(
        Math.atan2(
          Math.sin(nextTargetRotY - this.ghostTargetRotY),
          Math.cos(nextTargetRotY - this.ghostTargetRotY),
        ),
      ) > 0.01;

    this.ghostTargetRotY = nextTargetRotY;
    if (freshlyCreated) {
      this.ghostVisualRotY = nextTargetRotY;
      this.ghostGroup.rotation.set(0, nextTargetRotY, 0);
      this.ghostHopProgress = 1;
      this.ghostGroup.position.y = this.ghostBaseY;
    } else {
      if (triggerRotateHop || angleChanged) {
        this.ghostHopProgress = 0;
      }
      const hop =
        this.ghostHopProgress < 1 ? Math.sin(this.ghostHopProgress * Math.PI) * 0.08 : 0;
      this.ghostGroup.position.y = this.ghostBaseY + hop;
    }

    this.onHoverHint?.(target.valid ? null : (target.reason ?? 'Cannot place here'));
  }

  private clearGhost(): void {
    if (this.ghostGroup) {
      this.sceneManager.overlayRoot.remove(this.ghostGroup);
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      this.ghostGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          geos.add(obj.geometry);
          if (Array.isArray(obj.material)) obj.material.forEach((m) => mats.add(m));
          else mats.add(obj.material);
        }
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      this.ghostGroup = null;
    }
    this.ghostGuideRing.visible = false;
    this.wallEdgeGuideBar.visible = false;
    this.lastGhostItemKey = '';
    this.lastGhostColor = '';
    this.ghostHopProgress = 1;
    this.currentTarget = null;
  }

  private updateMarqueeBox(curX: number, curY: number): void {
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'selection-marquee';
      document.body.appendChild(this.marqueeEl);
    }
    const minX = Math.min(this.pointerDownPos.x, curX);
    const minY = Math.min(this.pointerDownPos.y, curY);
    const width = Math.abs(curX - this.pointerDownPos.x);
    const height = Math.abs(curY - this.pointerDownPos.y);

    this.marqueeEl.style.left = `${minX}px`;
    this.marqueeEl.style.top = `${minY}px`;
    this.marqueeEl.style.width = `${width}px`;
    this.marqueeEl.style.height = `${height}px`;

    const rect = this.canvas.getBoundingClientRect();
    const state = this.store.getState();
    const camera = this.sceneManager.isoCamera.camera;
    const proj = new THREE.Vector3();
    const matched: string[] = [];

    for (const item of state.items) {
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
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
        proj.set(t.wx, item.y + def.height * 0.45, t.wz);
      } else {
        const eff = getEffectiveFootprint(def, item.rotation);
        const c = tileToWorldCenter(item.x, item.z, eff.w, eff.d, state.gridWidth, state.gridDepth);
        const midY = def.layer === 'ceiling' ? item.y - def.height * 0.5 : item.y + def.height * 0.45;
        proj.set(c.wx, midY, c.wz);
      }
      proj.project(camera);
      const sx = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      if (sx >= minX && sx <= minX + width && sy >= minY && sy <= minY + height) {
        matched.push(item.uid);
      }
    }

    this.store.setSelectedUids(
      this.marqueeBaseSelection.length > 0
        ? [...this.marqueeBaseSelection, ...matched]
        : matched,
    );
  }

  private hideMarquee(): void {
    if (this.marqueeEl) {
      this.marqueeEl.remove();
      this.marqueeEl = null;
    }
    this.marqueeBaseSelection = [];
  }

  /**
   * Computes a child's new grid coordinates after rotating its parent clockwise by `quarterSteps`.
   */
  private rotateChildOnParent(
    parent: PlacedItem,
    parentDef: FurnitureItemDef,
    nextParentX: number,
    nextParentZ: number,
    nextParentRot: RotationQuarter,
    child: PlacedItem,
    childDef: FurnitureItemDef,
  ): { x: number; z: number; rotation: RotationQuarter } {
    const steps = (((nextParentRot - parent.rotation) % 4) + 4) % 4;
    let lx = child.x - parent.x;
    let lz = child.z - parent.z;
    let curParentEff = getEffectiveFootprint(parentDef, parent.rotation);
    let curChildRot = child.rotation;
    let curChildEff = getEffectiveFootprint(childDef, curChildRot);

    for (let s = 0; s < steps; s++) {
      const nextLx = curParentEff.d - curChildEff.d - lz;
      const nextLz = lx;
      lx = nextLx;
      lz = nextLz;
      curParentEff = { w: curParentEff.d, d: curParentEff.w };
      curChildRot = (((curChildRot + 1) % 4) as RotationQuarter);
      curChildEff = getEffectiveFootprint(childDef, curChildRot);
    }

    const nextParentEff = getEffectiveFootprint(parentDef, nextParentRot);
    const finalX = THREE.MathUtils.clamp(
      nextParentX + lx,
      nextParentX,
      nextParentX + Math.max(0, nextParentEff.w - curChildEff.w),
    );
    const finalZ = THREE.MathUtils.clamp(
      nextParentZ + lz,
      nextParentZ,
      nextParentZ + Math.max(0, nextParentEff.d - curChildEff.d),
    );
    return { x: finalX, z: finalZ, rotation: curChildRot };
  }

  /** Rotates the currently selected item in-place (90° clockwise) if valid. */
  rotateSelectedInPlace(): boolean {
    const selected = this.store.getSelectedItem();
    if (!selected) return false;
    const def = this.store.data.itemsById.get(selected.itemId);
    if (!def) return false;

    if (def.layer === 'wall' && def.wallKind === 'mounted') {
      this.store.notify('Wall decor follows the wall facing.', 'info');
      return false;
    }

    const nextRot = (((selected.rotation + 1) % 4) as RotationQuarter);
    const children = this.store.getChildren(selected.uid);
    const ignore = new Set([selected.uid, ...children.map((c) => c.uid)]);
    const kickOffsets: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [-1, 0],
      [0, -1],
      [1, 0],
      [0, 1],
    ];

    let chosenX = selected.x;
    let chosenZ = selected.z;
    let firstFailReason: string | undefined;
    let foundValid = false;

    for (const [dx, dz] of kickOffsets) {
      const tx = selected.x + dx;
      const tz = selected.z + dz;
      const check = validatePlacement(
        this.store.getState(),
        this.store.data,
        {
          itemId: selected.itemId,
          x: tx,
          y: selected.y,
          z: tz,
          rotation: nextRot,
          parentUid: selected.parentUid,
        },
        ignore,
      );
      if (check.valid) {
        chosenX = tx;
        chosenZ = tz;
        foundValid = true;
        break;
      }
      if (firstFailReason === undefined) {
        firstFailReason = check.reason;
      }
    }

    if (!foundValid) {
      this.store.notify(firstFailReason ?? 'Not enough space to rotate here.', 'error');
      return false;
    }

    const surfaceChildren = children.filter(
      (c) => this.store.data.itemsById.get(c.itemId)?.layer === 'surface',
    );
    if (surfaceChildren.length === 0) {
      return this.store.moveItem(selected.uid, {
        x: chosenX,
        y: selected.y,
        z: chosenZ,
        rotation: nextRot,
        parentUid: selected.parentUid,
      });
    }

    // Rotate parent + surface children cleanly in ONE atomic undoable batch
    const childTargets = surfaceChildren.map((child) => {
      const cDef = this.store.data.itemsById.get(child.itemId)!;
      const rotPos = this.rotateChildOnParent(
        selected,
        def,
        chosenX,
        chosenZ,
        nextRot,
        child,
        cDef,
      );
      return { child, ...rotPos };
    });

    this.store.beginBatch();
    const moved = this.store.moveItem(selected.uid, {
      x: chosenX,
      y: selected.y,
      z: chosenZ,
      rotation: nextRot,
      parentUid: selected.parentUid,
    });
    if (moved) {
      for (const ct of childTargets) {
        this.store.moveItem(ct.child.uid, {
          x: ct.x,
          y: ct.child.y,
          z: ct.z,
          rotation: ct.rotation,
          parentUid: selected.uid,
        });
      }
    }
    this.store.endBatch(moved ? 'move' : undefined);
    return moved;
  }

  private placeFromTarget(
    def: FurnitureItemDef,
    variantId: string,
    target: ResolvedPlacementTarget,
  ): void {
    this.store.placeItem({
      itemId: def.id,
      x: target.x,
      y: target.y,
      z: target.z,
      rotation: target.rotation,
      variantId,
      parentUid: target.parentUid,
    });
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // Trackpad primary click only; never requires right-click
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size === 2) {
      if (this.dragBatchOpen) {
        this.closeDragBatch(this.resolveActiveDragBatchReason());
      }
      this.paintedKeys.clear();
      this.erasedAnyInBatch = false;
      this.hideMarquee();
      const pts = [...this.activePointers.values()];
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this.lastPinchCenter = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5,
      };
      this.pinchCancelled = true;
      this.dragKind = 'none';
      this.isPointerDown = false;
      this.refreshBaselineCursor();
      return;
    }

    if (this.activePointers.size === 1) {
      this.pinchCancelled = false;
      this.lastPinchCenter = null;
    }

    this.cancelPendingHover();
    this.onHoverItem?.(null);
    this.onHoverPerson?.(null);
    this.isPointerDown = true;
    this.didDrag = false;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.lastPointerPos = { x: e.clientX, y: e.clientY };
    this.lastPointerClientX = e.clientX;
    this.lastPointerClientY = e.clientY;
    this.lastCanvasPointerClientX = e.clientX;
    this.lastCanvasPointerClientY = e.clientY;
    this.updatePointerNdc(e.clientX, e.clientY);

    // Live Mode: drag always pans smoothly; clean click interacts only with interactive items
    if (!this.store.isEditMode()) {
      const hit = this.raycastItemUid();
      this.pointerDownItemUid = hit?.uid ?? null;
      this.dragKind = 'pan';
      this.refreshBaselineCursor();
      return;
    }

    const modeState = this.store.getModeState();
    if (modeState.mode === 'select') {
      const hit = this.raycastItemUid();
      this.pointerDownItemUid = hit?.uid ?? null;
      const hitItem = hit ? this.store.getItem(hit.uid) : undefined;
      // Direct smooth drag-to-move for ANY non-floor-tile item in Edit Mode!
      if (!e.shiftKey && hit && hitItem && !this.isFloorTile(hitItem.itemId)) {
        this.dragKind = 'drag-item';
      } else {
        this.dragKind = 'pan';
      }
      this.refreshBaselineCursor();
      return;
    }

    if (modeState.mode === 'bulk-select') {
      const hit = this.raycastItemUid();
      this.pointerDownItemUid = hit?.uid ?? null;
      this.marqueeBaseSelection = e.shiftKey ? this.store.getSelectedUids() : [];
      this.dragKind = 'marquee';
      this.refreshBaselineCursor();
      return;
    }

    if (modeState.mode === 'erase') {
      this.pointerDownItemUid = null;
      this.dragKind = 'erase';
      this.erasedAnyInBatch = false;
      this.beginDragBatch();
      this.sceneManager.setEraseHoverUid(null);
      const hitUid = this.raycastEraseUid(modeState.eraseFilter);
      if (hitUid) {
        this.store.deleteItems([hitUid]);
        this.erasedAnyInBatch = true;
      }
      this.refreshBaselineCursor();
      return;
    }

    if (modeState.mode === 'place' && modeState.placementItemId) {
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (def && this.isPaintablePlacement(def)) {
        this.pointerDownItemUid = null;
        this.dragKind = 'paint';
        this.paintedKeys.clear();
        this.beginDragBatch();
        const target = this.resolvePlacementTarget(def, modeState.placementRotation);
        this.currentTarget = target;
        if (target) {
          this.renderGhost(def, modeState.placementVariantId ?? def.variants[0].id, target);
          if (target.valid) {
            const key = this.getPaintKey(def, target);
            this.paintedKeys.add(key);
            this.placeFromTarget(def, modeState.placementVariantId ?? def.variants[0].id, target);
          }
        }
        this.refreshBaselineCursor();
        return;
      }
    }

    this.dragKind = 'none';
    this.pointerDownItemUid = null;
    // On touch screens (no hover), show live ghost preview immediately on touch-down in place/move mode
    if (e.pointerType === 'touch' && (modeState.mode === 'place' || modeState.mode === 'move')) {
      this.processEditHoverOrGhost(e.clientX, e.clientY, true);
    } else {
      this.refreshBaselineCursor();
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger touch pinch-to-zoom + simultaneous midpoint pan
    if (this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const center = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5,
      };
      if (this.lastPinchDist > 0 && dist > 0) {
        this.sceneManager.isoCamera.zoomByFactor(dist / this.lastPinchDist);
      }
      if (this.lastPinchCenter) {
        const dx = center.x - this.lastPinchCenter.x;
        const dy = center.y - this.lastPinchCenter.y;
        if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
          this.sceneManager.isoCamera.panByPixels(dx, dy, this.canvas.clientHeight);
        }
      }
      this.lastPinchDist = dist;
      this.lastPinchCenter = center;
      return;
    }

    this.lastPointerClientX = e.clientX;
    this.lastPointerClientY = e.clientY;
    if (e.target === this.canvas) {
      this.lastCanvasPointerClientX = e.clientX;
      this.lastCanvasPointerClientY = e.clientY;
    }
    this.updatePointerNdc(e.clientX, e.clientY);

    if (this.isPointerDown) {
      const totalDist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y,
      );
      const dragThreshold = e.pointerType === 'touch' ? 14 : DRAG_THRESHOLD_PX;
      if (totalDist > dragThreshold) {
        this.didDrag = true;
      }

      if (this.didDrag && this.dragKind === 'pan') {
        const dx = e.clientX - this.lastPointerPos.x;
        const dy = e.clientY - this.lastPointerPos.y;
        this.sceneManager.isoCamera.panByPixels(dx, dy, this.canvas.clientHeight);
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        this.sceneManager.setHoverOutlineUid(null);
        this.onHoverItem?.(null);
        this.onHoverPerson?.(null);
        this.refreshBaselineCursor();
        return;
      }

      if (this.didDrag && this.dragKind === 'marquee') {
        this.sceneManager.setHoverOutlineUid(null);
        this.onHoverItem?.(null);
        this.onHoverPerson?.(null);
        this.updateMarqueeBox(e.clientX, e.clientY);
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        this.refreshBaselineCursor();
        return;
      }

      if (this.dragKind === 'erase') {
        const filter = this.store.getEraseFilter();
        const hitUid = this.raycastEraseUid(filter);
        if (hitUid) {
          this.store.deleteItems([hitUid]);
          this.erasedAnyInBatch = true;
        }
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        this.refreshBaselineCursor();
        return;
      }

      if (this.didDrag && this.dragKind === 'drag-item' && this.pointerDownItemUid) {
        if (this.store.getModeState().mode !== 'move') {
          this.store.selectItem(this.pointerDownItemUid);
          this.store.startMovingSelected();
          this.sceneManager.setMovingHiddenUid(this.pointerDownItemUid);
        }
      }
    }

    this.lastPointerPos = { x: e.clientX, y: e.clientY };

    const overCanvas = e.target === this.canvas;

    // Priority 1 & 2: cursor overrides (e.g. moving staff) or POV mode skip hover picking cleanly
    if (this.cursorOverride || this.sceneManager.getCameraViewMode?.() !== 'isometric') {
      this.cancelPendingHover();
      this.sceneManager.setHoverOutlineUid(null);
      this.sceneManager.setEraseHoverUid(null);
      this.onHoverItem?.(null);
      this.onHoverPerson?.(null);
      this.refreshBaselineCursor();
      return;
    }

    // Throttle non-dragging hover raycasting (desktop mouse/pen only; touch never hovers)
    if (!this.isPointerDown) {
      if (e.pointerType === 'touch') {
        return;
      }
      this.pendingHover = { clientX: e.clientX, clientY: e.clientY, overCanvas };
      if (this.hoverRafId === 0) {
        this.hoverRafId = requestAnimationFrame(this.flushHoverUpdate);
      }
      return;
    }

    // Active drag in Live Mode (before threshold) keeps active drag cursor cleanly
    if (!this.store.isEditMode()) {
      this.refreshBaselineCursor();
      return;
    }

    // Active drag in place/move mode updates ghost preview immediately
    this.processEditHoverOrGhost(e.clientX, e.clientY, overCanvas);
  };

  private flushHoverUpdate = (): void => {
    this.hoverRafId = 0;
    const pending = this.pendingHover;
    this.pendingHover = null;
    if (!pending || this.isPointerDown) return;

    if (this.cursorOverride || this.sceneManager.getCameraViewMode?.() !== 'isometric') {
      this.onHoverItem?.(null);
      this.onHoverPerson?.(null);
      this.refreshBaselineCursor();
      return;
    }

    this.updatePointerNdc(pending.clientX, pending.clientY);
    if (!this.store.isEditMode()) {
      this.processLiveHover(pending.clientX, pending.clientY, pending.overCanvas);
      return;
    }
    this.processEditHoverOrGhost(pending.clientX, pending.clientY, pending.overCanvas);
  };

  private processLiveHover(clientX: number, clientY: number, overCanvas: boolean): void {
    this.sceneManager.setHoverOutlineUid(null);
    this.sceneManager.setEraseHoverUid(null);

    if (!overCanvas) {
      this.onHoverPerson?.(null);
      this.onHoverItem?.(null);
      this.setCanvasCursor(this.resolveBaselineCursor());
      return;
    }

    // Priority 5a: Live visitor hover -> person info cursor + person hover callback
    const hitVisitorId = this.sceneManager.pickVisitorAtClientPos(clientX, clientY);
    if (hitVisitorId) {
      this.onHoverItem?.(null);
      this.onHoverPerson?.({ instanceId: hitVisitorId, clientX, clientY });
      this.setCanvasCursor('person');
      return;
    }

    // Priority 5b: Interactive item hover -> interact sparkle cursor + compact item hover
    const hit = this.raycastItemUid();
    if (hit) {
      const item = this.store.getItem(hit.uid);
      const def = item ? this.store.data.itemsById.get(item.itemId) : undefined;
      if (item && def?.interaction) {
        this.onHoverPerson?.(null);
        this.onHoverItem?.({
          uid: hit.uid,
          itemId: item.itemId,
          name: def.name,
          clientX,
          clientY,
          kind: 'interact',
          subtitle: 'Click to interact',
        });
        this.setCanvasCursor('interact');
        return;
      }
    }

    // Priority 5c: Empty space or passive item -> open-hand pan cursor
    this.onHoverPerson?.(null);
    this.onHoverItem?.(null);
    this.setCanvasCursor('pan');
  }

  private processEditHoverOrGhost(clientX: number, clientY: number, overCanvas: boolean): void {
    const modeState = this.store.getModeState();
    this.onHoverPerson?.(null);

    // Hover outline + tooltip in Edit Mode ('select' or 'bulk-select')
    if ((modeState.mode === 'select' || modeState.mode === 'bulk-select') && !this.isPointerDown) {
      this.sceneManager.setEraseHoverUid(null);
      if (!overCanvas) {
        this.sceneManager.setHoverOutlineUid(null);
        this.onHoverItem?.(null);
        this.setCanvasCursor(this.resolveBaselineCursor());
        return;
      }
      const hit = this.raycastItemUid();
      if (hit) {
        const item = this.store.getItem(hit.uid);
        const def = item ? this.store.data.itemsById.get(item.itemId) : undefined;
        if (item && def) {
          this.sceneManager.setHoverOutlineUid(hit.uid);
          this.onHoverItem?.({
            uid: hit.uid,
            itemId: item.itemId,
            name: def.name,
            clientX,
            clientY,
            kind: 'item',
          });
          if (
            modeState.mode === 'select' &&
            this.store.getSelectedUids().includes(hit.uid) &&
            !this.isFloorTile(item.itemId)
          ) {
            this.setCanvasCursor('move');
          } else {
            this.setCanvasCursor('select');
          }
          return;
        }
      }
      this.sceneManager.setHoverOutlineUid(null);
      this.onHoverItem?.(null);
      this.setCanvasCursor(modeState.mode === 'bulk-select' ? 'marquee' : 'pan');
      return;
    }

    // Update erase hover outline when hovering in erase mode
    if (modeState.mode === 'erase' && !this.isPointerDown) {
      this.sceneManager.setHoverOutlineUid(null);
      this.onHoverItem?.(null);
      this.sceneManager.setEraseHoverUid(
        overCanvas ? this.raycastEraseUid(modeState.eraseFilter) : null,
      );
      this.setCanvasCursor('erase');
      return;
    }

    // Update ghost preview (and paint drag) when in place or move mode
    if ((modeState.mode === 'place' || modeState.mode === 'move') && modeState.placementItemId) {
      this.sceneManager.setHoverOutlineUid(null);
      this.onHoverItem?.(null);
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) {
        this.refreshBaselineCursor();
        return;
      }
      const movingUid = modeState.mode === 'move' ? (this.store.getSelectedUid() ?? undefined) : undefined;
      const target = this.resolvePlacementTarget(def, modeState.placementRotation, movingUid);
      this.currentTarget = target;
      if (target) {
        this.lastHoverCoord = { gx: target.x, gz: target.z };
      }
      const variantId = modeState.placementVariantId ?? def.variants[0].id;
      if (target) {
        this.renderGhost(def, variantId, target);
        if (this.isPointerDown && this.dragKind === 'paint' && target.valid) {
          const key = this.getPaintKey(def, target);
          if (!this.paintedKeys.has(key)) {
            this.paintedKeys.add(key);
            this.placeFromTarget(def, variantId, target);
          }
        }
      } else {
        this.clearGhost();
      }
      if (modeState.mode === 'move') {
        this.setCanvasCursor('move');
      } else {
        this.setCanvasCursor(target && !target.valid ? 'place-invalid' : 'place');
      }
      return;
    }

    this.refreshBaselineCursor();
  }

  private handlePointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.lastPinchDist = 0;
      this.lastPinchCenter = null;
    }
    if (this.activePointers.size === 0) {
      this.pinchCancelled = false;
    }
    if (this.dragBatchOpen) {
      this.closeDragBatch(this.resolveActiveDragBatchReason());
    }
    this.paintedKeys.clear();
    this.erasedAnyInBatch = false;
    this.isPointerDown = false;
    this.didDrag = false;
    this.dragKind = 'none';
    this.pointerDownItemUid = null;
    this.hideMarquee();
    this.onHoverItem?.(null);
    this.onHoverPerson?.(null);
    this.refreshBaselineCursor();
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.lastPinchDist = 0;
      this.lastPinchCenter = null;
    }
    const wasPinchCancelled = this.pinchCancelled;
    if (this.activePointers.size === 0) {
      this.pinchCancelled = false;
    }

    if (!this.isPointerDown || wasPinchCancelled) {
      this.isPointerDown = false;
      if (this.dragBatchOpen) {
        this.closeDragBatch(this.resolveActiveDragBatchReason());
      }
      this.refreshBaselineCursor();
      return;
    }
    this.isPointerDown = false;

    const schedulePostUpHover = () => {
      if (e.pointerType === 'touch') return;
      if (e.target === this.canvas && !this.cursorOverride && this.sceneManager.getCameraViewMode?.() === 'isometric') {
        this.pendingHover = { clientX: e.clientX, clientY: e.clientY, overCanvas: true };
        if (this.hoverRafId === 0) {
          this.hoverRafId = requestAnimationFrame(this.flushHoverUpdate);
        }
      }
    };

    // Live Mode: click interacts ONLY with interactive items; never selects or bounces static furniture
    if (!this.store.isEditMode()) {
      if (this.dragBatchOpen) {
        this.closeDragBatch();
      }
      const wasDrag = this.didDrag;
      const clickedUid = this.pointerDownItemUid;
      this.dragKind = 'none';
      this.pointerDownItemUid = null;
      if (!wasDrag && clickedUid) {
        const item = this.store.getItem(clickedUid);
        const def = item ? this.store.data.itemsById.get(item.itemId) : undefined;
        if (item && def?.interaction) {
          this.store.triggerInteraction(clickedUid);
        }
      }
      this.refreshBaselineCursor();
      schedulePostUpHover();
      return;
    }

    const modeState = this.store.getModeState();

    if (this.dragKind === 'paint') {
      const hadPaints = this.paintedKeys.size > 0;
      this.closeDragBatch(hadPaints ? 'place' : undefined);
      if (!this.didDrag && !hadPaints && this.currentTarget?.reason) {
        this.store.notify(this.currentTarget.reason, 'error');
      }
      this.paintedKeys.clear();
      this.dragKind = 'none';
      this.refreshBaselineCursor();
      return;
    }

    if (this.dragKind === 'erase') {
      this.closeDragBatch(this.erasedAnyInBatch ? 'delete' : undefined);
      this.erasedAnyInBatch = false;
      this.dragKind = 'none';
      this.refreshBaselineCursor();
      return;
    }

    if (this.dragKind === 'marquee') {
      this.hideMarquee();
      this.dragKind = 'none';
      if (!this.didDrag && this.pointerDownItemUid) {
        this.store.toggleSelectionUid(this.pointerDownItemUid);
      }
      this.refreshBaselineCursor();
      schedulePostUpHover();
      return;
    }

    // Commit drag-move on pointer release
    if (this.dragKind === 'drag-item' && this.didDrag && modeState.mode === 'move') {
      this.commitMove();
      this.dragKind = 'none';
      this.refreshBaselineCursor();
      schedulePostUpHover();
      return;
    }

    this.dragKind = 'none';
    // On touch screens, sliding 1 finger in place/move mode aims the ghost and releasing commits it!
    const isTouchPlaceOrMove =
      e.pointerType === 'touch' && (modeState.mode === 'place' || modeState.mode === 'move');
    if (this.didDrag && !isTouchPlaceOrMove) {
      this.refreshBaselineCursor();
      schedulePostUpHover();
      return;
    }

    // Click in Place mode (non-paintable furniture/surface/ceiling/decor)
    if (modeState.mode === 'place' && modeState.placementItemId) {
      this.updatePointerNdc(e.clientX, e.clientY);
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) {
        this.refreshBaselineCursor();
        return;
      }
      const target = this.resolvePlacementTarget(def, modeState.placementRotation);
      if (target && target.valid) {
        this.placeFromTarget(def, modeState.placementVariantId ?? def.variants[0].id, target);
      } else if (target?.reason) {
        this.store.notify(target.reason, 'error');
      }
      this.refreshBaselineCursor();
      return;
    }

    // Click in Move mode -> commit move
    if (modeState.mode === 'move') {
      this.updatePointerNdc(e.clientX, e.clientY);
      const def = modeState.placementItemId
        ? this.store.data.itemsById.get(modeState.placementItemId)
        : undefined;
      const selectedUid = this.store.getSelectedUid();
      if (def && selectedUid) {
        this.currentTarget = this.resolvePlacementTarget(
          def,
          modeState.placementRotation,
          selectedUid,
        );
      }
      this.commitMove();
      this.refreshBaselineCursor();
      schedulePostUpHover();
      return;
    }

    // Click in Select mode (Edit Mode): select cleanly (Shift+click toggles multi-select)
    if (modeState.mode === 'select') {
      if (this.pointerDownItemUid) {
        if (e.shiftKey) {
          this.store.toggleSelectionUid(this.pointerDownItemUid);
        } else {
          this.store.selectItem(this.pointerDownItemUid);
        }
      } else if (!e.shiftKey) {
        this.store.selectItem(null);
      }
    }
    this.refreshBaselineCursor();
    schedulePostUpHover();
  };

  private commitMove(): void {
    const selected = this.store.getSelectedItem();
    const selectedUid = selected?.uid ?? null;
    this.sceneManager.setMovingHiddenUid(null);
    if (selected && selectedUid && this.currentTarget && this.currentTarget.valid) {
      const def = this.store.data.itemsById.get(selected.itemId);
      const surfaceChildren =
        def && selected.rotation !== this.currentTarget.rotation
          ? this.store
              .getChildren(selectedUid)
              .filter((c) => this.store.data.itemsById.get(c.itemId)?.layer === 'surface')
          : [];

      if (def && surfaceChildren.length > 0) {
        const childTargets = surfaceChildren.map((child) => {
          const cDef = this.store.data.itemsById.get(child.itemId)!;
          const rotPos = this.rotateChildOnParent(
            selected,
            def,
            this.currentTarget!.x,
            this.currentTarget!.z,
            this.currentTarget!.rotation,
            child,
            cDef,
          );
          return { child, ...rotPos };
        });
        this.store.beginBatch();
        const moved = this.store.moveItem(selectedUid, {
          x: this.currentTarget.x,
          y: this.currentTarget.y,
          z: this.currentTarget.z,
          rotation: this.currentTarget.rotation,
          parentUid: this.currentTarget.parentUid,
        });
        if (moved) {
          for (const ct of childTargets) {
            this.store.moveItem(ct.child.uid, {
              x: ct.x,
              y: ct.child.y,
              z: ct.z,
              rotation: ct.rotation,
              parentUid: selectedUid,
            });
          }
        }
        this.store.endBatch(moved ? 'move' : undefined);
      } else {
        this.store.moveItem(selectedUid, {
          x: this.currentTarget.x,
          y: this.currentTarget.y,
          z: this.currentTarget.z,
          rotation: this.currentTarget.rotation,
          parentUid: this.currentTarget.parentUid,
        });
      }
    } else if (this.currentTarget && !this.currentTarget.valid && this.currentTarget.reason) {
      this.store.notify(this.currentTarget.reason, 'error');
    }
    this.store.setSelectMode();
    this.clearGhost();
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();

    // Pinch-to-zoom on laptop trackpads arrives as wheel with ctrlKey=true
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const zoomFactor = Math.exp(-e.deltaY * 0.006);
      this.sceneManager.isoCamera.zoomByFactor(zoomFactor);
      return;
    }

    // Two-finger trackpad scroll pans smoothly in camera-aligned ground space
    this.sceneManager.isoCamera.panByPixels(-e.deltaX * 0.9, -e.deltaY * 0.9, this.canvas.clientHeight);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore shortcuts while typing in inputs
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return;
    }

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        if (this.store.redo()) this.store.notify('Redid action', 'info');
      } else {
        if (this.store.undo()) this.store.notify('Undid action', 'info');
      }
      return;
    }

    if (e.key === 'Escape') {
      if (this.store.getModeState().mode !== 'select') {
        this.store.setSelectMode();
      } else {
        this.store.clearSelection();
      }
      return;
    }

    const lower = e.key.toLowerCase();
    if (lower === 'q') {
      this.sceneManager.isoCamera.rotateStep(-1);
    } else if (lower === 'e') {
      this.sceneManager.isoCamera.rotateStep(1);
    } else if (lower === 'r' && this.store.isEditMode()) {
      const mode = this.store.getModeState().mode;
      if (mode === 'place' || mode === 'move') {
        this.store.rotatePlacement(1);
      } else {
        this.rotateSelectedInPlace();
      }
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && this.store.isEditMode()) {
      const selectedUids = this.store.getSelectedUids();
      if (selectedUids.length > 0) {
        e.preventDefault();
        const removed = this.store.deleteItems(selectedUids);
        this.store.notify(removed > 1 ? `Deleted ${removed} items` : 'Item deleted', 'info');
      }
    } else if (e.key === '=' || e.key === '+') {
      this.sceneManager.isoCamera.zoomByFactor(1.18);
    } else if (e.key === '-' || e.key === '_') {
      this.sceneManager.isoCamera.zoomByFactor(1 / 1.18);
    }
  };

  dispose(): void {
    this.closeDragBatch();
    this.unsubTickHook?.();
    this.unsubTickHook = null;
    this.unsubViewMode?.();
    this.unsubViewMode = null;
    this.cancelPendingHover();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerleave', this.handleCanvasLeave);
    this.canvas.removeEventListener('lostpointercapture', this.handlePointerCancel);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('wheel', this.handleWindowWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.sceneManager.setMovingHiddenUid(null);
    this.clearGhost();
    this.hideMarquee();
    this.ghostGuideRing.geometry.dispose();
    (this.ghostGuideRing.material as THREE.Material).dispose();
    this.wallEdgeGuideBar.geometry.dispose();
    (this.wallEdgeGuideBar.material as THREE.Material).dispose();
  }
}
