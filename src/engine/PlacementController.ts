import * as THREE from 'three';
import type { FurnitureItemDef, PlacedItem, RotationQuarter } from '../data/schemas';
import type { HouseStore } from '../state/houseStore';
import {
  CEILING_HEIGHT,
  WALL_THICKNESS,
  getEffectiveFootprint,
  nearestEdgeRotation,
  tileToWorldCenter,
  validatePlacement,
  wallEdgeToWorldTransform,
  worldToTileFloat,
} from './GridSystem';
import type { SceneManager } from './SceneManager';

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
const DRAG_THRESHOLD_PX = 6;

/**
 * Trackpad-first input & 4-layer placement controller:
 * - Click item: select (or click again to react/toggle)
 * - Click & drag selected item: move smoothly across valid targets
 * - Click & drag empty space: pan camera
 * - Two-finger scroll: pan camera
 * - Trackpad pinch (wheel + ctrlKey) or Alt+wheel: zoom smoothly
 * - No right-click-drag and no keyboard required (optional shortcuts included)
 */
export class PlacementController {
  private readonly sceneManager: SceneManager;
  private readonly store: HouseStore;
  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private ghostGroup: THREE.Group | null = null;
  private ghostGuideRing: THREE.LineLoop;
  private lastGhostKey = '';
  private currentTarget: ResolvedPlacementTarget | null = null;

