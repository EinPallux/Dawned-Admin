# Dawned-Admin — Map Editor Specification

> The flagship module: a full in-browser 3D world editor for the Dawnlands. Requirement: *"highly
> detailed, so the owner can improve the world as detailed as they want"* — and also able to
> **clear layers and start fresh**. It edits the same chunk/placement/spawn data the game consumes
> (formats: game repo `docs/tech/ASSET_PIPELINE.md` §6, tables: `docs/tech/DATABASE.md` §3).

## 1. Layout

```
┌ Toolbar: mode tabs · tool options · brush HUD · snap · undo/redo · play-test ▸ publish ┐
│ ┌ Left: Mode panel (contextual)      ┌────────── 3D Viewport ──────────┐ ┌ Right:     │
│ │ Terrain: brushes/layers            │  WASD-fly camera + orbit mode   │ │ Inspector  │
│ │ Props: asset palette (browser)     │  gizmos, selection outlines,     │ │ (selected  │
│ │ Spawns: enemy/node/NPC lists       │  overlays (grid/zones/walk/     │ │ entity     │
│ │ Zones/POI: entity lists            │  chunks), minimap pip           │ │ properties)│
│ └ Bottom: status (coords, chunk, tri/instance counts, save state, bake state) ────────┘
```

Viewport: the real game renderer (same terrain/water/sky/prop systems via `@dawned/shared`-aligned
client modules) → **WYSIWYG with the live game**, including zone fog/light preview toggle.
Camera: fly (WASD+RMB look, scroll speed), orbit-on-selection, `F` frame-selected, bookmarkable
camera slots (1–9), "drop to ground" walkthrough mode (fake-player eye height for readability
checks — not a game client).

## 2. Modes & Tools

### 2.1 Terrain Mode
- **Sculpt brushes:** Raise/Lower (strength, radius 1–64 m, falloff curves: smooth/linear/sharp),
  Smooth, Flatten (to sampled or typed height), Set Height, Terrace, Noise (perlin-jitter for
  natural breakup), Path (drag a spline → flattens + optionally paints a path layer with width) —
  hold `Ctrl` inverts, `[`/`]` radius, `Shift+[`/`]` strength.
- **Texture painting:** 8 splat layers per zone-set (per game WORLD.md §6) with per-layer
  properties panel; paint with same brush system + slope/height **masks** (e.g. "only where slope
  >30°"), fill-by-mask bucket, layer visibility solo.
- **Water:** global sea level + per-chunk water override (ponds/rivers at height), river spline
  tool (width, flow direction for shader), swim-volume auto from water depth.
- **Cliff helper:** overlay slopes >55° (auto-unwalkable) + one-click "dress selection with rock
  set" scatter suggestion (places from a chosen cliff-rock collection along the steep face —
  suggestions land as normal editable placements).
- **Island/board tools:** chunk enable/disable (ocean chunks cost nothing), heightmap
  import/export (PNG16) per selection for external tinkering, and **generators** (admin-only,
  confirm-gated): island mask synth (radial falloff + noise), erosion pass, auto-splat by
  height/slope rules — used to seed the base world (game P12), always non-destructive to placed
  props (they re-sit on the new heights with a "floaters report").

### 2.2 Props Mode (placement)
- **Asset palette:** the Asset Browser docked (search/filter/collections); drag into viewport or
  click-to-stamp mode.
- **Transform:** move/rotate/scale gizmos + numeric inspector; surface-snap (align-to-normal
  toggle), grid snap (0.25/0.5/1 m), random-rotation/scale-jitter stamping options for natural
  placement; duplicate (`Ctrl+D`), array/line duplicate along drag.
- **Multi-select:** click/shift-click/marquee; group into named **prefab collections** (e.g.
  "market stall set") reusable across the map — collections are editor-side groupings, flattened
  to plain placements at bake.
