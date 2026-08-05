# Dawned-Admin — Map Editor Specification

> The flagship module: a full in-browser 3D world editor for the Dawnlands. Requirement: _"highly
> detailed, so the owner can improve the world as detailed as they want"_ — and also able to
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
  > 30°"), fill-by-mask bucket, layer visibility solo.
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

#### As-built (A3-d)

- **Multi-select**: click replaces, `Shift`+click toggles, `Shift`+drag boxes. The marquee hits
  what it LOOKS like it hits — every marker's drawn position is projected to the screen and tested
  against the box, rather than its ground point, because a marker stands up from the terrain and
  the two are twenty pixels apart at map height.
- **Prefab collections** are named groups with RELATIVE offsets, stored in Postgres
  (`map_editor_collections`) rather than the browser: they are shared between the owner and any GM,
  and months of collected prefabs must not die with a cache clear. Arm one and click the ground to
  stamp it; the origin is the group's average position, so what lands under the cursor is its
  middle. Stamping mints fresh ids against everything already placed AND against the ids minted
  earlier in the same stamp — two members on the same metre would otherwise collide with each
  other. Prefabs never reach the game: a stamp produces plain placements, so the bake never learns
  they exist.
- **Foliage scatter brush**: pick a set, paint density, hold `Ctrl` to clear it. Density lives in
  the 16×16-per-chunk grid the format actually stores, so a forest is a couple of hundred bytes and
  the bake re-scatters it deterministically. A stroke that straddles a chunk seam paints both
  sides (or every chunk edge grows a bald stripe), the whole stroke is ONE save and ONE undo step,
  and erasing a patch back to nothing DELETES the row instead of storing 256 zeroes.
- **Scatter sets** are edited in the same card: name, the weighted model list, instances per 100 m²,
  and the slope/height limits that keep ground cover off cliffs and out of the sea. They are
  map-wide settings, so they ride world settings rather than the object table.
- **Transform gizmos, snapping and jitter stamping are NOT built.** Position is edited numerically
  in the inspector and by re-stamping; a drag-gizmo is worth having but it is polish on top of a
  placement path that already works, and it was not worth delaying the §7 run for.

### 2.3 Spawns Mode

- Place/edit **enemy spawners** (point/area; entries with weights/counts; rank override; respawn
  timer; camp-tag with visualized social-aggro link circles; patrol spline editor with per-node
  wait times), **resource nodes**, **NPCs** (from content NPC list; routine waypoint editor with
  idle-clip picker).
- **As built (A1-e, 2026-08-05) — resource nodes.** The Place tool's `node` layer stamps a
  placement of a definition authored in Content → Professions; the picker lists what is published
  with its tier and profession. There is no per-placement profession/tier/respawn field and there
  will not be: those live on the DEFINITION, so retuning a resource is one row rather than every
  placement of it (the enemies/spawners split). A placement is id · nodeId · position · rotation ·
  scale. Markers take the placement's scale and are ringed at the definition's radius × that
  scale — the placement cannot answer its own size, so the viewport looks the definition up. A map
  publish refuses a placement whose definition is not published.
- Overlays: aggro radii, leash radii, patrol paths, spawn density heat (per-zone counts vs.
  CONTENT_0.1 targets — a live "content budget" meter per zone in the panel!).
- "Simulate populate" preview: ghost-render one spawn resolution to eyeball camp compositions.

#### As-built (A3-b)

- **Rings are drawn at TRUE size** from the enemies a spawner actually rolls — the widest aggro
  and leash among its entries, plus the spawn radius, because that is what a player walking past
  will feel. A ring that lies about its metres is worse than no ring.
- **Camp links** join tagged spawners through their group centre and report the spread in metres,
  longest first. `campTag` is what the server groups social aggro by, so this is the real
  relationship rather than an editor-side grouping — and a tag that accidentally spans a ridge
  reads instantly as one shape rather than two camps.
- **Population per zone** counts spawners, enemies standing at once, camps and the rank mix, over
  the same `pointInPolygon` the game assigns zones with. A spawner in NO zone is reported on its
  own line; folding it into a total would hide an authoring mistake in a number that looks fine.
- **Overlapping pulls** lists pairs of camps whose aggro envelopes touch, with the overlap in
  metres. Same-tag pairs are skipped — they are MEANT to pull together. Reported, never blocked:
  P9-C shipped two deliberately mixed camps, so this is a decision to make rather than an error.
- **Simulate populate** rolls one resolution with the same uniform-over-area scatter the server
  spawns with (`sqrt()` on the radius, or the shape bunches at the middle and a 20 m camp
  previews as a 6 m huddle). Deterministic from a seed, so changing a count shows the change
  rather than a fresh shuffle.
