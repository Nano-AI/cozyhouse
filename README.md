# Cozyhouse

A calm, private isometric house-builder for the browser where the furniture you place decides what the space is, and visitors react to it.

## Features

- **Storybook Icon-First Interface & Visual Shaders:** Crisp warm-paper & ink UI with two-tone illustrated pastel SVG icons across rooms, time of day (`Running`, `Dawn`, `Day`, `Dusk`, `Night`), weather (`Clear`, `Rain`, `Fog`, `Thunderstorm`, `Snow`), all 6 locations, a glowing lightbulb switch, and 6 switchable full-screen visual shader presets (`Cozy`, `Retro Dither`, `Pocket`, `Storybook Ink`, `Golden Film`, `CRT Lo-Fi`).
- **6 Handcrafted House Presets & 3D Cloud Transitions:** Jump between 6 playable houses (`Alin's Café`, `Neon Club`, `Cat Lounge`, `Farmhouse`, `Beach Retreat`, `Mountain Cabin`) from the Menu or Space picker, or travel between all 6 window locations behind a cinematic 3D cloud-cluster zoom transition while the HUD fades away and returns smoothly.
- **Sims-Style Live Mode, Left-Side Build Sidebar & One-Click Surface Restyling:** Switch cleanly between **Live Mode** (uncluttered viewport where you interact with objects and watch visitors) and **Build Mode** (left-side vertical catalog with 3D preview cards, `Basics` grouped into `Floors`/`Walls`/`Doors`/`Windows`, one-click **`Apply to All Walls`** / **`Apply to All Floors`**, and Shift+Click / marquee multi-select wall & floor restyling in the bottom context bar).
- **Open / Closed Autonomous Guests & Airy Visitor Cards:** Toggle the top-right **Open / Closed** switch so organic visitors drop by automatically through the front door (arriving by car, boat, elevator, or footpath depending on location!), sit *on* couches/chairs/beds, react visibly to Likes and Dislikes, and appear in compact, clutter-free visitor cards with 3D portraits, mood bars, and one-line reactions.
- **Seamless Double Doors, Double Beds & Cutaway Architecture:** Adjacent doors auto-merge into symmetrical double doors; adjacent beds converge cleanly into wide double beds. Front-facing walls automatically turn translucent as you rotate the camera (with click-through to interior items), and enclosed rooms gain a frosted translucent ceiling.
- **145 Sculpted Low-Poly 3D Items & Directional Lot Expansion:** Browse 7 tabs (`Basics`, `Living`, `Kitchen`, `Café`, `Party`, `Decor`, `Pets`) with instanced floor tiles, cached prototype geometry, and directional lot resizing (`8×8` up to `36×36`), plus `Bulk Select` and `Bulk Erase` and **Cinematic Mode** for a HUD-free 360° orbit showcase.
- **Adaptive Themed Music, Separate Weather/Music Audio & Private Shareable Links:** Crossfading background music (`Café`, `House`, `Farm`, `Beach`, `Forest`) with independent storybook ink-rail volume sliders for **Music** and **Weather** ambience (plus Master volume & mute), paired with synthesized foley, celebration chimes, thunder, and gibberish voices. Autosaves to `localStorage`, supports `.cozyhouse.json` Export/Import, and encodes entire houses into compact `#h=...` **Shareable Links**.

