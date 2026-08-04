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

- **Freshness checklist (every task, mirrors the game repo's CLAUDE.md):** ROADMAP row + phase
  block · CHANGELOG · README status block · CLAUDE/AGENTS current state in BOTH repos · docs
  whose territory you touched · no hardcoded phase/version strings in the UI · counts you quote
  (tests, rows) re-read from the run you just did. Stale state is a bug the owner has to find.
- Work inside the current A-phase (ROADMAP.md here; sync points to game P-phases matter — check
  both roadmaps before starting).
- `pnpm check` green before claiming done; CHANGELOG.md `[Unreleased]` for user-visible changes;
  update docs touched by the change.
- Open design questions → the **game repo's** USER_QUESTIONS.md (single inbox for the owner),
  with a recommended default.
- `@dawned/shared` comes from the sibling game checkout (both repos deploy from `main`
  together); after game-side shared changes, rebuild it there and rerun `pnpm install` here.

## Current state

**A0 — Foundation is ✅ closed (owner logged in at play.pathlands.cc/admin, 2026-08-04)**:
Vite/React/Fastify scaffold with `@dawned/shared` consumed from the sibling game checkout,
panel auth against game accounts (gm/admin roles, admin sessions, CSRF, audit_log), the
"Workshop" shell + Ctrl+K palette, Dashboard v1 with the live server card, and the
schema-form generator driving World Settings drafts (`content_world_settings`, draft rows
only). Playwright login smoke: `node tools/smoke/admin-login.mjs`; dist layout matches the
deployed `dawned-admin.service`.
**A1 — the Abilities editor + publish pipeline v1 is live** (2026-08-03, alongside game P5;
P6's 16 caster rows also went through it): Content → Abilities (class-grouped drafts, quick
tuning fields over shared-schema-validated JSON, Ctrl+S, prune-on-match), publish v1 (diff
review → validate-all + slot-collision cross-check → transactional copy →
`/ops/reload-content` hot reload), all 44 live ability rows authored through it
(`tools/content/author-kits.mjs`; live-tune proof re-runnable via
`tools/content/live-tune-proof.mjs`).
**A1-b — the Progression editors are live** (2026-08-04, alongside game P7): Content →
Progression with the skill-trees tab (class picker, tier-laid branch columns, shared-schema
JSON editing per node, draft dots) and the XP-curve tab (29 editable rows, cumulative +
formula reference, reset-to-formula), publishing over v1's rails plus the tree cross-checks
(curve completeness, ability refs, cell collisions, one capstone per branch). The full P7
content set — 29 curve rows + 96 nodes — went live through it
(`tools/content/author-progression.mjs`); 19 tests green.
**A1-c — the Item editors are live** (2026-08-04, alongside game P8): Content → Items
with three tabs on one publish rail — items (budget meter against the ITEMS_LOOT §2
formulas, ƒ-suggest for value/weapon band/stat rescale, live duplicate-icon warning),
loot (a 1 000-roll simulator through the SAME shared roller the server drops with,
killer level + rolls-per-kill adjustable, `nothing` shown as its own share) and vendors
(stock priced by the shared value/sell formulas). Publish cross-checks icon uniqueness,
item/table/vendor ref resolution, loot cycles and the tables live enemies still roll;
budget deviations report as advisory warnings. A latent prune bug was fixed with it:
drafts were compared against the RAW jsonb column, whose key order Postgres normalises,
so an identical draft could never prune. 25 tests green. The whole P8 catalogue went
live through this surface — 62 items, 5 loot tables, 5 Dawnhaven vendors and the shore/
weald enemy loot bindings (`tools/content/author-items.mjs`, numbers derived from the
shared budget formulas) — and the game froze the published result into its seed
migration 0012. **Current: game P0–P8 are all closed and owner-verified (2026-08-04, after two
fix rounds — the game is on protocol v11); nothing in those rounds changed a content
schema, so the panel needed no editor work. The game is now in P9 — Enemies & AI Depth.**
**A1-d — the Enemies editor is live** (2026-08-04, alongside game P9): Content → Enemies
with bestiary + spawners on one publish rail (they reference each other), the level-banded
list with rank badges, and the **time-to-kill simulator** — it runs the game's OWN
`selectableEnemyAbilities`, so the rotation it previews is the rotation that will be
fought. It answers both directions of the trade, hides abilities unusable at the tested
range, sees a boss's whole unlocked kit rather than phase 0, and names the COMBAT.md §12
60–120 s boss window when a fight misses it. Publish blocks on unresolvable spawner refs
and unpublished loot; judgement calls (a boss with no phases or arena, a `ranged` row with
nothing ranged) warn without blocking. 41 tests green.
Note for the next `@dawned/shared` rebuild here: the game bumped `PROTOCOL_VERSION` to 11
(the snapshot self block now carries the dodge roll). The panel does not speak the game
protocol, so this is informational — but `pnpm install` after a game-side shared change is
still required, as always.

### Running it locally

```bash
pnpm install && pnpm dev   # API :8082 + Vite :5174 → http://localhost:5174/admin/
pnpm check                 # needs the game repo's migrated local Postgres
```
