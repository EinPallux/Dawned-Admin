# Dawned-Admin — Roadmap (A-track)

> Synced to the game repo's P-phases (see `Dawned/ROADMAP.md` — ⚙ markers there point here).
> Same working agreements: phases close only on their DoD, statuses maintained in this table.
> Sizes: S/M/L/XL relative effort.

| Phase | Name                                          | Size | Starts after          | Status                                  |
| ----- | --------------------------------------------- | ---- | --------------------- | --------------------------------------- |
| A0    | Foundation: shell, auth, data link            | M    | game P1 (schema live) | ✅ done (2026-08-04)                    |
| A1    | Content editors (items→curves) + publish v1   | L    | A0; serves P5–P8      | 🟨 abilities · progression · items live |
| A2    | Map Editor I: viewport, terrain, publish/bake | XL   | game P2 formats       | 🚧 in progress (a/b done, 2026-08-04)   |
| A3    | Map Editor II: placement, spawns, zones, POIs | XL   | A2 + game P9 systems  | 🚧 in progress (2026-08-04)             |
| A4    | Quest & dialogue editor                       | M    | A1; serves P11        | 🔲                                      |
| A5    | Live Ops: players, moderation, server, audit  | M    | game P13 ops API      | 🔲                                      |
| A6    | Publish polish, validation depth, backups UI  | M    | with game P14         | 🔲                                      |

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
- [x] **Owner DoD check:** confirmed 2026-08-04 — the owner logged in at
      play.pathlands.cc/admin and the panel works. A0 is closed.

## A1 — Content Editors & Publish v1 (L) — runs alongside game P5–P8

Shared editor framework (lists/details/usage-refs/duplicate/history/delete-guards/ƒ-suggest,
import/export); editors: World Settings, XP & profession curves, Abilities + Skill Nodes (with
tooltip/tree previews), Items (budget meter, icon picker, tier-series wizard, 3D weapon preview),
Enemies (kit builder, TTK calculator), Loot (nesting + simulator), Vendors, NPCs (minus spatial),
Zones (non-spatial); Publish flow v1 (validate → diff review → publish → hot-reload notify) +
Publish History with revert; Asset Browser v1 (thumbnails via tools pipeline, license badges).
**DoD:** game P5 tunes Warrior ability numbers live through this panel; game P8's first 60 items
are authored here start-to-finish (icons enforced unique); publish diff/revert demonstrated.

**Status (2026-08-04): A1-a abilities, A1-b progression and A1-c items/loot/vendors are live;
the P5 DoD hook is proven. The whole P8 catalogue — 62 items, 5 loot tables, 5 vendors and the
enemy loot bindings — was authored and published through the A1-c surface. Game P0–P8 are all
closed and owner-verified; **A1-d — the Enemies editor is live** (2026-08-04, alongside game P9):
bestiary + spawners on one rail, with a time-to-kill simulator that runs the game's own ability
selection rules.**

- [x] Abilities editor (Content → Abilities): class-grouped list with binding
      badges + draft markers, quick tuning fields over a shared-schema-validated
      JSON def editor, Ctrl+S drafts, prune-on-match, discard-draft. Draft CRUD
      is admin-role, audited; publish is all-or-nothing with slot-collision
      cross-checks and pokes the game's `/ops/reload-content` (live tuning
      without restart — the P5 DoD hook). 3 integration tests (15 total green).
- [x] The pipeline shipped real content: all 28 P5 kit rows (Warrior + Rogue
      slots, ×4-class basics) authored through the panel API and published live
      (`tools/content/author-kits.mjs`); the slot-collision cross-check caught a
      leaked test fixture on its first live run. The game's migration 0005
      freezes that published output for deploys.
- [x] **P5 DoD "live-tunable without restart" proven end-to-end**
      (`tools/content/live-tune-proof.mjs`): Crushing Blow's coefficient bumped
      via draft → publish → hot reload, the live game served the new number,
      then reverted the same way — re-runnable any time.
