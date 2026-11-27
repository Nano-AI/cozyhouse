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
  | 'close'
  | 'check'
  | 'back';

export type StorybookIconName =
  // Time of Day (5)
  | 'time_running'
  | 'time_dawn'
  | 'time_day'
  | 'time_dusk'
  | 'time_night'
  // Weather (5)
  | 'weather_clear'
  | 'weather_rain'
  | 'weather_fog'
  | 'weather_thunderstorm'
  | 'weather_snow'
  // Locations (6)
  | 'loc_suburbs'
  | 'loc_city'
  | 'loc_beach'
  | 'loc_forest'
  | 'loc_mountains'
  | 'loc_countryside'
  // Lights & Music (4)
  | 'bulb_on'
  | 'bulb_off'
  | 'music_on'
  | 'music_off'
  // Wall Visibility Modes (3)
  | 'wall_auto'
  | 'wall_translucent'
  | 'wall_solid'
  // Share Studio (1)
  | 'polaroid'
  // Visual Shaders (6)
  | 'shader_default'
  | 'shader_retro_dither'
  | 'shader_pocket'
  | 'shader_storybook_ink'
  | 'shader_golden_film'
  | 'shader_crt_lofi'
  // Room Types & Presets (18)
  | 'room_cafe'
  | 'room_live_in_cafe'
  | 'room_cat_cafe'
  | 'room_bar'
  | 'room_book_cafe'
  | 'room_party_pad'
  | 'room_smoothie_bar'
  | 'room_diner'
  | 'room_cat_sanctuary'
  | 'room_night_lounge'
  | 'room_plant_haven'
  | 'room_music_lounge'
  | 'room_reading_nook'
  | 'room_home_kitchen'
  | 'room_beach'
  | 'room_cabin'
  | 'room_home'
  | 'room_custom';

const INK = '#2D2620';

const ICON_PATHS: Record<IconName, string> = {
  brand:
    '<path d="M3 10.2 12 3l9 7.2"/><path d="M5.5 9.2V20h13V9.2"/><path d="M9.8 20v-5.5h4.4V20"/>',
  live: '<polygon points="7,4.5 19,12 7,19.5"/>',
  build:
    '<path d="m14.8 4.2 5 5-9.8 9.8-5.6 1 1-5.6 9.4-10.2z"/><path d="m12.8 6.2 5 5"/>',

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
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',
};

/**
 * Illustrated two-tone storybook SVG icons: soft pastel fills + crisp dark-ink strokes.
 */
