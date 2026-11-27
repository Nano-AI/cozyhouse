import type {
  GameDataBundle,
  HouseState,
  PlacedItem,
  RotationQuarter,
} from '../data/schemas';
import { generateItemUid } from '../state/houseStore';

export const SAVE_FORMAT_VERSION = 1;

/**
 * Compact tuple encoding for one placed item:
 * [itemId, x, y, z, rotation, variantId, parentIndex?, active?]
 * Designed to stay tiny so a full house can later be compressed into a share URL.
 */
export type SerializedItemTuple = [
  itemId: string,
  x: number,
  y: number,
  z: number,
  rotation: RotationQuarter,
  variantId: string,
  parentIndex?: number,
  active?: 0 | 1,
];

export interface SerializedHouseV1 {
  v: 1;
  g: [number, number];
  s: string;
  w: string;
  o?: string | null;
  i: SerializedItemTuple[];
}

export interface DeserializeResult {
  state: HouseState;
  warnings: string[];
}

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function serializeHouse(state: HouseState): SerializedHouseV1 {
  const uidToIndex = new Map<string, number>();
  state.items.forEach((item, idx) => {
    uidToIndex.set(item.uid, idx);
  });

  const tuples: SerializedItemTuple[] = state.items.map((item) => {
    const parentIdx =
      item.parentUid !== undefined ? (uidToIndex.get(item.parentUid) ?? -1) : -1;
    const hasActive = item.active === true;

    const tuple: SerializedItemTuple = [
      item.itemId,
      roundCoord(item.x),
      roundCoord(item.y),
      roundCoord(item.z),
      item.rotation,
      item.variantId,
    ];

    if (parentIdx >= 0 || hasActive) {
      tuple.push(parentIdx);
    }
    if (hasActive) {
      tuple.push(1);
    }
    return tuple;
  });

  const payload: SerializedHouseV1 = {
    v: SAVE_FORMAT_VERSION,
    g: [state.gridWidth, state.gridDepth],
    s: state.sceneryViewId,
    w: state.weatherId,
    i: tuples,
  };

  if (state.roomTypeOverride) {
    payload.o = state.roomTypeOverride;
  }

  return payload;
}

export function serializeHouseToJson(state: HouseState): string {
  return JSON.stringify(serializeHouse(state));
}

function normalizeRotation(rot: unknown): RotationQuarter {
  if (typeof rot !== 'number' || !Number.isFinite(rot)) return 0;
  return ((((Math.round(rot) % 4) + 4) % 4) as RotationQuarter);
}

export function deserializeHouse(raw: unknown, data: GameDataBundle): DeserializeResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid house file: expected a JSON object.');
  }

  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new Error(`Unsupported house file version: ${String(obj.v)}`);
  }

  const warnings: string[] = [];

  const gridRaw = Array.isArray(obj.g) ? obj.g : [12, 12];
  const gridWidth =
    typeof gridRaw[0] === 'number' && gridRaw[0] >= 4 && gridRaw[0] <= 48
      ? Math.round(gridRaw[0])
      : 12;
  const gridDepth =
    typeof gridRaw[1] === 'number' && gridRaw[1] >= 4 && gridRaw[1] <= 48
      ? Math.round(gridRaw[1])
      : 12;

  const sceneryViewId =
    typeof obj.s === 'string' && data.viewsById.has(obj.s)
      ? obj.s
      : data.scenery.defaultViewId;

  const weatherId =
    typeof obj.w === 'string' && data.weathersById.has(obj.w)
      ? obj.w
      : data.scenery.defaultWeatherId;

  const roomTypeOverride = typeof obj.o === 'string' && obj.o.trim() ? obj.o.trim() : null;

  if (!Array.isArray(obj.i)) {
    throw new Error('Invalid house file: missing items array.');
  }

  // First pass: assign UIDs by original tuple index so parent indices resolve cleanly
  const indexToUid = new Map<number, string>();
  const pendingItems: Array<{ index: number; item: PlacedItem; parentIndex: number }> = [];

  obj.i.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 6) {
      warnings.push(`Skipped malformed item at index ${index}.`);
      return;
    }

    const [itemId, x, y, z, rot, variantId, parentIndex, activeFlag] = entry;
    if (typeof itemId !== 'string') {
      warnings.push(`Skipped item at index ${index} with invalid id.`);
      return;
    }

    const def = data.itemsById.get(itemId);
    if (!def) {
      warnings.push(`Skipped unknown catalog item "${itemId}".`);
      return;
    }

    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      warnings.push(`Skipped "${itemId}" with invalid coordinates.`);
      return;
    }

    const resolvedVariant =
      typeof variantId === 'string' && def.variants.some((v) => v.id === variantId)
        ? variantId
        : def.variants[0].id;

    const uid = generateItemUid();
    indexToUid.set(index, uid);

    pendingItems.push({
      index,
      parentIndex: typeof parentIndex === 'number' ? parentIndex : -1,
      item: {
        uid,
        itemId,
        x,
        y,
        z,
        rotation: normalizeRotation(rot),
        variantId: resolvedVariant,
        active: activeFlag === 1 ? true : undefined,
      },
    });
  });

  // Second pass: resolve parentUid links
  const items: PlacedItem[] = pendingItems.map(({ item, parentIndex }) => {
    if (parentIndex >= 0) {
      const parentUid = indexToUid.get(parentIndex);
      if (parentUid) {
        item.parentUid = parentUid;
      }
    }
    return item;
  });

  return {
    state: {
      gridWidth,
      gridDepth,
      sceneryViewId,
      weatherId,
      roomTypeOverride,
      items,
    },
    warnings,
  };
}
