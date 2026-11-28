import type {
  GameDataBundle,
  HiredStaff,
  HouseState,
  PlacedItem,
  RotationQuarter,
  StaffKind,
  StaffRole,
} from '../data/schemas';
import { CEILING_HEIGHT, getEffectiveFootprint } from '../engine/GridSystem';

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

/**
 * Starter house / "Alin's Café". Authored directly in lot coordinates (+x = east, +z = south).
 * The front door is on the North wall and the default camera looks in from the south-east, so
 * North and West are the visible back walls: tall pieces and wall decor go there, low pieces
 * sit toward the south/east where they hide nothing.
 */
export function createStarterHouse(data: GameDataBundle): HouseState {
  const items: PlacedItem[] = [];
  let seq = 1;
  const put = (
    itemId: string,
    x: number,
    z: number,
    rotation: RotationQuarter,
    variantId: string,
    extra: Partial<PlacedItem> = {},
  ): string => {
    const uid = `starter_${seq++}`;
    items.push({ uid, itemId, x, y: 0, z, rotation, variantId, ...extra });
    return uid;
  };
  const byUid = (uid: string): PlacedItem => items.find((it) => it.uid === uid)!;
  const lit = (active?: boolean) => (active ? { active: true } : {});
  /** Surface item resting on `parentUid` at tile (x, z). */
  const onTop = (parentUid: string, itemId: string, x: number, z: number, variantId: string, active?: boolean) => {
    const parent = byUid(parentUid);
    const y = data.itemsById.get(parent.itemId)?.surfaceHeight ?? 0.9;
    return put(itemId, x, z, parent.rotation, variantId, { y, parentUid, ...lit(active) });
  };
  /** Wall decor mounted on the structural wall segment `wallUid`. */
  const mount = (wallUid: string, itemId: string, variantId: string, active?: boolean) => {
    const wall = byUid(wallUid);
    const y = data.itemsById.get(itemId)?.mountHeight ?? 1.55;
    return put(itemId, wall.x, wall.z, wall.rotation, variantId, { y, parentUid: wallUid, ...lit(active) });
  };
  const hang = (itemId: string, x: number, z: number, variantId: string, active?: boolean) =>
    put(itemId, x, z, 0, variantId, { y: CEILING_HEIGHT, ...lit(active) });

  // Cozy enclosed 8x8 room centered in the 16x16 lot (tiles 4..11), restroom tiles in the NW corner
  const MIN = 4;
  const MAX = 11;
  for (let x = MIN; x <= MAX; x++) {
    for (let z = MIN; z <= MAX; z++) {
      const isBathTile = x <= MIN + 1 && z <= MIN + 1;
      put(isBathTile ? 'floor_tile' : 'floor_wood', x, z, 0, isBathTile ? 'sage' : 'oak');
    }
  }

  // North wall (rotation 0): front door + windows flanking the café counter
  const northWalls = new Map<number, string>();
  for (let x = MIN; x <= MAX; x++) {
    const itemId = x === 7 ? 'door_wood' : x === 9 || x === 11 ? 'window_wide' : 'wall_plain';
    northWalls.set(x, put(itemId, x, MIN, 0, x === 7 ? 'honey' : 'cream'));
  }
  // West wall (rotation 3): windows either side of the sofa
  const westWalls = new Map<number, string>();
  for (let z = MIN; z <= MAX; z++) {
    westWalls.set(z, put(z === 7 || z === 10 ? 'window_wide' : 'wall_plain', MIN, z, 3, 'cream'));
  }
  // South (rotation 2) and East (rotation 1) walls face the camera and fade out
  for (let x = MIN; x <= MAX; x++) {
    put(x === 6 || x === 9 ? 'window_wide' : 'wall_plain', x, MAX, 2, 'cream');
  }
  for (let z = MIN; z <= MAX; z++) {
    put(z === 6 || z === 9 ? 'window_wide' : 'wall_plain', MAX, z, 1, 'cream');
  }

  // Partitioned 2x2 restroom in the NW corner (tiles 4..5, 4..5), door opening east
  put('wall_plain', 4, 5, 2, 'cream');
  put('wall_plain', 5, 5, 2, 'cream');
  put('wall_plain', 5, 4, 1, 'cream');
  put('door_wood', 5, 5, 1, 'honey');
  put('toilet_cozy', 4, 4, 0, 'porcelain');
  put('bathroom_sink', 5, 4, 0, 'sage');
  put('bath_mat', 4, 5, 0, 'cream');
  mount(westWalls.get(5)!, 'towel_rack', 'sage_oat');
  hang('lamp_pendant', 5, 5, 'sage', true);

  // Service counter along the North wall, right of the door
  put('pastry_case', 9, 4, 0, 'oak');
  const counterUid = put('cafe_counter', 10, 4, 0, 'latte');
  onTop(counterUid, 'cup_stack', 10, 4, 'cream');
  const espressoUid = onTop(counterUid, 'espresso_machine', 11, 4, 'mint', true);
  mount(northWalls.get(10)!, 'chalkboard_menu', 'oak');
  mount(northWalls.get(8)!, 'neon_sign', 'pink', true);
  hang('lamp_pendant', 10, 5, 'rice', true);

  // Lounge corner along the West wall
  put('potted_monstera', 4, 6, 0, 'terracotta');
  put('rug_woven', 4, 8, 0, 'oat');
  put('sofa_plush', 4, 8, 3, 'terracotta');
  const sideUid = put('side_table_round', 4, 10, 0, 'birch');
  onTop(sideUid, 'table_lamp', 4, 10, 'amber', true);
  mount(westWalls.get(8)!, 'fairy_lights', 'warm', true);
  mount(westWalls.get(9)!, 'fairy_lights', 'warm', true);

  // Two bistro tables toward the camera, each under its own pendant
  for (const z of [7, 10]) {
    put('cafe_bistro_table', 9, z, 0, 'oak');
    put('dining_chair', 8, z, 3, 'sage');
    put('dining_chair', 10, z, 1, 'sage');
    hang('lamp_pendant', 9, z, 'rice', true);
  }

  return {
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
