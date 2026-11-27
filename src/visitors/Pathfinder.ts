import type {
  FurnitureItemDef,
  GameDataBundle,
  HouseState,
  PlacedItem,
  RotationQuarter,
} from '../data/schemas';
import {
  canonicalWallEdgeKey,
  getEffectiveFootprint,
  tileToWorldCenter,
  wallEdgeToWorldTransform,
} from '../engine/GridSystem';

export interface GridCoord {
  x: number;
  z: number;
}

export interface WorldPoint {
  wx: number;
  wz: number;
}

export interface DoorEntry {
  item: PlacedItem;
  insideTile: GridCoord;
  outsideTile: GridCoord;
  outsideWorld: WorldPoint;
}

export interface NavGrid {
  width: number;
  depth: number;
  /** True when no blocking floor object occupies the tile. */
  walkable: boolean[][];
  /** True when a floor tile item is placed on the tile (helps find interior vs yard). */
  hasFloorTile: boolean[][];
  /** Canonical edge keys (`H:x:z` / `V:x:z`) blocked by solid walls/windows (doors are passable). */
  blockedEdges: Set<string>;
  doors: DoorEntry[];
}

export interface ApproachTarget {
  tile: GridCoord;
  faceWorld: WorldPoint;
}

export interface GridPathOptions {
  allowOccupiedStart?: boolean;
  /** Tiles that cannot be stepped onto (except `goal` if `allowGoalInBlocked` is true). */
  blockedTiles?: Set<number>;
  /** Tiles that carry extra movement cost (e.g., another visitor's occupied tile). */
  penalizedTiles?: Set<number>;
  penaltyCost?: number;
}

const CARDINAL_DIRS: readonly GridCoord[] = [
  { x: 0, z: -1 }, // North
  { x: 1, z: 0 },  // East
  { x: 0, z: 1 },  // South
  { x: -1, z: 0 }, // West
];

export const VISITOR_WALL_MARGIN = 0.24;

export function tileIndex(x: number, z: number, depth: number): number {
  return x * depth + z;
}

export function inGridBounds(x: number, z: number, width: number, depth: number): boolean {
  return x >= 0 && z >= 0 && x < width && z < depth;
}

export function tileCenterToWorld(
  x: number,
  z: number,
  width: number,
  depth: number,
): WorldPoint {
  return tileToWorldCenter(x, z, 1, 1, width, depth);
}

/**
 * Returns the canonical wall edge key separating `(ax, az)` and an adjacent cardinal neighbor `(bx, bz)`.
 */
export function edgeKeyBetween(ax: number, az: number, bx: number, bz: number): string | null {
  const dx = bx - ax;
  const dz = bz - az;
  if (dx === 0 && dz === -1) return canonicalWallEdgeKey(ax, az, 0); // North
  if (dx === 1 && dz === 0) return canonicalWallEdgeKey(ax, az, 1);  // East
  if (dx === 0 && dz === 1) return canonicalWallEdgeKey(ax, az, 2);  // South
  if (dx === -1 && dz === 0) return canonicalWallEdgeKey(ax, az, 3); // West
  return null;
}

/**
 * Computes front-facing cardinal offset in grid space matching SceneManager's `rotY = -rotation * PI/2`.
 */
function itemFrontOffset(rotation: RotationQuarter): GridCoord {
  switch (rotation) {
    case 0:
      return { x: 0, z: 1 };
    case 1:
      return { x: -1, z: 0 };
    case 2:
      return { x: 0, z: -1 };
    case 3:
      return { x: 1, z: 0 };
  }
}

