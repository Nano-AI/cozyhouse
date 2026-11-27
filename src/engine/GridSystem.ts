import * as THREE from 'three';
import type {
  FurnitureItemDef,
  GameDataBundle,
  HouseState,
  RotationQuarter,
} from '../data/schemas';

export const CEILING_HEIGHT = 2.6;
export const WALL_THICKNESS = 0.14;

export interface EffectiveFootprint {
  w: number;
  d: number;
}

export interface PlacementValidation {
  valid: boolean;
  reason?: string;
}

export function getEffectiveFootprint(
  def: FurnitureItemDef,
  rotation: RotationQuarter,
): EffectiveFootprint {
  const [fw, fd] = def.footprint;
  return rotation % 2 === 1 ? { w: fd, d: fw } : { w: fw, d: fd };
}

/**
 * Normalizes a wall edge to a canonical key so shared edges between adjacent
 * rooms (e.g., South of (x,z) and North of (x,z+1)) map to the exact same key.
 */
export function canonicalWallEdgeKey(x: number, z: number, rotation: RotationQuarter): string {
  switch (rotation) {
    case 0: // North edge of (x, z)
      return `H:${x}:${z}`;
    case 2: // South edge of (x, z)
      return `H:${x}:${z + 1}`;
    case 3: // West edge of (x, z)
      return `V:${x}:${z}`;
    case 1: // East edge of (x, z)
      return `V:${x + 1}:${z}`;
  }
}

export function parseCanonicalWallEdgeKey(key: string): {
  axis: 'H' | 'V';
  ex: number;
  ez: number;
} {
  const [axis, exStr, ezStr] = key.split(':');
  return {
    axis: axis === 'V' ? 'V' : 'H',
    ex: Number(exStr),
    ez: Number(ezStr),
  };
}

function wallEdgeCutsRect(
  axis: 'H' | 'V',
  ex: number,
  ez: number,
  rx: number,
  rz: number,
  rw: number,
  rd: number,
): boolean {
  if (axis === 'H') {
    return ex >= rx && ex < rx + rw && ez > rz && ez < rz + rd;
  }
  return ez >= rz && ez < rz + rd && ex > rx && ex < rx + rw;
}

export function tileToWorldCenter(
  x: number,
  z: number,
  effW: number,
  effD: number,
  gridWidth: number,
  gridDepth: number,
): { wx: number; wz: number } {
  return {
    wx: x + effW / 2 - gridWidth / 2,
    wz: z + effD / 2 - gridDepth / 2,
  };
}

export function wallEdgeToWorldTransform(
  x: number,
  z: number,
  rotation: RotationQuarter,
  gridWidth: number,
  gridDepth: number,
  mountOffset = 0,
): { wx: number; wz: number; rotY: number } {
  const tileCenterX = x + 0.5 - gridWidth / 2;
  const tileCenterZ = z + 0.5 - gridDepth / 2;

  switch (rotation) {
    case 0: // North edge, facing +Z
      return {
        wx: tileCenterX,
        wz: z - gridDepth / 2 + mountOffset,
        rotY: 0,
      };
    case 1: // East edge, facing -X
      return {
        wx: x + 1 - gridWidth / 2 - mountOffset,
        wz: tileCenterZ,
        rotY: -Math.PI / 2,
      };
    case 2: // South edge, facing -Z
      return {
        wx: tileCenterX,
        wz: z + 1 - gridDepth / 2 - mountOffset,
        rotY: Math.PI,
      };
    case 3: // West edge, facing +X
      return {
        wx: x - gridWidth / 2 + mountOffset,
        wz: tileCenterZ,
        rotY: Math.PI / 2,
      };
  }
}

export function worldToTileFloat(
  wx: number,
  wz: number,
  gridWidth: number,
  gridDepth: number,
): { fx: number; fz: number } {
  return {
    fx: wx + gridWidth / 2,
    fz: wz + gridDepth / 2,
  };
}

