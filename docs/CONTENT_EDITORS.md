# Dawned-Admin — Content & Quest Editors

> Every database-driven piece of Dawned gets a real editor: schema-driven forms (generated from
> the shared zod schemas), draft/publish, duplication, search, and per-type helpers that make
> authoring _pleasant_. Data contracts: game repo `docs/tech/DATABASE.md` §3; design sources in
> game `docs/design/*`.

## 1. Shared Editor Framework

- **List views:** virtualized tables per content type — columns: id, name, key fields, status
  (draft-dirty dot), updated by/at; filter bar + saved filters; bulk actions (duplicate, export
  JSON, delete-with-usage-check).
- **Detail views:** schema-form from zod (right rail: usage back-references — "dropped by 3
  enemies, sold by 1 vendor, reward in 2 quests" with jump links); every entity: Duplicate ("copy
  of" flow with new slug), History (draft revisions, restore), Delete (blocked while referenced —
  the check lists blockers).
- **Slug discipline:** id fields auto-suggest from name (`item_weapon_sword_emberbrand`),
  immutable after first publish (rename = display name only) — referential sanity forever.
- **Suggest buttons:** numeric fields with design-curve defaults (item budgets, enemy HP/dmg at
  level, XP values) show a ƒ button that fills the formula value (game design docs' curves) — the
  designer can then deviate consciously. Deviation >±40% shows a gentle amber hint, never a block.
- **Import/export:** JSON export/import per entity or filtered set (backup, bulk edits, sharing).

> **As built (A1-c, 2026-08-04 — items, loot, vendors):** Content → Items ships the three
> editors on one publish rail as tabs over a shared-schema JSON editor (the same surface
> Abilities and Progression use), plus the per-type helpers that change what the owner can
> SEE: the item budget meter with ƒ-suggest (value, weapon band, proportional stat rescale)
> and a live duplicate-icon warning; the loot roll simulator (1 000 seeded rolls through the
> shared roller, killer level + rolls-per-kill adjustable, `nothing` shown as its own share);
> and the vendor price preview computed with the shared value/sell formulas. Publish
> cross-checks icon uniqueness, ref resolution (items, nested tables, vendor stock, and the
> tables live enemies still roll) and loot cycles; budget deviations are advisory warnings.
> Still to come with the shared framework: the searchable icon browser and in-hand 3D preview,
> the tier-series wizard, row-builder forms over the JSON, usage back-references, import/export
> and history/revert.

## 2. Item Editor

Form: category/slot/rarity/ilvl/class-lock/stack/value + stats builder (attribute rows vs. the
budget meter — a live bar showing spent vs. `statBudget` from the formula, over-budget = amber),
weapon damage block (auto min/max from avg±12%), effect picker (Epic+ minor effects from the
effects registry), flavor text, **icon picker** (searchable game-icons browser with the themed
recolor preview + "used by" duplicate warning — uniqueness enforced at publish), model ref picker
(weapons/offhands: asset browser filtered to weapon bits; live 3D preview in-hand on a mannequin).
Helpers: "create tier series" wizard (T1–T5 variants from a base), vendor-price preview, loot
appearance list.

## 3. Enemy Editor

Form: name/archetype/level band/rank/model (asset picker with anim-set validation — model must
carry the archetype's required clips; mismatches listed), scale/tint, stat overrides vs. ƒ curve,
aggro/leash radii, social tag, XP mult, gold range, **ability kit builder** (rows: ability,
weight, cooldown, range window, HP-threshold phase gating — with a readable "rotation preview"
timeline), loot table ref (+ inline create), telegraph preview thumbnails per ability.
Helper: "solo TTK calculator" — given a class/level per game formulas, shows estimated
time-to-kill both directions vs. the COMBAT.md targets (the balance sanity tool).

## 4. Ability & Skill Node Editors

- Ability editor: full COMBAT.md §4 field set grouped (cost/timing/targeting/effects/anim-vfx-sfx
  refs with existence validation); effect list builder with typed params; "tooltip preview"
  renders the player-facing tooltip from the description template + numbers live.
- Skill node editor: class/branch/tier/ranks/effect (stat-mod or ability-mod picker), requires;
  **tree preview** renders the lattice exactly as in-game with the node highlighted.
- Guardrail: abilities/nodes referenced by characters can be edited but not deleted; numeric
  changes hot-reload (the live-tuning loop used from game phase P5 on).

## 5. Loot, Vendor, XP/Curve, Zone, NPC, World-Settings Editors

- **Loot tables:** entry rows (item/table/gold, weight, qty, conditions) with nesting breadcrumbs
  - cycle detection + **roll simulator** (1k/10k rolls → distribution table with rarity coloring —
    the "does this feel right" tool).
- **Vendors:** stock rows with price-override and barter builder; per-settlement assignment view.
- **XP & curves:** editable tables (level rows) with chart preview + "playtime estimate" hint
  (kills+quests model); profession curves alongside.
- **Zones (non-spatial fields):** ambience profile editor with color pickers, music/sfx set
  dropdowns and weather probability sliders (clear/overcast/rain/storm weights per WORLD.md §4.6;
  spatial editing lives in the Map Editor; both views deep-link at each other).
- **NPCs:** identity/model/role bindings (vendor/quest refs), dialogue set editor (see §6 quest
  dialogue component — shared), routine summary (waypoints edited spatially in Map Editor).
- **World settings:** typed key/value list (xpRate, inviteCode, motd, dayNightEnabled…) with
  per-key descriptions and hot-reload badges.

## 6. Quest Editor (the second flagship)

- **Structure canvas:** vertical step list (drag-reorder) — each step a card: type
  (KILL/COLLECT/DELIVER/TALK/EXPLORE/INTERACT/USE_AT), typed params via entity-ref pickers,
  tracker text with live counter preview, optional map-hint circle (mini-map picker), on-complete
  hooks (dropdown per whitelisted hook + params).
- **Dialogue editor:** per-quest (and per-NPC ambient) node list — speaker, text (with typewriter
  preview + length lint at 220 chars), choice chips (accept/decline/flavor), emote picker (UAL
  clip dropdown with thumbnail loop preview).
- **Metadata:** giver picker (NPC/object/board with "place in Map Editor" jump), zone, suggested
  level, prerequisites (level/quests/discoveries), rewards builder (xp ƒ-suggest, gold, item
  picker incl. class-choice rewards, title).
- **Journal preview:** renders the in-game journal entry (found-voice prose field encouraged with
  a writing-tip placeholder).
- **Flow validation:** unreachable steps, missing turn-in, reward-less warning, chain-link view
  (what unlocks what) as a mini graph, "quest-line playthrough estimate" (sum of travel + kill
  targets vs suggested level).
- **Test hook:** "grant to my GM character at step n" button (via ops API) — author → test in
  seconds (used heavily in game P11).

### 6.1 As built (A4, 2026-08-05)

Quests and NPCs share **one publish rail** — they reference each other, so publishing them apart
would guarantee a window where a live quest points at an NPC that is not there yet. Publish runs
the GAME's `validateQuestFlow` (never a copy — a quest this page calls valid and the server
refuses to load would fail at the next server BOOT rather than at the button), then the
cross-checks a single row cannot make: every NPC, item, enemy and prerequisite a quest names has
to be in the would-be-published set. Advisory, never blocking: a quest that pays nothing, a chain
link nothing unlocks, a quest giver no quest names, and a `zoneId` naming no zone the map carries.

The **chain graph is built from `prerequisites`, not from `chainId`** — the id is a label the
journal groups by, the prerequisites are what the game gates on, and drawing the label would draw
a graph the game disagrees with. Same reason the Enemies page's TTK simulator runs
`selectableEnemyAbilities` instead of re-implementing selection.

Deferred, deliberately, to when someone wants them rather than up front: drag-reorder of steps
(the list is JSON-over-schema, which reorders fine), the typewriter preview and 220-char lint,
the emote thumbnail loop, and the playthrough estimate. The step list, dialogue nodes, metadata,
rewards ƒ-suggests, journal preview, flow validation and the test hook are all live.

**One thing the game's P11-C run proved about NPCs specifically:** an NPC has **no `modelRef`**.
A character in this game is composed — base body + outfit + hair on one skeleton — so a villager
carries an `appearance` exactly like a player, which is also how they get the whole UAL clip
library for free. The map editor briefly held its own guess at this row and refused the real one;
see MAP_EDITOR §5.1.

## 7. Publish Semantics (per content type)

| Type                                                                                          | Hot-reloadable?                                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Item/ability/node/enemy _numbers_, loot, vendors, curves, world settings, dialogue/quest text | ✅ live (`/ops/reload-content`)                                                                                            |
| New entities (items, enemies, quests…)                                                        | ✅ live (clients fetch bundle on hash change)                                                                              |
| Enemy model/archetype swaps, zone ambience                                                    | ✅ live (clients apply next zone-load; note shown)                                                                         |
| Map bakes (terrain/placements/spawners/walkgrid)                                              | ⚠ staged: live chunk-swap where safe, else "applies on restart" (publish dialog states which, per game ARCHITECTURE.md §5) |
| Schema migrations                                                                             | ❌ deploy path (UPDATE.sh), by design                                                                                      |

## 8. As-built status (A1 rolls out editor-by-editor)

Editors land alongside the game phase that consumes them; this section tracks what exists
versus the spec above.

- **Abilities (2026-08-03, game P5/P6):** shipped per §4's core — class-grouped list with
  draft dots, quick tuning fields over the full shared-schema-validated JSON def, Ctrl+S
  drafts with prune-on-match, publish v1 with slot-collision cross-check + hot reload. All 44
  live ability rows went through it. Tooltip preview and ref-existence validation are still
  ahead (they need the P8+ registries).
- **Progression (2026-08-04, game P7):** Content → Progression with two tabs. _Skill trees_:
  class picker + three branch columns laid out by tier with capstone marking and draft dots;
  the selected node edits as shared-schema-validated JSON (`skillNodeDefSchema`) with the
  node's gate shown; per-node discard. _XP curve_: the 29-level table with editable
  `xpToNext`, precomputed cumulative column, the design-formula reference value (ƒ per §1)
  and a one-click reset-to-formula per row. One publish rail covers both tables with the
  progression cross-checks (curve completeness, node ability-refs against published
  abilities, branch cell collisions, one capstone per branch) and ends in the same hot
  reload. The §4 lattice "tree preview" upgrades when the game client's tree UI (P7-D)
  settles the visual language.
- **Items / Loot / Vendors (2026-08-04, game P8):** three tabs on one publish rail, per §2 and
  §5. Items carry a budget meter against the shared ITEMS_LOOT §2 formulas with ƒ-suggests for
  value, weapon band and stat rescale, plus a live duplicate-icon warning; loot tables get a
  1 000-roll simulator driven through the SAME shared roller the server drops with (killer
  level and rolls-per-kill adjustable, `nothing` shown as its own share); vendors price their
  stock off the shared value/sell formulas. Publish cross-checks icon uniqueness, item/table/
  vendor ref resolution, loot cycles and the tables live enemies still roll; budget deviations
  are advisory warnings, not blocks.
- **Enemies + Spawners (2026-08-04, game P9):** §3's editor, both tables on one rail because a
  spawner without its enemy is a camp that silently never populates. Level-banded bestiary with
  rank badges, and the **time-to-kill simulator** running the game's own
  `selectableEnemyAbilities` — so the rotation previewed is the rotation fought. It answers both
  directions of the trade, hides abilities unusable at the tested range, sees a boss's whole
  unlocked kit rather than phase 0, and names the COMBAT.md §12 60–120 s window when a fight
  misses it. Publish blocks on unresolvable spawner refs and unpublished loot; judgement calls
  (a boss with no phases, a `ranged` row with nothing ranged) warn.
- **Professions / resource nodes (2026-08-05, game P10):** Content → Professions edits
  `content_resource_nodes` — what a birch, a vein, a herb patch or a shoal IS. The
  definition/placement split matches enemies/spawners: this page owns definitions, the map
  editor's `node` layer owns where they stand, and the two resolve against each other at
  publish. The list groups by profession with tier and gate badges; the def edits as
  shared-schema-validated JSON (`resourceNodeDefSchema`) with Ctrl+S and prune-on-match.
  The **gathering preview** is the point of the page: 1 000 rolls through the game's own
  `rollGather` at a chosen profession level, reporting the hold time, profession XP (including
  §1.3's back-country halving), proc chance, expected items per 100 gathers with names resolved
  against the published catalogue, one node's yield per hour off its own channel+respawn cycle,
  and how many gathers of it walk the profession from this tier's gate to the next. It takes the
  def from the EDITOR BUFFER rather than the saved row, so a tuning loop never lies for one
  save. Fishing nodes get an extra block: each catch with the bar difficulty its rarity buys
  (`fishingDifficulty`), because a legendary on a low-tier shoal is a fish nobody lands and that
  is invisible in the JSON. Publish blocks on a yield or proc whose item is not published and on
  a model that is not in the baked manifest (both are silent failures in the world — a gather
  that hands over nothing, a node standing invisible); a fishing spot with a depleted model
  warns. Node PLACEMENTS publish with the map, not here.
  Browser run: `node tools/smoke/professions-editor.mjs`.
