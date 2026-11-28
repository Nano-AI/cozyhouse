import {
  timeHourToBucket,
  type GameDataBundle,
  type HiredStaff,
  type HouseState,
  type PlacedItem,
  type RotationQuarter,
} from '../data/schemas';
import { CEILING_HEIGHT, canonicalWallEdgeKey } from '../engine/GridSystem';
import {
  DEFAULT_GRID_DEPTH,
  DEFAULT_GRID_WIDTH,
  createStarterHouse,
  makePresetStaff,
  rotateHouseState,
} from './defaultHouse';

export { makePresetStaff, rotateHouseState };

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
    name: 'Cat Café',
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
  {
    id: 'backrooms_level0',
    name: 'Level 0',
    icon: 'loc_backrooms',
    sceneryViewId: 'backrooms',
    weatherId: 'fog',
    timeHour: 14.0,
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
  buildState(preset: HousePresetDef, staff?: HiredStaff[]): HouseState;
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
    buildState(preset, staff) {
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
        ...(staff && staff.length > 0 ? { staff } : {}),
      };
    },
  };
}

/*
 * Every preset below is authored directly in lot coordinates (+x = east, +z = south) with the
 * front door on the North wall. The default camera looks in from the south-east, so North and
 * West are the visible back walls: tall pieces, counters and wall decor go there. The South and
 * East walls fade out toward the camera, so only low pieces sit against them.
 * The renderer gives real point lights to at most 12 active fixtures per house (spinning party
 * rigs first, then lamps), so each preset keeps its lit fixtures within that budget.
 */

function buildClubPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const wall = { itemId: 'wall_plain', variantId: 'slate' };
  const windowSpec = { itemId: 'window_wide', variantId: 'charcoal' };
  const b = createRoomBuilder(
    'club',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) => {
      if (x <= 5 && z <= 5) {
        return { itemId: 'floor_tile', variantId: 'sky' };
      }
      if (x >= 6 && x <= 9 && z >= 6 && z <= 9) {
        const variantId = (x + z) % 2 === 0 ? 'lilac' : 'mint';
        return { itemId: 'dance_floor_tile', variantId, active: true };
      }
      return { itemId: 'floor_stone', variantId: 'slate' };
    },
    {
      north: (x) =>
        x === 7 || x === 8 ? { itemId: 'door_sliding', variantId: 'charcoal' } : x === 9 ? windowSpec : wall,
      south: (x) => (x === 5 || x === 10 ? windowSpec : wall),
      west: (z) => (z === 4 || z === 10 ? windowSpec : wall),
      east: (z) => (z === 6 || z === 10 ? windowSpec : wall),
    },
  );

  // Partitioned 2x2 restroom in the NW corner (tiles 4..5, 4..5), door opening east
  b.place('wall_plain', 4, 5, 2, 'slate');
  b.place('wall_plain', 5, 5, 2, 'slate');
  b.place('wall_plain', 5, 4, 1, 'slate');
  b.place('door_sliding', 5, 5, 1, 'charcoal');
  b.place('toilet_cozy', 4, 4, 0, 'mint');
  b.place('bathroom_sink', 5, 4, 0, 'sky');
  b.place('bath_mat', 4, 5, 0, 'blush');
  b.mountWall(b.westWalls.get(5), 'towel_rack', 'sky_blush');
  b.placeCeiling('lamp_pendant', 5, 5, 0, 'peach', true);

  // DJ stage along the West wall, facing the dance floor
  b.place('speaker_tower', 4, 6, 3, 'slate', true);
  const djBoothUid = b.place('dj_booth', 4, 7, 3, 'lilac', true);
  b.place('speaker_tower', 4, 9, 3, 'slate', true);
  b.place('subwoofer_box', 4, 10, 3, 'charcoal', true);
  b.place('vinyl_crate', 4, 11, 3, 'oak');
  b.place('fog_machine', 6, 11, 2, 'lavender', true);
  b.mountWall(b.westWalls.get(7), 'neon_sign', 'pink', true);
  b.mountWall(b.westWalls.get(8), 'led_strip_wall', 'lilac', true);

  // Cocktail bar along the North wall, right of the entrance
  const barUid = b.place('bar_counter', 10, 4, 0, 'indigo');
  b.placeSurface(barUid, 'cocktail_shaker', 10, 4, 0, 'silver');
  b.place('bar_stool', 9, 4, 3, 'blush');
  b.place('bar_stool', 10, 5, 2, 'blush');
  b.mountWall(b.northWalls.get(10), 'bottle_shelf', 'brass');
  b.mountWall(b.northWalls.get(11), 'neon_drink_menu', 'mint', true);
  b.placeCeiling('string_lights', 10, 4, 0, 'cool', true);

  // Entrance glow + VIP seating along the East wall
  b.place('floor_uplight', 6, 4, 0, 'violet', true);
  b.mountWall(b.northWalls.get(6), 'led_strip_wall', 'pink', true);
  const sideUid = b.place('side_table_round', 11, 7, 0, 'sage');
  b.placeSurface(sideUid, 'lamp_lava', 11, 7, 0, 'lilac', true);
  b.place('sofa_plush', 11, 8, 1, 'dusty_blue');
  b.place('floor_uplight', 11, 11, 0, 'cyan', true);

  // Ceiling lighting rig over the dance floor
  b.placeCeiling('laser_bar', 5, 7, 1, 'neon_pink', true);
  b.placeCeiling('disco_ball', 7, 7, 0, 'silver', true);
  b.placeCeiling('party_spotlight', 9, 6, 0, 'aqua', true);
  b.placeCeiling('party_spotlight', 6, 9, 0, 'magenta', true);

  return b.buildState(preset, [
    makePresetStaff('staff_club_dj', 'dj', djBoothUid, 0),
    makePresetStaff('staff_club_bartender', 'bartender', barUid, 0),
  ]);
}

function buildCatLoungePreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const wall = { itemId: 'wall_wainscot', variantId: 'oat_sage' };
  const windowSpec = { itemId: 'window_arched', variantId: 'sage' };
  const b = createRoomBuilder(
    'cats',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) =>
      x <= 5 && z >= 10
        ? { itemId: 'floor_tile', variantId: 'sage' }
        : { itemId: 'floor_herringbone', variantId: 'honey' },
    {
      north: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_arched', variantId: 'sage' }
          : x === 4
            ? { itemId: 'window_bay', variantId: 'ivory' }
            : wall,
      south: (x) => (x === 7 || x === 10 ? windowSpec : wall),
      west: (z) => (z === 8 || z === 11 ? windowSpec : wall),
      east: (z) => (z === 6 || z === 9 ? windowSpec : wall),
    },
  );

  // Coffee bar + bookshelf along the North wall, left of the entrance
  const coffeeCounterUid = b.place('cafe_counter', 4, 4, 0, 'latte');
  b.placeSurface(coffeeCounterUid, 'cup_stack', 4, 4, 0, 'cream');
  const espressoUid = b.placeSurface(coffeeCounterUid, 'espresso_machine', 5, 4, 0, 'mint', true);
  b.place('bookshelf_tall', 6, 4, 0, 'oak');
  b.mountWall(b.northWalls.get(5), 'fairy_lights', 'warm', true);
  b.placeCeiling('hanging_ivy', 4, 4, 0, 'sage');

  // Cat climbing corner along the North wall, right of the entrance
  b.place('pet_bed_round', 9, 4, 0, 'peach');
  b.mountWall(b.northWalls.get(9), 'window_hammock', 'sage');
  b.place('cat_tree', 10, 4, 0, 'oat');
  b.place('cat_condo_tower', 11, 4, 0, 'birch');
  b.mountWall(b.northWalls.get(10), 'fairy_lights', 'warm', true);

  // Sofa under the cat shelves + low bookshelf along the West wall
  b.place('potted_fiddle_leaf', 4, 5, 0, 'woven');
  b.place('sofa_plush', 4, 6, 3, 'terracotta');
  b.mountWall(b.westWalls.get(6), 'cat_wall_shelf', 'birch');
  b.mountWall(b.westWalls.get(7), 'cat_wall_shelf', 'birch');
  b.placeCeiling('ceiling_catwalk', 4, 6, 1, 'oak');
  const lowShelfUid = b.place('bookshelf_low', 4, 8, 3, 'oak');
  b.placeSurface(lowShelfUid, 'cat_loaf', 4, 8, 3, 'brioche');
  b.placeSurface(lowShelfUid, 'table_lamp', 4, 9, 3, 'blush', true);
  b.mountWall(b.westWalls.get(9), 'wall_vines', 'ivy');

  // Central rug with lounging cats, armchair facing the sofa
  b.place('rug_woven', 6, 6, 0, 'eucalyptus');
  b.place('cat_sleepy', 6, 7, 0, 'cream');
  b.place('cat_calico', 8, 7, 0, 'calico');
  b.place('armchair_plush', 9, 6, 1, 'sage');
  const sideUid = b.place('side_table_round', 9, 7, 0, 'birch');
  b.placeSurface(sideUid, 'table_lamp', 9, 7, 0, 'amber', true);
  b.placeCeiling('lamp_pendant', 7, 7, 0, 'sage', true);

  // Play & nap zone toward the camera (low pieces only)
  b.place('cat_ball_track', 7, 9, 0, 'mint');
  b.place('cat_kitten', 8, 9, 1, 'marmalade');
  b.place('cat_tunnel', 8, 11, 0, 'oat');
  b.place('scratch_post', 11, 7, 0, 'cactus');
  b.place('pet_bed_round', 11, 8, 0, 'oat');
  b.place('potted_monstera', 11, 10, 0, 'terracotta');
  b.place('pet_bowls', 11, 11, 1, 'mint');
  b.placeCeiling('lamp_pendant', 9, 9, 0, 'rice', true);
  b.placeCeiling('hanging_fern', 9, 4, 0, 'meadow');

  // Partitioned 2x2 restroom in the SW corner (tiles 4..5, 10..11), door opening east
  b.place('wall_wainscot', 4, 10, 0, 'oat_sage');
  b.place('wall_wainscot', 5, 10, 0, 'oat_sage');
  b.place('door_arched', 5, 10, 1, 'sage');
  b.place('wall_wainscot', 5, 11, 1, 'oat_sage');
  b.place('bathroom_sink', 4, 10, 3, 'sage');
  b.place('toilet_cozy', 4, 11, 3, 'blush');
  b.place('bath_mat', 5, 11, 0, 'sage');
  b.mountWall(b.westWalls.get(10), 'towel_rack', 'sage_oat');
  b.placeCeiling('lamp_pendant', 5, 10, 0, 'rice', true);

  return b.buildState(preset, [
    makePresetStaff('staff_catcafe_barista', 'barista', espressoUid, 1),
  ]);
}

function buildFarmhousePreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const brick = { itemId: 'wall_brick', variantId: 'whitewash' };
  const wainscot = { itemId: 'wall_wainscot', variantId: 'cream_oak' };
  const wideWindow = { itemId: 'window_wide', variantId: 'oak' };
  const archedWindow = { itemId: 'window_arched', variantId: 'cream' };
  const b = createRoomBuilder(
    'farm',
    data,
    { minX: 3, maxX: 12, minZ: 4, maxZ: 11 },
    (x, z) => {
      if (x >= 10 && z <= 5) {
        return { itemId: 'floor_tile', variantId: 'cream' };
      }
      return x <= 6 && z <= 8
        ? { itemId: 'floor_stone', variantId: 'sandstone' }
        : { itemId: 'floor_wood', variantId: 'walnut' };
    },
    {
      north: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_wood', variantId: 'honey' }
          : x === 4 || x === 12
            ? wideWindow
            : brick,
      south: (x) => (x === 5 || x === 10 ? wideWindow : wainscot),
      west: (z) => (z === 6 || z === 9 || z === 10 ? archedWindow : brick),
      east: (z) => (z === 7 || z === 10 ? wideWindow : wainscot),
    },
  );

  // Country kitchen: cooking run along the North wall, sink + pantry along the West wall
  const fridgeUid = b.place('fridge_retro', 3, 4, 0, 'butter');
  b.placeSurface(fridgeUid, 'fruit_bowl', 3, 4, 0, 'cream');
  const counterUid = b.place('kitchen_counter', 4, 4, 0, 'butter');
  b.placeSurface(counterUid, 'electric_kettle', 4, 4, 0, 'copper');
  b.placeSurface(counterUid, 'toaster_pastel', 5, 4, 0, 'butter');
  const stoveUid = b.place('stove_oven', 6, 4, 0, 'cream', true);
  b.place('kitchen_sink', 3, 6, 3, 'cream');
  b.place('kitchen_counter_corner', 3, 7, 3, 'butter');
  b.place('pantry_shelf', 3, 8, 3, 'oak');
  b.mountWall(b.northWalls.get(3), 'fairy_lights', 'warm', true);
  b.mountWall(b.northWalls.get(5), 'spice_rack', 'birch');
  b.mountWall(b.northWalls.get(6), 'wall_clock', 'cream');

  const islandUid = b.place('kitchen_island', 5, 6, 0, 'cream_oak');
  b.placeSurface(islandUid, 'cake_stand', 5, 6, 0, 'strawberry');
  b.placeSurface(islandUid, 'cup_stack', 6, 6, 0, 'cream');
  b.placeCeiling('lamp_pendant', 5, 6, 0, 'rice', true);

  // Entry: plant + art beside the front door
  b.place('potted_monstera', 9, 4, 0, 'terracotta');
  b.mountWall(b.northWalls.get(9), 'framed_art', 'oak');

  // Partitioned 3x2 bathroom with clawfoot tub in the NE corner (tiles 10..12, 4..5), door opening west
  b.place('wall_wainscot', 10, 4, 3, 'cream_oak');
  b.place('door_wood', 10, 5, 3, 'honey');
  b.place('wall_wainscot', 10, 5, 2, 'cream_oak');
  b.place('wall_wainscot', 11, 5, 2, 'cream_oak');
  b.place('wall_wainscot', 12, 5, 2, 'cream_oak');
  b.place('toilet_cozy', 10, 4, 0, 'porcelain');
  b.place('bathtub_clawfoot', 11, 4, 0, 'ivory');
  b.place('bathroom_sink', 12, 5, 1, 'oak');
  b.place('bath_mat', 11, 5, 0, 'cream');
  b.mountWall(b.northWalls.get(10), 'towel_rack', 'peach_cream');
  b.placeCeiling('lamp_pendant', 11, 5, 0, 'rice', true);

  // Farmhouse dining table toward the camera
  const diningUid = b.place('dining_table', 10, 9, 0, 'oak');
  b.placeSurface(diningUid, 'flower_vase', 10, 9, 0, 'daisy');
  b.place('dining_chair', 9, 9, 3, 'oak');
  b.place('dining_chair', 9, 10, 3, 'oak');
  b.place('dining_chair', 12, 9, 1, 'oak');
  b.place('dining_chair', 12, 10, 1, 'oak');
  b.placeCeiling('lamp_pendant', 10, 9, 0, 'rice', true);

  // Cozy living corner along the West wall
  b.place('rug_woven', 3, 9, 0, 'oat');
  b.place('loveseat_tufted', 3, 9, 3, 'olive');
  const coffeeUid = b.place('coffee_table_low', 5, 9, 3, 'oak');
  b.placeSurface(coffeeUid, 'table_lamp', 5, 9, 3, 'amber', true);
  b.placeSurface(coffeeUid, 'scented_candle', 5, 10, 3, 'vanilla', true);
  b.placeCeiling('lamp_pendant', 4, 9, 0, 'rice', true);
  b.place('potted_fiddle_leaf', 3, 11, 0, 'terracotta');

  return b.buildState(preset, [makePresetStaff('staff_farm_chef', 'chef', stoveUid, 0)]);
}

function buildBeachLoftPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const wall = { itemId: 'wall_plain', variantId: 'cream' };
  const wideWindow = { itemId: 'window_wide', variantId: 'cream' };
  const b = createRoomBuilder(
    'beach',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) => {
      if (x >= 10 && z <= 6) {
        return { itemId: 'floor_tile', variantId: 'sky' };
      }
      return x >= 7 && x <= 8 && z <= 5
        ? { itemId: 'floor_terrazzo', variantId: 'ivory' }
        : { itemId: 'floor_wood', variantId: 'birch' };
    },
    {
      north: (x) =>
        x === 7 || x === 8
          ? { itemId: 'door_cafe_glass', variantId: 'butter' }
          : x === 4 || x === 5
            ? wideWindow
            : wall,
      south: (x) => (x === 5 || x === 6 || x === 9 || x === 10 ? wideWindow : wall),
      west: (z) => (z === 7 || z === 8 ? { itemId: 'window_bay', variantId: 'ivory' } : wall),
      east: (z) => (z === 7 || z === 10 ? { itemId: 'window_arched', variantId: 'cream' } : wall),
    },
  );

  // Coastal espresso bar under the North windows, left of the entrance
  const beachCounterUid = b.place('cafe_counter', 4, 4, 0, 'latte');
  b.placeSurface(beachCounterUid, 'cup_stack', 4, 4, 0, 'peach');
  const beachEspressoUid = b.placeSurface(beachCounterUid, 'espresso_machine', 5, 4, 0, 'coral', true);
  b.place('potted_monstera', 6, 4, 0, 'cream');
  b.placeCeiling('hanging_ivy', 6, 4, 0, 'sage');
  b.placeCeiling('lamp_pendant', 5, 5, 0, 'rice', true);

  // King-size coastal bed (2 merged bed_cozy) with its headboard on the West wall
  const leftNightstand = b.place('side_table_round', 4, 5, 0, 'birch');
  b.placeSurface(leftNightstand, 'table_lamp', 4, 5, 0, 'amber', true);
  b.place('bed_cozy', 4, 6, 3, 'sage');
  b.place('bed_cozy', 4, 8, 3, 'sage');
  const rightNightstand = b.place('side_table_round', 4, 10, 0, 'birch');
  b.placeSurface(rightNightstand, 'scented_candle', 4, 10, 0, 'vanilla', true);
  b.place('mirror_arch', 4, 11, 3, 'oak');
  b.mountWall(b.westWalls.get(5), 'fairy_lights', 'warm', true);
  b.mountWall(b.westWalls.get(10), 'tapestry_woven', 'sunset');
  b.placeCeiling('string_lights', 4, 7, 1, 'warm', true);

  // Reading lounge at the foot of the bed
  const shelfUid = b.place('bookshelf_low', 6, 7, 3, 'birch');
  b.placeSurface(shelfUid, 'flower_vase', 6, 7, 3, 'tulip');
  b.placeSurface(shelfUid, 'glass_terrarium', 6, 8, 3, 'succulent');
  b.place('rug_woven', 7, 7, 0, 'oat');
  b.place('armchair_plush', 9, 7, 1, 'sage');
  b.place('lamp_floor_arc', 10, 7, 1, 'cream', true);
  b.placeCeiling('lamp_pendant', 8, 7, 0, 'rice', true);

  // Study desk by the East windows
  const deskUid = b.place('desk_study', 11, 9, 1, 'birch');
  b.placeSurface(deskUid, 'lamp_desk', 11, 9, 1, 'butter', true);
  b.placeSurface(deskUid, 'potted_cactus', 11, 10, 1, 'cream');
  b.place('chair_office', 10, 9, 3, 'sky');

  // Partitioned 2x3 ensuite with glass shower in the NE corner (tiles 10..11, 4..6), door opening west
  b.place('potted_snake_plant', 9, 4, 0, 'cream');
  b.mountWall(b.northWalls.get(9), 'mirror_round', 'oak');
  b.place('wall_plain', 10, 4, 3, 'cream');
  b.place('door_arched', 10, 5, 3, 'blush');
  b.place('wall_plain', 10, 6, 3, 'cream');
  b.place('wall_plain', 10, 6, 2, 'cream');
  b.place('wall_plain', 11, 6, 2, 'cream');
  b.place('toilet_cozy', 10, 4, 0, 'porcelain');
  b.place('shower_glass', 11, 4, 0, 'brass');
  b.place('bathroom_sink', 11, 6, 1, 'sky');
  b.place('bath_mat', 11, 5, 0, 'cream');
  b.mountWall(b.northWalls.get(10), 'towel_rack', 'sky_blush');
  b.placeCeiling('lamp_pendant', 10, 5, 0, 'rice', true);

  return b.buildState(preset, [
    makePresetStaff('staff_beach_barista', 'barista', beachEspressoUid, 0),
  ]);
}

function buildMountainCabinPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const brick = { itemId: 'wall_brick', variantId: 'rosewood' };
  const wainscot = { itemId: 'wall_wainscot', variantId: 'cream_oak' };
  const windowSpec = { itemId: 'window_wide', variantId: 'oak' };
  const b = createRoomBuilder(
    'cabin',
    data,
    { minX: 4, maxX: 11, minZ: 4, maxZ: 11 },
    (x, z) =>
      x <= 5 && z <= 6
        ? { itemId: 'floor_tile', variantId: 'cream' }
        : { itemId: 'floor_herringbone', variantId: 'espresso' },
    {
      north: (x) =>
        x === 7 || x === 8 ? { itemId: 'door_wood', variantId: 'honey' } : brick,
      south: (x) => (x === 5 || x === 9 ? windowSpec : wainscot),
      west: (z) => (z === 5 || z === 8 || z === 9 ? windowSpec : wainscot),
      east: (z) => (z === 6 || z === 10 ? windowSpec : wainscot),
    },
  );

  // Partitioned 2x3 bath with glass shower in the NW corner (tiles 4..5, 4..6), door opening east
  b.place('wall_wainscot', 4, 6, 2, 'cream_oak');
  b.place('wall_wainscot', 5, 6, 2, 'cream_oak');
  b.place('wall_wainscot', 5, 4, 1, 'cream_oak');
  b.place('wall_wainscot', 5, 5, 1, 'cream_oak');
  b.place('door_wood', 5, 6, 1, 'honey');
  b.place('shower_glass', 4, 4, 3, 'charcoal');
  b.place('toilet_cozy', 4, 5, 3, 'porcelain');
  b.place('bathroom_sink', 4, 6, 3, 'oak');
  b.place('bath_mat', 5, 5, 0, 'sage');
  b.mountWall(b.northWalls.get(5), 'towel_rack', 'peach_cream');
  b.placeCeiling('lamp_pendant', 5, 5, 0, 'rice', true);

  // Alpine espresso & hot-cocoa bar + stove in the NE corner
  b.place('pantry_shelf', 9, 4, 0, 'oak');
  const counterUid = b.place('cafe_counter', 10, 4, 0, 'espresso');
  const cabinEspressoUid = b.placeSurface(counterUid, 'espresso_machine', 10, 4, 0, 'cream', true);
  b.placeSurface(counterUid, 'cup_stack', 11, 4, 0, 'cream');
  b.place('stove_oven', 11, 5, 1, 'sage', true);
  b.mountWall(b.northWalls.get(10), 'framed_art', 'brass');
  b.mountWall(b.northWalls.get(11), 'record_wall_display', 'sunset');
  b.placeCeiling('lamp_pendant', 10, 5, 0, 'peach', true);

  // Double canopy bed (2 merged bed_canopy) with its headboard on the West wall
  b.place('bed_canopy', 4, 7, 3, 'linen');
  b.place('bed_canopy', 4, 9, 3, 'linen');
  b.placeCeiling('string_lights', 4, 8, 1, 'warm', true);
  b.place('bookshelf_tall', 4, 11, 3, 'oak');
  b.mountWall(b.westWalls.get(11), 'fairy_lights', 'warm', true);
  b.mountWall(b.northWalls.get(6), 'tapestry_woven', 'sunset');
  b.mountWall(b.northWalls.get(9), 'fairy_lights', 'warm', true);

  // Fireside-style seating facing the vinyl console on the East wall
  b.place('lamp_floor_arc', 7, 7, 3, 'brass', true);
  b.place('rug_woven', 7, 8, 0, 'coral');
  b.place('sofa_plush', 7, 8, 3, 'terracotta');
  const endTableUid = b.place('side_table_round', 7, 10, 0, 'peach');
  b.placeSurface(endTableUid, 'table_lamp', 7, 10, 0, 'amber', true);
  b.place('armchair_plush', 9, 7, 0, 'caramel');
  const coffeeUid = b.place('coffee_table_low', 9, 8, 3, 'walnut');
  b.placeSurface(coffeeUid, 'scented_candle', 9, 8, 3, 'cedar', true);
  b.placeSurface(coffeeUid, 'plushie_bear', 9, 9, 3, 'honey');
  b.placeCeiling('lamp_pendant', 9, 9, 0, 'peach', true);

  const consoleUid = b.place('media_console', 11, 8, 1, 'walnut');
  b.placeSurface(consoleUid, 'record_player', 11, 8, 1, 'walnut', true);
  b.placeSurface(consoleUid, 'table_lamp', 11, 9, 1, 'amber', true);
  b.place('potted_fiddle_leaf', 11, 7, 0, 'terracotta');

  return b.buildState(preset, [
    makePresetStaff('staff_cabin_barista', 'barista', cabinEspressoUid, 1),
  ]);
}