/** Given a fractional tile coordinate inside a cell, returns the closest edge (0=N,1=E,2=S,3=W). */
export function nearestEdgeRotation(fx: number, fz: number): {
  x: number;
  z: number;
  rotation: RotationQuarter;
} {
  const x = Math.floor(fx);
  const z = Math.floor(fz);
  const lx = fx - x;
  const lz = fz - z;

  const distN = lz;
  const distS = 1 - lz;
  const distW = lx;
  const distE = 1 - lx;

  const min = Math.min(distN, distS, distW, distE);
  if (min === distN) return { x, z, rotation: 0 };
  if (min === distE) return { x, z, rotation: 1 };
  if (min === distS) return { x, z, rotation: 2 };
  return { x, z, rotation: 3 };
}

function rectsOverlap(
  ax: number,
  az: number,
  aw: number,
  ad: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && az < bz + bd && az + ad > bz;
}

export function validatePlacement(
  state: HouseState,
  data: GameDataBundle,
  candidate: {
    itemId: string;
    x: number;
    y: number;
    z: number;
    rotation: RotationQuarter;
    parentUid?: string;
  },
  ignoreUids?: Set<string>,
): PlacementValidation {
  const def = data.itemsById.get(candidate.itemId);
  if (!def) {
    return { valid: false, reason: 'Unknown item' };
  }

  const eff = getEffectiveFootprint(def, candidate.rotation);

  if (
    candidate.x < 0 ||
    candidate.z < 0 ||
    candidate.x + eff.w > state.gridWidth ||
    candidate.z + eff.d > state.gridDepth
  ) {
    return { valid: false, reason: 'Outside lot boundary' };
  }

  // Structural walls occupy grid edges
  if (def.layer === 'wall' && def.wallKind === 'structure') {
    const edgeKey = canonicalWallEdgeKey(candidate.x, candidate.z, candidate.rotation);
    const parsed = parseCanonicalWallEdgeKey(edgeKey);
    for (const existing of state.items) {
      if (ignoreUids?.has(existing.uid)) continue;
      const exDef = data.itemsById.get(existing.itemId);
      if (!exDef) continue;
      if (exDef.layer === 'wall' && exDef.wallKind === 'structure') {
        if (canonicalWallEdgeKey(existing.x, existing.z, existing.rotation) === edgeKey) {
          return { valid: false, reason: 'Wall edge already occupied' };
        }
      } else if (exDef.layer === 'floor' && (exDef.subLayer ?? 'object') === 'object') {
        const exEff = getEffectiveFootprint(exDef, existing.rotation);
        if (wallEdgeCutsRect(parsed.axis, parsed.ex, parsed.ez, existing.x, existing.z, exEff.w, exEff.d)) {
          return { valid: false, reason: 'Cannot place wall through furniture' };
        }
      }
    }
    return { valid: true };
  }

  // Wall-mounted decor must attach to an existing wall structure
  if (def.layer === 'wall' && def.wallKind === 'mounted') {
    if (!candidate.parentUid) {
      return { valid: false, reason: 'Attach to a wall' };
    }
    const parent = state.items.find((i) => i.uid === candidate.parentUid);
    const parentDef = parent ? data.itemsById.get(parent.itemId) : undefined;
    if (!parent || !parentDef || parentDef.layer !== 'wall' || parentDef.wallKind !== 'structure') {
      return { valid: false, reason: 'Requires a wall segment' };
    }
    if (parentDef.tags.includes('window') || parentDef.tags.includes('door')) {
      return { valid: false, reason: 'Cannot mount on doors or windows' };
    }
    // Check overlap with other mounted items on the same wall face
    for (const existing of state.items) {
      if (ignoreUids?.has(existing.uid)) continue;
      if (
        existing.parentUid === candidate.parentUid &&
        existing.rotation === candidate.rotation
      ) {
        return { valid: false, reason: 'Wall spot already occupied' };
      }
    }
    return { valid: true };
  }

  // Surface items must sit on a supporting item with `surfaceHeight`
  if (def.layer === 'surface') {
    if (!candidate.parentUid) {
      return { valid: false, reason: 'Place on a counter, table, or shelf' };
    }
    const parent = state.items.find((i) => i.uid === candidate.parentUid);
    const parentDef = parent ? data.itemsById.get(parent.itemId) : undefined;
    if (!parent || !parentDef || parentDef.surfaceHeight === undefined) {
      return { valid: false, reason: 'Surface does not support items' };
    }
    const pEff = getEffectiveFootprint(parentDef, parent.rotation);
    const insideParent =
      candidate.x >= parent.x &&
      candidate.z >= parent.z &&
      candidate.x + eff.w <= parent.x + pEff.w &&
      candidate.z + eff.d <= parent.z + pEff.d;

    if (!insideParent) {
      return { valid: false, reason: 'Must fit on supporting surface' };
    }

    for (const existing of state.items) {
      if (ignoreUids?.has(existing.uid)) continue;
      if (existing.parentUid !== candidate.parentUid) continue;
      const exDef = data.itemsById.get(existing.itemId);
      if (!exDef || exDef.layer !== 'surface') continue;
      const exEff = getEffectiveFootprint(exDef, existing.rotation);
      if (rectsOverlap(candidate.x, candidate.z, eff.w, eff.d, existing.x, existing.z, exEff.w, exEff.d)) {
        return { valid: false, reason: 'Surface spot already occupied' };
      }
    }
    return { valid: true };
  }

  // Ceiling items collide only with ceiling items
  if (def.layer === 'ceiling') {
    for (const existing of state.items) {
      if (ignoreUids?.has(existing.uid)) continue;
      const exDef = data.itemsById.get(existing.itemId);
      if (!exDef || exDef.layer !== 'ceiling') continue;
      const exEff = getEffectiveFootprint(exDef, existing.rotation);
      if (rectsOverlap(candidate.x, candidate.z, eff.w, eff.d, existing.x, existing.z, exEff.w, exEff.d)) {
        return { valid: false, reason: 'Ceiling tile already occupied' };
      }
    }
    return { valid: true };
  }

  // Floor items collide only within their own subLayer (tile / rug / object)
  const mySub = def.subLayer ?? 'object';
  for (const existing of state.items) {
    if (ignoreUids?.has(existing.uid)) continue;
    const exDef = data.itemsById.get(existing.itemId);
    if (!exDef) continue;
    if (mySub === 'object' && exDef.layer === 'wall' && exDef.wallKind === 'structure') {
      const parsed = parseCanonicalWallEdgeKey(
        canonicalWallEdgeKey(existing.x, existing.z, existing.rotation),
      );
      if (wallEdgeCutsRect(parsed.axis, parsed.ex, parsed.ez, candidate.x, candidate.z, eff.w, eff.d)) {
        return { valid: false, reason: 'Blocked by wall' };
      }
      continue;
    }
    if (exDef.layer !== 'floor') continue;
    const exSub = exDef.subLayer ?? 'object';
    if (exSub !== mySub) continue;
    const exEff = getEffectiveFootprint(exDef, existing.rotation);
    if (rectsOverlap(candidate.x, candidate.z, eff.w, eff.d, existing.x, existing.z, exEff.w, exEff.d)) {
      return { valid: false, reason: 'Tile already occupied' };
    }
  }

  return { valid: true };
}