const STORYBOOK_SHAPES: Record<StorybookIconName, string> = {
  // ── Time of Day (5) ──
  time_running: `
    <circle cx="9.2" cy="11.5" r="4.2" fill="#FFD966" stroke="${INK}" stroke-width="1.8"/>
    <path d="M9.2 4.6v1.3M4.3 6.6l.9.9M2.8 11.5h1.3M4.3 16.4l.9-.9M9.2 17.1v1.3" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M18.8 14.8a5.2 5.2 0 0 1-5.8-7.4 5.5 5.5 0 1 0 5.8 7.4z" fill="#FCE59B" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="18.6" cy="7.2" r="1.05" fill="#FFD966" stroke="${INK}" stroke-width="1.1"/>
  `,
  time_dawn: `
    <path d="M5.5 16.5a6.5 6.5 0 0 1 13 0z" fill="#F8B4BA" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 5.4v2.1M6.6 8.2l1.4 1.4M17.4 8.2l-1.4 1.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M3 16.5h18M6.5 19.6h11" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  time_day: `
    <circle cx="12" cy="12" r="4.8" fill="#FFD966" stroke="${INK}" stroke-width="1.8"/>
    <path d="M12 3.3v2.1M12 18.6v2.1M3.3 12h2.1M18.6 12h2.1M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  time_dusk: `
    <path d="M5.5 15.8a6.5 6.5 0 0 1 13 0z" fill="#F6B88D" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 6.8v2M7.2 9.4l1.3 1.1M16.8 9.4l-1.3 1.1" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M3 15.8h18" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M6.8 18.8c1.5.9 3.2.9 5.2 0 2-.9 3.7-.9 5.2 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
  `,
  time_night: `
    <path d="M18.6 14.5A6.8 6.8 0 0 1 9.5 5.4a7.1 7.1 0 1 0 9.1 9.1z" fill="#FCE59B" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M16.8 5.2v2.4M15.6 6.4h2.4" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="19.6" cy="9.6" r="1.05" fill="#FFD966" stroke="${INK}" stroke-width="1.1"/>
  `,

  // ── Weather (5) ──
  weather_clear: `
    <circle cx="12" cy="12" r="5" fill="#FFD966" stroke="${INK}" stroke-width="1.8"/>
    <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  weather_rain: `
    <path d="M6.8 14.8h10.8a3.6 3.6 0 0 0 .5-7.1A5 5 0 0 0 8.2 6.5a3.9 3.9 0 0 0-1.4 8.3z" fill="#CBE3F8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8.5 17.5l-1 2.7M12.5 17.5l-1 2.7M16.5 17.5l-1 2.7" stroke="#4B8AC7" stroke-width="2" stroke-linecap="round"/>
  `,
  weather_fog: `
    <path d="M7.2 12.2h10a3.2 3.2 0 0 0 .4-6.3 4.5 4.5 0 0 0-8.6-1 3.4 3.4 0 0 0-1.8 7.3z" fill="#E1E7EB" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M4.2 15.6h15.6M6 18.8h12" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  weather_thunderstorm: `
    <path d="M6.6 13.8h11a3.5 3.5 0 0 0 .5-7 4.9 4.9 0 0 0-9.7-1A3.7 3.7 0 0 0 6.6 13.8z" fill="#B8C3D9" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <polygon points="13.2,11.6 9.5,16.8 12.3,16.8 10.8,21.2 15.6,15.2 12.7,15.2" fill="#FFD966" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
  `,
  weather_snow: `
    <circle cx="12" cy="12" r="2.6" fill="#C7E6FA" stroke="${INK}" stroke-width="1.6"/>
    <path d="M12 3.5v5.9M12 14.6v5.9M4.6 7.8l5.1 2.9M14.3 13.3l5.1 2.9M19.4 7.8l-5.1 2.9M9.7 13.3l-5.1 2.9" stroke="${INK}" stroke-width="1.75" stroke-linecap="round"/>
    <circle cx="12" cy="4.2" r="1.1" fill="#A9D7F5"/>
    <circle cx="12" cy="19.8" r="1.1" fill="#A9D7F5"/>
  `,

  // ── Locations / Window Views (6) ──
  loc_suburbs: `
    <path d="M3.5 19.5h17" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="4.8" y="11" width="9.8" height="8.5" rx="1" fill="#FCF3E3" stroke="${INK}" stroke-width="1.7"/>
    <polygon points="3.6,11.4 9.7,6 15.8,11.4" fill="#F0A590" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <rect x="8.2" y="14.4" width="3" height="5.1" rx="0.6" fill="#D5A680" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="18.2" cy="13.2" r="3.1" fill="#A7D3AD" stroke="${INK}" stroke-width="1.6"/>
    <path d="M18.2 16.3v3.2" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
  `,
  loc_city: `
    <rect x="3.8" y="10.2" width="5.2" height="9.8" rx="0.8" fill="#F2C7B8" stroke="${INK}" stroke-width="1.7"/>
    <rect x="9" y="4.5" width="6.2" height="15.5" rx="0.8" fill="#B8D2EC" stroke="${INK}" stroke-width="1.7"/>
    <rect x="15.2" y="8.4" width="5" height="11.6" rx="0.8" fill="#D1C4EA" stroke="${INK}" stroke-width="1.7"/>
    <path d="M11 7.6h2.2M11 10.6h2.2M11 13.6h2.2M5.8 13.2h1.2M17.2 11.4h1.1M17.2 14.4h1.1" stroke="#FFF3B0" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2.5 20h19" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  loc_beach: `
    <circle cx="17.8" cy="6.6" r="2.4" fill="#FFD966" stroke="${INK}" stroke-width="1.5"/>
    <polygon points="11.2,6.4 11.2,14 6,14" fill="#F4A896" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <polygon points="11.2,8 15.2,14 11.2,14" fill="#FFFDF8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M5 14.4h11l-1.4 2.8H6.4z" fill="#E3B387" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M3 18.8c2.2-1.2 4.2-1.2 6.2 0s4 1.2 6 0 3.8-1.2 5.8 0" fill="none" stroke="#4D9AC4" stroke-width="2" stroke-linecap="round"/>
  `,
  loc_forest: `
    <polygon points="8.5,5.2 4.2,12.5 12.8,12.5" fill="#9BCAA3" stroke="${INK}" stroke-width="1.65" stroke-linejoin="round"/>
    <polygon points="8.5,9.5 3.6,17 13.4,17" fill="#7FB88C" stroke="${INK}" stroke-width="1.65" stroke-linejoin="round"/>
    <polygon points="16.4,7.4 12.6,14 20.2,14" fill="#B2D9B4" stroke="${INK}" stroke-width="1.65" stroke-linejoin="round"/>
    <polygon points="16.4,11.2 12.2,17.5 20.6,17.5" fill="#8DC398" stroke="${INK}" stroke-width="1.65" stroke-linejoin="round"/>
    <path d="M8.5 17v2.8M16.4 17.5v2.3M3 19.8h18" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  loc_mountains: `
    <polygon points="3,19.2 9.8,6.5 16.6,19.2" fill="#BFCFE3" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <polygon points="9.8,6.5 7.4,11 9.8,9.8 12.2,11" fill="#FFFDF8" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <polygon points="11.5,19.2 16.5,9.8 21.5,19.2" fill="#D5DFEC" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <polygon points="16.5,9.8 14.8,13 16.5,12.1 18.2,13" fill="#FFFDF8" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="5.6" cy="6.6" r="1.9" fill="#FFD966" stroke="${INK}" stroke-width="1.4"/>
  `,
  loc_countryside: `
    <path d="M2.5 19.5Q8.5 13.5 15 17.2Q18.8 15 21.5 19.5z" fill="#C9DDA2" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="6.5" y="10.8" width="7.8" height="7.6" rx="0.8" fill="#EB9C8E" stroke="${INK}" stroke-width="1.65"/>
    <polygon points="5.5,11.2 10.4,6.4 15.3,11.2" fill="#D97A6C" stroke="${INK}" stroke-width="1.65" stroke-linejoin="round"/>
    <path d="M8.8 18.4v-4.2h3.2v4.2M8.8 14.2l3.2 4.2" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="18.2" cy="7.4" r="2.2" fill="#FFD966" stroke="${INK}" stroke-width="1.5"/>
  `,

  // ── Lights & Music Switches (4) ──
  bulb_on: `
    <path d="M9.4 17.2h5.2M10.2 20h3.6" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 5.4a5.2 5.2 0 0 0-3.1 9.4c.7.6 1 1.3 1 2.3h4.2c0-1 .3-1.7 1-2.3A5.2 5.2 0 0 0 12 5.4z" fill="#FFD966" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 2.2v1.3M4.4 6.2l1.2.8M19.6 6.2l-1.2.8M3.2 11.4h1.5M19.3 11.4h1.5" stroke="#D99422" stroke-width="1.8" stroke-linecap="round"/>
  `,
  bulb_off: `
    <path d="M9.4 17.2h5.2M10.2 20h3.6" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 5.4a5.2 5.2 0 0 0-3.1 9.4c.7.6 1 1.3 1 2.3h4.2c0-1 .3-1.7 1-2.3A5.2 5.2 0 0 0 12 5.4z" fill="#EFE7D8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  `,
  music_on: `
    <path d="M10 16.8V6.2l9-1.7v10.2" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 9.6l9-1.7" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="7.6" cy="17.2" rx="2.8" ry="2.2" fill="#F4B29D" stroke="${INK}" stroke-width="1.7"/>
    <ellipse cx="16.6" cy="15.2" rx="2.8" ry="2.2" fill="#FFD966" stroke="${INK}" stroke-width="1.7"/>
    <circle cx="5.2" cy="6.2" r="1.1" fill="#FFD966" stroke="${INK}" stroke-width="1.1"/>
  `,
  music_off: `
    <path d="M10 16.8V6.2l8.5-1.6v9.8" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="7.6" cy="17.2" rx="2.6" ry="2" fill="#EFE7D8" stroke="${INK}" stroke-width="1.7"/>
    <ellipse cx="16.2" cy="15.2" rx="2.6" ry="2" fill="#EFE7D8" stroke="${INK}" stroke-width="1.7"/>
    <path d="M4.2 4.6 19.8 19.4" stroke="#A82D24" stroke-width="1.9" stroke-linecap="round"/>
  `,

  // ── Wall Visibility Modes (3) ──
  wall_auto: `
    <polygon points="12,12.5 20,16.5 12,20.5 4,16.5" fill="#F6E9D2" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <polygon points="4,8.2 12,4.2 12,12.5 4,16.5" fill="#EAC8A8" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <polygon points="12,4.2 20,8.2 20,16.5 12,12.5" fill="#DFB28C" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <polygon points="4,13 12,17 12,20.5 4,16.5" fill="#9ED3F5" fill-opacity="0.55" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2.4 1.8" stroke-linejoin="round"/>
    <polygon points="12,17 20,13 20,16.5 12,20.5" fill="#9ED3F5" fill-opacity="0.45" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2.4 1.8" stroke-linejoin="round"/>
  `,
  wall_translucent: `
    <polygon points="12,12.6 20,16.6 12,20.6 4,16.6" fill="#F6E9D2" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="9.8" y="13.2" width="4.4" height="3.2" rx="0.8" fill="#E8A28B" stroke="${INK}" stroke-width="1.3"/>
    <polygon points="4,8 12,4 20,8 20,16.6 12,20.6 4,16.6" fill="#9FD6F7" fill-opacity="0.4" stroke="${INK}" stroke-width="1.75" stroke-dasharray="2.6 2" stroke-linejoin="round"/>
    <path d="M12,12.4v8.2M4,8l8,4.4L20,8" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="2.4 2" stroke-linecap="round"/>
  `,
  wall_solid: `
    <polygon points="4,8 12,4 20,8 12,12" fill="#F4C7B7" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <polygon points="4,8 12,12 12,20.5 4,16.5" fill="#E69A83" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <polygon points="12,12 20,8 20,16.5 12,20.5" fill="#D47E66" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="M4,12.2 12,16.2 20,12.2M8,10v4.2M16,14v4.2" fill="none" stroke="${INK}" stroke-width="1.35" stroke-linecap="round"/>
  `,

  // ── Share Polaroid Camera (1) ──
  polaroid: `
    <rect x="3" y="5.4" width="18" height="14.2" rx="3" fill="#FCF3E3" stroke="${INK}" stroke-width="1.8"/>
    <path d="M3.8 14.2h16.4v2.4H3.8z" fill="#ED9E8A"/>
    <path d="M3.8 14.2h16.4M3.8 16.6h16.4" stroke="${INK}" stroke-width="1.25"/>
    <circle cx="12" cy="11.4" r="3.9" fill="#A9D8F5" stroke="${INK}" stroke-width="1.75"/>
    <circle cx="10.8" cy="10.2" r="1.1" fill="#FFFDF8"/>
    <rect x="15.8" y="7.2" width="2.8" height="2.2" rx="0.6" fill="#FFD966" stroke="${INK}" stroke-width="1.2"/>
    <path d="M6.4 5.4V4.2h3.4v1.2" fill="#E6C2A3" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
  `,

  // ── Visual Shaders (6) ──
  shader_default: `
    <circle cx="12" cy="12" r="7.4" fill="#FCF3E3" stroke="${INK}" stroke-width="1.8"/>
    <circle cx="9.6" cy="10" r="2.6" fill="#FFD966" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="14.8" cy="14" r="2.2" fill="#F4B29D" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="15" cy="9" r="1.4" fill="#A7D3AD" stroke="${INK}" stroke-width="1.2"/>
  `,
  shader_retro_dither: `
    <rect x="4" y="4" width="16" height="16" rx="3" fill="#E8D8F5" stroke="${INK}" stroke-width="1.8"/>
    <rect x="6.5" y="6.5" width="3.5" height="3.5" fill="#9E87C9" stroke="${INK}" stroke-width="1.1"/>
    <rect x="14" y="6.5" width="3.5" height="3.5" fill="#F4B29D" stroke="${INK}" stroke-width="1.1"/>
    <rect x="10.25" y="10.25" width="3.5" height="3.5" fill="#FFD966" stroke="${INK}" stroke-width="1.1"/>
    <rect x="6.5" y="14" width="3.5" height="3.5" fill="#A7D3AD" stroke="${INK}" stroke-width="1.1"/>
    <rect x="14" y="14" width="3.5" height="3.5" fill="#9E87C9" stroke="${INK}" stroke-width="1.1"/>
  `,
  shader_pocket: `
    <rect x="5.5" y="3.2" width="13" height="17.6" rx="2.4" fill="#C9DCB4" stroke="${INK}" stroke-width="1.8"/>
    <rect x="7.8" y="5.5" width="8.4" height="6.2" rx="1" fill="#7D9E6C" stroke="${INK}" stroke-width="1.5"/>
    <path d="M9.5 14.5v3M8 16h3" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="15" cy="15.2" r="1.1" fill="#D97A6C" stroke="${INK}" stroke-width="1.1"/>
    <circle cx="13.5" cy="17.4" r="1.1" fill="#D97A6C" stroke="${INK}" stroke-width="1.1"/>
  `,
  shader_storybook_ink: `
    <path d="M18.6 4.4 19.6 5.4 9.8 15.2 5.4 16.6 6.8 12.2z" fill="#FCE59B" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="M15.4 7.6 16.4 8.6" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M4.2 19.4c2.4-1.3 4.4-.2 6.8-.2 2.4 0 4.6-1.2 8.4-.4" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  shader_golden_film: `
    <rect x="3.5" y="5" width="17" height="14" rx="2.2" fill="#F6D58E" stroke="${INK}" stroke-width="1.8"/>
    <rect x="7.6" y="7.5" width="8.8" height="9" rx="1" fill="#FFF4D1" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="2.2" fill="#F0A57D" stroke="${INK}" stroke-width="1.4"/>
    <path d="M5.5 8v1.4M5.5 11.3v1.4M5.5 14.6V16M18.5 8v1.4M18.5 11.3v1.4M18.5 14.6V16" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
  `,
  shader_crt_lofi: `
    <rect x="3.5" y="5.2" width="17" height="13.2" rx="3" fill="#B8C8DF" stroke="${INK}" stroke-width="1.8"/>
    <rect x="5.8" y="7.4" width="10.2" height="8.8" rx="1.6" fill="#DCECF8" stroke="${INK}" stroke-width="1.5"/>
    <path d="M7.2 10h7.4M7.2 12.5h7.4M7.2 14.8h5.2" stroke="#6E90B8" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="18.2" cy="9.4" r="0.9" fill="#F4A896" stroke="${INK}" stroke-width="1"/>
    <circle cx="18.2" cy="12.4" r="0.9" fill="#FFD966" stroke="${INK}" stroke-width="1"/>
    <path d="M7.5 18.4 6.5 20.4M16.5 18.4l1 2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,

  // ── Room Types (Illustrated Pastel + Ink) ──
  room_cafe: `
    <path d="M4.8 10h11v5.2a4.4 4.4 0 0 1-4.4 4.4H9.2a4.4 4.4 0 0 1-4.4-4.4V10z" fill="#E6C2A3" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M15.8 11.3h1.9a2.2 2.2 0 0 1 0 4.4h-1.9" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 5.2c0 1.2 1 1.4 1 2.5M12 5.2c0 1.2 1 1.4 1 2.5" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
  `,
  room_live_in_cafe: `
    <polygon points="3.5,9.5 12,3.6 20.5,9.5" fill="#EDAA96" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M6.4 11h8.8v4.8a3.6 3.6 0 0 1-3.6 3.6H10a3.6 3.6 0 0 1-3.6-3.6V11z" fill="#E6C2A3" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M15.2 12.2h1.6a1.8 1.8 0 0 1 0 3.6h-1.6" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
  `,
  room_cat_cafe: `
    <path d="M5.5 10.6 6.8 6.5 9.8 9a6.4 6.4 0 0 1 4.4 0l3-2.5 1.3 4.1" fill="#F5C0CD" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M5.4 10.6h13.2v4.6a4.4 4.4 0 0 1-4.4 4.4H9.8a4.4 4.4 0 0 1-4.4-4.4v-4.6z" fill="#F5C0CD" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <circle cx="9.6" cy="14" r="1" fill="${INK}"/><circle cx="14.4" cy="14" r="1" fill="${INK}"/>
  `,
  room_bar: `
    <polygon points="5.2,6.2 18.8,6.2 12,13.6" fill="#D5C2EE" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 13.6v6M8.5 19.6h7" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="16.8" cy="5.8" r="2.2" fill="#FFD966" stroke="${INK}" stroke-width="1.4"/>
  `,
  room_book_cafe: `
    <path d="M3.5 7.5c2.8-.9 5.8-.9 8.5.8 2.7-1.7 5.7-1.7 8.5-.8v11c-2.8-.9-5.8-.9-8.5.8-2.7-1.7-5.7-1.7-8.5-.8v-11z" fill="#C4DCF0" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 8.3v11" stroke="${INK}" stroke-width="1.6"/>
  `,
  room_party_pad: `
    <path d="M12 3v3" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="12.5" r="6.4" fill="#D8C4F2" stroke="${INK}" stroke-width="1.8"/>
    <path d="M6 12.5h12M12 6.1v12.8M8.5 7.3c1 3.4 1 7 0 10.4M15.5 7.3c-1 3.4-1 7 0 10.4" fill="none" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="18.8" cy="6.4" r="1.4" fill="#FFD966" stroke="${INK}" stroke-width="1.1"/>
  `,
  room_smoothie_bar: `
    <path d="M7.4 9.6h9.2l-1.2 10H8.6l-1.2-10z" fill="#F6C59C" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M6.4 9.6a5.6 5.6 0 0 1 11.2 0z" fill="#FBE5D1" stroke="${INK}" stroke-width="1.7"/>
    <path d="M12.2 9.6V4.2l3.4-.9" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  `,
  room_diner: `
    <path d="M4.5 15a7.5 7.5 0 0 1 15 0z" fill="#F0B1A6" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="6.8" r="1.5" fill="#FFD966" stroke="${INK}" stroke-width="1.5"/>
    <path d="M3 18h18" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  `,
  room_cat_sanctuary: `
    <path d="M5 12.5 6.4 6.5 10 9.4a6.4 6.4 0 0 1 4 0l3.6-2.9 1.4 6a6.8 6.8 0 0 1-14 0z" fill="#F6C2CE" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8.8 13.8c.5.6 1.3.6 1.8 0M13.4 13.8c.5.6 1.3.6 1.8 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
  `,
  room_night_lounge: `
    <path d="M17.5 14.5A6.2 6.2 0 0 1 9.5 6a6.4 6.4 0 1 0 8 8.5z" fill="#B5C0E8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="17.8" cy="7" r="1.8" fill="#FFD966" stroke="${INK}" stroke-width="1.3"/>
  `,
  room_plant_haven: `
    <path d="M8 14h8l-1.1 5.6H9.1L8 14z" fill="#E39D85" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12 14V7.5M12 12c-3.8 0-6.2-2.2-6.2-5.4 3.5 0 6.2 2 6.2 5.4zM12 10.6c3.8 0 6.2-2.2 6.2-5.4-3.5 0-6.2 2-6.2 5.4z" fill="#9ECDA7" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  `,
  room_music_lounge: `
    <circle cx="12" cy="12" r="7.6" fill="#C9BCE8" stroke="${INK}" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="2.7" fill="#F2A794" stroke="${INK}" stroke-width="1.6"/>
  `,
  room_reading_nook: `
    <rect x="4.5" y="13.5" width="15" height="5" rx="1.2" fill="#BBD5ED" stroke="${INK}" stroke-width="1.7"/>
    <rect x="6" y="8" width="12.5" height="5.2" rx="1.2" fill="#F4C7B7" stroke="${INK}" stroke-width="1.7"/>
    <path d="M8.5 10.6h5.5M7.5 16h6.5" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
  `,
  room_home_kitchen: `
    <rect x="5" y="10.2" width="14" height="8.2" rx="2.5" fill="#F5DC93" stroke="${INK}" stroke-width="1.8"/>
    <path d="M3.5 11.8h1.5M19 11.8h1.5M9.5 6.4v2M14.5 6.4v2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
  `,
  room_beach: `
    <path d="M4.2 11.6a8 8 0 0 1 15.6 0z" fill="#F4A896" stroke="${INK}" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="M9.4 11.6c.4-3.6 1.5-5.8 2.6-6.2 1.1.4 2.2 2.6 2.6 6.2z" fill="#FFFDF8" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M12 11.6v6.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M3 19c2.2-1.1 4.2-1.1 6.2 0s4 1.1 6 0 3.8-1.1 5.8 0" fill="none" stroke="#4D9AC4" stroke-width="2" stroke-linecap="round"/>
  `,
  room_cabin: `
    <polygon points="3.5,19 12,5 20.5,19" fill="#D5A680" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <polygon points="12,5 8.8,10.2 12,9 15.2,10.2" fill="#FFFDF8" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="9.6" y="13.5" width="4.8" height="5.5" rx="0.8" fill="#FFD966" stroke="${INK}" stroke-width="1.5"/>
  `,
  room_home: `
    <rect x="5.4" y="10.6" width="13.2" height="9" rx="1.2" fill="#FCF0DE" stroke="${INK}" stroke-width="1.8"/>
    <polygon points="3.5,11.2 12,4.4 20.5,11.2" fill="#EBAA93" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <rect x="9.8" y="13.8" width="4.4" height="5.8" rx="0.8" fill="#FFD966" stroke="${INK}" stroke-width="1.5"/>
  `,
  room_custom: `
    <polygon points="12,4.2 14.3,9.2 19.8,9.8 15.6,13.5 16.8,19 12,16.1 7.2,19 8.4,13.5 4.2,9.8 9.7,9.2" fill="#FFD966" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  `,
};

