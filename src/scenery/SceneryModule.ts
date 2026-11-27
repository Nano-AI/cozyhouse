import * as THREE from 'three';
import type { GameDataBundle, HouseState, SceneryViewDef, TimeOfDay, WeatherDef } from '../data/schemas';
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';
import {
  type BackdropHandle,
  type YardLifeHandle,
  buildBackdropForView,
  buildYardLife,
  computeYardLayoutSignature,
} from './BackdropBuilder';
import { resolveTimeHour } from './SkyDome';
import { WeatherSystem } from './WeatherSystem';

const COL_MIDNIGHT_FOG = new THREE.Color('#182240');
const COL_DAWN_FOG = new THREE.Color('#F2CFB9');
const COL_MORNING_FOG = new THREE.Color('#F6E5D4');
const COL_SUNSET_FOG = new THREE.Color('#C48086');
const COL_DUSK_FOG = new THREE.Color('#393A62');
const COL_NIGHT_FOG = new THREE.Color('#1D2847');
const WHITE_TINT = new THREE.Color('#FFFFFF');

/**
 * Module boundary for window views, weather (`data/scenery.json`), continuous 24h Time
 * of Day, and living yard grass/wildflowers/butterflies inside open lot tiles.
 */
export class SceneryModule {
  private readonly store: HouseStore;
  private readonly data: GameDataBundle;
  private readonly sceneManager: SceneManager;
  private readonly weatherSystem = new WeatherSystem();
  private readonly baseSkyColor = new THREE.Color();
  private readonly flashSkyColor = new THREE.Color('#DCE8FF');
  private readonly workingColor = new THREE.Color();
  private readonly workingFogColor = new THREE.Color();
  private readonly workingFogTint = new THREE.Color();
  private readonly cameraForward = new THREE.Vector3();

  // Reusable scratch atmosphere objects during lightning flashes (zero per-frame alloc)
  private readonly scratchFlashedView: SceneryViewDef;
  private readonly scratchFlashedWeather: WeatherDef;

  private backdrop: BackdropHandle | null = null;
  private yardLife: YardLifeHandle | null = null;
  private currentViewId: string | null = null;
  private currentWeatherId: string | null = null;
  private currentTimeOfDay: TimeOfDay | null = null;
  private currentTimeHour = -1;
  private currentGridWidth = -1;
  private currentGridDepth = -1;
  private currentYardSig = '';
  private elapsed = 0;
  private unsubscribe?: () => void;

  constructor(store: HouseStore, sceneManager: SceneManager) {
    this.store = store;
    this.data = store.data;
    this.sceneManager = sceneManager;

    this.scratchFlashedView = { ...this.data.scenery.views[0] };
    this.scratchFlashedWeather = { ...this.data.scenery.weathers[0] };

    this.sceneManager.scene.add(this.weatherSystem.root);
    this.weatherSystem.setOnFlashVisualUpdate((intensity) => {
      this.applyLightningFlashVisual(intensity);
    });

    this.applyCurrent();
    this.unsubscribe = this.store.on('houseChanged', () => this.applyCurrent());
  }

  setOnLightningFlash(cb: (() => void) | null): void {
    this.weatherSystem.setOnLightningFlash(cb);
  }

  getActiveView(): SceneryViewDef {
    const id = this.store.getState().sceneryViewId;
    return this.data.viewsById.get(id) ?? this.data.scenery.views[0];
  }

  getActiveWeather(): WeatherDef {
    const id = this.store.getState().weatherId;
    return this.data.weathersById.get(id) ?? this.data.scenery.weathers[0];
  }

  getActiveTimeOfDay(): TimeOfDay {
    return this.store.getState().timeOfDay ?? 'day';
  }

  getActiveTimeHour(): number {
    const state = this.store.getState();
    return resolveTimeHour(state.timeOfDay ?? 'day', state.timeHour);
  }

