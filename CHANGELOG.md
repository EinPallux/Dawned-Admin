# Changelog — Dawned-Admin

All notable changes to the admin panel. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track the game's release trains (0.1.0 = tooling that shipped Dawned 0.1.0).

## [Unreleased]

### Added — Abilities editor + publish pipeline v1 (2026-08-03, A1 begins)

- **Content → Abilities**: the panel's first full content editor. Every ability
  grouped by class with slot/basic/RMB bindings and draft markers; the selected
  def opens with its hot tuning numbers (cost, cooldown, cast, unlock, swing)
  lifted into quick fields and the complete definition as JSON validated live
  by the SHARED `abilityDefSchema` — the exact validator the game server boots
  with, so the editor can never drift from the game. Saves write DRAFTS only
  (Ctrl+S), drafts identical to the published row are pruned, and drafts can
  be discarded per ability.
- **Publish v1**: the pending-changes panel diffs every draft against its
  published row (changed field paths), then validate + publish copies the
  whole draft set live in one transaction — any invalid draft or class/slot
  collision refuses the entire publish. On success the panel pokes the game's
  new `/ops/reload-content`, so ability numbers apply to the LIVE server
  without a restart (the response reports reload state; an unreachable game
  simply picks the rows up at next boot). Everything audited.
- 3 new integration tests (draft validation messages, the save→diff→publish→
  prune round-trip, slot-collision refusal); 15 total green.
- **The pipeline shipped its first real content**: all 28 P5 kit rows authored
  through the panel API and published live (`tools/content/author-kits.mjs`);
  the slot-collision cross-check caught a leaked test fixture on its first
  live run — refusing the publish exactly as designed.
- **Live-tune proof** (`tools/content/live-tune-proof.mjs`): re-runnable
  end-to-end demonstration of the P5 DoD — a coefficient edited as a draft,
  published, hot-reloaded into the running game, verified served, reverted
  the same way. No restarts anywhere.

### Fixed — blank page at /admin in production (2026-08-03)

- The deployed panel rendered a **blank white page**: the game repo's Caddyfile proxied
  `/admin` with `handle` (prefix kept) while the panel is built against stripped paths
  (`handle_path`), so the SPA fallback answered `/admin/assets/*.js` with `index.html` and the
  browser refused the bundle on MIME. Fixed in the game repo's `deploy/Caddyfile`
  (`handle_path /admin*`, now pinned by a vitest there).
- Fonts now ship as same-origin files instead of `data:`-inlined CSS URIs
  (`assetsInlineLimit: 0`): the production CSP (`font-src 'self'`) silently refused the inlined
  Inter subsets — dev never showed it because Vite applies no CSP.
- Production static serving got real cache headers: hashed `/assets/*` immutable for a year,
  `index.html`/SPA fallback `no-cache` (a cached index after a deploy references bundles that no
  longer exist — the same rule the game's Caddyfile enforces), and the deep-link fallback now
  answers `HEAD` like `GET`.
- **New smoke — `node tools/smoke/admin-prod-serve.mjs`**: boots the built panel in
  `NODE_ENV=production` behind a replica of the real Caddy `/admin` block (prefix strip + the
  actual CSP parsed from the sibling game checkout) and drives Chromium through load, asset
  MIME/caching checks, font loading and a full login. The dev stack structurally cannot catch
  this bug class; this closes the gap the A0 deploy fell through.

### Changed — deploy determinism (2026-08-03)

- `@dawned/shared` is now a **sibling-checkout dependency**
  (`file:../Dawned/packages/shared`) instead of a SHA-pinned GitHub git
  dependency: pnpm resolves GitHub git deps to codeload tarballs, which private
  repos cannot serve credential-less on the VPS — the panel build died there.
  Dev machines, CI and the VPS all keep the repos side by side (the game repo's
  deploy scripts provide a `Dawned → game` symlink and build shared first);
  both repos deploy from `main` together, so the contract stays in lockstep.
  CI now checks out the game repo as a sibling (same `DAWNED_SHARED_TOKEN`
  secret, used for checkout instead of tarball auth).

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
