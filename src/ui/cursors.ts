/**
 * Hardware-composited 32x32 Storybook Ink SVG custom cursor set.
 * Injects CSS variables (`--cursor-*`) onto `:root` so both the 3D canvas
 * (`#viewport canvas[data-cursor="..."]`) and HUD controls share one crisp
 * hand-inked cream & dark-ink cursor language.
 */

export type StorybookCursorKey =
  | 'default'
  | 'pointer'
  | 'pan'
  | 'panning'
  | 'person'
  | 'interact'
  | 'select'
  | 'move'
  | 'place'
  | 'place-invalid'
  | 'erase'
  | 'marquee';

interface CursorSpec {
  cssVar: string;
  hx: number;
  hy: number;
  fallback: string;
  body: string;
}

const CREAM = '#FCF9F2';
const CREAM_SHADE = '#EFE6D5';
const INK = '#2D2620';
const SHADOW = 'rgba(45,38,32,0.22)';

const POINTER_ARROW_PATHS = `
  <path d="M5 4 L5 23 L10.2 18.2 L13.8 26.2 L16.8 24.8 L13.2 17 L19.8 16.6 Z" fill="${SHADOW}"/>
  <path d="M4 3 L4 22 L9.2 17.2 L12.8 25.2 L15.8 23.8 L12.2 16 L18.8 15.6 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
`;

const POINTING_HAND_PATHS = `
  <path d="M11 4.2 C9.6 4.2 8.7 5.2 8.7 6.5 L8.7 15.2 L7.2 13.7 C6 12.6 4.4 13.4 4.8 15.1 L7.4 22.8 C8.3 25.2 10.6 26.6 13.5 26.6 L18 26.6 C21.2 26.6 23.2 24.4 23.2 21 L23.2 15.2 C23.2 13.6 21.8 12.6 20.5 13.1 C20.1 11.7 18.7 11.1 17.5 11.8 C17 10.5 15.6 10.1 14.4 10.8 L14.4 6.5 C14.4 5.2 13.4 4.2 12 4.2 Z" fill="${SHADOW}" transform="translate(1 1)"/>
  <path d="M10.5 3.4 C9.1 3.4 8.2 4.4 8.2 5.7 L8.2 14.5 L6.7 13 C5.5 11.9 3.9 12.7 4.3 14.4 L6.9 22.1 C7.8 24.5 10.1 25.9 13 25.9 L17.5 25.9 C20.7 25.9 22.7 23.7 22.7 20.3 L22.7 14.5 C22.7 12.9 21.3 11.9 20 12.4 C19.6 11 18.2 10.4 17 11.1 C16.5 9.8 15.1 9.4 13.9 10.1 L13.9 5.7 C13.9 4.4 12.9 3.4 11.5 3.4 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 14.2 V17.2 M17.1 14.5 V17.4 M20 15.2 V17.6" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
`;

const CROSSHAIR_BASE = `
  <path d="M16 4 V11 M16 21 V28 M4 16 H11 M21 16 H28" stroke="${CREAM}" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M16 4 V11 M16 21 V28 M4 16 H11 M21 16 H28" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="2.2" fill="${CREAM}" stroke="${INK}" stroke-width="1.8"/>
`;

