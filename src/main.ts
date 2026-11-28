import './ui/styles.css';
import { AudioModule } from './audio/AudioModule';
import { loadGameData } from './data/loader';
import { PlacementController } from './engine/PlacementController';
import { HorrorDirector } from './events/HorrorDirector';
import { SceneManager } from './engine/SceneManager';
import { decodeHouseFromShareLink, extractShareCodeFromHash } from './save/shareLink';
import { backupHouseStorage, loadHouseFromStorage, saveHouseToStorage } from './save/storage';
import { SceneryModule } from './scenery/SceneryModule';
import { createStarterHouse } from './state/defaultHouse';
import { HouseStore } from './state/houseStore';
import { HudController } from './ui/HudController';
import { VisitorModule } from './visitors/VisitorModule';

type LoaderStage = 1 | 2 | 3 | 4 | 5 | 6;

interface LoaderMilestone {
  stage: LoaderStage;
  pct: number;
  label: string;
}

interface BootLoader {
  setStage: (stage: LoaderStage, pct: number, label: string) => void;
  finish: () => Promise<void>;
  dismissImmediate: () => void;
}

function createBootLoader(): BootLoader {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dismissed = false;
  let lastDomUpdateAt = startedAt;
  let displayedStage: LoaderStage = 1;
  const queuedMilestones: LoaderMilestone[] = [];
  const pendingTimers = new Set<number>();

  const getElements = () => ({
    root: document.getElementById('cozy-loader'),
    bar: document.getElementById('cozy-loader-bar') as HTMLElement | null,
    label: document.getElementById('cozy-loader-label'),
  });

  const applyToDom = (stage: LoaderStage, pct: number, label: string): void => {
    if (dismissed) return;
    const { root, bar, label: labelEl } = getElements();
    if (!root) return;
    displayedStage = stage;
    lastDomUpdateAt = now();
    root.dataset.stage = String(stage);
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
    if (labelEl) {
      labelEl.textContent = label;
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (ms <= 0 || dismissed) {
        resolve();
        return;
      }
      const id = window.setTimeout(() => {
        pendingTimers.delete(id);
        resolve();
      }, ms);
      pendingTimers.add(id);
    });

  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      if (dismissed || typeof window.requestAnimationFrame !== 'function') {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => resolve());
    });

  const removeNodes = (): void => {
    document.getElementById('cozy-loader')?.remove();
    document.getElementById('cozy-loader-styles')?.remove();
  };

  const dismissImmediate = (): void => {
    dismissed = true;
    queuedMilestones.length = 0;
    for (const id of pendingTimers) {
      window.clearTimeout(id);
    }
    pendingTimers.clear();
    removeNodes();
  };

  const setStage = (stage: LoaderStage, pct: number, label: string): void => {
    if (dismissed) return;
    const { root } = getElements();
    if (!root) return;

    // Apply immediately for stage 1, reduced-motion, or when enough time elapsed since last paint;
    // otherwise queue so synchronous local-boot stages animate smoothly instead of collapsing into 1 frame.
    if (stage === 1 || prefersReducedMotion || now() - lastDomUpdateAt >= 90) {
      queuedMilestones.length = 0;
      applyToDom(stage, pct, label);
    } else {
      const existingIdx = queuedMilestones.findIndex((m) => m.stage === stage);
      const entry: LoaderMilestone = { stage, pct, label };
      if (existingIdx >= 0) {
        queuedMilestones[existingIdx] = entry;
      } else {
        queuedMilestones.push(entry);
      }
    }
  };

  const finish = async (): Promise<void> => {
    if (dismissed) return;
    const { root } = getElements();
    if (!root) return;

    // Wait for the first 3D WebGL frame to paint cleanly behind the overlay
    await nextFrame();
    if (dismissed) return;

    const MIN_DISPLAY_FLOOR_MS = 750;
    const remainingFloor = Math.max(0, MIN_DISPLAY_FLOOR_MS - (now() - startedAt));

    if (!prefersReducedMotion && remainingFloor > 0) {
      // Step cleanly through any remaining intermediate stages within the display floor
      const remainingStages = queuedMilestones.filter((m) => m.stage > displayedStage);
      queuedMilestones.length = 0;
      if (remainingStages.length > 0) {
        const stepMs = Math.max(85, Math.floor(remainingFloor / remainingStages.length));
        for (const milestone of remainingStages) {
          if (dismissed) return;
          applyToDom(milestone.stage, milestone.pct, milestone.label);
          await sleep(stepMs);
        }
      } else {
        await sleep(remainingFloor);
      }
    } else {
      queuedMilestones.length = 0;
    }

    if (dismissed) return;

    // Final stage: golden glow & sparkles
    applyToDom(6, 100, 'Welcome home!');
    await sleep(prefersReducedMotion ? 100 : 220);
    if (dismissed) return;

    const currentRoot = document.getElementById('cozy-loader');
    if (currentRoot) {
      currentRoot.classList.add('is-leaving');
      await sleep(prefersReducedMotion ? 160 : 380);
    }
    if (!dismissed) {
      dismissImmediate();
    }
  };

  return { setStage, finish, dismissImmediate };
}

const bootLoader = createBootLoader();