- [x] **A1-b — XP curve + skill trees (2026-08-04, with game P7):** Content →
      Progression's two tabs (class-picked branch columns laid out by tier with
      per-node shared-schema JSON; 29 editable curve rows with cumulative and
      formula reference columns), publishing over v1's rails plus curve
      completeness, ability-ref, cell-collision and one-capstone-per-branch
      cross-checks. It shipped the whole P7 content set — 29 curve rows and all
      96 skill nodes (`tools/content/author-progression.mjs`).
- [x] **A1-c — Items, Loot and Vendors (2026-08-04, with game P8):** Content →
      Items, three tabs on one publish rail. The items tab prices every draft
      against the ITEMS_LOOT §2 budget with a live meter and ƒ-suggest buttons
      (value, weapon band, scale-stats-to-budget) plus an icon-collision
      warning; the loot tab runs a 1 000-roll simulator through the SAME shared
      roller the server drops with (killer level and rolls-per-kill adjustable,
      `nothing` shown as the honest share it is); the vendors tab prices stock
      with the shared value/sell formulas. Publish cross-checks unique icons,
      resolvable item/table/vendor refs, loot cycles and the loot tables live
      enemies still roll, and reports budget deviations as advisory warnings
      that never block. 6 new integration tests (25 total green).
- [ ] Remaining A1 editors (enemies, zones, NPCs…) land with their consuming
      game phases (P9 enemies…); the shared editor framework generalizes from
      the abilities/items surfaces as they arrive.

## A2 — Map Editor I: Terrain (XL) — in progress

Viewport foundation (game-parity rendering: terrain/splat/water/sky, fly/orbit cameras, overlay
system, chunk streaming in-editor); terrain sculpt suite (all brushes incl. path spline +
falloffs + masks), splat painting (8 layers, masks, solo), water tools, cliff overlay + dress
suggestions, generators (island synth, erosion, auto-splat) behind confirms; chunk draft store +
autosave/crash recovery + named checkpoints; undo/redo journal; validate→bake→publish for map
artifacts (walkgrid, chunk bins, world-map render) with SSE progress; heightmap import/export.
**DoD:** MAP_EDITOR.md §7 scenario _terrain half_: sculpt/paint/publish a new islet and walk it
in the live game; full-map bake under 10 min on the VPS; undo survives a 200-step brush session.

- [x] **A2-a — shared map-authoring core (game repo).** Brush math (`applyBrushToChunk`, seam
      correctness across the shared vertex row, splat renormalisation to 255) and deterministic
      scatter resolution (`resolveScatter`) live in `@dawned/shared`, so the editor preview, the
      bake and the server cannot disagree about what a stroke did. Draft tables (chunks, objects,
      lock, checkpoints, versions) landed as migration 0014. 34 new shared tests.
- [x] **A2-b — draft store + bake/publish worker (here).** Chunk-granular draft CRUD with a
      45 s single-writer lease and takeover requests, gzip checkpoints with restore, per-layer
      clear (optionally polygon-scoped); `validateDraft` (zone coverage, placement/model/loot
      refs, safe-zone spawners, walkgrid flood-fill reachability, floater/buried and per-chunk
      instance-budget reports); `bakeDraft` staging into `.tmp` and renaming (chunk bins,
      walkgrid, zones, placements, meta, world-map + minimap renders) with SSE progress. Publish
      mints `map-<epoch>`, repoints `current.json` LAST, mirrors the spawner layer into published
      `content_spawners`, then pokes the game's `/ops/reload-map` + `/ops/reload-content`.
      **`POST /api/map/import-live` seeds the draft from the world players are standing on** —
      without it the editor opens on empty ocean and the first publish would delete Dawnhaven.
      19 new tests (61 total green).
