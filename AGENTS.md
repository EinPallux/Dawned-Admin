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
  migration 0012. Current: game P8 is built and awaiting the owner's playtest; remaining
  A1 editors follow their consuming phases (P9 enemies…).
