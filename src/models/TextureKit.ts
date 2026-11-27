import * as THREE from 'three';
import type { FurnitureItemDef } from '../data/schemas';

export type SurfaceTextureKind = 'plaster' | 'wood' | 'fabric' | 'stone';

export interface SurfaceTexturePair {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  bumpScale: number;
}

const TEX_SIZE = 128;
const textureCache = new Map<SurfaceTextureKind, SurfaceTexturePair>();

function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth periodic value noise wrapping seamlessly modulo `period`. */
function tileableValueNoise(x: number, y: number, period: number, seed: number): number {
  const fx = ((x % period) + period) % period;
  const fy = ((y % period) + period) % period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const tx = fx - x0;
  const ty = fy - y0;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);

  const a = hash2D(x0, y0, seed);
  const b = hash2D(x1, y0, seed);
  const c = hash2D(x0, y1, seed);
  const d = hash2D(x1, y1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function makeCanvasTexture(
  pixels: Uint8ClampedArray,
  isColorMap: boolean,
  repeat = 2,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = isColorMap ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.userData.sharedTex = true;
  tex.needsUpdate = true;
  return tex;
}

function buildSurfaceTexturePair(kind: SurfaceTextureKind): SurfaceTexturePair {
  const colorPixels = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
  const bumpPixels = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);

  for (let y = 0; y < TEX_SIZE; y++) {
    const v = y / TEX_SIZE;
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const idx = (y * TEX_SIZE + x) * 4;

      let shade = 252;
      let bump = 128;

      if (kind === 'plaster') {
        // Gentle architectural matte stucco variation (organic, never noisy)
        const n1 = tileableValueNoise(u * 8, v * 8, 8, 11);
        const n2 = tileableValueNoise(u * 24, v * 24, 24, 23);
        const fine = hash2D(x, y, 37);
        const combined = n1 * 0.55 + n2 * 0.35 + fine * 0.1;
        shade = Math.round(246 + combined * 9);
        bump = Math.round(108 + combined * 42);
      } else if (kind === 'wood') {
        // Warm horizontal wood fibers with subtle undulating rings
        const wave = Math.sin(u * Math.PI * 2) * 0.5 + Math.sin((u * 2 + v) * Math.PI * 2) * 0.25;
        const streak = tileableValueNoise(u * 4, (v + wave * 0.03) * 32, 32, 41);
        const fiber = tileableValueNoise(u * 8, v * 64, 64, 53);
        const grain = streak * 0.65 + fiber * 0.35;
        shade = Math.round(240 + grain * 15);
        bump = Math.round(92 + grain * 74);
      } else if (kind === 'fabric') {
        // Soft micro-woven linen / upholstery crosshatch
        const warp = Math.sin(x * Math.PI * 0.5) * 0.5 + 0.5;
        const weft = Math.sin(y * Math.PI * 0.5) * 0.5 + 0.5;
        const checker = ((x >> 1) + (y >> 1)) & 1;
        const weave = checker ? warp * 0.72 + weft * 0.28 : warp * 0.28 + weft * 0.72;
        const soft = tileableValueNoise(u * 12, v * 12, 12, 71);
        const val = weave * 0.65 + soft * 0.35;
        shade = Math.round(243 + val * 12);
        bump = Math.round(96 + val * 68);
      } else {
        // Fine mineral ceramic / brick / terrazzo micro-speckle
        const broad = tileableValueNoise(u * 12, v * 12, 12, 89);
        const grain = tileableValueNoise(u * 32, v * 32, 32, 97);
        const speck = hash2D(x, y, 109) > 0.94 ? -0.35 : 0;
        const val = Math.max(0, Math.min(1, broad * 0.5 + grain * 0.5 + speck));
        shade = Math.round(242 + val * 13);
        bump = Math.round(94 + val * 70);
      }

      colorPixels[idx] = shade;
      colorPixels[idx + 1] = shade;
      colorPixels[idx + 2] = shade;
      colorPixels[idx + 3] = 255;

      bumpPixels[idx] = bump;
      bumpPixels[idx + 1] = bump;
      bumpPixels[idx + 2] = bump;
      bumpPixels[idx + 3] = 255;
    }
  }

  const bumpScale =
    kind === 'plaster' ? 0.008 : kind === 'wood' ? 0.014 : kind === 'fabric' ? 0.012 : 0.015;
  const repeat = kind === 'fabric' ? 3 : 2;

  return {
    map: makeCanvasTexture(colorPixels, true, repeat),
    bumpMap: makeCanvasTexture(bumpPixels, false, repeat),
    bumpScale,
  };
}