export function buildNavGrid(state: HouseState, data: GameDataBundle): NavGrid {
  const width = state.gridWidth;
  const depth = state.gridDepth;

  const walkable: boolean[][] = Array.from({ length: width }, () => Array(depth).fill(true));
  const hasFloorTile: boolean[][] = Array.from({ length: width }, () => Array(depth).fill(false));
  const blockedEdges = new Set<string>();
  const doorItems: PlacedItem[] = [];

  for (const item of state.items) {
    const def = data.itemsById.get(item.itemId);
    if (!def) continue;

    if (def.layer === 'wall' && def.wallKind === 'structure') {
      const isPassableOpening =
        def.tags.includes('door') ||
        def.tags.includes('entrance') ||
        item.itemId === 'wall_arch';
      if (def.tags.includes('door') || def.tags.includes('entrance')) {
        doorItems.push(item);
      }
      if (!isPassableOpening) {
        blockedEdges.add(canonicalWallEdgeKey(item.x, item.z, item.rotation));
      }
      continue;
    }

    if (def.layer === 'floor') {
      const eff = getEffectiveFootprint(def, item.rotation);
      const sub = def.subLayer ?? 'object';
      for (let dx = 0; dx < eff.w; dx++) {
        for (let dz = 0; dz < eff.d; dz++) {
          const tx = item.x + dx;
          const tz = item.z + dz;
          if (!inGridBounds(tx, tz, width, depth)) continue;
          if (sub === 'tile') {
            hasFloorTile[tx][tz] = true;
          } else if (sub === 'object') {
            walkable[tx][tz] = false;
          }
        }
      }
    }
  }

  // Resolve door inside/outside tiles so visitors spawn on the yard side and step inside
  const doors: DoorEntry[] = [];
  for (const door of doorItems) {
    const sideA: GridCoord = { x: door.x, z: door.z };
    let sideB: GridCoord;
    switch (door.rotation) {
      case 0:
        sideB = { x: door.x, z: door.z - 1 };
        break;
      case 1:
        sideB = { x: door.x + 1, z: door.z };
        break;
      case 2:
        sideB = { x: door.x, z: door.z + 1 };
        break;
      case 3:
        sideB = { x: door.x - 1, z: door.z };
        break;
    }

    const aIn = inGridBounds(sideA.x, sideA.z, width, depth);
    const bIn = inGridBounds(sideB.x, sideB.z, width, depth);
    const aFloor = aIn && hasFloorTile[sideA.x][sideA.z];
    const bFloor = bIn && hasFloorTile[sideB.x][sideB.z];

    let insideTile = sideA;
    let outsideTile = sideB;
    if (bFloor && !aFloor) {
      insideTile = sideB;
      outsideTile = sideA;
    } else if (!bIn && aIn) {
      insideTile = sideA;
      outsideTile = sideB;
    }

    const clampedOutside: GridCoord = {
      x: Math.max(0, Math.min(width - 1, outsideTile.x)),
      z: Math.max(0, Math.min(depth - 1, outsideTile.z)),
    };

    const outsideWorld = inGridBounds(outsideTile.x, outsideTile.z, width, depth)
      ? tileCenterToWorld(outsideTile.x, outsideTile.z, width, depth)
      : {
          wx: outsideTile.x + 0.5 - width / 2,
          wz: outsideTile.z + 0.5 - depth / 2,
        };

    doors.push({
      item: door,
      insideTile,
      outsideTile: clampedOutside,
      outsideWorld,
    });
  }

  return { width, depth, walkable, hasFloorTile, blockedEdges, doors };
}

export function canStepBetween(
  nav: NavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  if (!inGridBounds(bx, bz, nav.width, nav.depth)) return false;
  if (!nav.walkable[bx][bz]) return false;
  const key = edgeKeyBetween(ax, az, bx, bz);
  if (key && nav.blockedEdges.has(key)) return false;
  return true;
}

/**
 * Cost-aware A* pathfinder on the 4-connected tile grid.
 * Supports avoiding other visitors' reserved/stationary tiles via `blockedTiles` & `penalizedTiles`.
 * Returns tile path excluding `start` and including `goal`, or `null` if unreachable.
 */
