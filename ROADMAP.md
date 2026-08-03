# Dawned-Admin — Roadmap (A-track)

> Synced to the game repo's P-phases (see `Dawned/ROADMAP.md` — ⚙ markers there point here).
> Same working agreements: phases close only on their DoD, statuses maintained in this table.
> Sizes: S/M/L/XL relative effort.

| Phase | Name                                          | Size | Starts after          | Status                         |
| ----- | --------------------------------------------- | ---- | --------------------- | ------------------------------ |
| A0    | Foundation: shell, auth, data link            | M    | game P1 (schema live) | 🟨 built — owner login pending |
| A1    | Content editors (items→curves) + publish v1   | L    | A0; serves P5–P8      | 🔲                             |
| A2    | Map Editor I: viewport, terrain, publish/bake | XL   | game P2 formats       | 🔲                             |
| A3    | Map Editor II: placement, spawns, zones, POIs | XL   | A2 + game P9 systems  | 🔲                             |
| A4    | Quest & dialogue editor                       | M    | A1; serves P11        | 🔲                             |
| A5    | Live Ops: players, moderation, server, audit  | M    | game P13 ops API      | 🔲                             |
| A6    | Publish polish, validation depth, backups UI  | M    | with game P14         | 🔲                             |

## A0 — Foundation (M)

Repo bootstrap (Vite+React+TS strict, Fastify, pnpm, `@dawned/shared` git-dep wiring + version-pin
workflow), "Workshop" design system core (tokens, table, schema-form generator from zod, shell/
nav/palette), auth vs. game accounts (admin sessions, role guards, audit plumbing), Dashboard v1
(server card via ops health, publish card stub), deploy as `dawned-admin.service` behind Caddy
(`/admin`), Playwright login smoke.
**DoD:** owner logs in at play.pathlands.cc/admin with their admin account, sees live server
status; a schema-form renders and round-trips a `world_settings` edit as a draft.

**Status (2026-08-02): built and verified in dev.**

- [x] Bootstrap: Vite + React 19 + TS strict SPA and Fastify 5 API in one package; pnpm;
      `@dawned/shared` pinned as a git dependency (SHA-pinned, builds via its prepare script);
      `pnpm check` = typecheck + lint + format + tests; CI with a Postgres service.
- [x] Auth vs game accounts: argon2id verify of `accounts.pass_hash`, gm/admin roles only,
      admin sessions (`sessions.kind='admin'`, 12 h sliding) in an httpOnly SameSite=Strict
      cookie, CSRF header on mutations, login rate limit, every panel action → `audit_log`.
- [x] "Workshop" shell: dark dense tokens (ADMIN_DESIGN §2), corner-cut logo, left rail with
      future modules parked under their phase tags, Ctrl+K palette, login screen.
- [x] Dashboard v1: live server card (health + ops metrics: players, uptime, protocol,
      tick p95 sparkline vs the 15 ms budget, RSS, net out — outage renders as a state, not an
      error), publish card stub with real drafts-pending count, quick actions.
- [x] Schema-form generator: shared zod schema → field models (+ per-field panel enhancements),
      unit-tested against `worldSettingsSchema`; World Settings editor with draft badges,
      Ctrl+S, dirty-leave warning, gm read-only mode, discard-to-published.
- [x] World-settings drafts land in `content_world_settings` as `status='draft'` rows only —
      the A1 publish pipeline stays the sole path to `published`. 12 vitest green (8 API
      integration vs real Postgres + 4 generator) and a Playwright smoke: login → live
      dashboard → edit → save draft → reload persists → discard clears.
- [x] Deploy: dist layout matches the existing `dawned-admin.service` (game repo deploy) and
      the Caddy `/admin` strip; env contract follows `/etc/dawned/admin.env` as written by
      DEPLOY.sh; game deploy scripts gained the PAT bridge for the private git dependency.
