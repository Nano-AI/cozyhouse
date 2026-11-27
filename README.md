# Cozyhouse

A calm, private isometric house-builder for the browser where the furniture you place decides what the space is.

> **Current status:** Phase 1 foundation (grid, 4-layer placement, 90° isometric camera, autosave + export/import, placeholder art, and the 5 shared data schemas).

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

Every action works with a laptop trackpad alone — no right-click-drag and no keyboard required:

- **Pan:** Two-finger scroll, or click-and-drag on empty space.
- **Zoom:** Trackpad pinch (or `+` / `−` buttons in the top bar).
- **Rotate view (90° steps):** `⟲ 90°` / `⟳ 90°` buttons (optional keys: `Q` / `E`).
- **Place items:** Click any item in the bottom catalog dock, pick a color swatch, click `Rotate 90°` if needed, then click on the floor, wall, ceiling, or a table/counter surface.
- **Select & interact:** Click a placed item to select it; click it again (or use its action button) to trigger its reaction.
- **Move, rotate, recolor, delete:** Drag a selected item directly, or use the contextual action bar (`Move`, `Rotate 90°`, color swatches, `Delete`).
- **Undo / Redo:** Top-bar buttons (optional keys: `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`).
- **Save & Share:** Every change autosaves to `localStorage`. Use **Export** to download a compact `.cozyhouse.json` file and **Import** to load a house in any browser.

## Architecture & Module Boundaries

Designed so Phase 2 parallel agents connect strictly through `data/*.json` and clean module interfaces:

- `data/` — Shared JSON contracts (single source of truth, served at `/data/*` in dev and copied to `dist/data/*` on build):
  - `data/furniture.json` — Catalog tabs & items (`id`, `name`, `tab`, `tags`, `footprint`, `height`, `layer`, `variants`, `model`, optional `subLayer`, `wallKind`, `surfaceHeight`, `interaction`).
  - `data/visitors.json` — Visitor types, tag preferences, behaviors, and gibberish voice profiles.
  - `data/dialogue.json` — Hand-written invented-language lines and emotes by mood and visitor type.
  - `data/room-rules.json` — Priority-ordered tag rules deriving room labels (`Home`, `Café`, `Live-in Café`, `Cat Café`, etc.).
  - `data/scenery.json` — Window views and weather definitions.
- `src/data/` — TypeScript types (`schemas.ts`) and runtime validator/loader (`loader.ts`).
- `src/state/` — Central reactive `HouseStore` with undo/redo history and `defaultHouse.ts`.
- `src/engine/` — Three.js `SceneManager`, `IsometricCamera`, `GridSystem` (4-layer validation & snapping), `PlacementController`, and `AssetLoader` (pastel placeholders + lazy glTF/GLB hook for Phase 3).
- `src/save/` — Compact versioned serializer (`v: 1`, share-link ready), `localStorage` autosave (`storage.ts`), and JSON file export/import (`fileIO.ts`).
- `src/rooms/` — Tag-rule room evaluator (`RoomEvaluator.ts`).
- `src/visitors/` — Phase 2 visitor module boundary (`VisitorModule.ts`).
- `src/scenery/` — Phase 2 scenery & weather module boundary (`SceneryModule.ts`).
- `src/audio/` — Phase 2 Web Audio & gibberish voice module boundary (`AudioModule.ts`).
- `src/ui/` — Minimalist pastel HUD & catalog dock (`HudController.ts`, `styles.css`).

## Extending Content via Data Files Only

You can add items, visitors, dialogue lines, room rules, or scenery views by editing only the JSON files in `data/` — no TypeScript changes required:

- **Add a furniture item:** Append an object to `items` in `data/furniture.json` with a unique `id`, valid `tab`, `layer` (`"floor" | "wall" | "ceiling" | "surface"`), `footprint: [w, d]`, at least one entry in `variants`, and a `model` path (`models/...glb`).
- **Add a visitor:** Append an entry to `visitors` in `data/visitors.json` with `likedTags`, `dislikedTags`, `preferredInteractions`, and `voiceProfile`.
- **Add dialogue lines:** Add hand-written lines under `default[mood]` or `byVisitor[visitorId][mood]` in `data/dialogue.json`.
- **Add a room rule:** Append a rule to `rules` in `data/room-rules.json` with `priority` and `requiredTags`.
- **Add a window view or weather:** Append to `views` or `weathers` in `data/scenery.json`.
