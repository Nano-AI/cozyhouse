import type { GameDataBundle, HouseState, PlacedItem } from '../data/schemas';

export const DEFAULT_GRID_WIDTH = 16;
export const DEFAULT_GRID_DEPTH = 16;

export function createStarterHouse(data: GameDataBundle): HouseState {
  const items: PlacedItem[] = [];
  let seq = 1;
  const nextUid = () => `starter_${seq++}`;

  // Cozy enclosed 8x8 starter room centered in the 16x16 lot (tiles 4..11)
  const minX = 4;
  const maxX = 11;
  const minZ = 4;
  const maxZ = 11;

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

  // North wall (z = minZ, edge 0 = North) with two picture windows
  const northWallUids = new Map<number, string>();
  for (let x = minX; x <= maxX; x++) {
    const isWindow = x === minX + 2 || x === minX + 5;
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

  // West wall (x = minX, edge 3 = West) with wood door and picture window
  for (let z = minZ; z <= maxZ; z++) {
    const isDoor = z === minZ + 5;
    const isWindow = z === minZ + 2;
    items.push({
      uid: nextUid(),
      itemId: isDoor ? 'door_wood' : isWindow ? 'window_wide' : 'wall_plain',
      x: minX,
      y: 0,
      z,
      rotation: 3,
      variantId: isDoor ? 'honey' : 'cream',
    });
  }

  // South wall (z = maxZ, edge 2 = South) with two picture windows
  for (let x = minX; x <= maxX; x++) {
    const isWindow = x === minX + 2 || x === minX + 5;
    items.push({
      uid: nextUid(),
      itemId: isWindow ? 'window_wide' : 'wall_plain',
      x,
      y: 0,
      z: maxZ,
      rotation: 2,
      variantId: 'cream',
    });
  }

  // East wall (x = maxX, edge 1 = East) with two picture windows
  for (let z = minZ; z <= maxZ; z++) {
    const isWindow = z === minZ + 2 || z === minZ + 5;
    items.push({
      uid: nextUid(),
      itemId: isWindow ? 'window_wide' : 'wall_plain',
      x: maxX,
      y: 0,
      z,
      rotation: 1,
      variantId: 'cream',
    });
  }

  // Starter sample pieces demonstrating all 4 placement layers
  const counterUid = nextUid();
  items.push({
    uid: counterUid,
    itemId: 'cafe_counter',
    x: minX + 1,
    y: 0,
    z: minZ + 1,
    rotation: 0,
    variantId: 'latte',
  });

  // Surface-layered espresso machine + warm amber mushroom lamp on the café counter
  const counterDef = data.itemsById.get('cafe_counter');
  const counterSurfaceY = counterDef?.surfaceHeight ?? 0.96;
  items.push({
    uid: nextUid(),
    itemId: 'espresso_machine',
    x: minX + 1,
    y: counterSurfaceY,
    z: minZ + 1,
    rotation: 0,
    variantId: 'mint',
    parentUid: counterUid,
    active: true,
  });

  items.push({
    uid: nextUid(),
    itemId: 'table_lamp',
    x: minX + 2,
    y: counterSurfaceY,
    z: minZ + 1,
    rotation: 0,
    variantId: 'amber',
    parentUid: counterUid,
    active: true,
  });

  items.push({
    uid: nextUid(),
    itemId: 'rug_woven',
    x: minX + 4,
    y: 0,
    z: minZ + 4,
    rotation: 0,
    variantId: 'oat',
  });

  items.push({
    uid: nextUid(),
    itemId: 'sofa_plush',
    x: minX + 4,
    y: 0,
    z: minZ + 3,
    rotation: 0,
    variantId: 'terracotta',
  });

  items.push({
    uid: nextUid(),
    itemId: 'potted_monstera',
    x: minX + 6,
    y: 0,
    z: minZ + 1,
    rotation: 0,
    variantId: 'terracotta',
  });

  // Wall-mounted item attached to a North wall segment
  const signParent = northWallUids.get(minX + 4);
  if (signParent) {
    items.push({
      uid: nextUid(),
      itemId: 'neon_sign',
      x: minX + 4,
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
    x: minX + 6,
    y: 2.6,
    z: minZ + 4,
    rotation: 0,
    variantId: 'sage',
  });

  return {
    gridWidth: DEFAULT_GRID_WIDTH,
    gridDepth: DEFAULT_GRID_DEPTH,
    sceneryViewId: data.scenery.defaultViewId,
    weatherId: data.scenery.defaultWeatherId,
    timeOfDay: 'day',
    timeHour: 11.5,
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
    timeOfDay: 'day',
    timeHour: 11.5,
    roomTypeOverride: null,
    items: [],
  };
}
