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
- **State (updated 2026-08-04):** A0 ✅ closed — the owner logged in at
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
  migration 0012. Current: game P0–P8 are all closed and owner-verified (2026-08-04, after two
  fix rounds; the game is on protocol v11) — neither round touched a content schema, so no
  editor work followed. The game is in P9 — Enemies & AI Depth.
  **A1-d — Enemies is live** (2026-08-04): bestiary + spawners on one publish rail, level-
  banded list with rank badges, and a time-to-kill simulator that runs the game's own
  `selectableEnemyAbilities` so the previewed rotation is the fought rotation (both sides
  of the trade, range-aware, boss-window aware). Publish blocks on unresolvable spawner
  refs and unpublished loot; boss-with-no-phases and archetype mismatches warn only.
  41 tests green. **Pull in after the next `@dawned/shared` rebuild:** the game's P9-D
  round added `shieldDurationMs` to the enemy ability schema (self-shield duration,
  default 12 000 ms) — schema-driven, so the form gains it with no editor code.
  **Game P9 closed 2026-08-04 (built, awaiting playtest):** the King solos in 105 s, inside
  the 60–120 s design window. Lesson for this panel: the TTK simulator's **player dps input
  is the whole answer** and the page defaults it to 40, where a properly built level-12
  warrior measures 78 (an unspent one, 30). A guessed dps can be 3× off and send someone
  re-balancing a boss that was fine — worth a measured reference on the sim controls.
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
