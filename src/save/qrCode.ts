/**
 * Zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level L,
 * Versions 1..40) + crisp Canvas 2D renderer for Polaroid share cards.
 */

export interface QrMatrix {
  version: number;
  size: number;
  /** 1 = dark module, 0 = light module (length = size * size, row-major). */
  modules: Uint8Array;
}

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** ISO/IEC 18004 Table 9 — ECC codewords per block for Error Correction Level L (index = version). */
const ECC_CODEWORDS_PER_BLOCK_L = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
  30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

/** ISO/IEC 18004 Table 9 — total number of EC blocks for Error Correction Level L (index = version). */
const NUM_EC_BLOCKS_L = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
  15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** Total raw data + ECC module bits available in a QR symbol of `version`. */
function getNumRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

/** Exact data codeword capacity for Error Correction Level L at `version`. */
function getDataCodewordCapacityL(version: number): number {
  const totalCodewords = Math.floor(getNumRawDataModules(version) / 8);
  return totalCodewords - ECC_CODEWORDS_PER_BLOCK_L[version] * NUM_EC_BLOCKS_L[version];
}

/** ISO/IEC 18004 Annex E alignment pattern center coordinates for `version`. */
function getAlignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/** Multiply two bytes in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Computes Reed-Solomon generator polynomial coefficients (excluding leading x^degree = 1). */
function rsComputeDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Computes Reed-Solomon remainder bytes for `data` given generator `divisor`. */
function rsComputeRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let j = 0; j < divisor.length; j++) {
      result[j] ^= gfMultiply(divisor[j], factor);
    }
  }
  return result;
}

/** Appends `bitLen` lowest bits of `val` MSB-first into a packed byte array. */
class BitBuffer {
  readonly bytes: number[] = [];
  bitLength = 0;

  appendBits(val: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) {
      if ((this.bitLength & 7) === 0) {
        this.bytes.push(0);
      }
      if (((val >>> i) & 1) !== 0) {
        this.bytes[this.bytes.length - 1] |= 1 << (7 - (this.bitLength & 7));
      }
      this.bitLength += 1;
    }
  }
}

/** Splits data codewords into ISO blocks, appends RS ECC, and interleaves into final bitstream. */
function addEccAndInterleave(data: Uint8Array, version: number): Uint8Array {
  const numBlocks = NUM_EC_BLOCKS_L[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_L[version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const rsDiv = rsComputeDivisor(blockEccLen);
  const blocks: Uint8Array[] = [];
  const shortDataLen = shortBlockLen - blockEccLen;

  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.subarray(offset, offset + dataLen);
    offset += dataLen;
    const ecc = rsComputeRemainder(dat, rsDiv);
    const fullBlock = new Uint8Array(shortDataLen + 1 + blockEccLen);
    fullBlock.set(dat, 0);
    // Note: short blocks have a dummy gap at index `shortDataLen`, skipped during interleaving
    fullBlock.set(ecc, shortDataLen + (i < numShortBlocks ? 0 : 1));
    blocks.push(fullBlock);
  }

  const result = new Uint8Array(rawCodewords);
  let outIdx = 0;
  const maxDataLen = shortDataLen + (numShortBlocks < numBlocks ? 1 : 0);

  // Interleave data codewords
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i === shortDataLen && b < numShortBlocks) continue;
      result[outIdx++] = blocks[b][i];
    }
  }

  // Interleave ECC codewords
  for (let i = 0; i < blockEccLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      const eccOffset = shortDataLen + (b < numShortBlocks ? 0 : 1);
      result[outIdx++] = blocks[b][eccOffset + i];
    }
  }

  return result;
}

function setFunctionModule(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  x: number,
  y: number,
  isDark: boolean,
): void {
  const idx = y * size + x;
  modules[idx] = isDark ? 1 : 0;
  isFunction[idx] = 1;
}

function drawFinderPattern(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  cx: number,
  cy: number,
): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const xx = cx + dx;
      const yy = cy + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const isDark = dist !== 2 && dist !== 4;
        setFunctionModule(modules, isFunction, size, xx, yy, isDark);
      }
    }
  }
}

function drawAlignmentPattern(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  cx: number,
  cy: number,
): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(modules, isFunction, size, cx + dx, cy + dy, dist !== 1);
    }
  }
}