- **Patrol splines are out of 0.1.0** (owner decision, 2026-08-05 — USER_QUESTIONS Q24). They need
  a `patrol` field on the spawner schema AND an AI state that walks it; the game has neither, and
  an editor for a field nothing reads would look finished and do nothing. P9 was measured and
  balanced against stationary camps. Post-0.1.0 this becomes a game-side slice (patrol state,
  leash and social-aggro behaviour on a moving camp) with the editor half a day on top.

### 2.4 Zones & POI Mode

- **Zone polygons:** draw/edit vertices on the terrain; properties (name, level band, ambience
  profile: fog color/density/light tint/music/sfx set/weather weights — with instant viewport
  preview toggle incl. forcing a weather state to eyeball rain/storm looks, safe-zone flag,
  settlement ref); overlap validation (every land point in exactly one zone).
- **POIs:** place discovery points (kind, radius, XP basis points, icon, name) with discover-radius
  ring preview.
- **Interactables:** place chests (loot table ref), shrines, campfires, signposts (text), quest
  props, portals (destination picker) — kind-specific inspectors from zod schemas.
- **Shrine/fast-travel graph view:** all shrines + travel cost preview matrix.

#### As-built (A3-c)

- **Drawing** a zone traces a border on the ground: `Enter` closes it, `Backspace` takes back a
  corner, `Esc` abandons it. The ring is normalised to the winding the live world uses — see the
  winding note below, which is a trap worth reading before touching `normalisePolygon`.
- **Editing** an existing zone: pick it from the tool bar (a border is a few pixels wide from map
  height; a dropdown is how you reach for the one you mean) or click its outline. Each corner gets
  a draggable diamond and each edge a smaller dot that inserts a corner where you click it;
  `Shift`+click a corner removes it. Handles scale with camera distance for the same reason
  markers do — you cannot grab what you cannot see.
- **Every edit is checked for self-intersection before it is allowed**, including deletes: removing
  one corner can cross a ring that was fine a moment earlier. A self-crossing zone passes the
  schema, looks normal, and then contains half of itself — wrong fog, wrong level band, discovery
  XP for the wrong ground. A refused drag stops at the last legal position rather than snapping
  back, so the shape you are left with is one you can see.
- **The zone tool picks against the world PLANE when no terrain is under the cursor.** Zone borders
  legitimately run out over open water and past the streamed region — all three shipped zones reach
  620 m out — so requiring ground made half of every outline untouchable. Zone geometry is 2D on
  that plane, so this is not a fallback so much as the correct question.
- **Winding.** `polygonArea2` here is the shoelace variant whose POSITIVE result is the
  counter-clockwise order `zoneSchema` documents and all three shipped zones use. The first version
  reversed on positive, which flipped every zone the editor touched. Nothing at runtime noticed —
  the game's `pointInPolygon` is an even-odd ray cast, blind to winding — so it is pinned by a test
  against a ring copied verbatim from the published bake, not by "both hands agree".
- **Interactables**: the Place tool has a kind picker (chest · shrine · campfire · signpost ·
  portal · quest prop). Each kind stamps a row that already passes shared `validateInteractable`,
  and picks the closest baked model by name — the world pack is nature props until the interactable
  phase bakes real ones, so the reference is a starting point the inspector lets you change, not a
  reason to refuse the placement.
- **The travel graph** lists every shrine-to-shrine hop with its price, cheapest first, and draws
  it on the world tinted by cost across the design's own 5–40 g band. The price is the game's
  `fastTravelCost` from `@dawned/shared` (ITEMS_LOOT.md §5: `2 × distance-in-chunks`), never a copy
  — a panel quoting a number the game will not charge is worse than no preview. Judgement calls
  (a shrine left off the graph, one lone node, a hop under 120 m) warn here and never block a
  publish; the hard gate — a shrine nobody can walk to — is the bake's flood-fill.
- **Deleting a zone asks first.** It is the one placed thing whose loss is expensive (hand-tuned
  ambience, and publish blocks on land in no zone) and the easiest to hit by accident, because a
  zone is selected by clicking a border that runs across the whole map. Solid markers also beat
  outlines in the pick now, so a shrine standing on a border selects the shrine.

## 3. Cross-cutting Editor Systems

- **Undo/redo:** command-pattern journal (≥200 steps, grouped brush strokes), scoped per session,
  `Ctrl+Z/Ctrl+Shift+Z`, history panel with jump.
- **Layers panel:** lock/hide per data layer (terrain, water, props, foliage, spawns, zones, POIs,
  interactables) — and per-zone **"Clear layer…"** action (the "start fresh" requirement: e.g.
  wipe all props in Emberwood but keep terrain+spawns; double-confirm + auto-draft-backup).