/**
 * Returns a globally cached procedural CanvasTexture pair (`map` + `bumpMap`),
 * or `null` safely in non-DOM environments (headless Node / SSR tests).
 */
export function getSurfaceTextures(kind: SurfaceTextureKind): SurfaceTexturePair | null {
  if (typeof document === 'undefined') return null;
  const existing = textureCache.get(kind);
  if (existing) return existing;
  try {
    const created = buildSurfaceTexturePair(kind);
    textureCache.set(kind, created);
    return created;
  } catch {
    return null;
  }
}

/**
 * Picks an architectural procedural surface texture for matte non-emissive materials.
 * Skips glossy metals, translucent glass, glowing emissives, and placement ghosts.
 */
export function inferSurfaceTextureKind(
  def: FurnitureItemDef,
  roughness: number,
  metalness: number,
  opacity: number,
  isGhost: boolean,
  hasEmissive: boolean,
): SurfaceTextureKind | null {
  if (isGhost || hasEmissive || metalness > 0.35 || opacity < 0.8 || roughness < 0.42) {
    return null;
  }

  const id = def.id;

  // Stone, brick, terrazzo, ceramic tiles & vases
  if (
    id.includes('brick') ||
    id.includes('stone') ||
    id.includes('terrazzo') ||
    id.includes('floor_tile') ||
    id.includes('checkerboard') ||
    id.includes('ceramic') ||
    id.includes('fruit_bowl') ||
    id.includes('kitchen_sink')
  ) {
    return 'stone';
  }

  // Structural walls -> subtle architectural stucco/plaster
  if (def.layer === 'wall' && def.wallKind === 'structure' && !def.tags.includes('door')) {
    return 'plaster';
  }

  // Fabrics, upholstery, rugs, beds, curtains, plushies, cozy pet beds/trees
  if (
    def.subLayer === 'rug' ||
    def.tags.includes('sleep') ||
    def.tags.includes('plushie') ||
    id.includes('sofa') ||
    id.includes('loveseat') ||
    id.includes('armchair') ||
    id.includes('beanbag') ||
    id.includes('booth') ||
    id.includes('curtain') ||
    id.includes('tapestry') ||
    id.includes('pet_bed') ||
    id.includes('cat_tree') ||
    id.includes('cat_condo') ||
    id.includes('cat_tunnel') ||
    id.includes('hammock')
  ) {
    return 'fabric';
  }

  // Wood floors, doors, desks, tables, counters, shelves, cabinetry
  if (
    id.includes('wood') ||
    id.includes('herringbone') ||
    id.includes('desk') ||
    id.includes('table') ||
    id.includes('counter') ||
    id.includes('island') ||
    id.includes('bookshelf') ||
    id.includes('wardrobe') ||
    id.includes('dresser') ||
    id.includes('console') ||
    id.includes('door') ||
    id.includes('shelf') ||
    id.includes('catwalk') ||
    id.includes('easel') ||
    id.includes('pantry') ||
    id.includes('crate') ||
    id.includes('chair') ||
    id.includes('stool') ||
    id.includes('scratch_post')
  ) {
    return 'wood';
  }

  if (roughness >= 0.72 && (def.tab === 'decor' || def.tab === 'basics')) {
    return 'plaster';
  }

  return null;
}
