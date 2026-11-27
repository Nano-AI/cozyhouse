import './ui/styles.css';
import { AudioModule } from './audio/AudioModule';
import { loadGameData } from './data/loader';
import { PlacementController } from './engine/PlacementController';
import { SceneManager } from './engine/SceneManager';
import { decodeHouseFromShareLink, extractShareCodeFromHash } from './save/shareLink';
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

  let sharedHouse = null;
  let sharedLoadError: string | null = null;
  const hashCode = extractShareCodeFromHash(window.location.hash);
  if (hashCode) {
    try {
      const decoded = await decodeHouseFromShareLink(window.location.hash, data);
      sharedHouse = decoded.state;
    } catch (err) {
      sharedLoadError = err instanceof Error ? err.message : 'Invalid shared house link.';
    }
  }

  const savedState = sharedHouse ? null : loadHouseFromStorage(data);
  const initialHouse = sharedHouse ?? savedState ?? createStarterHouse(data);

  const store = new HouseStore(data, initialHouse);
  const sceneManager = new SceneManager(viewportEl, store);
  const sceneryModule = new SceneryModule(store, sceneManager);
  const visitorModule = new VisitorModule(store, sceneManager);
  const audioModule = new AudioModule();

  audioModule.attachStore(store);
  visitorModule.setAudioModule(audioModule);
  sceneryModule.setOnLightningFlash(() => audioModule.playThunder());

  let hud: HudController | null = null;
  const placement = new PlacementController(
    sceneManager,
    store,
    (hint) => hud?.setHoverHint(hint),
    (info) => hud?.setHoverItem(info),
  );

  hud = new HudController(hudEl, store, sceneManager, placement, {
    visitorModule,
    audioModule,
    sceneryModule,
  });

  if (sharedHouse) {
    store.notify('Loaded shared house!', 'success');
  } else if (sharedLoadError) {
    store.notify(sharedLoadError, 'error');
  }

  // Hook module tick loops into SceneManager's animation frame
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

  // Ensure initial house is persisted cleanly if first visit (unless viewing a shared link)
  if (!savedState && !sharedHouse) {
    saveHouseToStorage(store.getState());
  }

  window.addEventListener('pagehide', flushSave);

  // Expose debug handle for local inspection & testing
  (window as unknown as Record<string, unknown>).__cozyhouse = {
    store,
    sceneManager,
    sceneryModule,
    visitorModule,
    audioModule,
    hud,
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
