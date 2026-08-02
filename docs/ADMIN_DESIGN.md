# Dawned-Admin — Product & UX Specification

> The admin panel is a **professional tool**: dense, fast, keyboard-friendly, impossible to break
> the game with by accident. It should feel like a well-made level editor / ops console, not a
> website. Users: the owner + a couple of trusted GMs/devs (accounts with `gm`/`admin` roles from
> the game DB — `gm` gets Live Ops read + moderation; `admin` gets everything).

## 1. UX Principles

1. **Never lose work:** every editor autosaves drafts (2 s debounce) with per-entity dirty
   markers; leaving a dirty view warns; crash recovery restores drafts.
2. **The game is never edited live by accident:** all changes are drafts until an explicit
   **Publish** (with validation + diff review). Live Ops actions (kick/ban/announce) are clearly
   visually separated (red-accent zone) and confirm-gated.
3. **Everything is findable in ≤2 actions:** global command palette (`Ctrl+K`: entities by name/id,
   panel navigation, actions) + per-module search-as-you-filter tables.
4. **Validation is guidance, not punishment:** inline field errors as you type (zod messages),
   cross-reference problems listed in the publish dialog with click-to-jump.
5. **Dense but calm:** compact rows, tabular numerals, generous alignment; no dashboards of vanity
   charts — every number shown is actionable.
6. **Keyboard-first:** table nav (↑↓, Enter to open), form submit (Ctrl+S = save draft), editor
   tool shortcuts (Map Editor has a full keymap), palette everywhere.

## 2. Design System — "Workshop"

Shares Dawned's anti-slop DNA (no serifs, no rounded-blob pills) but optimized for hours of tool
use, not fantasy immersion:

- **Theme:** dark-first (`#14161B` bg, `#1C1F26` panels, `#262B35` raised), 1 px hairline borders
  (`#333A47`), gold accent reserved for _publish/live_ actions (`#C9A34E`), blue for selection
  (`#3E8FE8`), red zone for destructive/live (`#D8453A`). Light theme: post-0.1 backlog.
- **Type:** Inter (UI) + JetBrains Mono (ids, coordinates, JSON). 13 px base, 12 px tables.
- **Corners:** 2 px radius max (flat professional), the game's 45° corner-cut motif appears only
  on the app logo/header — tools stay neutral.
- **Components:** data table (virtualized, sortable, column picker, csv export), schema-form
  (generated from zod: text/number/slider/select/slug/icon-picker/entity-ref/JSON-fallback),
  entity-ref input (typeahead with thumbnail + "open in editor" chip), diff viewer (side-by-side
  for publish review), toasts, modals, split panes (resizable, persisted), inspector sidebar
  pattern (list → selection → right-side inspector everywhere).

## 3. App Shell & Navigation

```
┌ Top bar: Dawned-Admin ▸ [env badge: PRODUCTION] · publish status · Ctrl+K · user ┐
│ Left rail (icons+labels):                                                        │
│  ▦ Dashboard   🗺 Map Editor   🗃 Content ▾ (Items, Enemies, Abilities, Skill    │
│  Nodes, Loot Tables, Vendors, NPCs, Zones*, XP & Curves, World Settings)         │
│  📜 Quests   📡 Live Ops ▾ (Players, Moderation, Server, Audit Log, Backups)     │
│  ⚙ Admin ▾ (Accounts & Roles, Publish History, Panel Settings)                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

*Zones are edited spatially in the Map Editor; the Content list view offers the non-spatial fields.
Every module deep-links (`/content/items/item_weapon_sword_emberbrand`) — shareable in Discord.

**Dashboard (home):** server card (up/down, uptime, players online with names, tick p95 sparkline
last hour, RAM), publish card (active content version, last publish, drafts pending count →
publish flow), backups card (last nightly, size, verify status), recent audit trail (10 rows),
quick actions (Announce, Reload Content, Open Map).

## 4. The Publish Flow (shared by all editors — the panel's spine)

1. Badge shows `n drafts pending` → opens **Publish Review**.
2. Validation runs (zod + cross-refs + map bake dry-run): errors block, warnings listed
   (e.g. "item has no loot table referencing it").
3. Diff review: changed entities grouped by type, side-by-side field diffs; map changes show
   affected chunks on a mini-map + placement counts.
4. Confirm → server bakes artifacts, bumps `content_publishes`, notifies game server;
   result toast reports what hot-reloaded vs. what wants a restart (with a "restart at next empty
   moment" scheduling option).
5. **Publish History** view: versions, notes, who, revert (re-activate a previous version — the
   safe rollback path).

## 5. Live Ops Module

- **Players:** online table (name, account, class, level, zone, position with "show on map",
  session length, violation counters) → inspector: character sheet, inventory (view + audited
  grant/remove), quests, teleport-to/bring actions (routed via ops API as GM commands), kick.
  Offline search across all characters/accounts.
- **Moderation:** bans/mutes list (active + history), create ban (account picker, duration,
  reason), password reset (sets must-change flag), role management (admin-only, loud audit).
- **Server:** metrics charts (tick p50/p95, entities, players, net out, RSS — from
  `metrics_snapshots` + live ring), log tail (journald via ops API, filterable by level),
  announce composer (with optional countdown), content reload button, `xpRate` event scheduler.
- **Audit Log:** every GM command + admin action, filter by actor/action/target/date, export.
- **Backups:** nightly list with sizes + verify results, "run backup now", restore instructions
  link (restores stay CLI-only on purpose — see game repo DEPLOYMENT.md).

## 6. Asset Browser (shared service, used by Map Editor + icon/model pickers)

Grid of all pipeline-known assets: thumbnail (generated), name, pack, tags, tri-count, license
badge; filter by category/pack/tag; detail = 3D preview orbit (three.js), collider view toggle,
"used in n placements" back-references. Missing-license assets show a red badge (and are
unplaceable — the ledger rule enforced visually).

## 7. Error/Empty/Loading States

Every table/form/view designs its empty state (helpful: "No loot tables yet — create one or
duplicate a template"), its loading skeleton, and its error state (with retry + copyable error
id). The panel must feel _reliable_ — it's the owner's daily driver for years.
