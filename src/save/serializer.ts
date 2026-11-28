import {
  DEFAULT_TIME_HOUR,
  timeHourToBucket,
  timeOfDayToDefaultHour,
  type GameDataBundle,
  type HiredStaff,
  type HouseState,
  type PlacedItem,
  type RotationQuarter,
  type StaffKind,
  type StaffRole,
  type TimeOfDay,
} from '../data/schemas';
import {
  MAX_STAFF,
  STAFF_ROLE_ACCENTS,
  generateItemUid,
  generateStaffId,
} from '../state/houseStore';

export const SAVE_FORMAT_VERSION = 1;
export const MIN_SERIALIZED_GRID_SIZE = 8;
export const MAX_SERIALIZED_GRID_SIZE = 36;
export const MAX_ITEMS = 2000;

/**
 * Compact tuple encoding for one placed item:
 * [itemId, x, y, z, rotation, variantId, parentIndex?, active?, wallStyleItemId?, wallStyleVariantId?]
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
  wallStyleItemId?: string,
  wallStyleVariantId?: string,
];

/**
 * Compact tuple encoding for one hired staff member:
 * [id, role, kind, name, assignedItemRef?, accentColor?, homeX?, homeZ?]
 * `assignedItemRef` encodes the assigned station's item index (or fallback UID string).
 */
export type SerializedStaffTuple = [
  id: string,
  role: StaffRole,
  kind: StaffKind,
  name: string,
  assignedItem?: number | string,
  accentColor?: string,
  homeX?: number,
  homeZ?: number,
];

export interface SerializedHouseV1 {
  v: 1;
  g: [number, number];
  s: string;
  w: string;
  t?: TimeOfDay;
  th?: number;
  o?: string | null;
  i: SerializedItemTuple[];
  sf?: SerializedStaffTuple[];
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
    const hasWallStyle = Boolean(item.wallStyleItemId);

    const tuple: SerializedItemTuple = [
      item.itemId,
      roundCoord(item.x),
      roundCoord(item.y),
      roundCoord(item.z),
      item.rotation,
      item.variantId,
    ];

