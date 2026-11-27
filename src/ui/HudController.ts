import type { CatalogTabId, FurnitureItemDef } from '../data/schemas';
import type { PlacementController } from '../engine/PlacementController';
import type { SceneManager } from '../engine/SceneManager';
import { evaluateRoomType } from '../rooms/RoomEvaluator';
import { exportHouseToFile, importHouseFromFile } from '../save/fileIO';
import { createEmptyHouse, createStarterHouse } from '../state/defaultHouse';
import type { HouseStore } from '../state/houseStore';

export class HudController {
  private readonly root: HTMLElement;
  private readonly store: HouseStore;
  private readonly sceneManager: SceneManager;
  private readonly placement: PlacementController;

  private activeTab: CatalogTabId = 'basics';
  private saveStatusText = 'Saved';
  private showHelp = false;

  // DOM references
  private roomBadgeEl!: HTMLSpanElement;
  private countBadgeEl!: HTMLSpanElement;
  private saveBadgeEl!: HTMLSpanElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private contextBarEl!: HTMLDivElement;
  private tabStripEl!: HTMLDivElement;
  private catalogItemsEl!: HTMLDivElement;
  private hoverHintEl!: HTMLDivElement;
  private toastStackEl!: HTMLDivElement;
  private helpPopoverEl!: HTMLDivElement;
  private fileInputEl!: HTMLInputElement;

  constructor(
    root: HTMLElement,
    store: HouseStore,
    sceneManager: SceneManager,
    placement: PlacementController,
  ) {
    this.root = root;
    this.store = store;
    this.sceneManager = sceneManager;
    this.placement = placement;

    this.buildShell();
    this.renderTabs();
    this.renderCatalogItems();
    this.syncHud();

    this.store.on('houseChanged', () => this.syncHud());
    this.store.on('selectionChanged', () => this.renderContextBar());
    this.store.on('modeChanged', () => {
      this.renderContextBar();
      this.renderCatalogItems();
    });
    this.store.on('toast', ({ message, tone }) => this.showToast(message, tone));
  }

