# Changelog — Dawned-Admin

All notable changes to the admin panel. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track the game's release trains (0.1.0 = tooling that shipped Dawned 0.1.0).

## [Unreleased]

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

### Notes
- No code yet by design — implementation starts at A0 once the game repo's P1 delivers the shared
  schema package.
