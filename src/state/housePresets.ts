import {
  timeHourToBucket,
  type GameDataBundle,
  type HouseState,
  type PlacedItem,
  type RotationQuarter,
} from '../data/schemas';
import { CEILING_HEIGHT } from '../engine/GridSystem';
import {
  DEFAULT_GRID_DEPTH,
  DEFAULT_GRID_WIDTH,
  createStarterHouse,
} from './defaultHouse';

export interface HousePresetDef {
  id: string;
  name: string;
  icon: string;
  sceneryViewId: string;
  weatherId: string;
  timeHour: number;
}

export const HOUSE_PRESETS: HousePresetDef[] = [
  {
    id: 'cafe',
    name: "Alin's Café",
    icon: 'room_cafe',
    sceneryViewId: 'suburbs',
    weatherId: 'clear',
    timeHour: 11.5,
  },
  {
    id: 'club',
    name: 'Neon Club',
    icon: 'room_club',
    sceneryViewId: 'city',
    weatherId: 'clear',
    timeHour: 22.5,
  },
  {
    id: 'cat_lounge',
    name: 'Cat Lounge',
    icon: 'room_cats',
    sceneryViewId: 'forest',
    weatherId: 'clear',
    timeHour: 10.0,
  },
  {
    id: 'farmhouse',
    name: 'Farmhouse',
    icon: 'room_kitchen',
    sceneryViewId: 'countryside',
    weatherId: 'clear',
    timeHour: 13.5,
  },
  {
    id: 'beach_loft',
    name: 'Beach Retreat',
    icon: 'room_beach',
    sceneryViewId: 'beach',
    weatherId: 'clear',
    timeHour: 18.2,
  },
  {
    id: 'mountain_cabin',
    name: 'Mountain Cabin',
    icon: 'room_cabin',
    sceneryViewId: 'mountains',
    weatherId: 'snow',
    timeHour: 19.0,
  },
];

interface WallSlotSpec {
  itemId: string;
  variantId: string;
}

interface PresetRoomBuilder {
  items: PlacedItem[];
  northWalls: Map<number, string>;
  southWalls: Map<number, string>;
  westWalls: Map<number, string>;
  eastWalls: Map<number, string>;
  place(
    itemId: string,
    x: number,
    z: number,
    rotation?: RotationQuarter,
    variantId?: string,
    active?: boolean,
  ): string;
  placeSurface(
    parentUid: string,
    itemId: string,
    x: number,
    z: number,
    rotation?: RotationQuarter,
    variantId?: string,
    active?: boolean,
  ): string;
  mountWall(
    wallUid: string | undefined,
    itemId: string,
    variantId?: string,
    active?: boolean,
  ): string | null;
  placeCeiling(
    itemId: string,
    x: number,
    z: number,
    rotation?: RotationQuarter,
    variantId?: string,
    active?: boolean,
  ): string;
  buildState(preset: HousePresetDef): HouseState;
}

