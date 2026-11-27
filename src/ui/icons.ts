export type IconName =
  // Brand & Modes
  | 'brand'
  | 'live'
  | 'build'
  // Catalog Tabs (7)
  | 'basics'
  | 'living'
  | 'kitchen'
  | 'cafe_bar'
  | 'party'
  | 'decor'
  | 'pets'
  // Subcategories
  | 'bed'
  | 'sofa'
  | 'desk'
  | 'storage'
  | 'table'
  | 'counter'
  | 'appliance'
  | 'dining'
  | 'kettle'
  | 'coffee'
  | 'dj'
  | 'light'
  | 'sparkles'
  | 'plant'
  | 'art'
  | 'mirror'
  | 'plushie'
  | 'cat'
  | 'toy'
  // HUD & Tool Actions
  | 'undo'
  | 'redo'
  | 'rotLeft'
  | 'rotRight'
  | 'minus'
  | 'plus'
  | 'reset'
  | 'wallCutaway'
  | 'cinematic'
  | 'visitors'
  | 'soundOn'
  | 'soundOff'
  | 'volume'
  | 'menu'
  | 'select'
  | 'bulkSelect'
  | 'eraser'
  | 'lot'
  | 'grid'
  | 'search'
  | 'stack'
  | 'share'
  | 'copy'
  | 'download'
  | 'upload'
  | 'sun'
  | 'sunrise'
  | 'sunset'
  | 'moon'
  | 'cloudRain'
  | 'snow'
  | 'fog'
  | 'thunder'
  | 'close'
  | 'check'
  | 'back';