function drawFormatBits(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  mask: number,
): void {
  // Error Correction Level L format indicator bits = 0b01
  const data = (0b01 << 3) | (mask & 7);
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  // First copy around top-left finder
  for (let i = 0; i <= 5; i++) {
    setFunctionModule(modules, isFunction, size, 8, i, ((bits >>> i) & 1) !== 0);
  }
  setFunctionModule(modules, isFunction, size, 8, 7, ((bits >>> 6) & 1) !== 0);
  setFunctionModule(modules, isFunction, size, 8, 8, ((bits >>> 7) & 1) !== 0);
  setFunctionModule(modules, isFunction, size, 7, 8, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) {
    setFunctionModule(modules, isFunction, size, 14 - i, 8, ((bits >>> i) & 1) !== 0);
  }

  // Second copy (top-right and bottom-left)
  for (let i = 0; i < 8; i++) {
    setFunctionModule(modules, isFunction, size, size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
  }
  for (let i = 8; i < 15; i++) {
    setFunctionModule(modules, isFunction, size, 8, size - 15 + i, ((bits >>> i) & 1) !== 0);
  }
  // Fixed dark module
  setFunctionModule(modules, isFunction, size, 8, size - 8, true);
}

function drawVersionBits(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  version: number,
): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  }
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const isDark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(modules, isFunction, size, a, b, isDark);
    setFunctionModule(modules, isFunction, size, b, a, isDark);
  }
}

function drawFunctionPatterns(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  version: number,
): void {
  // Timing patterns (row 6 and col 6)
  for (let i = 0; i < size; i++) {
    setFunctionModule(modules, isFunction, size, 6, i, i % 2 === 0);
    setFunctionModule(modules, isFunction, size, i, 6, i % 2 === 0);
  }

  // 3 corner finder patterns + 1-module white separators
  drawFinderPattern(modules, isFunction, size, 3, 3);
  drawFinderPattern(modules, isFunction, size, size - 4, 3);
  drawFinderPattern(modules, isFunction, size, 3, size - 4);

  // Alignment patterns (skipping the 3 finder corners)
  const alignPos = getAlignmentPatternPositions(version);
  const numAlign = alignPos.length;
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      if (
        !(
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0)
        )
      ) {
        drawAlignmentPattern(modules, isFunction, size, alignPos[i], alignPos[j]);
      }
    }
  }

  // Reserve format & version metadata modules before placing data codewords
  drawFormatBits(modules, isFunction, size, 0);
  drawVersionBits(modules, isFunction, size, version);
}

function drawCodewords(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  codewords: Uint8Array,
): void {
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const idx = y * size + x;
        if (isFunction[idx] === 0 && bitIdx < totalBits) {
          const bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          modules[idx] = bit;
          bitIdx += 1;
        }
      }
    }
  }
}

function applyMask(
  modules: Uint8Array,
  isFunction: Uint8Array,
  size: number,
  mask: number,
): void {
  for (let y = 0; y < size; y++) {
    const rowOff = y * size;
    for (let x = 0; x < size; x++) {
      if (isFunction[rowOff + x] !== 0) continue;
      let invert = false;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
          break;
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0;
          break;
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
        case 7:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          break;
      }
      if (invert) {
        modules[rowOff + x] ^= 1;
      }
    }
  }
}