  applyCurrent(): void {
    const state = this.store.getState();
    const view = this.getActiveView();
    const weather = this.getActiveWeather();
    const timeOfDay = this.getActiveTimeOfDay();
    const timeHour = this.getActiveTimeHour();

    const viewChanged = view.id !== this.currentViewId;
    const weatherChanged = weather.id !== this.currentWeatherId;
    const timeChanged =
      timeOfDay !== this.currentTimeOfDay || Math.abs(timeHour - this.currentTimeHour) > 0.0005;
    const sizeChanged =
      state.gridWidth !== this.currentGridWidth || state.gridDepth !== this.currentGridDepth;

    // Rebuild living yard grass/wildflowers only when floor/wall layout, view, or lot size changes
    this.syncYardLife(state, view, weather, timeHour);

    if (!viewChanged && !weatherChanged && !timeChanged && !sizeChanged) {
      return;
    }

    this.currentViewId = view.id;
    this.currentWeatherId = weather.id;
    this.currentTimeOfDay = timeOfDay;
    this.currentTimeHour = timeHour;
    this.currentGridWidth = state.gridWidth;
    this.currentGridDepth = state.gridDepth;

    this.sceneManager.gridVisual.setYardVisible(view.id !== 'city');

    if (viewChanged || sizeChanged || !this.backdrop) {
      if (this.backdrop) {
        this.sceneManager.scene.remove(this.backdrop.root);
        this.backdrop.dispose();
        this.backdrop = null;
      }
      this.backdrop = buildBackdropForView(
        view,
        weather,
        state.gridWidth,
        state.gridDepth,
        timeOfDay,
        timeHour,
      );
      this.sceneManager.scene.add(this.backdrop.root);
      const cam = this.sceneManager.isoCamera.camera;
      cam.getWorldDirection(this.cameraForward);
      this.backdrop.update(this.elapsed, 0, weather, cam.position, this.cameraForward);
    } else if (weatherChanged || timeChanged) {
      this.backdrop.applyWeatherTint(view, weather, timeOfDay, timeHour);
      if (timeChanged) {
        this.backdrop.applyTimeOfDay(timeOfDay, timeHour);
      }
    }

    this.backdrop.setLightning(0);
    const effectiveFogHex = this.applyAtmosphereAndFog(view, weather, timeOfDay, timeHour);

    if (viewChanged || weatherChanged || sizeChanged) {
      Object.assign(this.scratchFlashedView, view);
      this.scratchFlashedView.fogColor = effectiveFogHex;
      this.weatherSystem.configure(
        this.scratchFlashedView,
        weather,
        state.gridWidth,
        state.gridDepth,
      );
    } else if (timeChanged) {
      // Smoothly tint fog mist in-place when dragging the 24h Time Slider (zero rebuild)
      this.weatherSystem.setMistColor(effectiveFogHex, weather.skyTint);
    }
  }

  private syncYardLife(
    state: HouseState,
    view: SceneryViewDef,
    weather: WeatherDef,
    timeHour: number,
  ): void {
    const nextSig = computeYardLayoutSignature(state, this.data, view.id);
    if (nextSig === this.currentYardSig) return;
    this.currentYardSig = nextSig;

    if (this.yardLife) {
      this.sceneManager.scene.remove(this.yardLife.root);
      this.yardLife.dispose();
      this.yardLife = null;
    }

    this.yardLife = buildYardLife(state, this.data, view);
    if (this.yardLife) {
      this.sceneManager.scene.add(this.yardLife.root);
      this.yardLife.update(this.elapsed, 0, weather, timeHour);
    }
  }

  private computeTimedFogHex(view: SceneryViewDef, hour: number): string {
    const h = ((hour % 24) + 24) % 24;
    this.workingFogColor.set(view.fogColor);

    if (h < 4.8) {
      this.workingFogColor.lerp(COL_MIDNIGHT_FOG, 0.86);
    } else if (h < 6.6) {
      const t = THREE.MathUtils.smoothstep(h, 4.8, 6.6);
      this.workingColor.copy(COL_MIDNIGHT_FOG).lerp(COL_DAWN_FOG, t);
      this.workingFogColor.lerp(this.workingColor, 0.86 - t * 0.36);
    } else if (h < 9.2) {
      const t = THREE.MathUtils.smoothstep(h, 6.6, 9.2);
      this.workingColor.copy(COL_DAWN_FOG).lerp(COL_MORNING_FOG, t);
      this.workingFogColor.lerp(this.workingColor, 0.5 * (1 - t));
    } else if (h <= 16.5) {
      // Pure daylight view fog color
    } else if (h < 18.6) {
      const t = THREE.MathUtils.smoothstep(h, 16.5, 18.6);
      this.workingFogColor.lerp(COL_SUNSET_FOG, t * 0.58);
    } else if (h < 20.4) {
      const t = THREE.MathUtils.smoothstep(h, 18.6, 20.4);
      this.workingColor.copy(COL_SUNSET_FOG).lerp(COL_DUSK_FOG, t);
      this.workingFogColor.lerp(this.workingColor, 0.58 + t * 0.24);
    } else {
      const t = THREE.MathUtils.smoothstep(h, 20.4, 21.8);
      this.workingColor.copy(COL_DUSK_FOG).lerp(COL_NIGHT_FOG, t);
      this.workingFogColor.lerp(this.workingColor, 0.82 + t * 0.04);
    }

    return `#${this.workingFogColor.getHexString()}`;
  }

