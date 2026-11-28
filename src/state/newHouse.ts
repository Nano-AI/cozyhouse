import type { GameDataBundle, HouseState, PlacedItem } from '../data/schemas';
import { DEFAULT_GRID_DEPTH, DEFAULT_GRID_WIDTH, rotateHouseState } from './defaultHouse';

/**
 * "New House": an unfurnished 8×8 room in the middle of the lot (wood floor, cream walls, a front door and
 * picture windows), so a fresh start already has an enclosed space visitors can walk into. Same footprint
 * and entrance orientation as the starter house.
 */
export function createNewHouse(data: GameDataBundle): HouseState {
  const items: PlacedItem[] = [];
  let seq = 1;
  const nextUid = () => `new_${seq++}`;
  const minX = 4;
  const maxX = 11;
  const minZ = 4;
  const maxZ = 11;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      items.push({ uid: nextUid(), itemId: 'floor_wood', x, y: 0, z, rotation: 0, variantId: 'oak' });
    }
  }

  const wall = (x: number, z: number, rotation: 0 | 1 | 2 | 3, kind: 'wall' | 'window' | 'door') => {
    items.push({
      uid: nextUid(),
      itemId: kind === 'door' ? 'door_wood' : kind === 'window' ? 'window_wide' : 'wall_plain',
      x,
      y: 0,
      z,
      rotation,
      variantId: kind === 'door' ? 'honey' : 'cream',
    });
  };
  for (let x = minX; x <= maxX; x++) {
    const win = x === minX + 2 || x === minX + 5;
    wall(x, minZ, 0, win ? 'window' : 'wall');
    wall(x, maxZ, 2, win ? 'window' : 'wall');
  }
  for (let z = minZ; z <= maxZ; z++) {
    wall(minX, z, 3, z === minZ + 4 ? 'door' : z === minZ + 2 ? 'window' : 'wall');
    wall(maxX, z, 1, z === minZ + 2 || z === minZ + 5 ? 'window' : 'wall');
  }

  const raw: HouseState = {
    gridWidth: DEFAULT_GRID_WIDTH,
    gridDepth: DEFAULT_GRID_DEPTH,
    sceneryViewId: data.scenery.defaultViewId,
    weatherId: data.scenery.defaultWeatherId,
    timeOfDay: 'day',
    timeHour: 11.5,
    roomTypeOverride: null,
    items,
    staff: [],
  };
  // Same 90° turn as the starter house, so the front door faces the yard path.
  return rotateHouseState(raw, data, 1);
}
