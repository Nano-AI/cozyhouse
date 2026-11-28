import type { GameDataBundle, HouseState } from '../data/schemas';
import {
  deserializeHouse,
  serializeHouseToJson,
  type DeserializeResult,
} from './serializer';

const HASH_PARAM_KEY = 'house';
export const MAX_DECOMPRESSED_BYTES = 1_048_576; // 1 MB decompression safety cap

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function readStreamToBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes?: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (maxBytes !== undefined && total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('Share link payload exceeds maximum allowed size (1 MB).');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function compressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    void writer
      .write(copy)
      .then(() => writer.close())
      .catch(() => {});
    return await readStreamToBytes(cs.readable);
  } catch {
    return null;
  }
}

async function decompressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot decompress z1 share links.');
  }
  if (bytes.byteLength > MAX_DECOMPRESSED_BYTES) {
    throw new Error('Share link payload exceeds maximum allowed size (1 MB).');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  void writer
    .write(copy)
    .then(() => writer.close())
    .catch(() => {});
  return readStreamToBytes(ds.readable, MAX_DECOMPRESSED_BYTES);
}

/**
 * Encodes a HouseState into a compact URL-safe share code (`z1_<deflate>` or `u1_<utf8>`).
 */
export async function encodeHouseToShareCode(state: HouseState): Promise<string> {
  const json = serializeHouseToJson(state);
  const utf8 = new TextEncoder().encode(json);
  const compressed = await compressDeflateRaw(utf8);
  if (compressed && compressed.byteLength < utf8.byteLength) {
    return `z1_${bytesToBase64Url(compressed)}`;
  }
  return `u1_${bytesToBase64Url(utf8)}`;
}

/**
 * Encodes a HouseState into a complete shareable URL (`${origin}${pathname}#house=<code>`).
 */
export async function encodeHouseToShareUrl(
  state: HouseState,
  baseUrl?: string,
): Promise<string> {
  const code = await encodeHouseToShareCode(state);
  let cleanBase = '';
  if (baseUrl !== undefined) {
    const hashIdx = baseUrl.indexOf('#');
    cleanBase = hashIdx >= 0 ? baseUrl.slice(0, hashIdx) : baseUrl;
  } else if (typeof window !== 'undefined' && window.location) {
    cleanBase = `${window.location.origin}${window.location.pathname}`;
  }
  return `${cleanBase}#${HASH_PARAM_KEY}=${code}`;
}

/**
 * Extracts a share code from a URL hash string (e.g. `#house=z1_...`), or returns `null`.
 */
export function extractShareCodeFromHash(hash: string): string | null {
  if (!hash) return null;
  const trimmed = hash.trim().replace(/^#/, '');
  if (!trimmed) return null;

  const parts = trimmed.split('&');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === HASH_PARAM_KEY) {
      const val = part.slice(eqIdx + 1).trim();
      if (!val) return null;
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

function normalizeShareCodeInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Please paste a share link or house code.');
  }

  // Full URL or hash fragment containing `#...`
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx >= 0) {
    const fromHash = extractShareCodeFromHash(trimmed.slice(hashIdx));
    if (fromHash) return fromHash;
  }

  // Query or key=value form (`house=...` or `?house=...`)
  const strippedQuery = trimmed.replace(/^\?/, '');
  const fromParam = extractShareCodeFromHash(strippedQuery);
  if (fromParam) return fromParam;

  // Raw code (`z1_...` or `u1_...`)
  return trimmed;
}

/**
 * Decodes a full share URL, `#house=...` fragment, `house=...`, or raw share code
 * back into a validated `HouseState`.
 */
export async function decodeHouseFromShareLink(
  input: string,
  data: GameDataBundle,
): Promise<DeserializeResult> {
  const code = normalizeShareCodeInput(input);

  let jsonText: string;
  if (code.startsWith('z1_')) {
    const payload = code.slice(3);
    if (!payload) throw new Error('Invalid share code: empty payload.');
    const compressed = base64UrlToBytes(payload);
    const inflated = await decompressDeflateRaw(compressed);
    jsonText = new TextDecoder().decode(inflated);
  } else if (code.startsWith('u1_')) {
    const payload = code.slice(3);
    if (!payload) throw new Error('Invalid share code: empty payload.');
    if (payload.length > Math.ceil((MAX_DECOMPRESSED_BYTES * 4) / 3) + 4) {
      throw new Error('Share link payload exceeds maximum allowed size (1 MB).');
    }
    const raw = base64UrlToBytes(payload);
    if (raw.byteLength > MAX_DECOMPRESSED_BYTES) {
      throw new Error('Share link payload exceeds maximum allowed size (1 MB).');
    }
    jsonText = new TextDecoder().decode(raw);
  } else {
    throw new Error('Unrecognized share link format. Expected a Cozyhouse share link or code.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Corrupted share link: could not parse house JSON.');
  }

  return deserializeHouse(parsed, data);
}