- **Selection sets & isolation:** save named selections; isolate-mode dims everything else.
  **As-built (A3-d):** a named set stores ids; loading one drops ids that no longer exist rather
  than keeping ghosts, and says so. Isolation HIDES rather than fades — a translucent hundred
  markers is still a hundred markers in the way — and it composes with layer hiding rather than
  overriding it, so a hidden layer stays hidden while you isolate.
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

### 4.1 As-built (A2-b)

- **Draft storage is chunk-granular and row-per-object.** `map_draft_chunks` holds heights +
  splat + water + an `enabled` flag per chunk (a stroke autosaves as a handful of ~25 kB
  upserts); `map_draft_objects` holds one row per placed thing, keyed by id and indexed by
  chunk. Disabled chunks are open ocean: the bake skips them and the client never downloads
  them, which is what keeps a 32×32 world cheap.
- **Import before you edit.** `POST /api/map/import-live` reads the bake players are currently
  standing on (chunks, zones, placements) plus the published spawner rows into the draft. The
  editor otherwise opens on empty ocean, and the first publish would delete the world. It
  checkpoints an existing draft before overwriting it.
- **The pointer moves last.** A bake stages into `<version>.tmp`, renames into `<version>/`, and
  only then rewrites `current.json`. Until that last write the previous version is still live,
  so a bake that dies halfway cannot take the world down. Publish then pokes the game's
  `/ops/reload-map` (which loads the new bake BEFORE swapping it in) and `/ops/reload-content`.
- **Spawners are the one layer the GAME reads from the database, not from the bake**
  (`content_spawners`). Publishing the map republishes that layer — delete-then-insert in one
  transaction, so a camp deleted in the editor actually stops spawning.
  **The map publish wins, and the map is where camps live** (owner decision, 2026-08-05 —
  USER_QUESTIONS Q23). Camps are editable on both Content → Enemies → Spawners and here, and they
  are the same rows; publishing the map overwrites a position moved on the Enemies page. That is
  the accepted trade, because position is a spatial decision and the Enemies page cannot show you
  the hill. The map editor's inspector edits the same full row (entries, counts, respawn timer),
  so nothing is lost by doing all of a camp's authoring here; the Enemies page stays the surface
  for the BESTIARY.
- **Reachability is a real flood-fill**, not a heuristic: the bake builds the walkgrid, floods
  from the resolved spawn across walkable + water, and reports any POI, interactable or spawner
  further than 3 m from a reached cell. World metre → cell is FLOOR, matching the game's
  `Walkgrid.classAt` — rounding instead puts the bake half a cell away from what the server
  enforces, which is enough to declare a reachable world unreachable.
- **Blocking vs advisory.** Blocked: land in no zone, an inverted level band, a placement on a
  disabled chunk, an unbaked `modelRef`, a chest with a missing or unpublished loot table, a
  spawner pointing at an unpublished enemy or sitting in a safe zone, a scatter patch whose set
  was deleted, unreachable content. Advisory: overlapping zones, floaters/buried props, chunks
  over the instance budget, spawners in an unreachable pocket.
- **Validation passing is not proof a draft BAKES.** They run different schemas: `validateDraft`
  reads the draft's own shapes, the bake hands every layer to the GAME's `.strict()` artifact
  schemas. A scatter row carries an `id` (it is a row key) that the baked format has no field
  for, so for a while every publish with a painted forest in it validated clean and then threw
  inside `placements.json` — between the "zones" and "placements" steps, with nothing in the log
  and a staging directory left behind. Draft rows are PROJECTED into the baked format now, never
  cast; a failed bake logs and removes its own stage; and `map-bake.test.ts` bakes for real
  rather than only validating.
- **A publish sweeps old bakes.** Each one is ~8.6 MB of chunk bins and nothing used to remove
  them, so the VPS filled in proportion to how much the owner edited. `pruneOldBakes` keeps the
  five newest plus whatever `current.json` points at, takes any `.tmp` a killed process left,
  and reports the count on the stream and in the audit row. `dev-2` — the committed
  `pnpm world:generate` fallback — is not a `map-*` directory and is never touched.
- **The live bake is machine state, and it is backed up.** Published bakes land in the game
  checkout next to `dev-2`, so they are git-ignored (a `git pull` on the VPS must never repoint
  the live world at a bake from someone's laptop) and `deploy/BACKUP.sh` archives the live one
  nightly. The DRAFT it came from is in Postgres, which pg_dump already covers.

### 4.2 As-built: the viewport and the tools (A2-c/A2-d)

- **One geometry, two repos.** Chunk meshes are built by `buildChunkGeometryData` in
  `@dawned/shared` — the same function the game client calls. The editor owns only materials,
  lighting and the water plane. An editor with its own vertex code is an editor that eventually
  lies about the result, and the divergence would be invisible until someone published.
- **The resident region follows the camera's zoom**, capped at a 6-chunk radius (13×13 = 832 m,
  wider than the whole dev island). The cap is measured, not guessed: 17×17 is 7.5 M triangles a
  frame and buries a software renderer completely. The whole-world view is the baked world map,
  not a thousand live chunks.
