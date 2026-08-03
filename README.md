# 🛠 Dawned-Admin

**The control room for [Dawned](https://github.com/EinPallux/Dawned)** — a web panel where
developers and admins edit _everything_ about the game through a friendly UI: the world itself
(a full 3D map editor), every database-driven piece of content (items, enemies, abilities, loot,
quests, vendors, zones, curves), and the live server (players, bans, broadcasts, metrics).

> **Status: 🟨 Phase A0 built (2026-08-02)** — panel shell, auth against game accounts
> (gm/admin), live dashboard, schema-driven World Settings drafts; owner sign-off pending
> (ROADMAP A0 status). The game repo's planning docs are the design source of truth for game
> systems; this repo's docs specify the _editing tools_ for them.

## Running it locally

```bash
# Prerequisites: the game repo's dev database (start its server once to migrate),
# and ideally the game server on :8081 for the live dashboard card.
pnpm install
pnpm dev            # API on :8082 + Vite on :5174 → http://localhost:5174/admin/
pnpm check          # typecheck + lint + format + tests (needs local Postgres)
node tools/smoke/admin-login.mjs   # Playwright: login → dashboard → draft round-trip
```

Panel access needs a game account with the `gm` or `admin` role
(`UPDATE accounts SET role='admin' WHERE name='you';` — role management UI arrives at A5).
The game repo must be checked out as a SIBLING directory named `Dawned` (CI does this via the
`DAWNED_SHARED_TOKEN` secret, a read-only PAT for the private game repo) and its shared package
built (`pnpm --filter @dawned/shared build`) before installing here.

## Modules (0.1.0 scope)

| Module                | What it edits                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🗺 **Map Editor**      | Terrain sculpt & texture paint, prop/foliage placement, zones, spawners, resource nodes, POIs, interactables, NPCs — with draft → validate → publish pipeline into the live game. [docs/MAP_EDITOR.md](docs/MAP_EDITOR.md) |
| 🗃 **Content Editors** | Items (with icon picker), enemies, abilities, skill nodes, loot tables (with roll simulator), vendors, XP curves, world settings — schema-driven forms with validation. [docs/CONTENT_EDITORS.md](docs/CONTENT_EDITORS.md) |
| 📜 **Quest Editor**   | Steps, objectives, dialogue, rewards, world links (givers/props/hints) — part of [docs/CONTENT_EDITORS.md](docs/CONTENT_EDITORS.md) §6                                                                                     |
| 📡 **Live Ops**       | Online players, inspect/kick/ban/mute, password resets, broadcasts, server metrics (tick/RAM/entities), audit log, content hot-reload, backups status. [docs/ADMIN_DESIGN.md](docs/ADMIN_DESIGN.md) §5                     |

## Docs

- [docs/ADMIN_DESIGN.md](docs/ADMIN_DESIGN.md) — product spec: navigation, UX principles, design system, module tour
- [docs/MAP_EDITOR.md](docs/MAP_EDITOR.md) — the big one: full 3D world-editing spec
- [docs/CONTENT_EDITORS.md](docs/CONTENT_EDITORS.md) — every database editor + the quest editor
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, auth, DB/publish pipeline, game-server ops API
- [ROADMAP.md](ROADMAP.md) — phases A0–A6, synced to the game repo's P-phases
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — working agreements · [CHANGELOG.md](CHANGELOG.md)

## Planned stack (rationale in docs/ARCHITECTURE.md)

React 19 + Vite + TypeScript strict · three.js viewport (map editor) · Fastify 5 API ·
shared schema/validation via **`@dawned/shared`** (file: dependency on the sibling game checkout) ·
same PostgreSQL as the game · deployed on the same VPS behind Caddy (`/admin` by default).

## Relationship to the game repo

- **One schema:** Drizzle tables + zod content schemas live in `@dawned/shared` (game repo);
  this app consumes them — editors and validators can never drift from the game.
- **Draft → publish:** editors write drafts; publishing validates, versions, bakes artifacts
  (map chunks, walkgrid, bundles) and notifies the game server to hot-reload what's safe.
- **Live ops via API:** the panel talks to the game server's localhost-only ops API — it never
  pokes game memory or bypasses the audit log.
