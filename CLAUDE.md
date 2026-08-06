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
migration 0012. **Current: game P0–P11 are all closed on their measured DoDs (P9 + P10 on
2026-08-05 and owner-accepted; P11 — Quests, POIs & Interactables measured its DoD on
2026-08-06), and this panel's A4 sync point — the quest & dialogue editor — is BUILT and
carried the whole P11 pilot set.** Phases close on the measured DoD, not on a playtest; all
feel/number tuning is one deliberate pass at the end of the project.
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
**Game P9 is closed (measured 2026-08-04, owner-accepted 2026-08-05)** — the Mushroom
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
**Game P10-E ran the whole gathering catalogue through this panel (2026-08-05)** —
`tools/content/author-nodes.mjs`: 42 material/gem/proc/fish items, all 21 resource-node
definitions and 65 T1–T2 placements, each published on its own rail, ending with a map
publish the game hot-swapped onto. That is the Professions editor's first real load, and it
held. Two things the run taught the tooling: a content script must be **safe to re-run** (an
unchanged draft prunes itself, so "nothing to publish" is success, not failure — otherwise
fixing one placement means re-authoring everything), and a placement pass must **clear its
layer first**, because overwriting by id leaves the previous run's rows standing wherever they
were. Moving a cluster fifty metres left two trees at the old spot: published, invisible in
the diff, findable only by walking there.

