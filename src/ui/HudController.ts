import * as THREE from 'three';
import { MUSIC_THEME_LABELS, type AudioModule } from '../audio/AudioModule';
import type {
  CatalogTabId,
  FurnitureItemDef,
  PlacedItem,
  StaffKind,
  StaffRole,
  VisitorDef,
} from '../data/schemas';
import { getEffectiveFootprint } from '../engine/GridSystem';
import type { HoverItemInfo, PlacementController } from '../engine/PlacementController';
import { buildLastGuestDevCard, buildPeacefulModeRow } from '../events/HorrorDirector'; // [horror-events hook]
import type { SceneManager, VisualShaderId } from '../engine/SceneManager';
import { evaluateRoomType } from '../rooms/RoomEvaluator';
import { exportHouseToFile, importHouseFromFile } from '../save/fileIO';
import { decodeHouseFromShareLink, encodeHouseToShareUrl } from '../save/shareLink';
import type { SceneryModule } from '../scenery/SceneryModule';
import { createEmptyHouse, createStarterHouse } from '../state/defaultHouse';
import { HOUSE_PRESETS, createPresetHouse } from '../state/housePresets';
import { createNewHouse } from '../state/newHouse';
import type {
  EraseFilter,
  ExpandSide,
  GuestLogEntry,
  HouseStore,
  SimSpeed,
  WallViewMode,
} from '../state/houseStore';
import type { ActiveVisitorSnapshot, VisitorModule } from '../visitors/VisitorModule';
import { CelebrationBanner } from './CelebrationBanner';
import { PolaroidShareModal } from './PolaroidShareModal';
import {
  type IconName,
  type StorybookIconName,
  createIconEl,
  createStorybookIconEl,
  getLocationStorybookIconName,
  getRoomStorybookIconName,
  getShaderStorybookIconName,
  getWallViewStorybookIconName,
  getWeatherStorybookIconName,
} from './icons';

export interface HudModules {
  visitorModule?: VisitorModule;
  audioModule?: AudioModule;
  sceneryModule?: SceneryModule;
}

type SpecialVisitorDef = VisitorDef & { special?: boolean };
type CaptionPayload = { speaker: string; text: string; subtext?: string; accent?: string };
type CinematicFx = 'bars-on' | 'bars-off' | 'flash' | 'flash-purple' | 'shake' | 'shake-hard' | 'sound-locked' | 'sound-ok';
type SpecialVisitorModule = VisitorModule & {
  inviteRandomSpecialCharacter?: () => unknown;
  getRandomSpecialCooldownRemaining?: () => number;
  skipActiveMonologue?: () => void;
  isMonologueActive?: () => boolean;
  devTriggerShowdown?: () => void;
  onCaption?: (listener: (payload: CaptionPayload | null) => void) => () => void;
  onCinematicFx?: (listener: (fx: CinematicFx) => void) => () => void;
};
type StaffPositionStore = HouseStore & {
  setStaffPosition?: (staffId: string, x: number, z: number, assignedItemUid?: string) => boolean;
};

/** Input the game must not see during a cutscene (pointerup/cancel pass, so no drag gets stuck). */
const CINEMA_BLOCKED_EVENTS = ['pointerdown', 'pointermove', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup'] as const;

type HudCameraViewMode = 'isometric' | 'visitor_pov' | 'angel_pov';
interface HudPovPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  seated?: boolean;
  bobPhase?: number;
  speed?: number;
}
interface HudPovCandidate {
  id: string;
  name: string;
  kind: 'visitor' | 'staff';
  icon: string;
  color: string;
  isSpecial?: boolean;
  visitorId?: string;
  variantIndex?: number;
}
type PovSceneManager = SceneManager & {
  getCameraViewMode?: () => HudCameraViewMode;
  getPovTargetId?: () => string | null;
  enterVisitorPov?: (
    targetId: string,
    poseProvider: () => HudPovPose | null,
    onExit?: () => void,
  ) => void;
  enterAngelPov?: () => void;
  exitPovMode?: () => void;
  onCameraViewModeChange?: (
    cb: (mode: HudCameraViewMode, targetId: string | null) => void,
  ) => () => void;
};
type PovVisitorModule = VisitorModule & {
  getPovPoseForPerson?: (id: string) => HudPovPose | null;
  setPovHiddenPerson?: (id: string | null) => void;
  getPovCandidates?: () => HudPovCandidate[];
};

type PopoverKind =
  | 'room'
  | 'atmosphere'
  | 'walls'
  | 'view'
  | 'visitors'
  | 'help'
  | 'menu'
  | 'cheats'
  | 'lot'
  | null;
type BasicsGroupId = 'floors' | 'walls' | 'doors' | 'windows';

interface SubcategoryDef {
  id: string;
  label: string;
  match: (item: FurnitureItemDef) => boolean;
}

const KONAMI_SEQUENCE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const;

const CELEBRATION_REASONS = new Set([
  'place',
  'move',
  'delete',
  'undo',
  'redo',
  'roomOverride',
]);

const ERASE_FILTERS: Array<{ id: EraseFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'floor', label: 'Floors' },
  { id: 'wall', label: 'Walls' },
  { id: 'furniture', label: 'Furniture' },
];

const TIME_STOPS: Array<{
  id: 'running' | 'dawn' | 'day' | 'dusk' | 'night';
  label: string;
  icon: StorybookIconName;
  hour?: number;
}> = [
  { id: 'running', label: 'Running', icon: 'time_running' },
  { id: 'dawn', label: 'Dawn', icon: 'time_dawn', hour: 6.5 },
  { id: 'day', label: 'Day', icon: 'time_day', hour: 12.0 },
  { id: 'dusk', label: 'Dusk', icon: 'time_dusk', hour: 18.5 },
  { id: 'night', label: 'Night', icon: 'time_night', hour: 22.5 },
];

const WEATHER_SLIDER_ORDER: Array<{
  id: string;
  label: string;
  icon: StorybookIconName;
}> = [
  { id: 'clear', label: 'Clear', icon: 'weather_clear' },
  { id: 'rain', label: 'Rain', icon: 'weather_rain' },
  { id: 'fog', label: 'Fog', icon: 'weather_fog' },
  { id: 'thunderstorm', label: 'Thunderstorm', icon: 'weather_thunderstorm' },
  { id: 'snow', label: 'Snow', icon: 'weather_snow' },
];

const SHADER_STYLES: Array<{
  id: VisualShaderId;
  label: string;
  icon: StorybookIconName;
}> = [
  { id: 'default', label: 'Cozy', icon: 'shader_default' },
  { id: 'retro_dither', label: 'Retro Dither', icon: 'shader_retro_dither' },
  { id: 'pocket', label: 'Pocket', icon: 'shader_pocket' },
  { id: 'storybook_ink', label: 'Storybook Ink', icon: 'shader_storybook_ink' },
  { id: 'golden_film', label: 'Golden Film', icon: 'shader_golden_film' },
  { id: 'crt_lofi', label: 'CRT Lo-Fi', icon: 'shader_crt_lofi' },
];

const WALL_VIEW_OPTIONS: Array<{ id: WallViewMode; label: string; fullLabel: string }> = [
  { id: 'auto', label: 'Auto', fullLabel: 'Walls: Auto Translucent' },
  { id: 'translucent', label: 'Translucent', fullLabel: 'Walls: All Translucent' },
  { id: 'solid', label: 'Solid', fullLabel: 'Walls: Solid' },
];

const SIM_SPEED_OPTIONS: Array<{ speed: SimSpeed; label: string; title: string }> = [
  { speed: 0, label: '⏸', title: 'Pause simulation (freeze for photos)' },
  { speed: 1, label: '1×', title: 'Normal speed (1×)' },
  { speed: 2, label: '2×', title: 'Fast speed (2×)' },
  { speed: 5, label: '5×', title: 'Turbo speed (5×)' },
];

const STAFF_ROLES: Array<{
  role: StaffRole;
  label: string;
  emoji: string;
  stations: string[];
}> = [
  {
    role: 'barista',
    label: 'Barista',
    emoji: '☕',
    stations: ['espresso_machine', 'cafe_counter', 'pourover_stand', 'coffee_grinder', 'blender_smoothie'],
  },
  {
    role: 'dj',
    label: 'DJ',
    emoji: '🎧',
    stations: ['dj_booth', 'record_player', 'diner_jukebox', 'karaoke_mic'],
  },
  {
    role: 'chef',
    label: 'Chef',
    emoji: '🍳',
    stations: ['stove_oven', 'kitchen_counter', 'kitchen_island', 'pastry_case'],
  },
  {
    role: 'bartender',
    label: 'Bartender',
    emoji: '🍹',
    stations: ['bar_counter', 'shaker_set', 'cafe_counter'],
  },
];

const VISITOR_ARCHETYPE_ICONS: Record<string, string> = {
  bookworm: '📖',
  coffee_snob: '☕',
  cat_person: '🐾',
  party_goer: '🎧',
  plant_lover: '🌿',
  night_owl: '🌙',
  foodie: '🍳',
  artist: '🎨',
  musician: '🎵',
  homebody: '🛋️',
  viking: '⚔️',
  squeaky_chicken: '🐔',
  gojo: '🤞',
  toji: '🗡️',
  baki: '🥊',
  shakespeare: '🪶',
  philosopher: '🤔',
  john_wick: '🐾',
  rocky: '🕷️',
  homer: '🍩',
  rick: '🌀',
  adi: '👓',
};

const EMOTE_ID_TO_EMOJI: Record<string, string> = {
  sparkles: '✨',
  heart: '💖',
  smile: '😊',
  note: '🎵',
  dots: '💭',
  look: '👀',
  yawn: '🥱',
  wave: '👋',
  book: '📚',
  glasses: '👓',
  coffee: '☕',
  cloud: '☁️',
  paw: '🐾',
  music: '🎶',
  leaf: '🌿',
  moon: '🌙',
  star: '⭐',
  sweat: '💧',
  zzz: '😴',
  thumbsDown: '👎',
  unimpressed: '😒',
  grimace: '😖',
  toilet: '🧻',
  robot: '🤖',
  battery: '🔋',
  bubble: '🫧',
  cocktail: '🍹',
  chat: '💬',
  laugh: '😄',
  sword: '⚔️',
  chicken: '🐔',
  megaphone: '📢',
  fingers: '🤞',
  boxing: '🥊',
  boom: '💥',
  quill: '🪶',
  thinking: '🤔',
  donut: '🍩',
  portal: '🌀',
  skull: '💀',
  fire: '🔥',
  wind: '💨',
  sweatPanic: '😰',
  spider: '🕷️',
  raisedBrow: '🤨',
  beer: '🍺',
};

const MOOD_FALLBACK_EMOJI: Record<string, string> = {
  delighted: '✨',
  happy: '😊',
  neutral: '💭',
  bored: '🥱',
  leaving: '👋',
};

const BASICS_GROUPS: Array<{ id: BasicsGroupId; label: string }> = [
  { id: 'floors', label: 'Floors' },
  { id: 'walls', label: 'Walls' },
  { id: 'doors', label: 'Doors' },
  { id: 'windows', label: 'Windows' },
];

const TAB_SHORT_LABELS: Record<CatalogTabId, string> = {
  basics: 'Basics',
  living: 'Living',
  kitchen: 'Kitchen',
  cafe_bar: 'Café',
  party: 'Party',
  decor: 'Decor',
  pets: 'Pets',
};

const TAB_SUBCATEGORIES: Record<Exclude<CatalogTabId, 'basics'>, SubcategoryDef[]> = {
  living: [
    { id: 'all', label: 'All', match: () => true },
    { id: 'beds', label: 'Beds', match: (i) => i.tags.includes('sleep') || i.id.startsWith('bed_') },
    {
      id: 'seating',
      label: 'Seating',
      match: (i) =>
        i.tags.includes('seating') && !i.tags.includes('sleep') && !i.tags.includes('work'),
    },
    { id: 'desks', label: 'Desks', match: (i) => i.tags.includes('work') || i.id.includes('desk') },
    {
      id: 'storage',
      label: 'Storage',
      match: (i) => i.tags.includes('storage') || i.tags.includes('media'),
    },
    {
      id: 'tables',
      label: 'Tables & Rugs',
      match: (i) => i.id.includes('table') || i.id.includes('rug') || i.subLayer === 'rug',
    },
    { id: 'bath', label: 'Bath', match: (i) => i.tags.includes('bathroom') },
  ],
  kitchen: [
    { id: 'all', label: 'All', match: () => true },
    {
      id: 'counters',
      label: 'Counters',
      match: (i) =>
        i.id.includes('counter') ||
        i.id.includes('island') ||
        i.id.includes('sink') ||
        i.id.includes('pantry'),
    },
    {
      id: 'appliances',
      label: 'Appliances',
      match: (i) =>
        i.id.includes('fridge') ||
        i.id.includes('stove') ||
        i.id.includes('microwave') ||
        i.id.includes('dishwasher'),
    },
    { id: 'dining', label: 'Dining', match: (i) => i.id.includes('dining_') },
    {
      id: 'smallware',
      label: 'Smallware',
      match: (i) =>
        i.id.includes('spice') ||
        i.id.includes('kettle') ||
        i.id.includes('toaster') ||
        i.id.includes('fruit'),
    },
  ],
  cafe_bar: [
    { id: 'all', label: 'All', match: () => true },
    {
      id: 'counters',
      label: 'Counters',
      match: (i) =>
        i.id.includes('counter') || i.id.includes('station') || i.id.includes('pastry_case'),
    },
    {
      id: 'machines',
      label: 'Machines',
      match: (i) =>
        i.id.includes('espresso') ||
        i.id.includes('blender') ||
        i.id.includes('grinder') ||
        i.id.includes('pourover'),
    },
    {
      id: 'seating',
      label: 'Seating',
      match: (i) =>
        i.id.includes('stool') || i.id.includes('bistro') || i.id.includes('booth'),
    },
    {
      id: 'signage',
      label: 'Signage & Bar',
      match: (i) =>
        i.id.includes('menu') ||
        i.id.includes('shaker') ||
        i.id.includes('bottle') ||
        i.id.includes('cup') ||
        i.id.includes('cake') ||
        i.id.includes('tip') ||
        i.id.includes('jukebox'),
    },
  ],
  party: [
    { id: 'all', label: 'All', match: () => true },
    {
      id: 'audio',
      label: 'Audio & DJ',
      match: (i) =>
        i.id.includes('dj') ||
        i.id.includes('speaker') ||
        i.id.includes('subwoofer') ||
        i.id.includes('karaoke') ||
        i.id.includes('vinyl'),
    },
    {
      id: 'lighting',
      label: 'Lighting',
      match: (i) => i.tags.includes('light') && i.id !== 'dance_floor_tile',
    },
    {
      id: 'vibes',
      label: 'Vibes & Floor',
      match: (i) =>
        i.id.includes('fog') || i.id.includes('dance_floor') || i.id.includes('balloon'),
    },
  ],
  decor: [
    { id: 'all', label: 'All', match: () => true },
    { id: 'plants', label: 'Plants', match: (i) => i.tags.includes('plants') },
    { id: 'lighting', label: 'Lighting', match: (i) => i.tags.includes('light') },
    {
      id: 'music_art',
      label: 'Music & Art',
      match: (i) =>
        i.tags.includes('music') ||
        i.tags.includes('art') ||
        i.id.includes('clock') ||
        i.id.includes('vase'),
    },
    {
      id: 'shelves',
      label: 'Shelves & Mirrors',
      match: (i) =>
        i.id.includes('bookshelf') ||
        i.id.includes('curtain') ||
        i.id.includes('mirror') ||
        i.id.includes('rug'),
    },
    { id: 'plushies', label: 'Plushies', match: (i) => i.tags.includes('plushie') },
  ],
  pets: [
    { id: 'all', label: 'All', match: () => true },
    {
      id: 'cats',
      label: 'Cats',
      match: (i) =>
        i.id === 'cat_calico' ||
        i.id === 'cat_sleepy' ||
        i.id === 'cat_kitten' ||
        i.id === 'cat_loaf',
    },
    {
      id: 'trees',
      label: 'Trees & Beds',
      match: (i) =>
        i.id.includes('tree') ||
        i.id.includes('condo') ||
        i.id.includes('bed') ||
        i.id.includes('shelf') ||
        i.id.includes('catwalk') ||
        i.id.includes('hammock'),
    },
    {
      id: 'toys',
      label: 'Toys & Care',
      match: (i) =>
        i.id.includes('scratch') ||
        i.id.includes('wand') ||
        i.id.includes('tunnel') ||
        i.id.includes('ball') ||
        i.id.includes('bowl') ||
        i.id.includes('feeder') ||
        i.id.includes('litter'),
    },
  ],
};

function timeHourToStorybookIcon(hour: number, running: boolean): StorybookIconName {
  if (running) return 'time_running';
  const h = ((hour % 24) + 24) % 24;
  if (h < 5.2 || h >= 20.2) return 'time_night';
  if (h < 9.0) return 'time_dawn';
  if (h < 16.8) return 'time_day';
  return 'time_dusk';
}

function timeHourToLabel(hour: number, running: boolean): string {
  if (running) return 'Running';
  const h = ((hour % 24) + 24) % 24;
  if (h < 5.2 || h >= 20.2) return 'Night';
  if (h < 9.0) return 'Dawn';
  if (h < 16.8) return 'Day';
  return 'Dusk';
}

/** Maps continuous hour (6.5..22.5) into slider stop position (1..4). */
function hourToTimeSliderPos(hour: number, running: boolean): number {
  if (running) return 0;
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.5) return 4;
  if (h <= 6.5) return 1;
  if (h <= 12.0) return 1 + (h - 6.5) / (12.0 - 6.5);
  if (h <= 18.5) return 2 + (h - 12.0) / (18.5 - 12.0);
  if (h <= 22.5) return 3 + (h - 18.5) / (22.5 - 18.5);
  return 4;
}

