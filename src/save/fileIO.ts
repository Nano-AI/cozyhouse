import type { GameDataBundle, HouseState } from '../data/schemas';
import { deserializeHouse, serializeHouseToJson, type DeserializeResult } from './serializer';

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function exportHouseToFile(state: HouseState): { filename: string; bytes: number } {
  const json = serializeHouseToJson(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `cozyhouse-${formatTimestamp()}.cozyhouse.json`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoke asynchronously so Safari/Firefox finish the download cleanly
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { filename, bytes: json.length };
}

export async function importHouseFromFile(
  file: File,
  data: GameDataBundle,
): Promise<DeserializeResult> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not read file: invalid JSON format.');
  }
  return deserializeHouse(parsed, data);
}