const ICON_PATHS: Record<IconName, string> = {
  // Brand & Modes
  brand:
    '<path d="M3 10.2 12 3l9 7.2"/><path d="M5.5 9.2V20h13V9.2"/><path d="M9.8 20v-5.5h4.4V20"/>',
  live: '<polygon points="7,4.5 19,12 7,19.5"/>',
  build:
    '<path d="m14.8 4.2 5 5-9.8 9.8-5.6 1 1-5.6 9.4-10.2z"/><path d="m12.8 6.2 5 5"/>',

  // 7 Catalog Tabs
  basics:
    '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 12h18M12 3v18"/>',
  living:
    '<path d="M4 11V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V11"/><path d="M2.5 12.5A1.5 1.5 0 0 1 4 11h1a1.5 1.5 0 0 1 1.5 1.5V14h11v-1.5A1.5 1.5 0 0 1 19 11h1a1.5 1.5 0 0 1 1.5 1.5V17a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-4.5z"/><path d="M6 19v1.8M18 19v1.8"/>',
  kitchen:
    '<path d="M6 3v7a2.5 2.5 0 0 0 5 0V3M8.5 3v18"/><path d="M16 3v7.5a2 2 0 0 0 2 2h1V21"/><path d="M19 3v9.5"/>',
  cafe_bar:
    '<path d="M4 9h12v6a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 4 15V9z"/><path d="M16 10.5h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M7 4.5c0 1.2 1 1.4 1 2.4M11 4.5c0 1.2 1 1.4 1 2.4"/>',
  party:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/><path d="M12 4v2.5M19.5 9.5l-2.2.8M4.5 14.5l2.2-.8"/>',
  decor:
    '<path d="M19.5 4.5c-7 0-12.5 4-13.5 12.5 5 1 11.5-1.5 13.5-12.5z"/><path d="M5 19c2.5-3.5 6-6.5 10.5-9.5"/>',
  pets:
    '<circle cx="7.5" cy="8.2" r="1.7"/><circle cx="12" cy="6.2" r="1.7"/><circle cx="16.5" cy="8.2" r="1.7"/><circle cx="18.2" cy="12.5" r="1.5"/><path d="M12 11.5c-2.6 0-5 2.1-5 4.6 0 1.4 1.1 2.4 2.5 2.4 1 0 1.8-.4 2.5-.4s1.5.4 2.5.4c1.4 0 2.5-1 2.5-2.4 0-2.5-2.4-4.6-5-4.6z"/>',

  // Subcategories
  bed: '<path d="M3 18v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/><path d="M3 14h18M6 11h4.5M13.5 11H18"/>',
  sofa: '<path d="M4 13v-3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><rect x="3" y="13" width="18" height="5" rx="1.8"/><path d="M6 18v2M18 18v2"/>',
  desk: '<path d="M3 8h18M5 8v11M19 8v11M14 8v6h5"/>',
  storage: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 3v18M9.5 11v2M14.5 11v2"/>',
  table: '<path d="M3 9h18M5.5 9v10M18.5 9v10M5.5 14h13"/>',
  counter: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M3 11h18M12 11v9"/>',
  appliance: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14M9 6.5h1M9 13.5v3"/>',
  dining: '<path d="M4 11h16M7 11v8M17 11v8M9 7h6"/>',
  kettle: '<path d="M6 10a5.5 5.5 0 0 1 11 0v7.5H6V10z"/><path d="M17 11h2.2a1.8 1.8 0 0 1 0 3.6H17M9 4.5h5"/>',
  coffee: '<path d="M5 9h11v5.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5V9z"/><path d="M16 10.5h2a2 2 0 0 1 0 4h-2"/>',
  dj: '<rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="8.5" cy="12.5" r="2.6"/><circle cx="15.5" cy="12.5" r="2.6"/>',
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2.1h5c0-.9.3-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  sparkles:
    '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16l.8 2.2 2.2.8-2.2.8L19 22l-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  plant: '<path d="M12 21V11"/><path d="M12 13c-4 0-7-2.5-7-6.5 4 0 7 2.5 7 6.5z"/><path d="M12 11c4 0 7-2.5 7-6.5-4 0-7 2.5-7 6.5z"/>',
  art: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9.2" cy="9.2" r="1.4"/><path d="m20 15.5-4.5-4.5-6.5 6.5"/>',
  mirror: '<path d="M7 19V10a5 5 0 0 1 10 0v9z"/><path d="M5 19h14"/>',
  plushie: '<circle cx="8" cy="7.5" r="2.2"/><circle cx="16" cy="7.5" r="2.2"/><circle cx="12" cy="13.5" r="5.5"/>',
  cat: '<path d="M5.5 19v-6.5L4 6.5l4.2 2.3a7.2 7.2 0 0 1 7.6 0L20 6.5l-1.5 6v6.5"/><circle cx="9.5" cy="13.2" r=".8" fill="currentColor"/><circle cx="14.5" cy="13.2" r=".8" fill="currentColor"/>',
  toy: '<circle cx="12" cy="12" r="7"/><path d="M7.5 7.5c3 2.5 6 6.5 9 9M16.5 7.5c-3 2.5-6 6.5-9 9"/>',

  // HUD & Tool Actions
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 1 1 0 10h-2.5"/>',
  redo: '<path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 1 0 0 10h2.5"/>',
  rotLeft: '<path d="M6.5 8A7 7 0 1 1 5.2 14.5"/><path d="M6.5 3.5V8H11"/>',
  rotRight: '<path d="M17.5 8A7 7 0 1 0 18.8 14.5"/><path d="M17.5 3.5V8H13"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  reset: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  wallCutaway:
    '<path d="M3.5 9.2 12 4.5l8.5 4.7v8.2L12 21.5l-8.5-4.1V9.2z"/><path d="M12 4.5v8m0 0 8.5-3.3" stroke-dasharray="2.5 2.2"/><path d="M12 12.5 3.5 9.2"/>',
  cinematic:
    '<rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="m16 10.2 5-2.8v9.2l-5-2.8"/>',
  visitors:
    '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0"/><circle cx="16.8" cy="9.2" r="2.4"/><path d="M15.6 19.2h5.2a4 4 0 0 0-3.8-4.7"/>',
  soundOn:
    '<path d="M4.5 9.5H8.5L13.5 5.2v13.6L8.5 14.5h-4z"/><path d="M16.8 8.8a4.6 4.6 0 0 1 0 6.4"/><path d="M19.3 6.5a8 8 0 0 1 0 11"/>',
  soundOff:
    '<path d="M4.5 9.5H8.5L13.5 5.2v13.6L8.5 14.5h-4z"/><path d="m16.5 9.2 4.8 5.6M21.3 9.2l-4.8 5.6"/>',
  volume:
    '<path d="M4.5 9.5H8.5L13.5 5.2v13.6L8.5 14.5h-4z"/><path d="M17 9a4.5 4.5 0 0 1 0 6"/>',
  menu: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  select: '<path d="m5.5 3.5 12.5 8-5.6 1.4-2.5 6-4.4-15.4z"/>',
  bulkSelect: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.8" stroke-dasharray="3.5 2.6"/>',
  eraser:
    '<path d="M10.2 19.2H19.5M4.8 14.2l7.8-7.8a2.1 2.1 0 0 1 3 0l3.6 3.6a2.1 2.1 0 0 1 0 3l-6.2 6.2H8.4l-3.6-3.6a1 1 0 0 1 0-1.4z"/>',
  lot: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.6 15.6 4.6 4.6"/>',
  stack: '<path d="m4 8.8 8-4.3 8 4.3-8 4.3-8-4.3z"/><path d="m4 14.2 8 4.3 8-4.3"/>',
  share:
    '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  download: '<path d="M12 4v11M7.5 11.2 12 15.8l4.5-4.6M4.5 19.5h15"/>',
  upload: '<path d="M12 16V5M7.5 8.8 12 4.2l4.5 4.6M4.5 19.5h15"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  sunrise:
    '<path d="M12 5v4M5.5 11.5l1.8 1.8M18.5 11.5l-1.8 1.8M3 18h18M7.5 18a4.5 4.5 0 0 1 9 0"/>',
  sunset:
    '<path d="M12 9v4M5.5 11.5l1.8 1.8M18.5 11.5l-1.8 1.8M3 18h18M7.5 18a4.5 4.5 0 0 1 9 0"/>',
  moon: '<path d="M19.2 14.5A7.5 7.5 0 1 1 9.5 4.8a6 6 0 0 0 9.7 9.7z"/>',
  cloudRain:
    '<path d="M6.5 15.5h11a3.8 3.8 0 0 0 .5-7.6A5.2 5.2 0 0 0 7.8 6.5a4 4 0 0 0-1.3 9z"/><path d="m8.5 18.5-1 2.2M12.5 18.5l-1 2.2M16.5 18.5l-1 2.2"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>',
  fog: '<path d="M4 9h16M3 13.5h18M6 18h12"/>',
  thunder:
    '<path d="M6.5 14.5h11a3.8 3.8 0 0 0 .5-7.6A5.2 5.2 0 0 0 7.8 5.5a4 4 0 0 0-1.3 9z"/><path d="m13 13-3 5h3l-1.5 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',
};

export function getIcon(name: IconName, size = 16): string {
  const path = ICON_PATHS[name];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function createIconEl(name: IconName, size = 16): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'hud-icon';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = getIcon(name, size);
  return span;
}
