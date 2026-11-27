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
    for (const existing of state.items) {
      if (ignoreUids?.has(existing.uid)) continue;
      const exDef = data.itemsById.get(existing.itemId);
      if (exDef?.layer === 'wall' && exDef.wallKind === 'structure') {
        if (canonicalWallEdgeKey(existing.x, existing.z, existing.rotation) === edgeKey) {
          return { valid: false, reason: 'Wall edge already occupied' };
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
    if (parent.itemId === 'window_wide' || parent.itemId === 'door_wood') {
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
    if (!exDef || exDef.layer !== 'floor') continue;
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
 * Renders the cozy pastel lot slab, soft beveled diorama plinth, and crisp grid lines.
 */
export class GridVisual {
  readonly group = new THREE.Group();
  readonly groundPlane: THREE.Mesh;

  constructor(gridWidth: number, gridDepth: number) {
    this.group.name = 'HouseGrid';

    // Diorama plinth slab beneath the house lot
    const plinthGeo = new THREE.BoxGeometry(gridWidth + 0.8, 0.55, gridDepth + 0.8);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0xe6dfd3,
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.285;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // Subtle soft-grass / courtyard surround rim
    const yardGeo = new THREE.BoxGeometry(gridWidth + 2.4, 0.25, gridDepth + 2.4);
    const yardMat = new THREE.MeshStandardMaterial({
      color: 0xc9dcb8,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    });
    const yard = new THREE.Mesh(yardGeo, yardMat);
    yard.position.y = -0.45;
    yard.receiveShadow = true;
    yard.name = 'LotYard';
    this.group.add(yard);

    // Raycastable build plane at y = 0
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridDepth);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe6,
      roughness: 0.95,
      metalness: 0.0,
    });
    this.groundPlane = new THREE.Mesh(planeGeo, planeMat);
    this.groundPlane.position.y = -0.005;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.name = 'BuildPlane';
    this.group.add(this.groundPlane);

    // Subtle architectural grid lines
    const points: number[] = [];
    const halfW = gridWidth / 2;
    const halfD = gridDepth / 2;
    const y = 0.004;

    for (let i = 0; i <= gridWidth; i++) {
      const x = i - halfW;
      points.push(x, y, -halfD, x, y, halfD);
    }
    for (let j = 0; j <= gridDepth; j++) {
      const z = j - halfD;
      points.push(-halfW, y, z, halfW, y, z);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xc8bfb0,
      transparent: true,
      opacity: 0.55,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    this.group.add(lines);
  }

  setYardColor(hex: string): void {
    const yard = this.group.getObjectByName('LotYard') as THREE.Mesh | undefined;
    if (yard && yard.material instanceof THREE.MeshStandardMaterial) {
      yard.material.color.set(hex);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
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