export function getRoomStorybookIconName(roomId: string): StorybookIconName {
  switch (roomId) {
    case 'live_in_cafe':
    case 'room_live_in_cafe':
      return 'room_live_in_cafe';
    case 'cat_cafe':
    case 'room_cat_cafe':
      return 'room_cat_cafe';
    case 'live_in_bar':
    case 'bar':
    case 'room_bar':
      return 'room_bar';
    case 'book_cafe':
    case 'room_book_cafe':
      return 'room_book_cafe';
    case 'party_pad':
    case 'club':
    case 'room_club':
    case 'room_party_pad':
      return 'room_party_pad';
    case 'smoothie_bar':
    case 'room_smoothie_bar':
      return 'room_smoothie_bar';
    case 'diner':
    case 'neighborhood_diner':
    case 'room_diner':
      return 'room_diner';
    case 'cafe':
    case 'room_cafe':
      return 'room_cafe';
    case 'cat_sanctuary':
    case 'cat_lounge':
    case 'room_cats':
    case 'room_cat_sanctuary':
      return 'room_cat_sanctuary';
    case 'night_lounge':
    case 'room_night_lounge':
      return 'room_night_lounge';
    case 'plant_haven':
    case 'room_plant_haven':
      return 'room_plant_haven';
    case 'music_lounge':
    case 'room_music_lounge':
      return 'room_music_lounge';
    case 'reading_nook':
    case 'room_reading_nook':
      return 'room_reading_nook';
    case 'home_kitchen':
    case 'farmhouse':
    case 'room_kitchen':
    case 'room_home_kitchen':
      return 'room_home_kitchen';
    case 'beach_loft':
    case 'beach_retreat':
    case 'room_beach':
      return 'room_beach';
    case 'mountain_cabin':
    case 'cabin':
    case 'room_cabin':
      return 'room_cabin';
    case 'home':
    case 'room_home':
    case 'cozy_room':
    case 'cozy_lounge':
      return 'room_home';
    default:
      return 'room_custom';
  }
}