- **Foliage scatter brush:** paint density of a **scatter set** (weighted asset list, e.g. "Weald
  ground cover": 3 grasses, 2 ferns, mushroom 5%) with radius/density/erase — stored as scatter
  parameters per chunk (not individual instances) so painting stays light and re-bakeable; "bake
  to instances" per area when hand-tweaks are wanted.
- **Physics sanity:** placements auto-report "floating" (>15 cm above ground) and "buried" — a
  fixable-list panel with select-and-snap-to-ground.

### 2.3 Spawns Mode
- Place/edit **enemy spawners** (point/area; entries with weights/counts; rank override; respawn
  timer; camp-tag with visualized social-aggro link circles; patrol spline editor with per-node
  wait times), **resource nodes** (profession/tier picker with model auto-suggest per zone tier,
  respawn timer), **NPCs** (from content NPC list; routine waypoint editor with idle-clip picker).
- Overlays: aggro radii, leash radii, patrol paths, spawn density heat (per-zone counts vs.
  CONTENT_0.1 targets — a live "content budget" meter per zone in the panel!).
- "Simulate populate" preview: ghost-render one spawn resolution to eyeball camp compositions.

### 2.4 Zones & POI Mode
- **Zone polygons:** draw/edit vertices on the terrain; properties (name, level band, ambience
  profile: fog color/density/light tint/music/sfx set — with instant viewport preview toggle,
  safe-zone flag, settlement ref); overlap validation (every land point in exactly one zone).
- **POIs:** place discovery points (kind, radius, XP basis points, icon, name) with discover-radius
  ring preview.
- **Interactables:** place chests (loot table ref), shrines, campfires, signposts (text), quest
  props, portals (destination picker) — kind-specific inspectors from zod schemas.
- **Shrine/fast-travel graph view:** all shrines + travel cost preview matrix.

## 3. Cross-cutting Editor Systems
- **Undo/redo:** command-pattern journal (≥200 steps, grouped brush strokes), scoped per session,
  `Ctrl+Z/Ctrl+Shift+Z`, history panel with jump.
- **Layers panel:** lock/hide per data layer (terrain, water, props, foliage, spawns, zones, POIs,
  interactables) — and per-zone **"Clear layer…"** action (the "start fresh" requirement: e.g.
  wipe all props in Emberwood but keep terrain+spawns; double-confirm + auto-draft-backup).
- **Selection sets & isolation:** save named selections; isolate-mode dims everything else.
- **Overlays:** chunk grid, walkability bake preview (green/red), slope heat, splat layer weights,
  spawn density, zone fills, collider wireframes, tri/instance budget per chunk (red when over).
- **Measurements:** ruler tool, radius stamp (for planning camp spacing).
- **Multi-user safety:** single-writer lock per map draft (second user gets read-only + "request
  takeover"); it's a friends team — no CRDT complexity in 0.1.0.
- **Autosave & drafts:** chunk-granular draft saves 2 s after idle; draft state survives browser
  crash; explicit named checkpoints ("before redoing Dawnhaven harbor") restorable.

## 4. Validate → Bake → Publish (map-specific)
Publish runs: zone coverage check, floaters/buried report gate, spawn refs exist, node tier vs.
zone tier warnings, POI/shrine reachability (walkgrid flood-fill from spawn — unreachable content
is an error), budget check per chunk; then bakes: walkability grid, chunk bins, placement JSONs,
world-map + minimap renders (styled per game WORLD.md §5), publishes a map version + content
bundle entry (game repo pipeline). Bake runs server-side (admin API worker, niced) with progress
UI; typical incremental bake target <60 s (changed chunks only), full-map <10 min on the VPS.

## 5. Play-test Bridge
"Play-test ▸" button: opens the game client (new tab) pointed at a **draft preview channel** —
the game server can host one GM-only preview instance of draft map data (admin API asks it to
load draft chunks in a shadow world, GM character teleports in). 0.1.0 scope: preview instance =
walking + combat vs placed spawns, no persistence. This is the dogfooding loop that makes world
building (game P12) pleasant. Fallback if the shadow-world proves heavy in practice: publish-to-
staging-clone flow (documented decision point at A3).

## 6. Keymap (defaults)
`Q/W/E/R` select/move/rotate/scale · `B` brush mode toggle · `[ ]` size · `Shift+[ ]` strength ·
`G` snap cycle · `F` frame · `H` hide sel · `Alt+H` unhide all · `Ctrl+D` duplicate ·
`Del` delete · `Ctrl+Z/Y` undo/redo · `Ctrl+S` save draft · `1–9` camera slots · `T` top-down ·
`O` overlay picker · `Space` tool options popover. Fully rebindable (same keybind UI component as
the game's settings).

## 7. Acceptance bar (A2/A3 DoD extract)
The editor is done when the owner can, without touching code or docs: sculpt a new islet, paint
it, scatter a forest, drop a bandit camp with a patrol, ring it with T2 nodes, zone it with custom
fog + music, place a chest + vista + shrine, validate, publish — and stand on it in the live game
within minutes, then wipe just its props and redecorate. That exact scenario is the A3 demo
script.
