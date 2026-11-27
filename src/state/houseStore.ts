import {
  DEFAULT_TIME_HOUR,
  timeHourToBucket,
  timeOfDayToDefaultHour,
  type FurnitureItemDef,
  type GameDataBundle,
  type HouseState,
  type PlacedItem,
  type RotationQuarter,
  type TimeOfDay,
} from '../data/schemas';
import {
  canonicalWallEdgeKey,
  getEffectiveFootprint,
  parseCanonicalWallEdgeKey,
} from '../engine/GridSystem';

export type InteractionMode = 'select' | 'place' | 'move' | 'bulk-select' | 'erase';
export type EraseFilter = 'all' | 'floor' | 'wall' | 'furniture';
export type ExpandSide = 'north' | 'south' | 'east' | 'west';
export type WallViewMode = 'auto' | 'translucent' | 'solid';

const MUSIC_PARTY_HUBS = new Set(['dj_booth', 'record_player', 'diner_jukebox', 'karaoke_mic']);
const MUSIC_PARTY_LINKED = new Set([
  'dj_booth',
  'disco_ball',
  'speaker_tower',
  'subwoofer_box',
  'floor_uplight',
  'party_spotlight',
  'laser_bar',
  'dance_floor_tile',
  'led_strip_wall',
  'fog_machine',
  'string_lights',
  'record_player',
  'diner_jukebox',
]);
const CAFE_LINKED = new Set(['coffee_grinder', 'pourover_stand', 'pastry_case']);
const PET_TOYS = new Set(['cat_feather_wand', 'cat_ball_track', 'cat_tunnel', 'scratch_post']);
const CAT_ITEMS = new Set(['cat_calico', 'cat_sleepy', 'cat_kitten', 'cat_loaf']);

export interface StoreEventMap {
  houseChanged: { state: HouseState; reason: string };
  selectionChanged: { selectedUid: string | null; selectedUids: string[] };
  modeChanged: {
    mode: InteractionMode;
    placementItemId: string | null;
    placementVariantId: string | null;
    placementRotation: RotationQuarter;
    eraseFilter: EraseFilter;
  };
  editModeChanged: { editMode: boolean };
  gridVisibilityChanged: { visible: boolean };
  wallViewChanged: { mode: WallViewMode; showCeiling: boolean };
  houseOpenChanged: { open: boolean };
  timeCycleChanged: { running: boolean };
  itemInteracted: { item: PlacedItem };
  toast: { message: string; tone?: 'info' | 'success' | 'error' };
}

type Listener<T> = (payload: T) => void;

const MAX_HISTORY = 80;
const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 36;

function cloneHouseState(state: HouseState): HouseState {
  const timeHour =
    state.timeHour !== undefined && Number.isFinite(state.timeHour)
      ? state.timeHour
      : state.timeOfDay
        ? timeOfDayToDefaultHour(state.timeOfDay)
        : DEFAULT_TIME_HOUR;
  const timeOfDay = state.timeOfDay ?? timeHourToBucket(timeHour);
  return {
    gridWidth: state.gridWidth,
    gridDepth: state.gridDepth,
    sceneryViewId: state.sceneryViewId,
    weatherId: state.weatherId,
    timeOfDay,
    timeHour,
    roomTypeOverride: state.roomTypeOverride,
    items: state.items.map((item) => ({ ...item })),
  };
}

