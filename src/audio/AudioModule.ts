import type { VoiceProfile, WeatherDef } from '../data/schemas';
import { speakGibberishLine } from '../dialogue/GibberishVoice';
import type { HouseStore } from '../state/houseStore';
import { FoleySynth } from './FoleySynth';
import {
  MUSIC_THEME_LABELS,
  MusicPlayer,
  resolveMusicTheme,
  type MusicStateSnapshot,
  type MusicThemeId,
} from './MusicPlayer';
import { WeatherAmbience } from './WeatherAmbience';

export { MUSIC_THEME_LABELS, resolveMusicTheme, type MusicStateSnapshot, type MusicThemeId };

const DEFAULT_VOLUME = 0.85;
const DEFAULT_WEATHER_VOLUME = 0.75;
const DEFAULT_CHATTER_VOLUME = 0.28;
const MASTER_VOLUME_STORAGE_KEY = 'cozyhouse:vol:master';
const MASTER_MUTED_STORAGE_KEY = 'cozyhouse:vol:muted';
const WEATHER_VOLUME_STORAGE_KEY = 'cozyhouse:vol:weather';
const CHATTER_VOLUME_STORAGE_KEY = 'cozyhouse:chatterVolume';
const MAX_PENDING_CALLBACKS = 3;
const PENDING_TTL_MS = 1500;
const MUSIC_RELEVANT_REASONS = new Set([
  'scenery',
  'place',
  'delete',
  'bulkDelete',
  'clear',
  'preset',
  'roomOverride',
  'interact',
  'sim-interact',
  'undo',
  'redo',
  'load',
]);
const GESTURE_EVENTS = [
  'pointerdown',
  'pointerup',
  'keydown',
  'click',
  'touchstart',
  'touchend',
] as const;

type AudioOutputCallback = (ctx: AudioContext, dest: AudioNode) => void;

interface QueuedAudioCallback {
  fn: AudioOutputCallback;
  queuedAt: number;
  /** A cutscene's own sound: bypasses the world bus. */
  scene: boolean;
}

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NavigatorWithActivation = Navigator & {
  userActivation?: { hasBeenActive?: boolean };
};

function clampVolume(value: number, fallback = DEFAULT_VOLUME): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function readStoredMasterVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_VOLUME;
    const raw = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed, DEFAULT_VOLUME) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function writeStoredMasterVolume(volume: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, clampVolume(volume, DEFAULT_VOLUME).toFixed(3));
  } catch {
    // Ignore storage errors
  }
}

function readStoredMuted(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(MASTER_MUTED_STORAGE_KEY);
    return raw === 'true' || raw === '1';
  } catch {
    return false;
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MASTER_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

function readStoredWeatherVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_WEATHER_VOLUME;
    const raw = localStorage.getItem(WEATHER_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_WEATHER_VOLUME;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed, DEFAULT_WEATHER_VOLUME) : DEFAULT_WEATHER_VOLUME;
  } catch {
    return DEFAULT_WEATHER_VOLUME;
  }
}

function writeStoredWeatherVolume(volume: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(WEATHER_VOLUME_STORAGE_KEY, clampVolume(volume, DEFAULT_WEATHER_VOLUME).toFixed(3));
  } catch {
    // Ignore storage errors
  }
}

function readStoredChatterVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_CHATTER_VOLUME;
    const raw = localStorage.getItem(CHATTER_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_CHATTER_VOLUME;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed, DEFAULT_CHATTER_VOLUME) : DEFAULT_CHATTER_VOLUME;
  } catch {
    return DEFAULT_CHATTER_VOLUME;
  }
}

function writeStoredChatterVolume(volume: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHATTER_VOLUME_STORAGE_KEY, clampVolume(volume, DEFAULT_CHATTER_VOLUME).toFixed(3));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Web Audio facade for Cozyhouse: procedural foley SFX, item interactions,
 * independent weather ambience & themed music channels, room celebration chimes,
 * master volume control, and gibberish visitor speech.
 */
/**
 * A gain stage in front of `dest`, so the Hollow Purple layers sit on top of the 30 s clip instead
 * of under it (they rendered 10–17 dB quieter than its music). The master limiter catches peaks.
 */
function boosted(ctx: BaseAudioContext, dest: AudioNode, gain: number): AudioNode {
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(dest);
  return g;
}