  private applyAtmosphereAndFog(
    view: SceneryViewDef,
    weather: WeatherDef,
    timeOfDay: TimeOfDay,
    timeHour: number,
  ): string {
    this.sceneManager.applyAtmosphere(view, weather, timeOfDay, timeHour);

    const timedFogHex = this.computeTimedFogHex(view, timeHour);
    this.workingFogTint.set(weather.skyTint);
    const isNightish = timeHour >= 20.0 || timeHour <= 5.2;
    if (isNightish) {
      this.workingFogTint.lerp(WHITE_TINT, 0.45);
    }
    this.baseSkyColor.set(timedFogHex).multiply(this.workingFogTint);

    if (weather.fogDensity > 0) {
      if (this.sceneManager.scene.fog instanceof THREE.FogExp2) {
        this.sceneManager.scene.fog.color.copy(this.baseSkyColor);
        this.sceneManager.scene.fog.density = weather.fogDensity;
      } else {
        this.sceneManager.scene.fog = new THREE.FogExp2(
          this.baseSkyColor.getHex(),
          weather.fogDensity,
        );
      }
    } else {
      this.sceneManager.scene.fog = null;
    }

    return timedFogHex;
  }

  private applyLightningFlashVisual(intensity: number): void {
    const view = this.getActiveView();
    const weather = this.getActiveWeather();
    const timeOfDay = this.getActiveTimeOfDay();
    const timeHour = this.getActiveTimeHour();

    this.backdrop?.setLightning(intensity);

    if (intensity <= 0) {
      this.applyAtmosphereAndFog(view, weather, timeOfDay, timeHour);
      return;
    }

    const boost = timeOfDay === 'night' ? 4.2 : timeOfDay === 'sunset' ? 2.4 : 1.7;
    this.workingColor.set(weather.skyTint).lerp(this.flashSkyColor, intensity);
    this.workingFogColor
      .set(this.computeTimedFogHex(view, timeHour))
      .lerp(this.flashSkyColor, intensity * 0.72);

    Object.assign(this.scratchFlashedWeather, weather);
    this.scratchFlashedWeather.skyTint = `#${this.workingColor.getHexString()}`;
    this.scratchFlashedWeather.lightMultiplier = weather.lightMultiplier + intensity * boost;

    Object.assign(this.scratchFlashedView, view);
    this.scratchFlashedView.fogColor = `#${this.workingFogColor.getHexString()}`;
    this.scratchFlashedView.sunColor = '#EEF5FF';
    this.scratchFlashedView.ambientColor = '#E6F0FF';

    this.sceneManager.applyAtmosphere(
      this.scratchFlashedView,
      this.scratchFlashedWeather,
      timeOfDay,
      timeHour,
    );
    if (this.sceneManager.scene.fog instanceof THREE.FogExp2) {
      this.sceneManager.scene.fog.color
        .copy(this.baseSkyColor)
        .lerp(this.flashSkyColor, intensity * 0.82);
    }
  }

  update(dt: number): void {
    this.elapsed += dt;
    const weather = this.getActiveWeather();
    if (this.backdrop) {
      const cam = this.sceneManager.isoCamera.camera;
      cam.getWorldDirection(this.cameraForward);
      this.backdrop.update(this.elapsed, dt, weather, cam.position, this.cameraForward);
    }
    if (this.yardLife) {
      this.yardLife.update(this.elapsed, dt, weather, this.getActiveTimeHour());
    }
    this.weatherSystem.update(dt);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.weatherSystem.dispose();
    this.sceneManager.scene.remove(this.weatherSystem.root);
    if (this.yardLife) {
      this.sceneManager.scene.remove(this.yardLife.root);
      this.yardLife.dispose();
      this.yardLife = null;
    }
    if (this.backdrop) {
      this.sceneManager.scene.remove(this.backdrop.root);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    this.sceneManager.scene.fog = null;
  }
}