  // Pointer gesture tracking
  private isPointerDown = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };
  private dragKind: 'none' | 'pan' | 'drag-item' = 'none';
  private pointerDownItemUid: string | null = null;
  private didDrag = false;

  // Active touch points for pinch-to-zoom on touchpads/screens
  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;

  private onHoverHint?: (hint: string | null) => void;

  constructor(
    sceneManager: SceneManager,
    store: HouseStore,
    onHoverHint?: (hint: string | null) => void,
  ) {
    this.sceneManager = sceneManager;
    this.store = store;
    this.canvas = sceneManager.renderer.domElement;
    this.onHoverHint = onHoverHint;

    this.ghostGuideRing = this.createCeilingDropRing();
    this.ghostGuideRing.visible = false;
    this.sceneManager.overlayRoot.add(this.ghostGuideRing);

    this.store.on('modeChanged', () => {
      this.clearGhost();
      this.onHoverHint?.(null);
    });

    this.bindEvents();
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

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private updatePointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastItemUid(ignoreUid?: string): { uid: string; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);
    for (const hit of hits) {
      if (hit.object instanceof THREE.Sprite) continue;
      const uid = hit.object.userData.itemUid as string | undefined;
      if (!uid || uid === ignoreUid) continue;
      return { uid, point: hit.point };
    }
    return null;
  }

  private raycastGround(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
    const hits = this.raycaster.intersectObject(this.sceneManager.gridVisual.groundPlane, false);
    return hits.length > 0 ? hits[0].point : null;
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

    // 1. Surface layer: raycast supporting furniture first, then fallback to tile check
    if (def.layer === 'surface') {
      this.raycaster.setFromCamera(this.pointerNdc, this.sceneManager.isoCamera.camera);
      const hits = this.raycaster.intersectObjects(this.sceneManager.getInteractableMeshes(), true);

      let supportItem: PlacedItem | undefined;
      let hitPoint: THREE.Vector3 | null = null;

      for (const hit of hits) {
        if (hit.object instanceof THREE.Sprite) continue;
        const uid = hit.object.userData.itemUid as string | undefined;
        if (!uid || uid === movingUid) continue;
        const candidate = this.store.getItem(uid);
        const cDef = candidate ? this.store.data.itemsById.get(candidate.itemId) : undefined;
        if (candidate && cDef && cDef.surfaceHeight !== undefined) {
          supportItem = candidate;
          hitPoint = hit.point;
          break;
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

      // Not hovering a surface: show red ghost on floor tile with helpful message
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
        const uid = hit.object.userData.itemUid as string | undefined;
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

    // 3. Structural wall / door / window: auto-snap to nearest tile edge
    if (def.layer === 'wall' && def.wallKind === 'structure') {
      const groundPt = this.raycastGround();
      if (!groundPt) return null;
      const { fx, fz } = worldToTileFloat(groundPt.x, groundPt.z, state.gridWidth, state.gridDepth);
      if (fx < 0 || fz < 0 || fx >= state.gridWidth || fz >= state.gridDepth) {
        return null;
      }
      const edge = nearestEdgeRotation(fx, fz);
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

  private renderGhost(
    def: FurnitureItemDef,
    variantId: string,
    target: ResolvedPlacementTarget,
  ): void {
    const state = this.store.getState();
    const ghostColor = target.valid ? VALID_GHOST_COLOR : INVALID_GHOST_COLOR;
    const key = `${def.id}__${variantId}__${ghostColor}`;

    if (!this.ghostGroup || this.lastGhostKey !== key) {
      this.clearGhost();
      this.ghostGroup = this.sceneManager.assetLoader.createPlaceholderMesh(def, variantId, {
        ghost: true,
        ghostColor,
        hideLabel: true,
      });
      this.sceneManager.overlayRoot.add(this.ghostGroup);
      this.lastGhostKey = key;
    }

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
      this.ghostGroup.position.set(t.wx, target.y, t.wz);
      this.ghostGroup.rotation.set(0, t.rotY, 0);
      this.ghostGuideRing.visible = false;
    } else {
      const eff = getEffectiveFootprint(def, target.rotation);
      const c = tileToWorldCenter(target.x, target.z, eff.w, eff.d, state.gridWidth, state.gridDepth);
      this.ghostGroup.position.set(c.wx, target.y, c.wz);
      this.ghostGroup.rotation.set(0, -target.rotation * (Math.PI / 2), 0);

      if (def.layer === 'ceiling') {
        this.ghostGuideRing.visible = true;
        this.ghostGuideRing.position.set(c.wx, 0.05, c.wz);
        (this.ghostGuideRing.material as THREE.LineBasicMaterial).color.set(ghostColor);
      } else {
        this.ghostGuideRing.visible = false;
      }
    }

    this.onHoverHint?.(target.valid ? null : (target.reason ?? 'Cannot place here'));
  }

  private clearGhost(): void {
    if (this.ghostGroup) {
      this.sceneManager.overlayRoot.remove(this.ghostGroup);
      this.ghostGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      this.ghostGroup = null;
    }
    this.ghostGuideRing.visible = false;
    this.lastGhostKey = '';
    this.currentTarget = null;
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
    const ignore = new Set([selected.uid, ...this.store.getChildren(selected.uid).map((c) => c.uid)]);
    const check = validatePlacement(
      this.store.getState(),
      this.store.data,
      {
        itemId: selected.itemId,
        x: selected.x,
        y: selected.y,
        z: selected.z,
        rotation: nextRot,
        parentUid: selected.parentUid,
      },
      ignore,
    );

    if (!check.valid) {
      this.store.notify(check.reason ?? 'Not enough space to rotate here.', 'error');
      return false;
    }

    return this.store.moveItem(selected.uid, {
      x: selected.x,
      y: selected.y,
      z: selected.z,
      rotation: nextRot,
      parentUid: selected.parentUid,
    });
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // Trackpad primary click only; never requires right-click
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()];
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this.dragKind = 'none';
      return;
    }

    this.isPointerDown = true;
    this.didDrag = false;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.lastPointerPos = { x: e.clientX, y: e.clientY };
    this.updatePointerNdc(e.clientX, e.clientY);

    const { mode } = this.store.getModeState();
    if (mode === 'select') {
      const hit = this.raycastItemUid();
      this.pointerDownItemUid = hit?.uid ?? null;
      // Clicking & dragging an already-selected item drags it directly; dragging empty space pans
      if (hit && hit.uid === this.store.getSelectedUid()) {
        this.dragKind = 'drag-item';
      } else {
        this.dragKind = 'pan';
      }
    } else {
      this.dragKind = 'none';
      this.pointerDownItemUid = null;
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger touch pinch-to-zoom
    if (this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (this.lastPinchDist > 0 && dist > 0) {
        this.sceneManager.isoCamera.zoomByFactor(dist / this.lastPinchDist);
      }
      this.lastPinchDist = dist;
      return;
    }

    this.updatePointerNdc(e.clientX, e.clientY);

    if (this.isPointerDown) {
      const totalDist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y,
      );
      if (totalDist > DRAG_THRESHOLD_PX) {
        this.didDrag = true;
      }

      if (this.didDrag && this.dragKind === 'pan') {
        const dx = e.clientX - this.lastPointerPos.x;
        const dy = e.clientY - this.lastPointerPos.y;
        this.sceneManager.isoCamera.panByPixels(dx, dy, this.canvas.clientHeight);
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        return;
      }

      if (this.didDrag && this.dragKind === 'drag-item' && this.pointerDownItemUid) {
        if (this.store.getModeState().mode !== 'move') {
          this.store.startMovingSelected();
        }
      }
    }

    this.lastPointerPos = { x: e.clientX, y: e.clientY };

    // Update ghost preview when in place or move mode
    const modeState = this.store.getModeState();
    if ((modeState.mode === 'place' || modeState.mode === 'move') && modeState.placementItemId) {
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) return;
      const movingUid = modeState.mode === 'move' ? (this.store.getSelectedUid() ?? undefined) : undefined;
      const target = this.resolvePlacementTarget(def, modeState.placementRotation, movingUid);
      this.currentTarget = target;
      if (target) {
        this.renderGhost(def, modeState.placementVariantId ?? def.variants[0].id, target);
      } else {
        this.clearGhost();
      }
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.lastPinchDist = 0;
    }

    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    const modeState = this.store.getModeState();

    // Commit drag-move on pointer release
    if (this.dragKind === 'drag-item' && this.didDrag && modeState.mode === 'move') {
      this.commitMove();
      this.dragKind = 'none';
      return;
    }

    this.dragKind = 'none';
    if (this.didDrag) return;

    // Click in Place mode -> place item
    if (modeState.mode === 'place' && modeState.placementItemId) {
      this.updatePointerNdc(e.clientX, e.clientY);
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) return;
      const target = this.resolvePlacementTarget(def, modeState.placementRotation);
      if (target && target.valid) {
        this.store.placeItem({
          itemId: def.id,
          x: target.x,
          y: target.y,
          z: target.z,
          rotation: target.rotation,
          variantId: modeState.placementVariantId ?? def.variants[0].id,
          parentUid: target.parentUid,
        });
      } else if (target?.reason) {
        this.store.notify(target.reason, 'error');
      }
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
      return;
    }

    // Click in Select mode -> select item, or click already-selected item to interact!
    if (modeState.mode === 'select') {
      if (this.pointerDownItemUid) {
        if (this.store.getSelectedUid() === this.pointerDownItemUid) {
          const interacted = this.store.triggerInteraction(this.pointerDownItemUid);
          if (interacted) {
            const def = this.store.data.itemsById.get(interacted.itemId);
            if (def?.interaction) {
              this.store.notify(`${def.name}: ${def.interaction.label}`, 'info');
            }
          }
        } else {
          this.store.selectItem(this.pointerDownItemUid);
        }
      } else {
        this.store.selectItem(null);
      }
    }
  };

  private commitMove(): void {
    const selectedUid = this.store.getSelectedUid();
    if (selectedUid && this.currentTarget && this.currentTarget.valid) {
      this.store.moveItem(selectedUid, {
        x: this.currentTarget.x,
        y: this.currentTarget.y,
        z: this.currentTarget.z,
        rotation: this.currentTarget.rotation,
        parentUid: this.currentTarget.parentUid,
      });
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
        this.store.selectItem(null);
      }
      return;
    }

    const lower = e.key.toLowerCase();
    if (lower === 'q') {
      this.sceneManager.isoCamera.rotateStep(-1);
    } else if (lower === 'e') {
      this.sceneManager.isoCamera.rotateStep(1);
    } else if (lower === 'r') {
      const mode = this.store.getModeState().mode;
      if (mode === 'place' || mode === 'move') {
        this.store.rotatePlacement(1);
      } else {
        this.rotateSelectedInPlace();
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      const selectedUid = this.store.getSelectedUid();
      if (selectedUid) {
        e.preventDefault();
        this.store.deleteItem(selectedUid);
        this.store.notify('Item deleted', 'info');
      }
    } else if (e.key === '=' || e.key === '+') {
      this.sceneManager.isoCamera.zoomByFactor(1.18);
    } else if (e.key === '-' || e.key === '_') {
      this.sceneManager.isoCamera.zoomByFactor(1 / 1.18);
    }
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.clearGhost();
  }
}
