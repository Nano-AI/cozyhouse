import type { GameDataBundle, HouseState } from '../data/schemas';
import { deserializeHouse, serializeHouseToJson } from './serializer';

const STORAGE_KEY = 'cozyhouse.autosave.v1';

export interface StorageSaveResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export function saveHouseToStorage(state: HouseState): StorageSaveResult {
  try {
    const json = serializeHouseToJson(state);
    window.localStorage.setItem(STORAGE_KEY, json);
    return { ok: true, bytes: json.length };
  } catch (err) {
    return {
      ok: false,
      bytes: 0,
      error: err instanceof Error ? err.message : 'Unable to write localStorage',
    };
  }
}

export function loadHouseFromStorage(data: GameDataBundle): HouseState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const { state } = deserializeHouse(parsed, data);
    return state;
  } catch (err) {
    console.warn('[Cozyhouse] Failed to restore autosave from localStorage:', err);
    return null;
  }
}

export function clearHouseStorage(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage access errors in restricted modes
  }
}