function finderPenaltyCountPatterns(runHistory: number[]): number {
  const n = runHistory[1];
  if (n <= 0) return 0;
  const core =
    runHistory[2] === n &&
    runHistory[3] === n * 3 &&
    runHistory[4] === n &&
    runHistory[5] === n;
  return (
    (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
    (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
  );
}

function finderPenaltyAddHistory(currentRunLength: number, runHistory: number[]): void {
  runHistory.pop();
  runHistory.unshift(currentRunLength);
}

function finderPenaltyTerminateAndCount(
  currentRunColor: number,
  currentRunLength: number,
  runHistory: number[],
  size: number,
): number {
  let len = currentRunLength;
  if (currentRunColor === 1) {
    finderPenaltyAddHistory(len, runHistory);
    len = 0;
  }
  len += size;
  finderPenaltyAddHistory(len, runHistory);
  return finderPenaltyCountPatterns(runHistory);
}

/** ISO/IEC 18004 Section 7.8.3.1 4-rule mask penalty score. */
function computePenaltyScore(modules: Uint8Array, size: number): number {
  let result = 0;

  // Rule 1 & Rule 3 — horizontal scans
  for (let y = 0; y < size; y++) {
    const rowOff = y * size;
    let runColor = 0;
    let runX = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      const color = modules[rowOff + x];
      if (color === runColor) {
        runX += 1;
        if (runX === 5) result += PENALTY_N1;
        else if (runX > 5) result += 1;
      } else {
        finderPenaltyAddHistory(runX, runHistory);
        if (runColor === 0) {
          result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        }
        runColor = color;
        runX = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
  }

  // Rule 1 & Rule 3 — vertical scans
  for (let x = 0; x < size; x++) {
    let runColor = 0;
    let runY = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      const color = modules[y * size + x];
      if (color === runColor) {
        runY += 1;
        if (runY === 5) result += PENALTY_N1;
        else if (runY > 5) result += 1;
      } else {
        finderPenaltyAddHistory(runY, runHistory);
        if (runColor === 0) {
          result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        }
        runColor = color;
        runY = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * PENALTY_N3;
  }

  // Rule 2 — 2x2 same-color blocks
  for (let y = 0; y < size - 1; y++) {
    const r0 = y * size;
    const r1 = r0 + size;
    for (let x = 0; x < size - 1; x++) {
      const c = modules[r0 + x];
      if (c === modules[r0 + x + 1] && c === modules[r1 + x] && c === modules[r1 + x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  // Rule 4 — balance of dark vs light modules
  let dark = 0;
  const total = size * size;
  for (let i = 0; i < total; i++) {
    dark += modules[i];
  }
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  if (k > 0) {
    result += k * PENALTY_N4;
  }

  return result;
}

/**
 * Encodes UTF-8 `text` into a standards-compliant ISO/IEC 18004 QR Code matrix
 * (Byte mode, Error Correction Level L, auto-selecting Version 1..40).
 * Returns `null` if `text` is empty or exceeds maximum capacity (2,953 UTF-8 bytes).
 */
export function encodeQrMatrix(text: string): QrMatrix | null {
  if (!text) return null;
  const bytes = new TextEncoder().encode(text);

  // Select smallest version whose Level-L Byte-mode capacity fits `bytes`
  let version = -1;
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + bytes.length * 8;
    const capacityBits = getDataCodewordCapacityL(v) * 8;
    if (requiredBits <= capacityBits) {
      version = v;
      break;
    }
  }
  if (version < 0) return null;

  const dataCapacityBytes = getDataCodewordCapacityL(version);
  const dataCapacityBits = dataCapacityBytes * 8;
  const countBits = version <= 9 ? 8 : 16;

  // Build Byte-mode bit stream: mode (0100) + byte length + UTF-8 bytes + terminator + pad bytes
  const bb = new BitBuffer();
  bb.appendBits(0b0100, 4);
  bb.appendBits(bytes.length, countBits);
  for (let i = 0; i < bytes.length; i++) {
    bb.appendBits(bytes[i], 8);
  }
  bb.appendBits(0, Math.min(4, dataCapacityBits - bb.bitLength));
  bb.appendBits(0, (8 - (bb.bitLength % 8)) % 8);
  for (let padByte = 0xec; bb.bitLength < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
    bb.appendBits(padByte, 8);
  }

  const dataCodewords = Uint8Array.from(bb.bytes);
  const allCodewords = addEccAndInterleave(dataCodewords, version);

  const size = 17 + version * 4;
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);

  drawFunctionPatterns(modules, isFunction, size, version);
  drawCodewords(modules, isFunction, size, allCodewords);

  // Select optimal mask pattern (0..7) minimizing ISO 4-rule penalty
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, size, mask);
    drawFormatBits(modules, isFunction, size, mask);
    const penalty = computePenaltyScore(modules, size);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
    // Undo mask before testing next candidate
    applyMask(modules, isFunction, size, mask);
  }

  // Apply winning mask & final format bits
  applyMask(modules, isFunction, size, bestMask);
  drawFormatBits(modules, isFunction, size, bestMask);

  return { version, size, modules };
}

/**
 * Renders a crisp, scan-ready QR code directly onto a Canvas 2D context.
 * Uses edge-snapped pixel coordinates to prevent hairline sub-pixel seams between adjacent modules.
 */
export function drawQrToCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  drawSize: number,
  opts?: { fg?: string; bg?: string; quietZone?: number },
): boolean {
  const qr = encodeQrMatrix(text);
  if (!qr || drawSize <= 0) return false;

  const fg = opts?.fg ?? '#2D2620';
  const bg = opts?.bg ?? '#FFFFFF';
  const quietZone = Math.max(0, Math.round(opts?.quietZone ?? 4));
  const totalModules = qr.size + quietZone * 2;
  const cell = drawSize / totalModules;

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, drawSize, drawSize);

  ctx.fillStyle = fg;
  const { size, modules } = qr;
  for (let row = 0; row < size; row++) {
    const rowOff = row * size;
    const py0 = Math.floor(y + (row + quietZone) * cell);
    const py1 = Math.ceil(y + (row + quietZone + 1) * cell);
    const ph = Math.max(1, py1 - py0);

    let col = 0;
    while (col < size) {
      if (modules[rowOff + col] === 0) {
        col += 1;
        continue;
      }
      // Coalesce contiguous horizontal dark runs for sharper rendering & fewer fillRect calls
      const runStart = col;
      while (col < size && modules[rowOff + col] === 1) {
        col += 1;
      }
      const px0 = Math.floor(x + (runStart + quietZone) * cell);
      const px1 = Math.ceil(x + (col + quietZone) * cell);
      ctx.fillRect(px0, py0, Math.max(1, px1 - px0), ph);
    }
  }
  ctx.restore();
  return true;
}
