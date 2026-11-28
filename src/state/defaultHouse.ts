import type {
  GameDataBundle,
  HiredStaff,
  HouseState,
  PlacedItem,
  RotationQuarter,
  StaffKind,
  StaffRole,
} from '../data/schemas';
import { getEffectiveFootprint } from '../engine/GridSystem';

export const DEFAULT_GRID_WIDTH = 16;
export const DEFAULT_GRID_DEPTH = 16;

const PRESET_STAFF_POOLS: Record<
  StaffRole,
  { bot: readonly string[]; human: readonly string[]; accentColor: string }
> = {
  barista: { bot: ['Brew-Bot', 'Latte-Bot'], human: ['Bean', 'Clara'], accentColor: '#D98F72' },
  dj: { bot: ['DJ Synth-01', 'Pulse-Bot'], human: ['Milo', 'Zara'], accentColor: '#9F90E0' },
  chef: { bot: ['Sous-Bot', 'Whisk-02'], human: ['Nora', 'Bram'], accentColor: '#8FC09E' },
  bartender: { bot: ['Mix-Bot', 'Fizz-02'], human: ['Theo', 'June'], accentColor: '#7DC4B8' },
};

/**
 * Builds a pre-staffed starter employee, randomly choosing a Cozy Bot (~55%) or Human (~45%)
 * with a themed matching name and role accent color.
 */
export function makePresetStaff(
  id: string,
  role: StaffRole,
  assignedItemUid?: string,
  nameIndex = 0,
): HiredStaff {
  const kind: StaffKind = Math.random() < 0.55 ? 'bot' : 'human';
  const pool = PRESET_STAFF_POOLS[role];
  const names = pool[kind];
  const name = names[nameIndex % names.length];
  return {
    id,
    role,
    kind,
    name,
    accentColor: pool.accentColor,
    ...(assignedItemUid ? { assignedItemUid } : {}),
  };
}

/**
 * Rotates an entire `HouseState` clockwise by `quarterTurns` 90° steps around its grid,
 * preserving every UID, parent-child link, wall finish style, active flag, and hired staff list.
 */
export function rotateHouseState(
  state: HouseState,
  data: GameDataBundle,
  quarterTurns: 1 | 2 | 3,
): HouseState {
  let width = state.gridWidth;
  let depth = state.gridDepth;
  let items = state.items.map((item) => ({ ...item }));
  let staff = state.staff ? state.staff.map((member) => ({ ...member })) : undefined;

  for (let step = 0; step < quarterTurns; step++) {
    const nextWidth = depth;
    const nextDepth = width;
    items = items.map((item) => {
      const def = data.itemsById.get(item.itemId);
      const nextRot = (((item.rotation + 1) % 4) as RotationQuarter);
      if (def?.layer === 'wall') {
        return {
          ...item,
          x: depth - 1 - item.z,
          z: item.x,
          rotation: nextRot,
        };
      }
      const eff = def ? getEffectiveFootprint(def, item.rotation) : { w: 1, d: 1 };
      return {
        ...item,
        x: depth - item.z - eff.d,
        z: item.x,
        rotation: nextRot,
      };
    });
    if (staff) {
      staff = staff.map((member) => {
        if (member.homeX !== undefined && member.homeZ !== undefined) {
          return {
            ...member,
            homeX: depth - 1 - member.homeZ,
            homeZ: member.homeX,
          };
        }
        return member;
      });
    }
    width = nextWidth;
    depth = nextDepth;
  }

  return {
    ...state,
    gridWidth: width,
    gridDepth: depth,
    items,
    ...(staff ? { staff } : {}),
  };
}

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
      const isBathTile = x <= minX + 1 && z >= maxZ - 1;
      items.push({
        uid: nextUid(),
        itemId: isBathTile ? 'floor_tile' : 'floor_wood',
        x,
        y: 0,
        z,
        rotation: 0,
        variantId: isBathTile ? 'sage' : 'oak',
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

  // West wall (x = minX, edge 3 = West) with centered wood door (rotates to North center x = 7) and picture window
  for (let z = minZ; z <= maxZ; z++) {
    const isDoor = z === minZ + 4;
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
  const espressoUid = nextUid();
  items.push({
    uid: espressoUid,
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

  // Partitioned 2x2 cozy café restroom in SW corner (tiles 4..5, 10..11; rotates to NW corner)
  items.push({
    uid: nextUid(),
    itemId: 'wall_plain',
    x: minX,
    y: 0,
    z: maxZ - 1,
    rotation: 0,
    variantId: 'cream',
  });
  items.push({
    uid: nextUid(),
    itemId: 'door_wood',
    x: minX + 1,
    y: 0,
    z: maxZ - 1,
    rotation: 0,
    variantId: 'honey',
  });
  items.push({
    uid: nextUid(),
    itemId: 'wall_plain',
    x: minX + 1,
    y: 0,
    z: maxZ - 1,
    rotation: 1,
    variantId: 'cream',
  });
  const bathEastWallUid = nextUid();
  items.push({
    uid: bathEastWallUid,
    itemId: 'wall_plain',
    x: minX + 1,
    y: 0,
    z: maxZ,
    rotation: 1,
    variantId: 'cream',
  });
  items.push({
    uid: nextUid(),
    itemId: 'toilet_cozy',
    x: minX,
    y: 0,
    z: maxZ,
    rotation: 3,
    variantId: 'porcelain',
  });
  items.push({
    uid: nextUid(),
    itemId: 'bathroom_sink',
    x: minX,
    y: 0,
    z: maxZ - 1,
    rotation: 3,
    variantId: 'sage',
  });
  items.push({
    uid: nextUid(),
    itemId: 'bath_mat',
    x: minX + 1,
    y: 0,
    z: maxZ,
    rotation: 0,
    variantId: 'cream',
  });
  const towelRackDef = data.itemsById.get('towel_rack');
  items.push({
    uid: nextUid(),
    itemId: 'towel_rack',
    x: minX + 1,
    y: towelRackDef?.mountHeight ?? 1.32,
    z: maxZ,
    rotation: 1,
    variantId: 'sage_oat',
    parentUid: bathEastWallUid,
  });

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

  const rawState: HouseState = {
    gridWidth: DEFAULT_GRID_WIDTH,
    gridDepth: DEFAULT_GRID_DEPTH,
    sceneryViewId: data.scenery.defaultViewId,
    weatherId: data.scenery.defaultWeatherId,
    timeOfDay: 'day',
    timeHour: 11.5,
    roomTypeOverride: null,
    items,
    staff: [makePresetStaff('staff_cafe_barista', 'barista', espressoUid, 0)],
  };

  // Rotate 90° clockwise so the front entrance sits on the North wall (rot = 0),
  // facing straight onto the incoming stepping stones & yard entrance.
  return rotateHouseState(rawState, data, 1);
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
