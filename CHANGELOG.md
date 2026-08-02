# Changelog — Dawned-Admin

All notable changes to the admin panel. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track the game's release trains (0.1.0 = tooling that shipped Dawned 0.1.0).

## [Unreleased]

### Added — Phase A0: foundation (built 2026-08-02; owner sign-off pending)

- **The panel exists**: React 19 + Vite SPA and Fastify API in one repo, served under
  `/admin` (Caddy strips the prefix; dev mirrors it), with `@dawned/shared` consumed as a
  SHA-pinned git dependency so schema/validation/formulas can never drift from the game.
- **Sign in with game accounts**: argon2id verification against the shared `accounts` table,
  restricted to `gm`/`admin` roles; 12 h sliding admin sessions as httpOnly SameSite=Strict
  cookies; login rate limiting; CSRF header on every mutation; every panel action writes the
  shared `audit_log`.
- **"Workshop" design system core**: dark dense tokens (no serifs, 2 px corners, hairlines,
  gold reserved for publish/live), app shell with the corner-cut logo, left rail with future
  modules parked under their phase tags, and a Ctrl+K command palette.
- **Dashboard v1**: live game-server card (online state, players, uptime, protocol, tick-p95
  sparkline against the 15 ms budget, RSS, net out — reads the game's health + ops metrics
  APIs; an unreachable game renders as a state, not an error) and a publish card counting
  real pending drafts (pipeline itself arrives with A1).
- **World Settings editor** — the first schema-driven form: generated from the shared
  `worldSettingsSchema` (xpRate, day/night switch, MOTD) with per-field enhancements, inline
  zod validation, draft badges, Ctrl+S, dirty-leave warning and gm read-only mode. Saves are
  **drafts only** (`content_world_settings.status='draft'`); publishing stays A1's job.
- **Verification**: 12 vitest (API integration against real Postgres + form generator) and a
  Playwright smoke — login → live dashboard → edit → save draft → reload persists → discard.
  CI runs the full check against a Postgres service (needs the `DAWNED_SHARED_TOKEN` secret).

### Added

- Complete planning documentation for the admin panel:
  - Product & UX specification (navigation, "Workshop" design system, publish flow, Live Ops,
    asset browser) — docs/ADMIN_DESIGN.md
  - Full 3D Map Editor specification (terrain sculpt/paint, placement, foliage scatter, spawns,
    zones/POIs, layers with per-zone clear, undo/redo, validate→bake→publish, play-test bridge,
    keymap, acceptance scenario) — docs/MAP_EDITOR.md
  - Content & Quest editor specifications (schema-driven framework, per-type editors with
    designer helpers: budget meters, TTK calculator, loot roll simulator, quest step canvas &
    dialogue editor, publish semantics) — docs/CONTENT_EDITORS.md
  - Architecture (React/Fastify/three.js, shared-schema strategy via `@dawned/shared`, auth &
    audit, data-access rules, bake workers) — docs/ARCHITECTURE.md
  - Roadmap A0–A6 synced to the game repo's phases; CLAUDE.md/AGENTS.md working agreements.

### Changed

- Folded owner decisions (2026-08-02): admin panel confirmed at `play.pathlands.cc/admin` with IP
  allowlist off; password resets via this panel confirmed; zone editing gains **weather
  probability sliders** and the Map Editor zone preview can force a weather state (weather is now
  0.1.0 visual scope in the game — see game repo WORLD.md §4.6).

### Notes

- No code yet by design — implementation starts at A0 once the game repo's P1 delivers the shared
  schema package.