/** Maps slider stop position (1..4) back to continuous hour (6.5..22.5). */
function timeSliderPosToHour(pos: number): number {
  const clamped = Math.max(1, Math.min(4, pos));
  if (clamped <= 2) return 6.5 + (clamped - 1) * (12.0 - 6.5);
  if (clamped <= 3) return 12.0 + (clamped - 2) * (18.5 - 12.0);
  return 18.5 + (clamped - 3) * (22.5 - 18.5);
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly store: HouseStore;
  private readonly sceneManager: SceneManager;
  private readonly placement: PlacementController;
  private readonly visitorModule?: VisitorModule;
  private readonly audioModule?: AudioModule;
  private readonly sceneryModule?: SceneryModule;
  private readonly celebrationBanner: CelebrationBanner;
  private readonly polaroidModal: PolaroidShareModal;

  private activeTab: CatalogTabId = 'basics';
  private activeSubcategory = 'all';
  private activeBasicsGroup: BasicsGroupId | null = null;
  private groupActiveItem: Record<BasicsGroupId, string> = {
    floors: 'floor_wood',
    walls: 'wall_plain',
    doors: 'door_wood',
    windows: 'window_wide',
  };
  private groupActiveVariant: Record<BasicsGroupId, string> = {
    floors: 'oak',
    walls: 'cream',
    doors: 'honey',
    windows: 'cream',
  };
  private searchQuery = '';
  private saveStatusText = 'Saved';
  private activePopover: PopoverKind = null;
  private visitorsTab: 'here' | 'staff' | 'invite' | 'log' = 'here';
  private hasUnseenGuestLogEntry = false;
  private selectedGuestLogId: string | null = null;
  private lastNewlyDiscoveredId: string | null = null;
  private newlyDiscoveredClearTimer: number | null = null;
  private resetLogConfirmArmed = false;
  private resetLogConfirmTimer: number | null = null;
  private staffHireKind: StaffKind = 'bot';
  private selectedVisitorId: string | null = null;
  private movingStaffId: string | null = null;
  private readonly staffRaycaster = new THREE.Raycaster();
  private readonly staffNdc = new THREE.Vector2();
  private readonly staffGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly staffHitPt = new THREE.Vector3();

  private lastRoomId: string;
  private lastRoomLabel: string;
  private catalogRenderGen = 0;
  private previewObserver: IntersectionObserver | null = null;
  private unsubscribes: Array<() => void> = [];
  private tutorialCleanup: (() => void) | null = null;

  // Location, caption & cooldown timers
  private locSwapTimer: number | null = null;
  private locFadeTimer: number | null = null;
  private locHideTimer: number | null = null;
  private captionHideTimer: number | null = null;
  private randomCooldownTimer: number | null = null;
  private randomInviteBtnEl: HTMLButtonElement | null = null;
  private randomCooldownBadgeEl: HTMLSpanElement | null = null;

  // DOM references
  private topBarEl!: HTMLDivElement;
  private roomBtnEl!: HTMLButtonElement;
  private roomIconSlotEl!: HTMLSpanElement;
  private roomLabelTextEl!: HTMLSpanElement;
  private atmosphereBtnEl!: HTMLButtonElement;
  private atmoLocSlotEl!: HTMLSpanElement;
  private atmoTimeSlotEl!: HTMLSpanElement;
  private atmoWeatherSlotEl!: HTMLSpanElement;

  private liveModeBtnEl!: HTMLButtonElement;
  private buildModeBtnEl!: HTMLButtonElement;
  private modeSwitchEl!: HTMLDivElement;
  private undoRedoGroupEl!: HTMLDivElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private wallViewBtnEl!: HTMLButtonElement;
  private wallViewIconSlotEl!: HTMLSpanElement;
  private viewBtnEl!: HTMLButtonElement;
  private viewIconSlotEl!: HTMLSpanElement;
  private povBannerEl!: HTMLDivElement;
  private cinematicBtnEl!: HTMLButtonElement;
  private cinematicExitBtnEl!: HTMLButtonElement;

  private houseOpenBtnEl!: HTMLButtonElement;
  private houseOpenDotEl!: HTMLSpanElement;
  private houseOpenLabelEl!: HTMLSpanElement;
  private visitorsBtnEl!: HTMLButtonElement;
  private visitorCountEl!: HTMLSpanElement;
  private shareBtnEl!: HTMLButtonElement;
  private soundBtnEl!: HTMLButtonElement;
  private helpBtnEl!: HTMLButtonElement;
  private menuBtnEl!: HTMLButtonElement;
  private simSpeedPillEl!: HTMLDivElement;
  private simSpeedBtns: Array<{ btn: HTMLButtonElement; speed: SimSpeed }> = [];
  private visitorProfileCardEl!: HTMLElement;
  private captionOverlayEl!: HTMLDivElement;
  private captionCardEl!: HTMLDivElement;
  private captionSpeakerEl!: HTMLDivElement;
  private captionTextEl!: HTMLDivElement;
  private captionSubtextEl!: HTMLDivElement;
  private cinemaBarsEl!: HTMLDivElement;
  private cinemaSoundHintEl!: HTMLSpanElement;
  private cinemaInputBlock: ((e: Event) => void) | null = null;
  private cinemaFlashEl!: HTMLDivElement;

  private liveCtaWrapEl!: HTMLDivElement;
  private buildSidebarEl!: HTMLElement;
  private tabRailEl!: HTMLDivElement;
  private subcategoryStripEl!: HTMLDivElement;
  private sidebarBodyEl!: HTMLDivElement;
  private selectToolBtnEl!: HTMLButtonElement;
  private bulkSelectBtnEl!: HTMLButtonElement;
  private bulkEraseBtnEl!: HTMLButtonElement;
  private lotSizeBtnEl!: HTMLButtonElement;
  private lotSizeBadgeEl!: HTMLSpanElement;
  private gridToggleBtnEl!: HTMLButtonElement;
  private searchInputEl!: HTMLInputElement;
  private searchClearBtn!: HTMLButtonElement;
  private contextBarEl!: HTMLDivElement;

  private hoverTooltipEl!: HTMLDivElement;
  private hoverHintEl!: HTMLDivElement;
  private toastStackEl!: HTMLDivElement;
  private locationCurtainEl!: HTMLDivElement;
  private locationCurtainIconEl!: HTMLDivElement;
  private locationCurtainTitleEl!: HTMLDivElement;

  private roomPopoverEl!: HTMLDivElement;
  private atmospherePopoverEl!: HTMLDivElement;
  private wallsPopoverEl!: HTMLDivElement;
  private viewPopoverEl!: HTMLDivElement;
  private visitorsPopoverEl!: HTMLDivElement;
  private helpPopoverEl!: HTMLDivElement;
  private menuPopoverEl!: HTMLDivElement;
  private cheatsPopoverEl!: HTMLDivElement;
  private lotPopoverEl!: HTMLDivElement;
  private fileInputEl!: HTMLInputElement;
  private konamiProgress = 0;
  private konamiKeycapEls: HTMLSpanElement[] = [];

  // Live storybook slider & control refs so dragging/updates stay silky smooth without rebuilding DOM
  private timeThumbEl: HTMLDivElement | null = null;
  private timeTrackEl: HTMLDivElement | null = null;
  private timeStatusEl: HTMLSpanElement | null = null;
  private timeStopBtns: HTMLButtonElement[] = [];
  private weatherThumbEl: HTMLDivElement | null = null;
  private weatherTrackEl: HTMLDivElement | null = null;
  private weatherStopBtns: HTMLButtonElement[] = [];
  private shaderStyleBtns: Map<VisualShaderId, HTMLButtonElement> = new Map();
  private musicRowRefs: Array<{
    row: HTMLDivElement;
    iconSlot: HTMLButtonElement;
    vibeEl: HTMLSpanElement;
    trackEl: HTMLDivElement;
    orbEl: HTMLDivElement;
    pctEl: HTMLSpanElement;
  }> = [];
  private weatherAudioRefs: Array<{
    row: HTMLDivElement;
    iconSlot: HTMLButtonElement;
    trackEl: HTMLDivElement;
    orbEl: HTMLDivElement;
    pctEl: HTMLSpanElement;
  }> = [];
  private chatterAudioRefs: Array<{
    row: HTMLDivElement;
    iconSlot: HTMLButtonElement;
    labelEl: HTMLSpanElement;
    trackEl: HTMLDivElement;
    orbEl: HTMLDivElement;
    pctEl: HTMLSpanElement;
  }> = [];
  private volumeThumbEls: HTMLDivElement[] = [];
  private volumeValueEls: HTMLSpanElement[] = [];
  private wallModeRefs: Map<WallViewMode, { btn: HTMLButtonElement; checkEl: HTMLElement }> =
    new Map();
  private wallCeilingSwitchBtn: HTMLButtonElement | null = null;
  private wallOpacitySliderRef: {
    track: HTMLDivElement;
    orb: HTMLDivElement;
    pct: HTMLSpanElement;
  } | null = null;

  constructor(
    root: HTMLElement,
    store: HouseStore,
    sceneManager: SceneManager,
    placement: PlacementController,
    modules: HudModules = {},
  ) {
    this.root = root;
    this.store = store;
    this.sceneManager = sceneManager;
    this.placement = placement;
    this.visitorModule = modules.visitorModule;
    this.audioModule = modules.audioModule;
    this.sceneryModule = modules.sceneryModule;

    this.ensureValidGroupDefaults();

    const initialEval = evaluateRoomType(this.store.getState(), this.store.data);
    this.lastRoomId = initialEval.labelInfo.id;
    this.lastRoomLabel = initialEval.labelInfo.label;

    this.buildShell();
    this.celebrationBanner = new CelebrationBanner(this.root);
    this.polaroidModal = new PolaroidShareModal(
      this.root,
      this.store,
      this.sceneManager,
      this.audioModule,
    );

    this.renderTabRail();
    this.renderSubcategories();
    this.renderSidebarCatalog();
    this.syncEditModeUi();
    this.syncHouseOpenButton();
    this.syncSimSpeedControlsLive();
    this.syncHud();
    this.syncWallViewButton();
    this.syncSoundButton();
    this.syncVisitorsUi();
    this.updateTopOffset();
    requestAnimationFrame(() => this.updateTopOffset());

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.updateTopOffset());
      ro.observe(this.topBarEl);
      this.unsubscribes.push(() => ro.disconnect());
    }
    const onResize = () => this.updateTopOffset();
    window.addEventListener('resize', onResize);
    this.unsubscribes.push(() => window.removeEventListener('resize', onResize));

    this.unsubscribes.push(
      this.store.on('houseChanged', ({ state, reason }) => {
        if (reason === 'timeOfDay') {
          this.syncAtmosphereTopPill();
          if (this.activePopover === 'atmosphere') {
            this.syncTimeSliderLive();
          }
          return;
        }

        if (reason === 'weather' && this.activePopover === 'atmosphere') {
          this.syncAtmosphereTopPill();
          this.syncWeatherSliderLive();
          this.undoBtn.disabled = !this.store.canUndo();
          this.redoBtn.disabled = !this.store.canRedo();
          return;
        }

        const evaluation = evaluateRoomType(state, this.store.data);
        const changed =
          evaluation.labelInfo.id !== this.lastRoomId ||
          evaluation.labelInfo.label !== this.lastRoomLabel;

        if (changed && CELEBRATION_REASONS.has(reason)) {
          this.celebrationBanner.show(evaluation.labelInfo, this.lastRoomLabel);
          this.audioModule?.playCelebration();
        }

        this.lastRoomId = evaluation.labelInfo.id;
        this.lastRoomLabel = evaluation.labelInfo.label;

        this.syncHud();
      }),
      this.store.on('houseOpenChanged', () => {
        this.syncHouseOpenButton();
        if (this.activePopover === 'visitors') {
          this.renderVisitorsPopover();
        }
      }),
      this.store.on('doorPolicyChanged', () => {
        this.syncHouseOpenButton();
        if (this.activePopover === 'visitors') {
          this.renderVisitorsPopover();
        }
      }),
      this.store.on('timeCycleChanged', () => {
        this.syncAtmosphereTopPill();
        if (this.activePopover === 'atmosphere') {
          this.syncTimeSliderLive();
        }
      }),
      this.store.on('simSpeedChanged', () => this.syncSimSpeedControlsLive()),
      this.store.on('staffChanged', () => {
        if (this.movingStaffId && !this.store.getStaff().some((s) => s.id === this.movingStaffId)) {
          this.cancelMovingStaff();
        }
        if (this.activePopover === 'visitors') {
          this.renderVisitorsPopover();
        }
      }),
      this.store.on('selectionChanged', () => this.renderContextBar()),
      this.store.on('modeChanged', (modeState) => {
        if (modeState.mode === 'place' && modeState.placementItemId) {
          const placedDef = this.store.data.itemsById.get(modeState.placementItemId);
          const group = placedDef ? this.getBasicsGroupForDef(placedDef) : null;
          if (group) {
            this.activeBasicsGroup = group;
            this.groupActiveItem[group] = modeState.placementItemId;
            if (modeState.placementVariantId) {
              this.groupActiveVariant[group] = modeState.placementVariantId;
            }
          } else {
            this.activeBasicsGroup = null;
          }
        } else {
          this.activeBasicsGroup = null;
        }
        this.syncDockToolButtons();
        this.renderContextBar();
        this.renderSidebarCatalog();
      }),
      this.store.on('editModeChanged', () => {
        if (!this.store.isEditMode()) {
          this.activeBasicsGroup = null;
          this.setHoverItem(null);
          if (this.activePopover === 'lot') {
            this.setActivePopover(null);
          }
        } else {
          this.clearSelectedVisitor();
        }
        this.syncEditModeUi();
        this.renderContextBar();
        this.renderSidebarCatalog();
      }),
      this.store.on('gridVisibilityChanged', () => {
        this.syncDockToolButtons();
        if (this.activePopover === 'lot') this.renderLotPopover();
      }),
      this.store.on('wallViewChanged', () => {
        this.syncWallViewButton();
        if (this.activePopover === 'walls') this.syncWallsPopoverLive();
        if (this.activePopover === 'atmosphere') this.renderAtmospherePopover();
        if (this.activePopover === 'lot') this.renderLotPopover();
      }),
      this.store.on('cheatsChanged', () => {
        this.syncRandomInviteCooldown();
        if (this.activePopover === 'cheats') this.renderCheatsPopover();
        if (this.activePopover === 'visitors') this.renderVisitorsPopover();
        if (this.activePopover === 'menu') this.renderMenuPopover();
      }),
      this.store.on('guestLogChanged', ({ newlyDiscoveredId }) => {
        if (newlyDiscoveredId) {
          this.lastNewlyDiscoveredId = newlyDiscoveredId;
          if (this.newlyDiscoveredClearTimer !== null) {
            window.clearTimeout(this.newlyDiscoveredClearTimer);
          }
          this.newlyDiscoveredClearTimer = window.setTimeout(() => {
            this.lastNewlyDiscoveredId = null;
            this.newlyDiscoveredClearTimer = null;
          }, 4500);
          if (this.activePopover !== 'visitors' || this.visitorsTab !== 'log') {
            this.hasUnseenGuestLogEntry = true;
          }
        }
        if (this.activePopover === 'visitors') this.renderVisitorsPopover();
        if (this.activePopover === 'cheats') this.renderCheatsPopover();
      }),
      this.store.on('chaosModeChanged', () => {
        if (this.activePopover === 'menu') this.renderMenuPopover();
        if (this.activePopover === 'visitors') this.renderVisitorsPopover();
        if (this.activePopover === 'cheats') this.renderCheatsPopover();
      }),
      this.store.on('toast', ({ message, tone }) => this.showToast(message, tone)),
    );

    if (this.visitorModule) {
      this.unsubscribes.push(this.visitorModule.onChange(() => this.syncVisitorsUi()));
      if (this.visitorModule.onStaffChange) {
        this.unsubscribes.push(
          this.visitorModule.onStaffChange(() => {
            if (this.activePopover === 'visitors') {
              this.renderVisitorsPopover();
            }
            if (this.activePopover === 'view') {
              this.renderViewPopover();
            }
            if (this.getCameraViewMode() === 'visitor_pov') {
              this.renderPovBanner();
            }
          }),
        );
      }
      const specialVm = this.visitorModule as SpecialVisitorModule;
      if (specialVm.onCaption) {
        this.unsubscribes.push(
          specialVm.onCaption((payload) => this.renderDramaticCaption(payload)),
        );
      }
      if (specialVm.onCinematicFx) {
        this.unsubscribes.push(specialVm.onCinematicFx((fx) => this.playCinematicFx(fx)));
      }
    }
    if (this.audioModule) {
      const chatterAudio = this.audioModule as AudioModule & {
        onChatterVolumeChange?: (cb: (volume: number) => void) => () => void;
      };
      this.unsubscribes.push(
        this.audioModule.onMuteChange(() => this.syncSoundButton()),
        this.audioModule.onVolumeChange(() => this.syncVolumeSlidersLive()),
        this.audioModule.onMusicChange(() => this.syncMusicControlsLive()),
        this.audioModule.onMusicVolumeChange(() => this.syncMusicControlsLive()),
        this.audioModule.onWeatherVolumeChange(() => this.syncWeatherVolumeControlsLive()),
      );
      if (chatterAudio.onChatterVolumeChange) {
        this.unsubscribes.push(
          chatterAudio.onChatterVolumeChange(() => this.syncChatterVolumeControlsLive()),
        );
      }
    }
    if (this.sceneManager.onShaderChange) {
      this.unsubscribes.push(
        this.sceneManager.onShaderChange(() => this.syncShaderButtonsLive()),
      );
    }
    // After a cutscene pulled the player out of POV, put them back (silently skip if that guest left)
    this.sceneManager.onPovRestore = (mode, targetId) => {
      if (mode === 'angel_pov') this.enterAngelPovMode();
      else if (targetId && this.visitorModule?.getPovPoseForPerson(targetId)) this.enterPersonPovMode(targetId);
    };
    const povSm = this.sceneManager as PovSceneManager;
    if (povSm.onCameraViewModeChange) {
      this.unsubscribes.push(
        povSm.onCameraViewModeChange((mode) => {
          if (mode !== 'visitor_pov') {
            (this.visitorModule as PovVisitorModule | undefined)?.setPovHiddenPerson?.(null);
          }
          this.syncViewButton();
          this.renderPovBanner();
          if (this.activePopover === 'view') {
            this.renderViewPopover();
          }
        }),
      );
    }

    const onDocPointerDown = (event: PointerEvent) => {
      if (!this.activePopover) return;
      const target = event.target as Node | null;
      if (!target) return;
      const keepOpenContainers: Array<HTMLElement | undefined> = [
        this.roomPopoverEl,
        this.atmospherePopoverEl,
        this.wallsPopoverEl,
        this.viewPopoverEl,
        this.visitorsPopoverEl,
        this.helpPopoverEl,
        this.menuPopoverEl,
        this.cheatsPopoverEl,
        this.lotPopoverEl,
        this.roomBtnEl,
        this.atmosphereBtnEl,
        this.wallViewBtnEl,
        this.viewBtnEl,
        this.visitorsBtnEl,
        this.helpBtnEl,
        this.menuBtnEl,
        this.lotSizeBtnEl,
      ];
      if (keepOpenContainers.some((el) => el?.contains(target))) {
        return;
      }
      this.setActivePopover(null);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    this.unsubscribes.push(() => document.removeEventListener('pointerdown', onDocPointerDown));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (this.getCameraViewMode() !== 'isometric') {
          this.exitPovModeCleanly();
          return;
        }
        const scriptedVm = this.visitorModule as SpecialVisitorModule | undefined;
        if (scriptedVm?.isMonologueActive?.()) {
          scriptedVm.skipActiveMonologue?.();
          return;
        }
        if (this.movingStaffId) {
          this.cancelMovingStaff();
          this.store.notify('Cancelled moving staff', 'info');
          return;
        }
        if (this.polaroidModal.isOpen()) {
          return;
        }
        if (this.sceneManager.isoCamera.isCinematicMode()) {
          this.setCinematicMode(false);
          return;
        }
        if (this.activePopover) {
          this.setActivePopover(null);
          return;
        }
        if (this.selectedVisitorId) {
          this.clearSelectedVisitor();
        }
        return;
      }
      this.handleKonamiKeyDown(event);
    };
    window.addEventListener('keydown', onKeyDown);
    this.unsubscribes.push(() => window.removeEventListener('keydown', onKeyDown));

    // Direct 3D visitor click-to-focus in Live Mode + Interactive Staff Move tile pick
    const canvas = this.sceneManager.renderer?.domElement;
    if (canvas) {
      let downX = 0;
      let downY = 0;
      let trackingTap = false;
      let trackingStaffMove = false;
      const onCanvasPointerDown = (ev: PointerEvent) => {
        if (ev.button !== 0 || this.polaroidModal.isOpen()) {
          trackingTap = false;
          trackingStaffMove = false;
          return;
        }
        downX = ev.clientX;
        downY = ev.clientY;
        if (this.movingStaffId) {
          trackingStaffMove = true;
          trackingTap = false;
          return;
        }
        trackingStaffMove = false;
        if (this.store.isEditMode()) {
          trackingTap = false;
          return;
        }
        trackingTap = true;
      };
      const onCanvasPointerUp = (ev: PointerEvent) => {
        if (trackingStaffMove && this.movingStaffId) {
          trackingStaffMove = false;
          if (Math.hypot(ev.clientX - downX, ev.clientY - downY) <= 6) {
            ev.stopPropagation();
            ev.preventDefault();
            this.handleStaffMoveCanvasClick(ev.clientX, ev.clientY);
          }
          return;
        }
        if (!trackingTap) return;
        trackingTap = false;
        if (
          this.store.isEditMode() ||
          this.polaroidModal.isOpen() ||
          this.sceneManager.isoCamera.isCinematicMode() ||
          this.getCameraViewMode() !== 'isometric'
        ) {
          return;
        }
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
        const hitId = this.sceneManager.pickVisitorAtClientPos(ev.clientX, ev.clientY);
        if (hitId) {
          this.audioModule?.playUiClick();
          this.selectVisitor(hitId, true);
        }
      };
      canvas.addEventListener('pointerdown', onCanvasPointerDown, true);
      canvas.addEventListener('pointerup', onCanvasPointerUp, true);
      this.unsubscribes.push(() => {
        canvas.removeEventListener('pointerdown', onCanvasPointerDown, true);
        canvas.removeEventListener('pointerup', onCanvasPointerUp, true);
      });
    }
  }

  setSaveStatus(label: string): void {
    this.saveStatusText = label;
    if (this.activePopover === 'menu') {
      this.renderMenuPopover();
    }
  }

  setHoverHint(hint: string | null): void {
    if (!this.hoverHintEl) return;
    if (hint) {
      this.hoverHintEl.textContent = hint;
      this.hoverHintEl.classList.add('visible');
    } else {
      this.hoverHintEl.classList.remove('visible');
    }
  }

  setHoverItem(info: HoverItemInfo | null): void {
    if (!this.hoverTooltipEl) return;
    if (!info || !this.store.isEditMode()) {
      this.hoverTooltipEl.classList.remove('visible');
      return;
    }
    this.hoverTooltipEl.textContent = info.name;
    const pad = 14;
    const maxX = Math.max(pad, window.innerWidth - 200);
    const x = Math.min(Math.max(pad, info.clientX + 14), maxX);
    const y = Math.max(56, info.clientY - 34);
    this.hoverTooltipEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    this.hoverTooltipEl.classList.add('visible');
  }

  dispose(): void {
    this.tutorialCleanup?.();
    this.tutorialCleanup = null;
    this.cancelMovingStaff();
    this.clearSelectedVisitor();
    this.clearLocationTimers();
    if (this.captionHideTimer !== null) {
      window.clearTimeout(this.captionHideTimer);
      this.captionHideTimer = null;
    }
    if (this.newlyDiscoveredClearTimer !== null) {
      window.clearTimeout(this.newlyDiscoveredClearTimer);
      this.newlyDiscoveredClearTimer = null;
    }
    if (this.resetLogConfirmTimer !== null) {
      window.clearTimeout(this.resetLogConfirmTimer);
      this.resetLogConfirmTimer = null;
    }
    this.stopRandomCooldownTimer();
    this.previewObserver?.disconnect();
    this.previewObserver = null;
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.celebrationBanner.dispose();
    this.polaroidModal.dispose();
  }

  private clearLocationTimers(): void {
    if (this.locSwapTimer !== null) {
      window.clearTimeout(this.locSwapTimer);
      this.locSwapTimer = null;
    }
    if (this.locFadeTimer !== null) {
      window.clearTimeout(this.locFadeTimer);
      this.locFadeTimer = null;
    }
    if (this.locHideTimer !== null) {
      window.clearTimeout(this.locHideTimer);
      this.locHideTimer = null;
    }
  }

  private runCloudTransition(
    onMidpoint: () => void,
    fallbackTitle?: string,
    fallbackIcon?: StorybookIconName,
  ): void {
    if (typeof this.sceneManager.playCloudTransition === 'function') {
      this.sceneManager.playCloudTransition(onMidpoint, {
        onStart: () => {
          this.setActivePopover(null);
          this.setHoverItem(null);
          this.root.classList.add('is-cloud-transitioning');
        },
        onComplete: () => {
          this.root.classList.remove('is-cloud-transitioning');
        },
      });
      return;
    }

    // Graceful storybook curtain fallback if 3D cloud transition is unavailable
    this.clearLocationTimers();
    this.setActivePopover(null);
    this.locationCurtainIconEl.innerHTML = '';
    if (fallbackIcon) {
      this.locationCurtainIconEl.appendChild(createStorybookIconEl(fallbackIcon, 64));
    }
    this.locationCurtainTitleEl.textContent = fallbackTitle ?? '';

    this.locationCurtainEl.classList.remove('hidden', 'leaving');
    void this.locationCurtainEl.offsetWidth;
    this.locationCurtainEl.classList.add('visible');

    this.locSwapTimer = window.setTimeout(() => {
      onMidpoint();
      this.locSwapTimer = null;
    }, 220);

    this.locFadeTimer = window.setTimeout(() => {
      this.locationCurtainEl.classList.remove('visible');
      this.locationCurtainEl.classList.add('leaving');
      this.locFadeTimer = null;
      this.locHideTimer = window.setTimeout(() => {
        this.locationCurtainEl.classList.add('hidden');
        this.locationCurtainEl.classList.remove('leaving');
        this.locHideTimer = null;
      }, 210);
    }, 360);
  }

  private switchLocationWithTransition(viewId: string): void {
    if (this.store.getState().sceneryViewId === viewId) return;
    const viewDef = this.store.data.viewsById.get(viewId);
    if (!viewDef) return;
    this.runCloudTransition(
      () => this.store.setSceneryView(viewId),
      viewDef.name,
      getLocationStorybookIconName(viewId),
    );
  }

  private startNewHouseWithTransition(): void {
    this.runCloudTransition(
      () => {
        this.store.loadPreset(createNewHouse(this.store.data));
        this.store.notify('New house started. Open Build to furnish it (Undo brings the old one back).', 'info');
      },
      'New House',
      'room_home',
    );
  }

  /**
   * First-visit chooser: start from an empty room or move into one of the preset houses.
   * Closing it (Esc, the close button or the backdrop) keeps the starter house that is already loaded.
   */
  showWelcomeChooser(onDone?: () => void): void {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'polaroid-modal-backdrop welcome-backdrop';
    const card = document.createElement('div');
    card.className = 'welcome-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'welcome-title');

    const title = document.createElement('h2');
    title.id = 'welcome-title';
    title.className = 'welcome-title';
    title.textContent = 'Welcome to Cozyhouse';
    const sub = document.createElement('p');
    sub.className = 'welcome-sub';
    sub.textContent = 'Start with an empty room, or move into a ready-made house. You can switch any time from the menu.';

    const grid = document.createElement('div');
    grid.className = 'welcome-grid';
    let finished = false;
    const finish = (choose?: () => void) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previouslyFocused?.focus?.();
      choose?.();
      onDone?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    const addChoice = (name: string, desc: string, icon: Parameters<typeof createStorybookIconEl>[0], choose: () => void, isNew = false) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isNew ? 'welcome-choice welcome-choice--new' : 'welcome-choice';
      btn.appendChild(createStorybookIconEl(icon, 30));
      const label = document.createElement('span');
      label.className = 'welcome-choice-name';
      label.textContent = name;
      const d = document.createElement('span');
      d.className = 'welcome-choice-desc';
      d.textContent = desc;
      btn.append(label, d);
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        finish(choose);
      });
      grid.appendChild(btn);
      return btn;
    };
    const firstBtn = addChoice('New House', 'An empty room to build from scratch', 'room_home', () => this.startNewHouseWithTransition(), true);
    for (const preset of HOUSE_PRESETS) {
      const view = this.store.data.viewsById.get(preset.sceneryViewId);
      const isBackrooms =
        preset.sceneryViewId === 'backrooms' || preset.id === 'backrooms_level0';
      const choiceBtn = addChoice(
        preset.name,
        view ? `Furnished · ${view.name}` : 'Furnished',
        getRoomStorybookIconName(preset.icon),
        () => this.switchPresetWithTransition(preset.id),
      );
      if (isBackrooms) {
        choiceBtn.classList.add('is-backrooms');
        choiceBtn.title = 'Level 0 · Something arrives when 5+ guests gather';
      }
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn welcome-skip';
    close.textContent = 'Keep the starter house';
    close.addEventListener('click', () => finish());

    card.append(title, sub, grid, close);
    backdrop.appendChild(card);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });
    window.addEventListener('keydown', onKey, true);
    this.root.appendChild(backdrop);
    firstBtn.focus();
  }

  isTutorialActive(): boolean {
    return this.tutorialCleanup !== null;
  }

  startTutorial(onFinish?: () => void): void {
    this.tutorialCleanup?.();

    // Ensure a clean Live-mode isometric view so every top-bar & bottom HUD target is visible
    if (this.getCameraViewMode() !== 'isometric') {
      this.exitPovModeCleanly();
    }
    if (this.sceneManager.isoCamera.isCinematicMode()) {
      this.setCinematicMode(false);
    }
    this.setActivePopover(null);
    this.clearSelectedVisitor();
    if (this.store.isEditMode()) {
      this.store.setEditMode(false);
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;

    interface TutorialStep {
      icon: StorybookIconName;
      title: string;
      bodyHtml: string;
      getTargets: () => Array<HTMLElement | null | undefined>;
      preferredAnchor?: 'below' | 'above';
    }

    const steps: TutorialStep[] = [
      {
        icon: 'room_home',
        title: 'Live & Build Modes',
        bodyHtml:
          'Switch between <strong>Live</strong> (watch guests hang out &amp; interact with items) and <strong>Build</strong> (place walls, floors, and 150+ cozy items).',
        getTargets: () => [this.modeSwitchEl],
      },
      {
        icon: 'time_day',
        title: 'Atmosphere & Audio',
        bodyHtml:
          'Pick your <strong>Scenery</strong> (Suburbs, City, Beach, Backrooms…), <strong>Weather</strong>, <strong>Time of Day</strong>, <strong>Shaders</strong>, and <strong>Music / Weather / Chat</strong> volume.',
        getTargets: () => [this.atmosphereBtnEl],
      },
      {
        icon: 'camera_pov',
        title: 'Walls & Camera POV',
        bodyHtml:
          'Dial <strong>Wall Opacity</strong> &amp; cutaway mode, or open <strong>Camera View</strong> to see through any guest’s <strong>POV</strong> or fly around in <strong>Angel’s POV</strong>.',
        getTargets: () => [this.wallViewBtnEl, this.viewBtnEl],
      },
      {
        icon: 'staff_bot',
        title: 'Visitors, Staff & Door Policy',
        bodyHtml:
          'Manage <strong>Guests</strong>, hire <strong>Cozy Bots</strong> or human staff, track rare visitors in the <strong>Log Book</strong>, and set your door to <strong>Open / Full / Closed</strong>.',
        getTargets: () => [this.houseOpenBtnEl, this.visitorsBtnEl],
      },
      {
        icon: 'time_running',
        title: 'Sim Speed & Controls',
        bodyHtml:
          'Pause or speed up life (<code>1×</code>–<code>5×</code>), drag to pan, scroll to zoom, and press <strong>Q / E</strong> to rotate. Open <strong>(i)</strong> anytime for shortcuts or to replay this tour.',
        getTargets: () => [this.simSpeedPillEl, this.helpBtnEl],
        preferredAnchor: 'above',
      },
      {
        icon: 'polaroid',
        title: 'Presets, Menu & Sharing',
        bodyHtml:
          'Try handcrafted <strong>House Presets</strong>, snap a <strong>Polaroid Card</strong>, copy a share link, or save <code>.house</code> files. Make yourself at home!',
        getTargets: () => [this.menuBtnEl],
      },
    ];

    const layer = document.createElement('div');
    layer.className = 'tutorial-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Cozyhouse quick tour');

    const scrim = document.createElement('div');
    scrim.className = 'tutorial-scrim';
    layer.appendChild(scrim);

    const spotlightsHost = document.createElement('div');
    spotlightsHost.className = 'tutorial-spotlights';
    spotlightsHost.setAttribute('aria-hidden', 'true');
    layer.appendChild(spotlightsHost);

    const card = document.createElement('div');
    card.className = 'tutorial-card';
    layer.appendChild(card);

    let stepIdx = 0;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', reposition);
      layer.remove();
      if (this.tutorialCleanup === cleanup) {
        this.tutorialCleanup = null;
      }
      previouslyFocused?.focus?.();
    };
    this.tutorialCleanup = cleanup;

    const completeTour = () => {
      try {
        localStorage.setItem('cozyhouse:tutorialDone', '1');
      } catch {
        // Ignore storage restrictions
      }
      cleanup();
      onFinish?.();
    };

    const computeHighlightRects = (
      els: Array<HTMLElement | null | undefined>,
    ): { rings: DOMRect[]; anchor: DOMRect | null } => {
      const valid: DOMRect[] = [];
      for (const el of els) {
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          valid.push(r);
        }
      }
      if (valid.length === 0) {
        return { rings: [], anchor: null };
      }
      if (valid.length === 1) {
        return { rings: valid, anchor: valid[0] };
      }
      // Merge adjacent targets (e.g. Walls + View, Door + Visitors) into one clean union ring;
      // keep distant targets (e.g. bottom-right Sim Speed + top-right Info) as crisp dual rings!
      const minLeft = Math.min(...valid.map((r) => r.left));
      const minTop = Math.min(...valid.map((r) => r.top));
      const maxRight = Math.max(...valid.map((r) => r.right));
      const maxBottom = Math.max(...valid.map((r) => r.bottom));
      const verticalSpan = maxBottom - minTop;
      const horizontalSpan = maxRight - minLeft;
      if (verticalSpan <= 72 && horizontalSpan <= 360) {
        const union = new DOMRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
        return { rings: [union], anchor: union };
      }
      return { rings: valid, anchor: valid[0] };
    };

    const reposition = () => {
      if (closed) return;
      const step = steps[stepIdx];
      const { rings, anchor } = computeHighlightRects(step.getTargets());

      spotlightsHost.innerHTML = '';
      const pad = 6;
      for (const rect of rings) {
        const ring = document.createElement('div');
        ring.className = 'tutorial-spotlight';
        ring.style.left = `${Math.round(rect.left - pad)}px`;
        ring.style.top = `${Math.round(rect.top - pad)}px`;
        ring.style.width = `${Math.round(rect.width + pad * 2)}px`;
        ring.style.height = `${Math.round(rect.height + pad * 2)}px`;
        spotlightsHost.appendChild(ring);
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 14;
      const gap = 14;
      const measured = card.getBoundingClientRect();
      const cardW = measured.width > 0 ? measured.width : Math.min(332, vw - margin * 2);
      const cardH = measured.height > 0 ? measured.height : 206;

      let left: number;
      let top: number;
      if (!anchor) {
        left = (vw - cardW) / 2;
        top = (vh - cardH) / 2;
      } else {
        left = anchor.left + anchor.width / 2 - cardW / 2;
        const belowTop = anchor.bottom + pad + gap;
        const aboveTop = anchor.top - pad - gap - cardH;
        if (step.preferredAnchor === 'above') {
          top = aboveTop >= margin ? aboveTop : belowTop;
        } else {
          top = belowTop + cardH <= vh - margin ? belowTop : aboveTop;
        }
      }

      left = Math.max(margin, Math.min(vw - cardW - margin, left));
      top = Math.max(margin, Math.min(vh - cardH - margin, top));
      card.style.left = `${Math.round(left)}px`;
      card.style.top = `${Math.round(top)}px`;
    };

    const renderStep = () => {
      const step = steps[stepIdx];
      const isFirst = stepIdx === 0;
      const isLast = stepIdx === steps.length - 1;

      card.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'tutorial-card-head';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'tutorial-title-group';
      titleGroup.appendChild(createStorybookIconEl(step.icon, 24));
      const h3 = document.createElement('h3');
      h3.className = 'tutorial-title';
      h3.textContent = step.title;
      titleGroup.appendChild(h3);

      const stepPill = document.createElement('span');
      stepPill.className = 'tutorial-step-pill tabular-num';
      stepPill.textContent = `${stepIdx + 1} / ${steps.length}`;

      head.append(titleGroup, stepPill);

      const body = document.createElement('p');
      body.className = 'tutorial-body';
      body.innerHTML = step.bodyHtml;

      const dots = document.createElement('div');
      dots.className = 'tutorial-dots';
      dots.setAttribute('aria-label', `Step ${stepIdx + 1} of ${steps.length}`);
      steps.forEach((s, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className =
          i === stepIdx
            ? 'tutorial-dot active'
            : i < stepIdx
              ? 'tutorial-dot done'
              : 'tutorial-dot';
        dot.setAttribute('aria-label', `Go to step ${i + 1}: ${s.title}`);
        dot.addEventListener('click', () => {
          if (i === stepIdx) return;
          this.audioModule?.playUiClick();
          stepIdx = i;
          renderStep();
        });
        dots.appendChild(dot);
      });

      const actions = document.createElement('div');
      actions.className = 'tutorial-actions';

      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'btn ghost btn-xs tutorial-skip-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        completeTour();
      });

      const navGroup = document.createElement('div');
      navGroup.className = 'tutorial-nav-group';

      if (!isFirst) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'btn btn-xs';
        backBtn.textContent = 'Back';
        backBtn.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          stepIdx = Math.max(0, stepIdx - 1);
          renderStep();
        });
        navGroup.appendChild(backBtn);
      }

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'btn primary btn-xs tutorial-next-btn';
      nextBtn.textContent = isLast ? 'Let’s Play!' : 'Next →';
      nextBtn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        if (isLast) {
          completeTour();
        } else {
          stepIdx += 1;
          renderStep();
        }
      });
      navGroup.appendChild(nextBtn);

      actions.append(skipBtn, navGroup);
      card.append(head, body, dots, actions);

      reposition();
      window.requestAnimationFrame(reposition);
      nextBtn.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (closed) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.audioModule?.playUiClick();
        completeTour();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        this.audioModule?.playUiClick();
        if (stepIdx >= steps.length - 1) {
          completeTour();
        } else {
          stepIdx += 1;
          renderStep();
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        if (stepIdx > 0) {
          this.audioModule?.playUiClick();
          stepIdx -= 1;
          renderStep();
        }
        return;
      }
      if (event.key === 'Enter') {
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
        if (activeTag === 'BUTTON') return;
        event.preventDefault();
        event.stopPropagation();
        this.audioModule?.playUiClick();
        if (stepIdx >= steps.length - 1) {
          completeTour();
        } else {
          stepIdx += 1;
          renderStep();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', reposition);
    this.root.appendChild(layer);
    renderStep();
  }

  private switchPresetWithTransition(presetId: string): void {
    const preset = HOUSE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.runCloudTransition(
      () => {
        const nextState = createPresetHouse(preset.id, this.store.data);
        this.store.loadPreset(nextState, preset.name);
      },
      preset.name,
      getRoomStorybookIconName(preset.icon),
    );
  }

  private ensureValidGroupDefaults(): void {
    for (const group of BASICS_GROUPS) {
      const items = this.getBasicsGroupItems(group.id);
      if (items.length === 0) continue;
      if (!items.some((it) => it.id === this.groupActiveItem[group.id])) {
        this.groupActiveItem[group.id] = items[0].id;
      }
      const activeDef = items.find((it) => it.id === this.groupActiveItem[group.id]) ?? items[0];
      if (!activeDef.variants.some((v) => v.id === this.groupActiveVariant[group.id])) {
        this.groupActiveVariant[group.id] = activeDef.variants[0].id;
      }
    }
  }

  private updateTopOffset(): void {
    if (!this.topBarEl) return;
    const rect = this.topBarEl.getBoundingClientRect();
    if (rect.bottom > 0) {
      this.root.style.setProperty('--hud-top-offset', `${Math.ceil(rect.bottom + 8)}px`);
    }
    if (this.activePopover === 'walls') {
      this.positionWallsPopover();
    }
    if (this.activePopover === 'view') {
      this.positionViewPopover();
    }
  }

  private makeBtn(
    label: string,
    onClick: () => void,
    variant?: 'primary' | 'danger' | 'ghost',
    iconName?: IconName,
    iconSize = 15,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = variant ? `btn ${variant}` : 'btn';
    if (iconName) {
      btn.appendChild(createIconEl(iconName, iconSize));
    }
    if (label) {
      const text = document.createElement('span');
      text.textContent = label;
      btn.appendChild(text);
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  private buildShell(): void {
    this.root.innerHTML = '';

    // Hidden file input for house import
    this.fileInputEl = document.createElement('input');
    this.fileInputEl.type = 'file';
    this.fileInputEl.accept = '.house,.json,.cozyhouse.json,application/json';
    this.fileInputEl.style.display = 'none';
    this.fileInputEl.addEventListener('change', () => {
      void this.handleImportSelected();
    });
    this.root.appendChild(this.fileInputEl);

    // ── Top Bar (Ultra-clean icon-first storybook islands) ──
    this.topBarEl = document.createElement('div');
    this.topBarEl.className = 'hud-bar';

    // Left Island: [Illustrated Room Icon + Label] + [Location · Time · Weather Icons Only]
    const leftIsland = document.createElement('div');
    leftIsland.className = 'hud-island';

    this.roomBtnEl = document.createElement('button');
    this.roomBtnEl.type = 'button';
    this.roomBtnEl.className = 'island-btn room-badge-btn';
    this.roomBtnEl.title = 'Choose room type or custom name';

    this.roomIconSlotEl = document.createElement('span');
    this.roomIconSlotEl.className = 'room-icon-slot';
    this.roomLabelTextEl = document.createElement('span');
    this.roomLabelTextEl.className = 'room-label-text';

    this.roomBtnEl.append(this.roomIconSlotEl, this.roomLabelTextEl);
    this.roomBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('room');
    });

    const divLeft = document.createElement('span');
    divLeft.className = 'hud-divider';

    this.atmosphereBtnEl = document.createElement('button');
    this.atmosphereBtnEl.type = 'button';
    this.atmosphereBtnEl.className = 'island-btn atmosphere-btn';
    this.atmosphereBtnEl.setAttribute('aria-label', 'Atmosphere, time, weather & location');

    this.atmoLocSlotEl = document.createElement('span');
    this.atmoLocSlotEl.className = 'atmo-icon-slot';
    this.atmoTimeSlotEl = document.createElement('span');
    this.atmoTimeSlotEl.className = 'atmo-icon-slot';
    this.atmoWeatherSlotEl = document.createElement('span');
    this.atmoWeatherSlotEl.className = 'atmo-icon-slot';

    this.atmosphereBtnEl.append(this.atmoLocSlotEl, this.atmoTimeSlotEl, this.atmoWeatherSlotEl);
    this.atmosphereBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('atmosphere');
    });

    leftIsland.append(this.roomBtnEl, divLeft, this.atmosphereBtnEl);

    // Center Island: Live / Build Switch + Build Undo/Redo + Camera + Wall Cutaway + Cinematic
    const centerIsland = document.createElement('div');
    centerIsland.className = 'hud-island';

    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'mode-switch';
    modeSwitch.setAttribute('role', 'group');
    modeSwitch.setAttribute('aria-label', 'Game mode');
    this.modeSwitchEl = modeSwitch;

    this.liveModeBtnEl = document.createElement('button');
    this.liveModeBtnEl.type = 'button';
    this.liveModeBtnEl.className = 'mode-seg-btn live-seg';
    this.liveModeBtnEl.title = 'Live Mode — interact and watch visitors';
    this.liveModeBtnEl.append(createIconEl('live', 13));
    const liveLbl = document.createElement('span');
    liveLbl.textContent = 'Live';
    this.liveModeBtnEl.appendChild(liveLbl);
    this.liveModeBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setEditMode(false);
    });

    this.buildModeBtnEl = document.createElement('button');
    this.buildModeBtnEl.type = 'button';
    this.buildModeBtnEl.className = 'mode-seg-btn build-seg';
    this.buildModeBtnEl.title = 'Build Mode — furnish, paint walls & floors, expand lot';
    this.buildModeBtnEl.append(createIconEl('build', 13));
    const buildLbl = document.createElement('span');
    buildLbl.textContent = 'Build';
    this.buildModeBtnEl.appendChild(buildLbl);
    this.buildModeBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setEditMode(true);
    });

    modeSwitch.append(this.liveModeBtnEl, this.buildModeBtnEl);

    this.undoRedoGroupEl = document.createElement('div');
    this.undoRedoGroupEl.className = 'inline-cluster hidden';

    const divUndo = document.createElement('span');
    divUndo.className = 'hud-divider';

    this.undoBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        if (this.store.undo()) this.store.notify('Undid action', 'info');
      },
      'ghost',
      'undo',
      21,
    );
    this.undoBtn.className = 'icon-btn';
    this.undoBtn.dataset.tooltip = 'Undo';
    this.undoBtn.setAttribute('aria-label', 'Undo (Cmd/Ctrl+Z)');

    this.redoBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        if (this.store.redo()) this.store.notify('Redid action', 'info');
      },
      'ghost',
      'redo',
      21,
    );
    this.redoBtn.className = 'icon-btn';
    this.redoBtn.dataset.tooltip = 'Redo';
    this.redoBtn.setAttribute('aria-label', 'Redo (Cmd/Ctrl+Shift+Z)');

    this.undoRedoGroupEl.append(divUndo, this.undoBtn, this.redoBtn);

    const divCam = document.createElement('span');
    divCam.className = 'hud-divider';

    const rotLeftBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.rotateStep(-1);
      },
      'ghost',
      'rotLeft',
      21,
    );
    rotLeftBtn.className = 'icon-btn';
    rotLeftBtn.dataset.tooltip = 'Rotate Left';
    rotLeftBtn.setAttribute('aria-label', 'Rotate view left 90 degrees');

    const rotRightBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.rotateStep(1);
      },
      'ghost',
      'rotRight',
      21,
    );
    rotRightBtn.className = 'icon-btn';
    rotRightBtn.dataset.tooltip = 'Rotate Right';
    rotRightBtn.setAttribute('aria-label', 'Rotate view right 90 degrees');

    const zoomOutBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.zoomByFactor(1 / 1.2);
      },
      'ghost',
      'minus',
      21,
    );
    zoomOutBtn.className = 'icon-btn';
    zoomOutBtn.dataset.tooltip = 'Zoom Out';
    zoomOutBtn.setAttribute('aria-label', 'Zoom out');

    const zoomInBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.zoomByFactor(1.2);
      },
      'ghost',
      'plus',
      21,
    );
    zoomInBtn.className = 'icon-btn';
    zoomInBtn.dataset.tooltip = 'Zoom In';
    zoomInBtn.setAttribute('aria-label', 'Zoom in');

    const resetViewBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.resetView();
      },
      'ghost',
      'reset',
      21,
    );
    resetViewBtn.className = 'icon-btn';
    resetViewBtn.dataset.tooltip = 'Reset View';
    resetViewBtn.setAttribute('aria-label', 'Reset camera view');

    this.wallViewBtnEl = document.createElement('button');
    this.wallViewBtnEl.type = 'button';
    this.wallViewBtnEl.className = 'icon-btn wall-view-btn has-caret';
    this.wallViewBtnEl.dataset.tooltip = 'Walls: Auto';
    this.wallViewBtnEl.setAttribute('aria-label', 'Wall visibility & ceiling');
    this.wallViewBtnEl.setAttribute('aria-haspopup', 'menu');
    this.wallViewBtnEl.setAttribute('aria-expanded', 'false');
    this.wallViewIconSlotEl = document.createElement('span');
    this.wallViewIconSlotEl.className = 'wall-icon-slot';
    const wallCaret = document.createElement('span');
    wallCaret.className = 'btn-caret';
    wallCaret.textContent = '▾';
    wallCaret.setAttribute('aria-hidden', 'true');
    this.wallViewBtnEl.append(this.wallViewIconSlotEl, wallCaret);
    this.wallViewBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('walls');
    });

    this.viewBtnEl = document.createElement('button');
    this.viewBtnEl.type = 'button';
    this.viewBtnEl.className = 'icon-btn view-pov-btn has-caret';
    this.viewBtnEl.dataset.tooltip = 'Camera View · View from a guest or Angel’s POV';
    this.viewBtnEl.setAttribute('aria-label', 'Camera View — View from a guest or Angel’s POV');
    this.viewBtnEl.setAttribute('aria-haspopup', 'dialog');
    this.viewBtnEl.setAttribute('aria-expanded', 'false');
    this.viewIconSlotEl = document.createElement('span');
    this.viewIconSlotEl.className = 'wall-icon-slot';
    this.viewIconSlotEl.appendChild(createStorybookIconEl('camera_pov', 22));
    this.viewIconSlotEl.dataset.icon = 'camera_pov';
    const viewCaret = document.createElement('span');
    viewCaret.className = 'btn-caret';
    viewCaret.textContent = '▾';
    viewCaret.setAttribute('aria-hidden', 'true');
    this.viewBtnEl.append(this.viewIconSlotEl, viewCaret);
    this.viewBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('view');
    });

    this.cinematicBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.setCinematicMode(!this.sceneManager.isoCamera.isCinematicMode());
      },
      'ghost',
      'cinematic',
      21,
    );
    this.cinematicBtnEl.className = 'icon-btn cinematic-btn';
    this.cinematicBtnEl.dataset.tooltip = 'Cinematic';
    this.cinematicBtnEl.setAttribute('aria-label', 'Cinematic Mode');

    centerIsland.append(
      modeSwitch,
      this.undoRedoGroupEl,
      divCam,
      rotLeftBtn,
      rotRightBtn,
      zoomOutBtn,
      zoomInBtn,
      resetViewBtn,
      this.wallViewBtnEl,
      this.viewBtnEl,
      this.cinematicBtnEl,
    );

    // Right Island: Open/Closed Switch + Visitors Icon+Count + Sound Icon + Menu Icon
    const rightIsland = document.createElement('div');
    rightIsland.className = 'hud-island';

    this.houseOpenBtnEl = document.createElement('button');
    this.houseOpenBtnEl.type = 'button';
    this.houseOpenBtnEl.className = 'open-toggle-pill';

    this.houseOpenDotEl = document.createElement('span');
    this.houseOpenDotEl.className = 'open-status-dot';
    this.houseOpenLabelEl = document.createElement('span');
    this.houseOpenLabelEl.textContent = 'Open';
    this.houseOpenBtnEl.append(this.houseOpenDotEl, this.houseOpenLabelEl);
    this.houseOpenBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      const next = this.store.cycleDoorPolicy();
      const msg =
        next === 'open'
          ? 'House is Open — guests may drop by!'
          : next === 'full'
            ? 'House is Full — current guests stay, no new arrivals'
            : 'House is Closed — sending guests home';
      this.store.notify(msg, 'info');
    });

    const divRight = document.createElement('span');
    divRight.className = 'hud-divider';

    this.visitorsBtnEl = document.createElement('button');
    this.visitorsBtnEl.type = 'button';
    this.visitorsBtnEl.className = 'island-btn visitors-btn';
    this.visitorsBtnEl.dataset.tooltip = 'Visitors';
    this.visitorsBtnEl.setAttribute('aria-label', 'Visitors');
    this.visitorsBtnEl.appendChild(createIconEl('visitors', 20));
    this.visitorCountEl = document.createElement('span');
    this.visitorCountEl.className = 'count-pill';
    this.visitorCountEl.textContent = '0';
    this.visitorsBtnEl.appendChild(this.visitorCountEl);
    this.visitorsBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('visitors');
    });

    this.shareBtnEl = document.createElement('button');
    this.shareBtnEl.type = 'button';
    this.shareBtnEl.className = 'icon-btn share-btn tooltip-right';
    this.shareBtnEl.dataset.tooltip = 'Share your house';
    this.shareBtnEl.setAttribute('aria-label', 'Share your house as a Polaroid');
    this.shareBtnEl.appendChild(createStorybookIconEl('polaroid', 22));
    this.shareBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover(null);
      this.polaroidModal.open();
    });

    this.soundBtnEl = document.createElement('button');
    this.soundBtnEl.type = 'button';
    this.soundBtnEl.className = 'icon-btn sound-btn tooltip-right';
    this.soundBtnEl.addEventListener('click', () => {
      if (!this.audioModule) return;
      const nextMuted = !this.audioModule.isMuted();
      this.audioModule.setMuted(nextMuted);
      if (!nextMuted) {
        this.audioModule.playUiClick();
      }
      this.syncSoundButton();
    });

    this.helpBtnEl = document.createElement('button');
    this.helpBtnEl.type = 'button';
    this.helpBtnEl.className = 'icon-btn help-btn tooltip-right';
    this.helpBtnEl.dataset.tooltip = 'Controls & Info';
    this.helpBtnEl.setAttribute('aria-label', 'Controls and Info');
    this.helpBtnEl.appendChild(createIconEl('info', 21));
    this.helpBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('help');
    });

    this.menuBtnEl = document.createElement('button');
    this.menuBtnEl.type = 'button';
    this.menuBtnEl.className = 'icon-btn menu-btn tooltip-right';
    this.menuBtnEl.dataset.tooltip = 'Menu';
    this.menuBtnEl.setAttribute('aria-label', 'House menu');
    this.menuBtnEl.appendChild(createIconEl('menu', 21));
    this.menuBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('menu');
    });

    rightIsland.append(
      this.houseOpenBtnEl,
      divRight,
      this.visitorsBtnEl,
      this.shareBtnEl,
      this.soundBtnEl,
      this.helpBtnEl,
      this.menuBtnEl,
    );

    this.topBarEl.append(leftIsland, centerIsland, rightIsland);
    this.root.appendChild(this.topBarEl);

    // ── Left-Side Vertical Build Sidebar ──
    this.buildSidebarEl = document.createElement('aside');
    this.buildSidebarEl.className = 'build-sidebar tucked';
    this.buildSidebarEl.setAttribute('aria-label', 'Build Catalog');

    this.tabRailEl = document.createElement('div');
    this.tabRailEl.className = 'sidebar-tab-rail';

    const mainCol = document.createElement('div');
    mainCol.className = 'sidebar-main-col';

    const toolRow = document.createElement('div');
    toolRow.className = 'sidebar-tool-row';

    this.selectToolBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.store.setSelectMode();
      },
      'ghost',
      'select',
      14,
    );
    this.selectToolBtnEl.className = 'tool-btn';
    this.selectToolBtnEl.title = 'Select, move, rotate, or recolor items';
    this.selectToolBtnEl.setAttribute('aria-label', 'Select tool');

    this.bulkSelectBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        if (this.store.getModeState().mode === 'bulk-select') {
          this.store.setSelectMode();
        } else {
          this.store.setBulkSelectMode();
        }
      },
      'ghost',
      'bulkSelect',
      14,
    );
    this.bulkSelectBtnEl.className = 'tool-btn';
    this.bulkSelectBtnEl.title = 'Bulk Select — click or drag box';
    this.bulkSelectBtnEl.setAttribute('aria-label', 'Bulk select tool');

    this.bulkEraseBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        if (this.store.getModeState().mode === 'erase') {
          this.store.setSelectMode();
        } else {
          this.store.setEraseMode();
        }
      },
      'ghost',
      'eraser',
      14,
    );
    this.bulkEraseBtnEl.className = 'tool-btn';
    this.bulkEraseBtnEl.title = 'Bulk Erase — click or drag to remove';
    this.bulkEraseBtnEl.setAttribute('aria-label', 'Bulk erase tool');

    this.lotSizeBtnEl = document.createElement('button');
    this.lotSizeBtnEl.type = 'button';
    this.lotSizeBtnEl.className = 'tool-btn';
    this.lotSizeBtnEl.title = 'Expand lot in any direction & restyle all walls or floors';
    this.lotSizeBtnEl.appendChild(createIconEl('lot', 14));
    this.lotSizeBadgeEl = document.createElement('span');
    this.lotSizeBadgeEl.className = 'lot-dim-chip';
    this.lotSizeBtnEl.appendChild(this.lotSizeBadgeEl);
    this.lotSizeBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('lot');
    });

    this.gridToggleBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.store.setGridVisible(!this.store.isGridVisible());
      },
      'ghost',
      'grid',
      14,
    );
    this.gridToggleBtnEl.className = 'tool-btn';
    this.gridToggleBtnEl.title = 'Toggle buildable tile grid lines';
    this.gridToggleBtnEl.setAttribute('aria-label', 'Toggle grid');

    toolRow.append(
      this.selectToolBtnEl,
      this.bulkSelectBtnEl,
      this.bulkEraseBtnEl,
      this.lotSizeBtnEl,
      this.gridToggleBtnEl,
    );

    const searchWrap = document.createElement('div');
    searchWrap.className = 'catalog-search-wrap';
    searchWrap.appendChild(createIconEl('search', 14));

    this.searchInputEl = document.createElement('input');
    this.searchInputEl.type = 'text';
    this.searchInputEl.className = 'catalog-search-input';
    this.searchInputEl.placeholder = 'Search…';
    this.searchInputEl.setAttribute('aria-label', 'Search catalog items');
    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl.value;
      this.searchClearBtn.classList.toggle('hidden', this.searchQuery.length === 0);
      this.renderSubcategories();
      this.renderSidebarCatalog();
    });

    this.searchClearBtn = document.createElement('button');
    this.searchClearBtn.type = 'button';
    this.searchClearBtn.className = 'catalog-search-clear hidden';
    this.searchClearBtn.textContent = '×';
    this.searchClearBtn.title = 'Clear search';
    this.searchClearBtn.addEventListener('click', () => {
      this.searchQuery = '';
      this.searchInputEl.value = '';
      this.searchClearBtn.classList.add('hidden');
      this.renderSubcategories();
      this.renderSidebarCatalog();
    });

    searchWrap.append(this.searchInputEl, this.searchClearBtn);

    this.subcategoryStripEl = document.createElement('div');
    this.subcategoryStripEl.className = 'subcategory-strip';

    this.sidebarBodyEl = document.createElement('div');
    this.sidebarBodyEl.className = 'sidebar-catalog-body';

    mainCol.append(toolRow, searchWrap, this.subcategoryStripEl, this.sidebarBodyEl);
    this.buildSidebarEl.append(this.tabRailEl, mainCol);
    this.root.appendChild(this.buildSidebarEl);

    // ── Mutually Exclusive Popovers ──
    this.roomPopoverEl = document.createElement('div');
    this.roomPopoverEl.className = 'hud-popover room-popover hidden';
    this.root.appendChild(this.roomPopoverEl);

    this.atmospherePopoverEl = document.createElement('div');
    this.atmospherePopoverEl.className = 'hud-popover atmosphere-popover hidden';
    this.root.appendChild(this.atmospherePopoverEl);

    this.wallsPopoverEl = document.createElement('div');
    this.wallsPopoverEl.className = 'hud-popover walls-popover hidden';
    this.root.appendChild(this.wallsPopoverEl);

    this.viewPopoverEl = document.createElement('div');
    this.viewPopoverEl.className = 'hud-popover view-popover hidden';
    this.root.appendChild(this.viewPopoverEl);

    this.povBannerEl = document.createElement('div');
    this.povBannerEl.className = 'pov-hud-banner hidden';
    this.povBannerEl.setAttribute('role', 'status');
    this.povBannerEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.povBannerEl);

    this.visitorsPopoverEl = document.createElement('div');
    this.visitorsPopoverEl.className = 'hud-popover visitors-popover hidden';
    this.root.appendChild(this.visitorsPopoverEl);

    this.helpPopoverEl = document.createElement('div');
    this.helpPopoverEl.className = 'hud-popover help-popover hidden';
    this.root.appendChild(this.helpPopoverEl);

    this.menuPopoverEl = document.createElement('div');
    this.menuPopoverEl.className = 'hud-popover menu-popover hidden';
    this.root.appendChild(this.menuPopoverEl);

    this.cheatsPopoverEl = document.createElement('div');
    this.cheatsPopoverEl.className = 'hud-popover cheats-popover hidden';
    this.root.appendChild(this.cheatsPopoverEl);

    this.lotPopoverEl = document.createElement('div');
    this.lotPopoverEl.className = 'hud-popover lot-popover hidden';
    this.root.appendChild(this.lotPopoverEl);

    // ── Edit-Mode Hover Tooltip (Name Only) ──
    this.hoverTooltipEl = document.createElement('div');
    this.hoverTooltipEl.className = 'hover-item-tooltip';
    this.root.appendChild(this.hoverTooltipEl);

    this.hoverHintEl = document.createElement('div');
    this.hoverHintEl.className = 'floating-hint';
    this.root.appendChild(this.hoverHintEl);

    this.toastStackEl = document.createElement('div');
    this.toastStackEl.className = 'toast-stack';
    this.toastStackEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.toastStackEl);

    // ── Location Transition Storybook Curtain ──
    this.locationCurtainEl = document.createElement('div');
    this.locationCurtainEl.className = 'location-transition-curtain hidden';
    this.locationCurtainEl.setAttribute('aria-hidden', 'true');
    const curtainCard = document.createElement('div');
    curtainCard.className = 'location-curtain-card';
    this.locationCurtainIconEl = document.createElement('div');
    this.locationCurtainIconEl.className = 'location-curtain-icon';
    this.locationCurtainTitleEl = document.createElement('div');
    this.locationCurtainTitleEl.className = 'location-curtain-title';
    curtainCard.append(this.locationCurtainIconEl, this.locationCurtainTitleEl);
    this.locationCurtainEl.appendChild(curtainCard);
    this.root.appendChild(this.locationCurtainEl);

    // ── Cinematic Mode Exit Pill ──
    this.cinematicExitBtnEl = this.makeBtn(
      'Exit Cinematic',
      () => {
        this.audioModule?.playUiClick();
        this.setCinematicMode(false);
      },
      undefined,
      'cinematic',
      15,
    );
    this.cinematicExitBtnEl.className = 'cinematic-exit-btn';
    this.cinematicExitBtnEl.title = 'Exit Cinematic Mode (Esc)';
    this.root.appendChild(this.cinematicExitBtnEl);

    // ── Live Mode Subtle Bottom CTA ──
    this.liveCtaWrapEl = document.createElement('div');
    this.liveCtaWrapEl.className = 'live-cta-wrap';
    const enterBuildBtn = this.makeBtn(
      'Build',
      () => {
        this.audioModule?.playUiClick();
        this.store.setEditMode(true);
      },
      'primary',
      'build',
      15,
    );
    enterBuildBtn.className = 'live-build-cta';
    enterBuildBtn.title = 'Open Build Mode';
    this.liveCtaWrapEl.appendChild(enterBuildBtn);
    this.root.appendChild(this.liveCtaWrapEl);

    // ── Bottom-Right Floating Simulation Speed Pill (⏸ · 1× · 2× · 5×) ──
    this.simSpeedPillEl = this.createSimSpeedGroup('sim-speed-pill');
    this.root.appendChild(this.simSpeedPillEl);

    // ── Bottom-Left Floating Storybook Visitor Profile Card ──
    this.visitorProfileCardEl = document.createElement('aside');
    this.visitorProfileCardEl.className = 'visitor-profile-card hidden';
    this.visitorProfileCardEl.setAttribute('aria-label', 'Visitor profile');
    this.root.appendChild(this.visitorProfileCardEl);

    // ── Dramatic Monologue Caption Overlay (Legendary Moments + Skip Button) ──
    this.captionOverlayEl = document.createElement('div');
    this.captionOverlayEl.className = 'dramatic-caption-overlay hidden';
    this.captionOverlayEl.setAttribute('aria-live', 'polite');
    this.captionCardEl = document.createElement('div');
    this.captionCardEl.className = 'dramatic-caption-card';
    const captionBody = document.createElement('div');
    captionBody.className = 'dramatic-caption-body';
    this.captionSpeakerEl = document.createElement('div');
    this.captionSpeakerEl.className = 'dramatic-caption-speaker';
    this.captionTextEl = document.createElement('div');
    this.captionTextEl.className = 'dramatic-caption-text';
    this.captionSubtextEl = document.createElement('div');
    this.captionSubtextEl.className = 'dramatic-caption-subtext';
    this.captionSubtextEl.lang = 'ja';
    captionBody.append(this.captionSpeakerEl, this.captionTextEl, this.captionSubtextEl);

    const skipCaptionBtn = document.createElement('button');
    skipCaptionBtn.type = 'button';
    skipCaptionBtn.className = 'dramatic-caption-skip';
    skipCaptionBtn.textContent = 'Skip ⏭';
    skipCaptionBtn.title = 'Skip monologue';
    skipCaptionBtn.setAttribute('aria-label', 'Skip monologue');
    skipCaptionBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      const specialVm = this.visitorModule as SpecialVisitorModule | undefined;
      if (specialVm?.skipActiveMonologue) {
        specialVm.skipActiveMonologue();
      } else {
        this.renderDramaticCaption(null);
      }
    });

    this.captionCardEl.append(captionBody, skipCaptionBtn);
    this.captionOverlayEl.appendChild(this.captionCardEl);
    this.root.appendChild(this.captionOverlayEl);

    // ── Cutscene dressing: letterbox bars (with their own Skip), hit flash ──
    this.cinemaBarsEl = document.createElement('div');
    this.cinemaBarsEl.className = 'cinema-bars';
    const cinemaSkipBtn = document.createElement('button');
    cinemaSkipBtn.type = 'button';
    cinemaSkipBtn.className = 'dramatic-caption-skip cinema-skip';
    cinemaSkipBtn.textContent = 'Skip ⏭';
    cinemaSkipBtn.title = 'Skip scene (Esc)';
    cinemaSkipBtn.setAttribute('aria-label', 'Skip scene');
    cinemaSkipBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      (this.visitorModule as SpecialVisitorModule | undefined)?.skipActiveMonologue?.();
    });
    const topBar = document.createElement('div');
    topBar.className = 'cinema-bar top';
    const bottomBar = document.createElement('div');
    bottomBar.className = 'cinema-bar bottom';
    this.cinemaSoundHintEl = document.createElement('span');
    this.cinemaSoundHintEl.className = 'cinema-sound-hint';
    this.cinemaSoundHintEl.textContent = '🔇 Click anywhere for sound';
    this.cinemaSoundHintEl.hidden = true;
    bottomBar.append(this.cinemaSoundHintEl, cinemaSkipBtn);
    this.cinemaBarsEl.append(topBar, bottomBar);
    this.cinemaFlashEl = document.createElement('div');
    this.cinemaFlashEl.className = 'cinema-flash';
    this.root.append(this.cinemaBarsEl, this.cinemaFlashEl);

    // ── Floating Bottom Selection / Place / Bulk / Erase Action Bar ──
    this.contextBarEl = document.createElement('div');
    this.contextBarEl.className = 'context-bar hidden';
    this.root.appendChild(this.contextBarEl);
  }

  private createSimSpeedGroup(className: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = className;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Simulation speed');

    const current = this.store.getSimSpeed();
    this.simSpeedBtns = this.simSpeedBtns.filter((entry) => entry.btn.isConnected);

    for (const opt of SIM_SPEED_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sim-speed-btn tabular-num';
      btn.textContent = opt.label;
      btn.title = opt.title;
      btn.setAttribute('aria-label', opt.title);
      const isActive = current === opt.speed;
      btn.classList.toggle('active', isActive && opt.speed !== 0);
      btn.classList.toggle('paused-active', isActive && opt.speed === 0);
      btn.setAttribute('aria-pressed', String(isActive));
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setSimSpeed(opt.speed);
      });
      this.simSpeedBtns.push({ btn, speed: opt.speed });
      group.appendChild(btn);
    }
    return group;
  }

  private syncSimSpeedControlsLive(): void {
    const current = this.store.getSimSpeed();
    this.simSpeedBtns = this.simSpeedBtns.filter((entry) => entry.btn.isConnected);
    for (const { btn, speed } of this.simSpeedBtns) {
      const isActive = current === speed;
      btn.classList.toggle('active', isActive && speed !== 0);
      btn.classList.toggle('paused-active', isActive && speed === 0);
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  private setCinematicMode(enabled: boolean): void {
    if (enabled) {
      this.cancelMovingStaff();
      this.store.setEditMode(false);
      this.setActivePopover(null);
      this.setHoverItem(null);
      this.clearSelectedVisitor();
    }
    this.sceneManager.isoCamera.setCinematicMode(enabled);
    this.root.classList.toggle('cinematic-active', enabled);
    if (this.cinematicBtnEl) {
      this.cinematicBtnEl.classList.toggle('active-trigger', enabled);
    }
  }

  private togglePopover(kind: Exclude<PopoverKind, null>): void {
    this.setActivePopover(this.activePopover === kind ? null : kind);
  }

  private setActivePopover(kind: PopoverKind): void {
    if (kind !== null && this.movingStaffId) {
      this.cancelMovingStaff();
    }
    this.updateTopOffset();
    this.activePopover = kind;
    this.timeThumbEl = null;
    this.timeStatusEl = null;
    this.timeStopBtns = [];
    this.volumeThumbEls = [];
    this.volumeValueEls = [];
    this.wallModeRefs.clear();
    this.wallCeilingSwitchBtn = null;
    this.wallOpacitySliderRef = null;
    this.konamiKeycapEls = [];
    if (kind !== 'visitors') {
      this.selectedGuestLogId = null;
    }
    if (kind !== 'cheats') {
      this.disarmResetLogConfirm();
    }
    this.stopRandomCooldownTimer();
    this.randomInviteBtnEl = null;
    this.randomCooldownBadgeEl = null;

    this.roomPopoverEl.classList.toggle('hidden', kind !== 'room');
    this.atmospherePopoverEl.classList.toggle('hidden', kind !== 'atmosphere');
    this.wallsPopoverEl.classList.toggle('hidden', kind !== 'walls');
    this.viewPopoverEl.classList.toggle('hidden', kind !== 'view');
    this.visitorsPopoverEl.classList.toggle('hidden', kind !== 'visitors');
    this.helpPopoverEl.classList.toggle('hidden', kind !== 'help');
    this.menuPopoverEl.classList.toggle('hidden', kind !== 'menu');
    this.cheatsPopoverEl.classList.toggle('hidden', kind !== 'cheats');
    this.lotPopoverEl.classList.toggle('hidden', kind !== 'lot');

    this.roomBtnEl.classList.toggle('active-trigger', kind === 'room');
    this.atmosphereBtnEl.classList.toggle('active-trigger', kind === 'atmosphere');
    this.visitorsBtnEl.classList.toggle('active-trigger', kind === 'visitors');
    this.helpBtnEl.classList.toggle('active-trigger', kind === 'help');
    this.menuBtnEl.classList.toggle('active-trigger', kind === 'menu');
    this.lotSizeBtnEl.classList.toggle('active-tool', kind === 'lot');
    this.syncWallViewButton();
    this.syncViewButton();

    if (kind === 'room') this.renderRoomPopover();
    if (kind === 'atmosphere') this.renderAtmospherePopover();
    if (kind === 'walls') {
      this.renderWallsPopover();
      this.positionWallsPopover();
    }
    if (kind === 'view') {
      this.renderViewPopover();
      this.positionViewPopover();
    }
    if (kind === 'visitors') this.renderVisitorsPopover();
    if (kind === 'help') this.renderHelpPopover();
    if (kind === 'menu') this.renderMenuPopover();
    if (kind === 'cheats') this.renderCheatsPopover();
    if (kind === 'lot') this.renderLotPopover();
  }

  private syncEditModeUi(): void {
    const isEdit = this.store.isEditMode();
    this.root.classList.toggle('build-open', isEdit);
    this.liveModeBtnEl.classList.toggle('active', !isEdit);
    this.buildModeBtnEl.classList.toggle('active', isEdit);
    this.undoRedoGroupEl.classList.toggle('hidden', !isEdit);
    this.buildSidebarEl.classList.toggle('tucked', !isEdit);
    this.liveCtaWrapEl.classList.toggle('hidden', isEdit);
    this.syncDockToolButtons();
    this.updateTopOffset();
  }

  private syncHouseOpenButton(): void {
    if (!this.houseOpenBtnEl) return;
    const policy = this.store.getDoorPolicy();
    this.houseOpenBtnEl.classList.toggle('is-open', policy === 'open');
    this.houseOpenBtnEl.classList.toggle('is-full', policy === 'full');
    this.houseOpenBtnEl.classList.toggle('is-closed', policy === 'closed');
    this.houseOpenLabelEl.textContent =
      policy === 'open' ? 'Open' : policy === 'full' ? 'Full' : 'Closed';
    const tip =
      policy === 'open'
        ? 'Open — guests arrive on their own'
        : policy === 'full'
          ? 'Full — current guests stay, no new arrivals'
          : 'Closed — no arrivals, sending guests home';
    this.houseOpenBtnEl.dataset.tooltip = tip;
    this.houseOpenBtnEl.removeAttribute('title');
    this.houseOpenBtnEl.setAttribute('aria-label', `${tip} (click to cycle)`);
  }

  private renderTabRail(): void {
    this.tabRailEl.innerHTML = '';
    const counts = new Map<CatalogTabId, number>();
    for (const item of this.store.data.furniture.items) {
      counts.set(item.tab, (counts.get(item.tab) ?? 0) + 1);
    }

    for (const tab of this.store.data.furniture.tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = tab.id === this.activeTab ? 'rail-tab-btn active' : 'rail-tab-btn';
      const count = tab.id === 'basics' ? BASICS_GROUPS.length : (counts.get(tab.id) ?? 0);
      btn.title = `${tab.label} (${count})`;

      const iconWrap = document.createElement('span');
      iconWrap.className = 'rail-tab-icon';
      iconWrap.appendChild(createIconEl(tab.id as IconName, 18));

      const label = document.createElement('span');
      label.className = 'rail-tab-label';
      label.textContent = TAB_SHORT_LABELS[tab.id] ?? tab.label;

      btn.append(iconWrap, label);
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.activeTab = tab.id;
        this.activeSubcategory = 'all';
        if (tab.id !== 'basics') {
          this.activeBasicsGroup = null;
        }
        this.renderTabRail();
        this.renderSubcategories();
        this.renderSidebarCatalog();
        this.sidebarBodyEl.scrollTo({ top: 0 });
      });
      this.tabRailEl.appendChild(btn);
    }
  }

  private renderSubcategories(): void {
    this.subcategoryStripEl.innerHTML = '';
    const query = this.searchQuery.trim();
    if (query || this.activeTab === 'basics') {
      this.subcategoryStripEl.classList.add('hidden');
      return;
    }

    const subs = TAB_SUBCATEGORIES[this.activeTab];
    if (!subs || subs.length <= 1) {
      this.subcategoryStripEl.classList.add('hidden');
      return;
    }

    this.subcategoryStripEl.classList.remove('hidden');
    for (const sub of subs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = sub.id === this.activeSubcategory ? 'subcat-pill active' : 'subcat-pill';
      chip.textContent = sub.label;
      chip.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.activeSubcategory = sub.id;
        this.renderSubcategories();
        this.renderSidebarCatalog();
        this.sidebarBodyEl.scrollTo({ top: 0 });
      });
      this.subcategoryStripEl.appendChild(chip);
    }
  }

  private loadPreviewInto(
    def: FurnitureItemDef,
    variantId: string,
    img: HTMLImageElement,
    fallback: HTMLElement,
    expectedCatalogGen?: number,
  ): void {
    const renderer = this.sceneManager.getPreviewRenderer?.();
    if (!renderer) return;

    void renderer.renderPreview(def, variantId).then((url) => {
      if (!url || !img.isConnected) return;
      if (expectedCatalogGen !== undefined && expectedCatalogGen !== this.catalogRenderGen) {
        return;
      }
      img.src = url;
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
    });
  }

  private createPreviewThumb(
    def: FurnitureItemDef,
    variantId: string,
    className: string,
    eager = true,
  ): { box: HTMLDivElement; img: HTMLImageElement; fallback: HTMLSpanElement; cached: boolean } {
    const box = document.createElement('div');
    box.className = className;

    const variant = def.variants.find((v) => v.id === variantId) ?? def.variants[0];
    const fallback = document.createElement('span');
    fallback.className = 'preview-fallback-dot';
    fallback.style.background = variant.color;

    const img = document.createElement('img');
    img.className = 'preview-thumb-img hidden';
    img.alt = def.name;
    img.draggable = false;

    box.append(fallback, img);

    const renderer = this.sceneManager.getPreviewRenderer?.();
    const cachedUrl = renderer?.getCachedPreview(def.id, variantId) ?? null;
    if (cachedUrl) {
      img.src = cachedUrl;
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
      return { box, img, fallback, cached: true };
    }

    if (eager) {
      this.loadPreviewInto(def, variantId, img, fallback);
    }

    return { box, img, fallback, cached: false };
  }

  private isStructuralWallDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def &&
        def.layer === 'wall' &&
        def.wallKind === 'structure' &&
        !def.tags.includes('door') &&
        !def.tags.includes('window'),
    );
  }

  private isArchwayWallDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(def && (def.id === 'wall_arch' || def.tags.includes('entrance')));
  }

  private isFloorTileDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(def && def.layer === 'floor' && def.subLayer === 'tile');
  }

  private isDoorDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def && def.layer === 'wall' && def.wallKind === 'structure' && def.tags.includes('door'),
    );
  }

  private isWindowDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def && def.layer === 'wall' && def.wallKind === 'structure' && def.tags.includes('window'),
    );
  }

  private getBasicsGroupForDef(def: FurnitureItemDef): BasicsGroupId | null {
    if (this.isFloorTileDef(def)) return 'floors';
    if (this.isStructuralWallDef(def)) return 'walls';
    if (this.isDoorDef(def)) return 'doors';
    if (this.isWindowDef(def)) return 'windows';
    return null;
  }

  private getBasicsGroupItems(groupId: BasicsGroupId): FurnitureItemDef[] {
    const items = this.store.data.furniture.items;
    switch (groupId) {
      case 'floors':
        return items.filter((i) => this.isFloorTileDef(i));
      case 'walls':
        return items.filter((i) => this.isStructuralWallDef(i));
      case 'doors':
        return items.filter((i) => this.isDoorDef(i));
      case 'windows':
        return items.filter((i) => this.isWindowDef(i));
    }
  }

  private renderSidebarCatalog(): void {
    this.catalogRenderGen += 1;
    const renderGen = this.catalogRenderGen;
    this.previewObserver?.disconnect();
    this.previewObserver = null;

    this.sidebarBodyEl.innerHTML = '';
    const modeState = this.store.getModeState();
    const query = this.searchQuery.trim().toLowerCase();

    if (this.activeTab === 'basics' && !query) {
      this.ensureValidGroupDefaults();

      const groupGrid = document.createElement('div');
      groupGrid.className = 'catalog-grid';

      for (const group of BASICS_GROUPS) {
        const groupItems = this.getBasicsGroupItems(group.id);
        if (groupItems.length === 0) continue;

        const activeId = this.groupActiveItem[group.id];
        const activeDef = groupItems.find((it) => it.id === activeId) ?? groupItems[0];
        const activeVariant =
          activeDef.variants.find((v) => v.id === this.groupActiveVariant[group.id])?.id ??
          activeDef.variants[0].id;

        const isActiveGroup = this.activeBasicsGroup === group.id;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = isActiveGroup ? 'item-card group-card active' : 'item-card group-card';
        card.title = `${group.label} — ${groupItems.length} styles (${activeDef.name})`;

        const { box: previewBox } = this.createPreviewThumb(
          activeDef,
          activeVariant,
          'item-card-preview',
          true,
        );

        const stackMark = document.createElement('span');
        stackMark.className = 'group-stack-badge';
        stackMark.appendChild(createIconEl('stack', 11));
        const countSpan = document.createElement('span');
        countSpan.textContent = String(groupItems.length);
        stackMark.appendChild(countSpan);
        previewBox.appendChild(stackMark);

        const name = document.createElement('div');
        name.className = 'item-card-name';
        name.textContent = group.label;

        card.append(previewBox, name);
        card.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          if (isActiveGroup && modeState.mode === 'place') {
            this.activeBasicsGroup = null;
            this.store.setSelectMode();
          } else {
            this.activeBasicsGroup = group.id;
            this.store.startPlacement(activeDef.id, activeVariant);
          }
        });

        groupGrid.appendChild(card);
      }

      this.sidebarBodyEl.appendChild(groupGrid);

      if (this.activeBasicsGroup) {
        this.renderInlineBasicsSubPicker(this.activeBasicsGroup);
      }
      return;
    }

    let items: FurnitureItemDef[];
    if (query) {
      items = this.store.data.furniture.items.filter((i) => {
        const hay = `${i.name} ${i.tags.join(' ')} ${i.layer}`.toLowerCase();
        return hay.includes(query);
      });
    } else {
      const tabItems = this.store.data.furniture.items.filter((i) => i.tab === this.activeTab);
      const subList = this.activeTab !== 'basics' ? TAB_SUBCATEGORIES[this.activeTab] : undefined;
      const activeSub = subList?.find((s) => s.id === this.activeSubcategory);
      items = activeSub ? tabItems.filter(activeSub.match) : tabItems;
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'catalog-empty';
      const msg = document.createElement('span');
      msg.textContent = query ? 'No items match your search.' : 'No items in this category.';
      const reset = this.makeBtn('Show All', () => {
        this.audioModule?.playUiClick();
        this.searchQuery = '';
        this.searchInputEl.value = '';
        this.searchClearBtn.classList.add('hidden');
        this.activeSubcategory = 'all';
        this.renderSubcategories();
        this.renderSidebarCatalog();
      });
      empty.append(msg, reset);
      this.sidebarBodyEl.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'catalog-grid';

    const pendingQueue = new Map<Element, () => void>();
    if (typeof IntersectionObserver !== 'undefined') {
      this.previewObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const trigger = pendingQueue.get(entry.target);
            if (trigger) {
              pendingQueue.delete(entry.target);
              trigger();
            }
            observer.unobserve(entry.target);
          }
        },
        { root: this.sidebarBodyEl, rootMargin: '220px' },
      );
    }

    for (const item of items) {
      const isPlacingThis =
        modeState.mode === 'place' && modeState.placementItemId === item.id;
      const previewVariantId =
        isPlacingThis && modeState.placementVariantId
          ? modeState.placementVariantId
          : item.variants[0].id;

      const [w, d] = item.footprint;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = isPlacingThis ? 'item-card active' : 'item-card';
      card.title = `${item.name} · ${w}×${d} · ${item.layer} · ${item.variants.length} colors`;

      const { box: previewBox, img, fallback, cached } = this.createPreviewThumb(
        item,
        previewVariantId,
        'item-card-preview',
        false,
      );

      if (!cached) {
        if (this.previewObserver) {
          pendingQueue.set(previewBox, () => {
            this.loadPreviewInto(item, previewVariantId, img, fallback, renderGen);
          });
          this.previewObserver.observe(previewBox);
        } else {
          this.loadPreviewInto(item, previewVariantId, img, fallback, renderGen);
        }
      }

      const name = document.createElement('div');
      name.className = 'item-card-name';
      name.textContent = item.name;

      card.append(previewBox, name);
      card.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        if (isPlacingThis) {
          this.store.setSelectMode();
        } else {
          this.store.startPlacement(item.id);
        }
      });

      grid.appendChild(card);
    }

    this.sidebarBodyEl.appendChild(grid);
  }

  private renderInlineBasicsSubPicker(groupId: BasicsGroupId): void {
    const modeState = this.store.getModeState();
    const groupMeta = BASICS_GROUPS.find((g) => g.id === groupId);
    const groupItems = this.getBasicsGroupItems(groupId);
    const activeDef =
      this.store.data.itemsById.get(
        modeState.mode === 'place' && modeState.placementItemId
          ? modeState.placementItemId
          : this.groupActiveItem[groupId],
      ) ?? groupItems[0];
    if (!groupMeta || !activeDef) return;

    const activeVariantId =
      modeState.mode === 'place' && modeState.placementVariantId
        ? modeState.placementVariantId
        : this.groupActiveVariant[groupId];

    const panel = document.createElement('div');
    panel.className = 'inline-basics-panel';

    const header = document.createElement('div');
    header.className = 'inline-basics-header';
    const title = document.createElement('span');
    title.className = 'popover-section-label';
    title.textContent = groupMeta.label;
    const closeBtn = this.makeBtn(
      'Done',
      () => {
        this.audioModule?.playUiClick();
        this.activeBasicsGroup = null;
        this.store.setSelectMode();
      },
      'primary',
    );
    closeBtn.className = 'btn primary btn-xs';
    header.append(title, closeBtn);
    panel.appendChild(header);

    const swatchRow = document.createElement('div');
    swatchRow.className = 'inline-basics-swatches';
    swatchRow.appendChild(
      this.buildVariantSwatches(activeDef, activeVariantId, (vid) => {
        this.audioModule?.playUiClick();
        this.groupActiveVariant[groupId] = vid;
        this.store.setPlacementVariant(vid);
      }),
    );
    panel.appendChild(swatchRow);

    if (
      groupId === 'floors' ||
      (groupId === 'walls' && !this.isArchwayWallDef(activeDef))
    ) {
      const applyAllLabel =
        groupId === 'walls' ? 'Apply to All Walls' : 'Apply to All Floors';
      const applyBtn = this.makeBtn(applyAllLabel, () => {
        this.audioModule?.playUiClick();
        this.applySurfaceStyleToAll(groupId, activeDef.id, activeVariantId);
      });
      applyBtn.className = 'btn btn-xs inline-basics-apply-btn';
      applyBtn.title = `Restyle every placed ${groupId === 'walls' ? 'wall' : 'floor tile'} to ${activeDef.name}`;
      panel.appendChild(applyBtn);
    }

    const stylesGrid = document.createElement('div');
    stylesGrid.className = 'inline-styles-grid';

    for (const styleDef of groupItems) {
      const isSelected = styleDef.id === activeDef.id;
      const styleVariant = isSelected ? activeVariantId : styleDef.variants[0].id;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = isSelected ? 'sub-style-tile active' : 'sub-style-tile';
      tile.title = `${styleDef.name} · ${styleDef.variants.length} colors`;

      const { box: preview } = this.createPreviewThumb(
        styleDef,
        styleVariant,
        'sub-style-preview',
        true,
      );

      const lbl = document.createElement('span');
      lbl.className = 'sub-style-name';
      lbl.textContent = styleDef.name;

      tile.append(preview, lbl);
      tile.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.groupActiveItem[groupId] = styleDef.id;
        const nextVar = styleDef.variants.some((v) => v.id === this.groupActiveVariant[groupId])
          ? this.groupActiveVariant[groupId]
          : styleDef.variants[0].id;
        this.groupActiveVariant[groupId] = nextVar;
        this.store.startPlacement(styleDef.id, nextVar);
      });

      stylesGrid.appendChild(tile);
    }

    panel.appendChild(stylesGrid);
    this.sidebarBodyEl.appendChild(panel);
  }

  private applySurfaceStyleToAll(
    kind: 'floors' | 'walls',
    itemId: string,
    variantId: string,
  ): void {
    const def = this.store.data.itemsById.get(itemId);
    const updated =
      kind === 'walls'
        ? this.store.applyStyleToAllWalls(itemId, variantId)
        : this.store.applyStyleToAllFloors(itemId, variantId);

    const noun = kind === 'floors' ? 'floor' : 'wall';
    if (updated === 0) {
      const hasAny = this.store
        .getState()
        .items.some((it) => {
          const d = this.store.data.itemsById.get(it.itemId);
          return kind === 'floors' ? this.isFloorTileDef(d) : this.isStructuralWallDef(d);
        });
      this.store.notify(
        hasAny
          ? `All ${noun}s already use ${def?.name ?? itemId}`
          : `No ${noun}s placed yet`,
        'info',
      );
      return;
    }

    this.store.notify(
      `Updated ${updated} ${noun}${updated === 1 ? '' : 's'}`,
      'success',
    );
  }

  private buildStyleSelect(
    defs: FurnitureItemDef[],
    currentItemId: string | null,
    onPick: (itemId: string) => void,
    placeholder = 'Swap style…',
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'style-select';
    select.setAttribute('aria-label', placeholder);

    if (!currentItemId || !defs.some((d) => d.id === currentItemId)) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = placeholder;
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
    }

    for (const def of defs) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = def.name;
      if (def.id === currentItemId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      if (!select.value) return;
      this.audioModule?.playUiClick();
      onPick(select.value);
    });
    return select;
  }

  private renderContextBar(): void {
    if (!this.store.isEditMode()) {
      this.contextBarEl.classList.add('hidden');
      return;
    }

    const modeState = this.store.getModeState();
    const selectedUids = this.store.getSelectedUids();
    const selected = this.store.getSelectedItem();

    if (modeState.mode === 'erase') {
      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = 'Erase';

      const filterWrap = document.createElement('div');
      filterWrap.className = 'seg-strip';
      const activeFilter = this.store.getEraseFilter();
      for (const f of ERASE_FILTERS) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = f.id === activeFilter ? 'seg-chip active' : 'seg-chip';
        chip.textContent = f.label;
        chip.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          this.store.setEraseFilter(f.id);
        });
        filterWrap.appendChild(chip);
      }

      this.contextBarEl.append(
        title,
        filterWrap,
        this.makeBtn(
          'Done',
          () => {
            this.audioModule?.playUiClick();
            this.store.setSelectMode();
          },
          'primary',
        ),
      );
      return;
    }

    if (modeState.mode === 'bulk-select' || selectedUids.length > 1) {
      this.renderBulkActionBar();
      return;
    }

    if (modeState.mode === 'place' && modeState.placementItemId) {
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) {
        this.contextBarEl.classList.add('hidden');
        return;
      }
      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const activeVariantId = modeState.placementVariantId ?? def.variants[0].id;
      const { box: contextPreview } = this.createPreviewThumb(
        def,
        activeVariantId,
        'context-preview',
        true,
      );

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = def.name;

      const swatches = this.buildVariantSwatches(def, activeVariantId, (variantId) => {
        this.audioModule?.playUiClick();
        this.store.setPlacementVariant(variantId);
      });

      this.contextBarEl.append(
        contextPreview,
        title,
        swatches,
        this.makeBtn('Rotate', () => {
          this.audioModule?.playUiClick();
          this.store.rotatePlacement(1);
        }, undefined, 'rotRight', 14),
        this.makeBtn(
          'Done',
          () => {
            this.audioModule?.playUiClick();
            this.store.setSelectMode();
          },
          'primary',
        ),
      );
      return;
    }

    if (modeState.mode === 'move' && selected) {
      const def = this.store.data.itemsById.get(selected.itemId);
      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = `Moving ${def?.name ?? selected.itemId}`;

      this.contextBarEl.append(
        title,
        this.makeBtn('Rotate', () => {
          this.audioModule?.playUiClick();
          this.store.rotatePlacement(1);
        }, undefined, 'rotRight', 14),
        this.makeBtn('Cancel', () => {
          this.audioModule?.playUiClick();
          this.store.setSelectMode();
        }),
      );
      return;
    }

    if (selected) {
      const def = this.store.data.itemsById.get(selected.itemId);
      if (!def) {
        this.contextBarEl.classList.add('hidden');
        return;
      }

      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const { box: contextPreview } = this.createPreviewThumb(
        def,
        selected.variantId,
        'context-preview',
        true,
      );

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = def.name;

      const swatches = this.buildVariantSwatches(def, selected.variantId, (variantId) => {
        this.audioModule?.playUiClick();
        this.store.setItemVariant(selected.uid, variantId);
      });

      this.contextBarEl.append(contextPreview, title, swatches);

      if (this.isStructuralWallDef(def)) {
        const wallDefs = this.getBasicsGroupItems('walls');
        if (wallDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(wallDefs, def.id, (nextItemId) => {
              const nextDef = this.store.data.itemsById.get(nextItemId);
              const nextVariant =
                nextDef?.variants.find((v) => v.id === selected.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                selected.variantId;
              this.store.applyStyleToSelection(nextItemId, nextVariant);
            }),
          );
        }
        if (!this.isArchwayWallDef(def)) {
          const applyAllWallsBtn = this.makeBtn('Apply All', () => {
            this.audioModule?.playUiClick();
            this.applySurfaceStyleToAll('walls', selected.itemId, selected.variantId);
          });
          applyAllWallsBtn.className = 'btn btn-xs';
          applyAllWallsBtn.title = 'Apply this wall type & color to all walls';
          this.contextBarEl.appendChild(applyAllWallsBtn);
        }
      } else if (this.isFloorTileDef(def)) {
        const floorDefs = this.getBasicsGroupItems('floors');
        if (floorDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(floorDefs, def.id, (nextItemId) => {
              const nextDef = this.store.data.itemsById.get(nextItemId);
              const nextVariant =
                nextDef?.variants.find((v) => v.id === selected.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                selected.variantId;
              this.store.applyStyleToSelection(nextItemId, nextVariant);
            }),
          );
        }
        const applyAllFloorsBtn = this.makeBtn('Apply All', () => {
          this.audioModule?.playUiClick();
          this.applySurfaceStyleToAll('floors', selected.itemId, selected.variantId);
        });
        applyAllFloorsBtn.className = 'btn btn-xs';
        applyAllFloorsBtn.title = 'Apply this floor type & color to all floors';
        this.contextBarEl.appendChild(applyAllFloorsBtn);
      } else if (this.isDoorDef(def)) {
        const doorDefs = this.getBasicsGroupItems('doors');
        if (doorDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(doorDefs, def.id, (nextItemId) => {
              const nextDef = this.store.data.itemsById.get(nextItemId);
              const nextVariant =
                nextDef?.variants.find((v) => v.id === selected.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                selected.variantId;
              this.store.applyStyleToSelection(nextItemId, nextVariant);
            }),
          );
        }
      } else if (this.isWindowDef(def)) {
        const winDefs = this.getBasicsGroupItems('windows');
        if (winDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(winDefs, def.id, (nextItemId) => {
              const nextDef = this.store.data.itemsById.get(nextItemId);
              const nextVariant =
                nextDef?.variants.find((v) => v.id === selected.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                selected.variantId;
              this.store.applyStyleToSelection(nextItemId, nextVariant);
            }),
          );
        }
      }

      if (def.interaction) {
        this.contextBarEl.appendChild(
          this.makeBtn(def.interaction.label, () => {
            this.store.triggerInteraction(selected.uid);
          }),
        );
      }

      this.contextBarEl.append(
        this.makeBtn('Move', () => {
          this.audioModule?.playUiClick();
          this.store.startMovingSelected();
        }),
        this.makeBtn('Rotate', () => {
          this.audioModule?.playUiClick();
          this.placement.rotateSelectedInPlace();
        }, undefined, 'rotRight', 14),
        this.makeBtn(
          'Delete',
          () => {
            this.store.deleteItem(selected.uid);
            this.store.notify(`Deleted ${def.name}`, 'info');
          },
          'danger',
        ),
        this.makeBtn('×', () => {
          this.audioModule?.playUiClick();
          this.store.selectItem(null);
        }),
      );
      return;
    }

    this.contextBarEl.classList.add('hidden');
  }

  private renderBulkActionBar(): void {
    const selectedItems = this.store.getSelectedItems();
    const uids = selectedItems.map((i) => i.uid);

    this.contextBarEl.classList.remove('hidden');
    this.contextBarEl.innerHTML = '';

    const countPill = document.createElement('span');
    countPill.className = 'context-title tabular-num';
    countPill.textContent = uids.length === 0 ? '0 selected' : `${uids.length} selected`;

    const allWallsBtn = this.makeBtn('All Walls', () => {
      this.audioModule?.playUiClick();
      const wallUids = this.store
        .getState()
        .items.filter((it) => this.isStructuralWallDef(this.store.data.itemsById.get(it.itemId)))
        .map((it) => it.uid);
      if (wallUids.length === 0) {
        this.store.notify('No walls placed yet', 'info');
        return;
      }
      this.store.setSelectedUids(wallUids);
    });
    allWallsBtn.className = 'btn btn-xs';

    const allFloorsBtn = this.makeBtn('All Floors', () => {
      this.audioModule?.playUiClick();
      const floorUids = this.store
        .getState()
        .items.filter((it) => this.isFloorTileDef(this.store.data.itemsById.get(it.itemId)))
        .map((it) => it.uid);
      if (floorUids.length === 0) {
        this.store.notify('No floors placed yet', 'info');
        return;
      }
      this.store.setSelectedUids(floorUids);
    });
    allFloorsBtn.className = 'btn btn-xs';

    const sameTypeBtn = this.makeBtn('Same Type', () => {
      this.audioModule?.playUiClick();
      if (selectedItems.length === 0) return;
      const targetItemId = selectedItems[0].itemId;
      const matching = this.store
        .getState()
        .items.filter((it) => it.itemId === targetItemId)
        .map((it) => it.uid);
      this.store.setSelectedUids(matching);
    });
    sameTypeBtn.className = 'btn btn-xs';
    sameTypeBtn.disabled = selectedItems.length === 0;

    this.contextBarEl.append(countPill, allWallsBtn, allFloorsBtn, sameTypeBtn);

    if (selectedItems.length > 0) {
      const itemIds = new Set(selectedItems.map((i) => i.itemId));
      const selectedWalls = selectedItems.filter((i) =>
        this.isStructuralWallDef(this.store.data.itemsById.get(i.itemId)),
      );
      const selectedFloors = selectedItems.filter((i) =>
        this.isFloorTileDef(this.store.data.itemsById.get(i.itemId)),
      );
      const allWalls = selectedWalls.length === selectedItems.length;
      const allFloors = selectedFloors.length === selectedItems.length;

      if (allWalls) {
        const commonId = itemIds.size === 1 ? selectedItems[0].itemId : null;
        const repItem = selectedItems[0];
        const repDef = this.store.data.itemsById.get(repItem.itemId);
        const variants = new Set(selectedItems.map((i) => i.variantId));
        const activeVariant =
          itemIds.size === 1 && variants.size === 1 ? repItem.variantId : '';

        this.contextBarEl.appendChild(
          this.buildStyleSelect(
            this.getBasicsGroupItems('walls'),
            commonId,
            (nextId) => {
              const nextDef = this.store.data.itemsById.get(nextId);
              const nextVar =
                nextDef?.variants.find((v) => v.id === repItem.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                repItem.variantId;
              const changed = this.store.applyStyleToSelection(nextId, nextVar);
              if (changed > 0) {
                this.store.notify(
                  `Updated ${changed} wall${changed === 1 ? '' : 's'}`,
                  'success',
                );
              }
            },
            'Wall type…',
          ),
        );

        if (repDef) {
          this.contextBarEl.appendChild(
            this.buildVariantSwatches(repDef, activeVariant, (variantId) => {
              this.audioModule?.playUiClick();
              this.store.applyStyleToSelection(repDef.id, variantId);
            }),
          );
          if (!this.isArchwayWallDef(repDef)) {
            const applyAllBtn = this.makeBtn('Apply All', () => {
              this.audioModule?.playUiClick();
              this.applySurfaceStyleToAll('walls', repDef.id, repItem.variantId);
            });
            applyAllBtn.className = 'btn btn-xs';
            applyAllBtn.title = 'Apply this style to every wall in the house';
            this.contextBarEl.appendChild(applyAllBtn);
          }
        }
      } else if (allFloors) {
        const commonId = itemIds.size === 1 ? selectedItems[0].itemId : null;
        const repItem = selectedItems[0];
        const repDef = this.store.data.itemsById.get(repItem.itemId);
        const variants = new Set(selectedItems.map((i) => i.variantId));
        const activeVariant =
          itemIds.size === 1 && variants.size === 1 ? repItem.variantId : '';

        this.contextBarEl.appendChild(
          this.buildStyleSelect(
            this.getBasicsGroupItems('floors'),
            commonId,
            (nextId) => {
              const nextDef = this.store.data.itemsById.get(nextId);
              const nextVar =
                nextDef?.variants.find((v) => v.id === repItem.variantId)?.id ??
                nextDef?.variants[0]?.id ??
                repItem.variantId;
              const changed = this.store.applyStyleToSelection(nextId, nextVar);
              if (changed > 0) {
                this.store.notify(
                  `Updated ${changed} floor${changed === 1 ? '' : 's'}`,
                  'success',
                );
              }
            },
            'Floor type…',
          ),
        );

        if (repDef) {
          this.contextBarEl.appendChild(
            this.buildVariantSwatches(repDef, activeVariant, (variantId) => {
              this.audioModule?.playUiClick();
              this.store.applyStyleToSelection(repDef.id, variantId);
            }),
          );
          const applyAllBtn = this.makeBtn('Apply All', () => {
            this.audioModule?.playUiClick();
            this.applySurfaceStyleToAll('floors', repDef.id, repItem.variantId);
          });
          applyAllBtn.className = 'btn btn-xs';
          applyAllBtn.title = 'Apply this style to every floor in the house';
          this.contextBarEl.appendChild(applyAllBtn);
        }
      } else if (itemIds.size === 1) {
        const sharedDef = this.store.data.itemsById.get(selectedItems[0].itemId);
        if (sharedDef) {
          const variants = new Set(selectedItems.map((i) => i.variantId));
          const activeVariant = variants.size === 1 ? selectedItems[0].variantId : '';
          this.contextBarEl.appendChild(
            this.buildVariantSwatches(sharedDef, activeVariant, (variantId) => {
              this.audioModule?.playUiClick();
              this.store.applyStyleToSelection(sharedDef.id, variantId);
            }),
          );
        }
      }
    }

    const deleteBtn = this.makeBtn(
      `Delete (${uids.length})`,
      () => {
        if (uids.length === 0) return;
        const removed = this.store.deleteItems(uids);
        this.store.notify(`Deleted ${removed} item${removed === 1 ? '' : 's'}`, 'info');
      },
      'danger',
    );
    deleteBtn.disabled = uids.length === 0;

    const clearBtn = this.makeBtn('Clear', () => {
      this.audioModule?.playUiClick();
      this.store.clearSelection();
    });
    clearBtn.disabled = uids.length === 0;

    const doneBtn = this.makeBtn(
      'Done',
      () => {
        this.audioModule?.playUiClick();
        this.store.setSelectMode();
      },
      'primary',
    );

    this.contextBarEl.append(deleteBtn, clearBtn, doneBtn);
  }

  // ── Clean Room Picker Popover (NO Furniture Tag Dump!) ──
  private renderRoomPopover(): void {
    const state = this.store.getState();
    const derivedEval = evaluateRoomType({ ...state, roomTypeOverride: null }, this.store.data);

    this.roomPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Space';

    const headerActions = document.createElement('div');
    headerActions.className = 'popover-header-actions';
    const presetsBtn = this.makeBtn('Presets', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover('menu');
    });
    presetsBtn.className = 'btn btn-xs';
    presetsBtn.title = 'Browse handcrafted house presets';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    headerActions.append(presetsBtn, closeBtn);

    header.append(h4, headerActions);
    this.roomPopoverEl.appendChild(header);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = !state.roomTypeOverride ? 'preset-btn full selected' : 'preset-btn full';
    autoBtn.append(createStorybookIconEl(getRoomStorybookIconName(derivedEval.labelInfo.id), 18));
    const autoText = document.createElement('span');
    autoText.textContent = `Auto · ${derivedEval.labelInfo.label}`;
    autoBtn.appendChild(autoText);
    autoBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setRoomTypeOverride(null);
    });
    this.roomPopoverEl.appendChild(autoBtn);

    const grid = document.createElement('div');
    grid.className = 'room-preset-grid';
    const sortedRules = [...this.store.data.roomRules.rules].sort(
      (a, b) => b.priority - a.priority,
    );
    for (const rule of sortedRules) {
      const isSelected =
        state.roomTypeOverride === rule.id || state.roomTypeOverride === rule.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'preset-btn selected' : 'preset-btn';
      btn.title = rule.description;

      btn.append(createStorybookIconEl(getRoomStorybookIconName(rule.id), 19));

      const lbl = document.createElement('span');
      lbl.textContent = rule.label;
      btn.appendChild(lbl);

      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setRoomTypeOverride(rule.id);
      });
      grid.appendChild(btn);
    }
    this.roomPopoverEl.appendChild(grid);

    const customRow = document.createElement('div');
    customRow.className = 'custom-room-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-room-input';
    input.placeholder = 'Custom name…';
    input.maxLength = 32;
    if (
      state.roomTypeOverride &&
      !sortedRules.some(
        (r) => r.id === state.roomTypeOverride || r.label === state.roomTypeOverride,
      )
    ) {
      input.value = state.roomTypeOverride;
    }

    const applyCustom = () => {
      const trimmed = input.value.trim();
      if (!trimmed) return;
      this.audioModule?.playUiClick();
      this.store.setRoomTypeOverride(trimmed);
    };

    const applyBtn = this.makeBtn('Set', applyCustom, 'primary');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyCustom();
    });

    customRow.append(input, applyBtn);
    this.roomPopoverEl.appendChild(customRow);
  }

  // ── Storybook Custom Ink-Rail Sliders & Atmosphere Popover ──
  private positionOrbAlongNotches(orb: HTMLDivElement, pos: number, stopCount: number): void {
    const t = Math.max(0, Math.min(1, pos / (stopCount - 1)));
    // Matches the rail padding (10% .. 90% for 5 stops = center of first & last icon column)
    const halfCol = 50 / stopCount;
    const pct = halfCol + t * (100 - halfCol * 2);
    orb.style.left = `${pct.toFixed(2)}%`;
  }

  private syncTimeSliderLive(): void {
    const running = this.store.isTimeCycleRunning();
    const hour = this.store.getTimeHour();
    const pos = hourToTimeSliderPos(hour, running);
    const label = timeHourToLabel(hour, running);

    if (this.timeThumbEl && this.timeThumbEl.isConnected) {
      this.positionOrbAlongNotches(this.timeThumbEl, pos, TIME_STOPS.length);
    }
    if (this.timeTrackEl && this.timeTrackEl.isConnected) {
      this.timeTrackEl.setAttribute('aria-valuenow', pos.toFixed(2));
      this.timeTrackEl.setAttribute('aria-valuetext', label);
    }
    if (this.timeStatusEl && this.timeStatusEl.isConnected) {
      this.timeStatusEl.textContent = label;
    }
    const activeIdx = running ? 0 : Math.round(pos);
    this.timeStopBtns.forEach((btn, idx) => {
      if (btn.isConnected) {
        btn.classList.toggle('active', idx === activeIdx);
      }
    });
  }

  private syncWeatherSliderLive(): void {
    const activeWeatherId = this.store.getState().weatherId;
    const activeIdx = Math.max(
      0,
      WEATHER_SLIDER_ORDER.findIndex((w) => w.id === activeWeatherId),
    );
    const entry = WEATHER_SLIDER_ORDER[activeIdx] ?? WEATHER_SLIDER_ORDER[0];

    if (this.weatherThumbEl && this.weatherThumbEl.isConnected) {
      this.positionOrbAlongNotches(this.weatherThumbEl, activeIdx, WEATHER_SLIDER_ORDER.length);
    }
    if (this.weatherTrackEl && this.weatherTrackEl.isConnected) {
      this.weatherTrackEl.setAttribute('aria-valuenow', String(activeIdx));
      this.weatherTrackEl.setAttribute('aria-valuetext', entry.label);
    }
    this.weatherStopBtns.forEach((btn, idx) => {
      if (btn.isConnected) {
        btn.classList.toggle('active', idx === activeIdx);
      }
    });
  }

  private buildStorybookTimeSlider(): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'sb-slider-card';

    const running = this.store.isTimeCycleRunning();
    const hour = this.store.getTimeHour();
    const pos = hourToTimeSliderPos(hour, running);

    const head = document.createElement('div');
    head.className = 'sb-slider-head sb-time-head';
    const headLeft = document.createElement('div');
    headLeft.className = 'sb-time-head-left';
    const prefix = document.createElement('span');
    prefix.className = 'sb-slider-prefix';
    prefix.textContent = 'Time:';
    const val = document.createElement('span');
    val.className = 'sb-slider-value';
    val.textContent = timeHourToLabel(hour, running);
    this.timeStatusEl = val;
    headLeft.append(prefix, val);
    head.append(headLeft, this.createSimSpeedGroup('sb-speed-mini'));
    card.appendChild(head);

    const track = document.createElement('div');
    track.className = 'sb-slider-track';
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', 'Time of day');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '4');
    track.setAttribute('aria-valuenow', pos.toFixed(2));
    track.setAttribute('aria-valuetext', timeHourToLabel(hour, running));
    this.timeTrackEl = track;

    const rail = document.createElement('div');
    rail.className = 'sb-slider-rail';
    track.appendChild(rail);

    for (let i = 0; i < TIME_STOPS.length; i++) {
      const tick = document.createElement('span');
      tick.className = 'sb-slider-tick';
      const halfCol = 50 / TIME_STOPS.length;
      const pct = halfCol + (i / (TIME_STOPS.length - 1)) * (100 - halfCol * 2);
      tick.style.left = `${pct}%`;
      track.appendChild(tick);
    }

    const orb = document.createElement('div');
    orb.className = 'sb-slider-orb';
    this.positionOrbAlongNotches(orb, pos, TIME_STOPS.length);
    this.timeThumbEl = orb;
    track.appendChild(orb);

    const applyClientX = (clientX: number, commitHistory: boolean) => {
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nextPos = ratio * (TIME_STOPS.length - 1);
      if (nextPos < 0.45) {
        if (!this.store.isTimeCycleRunning()) {
          this.store.setTimeCycleRunning(true);
        }
        this.syncTimeSliderLive();
      } else {
        if (this.store.isTimeCycleRunning()) {
          this.store.setTimeCycleRunning(false);
        }
        const nextHour = timeSliderPosToHour(Math.max(1, nextPos));
        this.store.setTimeHour(nextHour, { recordHistory: commitHistory });
        this.syncTimeSliderLive();
      }
    };

    let dragging = false;
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      track.setPointerCapture(e.pointerId);
      orb.classList.add('dragging');
      applyClientX(e.clientX, false);
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyClientX(e.clientX, false);
    });
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      orb.classList.remove('dragging');
      if (track.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('keydown', (e) => {
      const curIdx = this.store.isTimeCycleRunning()
        ? 0
        : Math.round(hourToTimeSliderPos(this.store.getTimeHour(), false));
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIdx = Math.min(TIME_STOPS.length - 1, curIdx + 1);
        this.selectTimeStop(nextIdx);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = Math.max(0, curIdx - 1);
        this.selectTimeStop(nextIdx);
      }
    });

    card.appendChild(track);

    const iconsRow = document.createElement('div');
    iconsRow.className = 'sb-slider-stops';
    this.timeStopBtns = [];
    const activeIdx = running ? 0 : Math.round(pos);

    TIME_STOPS.forEach((stop, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === activeIdx ? 'sb-stop-btn active' : 'sb-stop-btn';
      btn.title = stop.label;
      btn.setAttribute('aria-label', stop.label);
      btn.appendChild(createStorybookIconEl(stop.icon, 24));
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.selectTimeStop(idx);
      });
      this.timeStopBtns.push(btn);
      iconsRow.appendChild(btn);
    });

    card.appendChild(iconsRow);
    return card;
  }

  private selectTimeStop(idx: number): void {
    const stop = TIME_STOPS[idx];
    if (!stop) return;
    if (stop.id === 'running') {
      this.store.setTimeCycleRunning(true);
    } else {
      this.store.setTimeCycleRunning(false);
      this.store.setTimeHour(stop.hour ?? 12);
    }
    this.syncTimeSliderLive();
  }

  private buildStorybookWeatherSlider(activeWeatherId: string): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'sb-slider-card';

    const activeIdx = Math.max(
      0,
      WEATHER_SLIDER_ORDER.findIndex((w) => w.id === activeWeatherId),
    );

    const track = document.createElement('div');
    track.className = 'sb-slider-track';
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', 'Weather');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(WEATHER_SLIDER_ORDER.length - 1));
    track.setAttribute('aria-valuenow', String(activeIdx));
    track.setAttribute(
      'aria-valuetext',
      (WEATHER_SLIDER_ORDER[activeIdx] ?? WEATHER_SLIDER_ORDER[0]).label,
    );
    this.weatherTrackEl = track;

    const rail = document.createElement('div');
    rail.className = 'sb-slider-rail';
    track.appendChild(rail);

    for (let i = 0; i < WEATHER_SLIDER_ORDER.length; i++) {
      const tick = document.createElement('span');
      tick.className = 'sb-slider-tick';
      const halfCol = 50 / WEATHER_SLIDER_ORDER.length;
      const pct = halfCol + (i / (WEATHER_SLIDER_ORDER.length - 1)) * (100 - halfCol * 2);
      tick.style.left = `${pct}%`;
      track.appendChild(tick);
    }

    const orb = document.createElement('div');
    orb.className = 'sb-slider-orb';
    this.positionOrbAlongNotches(orb, activeIdx, WEATHER_SLIDER_ORDER.length);
    this.weatherThumbEl = orb;
    track.appendChild(orb);

    const applyClientX = (clientX: number) => {
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * (WEATHER_SLIDER_ORDER.length - 1));
      const chosen = WEATHER_SLIDER_ORDER[idx];
      if (chosen && chosen.id !== this.store.getState().weatherId) {
        this.audioModule?.playUiClick();
        this.store.setWeather(chosen.id);
      }
    };

    let dragging = false;
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      track.setPointerCapture(e.pointerId);
      orb.classList.add('dragging');
      applyClientX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyClientX(e.clientX);
    });
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      orb.classList.remove('dragging');
      if (track.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('keydown', (e) => {
      const curIdx = Math.max(
        0,
        WEATHER_SLIDER_ORDER.findIndex((w) => w.id === this.store.getState().weatherId),
      );
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = WEATHER_SLIDER_ORDER[Math.min(WEATHER_SLIDER_ORDER.length - 1, curIdx + 1)];
        if (next) this.store.setWeather(next.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const prev = WEATHER_SLIDER_ORDER[Math.max(0, curIdx - 1)];
        if (prev) this.store.setWeather(prev.id);
      }
    });

    card.appendChild(track);

    // 5 illustrated weather icons ONLY (zero text below!)
    const iconsRow = document.createElement('div');
    iconsRow.className = 'sb-slider-stops';
    this.weatherStopBtns = [];
    WEATHER_SLIDER_ORDER.forEach((w, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === activeIdx ? 'sb-stop-btn active' : 'sb-stop-btn';
      btn.title = w.label;
      btn.setAttribute('aria-label', w.label);
      btn.appendChild(createStorybookIconEl(w.icon, 24));
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setWeather(w.id);
      });
      this.weatherStopBtns.push(btn);
      iconsRow.appendChild(btn);
    });

    card.appendChild(iconsRow);
    return card;
  }

  private renderAtmospherePopover(): void {
    const state = this.store.getState();
    const activeView =
      this.sceneryModule?.getActiveView() ??
      this.store.data.viewsById.get(state.sceneryViewId) ??
      this.store.data.scenery.views[0];
    const activeWeather =
      this.sceneryModule?.getActiveWeather() ??
      this.store.data.weathersById.get(state.weatherId) ??
      this.store.data.scenery.weathers[0];

    this.atmospherePopoverEl.innerHTML = '';

    // 1. Time of Day Storybook Slider (Running · Dawn · Day · Dusk · Night)
    this.atmospherePopoverEl.appendChild(this.buildStorybookTimeSlider());

    // 2. Weather Storybook Slider (5 illustrated icons only!)
    this.atmospherePopoverEl.appendChild(this.buildStorybookWeatherSlider(activeWeather.id));

    // 3. Location Icon Row (7 illustrated pastel+ink icons!)
    const locRow = document.createElement('div');
    locRow.className = 'sb-location-row';
    for (const view of this.store.data.scenery.views) {
      const isSelected = view.id === activeView.id;
      const isBackrooms = view.id === 'backrooms';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'sb-loc-btn active' : 'sb-loc-btn';
      if (isBackrooms) {
        btn.classList.add('is-backrooms');
        btn.title = 'Level 0 · Something arrives when 5+ guests gather';
      } else {
        btn.title = `${view.name} — ${view.description}`;
      }
      btn.setAttribute('aria-label', view.name);
      btn.appendChild(createStorybookIconEl(getLocationStorybookIconName(view.id), 24));
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.switchLocationWithTransition(view.id);
      });
      locRow.appendChild(btn);
    }
    this.atmospherePopoverEl.appendChild(locRow);

    // 4. Visual Shader Style Switcher (6 illustrated icon-only buttons)
    const activeShader = this.sceneManager.getShaderPreset?.() ?? 'default';
    const shaderRow = document.createElement('div');
    shaderRow.className = 'sb-shader-row';
    shaderRow.setAttribute('role', 'group');
    shaderRow.setAttribute('aria-label', 'Visual shader style');
    this.shaderStyleBtns.clear();
    for (const style of SHADER_STYLES) {
      const isSelected = style.id === activeShader;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'sb-shader-btn active' : 'sb-shader-btn';
      btn.title = style.label;
      btn.setAttribute('aria-label', style.label);
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.appendChild(createStorybookIconEl(getShaderStorybookIconName(style.id), 24));
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.sceneManager.setShaderPreset?.(style.id);
        this.syncShaderButtonsLive();
      });
      this.shaderStyleBtns.set(style.id, btn);
      shaderRow.appendChild(btn);
    }
    this.atmospherePopoverEl.appendChild(shaderRow);

    // 5. Lightbulb Switch + Ceiling toggle
    const anyOn = this.store.areAnyLightsActive();
    const lightRow = document.createElement('div');
    lightRow.className = 'sb-light-switch-row';

    const bulbIcon = createStorybookIconEl(anyOn ? 'bulb_on' : 'bulb_off', 26);

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = anyOn ? 'sb-toggle-switch on' : 'sb-toggle-switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', String(anyOn));
    switchBtn.setAttribute('aria-label', anyOn ? 'Turn all lights off' : 'Turn all lights on');
    switchBtn.title = anyOn ? 'Lights On — click to turn all off' : 'Lights Off — click to turn all on';

    const knob = document.createElement('span');
    knob.className = 'sb-toggle-knob';
    switchBtn.appendChild(knob);

    const toggleLights = () => {
      this.audioModule?.playUiClick();
      const target = !this.store.areAnyLightsActive();
      const changed = this.store.setAllLightsActive(target);
      if (target && changed === 0 && !this.store.areAnyLightsActive()) {
        this.store.notify('Place a lamp or light first', 'info');
      }
      this.renderAtmospherePopover();
    };
    switchBtn.addEventListener('click', toggleLights);

    const bulbBtn = document.createElement('button');
    bulbBtn.type = 'button';
    bulbBtn.className = 'sb-bulb-trigger';
    bulbBtn.title = switchBtn.title;
    bulbBtn.appendChild(bulbIcon);
    bulbBtn.addEventListener('click', toggleLights);

    const ceilingOn = this.store.isCeilingVisible();
    const ceilingBtn = this.makeBtn(
      ceilingOn ? 'Ceiling On' : 'Ceiling Off',
      () => {
        this.audioModule?.playUiClick();
        this.store.setCeilingVisible(!this.store.isCeilingVisible());
      },
      ceilingOn ? 'primary' : undefined,
    );
    ceilingBtn.className = ceilingOn
      ? 'btn primary btn-xs ceiling-toggle-btn'
      : 'btn btn-xs ceiling-toggle-btn';

    const leftPair = document.createElement('div');
    leftPair.className = 'sb-bulb-pair';
    leftPair.append(bulbBtn, switchBtn);

    lightRow.append(leftPair, ceilingBtn);
    this.atmospherePopoverEl.appendChild(lightRow);

    // 6. Separated Audio Mix Controls (Music + Weather independent ink-rail sliders)
    if (this.audioModule) {
      this.atmospherePopoverEl.appendChild(this.buildAudioMixPanel(false));
    }
  }

  private syncShaderButtonsLive(): void {
    const activeShader = this.sceneManager.getShaderPreset?.() ?? 'default';
    for (const [id, btn] of this.shaderStyleBtns) {
      if (!btn.isConnected) continue;
      const on = id === activeShader;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  private createInkRailSlider(opts: {
    ariaLabel: string;
    initial: number;
    getValue: () => number;
    onChange: (next: number) => void;
  }): { track: HTMLDivElement; orb: HTMLDivElement; pct: HTMLSpanElement } {
    const track = document.createElement('div');
    track.className = 'sb-vol-track';
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', opts.ariaLabel);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(opts.initial * 100)));

    const rail = document.createElement('div');
    rail.className = 'sb-vol-rail';
    const orb = document.createElement('div');
    orb.className = 'sb-slider-orb small';
    orb.style.left = `${Math.round(opts.initial * 100)}%`;
    track.append(rail, orb);

    const pct = document.createElement('span');
    pct.className = 'volume-pct tabular-num';
    pct.textContent = `${Math.round(opts.initial * 100)}%`;

    const applyClientX = (clientX: number) => {
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const p = Math.round(next * 100);
      orb.style.left = `${p}%`;
      pct.textContent = `${p}%`;
      track.setAttribute('aria-valuenow', String(p));
      opts.onChange(next);
    };

    let dragging = false;
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      track.setPointerCapture(e.pointerId);
      orb.classList.add('dragging');
      applyClientX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyClientX(e.clientX);
    });
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      orb.classList.remove('dragging');
      if (track.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('keydown', (e) => {
      const cur = opts.getValue();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        opts.onChange(Math.min(1, cur + 0.05));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        opts.onChange(Math.max(0, cur - 0.05));
      }
    });

    return { track, orb, pct };
  }

  private buildAudioMixPanel(includeMaster: boolean): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'sb-audio-card';

    // 1. Music channel: Music icon toggle + vibe pill + independent ink-rail slider
    const musicEnabled = this.audioModule?.isMusicEnabled() ?? true;
    const musicVol = this.audioModule?.getMusicVolume() ?? 0.65;
    const musicEff = musicEnabled ? musicVol : 0;
    const theme = this.audioModule?.getMusicTheme() ?? 'cafe';
    const vibeLabel = MUSIC_THEME_LABELS[theme] ?? 'Café';

    const musicRow = document.createElement('div');
    musicRow.className = 'sb-audio-channel-row';

    const musicIconBtn = document.createElement('button');
    musicIconBtn.type = 'button';
    musicIconBtn.className = 'sb-audio-icon-btn';
    musicIconBtn.title = musicEff > 0.01 ? `Music On (${vibeLabel}) — click to mute` : 'Music Off — click to play';
    musicIconBtn.setAttribute('aria-label', musicEff > 0.01 ? 'Mute music' : 'Unmute music');
    musicIconBtn.appendChild(createStorybookIconEl(musicEff > 0.01 ? 'music_on' : 'music_off', 22));

    const vibeEl = document.createElement('span');
    vibeEl.className = musicEff > 0.01 ? 'sb-music-vibe' : 'sb-music-vibe muted';
    vibeEl.textContent = vibeLabel;

    const musicSlider = this.createInkRailSlider({
      ariaLabel: 'Music volume',
      initial: musicEff,
      getValue: () => (this.audioModule?.isMusicEnabled() ? (this.audioModule?.getMusicVolume() ?? 0.65) : 0),
      onChange: (next) => {
        if (!this.audioModule) return;
        if (next > 0 && this.audioModule.isMuted()) {
          this.audioModule.setMuted(false);
        }
        if (next <= 0.005) {
          this.audioModule.setMusicVolume(0);
          this.audioModule.setMusicEnabled(false);
        } else {
          this.audioModule.setMusicVolume(next);
          if (!this.audioModule.isMusicEnabled()) {
            this.audioModule.setMusicEnabled(true);
          }
        }
      },
    });

    musicIconBtn.addEventListener('click', () => {
      if (!this.audioModule) return;
      this.audioModule.playUiClick();
      const on = this.audioModule.isMusicEnabled() && this.audioModule.getMusicVolume() > 0.01;
      if (on) {
        this.audioModule.setMusicEnabled(false);
      } else {
        if (this.audioModule.getMusicVolume() <= 0.01) {
          this.audioModule.setMusicVolume(0.65);
        }
        this.audioModule.setMusicEnabled(true);
      }
      this.syncMusicControlsLive();
    });

    this.musicRowRefs = this.musicRowRefs.filter((r) => r.row.isConnected);
    this.musicRowRefs.push({
      row: musicRow,
      iconSlot: musicIconBtn,
      vibeEl,
      trackEl: musicSlider.track,
      orbEl: musicSlider.orb,
      pctEl: musicSlider.pct,
    });

    musicRow.append(musicIconBtn, vibeEl, musicSlider.track, musicSlider.pct);
    card.appendChild(musicRow);

    // 2. Weather channel: Cloud/Rain icon toggle (0 ↔ 0.75) + independent ink-rail slider
    const weatherVol = this.audioModule?.getWeatherVolume() ?? 0.75;
    const weatherRow = document.createElement('div');
    weatherRow.className = 'sb-audio-channel-row';

    const weatherIconBtn = document.createElement('button');
    weatherIconBtn.type = 'button';
    weatherIconBtn.className = weatherVol > 0.01 ? 'sb-audio-icon-btn' : 'sb-audio-icon-btn muted';
    weatherIconBtn.title = weatherVol > 0.01 ? 'Weather sound on — click to mute' : 'Weather sound off — click to restore';
    weatherIconBtn.setAttribute('aria-label', weatherVol > 0.01 ? 'Mute weather ambience' : 'Enable weather ambience');
    weatherIconBtn.appendChild(createStorybookIconEl(weatherVol > 0.01 ? 'weather_rain' : 'weather_fog', 22));

    const weatherSlider = this.createInkRailSlider({
      ariaLabel: 'Weather ambience volume',
      initial: weatherVol,
      getValue: () => this.audioModule?.getWeatherVolume() ?? 0.75,
      onChange: (next) => {
        if (!this.audioModule) return;
        if (next > 0 && this.audioModule.isMuted()) {
          this.audioModule.setMuted(false);
        }
        this.audioModule.setWeatherVolume(next);
      },
    });

    weatherIconBtn.addEventListener('click', () => {
      if (!this.audioModule) return;
      this.audioModule.playUiClick();
      const cur = this.audioModule.getWeatherVolume();
      this.audioModule.setWeatherVolume(cur > 0.01 ? 0 : 0.75);
      this.syncWeatherVolumeControlsLive();
    });

    this.weatherAudioRefs = this.weatherAudioRefs.filter((r) => r.row.isConnected);
    this.weatherAudioRefs.push({
      row: weatherRow,
      iconSlot: weatherIconBtn,
      trackEl: weatherSlider.track,
      orbEl: weatherSlider.orb,
      pctEl: weatherSlider.pct,
    });

    weatherRow.append(weatherIconBtn, weatherSlider.track, weatherSlider.pct);
    card.appendChild(weatherRow);

    // 3. Chatting / Chatter channel: speech toggle (0 ↔ 0.28) + label pill + ink-rail slider
    const chatterAudio = this.audioModule as
      | (AudioModule & {
          getChatterVolume?: () => number;
          setChatterVolume?: (vol: number) => void;
        })
      | undefined;
    const chatterVol = chatterAudio?.getChatterVolume?.() ?? 0.28;
    const chatterActive = chatterVol > 0.01;
    const chatterRow = document.createElement('div');
    chatterRow.className = 'sb-audio-channel-row';

    const chatterIconBtn = document.createElement('button');
    chatterIconBtn.type = 'button';
    chatterIconBtn.className = chatterActive ? 'sb-audio-icon-btn' : 'sb-audio-icon-btn muted';
    chatterIconBtn.title = chatterActive
      ? 'Visitor chatter volume — click to mute'
      : 'Visitor chatter muted — click to restore';
    chatterIconBtn.setAttribute(
      'aria-label',
      chatterActive
        ? 'Visitor chatter volume — click to mute'
        : 'Visitor chatter muted — click to restore',
    );
    const chatterGlyph = document.createElement('span');
    chatterGlyph.className = 'sb-audio-glyph';
    chatterGlyph.setAttribute('aria-hidden', 'true');
    chatterGlyph.textContent = '💬';
    chatterIconBtn.appendChild(chatterGlyph);

    const chatterLabel = document.createElement('span');
    chatterLabel.className = chatterActive ? 'sb-music-vibe' : 'sb-music-vibe muted';
    chatterLabel.textContent = 'Chat';

    const chatterSlider = this.createInkRailSlider({
      ariaLabel: 'Visitor chatting volume',
      initial: chatterVol,
      getValue: () => chatterAudio?.getChatterVolume?.() ?? 0.28,
      onChange: (next) => {
        if (!this.audioModule) return;
        if (next > 0 && this.audioModule.isMuted()) {
          this.audioModule.setMuted(false);
        }
        chatterAudio?.setChatterVolume?.(next);
      },
    });

    chatterIconBtn.addEventListener('click', () => {
      if (!this.audioModule) return;
      this.audioModule.playUiClick();
      const cur = chatterAudio?.getChatterVolume?.() ?? 0.28;
      const next = cur > 0.01 ? 0 : 0.28;
      if (next > 0 && this.audioModule.isMuted()) {
        this.audioModule.setMuted(false);
      }
      chatterAudio?.setChatterVolume?.(next);
      this.syncChatterVolumeControlsLive();
    });

    this.chatterAudioRefs = this.chatterAudioRefs.filter((r) => r.row.isConnected);
    this.chatterAudioRefs.push({
      row: chatterRow,
      iconSlot: chatterIconBtn,
      labelEl: chatterLabel,
      trackEl: chatterSlider.track,
      orbEl: chatterSlider.orb,
      pctEl: chatterSlider.pct,
    });

    chatterRow.append(chatterIconBtn, chatterLabel, chatterSlider.track, chatterSlider.pct);
    card.appendChild(chatterRow);

    // 4. Optional Master volume row (in Menu popover)
    if (includeMaster) {
      const masterVol = this.audioModule?.getVolume() ?? 0.85;
      const masterRow = document.createElement('div');
      masterRow.className = 'sb-audio-channel-row';

      const masterIcon = document.createElement('span');
      masterIcon.className = 'sb-audio-icon-static';
      masterIcon.title = 'Master volume';
      masterIcon.appendChild(createIconEl('volume', 16));

      const masterSlider = this.createInkRailSlider({
        ariaLabel: 'Master volume',
        initial: masterVol,
        getValue: () => this.audioModule?.getVolume() ?? 0.85,
        onChange: (next) => {
          if (!this.audioModule) return;
          if (next > 0 && this.audioModule.isMuted()) {
            this.audioModule.setMuted(false);
          }
          this.audioModule.setVolume(next);
        },
      });

      this.volumeThumbEls = this.volumeThumbEls.filter((el) => el.isConnected);
      this.volumeValueEls = this.volumeValueEls.filter((el) => el.isConnected);
      this.volumeThumbEls.push(masterSlider.orb);
      this.volumeValueEls.push(masterSlider.pct);

      masterRow.append(masterIcon, masterSlider.track, masterSlider.pct);
      card.appendChild(masterRow);
    }

    return card;
  }

  private syncMusicControlsLive(): void {
    const enabled = this.audioModule?.isMusicEnabled() ?? true;
    const vol = this.audioModule?.getMusicVolume() ?? 0.65;
    const eff = enabled ? vol : 0;
    const pct = Math.round(eff * 100);
    const active = eff > 0.01;
    const theme = this.audioModule?.getMusicTheme() ?? 'cafe';
    const vibeLabel = MUSIC_THEME_LABELS[theme] ?? 'Café';

    this.musicRowRefs = this.musicRowRefs.filter((r) => r.row.isConnected);
    for (const ref of this.musicRowRefs) {
      ref.iconSlot.innerHTML = '';
      ref.iconSlot.appendChild(createStorybookIconEl(active ? 'music_on' : 'music_off', 22));
      ref.iconSlot.title = active
        ? `Music On (${vibeLabel}) — click to mute`
        : 'Music Off — click to play';
      ref.iconSlot.setAttribute('aria-label', active ? 'Mute music' : 'Unmute music');
      ref.vibeEl.textContent = vibeLabel;
      ref.vibeEl.classList.toggle('muted', !active);
      ref.orbEl.style.left = `${pct}%`;
      ref.pctEl.textContent = `${pct}%`;
      ref.trackEl.setAttribute('aria-valuenow', String(pct));
    }
  }

  private syncWeatherVolumeControlsLive(): void {
    const vol = this.audioModule?.getWeatherVolume() ?? 0.75;
    const pct = Math.round(vol * 100);
    const active = vol > 0.01;

    this.weatherAudioRefs = this.weatherAudioRefs.filter((r) => r.row.isConnected);
    for (const ref of this.weatherAudioRefs) {
      ref.iconSlot.innerHTML = '';
      ref.iconSlot.appendChild(createStorybookIconEl(active ? 'weather_rain' : 'weather_fog', 22));
      ref.iconSlot.classList.toggle('muted', !active);
      ref.iconSlot.title = active
        ? 'Weather sound on — click to mute'
        : 'Weather sound off — click to restore';
      ref.iconSlot.setAttribute(
        'aria-label',
        active ? 'Mute weather ambience' : 'Enable weather ambience',
      );
      ref.orbEl.style.left = `${pct}%`;
      ref.pctEl.textContent = `${pct}%`;
      ref.trackEl.setAttribute('aria-valuenow', String(pct));
    }
  }

  private syncChatterVolumeControlsLive(): void {
    const chatterAudio = this.audioModule as
      | (AudioModule & { getChatterVolume?: () => number })
      | undefined;
    const vol = chatterAudio?.getChatterVolume?.() ?? 0.28;
    const pct = Math.round(vol * 100);
    const active = vol > 0.01;

    this.chatterAudioRefs = this.chatterAudioRefs.filter((r) => r.row.isConnected);
    for (const ref of this.chatterAudioRefs) {
      ref.iconSlot.classList.toggle('muted', !active);
      const tip = active
        ? 'Visitor chatter volume — click to mute'
        : 'Visitor chatter muted — click to restore';
      ref.iconSlot.title = tip;
      ref.iconSlot.setAttribute('aria-label', tip);
      ref.labelEl.classList.toggle('muted', !active);
      ref.orbEl.style.left = `${pct}%`;
      ref.pctEl.textContent = `${pct}%`;
      ref.trackEl.setAttribute('aria-valuenow', String(pct));
    }
  }

  private syncVolumeSlidersLive(): void {
    const pct = Math.round((this.audioModule?.getVolume() ?? 0.85) * 100);
    for (const orb of this.volumeThumbEls) {
      if (orb.isConnected) {
        orb.style.left = `${pct}%`;
      }
    }
    for (const v of this.volumeValueEls) {
      if (v.isConnected) {
        v.textContent = `${pct}%`;
      }
    }
  }

  private appendWallCeilingControls(parent: HTMLElement): void {
    const title = document.createElement('div');
    title.className = 'popover-section-label';
    title.textContent = 'Walls & Ceiling';
    parent.appendChild(title);

    const wrap = document.createElement('div');
    wrap.className = 'wall-ceiling-panel';

    const activeMode = this.store.getWallViewMode();
    const modeRow = document.createElement('div');
    modeRow.className = 'wall-view-seg';
    modeRow.setAttribute('role', 'group');
    modeRow.setAttribute('aria-label', 'Wall cutaway mode');

    for (const opt of WALL_VIEW_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = opt.id === activeMode ? 'wall-view-opt active' : 'wall-view-opt';
      btn.textContent = opt.label;
      btn.title = opt.fullLabel;
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setWallViewMode(opt.id);
      });
      modeRow.appendChild(btn);
    }

    const ceilingOn = this.store.isCeilingVisible();
    const ceilingBtn = this.makeBtn(
      ceilingOn ? 'Ceiling On' : 'Ceiling Off',
      () => {
        this.audioModule?.playUiClick();
        this.store.setCeilingVisible(!this.store.isCeilingVisible());
      },
      ceilingOn ? 'primary' : undefined,
    );
    ceilingBtn.className = ceilingOn
      ? 'btn primary btn-xs ceiling-toggle-btn'
      : 'btn btn-xs ceiling-toggle-btn';

    wrap.append(modeRow, ceilingBtn);
    parent.appendChild(wrap);
  }

  private positionWallsPopover(): void {
    if (!this.wallsPopoverEl || !this.wallViewBtnEl) return;
    const btnRect = this.wallViewBtnEl.getBoundingClientRect();
    const popWidth = 224;
    const centeredLeft = btnRect.left + btnRect.width / 2 - popWidth / 2;
    const clampedLeft = Math.max(14, Math.min(window.innerWidth - popWidth - 14, centeredLeft));
    this.wallsPopoverEl.style.left = `${Math.round(clampedLeft)}px`;
  }

  private renderWallsPopover(): void {
    const activeMode = this.store.getWallViewMode();
    const ceilingOn = this.store.isCeilingVisible();
    const cutawayOpacity = this.store.getWallCutawayOpacity();
    this.wallsPopoverEl.innerHTML = '';
    this.wallModeRefs.clear();
    this.wallCeilingSwitchBtn = null;
    this.wallOpacitySliderRef = null;

    const options: Array<{ mode: WallViewMode; label: string }> = [
      { mode: 'auto', label: 'Auto Cutaway' },
      { mode: 'translucent', label: 'Transparent' },
      { mode: 'solid', label: 'Solid Walls' },
    ];

    const list = document.createElement('div');
    list.className = 'walls-mode-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', 'Wall visibility modes');

    for (const opt of options) {
      const isSelected = opt.mode === activeMode;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'wall-mode-option active' : 'wall-mode-option';
      btn.setAttribute('role', 'menuitemradio');
      btn.setAttribute('aria-checked', String(isSelected));
      btn.appendChild(createStorybookIconEl(getWallViewStorybookIconName(opt.mode), 25));

      const lbl = document.createElement('span');
      lbl.className = 'wall-mode-label';
      lbl.textContent = opt.label;
      btn.appendChild(lbl);

      const checkEl = createIconEl('check', 15);
      checkEl.classList.add('wall-mode-check');
      checkEl.classList.toggle('hidden', !isSelected);
      btn.appendChild(checkEl);

      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setWallViewMode(opt.mode);
        const meta = WALL_VIEW_OPTIONS.find((o) => o.id === opt.mode);
        if (meta) this.store.notify(meta.fullLabel, 'info');
        this.setActivePopover(null);
      });

      this.wallModeRefs.set(opt.mode, { btn, checkEl });
      list.appendChild(btn);
    }
    this.wallsPopoverEl.appendChild(list);

    const dividerTop = document.createElement('div');
    dividerTop.className = 'walls-dropdown-divider';
    this.wallsPopoverEl.appendChild(dividerTop);

    // Compact storybook ink-rail Wall Opacity slider (0% invisible → 100% solid)
    const opacityBlock = document.createElement('div');
    opacityBlock.className = 'walls-opacity-block';

    const opacityHead = document.createElement('div');
    opacityHead.className = 'walls-opacity-head';

    const opacityLabel = document.createElement('span');
    opacityLabel.className = 'walls-opacity-label';
    opacityLabel.textContent = 'Opacity';

    const opacitySlider = this.createInkRailSlider({
      ariaLabel: 'Wall opacity',
      initial: cutawayOpacity,
      getValue: () => this.store.getWallCutawayOpacity(),
      onChange: (next) => {
        this.store.setWallCutawayOpacity(next);
        if (this.store.getWallViewMode() === 'solid') {
          this.store.setWallViewMode('auto');
        }
      },
    });
    opacitySlider.pct.classList.add('walls-opacity-pct');
    this.wallOpacitySliderRef = opacitySlider;

    opacityHead.append(opacityLabel, opacitySlider.pct);

    const railWrap = document.createElement('div');
    railWrap.className = 'walls-opacity-rail-wrap';
    railWrap.appendChild(opacitySlider.track);

    opacityBlock.append(opacityHead, railWrap);
    this.wallsPopoverEl.appendChild(opacityBlock);

    const dividerBottom = document.createElement('div');
    dividerBottom.className = 'walls-dropdown-divider';
    this.wallsPopoverEl.appendChild(dividerBottom);

    const ceilingRow = document.createElement('div');
    ceilingRow.className = 'walls-ceiling-row';

    const ceilingLabel = document.createElement('span');
    ceilingLabel.className = 'walls-ceiling-label';
    ceilingLabel.textContent = 'Ceiling';

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = ceilingOn ? 'sb-toggle-switch on' : 'sb-toggle-switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', String(ceilingOn));
    switchBtn.setAttribute('aria-label', ceilingOn ? 'Hide ceiling' : 'Show ceiling');
    const knob = document.createElement('span');
    knob.className = 'sb-toggle-knob';
    switchBtn.appendChild(knob);

    switchBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setCeilingVisible(!this.store.isCeilingVisible());
    });

    this.wallCeilingSwitchBtn = switchBtn;
    ceilingRow.append(ceilingLabel, switchBtn);
    this.wallsPopoverEl.appendChild(ceilingRow);
  }

  private syncWallsPopoverLive(): void {
    if (!this.wallsPopoverEl || this.activePopover !== 'walls') return;
    if (!this.wallOpacitySliderRef || !this.wallOpacitySliderRef.track.isConnected) {
      this.renderWallsPopover();
      return;
    }

    const activeMode = this.store.getWallViewMode();
    for (const [mode, { btn, checkEl }] of this.wallModeRefs) {
      const isSelected = mode === activeMode;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-checked', String(isSelected));
      checkEl.classList.toggle('hidden', !isSelected);
    }

    const pct = Math.round(this.store.getWallCutawayOpacity() * 100);
    this.wallOpacitySliderRef.orb.style.left = `${pct}%`;
    this.wallOpacitySliderRef.pct.textContent = `${pct}%`;
    this.wallOpacitySliderRef.track.setAttribute('aria-valuenow', String(pct));

    if (this.wallCeilingSwitchBtn && this.wallCeilingSwitchBtn.isConnected) {
      const ceilingOn = this.store.isCeilingVisible();
      this.wallCeilingSwitchBtn.classList.toggle('on', ceilingOn);
      this.wallCeilingSwitchBtn.setAttribute('aria-checked', String(ceilingOn));
      this.wallCeilingSwitchBtn.setAttribute(
        'aria-label',
        ceilingOn ? 'Hide ceiling' : 'Show ceiling',
      );
    }
  }

  private syncWallViewButton(): void {
    if (!this.wallViewBtnEl || !this.wallViewIconSlotEl) return;
    const mode = this.store.getWallViewMode();
    const meta = WALL_VIEW_OPTIONS.find((o) => o.id === mode) ?? WALL_VIEW_OPTIONS[0];
    const iconName = getWallViewStorybookIconName(mode);
    if (this.wallViewIconSlotEl.dataset.icon !== iconName) {
      this.wallViewIconSlotEl.dataset.icon = iconName;
      this.wallViewIconSlotEl.innerHTML = '';
      this.wallViewIconSlotEl.appendChild(createStorybookIconEl(iconName, 22));
    }
    const tooltip =
      mode === 'translucent'
        ? 'Walls: Transparent'
        : mode === 'solid'
          ? 'Walls: Solid'
          : 'Walls: Auto';
    const isOpen = this.activePopover === 'walls';
    this.wallViewBtnEl.dataset.tooltip = tooltip;
    this.wallViewBtnEl.removeAttribute('title');
    this.wallViewBtnEl.setAttribute('aria-label', `${meta.fullLabel} — open wall & ceiling options`);
    this.wallViewBtnEl.setAttribute('aria-expanded', String(isOpen));
    this.wallViewBtnEl.classList.toggle('active-trigger', isOpen);
    this.wallViewBtnEl.classList.toggle('wall-translucent-state', mode === 'translucent');
    this.wallViewBtnEl.classList.toggle('wall-solid-state', mode === 'solid');
  }

  private getCameraViewMode(): HudCameraViewMode {
    return (this.sceneManager as PovSceneManager).getCameraViewMode?.() ?? 'isometric';
  }

  private getPovTargetId(): string | null {
    return (this.sceneManager as PovSceneManager).getPovTargetId?.() ?? null;
  }

  private getPovCandidates(): HudPovCandidate[] {
    return (this.visitorModule as PovVisitorModule | undefined)?.getPovCandidates?.() ?? [];
  }

  private enterPersonPovMode(id: string): void {
    const povSm = this.sceneManager as PovSceneManager;
    const povVm = this.visitorModule as PovVisitorModule | undefined;
    if (!povSm.enterVisitorPov || !povVm?.getPovPoseForPerson) return;
    if (!povVm.getPovPoseForPerson(id)) {
      this.store.notify('That person is no longer available for POV.', 'info');
      return;
    }
    this.setActivePopover(null);
    this.clearSelectedVisitor();
    povVm.setPovHiddenPerson?.(id);
    povSm.enterVisitorPov(
      id,
      () => povVm.getPovPoseForPerson?.(id) ?? null,
      () => {
        povVm.setPovHiddenPerson?.(null);
      },
    );
  }

  private enterAngelPovMode(): void {
    const povSm = this.sceneManager as PovSceneManager;
    const povVm = this.visitorModule as PovVisitorModule | undefined;
    if (!povSm.enterAngelPov) return;
    this.setActivePopover(null);
    this.clearSelectedVisitor();
    povVm?.setPovHiddenPerson?.(null);
    povSm.enterAngelPov();
  }

  private exitPovModeCleanly(): void {
    const povSm = this.sceneManager as PovSceneManager;
    const povVm = this.visitorModule as PovVisitorModule | undefined;
    povVm?.setPovHiddenPerson?.(null);
    povSm.exitPovMode?.();
  }

  private syncViewButton(): void {
    if (!this.viewBtnEl || !this.viewIconSlotEl) return;
    const mode = this.getCameraViewMode();
    const isOpen = this.activePopover === 'view';
    const inPov = mode !== 'isometric';
    const iconName: StorybookIconName = mode === 'angel_pov' ? 'angel_pov' : 'camera_pov';
    if (this.viewIconSlotEl.dataset.icon !== iconName) {
      this.viewIconSlotEl.dataset.icon = iconName;
      this.viewIconSlotEl.innerHTML = '';
      this.viewIconSlotEl.appendChild(createStorybookIconEl(iconName, 22));
    }
    this.viewBtnEl.dataset.tooltip =
      mode === 'angel_pov'
        ? 'Angel’s POV active · Click to switch view'
        : mode === 'visitor_pov'
          ? 'First-Person POV active · Click to switch view'
          : 'Camera View · View from a guest or Angel’s POV';
    this.viewBtnEl.removeAttribute('title');
    this.viewBtnEl.setAttribute('aria-expanded', String(isOpen));
    this.viewBtnEl.classList.toggle('active-trigger', isOpen || inPov);
    this.viewBtnEl.classList.toggle('in-pov', inPov);
  }

  private positionViewPopover(): void {
    if (!this.viewPopoverEl || !this.viewBtnEl) return;
    const btnRect = this.viewBtnEl.getBoundingClientRect();
    const popWidth = 286;
    const centeredLeft = btnRect.left + btnRect.width / 2 - popWidth / 2;
    const clampedLeft = Math.max(14, Math.min(window.innerWidth - popWidth - 14, centeredLeft));
    this.viewPopoverEl.style.left = `${Math.round(clampedLeft)}px`;
  }

  private renderViewPopover(): void {
    const prevScroll =
      (this.viewPopoverEl.querySelector('.pov-person-list') as HTMLElement | null)?.scrollTop ?? 0;
    this.viewPopoverEl.innerHTML = '';

    const mode = this.getCameraViewMode();
    const targetId = this.getPovTargetId();

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Camera View';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.viewPopoverEl.appendChild(header);

    const modeList = document.createElement('div');
    modeList.className = 'pov-mode-list';
    modeList.setAttribute('role', 'menu');
    modeList.setAttribute('aria-label', 'Camera view modes');

    const makeModeCard = (
      iconName: StorybookIconName,
      titleText: string,
      subtitleText: string,
      isActive: boolean,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isActive ? 'pov-mode-btn active' : 'pov-mode-btn';
      btn.setAttribute('role', 'menuitemradio');
      btn.setAttribute('aria-checked', String(isActive));

      btn.appendChild(createStorybookIconEl(iconName, 24));

      const textWrap = document.createElement('span');
      textWrap.className = 'pov-mode-text';
      const titleEl = document.createElement('span');
      titleEl.className = 'pov-mode-title';
      titleEl.textContent = titleText;
      const subEl = document.createElement('span');
      subEl.className = 'pov-mode-sub';
      subEl.textContent = subtitleText;
      textWrap.append(titleEl, subEl);
      btn.appendChild(textWrap);

      if (isActive) {
        btn.appendChild(createIconEl('check', 15));
      }

      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        onClick();
      });
      return btn;
    };

    modeList.append(
      makeModeCard(
        'wall_auto',
        'Isometric',
        'Default architectural view',
        mode === 'isometric',
        () => {
          this.exitPovModeCleanly();
          this.setActivePopover(null);
        },
      ),
      makeModeCard(
        'angel_pov',
        '🪽 Angel’s POV',
        'Free-fly around the house · Bounded',
        mode === 'angel_pov',
        () => {
          this.enterAngelPovMode();
        },
      ),
    );
    this.viewPopoverEl.appendChild(modeList);

    const viewFromLabel = document.createElement('div');
    viewFromLabel.className = 'popover-section-label';
    viewFromLabel.textContent = 'View From';
    this.viewPopoverEl.appendChild(viewFromLabel);

    const candidates = this.getPovCandidates();
    if (candidates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pov-empty-note';
      empty.textContent =
        'No guests or staff in the house yet. Keep your door Open or invite someone to see through their eyes!';
      this.viewPopoverEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'pov-person-list';

    for (const cand of candidates) {
      const isViewing = mode === 'visitor_pov' && targetId === cand.id;
      const row = document.createElement('div');
      row.className = isViewing ? 'pov-person-row viewing' : 'pov-person-row';

      let avatarEl: HTMLElement;
      if (cand.kind === 'visitor' && cand.visitorId) {
        const def = this.store.data.visitorsById.get(cand.visitorId);
        avatarEl = this.createVisitorPortrait(
          def,
          cand.variantIndex ?? 0,
          cand.color,
          cand.visitorId,
        );
      } else {
        const staffAvatar = document.createElement('div');
        staffAvatar.className = 'pov-staff-avatar';
        staffAvatar.style.background = `color-mix(in srgb, ${cand.color || '#E8BFA8'} 38%, #FCF9F2)`;
        if (cand.icon === '🤖') {
          staffAvatar.appendChild(createStorybookIconEl('staff_bot', 22));
        } else {
          staffAvatar.textContent = cand.icon || '🧑‍🍳';
        }
        avatarEl = staffAvatar;
      }

      const info = document.createElement('div');
      info.className = 'pov-person-info';
      const nameRow = document.createElement('div');
      nameRow.className = 'pov-person-name';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pov-person-name-text';
      nameSpan.textContent = cand.name;
      nameRow.appendChild(nameSpan);

      if (cand.isSpecial) {
        const star = document.createElement('span');
        star.className = 'special-sparkle-badge';
        star.textContent = '✦';
        nameRow.appendChild(star);
      }
      if (cand.kind === 'staff') {
        const staffPill = document.createElement('span');
        staffPill.className = 'pov-staff-pill';
        staffPill.textContent = 'Staff';
        nameRow.appendChild(staffPill);
      }
      info.appendChild(nameRow);

      if (isViewing) {
        const viewingPill = document.createElement('span');
        viewingPill.className = 'pov-viewing-pill';
        viewingPill.textContent = 'Viewing';
        row.append(avatarEl, info, viewingPill);
      } else {
        const povBtn = this.makeBtn(
          'POV',
          () => {
            this.audioModule?.playUiClick();
            this.enterPersonPovMode(cand.id);
          },
          'primary',
        );
        povBtn.className = 'btn primary btn-xs';
        povBtn.setAttribute('aria-label', `View from ${cand.name}'s POV`);
        row.append(avatarEl, info, povBtn);
      }

      list.appendChild(row);
    }

    this.viewPopoverEl.appendChild(list);
    if (prevScroll > 0) {
      list.scrollTop = prevScroll;
    }
  }

  private renderPovBanner(): void {
    if (!this.povBannerEl) return;
    const mode = this.getCameraViewMode();
    if (mode === 'isometric') {
      this.povBannerEl.classList.add('hidden');
      this.povBannerEl.innerHTML = '';
      return;
    }

    this.povBannerEl.classList.remove('hidden');
    this.povBannerEl.innerHTML = '';

    if (mode === 'visitor_pov') {
      const targetId = this.getPovTargetId();
      const candidates = this.getPovCandidates();
      const currentIdx = candidates.findIndex((c) => c.id === targetId);
      const currentCand = currentIdx >= 0 ? candidates[currentIdx] : null;
      const fallbackSnap = targetId
        ? this.visitorModule?.getActiveVisitorById(targetId)
        : undefined;
      const personName =
        currentCand?.name ?? fallbackSnap?.name ?? fallbackSnap?.archetypeName ?? 'Guest';

      const title = document.createElement('span');
      title.className = 'pov-banner-title';
      title.textContent = `👁 ${personName}`;
      this.povBannerEl.appendChild(title);

      if (candidates.length > 1) {
        const cycleWrap = document.createElement('div');
        cycleWrap.className = 'pov-cycle-group';
        const stepCandidate = (delta: number) => {
          const liveCands = this.getPovCandidates();
          if (liveCands.length === 0) return;
          const idx = liveCands.findIndex((c) => c.id === this.getPovTargetId());
          const base = idx >= 0 ? idx : 0;
          const next = liveCands[(base + delta + liveCands.length) % liveCands.length];
          if (next) this.enterPersonPovMode(next.id);
        };

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'btn btn-xs pov-cycle-btn';
        prevBtn.textContent = '‹';
        prevBtn.title = 'Previous person POV';
        prevBtn.setAttribute('aria-label', 'Previous person POV');
        prevBtn.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          stepCandidate(-1);
        });

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'btn btn-xs pov-cycle-btn';
        nextBtn.textContent = '›';
        nextBtn.title = 'Next person POV';
        nextBtn.setAttribute('aria-label', 'Next person POV');
        nextBtn.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          stepCandidate(1);
        });

        cycleWrap.append(prevBtn, nextBtn);
        this.povBannerEl.appendChild(cycleWrap);
      }

      const hint = document.createElement('span');
      hint.className = 'pov-banner-hint';
      hint.textContent = 'Drag to look · R center';
      this.povBannerEl.appendChild(hint);
    } else {
      const title = document.createElement('span');
      title.className = 'pov-banner-title';
      title.textContent = '🪽 Angel’s POV';

      const hint = document.createElement('span');
      hint.className = 'pov-banner-hint';
      hint.textContent = 'WASD Fly · Space/Shift Alt · Drag Look';

      this.povBannerEl.append(title, hint);
    }

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'btn primary btn-xs pov-exit-btn';
    const exitLbl = document.createElement('span');
    exitLbl.textContent = 'Exit POV';
    const escKbd = document.createElement('kbd');
    escKbd.className = 'pov-esc-kbd';
    escKbd.textContent = 'Esc';
    exitBtn.append(exitLbl, escKbd);
    exitBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.exitPovModeCleanly();
    });
    this.povBannerEl.appendChild(exitBtn);
  }

  private renderLotPopover(): void {
    const state = this.store.getState();
    this.ensureValidGroupDefaults();
    const wallDefs = this.getBasicsGroupItems('walls').filter((d) => !this.isArchwayWallDef(d));
    const floorDefs = this.getBasicsGroupItems('floors');
    const activeWallDef =
      wallDefs.find((d) => d.id === this.groupActiveItem.walls) ?? wallDefs[0];
    const activeFloorDef =
      this.store.data.itemsById.get(this.groupActiveItem.floors) ?? floorDefs[0];

    this.lotPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Lot & Surfaces';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.lotPopoverEl.appendChild(header);

    const makeDirControl = (side: ExpandSide, arrow: string, name: string) => {
      const box = document.createElement('div');
      box.className = `compass-cell compass-${side}`;

      const lbl = document.createElement('span');
      lbl.className = 'compass-label';
      lbl.textContent = `${arrow} ${name}`;

      const btns = document.createElement('div');
      btns.className = 'compass-btns';

      const shrink = this.makeBtn('−2', () => {
        this.audioModule?.playUiClick();
        if (this.store.expandDirection(side, -2)) {
          const s = this.store.getState();
          this.store.notify(`Lot ${s.gridWidth}×${s.gridDepth}`, 'info');
        }
      });
      shrink.className = 'btn btn-xs';

      const expand = this.makeBtn(
        '+2',
        () => {
          this.audioModule?.playUiClick();
          if (this.store.expandDirection(side, 2)) {
            const s = this.store.getState();
            this.store.notify(`Expanded ${name} (${s.gridWidth}×${s.gridDepth})`, 'success');
          }
        },
        'primary',
      );
      expand.className = 'btn primary btn-xs';

      btns.append(shrink, expand);
      box.append(lbl, btns);
      return box;
    };

    const compass = document.createElement('div');
    compass.className = 'compass-grid';

    const centerReadout = document.createElement('div');
    centerReadout.className = 'compass-center tabular-num';
    const dimBig = document.createElement('div');
    dimBig.className = 'compass-dim';
    dimBig.textContent = `${state.gridWidth} × ${state.gridDepth}`;
    const dimSub = document.createElement('div');
    dimSub.className = 'compass-sub';
    dimSub.textContent = 'tiles (8–36)';
    centerReadout.append(dimBig, dimSub);

    compass.append(
      makeDirControl('north', '↑', 'North'),
      makeDirControl('west', '←', 'West'),
      centerReadout,
      makeDirControl('east', '→', 'East'),
      makeDirControl('south', '↓', 'South'),
    );
    this.lotPopoverEl.appendChild(compass);

    const stepperRow = document.createElement('div');
    stepperRow.className = 'dim-stepper-row';

    const makeStepper = (labelText: string, value: number, onDelta: (d: number) => void) => {
      const group = document.createElement('div');
      group.className = 'dim-stepper';
      const lbl = document.createElement('span');
      lbl.className = 'dim-stepper-label';
      lbl.textContent = labelText;

      const dec = this.makeBtn('−', () => {
        this.audioModule?.playUiClick();
        onDelta(-2);
      });
      dec.className = 'btn btn-xs';
      dec.disabled = value <= 8;

      const val = document.createElement('span');
      val.className = 'dim-stepper-val tabular-num';
      val.textContent = String(value);

      const inc = this.makeBtn('+', () => {
        this.audioModule?.playUiClick();
        onDelta(2);
      });
      inc.className = 'btn btn-xs';
      inc.disabled = value >= 36;

      group.append(lbl, dec, val, inc);
      return group;
    };

    stepperRow.append(
      makeStepper('Width', state.gridWidth, (d) => {
        const nw = Math.max(8, Math.min(36, state.gridWidth + d));
        if (this.store.resizeGrid(nw, state.gridDepth)) {
          this.store.notify(`Lot ${nw}×${state.gridDepth}`, 'success');
        }
      }),
      makeStepper('Depth', state.gridDepth, (d) => {
        const nd = Math.max(8, Math.min(36, state.gridDepth + d));
        if (this.store.resizeGrid(state.gridWidth, nd)) {
          this.store.notify(`Lot ${state.gridWidth}×${nd}`, 'success');
        }
      }),
    );
    this.lotPopoverEl.appendChild(stepperRow);

    const gridRow = document.createElement('div');
    gridRow.className = 'toggle-setting-row';
    const gridText = document.createElement('span');
    gridText.className = 'toggle-setting-label';
    gridText.textContent = 'Grid Tiles';
    const gridOn = this.store.isGridVisible();
    const gridBtn = this.makeBtn(
      gridOn ? 'Visible' : 'Build Only',
      () => {
        this.audioModule?.playUiClick();
        this.store.setGridVisible(!this.store.isGridVisible());
      },
      gridOn ? 'primary' : undefined,
    );
    gridBtn.className = gridOn ? 'btn primary btn-xs' : 'btn btn-xs';
    gridRow.append(gridText, gridBtn);
    this.lotPopoverEl.appendChild(gridRow);

    this.appendWallCeilingControls(this.lotPopoverEl);

    if (activeWallDef) {
      const wallLabel = document.createElement('div');
      wallLabel.className = 'popover-section-label';
      wallLabel.textContent = 'All Walls';
      this.lotPopoverEl.appendChild(wallLabel);

      const row = document.createElement('div');
      row.className = 'surface-action-row';
      const { box: preview } = this.createPreviewThumb(
        activeWallDef,
        this.groupActiveVariant.walls,
        'surface-preview',
        true,
      );

      const mid = document.createElement('div');
      mid.className = 'surface-mid-col';
      mid.append(
        this.buildStyleSelect(wallDefs, activeWallDef.id, (nextId) => {
          this.groupActiveItem.walls = nextId;
          const nextDef = this.store.data.itemsById.get(nextId);
          if (nextDef && !nextDef.variants.some((v) => v.id === this.groupActiveVariant.walls)) {
            this.groupActiveVariant.walls = nextDef.variants[0].id;
          }
          this.renderLotPopover();
        }),
        this.buildVariantSwatches(activeWallDef, this.groupActiveVariant.walls, (vid) => {
          this.audioModule?.playUiClick();
          this.groupActiveVariant.walls = vid;
          this.renderLotPopover();
        }),
      );

      const applyBtn = this.makeBtn('Apply', () => {
        this.audioModule?.playUiClick();
        this.applySurfaceStyleToAll('walls', activeWallDef.id, this.groupActiveVariant.walls);
      });
      applyBtn.className = 'btn btn-xs';

      row.append(preview, mid, applyBtn);
      this.lotPopoverEl.appendChild(row);
    }

    if (activeFloorDef) {
      const floorLabel = document.createElement('div');
      floorLabel.className = 'popover-section-label';
      floorLabel.textContent = 'All Floors';
      this.lotPopoverEl.appendChild(floorLabel);

      const row = document.createElement('div');
      row.className = 'surface-action-row';
      const { box: preview } = this.createPreviewThumb(
        activeFloorDef,
        this.groupActiveVariant.floors,
        'surface-preview',
        true,
      );

      const mid = document.createElement('div');
      mid.className = 'surface-mid-col';
      mid.append(
        this.buildStyleSelect(floorDefs, activeFloorDef.id, (nextId) => {
          this.groupActiveItem.floors = nextId;
          const nextDef = this.store.data.itemsById.get(nextId);
          if (nextDef && !nextDef.variants.some((v) => v.id === this.groupActiveVariant.floors)) {
            this.groupActiveVariant.floors = nextDef.variants[0].id;
          }
          this.renderLotPopover();
        }),
        this.buildVariantSwatches(activeFloorDef, this.groupActiveVariant.floors, (vid) => {
          this.audioModule?.playUiClick();
          this.groupActiveVariant.floors = vid;
          this.renderLotPopover();
        }),
      );

      const applyBtn = this.makeBtn('Apply', () => {
        this.audioModule?.playUiClick();
        this.applySurfaceStyleToAll('floors', activeFloorDef.id, this.groupActiveVariant.floors);
      });
      applyBtn.className = 'btn btn-xs';

      row.append(preview, mid, applyBtn);
      this.lotPopoverEl.appendChild(row);
    }
  }

  private async copyTextToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback below
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  private renderMenuPopover(): void {
    const state = this.store.getState();
    this.menuPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Menu';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.menuPopoverEl.appendChild(header);

    const statusLine = document.createElement('div');
    statusLine.className = 'menu-status-row tabular-num';
    statusLine.innerHTML = `<span>${this.saveStatusText}</span><span>${state.items.length} items · ${state.gridWidth}×${state.gridDepth}</span>`;
    this.menuPopoverEl.appendChild(statusLine);

    // 2×3 Handcrafted House Presets Grid
    const presetsLabel = document.createElement('div');
    presetsLabel.className = 'popover-section-label';
    presetsLabel.textContent = 'House Presets';
    this.menuPopoverEl.appendChild(presetsLabel);

    const presetsGrid = document.createElement('div');
    presetsGrid.className = 'preset-house-grid';
    const newHouseCard = document.createElement('button');
    newHouseCard.type = 'button';
    newHouseCard.className = 'preset-house-card preset-house-card--new';
    newHouseCard.title = 'Start over with an empty room';
    newHouseCard.appendChild(createStorybookIconEl('room_home', 21));
    const newHouseName = document.createElement('span');
    newHouseName.className = 'preset-house-name';
    newHouseName.textContent = 'New House';
    newHouseCard.appendChild(newHouseName);
    newHouseCard.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover(null);
      this.startNewHouseWithTransition();
    });
    presetsGrid.appendChild(newHouseCard);
    for (const preset of HOUSE_PRESETS) {
      const isBackrooms =
        preset.sceneryViewId === 'backrooms' || preset.id === 'backrooms_level0';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = isBackrooms ? 'preset-house-card is-backrooms' : 'preset-house-card';
      card.title = isBackrooms
        ? 'Level 0 · Something arrives when 5+ guests gather'
        : `Load ${preset.name}`;
      card.appendChild(createStorybookIconEl(getRoomStorybookIconName(preset.icon), 21));
      const nameEl = document.createElement('span');
      nameEl.className = 'preset-house-name';
      nameEl.textContent = preset.name;
      card.appendChild(nameEl);
      card.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.switchPresetWithTransition(preset.id);
      });
      presetsGrid.appendChild(card);
    }
    this.menuPopoverEl.appendChild(presetsGrid);

    if (this.audioModule) {
      this.menuPopoverEl.appendChild(this.buildAudioMixPanel(true));
    }
    this.menuPopoverEl.appendChild(buildPeacefulModeRow(this.store)); // [horror-events hook]

    const shareLabel = document.createElement('div');
    shareLabel.className = 'popover-section-label';
    shareLabel.textContent = 'Share';
    this.menuPopoverEl.appendChild(shareLabel);

    const polaroidBtn = document.createElement('button');
    polaroidBtn.type = 'button';
    polaroidBtn.className = 'btn primary full-width';
    polaroidBtn.appendChild(createStorybookIconEl('polaroid', 19));
    const polaroidLbl = document.createElement('span');
    polaroidLbl.textContent = 'Share Polaroid Card';
    polaroidBtn.appendChild(polaroidLbl);
    polaroidBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover(null);
      this.polaroidModal.open();
    });
    this.menuPopoverEl.appendChild(polaroidBtn);

    const copyLinkBtn = this.makeBtn(
      'Copy Share Link',
      () => {
        this.audioModule?.playUiClick();
        void (async () => {
          try {
            const url = await encodeHouseToShareUrl(this.store.getState());
            const copied = await this.copyTextToClipboard(url);
            this.store.notify(
              copied ? 'Share link copied!' : 'Could not copy link — check clipboard permission',
              copied ? 'success' : 'error',
            );
          } catch (err) {
            this.store.notify(
              err instanceof Error ? err.message : 'Failed to create share link',
              'error',
            );
          }
        })();
      },
      undefined,
      'share',
      14,
    );
    copyLinkBtn.className = 'btn full-width';
    this.menuPopoverEl.appendChild(copyLinkBtn);

    const importLinkRow = document.createElement('div');
    importLinkRow.className = 'custom-room-row';

    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'custom-room-input';
    linkInput.placeholder = 'Paste share link…';
    linkInput.setAttribute('aria-label', 'Import from share link');

    const loadSharedLink = () => {
      const raw = linkInput.value.trim();
      if (!raw) return;
      this.audioModule?.playUiClick();
      void (async () => {
        try {
          const { state: decoded, warnings } = await decodeHouseFromShareLink(raw, this.store.data);
          this.store.loadHouse(decoded, { reason: 'import' });
          const warnSuffix = warnings.length > 0 ? ` (${warnings.length} skipped)` : '';
          this.store.notify(
            `Loaded shared house (${decoded.items.length} items${warnSuffix})`,
            'success',
          );
          this.setActivePopover(null);
        } catch (err) {
          this.store.notify(err instanceof Error ? err.message : 'Invalid share link', 'error');
        }
      })();
    };

    const loadBtn = this.makeBtn('Load', loadSharedLink);
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSharedLink();
    });

    importLinkRow.append(linkInput, loadBtn);
    this.menuPopoverEl.appendChild(importLinkRow);

    const actions = document.createElement('div');
    actions.className = 'menu-action-grid';

    actions.append(
      this.makeBtn(
        'Save .house',
        () => {
          this.audioModule?.playUiClick();
          const { filename } = exportHouseToFile(this.store.getState());
          this.store.notify(`Saved ${filename}`, 'success');
          this.setActivePopover(null);
        },
        undefined,
        'download',
        14,
      ),
      this.makeBtn(
        'Open .house',
        () => {
          this.audioModule?.playUiClick();
          this.fileInputEl.value = '';
          this.fileInputEl.click();
          this.setActivePopover(null);
        },
        undefined,
        'upload',
        14,
      ),
      this.makeBtn('Starter', () => {
        this.audioModule?.playUiClick();
        this.store.loadHouse(createStarterHouse(this.store.data), { reason: 'starter' });
        this.store.notify('Restored starter house', 'info');
        this.setActivePopover(null);
      }),
      this.makeBtn(
        'Clear Lot',
        () => {
          this.audioModule?.playUiClick();
          this.store.loadHouse(createEmptyHouse(this.store.data), { reason: 'clear' });
          this.store.notify('Cleared lot (Undo to restore)', 'info');
          this.setActivePopover(null);
        },
        'danger',
      ),
    );
    this.menuPopoverEl.appendChild(actions);

    // Storybook Cheat Panel launcher (shows live DEV / ON / OFF / 🔒 badge)
    const cheatBtn = document.createElement('button');
    cheatBtn.type = 'button';
    cheatBtn.className = 'btn menu-cheats-btn';
    const cheatLeft = document.createElement('span');
    cheatLeft.className = 'menu-cheats-left';
    const cheatGlyph = document.createElement('span');
    cheatGlyph.setAttribute('aria-hidden', 'true');
    cheatGlyph.textContent = '🎮';
    const cheatText = document.createElement('span');
    cheatText.textContent = 'Cheat Panel';
    cheatLeft.append(cheatGlyph, cheatText);

    const isDev = this.store.isDevBuild();
    const canUse = this.store.canUseInviteCheats();
    const enabled = this.store.isInviteCheatsEnabled();
    const cheatBadge = document.createElement('span');
    if (isDev && enabled) {
      cheatBadge.className = 'cheats-status-pill is-dev';
      cheatBadge.textContent = 'DEV';
    } else if (enabled) {
      cheatBadge.className = 'cheats-status-pill is-on';
      cheatBadge.textContent = 'ON';
    } else if (canUse) {
      cheatBadge.className = 'cheats-status-pill is-off';
      cheatBadge.textContent = 'OFF';
    } else {
      cheatBadge.className = 'cheats-status-pill is-locked';
      cheatBadge.textContent = '🔒';
      cheatBadge.setAttribute('aria-label', 'Locked');
    }

    cheatBtn.append(cheatLeft, cheatBadge);
    cheatBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover('cheats');
    });
    this.menuPopoverEl.appendChild(cheatBtn);
  }

  private handleKonamiKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.key === 'Shift' ||
      event.key === 'CapsLock' ||
      event.key === 'Control' ||
      event.key === 'Alt' ||
      event.key === 'Meta'
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable ||
        Boolean(target.closest?.('[contenteditable="true"]'))
      ) {
        return;
      }
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let nextProgress = 0;
    if (key === KONAMI_SEQUENCE[this.konamiProgress]) {
      nextProgress = this.konamiProgress + 1;
    } else {
      // Prefix-fallback matching (e.g. an extra leading ArrowUp stays at progress 2)
      for (let k = this.konamiProgress; k >= 1; k -= 1) {
        if (KONAMI_SEQUENCE[k - 1] !== key) continue;
        let matchesPrefix = true;
        for (let j = 0; j < k - 1; j += 1) {
          if (KONAMI_SEQUENCE[j] !== KONAMI_SEQUENCE[this.konamiProgress - k + 1 + j]) {
            matchesPrefix = false;
            break;
          }
        }
        if (matchesPrefix) {
          nextProgress = k;
          break;
        }
      }
    }

    if (nextProgress === KONAMI_SEQUENCE.length) {
      this.konamiProgress = 0;
      const newlyUnlocked = this.store.unlockKonamiCheats();
      this.audioModule?.playCelebration();
      this.store.notify(
        newlyUnlocked
          ? '🎮 Konami Code! Invitation cheats unlocked.'
          : '🎮 Invitation cheats enabled!',
        'success',
      );
      this.setActivePopover('cheats');
      return;
    }

    if (nextProgress !== this.konamiProgress) {
      this.konamiProgress = nextProgress;
      if (this.activePopover === 'cheats' && !this.store.canUseInviteCheats()) {
        this.syncKonamiKeycapsLive();
      }
    }
  }

  private syncKonamiKeycapsLive(): void {
    if (this.konamiKeycapEls.length === 0) return;
    for (let i = 0; i < this.konamiKeycapEls.length; i += 1) {
      const pip = this.konamiKeycapEls[i];
      if (!pip.isConnected) continue;
      const matched = i < this.konamiProgress;
      const isNext = i === this.konamiProgress;
      pip.textContent = matched ? '✓' : '?';
      pip.classList.toggle('matched', matched);
      pip.classList.toggle('next', isNext);
    }
  }

  private renderCheatsPopover(): void {
    const prevList = this.cheatsPopoverEl.querySelector('.cheats-legend-list') as HTMLElement | null;
    const prevScrollTop = prevList?.scrollTop ?? 0;

    this.cheatsPopoverEl.innerHTML = '';
    this.konamiKeycapEls = [];

    const isDev = this.store.isDevBuild();
    const canUse = this.store.canUseInviteCheats();
    const enabled = this.store.isInviteCheatsEnabled();

    const header = document.createElement('div');
    header.className = 'popover-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'cheats-header-title';
    const h4 = document.createElement('h4');
    h4.textContent = 'Cheat Panel';
    const statusPill = document.createElement('span');
    if (isDev) {
      statusPill.className = 'cheats-status-pill is-dev';
      statusPill.textContent = 'DEV';
    } else if (canUse) {
      statusPill.className = 'cheats-status-pill is-unlocked';
      statusPill.textContent = 'UNLOCKED';
    } else {
      statusPill.className = 'cheats-status-pill is-locked';
      statusPill.textContent = 'LOCKED';
    }
    titleWrap.append(h4, statusPill);

    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(titleWrap, closeBtn);
    this.cheatsPopoverEl.appendChild(header);

    if (canUse && !this.store.isChaosMode()) {
      const chillBanner = document.createElement('div');
      chillBanner.className = 'chill-mode-banner cheats-chill-banner';

      const chillText = document.createElement('div');
      chillText.className = 'chill-mode-text';
      const chillDesc = document.createElement('div');
      chillDesc.className = 'chill-mode-sub';
      chillDesc.textContent =
        'Chaos Mode is off — enable Chaos Mode to summon Legendary Guests.';
      chillText.appendChild(chillDesc);

      const turnOnBtn = this.makeBtn(
        'Turn On Chaos Mode',
        () => {
          this.audioModule?.playUiClick();
          this.store.setChaosMode(true);
        },
        'primary',
      );
      turnOnBtn.className = 'btn primary btn-xs chill-enable-btn';

      chillBanner.append(chillText, turnOnBtn);
      this.cheatsPopoverEl.appendChild(chillBanner);
    }

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'popover-section-label';
    sectionLabel.textContent = 'Invitation Cheats';
    this.cheatsPopoverEl.appendChild(sectionLabel);

    if (!canUse) {
      const lockedCard = document.createElement('div');
      lockedCard.className = 'cheats-locked-card';

      const lockedTitle = document.createElement('div');
      lockedTitle.className = 'cheats-locked-title';
      lockedTitle.textContent = '🔒 Invitation Cheats Locked';

      const lockedDesc = document.createElement('p');
      lockedDesc.className = 'cheats-locked-desc';
      lockedDesc.textContent =
        'Type the secret code on your keyboard to unlock invitation cheats.';

      const strip = document.createElement('div');
      strip.className = 'konami-keycaps-strip';
      strip.setAttribute('aria-label', 'Secret code progress');

      for (let i = 0; i < KONAMI_SEQUENCE.length; i += 1) {
        const pip = document.createElement('span');
        pip.className = 'konami-kbd';
        pip.textContent = '?';
        this.konamiKeycapEls.push(pip);
        strip.appendChild(pip);
      }
      this.syncKonamiKeycapsLive();

      lockedCard.append(lockedTitle, lockedDesc, strip);
      this.cheatsPopoverEl.appendChild(lockedCard);
      return;
    }

    // Unlocked (Dev build OR secret code unlocked)
    const toggleRow = document.createElement('div');
    toggleRow.className = 'cheats-toggle-row';

    const toggleText = document.createElement('div');
    toggleText.className = 'cheats-toggle-text';
    const toggleTitle = document.createElement('div');
    toggleTitle.className = 'cheats-toggle-title';
    toggleTitle.textContent = 'Invite Cheats';
    const toggleSub = document.createElement('div');
    toggleSub.className = 'cheats-toggle-sub';
    toggleSub.textContent = 'No cooldown · Invite any Legendary Guest';
    toggleText.append(toggleTitle, toggleSub);

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = enabled ? 'sb-toggle-switch on' : 'sb-toggle-switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', String(enabled));
    switchBtn.setAttribute(
      'aria-label',
      enabled ? 'Disable invitation cheats' : 'Enable invitation cheats',
    );
    const knob = document.createElement('span');
    knob.className = 'sb-toggle-knob';
    switchBtn.appendChild(knob);
    switchBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setInviteCheatsEnabled(!this.store.isInviteCheatsEnabled());
    });

    toggleRow.append(toggleText, switchBtn);
    this.cheatsPopoverEl.appendChild(toggleRow);

    if (!enabled) {
      const pausedNote = document.createElement('div');
      pausedNote.className = 'cheats-paused-note';
      pausedNote.textContent =
        'Invitation cheats paused — 25s cooldown & mystery-only mode active.';
      this.cheatsPopoverEl.appendChild(pausedNote);
      this.appendCheatsResetLogRow();
      return;
    }

    const specialVisitors = this.store.data.visitors.visitors.filter((v) =>
      Boolean((v as SpecialVisitorDef).special),
    );
    const activeVisitorIds = new Set(
      (this.visitorModule?.getActiveVisitors() ?? []).map((v) => v.visitorId),
    );

    const actionsRow = document.createElement('div');
    actionsRow.className = 'cheats-actions-row';

    const randomBtn = this.makeBtn('🎲 Random', () => {
      this.audioModule?.playUiClick();
      const specialVm = this.visitorModule as SpecialVisitorModule | undefined;
      if (specialVm?.inviteRandomSpecialCharacter) {
        specialVm.inviteRandomSpecialCharacter();
      } else if (specialVisitors.length > 0) {
        const pick = specialVisitors[Math.floor(Math.random() * specialVisitors.length)];
        this.visitorModule?.inviteVisitor(pick.id);
      }
    });
    randomBtn.className = 'btn btn-xs cheats-action-btn';
    randomBtn.title = 'Invite a random Legendary Guest';

    const inviteAllBtn = this.makeBtn('✨ Invite All', () => {
      this.audioModule?.playUiClick();
      const currentActive = new Set(
        (this.visitorModule?.getActiveVisitors() ?? []).map((v) => v.visitorId),
      );
      let invited = 0;
      for (const visitor of specialVisitors) {
        if (currentActive.has(visitor.id)) continue;
        if (this.visitorModule?.inviteVisitor(visitor.id)) {
          invited += 1;
        }
      }
      if (invited === 0) {
        this.store.notify('All Legendary Guests are already visiting!', 'info');
      } else {
        this.store.notify(
          `Invited ${invited} Legendary Guest${invited === 1 ? '' : 's'}!`,
          'success',
        );
      }
    });
    inviteAllBtn.className = 'btn btn-xs cheats-action-btn';

    const dismissAllBtn = this.makeBtn(
      '👋 Dismiss All',
      () => {
        this.audioModule?.playUiClick();
        this.visitorModule?.dismissAll();
      },
      'danger',
    );
    dismissAllBtn.className = 'btn danger btn-xs cheats-action-btn';

    actionsRow.append(randomBtn, inviteAllBtn, dismissAllBtn);
    this.cheatsPopoverEl.appendChild(actionsRow);

    if (specialVisitors.length > 0) {
      const listLabel = document.createElement('div');
      listLabel.className = 'popover-section-label';
      listLabel.textContent = 'Legendary Guests';
      this.cheatsPopoverEl.appendChild(listLabel);

      const legendList = document.createElement('div');
      legendList.className = 'cheats-legend-list';

      for (const visitor of specialVisitors) {
        const isHere = activeVisitorIds.has(visitor.id);
        const card = document.createElement('div');
        card.className = 'invite-visitor-card cheats-legend-card';
        card.title = visitor.description;

        const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);

        const body = document.createElement('div');
        body.className = 'invite-visitor-body';

        const name = document.createElement('div');
        name.className = 'invite-visitor-name';
        name.textContent = visitor.name;
        const star = document.createElement('span');
        star.className = 'special-sparkle-badge';
        star.textContent = '✦';
        name.appendChild(star);

        const iconGlyph =
          visitor.archetypeIcon ?? VISITOR_ARCHETYPE_ICONS[visitor.id] ?? '✨';
        const personaTrait = (
          visitor as VisitorDef & { personas?: Array<{ trait?: string }> }
        ).personas?.[0]?.trait;
        const sub = document.createElement('div');
        sub.className = 'invite-visitor-sub';
        sub.textContent = `${iconGlyph} ${personaTrait || visitor.description}`;

        body.append(name, sub);

        if (isHere) {
          const herePill = document.createElement('span');
          herePill.className = 'cheats-here-pill';
          herePill.textContent = 'Here';
          card.append(portrait, body, herePill);
        } else {
          const inviteBtn = this.makeBtn(
            'Invite',
            () => {
              this.audioModule?.playUiClick();
              this.visitorModule?.inviteVisitor(visitor.id);
            },
            'primary',
          );
          inviteBtn.className = 'btn primary btn-xs';
          card.append(portrait, body, inviteBtn);
        }

        legendList.appendChild(card);
      }

      this.cheatsPopoverEl.appendChild(legendList);
      if (prevScrollTop > 0) {
        legendList.scrollTop = prevScrollTop;
      }
    }

    this.appendCheatsResetLogRow();
  }

  private disarmResetLogConfirm(): void {
    this.resetLogConfirmArmed = false;
    if (this.resetLogConfirmTimer !== null) {
      window.clearTimeout(this.resetLogConfirmTimer);
      this.resetLogConfirmTimer = null;
    }
  }

  private appendCheatsResetLogRow(): void {
    const { discoveredCount } = this.getGuestLogProgress();
    const row = document.createElement('div');
    row.className = 'cheats-reset-log-row';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = this.resetLogConfirmArmed
      ? 'cheats-reset-log-btn armed'
      : 'cheats-reset-log-btn';
    resetBtn.textContent = this.resetLogConfirmArmed
      ? 'Click again to clear log'
      : 'Reset Log Book';
    if (discoveredCount === 0 && !this.resetLogConfirmArmed) {
      resetBtn.disabled = true;
      resetBtn.title = 'Guestbook is already empty';
    } else {
      resetBtn.title = this.resetLogConfirmArmed
        ? 'Confirm clearing all Legendary Guestbook entries'
        : 'Clear discovered Legendary Guestbook entries';
    }

    resetBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      if (!this.resetLogConfirmArmed) {
        this.resetLogConfirmArmed = true;
        if (this.resetLogConfirmTimer !== null) {
          window.clearTimeout(this.resetLogConfirmTimer);
        }
        this.resetLogConfirmTimer = window.setTimeout(() => {
          this.resetLogConfirmArmed = false;
          this.resetLogConfirmTimer = null;
          if (this.activePopover === 'cheats') this.renderCheatsPopover();
        }, 4000);
        this.renderCheatsPopover();
        return;
      }

      this.disarmResetLogConfirm();
      this.hasUnseenGuestLogEntry = false;
      this.selectedGuestLogId = null;
      this.lastNewlyDiscoveredId = null;
      this.store.resetGuestLog();
      this.store.notify('📖 Legendary Guestbook reset.', 'info');
    });

    row.appendChild(resetBtn);
    this.cheatsPopoverEl.appendChild(row);
  }

  private renderHelpPopover(): void {
    this.helpPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Controls';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.helpPopoverEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'help-controls-list';

    const makeControlRow = (
      badgeNode: HTMLElement,
      title: string,
      detail: string,
    ): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = 'help-control-row';

      const badge = document.createElement('div');
      badge.className = 'help-control-badge';
      badge.appendChild(badgeNode);

      const text = document.createElement('div');
      text.className = 'help-control-text';
      const strong = document.createElement('span');
      strong.className = 'help-control-title';
      strong.textContent = title;
      const sub = document.createElement('span');
      sub.className = 'help-control-detail';
      sub.textContent = detail;
      text.append(strong, sub);

      row.append(badge, text);
      return row;
    };

    const makeKbdGroup = (keys: string[], sep = ''): HTMLSpanElement => {
      const wrap = document.createElement('span');
      wrap.className = 'help-kbd-group';
      keys.forEach((k, idx) => {
        if (idx > 0 && sep) {
          const s = document.createElement('span');
          s.className = 'help-kbd-sep';
          s.textContent = sep;
          wrap.appendChild(s);
        }
        const kbd = document.createElement('kbd');
        kbd.className = 'help-kbd';
        kbd.textContent = k;
        wrap.appendChild(kbd);
      });
      return wrap;
    };

    list.append(
      makeControlRow(createIconEl('mouse', 16), 'Pan', 'Drag floor · 2-finger drag'),
      makeControlRow(createIconEl('trackpad', 16), 'Zoom', 'Scroll · Pinch'),
      makeControlRow(makeKbdGroup(['Q', 'E']), 'Rotate View', 'Turn camera 90°'),
      makeControlRow(createIconEl('select', 15), 'Interact', 'Click lamps, doors, machines & guests'),
      makeControlRow(makeKbdGroup(['R']), 'Rotate Item', 'Spin while placing or selected'),
      makeControlRow(makeKbdGroup(['Shift', 'Click'], '+'), 'Multi-Select', 'Select multiple walls or items'),
      makeControlRow(makeKbdGroup(['⌘Z', '⌫'], '/'), 'Undo / Delete', 'Undo edit · Remove item'),
      makeControlRow(makeKbdGroup(['?']), 'Cheats', 'Secret keyboard code'),
    );
    this.helpPopoverEl.appendChild(list);

    const tipsRow = document.createElement('div');
    tipsRow.className = 'help-tips-row';
    for (const tip of [
      'Doors & beds merge side-by-side',
      'Click walls to add windows',
      'Click any guest to follow',
    ]) {
      const chip = document.createElement('span');
      chip.className = 'help-tip-chip';
      chip.textContent = tip;
      tipsRow.appendChild(chip);
    }
    this.helpPopoverEl.appendChild(tipsRow);

    const tourBtn = document.createElement('button');
    tourBtn.type = 'button';
    tourBtn.className = 'help-tour-btn';
    tourBtn.textContent = '✨ Replay Quick Tour';
    tourBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.setActivePopover(null);
      this.startTutorial();
    });
    this.helpPopoverEl.appendChild(tourBtn);

    const ghLink = document.createElement('a');
    ghLink.className = 'help-github-btn';
    ghLink.href = 'https://github.com/Nano-AI/cozyhouse';
    ghLink.target = '_blank';
    ghLink.rel = 'noopener noreferrer';
    ghLink.appendChild(createIconEl('github', 16));
    const ghSpan = document.createElement('span');
    ghSpan.textContent = 'View on GitHub';
    ghLink.appendChild(ghSpan);
    this.helpPopoverEl.appendChild(ghLink);

    const liLink = document.createElement('a');
    liLink.className = 'help-github-btn';
    liLink.href = 'https://www.linkedin.com/in/adityanb';
    liLink.target = '_blank';
    liLink.rel = 'noopener noreferrer';
    liLink.appendChild(createIconEl('linkedin', 16));
    const liSpan = document.createElement('span');
    liSpan.textContent = 'Add me on LinkedIn';
    liLink.appendChild(liSpan);
    this.helpPopoverEl.appendChild(liLink);
  }

  private buildVariantSwatches(
    def: FurnitureItemDef,
    activeVariantId: string,
    onPick: (variantId: string) => void,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    for (const variant of def.variants) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = variant.id === activeVariantId ? 'swatch selected' : 'swatch';
      btn.style.background = variant.color;
      btn.title = variant.label;
      btn.setAttribute('aria-label', variant.label);
      btn.addEventListener('click', () => onPick(variant.id));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  private renderDramaticCaption(payload: CaptionPayload | null): void {
    if (!this.captionOverlayEl) return;
    if (this.captionHideTimer !== null) {
      window.clearTimeout(this.captionHideTimer);
      this.captionHideTimer = null;
    }
    if (!payload) {
      this.captionOverlayEl.classList.remove('visible');
      this.captionHideTimer = window.setTimeout(() => {
        this.captionOverlayEl.classList.add('hidden');
        this.captionHideTimer = null;
      }, 220);
      return;
    }

    const accent = payload.accent || '#FFD966';
    this.captionCardEl.style.setProperty('--caption-accent', accent);
    this.captionSpeakerEl.textContent = payload.speaker;
    this.captionTextEl.textContent = payload.text.startsWith('「')
      ? payload.text
      : `“${payload.text}”`;
    this.captionSubtextEl.textContent = payload.subtext ?? '';
    this.captionSubtextEl.hidden = !payload.subtext;

    this.captionOverlayEl.classList.remove('hidden');
    void this.captionOverlayEl.offsetWidth;
    this.captionOverlayEl.classList.add('visible');
  }

  /** Letterbox bars, hit flash and screen shake for scripted scenes (shake is CSS, off under reduced motion). */
  private playCinematicFx(fx: CinematicFx): void {
    if (fx === 'sound-locked' || fx === 'sound-ok') {
      this.cinemaSoundHintEl.hidden = fx === 'sound-ok';
      return;
    }
    if (fx === 'bars-on' || fx === 'bars-off') {
      if (fx === 'bars-off') this.cinemaSoundHintEl.hidden = true;
      this.setCinemaMode(fx === 'bars-on');
      return;
    }
    const isFlash = fx === 'flash' || fx === 'flash-purple';
    const el = isFlash ? this.cinemaFlashEl : this.sceneManager.renderer.domElement;
    const cls = fx === 'flash' ? 'fire' : fx === 'flash-purple' ? 'fire-purple' : fx === 'shake' ? 'cinema-shake' : 'cinema-shake-hard';
    el.classList.remove('fire', 'fire-purple', 'cinema-shake', 'cinema-shake-hard');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /**
   * Cutscene presentation. While on, the whole interface is hidden (CSS on `#hud.cinema-mode`
   * keeps only the bars, captions and Skip), editor overlays in the 3D view are hidden, and
   * pointer, wheel and key input is swallowed before the game sees it — except Esc and the Skip
   * button. Nothing is closed or reset, so turning it off puts every panel back as it was.
   */
  private setCinemaMode(on: boolean): void {
    this.cinemaBarsEl.classList.toggle('on', on);
    // The bars carry the Skip button for the whole scene, so the caption card hides its own.
    this.captionOverlayEl.classList.toggle('in-cinema', on);
    this.root.classList.toggle('cinema-mode', on);
    this.sceneManager.setCutsceneOverlaysHidden(on);
    if (on === (this.cinemaInputBlock !== null)) return;
    if (on) {
      this.setHoverHint(null);
      this.setHoverItem(null);
      const block = (e: Event): void => {
        const target = e.target as Element | null;
        if (target?.closest?.('.cinema-skip')) return;
        if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.metaKey || e.ctrlKey)) return;
        e.stopImmediatePropagation();
        if (e.type === 'contextmenu' || e.type === 'wheel') e.preventDefault();
      };
      for (const type of CINEMA_BLOCKED_EVENTS) {
        window.addEventListener(type, block, { capture: true, passive: false });
      }
      this.cinemaInputBlock = block;
    } else if (this.cinemaInputBlock) {
      for (const type of CINEMA_BLOCKED_EVENTS) {
        window.removeEventListener(type, this.cinemaInputBlock, { capture: true });
      }
      this.cinemaInputBlock = null;
    }
  }

  private createVisitorPortrait(
    def: VisitorDef | undefined,
    variantIndex: number,
    fallbackColor: string,
    visitorId: string,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'visitor-portrait';
    const isSpecial = Boolean((def as SpecialVisitorDef | undefined)?.special);
    if (isSpecial) {
      wrap.classList.add('special-portrait');
    }
    const tint = def?.color ?? fallbackColor ?? '#E8BFA8';
    wrap.style.background = `color-mix(in srgb, ${tint} 36%, #FCF9F2)`;

    const iconGlyph = def?.archetypeIcon ?? VISITOR_ARCHETYPE_ICONS[visitorId] ?? '✨';
    const fallback = document.createElement('span');
    if (isSpecial) {
      fallback.className = 'visitor-portrait-glyph';
      fallback.textContent = iconGlyph;
      fallback.setAttribute('aria-hidden', 'true');
    } else {
      fallback.className = 'visitor-portrait-fallback';
      fallback.style.background = tint;
    }

    const img = document.createElement('img');
    img.className = 'visitor-portrait-img hidden';
    img.alt = def?.name ?? visitorId;
    img.draggable = false;

    const badge = document.createElement('span');
    badge.className = isSpecial ? 'visitor-archetype-badge special' : 'visitor-archetype-badge';
    badge.textContent = isSpecial ? '✦' : iconGlyph;
    badge.setAttribute('aria-hidden', 'true');

    wrap.append(fallback, img, badge);

    const renderer = this.sceneManager.getPreviewRenderer?.();
    if (def && renderer) {
      const cached = renderer.getCachedVisitorPortrait(def.id, variantIndex);
      if (cached) {
        img.src = cached;
        img.classList.remove('hidden');
        fallback.classList.add('hidden');
      } else {
        void renderer.renderVisitorPortrait(def, variantIndex).then((url) => {
          if (!url || !img.isConnected) return;
          img.src = url;
          img.classList.remove('hidden');
          fallback.classList.add('hidden');
        });
      }
    }

    return wrap;
  }

  private getSpecialVisitors(): VisitorDef[] {
    return this.store.data.visitors.visitors.filter((v) =>
      Boolean((v as SpecialVisitorDef).special),
    );
  }

  private getGuestLogProgress(): {
    specials: VisitorDef[];
    log: Record<string, GuestLogEntry>;
    discoveredCount: number;
    total: number;
  } {
    const specials = this.getSpecialVisitors();
    const log = this.store.getGuestLog();
    let discoveredCount = 0;
    for (const v of specials) {
      if (log[v.id]) discoveredCount += 1;
    }
    return { specials, log, discoveredCount, total: specials.length };
  }

  private formatShortLogDate(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return '—';
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    try {
      return new Intl.DateTimeFormat(
        undefined,
        sameYear
          ? { month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric', year: 'numeric' },
      ).format(d);
    } catch {
      return d.toLocaleDateString();
    }
  }

  private createMysteryGuestPortrait(def: VisitorDef, large = false): HTMLDivElement {
    // Strictly spoiler-free: neutral warm parchment backdrop, never leaks def.name, color, or icon
    const wrap = document.createElement('div');
    wrap.className = large
      ? 'guestbook-portrait mystery large'
      : 'guestbook-portrait mystery';

    const img = document.createElement('img');
    img.className = 'guestbook-silhouette-img hidden';
    img.alt = 'Undiscovered legendary guest';
    img.draggable = false;

    const qBadge = document.createElement('span');
    qBadge.className = 'guestbook-mystery-q';
    qBadge.textContent = '?';
    qBadge.setAttribute('aria-hidden', 'true');

    wrap.append(img, qBadge);

    const renderer = this.sceneManager.getPreviewRenderer?.();
    if (renderer) {
      const cached = renderer.getCachedVisitorPortrait(def.id, 0);
      if (cached) {
        img.src = cached;
        img.classList.remove('hidden');
        wrap.classList.add('has-silhouette');
      } else {
        void renderer.renderVisitorPortrait(def, 0).then((url) => {
          if (!url || !img.isConnected) return;
          img.src = url;
          img.classList.remove('hidden');
          wrap.classList.add('has-silhouette');
        });
      }
    }

    return wrap;
  }

  private resolveVisitorEmoji(lastEmote: string | undefined, mood: string): string {
    if (lastEmote) {
      const mapped = EMOTE_ID_TO_EMOJI[lastEmote.trim().toLowerCase()];
      if (mapped) return mapped;
      if (!/^[a-zA-Z0-9_\s-]+$/.test(lastEmote)) {
        return lastEmote;
      }
    }
    return MOOD_FALLBACK_EMOJI[mood] ?? '💭';
  }

  private selectVisitor(instanceId: string, closePopover = false): void {
    const snap = this.visitorModule?.getActiveVisitorById(instanceId);
    if (!snap) {
      this.clearSelectedVisitor();
      return;
    }
    this.selectedVisitorId = instanceId;
    if (closePopover) {
      this.setActivePopover(null);
    }
    this.focusCameraOnSelectedVisitor();
    this.renderVisitorProfileCard();
  }

  private focusCameraOnSelectedVisitor(): void {
    if (!this.selectedVisitorId || !this.visitorModule) return;
    const pos = this.visitorModule.getVisitorWorldPosition(this.selectedVisitorId);
    if (pos) {
      this.sceneManager.focusOnWorldPoint(pos.x, pos.z, 1.55);
    }
    const targetId = this.selectedVisitorId;
    this.sceneManager.setCameraFollowProvider(() => {
      if (this.selectedVisitorId !== targetId || !this.visitorModule) return null;
      const livePos = this.visitorModule.getVisitorWorldPosition(targetId);
      return livePos ? { x: livePos.x, z: livePos.z } : null;
    });
  }

  private clearSelectedVisitor(): void {
    if (this.selectedVisitorId !== null) {
      this.selectedVisitorId = null;
      this.sceneManager.setCameraFollowProvider(null);
    }
    if (this.visitorProfileCardEl) {
      this.visitorProfileCardEl.classList.add('hidden');
      this.visitorProfileCardEl.innerHTML = '';
    }
  }

  private renderVisitorProfileCard(): void {
    if (!this.visitorProfileCardEl) return;
    if (!this.selectedVisitorId || !this.visitorModule || this.store.isEditMode()) {
      this.clearSelectedVisitor();
      return;
    }

    const snap = this.visitorModule.getActiveVisitorById(this.selectedVisitorId);
    if (!snap) {
      this.clearSelectedVisitor();
      return;
    }

    const def = this.store.data.visitorsById.get(snap.visitorId);
    const personalName = snap.name ?? def?.name ?? snap.visitorId;
    const archetypeLabel = snap.archetypeName ?? def?.name ?? snap.visitorId;
    const score = Math.max(
      0,
      Math.min(
        100,
        snap.moodScore ??
          (snap.mood === 'delighted'
            ? 95
            : snap.mood === 'happy'
              ? 76
              : snap.mood === 'neutral'
                ? 52
                : snap.mood === 'bored'
                  ? 25
                  : 10),
      ),
    );

    this.visitorProfileCardEl.classList.remove('hidden');
    this.visitorProfileCardEl.innerHTML = '';

    // Header: 58px 3D Portrait + Name + Archetype & Pronouns + Mood meter + Close
    const head = document.createElement('div');
    head.className = 'vp-head';

    const portrait = this.createVisitorPortrait(
      def,
      snap.variantIndex ?? 0,
      snap.color ?? '#E8BFA8',
      snap.visitorId,
    );
    portrait.classList.add('vp-pfp');

    const meta = document.createElement('div');
    meta.className = 'vp-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'vp-name';
    nameEl.textContent = personalName;
    const isSpecialVisitor = Boolean(
      (snap as { isSpecial?: boolean }).isSpecial || (def as SpecialVisitorDef | undefined)?.special,
    );
    if (isSpecialVisitor) {
      const star = document.createElement('span');
      star.className = 'special-sparkle-badge';
      star.textContent = '✦';
      star.title = 'Legendary Special Guest';
      nameEl.appendChild(star);
    }
    const holdingCoffee = Boolean(
      (snap as ActiveVisitorSnapshot & { holdingCoffee?: boolean }).holdingCoffee,
    );
    if (holdingCoffee) {
      const coffeeTag = document.createElement('span');
      coffeeTag.className = 'visitor-coffee-badge vp-coffee-badge';
      coffeeTag.textContent = '☕';
      coffeeTag.title = 'Holding a fresh cup of coffee';
      coffeeTag.setAttribute('aria-label', 'Holding a fresh cup of coffee');
      nameEl.appendChild(coffeeTag);
    }

    const subEl = document.createElement('div');
    subEl.className = 'vp-sub';
    subEl.textContent = snap.pronouns
      ? `${archetypeLabel} · ${snap.pronouns}`
      : archetypeLabel;

    const moodRow = document.createElement('div');
    moodRow.className = 'vp-mood-row';

    const emoji = document.createElement('span');
    emoji.className = 'visitor-mood-emoji';
    emoji.textContent = this.resolveVisitorEmoji(snap.lastEmote, snap.mood);

    const moodLabel = document.createElement('span');
    moodLabel.className = `mood-pill mood-${snap.mood}`;
    moodLabel.textContent = snap.mood;

    const barTrack = document.createElement('div');
    barTrack.className = 'mood-bar-track';
    barTrack.title = `Mood: ${Math.round(score)}%`;
    const barFill = document.createElement('div');
    barFill.className = `mood-bar-fill mood-${snap.mood}`;
    barFill.style.width = `${Math.round(score)}%`;
    barTrack.appendChild(barFill);

    moodRow.append(emoji, moodLabel, barTrack);
    meta.append(nameEl, subEl, moodRow);

    const headActions = document.createElement('div');
    headActions.className = 'vp-head-actions';

    const povBtn = document.createElement('button');
    povBtn.type = 'button';
    povBtn.className = 'btn btn-xs vp-pov-btn';
    povBtn.textContent = '👁 POV';
    povBtn.title = `View from ${personalName}'s first-person POV`;
    povBtn.setAttribute('aria-label', `View from ${personalName}'s POV`);
    povBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.enterPersonPovMode(snap.instanceId);
    });

    const closeBtn = this.makeBtn('×', () => {
      this.audioModule?.playUiClick();
      this.clearSelectedVisitor();
    });
    closeBtn.className = 'btn icon-close';
    closeBtn.setAttribute('aria-label', 'Close visitor profile');

    headActions.append(povBtn, closeBtn);
    head.append(portrait, meta, headActions);
    this.visitorProfileCardEl.appendChild(head);

    // Hobbies & Interests section (full untruncated personality + Likes/Dislikes)
    const hobbiesSec = document.createElement('div');
    hobbiesSec.className = 'vp-section';

    const hobbiesLbl = document.createElement('div');
    hobbiesLbl.className = 'popover-section-label';
    hobbiesLbl.textContent = 'Hobbies & Interests';
    hobbiesSec.appendChild(hobbiesLbl);

    const traitText = snap.personality || def?.description;
    if (traitText) {
      const traitEl = document.createElement('p');
      traitEl.className = 'vp-trait';
      traitEl.textContent = traitText;
      hobbiesSec.appendChild(traitEl);
    }

    const likes = snap.interests ?? def?.likedTags ?? [];
    const matchedLikes = new Set(snap.matchedInterests ?? []);
    const dislikes = snap.dislikes ?? def?.dislikedTags ?? [];
    const matchedDislikes = new Set(snap.matchedDislikes ?? []);

    if (likes.length > 0 || dislikes.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'tag-chip-list';
      for (const tag of likes) {
        const hit = matchedLikes.has(tag);
        const chip = document.createElement('span');
        chip.className = hit ? 'tag-chip matched' : 'tag-chip';
        chip.textContent = hit ? `✓ ${tag}` : tag;
        chips.appendChild(chip);
      }
      for (const tag of dislikes) {
        const hit = matchedDislikes.has(tag);
        const chip = document.createElement('span');
        chip.className = hit ? 'tag-chip disliked-hit' : 'tag-chip disliked';
        chip.textContent = `✕ ${tag}`;
        chips.appendChild(chip);
      }
      hobbiesSec.appendChild(chips);
    }
    this.visitorProfileCardEl.appendChild(hobbiesSec);

    // What they think of the place (full untruncated quote + live activity)
    const thoughtSec = document.createElement('div');
    thoughtSec.className = 'vp-thought-box';

    const thoughtLbl = document.createElement('div');
    thoughtLbl.className = 'popover-section-label';
    thoughtLbl.textContent = 'What they think';
    thoughtSec.appendChild(thoughtLbl);

    const quoteEl = document.createElement('p');
    quoteEl.className = 'vp-quote';
    quoteEl.textContent = snap.thought
      ? `“${snap.thought}”`
      : '“Taking in the cozy atmosphere!”';
    thoughtSec.appendChild(quoteEl);

    const activityEl = document.createElement('div');
    activityEl.className = 'vp-activity';
    activityEl.textContent = snap.activity || 'Exploring the room';
    thoughtSec.appendChild(activityEl);

    this.visitorProfileCardEl.appendChild(thoughtSec);

    // Footer actions: Focus + Grab Coffee + Dismiss
    const footer = document.createElement('div');
    footer.className = 'vp-actions';

    const focusBtn = this.makeBtn(
      'Focus',
      () => {
        this.audioModule?.playUiClick();
        this.focusCameraOnSelectedVisitor();
      },
      'primary',
      'reset',
      14,
    );
    focusBtn.className = 'btn primary btn-xs';

    const goingForCoffee = Boolean(snap.activity?.toLowerCase().includes('grab a coffee'));
    const coffeeBtn = document.createElement('button');
    coffeeBtn.type = 'button';
    if (holdingCoffee) {
      coffeeBtn.className = 'btn btn-xs vp-coffee-btn is-sipping';
      coffeeBtn.textContent = '☕ Sipping';
      coffeeBtn.disabled = true;
      coffeeBtn.title = 'Already enjoying a cup of coffee';
    } else if (goingForCoffee) {
      coffeeBtn.className = 'btn btn-xs vp-coffee-btn is-heading';
      coffeeBtn.textContent = '☕ On the way';
      coffeeBtn.disabled = true;
      coffeeBtn.title = 'Heading to grab a fresh cup of coffee';
    } else {
      coffeeBtn.className = 'btn btn-xs vp-coffee-btn';
      coffeeBtn.textContent = '☕ Grab Coffee';
      if (snap.mood === 'leaving') {
        coffeeBtn.disabled = true;
        coffeeBtn.title = 'Heading home';
      } else {
        coffeeBtn.title = 'Send to grab a fresh cup of coffee';
        coffeeBtn.addEventListener('click', () => {
          this.audioModule?.playUiClick();
          (
            this.visitorModule as unknown as {
              sendVisitorForCoffee?: (id: string) => boolean;
            }
          )?.sendVisitorForCoffee?.(snap.instanceId);
        });
      }
    }

    const dismissBtn = this.makeBtn(
      'Dismiss',
      () => {
        this.audioModule?.playUiClick();
        const id = snap.instanceId;
        this.clearSelectedVisitor();
        this.visitorModule?.dismiss(id);
      },
      'danger',
    );
    dismissBtn.className = 'btn danger btn-xs';

    footer.append(focusBtn, coffeeBtn, dismissBtn);
    this.visitorProfileCardEl.appendChild(footer);
  }

  private renderVisitorsPopover(): void {
    const prevLogGridScroll =
      (this.visitorsPopoverEl.querySelector('.guestbook-grid') as HTMLElement | null)
        ?.scrollTop ?? 0;
    this.visitorsPopoverEl.innerHTML = '';

    const active = this.visitorModule?.getActiveVisitors() ?? [];
    const hiredStaff = this.store.getStaff();
    const { discoveredCount, total: totalLegends } = this.getGuestLogProgress();

    if (this.visitorsTab === 'log') {
      this.hasUnseenGuestLogEntry = false;
    }

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Visitors & Staff';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.visitorsPopoverEl.appendChild(header);

    // Crisp 4-Tab Switcher separating Guests, Staff, Invite, and Legendary Log Book
    const tabBar = document.createElement('div');
    tabBar.className = 'visitors-tab-bar';
    tabBar.setAttribute('role', 'tablist');

    const makeTab = (
      id: 'here' | 'staff' | 'invite' | 'log',
      label: string,
      showDot = false,
    ) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        this.visitorsTab === id
          ? 'visitors-tab-btn active tabular-num'
          : 'visitors-tab-btn tabular-num';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(this.visitorsTab === id));
      btn.textContent = label;
      if (showDot) {
        const dot = document.createElement('span');
        dot.className = 'visitors-tab-dot';
        dot.setAttribute('aria-label', 'New discovery');
        btn.appendChild(dot);
      }
      btn.addEventListener('click', () => {
        if (this.visitorsTab === id) return;
        this.audioModule?.playUiClick();
        this.visitorsTab = id;
        if (id === 'log') {
          this.hasUnseenGuestLogEntry = false;
        } else {
          this.selectedGuestLogId = null;
        }
        this.renderVisitorsPopover();
      });
      return btn;
    };

    tabBar.append(
      makeTab('here', `Guests (${active.length})`),
      makeTab('staff', `Staff (${hiredStaff.length})`),
      makeTab('invite', 'Invite'),
      makeTab(
        'log',
        `Log (${discoveredCount}/${totalLegends})`,
        this.hasUnseenGuestLogEntry && this.visitorsTab !== 'log',
      ),
    );
    this.visitorsPopoverEl.appendChild(tabBar);

    if (this.visitorsTab === 'staff') {
      this.renderStaffTab();
      return;
    }

    if (this.visitorsTab === 'log') {
      this.renderGuestLogTab(prevLogGridScroll);
      return;
    }

    if (this.visitorsTab === 'here') {
      this.stopRandomCooldownTimer();
      this.randomInviteBtnEl = null;
      if (active.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'visitors-empty';
        const policy = this.store.getDoorPolicy();
        empty.textContent =
          policy === 'open'
            ? 'Guests drop by automatically while Open, or switch to Invite.'
            : policy === 'full'
              ? 'House is Full — no new drop-ins arrive automatically. Switch to Invite or Open.'
              : 'House is Closed. Switch to Invite or set Open.';
        this.visitorsPopoverEl.appendChild(empty);
      } else {
        const topActionRow = document.createElement('div');
        topActionRow.className = 'visitors-section-header';
        const hint = document.createElement('span');
        hint.className = 'visitors-click-hint';
        hint.textContent = 'Click a guest to focus & inspect';
        const dismissAllBtn = this.makeBtn('Dismiss All', () => {
          this.audioModule?.playUiClick();
          this.clearSelectedVisitor();
          this.visitorModule?.dismissAll();
        });
        dismissAllBtn.className = 'btn btn-xs';
        topActionRow.append(hint, dismissAllBtn);
        this.visitorsPopoverEl.appendChild(topActionRow);

        const activeList = document.createElement('div');
        activeList.className = 'active-visitors-list';
        const seenByArchetype = new Map<string, number>();
        const coffeeVm = this.visitorModule as unknown as
          | {
              hasCoffeeStation?: () => boolean;
              sendVisitorForCoffee?: (id: string) => boolean;
            }
          | undefined;
        const canGrabCoffee = Boolean(coffeeVm?.hasCoffeeStation?.());

        for (const snap of active) {
          const def = this.store.data.visitorsById.get(snap.visitorId);
          const occ = seenByArchetype.get(snap.visitorId) ?? 0;
          seenByArchetype.set(snap.visitorId, occ + 1);
          const variantIdx = snap.variantIndex ?? (occ % 3);

          const isSelected = this.selectedVisitorId === snap.instanceId;
          const card = document.createElement('div');
          card.className = isSelected
            ? 'active-visitor-card clickable selected'
            : 'active-visitor-card clickable';
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.dataset.visitorInstanceId = snap.instanceId; // [horror-events hook] lets a vanishing guest's row crack

          const personalName = snap.name ?? def?.name ?? snap.visitorId;
          const archetypeLabel = snap.archetypeName ?? def?.name ?? snap.visitorId;
          card.title = `Focus on ${personalName} (${archetypeLabel})`;
          card.addEventListener('click', () => {
            this.audioModule?.playUiClick();
            this.selectVisitor(snap.instanceId, true);
          });
          card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.audioModule?.playUiClick();
              this.selectVisitor(snap.instanceId, true);
            }
          });

          const headerRow = document.createElement('div');
          headerRow.className = 'active-visitor-head';

          const portrait = this.createVisitorPortrait(
            def,
            variantIdx,
            snap.color ?? '#E8BFA8',
            snap.visitorId,
          );

          const identity = document.createElement('div');
          identity.className = 'active-visitor-info';

          const compactRow = document.createElement('div');
          compactRow.className = 'active-visitor-compact';

          const nameEl = document.createElement('span');
          nameEl.className = 'active-visitor-name';
          nameEl.textContent = personalName;

          const isSpecialRow = Boolean(
            (snap as { isSpecial?: boolean }).isSpecial ||
              (def as SpecialVisitorDef | undefined)?.special,
          );
          if (isSpecialRow) {
            const star = document.createElement('span');
            star.className = 'special-sparkle-badge';
            star.textContent = '✦';
            star.title = 'Legendary Special Guest';
            compactRow.append(nameEl, star);
          } else {
            compactRow.append(nameEl);
          }

          const emojiEl = document.createElement('span');
          emojiEl.className = 'visitor-mood-emoji';
          emojiEl.textContent = this.resolveVisitorEmoji(snap.lastEmote, snap.mood);
          emojiEl.title = snap.mood;

          const score = Math.max(
            0,
            Math.min(
              100,
              snap.moodScore ??
                (snap.mood === 'delighted'
                  ? 95
                  : snap.mood === 'happy'
                    ? 76
                    : snap.mood === 'neutral'
                      ? 52
                      : snap.mood === 'bored'
                        ? 25
                        : 10),
            ),
          );

          const barTrack = document.createElement('div');
          barTrack.className = 'mood-bar-track';
          barTrack.title = `Mood: ${Math.round(score)}%`;
          const barFill = document.createElement('div');
          barFill.className = `mood-bar-fill mood-${snap.mood}`;
          barFill.style.width = `${Math.round(score)}%`;
          barTrack.appendChild(barFill);

          compactRow.append(emojiEl, barTrack);
          identity.appendChild(compactRow);

          const holdingCoffeeRow = Boolean(
            (snap as ActiveVisitorSnapshot & { holdingCoffee?: boolean }).holdingCoffee,
          );
          const goingForCoffeeRow = Boolean(
            snap.activity?.toLowerCase().includes('grab a coffee'),
          );

          let coffeeCtrl: HTMLElement | null = null;
          if (holdingCoffeeRow) {
            const coffeeBadge = document.createElement('span');
            coffeeBadge.className = 'visitor-coffee-badge';
            coffeeBadge.textContent = '☕';
            coffeeBadge.title = 'Holding a fresh cup of coffee';
            coffeeBadge.setAttribute('aria-label', 'Holding a fresh cup of coffee');
            coffeeCtrl = coffeeBadge;
          } else if (canGrabCoffee && snap.mood !== 'leaving') {
            const coffeeQuickBtn = document.createElement('button');
            coffeeQuickBtn.type = 'button';
            coffeeQuickBtn.className = goingForCoffeeRow
              ? 'btn btn-xs visitor-coffee-btn is-heading'
              : 'btn btn-xs visitor-coffee-btn';
            coffeeQuickBtn.textContent = '☕';
            coffeeQuickBtn.disabled = goingForCoffeeRow;
            coffeeQuickBtn.title = goingForCoffeeRow
              ? 'Heading to grab a coffee'
              : 'Send to grab a coffee';
            coffeeQuickBtn.setAttribute('aria-label', `Send ${personalName} to grab a coffee`);
            coffeeQuickBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.audioModule?.playUiClick();
              coffeeVm?.sendVisitorForCoffee?.(snap.instanceId);
            });
            coffeeCtrl = coffeeQuickBtn;
          }

          const sendHomeBtn = document.createElement('button');
          sendHomeBtn.type = 'button';
          sendHomeBtn.className = 'btn icon-close';
          sendHomeBtn.textContent = '×';
          sendHomeBtn.title = 'Send Home';
          sendHomeBtn.setAttribute('aria-label', `Send ${personalName} home`);
          sendHomeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.audioModule?.playUiClick();
            if (this.selectedVisitorId === snap.instanceId) {
              this.clearSelectedVisitor();
            }
            this.visitorModule?.dismiss(snap.instanceId);
          });

          if (coffeeCtrl) {
            headerRow.append(portrait, identity, coffeeCtrl, sendHomeBtn);
          } else {
            headerRow.append(portrait, identity, sendHomeBtn);
          }
          card.appendChild(headerRow);
          activeList.appendChild(card);
        }
        this.visitorsPopoverEl.appendChild(activeList);
      }
      return;
    }

    // Tab 3: Mystery Random Character Card + Regular Cozy Archetypes (Special guests kept secret!)
    this.stopRandomCooldownTimer();
    this.randomInviteBtnEl = null;
    this.randomCooldownBadgeEl = null;

    const chaosOn = this.store.isChaosMode();
    const inviteList = document.createElement('div');
    inviteList.className = 'invite-visitors-list';

    if (chaosOn) {
      const randomCard = document.createElement('div');
      randomCard.className = 'invite-visitor-card invite-random-card';
      randomCard.title = 'Invite a surprise legendary special guest!';

      const mysteryBox = document.createElement('div');
      mysteryBox.className = 'invite-random-avatar';
      mysteryBox.textContent = '🎲';
      mysteryBox.setAttribute('aria-hidden', 'true');

      const randomBody = document.createElement('div');
      randomBody.className = 'invite-visitor-body';
      const randomName = document.createElement('div');
      randomName.className = 'invite-visitor-name';
      randomName.textContent = 'Random Character';
      const randomSub = document.createElement('div');
      randomSub.className = 'invite-visitor-sub';
      randomSub.textContent = 'Invite a surprise legendary guest!';
      randomBody.append(randomName, randomSub);

      const randomInviteBtn = this.makeBtn(
        'Invite',
        () => {
          this.audioModule?.playUiClick();
          const specialVm = this.visitorModule as SpecialVisitorModule | undefined;
          if (specialVm?.inviteRandomSpecialCharacter) {
            specialVm.inviteRandomSpecialCharacter();
          } else {
            const specials = this.store.data.visitors.visitors.filter(
              (v) => (v as SpecialVisitorDef).special,
            );
            const pool = specials.length > 0 ? specials : this.store.data.visitors.visitors;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            if (pick) this.visitorModule?.invite(pick.id);
          }
          this.syncRandomInviteCooldown();
        },
        'primary',
      );
      randomInviteBtn.className = 'btn primary btn-xs random-invite-btn';

      const cooldownBadge = document.createElement('span');
      cooldownBadge.className = 'random-cooldown-badge tabular-num hidden';
      cooldownBadge.hidden = true;
      cooldownBadge.setAttribute('aria-live', 'off');

      this.randomInviteBtnEl = randomInviteBtn;
      this.randomCooldownBadgeEl = cooldownBadge;
      this.syncRandomInviteCooldown();

      randomCard.append(mysteryBox, randomBody, randomInviteBtn, cooldownBadge);
      inviteList.appendChild(randomCard);
    } else {
      const chillBanner = document.createElement('div');
      chillBanner.className = 'chill-mode-banner';

      const chillText = document.createElement('div');
      chillText.className = 'chill-mode-text';
      const chillTitle = document.createElement('div');
      chillTitle.className = 'chill-mode-title';
      chillTitle.textContent = '🌿 Chill Mode (Chaos Off)';
      const chillSub = document.createElement('div');
      chillSub.className = 'chill-mode-sub';
      chillSub.textContent = 'Legendary guests & spooky events are paused';
      chillText.append(chillTitle, chillSub);

      const enableBtn = this.makeBtn(
        'Enable Chaos',
        () => {
          this.audioModule?.playUiClick();
          this.store.setChaosMode(true);
        },
        'primary',
      );
      enableBtn.className = 'btn primary btn-xs chill-enable-btn';

      chillBanner.append(chillText, enableBtn);
      inviteList.appendChild(chillBanner);
    }

    const regularVisitors = this.store.data.visitors.visitors.filter(
      (v) => !(v as SpecialVisitorDef).special,
    );
    for (const visitor of regularVisitors) {
      const card = document.createElement('div');
      card.className = 'invite-visitor-card';
      const dislikeNote =
        visitor.dislikedTags.length > 0 ? ` · Dislikes ${visitor.dislikedTags.join(', ')}` : '';
      card.title = `Likes ${visitor.likedTags.join(', ')}${dislikeNote}`;

      const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);

      const body = document.createElement('div');
      body.className = 'invite-visitor-body';

      const name = document.createElement('div');
      name.className = 'invite-visitor-name';
      name.textContent = visitor.name;

      const sub = document.createElement('div');
      sub.className = 'invite-visitor-sub';
      sub.textContent = visitor.likedTags.slice(0, 3).join(' · ');

      body.append(name, sub);

      const inviteBtn = this.makeBtn(
        'Invite',
        () => {
          this.audioModule?.playUiClick();
          this.visitorModule?.invite(visitor.id);
        },
        'primary',
      );
      inviteBtn.className = 'btn primary btn-xs';

      card.append(portrait, body, inviteBtn);
      inviteList.appendChild(card);
    }
    this.visitorsPopoverEl.appendChild(inviteList);

    if (chaosOn && this.store.isInviteCheatsEnabled()) {
      const specialVisitors = this.store.data.visitors.visitors.filter((v) =>
        Boolean((v as SpecialVisitorDef).special),
      );
      if (specialVisitors.length > 0) {
        const sectionHead = document.createElement('div');
        sectionHead.className = 'invite-section-head';

        const devLabel = document.createElement('div');
        devLabel.className = 'popover-section-label';
        devLabel.textContent = this.store.isDevBuild()
          ? 'DEV · Legendary Guests'
          : 'CHEATS · Legendary Guests';

        const cheatLinkBtn = this.makeBtn('Cheat Panel', () => {
          this.audioModule?.playUiClick();
          this.setActivePopover('cheats');
        });
        cheatLinkBtn.className = 'btn btn-xs invite-cheats-link';

        sectionHead.append(devLabel, cheatLinkBtn);
        this.visitorsPopoverEl.appendChild(sectionHead);

        const devList = document.createElement('div');
        devList.className = 'invite-visitors-list';

        const showdownVm = this.visitorModule as SpecialVisitorModule | undefined;
        if (showdownVm?.devTriggerShowdown) {
          const card = document.createElement('div');
          card.className = 'invite-visitor-card';
          card.title = 'Invites Gojo and Toji if needed, then plays the showdown once both are indoors.';
          const body = document.createElement('div');
          body.className = 'invite-visitor-body';
          const name = document.createElement('div');
          name.className = 'invite-visitor-name';
          name.textContent = 'Gojo × Toji showdown';
          const sub = document.createElement('div');
          sub.className = 'invite-visitor-sub';
          sub.textContent = '🗡️ Scripted scene · any room';
          body.append(name, sub);
          const triggerBtn = this.makeBtn(
            'Trigger',
            () => {
              this.audioModule?.playUiClick();
              showdownVm.devTriggerShowdown?.();
            },
            'primary',
          );
          triggerBtn.className = 'btn primary btn-xs';
          card.append(body, triggerBtn);
          devList.appendChild(card);
        }

        for (const visitor of specialVisitors) {
          const card = document.createElement('div');
          card.className = 'invite-visitor-card';
          card.title = visitor.description;

          const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);

          const body = document.createElement('div');
          body.className = 'invite-visitor-body';

          const name = document.createElement('div');
          name.className = 'invite-visitor-name';
          name.textContent = visitor.name;
          const star = document.createElement('span');
          star.className = 'special-sparkle-badge';
          star.textContent = '✦';
          name.appendChild(star);

          const iconGlyph =
            visitor.archetypeIcon ?? VISITOR_ARCHETYPE_ICONS[visitor.id] ?? '✨';
          const personaTrait = (
            visitor as VisitorDef & { personas?: Array<{ trait?: string }> }
          ).personas?.[0]?.trait;
          const sub = document.createElement('div');
          sub.className = 'invite-visitor-sub';
          sub.textContent = `${iconGlyph} ${personaTrait || visitor.description}`;

          body.append(name, sub);

          const inviteBtn = this.makeBtn(
            'Invite',
            () => {
              this.audioModule?.playUiClick();
              this.visitorModule?.inviteVisitor(visitor.id);
            },
            'primary',
          );
          inviteBtn.className = 'btn primary btn-xs';

          card.append(portrait, body, inviteBtn);
          devList.appendChild(card);
        }
        devList.appendChild(buildLastGuestDevCard()); // [horror-events hook]
        this.visitorsPopoverEl.appendChild(devList);
      }
    }

    // Compact footer with clickable Legendary Log progress pill (+ Cheats shortcut when locked/off)
    const inviteFooter = document.createElement('div');
    inviteFooter.className = 'invite-cheats-footer';
    const logShortcutBtn = this.makeBtn(`📖 Log ${discoveredCount}/${totalLegends}`, () => {
      this.audioModule?.playUiClick();
      this.visitorsTab = 'log';
      this.selectedGuestLogId = null;
      this.hasUnseenGuestLogEntry = false;
      this.renderVisitorsPopover();
    });
    logShortcutBtn.className = 'btn btn-xs invite-log-pill tabular-num';
    inviteFooter.appendChild(logShortcutBtn);

    if (!this.store.isInviteCheatsEnabled()) {
      const cheatsQuickBtn = this.makeBtn('🎮 Cheats', () => {
        this.audioModule?.playUiClick();
        this.setActivePopover('cheats');
      });
      cheatsQuickBtn.className = 'btn btn-xs invite-cheats-footer-btn';
      inviteFooter.appendChild(cheatsQuickBtn);
    }
    this.visitorsPopoverEl.appendChild(inviteFooter);
  }

  private renderGuestLogTab(prevGridScroll = 0): void {
    this.stopRandomCooldownTimer();
    this.randomInviteBtnEl = null;
    this.randomCooldownBadgeEl = null;

    const { specials, log, discoveredCount, total } = this.getGuestLogProgress();
    const activeByVisitorId = new Map<string, ActiveVisitorSnapshot>();
    for (const snap of this.visitorModule?.getActiveVisitors() ?? []) {
      if (!activeByVisitorId.has(snap.visitorId)) {
        activeByVisitorId.set(snap.visitorId, snap);
      }
    }

    // Detail view for a single entry's signed page (or non-spoiler mystery card)
    if (this.selectedGuestLogId !== null) {
      const idx = specials.findIndex((v) => v.id === this.selectedGuestLogId);
      if (idx >= 0) {
        this.renderGuestLogDetail(
          specials[idx],
          idx,
          log[specials[idx].id] ?? null,
          activeByVisitorId.get(specials[idx].id) ?? null,
        );
        return;
      }
      this.selectedGuestLogId = null;
    }

    // Header / Progress Banner
    const pct = total > 0 ? Math.round((discoveredCount / total) * 100) : 0;
    const isComplete = total > 0 && discoveredCount >= total;

    const banner = document.createElement('div');
    banner.className = isComplete ? 'guestbook-banner complete' : 'guestbook-banner';

    const bannerTop = document.createElement('div');
    bannerTop.className = 'guestbook-banner-top';
    const title = document.createElement('span');
    title.className = 'guestbook-banner-title';
    title.textContent = '📖 Legendary Guestbook';
    const countPill = document.createElement('span');
    countPill.className = isComplete
      ? 'guestbook-count-pill complete tabular-num'
      : 'guestbook-count-pill tabular-num';
    countPill.textContent = `${discoveredCount} / ${total}`;
    bannerTop.append(title, countPill);

    const progressTrack = document.createElement('div');
    progressTrack.className = 'guestbook-progress-track';
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-valuemin', '0');
    progressTrack.setAttribute('aria-valuemax', String(total));
    progressTrack.setAttribute('aria-valuenow', String(discoveredCount));
    const progressFill = document.createElement('div');
    progressFill.className = 'guestbook-progress-fill';
    progressFill.style.width = `${pct}%`;
    progressTrack.appendChild(progressFill);

    const sub = document.createElement('div');
    sub.className = 'guestbook-banner-sub';
    sub.textContent = isComplete
      ? '🎉 Complete! Every legend has signed your book!'
      : 'Meet surprise legendary visitors to cross them off!';

    banner.append(bannerTop, progressTrack, sub);
    this.visitorsPopoverEl.appendChild(banner);

    // 3-Column Pokédex Collection Grid
    const grid = document.createElement('div');
    grid.className = 'guestbook-grid';

    specials.forEach((visitor, idx) => {
      const entryNum = `#${String(idx + 1).padStart(2, '0')}`;
      const logEntry = log[visitor.id] ?? null;
      const isDiscovered = Boolean(logEntry);
      const isHere = activeByVisitorId.has(visitor.id);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = isDiscovered ? 'guestbook-card discovered' : 'guestbook-card locked';
      if (isDiscovered && visitor.id === this.lastNewlyDiscoveredId) {
        card.classList.add('just-discovered');
      }
      card.setAttribute(
        'aria-label',
        isDiscovered && logEntry
          ? `${entryNum} ${visitor.name}, visited ${logEntry.visits} time${logEntry.visits === 1 ? '' : 's'}`
          : `${entryNum} Undiscovered legendary guest`,
      );

      const topRow = document.createElement('div');
      topRow.className = 'guestbook-card-top';
      const numEl = document.createElement('span');
      numEl.className = 'guestbook-num tabular-num';
      numEl.textContent = entryNum;
      topRow.appendChild(numEl);

      if (isDiscovered) {
        const checkStamp = document.createElement('span');
        checkStamp.className = 'guestbook-check-stamp';
        checkStamp.textContent = '✓';
        checkStamp.title = 'Discovered';
        topRow.appendChild(checkStamp);
      }

      const media = document.createElement('div');
      media.className = 'guestbook-card-media';
      if (isDiscovered) {
        const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);
        portrait.classList.add('guestbook-card-portrait');
        media.appendChild(portrait);
        if (isHere) {
          const herePill = document.createElement('span');
          herePill.className = 'guestbook-here-badge';
          herePill.textContent = 'Here';
          media.appendChild(herePill);
        }
      } else {
        media.appendChild(this.createMysteryGuestPortrait(visitor, false));
      }

      const foot = document.createElement('div');
      foot.className = 'guestbook-card-foot';
      const nameEl = document.createElement('span');
      nameEl.className = isDiscovered ? 'guestbook-card-name' : 'guestbook-card-name mystery';
      nameEl.textContent = isDiscovered ? visitor.name : '???';
      foot.appendChild(nameEl);

      if (isDiscovered && logEntry && logEntry.visits > 1) {
        const visitsEl = document.createElement('span');
        visitsEl.className = 'guestbook-visit-count tabular-num';
        visitsEl.textContent = `×${logEntry.visits}`;
        foot.appendChild(visitsEl);
      }

      card.append(topRow, media, foot);
      card.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.selectedGuestLogId = visitor.id;
        this.renderVisitorsPopover();
      });

      grid.appendChild(card);
    });

    this.visitorsPopoverEl.appendChild(grid);
    if (prevGridScroll > 0) {
      grid.scrollTop = prevGridScroll;
    }
  }

  private renderGuestLogDetail(
    visitor: VisitorDef,
    index: number,
    logEntry: GuestLogEntry | null,
    activeSnap: ActiveVisitorSnapshot | null,
  ): void {
    const entryNum = `#${String(index + 1).padStart(2, '0')}`;
    const isDiscovered = Boolean(logEntry);

    const topBar = document.createElement('div');
    topBar.className = 'guestbook-detail-bar';

    const backBtn = this.makeBtn('← All Entries', () => {
      this.audioModule?.playUiClick();
      this.selectedGuestLogId = null;
      this.renderVisitorsPopover();
    });
    backBtn.className = 'btn btn-xs guestbook-back-btn';

    const numBadge = document.createElement('span');
    numBadge.className = 'guestbook-entry-num tabular-num';
    numBadge.textContent = entryNum;

    topBar.append(backBtn, numBadge);
    this.visitorsPopoverEl.appendChild(topBar);

    if (!isDiscovered || !logEntry) {
      // Strictly non-spoiler mystery page
      const card = document.createElement('div');
      card.className = 'guestbook-detail-card locked';

      const portrait = this.createMysteryGuestPortrait(visitor, true);
      const title = document.createElement('div');
      title.className = 'guestbook-detail-name';
      title.textContent = '???';

      const pill = document.createElement('span');
      pill.className = 'guestbook-pill locked';
      pill.textContent = 'Undiscovered';

      const prompt = document.createElement('p');
      prompt.className = 'guestbook-detail-desc';
      prompt.textContent =
        "A mysterious legendary guest who hasn't stopped by yet. Keep your door Open or try Random Character in Invite to meet them!";

      const goInviteBtn = this.makeBtn(
        '🎲 Try Random Character',
        () => {
          this.audioModule?.playUiClick();
          this.visitorsTab = 'invite';
          this.selectedGuestLogId = null;
          this.renderVisitorsPopover();
        },
        'primary',
      );
      goInviteBtn.className = 'btn primary btn-xs';

      card.append(portrait, title, pill, prompt, goInviteBtn);
      this.visitorsPopoverEl.appendChild(card);
      return;
    }

    // Discovered signed guestbook page
    const card = document.createElement('div');
    card.className = 'guestbook-detail-card discovered';

    const hero = document.createElement('div');
    hero.className = 'guestbook-detail-hero';

    const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);
    portrait.classList.add('guestbook-portrait-lg');

    const meta = document.createElement('div');
    meta.className = 'guestbook-detail-meta';

    const badgesRow = document.createElement('div');
    badgesRow.className = 'guestbook-detail-badges';
    const crossedPill = document.createElement('span');
    crossedPill.className = 'guestbook-pill crossed-off';
    crossedPill.textContent = '✓ Crossed Off';
    badgesRow.appendChild(crossedPill);
    if (activeSnap) {
      const herePill = document.createElement('span');
      herePill.className = 'guestbook-pill here';
      herePill.textContent = 'Here now';
      badgesRow.appendChild(herePill);
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'guestbook-detail-name';
    nameRow.textContent = visitor.name;
    const star = document.createElement('span');
    star.className = 'special-sparkle-badge';
    star.textContent = '✦';
    nameRow.appendChild(star);

    const iconGlyph = visitor.archetypeIcon ?? VISITOR_ARCHETYPE_ICONS[visitor.id] ?? '✨';
    const personaTrait = (
      visitor as VisitorDef & { personas?: Array<{ trait?: string }> }
    ).personas?.[0]?.trait;
    const traitLine = document.createElement('div');
    traitLine.className = 'guestbook-detail-trait';
    traitLine.textContent = `${iconGlyph} ${personaTrait || visitor.description}`;

    meta.append(badgesRow, nameRow, traitLine);
    hero.append(portrait, meta);
    card.appendChild(hero);

    if (personaTrait && visitor.description && visitor.description !== personaTrait) {
      const desc = document.createElement('p');
      desc.className = 'guestbook-detail-desc';
      desc.textContent = visitor.description;
      card.appendChild(desc);
    }

    if (visitor.likedTags.length > 0) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'guestbook-tags-row';
      for (const tag of visitor.likedTags) {
        const chip = document.createElement('span');
        chip.className = 'guestbook-tag-chip';
        chip.textContent = `♥ ${tag}`;
        tagsRow.appendChild(chip);
      }
      card.appendChild(tagsRow);
    }

    const stats = document.createElement('div');
    stats.className = 'guestbook-stats-strip tabular-num';
    stats.textContent = `Visits: ${logEntry.visits} · First met: ${this.formatShortLogDate(logEntry.firstVisitedAt)}`;
    card.appendChild(stats);

    const cheatsOn = this.store.isInviteCheatsEnabled();
    if (activeSnap || cheatsOn) {
      const actions = document.createElement('div');
      actions.className = 'guestbook-detail-actions';

      if (activeSnap) {
        const focusBtn = this.makeBtn(
          '👀 Focus',
          () => {
            this.audioModule?.playUiClick();
            if (this.store.isEditMode()) {
              this.store.setEditMode(false);
            }
            this.selectVisitor(activeSnap.instanceId, true);
          },
          'primary',
        );
        focusBtn.className = 'btn primary btn-xs';
        actions.appendChild(focusBtn);
      }

      if (cheatsOn) {
        const inviteBtn = this.makeBtn(
          'Invite',
          () => {
            this.audioModule?.playUiClick();
            this.visitorModule?.inviteVisitor(visitor.id);
          },
          activeSnap ? undefined : 'primary',
        );
        inviteBtn.className = activeSnap ? 'btn btn-xs' : 'btn primary btn-xs';
        actions.appendChild(inviteBtn);
      }

      card.appendChild(actions);
    }

    this.visitorsPopoverEl.appendChild(card);
  }

  private stopRandomCooldownTimer(): void {
    if (this.randomCooldownTimer !== null) {
      window.clearInterval(this.randomCooldownTimer);
      this.randomCooldownTimer = null;
    }
  }

  private syncRandomInviteCooldown(): void {
    const btn = this.randomInviteBtnEl;
    const badge = this.randomCooldownBadgeEl;
    if (!btn || !badge) {
      this.stopRandomCooldownTimer();
      return;
    }
    const specialVm = this.visitorModule as SpecialVisitorModule | undefined;
    const raw = specialVm?.getRandomSpecialCooldownRemaining?.() ?? 0;
    const cd = Math.max(0, Math.ceil(raw));
    if (cd > 0) {
      btn.hidden = true;
      btn.disabled = true;
      btn.classList.add('hidden');
      badge.hidden = false;
      badge.classList.remove('hidden');
      badge.textContent = `⏱ ${cd}s`;
      badge.title = `Ready in ${cd}s`;
      if (this.randomCooldownTimer === null) {
        this.randomCooldownTimer = window.setInterval(() => {
          if (!this.randomInviteBtnEl?.isConnected) {
            this.stopRandomCooldownTimer();
            return;
          }
          this.syncRandomInviteCooldown();
        }, 250);
      }
    } else {
      btn.hidden = false;
      btn.disabled = false;
      btn.classList.remove('hidden');
      btn.textContent = 'Invite';
      badge.hidden = true;
      badge.classList.add('hidden');
      this.stopRandomCooldownTimer();
    }
  }

  private getMatchingStationsForRole(role: StaffRole): PlacedItem[] {
    const roleMeta = STAFF_ROLES.find((r) => r.role === role);
    if (!roleMeta) return [];
    const allowed = new Set(roleMeta.stations);
    return this.store.getState().items.filter((it) => allowed.has(it.itemId));
  }

  private startMovingStaff(staffId: string): void {
    const member = this.store.getStaff().find((s) => s.id === staffId);
    if (!member) return;
    this.setActivePopover(null);
    this.movingStaffId = staffId;
    const canvas = this.sceneManager.renderer?.domElement;
    if (canvas) {
      canvas.style.cursor = 'crosshair';
    }
    this.setHoverHint(
      `Click a floor tile near a matching station to place ${member.name} (Esc to cancel)`,
    );
  }

  private cancelMovingStaff(): void {
    if (!this.movingStaffId) return;
    this.movingStaffId = null;
    const canvas = this.sceneManager.renderer?.domElement;
    if (canvas) {
      canvas.style.cursor = '';
    }
    this.setHoverHint(null);
  }

  private raycastFloorTile(clientX: number, clientY: number): { gx: number; gz: number } | null {
    const canvas = this.sceneManager.renderer?.domElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.staffNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.staffRaycaster.setFromCamera(this.staffNdc, this.sceneManager.isoCamera.camera);
    const hit = this.staffRaycaster.ray.intersectPlane(this.staffGroundPlane, this.staffHitPt);
    if (!hit) return null;
    const state = this.store.getState();
    const gx = Math.floor(hit.x + state.gridWidth / 2);
    const gz = Math.floor(hit.z + state.gridDepth / 2);
    if (gx < 0 || gz < 0 || gx >= state.gridWidth || gz >= state.gridDepth) {
      return null;
    }
    return { gx, gz };
  }

  private distanceToItemFootprint(gx: number, gz: number, item: PlacedItem): number {
    const def = this.store.data.itemsById.get(item.itemId);
    const eff = def ? getEffectiveFootprint(def, item.rotation) : { w: 1, d: 1 };
    const cx = Math.max(item.x, Math.min(item.x + eff.w - 1, gx));
    const cz = Math.max(item.z, Math.min(item.z + eff.d - 1, gz));
    return Math.hypot(gx - cx, gz - cz);
  }

  private handleStaffMoveCanvasClick(clientX: number, clientY: number): void {
    const staffId = this.movingStaffId;
    if (!staffId) return;
    const member = this.store.getStaff().find((s) => s.id === staffId);
    if (!member) {
      this.cancelMovingStaff();
      return;
    }

    const tile = this.raycastFloorTile(clientX, clientY);
    if (!tile) {
      this.store.notify(
        `Move ${member.name} closer to a matching station (within 2 tiles)`,
        'info',
      );
      return;
    }

    const matchingStations = this.getMatchingStationsForRole(member.role);
    let chosenStation: PlacedItem | null = null;
    let bestDist = Infinity;

    // Prefer assigned station if within <= 2.6 tiles, else pick nearest matching station
    if (member.assignedItemUid) {
      const assigned = matchingStations.find((s) => s.uid === member.assignedItemUid);
      if (assigned) {
        const d = this.distanceToItemFootprint(tile.gx, tile.gz, assigned);
        if (d <= 2.6) {
          chosenStation = assigned;
          bestDist = d;
        }
      }
    }
    if (!chosenStation) {
      for (const st of matchingStations) {
        const d = this.distanceToItemFootprint(tile.gx, tile.gz, st);
        if (d <= 2.6 && d < bestDist) {
          bestDist = d;
          chosenStation = st;
        }
      }
    }

    if (!chosenStation) {
      this.store.notify(
        `Move ${member.name} closer to a matching station (within 2 tiles)`,
        'info',
      );
      return;
    }

    const staffStore = this.store as StaffPositionStore;
    const moved = staffStore.setStaffPosition
      ? staffStore.setStaffPosition(member.id, tile.gx, tile.gz, chosenStation.uid)
      : false;
    if (moved) {
      this.audioModule?.playUiClick();
      this.cancelMovingStaff();
      this.store.notify(`Moved ${member.name}!`, 'success');
    } else {
      this.store.notify(
        `Move ${member.name} closer to a matching station (within 2 tiles)`,
        'info',
      );
    }
  }

  private renderStaffTab(): void {
    this.stopRandomCooldownTimer();
    this.randomInviteBtnEl = null;
    this.randomCooldownBadgeEl = null;
    const hired = this.store.getStaff();
    const activeSnapshots = this.visitorModule?.getActiveStaff?.() ?? [];
    const snapById = new Map(activeSnapshots.map((s) => [s.id, s]));
    const placedIds = new Set(this.store.getState().items.map((it) => it.itemId));

    // Compact Bot / Human kind toggle pill
    const kindWrap = document.createElement('div');
    kindWrap.className = 'staff-kind-section';

    const kindToggle = document.createElement('div');
    kindToggle.className = 'staff-kind-toggle';
    kindToggle.setAttribute('role', 'group');
    kindToggle.setAttribute('aria-label', 'Staff style');

    const botBtn = document.createElement('button');
    botBtn.type = 'button';
    botBtn.className = this.staffHireKind === 'bot' ? 'staff-kind-btn active' : 'staff-kind-btn';
    botBtn.appendChild(createStorybookIconEl('staff_bot', 18));
    const botSpan = document.createElement('span');
    botSpan.textContent = 'Cozy Bot';
    botBtn.appendChild(botSpan);
    botBtn.addEventListener('click', () => {
      if (this.staffHireKind === 'bot') return;
      this.audioModule?.playUiClick();
      this.staffHireKind = 'bot';
      this.renderVisitorsPopover();
    });

    const humanBtn = document.createElement('button');
    humanBtn.type = 'button';
    humanBtn.className =
      this.staffHireKind === 'human' ? 'staff-kind-btn active' : 'staff-kind-btn';
    humanBtn.textContent = '🧑 Human';
    humanBtn.addEventListener('click', () => {
      if (this.staffHireKind === 'human') return;
      this.audioModule?.playUiClick();
      this.staffHireKind = 'human';
      this.renderVisitorsPopover();
    });

    kindToggle.append(botBtn, humanBtn);

    const kindHint = document.createElement('div');
    kindHint.className = 'staff-kind-hint';
    kindHint.textContent =
      this.staffHireKind === 'bot'
        ? 'Works nonstop with quick joyful recharges'
        : 'Works shifts and takes cozy couch or bath breaks';

    kindWrap.append(kindToggle, kindHint);
    this.visitorsPopoverEl.appendChild(kindWrap);

    // 2×2 Role Hire Grid
    const hireGrid = document.createElement('div');
    hireGrid.className = 'staff-hire-grid';
    const atMax = hired.length >= 6;

    for (const meta of STAFF_ROLES) {
      const hasStation = meta.stations.some((id) => placedIds.has(id));

      const card = document.createElement('div');
      card.className = 'staff-hire-card';

      const top = document.createElement('div');
      top.className = 'staff-hire-top';
      const title = document.createElement('span');
      title.className = 'staff-hire-title';
      title.textContent = `${meta.emoji} ${meta.label}`;
      top.appendChild(title);

      const status = document.createElement('div');
      status.className = hasStation ? 'staff-station-status ready' : 'staff-station-status';
      const dot = document.createElement('span');
      dot.className = hasStation ? 'staff-status-dot ready' : 'staff-status-dot';
      const stTxt = document.createElement('span');
      stTxt.textContent = hasStation ? 'Ready' : 'No station yet';
      status.append(dot, stTxt);

      const hireBtn = this.makeBtn(
        'Hire',
        () => {
          this.audioModule?.playUiClick();
          const created = this.store.hireStaff(meta.role, this.staffHireKind);
          if (created) {
            this.store.notify(`Hired ${created.name} (${meta.label})`, 'success');
          }
        },
        'primary',
      );
      hireBtn.className = 'btn primary btn-xs full-width';
      hireBtn.disabled = atMax;
      if (atMax) {
        hireBtn.title = 'Maximum 6 staff on duty';
      }

      card.append(top, status, hireBtn);
      hireGrid.appendChild(card);
    }
    this.visitorsPopoverEl.appendChild(hireGrid);

    // On Duty (M) list
    const dutyHeader = document.createElement('div');
    dutyHeader.className = 'visitors-section-header';
    const dutyLabel = document.createElement('span');
    dutyLabel.className = 'popover-section-label tabular-num';
    dutyLabel.textContent = `On Duty (${hired.length})`;
    dutyHeader.appendChild(dutyLabel);
    this.visitorsPopoverEl.appendChild(dutyHeader);

    if (hired.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'visitors-empty';
      empty.textContent = 'Hire a Cozy Bot or Human staff member above to run your machines!';
      this.visitorsPopoverEl.appendChild(empty);
      return;
    }

    const dutyList = document.createElement('div');
    dutyList.className = 'staff-duty-list';

    for (const member of hired) {
      const roleMeta = STAFF_ROLES.find((r) => r.role === member.role);
      const live = snapById.get(member.id);
      const matchingStations = this.getMatchingStationsForRole(member.role);

      const card = document.createElement('div');
      card.className = 'staff-duty-card-wrap';

      const row = document.createElement('div');
      row.className = 'staff-duty-card';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = `Focus camera on ${member.name}`;

      const focusStaff = () => {
        const pos = this.visitorModule?.getStaffWorldPosition?.(member.id);
        if (pos) {
          this.audioModule?.playUiClick();
          this.setActivePopover(null);
          this.sceneManager.focusOnWorldPoint(pos.x, pos.z, 1.55);
        }
      };
      row.addEventListener('click', focusStaff);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          focusStaff();
        }
      });

      const avatar = document.createElement('div');
      avatar.className = 'staff-duty-avatar';
      if (member.kind === 'bot') {
        avatar.appendChild(createStorybookIconEl('staff_bot', 22));
      } else {
        avatar.textContent = '🧑';
      }

      const info = document.createElement('div');
      info.className = 'staff-duty-info';

      const nameLine = document.createElement('div');
      nameLine.className = 'staff-duty-name';
      nameLine.textContent = `${member.name} · ${roleMeta?.label ?? member.role}`;

      const statusLine = document.createElement('div');
      statusLine.className = 'staff-duty-status';
      if (live) {
        statusLine.textContent =
          live.status === 'break'
            ? `On Break · ${live.activity}`
            : live.status === 'recharging'
              ? 'Recharging…'
              : live.activity || (live.stationName ? `Working ${live.stationName}` : 'On duty');
      } else {
        statusLine.textContent = 'Reporting for duty';
      }
      info.append(nameLine, statusLine);

      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'btn btn-xs staff-swap-btn';
      swapBtn.textContent = member.kind === 'bot' ? '🤖→🧑' : '🧑→🤖';
      swapBtn.title = member.kind === 'bot' ? 'Swap to Human staff' : 'Swap to Cozy Bot';
      swapBtn.setAttribute(
        'aria-label',
        member.kind === 'bot' ? `Swap ${member.name} to Human` : `Swap ${member.name} to Cozy Bot`,
      );
      swapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audioModule?.playUiClick();
        this.store.toggleStaffKind(member.id);
      });

      const fireBtn = document.createElement('button');
      fireBtn.type = 'button';
      fireBtn.className = 'btn icon-close';
      fireBtn.textContent = '×';
      fireBtn.title = 'Dismiss staff member';
      fireBtn.setAttribute('aria-label', `Dismiss ${member.name}`);
      fireBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audioModule?.playUiClick();
        this.store.fireStaff(member.id);
        this.store.notify(`Dismissed ${member.name}`, 'info');
      });

      row.append(avatar, info, swapBtn, fireBtn);

      // Compact Station Assignment Dropdown + Interactive Move button row
      const controlsRow = document.createElement('div');
      controlsRow.className = 'staff-duty-controls';

      const stationSelect = document.createElement('select');
      stationSelect.className = 'style-select staff-station-select';
      stationSelect.setAttribute('aria-label', `Assign station for ${member.name}`);
      stationSelect.addEventListener('click', (e) => e.stopPropagation());

      if (matchingStations.length === 0) {
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = 'No matching station';
        stationSelect.appendChild(noneOpt);
        stationSelect.disabled = true;
      } else {
        const countById = new Map<string, number>();
        for (const st of matchingStations) {
          countById.set(st.itemId, (countById.get(st.itemId) ?? 0) + 1);
        }

        const autoOpt = document.createElement('option');
        autoOpt.value = '';
        autoOpt.textContent = 'Auto station';
        autoOpt.selected = !member.assignedItemUid;
        stationSelect.appendChild(autoOpt);

        for (const st of matchingStations) {
          const def = this.store.data.itemsById.get(st.itemId);
          const baseName = def?.name ?? st.itemId;
          const dup = (countById.get(st.itemId) ?? 0) > 1;
          const opt = document.createElement('option');
          opt.value = st.uid;
          opt.textContent = dup ? `${baseName} (${st.x}, ${st.z})` : baseName;
          opt.selected = member.assignedItemUid === st.uid;
          stationSelect.appendChild(opt);
        }
      }

      stationSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        this.audioModule?.playUiClick();
        const nextUid = stationSelect.value || undefined;
        this.store.assignStaffStation(member.id, nextUid);
      });

      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'btn btn-xs staff-move-btn';
      moveBtn.textContent = 'Move';
      moveBtn.disabled = matchingStations.length === 0;
      moveBtn.title =
        matchingStations.length === 0
          ? 'Place a matching station first'
          : `Click a floor tile near a station to move ${member.name}`;
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audioModule?.playUiClick();
        this.startMovingStaff(member.id);
      });

      controlsRow.append(stationSelect, moveBtn);
      card.append(row, controlsRow);
      dutyList.appendChild(card);
    }

    this.visitorsPopoverEl.appendChild(dutyList);
  }

  private syncVisitorsUi(): void {
    const count = this.visitorModule?.getActiveVisitors().length ?? 0;
    if (this.visitorCountEl) {
      this.visitorCountEl.textContent = String(count);
      this.visitorCountEl.classList.toggle('has-active', count > 0);
    }
    if (this.activePopover === 'visitors') {
      this.renderVisitorsPopover();
    }
    if (this.activePopover === 'cheats') {
      this.renderCheatsPopover();
    }
    if (this.activePopover === 'view') {
      this.renderViewPopover();
    }
    if (this.getCameraViewMode() === 'visitor_pov') {
      this.renderPovBanner();
    }
    if (this.selectedVisitorId) {
      this.renderVisitorProfileCard();
    }
  }

  private syncDockToolButtons(): void {
    const mode = this.store.getModeState().mode;
    const gridOn = this.store.isGridVisible();

    if (this.selectToolBtnEl) {
      this.selectToolBtnEl.classList.toggle('active-tool', mode === 'select');
    }
    if (this.bulkSelectBtnEl) {
      this.bulkSelectBtnEl.classList.toggle('active-tool', mode === 'bulk-select');
    }
    if (this.bulkEraseBtnEl) {
      this.bulkEraseBtnEl.classList.toggle('active-erase', mode === 'erase');
    }
    if (this.gridToggleBtnEl) {
      this.gridToggleBtnEl.classList.toggle('active-tool', gridOn);
    }
    if (this.lotSizeBtnEl) {
      this.lotSizeBtnEl.classList.toggle('active-tool', this.activePopover === 'lot');
    }
  }

  private syncSoundButton(): void {
    if (!this.soundBtnEl) return;
    const muted = this.audioModule?.isMuted() ?? false;
    this.soundBtnEl.innerHTML = '';
    this.soundBtnEl.appendChild(createIconEl(muted ? 'soundOff' : 'soundOn', 21));
    this.soundBtnEl.dataset.tooltip = muted ? 'Sound Off' : 'Sound';
    this.soundBtnEl.removeAttribute('title');
    this.soundBtnEl.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.soundBtnEl.classList.toggle('muted-state', muted);
  }

  private setStorybookSlotIcon(slot: HTMLElement, iconName: StorybookIconName, size: number): void {
    if (slot.dataset.icon === iconName) return;
    slot.dataset.icon = iconName;
    slot.innerHTML = '';
    slot.appendChild(createStorybookIconEl(iconName, size));
  }

  private syncAtmosphereTopPill(): void {
    const state = this.store.getState();
    const activeView =
      this.sceneryModule?.getActiveView() ??
      this.store.data.viewsById.get(state.sceneryViewId) ??
      this.store.data.scenery.views[0];
    const activeWeather =
      this.sceneryModule?.getActiveWeather() ??
      this.store.data.weathersById.get(state.weatherId) ??
      this.store.data.scenery.weathers[0];

    const running = this.store.isTimeCycleRunning();
    const timeHour = this.store.getTimeHour();

    const locIcon = getLocationStorybookIconName(activeView.id);
    const timeIcon = timeHourToStorybookIcon(timeHour, running);
    const weatherIcon = getWeatherStorybookIconName(activeWeather.id);

    this.setStorybookSlotIcon(this.atmoLocSlotEl, locIcon, 22);
    this.setStorybookSlotIcon(this.atmoTimeSlotEl, timeIcon, 22);
    this.setStorybookSlotIcon(this.atmoWeatherSlotEl, weatherIcon, 22);

    this.atmosphereBtnEl.dataset.tooltip = `${activeView.name} · ${timeHourToLabel(timeHour, running)} · ${activeWeather.name}`;
    this.atmosphereBtnEl.removeAttribute('title');
  }

  private syncHud(): void {
    const state = this.store.getState();
    const evaluation = evaluateRoomType(state, this.store.data);

    this.setStorybookSlotIcon(
      this.roomIconSlotEl,
      getRoomStorybookIconName(evaluation.labelInfo.id),
      22,
    );
    this.roomLabelTextEl.textContent = evaluation.labelInfo.label;

    this.undoBtn.disabled = !this.store.canUndo();
    this.redoBtn.disabled = !this.store.canRedo();

    if (this.lotSizeBadgeEl) {
      this.lotSizeBadgeEl.textContent = `${state.gridWidth}×${state.gridDepth}`;
    }

    this.syncAtmosphereTopPill();
    this.syncDockToolButtons();

    if (this.activePopover === 'room') this.renderRoomPopover();
    if (this.activePopover === 'atmosphere') this.renderAtmospherePopover();
    if (this.activePopover === 'menu') this.renderMenuPopover();
    if (this.activePopover === 'lot') this.renderLotPopover();

    this.renderContextBar();
    this.updateTopOffset();
  }

  private async handleImportSelected(): Promise<void> {
    const file = this.fileInputEl.files?.[0];
    if (!file) return;
    try {
      const { state, warnings } = await importHouseFromFile(file, this.store.data);
      this.store.loadHouse(state, { reason: 'import' });
      const warnSuffix = warnings.length > 0 ? ` (${warnings.length} skipped)` : '';
      this.store.notify(`Imported ${state.items.length} items${warnSuffix}`, 'success');
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : 'Failed to import house file.',
        'error',
      );
    }
  }

  private showToast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = message;
    this.toastStackEl.appendChild(el);
    window.setTimeout(() => {
      el.remove();
    }, 2600);
  }
}
