# Cozyhouse

A calm, private isometric house-builder for the browser where the furniture you place decides what the space is, and visitors react to it.

## Features

- **Sims-Style Live Mode & Left-Side Vertical Build Sidebar:** Switch cleanly between **Live Mode** (uncluttered viewport where you interact with objects and watch visitors) and **Build Mode** (left-side vertical catalog with a crisp SVG category rail, tab-tailored subcategory pills, 2-column downward-scrolling 3D preview cards, hover-only tooltips, crisp 3D outlines, and toggleable buildable tile grid lines on one flat ground plane).
- **Enclosed 4-Wall Starter House, Translucent Cutaway Walls & Automatic Ceilings:** Your starter café is fully enclosed on all 4 sides. Front-facing walls automatically turn softly translucent as you rotate the isometric camera (with click-through to interior items!), and enclosed rooms gain a crisp frosted translucent ceiling — cycle between `Auto`, `Translucent`, and `Solid` walls or toggle `Ceiling On/Off` from the top bar, Atmosphere popover, or Lot Size popover.
- **145 Sculpted Low-Poly 3D Items & Procedural Materials:** Browse 7 tabs (`Basics`, `Living`, `Kitchen`, `Café`, `Party`, `Decor`, `Pets`) with instanced floor tiles, cached prototype geometry, procedural wood/fabric/terrazzo/tile textures, and live 3D isometric thumbnail cards. In `Basics`, structural pieces are consolidated into 4 grouped categories (`Floors`, `Walls`, `Doors`, `Windows`) with an inline style drawer and one-click `Apply All Floors` / `Apply All Walls`.
- **Directional Rectangular Lot Expansion:** Start on a flat 16×16 lot and expand or shrink independently along `North`, `South`, `East`, or `West` (or via Width × Depth steppers from 8×8 up to 36×36).
- **Bulk Select & Bulk Erase:** Click or drag a marquee box to multi-select items, quick-select `All Walls` / `All Floors` / `Same Type`, swap wall/floor styles, recolor in bulk, or sweep across items with filtered `Bulk Erase` (`All`, `Floors`, `Walls`, `Furniture`).
- **Continuous 24-Hour Time Slider, Dynamic Lights & Cinematic Mode:** Scrub smoothly across all 24 hours (`Dawn` → `Noon` → `Sunset` → `Night`) with continuous sun/moon arcs, twinkling night stars, glowing skyline/neighborhood windows, real projecting 3D lamp light pools, rotating disco/spotlight rigs, `All Lights On`/`Off`, and **Cinematic Mode** slow 360° orbit showcase (`Esc` or `Exit Cinematic` returns).
- **Interactive Everything & Linked DJ/Music Synergy:** Click interactive items to trigger reactions — lamps and neon signs cast real light pools, disco balls and spotlights spin colored projections, doors swing open, and toggling a DJ booth, jukebox, or record player syncs nearby speakers and party lights with cozy synth grooves.
- **Dynamic Room-Type Evaluation & Celebration:** Furniture tags automatically classify your house (`Café`, `Live-in Café`, `Cat Café`, `Bar`, `Live-in Bar`, `Smoothie Bar`, `Retro Diner`, `Party Pad`, `Plant Haven`, `Reading Nook`, `Home`, and more) with a pastel celebration banner and confetti burst, plus manual room override.
- **6 Scenic Window Views & 5 Weathers:** Swap between `Suburbs` (continuous fenced neighborhood), `City` (elevated high-rise apartment floor in an urban skyline), `Beach` (animated rolling waves), `Forest`, `Mountains` (dramatic peaks with an animated winding river), and `Countryside` (rolling meadows & swaying grass) with procedural gradient skyboxes, linear drifting clouds, and `Clear`, `Rain`, `Snow`, `Fog`, or `Thunderstorm` weather.
- **10 Diverse Visitor Archetypes & Rich Visitor Status Panel:** Invite 10 diverse archetypes (`Bookworm`, `Coffee Snob`, `Cat Person`, `Party-Goer`, `Plant Lover`, `Night Owl`, `Foodie`, `Artist`, `Musician`, `Homebody`) with personal names, pronouns, 3D profile portraits + archetype badges, live mood progress bars, matched-interest checkmarks, cozy thought quotes, collision-avoiding pathfinding, and emoji emotion bubbles.
- **Synthesized Web Audio, Volume Control & Private Shareable Links:** Procedural Web Audio foley, weather ambience, celebration chimes, thunder, and gibberish voice with mute toggle and 0–100% Volume slider. Autosaves to `localStorage`, supports `.cozyhouse.json` file Export/Import, and encodes entire houses into compact `#h=...` **Shareable Links** (nothing is uploaded to a server!).

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

