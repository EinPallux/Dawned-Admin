# Dawned-Admin — Architecture

> A React SPA + Fastify API deployed next to the game on the same VPS, sharing the game's
> PostgreSQL and the `@dawned/shared` package. The game repo's tech docs are upstream context:
> `Dawned/docs/tech/{ARCHITECTURE,DATABASE,SECURITY,DEPLOYMENT,ASSET_PIPELINE}.md`.

## 1. Stack
- **Frontend:** React 19 + Vite + TS strict; Zustand state; TanStack Query (server cache) +
  TanStack Table/Virtual (data grids); three.js viewport for the Map Editor & 3D previews
  (reusing the game's terrain/prop render modules); zod-driven schema forms (custom generator —
  shared zod schemas in, "Workshop" components out).
- **Backend:** Fastify 5 (TS) — REST JSON API (`/api/*`), session auth, publish/bake workers,
  ops-API proxy; Drizzle against the shared schema; long tasks (map bake, thumbnail gen, roll
  sims) run in a worker thread with progress events (SSE).
- **Shared contract:** `@dawned/shared` via pnpm git dependency
  (`"@dawned/shared": "github:EinPallux/Dawned#path:packages/shared"`, version-pinned to a tag per
  release train). Drizzle tables, zod content schemas, formulas (ƒ-suggest buttons run *the same
  code* the game balances with), constants, map/chunk format codecs.

## 2. Process & Routing (on the VPS)
`dawned-admin.service` (Node, port 8082) behind Caddy at `play.pathlands.cc/admin` (default; see
game USER_QUESTIONS Q10). Serves the built SPA + `/api`. Local dev: `pnpm dev` (Vite + API,
pointed at local Postgres from the game repo's dev setup).

## 3. AuthN/AuthZ
- Login with **game accounts** that hold `gm`/`admin` role (accounts table is shared truth);
  argon2id verify via the same shared auth util; admin session = httpOnly Secure SameSite=Strict
  cookie, 12 h sliding, server-side session rows (`sessions.kind='admin'`).
- Route guards per role: `gm` → Live Ops (read + moderation commands, no role/ban-perm powers,
  no publish); `admin` → everything. Every mutating endpoint re-checks role server-side and
  writes `audit_log` (surface `admin`).
- CSRF: same-site strict + custom header check; rate limiting on login (shared limiter config).

## 4. Data Access Rules
- Content: full CRUD on `content_*` **draft** rows; publish endpoint runs validation +
  cross-reference checks + bake, writes `content_publishes`, moves snapshots — the ONLY path to
  the live game's data.
- Player data: read views + **narrow audited mutations** (inventory grant/remove, password-reset
  flag, ban/mute rows) — no free-form UPDATE surface, each action a typed endpoint.
- Live actions (kick, announce, teleport, reload): never touch the DB — proxied to the game
  server's localhost ops API with the shared `OPS_SECRET` header; responses stream back to the UI.
- Files: bakes write `/var/lib/dawned/published/<version>/` (same contract the game reads);
  thumbnails/asset index cache under `/var/lib/dawned/assets/`.

## 5. Map Editor Data Flow
```
viewport edits → chunk-granular draft store (client, IndexedDB journal for crash recovery)
  → autosave PATCH /api/map/draft/chunks/:cx/:cy (2 s debounce, delta payloads)
  → Publish: POST /api/publish {kinds:[map,…]} → worker: validate → bake (changed chunks) →
     content_publishes++ → POST game /ops/reload-content → SSE progress → UI report
```
Draft preview channel (play-test bridge) per MAP_EDITOR.md §5: admin API asks the game server to
mount draft chunks in a GM-only shadow world; feature-flagged, evaluated at A3.

## 6. Performance Notes (1-core box citizenship)
Bake/thumbnail workers run `nice`d and chunked (yield between chunks) so the game server's tick
never starves; heavy queries paginate; SPA bundles code-split per module (Map Editor's three.js
payload loads only when opened); viewport uses the game's instancing systems (editor overhead
budget: 60 FPS with full overlay stack on the reference dev machine, 30 FPS acceptable on
integrated GPUs).

## 7. Testing
Vitest: schema-form generator (zod → form model), publish validator (fixture worlds with seeded
errors), loot simulator math, chunk codec round-trips. Playwright: login → edit item → publish →
verify bundle diff (against a dev game server) — the pipeline smoke that guards the whole reason
this app exists. Manual: Map Editor tool matrix per release (checklist in repo).
