# Cozyhouse: project brief

Build a cozy isometric house-builder game for the browser where the furniture you place decides what the space is, and visitors react to it. Working title: Cozyhouse.

## The game

- Your own private house: build and decorate it however you like, as a home, café, bar, diner, smoothie place, or a mix. The furniture decides what it is.
- Single player and private. There is no feed, gallery or way to browse other people's houses. You only ever see your own, or a house someone sends you.
- Calm and open-ended: no fail state, no timers, no money.
- Everything reacts when clicked: lamps toggle, records spin, the disco ball turns, the cat looks up.

## Deploy and performance

- An easy-to-run browser game: one build command produces static files that work on any static host (GitHub Pages, Netlify, Cloudflare Pages). No backend, no accounts, no paid services.
- Fast to load: the house is interactive within about 3 seconds on a normal laptop connection, with an initial download under 3 MB. Furniture models load lazily (per catalog tab, or when first placed), never all up front.
- Use a lightweight 3D library (three.js is the reference point). No exported game-engine builds. Free, open-source dependencies only.
- Models are glTF/GLB, compressed (meshopt geometry, KTX2 textures where textures exist).

## Controls

- Fully playable with a laptop trackpad alone: click, click-and-drag, two-finger scroll, pinch. No right-click-drag, no keyboard required (optional shortcuts are fine).
- Undo, move, rotate, delete for every item. Autosave to localStorage.

## View

- A 3D scene seen through a fixed isometric (2.5D, top-down) camera. It rotates in 90° steps and zooms in and out.
- Placement layers: floor, wall-mounted, ceiling, and on-surface (small items stack on tables, shelves, counters).
- Walls, floors, doors and windows are placeable, so the house can hold several rooms. Items come in color variants.

## Window view and weather

- A setting for what you see out the windows and around the house: city, suburbs, beach, forest, mountains, countryside. Changing it swaps the background scenery.
- A weather setting: clear, rain, snow, fog, thunderstorm. Weather shows through the windows and has its own ambient sound.

## Art direction

- Minimalist, flat-shaded low-poly in an isometric diorama view, in the spirit of Mini Motorways.
- Simple geometric shapes with slightly rounded edges, low polygon counts.
- Solid colors from one soft pastel palette; no image textures.
- Soft shadows and gentle ambient occlusion; warm lighting indoors.
- Readable at a glance from the isometric camera; every item recognizable by its silhouette.
- All art and sound must be original. No copyrighted or downloaded game assets.

## Art: placeholders first

- Until final models exist, every item, visitor and pet uses a simple placeholder: a shape sized to its footprint, colored by tab, labeled with its name.
- Final 3D models are made separately (modeling is a later, separate step). Each catalog entry names the model file it will use, so swapping in real models needs no code changes.

## Catalog (at least 120 items, organized in tabs)

- **Basics:** walls, floors, doors, windows.
- **Living:** beds, sofas, chairs, desks, wardrobes, TVs, rugs.
- **Kitchen:** counters, fridge, stove, sink, dining sets.
- **Café and Bar:** espresso machine, blender, counter, bar stools, pastry case, chalkboard menu, café tables, booths.
- **Party:** DJ booth with turntables, speakers, floor lights, disco ball, LED strips, fog machine.
- **Interior Decor** (the biggest tab): vines and hanging plants, potted plants, vinyl records and a record wall, posters, neon signs, lamps, bookshelves, curtains, mirrors, wall art, rugs, plushies.
- **Pets:** cat trees, scratch posts, toys, beds, bowls, litter box, wall shelves and ceiling catwalks, plus cats that use them.

## Room types

- Every item carries tags (for example sleep, serve, music, plants, read, pet).
- Rules derive a label from the tags: Home, Café, Live-in Café, Bar, Party Pad, Cat Café, and so on. Adding a bed to a café makes it a Live-in Café. Show a small celebratory moment when the label changes.
- A manual override lets the player declare the type themselves.

## Visitors

- An Invite panel with at least 6 visitor types (for example bookworm, party-goer, coffee snob, plant lover, cat person, night owl), each with tag preferences.
- Visitors walk in, wander, use items (sit, dance near the DJ booth, pet the cat, browse shelves) and show a mood that rises or falls with what they find. Bored visitors leave.
- They never speak a real language. Speech bubbles use an invented script, and an invented gibberish voice follows their mood in pitch and speed, with emote bubbles alongside. All lines are written by hand in a data file, never generated at runtime.

## Sending a house

- Export your house as a small file; import a file someone sent you to view their house. Nothing is uploaded anywhere.
- The saved layout format is compact and versioned, so it can later fit in a share link.

## Planned for later (do not build now; keep the code ready for them)

- Share links: the whole house compressed into a URL that opens it for the recipient.
- Exploring: a street of neighboring lots you can walk to and visit.
- Making drinks and food at the café or bar counter.

## Files (the shared contracts that parallel agents build against)

- `data/furniture.json`: every catalog item (id, name, tab, tags, footprint, layer, variants, model file).
- `data/visitors.json`: visitor types, preferences, behaviors.
- `data/dialogue.json`: hand-written invented-language lines and emotes per visitor type and mood.
- `data/room-rules.json`: the tag rules that produce room labels.
- `data/scenery.json`: window views and weather types.
- `src/`: engine, UI, visitor behavior, scenery and weather, save/export, and audio as separate modules.
- `README.md`: how to run, build and deploy it, the controls, and how to add an item, visitor, dialogue line or view by editing only the data files.

## Work plan

- **Phase 1 (one agent):** the grid, placement, camera, save/load and export/import, and all five data schemas with a few sample entries each. Nothing else starts until this works.
- **Phase 2 (parallel):** fill the catalog, visitor behavior and emotes, dialogue and the gibberish voice, window views and weather, sounds, UI and the room-type celebration. Agents connect only through the data files and the module boundaries from Phase 1.
- **Phase 3 (separate):** final 3D models in the art direction above, swapped in through the model file paths.

## Done when

- It builds to static files and runs from a static host.
- The first load meets the size and time targets above.
- Every action works with a trackpad alone.
- The catalog has 120 or more items across all tabs, each with a placeholder and a model file path.
- Adding a bed to a café changes its label to Live-in Café.
- Changing the window view or the weather visibly changes the scene.
- Invited visitors react visibly and audibly to the room, and leave when bored.
- Clicking items makes them react.
- Exporting a house and importing it in another browser reproduces it exactly.
- Reloading the page restores the exact layout.
- No console errors, and it stays smooth with 100+ placed items.