- **Live / Build Mode:** Toggle between `Live` and `Build` in the top-center switch (or click `Build & Decorate` at the bottom in Live Mode).
- **Pan:** Two-finger scroll, or click-and-drag on empty space.
- **Zoom:** Trackpad pinch (or `+` / `−` buttons in the top bar).
- **Rotate view (90° steps):** `⟲` / `⟳` buttons (optional keys: `Q` / `E`).
- **Left-Side Build Sidebar:** Switch tabs along the left SVG icon rail, filter by subcategory or search, and scroll down through the 2-column 3D preview grid. Click `Floors`, `Walls`, `Doors`, or `Windows` in `Basics` to expand styles and `Apply All Floors` / `Apply All Walls`.
- **Place & Edit Furniture:** Click any 3D preview card to place; click-and-drag walls/floor tiles to paint continuously. In Build Mode, hover items for name-only tooltips and 3D outlines; click to select or drag directly to reposition.
- **Lot Size, Grid & Walls/Ceiling:** Click `Lot Size` in the Build Toolbar to expand `North`, `South`, `East`, or `West` independently, toggle grid tiles (`Grid`), or switch wall cutaway (`Auto` / `Translucent` / `Solid`) and `Ceiling On/Off`.
- **Bulk Select & Bulk Erase:** Use `Bulk` to click or drag-box multiple items (`All Walls` / `All Floors` / `Same Type`, swap styles, recolor, delete) or `Erase` to sweep across `All`, `Floors`, `Walls`, or `Furniture`.
- **24-Hour Atmosphere, Visitors, Volume & Share Links:** Use the Atmosphere pill for the 24h Time Slider, views, weather, lights, and volume; use `Visitors` for live status cards & invites; use `⋯` House Menu for **Copy Share Link**, **Import from Link**, Export/Import `.cozyhouse.json`, Starter, and Clear.

## Architecture & Module Boundaries

All content contracts live in `data/*.json` and connect clean TypeScript modules:

- `data/` — Shared JSON contracts (`furniture.json`, `visitors.json`, `dialogue.json`, `room-rules.json`, `scenery.json`).
- `src/models/` — Unified low-poly 3D model kit (`ModelKit.ts`, `TextureKit.ts`, `index.ts`) and per-category sculpted furniture builders (`basicsModels.ts`, `livingModels.ts`, `kitchenModels.ts`, `cafeBarModels.ts`, `partyModels.ts`, `petsModels.ts`, `decorModels.ts`).
- `src/data/` — TypeScript types (`schemas.ts`) and runtime validator/loader (`loader.ts`).
- `src/state/` — Central reactive `HouseStore` with Live/Build mode, 24h time, wall cutaway/ceiling, directional lot resizing, multi-selection, and undo/redo (`houseStore.ts`, `defaultHouse.ts`).
- `src/engine/` — Three.js `SceneManager` (instanced floor tiles, smart shadow updates, dynamic lights, translucent cutaway walls & ceilings), `IsometricCamera` (Cinematic Mode), `GridSystem`, `PlacementController`, `AssetLoader` (prototype geometry/material caching), and `ModelPreviewRenderer`.
- `src/save/` — Compact versioned serializer (`v: 1`), `localStorage` autosave (`storage.ts`), JSON file export/import (`fileIO.ts`), and compressed `#h=...` share links (`shareLink.ts`).
- `src/rooms/` — Tag-rule room evaluator (`RoomEvaluator.ts`).
- `src/visitors/` — 10 diverse visitor archetypes with personal names, pronouns, thoughts, mood scores, collision-avoiding pathfinding, and emoji bubbles (`VisitorModule.ts`, `VisitorMesh.ts`, `Pathfinder.ts`, `SpeechBubble.ts`).
- `src/scenery/` — Continuous 24h gradient skyboxes, twinkling starfield, linear drifting clouds, 6 scenic dioramas, and weather systems (`SceneryModule.ts`, `SkyDome.ts`, `BackdropBuilder.ts`, `WeatherSystem.ts`).
- `src/audio/` — Synthesized Web Audio foley, weather ambience, celebration chime, thunder, gibberish voice, and live volume control (`AudioModule.ts`, `FoleySynth.ts`, `WeatherAmbience.ts`).
- `src/ui/` — Unified Lucide-style SVG icon pack (`icons.ts`), warm architectural daylight HUD, left-side vertical Build Sidebar with subcategories, 24h Time Slider, Visitor Status Panel, and celebration banner (`HudController.ts`, `CelebrationBanner.ts`, `styles.css`).

## Extending Content via Data Files Only

You can add items, visitors, dialogue lines, room rules, or scenery views by editing only the JSON files in `data/` — no TypeScript changes required:

- **Add a furniture item:** Append an object to `items` in `data/furniture.json` with a unique `id`, valid `tab`, `layer` (`"floor" | "wall" | "ceiling" | "surface"`), `footprint: [w, d]`, at least one entry in `variants`, and a `model` path (`models/...glb`).
- **Add a visitor:** Append an entry to `visitors` in `data/visitors.json` with `likedTags`, `dislikedTags`, `preferredInteractions`, and `voiceProfile`.
- **Add dialogue lines:** Add hand-written lines under `default[mood]` or `byVisitor[visitorId][mood]` in `data/dialogue.json`.
- **Add a room rule:** Append a rule to `rules` in `data/room-rules.json` with `priority`, `requiredTags`, `label`, `description`, and `accentColor`.
- **Add a window view or weather:** Append to `views` or `weathers` in `data/scenery.json`.