export class AudioModule {
  private muted = false;
  private volume = DEFAULT_VOLUME;
  private weatherVolume = DEFAULT_WEATHER_VOLUME;
  private chatterVolume = DEFAULT_CHATTER_VOLUME;
  private disposed = false;
  private hasUserGesture = false;
  private resumeInFlight = false;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** Everything that is not a cutscene's own sound: foley, voices, UI, weather. */
  private worldGain: GainNode | null = null;
  private cutsceneAudio = false;
  private musicDucked = false;
  private weatherGain: GainNode | null = null;
  private chatterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  private readonly foley = new FoleySynth();
  private readonly weatherAmbience = new WeatherAmbience();
  private readonly musicPlayer = new MusicPlayer({
    onPlayBlocked: () => {
      if (!this.disposed) {
        this.bindGestureUnlock();
      }
    },
  });
  private activeWeather: WeatherDef | null = null;
  private activeSceneryViewId = 'suburbs';

  private readonly muteListeners = new Set<(muted: boolean) => void>();
  private readonly volumeListeners = new Set<(volume: number) => void>();
  private readonly weatherVolumeListeners = new Set<(volume: number) => void>();
  private readonly chatterVolumeListeners = new Set<(volume: number) => void>();
  private readonly storeCleanups = new Set<() => void>();
  private readonly pendingCallbacks: QueuedAudioCallback[] = [];
  private gestureListenersBound = false;

  constructor() {
    this.volume = readStoredMasterVolume();
    this.muted = readStoredMuted();
    this.weatherVolume = readStoredWeatherVolume();
    this.chatterVolume = readStoredChatterVolume();
    this.musicPlayer.setMasterVolume(this.volume, this.muted);
    this.bindGestureUnlock();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    const next = Boolean(muted);
    const muteChanged = this.muted !== next;
    this.muted = next;
    writeStoredMuted(this.muted);

    let volumeChanged = false;
    if (!next && this.volume <= 0.001) {
      this.volume = DEFAULT_VOLUME;
      writeStoredMasterVolume(this.volume);
      volumeChanged = true;
    }

    if (!next) {
      this.ensureContextAndResume();
    }
    this.applyMasterGain();

    if (muteChanged) {
      for (const listener of this.muteListeners) {
        listener(this.muted);
      }
    }
    if (volumeChanged) {
      for (const listener of this.volumeListeners) {
        listener(this.volume);
      }
    }
  }

  onMuteChange(listener: (muted: boolean) => void): () => void {
    this.muteListeners.add(listener);
    return () => {
      this.muteListeners.delete(listener);
    };
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    const next = clampVolume(volume);
    const volumeChanged = Math.abs(this.volume - next) > 0.0005;
    this.volume = next;
    writeStoredMasterVolume(this.volume);

    let muteChanged = false;
    if (next > 0 && this.muted) {
      this.muted = false;
      writeStoredMuted(false);
      muteChanged = true;
    }

    if (next > 0) {
      this.ensureContextAndResume();
    }
    this.applyMasterGain();

    if (muteChanged) {
      for (const listener of this.muteListeners) {
        listener(this.muted);
      }
    }
    if (volumeChanged) {
      for (const listener of this.volumeListeners) {
        listener(this.volume);
      }
    }
  }

  onVolumeChange(listener: (volume: number) => void): () => void {
    this.volumeListeners.add(listener);
    return () => {
      this.volumeListeners.delete(listener);
    };
  }

  isMusicEnabled(): boolean {
    return this.musicPlayer.isEnabled();
  }

  setMusicEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    this.musicPlayer.setEnabled(next);
    if (next) {
      this.ensureContextAndResume();
    }
  }

  getMusicTheme(): MusicThemeId {
    return this.musicPlayer.getTheme();
  }

  onMusicChange(listener: (state: { enabled: boolean; theme: MusicThemeId }) => void): () => void {
    return this.musicPlayer.onChange(listener);
  }

  getWeatherVolume(): number {
    return this.weatherVolume;
  }

  setWeatherVolume(vol: number): void {
    const next = clampVolume(vol, DEFAULT_WEATHER_VOLUME);
    const changed = Math.abs(this.weatherVolume - next) > 0.0005;
    this.weatherVolume = next;
    writeStoredWeatherVolume(next);

    if (next > 0.001) {
      this.ensureContextAndResume();
    }
    this.applyWeatherGain();

    if (changed) {
      for (const listener of this.weatherVolumeListeners) {
        listener(this.weatherVolume);
      }
    }
  }

  onWeatherVolumeChange(cb: (vol: number) => void): () => void {
    this.weatherVolumeListeners.add(cb);
    return () => {
      this.weatherVolumeListeners.delete(cb);
    };
  }

  getChatterVolume(): number {
    return this.chatterVolume;
  }

  setChatterVolume(vol: number): void {
    const next = clampVolume(vol, DEFAULT_CHATTER_VOLUME);
    const changed = Math.abs(this.chatterVolume - next) > 0.0005;
    this.chatterVolume = next;
    writeStoredChatterVolume(next);

    if (next > 0.001) {
      this.ensureContextAndResume();
    }
    this.applyChatterGain();

    if (changed) {
      for (const listener of this.chatterVolumeListeners) {
        listener(this.chatterVolume);
      }
    }
  }

  onChatterVolumeChange(cb: (volume: number) => void): () => void {
    this.chatterVolumeListeners.add(cb);
    return () => {
      this.chatterVolumeListeners.delete(cb);
    };
  }

  getMusicVolume(): number {
    return this.musicPlayer.getMusicVolume();
  }

  setMusicVolume(vol: number): void {
    const next = clampVolume(vol, 0.65);
    this.musicPlayer.setMusicVolume(next);
    if (next > 0.001) {
      this.ensureContextAndResume();
    }
  }

  onMusicVolumeChange(cb: (vol: number) => void): () => void {
    return this.musicPlayer.onVolumeChange(cb);
  }

  attachStore(store: HouseStore): () => void {
    const initialState = store.getState();
    let lastWeatherId = initialState.weatherId;
    this.activeSceneryViewId = initialState.sceneryViewId;
    const initialWeather = store.data.weathersById.get(lastWeatherId);
    if (initialWeather) {
      this.setWeatherAmbience(initialWeather);
    } else if (this.activeSceneryViewId === 'backrooms') {
      this.syncWeatherAmbience();
    }
    this.musicPlayer.setTheme(resolveMusicTheme(initialState, store.data));

    const unsubHouse = store.on('houseChanged', ({ state, reason }) => {
      if (this.disposed) return;

      if (reason === 'place') {
        this.playPlace();
      } else if (reason === 'delete') {
        this.playRemove();
      } else if (reason === 'move') {
        this.playMove();
      } else if (reason === 'lights') {
        const toggleLights = state.items.filter((it) => {
          const def = store.data.itemsById.get(it.itemId);
          return def?.interaction?.type === 'toggle' && def.tags.includes('light');
        });
        if (toggleLights.length > 0) {
          const anyOn = toggleLights.some((it) => Boolean(it.active));
          this.playInteract('table_lamp', ['light'], anyOn);
        }
      }
      // Note: 'timeOfDay' stays quiet/ambient without spurious placement SFX.

      const sceneryChanged = state.sceneryViewId !== this.activeSceneryViewId;
      if (sceneryChanged) {
        this.activeSceneryViewId = state.sceneryViewId;
      }

      if (state.weatherId !== lastWeatherId) {
        lastWeatherId = state.weatherId;
        const nextWeather = store.data.weathersById.get(state.weatherId);
        if (nextWeather) {
          this.setWeatherAmbience(nextWeather);
        } else if (sceneryChanged) {
          this.syncWeatherAmbience();
        }
      } else if (sceneryChanged) {
        this.syncWeatherAmbience();
      }

      if (MUSIC_RELEVANT_REASONS.has(reason)) {
        this.musicPlayer.setTheme(resolveMusicTheme(state, store.data));
      }
    });

    const unsubInteract = store.on('itemInteracted', ({ item }) => {
      if (this.disposed) return;
      const def = store.data.itemsById.get(item.itemId);
      this.playInteract(item.itemId, def?.tags, item.active);
    });

    const cleanup = () => {
      unsubHouse();
      unsubInteract();
      this.storeCleanups.delete(cleanup);
    };

    this.storeCleanups.add(cleanup);
    return cleanup;
  }

  playPlace(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playPlace(ctx, dest));
  }

  playRemove(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playRemove(ctx, dest));
  }

  playMove(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playMove(ctx, dest));
  }

  playRotate(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playRotate(ctx, dest));
  }

  playUiClick(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playUiClick(ctx, dest));
  }

  playInteract(itemId: string, tags?: string[], active?: boolean): void {
    this.withAudioOutput((ctx, dest) => this.foley.playInteract(ctx, dest, itemId, tags, active));
  }

  playCelebration(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playCelebration(ctx, dest));
  }

  playThunder(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playThunder(ctx, this.weatherGain ?? dest));
  }

  playBotChirp(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playBotChirp(ctx, dest));
  }

  playChickenSqueak(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playChickenSqueak(ctx, dest));
  }

  playPortalWarp(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playPortalWarp(ctx, dest));
  }

  playComicKick(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playComicKick(ctx, dest));
  }

  playGojoAscend(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playGojoAscend(ctx, dest));
  }

  /** Fades the background music out for a cutscene (true) and back in afterwards (false). */
  setMusicDucked(ducked: boolean): void {
    this.musicDucked = ducked;
    this.musicPlayer.setDuck(this.musicDucked || this.cutsceneAudio ? 0 : 1);
  }

  /**
   * Cutscene audio. While on, only the scene's own sounds are heard: music is ducked, the world
   * bus (item, door, UI and visitor sounds, chatter, weather, thunder) eases to silence over
   * about 0.3 s, and new non-scene sounds are dropped instead of being played into the gate.
   * Scene sounds use `withSceneOutput`, straight to the master gain, so the player's volume and
   * mute still apply to them.
   */
  setCutsceneAudio(on: boolean): void {
    this.cutsceneAudio = Boolean(on);
    this.musicPlayer.setDuck(this.musicDucked || this.cutsceneAudio ? 0 : 1);
    this.applyWorldGain();
  }

  isCutsceneAudio(): boolean {
    return this.cutsceneAudio;
  }

  playShowdownStab(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownStab(ctx, dest));
  }

  /** One swell of the charging hum; `level` 0..1 raises its pitch. */
  playShowdownCharge(level: number): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownCharge(ctx, boosted(ctx, dest, 2), level));
  }

  playShowdownBlue(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownBlue(ctx, boosted(ctx, dest, 3)));
  }

  playShowdownRed(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownRed(ctx, boosted(ctx, dest, 4)));
  }

  playShowdownMerge(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownMerge(ctx, boosted(ctx, dest, 2.5)));
  }

  playShowdownCrackle(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownCrackle(ctx, boosted(ctx, dest, 3)));
  }

  playShowdownExplosion(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownExplosion(ctx, dest));
  }

  playShowdownHit(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownHit(ctx, dest));
  }

  playShowdownFire(): void {
    this.withSceneOutput((ctx, dest) => this.foley.playShowdownFire(ctx, boosted(ctx, dest, 1.5)));
  }

  playRockyChords(): void {
    this.withAudioOutput((ctx, dest) => this.foley.playRockyChords(ctx, dest));
  }

  playGibberishLine(
    text: string,
    voice: VoiceProfile,
    pitchOffset = 1,
    speedMultiplier = 1,
  ): void {
    if (this.chatterVolume <= 0.001) return;
    this.withAudioOutput((ctx, dest) => {
      if (this.chatterVolume <= 0.001) return;
      try {
        speakGibberishLine(ctx, this.chatterGain ?? dest, text, voice, pitchOffset, speedMultiplier);
      } catch {
        // Never propagate audio synthesis errors to caller
      }
    });
  }

  // [horror-events hook] Lets src/events/HorrorDirector.ts play its own Web Audio score through the
  // master gain (master volume + mute apply) and a rain layer through the weather gain.
  getEventAudioOutput(): { ctx: AudioContext; master: AudioNode; weather: AudioNode } | null {
    if (!this.ensureContextAndResume() || !this.ctx || !this.masterGain || !this.weatherGain) return null;
    return { ctx: this.ctx, master: this.masterGain, weather: this.weatherGain };
  }

  setMusicSuspended(suspended: boolean): void {
    this.musicPlayer.setSuspended(suspended);
  }

  setWeatherAmbience(weather: WeatherDef): void {
    this.activeWeather = weather;
    if (this.disposed) return;

    this.ensureContextAndResume();
    this.syncWeatherAmbience();
  }

  private syncWeatherAmbience(): void {
    if (this.disposed || !this.ctx || !this.weatherGain || this.ctx.state !== 'running') return;
    if (this.activeSceneryViewId === 'backrooms') {
      this.weatherAmbience.setBackroomsHum(this.ctx, this.weatherGain, true);
    } else {
      this.weatherAmbience.setBackroomsHum(this.ctx, this.weatherGain, false, this.activeWeather);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unbindGestureUnlock();

    for (const cleanup of Array.from(this.storeCleanups)) {
      cleanup();
    }
    this.storeCleanups.clear();
    this.muteListeners.clear();
    this.volumeListeners.clear();
    this.weatherVolumeListeners.clear();
    this.chatterVolumeListeners.clear();
    this.pendingCallbacks.length = 0;

    this.weatherAmbience.dispose();
    this.musicPlayer.dispose();

    if (this.chatterGain) {
      try {
        this.chatterGain.disconnect();
      } catch {
        // Ignore
      }
      this.chatterGain = null;
    }

    if (this.weatherGain) {
      try {
        this.weatherGain.disconnect();
      } catch {
        // Ignore
      }
      this.weatherGain = null;
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // Ignore
      }
      this.masterGain = null;
    }

    if (this.limiter) {
      try {
        this.limiter.disconnect();
      } catch {
        // Ignore
      }
      this.limiter = null;
    }

    if (this.ctx) {
      this.ctx.onstatechange = null;
      try {
        void this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
    }
  }

  private applyMasterGain(): void {
    this.musicPlayer.setMasterVolume(this.volume, this.muted);
    if (!this.ctx || !this.masterGain || this.disposed) return;
    const target = this.muted ? 0 : this.volume;
    try {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.setTargetAtTime(target, now, 0.025);
    } catch {
      // Ignore if AudioContext is closing
    }
  }

  private applyWorldGain(): void {
    if (!this.ctx || !this.worldGain || this.disposed) return;
    try {
      const now = this.ctx.currentTime;
      this.worldGain.gain.cancelScheduledValues(now);
      this.worldGain.gain.setValueAtTime(this.worldGain.gain.value, now);
      this.worldGain.gain.setTargetAtTime(this.cutsceneAudio ? 0 : 1, now, 0.1);
    } catch {
      // Ignore if AudioContext is closing
    }
  }

  private applyWeatherGain(): void {
    if (!this.ctx || !this.weatherGain || this.disposed) return;
    try {
      const now = this.ctx.currentTime;
      this.weatherGain.gain.cancelScheduledValues(now);
      this.weatherGain.gain.setValueAtTime(this.weatherGain.gain.value, now);
      this.weatherGain.gain.setTargetAtTime(this.weatherVolume, now, 0.025);
    } catch {
      // Ignore if AudioContext is closing
    }
  }

  private applyChatterGain(): void {
    if (!this.ctx || !this.chatterGain || this.disposed) return;
    try {
      const now = this.ctx.currentTime;
      this.chatterGain.gain.cancelScheduledValues(now);
      this.chatterGain.gain.setValueAtTime(this.chatterGain.gain.value, now);
      this.chatterGain.gain.setTargetAtTime(this.chatterVolume, now, 0.025);
    } catch {
      // Ignore if AudioContext is closing
    }
  }

  private readonly handleUserGesture = (): void => {
    if (this.disposed) return;
    this.hasUserGesture = true;
    this.ensureContextAndResume();
  };

  private bindGestureUnlock(): void {
    if (this.gestureListenersBound || typeof window === 'undefined') return;
    this.gestureListenersBound = true;
    for (const eventName of GESTURE_EVENTS) {
      window.addEventListener(eventName, this.handleUserGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  private unbindGestureUnlock(): void {
    if (!this.gestureListenersBound || typeof window === 'undefined') return;
    this.gestureListenersBound = false;
    for (const eventName of GESTURE_EVENTS) {
      window.removeEventListener(eventName, this.handleUserGesture, {
        capture: true,
      });
    }
  }

  private checkUserActivation(): boolean {
    if (this.hasUserGesture) return true;
    if (typeof navigator !== 'undefined') {
      const nav = navigator as NavigatorWithActivation;
      if (nav.userActivation?.hasBeenActive) {
        this.hasUserGesture = true;
        return true;
      }
    }
    return false;
  }

  private ensureContextAndResume(): boolean {
    if (this.disposed || typeof window === 'undefined') return false;
    if (!this.ctx && !this.checkUserActivation()) return false;

    // Unlock HTMLAudio music synchronously inside the active user gesture
    if (this.checkUserActivation()) {
      this.musicPlayer.unlock();
    }

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!AudioCtx) return false;

      try {
        const ctx = new AudioCtx();
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, ctx.currentTime);

        const worldGain = ctx.createGain();
        worldGain.gain.setValueAtTime(this.cutsceneAudio ? 0 : 1, ctx.currentTime);

        const weatherGain = ctx.createGain();
        weatherGain.gain.setValueAtTime(this.weatherVolume, ctx.currentTime);

        const chatterGain = ctx.createGain();
        chatterGain.gain.setValueAtTime(this.chatterVolume, ctx.currentTime);

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.setValueAtTime(-6, ctx.currentTime);
        limiter.knee.setValueAtTime(8, ctx.currentTime);
        limiter.ratio.setValueAtTime(6, ctx.currentTime);
        limiter.attack.setValueAtTime(0.003, ctx.currentTime);
        limiter.release.setValueAtTime(0.12, ctx.currentTime);

        weatherGain.connect(worldGain);
        chatterGain.connect(worldGain);
        worldGain.connect(masterGain);
        masterGain.connect(limiter);
        limiter.connect(ctx.destination);

        ctx.onstatechange = () => {
          if (this.disposed || this.ctx !== ctx) return;
          if (ctx.state === 'running') {
            this.onAudioUnlocked();
          } else if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
            // Re-bind gesture unlock so returning from backgrounded tabs resumes seamlessly
            this.bindGestureUnlock();
          }
        };

        this.ctx = ctx;
        this.masterGain = masterGain;
        this.worldGain = worldGain;
        this.weatherGain = weatherGain;
        this.chatterGain = chatterGain;
        this.limiter = limiter;
      } catch {
        return false;
      }
    }

    const ctx = this.ctx;
    if (!ctx) return false;

    if (ctx.state === 'running') {
      this.onAudioUnlocked();
      return true;
    }

    if ((ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') && !this.resumeInFlight) {
      this.resumeInFlight = true;
      ctx
        .resume()
        .then(() => {
          this.resumeInFlight = false;
          if (!this.disposed && this.ctx?.state === 'running') {
            this.onAudioUnlocked();
          }
        })
        .catch(() => {
          this.resumeInFlight = false;
        });
    }

    return false;
  }

  private onAudioUnlocked(): void {
    if (this.disposed || !this.ctx || !this.masterGain || !this.weatherGain) return;
    if (this.ctx.state !== 'running') return;

    if (!this.musicPlayer.isPlayBlocked()) {
      this.unbindGestureUnlock();
    }
    this.applyMasterGain();
    this.applyWeatherGain();
    this.applyChatterGain();

    this.syncWeatherAmbience();

    this.flushPendingCallbacks();
  }

  private flushPendingCallbacks(): void {
    if (this.disposed || !this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    if (this.pendingCallbacks.length === 0) return;

    const nowMs = Date.now();
    const queued = this.pendingCallbacks.splice(0, this.pendingCallbacks.length);
    for (const entry of queued) {
      if (nowMs - entry.queuedAt > PENDING_TTL_MS) continue;
      if (!entry.scene && this.cutsceneAudio) continue;
      try {
        entry.fn(this.ctx, entry.scene ? this.masterGain : (this.worldGain ?? this.masterGain));
      } catch {
        // Keep audio completely fail-safe
      }
    }
  }

  /** A cutscene's own sound: never gated by the cutscene flag. */
  private withSceneOutput(fn: AudioOutputCallback): void {
    this.withAudioOutput(fn, true);
  }

  private withAudioOutput(fn: AudioOutputCallback, scene = false): void {
    if (this.disposed) return;
    // During a cutscene every non-scene sound is simply not played.
    if (this.cutsceneAudio && !scene) return;

    if (this.ensureContextAndResume() && this.ctx && this.masterGain && this.ctx.state === 'running') {
      try {
        fn(this.ctx, scene ? this.masterGain : (this.worldGain ?? this.masterGain));
      } catch {
        // Keep audio completely fail-safe
      }
      return;
    }

    // AudioContext is created and suspended (e.g. first gesture resume in flight): queue briefly
    if (this.ctx && this.masterGain && this.ctx.state !== 'closed') {
      this.pendingCallbacks.push({ fn, queuedAt: Date.now(), scene });
      while (this.pendingCallbacks.length > MAX_PENDING_CALLBACKS) {
        this.pendingCallbacks.shift();
      }
    }
  }
}
