import type { AudioModule } from '../audio/AudioModule';
import type { CatalogTabId, FurnitureItemDef, VisitorDef } from '../data/schemas';
import type { HoverItemInfo, PlacementController } from '../engine/PlacementController';
import type { SceneManager } from '../engine/SceneManager';
import { evaluateRoomType } from '../rooms/RoomEvaluator';
import { decodeHouseFromShareLink, encodeHouseToShareUrl } from '../save/shareLink';
import { exportHouseToFile, importHouseFromFile } from '../save/fileIO';
import type { SceneryModule } from '../scenery/SceneryModule';
import { createEmptyHouse, createStarterHouse } from '../state/defaultHouse';
import type { EraseFilter, ExpandSide, HouseStore, WallViewMode } from '../state/houseStore';
import type { VisitorModule } from '../visitors/VisitorModule';
import { CelebrationBanner } from './CelebrationBanner';
import { type IconName, createIconEl } from './icons';

export interface HudModules {
  visitorModule?: VisitorModule;
  audioModule?: AudioModule;
  sceneryModule?: SceneryModule;
}

type PopoverKind = 'room' | 'atmosphere' | 'visitors' | 'menu' | 'lot' | null;
type BasicsGroupId = 'floors' | 'walls' | 'doors' | 'windows';

interface SubcategoryDef {
  id: string;
  label: string;
  match: (item: FurnitureItemDef) => boolean;
}

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

const WEATHER_ICON_NAMES: Record<string, IconName> = {
  clear: 'sun',
  rain: 'cloudRain',
  snow: 'snow',
  fog: 'fog',
  thunderstorm: 'thunder',
};

const TIME_TICKS: Array<{ label: string; hour: number }> = [
  { label: 'Dawn', hour: 6.5 },
  { label: 'Noon', hour: 12.0 },
  { label: 'Sunset', hour: 18.5 },
  { label: 'Night', hour: 22.5 },
];

