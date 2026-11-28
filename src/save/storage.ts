import type { GameDataBundle, HouseState } from '../data/schemas';
import { deserializeHouse, serializeHouseToJson } from './serializer';

const STORAGE_KEY = 'cozyhouse.autosave.v1';
const CORRUPT_BACKUP_KEY = 'cozyhouse:save:corrupt_backup';

export interface StorageSaveResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export function backupHouseStorage(backupKey = 'cozyhouse:save:backup'): void {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      window.localStorage.setItem(backupKey, existing);
    }
  } catch {
    // Ignore storage access errors in restricted modes
  }
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
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const { state } = deserializeHouse(parsed, data);
    if (!state) {
      try {
        window.localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
      } catch {
        // Ignore storage backup failure
      }
      return null;
    }
    return state;
  } catch (err) {
    if (raw) {
      try {
        window.localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
      } catch {
        // Ignore storage backup failure
      }
    }
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