async function bootstrap(): Promise<void> {
  const viewportEl = document.getElementById('viewport');
  const hudEl = document.getElementById('hud');
  if (!viewportEl || !hudEl) {
    throw new Error('Missing #viewport or #hud mount containers.');
  }

  bootLoader.setStage(1, 18, 'Laying the foundation…');
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
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      // Ignore replaceState restrictions in sandboxed environments
    }
  }

  const savedState = sharedHouse ? null : loadHouseFromStorage(data);
  const initialHouse = sharedHouse ?? savedState ?? createStarterHouse(data);

  bootLoader.setStage(2, 38, 'Raising the walls…');
  const store = new HouseStore(data, initialHouse);

  bootLoader.setStage(3, 58, 'Adding the roof & yard…');
  const sceneManager = new SceneManager(viewportEl, store);
  const sceneryModule = new SceneryModule(store, sceneManager);

  bootLoader.setStage(4, 76, 'Opening doors & windows…');
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

  bootLoader.setStage(5, 90, 'Warming up the hearth…');
  hud = new HudController(hudEl, store, sceneManager, placement, {
    visitorModule,
    audioModule,
    sceneryModule,
  });

  // Very first visit (no saved house, not opening a share link): offer New House or a preset.
  const WELCOMED_KEY = 'cozyhouse:welcomed';
  let welcomed = true;
  try {
    welcomed = localStorage.getItem(WELCOMED_KEY) === '1';
  } catch {
    // Storage blocked: skip the chooser rather than show it on every load
  }
  if (!welcomed && !savedState && !sharedHouse) {
    hud.showWelcomeChooser(() => {
      try {
        localStorage.setItem(WELCOMED_KEY, '1');
      } catch {
        // Ignore storage errors
      }
    });
  }

  if (sharedHouse) {
    store.notify('Loaded shared house!', 'success');
  } else if (sharedLoadError) {
    store.notify(sharedLoadError, 'error');
  }

  // Hook module tick loops into SceneManager's animation frame (simDt scales 0x/1x/2x/5x)
  sceneManager.addTickHook((simDt) => {
    sceneryModule.update(simDt);
    if (simDt <= 0) return;
    // Sub-step visitor simulation cleanly at 2x / 5x speeds so pathfinding & steering stay rock-solid
    const steps = simDt > 0.045 ? Math.ceil(simDt / 0.045) : 1;
    const stepDt = simDt / steps;
    for (let i = 0; i < steps; i++) {
      visitorModule.update(stepDt);
    }
  });

  // Debounced autosave to localStorage + flush on pagehide
  // While viewing an unedited shared link, preserve the player's local autosave untouched until their first real edit.
  let viewingUneditedShared = Boolean(sharedHouse);
  let saveTimer: number | null = null;
  const flushSave = () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (viewingUneditedShared) {
      return;
    }
    const result = saveHouseToStorage(store.getState());
    hud?.setSaveStatus(result.ok ? 'Saved' : 'Save failed');
  };

  store.on('houseChanged', ({ reason }) => {
    // Ignore 24h running time-cycle ticks so they never starve autosave debounce or spam "Saving…"
    if (reason === 'timeOfDay') return;
    // Visitors and staff using items isn't a player edit: never let it overwrite the local save while viewing a shared link.
    if (viewingUneditedShared && reason === 'sim-interact') return;

    if (viewingUneditedShared) {
      backupHouseStorage('cozyhouse:save:backup');
      viewingUneditedShared = false;
    }

    hud?.setSaveStatus('Saving…');
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(flushSave, 220);
  });

  // Ensure initial house is persisted cleanly if first visit (unless viewing a shared link)
  if (!savedState && !viewingUneditedShared) {
    saveHouseToStorage(store.getState());
  }

  window.addEventListener('pagehide', flushSave);

  // [horror-events hook] The Last Guest: rare night-weather event (src/events/HorrorDirector.ts)
  const horrorDirector = new HorrorDirector({ store, sceneManager, visitorModule, audioModule });
  // Gojo is the one guest The Last Guest can't take: Red + Blue → Hollow Purple erases him instead.
  horrorDirector.onGojoConfronts = (_gojo, guestPos) => {
    const view = horrorDirector.getPlayerView();
    let banished = false;
    const banish = () => {
      if (banished) return;
      banished = true;
      horrorDirector.banish();
    };
    const started = visitorModule.playHollowPurple('gojo', guestPos, {
      withVoice: true, // Gojo's own lines from the episode
      onHit: banish,
      onDone: () => {
        banish();
        if (view) sceneManager.isoCamera.restoreView(view.zoom, view.x, view.z);
      },
    });
    if (!started) banish();
  };

  // Expose debug handle for local inspection & testing
  (window as unknown as Record<string, unknown>).__cozyhouse = {
    horrorDirector,
    store,
    sceneManager,
    sceneryModule,
    visitorModule,
    audioModule,
    hud,
  };

  void bootLoader.finish();
}

bootstrap().catch((err) => {
  bootLoader.dismissImmediate();
  console.error('[Cozyhouse] Startup failed:', err);
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.innerHTML = `<div style="margin:24px;padding:16px;background:#fffbf5;border-radius:12px;color:#8f3529;pointer-events:auto;">
      <strong>Cozyhouse failed to start:</strong> ${err instanceof Error ? err.message : String(err)}
    </div>`;
  }
});
