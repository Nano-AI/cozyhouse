import type { GameDataBundle, HouseState } from '../data/schemas';
import { evaluateRoomType } from '../rooms/RoomEvaluator';

export type MusicThemeId = 'cafe' | 'party' | 'farm' | 'beach' | 'forest';

export const MUSIC_THEME_LABELS: Record<MusicThemeId, string> = {
  cafe: 'Café',
  party: 'House',
  farm: 'Farm',
  beach: 'Beach',
  forest: 'Forest',
};

export interface MusicStateSnapshot {
  enabled: boolean;
  theme: MusicThemeId;
}

const MUSIC_STORAGE_KEY = 'cozyhouse:music';
const MUSIC_VOLUME_STORAGE_KEY = 'cozyhouse:vol:music';
export const DEFAULT_MUSIC_VOLUME = 0.65;
const MUSIC_GAIN_SCALE = 0.55;
const CROSSFADE_MS = 1200;
const DUCK_FADE_MS = 700;
const DISABLE_FADE_MS = 450;
const FADE_TICK_MS = 50;

/**
 * Resolves the active cozy background music theme from room type + scenery biome.
 */
export function resolveMusicTheme(state: HouseState, data: GameDataBundle): MusicThemeId {
  const evaluation = evaluateRoomType(state, data);
  const roomId = evaluation.labelInfo.id.toLowerCase();
  const roomLabel = evaluation.labelInfo.label.toLowerCase();
  const viewId = state.sceneryViewId;

  const hasActivePartyHub = state.items.some(
    (it) => it.active && (it.itemId === 'dj_booth' || it.itemId === 'disco_ball'),
  );

  // 1. Party / club / dance / nightlife rooms (or active DJ booth / disco ball in City)
  const isPartyRoom =
    roomId === 'party_pad' ||
    roomId === 'night_lounge' ||
    roomId === 'bar' ||
    roomId === 'live_in_bar' ||
    roomId === 'music_lounge' ||
    /\b(party|club|dance|nightlife|night lounge|disco|rave|bar)\b/.test(roomLabel);

  if (isPartyRoom || (hasActivePartyHub && viewId === 'city')) {
    return 'party';
  }

  // 2. Beach biome (unless party)
  if (viewId === 'beach') {
    return 'beach';
  }

  // 3. Cat lounge / conservatory / woodland rooms, or forest biome (unless party)
  const isForestRoom =
    roomId === 'cat_sanctuary' ||
    roomId === 'cat_cafe' ||
    roomId === 'plant_haven' ||
    /\b(cat|conservatory|woodland|forest|botanical|plant)\b/.test(roomLabel);

  if (isForestRoom || viewId === 'forest') {
    return 'forest';
  }

  // 4. Explicit café / coffee rooms stay 'cafe' even in countryside / mountains
  //    (note: a cabin/farmhouse with a kettle + bed & cooking gear still counts as 'farm'!)
  const cookCount = evaluation.tagCounts.cook ?? 0;
  const isCafeRoom =
    roomId === 'cafe' ||
    roomId === 'book_cafe' ||
    roomId === 'smoothie_bar' ||
    (roomId === 'live_in_cafe' && cookCount < 2) ||
    (evaluation.isOverride && /\b(café|cafe|coffee|espresso)\b/.test(roomLabel));

  // 5. Kitchen / bakery / diner / farmhouse, or countryside / mountains biome (unless party/cafe)
  const isFarmRoom =
    roomId === 'home_kitchen' ||
    roomId === 'diner' ||
    roomId === 'neighborhood_diner' ||
    /\b(kitchen|bakery|diner|farm|farmhouse|cabin|ranch|cottage)\b/.test(roomLabel);

  if (isFarmRoom || (!isCafeRoom && (viewId === 'countryside' || viewId === 'mountains'))) {
    return 'farm';
  }

  // 6. Café / coffee / reading / home / lounge / default
  return 'cafe';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function readStoredMusicEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(MUSIC_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

function writeStoredMusicEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MUSIC_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors (private browsing / headless)
  }
}

function readStoredMusicVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_MUSIC_VOLUME;
    const raw = localStorage.getItem(MUSIC_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_MUSIC_VOLUME;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clamp01(parsed) : DEFAULT_MUSIC_VOLUME;
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

function writeStoredMusicVolume(volume: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MUSIC_VOLUME_STORAGE_KEY, clamp01(volume).toFixed(3));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Lazy HTMLAudioElement music manager with smooth crossfading across Cozyhouse themes,
 * independent music volume, autoplay-safe gesture unlocking, localStorage persistence,
 * and clean disposal.
 */
export class MusicPlayer {
  private enabled: boolean;
  private currentTheme: MusicThemeId = 'cafe';
  private masterVolume = 0.85;
  private musicVolume: number;
  private muted = false;
  private unlocked = false;
  private playBlocked = false;
  private disposed = false;

  private readonly elements = new Map<MusicThemeId, HTMLAudioElement>();
  private readonly trackLevels = new Map<MusicThemeId, number>();
  private readonly listeners = new Set<(state: MusicStateSnapshot) => void>();
  private readonly volumeListeners = new Set<(volume: number) => void>();
  private readonly onPlayBlocked?: () => void;

  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  /** Cutscene duck multiplier (1 = normal, 0 = silent), eased toward duckTarget by the fade loop. */
  private duck = 1;
  private duckTarget = 1;

  constructor(options?: { onPlayBlocked?: () => void }) {
    this.enabled = readStoredMusicEnabled();
    this.musicVolume = readStoredMusicVolume();
    this.onPlayBlocked = options?.onPlayBlocked;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTheme(): MusicThemeId {
    return this.currentTheme;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  isPlayBlocked(): boolean {
    return this.playBlocked;
  }

  onChange(listener: (state: MusicStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onVolumeChange(listener: (volume: number) => void): () => void {
    this.volumeListeners.add(listener);
    return () => {
      this.volumeListeners.delete(listener);
    };
  }

  setEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    const enabledChanged = this.enabled !== next;
    let volumeChanged = false;

    this.enabled = next;
    if (next && this.musicVolume <= 0.001) {
      this.musicVolume = DEFAULT_MUSIC_VOLUME;
      writeStoredMusicVolume(this.musicVolume);
      volumeChanged = true;
    }

    if (enabledChanged) {
      writeStoredMusicEnabled(next);
      this.emitChange();
    }
    if (volumeChanged) {
      this.emitVolumeChange();
    }

    if (this.disposed) return;

    if (next) {
      if (this.shouldPlayCurrent()) {
        this.ensureTrackPlaying(this.currentTheme);
      }
      this.applyElementVolumes();
      if (this.elements.size > 0) {
        this.startFadeLoop();
      }
    } else {
      this.playBlocked = false;
      this.startFadeLoop();
    }
  }

  setMusicVolume(volume: number): void {
    const next = clamp01(volume);
    const volumeChanged = Math.abs(this.musicVolume - next) > 0.0005;
    this.musicVolume = next;
    writeStoredMusicVolume(next);

    let enabledChanged = false;
    if (next > 0.001 && !this.enabled) {
      this.enabled = true;
      writeStoredMusicEnabled(true);
      enabledChanged = true;
    }

    if (enabledChanged) {
      this.emitChange();
    }
    if (volumeChanged) {
      this.emitVolumeChange();
    }

    if (this.disposed) return;

    if (this.shouldPlayCurrent()) {
      this.ensureTrackPlaying(this.currentTheme);
    }
    this.applyElementVolumes();
    if (this.elements.size > 0) {
      this.startFadeLoop();
    }
  }

  setTheme(theme: MusicThemeId): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    this.emitChange();

    if (this.disposed) return;

    if (this.shouldPlayCurrent()) {
      this.ensureTrackPlaying(theme);
    }
    if (this.elements.size > 0) {
      this.startFadeLoop();
    }
  }

  /** Fades the music down (0) or back up (1) without touching the player's volume settings. */
  setDuck(target: number): void {
    this.duckTarget = clamp01(target);
    if (this.disposed) return;
    this.startFadeLoop();
  }

  setMasterVolume(volume: number, muted: boolean): void {
    this.masterVolume = clamp01(volume);
    this.muted = Boolean(muted);

    if (this.disposed) return;

    if (this.shouldPlayCurrent()) {
      this.ensureTrackPlaying(this.currentTheme);
    }
    this.applyElementVolumes();
    if (this.elements.size > 0) {
      this.startFadeLoop();
    }
  }

  /**
   * Called synchronously inside a user gesture handler to safely satisfy browser autoplay rules.
   */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;

    if (!this.shouldPlayCurrent()) return;

    const currentEl = this.elements.get(this.currentTheme);
    const needsStart = !currentEl || currentEl.paused || this.playBlocked;
    if (needsStart) {
      this.ensureTrackPlaying(this.currentTheme);
      this.startFadeLoop();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFadeLoop();
    this.listeners.clear();
    this.volumeListeners.clear();

    for (const el of this.elements.values()) {
      try {
        el.pause();
        el.currentTime = 0;
        el.removeAttribute('src');
        el.load();
      } catch {
        // Ignore teardown errors in headless/mock environments
      }
    }
    this.elements.clear();
    this.trackLevels.clear();
  }

  // [horror-events hook] Fades theme music out (slowly) without touching the saved enabled setting.
  private suspended = false;

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (this.disposed) return;
    if (this.shouldPlayCurrent()) {
      this.ensureTrackPlaying(this.currentTheme);
    }
    if (this.elements.size > 0) {
      this.startFadeLoop();
    }
  }

  private shouldPlayCurrent(): boolean {
    return (
      !this.suspended &&
      !this.disposed &&
      this.unlocked &&
      this.enabled &&
      !this.muted &&
      this.masterVolume > 0.001 &&
      this.musicVolume > 0.001
    );
  }

  private getEffectiveGain(): number {
    if (!this.enabled || this.muted || this.masterVolume <= 0.001 || this.musicVolume <= 0.001) {
      return 0;
    }
    return clamp01(this.masterVolume * this.musicVolume * MUSIC_GAIN_SCALE * this.duck);
  }

  private getOrCreateElement(theme: MusicThemeId): HTMLAudioElement | null {
    if (this.disposed || typeof Audio === 'undefined') return null;

    const existing = this.elements.get(theme);
    if (existing) return existing;

    try {
      const el = new Audio();
      el.src = `./music/${theme}.mp3`;
      el.loop = true;
      el.preload = 'none';
      el.volume = 0;
      el.addEventListener('error', () => {
        // Silently ignore missing/corrupt audio file so gameplay stays error-free
      });
      this.elements.set(theme, el);
      if (!this.trackLevels.has(theme)) {
        this.trackLevels.set(theme, 0);
      }
      return el;
    } catch {
      return null;
    }
  }

  private ensureTrackPlaying(theme: MusicThemeId): void {
    const el = this.getOrCreateElement(theme);
    if (!el) return;

    if (!this.trackLevels.has(theme)) {
      this.trackLevels.set(theme, 0);
    }

    if (!el.paused && !this.playBlocked) return;

    try {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (!this.disposed) {
              this.playBlocked = false;
            }
          })
          .catch(() => {
            if (!this.disposed) {
              this.playBlocked = true;
              this.onPlayBlocked?.();
            }
          });
      } else {
        this.playBlocked = false;
      }
    } catch {
      this.playBlocked = true;
      this.onPlayBlocked?.();
    }
  }

  private startFadeLoop(): void {
    if (this.disposed || this.elements.size === 0) return;
    if (this.fadeTimer !== null) return;

    this.lastTickMs = Date.now();
    this.fadeTimer = setInterval(() => {
      this.stepFade();
    }, FADE_TICK_MS);
  }

  private stopFadeLoop(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private stepFade(): void {
    if (this.disposed) {
      this.stopFadeLoop();
      return;
    }

    const nowMs = Date.now();
    const dtMs = Math.max(10, Math.min(250, nowMs - this.lastTickMs));
    this.lastTickMs = nowMs;

    const playing = this.shouldPlayCurrent();
    const fadeDurationMs = playing ? CROSSFADE_MS : this.suspended ? 3500 : DISABLE_FADE_MS;
    const step = dtMs / fadeDurationMs;

    let anyMoving = false;

    if (this.duck !== this.duckTarget) {
      const duckStep = dtMs / DUCK_FADE_MS;
      this.duck =
        this.duck < this.duckTarget
          ? Math.min(this.duckTarget, this.duck + duckStep)
          : Math.max(this.duckTarget, this.duck - duckStep);
      anyMoving = anyMoving || this.duck !== this.duckTarget;
    }

    for (const [theme, el] of this.elements.entries()) {
      const current = this.trackLevels.get(theme) ?? 0;
      const target = playing && theme === this.currentTheme ? 1 : 0;

      let next = current;
      if (current < target) {
        next = Math.min(target, current + step);
      } else if (current > target) {
        next = Math.max(target, current - step);
      }

      this.trackLevels.set(theme, next);
      if (Math.abs(next - target) > 0.001) {
        anyMoving = true;
      }

      // Pause retired or muted tracks once they have faded completely out
      if (target === 0 && next <= 0.001) {
        this.trackLevels.set(theme, 0);
        try {
          el.volume = 0;
          if (!el.paused) {
            el.pause();
          }
        } catch {
          // Ignore
        }
      }
    }

    this.applyElementVolumes();

    if (!anyMoving) {
      this.stopFadeLoop();
    }
  }

  private applyElementVolumes(): void {
    const effective = this.getEffectiveGain();
    for (const [theme, el] of this.elements.entries()) {
      const level = this.trackLevels.get(theme) ?? 0;
      // Smooth equal-power curve so crossfade energy stays warm and even
      const shaped = Math.sin(clamp01(level) * Math.PI * 0.5);
      const targetVol = clamp01(shaped * effective);
      try {
        el.volume = targetVol;
      } catch {
        // Ignore
      }
    }
  }

  private emitChange(): void {
    const snapshot: MusicStateSnapshot = {
      enabled: this.enabled,
      theme: this.currentTheme,
    };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private emitVolumeChange(): void {
    for (const listener of this.volumeListeners) {
      listener(this.musicVolume);
    }
  }
}