interface BackroomsCornerPlan {
  id: 'NW' | 'NE' | 'SW' | 'SE';
  bathTiles: Array<[number, number]>;
  bathWalls: Array<{ x: number; z: number; rot: RotationQuarter; isDoorCandidate?: boolean }>;
  toilet: { x: number; z: number; rot: RotationQuarter };
  sink: { x: number; z: number; rot: RotationQuarter };
  bathMat: { x: number; z: number };
  bathEntry: { x: number; z: number };
  towelWallSide: 'north' | 'south';
  towelWallX: number;
  coffeeCounter: { x: number; z: number; rot: RotationQuarter; tiles: Array<[number, number]> };
  espressoPos: { x: number; z: number };
  cupPos: { x: number; z: number };
  coffeeApproach: Array<[number, number]>;
}

function buildBackroomsPreset(preset: HousePresetDef, data: GameDataBundle): HouseState {
  const minX = 3;
  const maxX = 12;
  const minZ = 4;
  const maxZ = 11;
  const tileKey = (x: number, z: number) => `${x},${z}`;

  const randInt = (lo: number, hi: number): number =>
    lo + Math.floor(Math.random() * (hi - lo + 1));

  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  // 4 distinct corner layouts on the 10x8 room (minX=3..12, minZ=4..11) with North entrance at (7..8, 4)
  const cornerPlans: BackroomsCornerPlan[] = [
    {
      id: 'NW',
      bathTiles: [[3, 4], [4, 4], [3, 5], [4, 5]],
      bathWalls: [
        { x: 3, z: 5, rot: 2 },
        { x: 4, z: 5, rot: 2, isDoorCandidate: true },
        { x: 4, z: 4, rot: 1 },
        { x: 4, z: 5, rot: 1, isDoorCandidate: true },
      ],
      toilet: { x: 3, z: 4, rot: 3 },
      sink: { x: 3, z: 5, rot: 3 },
      bathMat: { x: 4, z: 4 },
      bathEntry: { x: 4, z: 5 },
      towelWallSide: 'north',
      towelWallX: 4,
      coffeeCounter: { x: 3, z: 4, rot: 3, tiles: [[3, 4], [3, 5]] },
      espressoPos: { x: 3, z: 4 },
      cupPos: { x: 3, z: 5 },
      coffeeApproach: [[4, 4], [4, 5]],
    },
    {
      id: 'NE',
      bathTiles: [[11, 4], [12, 4], [11, 5], [12, 5]],
      bathWalls: [
        { x: 11, z: 5, rot: 2, isDoorCandidate: true },
        { x: 12, z: 5, rot: 2 },
        { x: 11, z: 4, rot: 3 },
        { x: 11, z: 5, rot: 3, isDoorCandidate: true },
      ],
      toilet: { x: 12, z: 4, rot: 1 },
      sink: { x: 12, z: 5, rot: 1 },
      bathMat: { x: 11, z: 4 },
      bathEntry: { x: 11, z: 5 },
      towelWallSide: 'north',
      towelWallX: 11,
      coffeeCounter: { x: 12, z: 4, rot: 1, tiles: [[12, 4], [12, 5]] },
      espressoPos: { x: 12, z: 4 },
      cupPos: { x: 12, z: 5 },
      coffeeApproach: [[11, 4], [11, 5]],
    },
    {
      id: 'SW',
      bathTiles: [[3, 10], [4, 10], [3, 11], [4, 11]],
      bathWalls: [
        { x: 3, z: 10, rot: 0 },
        { x: 4, z: 10, rot: 0, isDoorCandidate: true },
        { x: 4, z: 10, rot: 1, isDoorCandidate: true },
        { x: 4, z: 11, rot: 1 },
      ],
      toilet: { x: 3, z: 11, rot: 3 },
      sink: { x: 3, z: 10, rot: 3 },
      bathMat: { x: 4, z: 11 },
      bathEntry: { x: 4, z: 10 },
      towelWallSide: 'south',
      towelWallX: 4,
      coffeeCounter: { x: 3, z: 9, rot: 3, tiles: [[3, 9], [3, 10]] },
      espressoPos: { x: 3, z: 9 },
      cupPos: { x: 3, z: 10 },
      coffeeApproach: [[4, 9], [4, 10]],
    },
    {
      id: 'SE',
      bathTiles: [[11, 10], [12, 10], [11, 11], [12, 11]],
      bathWalls: [
        { x: 11, z: 10, rot: 0, isDoorCandidate: true },
        { x: 12, z: 10, rot: 0 },
        { x: 11, z: 10, rot: 3, isDoorCandidate: true },
        { x: 11, z: 11, rot: 3 },
      ],
      toilet: { x: 12, z: 11, rot: 1 },
      sink: { x: 12, z: 10, rot: 1 },
      bathMat: { x: 11, z: 11 },
      bathEntry: { x: 11, z: 10 },
      towelWallSide: 'south',
      towelWallX: 11,
      coffeeCounter: { x: 12, z: 9, rot: 1, tiles: [[12, 9], [12, 10]] },
      espressoPos: { x: 12, z: 9 },
      cupPos: { x: 12, z: 10 },
      coffeeApproach: [[11, 9], [11, 10]],
    },
  ];

  const pickedCorners = shuffle(cornerPlans);
  const bathCorner = pickedCorners[0];
  const coffeeCorner = pickedCorners[1];
  const bathTileSet = new Set(bathCorner.bathTiles.map(([x, z]) => tileKey(x, z)));
  const coffeeTileSet = new Set(coffeeCorner.coffeeCounter.tiles.map(([x, z]) => tileKey(x, z)));
  const coffeeApproachSet = new Set(coffeeCorner.coffeeApproach.map(([x, z]) => tileKey(x, z)));

  const wallStyleChoice = Math.random() < 0.72 ? 'wall_wainscot' : 'wall_plain';
  const wallVariantChoice = wallStyleChoice === 'wall_wainscot' ? 'cream_oak' : 'cream';
  const yellowWall = { itemId: wallStyleChoice, variantId: wallVariantChoice };

  const b = createRoomBuilder(
    'backrooms',
    data,
    { minX, maxX, minZ, maxZ },
    (x, z) =>
      bathTileSet.has(tileKey(x, z))
        ? { itemId: 'floor_tile', variantId: 'cream' }
        : { itemId: 'floor_stone', variantId: 'sandstone' },
    {
      north: (x) =>
        x === 7 || x === 8 ? { itemId: 'door_wood', variantId: 'honey' } : yellowWall,
      south: () => yellowWall,
      west: () => yellowWall,
      east: () => yellowWall,
    },
  );

  // Track occupied and protected canonical wall edges so interior partitions never overlap or seal doorways
  const occupiedEdges = new Set<string>();
  const protectedEdges = new Set<string>();
  const solidWallEdges = new Set<string>();

  for (let x = minX; x <= maxX; x++) {
    occupiedEdges.add(canonicalWallEdgeKey(x, minZ, 0));
    occupiedEdges.add(canonicalWallEdgeKey(x, maxZ, 2));
  }
  for (let z = minZ; z <= maxZ; z++) {
    occupiedEdges.add(canonicalWallEdgeKey(minX, z, 3));
    occupiedEdges.add(canonicalWallEdgeKey(maxX, z, 1));
  }

  // Keep North double-door vestibule open (tiles (7..8, 4..5))
  protectedEdges.add(canonicalWallEdgeKey(7, 4, 1));
  protectedEdges.add(canonicalWallEdgeKey(7, 4, 2));
  protectedEdges.add(canonicalWallEdgeKey(8, 4, 2));
  protectedEdges.add(canonicalWallEdgeKey(7, 5, 1));

  // Protect edges inside bathroom & between coffee counter and its front approach tiles
  const stepDelta: Record<RotationQuarter, [number, number]> = {
    0: [0, -1],
    1: [1, 0],
    2: [0, 1],
    3: [-1, 0],
  };

  for (const [bx, bz] of bathCorner.bathTiles) {
    for (const rot of [0, 1, 2, 3] as RotationQuarter[]) {
      const [dx, dz] = stepDelta[rot];
      if (bathTileSet.has(tileKey(bx + dx, bz + dz))) {
        protectedEdges.add(canonicalWallEdgeKey(bx, bz, rot));
      }
    }
  }
  for (const [cx, cz] of coffeeCorner.coffeeCounter.tiles) {
    for (const rot of [0, 1, 2, 3] as RotationQuarter[]) {
      const [dx, dz] = stepDelta[rot];
      const nk = tileKey(cx + dx, cz + dz);
      if (coffeeTileSet.has(nk) || coffeeApproachSet.has(nk)) {
        protectedEdges.add(canonicalWallEdgeKey(cx, cz, rot));
      }
    }
  }

  // Place partitioned 2x2 walkable bathroom with randomly chosen door face
  const doorCandidates = bathCorner.bathWalls.filter((w) => w.isDoorCandidate);
  const chosenBathDoor = doorCandidates[Math.floor(Math.random() * doorCandidates.length)];
  const [bdx, bdz] = stepDelta[chosenBathDoor.rot];
  const bathDoorOutside: [number, number] = [chosenBathDoor.x + bdx, chosenBathDoor.z + bdz];

  for (const w of bathCorner.bathWalls) {
    const key = canonicalWallEdgeKey(w.x, w.z, w.rot);
    occupiedEdges.add(key);
    if (w === chosenBathDoor) {
      b.place('door_wood', w.x, w.z, w.rot, 'honey');
    } else {
      b.place('wall_plain', w.x, w.z, w.rot, 'cream');
      solidWallEdges.add(key);
    }
  }
  b.place('toilet_cozy', bathCorner.toilet.x, bathCorner.toilet.z, bathCorner.toilet.rot, 'porcelain');
  b.place('bathroom_sink', bathCorner.sink.x, bathCorner.sink.z, bathCorner.sink.rot, 'oak');
  b.place('bath_mat', bathCorner.bathMat.x, bathCorner.bathMat.z, 0, 'cream');
  const towelHostWall =
    bathCorner.towelWallSide === 'north'
      ? b.northWalls.get(bathCorner.towelWallX)
      : b.southWalls.get(bathCorner.towelWallX);
  b.mountWall(towelHostWall, 'towel_rack', 'peach_cream');

  // Place surreal lone coffee corner in a different corner
  const counterUid = b.place(
    'cafe_counter',
    coffeeCorner.coffeeCounter.x,
    coffeeCorner.coffeeCounter.z,
    coffeeCorner.coffeeCounter.rot,
    'latte',
  );
  const espressoUid = b.placeSurface(
    counterUid,
    'espresso_machine',
    coffeeCorner.espressoPos.x,
    coffeeCorner.espressoPos.z,
    coffeeCorner.coffeeCounter.rot,
    'cream',
    true,
  );
  b.placeSurface(
    counterUid,
    'cup_stack',
    coffeeCorner.cupPos.x,
    coffeeCorner.cupPos.z,
    coffeeCorner.coffeeCounter.rot,
    'cream',
  );

  // Generate random asymmetrical Level 0 interior corridor partitions, stubs, and archways
  interface InteriorEdgeSpec {
    key: string;
    x: number;
    z: number;
    rot: RotationQuarter;
    kind: 'wall' | 'arch';
  }
  const interiorEdges = new Map<string, InteriorEdgeSpec>();

  const tryAddInteriorEdge = (
    x: number,
    z: number,
    rot: RotationQuarter,
    kind: 'wall' | 'arch',
  ): boolean => {
    const [dx, dz] = stepDelta[rot];
    const nx = x + dx;
    const nz = z + dz;
    if (
      x < minX ||
      x > maxX ||
      z < minZ ||
      z > maxZ ||
      nx < minX ||
      nx > maxX ||
      nz < minZ ||
      nz > maxZ
    ) {
      return false;
    }
    const key = canonicalWallEdgeKey(x, z, rot);
    if (occupiedEdges.has(key) || protectedEdges.has(key)) {
      return false;
    }
    occupiedEdges.add(key);
    interiorEdges.set(key, { key, x, z, rot, kind });
    if (kind === 'wall') {
      solidWallEdges.add(key);
    }
    return true;
  };

  // 5..8 asymmetrical corridor partition runs (length 2..4)
  const runCount = randInt(5, 8);
  for (let r = 0; r < runCount; r++) {
    const horizontal = Math.random() < 0.52;
    const len = randInt(2, 4);
    if (horizontal) {
      const z = randInt(minZ, maxZ - 1); // South edge of row z separates row z and row z+1
      const startX = randInt(minX, maxX - len + 1);
      const archIdx = Math.random() < 0.55 ? randInt(0, len - 1) : -1;
      for (let i = 0; i < len; i++) {
        tryAddInteriorEdge(startX + i, z, 2, i === archIdx ? 'arch' : 'wall');
      }
    } else {
      const x = randInt(minX, maxX - 1); // East edge of col x separates col x and col x+1
      const startZ = randInt(minZ, maxZ - len + 1);
      const archIdx = Math.random() < 0.55 ? randInt(0, len - 1) : -1;
      for (let i = 0; i < len; i++) {
        tryAddInteriorEdge(x, startZ + i, 1, i === archIdx ? 'arch' : 'wall');
      }
    }
  }

  // 3..5 unexpected 1-tile liminal stub dividers protruding into hallways
  const stubCount = randInt(3, 5);
  for (let s = 0; s < stubCount; s++) {
    const horizontal = Math.random() < 0.5;
    if (horizontal) {
      tryAddInteriorEdge(randInt(minX, maxX), randInt(minZ, maxZ - 1), 2, 'wall');
    } else {
      tryAddInteriorEdge(randInt(minX, maxX - 1), randInt(minZ, maxZ), 1, 'wall');
    }
  }

  // Solid floor obstacles (toilet, sink, coffee counter)
  const blockedFloorTiles = new Set<string>([
    tileKey(bathCorner.toilet.x, bathCorner.toilet.z),
    tileKey(bathCorner.sink.x, bathCorner.sink.z),
    ...coffeeCorner.coffeeCounter.tiles.map(([x, z]) => tileKey(x, z)),
  ]);

  const computeReachable = (extraBlocked?: Set<string>): Set<string> => {
    const startKey = tileKey(7, 4);
    const visited = new Set<string>([startKey]);
    const queue: Array<[number, number]> = [[7, 4]];
    while (queue.length > 0) {
      const [cx, cz] = queue.shift()!;
      for (const rot of [0, 1, 2, 3] as RotationQuarter[]) {
        const [dx, dz] = stepDelta[rot];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
        const nk = tileKey(nx, nz);
        if (visited.has(nk) || blockedFloorTiles.has(nk) || extraBlocked?.has(nk)) continue;
        const edgeKey = canonicalWallEdgeKey(cx, cz, rot);
        if (solidWallEdges.has(edgeKey)) continue;
        visited.add(nk);
        queue.push([nx, nz]);
      }
    }
    return visited;
  };

  // Inline BFS connectivity guarantee: punch a wall_arch through any interior wall sealing off
  // the bathroom, coffee corner, or any isolated pocket of the maze.
  for (let guard = 0; guard < 40; guard++) {
    const reachable = computeReachable();
    let sealedEdgeKey: string | null = null;

    // Prioritize breaking walls separating reachable tiles from unreachable tiles
    const candidates = shuffle(Array.from(interiorEdges.values()).filter((e) => e.kind === 'wall'));
    for (const edge of candidates) {
      const [dx, dz] = stepDelta[edge.rot];
      const k1 = tileKey(edge.x, edge.z);
      const k2 = tileKey(edge.x + dx, edge.z + dz);
      if (blockedFloorTiles.has(k1) || blockedFloorTiles.has(k2)) continue;
      if (reachable.has(k1) !== reachable.has(k2)) {
        sealedEdgeKey = edge.key;
        break;
      }
    }

    if (!sealedEdgeKey) break;
    const edgeSpec = interiorEdges.get(sealedEdgeKey)!;
    edgeSpec.kind = 'arch';
    solidWallEdges.delete(sealedEdgeKey);
  }

  // Emit finalized interior partition walls & archways
  const solidInteriorWallUids: string[] = [];
  for (const edge of interiorEdges.values()) {
    if (edge.kind === 'arch') {
      b.place('wall_arch', edge.x, edge.z, edge.rot, 'plaster');
    } else {
      const uid = b.place(wallStyleChoice, edge.x, edge.z, edge.rot, wallVariantChoice);
      solidInteriorWallUids.push(uid);
    }
  }

  // Mount 1..2 eerie mustard wall clocks on solid interior partitions
  const clockWalls = shuffle(solidInteriorWallUids).slice(0, randInt(1, 2));
  for (const clockWallUid of clockWalls) {
    b.mountWall(clockWallUid, 'wall_clock', 'mustard');
  }

  // Required tiles that must stay reachable and unblocked when scattering solitary liminal props
  const reservedPropTiles = new Set<string>([
    ...blockedFloorTiles,
    ...bathTileSet,
    ...coffeeApproachSet,
    tileKey(7, 4),
    tileKey(8, 4),
    tileKey(7, 5),
    tileKey(8, 5),
    tileKey(bathDoorOutside[0], bathDoorOutside[1]),
  ]);

  const requiredReachableKeys = [
    tileKey(8, 4),
    tileKey(bathDoorOutside[0], bathDoorOutside[1]),
    tileKey(bathCorner.bathEntry.x, bathCorner.bathEntry.z),
    tileKey(bathCorner.bathMat.x, bathCorner.bathMat.z),
    ...coffeeCorner.coffeeApproach.map(([x, z]) => tileKey(x, z)),
  ];

  const isEdgeBlocked = (x: number, z: number, rot: RotationQuarter): boolean => {
    const [dx, dz] = stepDelta[rot];
    const nx = x + dx;
    const nz = z + dz;
    if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) return true;
    return solidWallEdges.has(canonicalWallEdgeKey(x, z, rot));
  };

  const openTiles: Array<{ x: number; z: number; adjacentWalls: RotationQuarter[] }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      if (reservedPropTiles.has(tileKey(x, z))) continue;
      const adjacentWalls = ([0, 1, 2, 3] as RotationQuarter[]).filter((rot) =>
        isEdgeBlocked(x, z, rot),
      );
      openTiles.push({ x, z, adjacentWalls });
    }
  }

  const pickSafePropTile = (
    preferDeadEnd: boolean,
  ): { x: number; z: number; adjacentWalls: RotationQuarter[] } | null => {
    const ordered = shuffle(openTiles).sort((a, bTile) =>
      preferDeadEnd ? bTile.adjacentWalls.length - a.adjacentWalls.length : 0,
    );
    for (const cand of ordered) {
      const k = tileKey(cand.x, cand.z);
      if (blockedFloorTiles.has(k) || reservedPropTiles.has(k)) continue;
      const testReach = computeReachable(new Set([k]));
      if (requiredReachableKeys.every((req) => testReach.has(req))) {
        blockedFloorTiles.add(k);
        reservedPropTiles.add(k);
        return cand;
      }
    }
    return null;
  };

  // Scatter solitary eerie liminal furniture in dead-ends & alcoves
  const chairSpot = pickSafePropTile(true);
  if (chairSpot) {
    // Awkwardly face a nearby wall/corner
    const wallRot = chairSpot.adjacentWalls[0] ?? (randInt(0, 3) as RotationQuarter);
    const faceWallRot = (((wallRot + 2) % 4) as RotationQuarter);
    b.place('chair_office', chairSpot.x, chairSpot.z, faceWallRot, 'oat');
  }

  const lampSpot = pickSafePropTile(true);
  if (lampSpot) {
    b.place('lamp_floor_arc', lampSpot.x, lampSpot.z, randInt(0, 3) as RotationQuarter, 'brass', true);
  }

  const armchairSpot = pickSafePropTile(false);
  if (armchairSpot) {
    b.place('armchair_plush', armchairSpot.x, armchairSpot.z, randInt(0, 3) as RotationQuarter, 'ochre');
  }

  // Optional damp oat runner along a random open 3-tile corridor outside the bathroom
  const runnerCandidates: Array<{ x: number; z: number; rot: RotationQuarter }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ - 2; z++) {
      if (
        !bathTileSet.has(tileKey(x, z)) &&
        !bathTileSet.has(tileKey(x, z + 1)) &&
        !bathTileSet.has(tileKey(x, z + 2)) &&
        !solidWallEdges.has(canonicalWallEdgeKey(x, z, 2)) &&
        !solidWallEdges.has(canonicalWallEdgeKey(x, z + 1, 2))
      ) {
        runnerCandidates.push({ x, z, rot: 0 });
      }
    }
  }
  if (runnerCandidates.length > 0) {
    const runner = runnerCandidates[Math.floor(Math.random() * runnerCandidates.length)];
    b.place('rug_runner', runner.x, runner.z, runner.rot, 'oat');
  }

  // Irregular overhead pale fluorescent-style pendant lamps
  const ceilingUsed = new Set<string>();
  const addCeilingLight = (x: number, z: number) => {
    const k = tileKey(x, z);
    if (ceilingUsed.has(k)) return;
    ceilingUsed.add(k);
    b.placeCeiling('lamp_pendant', x, z, 0, 'rice', true);
  };
  addCeilingLight(bathCorner.bathEntry.x, bathCorner.bathEntry.z);
  addCeilingLight(coffeeCorner.coffeeApproach[0][0], coffeeCorner.coffeeApproach[0][1]);
  const lightCells = shuffle(
    Array.from({ length: (maxX - minX + 1) * (maxZ - minZ + 1) }, (_, idx) => {
      const w = maxX - minX + 1;
      return [minX + (idx % w), minZ + Math.floor(idx / w)] as [number, number];
    }),
  );
  let extraLights = randInt(4, 6);
  for (const [lx, lz] of lightCells) {
    if (extraLights <= 0) break;
    // Keep a pleasant irregular spacing (>= 2 tiles apart)
    let tooClose = false;
    for (const used of ceilingUsed) {
      const [ux, uz] = used.split(',').map(Number);
      if (Math.hypot(ux - lx, uz - lz) < 2.2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      addCeilingLight(lx, lz);
      extraLights -= 1;
    }
  }

  return b.buildState(preset, [
    makePresetStaff('staff_backrooms_barista', 'barista', espressoUid, 0),
  ]);
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
    case 'backrooms_level0':
      return buildBackroomsPreset(preset, data);
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
