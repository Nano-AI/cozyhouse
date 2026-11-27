import type {
  GameDataBundle,
  HouseState,
  PlacedItem,
  RotationQuarter,
} from '../data/schemas';

export type InteractionMode = 'select' | 'place' | 'move';

export interface StoreEventMap {
  houseChanged: { state: HouseState; reason: string };
  selectionChanged: { selectedUid: string | null };
  modeChanged: {
    mode: InteractionMode;
    placementItemId: string | null;
    placementVariantId: string | null;
    placementRotation: RotationQuarter;
  };
  itemInteracted: { item: PlacedItem };
  toast: { message: string; tone?: 'info' | 'success' | 'error' };
}

type Listener<T> = (payload: T) => void;

const MAX_HISTORY = 80;

function cloneHouseState(state: HouseState): HouseState {
  return {
    gridWidth: state.gridWidth,
    gridDepth: state.gridDepth,
    sceneryViewId: state.sceneryViewId,
    weatherId: state.weatherId,
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

  private selectedUid: string | null = null;
  private mode: InteractionMode = 'select';
  private placementItemId: string | null = null;
  private placementVariantId: string | null = null;
  private placementRotation: RotationQuarter = 0;

  private listeners: { [K in keyof StoreEventMap]: Set<Listener<StoreEventMap[K]>> } = {
    houseChanged: new Set(),
    selectionChanged: new Set(),
    modeChanged: new Set(),
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

  notify(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
    this.emit('toast', { message, tone });
  }

  getState(): HouseState {
    return this.state;
  }

  getItem(uid: string): PlacedItem | undefined {
    return this.state.items.find((i) => i.uid === uid);
  }

  getChildren(parentUid: string): PlacedItem[] {
    return this.state.items.filter((i) => i.parentUid === parentUid);
  }

  getSelectedUid(): string | null {
    return this.selectedUid;
  }

  getSelectedItem(): PlacedItem | null {
    if (!this.selectedUid) return null;
    return this.getItem(this.selectedUid) ?? null;
  }

  getModeState() {
    return {
      mode: this.mode,
      placementItemId: this.placementItemId,
      placementVariantId: this.placementVariantId,
      placementRotation: this.placementRotation,
    };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushHistory(): void {
    this.undoStack.push(cloneHouseState(this.state));
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  selectItem(uid: string | null): void {
    if (this.selectedUid === uid) return;
    this.selectedUid = uid;
    if (uid && this.mode === 'place') {
      this.setSelectMode();
    }
    this.emit('selectionChanged', { selectedUid: this.selectedUid });
  }

  setSelectMode(): void {
    this.mode = 'select';
    this.placementItemId = null;
    this.placementVariantId = null;
    this.emit('modeChanged', this.getModeState());
  }

  startPlacement(itemId: string, variantId?: string): void {
    const def = this.data.itemsById.get(itemId);
    if (!def) return;
    const chosenVariant =
      variantId && def.variants.some((v) => v.id === variantId)
        ? variantId
        : def.variants[0].id;
    this.selectedUid = null;
    this.mode = 'place';
    this.placementItemId = itemId;
    this.placementVariantId = chosenVariant;
    this.emit('selectionChanged', { selectedUid: null });
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
    this.emit('houseChanged', { state: this.state, reason: 'place' });
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

    this.emit('houseChanged', { state: this.state, reason: 'move' });
    return true;
  }

  setItemVariant(uid: string, variantId: string): boolean {
    const existing = this.getItem(uid);
    if (!existing || existing.variantId === variantId) return false;
    this.pushHistory();
    this.state = {
      ...this.state,
      items: this.state.items.map((it) => (it.uid === uid ? { ...it, variantId } : it)),
    };
    this.emit('houseChanged', { state: this.state, reason: 'variant' });
    return true;
  }

  deleteItem(uid: string): boolean {
    const existing = this.getItem(uid);
    if (!existing) return false;

    this.pushHistory();
    // Collect item and any recursively dependent children (surface/wall-mounted)
    const toRemove = new Set<string>([uid]);
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

    this.state = {
      ...this.state,
      items: this.state.items.filter((it) => !toRemove.has(it.uid)),
    };

    if (this.selectedUid && toRemove.has(this.selectedUid)) {
      this.selectedUid = null;
      this.emit('selectionChanged', { selectedUid: null });
    }
    if (this.mode === 'move') {
      this.setSelectMode();
    }

    this.emit('houseChanged', { state: this.state, reason: 'delete' });
    return true;
  }

  triggerInteraction(uid: string): PlacedItem | null {
    const existing = this.getItem(uid);
    if (!existing) return null;
    const def = this.data.itemsById.get(existing.itemId);
    const nextActive = def?.interaction?.type === 'toggle' || def?.interaction?.type === 'spin'
      ? !existing.active
      : existing.active;

    const updated: PlacedItem = { ...existing, active: nextActive };
    this.state = {
      ...this.state,
      items: this.state.items.map((it) => (it.uid === uid ? updated : it)),
    };
    this.emit('itemInteracted', { item: updated });
    this.emit('houseChanged', { state: this.state, reason: 'interact' });
    return updated;
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
    this.selectedUid = null;
    this.setSelectMode();
    this.emit('selectionChanged', { selectedUid: null });
    this.emit('houseChanged', { state: this.state, reason: options?.reason ?? 'load' });
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneHouseState(this.state));
    this.state = prev;
    if (this.selectedUid && !this.getItem(this.selectedUid)) {
      this.selectedUid = null;
      this.emit('selectionChanged', { selectedUid: null });
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
    if (this.selectedUid && !this.getItem(this.selectedUid)) {
      this.selectedUid = null;
      this.emit('selectionChanged', { selectedUid: null });
    }
    this.emit('houseChanged', { state: this.state, reason: 'redo' });
    return true;
  }
}