- [x] **A2-c — viewport, cameras, overlays.** Chunk meshes come from the SAME
      `buildChunkGeometryData` the game client uses (extracted to `@dawned/shared` for this),
      so the editor cannot show a world that differs from the one players walk on. Orbit / fly /
      top-down rig with 1–9 camera slots and fly speed scaled to the boom; overlays for slope,
      walkability and height bands (vertex recolour, not a second mesh); chunk grid; a status bar
      carrying save state, cursor world position, chunk and the last action taken.
      The resident region follows the camera's zoom, capped at 13×13 chunks (832 m — wider than
      the whole dev island) after measuring 17×17 at 7.5 M triangles a frame.
- [x] **A2-d — terrain tools + undo.** All six sculpt brush kinds, 8-layer splat painting with
      slope/height masks, per-chunk water, the island/board toggle and a ruler. Seeded island
      synthesis, thermal erosion and auto-splat, each a single undo step. The journal keeps byte
      snapshots grouped per stroke, 220 deep: a brush dab is not invertible in general, and 17 kB
      per touched chunk buys an undo that cannot be subtly wrong.
      Verified in a real browser (`tools/smoke/map-editor.mjs`) — it imports the live world,
      measures PIXELS to prove terrain rendered, sculpts, and proves undo/redo restore exactly.
      That run also surfaced two autosave bugs a fast machine hides: a flush landing during
      another flush was DROPPED (losing everything dirtied meanwhile), and a generator-sized
      save exceeded the endpoint's 64-chunk limit and failed permanently. Both fixed, both
      pinned by `draft-store.test.ts`, along with retry-on-refusal.

## A3 — Map Editor II: World Population (XL) — in progress, before game P12

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

- [x] **A3-a — placement core.** Everything that stands on the terrain draws through one module:
      coloured markers per layer, rings at TRUE size for the numbers the owner is actually
      choosing (a spawner's radius, a POI's discovery ring), zone polygons on the ground they
      cover, and scatter as the 16×16 density grid the format really stores rather than a
      prettier lie. A marker on un-streamed ground is NOT drawn, rather than seated on the sea
      floor. Objects have their own store with immediate saves and rollback on refusal — moving
      a rock is one 300-byte row, and an object that vanishes inside a 2 s debounce is worse than
      a save per drag.
- [x] **A3-d (part) — the Place tool, selection, inspector and layers panel.** Click the ground
      to stamp a prop / spawner / POI / chest (defaults drawn from what is actually published, so
      a new row is legal the instant it exists); click a marker to select it, whatever the tool.
      The inspector is quick fields over the schema-validated full row — the same two-tier shape
      the Abilities and Items editors use. The layers panel counts each layer, hides it, and
      carries the double-confirmed, checkpointed "Clear layer…".
- [x] **A3-b — spawns mode.** Aggro/leash rings at true size from the enemies a spawner
      actually rolls; camp links drawn through the group centre with the spread in metres (a tag
      spanning a ridge reads as one shape, not two camps); per-zone population against the
      CONTENT_0.1 budget with unzoned spawners called out separately; overlapping-pull pairs
      reported but never blocked; and a deterministic simulate-populate using the same
      uniform-over-area scatter the server spawns with. 11 tests.
      **Patrol splines are NOT shipped** — the AI has no patrol state and the spawner schema no
      patrol field, so the editor would author data nothing reads (USER_QUESTIONS Q24 carries
      the game-side slice it would need).
- [x] **A3-c (part) — zone drawing + live ambience preview.** Trace a border on the ground,
      `Enter` closes it, `Backspace` takes back a corner, `Esc` abandons it; the polygon is
      normalised to the winding the game's `pointInPolygon` expects, so the owner never has to
      think about winding order. The editor refuses outlines that would misbehave: fewer than
      three corners, a self-crossing ring (it looks normal and then contains half of itself —
      wrong fog, no discovery XP, and unfindable by eye), or one enclosing no ground. 10 tests.
      A selected zone can push its fog/sky/light into the viewport, off by default because a
      zone's dusk hides the terrain being shaped.
- [ ] A3-c (rest) — vertex editing on an existing polygon, the shrine/fast-travel graph view.
- [ ] A3-d (rest) — selection sets + isolation, prefab collections, scatter brush, keymap UI.

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