export function getShaderStorybookIconName(shaderId: string): StorybookIconName {
  switch (shaderId) {
    case 'retro_dither':
      return 'shader_retro_dither';
    case 'pocket':
      return 'shader_pocket';
    case 'storybook_ink':
      return 'shader_storybook_ink';
    case 'golden_film':
      return 'shader_golden_film';
    case 'crt_lofi':
      return 'shader_crt_lofi';
    default:
      return 'shader_default';
  }
}

export function getWallViewStorybookIconName(mode: string): StorybookIconName {
  switch (mode) {
    case 'translucent':
      return 'wall_translucent';
    case 'solid':
      return 'wall_solid';
    default:
      return 'wall_auto';
  }
}

export function getLocationStorybookIconName(viewId: string): StorybookIconName {
  switch (viewId) {
    case 'city':
      return 'loc_city';
    case 'beach':
      return 'loc_beach';
    case 'forest':
      return 'loc_forest';
    case 'mountains':
      return 'loc_mountains';
    case 'countryside':
      return 'loc_countryside';
    default:
      return 'loc_suburbs';
  }
}

export function getWeatherStorybookIconName(weatherId: string): StorybookIconName {
  switch (weatherId) {
    case 'rain':
      return 'weather_rain';
    case 'fog':
      return 'weather_fog';
    case 'thunderstorm':
      return 'weather_thunderstorm';
    case 'snow':
      return 'weather_snow';
    default:
      return 'weather_clear';
  }
}

export function getIcon(name: IconName, size = 16): string {
  const path = ICON_PATHS[name];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
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

export function getStorybookIcon(name: StorybookIconName, size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true">${STORYBOOK_SHAPES[name]}</svg>`;
}

export function createStorybookIconEl(name: StorybookIconName, size = 22): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'sb-icon';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = getStorybookIcon(name, size);
  return span;
}