    if (parentIdx >= 0 || hasActive || hasWallStyle) {
      tuple.push(parentIdx);
    }
    if (hasActive || hasWallStyle) {
      tuple.push(hasActive ? 1 : 0);
    }
    if (hasWallStyle) {
      tuple.push(item.wallStyleItemId!);
      if (item.wallStyleVariantId) {
        tuple.push(item.wallStyleVariantId);
      }
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

  if (state.timeOfDay && state.timeOfDay !== 'day') {
    payload.t = state.timeOfDay;
  }

  if (state.timeHour !== undefined && Number.isFinite(state.timeHour)) {
    const roundedHour = Math.round(Math.max(0, Math.min(24, state.timeHour)) * 100) / 100;
    if (Math.abs(roundedHour - DEFAULT_TIME_HOUR) > 0.005 || payload.t !== undefined) {
      payload.th = roundedHour;
    }
  }

  if (state.roomTypeOverride) {
    payload.o = state.roomTypeOverride;
  }

  if (state.staff && state.staff.length > 0) {
    payload.sf = state.staff.slice(0, MAX_STAFF).map((member) => {
      const tuple: SerializedStaffTuple = [member.id, member.role, member.kind, member.name];
      const assignedRef =
        member.assignedItemUid !== undefined
          ? (uidToIndex.get(member.assignedItemUid) ?? member.assignedItemUid)
          : undefined;
      const customAccent =
        member.accentColor && member.accentColor !== STAFF_ROLE_ACCENTS[member.role]
          ? member.accentColor
          : undefined;
      const hasHome =
        typeof member.homeX === 'number' &&
        typeof member.homeZ === 'number' &&
        Number.isInteger(member.homeX) &&
        Number.isInteger(member.homeZ);

      if (assignedRef !== undefined || customAccent !== undefined || hasHome) {
        tuple.push(assignedRef ?? '');
      }
      if (customAccent !== undefined || hasHome) {
        tuple.push(customAccent ?? '');
      }
      if (hasHome) {
        tuple.push(member.homeX!, member.homeZ!);
      }
      return tuple;
    });
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
    typeof gridRaw[0] === 'number' && Number.isFinite(gridRaw[0])
      ? Math.max(MIN_SERIALIZED_GRID_SIZE, Math.min(MAX_SERIALIZED_GRID_SIZE, Math.round(gridRaw[0])))
      : 12;
  const gridDepth =
    typeof gridRaw[1] === 'number' && Number.isFinite(gridRaw[1])
      ? Math.max(MIN_SERIALIZED_GRID_SIZE, Math.min(MAX_SERIALIZED_GRID_SIZE, Math.round(gridRaw[1])))
      : 12;

  const sceneryViewId =
    typeof obj.s === 'string' && data.viewsById.has(obj.s)
      ? obj.s
      : data.scenery.defaultViewId;

  const weatherId =
    typeof obj.w === 'string' && data.weathersById.has(obj.w)
      ? obj.w
      : data.scenery.defaultWeatherId;

  const rawTod: TimeOfDay | null =
    obj.t === 'morning' || obj.t === 'day' || obj.t === 'sunset' || obj.t === 'night'
      ? obj.t
      : null;

  let timeHour: number;
  let timeOfDay: TimeOfDay;
  if (typeof obj.th === 'number' && Number.isFinite(obj.th)) {
    timeHour = Math.round(Math.max(0, Math.min(24, obj.th)) * 100) / 100;
    timeOfDay = timeHourToBucket(timeHour);
  } else if (rawTod) {
    timeOfDay = rawTod;
    timeHour = timeOfDayToDefaultHour(rawTod);
  } else {
    timeOfDay = 'day';
    timeHour = DEFAULT_TIME_HOUR;
  }

  const roomTypeOverride = typeof obj.o === 'string' && obj.o.trim() ? obj.o.trim() : null;

  if (!Array.isArray(obj.i)) {
    throw new Error('Invalid house file: missing items array.');
  }

  // First pass: assign UIDs by original tuple index so parent indices resolve cleanly
  const indexToUid = new Map<number, string>();
  const pendingItems: Array<{ index: number; item: PlacedItem; parentIndex: number }> = [];

  if (obj.i.length > MAX_ITEMS) {
    warnings.push(`Truncated house items to maximum limit of ${MAX_ITEMS}.`);
  }
  const itemLimit = Math.min(obj.i.length, MAX_ITEMS);

  for (let index = 0; index < itemLimit; index++) {
    const entry = obj.i[index];
    if (!Array.isArray(entry) || entry.length < 6) {
      warnings.push(`Skipped malformed item at index ${index}.`);
      continue;
    }

    const [
      itemId,
      x,
      y,
      z,
      rot,
      variantId,
      parentIndex,
      activeFlag,
      rawWallStyleItemId,
      rawWallStyleVariantId,
    ] = entry;
    if (typeof itemId !== 'string') {
      warnings.push(`Skipped item at index ${index} with invalid id.`);
      continue;
    }

    const def = data.itemsById.get(itemId);
    if (!def) {
      warnings.push(`Skipped unknown catalog item "${itemId}".`);
      continue;
    }

    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      !Number.isFinite(y) ||
      y < 0 ||
      x < 0 ||
      x >= gridWidth ||
      z < 0 ||
      z >= gridDepth
    ) {
      warnings.push(`Skipped "${itemId}" with invalid or out-of-bounds coordinates.`);
      continue;
    }

    const resolvedVariant =
      typeof variantId === 'string' && def.variants.some((v) => v.id === variantId)
        ? variantId
        : def.variants[0].id;

    let wallStyleItemId: string | undefined;
    let wallStyleVariantId: string | undefined;
    if (typeof rawWallStyleItemId === 'string' && rawWallStyleItemId.trim()) {
      const wallDef = data.itemsById.get(rawWallStyleItemId);
      if (wallDef) {
        wallStyleItemId = wallDef.id;
        wallStyleVariantId =
          typeof rawWallStyleVariantId === 'string' &&
          wallDef.variants.some((v) => v.id === rawWallStyleVariantId)
            ? rawWallStyleVariantId
            : wallDef.variants[0]?.id;
      }
    }

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
        ...(wallStyleItemId ? { wallStyleItemId } : {}),
        ...(wallStyleVariantId ? { wallStyleVariantId } : {}),
      },
    });
  }

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

  // Optional hired staff (`sf`): backwards-compatible when absent
  const staff: HiredStaff[] = [];
  if (Array.isArray(obj.sf)) {
    const seenStaffIds = new Set<string>();
    for (let idx = 0; idx < obj.sf.length && staff.length < MAX_STAFF; idx++) {
      const entry = obj.sf[idx];
      if (!Array.isArray(entry) || entry.length < 4) {
        warnings.push(`Skipped malformed staff entry at index ${idx}.`);
        continue;
      }
      const [rawId, rawRole, rawKind, rawName, rawAssigned, rawAccent, rawHomeX, rawHomeZ] = entry;
      if (
        rawRole !== 'barista' &&
        rawRole !== 'dj' &&
        rawRole !== 'chef' &&
        rawRole !== 'bartender'
      ) {
        warnings.push(`Skipped staff entry with invalid role "${String(rawRole)}".`);
        continue;
      }
      if (rawKind !== 'bot' && rawKind !== 'human') {
        warnings.push(`Skipped staff entry with invalid kind "${String(rawKind)}".`);
        continue;
      }

      const role: StaffRole = rawRole;
      const kind: StaffKind = rawKind;

      const id =
        typeof rawId === 'string' && rawId.trim() && !seenStaffIds.has(rawId.trim())
          ? rawId.trim()
          : generateStaffId();
      seenStaffIds.add(id);

      const name =
        typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 32) : 'Cozy Staff';

      let assignedItemUid: string | undefined;
      if (typeof rawAssigned === 'number' && Number.isInteger(rawAssigned) && rawAssigned >= 0) {
        assignedItemUid = indexToUid.get(rawAssigned);
      } else if (typeof rawAssigned === 'string' && rawAssigned.trim()) {
        assignedItemUid = rawAssigned.trim();
      }

      const accentColor =
        typeof rawAccent === 'string' && rawAccent.trim()
          ? rawAccent.trim()
          : STAFF_ROLE_ACCENTS[role];

      const hasValidHome =
        typeof rawHomeX === 'number' &&
        typeof rawHomeZ === 'number' &&
        Number.isInteger(rawHomeX) &&
        Number.isInteger(rawHomeZ) &&
        rawHomeX >= 0 &&
        rawHomeX < gridWidth &&
        rawHomeZ >= 0 &&
        rawHomeZ < gridDepth;

      staff.push({
        id,
        role,
        kind,
        name,
        accentColor,
        ...(assignedItemUid ? { assignedItemUid } : {}),
        ...(hasValidHome ? { homeX: rawHomeX, homeZ: rawHomeZ } : {}),
      });
    }
  }

  return {
    state: {
      gridWidth,
      gridDepth,
      sceneryViewId,
      weatherId,
      timeOfDay,
      timeHour,
      roomTypeOverride,
      items,
      staff,
    },
    warnings,
  };
}
