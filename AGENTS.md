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
  failing assertion. Open in A3: patrol splines/camp links/density heat, zone polygon
  drawing with ambience preview, selection sets + prefabs + scatter brush + keymap UI.