function createRoomBuilder(
  prefix: string,
  data: GameDataBundle,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  floorFn: (x: number, z: number) => { itemId: string; variantId: string; active?: boolean },
  walls: {
    north: (x: number) => WallSlotSpec;
    south: (x: number) => WallSlotSpec;
    west: (z: number) => WallSlotSpec;
    east: (z: number) => WallSlotSpec;
  },
): PresetRoomBuilder {
  const items: PlacedItem[] = [];
  const itemsByUid = new Map<string, PlacedItem>();
  let seq = 1;
  const nextUid = () => `${prefix}_${seq++}`;

  const resolveVariant = (itemId: string, variantId?: string): string => {
    const def = data.itemsById.get(itemId);
    if (!def) return variantId ?? 'default';
    if (variantId && def.variants.some((v) => v.id === variantId)) {
      return variantId;
    }
    return def.variants[0].id;
  };

  const pushItem = (item: PlacedItem): string => {
    items.push(item);
    itemsByUid.set(item.uid, item);
    return item.uid;
  };

  // Floor tiles
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      const tile = floorFn(x, z);
      pushItem({
        uid: nextUid(),
        itemId: tile.itemId,
        x,
        y: 0,
        z,
        rotation: 0,
        variantId: resolveVariant(tile.itemId, tile.variantId),
        active: tile.active,
      });
    }
  }

  // Enclosed 4 walls
  const northWalls = new Map<number, string>();
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const w = walls.north(x);
    const uid = pushItem({
      uid: nextUid(),
      itemId: w.itemId,
      x,
      y: 0,
      z: bounds.minZ,
      rotation: 0,
      variantId: resolveVariant(w.itemId, w.variantId),
    });
    northWalls.set(x, uid);
  }

  const southWalls = new Map<number, string>();
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const w = walls.south(x);
    const uid = pushItem({
      uid: nextUid(),
      itemId: w.itemId,
      x,
      y: 0,
      z: bounds.maxZ,
      rotation: 2,
      variantId: resolveVariant(w.itemId, w.variantId),
    });
    southWalls.set(x, uid);
  }

  const westWalls = new Map<number, string>();
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    const w = walls.west(z);
    const uid = pushItem({
      uid: nextUid(),
      itemId: w.itemId,
      x: bounds.minX,
      y: 0,
      z,
      rotation: 3,
      variantId: resolveVariant(w.itemId, w.variantId),
    });
    westWalls.set(z, uid);
  }

  const eastWalls = new Map<number, string>();
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    const w = walls.east(z);
    const uid = pushItem({
      uid: nextUid(),
      itemId: w.itemId,
      x: bounds.maxX,
      y: 0,
      z,
      rotation: 1,
      variantId: resolveVariant(w.itemId, w.variantId),
    });
    eastWalls.set(z, uid);
  }

  return {
    items,
    northWalls,
    southWalls,
    westWalls,
    eastWalls,
    place(itemId, x, z, rotation = 0, variantId, active) {
      return pushItem({
        uid: nextUid(),
        itemId,
        x,
        y: 0,
        z,
        rotation,
        variantId: resolveVariant(itemId, variantId),
        active,
      });
    },
    placeSurface(parentUid, itemId, x, z, rotation = 0, variantId, active) {
      const parent = itemsByUid.get(parentUid);
      const parentDef = parent ? data.itemsById.get(parent.itemId) : undefined;
      const y = parentDef?.surfaceHeight ?? 0.85;
      return pushItem({
        uid: nextUid(),
        itemId,
        x,
        y,
        z,
        rotation,
        variantId: resolveVariant(itemId, variantId),
        parentUid,
        active,
      });
    },
    mountWall(wallUid, itemId, variantId, active) {
      if (!wallUid) return null;
      const wall = itemsByUid.get(wallUid);
      const def = data.itemsById.get(itemId);
      if (!wall || !def) return null;
      return pushItem({
        uid: nextUid(),
        itemId,
        x: wall.x,
        y: def.mountHeight ?? 1.55,
        z: wall.z,
        rotation: wall.rotation,
        variantId: resolveVariant(itemId, variantId),
        parentUid: wall.uid,
        active,
      });
    },
    placeCeiling(itemId, x, z, rotation = 0, variantId, active) {
      return pushItem({
        uid: nextUid(),
        itemId,
        x,
        y: CEILING_HEIGHT,
        z,
        rotation,
        variantId: resolveVariant(itemId, variantId),
        active,
      });
    },
    buildState(preset) {
      const sceneryViewId = data.viewsById.has(preset.sceneryViewId)
        ? preset.sceneryViewId
        : data.scenery.defaultViewId;
      const weatherId = data.weathersById.has(preset.weatherId)
        ? preset.weatherId
        : data.scenery.defaultWeatherId;
      return {
        gridWidth: DEFAULT_GRID_WIDTH,
        gridDepth: DEFAULT_GRID_DEPTH,
        sceneryViewId,
        weatherId,
        timeOfDay: timeHourToBucket(preset.timeHour),
        timeHour: preset.timeHour,
        roomTypeOverride: null,
        items,
      };
    },
  };
}

function buildClubPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const b = createRoomBuilder(
    'club',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) => {
      if (x >= 6 && x <= 9 && z >= 6 && z <= 9) {
        const variantId = (x + z) % 2 === 0 ? 'lilac' : 'mint';
        return { itemId: 'dance_floor_tile', variantId, active: true };
      }
      return { itemId: 'floor_stone', variantId: 'slate' };
    },
    {
      north: (x) =>
        x === 5 || x === 10
          ? { itemId: 'window_wide', variantId: 'charcoal' }
          : { itemId: 'wall_plain', variantId: 'slate' },
      south: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_cafe_glass', variantId: 'latte' }
          : x === 5 || x === 10
            ? { itemId: 'window_wide', variantId: 'charcoal' }
            : { itemId: 'wall_plain', variantId: 'slate' },
      west: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_wide', variantId: 'charcoal' }
          : { itemId: 'wall_plain', variantId: 'slate' },
      east: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_wide', variantId: 'charcoal' }
          : { itemId: 'wall_plain', variantId: 'slate' },
    },
  );

  // DJ stage along North wall
  b.place('floor_uplight', 4, 4, 0, 'violet', true);
  b.place('subwoofer_box', 5, 4, 0, 'charcoal', true);
  b.place('speaker_tower', 6, 4, 0, 'slate', true);
  b.place('dj_booth', 7, 4, 0, 'lilac', true);
  b.place('speaker_tower', 9, 4, 0, 'slate', true);
  b.place('vinyl_crate', 10, 4, 0, 'oak');
  b.place('floor_uplight', 11, 4, 0, 'cyan', true);

  // Lounge bar along West wall
  const barUid = b.place('bar_counter', 4, 7, 3, 'indigo');
  b.placeSurface(barUid, 'cocktail_shaker', 4, 7, 3, 'silver');
  b.place('bar_stool', 5, 7, 1, 'blush');
  b.place('bar_stool', 5, 8, 1, 'blush');

  // VIP seating corner along East wall
  const sideUid = b.place('side_table_round', 11, 6, 0, 'sage');
  b.placeSurface(sideUid, 'lamp_lava', 11, 6, 0, 'lilac', true);
  b.place('sofa_plush', 11, 7, 1, 'dusty_blue');
  b.place('fog_machine', 11, 10, 1, 'lavender', true);

  // Wall neon & LED bars
  b.mountWall(b.northWalls.get(7), 'neon_sign', 'pink', true);
  b.mountWall(b.northWalls.get(8), 'led_strip_wall', 'lilac', true);
  b.mountWall(b.westWalls.get(7), 'neon_drink_menu', 'mint', true);
  b.mountWall(b.westWalls.get(8), 'bottle_shelf', 'brass');
  b.mountWall(b.eastWalls.get(7), 'led_strip_wall', 'pink', true);

  // Ceiling lighting rig
  b.placeCeiling('laser_bar', 7, 5, 0, 'neon_pink', true);
  b.placeCeiling('disco_ball', 7, 7, 0, 'silver', true);
  b.placeCeiling('party_spotlight', 6, 8, 0, 'aqua', true);
  b.placeCeiling('party_spotlight', 9, 8, 0, 'magenta', true);

  return b.buildState(preset);
}

function buildCatLoungePreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const b = createRoomBuilder(
    'cats',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    () => ({ itemId: 'floor_herringbone', variantId: 'honey' }),
    {
      north: (x) =>
        x === 6 || x === 9
          ? { itemId: 'window_bay', variantId: 'ivory' }
          : { itemId: 'wall_wainscot', variantId: 'oat_sage' },
      south: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_arched', variantId: 'sage' }
          : x === 5 || x === 10
            ? { itemId: 'window_wide', variantId: 'oak' }
            : { itemId: 'wall_wainscot', variantId: 'oat_sage' },
      west: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_arched', variantId: 'sage' }
          : { itemId: 'wall_wainscot', variantId: 'oat_sage' },
      east: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_arched', variantId: 'sage' }
          : { itemId: 'wall_wainscot', variantId: 'oat_sage' },
    },
  );

  // Central woven rug
  b.place('rug_woven', 6, 7, 0, 'eucalyptus');

  // North sanctuary wall: bookshelves, cat trees & loaf cat
  b.place('bookshelf_tall', 4, 4, 0, 'oak');
  b.place('cat_tree', 5, 4, 0, 'oat');
  const lowShelfUid = b.place('bookshelf_low', 9, 4, 0, 'oak');
  b.placeSurface(lowShelfUid, 'cat_loaf', 9, 4, 0, 'brioche');
  b.placeSurface(lowShelfUid, 'table_lamp', 10, 4, 0, 'blush', true);
  b.place('cat_condo_tower', 11, 4, 1, 'birch');

  // Cozy human & feline seating
  b.place('potted_fiddle_leaf', 4, 5, 0, 'woven');
  b.place('sofa_plush', 6, 5, 0, 'terracotta');
  const sideUid = b.place('side_table_round', 8, 5, 0, 'birch');
  b.placeSurface(sideUid, 'table_lamp', 8, 5, 0, 'amber', true);
  b.place('potted_monstera', 11, 5, 0, 'terracotta');

  // Play & nap zone
  b.place('scratch_post', 4, 7, 0, 'cactus');
  b.place('cat_tunnel', 4, 9, 3, 'oat');
  b.place('pet_bed_round', 6, 9, 0, 'peach');
  b.place('pet_bed_round', 10, 9, 0, 'oat');
  b.place('armchair_plush', 10, 7, 1, 'sage');
  b.place('cat_ball_track', 9, 8, 0, 'mint');
  b.place('pet_bowls', 11, 8, 1, 'mint');

  // Cats lounging across the room
  b.place('cat_calico', 7, 7, 0, 'calico');
  b.place('cat_sleepy', 5, 7, 0, 'cream');
  b.place('cat_kitten', 8, 8, 2, 'marmalade');

  // Wall shelves, hammock, vines & warm fairy lights
  b.mountWall(b.northWalls.get(5), 'fairy_lights', 'warm', true);
  b.mountWall(b.northWalls.get(7), 'cat_wall_shelf', 'birch');
  b.mountWall(b.northWalls.get(8), 'cat_wall_shelf', 'birch');
  b.mountWall(b.westWalls.get(5), 'wall_vines', 'ivy');
  b.mountWall(b.eastWalls.get(7), 'window_hammock', 'sage');

  // Overhead catwalk & hanging greenery
  b.placeCeiling('ceiling_catwalk', 6, 6, 0, 'oak');
  b.placeCeiling('hanging_fern', 9, 6, 0, 'meadow');
  b.placeCeiling('hanging_ivy', 5, 8, 0, 'sage');

  return b.buildState(preset);
}

function buildFarmhousePreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const b = createRoomBuilder(
    'farm',
    data,
    { minX: 3, maxX: 12, minZ: 4, maxZ: 11 },
    (x) =>
      x <= 6
        ? { itemId: 'floor_checkerboard', variantId: 'butter_cocoa' }
        : { itemId: 'floor_wood', variantId: 'walnut' },
    {
      north: (x) =>
        x === 5 || x === 9 || x === 11
          ? { itemId: 'window_wide', variantId: 'oak' }
          : { itemId: 'wall_brick', variantId: 'whitewash' },
      south: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_wood', variantId: 'honey' }
          : x === 4 || x === 11
            ? { itemId: 'window_wide', variantId: 'oak' }
            : { itemId: 'wall_wainscot', variantId: 'cream_oak' },
      west: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_arched', variantId: 'cream' }
          : { itemId: 'wall_brick', variantId: 'whitewash' },
      east: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_wide', variantId: 'oak' }
          : { itemId: 'wall_wainscot', variantId: 'cream_oak' },
    },
  );

  // Full country kitchen along North & West
  const fridgeUid = b.place('fridge_retro', 3, 4, 0, 'butter');
  b.placeSurface(fridgeUid, 'fruit_bowl', 3, 4, 0, 'cream');

  const counterUid = b.place('kitchen_counter', 4, 4, 0, 'butter');
  b.placeSurface(counterUid, 'electric_kettle', 4, 4, 0, 'copper');
  b.placeSurface(counterUid, 'toaster_pastel', 5, 4, 0, 'butter');

  b.place('stove_oven', 6, 4, 0, 'cream', true);
  b.place('kitchen_sink', 3, 6, 3, 'cream');
  b.place('kitchen_counter_corner', 3, 7, 3, 'butter');
  b.place('pantry_shelf', 3, 9, 3, 'oak');

  const islandUid = b.place('kitchen_island', 5, 7, 0, 'cream_oak');
  b.placeSurface(islandUid, 'cake_stand', 5, 7, 0, 'strawberry');
  b.placeSurface(islandUid, 'cup_stack', 6, 7, 0, 'cream');

  // Farmhouse dining nook (NE)
  const diningUid = b.place('dining_table', 9, 5, 0, 'oak');
  b.placeSurface(diningUid, 'flower_vase', 9, 5, 0, 'daisy');
  b.place('dining_chair', 8, 5, 3, 'oak');
  b.place('dining_chair', 8, 6, 3, 'oak');
  b.place('dining_chair', 11, 5, 1, 'oak');
  b.place('dining_chair', 11, 6, 1, 'oak');

  // Cozy living corner (SE)
  b.place('rug_woven', 9, 8, 0, 'oat');
  b.place('loveseat_tufted', 12, 8, 1, 'olive');
  const coffeeUid = b.place('coffee_table_low', 10, 8, 1, 'oak');
  b.placeSurface(coffeeUid, 'table_lamp', 10, 8, 0, 'amber', true);
  b.placeSurface(coffeeUid, 'scented_candle', 10, 9, 0, 'vanilla', true);

  b.place('potted_monstera', 12, 4, 0, 'terracotta');
  b.place('potted_fiddle_leaf', 12, 10, 0, 'terracotta');

  // Wall & ceiling country accents
  b.mountWall(b.northWalls.get(4), 'spice_rack', 'birch');
  b.mountWall(b.northWalls.get(7), 'wall_clock', 'cream');
  b.mountWall(b.eastWalls.get(8), 'framed_art', 'oak');
  b.placeCeiling('lamp_pendant', 5, 7, 0, 'rice', true);
  b.placeCeiling('lamp_pendant', 9, 5, 0, 'rice', true);

  return b.buildState(preset);
}

function buildBeachLoftPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const b = createRoomBuilder(
    'beach',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) =>
      x >= 7 && x <= 8 && z >= 10
        ? { itemId: 'floor_terrazzo', variantId: 'ivory' }
        : { itemId: 'floor_wood', variantId: 'birch' },
    {
      north: (x) =>
        x === 5 || x === 6 || x === 9 || x === 10
          ? { itemId: 'window_wide', variantId: 'cream' }
          : { itemId: 'wall_plain', variantId: 'cream' },
      south: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_cafe_glass', variantId: 'butter' }
          : x === 5 || x === 10
            ? { itemId: 'window_wide', variantId: 'cream' }
            : { itemId: 'wall_plain', variantId: 'cream' },
      west: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_bay', variantId: 'ivory' }
          : { itemId: 'wall_plain', variantId: 'cream' },
      east: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_arched', variantId: 'cream' }
          : { itemId: 'wall_plain', variantId: 'cream' },
    },
  );

  // Converged king-size coastal double bed (2 adjacent bed_cozy!)
  b.place('bed_cozy', 5, 4, 0, 'sage');
  b.place('bed_cozy', 7, 4, 0, 'sage');

  const leftNightstand = b.place('side_table_round', 4, 4, 0, 'birch');
  b.placeSurface(leftNightstand, 'table_lamp', 4, 4, 0, 'amber', true);
  const rightNightstand = b.place('side_table_round', 9, 4, 0, 'birch');
  b.placeSurface(rightNightstand, 'scented_candle', 9, 4, 0, 'vanilla', true);

  // Woven rug & coastal study/lounge
  b.place('rug_woven', 6, 6, 0, 'oat');

  const deskUid = b.place('desk_study', 11, 5, 1, 'birch');
  b.placeSurface(deskUid, 'lamp_desk', 11, 5, 1, 'butter', true);
  b.placeSurface(deskUid, 'potted_cactus', 11, 6, 0, 'cream');
  b.place('chair_office', 10, 5, 3, 'sky');

  const shelfUid = b.place('bookshelf_low', 4, 7, 3, 'birch');
  b.placeSurface(shelfUid, 'flower_vase', 4, 7, 0, 'tulip');
  b.placeSurface(shelfUid, 'glass_terrarium', 4, 8, 0, 'succulent');

  b.place('armchair_plush', 10, 8, 2, 'sage');
  b.place('mirror_arch', 11, 9, 1, 'oak');
  b.place('potted_monstera', 11, 4, 0, 'cream');
  b.place('potted_snake_plant', 4, 10, 0, 'cream');

  // Sunlit wall & ceiling decor
  b.mountWall(b.northWalls.get(7), 'tapestry_woven', 'sunset');
  b.mountWall(b.northWalls.get(8), 'fairy_lights', 'warm', true);
  b.mountWall(b.eastWalls.get(5), 'mirror_round', 'oak');
  b.placeCeiling('hanging_ivy', 5, 7, 0, 'sage');
  b.placeCeiling('lamp_pendant', 7, 7, 0, 'rice', true);

  return b.buildState(preset);
}

function buildMountainCabinPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const b = createRoomBuilder(
    'cabin',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    () => ({ itemId: 'floor_herringbone', variantId: 'espresso' }),
    {
      north: (x) =>
        x === 6 || x === 9
          ? { itemId: 'window_wide', variantId: 'oak' }
          : { itemId: 'wall_brick', variantId: 'rosewood' },
      south: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_wood', variantId: 'honey' }
          : x === 5 || x === 10
            ? { itemId: 'window_wide', variantId: 'oak' }
            : { itemId: 'wall_wainscot', variantId: 'cream_oak' },
      west: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_wide', variantId: 'oak' }
          : { itemId: 'wall_wainscot', variantId: 'cream_oak' },
      east: (z) =>
        z === 6 || z === 9
          ? { itemId: 'window_wide', variantId: 'oak' }
          : { itemId: 'wall_wainscot', variantId: 'cream_oak' },
    },
  );

  // Converged double canopy bed in NW corner
  b.place('bed_canopy', 4, 4, 0, 'linen');
  b.place('bed_canopy', 6, 4, 0, 'linen');

  // Vinyl listening console along North wall
  const consoleUid = b.place('media_console', 8, 4, 0, 'walnut');
  b.placeSurface(consoleUid, 'record_player', 8, 4, 0, 'walnut', true);
  b.placeSurface(consoleUid, 'table_lamp', 9, 4, 0, 'amber', true);

  b.place('potted_fiddle_leaf', 10, 4, 0, 'terracotta');
  const cornerTableUid = b.place('side_table_round', 11, 4, 0, 'peach');
  b.placeSurface(cornerTableUid, 'table_lamp', 11, 4, 0, 'amber', true);

  // Warm cabin fireside seating & coffee table
  b.place('rug_woven', 5, 7, 0, 'coral');
  b.place('lamp_floor_arc', 4, 7, 0, 'brass', true);
  b.place('sofa_plush', 5, 7, 0, 'terracotta');
  b.place('armchair_plush', 9, 7, 1, 'caramel');
  b.place('bookshelf_tall', 4, 9, 3, 'oak');

  const coffeeUid = b.place('coffee_table_low', 5, 9, 0, 'walnut');
  b.placeSurface(coffeeUid, 'scented_candle', 5, 9, 0, 'cedar', true);
  b.placeSurface(coffeeUid, 'plushie_bear', 6, 9, 0, 'honey');

  // Hot-cocoa timber kitchen nook along East wall
  const counterUid = b.place('kitchen_counter', 11, 5, 1, 'wood');
  b.placeSurface(counterUid, 'electric_kettle', 11, 5, 1, 'copper', true);
  b.placeSurface(counterUid, 'cup_stack', 11, 6, 1, 'cream');
  b.place('stove_oven', 11, 7, 1, 'sage', true);
  b.place('pantry_shelf', 11, 8, 1, 'oak');

  // Warm cabin wall & ceiling lights
  b.mountWall(b.northWalls.get(5), 'fairy_lights', 'warm', true);
  b.mountWall(b.northWalls.get(7), 'fairy_lights', 'warm', true);
  b.mountWall(b.northWalls.get(8), 'record_wall_display', 'sunset');
  b.mountWall(b.eastWalls.get(5), 'framed_art', 'brass');
  b.mountWall(b.westWalls.get(7), 'tapestry_woven', 'sunset');
  b.placeCeiling('string_lights', 6, 6, 0, 'warm', true);
  b.placeCeiling('lamp_pendant', 9, 7, 0, 'peach', true);

  return b.buildState(preset);
}

export function createPresetHouse(presetId: string, data: GameDataBundle): HouseState {
  const preset = HOUSE_PRESETS.find((p) => p.id === presetId) ?? HOUSE_PRESETS[0];

  switch (preset.id) {
    case 'club':
      return buildClubPreset(preset, data);
    case 'cat_lounge':
      return buildCatLoungePreset(preset, data);
    case 'farmhouse':
      return buildFarmhousePreset(preset, data);
    case 'beach_loft':
      return buildBeachLoftPreset(preset, data);
    case 'mountain_cabin':
      return buildMountainCabinPreset(preset, data);
    case 'cafe':
    default: {
      const starter = createStarterHouse(data);
      const sceneryViewId = data.viewsById.has(preset.sceneryViewId)
        ? preset.sceneryViewId
        : starter.sceneryViewId;
      const weatherId = data.weathersById.has(preset.weatherId)
        ? preset.weatherId
        : starter.weatherId;
      return {
        ...starter,
        sceneryViewId,
        weatherId,
        timeHour: preset.timeHour,
        timeOfDay: timeHourToBucket(preset.timeHour),
      };
    }
  }
}
