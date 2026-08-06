# AGENTS.md — Dawned-Admin

Instructions for AI coding agents in this repository. **CLAUDE.md here is canonical and complete —
read it first**, plus the game repo's CLAUDE.md (one project, two repos; game docs are design
truth).

## TL;DR

- This repo = Dawned's admin panel: 3D Map Editor, content DB editors, quest editor, Live Ops.
  React 19 + Vite SPA · Fastify API · three.js viewport · shared Postgres · `@dawned/shared`
  (file: dep on the sibling `../Dawned` checkout) for schema/zod/formulas.
- **Hard rules:** drafts→validated publish pipeline only (never mutate live content directly) ·
  player-data writes are narrow typed audited endpoints · live actions only via the game's
  localhost ops API · forms generated from shared zod schemas · autosave/undo/confirm-gates on
  destructive things · TS strict, no `any` · "Workshop" design system (docs/ADMIN_DESIGN.md §2),
  no serifs, no rounded-blob UI · be gentle to the 1-core VPS (niced workers, pagination,
  code-split modules).
- **Process:** follow ROADMAP.md A-phases (synced to game P-phases); `pnpm check` before done;
  CHANGELOG `[Unreleased]`; design questions go to the game repo's USER_QUESTIONS.md with a
  recommended default.
- **Freshness checklist (every task):** ROADMAP row + phase block · CHANGELOG · README status
  block · CLAUDE/AGENTS current state in BOTH repos · docs you touched · no hardcoded
  phase/version strings in the UI · counts you quote re-read from the run you just did.
