import type { GameDataBundle, HouseState, PlacedItem } from '../data/schemas';

export const DEFAULT_GRID_WIDTH = 12;
export const DEFAULT_GRID_DEPTH = 12;

export function createStarterHouse(data: GameDataBundle): HouseState {
  const items: PlacedItem[] = [];
  let seq = 1;
  const nextUid = () => `starter_${seq++}`;

  // Cozy 8x8 starter room centered in the 12x12 lot (tiles 2..9)
  const minX = 2;
  const maxX = 9;
  const minZ = 2;
  const maxZ = 9;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      items.push({
        uid: nextUid(),
        itemId: 'floor_wood',
        x,
        y: 0,
        z,
        rotation: 0,
        variantId: 'oak',
      });
    }
  }

  // North back wall (z = minZ, edge 0 = North) with two picture windows
  const northWallUids = new Map<number, string>();
  for (let x = minX; x <= maxX; x++) {
    const isWindow = x === 4 || x === 7;
    const uid = nextUid();
    northWallUids.set(x, uid);
    items.push({
      uid,
      itemId: isWindow ? 'window_wide' : 'wall_plain',
      x,
      y: 0,
      z: minZ,
      rotation: 0,
      variantId: 'cream',
    });
  }

  // West back wall (x = minX, edge 3 = West) with a wood door
  const westWallUids = new Map<number, string>();
  for (let z = minZ; z <= maxZ; z++) {
    const isDoor = z === 7;
    const uid = nextUid();
    westWallUids.set(z, uid);
    items.push({
      uid,
      itemId: isDoor ? 'door_wood' : 'wall_plain',
      x: minX,
      y: 0,
      z,
      rotation: 3,
      variantId: isDoor ? 'honey' : 'cream',
    });
  }

  // Starter sample pieces demonstrating all 4 placement layers
  const counterUid = nextUid();
  items.push({
    uid: counterUid,
    itemId: 'cafe_counter',
    x: 3,
    y: 0,
    z: 3,
    rotation: 0,
    variantId: 'latte',
  });

  // Surface-layered item stacked on the café counter
  const counterDef = data.itemsById.get('cafe_counter');
  items.push({
    uid: nextUid(),
    itemId: 'espresso_machine',
    x: 3,
    y: counterDef?.surfaceHeight ?? 0.96,
    z: 3,
    rotation: 0,
    variantId: 'mint',
    parentUid: counterUid,
    active: true,
  });

  items.push({
    uid: nextUid(),
    itemId: 'rug_woven',
    x: 6,
    y: 0,
    z: 6,
    rotation: 0,
    variantId: 'oat',
  });

  items.push({
    uid: nextUid(),
    itemId: 'sofa_plush',
    x: 6,
    y: 0,
    z: 5,
    rotation: 0,
    variantId: 'terracotta',
  });

  items.push({
    uid: nextUid(),
    itemId: 'potted_monstera',
    x: 8,
    y: 0,
    z: 3,
    rotation: 0,
    variantId: 'terracotta',
  });

  // Wall-mounted item attached to a North wall segment
  const signParent = northWallUids.get(6);
  if (signParent) {
    items.push({
      uid: nextUid(),
      itemId: 'neon_sign',
      x: 6,
      y: 1.6,
      z: minZ,
      rotation: 0,
      variantId: 'pink',
      parentUid: signParent,
      active: true,
    });
  }

  // Ceiling-mounted item
  items.push({
    uid: nextUid(),
    itemId: 'hanging_ivy',
    x: 8,
    y: 2.6,
    z: 6,
    rotation: 0,
    variantId: 'sage',
  });

  return {
    gridWidth: DEFAULT_GRID_WIDTH,
    gridDepth: DEFAULT_GRID_DEPTH,
    sceneryViewId: data.scenery.defaultViewId,
    weatherId: data.scenery.defaultWeatherId,
    roomTypeOverride: null,
    items,
  };
}

export function createEmptyHouse(data: GameDataBundle): HouseState {
  return {
    gridWidth: DEFAULT_GRID_WIDTH,
    gridDepth: DEFAULT_GRID_DEPTH,
    sceneryViewId: data.scenery.defaultViewId,
    weatherId: data.scenery.defaultWeatherId,
    roomTypeOverride: null,
    items: [],
  };
}
