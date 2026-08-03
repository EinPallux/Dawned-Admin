# CLAUDE.md — Dawned-Admin (editor & ops panel repo)

Guidance for Claude Code (mirrored for other agents in AGENTS.md) in this repository. Read this
first, every session. **Read the game repo's CLAUDE.md too** — Dawned (game) and Dawned-Admin
(this) are one project in two repos, and the game repo's docs are the design source of truth.

## What this repo is

The web control panel for the Dawned MMORPG: 3D **Map Editor**, **content database editors**
(items, enemies, abilities, loot, vendors, quests, zones, curves), and **Live Ops** (players,
moderation, server dashboard). Users: the owner + trusted GMs. It runs on the same VPS as the
game, shares its PostgreSQL, and consumes `@dawned/shared` from the sibling game checkout
(`file:../Dawned/packages/shared`) for schema/validation/formulas — editors must never drift from the game.

## Non-negotiable rules

1. **Drafts, then publish.** Editors write draft rows only; the live game changes exclusively via
   the validated publish pipeline (validate → diff review → bake → version → notify). No endpoint
   may mutate published/live content directly.
2. **Narrow, audited player-data writes.** Player/character tables get typed, single-purpose,
   audited endpoints (grant item, reset password, ban…) — never a generic row editor.
3. **Live actions go through the game's ops API** (localhost + shared secret) — this app never
   reaches into game memory or simulates game logic itself (it _uses_ shared formulas for
   previews/ƒ-suggests only).
4. **Schema-driven forms.** UI forms are generated from the shared zod schemas + per-type
   enhancements. Adding a content field = shared schema change (game repo) + form enhancement
   here; hand-rolled forms that shadow the schema are forbidden.
5. **Don't break the owner's flow:** autosave + undo/redo + crash recovery are features of record
   in the Map Editor; destructive actions (clear layer, bans, publish) are confirm-gated with
   backups/reverts available.
6. **Same quality bar as the game:** TS strict, no `any`, zod at boundaries, tests for validators/
   codecs/simulators, "Workshop" design system (docs/ADMIN_DESIGN.md §2 — dense, dark, no serif
   fonts, no rounded-blob slop), 1-core VPS citizenship (niced workers, paginated queries).

## Repository map (planned — A0 creates it)

```
src/client/   React SPA (modules: dashboard, map-editor, content, quests, live-ops, admin)
src/server/   Fastify API (auth, content CRUD, publish workers, ops proxy, SSE)
src/shared-ext/  panel-only types/helpers on top of @dawned/shared
docs/         ADMIN_DESIGN.md · MAP_EDITOR.md · CONTENT_EDITORS.md · ARCHITECTURE.md (+ USER_GUIDE.md at A6)
```

## Process

- Work inside the current A-phase (ROADMAP.md here; sync points to game P-phases matter — check
  both roadmaps before starting).
- `pnpm check` green before claiming done; CHANGELOG.md `[Unreleased]` for user-visible changes;
  update docs touched by the change.
- Open design questions → the **game repo's** USER_QUESTIONS.md (single inbox for the owner),
  with a recommended default.
- `@dawned/shared` comes from the sibling game checkout (both repos deploy from `main`
  together); after game-side shared changes, rebuild it there and rerun `pnpm install` here.

## Current state

**A0 — Foundation is built and verified in dev (2026-08-02)**: Vite/React/Fastify scaffold with
`@dawned/shared` consumed from the sibling game checkout, panel auth against game accounts (gm/admin
roles, admin sessions, CSRF, audit_log), the "Workshop" shell + Ctrl+K palette, Dashboard v1
with the live server card, and the schema-form generator driving World Settings drafts
(`content_world_settings`, draft rows only). 12 tests + a Playwright login smoke green
(`node tools/smoke/admin-login.mjs`); dist layout matches the deployed `dawned-admin.service`.
**A1-a — the Abilities editor + publish pipeline v1 is live (2026-08-03, alongside game P5)**:
Content → Abilities (class-grouped drafts, quick tuning fields over shared-schema-validated
JSON, Ctrl+S, prune-on-match), publish v1 (diff review → validate-all + slot-collision
cross-check → transactional copy → `/ops/reload-content` hot reload), 15 tests green. It
shipped the 28 P5 kit rows (`tools/content/author-kits.mjs`) and the P5 "live-tunable without
restart" DoD is proven re-runnably (`tools/content/live-tune-proof.mjs`). **Open: the owner's
login check at play.pathlands.cc/admin after the next deploy (ROADMAP A0 status); remaining A1
editors land with their consuming game phases (P8 items, P9 enemies…).**

### Running it locally

```bash
pnpm install && pnpm dev   # API :8082 + Vite :5174 → http://localhost:5174/admin/
pnpm check                 # needs the game repo's migrated local Postgres
```
