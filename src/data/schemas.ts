export type CatalogTabId =
  | 'basics'
  | 'living'
  | 'kitchen'
  | 'cafe_bar'
  | 'party'
  | 'decor'
  | 'pets';

export type PlacementLayer = 'floor' | 'wall' | 'ceiling' | 'surface';

export type FloorSubLayer = 'tile' | 'rug' | 'object';

export type WallKind = 'structure' | 'mounted';

/** Quarter-turn clockwise rotation: 0 = 0°, 1 = 90°, 2 = 180°, 3 = 270°. */
export type RotationQuarter = 0 | 1 | 2 | 3;

export type TimeOfDay = 'morning' | 'day' | 'sunset' | 'night';

export const DEFAULT_TIME_HOUR = 11.5;

export function timeHourToBucket(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5.5 && h < 9.5) return 'morning';
  if (h >= 9.5 && h < 17) return 'day';
  if (h >= 17 && h < 20.2) return 'sunset';
  return 'night';
}

export function timeOfDayToDefaultHour(tod: TimeOfDay): number {
  switch (tod) {
    case 'morning':
      return 7.5;
    case 'day':
      return 12.0;
    case 'sunset':
      return 18.6;
    case 'night':
      return 22.5;
  }
}

export interface CatalogTab {
  id: CatalogTabId;
  label: string;
  color: string;
}

export interface FurnitureVariant {
  id: string;
  label: string;
  color: string;
  accentColor?: string;
}

export interface FurnitureInteraction {
  type: 'toggle' | 'spin' | 'bounce' | 'custom';
  label: string;
}

export interface FurnitureItemDef {
  id: string;
  name: string;
  tab: CatalogTabId;
  tags: string[];
  /** Grid tile footprint [widthX, depthZ] at rotation 0. */
  footprint: [number, number];
  /** Visual height in world units (1 unit = 1 grid tile). */
  height: number;
  layer: PlacementLayer;
  /** For `floor` items: allows tiles under rugs and rugs under furniture. */
  subLayer?: FloorSubLayer;
  /** For `wall` items: `structure` defines walls/doors/windows on edges; `mounted` hangs on walls. */
  wallKind?: WallKind;
  /** For `wallKind: 'mounted'`, vertical offset from floor in world units. */
  mountHeight?: number;
  /** If set, `surface` layer items may stack on top at this world Y offset. */
  surfaceHeight?: number;
  interaction?: FurnitureInteraction;
  variants: FurnitureVariant[];
  /** Relative path to compressed glTF/GLB asset swapped in during Phase 3. */
  model: string;
}

export interface FurnitureCatalogData {
  schemaVersion: number;
  tabs: CatalogTab[];
  items: FurnitureItemDef[];
}

export interface VoiceProfile {
  basePitch: number;
  pitchVariance: number;
  syllableRate: number;
  waveform: 'sine' | 'triangle' | 'square' | 'sawtooth';
}

export interface VisitorPersonaDef {
  name: string;
  pronouns: string;
  trait: string;
}

export interface VisitorDef {
  id: string;
  name: string;
  description: string;
  color: string;
  model: string;
  archetypeIcon?: string;
  personas?: VisitorPersonaDef[];
  likedTags: string[];
  dislikedTags: string[];
  preferredInteractions: string[];
  walkSpeed: number;
  patienceSeconds: number;
  voiceProfile: VoiceProfile;
}

export interface VisitorsData {
  schemaVersion: number;
  visitors: VisitorDef[];
}

export type VisitorMood = 'delighted' | 'happy' | 'neutral' | 'bored' | 'leaving';

export interface DialogueLine {
  id: string;
  text: string;
  emote: string;
  pitchOffset: number;
  speedMultiplier: number;
}

export type MoodDialogueMap = Partial<Record<VisitorMood, DialogueLine[]>>;

export interface DialogueData {
  schemaVersion: number;
  moods: VisitorMood[];
  scriptNotes?: string;
  default: Record<VisitorMood, DialogueLine[]>;
  byVisitor: Record<string, MoodDialogueMap>;
}

export interface RoomLabelInfo {
  id: string;
  label: string;
  description: string;
  accentColor: string;
}

export interface RoomRuleDef extends RoomLabelInfo {
  priority: number;
  requiredTags: Record<string, number>;
  excludedTags?: string[];
}

export interface RoomRulesData {
  schemaVersion: number;
  defaultLabel: RoomLabelInfo;
  rules: RoomRuleDef[];
}

export interface SceneryViewDef {
  id: string;
  name: string;
  description: string;
  skyTop: string;
  skyHorizon: string;
  groundColor: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
}

export type WeatherParticleType = 'none' | 'rain' | 'snow';

export interface WeatherDef {
  id: string;
  name: string;
  skyTint: string;
  lightMultiplier: number;
  fogDensity: number;
  particleType: WeatherParticleType;
  particleRate: number;
  windStrength: number;
  ambientSound: string;
  lightning: boolean;
}

export interface SceneryData {
  schemaVersion: number;
  defaultViewId: string;
  defaultWeatherId: string;
  views: SceneryViewDef[];
  weathers: WeatherDef[];
}

/** Combined game data loaded from the five contract files in `data/`. */
export interface GameDataBundle {
  furniture: FurnitureCatalogData;
  visitors: VisitorsData;
  dialogue: DialogueData;
  roomRules: RoomRulesData;
  scenery: SceneryData;
  itemsById: Map<string, FurnitureItemDef>;
  tabsById: Map<CatalogTabId, CatalogTab>;
  visitorsById: Map<string, VisitorDef>;
  viewsById: Map<string, SceneryViewDef>;
  weathersById: Map<string, WeatherDef>;
}

/** Runtime representation of one placed item in the house. */
export interface PlacedItem {
  /** Unique instance ID in the current session. */
  uid: string;
  /** Catalog item ID from `data/furniture.json`. */
  itemId: string;
  /** Grid X coordinate (integer tile index for floor/ceiling/wall, or fractional on surface). */
  x: number;
  /** World elevation Y (0 for floor/wall structure, surfaceHeight for surface, ceilingY for ceiling). */
  y: number;
  /** Grid Z coordinate. */
  z: number;
  /** Clockwise quarter-turn rotation (0..3). For walls: 0=North, 1=East, 2=South, 3=West edge. */
  rotation: RotationQuarter;
  /** Variant ID from the catalog item's `variants` array. */
  variantId: string;
  /** For `surface` or wall-mounted items: UID of the supporting furniture/wall item, if any. */
  parentUid?: string;
  /** Per-item interactive state (e.g. lamp on/off, door open, disco spinning). */
  active?: boolean;
}

export interface HouseState {
  gridWidth: number;
  gridDepth: number;
  sceneryViewId: string;
  weatherId: string;
  timeOfDay?: TimeOfDay;
  timeHour?: number;
  roomTypeOverride: string | null;
  items: PlacedItem[];
}