const WALL_VIEW_OPTIONS: Array<{ id: WallViewMode; label: string; fullLabel: string }> = [
  { id: 'auto', label: 'Auto', fullLabel: 'Walls: Auto Translucent' },
  { id: 'translucent', label: 'Translucent', fullLabel: 'Walls: All Translucent' },
  { id: 'solid', label: 'Solid', fullLabel: 'Walls: Solid' },
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
    {
      id: 'dining',
      label: 'Dining',
      match: (i) => i.id.includes('dining_'),
    },
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

function formatClockHour(rawHour: number): { text: string; shortText: string; icon: IconName; emoji: string } {
  const h = ((rawHour % 24) + 24) % 24;
  const totalMinutes = Math.round(h * 60) % (24 * 60);
  const hour24 = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(mins).padStart(2, '0');
  const text = `${hour12}:${mm} ${period}`;
  const shortText = `${hour12}:${mm}${period === 'AM' ? 'a' : 'p'}`;

  let icon: IconName = 'sun';
  let emoji = '☀';
  if (h < 5.5 || h >= 20.2) {
    icon = 'moon';
    emoji = '🌙';
  } else if (h < 8.5) {
    icon = 'sunrise';
    emoji = '🌅';
  } else if (h >= 17.2) {
    icon = 'sunset';
    emoji = '🌇';
  }
  return { text, shortText, icon, emoji };
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

  private lastRoomId: string;
  private lastRoomLabel: string;
  private catalogRenderGen = 0;
  private previewObserver: IntersectionObserver | null = null;
  private unsubscribes: Array<() => void> = [];

  // DOM references
  private topBarEl!: HTMLDivElement;
  private roomBtnEl!: HTMLButtonElement;
  private roomDotEl!: HTMLSpanElement;
  private roomLabelTextEl!: HTMLSpanElement;
  private roomOverrideTagEl!: HTMLSpanElement;
  private atmosphereBtnEl!: HTMLButtonElement;
  private atmosphereDotEl!: HTMLSpanElement;
  private atmosphereTextEl!: HTMLSpanElement;

  private liveModeBtnEl!: HTMLButtonElement;
  private buildModeBtnEl!: HTMLButtonElement;
  private undoRedoGroupEl!: HTMLDivElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private wallViewBtnEl!: HTMLButtonElement;
  private cinematicBtnEl!: HTMLButtonElement;
  private cinematicExitBtnEl!: HTMLButtonElement;

  private visitorsBtnEl!: HTMLButtonElement;
  private visitorCountEl!: HTMLSpanElement;
  private soundBtnEl!: HTMLButtonElement;
  private menuBtnEl!: HTMLButtonElement;

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
  private roomPopoverEl!: HTMLDivElement;
  private atmospherePopoverEl!: HTMLDivElement;
  private visitorsPopoverEl!: HTMLDivElement;
  private menuPopoverEl!: HTMLDivElement;
  private lotPopoverEl!: HTMLDivElement;
  private fileInputEl!: HTMLInputElement;

  // Live range readout refs inside open popovers so dragging never rebuilds DOM
  private timeSliderEl: HTMLInputElement | null = null;
  private timeReadoutEl: HTMLSpanElement | null = null;
  private volumeSliderEls: HTMLInputElement[] = [];
  private volumeValueEls: HTMLSpanElement[] = [];

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

    this.renderTabRail();
    this.renderSubcategories();
    this.renderSidebarCatalog();
    this.syncEditModeUi();
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

        if (reason === 'timeOfDay' && this.activePopover === 'atmosphere') {
          this.syncAtmosphereTopPill();
          this.syncTimeSliderLive();
          return;
        }
        this.syncHud();
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
        if (this.activePopover === 'atmosphere') this.renderAtmospherePopover();
        if (this.activePopover === 'lot') this.renderLotPopover();
      }),
      this.store.on('toast', ({ message, tone }) => this.showToast(message, tone)),
    );

    if (this.visitorModule) {
      this.unsubscribes.push(this.visitorModule.onChange(() => this.syncVisitorsUi()));
    }
    if (this.audioModule) {
      this.unsubscribes.push(
        this.audioModule.onMuteChange(() => this.syncSoundButton()),
        this.audioModule.onVolumeChange(() => this.syncVolumeSlidersLive()),
      );
    }

    const onDocPointerDown = (event: PointerEvent) => {
      if (!this.activePopover) return;
      const target = event.target as Node | null;
      if (!target) return;
      const keepOpenContainers: Array<HTMLElement | undefined> = [
        this.roomPopoverEl,
        this.atmospherePopoverEl,
        this.visitorsPopoverEl,
        this.menuPopoverEl,
        this.lotPopoverEl,
        this.roomBtnEl,
        this.atmosphereBtnEl,
        this.visitorsBtnEl,
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
        if (this.sceneManager.isoCamera.isCinematicMode()) {
          this.setCinematicMode(false);
          return;
        }
        if (this.activePopover) {
          this.setActivePopover(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.unsubscribes.push(() => window.removeEventListener('keydown', onKeyDown));
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
    this.previewObserver?.disconnect();
    this.previewObserver = null;
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.celebrationBanner.dispose();
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
    this.fileInputEl.accept = '.json,.cozyhouse.json,application/json';
    this.fileInputEl.style.display = 'none';
    this.fileInputEl.addEventListener('change', () => {
      void this.handleImportSelected();
    });
    this.root.appendChild(this.fileInputEl);

    // ── Top Bar (3 calm floating islands, single-row at 1280px+) ──
    this.topBarEl = document.createElement('div');
    this.topBarEl.className = 'hud-bar';

    // Left Island: Brand + Room Label + Atmosphere
    const leftIsland = document.createElement('div');
    leftIsland.className = 'hud-island';

    const brand = document.createElement('div');
    brand.className = 'brand-lockup';
    brand.append(createIconEl('brand', 17));
    const brandText = document.createElement('span');
    brandText.className = 'brand-title';
    brandText.textContent = 'Cozyhouse';
    brand.appendChild(brandText);

    const divLeft = document.createElement('span');
    divLeft.className = 'hud-divider';

    this.roomBtnEl = document.createElement('button');
    this.roomBtnEl.type = 'button';
    this.roomBtnEl.className = 'island-btn room-badge-btn';
    this.roomBtnEl.title = 'Inspect room tags or choose a manual room type';

    this.roomDotEl = document.createElement('span');
    this.roomDotEl.className = 'status-dot';
    this.roomLabelTextEl = document.createElement('span');
    this.roomLabelTextEl.className = 'room-label-text';
    this.roomOverrideTagEl = document.createElement('span');
    this.roomOverrideTagEl.className = 'room-override-chip hidden';
    this.roomOverrideTagEl.textContent = 'Manual';
    const roomChevron = document.createElement('span');
    roomChevron.className = 'btn-chevron';
    roomChevron.textContent = '▾';
    this.roomBtnEl.append(
      this.roomDotEl,
      this.roomLabelTextEl,
      this.roomOverrideTagEl,
      roomChevron,
    );
    this.roomBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('room');
    });

    this.atmosphereBtnEl = document.createElement('button');
    this.atmosphereBtnEl.type = 'button';
    this.atmosphereBtnEl.className = 'island-btn atmosphere-btn';
    this.atmosphereBtnEl.title = '24-hour time, window view, weather & lighting';
    this.atmosphereDotEl = document.createElement('span');
    this.atmosphereDotEl.className = 'atmosphere-dot';
    this.atmosphereTextEl = document.createElement('span');
    this.atmosphereTextEl.className = 'tabular-num';
    const atmoChevron = document.createElement('span');
    atmoChevron.className = 'btn-chevron';
    atmoChevron.textContent = '▾';
    this.atmosphereBtnEl.append(this.atmosphereDotEl, this.atmosphereTextEl, atmoChevron);
    this.atmosphereBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('atmosphere');
    });

    leftIsland.append(brand, divLeft, this.roomBtnEl, this.atmosphereBtnEl);

    // Center Island: Live / Build Switch + Build Undo/Redo + Camera + Wall Cutaway + Cinematic
    const centerIsland = document.createElement('div');
    centerIsland.className = 'hud-island';

    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'mode-switch';
    modeSwitch.setAttribute('role', 'group');
    modeSwitch.setAttribute('aria-label', 'Game mode');

    this.liveModeBtnEl = document.createElement('button');
    this.liveModeBtnEl.type = 'button';
    this.liveModeBtnEl.className = 'mode-seg-btn live-seg';
    this.liveModeBtnEl.title = 'Live Mode — interact with items and watch visitors';
    this.liveModeBtnEl.append(createIconEl('live', 14));
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
    this.buildModeBtnEl.append(createIconEl('build', 14));
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
    );
    this.undoBtn.className = 'icon-btn';
    this.undoBtn.title = 'Undo (Cmd/Ctrl+Z)';
    this.undoBtn.setAttribute('aria-label', 'Undo');

    this.redoBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        if (this.store.redo()) this.store.notify('Redid action', 'info');
      },
      'ghost',
      'redo',
    );
    this.redoBtn.className = 'icon-btn';
    this.redoBtn.title = 'Redo (Cmd/Ctrl+Shift+Z)';
    this.redoBtn.setAttribute('aria-label', 'Redo');

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
    );
    rotLeftBtn.className = 'icon-btn';
    rotLeftBtn.title = 'Rotate view left 90° (Q)';
    rotLeftBtn.setAttribute('aria-label', 'Rotate view left 90 degrees');

    const rotRightBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.rotateStep(1);
      },
      'ghost',
      'rotRight',
    );
    rotRightBtn.className = 'icon-btn';
    rotRightBtn.title = 'Rotate view right 90° (E)';
    rotRightBtn.setAttribute('aria-label', 'Rotate view right 90 degrees');

    const zoomOutBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.zoomByFactor(1 / 1.2);
      },
      'ghost',
      'minus',
    );
    zoomOutBtn.className = 'icon-btn';
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.setAttribute('aria-label', 'Zoom out');

    const zoomInBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.zoomByFactor(1.2);
      },
      'ghost',
      'plus',
    );
    zoomInBtn.className = 'icon-btn';
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.setAttribute('aria-label', 'Zoom in');

    const resetViewBtn = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.sceneManager.isoCamera.resetView();
      },
      'ghost',
      'reset',
    );
    resetViewBtn.className = 'icon-btn';
    resetViewBtn.title = 'Reset camera view';
    resetViewBtn.setAttribute('aria-label', 'Reset camera view');

    this.wallViewBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        const nextMode = this.store.cycleWallViewMode();
        const meta = WALL_VIEW_OPTIONS.find((o) => o.id === nextMode) ?? WALL_VIEW_OPTIONS[0];
        this.store.notify(meta.fullLabel, 'info');
      },
      'ghost',
      'wallCutaway',
    );
    this.wallViewBtnEl.className = 'icon-btn wall-view-btn';
    this.wallViewBtnEl.title = 'Walls: Auto Translucent';
    this.wallViewBtnEl.setAttribute('aria-label', 'Walls: Auto Translucent');

    this.cinematicBtnEl = this.makeBtn(
      '',
      () => {
        this.audioModule?.playUiClick();
        this.setCinematicMode(!this.sceneManager.isoCamera.isCinematicMode());
      },
      'ghost',
      'cinematic',
    );
    this.cinematicBtnEl.className = 'icon-btn cinematic-btn';
    this.cinematicBtnEl.title = 'Cinematic Mode';
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
      this.cinematicBtnEl,
    );

    // Right Island: Visitors + Sound Mute + House Menu (⋯)
    const rightIsland = document.createElement('div');
    rightIsland.className = 'hud-island';

    this.visitorsBtnEl = document.createElement('button');
    this.visitorsBtnEl.type = 'button';
    this.visitorsBtnEl.className = 'island-btn visitors-btn';
    this.visitorsBtnEl.title = 'Invite guests & inspect visitor status';
    this.visitorsBtnEl.appendChild(createIconEl('visitors', 15));
    const visitorsLabel = document.createElement('span');
    visitorsLabel.textContent = 'Visitors';
    this.visitorCountEl = document.createElement('span');
    this.visitorCountEl.className = 'count-pill';
    this.visitorCountEl.textContent = '0';
    this.visitorsBtnEl.append(visitorsLabel, this.visitorCountEl);
    this.visitorsBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('visitors');
    });

    this.soundBtnEl = document.createElement('button');
    this.soundBtnEl.type = 'button';
    this.soundBtnEl.className = 'icon-btn sound-btn';
    this.soundBtnEl.addEventListener('click', () => {
      if (!this.audioModule) return;
      const nextMuted = !this.audioModule.isMuted();
      this.audioModule.setMuted(nextMuted);
      if (!nextMuted) {
        this.audioModule.playUiClick();
      }
      this.syncSoundButton();
    });

    this.menuBtnEl = document.createElement('button');
    this.menuBtnEl.type = 'button';
    this.menuBtnEl.className = 'icon-btn menu-btn';
    this.menuBtnEl.title = 'House menu — Share Link, Volume, Export, Import & Controls';
    this.menuBtnEl.setAttribute('aria-label', 'House menu');
    this.menuBtnEl.appendChild(createIconEl('menu', 16));
    this.menuBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('menu');
    });

    rightIsland.append(this.visitorsBtnEl, this.soundBtnEl, this.menuBtnEl);

    this.topBarEl.append(leftIsland, centerIsland, rightIsland);
    this.root.appendChild(this.topBarEl);

    // ── Left-Side Vertical Build Sidebar (Slides in on Build Mode) ──
    this.buildSidebarEl = document.createElement('aside');
    this.buildSidebarEl.className = 'build-sidebar tucked';
    this.buildSidebarEl.setAttribute('aria-label', 'Build Catalog');

    this.tabRailEl = document.createElement('div');
    this.tabRailEl.className = 'sidebar-tab-rail';

    const mainCol = document.createElement('div');
    mainCol.className = 'sidebar-main-col';

    // Compact Build Tool Strip
    const toolRow = document.createElement('div');
    toolRow.className = 'sidebar-tool-row';

    this.selectToolBtnEl = this.makeBtn(
      'Select',
      () => {
        this.audioModule?.playUiClick();
        this.store.setSelectMode();
      },
      'ghost',
      'select',
      13,
    );
    this.selectToolBtnEl.className = 'tool-btn';
    this.selectToolBtnEl.title = 'Select, move, rotate, or recolor items';

    this.bulkSelectBtnEl = this.makeBtn(
      'Bulk',
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
      13,
    );
    this.bulkSelectBtnEl.className = 'tool-btn';
    this.bulkSelectBtnEl.title = 'Bulk Select — click or drag box';

    this.bulkEraseBtnEl = this.makeBtn(
      'Erase',
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
      13,
    );
    this.bulkEraseBtnEl.className = 'tool-btn';
    this.bulkEraseBtnEl.title = 'Bulk Erase — click or drag to remove';

    this.lotSizeBtnEl = document.createElement('button');
    this.lotSizeBtnEl.type = 'button';
    this.lotSizeBtnEl.className = 'tool-btn';
    this.lotSizeBtnEl.title = 'Expand lot in any direction & restyle all walls or floors';
    this.lotSizeBtnEl.appendChild(createIconEl('lot', 13));
    this.lotSizeBadgeEl = document.createElement('span');
    this.lotSizeBadgeEl.className = 'lot-dim-chip';
    this.lotSizeBtnEl.appendChild(this.lotSizeBadgeEl);
    this.lotSizeBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.togglePopover('lot');
    });

    this.gridToggleBtnEl = this.makeBtn(
      'Grid',
      () => {
        this.audioModule?.playUiClick();
        this.store.setGridVisible(!this.store.isGridVisible());
      },
      'ghost',
      'grid',
      13,
    );
    this.gridToggleBtnEl.className = 'tool-btn';
    this.gridToggleBtnEl.title = 'Toggle buildable tile grid lines';

    toolRow.append(
      this.selectToolBtnEl,
      this.bulkSelectBtnEl,
      this.bulkEraseBtnEl,
      this.lotSizeBtnEl,
      this.gridToggleBtnEl,
    );

    // Search Row
    const searchWrap = document.createElement('div');
    searchWrap.className = 'catalog-search-wrap';
    searchWrap.appendChild(createIconEl('search', 14));

    this.searchInputEl = document.createElement('input');
    this.searchInputEl.type = 'text';
    this.searchInputEl.className = 'catalog-search-input';
    this.searchInputEl.placeholder = 'Search furniture…';
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

    // Subcategory Pills Strip
    this.subcategoryStripEl = document.createElement('div');
    this.subcategoryStripEl.className = 'subcategory-strip';

    // Downward-scrolling Catalog Body
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

    this.visitorsPopoverEl = document.createElement('div');
    this.visitorsPopoverEl.className = 'hud-popover visitors-popover hidden';
    this.root.appendChild(this.visitorsPopoverEl);

    this.menuPopoverEl = document.createElement('div');
    this.menuPopoverEl.className = 'hud-popover menu-popover hidden';
    this.root.appendChild(this.menuPopoverEl);

    this.lotPopoverEl = document.createElement('div');
    this.lotPopoverEl.className = 'hud-popover lot-popover hidden';
    this.root.appendChild(this.lotPopoverEl);

    // ── Edit-Mode Hover Tooltip (Name Only) ──
    this.hoverTooltipEl = document.createElement('div');
    this.hoverTooltipEl.className = 'hover-item-tooltip';
    this.root.appendChild(this.hoverTooltipEl);

    // Hover validation hint pill
    this.hoverHintEl = document.createElement('div');
    this.hoverHintEl.className = 'floating-hint';
    this.root.appendChild(this.hoverHintEl);

    // Toast stack
    this.toastStackEl = document.createElement('div');
    this.toastStackEl.className = 'toast-stack';
    this.root.appendChild(this.toastStackEl);

    // Cinematic Mode Exit Pill
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
      'Build & Decorate',
      () => {
        this.audioModule?.playUiClick();
        this.store.setEditMode(true);
      },
      'primary',
      'build',
      15,
    );
    enterBuildBtn.className = 'live-build-cta';
    this.liveCtaWrapEl.appendChild(enterBuildBtn);
    this.root.appendChild(this.liveCtaWrapEl);

    // ── Floating Bottom Selection / Place / Bulk / Erase Action Bar ──
    this.contextBarEl = document.createElement('div');
    this.contextBarEl.className = 'context-bar hidden';
    this.root.appendChild(this.contextBarEl);
  }

  private setCinematicMode(enabled: boolean): void {
    if (enabled) {
      this.store.setEditMode(false);
      this.setActivePopover(null);
      this.setHoverItem(null);
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
    this.updateTopOffset();
    this.activePopover = kind;
    this.timeSliderEl = null;
    this.timeReadoutEl = null;
    this.volumeSliderEls = [];
    this.volumeValueEls = [];

    this.roomPopoverEl.classList.toggle('hidden', kind !== 'room');
    this.atmospherePopoverEl.classList.toggle('hidden', kind !== 'atmosphere');
    this.visitorsPopoverEl.classList.toggle('hidden', kind !== 'visitors');
    this.menuPopoverEl.classList.toggle('hidden', kind !== 'menu');
    this.lotPopoverEl.classList.toggle('hidden', kind !== 'lot');

    this.roomBtnEl.classList.toggle('active-trigger', kind === 'room');
    this.atmosphereBtnEl.classList.toggle('active-trigger', kind === 'atmosphere');
    this.visitorsBtnEl.classList.toggle('active-trigger', kind === 'visitors');
    this.menuBtnEl.classList.toggle('active-trigger', kind === 'menu');
    this.lotSizeBtnEl.classList.toggle('active-tool', kind === 'lot');

    if (kind === 'room') this.renderRoomPopover();
    if (kind === 'atmosphere') this.renderAtmospherePopover();
    if (kind === 'visitors') this.renderVisitorsPopover();
    if (kind === 'menu') this.renderMenuPopover();
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
      btn.style.setProperty('--tab-accent', tab.color);

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

    // ── Consolidated Basics Tab (4 iconic cards + inline style grid when selected) ──
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

      // Inline Basics Style Sub-Picker right inside the sidebar!
      if (this.activeBasicsGroup) {
        this.renderInlineBasicsSubPicker(this.activeBasicsGroup);
      }
      return;
    }

    // ── Standard 2-column Vertical Grid (with Subcategory or Global Search filtering) ──
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
      msg.textContent = query ? 'No items match your search.' : 'No items in this subcategory.';
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
    title.textContent = `${groupMeta.label} Styles`;
    const closeBtn = this.makeBtn('Done', () => {
      this.audioModule?.playUiClick();
      this.activeBasicsGroup = null;
      this.store.setSelectMode();
    }, 'primary');
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

    if (groupId === 'floors' || groupId === 'walls') {
      const applyBtn = this.makeBtn(
        groupId === 'floors' ? 'Apply All Floors' : 'Apply All Walls',
        () => {
          this.audioModule?.playUiClick();
          this.applySurfaceStyleToAll(groupId, activeDef.id, activeVariantId);
        },
      );
      applyBtn.className = 'btn btn-xs';
      swatchRow.appendChild(applyBtn);
    }
    panel.appendChild(swatchRow);

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
    const uids = this.store
      .getState()
      .items.filter((it) => {
        const d = this.store.data.itemsById.get(it.itemId);
        return kind === 'floors' ? this.isFloorTileDef(d) : this.isStructuralWallDef(d);
      })
      .map((it) => it.uid);

    if (uids.length === 0) {
      this.store.notify(
        kind === 'floors' ? 'No floor tiles placed yet' : 'No walls placed yet',
        'info',
      );
      return;
    }

    const updated = this.store.replaceItemsType(uids, itemId, variantId);
    const noun = kind === 'floors' ? 'floor tile' : 'wall';
    this.store.notify(
      `Updated ${updated} ${noun}${updated === 1 ? '' : 's'} to ${def?.name ?? itemId}`,
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
      title.textContent = 'Bulk Erase — click or drag';

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
      title.textContent = `Placing: ${def.name}`;

      const swatches = this.buildVariantSwatches(def, activeVariantId, (variantId) => {
        this.audioModule?.playUiClick();
        this.store.setPlacementVariant(variantId);
      });

      this.contextBarEl.append(
        contextPreview,
        title,
        swatches,
        this.makeBtn('Rotate 90°', () => {
          this.audioModule?.playUiClick();
          this.store.rotatePlacement(1);
        }),
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
      title.textContent = `Moving ${def?.name ?? selected.itemId} — click to drop`;

      this.contextBarEl.append(
        title,
        this.makeBtn('Rotate 90°', () => {
          this.audioModule?.playUiClick();
          this.store.rotatePlacement(1);
        }),
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
            this.buildStyleSelect(
              wallDefs,
              def.id,
              (nextItemId) => {
                this.store.replaceItemsType([selected.uid], nextItemId);
              },
              'Wall style…',
            ),
          );
        }
      } else if (this.isFloorTileDef(def)) {
        const floorDefs = this.getBasicsGroupItems('floors');
        if (floorDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(
              floorDefs,
              def.id,
              (nextItemId) => {
                this.store.replaceItemsType([selected.uid], nextItemId);
              },
              'Floor style…',
            ),
          );
        }
      } else if (this.isDoorDef(def)) {
        const doorDefs = this.getBasicsGroupItems('doors');
        if (doorDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(
              doorDefs,
              def.id,
              (nextItemId) => {
                this.store.replaceItemsType([selected.uid], nextItemId);
              },
              'Door style…',
            ),
          );
        }
      } else if (this.isWindowDef(def)) {
        const winDefs = this.getBasicsGroupItems('windows');
        if (winDefs.length > 1) {
          this.contextBarEl.appendChild(
            this.buildStyleSelect(
              winDefs,
              def.id,
              (nextItemId) => {
                this.store.replaceItemsType([selected.uid], nextItemId);
              },
              'Window style…',
            ),
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
        this.makeBtn('Rotate 90°', () => {
          this.audioModule?.playUiClick();
          this.placement.rotateSelectedInPlace();
        }),
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
    countPill.textContent =
      uids.length === 0 ? '0 selected — click or drag box' : `${uids.length} selected`;

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
      const allWalls = selectedItems.every((i) =>
        this.isStructuralWallDef(this.store.data.itemsById.get(i.itemId)),
      );
      const allFloors = selectedItems.every((i) =>
        this.isFloorTileDef(this.store.data.itemsById.get(i.itemId)),
      );

      if (allWalls) {
        const commonId = itemIds.size === 1 ? selectedItems[0].itemId : null;
        this.contextBarEl.appendChild(
          this.buildStyleSelect(
            this.getBasicsGroupItems('walls'),
            commonId,
            (nextId) => {
              const changed = this.store.replaceItemsType(uids, nextId);
              if (changed > 0) {
                const nextDef = this.store.data.itemsById.get(nextId);
                this.store.notify(
                  `Updated ${changed} walls to ${nextDef?.name ?? nextId}`,
                  'success',
                );
              }
            },
            'Swap wall style…',
          ),
        );
      } else if (allFloors) {
        const commonId = itemIds.size === 1 ? selectedItems[0].itemId : null;
        this.contextBarEl.appendChild(
          this.buildStyleSelect(
            this.getBasicsGroupItems('floors'),
            commonId,
            (nextId) => {
              const changed = this.store.replaceItemsType(uids, nextId);
              if (changed > 0) {
                const nextDef = this.store.data.itemsById.get(nextId);
                this.store.notify(
                  `Updated ${changed} floors to ${nextDef?.name ?? nextId}`,
                  'success',
                );
              }
            },
            'Swap floor style…',
          ),
        );
      }

      if (itemIds.size === 1) {
        const sharedDef = this.store.data.itemsById.get(selectedItems[0].itemId);
        if (sharedDef) {
          const variants = new Set(selectedItems.map((i) => i.variantId));
          const activeVariant = variants.size === 1 ? selectedItems[0].variantId : '';
          this.contextBarEl.appendChild(
            this.buildVariantSwatches(sharedDef, activeVariant, (variantId) => {
              this.audioModule?.playUiClick();
              this.store.setItemsVariant(uids, variantId);
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

  private renderLotPopover(): void {
    const state = this.store.getState();
    this.ensureValidGroupDefaults();
    const wallDefs = this.getBasicsGroupItems('walls');
    const floorDefs = this.getBasicsGroupItems('floors');
    const activeWallDef =
      this.store.data.itemsById.get(this.groupActiveItem.walls) ?? wallDefs[0];
    const activeFloorDef =
      this.store.data.itemsById.get(this.groupActiveItem.floors) ?? floorDefs[0];

    this.lotPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Lot Size & Surfaces';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.lotPopoverEl.appendChild(header);

    const dirLabel = document.createElement('div');
    dirLabel.className = 'popover-section-label';
    dirLabel.textContent = 'Expand Any Side (Rectangular)';
    this.lotPopoverEl.appendChild(dirLabel);

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
          this.store.notify(`Lot resized to ${s.gridWidth}×${s.gridDepth}`, 'info');
        }
      });
      shrink.className = 'btn btn-xs';

      const expand = this.makeBtn(
        '+2',
        () => {
          this.audioModule?.playUiClick();
          if (this.store.expandDirection(side, 2)) {
            const s = this.store.getState();
            this.store.notify(`Expanded ${name} to ${s.gridWidth}×${s.gridDepth}`, 'success');
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
          this.store.notify(`Lot width set to ${nw}×${state.gridDepth}`, 'success');
        }
      }),
      makeStepper('Depth', state.gridDepth, (d) => {
        const nd = Math.max(8, Math.min(36, state.gridDepth + d));
        if (this.store.resizeGrid(state.gridWidth, nd)) {
          this.store.notify(`Lot depth set to ${state.gridWidth}×${nd}`, 'success');
        }
      }),
    );
    this.lotPopoverEl.appendChild(stepperRow);

    const gridRow = document.createElement('div');
    gridRow.className = 'toggle-setting-row';
    const gridText = document.createElement('span');
    gridText.className = 'toggle-setting-label';
    gridText.textContent = 'Show Buildable Grid Tiles';
    const gridOn = this.store.isGridVisible();
    const gridBtn = this.makeBtn(
      gridOn ? 'Visible' : 'Auto (Build Only)',
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
      wallLabel.textContent = 'Quick Restyle All Walls';
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

      const applyBtn = this.makeBtn('Apply All', () => {
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
      floorLabel.textContent = 'Quick Restyle All Floors';
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

      const applyBtn = this.makeBtn('Apply All', () => {
        this.audioModule?.playUiClick();
        this.applySurfaceStyleToAll('floors', activeFloorDef.id, this.groupActiveVariant.floors);
      });
      applyBtn.className = 'btn btn-xs';

      row.append(preview, mid, applyBtn);
      this.lotPopoverEl.appendChild(row);
    }
  }

  private buildVolumeControl(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'volume-control-row';

    const icon = createIconEl('volume', 15);
    const label = document.createElement('span');
    label.className = 'volume-label';
    label.textContent = 'Volume';

    const vol = this.audioModule?.getVolume() ?? 0.85;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'volume-slider';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(vol * 100));
    slider.setAttribute('aria-label', 'Master volume');

    const pct = document.createElement('span');
    pct.className = 'volume-pct tabular-num';
    pct.textContent = `${Math.round(vol * 100)}%`;

    slider.addEventListener('input', () => {
      const next = Number(slider.value) / 100;
      pct.textContent = `${slider.value}%`;
      if (this.audioModule) {
        if (next > 0 && this.audioModule.isMuted()) {
          this.audioModule.setMuted(false);
        }
        this.audioModule.setVolume(next);
      }
    });

    this.volumeSliderEls.push(slider);
    this.volumeValueEls.push(pct);

    wrap.append(icon, label, slider, pct);
    return wrap;
  }

  private syncVolumeSlidersLive(): void {
    const pct = Math.round((this.audioModule?.getVolume() ?? 0.85) * 100);
    for (const s of this.volumeSliderEls) {
      if (s.isConnected && document.activeElement !== s) {
        s.value = String(pct);
      }
    }
    for (const v of this.volumeValueEls) {
      if (v.isConnected) {
        v.textContent = `${pct}%`;
      }
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
    h4.textContent = 'House Menu';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.menuPopoverEl.appendChild(header);

    const statusLine = document.createElement('div');
    statusLine.className = 'menu-status-row tabular-num';
    statusLine.innerHTML = `<span>${this.saveStatusText}</span><span>${state.items.length} items · ${state.gridWidth}×${state.gridDepth}</span>`;
    this.menuPopoverEl.appendChild(statusLine);

    // Audio Volume Slider
    if (this.audioModule) {
      this.menuPopoverEl.appendChild(this.buildVolumeControl());
    }

    // ── Shareable Link Section ──
    const shareLabel = document.createElement('div');
    shareLabel.className = 'popover-section-label';
    shareLabel.textContent = 'Shareable House Link';
    this.menuPopoverEl.appendChild(shareLabel);

    const copyLinkBtn = this.makeBtn(
      'Copy Share Link',
      () => {
        this.audioModule?.playUiClick();
        void (async () => {
          try {
            const url = await encodeHouseToShareUrl(this.store.getState());
            const copied = await this.copyTextToClipboard(url);
            try {
              const parsed = new URL(url);
              if (parsed.hash) {
                window.history.replaceState(null, '', parsed.hash);
              }
            } catch {
              // Ignore history errors in sandboxed/file origins
            }
            this.store.notify(
              copied ? 'Share link copied!' : 'Share link updated in address bar',
              'success',
            );
          } catch (err) {
            this.store.notify(
              err instanceof Error ? err.message : 'Failed to create share link',
              'error',
            );
          }
        })();
      },
      'primary',
      'share',
      14,
    );
    copyLinkBtn.className = 'btn primary full-width';
    this.menuPopoverEl.appendChild(copyLinkBtn);

    const importLinkRow = document.createElement('div');
    importLinkRow.className = 'custom-room-row';

    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'custom-room-input';
    linkInput.placeholder = 'Paste share link or #h=...';
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
          this.store.notify(`Loaded shared house (${decoded.items.length} items${warnSuffix})`, 'success');
          this.setActivePopover(null);
        } catch (err) {
          this.store.notify(
            err instanceof Error ? err.message : 'Invalid share link',
            'error',
          );
        }
      })();
    };

    const loadBtn = this.makeBtn('Load', loadSharedLink);
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSharedLink();
    });

    importLinkRow.append(linkInput, loadBtn);
    this.menuPopoverEl.appendChild(importLinkRow);

    // File & Lot Actions
    const fileLabel = document.createElement('div');
    fileLabel.className = 'popover-section-label';
    fileLabel.textContent = 'Files & Lot';
    this.menuPopoverEl.appendChild(fileLabel);

    const actions = document.createElement('div');
    actions.className = 'menu-action-grid';

    actions.append(
      this.makeBtn(
        'Export File',
        () => {
          this.audioModule?.playUiClick();
          const { filename, bytes } = exportHouseToFile(this.store.getState());
          this.store.notify(`Exported ${filename} (${bytes} B)`, 'success');
          this.setActivePopover(null);
        },
        undefined,
        'download',
        14,
      ),
      this.makeBtn(
        'Import File',
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
      this.makeBtn('Starter House', () => {
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

    const helpTitle = document.createElement('div');
    helpTitle.className = 'popover-section-label';
    helpTitle.textContent = 'Trackpad & Controls';
    this.menuPopoverEl.appendChild(helpTitle);

    const helpList = document.createElement('ul');
    helpList.className = 'menu-help-list';
    helpList.innerHTML = `
      <li><strong>Two-finger scroll</strong> or drag empty space: pan camera</li>
      <li><strong>Pinch</strong> or + / −: zoom; <strong>⟲ / ⟳</strong> (Q / E): rotate 90°</li>
      <li><strong>Live Mode</strong>: click interactive items &amp; watch visitors</li>
      <li><strong>Build Mode</strong>: browse left sidebar, drag items to move, drag-paint walls/floors</li>
      <li><strong>Bulk Select &amp; Erase</strong>: drag a box or sweep to edit/remove</li>
    `;
    this.menuPopoverEl.appendChild(helpList);
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

  private renderRoomPopover(): void {
    const state = this.store.getState();
    const currentEval = evaluateRoomType(state, this.store.data);
    const derivedEval = evaluateRoomType({ ...state, roomTypeOverride: null }, this.store.data);

    this.roomPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Space Type';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.roomPopoverEl.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'room-summary-box';
    const derivedLine = document.createElement('div');
    derivedLine.className = 'room-derived-line';
    derivedLine.innerHTML = `From furniture: <strong>${derivedEval.labelInfo.label}</strong>`;
    const descLine = document.createElement('div');
    descLine.className = 'popover-subtext';
    descLine.textContent = currentEval.labelInfo.description;
    summary.append(derivedLine, descLine);

    const tagEntries = Object.entries(currentEval.tagCounts)
      .filter(([tag]) => tag !== 'structure' && tag !== 'floor' && tag !== 'wall')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (tagEntries.length > 0) {
      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'tag-chip-list';
      for (const [tag, count] of tagEntries) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip tabular-num';
        chip.textContent = `${tag} ×${count}`;
        tagsWrap.appendChild(chip);
      }
      summary.appendChild(tagsWrap);
    }
    this.roomPopoverEl.appendChild(summary);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = !state.roomTypeOverride ? 'preset-btn full selected' : 'preset-btn full';
    autoBtn.textContent = `Auto (from furniture: ${derivedEval.labelInfo.label})`;
    autoBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.store.setRoomTypeOverride(null);
    });
    this.roomPopoverEl.appendChild(autoBtn);

    const presetLabel = document.createElement('div');
    presetLabel.className = 'popover-section-label';
    presetLabel.textContent = 'Or choose a manual type';
    this.roomPopoverEl.appendChild(presetLabel);

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

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.style.background = rule.accentColor;

      const lbl = document.createElement('span');
      lbl.textContent = rule.label;

      btn.append(dot, lbl);
      btn.title = rule.description;
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
    input.placeholder = 'Optional custom label…';
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

    const applyBtn = this.makeBtn('Apply', applyCustom, 'primary');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyCustom();
    });

    customRow.append(input, applyBtn);
    this.roomPopoverEl.appendChild(customRow);
  }

  private syncTimeSliderLive(): void {
    const hour = this.store.getTimeHour();
    const formatted = formatClockHour(hour);
    if (this.timeSliderEl && this.timeSliderEl.isConnected && document.activeElement !== this.timeSliderEl) {
      this.timeSliderEl.value = hour.toFixed(1);
    }
    if (this.timeReadoutEl && this.timeReadoutEl.isConnected) {
      this.timeReadoutEl.textContent = `${formatted.emoji} ${formatted.text}`;
    }
  }

  private renderAtmospherePopover(): void {
    const state = this.store.getState();
    const timeHour = this.store.getTimeHour();
    const clock = formatClockHour(timeHour);
    const activeView =
      this.sceneryModule?.getActiveView() ??
      this.store.data.viewsById.get(state.sceneryViewId) ??
      this.store.data.scenery.views[0];
    const activeWeather =
      this.sceneryModule?.getActiveWeather() ??
      this.store.data.weathersById.get(state.weatherId) ??
      this.store.data.scenery.weathers[0];

    this.atmospherePopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Atmosphere & Lighting';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.atmospherePopoverEl.appendChild(header);

    // ── Continuous 24-Hour Time Slider ──
    const timeHeader = document.createElement('div');
    timeHeader.className = 'time-slider-header';

    const todTitle = document.createElement('span');
    todTitle.className = 'popover-section-label';
    todTitle.textContent = 'Time of Day (24h)';

    const readout = document.createElement('span');
    readout.className = 'time-clock-readout tabular-num';
    readout.textContent = `${clock.emoji} ${clock.text}`;
    this.timeReadoutEl = readout;

    timeHeader.append(todTitle, readout);
    this.atmospherePopoverEl.appendChild(timeHeader);

    const sliderBox = document.createElement('div');
    sliderBox.className = 'time-slider-box';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'time-slider';
    slider.min = '0';
    slider.max = '24';
    slider.step = '0.1';
    slider.value = timeHour.toFixed(1);
    slider.setAttribute('aria-label', 'Time of day (0 to 24 hours)');
    this.timeSliderEl = slider;

    slider.addEventListener('input', () => {
      const nextHour = Number(slider.value);
      const c = formatClockHour(nextHour);
      readout.textContent = `${c.emoji} ${c.text}`;
      this.store.setTimeHour(nextHour, { recordHistory: false });
    });

    const ticksRow = document.createElement('div');
    ticksRow.className = 'time-ticks-row';
    for (const tick of TIME_TICKS) {
      const tickBtn = document.createElement('button');
      tickBtn.type = 'button';
      tickBtn.className = 'time-tick-btn';
      tickBtn.textContent = tick.label;
      tickBtn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        slider.value = tick.hour.toFixed(1);
        const c = formatClockHour(tick.hour);
        readout.textContent = `${c.emoji} ${c.text}`;
        this.store.setTimeHour(tick.hour);
      });
      ticksRow.appendChild(tickBtn);
    }

    sliderBox.append(slider, ticksRow);
    this.atmospherePopoverEl.appendChild(sliderBox);

    // ── Window View ──
    const viewTitle = document.createElement('div');
    viewTitle.className = 'popover-section-label';
    viewTitle.textContent = 'Window View';
    this.atmospherePopoverEl.appendChild(viewTitle);

    const viewGrid = document.createElement('div');
    viewGrid.className = 'view-grid';
    for (const view of this.store.data.scenery.views) {
      const isSelected = view.id === activeView.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = isSelected ? 'view-card selected' : 'view-card';

      const preview = document.createElement('span');
      preview.className = 'view-swatch';
      preview.style.background = `linear-gradient(180deg, ${view.skyTop} 0%, ${view.skyHorizon} 60%, ${view.groundColor} 60%, ${view.groundColor} 100%)`;

      const textWrap = document.createElement('div');
      textWrap.className = 'view-card-text';

      const name = document.createElement('div');
      name.className = 'view-card-name';
      name.textContent = view.name;

      const desc = document.createElement('div');
      desc.className = 'view-card-desc';
      desc.textContent = view.description;

      textWrap.append(name, desc);
      card.append(preview, textWrap);
      card.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setSceneryView(view.id);
      });
      viewGrid.appendChild(card);
    }
    this.atmospherePopoverEl.appendChild(viewGrid);

    // ── Weather ──
    const weatherTitle = document.createElement('div');
    weatherTitle.className = 'popover-section-label';
    weatherTitle.textContent = 'Weather';
    this.atmospherePopoverEl.appendChild(weatherTitle);

    const weatherGrid = document.createElement('div');
    weatherGrid.className = 'weather-grid';
    for (const weather of this.store.data.scenery.weathers) {
      const isSelected = weather.id === activeWeather.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isSelected ? 'weather-chip selected' : 'weather-chip';

      const iconName = WEATHER_ICON_NAMES[weather.id] ?? 'sun';
      btn.appendChild(createIconEl(iconName, 14));

      const label = document.createElement('span');
      label.textContent = weather.name;

      btn.appendChild(label);
      btn.addEventListener('click', () => {
        this.audioModule?.playUiClick();
        this.store.setWeather(weather.id);
      });
      weatherGrid.appendChild(btn);
    }
    this.atmospherePopoverEl.appendChild(weatherGrid);

    // ── Room Lights Row ──
    const lightsTitle = document.createElement('div');
    lightsTitle.className = 'popover-section-label';
    lightsTitle.textContent = 'Room Lights';
    this.atmospherePopoverEl.appendChild(lightsTitle);

    const lightsRow = document.createElement('div');
    lightsRow.className = 'room-lights-row';

    const lightsOnBtn = this.makeBtn(
      'All Lights On',
      () => {
        this.audioModule?.playUiClick();
        const changed = this.store.setAllLights(true);
        this.store.notify(
          changed > 0
            ? `Turned on ${changed} light${changed === 1 ? '' : 's'}`
            : 'All room lights are already on',
          'info',
        );
      },
      'primary',
    );
    lightsOnBtn.className = 'btn primary';

    const lightsOffBtn = this.makeBtn('All Lights Off', () => {
      this.audioModule?.playUiClick();
      const changed = this.store.setAllLights(false);
      this.store.notify(
        changed > 0
          ? `Turned off ${changed} light${changed === 1 ? '' : 's'}`
          : 'All room lights are already off',
        'info',
      );
    });

    lightsRow.append(lightsOnBtn, lightsOffBtn);
    this.atmospherePopoverEl.appendChild(lightsRow);

    this.appendWallCeilingControls(this.atmospherePopoverEl);

    if (this.audioModule) {
      const audioTitle = document.createElement('div');
      audioTitle.className = 'popover-section-label';
      audioTitle.textContent = 'Sound & Ambience';
      this.atmospherePopoverEl.appendChild(audioTitle);
      this.atmospherePopoverEl.appendChild(this.buildVolumeControl());
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
    ceilingBtn.title = 'Toggle translucent ceiling over enclosed rooms';

    wrap.append(modeRow, ceilingBtn);
    parent.appendChild(wrap);
  }

  private syncWallViewButton(): void {
    if (!this.wallViewBtnEl) return;
    const mode = this.store.getWallViewMode();
    const meta = WALL_VIEW_OPTIONS.find((o) => o.id === mode) ?? WALL_VIEW_OPTIONS[0];
    this.wallViewBtnEl.title = `${meta.fullLabel} — click to cycle`;
    this.wallViewBtnEl.setAttribute('aria-label', meta.fullLabel);
    this.wallViewBtnEl.classList.toggle('active-trigger', mode === 'translucent');
    this.wallViewBtnEl.classList.toggle('wall-solid-state', mode === 'solid');
  }

  private createVisitorPortrait(
    def: VisitorDef | undefined,
    variantIndex: number,
    fallbackColor: string,
    visitorId: string,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'visitor-portrait';
    const tint = def?.color ?? fallbackColor ?? '#E8BFA8';
    wrap.style.background = `color-mix(in srgb, ${tint} 36%, #FFFDF9)`;

    const fallback = document.createElement('span');
    fallback.className = 'visitor-portrait-fallback';
    fallback.style.background = tint;

    const img = document.createElement('img');
    img.className = 'visitor-portrait-img hidden';
    img.alt = def?.name ?? visitorId;
    img.draggable = false;

    const badge = document.createElement('span');
    badge.className = 'visitor-archetype-badge';
    badge.textContent = def?.archetypeIcon ?? VISITOR_ARCHETYPE_ICONS[visitorId] ?? '✨';
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

  private renderVisitorsPopover(): void {
    this.visitorsPopoverEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popover-header';
    const h4 = document.createElement('h4');
    h4.textContent = 'Visitors & Guests';
    const closeBtn = this.makeBtn('×', () => this.setActivePopover(null));
    closeBtn.className = 'btn icon-close';
    header.append(h4, closeBtn);
    this.visitorsPopoverEl.appendChild(header);

    const active = this.visitorModule?.getActiveVisitors() ?? [];

    const activeHeader = document.createElement('div');
    activeHeader.className = 'visitors-section-header';
    const activeLabel = document.createElement('span');
    activeLabel.className = 'popover-section-label tabular-num';
    activeLabel.textContent = `Visiting Now (${active.length})`;
    activeHeader.appendChild(activeLabel);

    if (active.length > 0 && this.visitorModule) {
      const dismissAllBtn = this.makeBtn('Dismiss All', () => {
        this.audioModule?.playUiClick();
        this.visitorModule?.dismissAll();
      });
      dismissAllBtn.className = 'btn btn-xs';
      activeHeader.appendChild(dismissAllBtn);
    }
    this.visitorsPopoverEl.appendChild(activeHeader);

    if (active.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'visitors-empty';
      empty.textContent = 'No visitors right now. Invite someone below to explore your space.';
      this.visitorsPopoverEl.appendChild(empty);
    } else {
      const activeList = document.createElement('div');
      activeList.className = 'active-visitors-list';
      const seenByArchetype = new Map<string, number>();

      for (const snap of active) {
        const def = this.store.data.visitorsById.get(snap.visitorId);
        const occ = seenByArchetype.get(snap.visitorId) ?? 0;
        seenByArchetype.set(snap.visitorId, occ + 1);
        const variantIdx = snap.variantIndex ?? (occ % 3);

        const card = document.createElement('div');
        card.className = 'active-visitor-card';

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

        const nameRow = document.createElement('div');
        nameRow.className = 'active-visitor-top';

        const personalName = snap.name ?? def?.name ?? snap.visitorId;
        const archetypeLabel = snap.archetypeName ?? def?.name;
        const nameEl = document.createElement('span');
        nameEl.className = 'active-visitor-name';
        nameEl.textContent =
          archetypeLabel && archetypeLabel !== personalName
            ? `${personalName} · ${archetypeLabel}`
            : personalName;
        nameRow.appendChild(nameEl);

        if (snap.pronouns) {
          const pron = document.createElement('span');
          pron.className = 'visitor-pronouns';
          pron.textContent = `(${snap.pronouns})`;
          nameRow.appendChild(pron);
        }

        // Mood pill + emotion emoji + progress bar
        const moodRow = document.createElement('div');
        moodRow.className = 'visitor-mood-row';

        const emotionBadge = document.createElement('span');
        emotionBadge.className = 'visitor-emotion-badge';
        emotionBadge.textContent = this.resolveVisitorEmoji(snap.lastEmote, snap.mood);

        const moodEl = document.createElement('span');
        moodEl.className = `mood-pill mood-${snap.mood}`;
        moodEl.textContent = snap.mood;

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
        barTrack.title = `Mood score: ${Math.round(score)}%`;
        const barFill = document.createElement('div');
        barFill.className = `mood-bar-fill mood-${snap.mood}`;
        barFill.style.width = `${Math.round(score)}%`;
        barTrack.appendChild(barFill);

        moodRow.append(emotionBadge, moodEl, barTrack);
        identity.append(nameRow, moodRow);

        const sendHomeBtn = this.makeBtn('Send Home', () => {
          this.audioModule?.playUiClick();
          this.visitorModule?.dismiss(snap.instanceId);
        });
        sendHomeBtn.className = 'btn btn-xs';

        headerRow.append(portrait, identity, sendHomeBtn);
        card.appendChild(headerRow);

        // Matched vs Unmatched Interests chips
        const interests = snap.interests ?? def?.likedTags ?? [];
        const matchedSet = new Set(snap.matchedInterests ?? []);
        if (interests.length > 0) {
          const chips = document.createElement('div');
          chips.className = 'tag-chip-list';
          for (const tag of interests) {
            const isMatched = matchedSet.has(tag);
            const chip = document.createElement('span');
            chip.className = isMatched ? 'tag-chip matched' : 'tag-chip';
            chip.textContent = isMatched ? `✓ ${tag}` : tag;
            chips.appendChild(chip);
          }
          card.appendChild(chips);
        }

        // Thought bubble + Activity
        const thoughtBox = document.createElement('div');
        thoughtBox.className = 'visitor-thought-strip';
        const activityText = snap.activity || 'Exploring the space';
        if (snap.thought) {
          const quoteEl = document.createElement('div');
          quoteEl.className = 'visitor-thought-quote';
          quoteEl.textContent = `💭 “${snap.thought}”`;
          const actEl = document.createElement('div');
          actEl.className = 'visitor-thought-activity';
          actEl.textContent = activityText;
          thoughtBox.append(quoteEl, actEl);
        } else {
          const actEl = document.createElement('div');
          actEl.className = 'visitor-thought-activity';
          actEl.textContent = activityText;
          thoughtBox.appendChild(actEl);
        }
        card.appendChild(thoughtBox);

        activeList.appendChild(card);
      }
      this.visitorsPopoverEl.appendChild(activeList);
    }

    const inviteLabel = document.createElement('div');
    inviteLabel.className = 'popover-section-label';
    inviteLabel.textContent = `Invite a Guest (${this.store.data.visitors.visitors.length})`;
    this.visitorsPopoverEl.appendChild(inviteLabel);

    const inviteList = document.createElement('div');
    inviteList.className = 'invite-visitors-list';
    for (const visitor of this.store.data.visitors.visitors) {
      const card = document.createElement('div');
      card.className = 'invite-visitor-card';

      const portrait = this.createVisitorPortrait(visitor, 0, visitor.color, visitor.id);

      const body = document.createElement('div');
      body.className = 'invite-visitor-body';

      const name = document.createElement('div');
      name.className = 'invite-visitor-name';
      name.textContent = visitor.name;

      const desc = document.createElement('div');
      desc.className = 'invite-visitor-desc';
      desc.textContent = visitor.description;

      const tags = document.createElement('div');
      tags.className = 'tag-chip-list';
      for (const tag of visitor.likedTags) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        tags.appendChild(chip);
      }

      body.append(name, desc, tags);

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
    this.soundBtnEl.appendChild(createIconEl(muted ? 'soundOff' : 'soundOn', 16));
    this.soundBtnEl.title = muted ? 'Sound muted — click to unmute' : 'Sound on — click to mute';
    this.soundBtnEl.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.soundBtnEl.classList.toggle('muted-state', muted);
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
    const clock = formatClockHour(this.store.getTimeHour());

    this.atmosphereDotEl.style.background = `linear-gradient(180deg, ${activeView.skyTop}, ${activeView.groundColor})`;
    this.atmosphereTextEl.textContent = `${clock.emoji} ${clock.shortText} · ${activeView.name} · ${activeWeather.name}`;
  }

  private syncHud(): void {
    const state = this.store.getState();
    const evaluation = evaluateRoomType(state, this.store.data);
    this.roomLabelTextEl.textContent = evaluation.labelInfo.label;
    this.roomDotEl.style.background = evaluation.labelInfo.accentColor;
    this.roomOverrideTagEl.classList.toggle('hidden', !evaluation.isOverride);

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
