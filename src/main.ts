import './ui/styles.css';
import { AudioModule } from './audio/AudioModule';
import { loadGameData } from './data/loader';
import { PlacementController } from './engine/PlacementController';
import { SceneManager } from './engine/SceneManager';
import { loadHouseFromStorage, saveHouseToStorage } from './save/storage';
import { SceneryModule } from './scenery/SceneryModule';
import { createStarterHouse } from './state/defaultHouse';
import { HouseStore } from './state/houseStore';
import { HudController } from './ui/HudController';
import { VisitorModule } from './visitors/VisitorModule';

async function bootstrap(): Promise<void> {
  const viewportEl = document.getElementById('viewport');
  const hudEl = document.getElementById('hud');
  if (!viewportEl || !hudEl) {
    throw new Error('Missing #viewport or #hud mount containers.');
  }

  const data = await loadGameData('./data');
  const savedState = loadHouseFromStorage(data);
  const initialHouse = savedState ?? createStarterHouse(data);

  const store = new HouseStore(data, initialHouse);
  const sceneManager = new SceneManager(viewportEl, store);
  const sceneryModule = new SceneryModule(store, sceneManager);
  const visitorModule = new VisitorModule(store, sceneManager);
  const audioModule = new AudioModule();

  let hud: HudController | null = null;
  const placement = new PlacementController(sceneManager, store, (hint) => {
    hud?.setHoverHint(hint);
  });

  hud = new HudController(hudEl, store, sceneManager, placement);

  // Hook Phase 2 module tick loops into SceneManager's animation frame
  sceneManager.addTickHook((dt) => {
    sceneryModule.update(dt);
    visitorModule.update(dt);
  });

  // Debounced autosave to localStorage + flush on pagehide
  let saveTimer: number | null = null;
  const flushSave = () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const result = saveHouseToStorage(store.getState());
    hud?.setSaveStatus(result.ok ? 'Saved' : 'Save failed');
  };

  store.on('houseChanged', () => {
    hud?.setSaveStatus('Saving…');
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(flushSave, 220);
  });

  // Ensure initial house is persisted cleanly if first visit
  if (!savedState) {
    saveHouseToStorage(store.getState());
  }

  window.addEventListener('pagehide', flushSave);

  // Expose minimal debug handle for local inspection & Phase 2 testing
  (window as unknown as Record<string, unknown>).__cozyhouse = {
    store,
    sceneManager,
    sceneryModule,
    visitorModule,
    audioModule,
  };
}

bootstrap().catch((err) => {
  console.error('[Cozyhouse] Startup failed:', err);
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.innerHTML = `<div style="margin:24px;padding:16px;background:#fffbf5;border-radius:12px;color:#8f3529;pointer-events:auto;">
      <strong>Cozyhouse failed to start:</strong> ${err instanceof Error ? err.message : String(err)}
    </div>`;
  }
});