  setSaveStatus(label: string): void {
    this.saveStatusText = label;
    if (this.saveBadgeEl) {
      this.saveBadgeEl.textContent = label;
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

    // Top bar
    const topBar = document.createElement('div');
    topBar.className = 'hud-bar';

    // Left: Brand + Room Label + Help
    const brandGroup = document.createElement('div');
    brandGroup.className = 'hud-group';

    const title = document.createElement('span');
    title.className = 'brand-title';
    title.textContent = 'Cozyhouse';
    brandGroup.appendChild(title);

    this.roomBadgeEl = document.createElement('span');
    this.roomBadgeEl.className = 'pill-badge';
    brandGroup.appendChild(this.roomBadgeEl);

    this.countBadgeEl = document.createElement('span');
    this.countBadgeEl.className = 'pill-badge muted';
    brandGroup.appendChild(this.countBadgeEl);

    const helpBtn = this.makeBtn('?', () => {
      this.showHelp = !this.showHelp;
      this.helpPopoverEl.classList.toggle('hidden', !this.showHelp);
    });
    helpBtn.title = 'Controls';
    brandGroup.appendChild(helpBtn);

    // Center: Camera + Undo/Redo
    const cameraGroup = document.createElement('div');
    cameraGroup.className = 'hud-group';

    this.undoBtn = this.makeBtn('Undo', () => {
      if (this.store.undo()) this.store.notify('Undid action', 'info');
    });
    this.redoBtn = this.makeBtn('Redo', () => {
      if (this.store.redo()) this.store.notify('Redid action', 'info');
    });

    cameraGroup.append(
      this.undoBtn,
      this.redoBtn,
      this.makeBtn('⟲ 90°', () => this.sceneManager.isoCamera.rotateStep(-1)),
      this.makeBtn('⟳ 90°', () => this.sceneManager.isoCamera.rotateStep(1)),
      this.makeBtn('−', () => this.sceneManager.isoCamera.zoomByFactor(1 / 1.2)),
      this.makeBtn('+', () => this.sceneManager.isoCamera.zoomByFactor(1.2)),
      this.makeBtn('Reset View', () => this.sceneManager.isoCamera.resetView()),
    );

    // Right: Autosave status + Export/Import + Reset
    const fileGroup = document.createElement('div');
    fileGroup.className = 'hud-group';

    this.saveBadgeEl = document.createElement('span');
    this.saveBadgeEl.className = 'pill-badge muted';
    this.saveBadgeEl.textContent = this.saveStatusText;

    const exportBtn = this.makeBtn('Export', () => {
      const { filename, bytes } = exportHouseToFile(this.store.getState());
      this.store.notify(`Exported ${filename} (${bytes} B)`, 'success');
    });

    const importBtn = this.makeBtn('Import', () => {
      this.fileInputEl.value = '';
      this.fileInputEl.click();
    });

    const starterBtn = this.makeBtn('Starter', () => {
      this.store.loadHouse(createStarterHouse(this.store.data), { reason: 'starter' });
      this.store.notify('Restored starter house', 'info');
    });

    const clearBtn = this.makeBtn('Clear', () => {
      this.store.loadHouse(createEmptyHouse(this.store.data), { reason: 'clear' });
      this.store.notify('Cleared lot (Undo to restore)', 'info');
    });

    fileGroup.append(this.saveBadgeEl, exportBtn, importBtn, starterBtn, clearBtn);

    topBar.append(brandGroup, cameraGroup, fileGroup);
    this.root.appendChild(topBar);

    // Help popover
    this.helpPopoverEl = document.createElement('div');
    this.helpPopoverEl.className = 'help-popover hidden';
    this.helpPopoverEl.innerHTML = `
      <h4>Trackpad &amp; Mouse Controls</h4>
      <ul>
        <li><strong>Two-finger scroll</strong> or <strong>drag empty space</strong>: pan camera</li>
        <li><strong>Pinch</strong> (or + / −): zoom in &amp; out</li>
        <li><strong>⟲ / ⟳ 90°</strong> (or Q / E): rotate view</li>
        <li><strong>Click catalog item</strong>: place on floor, wall, ceiling, or table surface</li>
        <li><strong>Click placed item</strong>: select; click again to react; drag to move</li>
        <li><strong>Optional keys</strong>: R rotate, Del delete, Cmd/Ctrl+Z undo, Esc cancel</li>
      </ul>
    `;
    this.root.appendChild(this.helpPopoverEl);

    // Hover validation hint pill
    this.hoverHintEl = document.createElement('div');
    this.hoverHintEl.className = 'floating-hint';
    this.root.appendChild(this.hoverHintEl);

    // Toast stack
    this.toastStackEl = document.createElement('div');
    this.toastStackEl.className = 'toast-stack';
    this.root.appendChild(this.toastStackEl);

    // Bottom stack: Contextual selection/placement bar + Catalog dock
    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';

    this.contextBarEl = document.createElement('div');
    this.contextBarEl.className = 'context-bar hidden';
    bottom.appendChild(this.contextBarEl);

    const dock = document.createElement('div');
    dock.className = 'catalog-dock';

    this.tabStripEl = document.createElement('div');
    this.tabStripEl.className = 'tab-strip';
    dock.appendChild(this.tabStripEl);

    this.catalogItemsEl = document.createElement('div');
    this.catalogItemsEl.className = 'catalog-items';
    dock.appendChild(this.catalogItemsEl);

    bottom.appendChild(dock);
    this.root.appendChild(bottom);
  }

  private makeBtn(label: string, onClick: () => void, variant?: 'primary' | 'danger'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = variant ? `btn ${variant}` : 'btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private renderTabs(): void {
    this.tabStripEl.innerHTML = '';
    for (const tab of this.store.data.furniture.tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = tab.id === this.activeTab ? 'tab-btn active' : 'tab-btn';

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.style.background = tab.color;

      const label = document.createElement('span');
      label.textContent = tab.label;

      btn.append(dot, label);
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.renderTabs();
        this.renderCatalogItems();
      });
      this.tabStripEl.appendChild(btn);
    }
  }

  private renderCatalogItems(): void {
    this.catalogItemsEl.innerHTML = '';
    const modeState = this.store.getModeState();
    const items = this.store.data.furniture.items.filter((i) => i.tab === this.activeTab);

    for (const item of items) {
      const isPlacingThis =
        modeState.mode === 'place' && modeState.placementItemId === item.id;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = isPlacingThis ? 'item-card active' : 'item-card';

      const top = document.createElement('div');
      top.className = 'item-card-top';

      const swatch = document.createElement('span');
      swatch.className = 'item-color-block';
      swatch.style.background = item.variants[0].color;

      const layerTag = document.createElement('span');
      layerTag.className = 'item-layer-tag';
      layerTag.textContent = item.layer;

      top.append(swatch, layerTag);

      const name = document.createElement('div');
      name.className = 'item-card-name';
      name.textContent = item.name;

      const meta = document.createElement('div');
      meta.className = 'item-card-meta';
      const [w, d] = item.footprint;
      meta.textContent = `${w}×${d} · ${item.variants.length} colors`;

      card.append(top, name, meta);
      card.addEventListener('click', () => {
        if (isPlacingThis) {
          this.store.setSelectMode();
        } else {
          this.store.startPlacement(item.id);
        }
      });

      this.catalogItemsEl.appendChild(card);
    }
  }

  private renderContextBar(): void {
    const modeState = this.store.getModeState();
    const selected = this.store.getSelectedItem();

    if (modeState.mode === 'place' && modeState.placementItemId) {
      const def = this.store.data.itemsById.get(modeState.placementItemId);
      if (!def) {
        this.contextBarEl.classList.add('hidden');
        return;
      }
      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = `Placing: ${def.name}`;

      const layer = document.createElement('span');
      layer.className = 'pill-badge muted';
      layer.textContent = `${def.layer}${def.wallKind ? ` (${def.wallKind})` : ''}`;

      const swatches = this.buildVariantSwatches(
        def,
        modeState.placementVariantId ?? def.variants[0].id,
        (variantId) => this.store.setPlacementVariant(variantId),
      );

      this.contextBarEl.append(
        title,
        layer,
        swatches,
        this.makeBtn('Rotate 90°', () => this.store.rotatePlacement(1)),
        this.makeBtn('Done', () => this.store.setSelectMode(), 'primary'),
      );
      return;
    }

    if (modeState.mode === 'move' && selected) {
      const def = this.store.data.itemsById.get(selected.itemId);
      this.contextBarEl.classList.remove('hidden');
      this.contextBarEl.innerHTML = '';

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = `Moving: ${def?.name ?? selected.itemId} — click to drop`;

      this.contextBarEl.append(
        title,
        this.makeBtn('Rotate 90°', () => this.store.rotatePlacement(1)),
        this.makeBtn('Cancel', () => this.store.setSelectMode()),
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

      const title = document.createElement('span');
      title.className = 'context-title';
      title.textContent = def.name;

      const layer = document.createElement('span');
      layer.className = 'pill-badge muted';
      layer.textContent = def.layer;

      const swatches = this.buildVariantSwatches(def, selected.variantId, (variantId) => {
        this.store.setItemVariant(selected.uid, variantId);
      });

      this.contextBarEl.append(title, layer, swatches);

      if (def.interaction) {
        this.contextBarEl.appendChild(
          this.makeBtn(def.interaction.label, () => {
            this.store.triggerInteraction(selected.uid);
          }),
        );
      }

      this.contextBarEl.append(
        this.makeBtn('Move', () => this.store.startMovingSelected()),
        this.makeBtn('Rotate 90°', () => this.placement.rotateSelectedInPlace()),
        this.makeBtn(
          'Delete',
          () => {
            this.store.deleteItem(selected.uid);
            this.store.notify(`Deleted ${def.name}`, 'info');
          },
          'danger',
        ),
        this.makeBtn('Close', () => this.store.selectItem(null)),
      );
      return;
    }

    this.contextBarEl.classList.add('hidden');
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

  private syncHud(): void {
    const state = this.store.getState();
    const evaluation = evaluateRoomType(state, this.store.data);
    this.roomBadgeEl.textContent = evaluation.labelInfo.label;
    this.roomBadgeEl.style.background = evaluation.labelInfo.accentColor;

    this.countBadgeEl.textContent = `${state.items.length} items`;
    this.undoBtn.disabled = !this.store.canUndo();
    this.redoBtn.disabled = !this.store.canRedo();
    this.renderContextBar();
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