let uidCounter = 1;
export function generateItemUid(): string {
  uidCounter += 1;
  return `it_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}

export class HouseStore {
  readonly data: GameDataBundle;
  private state: HouseState;
  private undoStack: HouseState[] = [];
  private redoStack: HouseState[] = [];

  private editMode = false;
  private gridVisible = false;
  private wallViewMode: WallViewMode = 'auto';
  private showCeiling = true;
  private houseOpen = true;
  private timeCycleRunning = false;
  private selectedUids: string[] = [];
  private mode: InteractionMode = 'select';
  private placementItemId: string | null = null;
  private placementVariantId: string | null = null;
  private placementRotation: RotationQuarter = 0;
  private eraseFilter: EraseFilter = 'all';

  private batchDepth = 0;
  private batchHistoryPushed = false;
  private batchMutated = false;

  private listeners: { [K in keyof StoreEventMap]: Set<Listener<StoreEventMap[K]>> } = {
    houseChanged: new Set(),
    selectionChanged: new Set(),
    modeChanged: new Set(),
    editModeChanged: new Set(),
    gridVisibilityChanged: new Set(),
    wallViewChanged: new Set(),
    houseOpenChanged: new Set(),
    timeCycleChanged: new Set(),
    itemInteracted: new Set(),
    toast: new Set(),
  };

  constructor(data: GameDataBundle, initialState: HouseState) {
    this.data = data;
    this.state = cloneHouseState(initialState);
  }

  on<K extends keyof StoreEventMap>(event: K, listener: Listener<StoreEventMap[K]>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  private emit<K extends keyof StoreEventMap>(event: K, payload: StoreEventMap[K]): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private emitSelectionChanged(): void {
    this.emit('selectionChanged', {
      selectedUid: this.getSelectedUid(),
      selectedUids: this.getSelectedUids(),
    });
  }

  private emitMutation(reason: string): void {
    if (this.batchDepth > 0) {
      this.batchMutated = true;
      this.emit('houseChanged', { state: this.state, reason: 'batch-step' });
    } else {
      this.emit('houseChanged', { state: this.state, reason });
    }
  }

  notify(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
    this.emit('toast', { message, tone });
  }

  getState(): HouseState {
    return this.state;
  }

  isEditMode(): boolean {
    return this.editMode;
  }

  setEditMode(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.editMode === next) return;
    this.editMode = next;
    if (!next) {
      this.clearSelection();
      if (this.mode !== 'select') {
        this.setSelectMode();
      }
    }
    this.emit('editModeChanged', { editMode: this.editMode });
  }

  toggleEditMode(): void {
    this.setEditMode(!this.editMode);
  }

  isGridVisible(): boolean {
    return this.gridVisible;
  }

  setGridVisible(visible: boolean): void {
    const next = Boolean(visible);
    if (this.gridVisible === next) return;
    this.gridVisible = next;
    this.emit('gridVisibilityChanged', { visible: this.gridVisible });
  }

  getWallViewMode(): WallViewMode {
    return this.wallViewMode;
  }

  setWallViewMode(mode: WallViewMode): void {
    if (this.wallViewMode === mode) return;
    this.wallViewMode = mode;
    this.emit('wallViewChanged', { mode: this.wallViewMode, showCeiling: this.showCeiling });
  }

  cycleWallViewMode(): WallViewMode {
    const next: WallViewMode =
      this.wallViewMode === 'auto'
        ? 'translucent'
        : this.wallViewMode === 'translucent'
          ? 'solid'
          : 'auto';
    this.setWallViewMode(next);
    return next;
  }

  isCeilingVisible(): boolean {
    return this.showCeiling;
  }

  setCeilingVisible(visible: boolean): void {
    const next = Boolean(visible);
    if (this.showCeiling === next) return;
    this.showCeiling = next;
    this.emit('wallViewChanged', { mode: this.wallViewMode, showCeiling: this.showCeiling });
  }

  isHouseOpen(): boolean {
    return this.houseOpen;
  }

  setHouseOpen(open: boolean): void {
    const next = Boolean(open);
    if (this.houseOpen === next) return;
    this.houseOpen = next;
    this.emit('houseOpenChanged', { open: this.houseOpen });
  }

  toggleHouseOpen(): boolean {
    this.setHouseOpen(!this.houseOpen);
    return this.houseOpen;
  }

  isTimeCycleRunning(): boolean {
    return this.timeCycleRunning;
  }

  setTimeCycleRunning(running: boolean): void {
    const next = Boolean(running);
    if (this.timeCycleRunning === next) return;
    this.timeCycleRunning = next;
    this.emit('timeCycleChanged', { running: this.timeCycleRunning });
  }

  private isStructuralDoorDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def &&
        def.layer === 'wall' &&
        def.wallKind === 'structure' &&
        (def.tags.includes('door') || def.id.startsWith('door_')),
    );
  }

  private isControllableLightDef(def: FurnitureItemDef | undefined): boolean {
    if (!def || !def.interaction) return false;
    if (def.interaction.type !== 'toggle' && def.interaction.type !== 'spin') return false;
    if (def.tags.includes('light')) return true;
    const id = def.id;
    return (
      id.includes('lamp') ||
      id.includes('light') ||
      id.includes('sconce') ||
      id.includes('lantern') ||
      id.includes('candle') ||
      id.includes('neon') ||
      id.includes('disco') ||
      id.includes('spotlight') ||
      id.includes('uplight') ||
      id.includes('laser')
    );
  }

  private collectLinkedDoubleDoorUids(door: PlacedItem): Set<string> {
    const doorEdges = new Map<
      string,
      { uid: string; axis: 'H' | 'V'; ex: number; ez: number }
    >();
    for (const it of this.state.items) {
      const itDef = this.data.itemsById.get(it.itemId);
      if (!this.isStructuralDoorDef(itDef)) continue;
      const parsed = parseCanonicalWallEdgeKey(canonicalWallEdgeKey(it.x, it.z, it.rotation));
      doorEdges.set(it.uid, { uid: it.uid, ...parsed });
    }

    const start = doorEdges.get(door.uid);
    const linked = new Set<string>();
    if (!start) return linked;

    const visited = new Set<string>([door.uid]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const cand of doorEdges.values()) {
        if (visited.has(cand.uid) || cand.axis !== cur.axis) continue;
        const adjacent =
          cur.axis === 'H'
            ? cand.ez === cur.ez && Math.abs(cand.ex - cur.ex) === 1
            : cand.ex === cur.ex && Math.abs(cand.ez - cur.ez) === 1;
        if (adjacent) {
          visited.add(cand.uid);
          linked.add(cand.uid);
          queue.push(cand);
        }
      }
    }
    return linked;
  }

  getItem(uid: string): PlacedItem | undefined {
    return this.state.items.find((i) => i.uid === uid);
  }

  getChildren(parentUid: string): PlacedItem[] {
    return this.state.items.filter((i) => i.parentUid === parentUid);
  }

  getSelectedUid(): string | null {
    return this.selectedUids.length === 1 ? this.selectedUids[0] : null;
  }

  getSelectedUids(): string[] {
    return [...this.selectedUids];
  }

  getSelectedItems(): PlacedItem[] {
    if (this.selectedUids.length === 0) return [];
    const set = new Set(this.selectedUids);
    return this.state.items.filter((i) => set.has(i.uid));
  }

  getSelectedItem(): PlacedItem | null {
    const uid = this.getSelectedUid();
    if (!uid) return null;
    return this.getItem(uid) ?? null;
  }

  getModeState() {
    return {
      mode: this.mode,
      placementItemId: this.placementItemId,
      placementVariantId: this.placementVariantId,
      placementRotation: this.placementRotation,
      eraseFilter: this.eraseFilter,
    };
  }

  getEraseFilter(): EraseFilter {
    return this.eraseFilter;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  beginBatch(): void {
    if (this.batchDepth === 0) {
      this.batchHistoryPushed = false;
      this.batchMutated = false;
    }
    this.batchDepth += 1;
  }

  endBatch(reason = 'batch'): void {
    if (this.batchDepth === 0) return;
    this.batchDepth -= 1;
    if (this.batchDepth === 0) {
      const mutated = this.batchMutated;
      this.batchHistoryPushed = false;
      this.batchMutated = false;
      if (mutated) {
        this.emit('houseChanged', { state: this.state, reason });
      }
    }
  }

  private pushHistory(): void {
    if (this.batchDepth > 0) {
      if (this.batchHistoryPushed) return;
      this.batchHistoryPushed = true;
    }
    this.undoStack.push(cloneHouseState(this.state));
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private ensureEditMode(): void {
    if (!this.editMode) {
      this.editMode = true;
      this.emit('editModeChanged', { editMode: true });
    }
  }

  selectItem(uid: string | null): void {
    const next = uid && this.getItem(uid) ? [uid] : [];
    const unchanged =
      next.length === this.selectedUids.length && next.every((v, i) => v === this.selectedUids[i]);
    if (unchanged) return;
    this.selectedUids = next;
    if (next.length > 0 && (this.mode === 'place' || this.mode === 'erase')) {
      this.setSelectMode();
    }
    this.emitSelectionChanged();
  }

  setSelectedUids(uids: string[]): void {
    const valid = new Set(this.state.items.map((i) => i.uid));
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const uid of uids) {
      if (valid.has(uid) && !seen.has(uid)) {
        seen.add(uid);
        deduped.push(uid);
      }
    }
    const unchanged =
      deduped.length === this.selectedUids.length &&
      deduped.every((v, i) => v === this.selectedUids[i]);
    if (unchanged) return;
    this.selectedUids = deduped;
    this.emitSelectionChanged();
  }

  toggleSelectItem(uid: string): void {
    if (!this.getItem(uid)) return;
    if (this.selectedUids.includes(uid)) {
      this.selectedUids = this.selectedUids.filter((id) => id !== uid);
    } else {
      this.selectedUids = [...this.selectedUids, uid];
    }
    this.emitSelectionChanged();
  }

  toggleSelectionUid(uid: string): void {
    this.toggleSelectItem(uid);
  }

  clearSelection(): void {
    if (this.selectedUids.length === 0) return;
    this.selectedUids = [];
    this.emitSelectionChanged();
  }

  setSelectMode(): void {
    this.mode = 'select';
    this.placementItemId = null;
    this.placementVariantId = null;
    this.emit('modeChanged', this.getModeState());
  }

  setBulkSelectMode(): void {
    this.ensureEditMode();
    this.mode = 'bulk-select';
    this.placementItemId = null;
    this.placementVariantId = null;
    this.emit('modeChanged', this.getModeState());
  }

  setEraseMode(filter?: EraseFilter): void {
    this.ensureEditMode();
    this.mode = 'erase';
    this.placementItemId = null;
    this.placementVariantId = null;
    if (filter) {
      this.eraseFilter = filter;
    }
    if (this.selectedUids.length > 0) {
      this.selectedUids = [];
      this.emitSelectionChanged();
    }
    this.emit('modeChanged', this.getModeState());
  }

  setEraseFilter(filter: EraseFilter): void {
    if (this.eraseFilter === filter) return;
    this.eraseFilter = filter;
    this.emit('modeChanged', this.getModeState());
  }

  startPlacement(itemId: string, variantId?: string): void {
    const def = this.data.itemsById.get(itemId);
    if (!def) return;
    this.ensureEditMode();
    const chosenVariant =
      variantId && def.variants.some((v) => v.id === variantId)
        ? variantId
        : def.variants[0].id;
    const hadSelection = this.selectedUids.length > 0;
    this.selectedUids = [];
    this.mode = 'place';
    this.placementItemId = itemId;
    this.placementVariantId = chosenVariant;
    if (hadSelection) {
      this.emitSelectionChanged();
    }
    this.emit('modeChanged', this.getModeState());
  }

  setPlacementVariant(variantId: string): void {
    if (this.mode !== 'place' || !this.placementItemId) return;
    this.placementVariantId = variantId;
    this.emit('modeChanged', this.getModeState());
  }

  rotatePlacement(step: 1 | -1 = 1): void {
    this.placementRotation = (((this.placementRotation + step) % 4) + 4) % 4 as RotationQuarter;
    this.emit('modeChanged', this.getModeState());
  }

  startMovingSelected(): void {
    const selected = this.getSelectedItem();
    if (!selected) return;
    this.ensureEditMode();
    this.mode = 'move';
    this.placementItemId = selected.itemId;
    this.placementVariantId = selected.variantId;
    this.placementRotation = selected.rotation;
    this.emit('modeChanged', this.getModeState());
  }

  placeItem(itemInput: Omit<PlacedItem, 'uid'>, options?: { selectAfter?: boolean }): PlacedItem {
    this.pushHistory();
    const item: PlacedItem = {
      ...itemInput,
      uid: generateItemUid(),
    };
    this.state = {
      ...this.state,
      items: [...this.state.items, item],
    };
    this.emitMutation('place');
    if (options?.selectAfter) {
      this.selectItem(item.uid);
    }
    return item;
  }

  moveItem(
    uid: string,
    target: { x: number; y: number; z: number; rotation: RotationQuarter; parentUid?: string },
  ): boolean {
    const existing = this.getItem(uid);
    if (!existing) return false;

    const dx = target.x - existing.x;
    const dy = target.y - existing.y;
    const dz = target.z - existing.z;

    this.pushHistory();
    this.state = {
      ...this.state,
      items: this.state.items.map((it) => {
        if (it.uid === uid) {
          return {
            ...it,
            x: target.x,
            y: target.y,
            z: target.z,
            rotation: target.rotation,
            parentUid: target.parentUid,
          };
        }
        // Keep stacked surface items / wall-mounted items riding along with their support
        if (it.parentUid === uid) {
          const childDef = this.data.itemsById.get(it.itemId);
          const isWallMounted = childDef?.layer === 'wall' && childDef.wallKind === 'mounted';
          return {
            ...it,
            x: it.x + dx,
            y: it.y + dy,
            z: it.z + dz,
            rotation: isWallMounted ? target.rotation : it.rotation,
          };
        }
        return it;
      }),
    };

    this.emitMutation('move');
    return true;
  }

  setItemVariant(uid: string, variantId: string): boolean {
    return this.setItemsVariant([uid], variantId) > 0;
  }

  setItemsVariant(uids: string[], variantId: string): number {
    if (uids.length === 0) return 0;
    const targetSet = new Set(uids);
    const matching = new Set<string>();

    for (const it of this.state.items) {
      if (!targetSet.has(it.uid) || it.variantId === variantId) continue;
      const def = this.data.itemsById.get(it.itemId);
      if (def?.variants.some((v) => v.id === variantId)) {
        matching.add(it.uid);
      }
    }

    if (matching.size === 0) return 0;
    this.pushHistory();
    this.state = {
      ...this.state,
      items: this.state.items.map((it) => (matching.has(it.uid) ? { ...it, variantId } : it)),
    };
    this.emitMutation('variant');
    return matching.size;
  }

  replaceItemsType(uids: string[], nextItemId: string, nextVariantId?: string): number {
    if (uids.length === 0) return 0;
    const nextDef = this.data.itemsById.get(nextItemId);
    if (!nextDef) return 0;

    const targetSet = new Set(uids);
    const isDoorOrWindow = nextDef.tags.includes('door') || nextDef.tags.includes('window');
    const swappedUids = new Set<string>();
    const childrenToRemove = new Set<string>();
    let changedCount = 0;

    const nextItems: PlacedItem[] = [];
    for (const it of this.state.items) {
      if (!targetSet.has(it.uid)) {
        nextItems.push(it);
        continue;
      }
      const chosenVariant =
        nextVariantId && nextDef.variants.some((v) => v.id === nextVariantId)
          ? nextVariantId
          : nextDef.variants.some((v) => v.id === it.variantId)
            ? it.variantId
            : nextDef.variants[0].id;

      if (it.itemId === nextItemId && it.variantId === chosenVariant) {
        nextItems.push(it);
        continue;
      }

      changedCount += 1;
      swappedUids.add(it.uid);
      const keepActive =
        nextDef.interaction?.type === 'toggle' || nextDef.interaction?.type === 'spin'
          ? it.active
          : undefined;
      nextItems.push({
        ...it,
        itemId: nextItemId,
        variantId: chosenVariant,
        active: keepActive,
      });
    }

    if (changedCount === 0) return 0;

    if (isDoorOrWindow) {
      for (const it of nextItems) {
        if (it.parentUid && swappedUids.has(it.parentUid)) {
          childrenToRemove.add(it.uid);
        }
      }
    }

    this.pushHistory();
    this.state = {
      ...this.state,
      items:
        childrenToRemove.size > 0
          ? nextItems.filter((it) => !childrenToRemove.has(it.uid))
          : nextItems,
    };

    if (childrenToRemove.size > 0 && this.selectedUids.some((id) => childrenToRemove.has(id))) {
      this.selectedUids = this.selectedUids.filter((id) => !childrenToRemove.has(id));
      this.emitSelectionChanged();
    }

    this.emitMutation('replace');
    return changedCount;
  }

  private isStructuralWallSurfaceDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def &&
        def.layer === 'wall' &&
        def.wallKind === 'structure' &&
        def.id.startsWith('wall_'),
    );
  }

  private isStructuralWindowDef(def: FurnitureItemDef | undefined): boolean {
    return Boolean(
      def &&
        def.layer === 'wall' &&
        def.wallKind === 'structure' &&
        (def.tags.includes('window') || def.id.startsWith('window_')),
    );
  }

  applyStyleToAllWalls(itemId: string, variantId: string): number {
    const targetDef = this.data.itemsById.get(itemId);
    if (!this.isStructuralWallSurfaceDef(targetDef)) {
      return 0;
    }
    const chosenVariant = targetDef!.variants.some((v) => v.id === variantId)
      ? variantId
      : targetDef!.variants[0].id;

    let changedCount = 0;
    const nextItems = this.state.items.map((it) => {
      const curDef = this.data.itemsById.get(it.itemId);
      if (!this.isStructuralWallSurfaceDef(curDef)) return it;
      if (it.itemId === itemId && it.variantId === chosenVariant) return it;
      changedCount += 1;
      return { ...it, itemId, variantId: chosenVariant };
    });

    if (changedCount === 0) return 0;
    this.pushHistory();
    this.state = { ...this.state, items: nextItems };
    this.emitMutation('styleAll');
    return changedCount;
  }

  applyStyleToAllFloors(itemId: string, variantId: string): number {
    const targetDef = this.data.itemsById.get(itemId);
    if (!targetDef || targetDef.layer !== 'floor' || targetDef.subLayer !== 'tile') {
      return 0;
    }
    const chosenVariant = targetDef.variants.some((v) => v.id === variantId)
      ? variantId
      : targetDef.variants[0].id;
    const supportsActive =
      targetDef.interaction?.type === 'toggle' || targetDef.interaction?.type === 'spin';

    let changedCount = 0;
    const nextItems = this.state.items.map((it) => {
      const curDef = this.data.itemsById.get(it.itemId);
      if (!curDef || curDef.layer !== 'floor' || curDef.subLayer !== 'tile') return it;
      if (it.itemId === itemId && it.variantId === chosenVariant) return it;
      changedCount += 1;
      return {
        ...it,
        itemId,
        variantId: chosenVariant,
        active: supportsActive ? it.active : undefined,
      };
    });

    if (changedCount === 0) return 0;
    this.pushHistory();
    this.state = { ...this.state, items: nextItems };
    this.emitMutation('styleAll');
    return changedCount;
  }

  applyStyleToSelection(itemId: string, variantId: string): number {
    if (this.selectedUids.length === 0) return 0;
    const targetDef = this.data.itemsById.get(itemId);
    if (!targetDef) return 0;
    const chosenVariant = targetDef.variants.some((v) => v.id === variantId)
      ? variantId
      : targetDef.variants[0].id;

    const selectedSet = new Set(this.selectedUids);
    const isTargetWall = this.isStructuralWallSurfaceDef(targetDef);
    const isTargetTile = targetDef.layer === 'floor' && targetDef.subLayer === 'tile';
    const isTargetDoor = this.isStructuralDoorDef(targetDef);
    const isTargetWindow = this.isStructuralWindowDef(targetDef);
    const supportsActive =
      targetDef.interaction?.type === 'toggle' || targetDef.interaction?.type === 'spin';

    let changedCount = 0;
    const nextItems = this.state.items.map((it) => {
      if (!selectedSet.has(it.uid)) return it;
      const curDef = this.data.itemsById.get(it.itemId);
      if (!curDef) return it;

      const matchesCategory = isTargetWall
        ? this.isStructuralWallSurfaceDef(curDef)
        : isTargetTile
          ? curDef.layer === 'floor' && curDef.subLayer === 'tile'
          : isTargetDoor
            ? this.isStructuralDoorDef(curDef)
            : isTargetWindow
              ? this.isStructuralWindowDef(curDef)
              : it.itemId === itemId;

      if (!matchesCategory) return it;
      if (it.itemId === itemId && it.variantId === chosenVariant) return it;

      changedCount += 1;
      return {
        ...it,
        itemId,
        variantId: chosenVariant,
        active: supportsActive ? it.active : undefined,
      };
    });

    if (changedCount === 0) return 0;
    this.pushHistory();
    this.state = { ...this.state, items: nextItems };
    this.emitMutation('styleSelected');
    return changedCount;
  }

  deleteItem(uid: string): boolean {
    return this.deleteItems([uid]) > 0;
  }

  deleteItems(uids: string[]): number {
    if (uids.length === 0) return 0;
    const toRemove = new Set<string>();
    for (const uid of uids) {
      if (this.getItem(uid)) {
        toRemove.add(uid);
      }
    }
    if (toRemove.size === 0) return 0;

    // Collect recursively dependent children (surface/wall-mounted)
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of this.state.items) {
        if (it.parentUid && toRemove.has(it.parentUid) && !toRemove.has(it.uid)) {
          toRemove.add(it.uid);
          grew = true;
        }
      }
    }

    this.pushHistory();
    this.state = {
      ...this.state,
      items: this.state.items.filter((it) => !toRemove.has(it.uid)),
    };

    if (this.selectedUids.some((id) => toRemove.has(id))) {
      this.selectedUids = this.selectedUids.filter((id) => !toRemove.has(id));
      this.emitSelectionChanged();
    }
    if (this.mode === 'move') {
      this.setSelectMode();
    }

    this.emitMutation('delete');
    return toRemove.size;
  }

  expandDirection(side: ExpandSide, delta: number): boolean {
    const step = Math.round(delta);
    if (step === 0) return false;

    let nextWidth = this.state.gridWidth;
    let nextDepth = this.state.gridDepth;
    let offsetX = 0;
    let offsetZ = 0;

    if (side === 'east') {
      nextWidth = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, this.state.gridWidth + step));
    } else if (side === 'west') {
      nextWidth = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, this.state.gridWidth + step));
      offsetX = nextWidth - this.state.gridWidth;
    } else if (side === 'south') {
      nextDepth = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, this.state.gridDepth + step));
    } else if (side === 'north') {
      nextDepth = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, this.state.gridDepth + step));
      offsetZ = nextDepth - this.state.gridDepth;
    }

    if (nextWidth === this.state.gridWidth && nextDepth === this.state.gridDepth) {
      return false;
    }

    const shiftedItems: PlacedItem[] = [];
    for (const it of this.state.items) {
      const def = this.data.itemsById.get(it.itemId);
      const eff = def ? getEffectiveFootprint(def, it.rotation) : { w: 1, d: 1 };
      const nx = it.x + offsetX;
      const nz = it.z + offsetZ;
      if (nx < 0 || nz < 0 || nx + eff.w > nextWidth || nz + eff.d > nextDepth) {
        this.notify('Move or remove items on that edge first', 'error');
        return false;
      }
      shiftedItems.push({ ...it, x: nx, z: nz });
    }

    this.pushHistory();
    this.state = {
      ...this.state,
      gridWidth: nextWidth,
      gridDepth: nextDepth,
      items: shiftedItems,
    };
    this.emitMutation('resize');
    return true;
  }

  resizeGrid(nextWidth: number, nextDepth: number): boolean {
    const clampedW = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, Math.round(nextWidth)));
    const clampedD = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, Math.round(nextDepth)));
    if (clampedW === this.state.gridWidth && clampedD === this.state.gridDepth) {
      return false;
    }

    const offsetX = Math.floor((clampedW - this.state.gridWidth) / 2);
    const offsetZ = Math.floor((clampedD - this.state.gridDepth) / 2);

    const shiftedItems: PlacedItem[] = [];
    for (const it of this.state.items) {
      const def = this.data.itemsById.get(it.itemId);
      const eff = def ? getEffectiveFootprint(def, it.rotation) : { w: 1, d: 1 };
      const nx = it.x + offsetX;
      const nz = it.z + offsetZ;
      if (nx < 0 || nz < 0 || nx + eff.w > clampedW || nz + eff.d > clampedD) {
        this.notify('Move or remove outer items before shrinking lot', 'error');
        return false;
      }
      shiftedItems.push({ ...it, x: nx, z: nz });
    }

    this.pushHistory();
    this.state = {
      ...this.state,
      gridWidth: clampedW,
      gridDepth: clampedD,
      items: shiftedItems,
    };
    this.emitMutation('resize');
    return true;
  }

  triggerInteraction(uid: string): PlacedItem | null {
    const existing = this.getItem(uid);
    if (!existing) return null;
    const def = this.data.itemsById.get(existing.itemId);
    if (!def?.interaction) return null;

    const isMusicHub = MUSIC_PARTY_HUBS.has(existing.itemId);
    const isStructuralDoor = this.isStructuralDoorDef(def);
    const nextActive =
      isMusicHub || def.interaction.type === 'toggle' || def.interaction.type === 'spin'
        ? !existing.active
        : existing.active;

    const linkedDoorUids = isStructuralDoor
      ? this.collectLinkedDoubleDoorUids(existing)
      : new Set<string>();

    const updated: PlacedItem = { ...existing, active: nextActive };
    let syncedCount = 0;

    const nextItems = this.state.items.map((it) => {
      if (it.uid === uid) return updated;

      if (linkedDoorUids.has(it.uid)) {
        return { ...it, active: nextActive };
      }

      if (isMusicHub && MUSIC_PARTY_LINKED.has(it.itemId)) {
        syncedCount += 1;
        return { ...it, active: nextActive };
      }

      if (existing.itemId === 'espresso_machine' && nextActive === true && CAFE_LINKED.has(it.itemId)) {
        if (!it.active) syncedCount += 1;
        return { ...it, active: true };
      }

      return it;
    });

    this.state = {
      ...this.state,
      items: nextItems,
    };

    this.emit('itemInteracted', { item: updated });

    if (isMusicHub && syncedCount > 0) {
      this.notify(
        `${def.name} + ${syncedCount} party & music ${syncedCount === 1 ? 'item' : 'items'} ${nextActive ? 'synced!' : 'paused'}`,
        'info',
      );
    } else if (existing.itemId === 'espresso_machine' && nextActive === true && syncedCount > 0) {
      this.notify(
        `Espresso Machine + ${syncedCount} café ${syncedCount === 1 ? 'item' : 'items'} brewing!`,
        'info',
      );
    } else if (PET_TOYS.has(existing.itemId)) {
      let catsReacted = 0;
      for (const it of this.state.items) {
        if (it.uid !== uid && CAT_ITEMS.has(it.itemId)) {
          this.emit('itemInteracted', { item: it });
          catsReacted += 1;
        }
      }
      if (catsReacted > 0) {
        this.notify(
          `${def.name}: ${catsReacted} ${catsReacted === 1 ? 'cat perked' : 'cats perked'} up!`,
          'info',
        );
      }
    }

    this.emit('houseChanged', { state: this.state, reason: 'interact' });
    return updated;
  }

  getTimeHour(): number {
    if (this.state.timeHour !== undefined && Number.isFinite(this.state.timeHour)) {
      return this.state.timeHour;
    }
    return this.state.timeOfDay
      ? timeOfDayToDefaultHour(this.state.timeOfDay)
      : DEFAULT_TIME_HOUR;
  }

  setTimeHour(hour: number, options?: { recordHistory?: boolean; fromCycle?: boolean }): void {
    if (!Number.isFinite(hour)) return;
    if (!options?.fromCycle && this.timeCycleRunning) {
      this.timeCycleRunning = false;
      this.emit('timeCycleChanged', { running: false });
    }
    const normalized = options?.fromCycle
      ? ((hour % 24) + 24) % 24
      : Math.max(0, Math.min(24, hour));
    const clamped = Math.round(normalized * 100) / 100;
    if (Math.abs(clamped - this.getTimeHour()) < 0.001) return;
    if (options?.recordHistory === true) {
      this.pushHistory();
    }
    const nextTod = timeHourToBucket(clamped);
    this.state = { ...this.state, timeHour: clamped, timeOfDay: nextTod };
    this.emit('houseChanged', { state: this.state, reason: 'timeOfDay' });
  }

  setTimeOfDay(timeOfDay: TimeOfDay): void {
    if (this.timeCycleRunning) {
      this.timeCycleRunning = false;
      this.emit('timeCycleChanged', { running: false });
    }
    const nextHour = timeOfDayToDefaultHour(timeOfDay);
    const current = this.state.timeOfDay ?? 'day';
    if (current === timeOfDay && Math.abs(this.getTimeHour() - nextHour) < 0.01) return;
    this.pushHistory();
    this.state = { ...this.state, timeOfDay, timeHour: nextHour };
    this.emit('houseChanged', { state: this.state, reason: 'timeOfDay' });
  }

  areAnyLightsActive(): boolean {
    for (const it of this.state.items) {
      if (!it.active) continue;
      if (this.isControllableLightDef(this.data.itemsById.get(it.itemId))) {
        return true;
      }
    }
    return false;
  }

  setAllLightsActive(active: boolean): number {
    const nextActive = Boolean(active);
    const matching = new Set<string>();
    for (const it of this.state.items) {
      const def = this.data.itemsById.get(it.itemId);
      if (this.isControllableLightDef(def) && Boolean(it.active) !== nextActive) {
        matching.add(it.uid);
      }
    }
    if (matching.size === 0) return 0;

    this.pushHistory();
    this.state = {
      ...this.state,
      items: this.state.items.map((it) =>
        matching.has(it.uid) ? { ...it, active: nextActive } : it,
      ),
    };
    this.emitMutation('interact');
    return matching.size;
  }

  setAllLights(on: boolean): number {
    return this.setAllLightsActive(on);
  }

  setSceneryView(viewId: string): void {
    if (!this.data.viewsById.has(viewId) || this.state.sceneryViewId === viewId) return;
    this.pushHistory();
    this.state = { ...this.state, sceneryViewId: viewId };
    this.emit('houseChanged', { state: this.state, reason: 'scenery' });
  }

  setWeather(weatherId: string): void {
    if (!this.data.weathersById.has(weatherId) || this.state.weatherId === weatherId) return;
    this.pushHistory();
    this.state = { ...this.state, weatherId };
    this.emit('houseChanged', { state: this.state, reason: 'weather' });
  }

  setRoomTypeOverride(override: string | null): void {
    if (this.state.roomTypeOverride === override) return;
    this.pushHistory();
    this.state = { ...this.state, roomTypeOverride: override };
    this.emit('houseChanged', { state: this.state, reason: 'roomOverride' });
  }

  loadHouse(nextState: HouseState, options?: { recordHistory?: boolean; reason?: string }): void {
    if (options?.recordHistory !== false) {
      this.pushHistory();
    }
    this.state = cloneHouseState(nextState);
    this.selectedUids = [];
    this.setSelectMode();
    this.emitSelectionChanged();
    this.emit('houseChanged', { state: this.state, reason: options?.reason ?? 'load' });
  }

  loadPreset(nextState: HouseState, presetName?: string): void {
    if (this.timeCycleRunning) {
      this.setTimeCycleRunning(false);
    }
    this.loadHouse(nextState, { recordHistory: true, reason: 'preset' });
    if (presetName) {
      this.notify(`Loaded ${presetName}`, 'success');
    }
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneHouseState(this.state));
    this.state = prev;
    const valid = new Set(this.state.items.map((i) => i.uid));
    const pruned = this.selectedUids.filter((id) => valid.has(id));
    if (pruned.length !== this.selectedUids.length) {
      this.selectedUids = pruned;
      this.emitSelectionChanged();
    }
    if (this.mode === 'move') {
      this.setSelectMode();
    }
    this.emit('houseChanged', { state: this.state, reason: 'undo' });
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneHouseState(this.state));
    this.state = next;
    const valid = new Set(this.state.items.map((i) => i.uid));
    const pruned = this.selectedUids.filter((id) => valid.has(id));
    if (pruned.length !== this.selectedUids.length) {
      this.selectedUids = pruned;
      this.emitSelectionChanged();
    }
    this.emit('houseChanged', { state: this.state, reason: 'redo' });
    return true;
  }
}