/**
 * Flat ground-level buildable lot plane with toggleable Sims-style architectural grid tiles.
 * Zero stacked platforms — sits completely flush at y = 0 with the surrounding scenery.
 */
export class GridVisual {
  readonly group = new THREE.Group();
  readonly groundPlane: THREE.Mesh;

  private readonly gridOverlay = new THREE.Group();
  private yardColorHex = '#c9dcb8';
  private yardVisible = true;
  private gridVisible = false;

  constructor(gridWidth: number, gridDepth: number) {
    this.group.name = 'HouseGrid';

    // Flush invisible shadow-receiving build plane at y = 0 (zero elevated slab!)
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridDepth);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.ShadowMaterial({
      opacity: 0.16,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.groundPlane = new THREE.Mesh(planeGeo, planeMat);
    this.groundPlane.position.y = 0.002;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.name = 'BuildPlane';
    this.group.add(this.groundPlane);

    // Toggleable architectural build grid (shown in Edit Mode or when Grid toggle is active)
    this.gridOverlay.name = 'BuildableGridOverlay';
    this.gridOverlay.visible = this.gridVisible;

    const halfW = gridWidth / 2;
    const halfD = gridDepth / 2;

    // Subtle tinted translucent build zone wash (SceneManager lifts BuildableGridOverlay by +0.025 -> y = 0.028..0.033)
    const washGeo = new THREE.PlaneGeometry(gridWidth, gridDepth);
    washGeo.rotateX(-Math.PI / 2);
    const washMat = new THREE.MeshBasicMaterial({
      color: 0xfffaf0,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const wash = new THREE.Mesh(washGeo, washMat);
    wash.position.y = 0.003;
    this.gridOverlay.add(wash);

    // Interior grid lines (lifted by SceneManager +0.025 -> y = 0.030)
    const linePoints: number[] = [];
    const yLine = 0.005;
    for (let i = 0; i <= gridWidth; i++) {
      const x = i - halfW;
      linePoints.push(x, yLine, -halfD, x, yLine, halfD);
    }
    for (let j = 0; j <= gridDepth; j++) {
      const z = j - halfD;
      linePoints.push(-halfW, yLine, z, halfW, yLine, z);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x6f685e,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.gridOverlay.add(new THREE.LineSegments(lineGeo, lineMat));

    // Soft intersection cross-ticks for crisp tile readability
    const tickPoints: number[] = [];
    const tickHalf = 0.07;
    const yTick = 0.006;
    for (let i = 0; i <= gridWidth; i++) {
      const x = i - halfW;
      for (let j = 0; j <= gridDepth; j++) {
        const z = j - halfD;
        const tx0 = Math.max(-halfW, x - tickHalf);
        const tx1 = Math.min(halfW, x + tickHalf);
        const tz0 = Math.max(-halfD, z - tickHalf);
        const tz1 = Math.min(halfD, z + tickHalf);
        tickPoints.push(tx0, yTick, z, tx1, yTick, z);
        tickPoints.push(x, yTick, tz0, x, yTick, tz1);
      }
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPoints, 3));
    const tickMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.gridOverlay.add(new THREE.LineSegments(tickGeo, tickMat));

    // Crisp outer lot boundary line
    const borderPts = [
      new THREE.Vector3(-halfW, 0.008, -halfD),
      new THREE.Vector3(halfW, 0.008, -halfD),
      new THREE.Vector3(halfW, 0.008, halfD),
      new THREE.Vector3(-halfW, 0.008, halfD),
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const borderMat = new THREE.LineBasicMaterial({
      color: 0xf5ece0,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.gridOverlay.add(new THREE.LineLoop(borderGeo, borderMat));

    this.group.add(this.gridOverlay);

    // Freeze static transforms on all grid meshes & lines
    this.group.traverse((obj) => {
      obj.updateMatrix();
      obj.matrixAutoUpdate = false;
    });
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.gridOverlay.visible = visible;
  }

  isGridVisible(): boolean {
    return this.gridVisible;
  }

  setYardColor(hex: string): void {
    this.yardColorHex = hex;
  }

  getYardColor(): string {
    return this.yardColorHex;
  }

  setYardVisible(visible: boolean): void {
    this.yardVisible = visible;
  }

  isYardVisible(): boolean {
    return this.yardVisible;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.LineSegments ||
        obj instanceof THREE.LineLoop
      ) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
