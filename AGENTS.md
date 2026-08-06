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
