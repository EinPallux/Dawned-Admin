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

## 7. Publish Semantics (per content type)

| Type                                                                                          | Hot-reloadable?                                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Item/ability/node/enemy _numbers_, loot, vendors, curves, world settings, dialogue/quest text | ✅ live (`/ops/reload-content`)                                                                                            |
| New entities (items, enemies, quests…)                                                        | ✅ live (clients fetch bundle on hash change)                                                                              |
| Enemy model/archetype swaps, zone ambience                                                    | ✅ live (clients apply next zone-load; note shown)                                                                         |
| Map bakes (terrain/placements/spawners/walkgrid)                                              | ⚠ staged: live chunk-swap where safe, else "applies on restart" (publish dialog states which, per game ARCHITECTURE.md §5) |
| Schema migrations                                                                             | ❌ deploy path (UPDATE.sh), by design                                                                                      |