export function findGridPath(
  nav: NavGrid,
  start: GridCoord,
  goal: GridCoord,
  options?: GridPathOptions | boolean,
): GridCoord[] | null {
  const opts: GridPathOptions =
    typeof options === 'boolean' ? { allowOccupiedStart: options } : (options ?? {});
  const allowOccupiedStart = opts.allowOccupiedStart ?? true;
  const blockedTiles = opts.blockedTiles;
  const penalizedTiles = opts.penalizedTiles;
  const penaltyCost = opts.penaltyCost ?? 6;

  if (!inGridBounds(start.x, start.z, nav.width, nav.depth)) return null;
  if (!inGridBounds(goal.x, goal.z, nav.width, nav.depth)) return null;
  if (!nav.walkable[goal.x][goal.z]) return null;
  if (!allowOccupiedStart && !nav.walkable[start.x][start.z]) return null;

  if (start.x === goal.x && start.z === goal.z) {
    return [];
  }

  const total = nav.width * nav.depth;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);
  const parent = new Int16Array(total).fill(-1);

  const startIdx = tileIndex(start.x, start.z, nav.depth);
  const goalIdx = tileIndex(goal.x, goal.z, nav.depth);

  gScore[startIdx] = 0;
  fScore[startIdx] = Math.abs(goal.x - start.x) + Math.abs(goal.z - start.z);

  const openList: number[] = [startIdx];
  inOpen[startIdx] = 1;

  while (openList.length > 0) {
    // Pick lowest fScore node from openList (grid is small <= 1296 tiles)
    let bestPos = 0;
    let curr = openList[0];
    let bestF = fScore[curr];
    for (let i = 1; i < openList.length; i++) {
      const idx = openList[i];
      if (fScore[idx] < bestF) {
        bestF = fScore[idx];
        curr = idx;
        bestPos = i;
      }
    }

    openList[bestPos] = openList[openList.length - 1];
    openList.pop();
    inOpen[curr] = 0;

    if (curr === goalIdx) {
      const path: GridCoord[] = [];
      let trace = curr;
      while (trace !== startIdx && trace !== -1) {
        const tx = Math.floor(trace / nav.depth);
        const tz = trace % nav.depth;
        path.push({ x: tx, z: tz });
        trace = parent[trace];
      }
      path.reverse();
      return path;
    }

    closed[curr] = 1;
    const cx = Math.floor(curr / nav.depth);
    const cz = curr % nav.depth;
    const currG = gScore[curr];

    for (const dir of CARDINAL_DIRS) {
      const nx = cx + dir.x;
      const nz = cz + dir.z;
      if (!canStepBetween(nav, cx, cz, nx, nz)) continue;

      const nIdx = tileIndex(nx, nz, nav.depth);
      if (closed[nIdx]) continue;
      if (nIdx !== goalIdx && blockedTiles?.has(nIdx)) continue;

      const stepCost = 1 + (penalizedTiles?.has(nIdx) ? penaltyCost : 0);
      const tentativeG = currG + stepCost;

      if (tentativeG < gScore[nIdx]) {
        parent[nIdx] = curr;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + Math.abs(goal.x - nx) + Math.abs(goal.z - nz);
        if (!inOpen[nIdx]) {
          openList.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  return null;
}

/**
 * Returns all tiles reachable from `start` with their path distance.
 */
export function computeReachableDistances(
  nav: NavGrid,
  start: GridCoord,
): Map<number, number> {
  const dist = new Map<number, number>();
  if (!inGridBounds(start.x, start.z, nav.width, nav.depth)) return dist;

  const startIdx = tileIndex(start.x, start.z, nav.depth);
  const queue: number[] = [startIdx];
  dist.set(startIdx, 0);

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const d = dist.get(curr) ?? 0;
    const cx = Math.floor(curr / nav.depth);
    const cz = curr % nav.depth;

    for (const dir of CARDINAL_DIRS) {
      const nx = cx + dir.x;
      const nz = cz + dir.z;
      if (!canStepBetween(nav, cx, cz, nx, nz)) continue;
      const nIdx = tileIndex(nx, nz, nav.depth);
      if (!dist.has(nIdx)) {
        dist.set(nIdx, d + 1);
        queue.push(nIdx);
      }
    }
  }
  return dist;
}

/**
 * Finds the nearest walkable tile to `(wx, wz)` inside the grid (useful after lot resize or edits).
 */
export function findNearestWalkableTile(nav: NavGrid, wx: number, wz: number): GridCoord {
  const fx = Math.floor(wx + nav.width / 2);
  const fz = Math.floor(wz + nav.depth / 2);
  const cx = Math.max(0, Math.min(nav.width - 1, fx));
  const cz = Math.max(0, Math.min(nav.depth - 1, fz));
  if (nav.walkable[cx][cz]) return { x: cx, z: cz };

  let best: GridCoord = { x: cx, z: cz };
  let bestDist = Infinity;
  for (let x = 0; x < nav.width; x++) {
    for (let z = 0; z < nav.depth; z++) {
      if (!nav.walkable[x][z]) continue;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < bestDist) {
        bestDist = d;
        best = { x, z };
      }
    }
  }
  return best;
}

/**
 * Clamps a continuous world movement `(fromWx, fromWz) -> (toWx, toWz)` against
 * solid walls (`blockedEdges`) and blocking floor objects (`!nav.walkable`),
 * keeping a soft margin so continuous collision avoidance NEVER pushes a visitor
 * through a wall or into a sofa/table.
 */
export function resolveSafeMovement(
  nav: NavGrid,
  fromWx: number,
  fromWz: number,
  toWx: number,
  toWz: number,
  allowOutsideBounds = false,
  margin = VISITOR_WALL_MARGIN,
): WorldPoint {
  const halfW = nav.width / 2;
  const halfD = nav.depth / 2;

  const isEdgeOrTileBlocked = (tx: number, tz: number, nx: number, nz: number): boolean => {
    const key = edgeKeyBetween(tx, tz, nx, nz);
    if (key && nav.blockedEdges.has(key)) return true;
    if (!inGridBounds(nx, nz, nav.width, nav.depth)) return !allowOutsideBounds;
    return !nav.walkable[nx][nz];
  };

  const clampInsideTile = (wx: number, wz: number): WorldPoint | null => {
    const fx = wx + halfW;
    const fz = wz + halfD;
    const tx = Math.floor(fx);
    const tz = Math.floor(fz);

    if (!inGridBounds(tx, tz, nav.width, nav.depth)) {
      return allowOutsideBounds ? { wx, wz } : null;
    }
    if (!nav.walkable[tx][tz]) {
      return null;
    }

    let cfx = fx;
    let cfz = fz;
    const lx = fx - tx;
    const lz = fz - tz;

    if (lx < margin && isEdgeOrTileBlocked(tx, tz, tx - 1, tz)) {
      cfx = tx + margin;
    } else if (lx > 1 - margin && isEdgeOrTileBlocked(tx, tz, tx + 1, tz)) {
      cfx = tx + 1 - margin;
    }

    if (lz < margin && isEdgeOrTileBlocked(tx, tz, tx, tz - 1)) {
      cfz = tz + margin;
    } else if (lz > 1 - margin && isEdgeOrTileBlocked(tx, tz, tx, tz + 1)) {
      cfz = tz + 1 - margin;
    }

    // Prevent diagonal clipping into corner furniture tiles
    const dlx = cfx - tx;
    const dlz = cfz - tz;
    if (dlx < margin && dlz < margin && inGridBounds(tx - 1, tz - 1, nav.width, nav.depth) && !nav.walkable[tx - 1][tz - 1]) {
      if (margin - dlx < margin - dlz) cfx = tx + margin;
      else cfz = tz + margin;
    } else if (dlx > 1 - margin && dlz < margin && inGridBounds(tx + 1, tz - 1, nav.width, nav.depth) && !nav.walkable[tx + 1][tz - 1]) {
      if (dlx - (1 - margin) < margin - dlz) cfx = tx + 1 - margin;
      else cfz = tz + margin;
    } else if (dlx < margin && dlz > 1 - margin && inGridBounds(tx - 1, tz + 1, nav.width, nav.depth) && !nav.walkable[tx - 1][tz + 1]) {
      if (margin - dlx < dlz - (1 - margin)) cfx = tx + margin;
      else cfz = tz + 1 - margin;
    } else if (dlx > 1 - margin && dlz > 1 - margin && inGridBounds(tx + 1, tz + 1, nav.width, nav.depth) && !nav.walkable[tx + 1][tz + 1]) {
      if (dlx - (1 - margin) < dlz - (1 - margin)) cfx = tx + 1 - margin;
      else cfz = tz + 1 - margin;
    }

    return { wx: cfx - halfW, wz: cfz - halfD };
  };

  const canCross = (ax: number, az: number, bx: number, bz: number): boolean => {
    const atx = Math.floor(ax + halfW);
    const atz = Math.floor(az + halfD);
    const btx = Math.floor(bx + halfW);
    const btz = Math.floor(bz + halfD);

    if (atx === btx && atz === btz) return true;

    // Check cardinal crossings (handles both straight and diagonal steps cleanly)
    if (atx !== btx) {
      const stepX = btx > atx ? atx + 1 : atx - 1;
      if (isEdgeOrTileBlocked(atx, atz, stepX, atz)) return false;
    }
    if (atz !== btz) {
      const stepZ = btz > atz ? atz + 1 : atz - 1;
      if (isEdgeOrTileBlocked(atx, atz, atx, stepZ)) return false;
    }
    if (atx !== btx && atz !== btz) {
      if (isEdgeOrTileBlocked(btx, atz, btx, btz)) return false;
      if (isEdgeOrTileBlocked(atx, btz, btx, btz)) return false;
    }
    return true;
  };

  // Try full move first
  if (canCross(fromWx, fromWz, toWx, toWz)) {
    const clamped = clampInsideTile(toWx, toWz);
    if (clamped) return clamped;
  }

  // Try sliding along X only
  if (canCross(fromWx, fromWz, toWx, fromWz)) {
    const slideX = clampInsideTile(toWx, fromWz);
    if (slideX) return slideX;
  }

  // Try sliding along Z only
  if (canCross(fromWx, fromWz, fromWx, toWz)) {
    const slideZ = clampInsideTile(fromWx, toWz);
    if (slideZ) return slideZ;
  }

  return { wx: fromWx, wz: fromWz };
}

/**
 * Checks whether a visitor standing at `(wx, wz)` is in a tight 1-tile corridor/doorway
 * relative to their movement direction `(dirX, dirZ)`.
 */
export function isTightCorridor(
  nav: NavGrid,
  wx: number,
  wz: number,
  dirX: number,
  dirZ: number,
): boolean {
  const tx = Math.floor(wx + nav.width / 2);
  const tz = Math.floor(wz + nav.depth / 2);
  if (!inGridBounds(tx, tz, nav.width, nav.depth)) return false;

  // Check lateral neighbors perpendicular to dominant movement axis
  if (Math.abs(dirX) >= Math.abs(dirZ)) {
    const northBlocked = !canStepBetween(nav, tx, tz, tx, tz - 1);
    const southBlocked = !canStepBetween(nav, tx, tz, tx, tz + 1);
    return northBlocked && southBlocked;
  }
  const westBlocked = !canStepBetween(nav, tx, tz, tx - 1, tz);
  const eastBlocked = !canStepBetween(nav, tx, tz, tx + 1, tz);
  return westBlocked && eastBlocked;
}

/**
 * Picks a spawn entry (exterior door if reachable, else a clear perimeter tile),
 * preferring spots not currently crowded by another visitor.
 */
export function pickSpawnLocation(
  nav: NavGrid,
  slotIndex = 0,
  occupiedWorldPoints: WorldPoint[] = [],
): { startTile: GridCoord; spawnWorld: WorldPoint; firstGoal?: GridCoord } {
  const minClearance = (pt: WorldPoint): number => {
    let best = Infinity;
    for (const o of occupiedWorldPoints) {
      const d = Math.hypot(pt.wx - o.wx, pt.wz - o.wz);
      if (d < best) best = d;
    }
    return best;
  };

  const usableDoors = nav.doors.filter(
    (d) =>
      inGridBounds(d.insideTile.x, d.insideTile.z, nav.width, nav.depth) &&
      nav.walkable[d.insideTile.x][d.insideTile.z],
  );

  if (usableDoors.length > 0) {
    // Pick the clearest usable door; if the exact outside tile is occupied, try an adjacent exterior tile
    const ordered = [...usableDoors];
    const startIdx = slotIndex % ordered.length;
    const rotated = [...ordered.slice(startIdx), ...ordered.slice(0, startIdx)];
    rotated.sort((a, b) => minClearance(b.outsideWorld) - minClearance(a.outsideWorld));

    const chosen = rotated[0];
    const outsideWalkable =
      inGridBounds(chosen.outsideTile.x, chosen.outsideTile.z, nav.width, nav.depth) &&
      nav.walkable[chosen.outsideTile.x][chosen.outsideTile.z];

    if (minClearance(chosen.outsideWorld) < 0.85 && outsideWalkable) {
      // Find an adjacent clear tile near the door outside so visitors don't spawn stacked
      let bestTile = chosen.outsideTile;
      let bestWorld = chosen.outsideWorld;
      let bestClear = minClearance(chosen.outsideWorld);

      for (const dir of CARDINAL_DIRS) {
        const nx = chosen.outsideTile.x + dir.x;
        const nz = chosen.outsideTile.z + dir.z;
        if (nx === chosen.insideTile.x && nz === chosen.insideTile.z) continue;
        if (!canStepBetween(nav, chosen.outsideTile.x, chosen.outsideTile.z, nx, nz)) continue;
        const w = tileCenterToWorld(nx, nz, nav.width, nav.depth);
        const c = minClearance(w);
        if (c > bestClear) {
          bestClear = c;
          bestTile = { x: nx, z: nz };
          bestWorld = w;
        }
      }

      return {
        startTile: bestTile,
        spawnWorld: bestWorld,
        firstGoal: chosen.insideTile,
      };
    }

    return {
      startTile: outsideWalkable ? chosen.outsideTile : chosen.insideTile,
      spawnWorld: chosen.outsideWorld,
      firstGoal: chosen.insideTile,
    };
  }

  // Fallback: perimeter tile clear of other visitors
  const candidates: GridCoord[] = [];
  for (let x = 0; x < nav.width; x++) {
    for (let z = 0; z < nav.depth; z++) {
      const isPerimeter = x === 0 || z === 0 || x === nav.width - 1 || z === nav.depth - 1;
      if (isPerimeter && nav.walkable[x][z]) {
        candidates.push({ x, z });
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const wa = tileCenterToWorld(a.x, a.z, nav.width, nav.depth);
      const wb = tileCenterToWorld(b.x, b.z, nav.width, nav.depth);
      const ca = Math.min(1.5, minClearance(wa));
      const cb = Math.min(1.5, minClearance(wb));
      if (Math.abs(cb - ca) > 0.25) return cb - ca;
      return b.z + (nav.width - 1 - b.x) - (a.z + (nav.width - 1 - a.x));
    });
    const pool = candidates.slice(0, Math.min(4, candidates.length));
    const chosen = pool[slotIndex % pool.length];
    return {
      startTile: chosen,
      spawnWorld: tileCenterToWorld(chosen.x, chosen.z, nav.width, nav.depth),
    };
  }

  const cx = Math.floor(nav.width / 2);
  const cz = Math.floor(nav.depth / 2);
  return {
    startTile: { x: cx, z: cz },
    spawnWorld: tileCenterToWorld(cx, cz, nav.width, nav.depth),
  };
}

/**
 * Picks an exit location (nearest reachable door or clear perimeter tile).
 */
export function pickExitLocation(
  nav: NavGrid,
  fromTile: GridCoord,
): { exitTile: GridCoord; exitWorld: WorldPoint } {
  const distances = computeReachableDistances(nav, fromTile);

  let bestDoor: DoorEntry | null = null;
  let bestDoorDist = Infinity;
  for (const door of nav.doors) {
    const outsideIdx = tileIndex(door.outsideTile.x, door.outsideTile.z, nav.depth);
    const insideIdx = tileIndex(door.insideTile.x, door.insideTile.z, nav.depth);
    const d = distances.get(outsideIdx) ?? distances.get(insideIdx);
    if (d !== undefined && d < bestDoorDist) {
      bestDoorDist = d;
      bestDoor = door;
    }
  }

  if (bestDoor) {
    const outsideIdx = tileIndex(bestDoor.outsideTile.x, bestDoor.outsideTile.z, nav.depth);
    const exitTile = distances.has(outsideIdx) ? bestDoor.outsideTile : bestDoor.insideTile;
    return { exitTile, exitWorld: bestDoor.outsideWorld };
  }

  let bestPerim: GridCoord | null = null;
  let bestPerimDist = Infinity;
  for (let x = 0; x < nav.width; x++) {
    for (let z = 0; z < nav.depth; z++) {
      const isPerimeter = x === 0 || z === 0 || x === nav.width - 1 || z === nav.depth - 1;
      if (!isPerimeter || !nav.walkable[x][z]) continue;
      const d = distances.get(tileIndex(x, z, nav.depth));
      if (d !== undefined && d < bestPerimDist) {
        bestPerimDist = d;
        bestPerim = { x, z };
      }
    }
  }

  if (bestPerim) {
    return {
      exitTile: bestPerim,
      exitWorld: tileCenterToWorld(bestPerim.x, bestPerim.z, nav.width, nav.depth),
    };
  }

  const fallback = pickSpawnLocation(nav, 0);
  return { exitTile: fallback.startTile, exitWorld: fallback.spawnWorld };
}

/**
 * Resolves the best UNRESERVED walkable approach tile and world facing point for any placed item.
 * Excludes tiles in `reservedTiles` so two visitors never claim the same furniture spot.
 */
export function resolveItemApproach(
  nav: NavGrid,
  state: HouseState,
  data: GameDataBundle,
  item: PlacedItem,
  def: FurnitureItemDef,
  reachableDistances: Map<number, number>,
  reservedTiles?: Set<number>,
): ApproachTarget | null {
  const isAvailable = (x: number, z: number): boolean => {
    const idx = tileIndex(x, z, nav.depth);
    if (!reachableDistances.has(idx)) return false;
    if (reservedTiles?.has(idx)) return false;
    return true;
  };

  // Surface items inherit approach from their supporting parent item
  if (def.layer === 'surface' && item.parentUid) {
    const parent = state.items.find((it) => it.uid === item.parentUid);
    const parentDef = parent ? data.itemsById.get(parent.itemId) : undefined;
    if (parent && parentDef) {
      const parentApproach = resolveItemApproach(
        nav,
        state,
        data,
        parent,
        parentDef,
        reachableDistances,
        reservedTiles,
      );
      if (parentApproach) {
        const eff = getEffectiveFootprint(def, item.rotation);
        const faceWorld = tileToWorldCenter(item.x, item.z, eff.w, eff.d, nav.width, nav.depth);
        return { tile: parentApproach.tile, faceWorld };
      }
    }
  }

  // Wall items (windows, wall-mounted art/neon/shelves)
  if (def.layer === 'wall') {
    const mountOffset = def.wallKind === 'mounted' ? 0.08 : 0;
    const wt = wallEdgeToWorldTransform(
      item.x,
      item.z,
      item.rotation,
      nav.width,
      nav.depth,
      mountOffset,
    );

    const candidates: GridCoord[] = [{ x: item.x, z: item.z }];
    let opposite: GridCoord;
    switch (item.rotation) {
      case 0:
        opposite = { x: item.x, z: item.z - 1 };
        break;
      case 1:
        opposite = { x: item.x + 1, z: item.z };
        break;
      case 2:
        opposite = { x: item.x, z: item.z + 1 };
        break;
      case 3:
        opposite = { x: item.x - 1, z: item.z };
        break;
    }
    if (inGridBounds(opposite.x, opposite.z, nav.width, nav.depth)) {
      candidates.push(opposite);
    }

    let bestTile: GridCoord | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (!inGridBounds(c.x, c.z, nav.width, nav.depth) || !nav.walkable[c.x][c.z]) continue;
      if (!isAvailable(c.x, c.z)) continue;
      const d = reachableDistances.get(tileIndex(c.x, c.z, nav.depth)) ?? 999;
      const floorBonus = nav.hasFloorTile[c.x][c.z] ? -5 : 0;
      if (d + floorBonus < bestScore) {
        bestScore = d + floorBonus;
        bestTile = c;
      }
    }

    return bestTile ? { tile: bestTile, faceWorld: { wx: wt.wx, wz: wt.wz } } : null;
  }

  const eff = getEffectiveFootprint(def, item.rotation);
  const faceWorld = tileToWorldCenter(item.x, item.z, eff.w, eff.d, nav.width, nav.depth);

  // Non-blocking floor items (rugs, tiles) or ceiling items can be stood on directly
  if (def.layer === 'ceiling' || (def.layer === 'floor' && def.subLayer !== 'object')) {
    const insideTiles: GridCoord[] = [];
    for (let dx = 0; dx < eff.w; dx++) {
      for (let dz = 0; dz < eff.d; dz++) {
        const tx = item.x + dx;
        const tz = item.z + dz;
        if (!inGridBounds(tx, tz, nav.width, nav.depth) || !nav.walkable[tx][tz]) continue;
        if (isAvailable(tx, tz)) {
          insideTiles.push({ x: tx, z: tz });
        }
      }
    }
    if (insideTiles.length > 0) {
      insideTiles.sort(
        (a, b) =>
          (reachableDistances.get(tileIndex(a.x, a.z, nav.depth)) ?? 999) -
          (reachableDistances.get(tileIndex(b.x, b.z, nav.depth)) ?? 999),
      );
      return { tile: insideTiles[0], faceWorld };
    }
  }

  // Floor objects: prefer front-facing adjacent tile, then any unblocked cardinal neighbor
  const frontDir = itemFrontOffset(item.rotation);
  const frontCandidates: GridCoord[] = [];
  const otherCandidates: GridCoord[] = [];
  const seen = new Set<number>();

  for (let dx = 0; dx < eff.w; dx++) {
    for (let dz = 0; dz < eff.d; dz++) {
      const ox = item.x + dx;
      const oz = item.z + dz;
      for (const dir of CARDINAL_DIRS) {
        const nx = ox + dir.x;
        const nz = oz + dir.z;
        if (!inGridBounds(nx, nz, nav.width, nav.depth)) continue;
        if (nx >= item.x && nx < item.x + eff.w && nz >= item.z && nz < item.z + eff.d) {
          continue;
        }
        if (!nav.walkable[nx][nz]) continue;
        const ek = edgeKeyBetween(ox, oz, nx, nz);
        if (ek && nav.blockedEdges.has(ek)) continue;

        const idx = tileIndex(nx, nz, nav.depth);
        if (seen.has(idx) || !isAvailable(nx, nz)) continue;
        seen.add(idx);

        if (dir.x === frontDir.x && dir.z === frontDir.z) {
          frontCandidates.push({ x: nx, z: nz });
        } else {
          otherCandidates.push({ x: nx, z: nz });
        }
      }
    }
  }

  const pickBest = (list: GridCoord[]): GridCoord | null => {
    if (list.length === 0) return null;
    list.sort(
      (a, b) =>
        (reachableDistances.get(tileIndex(a.x, a.z, nav.depth)) ?? 999) -
        (reachableDistances.get(tileIndex(b.x, b.z, nav.depth)) ?? 999),
    );
    return list[0];
  };

  const chosen = pickBest(frontCandidates) ?? pickBest(otherCandidates);
  return chosen ? { tile: chosen, faceWorld } : null;
}