## Quick Start

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`).

## Build & Static Deploy

```bash
npm run build
```

This produces static files in `dist/` (including `dist/data/*.json`) using relative asset paths (`base: './'`), ready for GitHub Pages, Netlify, Cloudflare Pages, or any static host. To preview the production build locally:

```bash
npm run preview
```

## Controls (Trackpad-First)

Every action works with a laptop trackpad alone — no right-click-drag and no keyboard required (with `overscroll-behavior: none` preventing accidental browser swipe-back):

- **Live / Build Mode:** Toggle between `Live` and `Build` in the top-center switch (or click `Build` at the bottom in Live Mode).
- **Pan / Zoom / Rotate:** Two-finger scroll or drag empty space to pan; trackpad pinch or `+` / `−` to zoom; `⟲` / `⟳` (`Q` / `E`) to rotate 90°.
- **Left-Side Build Sidebar:** Switch tabs along the left icon rail, filter by subcategory or search, and scroll down through 3D preview cards. Click `Floors`, `Walls`, `Doors`, or `Windows` in `Basics` to pick styles or apply to all floors/walls.
- **Place, Rotate & Edit:** Click any 3D preview card to place; press `R` (or click Rotate) to rotate the live ghost; drag walls/floors to paint continuously; click or drag placed items in Build Mode to move, recolor, swap style, or delete.
- **Atmosphere & Room Label:** Click the top-left Room pill to pick a personal room type or enter a custom name (or leave on `Auto`). Click the illustrated Atmosphere icons to scrub the Time of Day or Weather storybook sliders, switch Locations, flip the Lightbulb switch, or adjust Volume.
- **Open / Closed & Visitors:** Toggle `Open` / `Closed` on the top right to welcome drop-in guests, or open `Visitors` to invite any of the 10 archetypes and inspect their Likes, Dislikes, mood, and thoughts.
- **Share & Save (`⋯` Menu):** Copy a compact `#h=...` **Share Link**, load a friend's share link, Export/Import `.cozyhouse.json`, or restore the Starter house.

## Architecture & Module Boundaries

All content contracts live in `data/*.json` and connect clean TypeScript modules:

- `data/` — Shared JSON contracts (`furniture.json`, `visitors.json`, `dialogue.json`, `room-rules.json`, `scenery.json`).
- `src/models/` — Unified low-poly 3D model kit (`ModelKit.ts`, `TextureKit.ts`, `index.ts`) and per-category sculpted furniture builders (`basicsModels.ts`, `livingModels.ts`, `kitchenModels.ts`, `cafeBarModels.ts`, `partyModels.ts`, `petsModels.ts`, `decorModels.ts`) with adjacent double-door & double-bed merging.
- `src/data/` — TypeScript types (`schemas.ts`) and runtime validator/loader (`loader.ts`).
- `src/state/` — Central reactive `HouseStore` with Live/Build mode, Open/Closed state, running/manual 24h time, wall cutaway/ceiling, directional lot resizing, multi-selection, and undo/redo (`houseStore.ts`, `defaultHouse.ts`).
- `src/engine/` — Three.js `SceneManager` (instanced floor tiles, smart shadow updates, dynamic lights, translucent cutaway walls & ceilings, visitor-triggered doors), `IsometricCamera` (Cinematic Mode), `GridSystem`, `PlacementController`, `AssetLoader`, and `ModelPreviewRenderer`.
- `src/save/` — Compact versioned serializer (`v: 1`), `localStorage` autosave (`storage.ts`), JSON file export/import (`fileIO.ts`), and compressed `#h=...` share links (`shareLink.ts`).
- `src/rooms/` — Tag-rule room evaluator (`RoomEvaluator.ts`).
- `src/visitors/` — 10 diverse visitor archetypes with seated couch/chair/bed slots, front-door routing, themed arrival transport (`ArrivalTransport.ts`), Likes/Dislikes reactions, collision-avoiding pathfinding, and emoji bubbles (`VisitorModule.ts`, `VisitorMesh.ts`, `Pathfinder.ts`, `SpeechBubble.ts`).
- `src/scenery/` — Continuous 24h gradient skyboxes, twinkling starfield, linear drifting clouds, 6 scenic dioramas, living yard grass/butterflies, and weather systems (`SceneryModule.ts`, `SkyDome.ts`, `BackdropBuilder.ts`, `WeatherSystem.ts`).
- `src/audio/` — Synthesized Web Audio foley, weather ambience, celebration chime, thunder, gibberish voice, and volume control (`AudioModule.ts`, `FoleySynth.ts`, `WeatherAmbience.ts`).
- `src/ui/` — Illustrated two-tone storybook SVG icon library (`icons.ts`), icon-first HUD with custom notched ink-rail sliders, location transition curtain, left-side vertical Build Sidebar, and celebration banner (`HudController.ts`, `CelebrationBanner.ts`, `styles.css`).

## Extending Content via Data Files Only

You can add items, visitors, dialogue lines, room rules, or scenery views by editing only the JSON files in `data/` — no TypeScript changes required:

- **Add a furniture item:** Append an object to `items` in `data/furniture.json` with a unique `id`, valid `tab`, `layer` (`"floor" | "wall" | "ceiling" | "surface"`), `footprint: [w, d]`, at least one entry in `variants`, and a `model` path (`models/...glb`).
- **Add a visitor:** Append an entry to `visitors` in `data/visitors.json` with `likedTags`, `dislikedTags`, `preferredInteractions`, and `voiceProfile`.
- **Add dialogue lines:** Add hand-written lines under `default[mood]` or `byVisitor[visitorId][mood]` in `data/dialogue.json`.
- **Add a room rule:** Append a rule to `rules` in `data/room-rules.json` with `priority`, `requiredTags`, `label`, `description`, and `accentColor`.
- **Add a window view or weather:** Append to `views` or `weathers` in `data/scenery.json`.
