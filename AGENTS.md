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
  (`tools/content/live-tune-proof.mjs`). Current: the XP-curve and skill-tree editors land
  here alongside game P7; remaining A1 editors follow their consuming phases.