- **Overlays recolour the existing vertices** rather than drawing a second mesh, so toggling one
  costs a buffer update instead of a rebuild. Slope is a green→amber→red ramp over 0–60°;
  walkability uses the game's own classes (green walkable, red >50° steep, blue water).
- **Undo is byte snapshots, grouped per stroke, 220 deep.** Inverse operations were rejected: a
  Smooth or Flatten dab destroys the information you would need to invert it. 17 kB per touched
  chunk is a fine price for an undo that cannot be subtly wrong.
- **Autosave is per chunk, 2 s after the last dab.** During a stroke nothing is sent; a save per
  mousemove would put hundreds of 25 kB bodies on a 1-core VPS. Everything saved is durable, so
  a closed tab loses at most two seconds. Three rules make that promise true rather than
  approximate, and all three were bugs first:
  - a flush that lands while another is in flight **re-arms** instead of returning — dropping it
    loses every chunk dirtied during the previous save, and the editor sits on "Unsaved changes"
    until the owner happens to edit again;
  - a save larger than the endpoint's 64-chunk limit is **split into batches** — a generator
    dirties hundreds at once, and one oversized body is a 400 the editor reports as a permanent
    save failure;
  - a **refused** save keeps its chunks and schedules a retry rather than waiting for the next
    stroke.

  All three are pinned by `draft-store.test.ts`, because none of them reproduce on a fast machine.

- **The lock renews itself.** While the tab holds it, the 15 s poll POSTs (renew) instead of
  GETting — a lease that lapsed mid-session would start refusing saves with no warning.

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

#### As-built (A3-d)

Every editor shortcut is a row in a keymap rather than a case in a `switch`: click a binding in
the Keys card, press a key, done. Binding a key that another action holds takes it off that
action and leaves it UNBOUND rather than swapping — a silent swap moves a key nobody asked to
move, and two actions on one key means the second silently never fires. The keymap is stored per
browser (localStorage), because it is a property of the hands and the hardware, not of the login;
a stored map missing an action added in a later release falls back to that action's default
rather than leaving it dead. `Ctrl+Z`/`Ctrl+S`/`1–9` camera slots are fixed and not rebindable.

## 7. Acceptance bar (A2/A3 DoD extract)

The editor is done when the owner can, without touching code or docs: sculpt a new islet, paint
it, scatter a forest, drop a bandit camp with a patrol, ring it with T2 nodes, zone it with custom
fog + music, place a chest + vista + shrine, validate, publish — and stand on it in the live game
within minutes, then wipe just its props and redecorate. That exact scenario is the A3 demo
script.

### 7.1 As-built: the run (A2/A3-e, 2026-08-05)

`node tools/smoke/map-scenario.mjs` performs that sentence in a real browser against the real
game server, and is the phase's evidence rather than a checklist someone ticked:

| §7 asks for                | the run does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| sculpt a new islet         | pans out to open water (−6.8 m), Island-generates 28.4 m of land there   |
| paint it                   | a splat stroke across the new ground                                     |
| scatter a forest           | the scatter brush, 13 077 density over the islet's chunks                |
| a bandit camp              | 21 spawners placed, camp links and rings drawn at true size              |
| …with a patrol             | **not authored** — no patrol field, no patrol AI state (game Q24)        |
| ring it with T2 nodes      | **possible since A1-e** (game P10-A schema) — awaiting authored T2 nodes |
| zone it with custom fog    | a traced polygon, renamed, level-banded and given its own fog            |
| …+ music                   | **not possible yet** — `zoneAmbienceSchema` has no audio fields (Q26)    |
| chest + vista + shrine     | one of each, every row already passing `validateInteractable`            |
| validate, publish          | the streaming publish panel, `map-<epoch>` minted                        |
| stand on it within minutes | the GAME's `/api/health` flips `dev-2 → map-<epoch>` with no restart     |
| wipe just its props        | the zone-scoped "Clear layer…" removes 3 of 3, leaving the rest standing |

The remaining "not possible yet" rows are recorded rather than faked; each carries a recommended
default in the game repo's USER_QUESTIONS.md. The node row was one of them until game P10-A added
the resource-node schema and A1-e turned the layer on; the scenario will stamp nodes for real once
P10-E authors a T2 set to stamp. Everything else is checked against artifacts, not
appearances: the islet's own chunk bin and the new zone are read back out of the published bake,
and the map version is taken from the game server rather than from the panel that just wrote it.

The run leaves the islet live on purpose — this is a dev checkout, and the point of the scenario
is that the world changed. Re-running it is safe: it deletes its own previous leavings first.
