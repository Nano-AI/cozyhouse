import type {
  CatalogTab,
  CatalogTabId,
  DialogueData,
  FurnitureCatalogData,
  FurnitureItemDef,
  GameDataBundle,
  RoomRulesData,
  SceneryData,
  SceneryViewDef,
  VisitorDef,
  VisitorsData,
  WeatherDef,
} from './schemas';

async function fetchJson<T>(relativePath: string): Promise<T> {
  const res = await fetch(relativePath, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load ${relativePath} (${res.status} ${res.statusText})`);
  }
  return (await res.json()) as T;
}

function assertNonEmptyArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid data schema: ${label} must be a non-empty array.`);
  }
}

export function validateBundle(
  furniture: FurnitureCatalogData,
  visitors: VisitorsData,
  dialogue: DialogueData,
  roomRules: RoomRulesData,
  scenery: SceneryData,
): GameDataBundle {
  assertNonEmptyArray(furniture.tabs, 'furniture.tabs');
  assertNonEmptyArray(furniture.items, 'furniture.items');
  assertNonEmptyArray(visitors.visitors, 'visitors.visitors');
  assertNonEmptyArray(dialogue.moods, 'dialogue.moods');
  assertNonEmptyArray(roomRules.rules, 'roomRules.rules');
  assertNonEmptyArray(scenery.views, 'scenery.views');
  assertNonEmptyArray(scenery.weathers, 'scenery.weathers');

  const tabsById = new Map<CatalogTabId, CatalogTab>();
  for (const tab of furniture.tabs) {
    tabsById.set(tab.id, tab);
  }

  const itemsById = new Map<string, FurnitureItemDef>();
  for (const item of furniture.items) {
    if (!tabsById.has(item.tab)) {
      throw new Error(`Furniture item "${item.id}" references unknown tab "${item.tab}".`);
    }
    if (!item.variants || item.variants.length === 0) {
      throw new Error(`Furniture item "${item.id}" must define at least one variant.`);
    }
    if (itemsById.has(item.id)) {
      throw new Error(`Duplicate furniture item id "${item.id}".`);
    }
    itemsById.set(item.id, item);
  }

  const visitorsById = new Map<string, VisitorDef>();
  for (const v of visitors.visitors) {
    visitorsById.set(v.id, v);
  }

  const viewsById = new Map<string, SceneryViewDef>();
  for (const view of scenery.views) {
    viewsById.set(view.id, view);
  }

  const weathersById = new Map<string, WeatherDef>();
  for (const weather of scenery.weathers) {
    weathersById.set(weather.id, weather);
  }

  return {
    furniture,
    visitors,
    dialogue,
    roomRules,
    scenery,
    itemsById,
    tabsById,
    visitorsById,
    viewsById,
    weathersById,
  };
}

export async function loadGameData(baseUrl = './data'): Promise<GameDataBundle> {
  const [furniture, visitors, dialogue, roomRules, scenery] = await Promise.all([
    fetchJson<FurnitureCatalogData>(`${baseUrl}/furniture.json`),
    fetchJson<VisitorsData>(`${baseUrl}/visitors.json`),
    fetchJson<DialogueData>(`${baseUrl}/dialogue.json`),
    fetchJson<RoomRulesData>(`${baseUrl}/room-rules.json`),
    fetchJson<SceneryData>(`${baseUrl}/scenery.json`),
  ]);

  return validateBundle(furniture, visitors, dialogue, roomRules, scenery);
}