- **State (updated 2026-08-06):** A0 ✅ closed — the owner logged in at
  play.pathlands.cc/admin and the panel works (scaffold, panel auth gm/admin + audit,
  Workshop shell + palette, live dashboard, schema-form World Settings drafts). A1's
  Abilities editor + publish v1 is live (drafts → validate + slot-collision cross-check →
  transactional publish → game hot reload); all 44 ability rows (P5 + P6 kits) were
  authored/published through it and the live-tune DoD is proven re-runnably
  (`tools/content/live-tune-proof.mjs`). A1-b (game P7) is live too: Content → Progression
  (skill-tree tab with tier-laid branch columns + shared-schema JSON node editing; XP-curve
  tab with cumulative + formula reference and reset-to-formula) publishing over v1's rails
  plus tree cross-checks; the full P7 set (29 curve rows + 96 nodes) went live through it
  (`tools/content/author-progression.mjs`), 19 tests green. A1-c (game P8) is live as well:
  Content → Items with three tabs on one publish rail — items (a budget meter against the
  ITEMS_LOOT §2 formulas with ƒ-suggest and a duplicate-icon warning), loot (a 1 000-roll
  simulator through the shared roller the server drops with) and vendors (stock priced by
  the shared value/sell formulas) — publishing with icon-uniqueness, ref-resolution,
  loot-cycle and live-enemy-table cross-checks plus advisory budget warnings; 25 tests
  green. The whole P8 catalogue was authored here and published — 62 items, 5 loot tables,
  5 Dawnhaven vendors, plus the shore/weald enemy loot bindings
  (`tools/content/author-items.mjs`) — and the game froze the result into its seed
  migration 0012. Current:
  game P0–P11 are all closed on their measured DoDs (P9 + P10 on 2026-08-05 and
  owner-accepted; P11 on 2026-08-06) and **A4 — the quest & dialogue editor — is BUILT and
  carried its whole pilot set**. Phases close on the measured
  DoD, not on a playtest; all feel/number tuning is one pass at the end of the project.
  **A1-d — Enemies is live** (2026-08-04): bestiary + spawners on one publish rail, level-
  banded list with rank badges, and a time-to-kill simulator that runs the game's own
  `selectableEnemyAbilities` so the previewed rotation is the fought rotation (both sides
  of the trade, range-aware, boss-window aware). Publish blocks on unresolvable spawner
  refs and unpublished loot; boss-with-no-phases and archetype mismatches warn only.
  41 tests green. **Pull in after the next `@dawned/shared` rebuild:** the game's P9-D
  round added `shieldDurationMs` to the enemy ability schema (self-shield duration,
  default 12 000 ms) — schema-driven, so the form gains it with no editor code.
  **Game P9 closed (2026-08-04, accepted 2026-08-05):** the King solos in 105 s, inside
  the 60–120 s design window. Lesson for this panel: the TTK simulator's **player dps input
  is the whole answer** and the page defaults it to 40, where a properly built level-12
  warrior measures 78 (an unspent one, 30). A guessed dps can be 3× off and send someone
  re-balancing a boss that was fine — worth a measured reference on the sim controls.
  **A1-e — Professions is live** (2026-08-05, alongside game P10): Content → Professions
  edits `content_resource_nodes` — what a birch, a vein, a herb patch or a shoal IS.
  Definitions here, placements in the map editor's `node` layer, resolved against each
  other at publish (the enemies/spawners split). The page's point is the **gathering
  preview**, which runs the game's own `rollGather` at a chosen profession level: hold
  time, profession XP with §1.3's back-country halving, proc chance, items per 100 gathers
  with names resolved against the published catalogue, one node's yield per hour off its
  own channel+respawn cycle, and gathers-to-the-next-gate. It previews the EDITOR BUFFER,
  not the saved row — previewing the last save lies for exactly one save. Fishing nodes
  also list each catch with the bar difficulty its rarity buys. Publish blocks on an
  unpublished yield/proc item and on an unbaked model (both silent in the world); a
  fishing spot with a depleted model warns. Map editor: kind picker in the Place tool,
  thin placements, markers scaled by the placement and ringed at the DEFINITION's radius ×
  that scale, bake refuses a placement whose definition is not published.
  `node tools/smoke/professions-editor.mjs` checks the preview's ARITHMETIC against the
  shared formulas in a browser. 196 tests green. **Trap closed:** a `@dawned/shared` rebuild used to need
  the dev server restarted — Vite ignores `node_modules/` and the package is a `file:`
  link into it, so the running server kept serving boot-time module text with the same
  "does not provide an export named X" symptom `optimizeDeps.exclude` already fixed.
  `server.watch` un-ignores the linked package now.
  **Game P10-E ran the whole gathering catalogue through this panel (2026-08-05)** —
  `tools/content/author-nodes.mjs`: 42 material/gem/proc/fish items, all 21 resource-node
  definitions and 65 T1–T2 placements, each published on its own rail, ending with a map
  publish the game hot-swapped onto. That is the Professions editor's first real load, and it
  held. Two things the run taught the tooling: a content script must be **safe to re-run** (an
  unchanged draft prunes itself, so "nothing to publish" is success, not failure — otherwise
  fixing one placement means re-authoring everything), and a placement pass must **clear its
  layer first**, because overwriting by id leaves the previous run's rows standing wherever they
  were. Moving a cluster fifty metres left two trees at the old spot: published, invisible in
  the diff, findable only by walking there.

  **Game P10-F is built (2026-08-05).** No editor work needed, but a shared number moved:
  `MARKER_MAX_SPEED` 1.5 → 0.9 (the reel bar was unwinnable through one tick of command
  delay — 20/20 offline, 0/12 on the wire). Rebuild shared in the game repo, `pnpm install`
  here. If this panel ever grows a fishing preview it must run the shared reel, not a copy —
  same rule as the TTK sim running `selectableEnemyAbilities`. Q27 (T5 legendary difficulty)
  was answered 2026-08-05 — leave the reel as shipped, judge it in the playtest.

  **Game P10 is closed (2026-08-05).** No editor work needed; two findings are this panel's
  business. (1) The Professions preview's "gathers from this gate to the next" now has a
  measured counterpart: woodcutting 1 → 10 in **458 real gathers** on the live server, T2 gate
  at 248, both reproducing the shared curve's arithmetic to the gather — worth a reference row
  next time the page is touched, like the Enemies TTK sim wanting the measured 78 dps over its
  default 40. (2) New game lever **`/ops/fish`** names the fish on a player's line; since the
  reel's difficulty comes from rarity, that is how a rare or legendary bar gets played on
  purpose — the handle a fishing preview (or a Live Ops page) would check itself against.
  **A2-a/A2-b — the map editor's foundations are in (2026-08-04).** Shared (game repo)
  owns brush math + deterministic scatter so preview, bake and server agree; draft
  tables are migration 0014. Here: chunk-granular draft CRUD behind a 45 s single-writer
  lease with takeover, gzip checkpoints + restore, per-layer clear; `validateDraft`
  (zone coverage, model/loot/enemy refs, safe-zone spawners, walkgrid flood-fill
  reachability, floater/buried + per-chunk instance budgets); `bakeDraft` staging into
  `.tmp` then renaming, with SSE progress. Publish mints `map-<epoch>`, repoints
  `current.json` LAST, mirrors the spawner layer into published `content_spawners`, then
  pokes `/ops/reload-map` + `/ops/reload-content`. `POST /api/map/import-live` seeds the
  draft from the live world — without it the first publish would delete Dawnhaven.
  61 tests green.
  **A2-c/A2-d + A3-a are in (2026-08-04).** The viewport renders chunks through the
  SAME shared geometry the game client uses; orbit/fly/top cameras with slots; slope,
  walkability and height overlays; all six sculpt brushes, masked splat painting, water,
  board toggle, ruler; island/erosion/auto-splat generators; a 220-step byte-snapshot
  undo grouped per stroke; the streaming publish panel. Placed objects draw as markers
  with true-size rings, zone polygons and scatter density; Place stamps a
  prop/spawner/POI/chest with published-ref defaults; a layers panel counts, hides and
  clears (checkpointed). Resident region follows camera zoom, capped at 13×13 chunks
  (17×17 measured at 7.5 M triangles/frame). `tools/smoke/map-editor.mjs` drives it all
  in a real browser and measures PIXELS — four bugs came out of looking, none from a
  failing assertion.
  **Autosave hardening (2026-08-05):** a flush landing during another flush was DROPPED
  rather than queued (losing everything dirtied meanwhile), and a generator-sized save
  blew the endpoint's 64-chunk limit and failed permanently. Both fixed + retry-on-refusal,
  pinned by `draft-store.test.ts`. Neither reproduces on a fast machine — the slow browser
  run is what found them.
  **A3-b spawns mode (2026-08-05):** aggro/leash rings at true size from the enemies a
  spawner actually rolls, camp links with the spread in metres, per-zone population vs the
  CONTENT_0.1 budget (unzoned spawners on their own line), overlapping-pull pairs reported
  but never blocked, and a deterministic simulate-populate using the server's own
  uniform-over-area scatter. 11 tests. Patrol splines deliberately NOT built — no patrol
  field on the schema, no patrol state in the AI, so the editor would author data nothing
  reads (game repo USER_QUESTIONS Q24).
  **A3-c zone drawing (2026-08-05):** trace a border, Enter closes, Backspace takes a
  corner back, Esc abandons; the polygon is normalised to the winding the shipped world
  uses, and a self-crossing ring is REFUSED — it looks normal and then contains half of
  itself (wrong fog, no discovery XP), so it is tested rather than left to the eye. A
  selected zone previews its fog/sky/light in the viewport. This unblocks §7: publish
  blocks on land in no zone.
  **A3-c zone editing + shrine graph (2026-08-05):** draggable corner handles with
  insert dots on the edges and Shift+click to remove, every edit refused if the ring
  would cross itself (including the delete case). Shrines/campfires/signposts/portals/
  quest props placeable via a kind picker, each stamping a row that passes shared
  `validateInteractable`. The Travel card prices every hop with `fastTravelCost`, new in
  `@dawned/shared` so the panel cannot quote a number the game will not charge. Four bugs
  came out of the browser run: the live-map import never reloaded the object list;
  `normalisePolygon` reversed the winding the shipped world uses; a zone border stole
  clicks from markers standing on it and one Delete ate Dawnshore (markers now beat
  outlines, zone deletes confirm); and the zone tool required terrain under the cursor,
  making the half of every outline that runs over water untouchable.
  **A3-d (2026-08-05):** scatter brush painting the per-chunk density grid (seam-aware,
  one save + one undo per stroke, emptied patches deleted) with a scatter-set editor;
  multi-select by click / Shift+click / Shift+drag marquee testing DRAWN positions;
  prefabs stamping plain placements from a stored relative layout (game migration 0015,
  `map_editor_collections`); selection sets that drop dead ids; isolation that hides and
  composes with layer hiding; and a fully rebindable keymap. The browser run caught one
  more: scatter dabs re-read the store each dab, so a stroke kept only its last dab —
  `strokeBase` owns that precedence now. Transform gizmos/snap/jitter deliberately not
  built.
  **A2/A3-e (2026-08-05) — the §7 acceptance run closes both phases** (A2 ✅ done, A3 ✅
  built; the owner's own unassisted run is the last word). `tools/smoke/map-scenario.mjs`
  performs the whole §7 sentence in a browser against the real game: pan to open water,
  sculpt an islet, paint, scatter a forest, drop a 21-spawner camp, place chest/shrine/
  vista, trace a zone with its own fog, validate, publish — then ask the GAME whether it
  swapped worlds (`dev-2 → map-<epoch>`, no restart), read the islet's chunk bin and zone
  back out of the bake, and clear just that zone's props. Patrol routes (Q24), T2 resource
  nodes (Q25) and per-zone music (Q26) are reported missing, not faked. See MAP_EDITOR §7.1.
  **It found that no publish carrying scatter had ever worked**: the bake handed draft
  scatter rows (which carry a row `id`) to the game's `.strict()` placements schema, so it
  threw between "zones" and "placements" with nothing on screen, nothing in the log and a
  staging dir left behind. Rows are projected now rather than cast, the throw is logged, a
  failed bake clears its stage, and `map-bake.test.ts` BAKES — validation passing is not
  proof a draft bakes, they run different schemas. Also: publishing sweeps old bakes
  (`pruneOldBakes`, 5-deep window — each is ~8.6 MB and nothing removed them), and the live
  bake is git-ignored + archived by the game's `BACKUP.sh`.
  172 tests green; `map-editor.mjs` and `map-scenario.mjs` both pass end to end. (Running
  both against one world found a third thing: `map-editor.mjs` measured its scatter erase
  against EVERY patch in the draft, so the islet's deliberately-left forest read as
  "erasing left 13 077 density behind". It counts its own set now.)

  **A4 — the quest & dialogue editor is live** (2026-08-05, with game P11): quests + NPCs on
  ONE publish rail (they reference each other, so shipping them apart guarantees a window
  where a live quest points at a missing NPC), validated by the GAME's own
  `validateQuestFlow` rather than a copy — a quest this page calls valid and the server
  refuses would fail at the next server BOOT, not at the button. Plus the cross-checks a row
  cannot make (every NPC/item/enemy/prerequisite resolves) and four advisory warnings that
  never block. The **chain graph reads `prerequisites`, not `chainId`** — the label groups
  the journal, the prerequisites are what the game gates on. Journal preview, ƒ-suggested
  rewards from the shared formulas, grant-to-GM via the game's `/ops/quest` (rule 3),
  `tools/smoke/quest-editor.mjs` in a real browser. **219 tests green** (225 after the hint
  cross-check below).
  Game P11-C authored its whole pilot set through it (`tools/content/author-quests.mjs`: 4
  NPCs, 8 quests, 4 NPC / 7 interactable / 6 POI placements, then a map publish the game
  hot-swapped onto), and that run found **the map editor and the game disagreeing about what
  an NPC placement IS**: A2 shipped a local guess (`name` + `modelRef` + a walk routine)
  before P11 defined the real shared row (`npcId` + a composed appearance — no mesh, no
  patrol state), so the draft store refused with a 500 exactly the row the bake emits. Both
  were real zod schemas; nothing typechecked it. `map-bake.test.ts` asserts the property now:
  a def the BAKE accepts must survive the DRAFT store, for every layer. Also from that run:
  the bake **counted** NPCs and never wrote them, and an unpublished NPC definition now
  blocks publish like a node's does.
  **Layer ownership decides whether a script may clear a layer.** `npc` is the script's alone
  → clear first (the author-nodes lesson). `interactable` and `poi` are SHARED with hand
  placement in the editor → upsert by id only, or you delete the owner's shrines.

  **Game P11-D (2026-08-05) found one thing here.** The four pilot NPCs were authored with
  `idleClip: 'Idle'`; the UAL library's standing clip is `Idle_Loop`, and a composed rig plays
  NOTHING for a name it lacks — every villager stood in a T-pose. Re-authored and re-published.
  Clearest case yet for a **clip-name check on the NPC form**: publish already refuses a model
  that is not in the baked manifest, and an authored clip that names nothing is the same silent
  mistake.

  **Game P11-E closed the phase (2026-08-06) and found this page's real gap.** Its DoD run
  plays the pilot chain with only in-game affordances, so it walks to the circle the MAP draws
  — and four of five kill hints sat **85–170 m outside their only spawner**, while both gather
  steps had no circle at all. Neither row was wrong on its own: the circle is typed on Content →
  Quests, the spawner is placed in the map editor, and the two pages had never met. Publish now
  resolves each step's real targets (spawners for a kill, node placements for a gather,
  NPC/interactable placements for the rest) and **warns with the distance quoted** —
  `questHintCoverage` went into `@dawned/shared`, not a copy here, because the game's map draws
  the same circle. It warns rather than blocks: §1 rule 4 says the map hints _roughly_ where,
  and a deliberately loose circle is a choice, 170 m off is not. Content re-authored through
  this surface (hints re-pointed, two gather hints added, Hesta's prose fixed). One more rule
  from the same run: **nothing a quest step needs may be one-shot** — the crate and stumps were
  `respawnMs: 0`, so opening the crate out of curiosity ended "The Lost Crate" before it could
  be taken. Spent state is per-character; both are 300 000 ms now, and an interactable a quest
  step NAMES with `respawnMs: 0` is worth a form-level nudge next time this page is touched.
  **225 tests green** (the cross-check added 6 of them); the game finished at 642.

  **A2 grew whole-world generation for game P12 (2026-08-06).** The editor's island button works
  on the RESIDENT region (13×13 chunks) and the world is 32×32, so `/api/map/generate-stream`
  does it server-side: admin-only, lock-held, checkpointed first, streamed. Masks COMBINE rather
  than overwrite (overlapping isles make an isthmus) and `carve` masks SUBTRACT (a strait severs
  one) — which is what lets a world be 55–60 % land AND have bridges that gate. Erosion runs over
  ONE 2049² field, because the per-chunk pass must skip the border rows chunks share. A splat rule
  names a `zoneId` resolved against the draft rather than carrying a ring that can go stale.
  `pnpm world:preview` runs the same maths offline; its flood fill found **three of five straits
  severing nothing** while a centre-depth probe called them all open water. `pnpm world:author`
  ran it for real — 1024 chunks, 766 with land, 57.6 % coverage, 0 unclaimed texels, matching the
  preview exactly. Not published: the new sea sits where the dev island was. **248 tests green.**

  **Game P12-B settled the world through this panel (2026-08-06).** `pnpm world:settle`: 40
  buildings, 9 shrines, 35 plank sections, and a prune of the 46 rows the new sea drowned. New
  mask kinds `causeway` and `plateau`. **Two latent panel bugs surfaced:** `listObjects` had no
  ORDER BY (harmless until the Dawnsea's ring overlapped every land zone — `zoneAt` takes the
  first match, so an unchanged draft could bake Dawnshore as ocean one publish and not the next);
  and `findSpawn` took the first zone with a settlement, so with five settlements **a new
  character could have spawned in the level 24–30 camp**. Objects order by id, the bake sorts
  zones by area (smallest wins), the starter settlement is the lowest level band. A third, in the
  content script: pruning by matching validateDraft's PROSE missed props, which use a different
  sentence. **259 tests green.**

**Game P12-C ran the whole bestiary through this panel (2026-08-06)** — `pnpm world:bestiary`:
50 enemies, 7 zone loot-table stubs and **124 camps**, published on the Enemies rail AND written
into the map's `spawner` layer, because Q23 makes the MAP the owner of where a camp stands and a
map publish delete-then-inserts that whole published set. Every P4–P9 camp was re-placed: they
stood on the dev island, which the Dawnlands put under open water.
**Two pieces of tooling landed with it, and the node/POI/NPC passes reuse both.**
`tools/content/world-sample.ts` holds ONE in-memory synthesis of the world (the same `synthWorld`

- `erodeField` the generate endpoint runs) so every content script asks the same ground "is there
  land here, how steep, which landmass, which zone". `tools/content/placement.ts` turns a WISH —
  zone, bearing from that isle's heart, distance — into a coordinate by spiralling outward until
  every constraint holds, and it reports WHICH constraint each rejected candidate failed. It is
  **capped at 120 m on purpose**: an unbounded search always succeeds and quietly moves a camp a
  third of an isle away, which turns an authored difficulty gradient into scatter and reads as
  success. Two wishes hit that cap and were fixed rather than absorbed.
  **The bug that mattered is this panel's, and it had been live since A1-d: the Enemies page's
  prune-on-match compared the RAW jsonb column.** Postgres normalises key order, so an identical
  draft could never prune — every re-run of a content script republished the entire bestiary and
  showed 174 "changes" in a diff review whose only job is to say what changed. The A1-c fix landed
  on the item and progression editors and this one kept the COMMENT without the code. Parsed against
  parsed now; a third run of `world:bestiary` reports "50 pruned, nothing to publish", which is what
  "safe to re-run" is supposed to look like.
  **A second one was found by the GAME rather than here**: `world:author` wrote its seven zones by
  id and never cleared the layer, so `ashen_reach` — seeded from the dev island by `import-live` —
  survived a whole world regeneration and, being a smaller ring, WON inside the savanna and the
  canyons. Nine camps reported a zone WORLD.md does not have. The game's new `/ops/camps` counts what
  the world actually seeded per zone; that is the line that showed it, and it is the same shape of
  evidence as `/ops/respawnnodes` and `/ops/worldobjects`. After the fix the game reports **124
  spawners, 400 enemies alive, 0 unresolved refs, 0 camps that produced nothing**, per zone identical
  to this repo's offline placement.
  **One shared-schema change to pull in:** `enemyDefSchema` gained `tint` (`#rrggbb`, nullable) —
  the bestiary reuses models across bands and a boss wearing its own minions' mesh is not a boss.
  The schema-driven form picks it up for free after a rebuild; a colour swatch instead of a text
  field is worth doing next time the Enemies page is touched, and so is the fact that its TTK sim
  names COMBAT.md §12's 60–120 s window for WORLD bosses too, where §12 says "zone boss".
  **259 tests green here.**

**Game P12-D ran the whole item catalogue through this panel (2026-08-06)** —
`node tools/content/author-items.mjs` now owns T1–T2 _and_ the T3–T5 deep set together: **182 item
rows, 21 loot tables and 16 vendors** on the Items page's one publish rail, ending at 223 published
items (the other 41 are P10's gathering materials, which `author-nodes.mjs` owns). It is one script
because the vendors are the same rows in both files' eyes — the P8 shops were anchored on the dev
island, so every one of them had to move onto a building the map publish actually placed, and four
settlements gained their own.
`item-data-deep.mjs` authors IDENTITY only — name, slot, ilvl, rarity, attribute weights, one line
of flavour — and every number comes out of the shared §2 formulas, which is the same contract the
Items page's budget meter previews with. Armour ships as authored SETS rather than per-slot rows.
Loot nests through per-tier pools so a zone names its gear once, and each boss has its own table
with **no `nothing` entry at all**, which is what makes "guaranteed Rare+" a property of the data.
**The bug that mattered is content ownership, and it is this repo's:** `item_material_dawnpetal`
was authored in BOTH `item-data.mjs` and `node-data.mjs` at different ilvls, so whichever content
script ran last won. Republishing the item catalogue silently reverted P10-E's re-tiering of
Dawnpetal from a Dawnshore common to the Elder Grove's T5 rare — and put a "legendary" bloom back
in a level-3 mob's loot table. Caught by the GAME's gathering-ladder test, not by anything here.
A content script that republishes rows it does not own is the same class of mistake as a placement
pass that clears a layer it shares.
**One shared-schema thing to know:** `equipmentBonus` now returns `pct` and `killGold` as well as
`stats`/`weapon` — P8's item effects were folded by a server helper nobody called, so every Epic
and Legendary effect in the game was decoration. They are wired now, and because the fold is in
shared, any character-sheet surface this panel grows gets the same answer the server fights with.
**259 tests green here.**

**Game P12-E planted the gathering catalogue through this panel (2026-08-06)** — `pnpm world:nodes`:
the 21 definitions re-authored and **362 placements** written into the map's `node` layer across all
six zones, up from 65 on the dev island. The layout lives in `node-clusters.mjs` as **73 wishes**
(zone, bearing, distance, count, spread) rather than 362 coordinates, resolved by the same
`placeAll` the camps use, and the per-member ground check reads the DRAFT CHUNKS with a 6-attempt
retry that shrinks toward the centre — the retry is what makes a shoal land 8 of 8 instead of 3 of 8.
The game reports **362 nodes, 0 orphans**.
**The bug that mattered is this panel's tooling, and it is the sharpest example yet of a check that
stops one level too early.** `placeAll` validates the cluster CENTRE's zone. The members scatter up
to `spread` metres off that centre and were only ever asked about the GROUND — so **39 of 322 land
nodes stood in a zone they were never authored for**: 7 ashwood, 5 dawnstone and 5 duskthorn (the
canyons' T5 band) in the T4 savanna where nothing gates a player from them, and 4 of the 12 Dawnpetal
in Emberwood — which is exactly the promise game P12-D had just repaired in the DATA, broken again by
geometry a day later. Nothing was wrong with any single row. The member loop asks the DRAFT's zone
layer now (not the offline synthesis: the owner can drag a corner, and then the copy is stale),
ordered exactly as `bakeDraft` orders it, and the retry that already existed absorbed every stray at
no cost — 362 placed, 0 dropped, per zone 70/70/70/70/70 + 12.
**It became a publish cross-check, for the same reason `questHintCoverage` did:** the script fix
protects the script, and the owner places nodes by hand. Publish now warns when one node id's
placements split across zones, naming the split. A node definition carries a tier and no zone, so
the panel checks the data against ITSELF rather than inventing a design mapping it would then own.
Warns, never blocks — two regions can be deliberate, 5 of 19 across a line is not. +2 tests.
**Two script lessons, both general.** A run must report **where its output STANDS**, not only how
much of it there is: the per-definition counts were perfect through every broken run, because a
count cannot see a border. And the offline synthesis is the right source for a wish and the wrong
source for a verdict — the draft is what the bake reads.
**One thing that was not this repo's but was found here:** `WORLD_GEN_PLAN.waterLevel` was `null`,
so every generated chunk declared no water. The game draws a water surface only where a chunk
declares one, so 42 % of the map was an invisible hole and **no fishing node could be authored at
all**, because "submerged" means ground below its own chunk's water. Two phases passed without it
because nothing had needed water to EXIST. **261 tests green here.**

**Game P12-F peopled the world through this panel (2026-08-06)** — `pnpm world:places` and
`pnpm world:folk`: 45 POIs, 47 interactables, 68 settlement dressing props and 41 NPC placements,
with 37 NPC definitions on the Quests rail. The game reports **41 NPCs, 61 interactables, 46 POIs,
0 orphans**. Both scripts resolve WISHES through the same `placeAll` the camps and gathering
clusters use, and both report **where their output STANDS** (zone by zone, resolved the way
`bakeDraft` resolves it) rather than only how much of it there is — P12-E's lesson, since a count
cannot see a border.
**A vendor NPC's position is not a free choice.** A vendor row carries an `anchor` whose radius is
the proximity lease the GAME checks before it will open a trade, and the schema's own comment says
that anchor exists "until P12 places the real NPC". So `world:folk` reads the published anchors and
stands each shopkeeper on theirs. Put the body anywhere else and `F` offers a trade the server then
refuses — which looks like it works, which is the worst kind of wrong.
**The bug that mattered is this panel's, and it is the clearest case yet of a check modelling the
wrong thing.** Publish refused all five Elder Grove rows as "cannot be walked to from the spawn".
That was RIGHT — the Grove has no causeway and the ocean around it is disabled chunks — but the
fix is not to soften the check. `reachableFrom` only walked the walkgrid, and **a portal is a way
to GET somewhere; that is the whole of what it is**. So the fill was wrong about everything behind
any portal, and would have refused exactly what WORLD.md §3.6 specifies ("a one-way ancient portal
in Ashcrag"). It consumes portals as directed edges now, to a fixpoint so they can chain, and only
once the portal's own mouth is reachable — otherwise a portal sealed inside the far side would
declare itself the way in. +3 tests. (The content was also authored backwards: the arch had been
placed in the Grove pointing out. It stands in Ashcrag now.)
**Two script rules re-confirmed.** Layer ownership still decides clearing: `npc` is the script's
alone so `world:folk` clears it, while `poi`, `interactable` and `prop` are shared with hand
placement and are upserted by id with the owned ids printed. And the publish cross-checks earn
their keep — the run caught a `vendor`-role NPC with no `vendorId` (her `F` would have opened
nothing) and warns, correctly, that eleven new quest givers are named by no quest yet.
**264 tests green here.**
**Game P12-F's quest set closed it (2026-08-06)** — `pnpm world:quests`: 20 new quests published on
the Quests rail, taking the game to **28 in 5 chains**, and P11's eight pilot quests repaired in
the same pass. The script's point is the **hint resolver**. A step declares WHAT it points at
(`{ enemy: … }`, `{ node: … }`, `{ object: … }`, `{ npc: … }`, `{ poi: … }`) and the run resolves
that against the live map draft — the rows the bake reads — then circles the DENSEST cluster of
matches. `questHintCoverage` at publish is a backstop; deriving the circle is the fix, because a
hint built from the thing it points at cannot point at nothing.
**Clustering, not encircling, is what makes it a hint.** The first version drew one circle around
every match and produced a **327 m** ring when two camps sat on opposite sides of an isle. Matches
outside the chosen cluster are reported now, and a derived radius over 260 m fails the run.
**The repair pass is the finding.** Five of P11's eight quests pointed **420–815 m** from their
targets — the same failure P11-E documented, arriving by a different road: they were authored
against the dev island and P12 moved every spawner, node and villager under them. They go through
the same resolver rather than being re-typed. One was worse than a bad circle: `quest_shore_lost_
crate` names a crate that P12-B pruned as drowned, so a live quest referenced a placement that did
not exist — re-placed via `world:places`. The Weald chain's four `zoneId` labels moved to
`verdant_weald`, which is exactly the edit P11-C wrote down as owed.
**One thing measured here and NOT fixed (game USER_QUESTIONS Q32):** `bakeDraft`'s
`orderZones` sorts by polygon area ascending — P12-B's fix for `zoneAt` non-determinism — and that
is right for containment (the Dawnsea must always lose) and arbitrary for two peer zones that
overlap at the edges. Dawnshore's ring is 6 % larger than the Weald's where they meet, and that
overlap contains **Dawnhaven**: the starter town resolves to the level 6–12 zone. Three fixes
measured; nearest-centroid alone is wrong (it drags 572 of 3 100 land samples into the Dawnsea).
Recorded rather than patched, because it re-points ambience, discovery and journal headings for the
whole world at once.

**Content scripts take a real login now (2026-08-06, game P12-H).** The game repo gained
`deploy/WORLD.sh`, which deploys the WORLD by running THESE scripts on the live VPS — code travels
in git and a published map bake does not, so an updated box had all of P12's features and the old
dev island to use them on. That path was blocked by something this repo had been carrying since
A1: every `author-*` script minted an admin account whose password (`admin-smoke-pass-1`) is a
literal in a public repository. Harmless in a throwaway dev container; a permanent admin back door
on a real box, and "run these on a real box" is precisely what deploying a world means.
`tools/content/admin-session.mjs` replaces eleven inline copies of that block. It reads
**`DAWNED_ADMIN_USER` / `DAWNED_ADMIN_PASS`** and touches the `accounts` table only when neither is
set — so a deploy creates nothing, and every row the run publishes is attributed to a person in
`audit_log` rather than to a shared robot. The dev fallback mints a **per-run random password** on
its own account (`zz_admin_content` — deliberately NOT the smokes' `zz_admin_smoke`, which a
content run banning it would break) and bans it when the run ends. The random password is the part
that actually holds: `close()` can be missed on a crash or a `fail()`'s `process.exit`, and what
survives is then an account nobody can log into rather than one everybody can. The ban has to come
at the END of a run, never right after login, because `auth.ts` re-checks `accounts.status` on
every request. Verified against the running panel both ways: supplied credentials published with no
account created, the fallback ended `banned`, and `world:author` — the TypeScript entry point,
which needed `admin-session.mjs` listed in `tools/tsconfig.json` — regenerated all 1024 chunks
through it. **264 tests green.**

**The owner's first world deploy found what that path had been hiding: the panel could never
publish a map on a real box.** It died on `ENOENT: … mkdir '…/assets_baked/map/map-….tmp'`,
naming a path whose parents plainly existed. `dawned-admin.service` runs under
`ProtectSystem=strict` with `ReadWritePaths=/var/lib/dawned`, and `MAP_DIR` is the GAME
checkout's `assets_baked/map` — outside it, therefore read-only — and **a recursive `mkdir` into
a read-only tree reports ENOENT rather than EROFS**, which sends you hunting for a missing
directory that is right there. The unit was written at game P0, months before A2 gave this panel
a map to publish, and a dev container has no sandbox, which is why every smoke and both browser
suites had always passed. `bakeDraft` catches the staging failure now and names MAP_DIR, the
errno and the `ReadWritePaths` requirement (+1 test, provoked with ENOTDIR so it behaves the same
when tests run as root). The service-side fix is the game repo's: the shipped unit grants it, and
`UPDATE.sh`/`WORLD.sh` install a drop-in on boxes provisioned before it. **265 tests green.**

**Two fresh-box faults came out of the owner's first world deploy (2026-08-06, game P12-H), and
both were invisible in a checkout that had grown through the phases in order.**
(1) **`world:bestiary` stubbed a TYPED list of seven zone loot tables.** An enemy publish blocks on
an unpublished loot ref, so the pass creates `nothing`-only stubs and the item pass fills them —
but the list named only the zone tables, and the six `loot_boss_*` are P12-D's. On a box holding
nothing but the seed migrations they do not exist, so the deploy stopped at step 3 with six
refusals. The set is DERIVED from `ENEMY_DEFS` now: a new enemy pointing at a new table is stubbed
by the same code that publishes it, which is the quest hint resolver's rule applied to references.
Reproduced before fixing by dropping the six published rows, and verified after — `6 of 18 …
published as stubs`, the bestiary publishes, `author-items.mjs` restores all six with their real
names and entries.
(2) **`bakeDraft` surfaced a raw `ENOENT`** for a staging directory whose parents plainly existed —
`dawned-admin.service` runs under `ProtectSystem=strict` on the VPS, so `MAP_DIR` was read-only and
a recursive `mkdir` into a read-only tree reports ENOENT rather than EROFS. **Map publish had
therefore never worked on a real box since A2**; a dev container has no sandbox, which is why every
smoke and both browser suites had always passed. The staging failure names MAP_DIR, the errno and
the `ReadWritePaths` requirement now (+1 test, provoked with ENOTDIR so it behaves the same as
root). The service-side fix is the game repo's.
**The lesson both share: this repo's content scripts had only ever run against a database that
already contained the previous phase's output.** The game repo's `deploy/WORLD.sh` runs them
against one that contains only the seed migrations, which is a different program. A run of the
whole chain against a virgin database is now part of verifying a change to any of them.
