import type { GameDataBundle, SceneryViewDef, WeatherDef } from '../data/schemas';
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';

/**
 * Module boundary for window views and weather (`data/scenery.json`).
 *
 * Phase 1 applies the active view/weather palette and lighting tint to the scene.
 * Phase 2 expands this module with outdoor backdrop dioramas and weather particle systems
 * without touching engine or store internals.
 */
export class SceneryModule {
  private readonly store: HouseStore;
  private readonly data: GameDataBundle;
  private readonly sceneManager: SceneManager;
  private unsubscribe?: () => void;

  constructor(store: HouseStore, sceneManager: SceneManager) {
    this.store = store;
    this.data = store.data;
    this.sceneManager = sceneManager;

    this.applyCurrent();
    this.unsubscribe = this.store.on('houseChanged', () => this.applyCurrent());
  }

  getActiveView(): SceneryViewDef {
    const id = this.store.getState().sceneryViewId;
    return this.data.viewsById.get(id) ?? this.data.scenery.views[0];
  }

  getActiveWeather(): WeatherDef {
    const id = this.store.getState().weatherId;
    return this.data.weathersById.get(id) ?? this.data.scenery.weathers[0];
  }

  applyCurrent(): void {
    this.sceneManager.applyAtmosphere(this.getActiveView(), this.getActiveWeather());
  }

  update(_dt: number): void {
    // Phase 2 hook: animate rain, snow, fog drift, and occasional lightning flashes.
  }

  dispose(): void {
    this.unsubscribe?.();
  }
}