**Game P10-F is built (2026-08-05) — nothing here needed changing, but one shared number
moved.** `MARKER_MAX_SPEED` in `@dawned/shared` went 1.5 → 0.9: measured against a live
server, the reel bar could not be won at all through one tick of command delay (the crude
strategy the game's own tests use lands 20/20 offline and landed 0/12 on the wire), because a
delayed tick at 1.5/s carried the marker half a catch zone. Rebuild `@dawned/shared` in the
game repo and re-run `pnpm install` here, as after any game-side shared change. Nothing in the
Professions editor reads it today — but the moment this panel grows a fishing PREVIEW the way
the Enemies page has a TTK simulator, it has to run the shared reel rather than a copy, for
exactly the reason the TTK sim runs `selectableEnemyAbilities`. Q27 (how hard a T5 legendary
should be) was answered 2026-08-05 with the recommended default — leave the reel as shipped and
judge it in the playtest — so the ladder is settled for 0.1.0; it stays two numbers in
`fishingDifficulty` and a natural candidate for a tuning surface here later.

**Game P10 is closed (2026-08-05) — P10-G measured the DoD and nothing here needed changing,
but two of its findings are this panel's business.** (1) The Professions editor's gathering
preview reports "how many gathers walk this profession from one gate to the next", and that
number now has a MEASURED counterpart: woodcutting goes 1 → 10 in **458 real gathers** on the
live server, with the T2 gate at 248 — and both figures reproduce the shared curve's own
arithmetic to the gather, which is the strongest evidence yet that this page's preview and the
game agree. Worth showing as a reference row next time the page is touched, the same way the
Enemies page's TTK sim wants the measured 78 dps instead of its default 40. (2) The game gained
**`/ops/fish`**, which puts a named fish on a player's line — the reel's difficulty comes from
the fish's rarity, so this is how a rare or legendary BAR gets played on purpose rather than
waited for. If the fishing preview mentioned above is ever built, that lever is how its numbers
get checked against a real server, and it is also the handle a GM would want on a Live Ops page.
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

**A4 — the quest & dialogue editor is live** (2026-08-05, alongside game P11): Content →
Quests edits `content_quests` and `content_npcs` on ONE publish rail, because they reference
each other and shipping them apart guarantees a window where a live quest points at an NPC
that is not there yet — the same argument enemies and spawners ship on. The validation worth
naming is the GAME's `validateQuestFlow`, not a copy: a quest this page calls valid and the
server refuses to load would land at the next server BOOT rather than at the publish button.
On top of it, the cross-checks a single row cannot make (every NPC, item, enemy and
prerequisite resolves in the would-be-published set) and four advisory warnings that never
block: a quest that pays nothing, a chain link nothing unlocks, a giver no quest names, and a
`zoneId` no zone on the map carries. The **chain graph is built from `prerequisites`, not from
`chainId`** — the label groups the journal, the prerequisites are what the game gates on, and
drawing the label would draw a graph that disagrees with the game, which is the same mistake
the TTK simulator avoids by running `selectableEnemyAbilities`. Rewards ƒ-suggest off the
shared formulas; the grant-to-GM hook proxies to the game's `/ops/quest` (rule 3).
`node tools/smoke/quest-editor.mjs` drives it in a browser and cleans up its probe rows in a
`finally`. **219 tests green** (225 after the hint cross-check below).
**Game P11-C ran the whole pilot set through this surface** (`tools/content/author-quests.mjs`:
4 NPCs, 8 quests, then 4 NPC / 7 interactable / 6 POI placements and a map publish the game
hot-swapped onto), and that run found the bug that mattered: **the map editor and the game
disagreed about what an NPC placement IS.** A2 shipped a local guess at the row — `name`,
`modelRef`, a walk `routine` — months before P11 defined the real one in `@dawned/shared`
(`npcId` + a composed appearance, so no mesh and no patrol state). The draft store and the bake
then each validated with the schema they had, and the editor refused, with a 500, exactly the
row the bake was written to emit. Both were real zod schemas, so nothing typechecked; the
file's own comment already forbade it. `map-bake.test.ts` now asserts the PROPERTY — a def the
bake accepts must survive the draft store, for every layer — rather than re-checking shapes.
Two more from the same run: the bake **counted** NPCs and never wrote them (the scatter lesson
again — a count is not evidence a row was written), and an NPC placement whose definition is
not published now BLOCKS publish, like a node's.
**Game P11-D (the client) found one thing that is this panel's business.** All four pilot NPCs
were authored here with `idleClip: 'Idle'`, and the UAL library's standing-still clip is
`Idle_Loop` — a composed rig plays NOTHING for a name it does not have, so every villager stood
in a T-pose until a screenshot caught it. Re-authored and re-published (the game shipped the
repair as migration 0020 and moved its schema default). Nothing here changed, but it is the
clearest case yet for a **clip-name check on the NPC form**: publish already refuses a model that
is not in the baked manifest, and an authored clip that names nothing is the same class of silent
mistake. Worth doing next time Content → Quests is touched.

**Two script rules this run reinforced.** A content script must be safe to re-run ("nothing to
publish" is success). And **layer ownership decides whether you may clear**: the `npc` layer is
the script's alone, so it clears first; `interactable` and `poi` are SHARED with hand placement
in the editor, so clearing them would delete the owner's shrines — those upsert by id and the
script prints exactly which ids it owns.

**Game P11-E closed the phase (2026-08-06) and it is the run that found this page's real gap:
a hint circle nothing had ever compared to the world.** The game's DoD run plays the pilot chain
with only in-game affordances, so it walks to the circle the map draws — and four of the pilot's
five kill hints sat **85–170 m outside their only spawner**, while both gather steps had no
circle at all. Nothing was wrong with either row: the circle is typed on Content → Quests and the
spawner is placed in the map editor, two pages that had never met. That is exactly the class of
mistake a cross-check exists for, so publish now resolves each step's REAL targets — spawners for
a kill, resource-node placements for a gather, NPC/interactable placements for the rest — and
warns with the distance quoted (`questHintCoverage` went into `@dawned/shared` rather than being
copied here, for the same reason `fastTravelCost` did: the game's map draws the same circle).
It **warns rather than blocks**, because §1 rule 4 says the map hints _roughly_ where and a
deliberately loose circle is a design choice; a circle 170 m off is not. Re-authored and
re-published through this surface, with two gather hints added and Hesta's prose re-pointed at
the region the mossbloom actually grows in.
**One more content rule came out of it, and it belongs on this page too: nothing a quest step
needs may be one-shot.** The crate and the marked stumps were authored `respawnMs: 0`, so a
player who opened the crate out of ordinary curiosity before Torv mentioned it could never take
"The Lost Crate" at all. Spent state is per-character, so a respawn costs nothing; both are
300 000 ms now. Worth a form-level nudge next time Content → Quests is touched — an interactable
a quest STEP names with `respawnMs: 0` is a soft-lock the JSON does not look like.
**225 tests green here** (the hint cross-check added 6 of them); the game side
finished at 642.

**A2 grew the tool P12 needed: whole-world generation (2026-08-06).** The map editor's island
button has been there since A2-d and it cannot build the Dawnlands — it generates into the
RESIDENT region, capped at 13×13 chunks, and the world is 32×32. MAP_EDITOR §2.1 has always said
the mask synth is what seeds the base world for game P12; this is the half that can do it.
`GET /api/map/generate-stream` is admin-only, lock-held, checkpointed FIRST and streamed, and it
rewrites terrain and ONLY terrain — placed objects re-sit on the new heights, which is what §2.1's
"non-destructive to placed props" means. Two things the per-chunk generator could not do: masks
COMBINE rather than overwrite, so two overlapping isles make an isthmus instead of the second
erasing the first; and `carve` masks SUBTRACT, so a strait can sever an isthmus the masks just
merged. That pairing is what lets a world be 55–60 % land AND have bridges that gate the path.
Erosion runs over ONE 2049² height field, because the per-chunk pass must skip the border rows
adjacent chunks SHARE and that leaves an un-eroded lattice every 64 m.
**A splat rule names a `zoneId` rather than carrying its own ring**, resolved server-side against
the draft's zone layer: a copied polygon goes stale the first time somebody drags a corner, leaving
the paint and the region describing different ground. (It is also the only thing that fits — an
SSE endpoint takes its plan in a URL and six rings of 28 corners is 15 kB.)
**`pnpm world:preview` is the piece that made the layout tractable**, and it earned its keep on
the first run. Its flood fill found that **three of five straits severed nothing**: the isles
joined around the ends of the cuts and one carve had been typed at nearly a right angle to where
it belonged — while a depth probe at each channel's own centre reported "open water" for all five,
which was true and completely beside the point. Straits derive their centre, angle and length from
the two isles they separate now. The preview also caught islets drowned inside their own channel
and land standing in no zone (which blocks publish), each before a chunk was written.
**`pnpm world:author` ran it for real:** 1024 chunks written, 766 carrying land, **57.6 % coverage,
0 unclaimed splat texels** — every figure identical to the preview's offline numbers, which is the
proof both run one copy of the maths. It stops short of publishing on purpose: the new archipelago
puts open water where the dev island was, so validation refuses every game-side P8–P11 placement as
standing on a disabled chunk. Answering that is the game's P12-B onward. **248 tests green.**

**Game P12-B settled the world through this panel (2026-08-06)** — `pnpm world:settle`: 40
buildings across five settlements, nine shrines, 35 plank sections on the causeways, and a prune
of the 46 P8–P11 rows the new sea drowned. **The draft validates.** Two new mask kinds went in
with it: `causeway` (a bridge has to BE ground — the walkgrid only subtracts) and `plateau`
(levelled, smoothstepped ground, because a house on noise-generated terrain stands on a slope).
**Two of the three bugs it found were this panel's, and both had been latent since A2.**
`listObjects` had **no ORDER BY**, so it returned Postgres's physical row order — which changes
whenever a row is updated. Nothing depended on it while no two zones overlapped; game P12 added
the Dawnsea, whose ring covers the whole map, and `zoneAt` takes the FIRST match, so an unchanged
draft could have baked Dawnshore as ocean one publish and not the next. Objects order by id now
(which also makes two publishes of one draft produce the same bytes, so a diff is readable), and
`bakeDraft` sorts zones by polygon area ascending — the smaller, more specific zone wins, as a
property of the data. Ordering them then broke a reachability test, which was the real find:
`findSpawn` took `zones.find(z => z.settlement !== null)`, fine with one settlement and a coin
flip with five, so **a new character could have spawned in the level 24–30 mining camp**. The
starter is the lowest level band now, tested through the bake's own `meta.json`.
The third was in the content script and is a lesson about coupling: it pruned drowned placements
by matching `validateDraft`'s prose, and props use a DIFFERENT sentence from nodes and spawners
("stands on a disabled chunk (it would fall into the sea)" vs "sits on"). It reported success
while 37 rows sat in the sea. It asks the chunks whether they are enabled now.
`pnpm world:preview` grew the check that matters for settlements — the ground under every
building — and it found Dawnhaven's harbour on a 37° slope, Sunwatch's farms on 44°, and a shrine
in 8 m of ocean, all before a row was written. **259 tests green.**

**Game P12-C ran the whole bestiary through this panel (2026-08-06)** — `pnpm world:bestiary`:
50 enemies, 7 zone loot-table stubs and **124 camps**, published on the Enemies rail AND written
into the map's `spawner` layer, because Q23 makes the MAP the owner of where a camp stands and a
map publish delete-then-inserts that whole published set. Every P4–P9 camp was re-placed: they
stood on the dev island, which the Dawnlands put under open water.
**Two pieces of tooling landed with it, and the node/POI/NPC passes reuse both.**
`tools/content/world-sample.ts` holds ONE in-memory synthesis of the world (the same `synthWorld`

- `erodeField` the generate endpoint runs) so every content script asks the same ground "is there
  land here, how steep, which landmass, which zone". `tools/content/placement.ts` turns a WISH —
  zone, bearing from that isle's heart, distance — into a coordinate by spiralling outward until
  every constraint holds, and it reports WHICH constraint each rejected candidate failed. It is
  **capped at 120 m on purpose**: an unbounded search always succeeds and quietly moves a camp a
  third of an isle away, which turns an authored difficulty gradient into scatter and reads as
  success. Two wishes hit that cap and were fixed rather than absorbed.
  **The bug that mattered is this panel's, and it had been live since A1-d: the Enemies page's
  prune-on-match compared the RAW jsonb column.** Postgres normalises key order, so an identical
  draft could never prune — every re-run of a content script republished the entire bestiary and
  showed 174 "changes" in a diff review whose only job is to say what changed. The A1-c fix landed
  on the item and progression editors and this one kept the COMMENT without the code. Parsed against
  parsed now; a third run of `world:bestiary` reports "50 pruned, nothing to publish", which is what
  "safe to re-run" is supposed to look like.
  **A second one was found by the GAME rather than here**: `world:author` wrote its seven zones by
  id and never cleared the layer, so `ashen_reach` — seeded from the dev island by `import-live` —
  survived a whole world regeneration and, being a smaller ring, WON inside the savanna and the
  canyons. Nine camps reported a zone WORLD.md does not have. The game's new `/ops/camps` counts what
  the world actually seeded per zone; that is the line that showed it, and it is the same shape of
  evidence as `/ops/respawnnodes` and `/ops/worldobjects`. After the fix the game reports **124
  spawners, 400 enemies alive, 0 unresolved refs, 0 camps that produced nothing**, per zone identical
  to this repo's offline placement.
  **One shared-schema change to pull in:** `enemyDefSchema` gained `tint` (`#rrggbb`, nullable) —
  the bestiary reuses models across bands and a boss wearing its own minions' mesh is not a boss.
  The schema-driven form picks it up for free after a rebuild; a colour swatch instead of a text
  field is worth doing next time the Enemies page is touched, and so is the fact that its TTK sim
  names COMBAT.md §12's 60–120 s window for WORLD bosses too, where §12 says "zone boss".
  **259 tests green here.**

**Game P12-D ran the whole item catalogue through this panel (2026-08-06)** —
`node tools/content/author-items.mjs` now owns T1–T2 _and_ the T3–T5 deep set together: **182 item
rows, 21 loot tables and 16 vendors** on the Items page's one publish rail, ending at 223 published
items (the other 41 are P10's gathering materials, which `author-nodes.mjs` owns). It is one script
because the vendors are the same rows in both files' eyes — the P8 shops were anchored on the dev
island, so every one of them had to move onto a building the map publish actually placed, and four
settlements gained their own.
`item-data-deep.mjs` authors IDENTITY only — name, slot, ilvl, rarity, attribute weights, one line
of flavour — and every number comes out of the shared §2 formulas, which is the same contract the
Items page's budget meter previews with. Armour ships as authored SETS rather than per-slot rows.
Loot nests through per-tier pools so a zone names its gear once, and each boss has its own table
with **no `nothing` entry at all**, which is what makes "guaranteed Rare+" a property of the data.
**The bug that mattered is content ownership, and it is this repo's:** `item_material_dawnpetal`
was authored in BOTH `item-data.mjs` and `node-data.mjs` at different ilvls, so whichever content
script ran last won. Republishing the item catalogue silently reverted P10-E's re-tiering of
Dawnpetal from a Dawnshore common to the Elder Grove's T5 rare — and put a "legendary" bloom back
in a level-3 mob's loot table. Caught by the GAME's gathering-ladder test, not by anything here.
A content script that republishes rows it does not own is the same class of mistake as a placement
pass that clears a layer it shares.
**One shared-schema thing to know:** `equipmentBonus` now returns `pct` and `killGold` as well as
`stats`/`weapon` — P8's item effects were folded by a server helper nobody called, so every Epic
and Legendary effect in the game was decoration. They are wired now, and because the fold is in
shared, any character-sheet surface this panel grows gets the same answer the server fights with.
**259 tests green here.**

**Game P12-E planted the gathering catalogue through this panel (2026-08-06)** — `pnpm world:nodes`:
the 21 definitions re-authored and **362 placements** written into the map's `node` layer across all
six zones, up from 65 on the dev island. The layout lives in `node-clusters.mjs` as **73 wishes**
(zone, bearing, distance, count, spread) rather than 362 coordinates, resolved by the same
`placeAll` the camps use, and the per-member ground check reads the DRAFT CHUNKS with a 6-attempt
retry that shrinks toward the centre — the retry is what makes a shoal land 8 of 8 instead of 3 of 8.
The game reports **362 nodes, 0 orphans**.
**The bug that mattered is this panel's tooling, and it is the sharpest example yet of a check that
stops one level too early.** `placeAll` validates the cluster CENTRE's zone. The members scatter up
to `spread` metres off that centre and were only ever asked about the GROUND — so **39 of 322 land
nodes stood in a zone they were never authored for**: 7 ashwood, 5 dawnstone and 5 duskthorn (the
canyons' T5 band) in the T4 savanna where nothing gates a player from them, and 4 of the 12 Dawnpetal
in Emberwood — which is exactly the promise game P12-D had just repaired in the DATA, broken again by
geometry a day later. Nothing was wrong with any single row. The member loop asks the DRAFT's zone
layer now (not the offline synthesis: the owner can drag a corner, and then the copy is stale),
ordered exactly as `bakeDraft` orders it, and the retry that already existed absorbed every stray at
no cost — 362 placed, 0 dropped, per zone 70/70/70/70/70 + 12.
**It became a publish cross-check, for the same reason `questHintCoverage` did:** the script fix
protects the script, and the owner places nodes by hand. Publish now warns when one node id's
placements split across zones, naming the split. A node definition carries a tier and no zone, so
the panel checks the data against ITSELF rather than inventing a design mapping it would then own.
Warns, never blocks — two regions can be deliberate, 5 of 19 across a line is not. +2 tests.
**Two script lessons, both general.** A run must report **where its output STANDS**, not only how
much of it there is: the per-definition counts were perfect through every broken run, because a
count cannot see a border. And the offline synthesis is the right source for a wish and the wrong
source for a verdict — the draft is what the bake reads.
**One thing that was not this repo's but was found here:** `WORLD_GEN_PLAN.waterLevel` was `null`,
so every generated chunk declared no water. The game draws a water surface only where a chunk
declares one, so 42 % of the map was an invisible hole and **no fishing node could be authored at
all**, because "submerged" means ground below its own chunk's water. Two phases passed without it
because nothing had needed water to EXIST. **261 tests green here.**

**Game P12-F peopled the world through this panel (2026-08-06)** — `pnpm world:places` and
`pnpm world:folk`: 45 POIs, 47 interactables, 68 settlement dressing props and 41 NPC placements,
with 37 NPC definitions on the Quests rail. The game reports **41 NPCs, 61 interactables, 46 POIs,
0 orphans**. Both scripts resolve WISHES through the same `placeAll` the camps and gathering
clusters use, and both report **where their output STANDS** (zone by zone, resolved the way
`bakeDraft` resolves it) rather than only how much of it there is — P12-E's lesson, since a count
cannot see a border.
**A vendor NPC's position is not a free choice.** A vendor row carries an `anchor` whose radius is
the proximity lease the GAME checks before it will open a trade, and the schema's own comment says
that anchor exists "until P12 places the real NPC". So `world:folk` reads the published anchors and
stands each shopkeeper on theirs. Put the body anywhere else and `F` offers a trade the server then
refuses — which looks like it works, which is the worst kind of wrong.
**The bug that mattered is this panel's, and it is the clearest case yet of a check modelling the
wrong thing.** Publish refused all five Elder Grove rows as "cannot be walked to from the spawn".
That was RIGHT — the Grove has no causeway and the ocean around it is disabled chunks — but the
fix is not to soften the check. `reachableFrom` only walked the walkgrid, and **a portal is a way
to GET somewhere; that is the whole of what it is**. So the fill was wrong about everything behind
any portal, and would have refused exactly what WORLD.md §3.6 specifies ("a one-way ancient portal
in Ashcrag"). It consumes portals as directed edges now, to a fixpoint so they can chain, and only
once the portal's own mouth is reachable — otherwise a portal sealed inside the far side would
declare itself the way in. +3 tests. (The content was also authored backwards: the arch had been
placed in the Grove pointing out. It stands in Ashcrag now.)
**Two script rules re-confirmed.** Layer ownership still decides clearing: `npc` is the script's
alone so `world:folk` clears it, while `poi`, `interactable` and `prop` are shared with hand
placement and are upserted by id with the owned ids printed. And the publish cross-checks earn
their keep — the run caught a `vendor`-role NPC with no `vendorId` (her `F` would have opened
nothing) and warns, correctly, that eleven new quest givers are named by no quest yet.
**264 tests green here.**
**Game P12-F's quest set closed it (2026-08-06)** — `pnpm world:quests`: 20 new quests published on
the Quests rail, taking the game to **28 in 5 chains**, and P11's eight pilot quests repaired in
the same pass. The script's point is the **hint resolver**. A step declares WHAT it points at
(`{ enemy: … }`, `{ node: … }`, `{ object: … }`, `{ npc: … }`, `{ poi: … }`) and the run resolves
that against the live map draft — the rows the bake reads — then circles the DENSEST cluster of
matches. `questHintCoverage` at publish is a backstop; deriving the circle is the fix, because a
hint built from the thing it points at cannot point at nothing.
**Clustering, not encircling, is what makes it a hint.** The first version drew one circle around
every match and produced a **327 m** ring when two camps sat on opposite sides of an isle. Matches
outside the chosen cluster are reported now, and a derived radius over 260 m fails the run.
**The repair pass is the finding.** Five of P11's eight quests pointed **420–815 m** from their
targets — the same failure P11-E documented, arriving by a different road: they were authored
against the dev island and P12 moved every spawner, node and villager under them. They go through
the same resolver rather than being re-typed. One was worse than a bad circle: `quest_shore_lost_
crate` names a crate that P12-B pruned as drowned, so a live quest referenced a placement that did
not exist — re-placed via `world:places`. The Weald chain's four `zoneId` labels moved to
`verdant_weald`, which is exactly the edit P11-C wrote down as owed.
**One thing measured here and NOT fixed (game USER_QUESTIONS Q32):** `bakeDraft`'s
`orderZones` sorts by polygon area ascending — P12-B's fix for `zoneAt` non-determinism — and that
is right for containment (the Dawnsea must always lose) and arbitrary for two peer zones that
overlap at the edges. Dawnshore's ring is 6 % larger than the Weald's where they meet, and that
overlap contains **Dawnhaven**: the starter town resolves to the level 6–12 zone. Three fixes
measured; nearest-centroid alone is wrong (it drags 572 of 3 100 land samples into the Dawnsea).
Recorded rather than patched, because it re-points ambience, discovery and journal headings for the
whole world at once.

**Content scripts take a real login now (2026-08-06, game P12-H).** The game repo gained
`deploy/WORLD.sh`, which deploys the WORLD by running THESE scripts on the live VPS — code travels
in git and a published map bake does not, so an updated box had all of P12's features and the old
dev island to use them on. That path was blocked by something this repo had been carrying since
A1: every `author-*` script minted an admin account whose password (`admin-smoke-pass-1`) is a
literal in a public repository. Harmless in a throwaway dev container; a permanent admin back door
on a real box, and "run these on a real box" is precisely what deploying a world means.
`tools/content/admin-session.mjs` replaces eleven inline copies of that block. It reads
**`DAWNED_ADMIN_USER` / `DAWNED_ADMIN_PASS`** and touches the `accounts` table only when neither is
set — so a deploy creates nothing, and every row the run publishes is attributed to a person in
`audit_log` rather than to a shared robot. The dev fallback mints a **per-run random password** on
its own account (`zz_admin_content` — deliberately NOT the smokes' `zz_admin_smoke`, which a
content run banning it would break) and bans it when the run ends. The random password is the part
that actually holds: `close()` can be missed on a crash or a `fail()`'s `process.exit`, and what
survives is then an account nobody can log into rather than one everybody can. The ban has to come
at the END of a run, never right after login, because `auth.ts` re-checks `accounts.status` on
every request. Verified against the running panel both ways: supplied credentials published with no
account created, the fallback ended `banned`, and `world:author` — the TypeScript entry point,
which needed `admin-session.mjs` listed in `tools/tsconfig.json` — regenerated all 1024 chunks
through it. **264 tests green.**

**The owner's first world deploy found what that path had been hiding: the panel could never
publish a map on a real box.** It died on `ENOENT: … mkdir '…/assets_baked/map/map-….tmp'`,
naming a path whose parents plainly existed. `dawned-admin.service` runs under
`ProtectSystem=strict` with `ReadWritePaths=/var/lib/dawned`, and `MAP_DIR` is the GAME
checkout's `assets_baked/map` — outside it, therefore read-only — and **a recursive `mkdir` into
a read-only tree reports ENOENT rather than EROFS**, which sends you hunting for a missing
directory that is right there. The unit was written at game P0, months before A2 gave this panel
a map to publish, and a dev container has no sandbox, which is why every smoke and both browser
suites had always passed. `bakeDraft` catches the staging failure now and names MAP_DIR, the
errno and the `ReadWritePaths` requirement (+1 test, provoked with ENOTDIR so it behaves the same
when tests run as root). The service-side fix is the game repo's: the shipped unit grants it, and
`UPDATE.sh`/`WORLD.sh` install a drop-in on boxes provisioned before it. **265 tests green.**

**Two fresh-box faults came out of the owner's first world deploy (2026-08-06, game P12-H), and
both were invisible in a checkout that had grown through the phases in order.**
(1) **`world:bestiary` stubbed a TYPED list of seven zone loot tables.** An enemy publish blocks on
an unpublished loot ref, so the pass creates `nothing`-only stubs and the item pass fills them —
but the list named only the zone tables, and the six `loot_boss_*` are P12-D's. On a box holding
nothing but the seed migrations they do not exist, so the deploy stopped at step 3 with six
refusals. The set is DERIVED from `ENEMY_DEFS` now: a new enemy pointing at a new table is stubbed
by the same code that publishes it, which is the quest hint resolver's rule applied to references.
Reproduced before fixing by dropping the six published rows, and verified after — `6 of 18 …
published as stubs`, the bestiary publishes, `author-items.mjs` restores all six with their real
names and entries.
(2) **`bakeDraft` surfaced a raw `ENOENT`** for a staging directory whose parents plainly existed —
`dawned-admin.service` runs under `ProtectSystem=strict` on the VPS, so `MAP_DIR` was read-only and
a recursive `mkdir` into a read-only tree reports ENOENT rather than EROFS. **Map publish had
therefore never worked on a real box since A2**; a dev container has no sandbox, which is why every
smoke and both browser suites had always passed. The staging failure names MAP_DIR, the errno and
the `ReadWritePaths` requirement now (+1 test, provoked with ENOTDIR so it behaves the same as
root). The service-side fix is the game repo's.
**The lesson both share: this repo's content scripts had only ever run against a database that
already contained the previous phase's output.** The game repo's `deploy/WORLD.sh` runs them
against one that contains only the seed migrations, which is a different program. A run of the
whole chain against a virgin database is now part of verifying a change to any of them.

### Running it locally

```bash
pnpm install && pnpm dev            # API :8082 + Vite :5174 → localhost:5174/admin/
pnpm check                          # needs the game repo's migrated local Postgres
node tools/smoke/map-editor.mjs     # the editor's tools, in a real browser
node tools/smoke/map-scenario.mjs   # MAP_EDITOR §7 — needs the GAME server on :8081,
                                    # and PUBLISHES a map (it leaves the islet live)
node tools/smoke/quest-editor.mjs   # the quest editor, in a real browser (cleans up after itself)
node tools/content/author-quests.mjs  # re-author + re-place the P11 pilot set (PUBLISHES a map)
pnpm world:bestiary                 # 50 enemies + 124 camps (PUBLISHES content, writes the map layer)
pnpm world:nodes                    # 21 node definitions + 362 placements (PUBLISHES content + a map)
pnpm world:places                   # 45 POIs + 47 interactables + 68 town props (PUBLISHES a map)
pnpm world:folk                     # 37 NPC defs + 41 placements (PUBLISHES content + a map)
pnpm world:quests                   # 20 quests + repairs P11's 8 (PUBLISHES content)
```
