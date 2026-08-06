# Changelog — Dawned-Admin

All notable changes to the admin panel. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track the game's release trains (0.1.0 = tooling that shipped Dawned 0.1.0).

## [Unreleased]

### Changed — content scripts take a real login (2026-08-06)

- `tools/content/admin-session.mjs` replaces eleven inline copies of "mint an admin account, log
  in, walk away". It reads **`DAWNED_ADMIN_USER` / `DAWNED_ADMIN_PASS`** and touches the `accounts`
  table only when neither is set — so a run against a real deployment creates nothing, and every
  row it publishes is attributed to a person in `audit_log`.
- The old path minted `zz_admin_smoke` with a password that is a literal in a public repository.
  Fine in a throwaway dev container; a permanent admin back door anywhere else — and the game
  repo's new `deploy/WORLD.sh` makes "anywhere else" the point, since deploying a world means
  running these scripts on the live box.
- The dev fallback is now a **per-run random password** on its own account (`zz_admin_content`,
  not the smokes' `zz_admin_smoke`), banned when the run ends. The random password is the part
  that holds: a crash can skip the ban, and what survives is then an account nobody can log into.

### Added — quest hints are derived from the world, not typed (2026-08-06, game P12-F)

- **`pnpm world:quests`** publishes 20 new quests (28 in 5 chains with P11's eight) and resolves
  every hint circle against the live map draft. A step declares WHAT it points at — an enemy, a
  resource node, a placed object, an NPC, a POI — and the run computes a circle over the densest
  cluster of real matches. A hint built from the thing it points at cannot point at nothing.
- Encircling _every_ match produced a **327 m** ring when two camps sat on opposite sides of an
  isle, so it clusters instead, reports matches left outside, and **fails the run** on a derived
  radius over 260 m rather than shipping a circle that means "somewhere on this landmass".
- The same pass **repairs P11's eight pilot quests**, which pointed 420–815 m off after P12 moved
  every spawner and node under them, and re-points the Weald chain's `zoneId` at the zone that
  now exists.

### Added — the world's places and people, placed through this panel (2026-08-06, game P12-F)

- **`pnpm world:places`** resolves 45 POIs, 47 interactables (chests, campfires, signposts, the
  Elder Arch) and 68 settlement dressing props against the real height field, then publishes.
- **`pnpm world:folk`** authors 37 NPC definitions on the Quests rail and places 41 of them.
  **Vendor NPCs stand on their vendor's `anchor`** — that radius is the proximity lease the game
  checks before it will trade, so a shopkeeper anywhere else offers a trade the server refuses.
- Both scripts report **where their output stands**, zone by zone, resolved the way `bakeDraft`
  resolves it — not only how many rows they wrote. A count cannot see a border.

### Fixed — the reachability check could not see a portal (2026-08-06, game P12-F)

- `reachableFrom` flood-filled the walkgrid only, so every POI, chest and camp on the Elder Grove
  was unpublishable — the validator refusing exactly what WORLD.md §3.6 specifies, a hidden islet
  reached by "a one-way ancient portal in Ashcrag". A portal is a way to GET somewhere; the fill
  consumes them as directed edges now, to a fixpoint so they chain, and only once the portal's own
  mouth is reachable (otherwise a portal sealed inside the far side declares itself the way in).

### Added — the gathering catalogue is placed through this panel (2026-08-06, game P12-E)

- **`pnpm world:nodes`** re-authors the 21 resource-node definitions and plants **362 placements**
  across all six zones, resolving every cluster against the real height field with the same
  `placeAll` the camps use. Safe to re-run: an unchanged catalogue prunes itself and reports
  "already live, nothing to publish".
- **`tools/content/node-clusters.mjs`** holds the layout as 73 wishes — zone, bearing, distance,
  count, spread — rather than 362 typed coordinates, so re-shaping a forest is one row.
- The run now prints **where the nodes actually STAND**, resolved the way the bake resolves it, not
  only how many of each kind it planted. A per-definition count says the catalogue is complete and
  says nothing about whether the tier ladder ended up where the design put it.

### Added — publish cross-checks a node's placements against its zone (2026-08-06, game P12-E)

- A node definition carries a tier and no zone, so the panel cannot check it against a design
  mapping without inventing one. It checks the data against **itself** instead: when one node id's
  placements are split across zones, publish warns and names the split. It **warns rather than
  blocks**, on `questHintCoverage`'s precedent — a material that genuinely grows in two regions is
  a design choice, and 5 of 19 across a border is not.
- This is the guard the content script's own fix cannot give, because nodes get dragged by hand in
  the map editor too.

### Fixed — cluster members ignored the zone their cluster was authored for (2026-08-06, game P12-E)

- `placeAll` validates the cluster CENTRE's zone; `author-nodes.mjs` then scattered members up to
  `spread` metres around it and asked only about the GROUND. **39 of 322 land nodes stood in a zone
  they were never authored for** — Ashcrag's T5 veins in the T4 savanna, and 4 of the 12 Dawnpetal
  outside the Elder Grove that exists for them, which is the same promise game P12-D had just
  fixed in the data. The member loop asks the DRAFT's zone layer now, ordered exactly as
  `bakeDraft` orders it, and the existing shrink-toward-centre retry absorbed every stray: 362
  placed, 0 dropped.

### Fixed — the generated world had no sea (2026-08-06, game P12-E)

- `WORLD_GEN_PLAN.waterLevel` was `null`, so all 1024 chunks were written declaring no water. The
  client draws a water surface only where a chunk declares one, so 42 % of the map was an invisible
  hole — and no fishing node could be authored at all, because "submerged" is ground below its own
  chunk's water. Nothing had needed water to exist until the gathering pass did.

### Added — the whole item catalogue runs through this panel (2026-08-06, game P12-D)

- **`node tools/content/author-items.mjs` now owns the entire catalogue** — T1–T2 from P8 and the
  T3–T5 deep set together, 182 item rows, 21 loot tables and 16 vendors on one publish rail. One
  script, because the vendors are the same rows in both files' eyes: the P8 shops were anchored on
  the dev island and every one of them had to move onto a building the map publish placed.
- **`item-data-deep.mjs`** authors identity only — name, slot, ilvl, rarity, attribute weights, one
  line of flavour — and every number comes out of the shared ITEMS_LOOT §2 formulas, which is the
  same contract the budget meter on the Items page previews with.
- Loot tables **nest through per-tier pools**, so a zone names its gear once; each boss has its own
  table with no `nothing` entry, which is what makes "guaranteed Rare+" a property of the data.

### Fixed — one item id, two owners (2026-08-06, game P12-D)

- `item_material_dawnpetal` was authored in BOTH `item-data.mjs` and `node-data.mjs` at different
  ilvls, so whichever content script ran last won. Republishing the item catalogue silently
  reverted P10-E's re-tiering of Dawnpetal from a Dawnshore common to the Elder Grove's T5 rare —
  and put a "legendary" bloom back in a level-3 mob's loot table. The gathering materials belong to
  the node catalogue; the duplicate row is gone. Caught by the game's gathering-ladder test, not by
  anything here — a content script that republishes rows it does not own is this repo's problem.

### Added — the world's camps are placed, not typed (2026-08-06, game P12-C)

- **`pnpm world:bestiary`** authors 50 enemies, the zone loot tables and **124 camps** through the
  Enemies page's rail, and writes the same camps into the map's `spawner` layer — camps live on the
  MAP, and a map publish replaces that whole set, so a bestiary authored only on the Enemies page
  would be erased by the next world publish.
- **A camp is a wish, not a coordinate.** New `placement.ts` resolves "somewhere north-east of the
  Emberwood" against the real height field, spiralling outward until it finds ground above water,
  gentle enough to fight on, inside the right zone, clear of every town and of the other camps —
  and says which of those a candidate failed. The search is capped at 120 m, because an unbounded
  one always succeeds and quietly scatters an authored difficulty gradient.
- **`world-sample.ts`** holds one in-memory synthesis of the world for every content script to
  share, so the preview, the settlement pass and the camp pass all read the same ground.

### Fixed — re-running a content script republished everything (2026-08-06, game P12-C)

- **The Enemies page's prune-on-match compared the RAW jsonb column.** Postgres normalises key
  order, so an identical draft could never prune: every re-run of a content script showed the whole
  bestiary as changed — 174 rows in a diff review whose only purpose is to say what changed. The
  A1-c fix landed on the item and progression editors; this one kept the comment without the code.
- **`world:author` never cleared the zone layer.** The draft was seeded from the dev island by
  `import-live`, so `ashen_reach` survived the entire world regeneration and, being a smaller ring,
  won inside the savanna and the canyons — nine camps stood in a zone the design does not have.
  Found by the game's new `/ops/camps`, which counts what the world actually seeded.

### Fixed — two ways the map bake could give different answers for the same draft (2026-08-06, game P12-B)

- **`listObjects` had no `ORDER BY`.** Postgres returns rows in physical order, which changes
  whenever a row is updated. Nothing depended on it while no two zones overlapped — and then the
  game's P12 added the Dawnsea, a zone whose ring covers the whole map, so every land point is
  inside two zones and `zoneAt` takes the FIRST match. An unchanged draft could have baked
  Dawnshore as ocean one publish and not the next, with no code change between them. Objects are
  ordered by id now, which also means two publishes of one draft produce the same bytes.
- **Zones bake smallest-first.** `bakeDraft` sorts them by polygon area ascending, so the more
  specific zone wins: a containing zone is always the larger one, and the sea can never shadow an
  isle. Ties break on id so the order is total.
- **`findSpawn` picked whichever settlement came first.** With one settlement that was fine;
  P12 gives all five of them one, and the answer came from row order — a new character could have
  woken up in Rustpick Camp, in the level 24–30 zone. The spawn is the settlement zone with the
  lowest level band now, which is already what makes Dawnshore the starter.

### Added — whole-world generation grew causeways and plateaus (2026-08-06, A2, game P12-B)

- **`causeway` masks** raise a neck of ground back over a strait after the carves. Walkability is
  computed from the terrain and a `solid` prop only ever SUBTRACTS from the walkgrid, so a bridge
  model laid over a channel is scenery you swim underneath — a crossing has to be ground.
- **`plateau` masks** level what is there toward a target: full pull across the inner 55 %,
  smoothstepped out, so a settlement sits on a shelf with the hillside running off it. They lower
  as readily as they raise.
- **`pnpm world:settle`** places settlements, shrines and bridge dressing, pruning anything the
  new terrain drowned. `pnpm world:preview` now reads the ground under every building and reports
  the height spread and steepest slope — which caught two settlements built on 37–44° hillsides
  and a shrine standing in the sea, before a single row was written.

### Added — generate a whole world from island masks (2026-08-06, A2, game P12-A)

- **The map editor could not build the world it was written to build.** Its island button has been
  there since A2-d, and it generates into the RESIDENT region — capped at 13×13 chunks after 17×17
  was measured at 7.5 M triangles a frame. The Dawnlands are 32×32. A tool that can only see a
  fifth of the map cannot compose an archipelago out of it, so the whole-world pass runs on the
  server: `GET /api/map/generate-stream`, admin-only, lock-held, checkpoint taken first, progress
  streamed. It rewrites terrain and only terrain — placed objects re-sit on the new heights, which
  is what MAP_EDITOR §2.1's "non-destructive to placed props" means.
- Two things the per-chunk generator could not do. Masks **combine** rather than overwrite, so two
  overlapping isles become an isthmus instead of the second erasing the first; and `carve` masks
  **subtract**, which is how a strait severs an isthmus the masks just merged. That pairing is what
  lets a world be 55–60 % land AND have bridges that gate the path — six landmasses far enough
  apart to leave open water between them cannot cover that much of a 2048 m box.
- Erosion runs over the world as **one height field** rather than chunk by chunk. The per-chunk
  version has to skip border vertices because adjacent chunks share them and a one-sided edit tears
  the world open; that leaves an un-eroded lattice every 64 m.
- A splat rule can name a **`zoneId`** instead of carrying its own ring, and the server resolves it
  against the draft's zone layer. A copied polygon goes stale the first time somebody drags a zone
  corner, leaving the paint and the region describing different ground.
- **`pnpm world:preview`** runs the same synthesis in memory and prints what the result would be —
  land coverage, per-isle area, which isles are actually separate landmasses, land standing in no
  zone, unpainted texels, and an ASCII map. **`pnpm world:author`** does it for real through the
  panel and then asks the game which map it is serving.
- The preview earned its keep on the first run: its **flood fill found that three of five straits
  severed nothing**. A depth probe at each channel's own centre reported open water for all of
  them, which was true and beside the point — the isles simply joined around the ends of the cuts,
  and one carve had been typed at nearly a right angle to where it belonged. Straits derive their
  centre, angle and length from the two isles they separate now.

### Added — publish checks that a hint circle contains the thing it points at (2026-08-05, game P11-E)

- A hint circle is the only pointer the world map gives for a kill, collect, interact or deliver
  step. It is typed by hand on **this** page while the thing it points at is placed on the enemies
  page or on the map, so nothing had ever compared the two — and the P11 pilot set shipped with
  **four kill circles 85–170 m from their only spawner**. You could open the map, walk to the ring,
  and find bare ground. Publish now resolves every step's targets from the published spawners plus
  the map draft's own prop, node and villager layers, and warns with the distance: _"the hint circle
  at (−150, 60) r60 contains none of what the step is about — the nearest is 170 m away, 110 m
  outside the ring"_.
- It **warns rather than blocks**, because a circle can legitimately mark a route rather than a
  spawn, and it stays silent when nothing is placed yet — "not built" and "built somewhere else"
  are different states and only the second is a mistake. A tagged kill step is left alone: a
  spawner row cannot answer for a campTag.
- The geometry itself is `questHintCoverage` in `@dawned/shared`, not a copy here — same reason the
  TTK simulator runs the game's own `selectableEnemyAbilities`.

### Fixed — the pilot quest content the check found (2026-08-05, game P11-E)

- Re-authored all four kill hints onto the spawners that actually roll the enemy, gave the two
  gather steps circles (a player with no profession levels cannot be expected to know where birch
  stands), and stopped Hesta claiming mossbloom grows in the Weald when the placed mossbloom is
  360 m north of it.
- **Nothing a quest step needs is one-shot any more.** The crate and the four marked stumps carried
  `respawnMs: 0`, so a player who opened the crate before Torv offered the quest could never
  complete it — and neither could a run that had already measured it once. Both come back on a
  five-minute timer.

### Fixed — the pilot NPCs were authored with a clip that does not exist (2026-08-05, game P11-D)

- All four pilot villagers carried `idleClip: 'Idle'`. The animation library's name for standing
  still is **`Idle_Loop`**, and a composed rig plays nothing at all for a clip it does not have —
  so every one of them stood in Dawnhaven in a bind-pose T until a screenshot caught it. Re-authored
  here and re-published; the game moved its schema default to `Idle_Loop` and its client now falls
  back to a clip that exists rather than rendering a T-pose, so this cannot be silent again.
- Nothing about the editor changed. It is worth a **clip-name check** on the NPC form next time
  that surface is touched, the same way publish already refuses a model that is not in the baked
  manifest: an authored string that names nothing is exactly the failure mode this panel exists
  to catch before the world does.

### Added — the quest & dialogue editor (2026-08-05, A4, alongside game P11)

- **Content → Quests** edits quests and NPCs on ONE publish rail, because they reference each
  other: a quest names its giver, an NPC exists to be talked to. Shipping them apart would
  guarantee a window where a live quest points at an NPC that is not there yet.
- The flow validation is the **game's own** `validateQuestFlow`, not a copy — a quest this page
  calls valid and the server refuses to load would land at the next server boot instead of at the
  publish button. On top of it, the cross-checks a single row cannot make: every NPC, item, enemy
  and prerequisite a quest names has to be in the would-be-published set.
- **Journal preview** shows the prose and tracker lines a player will actually read, and the
  **chain graph** is built from `prerequisites` rather than from `chainId` — the label is what
  the journal groups by, the prerequisites are what the game gates on, and drawing the label
  would draw a graph that disagrees with the game.
- ƒ-suggests for XP and gold off the shared `suggestedQuestXp`/`suggestedQuestGold`; a
  grant-to-GM test hook proxied to the game's `/ops/quest` so an author can jump to step 3
  instead of replaying steps 1 and 2.
- Advisory warnings that do not block: a quest that pays nothing, a chain link nothing unlocks,
  a quest giver no quest names, and a `zoneId` naming no zone the map carries.
- `node tools/smoke/quest-editor.mjs` drives it in a real browser and cleans up after itself.

### Fixed — the map editor and the game disagreed about what an NPC placement IS (2026-08-05)

- A2 shipped a **local guess** at the NPC placement row — `name`, `modelRef` and a walk routine —
  months before game P11 defined the real one in `@dawned/shared`: an NPC points at a definition
  (`npcId`) and wears a composed appearance, so it has no mesh of its own and there is no patrol
  state to walk. The draft store and the bake then each validated with the schema they had, so
  the editor refused — with a 500 and nothing useful on screen — **exactly the row the bake was
  written to emit**. Both were real zod schemas, so nothing typechecked. The draft store imports
  the shared one now, and `map-bake.test.ts` asserts the property rather than the shapes: a def
  the BAKE accepts must survive the DRAFT store, for every layer.
- **The bake counted NPCs and never wrote them.** Same shape as the scatter bug A2/A3-e found,
  and a reminder that a count in the report is not evidence a row reached `placements.json`.
- Publish now **blocks** an NPC placement whose definition is not published — a villager standing
  invisible is silent in the world and invisible in the diff, exactly like the node rule.

### Changed — game P10 closed; two things it hands this panel (2026-08-05, game P10-G)

- The Professions editor's gathering preview estimates how many gathers walk a profession from
  one tier gate to the next. That number now has a **measured** counterpart: on the live server
  woodcutting goes 1 → 10 in **458 real gathers**, with the T2 gate at 248 — and both figures
  reproduce the shared XP curve's own arithmetic to the gather. The preview and the game agree.
  Worth surfacing as a reference row next time the page is touched, the same way the Enemies
  page's time-to-kill simulator wants the measured 78 dps rather than its default of 40.
- The game gained **`/ops/fish`**, which puts a named fish on a player's line. The reel bar's
  speed and width come from the fish's rarity, so this is how a rare or legendary bar gets
  played on purpose instead of waited for (a rare is one yield weight in ten). If this panel
  ever grows a fishing preview, that lever is how its numbers get checked against a real
  server — and it is the handle a GM would want on a Live Ops page.
- No editor or schema changes: P10-G was verification only.

### Changed — pull in the game's shared rebuild (2026-08-05, game P10-F)

- `@dawned/shared` moved `MARKER_MAX_SPEED` (the fishing marker's top speed) from 1.5 to 0.9,
  because the reel bar turned out to be unwinnable through one tick of command delay. No panel
  code changes, but rebuild shared in the game checkout and re-run `pnpm install` here, as after
  any game-side shared change.

### Added — the gathering catalogue was authored here (2026-08-05, game P10-E)

- **`tools/content/author-nodes.mjs`** puts the whole P10 catalogue through the panel: 42
  material/gem/proc/fish items, all 21 resource-node definitions, and 65 T1–T2 placements into
  the map editor's node layer, then publishes each on its own rail. Safe to re-run — an
  unchanged draft prunes itself and "nothing to publish" is treated as success rather than
  failure, so fixing one placement does not mean re-authoring the catalogue.
- The placement pass **checks the ground before planting**. Cluster entries are hints, not
  coordinates: it searches outward for terrain that suits the cluster (dry for a tree, wet for a
  shoal), drops members the terrain still refuses, and refuses loudly if nothing within 90 m
  works. The first pass without it put every fishing cluster on dry land and planted zero shoals.
- It **clears the node layer before writing**, because a re-run that only overwrites leaves the
  previous run's placements standing wherever they were — two trees were left behind at old
  coordinates, published, invisible in the diff.

### Added — the Professions editor (2026-08-05, A1-e, alongside game P10)

- **Content → Professions** edits what a birch, a copper vein, a herb patch or a shoal IS.
  Grouped by profession with tier and gate badges, the definition edits as JSON validated by the
  same schema the game boots with, Ctrl+S saves a draft and a draft identical to what is live
  prunes itself.
- **A gathering preview that runs the game's own roller.** Pick a profession level and it reports
  the hold time, the profession XP (halved when the tier is back country, which is a design rule
  and easy to lose), the proc chance, what a hundred gathers actually yield with item names
  resolved against the published catalogue, what one node gives per hour off its own hold +
  respawn cycle, and roughly how many gathers of it walk the profession from this tier's gate to
  the next. It previews **what is in the editor**, not what was last saved — a preview of the
  saved row lies for exactly one save, which is how you halve a number twice.
- **Fishing nodes show the bar.** Every catch listed with the drift speed and marker width its
  rarity buys, so a rare that nobody can land is visible before it is placed.
- **Publish refuses what would be silent in the world**: a yield or rare drop whose item is not
  published (the player holds for three seconds and receives nothing) and a model that was never
  baked (the node stands there invisible). A fishing spot with a "depleted" model warns —
  ripples leave no stump.
- **The map editor can place them.** The Place tool grows a resource-node layer with a kind
  picker reading what Professions has; markers take the placement's scale and are ringed at the
  DEFINITION's radius, because a node placement is deliberately thin and its true size lives on
  the definition. A map publish refuses a placement whose definition is not published.
- **`node tools/smoke/professions-editor.mjs`** drives the page in a real browser and checks the
  preview's arithmetic against the shared formulas — not merely that a table appeared.

### Fixed

- **A rebuild of `@dawned/shared` no longer needs the dev server restarted.** Vite ignores
  everything under `node_modules/`, and the game's shared package is linked into it, so a running
  panel kept serving the module text it read at boot and reported brand-new exports as missing —
  the same symptom as the stale pre-bundle that was fixed earlier, which is what made it easy to
  chase twice. The dev server watches the linked package now.

### Fixed — publishing a map you had painted (2026-08-05, A2/A3-e)

- **A publish that contained a scattered forest failed, and said nothing.** It stopped between
  "Writing zones" and "Resolving placements", left no error on screen and none in the log, and
  left a half-written staging directory behind each time. Painting foliage and publishing it —
  the ordinary path — had never once worked. Fixed; a publish now also **says why** when a bake
  fails instead of appearing to hang, and clears up after itself.
- **Old map bakes are swept.** Every publish minted a directory of about 8.6 MB and nothing ever
  removed one, so a day of world-building could quietly eat a gigabyte of the VPS. The five most
  recent survive as a rollback window (plus whatever is live); the sweep is reported in the
  publish panel and the audit log rather than done behind your back.
- **The live map is backed up now.** Published bakes were in neither git nor the nightly backup —
  the one part of the world a restore would not have brought back. `BACKUP.sh` archives the live
  one, and the bakes are kept out of git so an update on the server can never point the world at
  a map from somebody's laptop.

### Added — the §7 acceptance run (2026-08-05, A2/A3-e)

- **`node tools/smoke/map-scenario.mjs`** drives the whole acceptance scenario in a real browser
  against the real game: pan out to open water, sculpt an islet, paint it, scatter a forest, drop
  a camp, place a chest / shrine / vista, draw a zone with its own fog, validate, publish — then
  ask the GAME whether it is standing on the new world, read the islet's chunk and zone back out
  of what was published, and clear just that zone's props. Three parts of §7 the game cannot
  receive yet (patrol routes, T2 resource nodes, per-zone music) are reported as missing rather
  than skipped quietly.

### Added — scatter a forest, keep a prefab, rebind a key (2026-08-05, A3-d)

- **Foliage scatter brush.** Pick a scatter set, paint ground cover, hold `Ctrl` to clear it. What
  is stored is the density map the bake re-scatters from — a forest is a couple of hundred bytes,
  not fifty thousand rows — so painting stays instant and republishing does not shuffle the woods.
  A stroke that crosses a chunk seam paints both sides, the whole stroke is one undo step, and
  erasing a patch back to nothing deletes it rather than saving a grid of zeroes.
- **Scatter sets** are edited in the same card: name, the weighted list of models, how many
  instances per 100 m², and the slope and height limits that keep grass off cliffs and out of the
  sea.
- **Multi-select**: click replaces, `Shift`+click adds, `Shift`+drag draws a box. The box selects
  what it looks like it selects — markers stand up from the ground, and it tests where they are
  DRAWN, not the metre they were placed on.
- **Prefab collections.** Keep a group of placed things — a market stall set, a camp's furniture —
  and stamp it anywhere; what lands is plain placements, so the game never knows a prefab existed.
  They live in the database, not the browser, so they are shared and survive a cleared cache.
- **Selection sets and isolation.** Name a selection and come back to it later; loading one drops
  ids that no longer exist rather than pretending. Isolate hides everything else, because a
  translucent hundred markers is still a hundred markers in the way.
- **Every shortcut is rebindable.** The Keys card lists each action; click it, press a key. Taking
  a key from another action leaves that one unbound rather than silently swapping it, and a stored
  keymap from before a new tool existed gets that tool's default instead of a dead action.

### Added — editing a zone you already drew, and the shrine graph (2026-08-05, A3-c)

- **Zone corner handles.** Pick a zone from the tool bar (or click its border) and every corner
  gets a diamond you can drag, with a smaller dot on each edge that adds a corner where you click
  it. `Shift`+click a corner removes it. The handles stay the same size on screen as you pull the
  camera back, so editing a coastline does not mean zooming in on each corner in turn.
- **Edits that would break the shape are refused, with a reason.** Dragging a corner across the
  far edge, or removing the one corner holding two lobes apart, produces a ring that crosses
  itself — it looks like a normal polygon and then contains half of itself. A refused drag stops
  at the last good position instead of snapping back.
- **Shrines, campfires, signposts, portals and quest props** are placeable: the Place tool grew a
  kind picker, and each kind starts as a row that is already valid (a chest points at a real loot
  table, a signpost has words, a portal has a destination — itself, visibly, rather than one
  invented for you). A new shrine joins the travel graph by default.
- **Travel card**: every shrine-to-shrine hop with the gold it will cost, cheapest first, plus the
  graph drawn on the world coloured by price. Warnings for shrines left off the graph, a lone node
  with nowhere to travel to, and hops so short nobody would pay for them. The price comes from the
  game's own `fastTravelCost` (new in `@dawned/shared`) — the panel cannot quote a number the game
  will not charge.

### Fixed — three ways the editor could lie about the map (2026-08-05)

- **"Import live map" left the object list stale.** It reloaded the terrain and nothing else, so
  zones, spawners and props stayed as the draft had them — an import that restored a zone left the
  panel insisting the zone was gone and every camp "in no zone".
- **A zone border stole clicks from things standing on it**, and the next thing you press after
  selecting is often Delete. Solid markers now win the pick over outlines, and deleting a zone
  asks first — losing one takes its ambience with it and blocks publishing on "land in no zone".
- **Zone polygons were normalised to the opposite winding from the live world's.** Invisible at
  runtime (the game's point-in-polygon is even-odd and does not care) but it rewrote every zone the
  editor touched, and it renumbered corners mid-edit. Pinned now against a ring copied from the
  published bake.
- **The zone tool required ground under the cursor.** Zone borders run out over open water and past
  the streamed region, so half of every outline was untouchable; the tool now falls back to the
  world plane, which is where zone geometry lives anyway.
- **`@dawned/shared` is excluded from Vite's dependency pre-bundling.** It is the sibling game
  checkout on a `file:` link, and the cached pre-bundle survived rebuilds — a fresh export from the
  game repo showed up as "does not provide an export named …" for a symbol plainly there.

### Added — seeing what a camp layout actually does (2026-08-05, A3-b)

- **Aggro and leash rings** on every spawner, drawn at true size from the
  enemies it actually rolls — the widest reach among them, because that is what
  a player walking past will feel.
- **Camp links**: spawners sharing a tag are joined by lines through their
  centre, so a tag accidentally spanning a ridge reads as one shape instead of
  two camps. The spread in metres is listed, longest first.
- **Population per zone** against the CONTENT_0.1 budget: spawners, enemies
  standing at once, camps, and the rank mix. A spawner sitting in no zone is
  reported on its own rather than folded into a total.
- **Overlapping pulls**: pairs of camps whose aggro envelopes touch, with how
  many metres they overlap. Reported, never blocked — two camps bleeding into
  each other is sometimes the point.
- **Simulate populate** ghosts one resolution of a camp using the same
  uniform-over-area scatter the server spawns with, deterministic from a seed so
  you can change a count and see what changed rather than a fresh shuffle.
- **Patrol splines are deliberately absent** — see USER_QUESTIONS Q24. The AI
  has no patrol state, and an editor for a field the game ignores would look
  finished and do nothing.

### Fixed — autosave could quietly leave work unsaved (2026-08-05)

- **Editing while a save was in flight lost that work.** The second save was
  dropped instead of queued, so anything changed during the previous save sat
  unwritten — the editor kept saying "Unsaved changes" and only caught up if
  you happened to edit again. Saves now queue and settle.
- **Running a generator failed to save at all.** Island synthesis, erosion and
  auto-splat touch hundreds of chunks; the save was sent as one oversized
  request the server refused, and the editor showed a permanent "Save failed".
  Large saves are now split into batches the server accepts.
- **A refused save now retries by itself** instead of waiting for you to make
  another edit.

### Added — drawing zones (2026-08-05, A3-c)

- **Zone mode**: click along the ground to trace a border, `Enter` to close it,
  `Backspace` to take back a corner, `Esc` to abandon it. The outline rides the
  terrain as you draw, so you are tracing a coastline rather than guessing at
  numbers.
- **The editor refuses outlines that would misbehave in the game**: fewer than
  three corners, an outline that crosses itself, or one enclosing no ground. A
  crossed border is the nasty one — it looks like a normal shape and then
  contains only half of itself, so a player standing in the middle of the zone
  would get the wrong fog and no discovery XP.
- **Preview a zone's ambience in the viewport**: its fog, sky and light applied
  live, so "is 420 m of fog right?" is answered by standing in it instead of
  reading a number. Off by default — a zone's dusk hides the terrain you are
  shaping.
- Zones are what publishing blocks on (land in no zone reads as open ocean), so
  sculpting a new islet and putting it in the game is now possible end to end.

### Added — placing things in the world (2026-08-04, A3-a)

- **Place mode**: click the ground to drop a prop, an enemy spawner, a
  discovery point or a chest. New rows come out valid — the model, enemy and
  loot table default to things that are actually published — and the inspector
  opens on what you just placed so choosing the right one is the next thing in
  front of you.
- **Everything on the terrain is visible and clickable**: props, spawners,
  camps, POIs and chests as colour-coded markers, with rings drawn at TRUE size
  for the numbers you are actually deciding — a spawner's radius, a POI's
  discovery ring. Zone borders draw on the ground they cover. Foliage shows as
  the density map it really is, not a fake forest.
- **The layers panel** counts each kind, hides any of them, and carries
  "Clear layer…" — double-confirmed, and the server takes a checkpoint first,
  so wiping every prop in a zone is recoverable even after a reload.
- A marker whose ground has not streamed in yet is not drawn at all, rather
  than parked on the sea floor.

### Added — the Map Editor (2026-08-04, A2-c/A2-d)

- **The world is editable in the browser.** Content → World → Map Editor opens
  the island in 3D, rendered exactly the way the game renders it — same
  geometry, same splat colours, same water — because both sides now build
  chunks from one shared implementation. What you sculpt is what players get.
- **Sculpt and paint**: raise, smooth, flatten, set-height, terrace and noise
  brushes with four falloffs; 8-layer texture painting that can be masked to a
  slope band ("only on cliffs") or a height band ("only above the tree line");
  per-chunk water; and a board tool for deciding which chunks are world at all.
- **Generators to start from**: a seeded island (same seed, same island),
  thermal erosion that turns noise spikes into shapes you can walk on, and
  auto-splat that dresses terrain from its own slope and height. Each is a
  single Ctrl+Z.
- **Overlays that answer questions**: slope heat, a walkability preview in the
  game's own green/red/blue, height bands, and the chunk grid.
- **Cameras**: orbit for shaping, fly (WASD, speed scaled to how far out you
  are) for crossing the island, top-down for coastlines, and 1–9 slots.
- **Undo 220 steps deep**, grouped per stroke — a coastline undoes as a
  coastline, not one dab at a time.

### Added — Map editor foundations: draft store, validate, bake, publish (2026-08-04, A2-b)

- **The map is now editable data with a real publish rail.** Terrain drafts are
  stored chunk by chunk, so a brush stroke autosaves as a handful of 25 kB
  writes rather than the whole world. Everything standing on the ground is its
  own row, which is what makes "move this rock" one write and "wipe every prop
  in Emberwood" a scoped delete.
- **Import the live world into the draft** (`Import live map`). Without this the
  editor would open on empty ocean and the first publish would delete Dawnhaven,
  every camp and every zone. It reads the bake players are currently standing on
  plus the published spawner rows, and takes a checkpoint before overwriting an
  existing draft.
- **Validation catches what the viewport cannot show**: land in no zone (it
  would read as open ocean), a chest with no loot table, a prop whose model was
  never baked, a spawner inside a safe zone or pointing at an unpublished enemy,
  and — the one nobody finds by looking — content you cannot walk to, via a
  flood-fill from the spawn across the same walkgrid the server enforces.
  Floaters, buried props and per-chunk instance budgets report without blocking.
- **Bake + publish with live progress.** Chunk bins, walkgrid, zones,
  placements, meta and the world-map/minimap renders are staged into a temporary
  directory and renamed into place; the `current.json` pointer moves LAST, so a
  bake that fails halfway cannot take the world down. The game is then asked to
  hot-load the new map — no deploy, no restart.
- **One writer at a time**: a 45-second lease with takeover requests, and named
  checkpoints (gzip snapshots) you can restore, taken automatically before
  anything destructive.

### Added — Enemies editor: bestiary, spawners, time-to-kill (2026-08-04, with game P9)

- **Content → Enemies**, two tabs on one publish rail. Enemies and spawners ship
  together because separating them ships the two failures neither can catch
  alone: a spawner without its enemy is a camp that silently never populates,
  and an enemy nothing spawns is invisible.
  - _Enemies_: the bestiary listed by level band the way NPCS_ENEMIES.md §4
    reads it, with rank badges (ELITE / BOSS) and archetype at a glance, over
    the shared-schema JSON editor.
  - _Spawners_: where the bestiary actually stands — position, count, camp tag.
- **The time-to-kill panel** runs the SAME `selectableEnemyAbilities` the live
  AI picks with, so the rotation it shows is the rotation that will be fought.
  It answers both directions — how long you need to kill it, and how long it
  needs to kill you — because a number for only one side is how an enemy ends
  up unkillable or harmless. It weights each ability by the share the game's
  weighted pick will actually give it, counts a self-shield as zero damage
  rather than free DPS, shows the whole kit a boss will EVER unlock instead of
  just phase 0, and names the COMBAT.md §12 60–120 s boss window when a fight
  misses it. Abilities unusable at the range being tested simply do not appear
  — which is how you find a "ranged" enemy that would stand and stare.
- **Publish cross-checks**: unresolvable spawner refs and unpublished loot
  tables block; judgement calls warn without blocking (a boss with no phases,
  a boss with no arena, a `ranged` row carrying nothing ranged, a `charger`
  with no charge). Row-level problems are refused at SAVE rather than held
  until publish — an editor should learn a charge cannot overshoot while
  looking at that charge.
- **Publish now refuses a clip the model does not own.** The Quaternius rig
  families use non-interchangeable clip names, and asking a rig for a clip it
  lacks is silent — the attack lands and animates nothing (the P5 Spore
  Lobber's panic swat had been doing exactly that). The game's shared build
  records which clips each baked model owns; the cross-check reads it.
- **`tools/content/author-bestiary.mjs`** authors the whole P9 bestiary through
  these endpoints — 17 enemies, 20 spawners — and prints the TTK table for every
  published enemy afterwards, so a content change is never merged without
  someone having looked at what it does to the fights.
- **Fixed before it shipped**: the rotation preview used a plain LCG whose
  long-run distribution is fine but whose first twelve values from a small seed
  are badly unrepresentative (3/12 where 7 were expected). Sitting directly
  under the weight table, it would have contradicted the numbers above it. It
  now uses the same mixed RNG as the loot simulator, and a test pins the
  distribution rather than just checking both abilities appear.

### Added — Item editors: items, loot tables + vendors (2026-08-04, with game P8)

- **Content → Items**, three tabs on one publish rail (they reference each other, so
  they ship together or they ship dangling):
  - _Items_: category-grouped catalogue with rarity chips and item levels; the selected
    def opens as SHARED-schema-validated JSON above a **budget meter** that prices it
    against ITEMS_LOOT §2 for its slot, ilvl and rarity — spent vs budget as a bar,
    the rolled-attribute count a drop will add, free armour from the armour class, and
    ƒ-suggest buttons that write the suggested value, weapon band, or a proportional
    rescale of the stat block straight into the draft. Duplicate icons are flagged
    while typing, not at publish time.
  - _Loot_: a **1 000-roll simulator** driven by the SAME shared roller the game drops
    with — killer level and rolls-per-kill adjustable, per-item drop rate and average
    stack size, gold frequency and average, and the honest "nothing at all" share
    (`nothing` is a real weighted entry, so the preview cannot flatter the table).
    Unknown refs are called out inline.
  - _Vendors_: stock priced by the shared value/sell formulas, so the preview shows
    exactly what the server will charge and pay.
- **Item publish** rides publish v1's rails and adds cross-checks: icon slugs unique
  across items (§8), every loot-table item/table ref and vendor stock ref resolvable,
  no self-nesting loot cycles, and every loot table that a LIVE published enemy still
  rolls must survive the publish. Budget deviations report as advisory **warnings** —
  an item may deviate on purpose, it just may not deviate by accident.
- **Fixed:** draft pruning compared the incoming def against the raw jsonb column, whose
  key order Postgres normalises — an identical draft could read as a difference and sit
  in "n pending" forever. Both the item and progression editors now compare parsed
  against parsed.
- 6 new integration tests (schema refusal, draft/diff round-trip with budget pricing,
  duplicate-icon/dangling-ref/cycle refusals, three-table publish, prune-on-match,
  gm read-only); 25 total green.

### Added — Progression editors: XP curve + skill trees (2026-08-04, with game P7)

- **Content → Progression**, the panel's second content editor pair, one page, two tabs:
  - _Skill trees_: pick a class, see its three branches as columns laid out by unlock tier
    (capstones marked, draft dots live); selecting a node opens the full definition as JSON
    validated by the SHARED `skillNodeDefSchema` (per-rank cumulative effects and all), with
    the node's tier gate spelled out. Ctrl+S saves drafts, prune-on-match, per-node discard —
    the same editing contract as Abilities.
  - _XP curve_: all 29 level rows in one table — editable `xpToNext`, the cumulative total
    precomputed per row, the design formula's reference value alongside (ƒ-suggest per the
    editor spec) and a one-click reset-to-formula for any row the owner has bent.
- **Progression publish** rides publish v1's rails (diff → validate-all → transactional copy
  → `/ops/reload-content`) and adds the tree cross-checks: curve completeness (no missing
  levels), node ability-references resolved against published abilities (including
  cooldown-reset/free-cast/proc targets), branch cell collisions (`class/branch#order`), and
  exactly one capstone per branch. Any failure refuses the whole publish; everything audited.
- **The editors shipped the P7 content**: the full XP curve (29 rows) and all 96 CLASSES.md
  skill nodes authored through the panel API and published live
  (`tools/content/author-progression.mjs`, node definitions in
  `tools/content/progression-data.mjs`), hot-reloaded into the running game; the game repo's
  seed migration 0010 mirrors the set for fresh deploys. 4 new integration tests (curve +
  node draft round-trips, unknown-ability-ref refusal, order-collision refusal); 19 total
  green.

### Added — Abilities editor + publish pipeline v1 (2026-08-03, A1 begins)

- **Content → Abilities**: the panel's first full content editor. Every ability
  grouped by class with slot/basic/RMB bindings and draft markers; the selected
  def opens with its hot tuning numbers (cost, cooldown, cast, unlock, swing)
  lifted into quick fields and the complete definition as JSON validated live
  by the SHARED `abilityDefSchema` — the exact validator the game server boots
  with, so the editor can never drift from the game. Saves write DRAFTS only
  (Ctrl+S), drafts identical to the published row are pruned, and drafts can
  be discarded per ability.
- **Publish v1**: the pending-changes panel diffs every draft against its
  published row (changed field paths), then validate + publish copies the
  whole draft set live in one transaction — any invalid draft or class/slot
  collision refuses the entire publish. On success the panel pokes the game's
  new `/ops/reload-content`, so ability numbers apply to the LIVE server
  without a restart (the response reports reload state; an unreachable game
  simply picks the rows up at next boot). Everything audited.
- 3 new integration tests (draft validation messages, the save→diff→publish→
  prune round-trip, slot-collision refusal); 15 total green.
- **The pipeline shipped its first real content**: all 28 P5 kit rows authored
  through the panel API and published live (`tools/content/author-kits.mjs`);
  the slot-collision cross-check caught a leaked test fixture on its first
  live run — refusing the publish exactly as designed.
- **Live-tune proof** (`tools/content/live-tune-proof.mjs`): re-runnable
  end-to-end demonstration of the P5 DoD — a coefficient edited as a draft,
  published, hot-reloaded into the running game, verified served, reverted
  the same way. No restarts anywhere.

### Fixed — blank page at /admin in production (2026-08-03)

- The deployed panel rendered a **blank white page**: the game repo's Caddyfile proxied
  `/admin` with `handle` (prefix kept) while the panel is built against stripped paths
  (`handle_path`), so the SPA fallback answered `/admin/assets/*.js` with `index.html` and the
  browser refused the bundle on MIME. Fixed in the game repo's `deploy/Caddyfile`
  (`handle_path /admin*`, now pinned by a vitest there).
- Fonts now ship as same-origin files instead of `data:`-inlined CSS URIs
  (`assetsInlineLimit: 0`): the production CSP (`font-src 'self'`) silently refused the inlined
  Inter subsets — dev never showed it because Vite applies no CSP.
- Production static serving got real cache headers: hashed `/assets/*` immutable for a year,
  `index.html`/SPA fallback `no-cache` (a cached index after a deploy references bundles that no
  longer exist — the same rule the game's Caddyfile enforces), and the deep-link fallback now
  answers `HEAD` like `GET`.
- **New smoke — `node tools/smoke/admin-prod-serve.mjs`**: boots the built panel in
  `NODE_ENV=production` behind a replica of the real Caddy `/admin` block (prefix strip + the
  actual CSP parsed from the sibling game checkout) and drives Chromium through load, asset
  MIME/caching checks, font loading and a full login. The dev stack structurally cannot catch
  this bug class; this closes the gap the A0 deploy fell through.

### Changed — deploy determinism (2026-08-03)

- `@dawned/shared` is now a **sibling-checkout dependency**
  (`file:../Dawned/packages/shared`) instead of a SHA-pinned GitHub git
  dependency: pnpm resolves GitHub git deps to codeload tarballs, which private
  repos cannot serve credential-less on the VPS — the panel build died there.
  Dev machines, CI and the VPS all keep the repos side by side (the game repo's
  deploy scripts provide a `Dawned → game` symlink and build shared first);
  both repos deploy from `main` together, so the contract stays in lockstep.
  CI now checks out the game repo as a sibling (same `DAWNED_SHARED_TOKEN`
  secret, used for checkout instead of tarball auth).

### Added — Phase A0: foundation (built 2026-08-02; owner sign-off pending)

- **The panel exists**: React 19 + Vite SPA and Fastify API in one repo, served under
  `/admin` (Caddy strips the prefix; dev mirrors it), with `@dawned/shared` consumed as a
  SHA-pinned git dependency so schema/validation/formulas can never drift from the game.
- **Sign in with game accounts**: argon2id verification against the shared `accounts` table,
  restricted to `gm`/`admin` roles; 12 h sliding admin sessions as httpOnly SameSite=Strict
  cookies; login rate limiting; CSRF header on every mutation; every panel action writes the
  shared `audit_log`.
- **"Workshop" design system core**: dark dense tokens (no serifs, 2 px corners, hairlines,
  gold reserved for publish/live), app shell with the corner-cut logo, left rail with future
  modules parked under their phase tags, and a Ctrl+K command palette.
- **Dashboard v1**: live game-server card (online state, players, uptime, protocol, tick-p95
  sparkline against the 15 ms budget, RSS, net out — reads the game's health + ops metrics
  APIs; an unreachable game renders as a state, not an error) and a publish card counting
  real pending drafts (pipeline itself arrives with A1).
- **World Settings editor** — the first schema-driven form: generated from the shared
  `worldSettingsSchema` (xpRate, day/night switch, MOTD) with per-field enhancements, inline
  zod validation, draft badges, Ctrl+S, dirty-leave warning and gm read-only mode. Saves are
  **drafts only** (`content_world_settings.status='draft'`); publishing stays A1's job.
- **Verification**: 12 vitest (API integration against real Postgres + form generator) and a
  Playwright smoke — login → live dashboard → edit → save draft → reload persists → discard.
  CI runs the full check against a Postgres service (needs the `DAWNED_SHARED_TOKEN` secret).

### Added

- Complete planning documentation for the admin panel:
  - Product & UX specification (navigation, "Workshop" design system, publish flow, Live Ops,
    asset browser) — docs/ADMIN_DESIGN.md
  - Full 3D Map Editor specification (terrain sculpt/paint, placement, foliage scatter, spawns,
    zones/POIs, layers with per-zone clear, undo/redo, validate→bake→publish, play-test bridge,
    keymap, acceptance scenario) — docs/MAP_EDITOR.md
  - Content & Quest editor specifications (schema-driven framework, per-type editors with
    designer helpers: budget meters, TTK calculator, loot roll simulator, quest step canvas &
    dialogue editor, publish semantics) — docs/CONTENT_EDITORS.md
  - Architecture (React/Fastify/three.js, shared-schema strategy via `@dawned/shared`, auth &
    audit, data-access rules, bake workers) — docs/ARCHITECTURE.md
  - Roadmap A0–A6 synced to the game repo's phases; CLAUDE.md/AGENTS.md working agreements.

### Changed

- Folded owner decisions (2026-08-02): admin panel confirmed at `play.pathlands.cc/admin` with IP
  allowlist off; password resets via this panel confirmed; zone editing gains **weather
  probability sliders** and the Map Editor zone preview can force a weather state (weather is now
  0.1.0 visual scope in the game — see game repo WORLD.md §4.6).

### Notes

- No code yet by design — implementation starts at A0 once the game repo's P1 delivers the shared
  schema package.