export const STORYBOOK_CURSORS: Record<StorybookCursorKey, CursorSpec> = {
  default: {
    cssVar: '--cursor-default',
    hx: 4,
    hy: 3,
    fallback: 'default',
    body: POINTER_ARROW_PATHS,
  },
  pointer: {
    cssVar: '--cursor-pointer',
    hx: 10,
    hy: 3,
    fallback: 'pointer',
    body: POINTING_HAND_PATHS,
  },
  pan: {
    cssVar: '--cursor-pan',
    hx: 15,
    hy: 15,
    fallback: 'grab',
    body: `
      <path d="M11 7.5 C10 7.5 9.4 8.3 9.4 9.3 V15.2 L7.8 13.6 C6.7 12.6 5.2 13.3 5.5 14.9 L8 22.8 C8.8 25.1 11 26.8 14.2 26.8 H18.2 C21.8 26.8 24.2 24.2 24.2 20.5 V10.5 C24.2 9.4 23.4 8.7 22.4 8.7 C21.5 8.7 20.8 9.4 20.8 10.4 V13.8 V7.7 C20.8 6.6 20 5.9 19 5.9 C18 5.9 17.3 6.6 17.3 7.7 V13.2 V6.6 C17.3 5.5 16.5 4.8 15.5 4.8 C14.5 4.8 13.7 5.5 13.7 6.6 V13.2 V8.3 C13.7 7.8 12.9 7.5 12 7.5 Z" fill="${SHADOW}" transform="translate(1 1)"/>
      <path d="M10.4 7.5 C9.4 7.5 8.8 8.3 8.8 9.3 V15.2 L7.2 13.6 C6.1 12.6 4.6 13.3 4.9 14.9 L7.4 22.8 C8.2 25.1 10.4 26.8 13.6 26.8 H17.6 C21.2 26.8 23.6 24.2 23.6 20.5 V10.5 C23.6 9.4 22.8 8.7 21.8 8.7 C20.9 8.7 20.2 9.4 20.2 10.4 V13.8 V7.7 C20.2 6.6 19.4 5.9 18.4 5.9 C17.4 5.9 16.7 6.6 16.7 7.7 V13.2 V6.6 C16.7 5.5 15.9 4.8 14.9 4.8 C13.9 4.8 13.1 5.5 13.1 6.6 V13.2 V8.3 C13.1 7.8 12.3 7.5 11.4 7.5 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.5 23.2 H18.5" stroke="${CREAM_SHADE}" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  panning: {
    cssVar: '--cursor-panning',
    hx: 15,
    hy: 15,
    fallback: 'grabbing',
    body: `
      <path d="M7.6 15.2 C6.6 15.2 6 16 6.2 17.2 L7.8 22.8 C8.6 25.2 10.8 26.8 14 26.8 H18.6 C22 26.8 24.4 24.2 24.4 20.6 V14.6 C24.4 12.8 23 11.8 21.4 12.2 C21 10.8 19.6 10.2 18.2 10.8 C17.6 9.6 16.2 9.2 14.8 9.9 C13.8 9.2 12.2 9.4 11.4 10.6 C10.4 10.3 9.2 11 9.2 12.4 V15.2 Z" fill="${SHADOW}" transform="translate(1 1)"/>
      <path d="M7.6 15.2 C6.6 15.2 6 16 6.2 17.2 L7.8 22.8 C8.6 25.2 10.8 26.8 14 26.8 H18.6 C22 26.8 24.4 24.2 24.4 20.6 V14.6 C24.4 12.8 23 11.8 21.4 12.2 C21 10.8 19.6 10.2 18.2 10.8 C17.6 9.6 16.2 9.2 14.8 9.9 C13.8 9.2 12.2 9.4 11.4 10.6 C10.4 10.3 9.2 11 9.2 12.4 V15.2 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.4 12.8 V17.2 M16.1 12.2 V17.2 M19.8 12.8 V17.2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  person: {
    cssVar: '--cursor-person',
    hx: 4,
    hy: 3,
    fallback: 'pointer',
    body: `
      ${POINTER_ARROW_PATHS}
      <circle cx="22.8" cy="23.2" r="7.4" fill="${SHADOW}"/>
      <circle cx="22.2" cy="22.4" r="7.4" fill="#F5C85B" stroke="${INK}" stroke-width="2"/>
      <circle cx="22.2" cy="18.8" r="1.25" fill="${INK}"/>
      <path d="M22.2 21.8 V26.2" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    `,
  },
  interact: {
    cssVar: '--cursor-interact',
    hx: 10,
    hy: 3,
    fallback: 'pointer',
    body: `
      ${POINTING_HAND_PATHS}
      <path d="M23.5 3.2 L25 7.2 L29 8.7 L25 10.2 L23.5 14.2 L22 10.2 L18 8.7 L22 7.2 Z" fill="#FFE382" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    `,
  },
  select: {
    cssVar: '--cursor-select',
    hx: 4,
    hy: 3,
    fallback: 'pointer',
    body: `
      ${POINTER_ARROW_PATHS}
      <rect x="16.2" y="16.4" width="12.6" height="12.6" rx="3" fill="${SHADOW}"/>
      <rect x="15.4" y="15.6" width="12.6" height="12.6" rx="3" fill="#8FD6B2" stroke="${INK}" stroke-width="2"/>
      <rect x="18.5" y="18.7" width="6.4" height="6.4" rx="1.2" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2.2 1.6"/>
    `,
  },
  move: {
    cssVar: '--cursor-move',
    hx: 16,
    hy: 16,
    fallback: 'move',
    body: `
      <path d="M16 4 L19.8 8.6 H17.5 V14.5 H23.4 V12.2 L28 16 L23.4 19.8 V17.5 H17.5 V23.4 H19.8 L16 28 L12.2 23.4 H14.5 V17.5 H8.6 V19.8 L4 16 L8.6 12.2 V14.5 H14.5 V8.6 H12.2 Z" fill="${SHADOW}" transform="translate(0.9 1)"/>
      <path d="M16 3.5 L20 8.3 H17.6 V14.4 H23.7 V12 L28.5 16 L23.7 20 V17.6 H17.6 V23.7 H20 L16 28.5 L12 23.7 H14.4 V17.6 H8.3 V20 L3.5 16 L8.3 12 V14.4 H14.4 V8.3 H12 Z" fill="${CREAM}" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>
      <circle cx="16" cy="16" r="2.2" fill="#F5C85B" stroke="${INK}" stroke-width="1.4"/>
    `,
  },
  place: {
    cssVar: '--cursor-place',
    hx: 16,
    hy: 16,
    fallback: 'crosshair',
    body: `
      ${CROSSHAIR_BASE}
      <circle cx="24" cy="24" r="6.4" fill="#7BC8A4" stroke="${INK}" stroke-width="1.9"/>
      <path d="M24 20.8 V27.2 M20.8 24 H27.2" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  'place-invalid': {
    cssVar: '--cursor-place-invalid',
    hx: 16,
    hy: 16,
    fallback: 'not-allowed',
    body: `
      ${CROSSHAIR_BASE}
      <circle cx="24" cy="24" r="6.4" fill="#E57F74" stroke="${INK}" stroke-width="1.9"/>
      <path d="M21.4 21.4 L26.6 26.6 M26.6 21.4 L21.4 26.6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  erase: {
    cssVar: '--cursor-erase',
    hx: 5,
    hy: 26,
    fallback: 'crosshair',
    body: `
      <g transform="translate(0.8 1)">
        <path d="M17.2 6.4 L25.6 14.8 L15.2 25.2 H8.8 L5.2 21.6 L17.2 6.4 Z" fill="${SHADOW}"/>
      </g>
      <path d="M16.8 5.4 L25.4 14 L14.4 25 H7.6 L4.6 22 Z" fill="#F4A7B9" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M10.4 11.8 L19 20.4 L14.4 25 H7.6 L4.6 22 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M5.4 26.8 H16.5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  marquee: {
    cssVar: '--cursor-marquee',
    hx: 16,
    hy: 16,
    fallback: 'crosshair',
    body: `
      <rect x="6" y="6" width="20" height="20" rx="2.5" fill="rgba(252,249,242,0.45)" stroke="${CREAM}" stroke-width="3.6"/>
      <rect x="6" y="6" width="20" height="20" rx="2.5" fill="none" stroke="${INK}" stroke-width="1.9" stroke-dasharray="3.5 2.5"/>
      <path d="M16 11.5 V20.5 M11.5 16 H20.5" stroke="${CREAM}" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M16 11.5 V20.5 M11.5 16 H20.5" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>
    `,
  },
};

export function encodeCursorSvg(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body.replace(/\s+/g, ' ').trim()}</svg>`;
  return encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

export function buildCursorCssValue(key: StorybookCursorKey): string {
  const spec = STORYBOOK_CURSORS[key];
  return `url("data:image/svg+xml,${encodeCursorSvg(spec.body)}") ${spec.hx} ${spec.hy}, ${spec.fallback}`;
}

let cursorsInstalled = false;

export function installStorybookCursors(): void {
  if (cursorsInstalled || typeof document === 'undefined' || !document.documentElement) {
    return;
  }
  const rootStyle = document.documentElement.style;
  for (const key of Object.keys(STORYBOOK_CURSORS) as StorybookCursorKey[]) {
    const spec = STORYBOOK_CURSORS[key];
    rootStyle.setProperty(spec.cssVar, buildCursorCssValue(key));
  }
  cursorsInstalled = true;
}