- [x] Production serving fixed + locked (2026-08-03): the first deploy served a blank page —
      Caddy proxied `/admin` without stripping the prefix (`handle` vs `handle_path`; fixed in
      the game repo's Caddyfile, pinned by its deploy-contract vitest) — and the CSP refused
      the `data:`-inlined Inter subsets (fonts now build as files, `assetsInlineLimit: 0`).
      New `node tools/smoke/admin-prod-serve.mjs` serves `dist/` exactly like the VPS (prefix
      strip + real CSP from the sibling Caddyfile) and walks load → MIME/cache checks → login
      in Chromium, so serving bugs can't reach a deploy unseen again.
- [ ] **Owner DoD check:** log in at play.pathlands.cc/admin after the next deploy (needs an
      `admin`-role account — set via `UPDATE accounts SET role='admin' WHERE name='…'`),
      confirm the live server card and a world-settings draft round-trip. Then A0 closes.

## A1 — Content Editors & Publish v1 (L) — runs alongside game P5–P8

Shared editor framework (lists/details/usage-refs/duplicate/history/delete-guards/ƒ-suggest,
import/export); editors: World Settings, XP & profession curves, Abilities + Skill Nodes (with
tooltip/tree previews), Items (budget meter, icon picker, tier-series wizard, 3D weapon preview),
Enemies (kit builder, TTK calculator), Loot (nesting + simulator), Vendors, NPCs (minus spatial),
Zones (non-spatial); Publish flow v1 (validate → diff review → publish → hot-reload notify) +
Publish History with revert; Asset Browser v1 (thumbnails via tools pipeline, license badges).
**DoD:** game P5 tunes Warrior ability numbers live through this panel; game P8's first 60 items
are authored here start-to-finish (icons enforced unique); publish diff/revert demonstrated.

## A2 — Map Editor I: Terrain (XL)

Viewport foundation (game-parity rendering: terrain/splat/water/sky, fly/orbit cameras, overlay
system, chunk streaming in-editor); terrain sculpt suite (all brushes incl. path spline +
falloffs + masks), splat painting (8 layers, masks, solo), water tools, cliff overlay + dress
suggestions, generators (island synth, erosion, auto-splat) behind confirms; chunk draft store +
autosave/crash recovery + named checkpoints; undo/redo journal; validate→bake→publish for map
artifacts (walkgrid, chunk bins, world-map render) with SSE progress; heightmap import/export.
**DoD:** MAP_EDITOR.md §7 scenario _terrain half_: sculpt/paint/publish a new islet and walk it
in the live game; full-map bake under 10 min on the VPS; undo survives a 200-step brush session.

## A3 — Map Editor II: World Population (XL) — before game P12

Props mode (palette, gizmos, snapping, jitter stamping, multi-select, prefab collections,
floaters/buried reports), foliage scatter sets (paint + bake-to-instances), Spawns mode (enemy
spawners with patrol splines + camp links + density heat vs CONTENT_0.1 budgets, resource nodes,
NPC routines), Zones & POI mode (polygons + ambience live preview, POIs, interactables, shrine
graph), layers panel with per-zone clear, selection sets/isolation, measurements, keymap +
rebinding, single-writer lock, reachability validation, play-test bridge (draft preview channel —
or the documented staging fallback decision).
**DoD:** the full MAP_EDITOR.md §7 acceptance scenario, performed by the owner unassisted; game
P12 world building proceeds entirely in this tool (its real DoD is P12 shipping the Dawnlands
with it).

## A4 — Quest & Dialogue Editor (M) — with game P11

Step canvas (all types, hooks, hint circles), dialogue editor with previews + emote picker,
metadata/rewards builders with ƒ-suggests, flow validation + chain graph, journal preview,
grant-to-GM test hook.
**DoD:** game P11's pilot chain ("The Loggers' Silence") authored 100% in-editor by a non-coder
flow (owner drives, we watch); validation catches seeded errors in a fixture quest.

## A5 — Live Ops (M) — with game P13

Players online/search + inspector (sheet, inventory grant/remove audited, tp/bring/kick),
Moderation (bans/mutes/password resets/roles), Server view (metrics charts from snapshots + live
ring, log tail, announce composer with countdown, reload button, xpRate scheduler), Audit Log
browser with export, Backups status view + run-now.
**DoD:** the game P13 "GM event night" is driven half from in-game GM tools, half from here, and
every action lands in the shared audit trail; a password reset + ban/unban round-trip verified.

## A6 — Hardening & Ops Polish (M) — with game P14

Validation depth pass (every cross-ref rule from DATABASE.md §3 covered + fixture tests), publish
dry-run mode, bake performance (incremental correctness fuzz: random edit → bake → game loads),
empty/error/loading states audit across all modules, keyboard nav audit, admin-panel security
re-check (CSRF, session fixation, role bypass attempts), backups verify surfacing, docs:
`docs/USER_GUIDE.md` (owner-facing how-to with screenshots — the manual for years of content
work).
**DoD:** game P15 release checklist's admin items all green; the owner rates the panel "I can run
the game without asking anything" against the user guide.

## Post-0.1.0 candidates

Multi-writer map editing (CRDT or region locks), light theme, content localization editor (if Q4
changes), dungeon-instance editor (game 0.3), analytics views (player retention, economy flows),
in-panel scripting console for hooks (carefully).
