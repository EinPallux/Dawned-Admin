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
**Shared-schema change to pull in (game P9-D, 2026-08-04):** `enemyAbilitySchema` gained
`shieldDurationMs` (int ms, default 12 000) — how long a `self_shield` absorb lasts. The
schema-driven form picks it up for free once `@dawned/shared` is rebuilt in the game repo
and `pnpm install` runs here; no editor code changes. It is worth a quick tuning-field
promotion on the Enemies page next time that surface is touched, since it is now part of
what a caster's shield beat is worth. The game also bumped `PROTOCOL_VERSION` to 12 (enemy
cast flag on `AbilityStart`); the panel does not speak the game protocol, so that part is
informational — but `pnpm install` after ANY game-side shared change is still required.
**Game P9 is built and measured (2026-08-04), awaiting the owner's playtest** — the Mushroom
King solos in 105 s inside the design's 60–120 s window. One thing that finding is worth to
this panel: the TTK simulator's **player dps input is the whole answer**, and the page still
defaults it to 40. The measured number for a properly built level-12 warrior with T2 gear is
**78**, and an UNSPENT level 12 does 30 — so a preview run with a guessed dps can be off by
3× and send someone re-balancing a boss that was fine. Worth surfacing on the sim controls
(a measured reference row, or level-derived defaults) next time the Enemies page is touched.
**A1-e — the Professions editor is live** (2026-08-05, alongside game P10): Content →
Professions edits `content_resource_nodes` — what a birch, a copper vein, a herb patch or a
shoal IS. Same definition/placement split enemies use: this page owns definitions, the map
editor's `node` layer owns where they stand, and publish resolves one against the other. The
page's point is the **gathering preview**, which runs the game's own `rollGather`: hold time,
profession XP (with §1.3's back-country halving), proc chance, items per 100 gathers with
names resolved against the published catalogue, one node's yield per hour off its own
channel+respawn cycle, and how many gathers walk the profession from this tier's gate to the
next. It previews the EDITOR BUFFER rather than the saved row — a preview of the last save
lies for exactly one save, which is how a number gets halved twice. Fishing nodes list each
catch with the bar difficulty its rarity buys (`fishingDifficulty`), because a rare nobody can
land is invisible in the JSON. Publish blocks on a yield/proc item that is not published and
on a model that is not in the baked manifest — both are silent in the world (a gather that
hands over nothing, a node standing invisible); a fishing spot with a depleted model warns.
The map editor's `node` layer landed with it: a kind picker in the Place tool, thin placements
(id · nodeId · position · rotation · scale), markers scaled by the placement and ringed at the
DEFINITION's radius × that scale (the placement cannot answer its own size), and a bake that
refuses a placement whose definition is not published. `node tools/smoke/professions-editor.mjs`
drives it in a browser and checks the preview's ARITHMETIC against the shared formulas, not
just that a table appeared. 196 tests green. **One trap closed with it:** rebuilding `@dawned/shared` in the
game repo left a running dev server serving the module text it read at boot — Vite ignores
everything under `node_modules/` and the package is a `file:` link into it — with the exact
symptom `optimizeDeps.exclude` already fixed ("does not provide an export named X" for a
symbol plainly in the file), which is what makes it easy to chase twice. `server.watch` now
un-ignores the linked package.
**A2-a/A2-b — the map editor's foundations are in** (2026-08-04): the game repo's
`@dawned/shared` now owns brush math and deterministic scatter (so the editor preview, the
bake and the server cannot disagree), plus the draft tables (migration 0014). Here: chunk-
granular draft CRUD with a 45 s single-writer lease + takeover, gzip checkpoints with
restore, per-layer clear; `validateDraft` (zone coverage, model/loot/enemy refs, safe-zone
spawners, walkgrid flood-fill reachability, floater/buried + per-chunk instance budgets);
`bakeDraft` staging into `.tmp` then renaming (chunk bins, walkgrid, zones, placements,
meta, world-map + minimap) with SSE progress. Publish mints `map-<epoch>`, repoints
`current.json` LAST, mirrors the spawner layer into published `content_spawners` (a camp
moved in the editor has to move in the game), then pokes `/ops/reload-map` +
`/ops/reload-content`. **`POST /api/map/import-live` seeds the draft from the live world** —
without it the editor opens on empty ocean and the first publish would delete Dawnhaven.
The GAME side landed with it: the live map version is a served artifact, not a constant
(server reads `current.json`, reports it on `/api/health`, client asks the server which bake
to stream), and `/ops/reload-map` swaps a new bake under the running world. 61 tests green.
**A2-c/A2-d — the editor itself is live** (2026-08-04): a three.js viewport rendering
chunks through the SAME `buildChunkGeometryData` the game client uses (extracted to
`@dawned/shared` for exactly this — an editor with its own vertex code eventually lies
about the result); orbit/fly/top cameras with 1–9 slots; slope, walkability and height
overlays as vertex recolours; all six sculpt brushes, 8-layer splat painting with
slope/height masks, per-chunk water, the island/board toggle and a ruler; seeded island
synthesis, thermal erosion and auto-splat, each one undo step; a 220-step byte-snapshot
undo journal grouped per stroke; and the streaming publish panel. The resident region
follows the camera's zoom, capped at 13×13 chunks — 17×17 was measured at 7.5 M triangles
a frame.
**A3-a + the Place tool** (2026-08-04): placed objects render as colour-coded markers with
rings at TRUE size (a spawner's radius, a POI's ring), zone polygons on their ground, and
scatter as the 16×16 density grid the format really stores. Click the ground to stamp a
prop/spawner/POI/chest (defaults from what is actually published), click a marker to select
it whatever the tool, edit it in a quick-fields-over-schema-validated-JSON inspector, and
manage the set from a layers panel with counts, hide and a checkpointed "Clear layer…".
**Verified in a real browser** (`tools/smoke/map-editor.mjs`): imports the live world (271
chunks, 3 zones, 20 spawners), proves terrain RENDERED by measuring pixels, sculpts (1001 m
of displacement from 12 dabs), undoes and redoes exactly, paints, cycles every overlay,
waits for autosave, places and deletes an object, and validates. Four bugs came out of
LOOKING that no test would have caught: the camera opened inside a hillside, toolbar
selects stretched across the bar, the camera-follow poll stacked ~9 MB region requests
until the tab died, and the 17×17 region above.
**Autosave hardening** (2026-08-05, found by the slow smoke run): a flush landing during
another flush was DROPPED rather than queued — every chunk dirtied during the previous save
sat unwritten while the editor said "Unsaved changes"; and a generator-sized save (hundreds
of chunks) exceeded the endpoint's 64-row limit, so running Island/Erode/Auto-splat produced
a permanent "Save failed". Both fixed with retry-on-refusal, pinned by `draft-store.test.ts`.
Neither reproduces on a fast machine, which is exactly why the browser run matters.
**A3-c zone drawing** (2026-08-05): trace a border on the ground, `Enter` closes,
`Backspace` takes a corner back, `Esc` abandons; the polygon is normalised to the winding
the shipped world uses (`pointInPolygon` itself is even-odd and does not care). The editor refuses a self-crossing ring — it looks like a normal
shape and then contains half of itself (wrong fog, no discovery XP), which no amount of
looking would catch, so it is tested (10 tests). A selected zone can push its fog/sky/light
into the viewport, off by default. This is the piece that unblocks the §7 scenario: publish
BLOCKS on land in no zone, so a new islet could not reach the game without it.
**A3-b spawns mode** (2026-08-05): aggro/leash rings at TRUE size from the enemies a spawner
actually rolls (widest among its entries + the spawn radius — what a passer-by will feel);
camp links through the group centre with the spread in metres, so a `campTag` accidentally
spanning a ridge reads as one shape rather than two camps; per-zone population against the
CONTENT_0.1 budget over the same `pointInPolygon` the game assigns zones with, with unzoned
spawners on their own line; overlapping-pull pairs reported and never blocked (P9-C shipped
two deliberately mixed camps); and a deterministic simulate-populate using the server's own
uniform-over-AREA scatter. 11 tests. **Patrol splines were deliberately NOT built** — the
spawner schema has no patrol field and the AI no patrol state, so the editor would author
data nothing reads; the game-side slice it needs is written out in the game repo's
USER_QUESTIONS Q24.
**A3-c zone editing + the shrine graph** (2026-08-05): pick a zone from the tool bar (or click
its outline) and every corner gets a draggable handle with an insert dot on each edge;
`Shift`+click removes one. Each edit is refused if the ring would cross itself — including the
DELETE case, which can break a polygon that was legal a moment before (a brute-force search
found the fixture; it is not obvious). Shrines/campfires/signposts/portals/quest props are
placeable through a kind picker, each stamping a row that already passes shared
`validateInteractable`, and the Travel card lists every hop at the price the game will charge —
`fastTravelCost` went into `@dawned/shared` (game `formulas/travel.ts`, +7 tests) rather than
being copied here. Four real bugs fell out of driving it in a browser, none of which a unit
test could have reached: (1) **"Import live map" never reloaded the OBJECT list**, so an import
that restored a zone left the panel insisting it was gone and every camp "in no zone";
(2) **`normalisePolygon` reversed the winding the live world ships**, rewriting every zone the
editor touched — invisible at runtime (`pointInPolygon` is even-odd) and now pinned against a
ring copied from the bake; (3) **a zone border stole clicks from markers standing on it** and
the next thing you press is Delete — it ate Dawnshore during a smoke run, so solid markers beat
outlines in the pick and deleting a zone asks first; (4) **the zone tool required terrain under
the cursor**, which made half of every outline untouchable (all three zones reach 620 m out over
water) — it picks against the world plane now. Also: `@dawned/shared` is excluded from Vite's
dep pre-bundling, because the cached bundle survived a rebuild in the game repo and reported a
brand-new export as missing.
**A3-d — scatter, selection, prefabs and the keymap** (2026-08-05): the scatter brush paints
the 16×16-per-chunk density grid the format really stores (a forest is a couple of hundred
bytes and the bake re-scatters it deterministically); a stroke across a seam paints both
sides, the whole stroke is ONE save and ONE undo, and erasing a patch to nothing deletes the
row rather than storing 256 zeroes. Scatter sets — the weighted model list, density per
100 m², slope/height limits — are edited in the same card. Multi-select is click /
`Shift`+click / `Shift`+drag, and the marquee tests where markers are DRAWN, not the metre
they stand on. Prefabs keep a group's relative layout and stamp plain placements anywhere
(game migration 0015, `map_editor_collections` — in Postgres because months of them must not
die with a browser cache); stamping mints ids against the map AND against the ids minted
earlier in the same stamp. Selection sets drop ids that no longer exist rather than keeping
ghosts; isolation HIDES and composes with layer hiding. Every shortcut is a keymap row:
rebinding takes the key off its previous owner instead of silently swapping (two actions on
one key means the second never fires), and an old stored map gains new actions' defaults.
One bug came out of the browser run again: **scatter dabs did not accumulate within a
stroke** — each dab re-read the store, which is only written on mouse-up, so only the last
dab survived. Painting looked roughly right; erasing removed 9 % of what it should have.
`strokeBase` now owns that precedence and is tested.
**Not built, deliberately:** transform gizmos, grid snap and jitter stamping — polish on a
placement path that already works, not worth delaying the §7 run for.
**A2/A3-e — the §7 acceptance run closes both phases** (2026-08-05; A2 ✅ done, A3 ✅ built,
the owner's own unassisted run is the last word). `tools/smoke/map-scenario.mjs` performs the
whole §7 sentence in a real browser against the real game server: pan out to open water
(−6.8 m), Island-generate an islet (28.4 m of land where there was sea), paint it, scatter a
forest (13 077 density), drop a 21-spawner camp, place a chest/shrine/vista, trace a zone and
give it its own fog through the inspector, validate, PUBLISH — then ask the GAME whether it
swapped worlds (`dev-2 → map-<epoch>`, no restart), read the islet's own chunk bin and the new
zone back out of the published bake, and clear just that zone's props (3 → 0, the rest of the
world untouched). Three parts of §7 the game cannot receive are REPORTED, not faked: patrol
routes (Q24), T2 resource nodes (Q25), per-zone music/sfx (Q26). Full table in MAP_EDITOR §7.1.
**The run found the bug that mattered: no publish carrying scatter had ever worked.** The bake
handed draft scatter rows — which carry a row `id` — straight to the game's `.strict()`
placements schema, so `placements.json` threw and publish stopped between "zones" and
"placements", with no error on screen, none in the log, and a staging directory left behind
each time. Draft rows are PROJECTED into the baked format now (never cast — the cast is what
type-checked the mistake into existence), the failure is logged, a failed bake removes its own
stage, and `map-bake.test.ts` BAKES rather than only validating: passing `validateDraft` is not
proof a draft bakes, because the two run different schemas. Two operational holes closed with
it — publishing never removed an old bake (~8.6 MB each, forever; now a 5-deep rollback window
swept and reported via `pruneOldBakes`), and the live bake was in neither git nor the backups
(game `deploy/BACKUP.sh` archives it; bakes + `current.json` are git-ignored so a `git pull` on
the VPS cannot repoint the live world). Running both browser suites against ONE world found a
third: `map-editor.mjs` measured its scatter erase against EVERY patch in the draft, so the
islet's deliberately-left forest read as "erasing left 13 077 density behind" — a run has to
measure what it DID, not what the world contains, so it counts its own set id now.
**172 tests green**, and both browser runs pass end to
end: `map-editor.mjs` (import → sculpt/undo/redo → paint → overlays → autosave →
place/inspect/delete → spawn budget + rings → shrines and the travel graph →
drag/insert/remove a zone corner → validate → clean up after itself) and `map-scenario.mjs`.

### Running it locally

```bash
pnpm install && pnpm dev            # API :8082 + Vite :5174 → localhost:5174/admin/
pnpm check                          # needs the game repo's migrated local Postgres
node tools/smoke/map-editor.mjs     # the editor's tools, in a real browser
node tools/smoke/map-scenario.mjs   # MAP_EDITOR §7 — needs the GAME server on :8081,
                                    # and PUBLISHES a map (it leaves the islet live)
```
