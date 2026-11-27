# Cozyhouse

A calm, private isometric house-builder for the browser where the furniture you place decides what the space is, and visitors react to it.

## Features

- **Storybook Icon-First Interface:** Crisp warm-paper & ink UI with two-tone illustrated pastel SVG icons across rooms, time of day (`Running`, `Dawn`, `Day`, `Dusk`, `Night`), weather (`Clear`, `Rain`, `Fog`, `Thunderstorm`, `Snow`), all 6 locations, and a glowing lightbulb switch — replacing cluttered text labels with intuitive tactile storybook controls.
- **Sims-Style Live Mode & Left-Side Vertical Build Sidebar:** Switch cleanly between **Live Mode** (uncluttered viewport where you interact with objects and watch visitors) and **Build Mode** (left-side vertical catalog with an SVG category rail, tab-tailored subcategory pills, 2-column downward-scrolling 3D preview cards, hover-only tooltips, crisp 3D outlines, and toggleable buildable tile grid lines on one flat ground plane).
- **Open / Closed Autonomous Guests, Arrivals & Likes/Dislikes:** Toggle the top-right **Open / Closed** switch so organic visitors drop by automatically through the front door (arriving by car, boat, elevator, or footpath depending on location!), sit *on* couches/chairs/beds, react visibly to both **Likes** (`✓`) and **Dislikes** (`✕`), and show full status cards with 3D portraits, mood progress bars, and cozy thoughts.
- **Seamless Double Doors, Double Beds & Cutaway Architecture:** Adjacent doors auto-merge into symmetrical double doors; adjacent beds converge cleanly into wide double beds. Front-facing walls automatically turn translucent as you rotate the camera (with click-through to interior items), and enclosed rooms gain a frosted translucent ceiling.
- **145 Sculpted Low-Poly 3D Items & Procedural Materials:** Browse 7 tabs (`Basics`, `Living`, `Kitchen`, `Café`, `Party`, `Decor`, `Pets`) with instanced floor tiles, cached prototype geometry, procedural wood/fabric/terrazzo/tile textures, and live 3D isometric thumbnail cards. In `Basics`, structural pieces are consolidated into 4 grouped categories (`Floors`, `Walls`, `Doors`, `Windows`) with an inline style drawer and one-click `Apply All`.
- **Directional Rectangular Lot Expansion & Bulk Tools:** Start on a flat 16×16 lot and expand independently along `North`, `South`, `East`, or `West` (8×8 up to 36×36). Use `Bulk Select` and `Bulk Erase` to restyle, recolor, or remove items in one undoable step.
- **Storybook Atmosphere Controls, Location Transitions & Cinematic Mode:** Use custom notched ink-rail sliders for live running/scrubbable **Time of Day** and **Weather**, illustrated icon switches for all 6 **Locations** (with a charming animated travel curtain!), a **Lightbulb Switch** for room lights, and **Cinematic Mode** for a HUD-free slow 360° orbit showcase.
- **Synthesized Web Audio, Volume Rail & Private Shareable Links:** Procedural Web Audio foley, weather ambience, celebration chimes, thunder, and gibberish voice with a mute button and matching storybook Volume rail. Autosaves to `localStorage`, supports `.cozyhouse.json` file Export/Import, and encodes entire houses into compact `#h=...` **Shareable Links** (nothing is uploaded to a server!).

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
