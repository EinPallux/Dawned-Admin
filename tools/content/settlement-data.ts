/**
 * The five settlements (game WORLD.md §2–§3, P12-B).
 *
 * Each one is two things that have to agree: a **plateau** in the terrain
 * synthesis, so there is buildable ground, and a **layout** of buildings placed
 * on it. They live in one file because a settlement moved in one and not the
 * other is a village sliding down a hillside, and nothing would catch it but
 * walking there.
 *
 * Layouts are authored in LOCAL metres — x east, z south from the settlement's
 * own centre — and rotated into the world by the settlement's `facing`. That is
 * what lets Dawnhaven face its harbour and Rustpick face its cliff without
 * either layout being re-typed in world coordinates.
 *
 * Nothing here says where an NPC stands or what a vendor sells; that is P12-F.
 * This is the town, empty.
 */

import type { IslandMask } from '../../src/shared-ext/terrain-synth.js';

/** A building on a settlement's plateau, in local metres. */
export interface Building {
  /** Baked model, without the `world_buildings_` prefix. */
  readonly model: string;
  /** East (+) / west (−) of the settlement centre. */
  readonly dx: number;
  /** South (+) / north (−) of the settlement centre. */
  readonly dz: number;
  /** Yaw in radians, before the settlement's own facing is added. */
  readonly yaw?: number;
  readonly scale?: number;
  /**
   * Footprint radius the walkgrid stamps unwalkable. A building you can walk
   * through is a building nobody believes in; a radius that is too big walls
   * off the square. These are eyeballed from the models' own footprints and are
   * the first thing to adjust if a settlement feels like a maze.
   */
  readonly blockRadius: number;
}

export interface Settlement {
  readonly id: string;
  readonly name: string;
  readonly zoneId: string;
  readonly x: number;
  readonly z: number;
  /** Rotates the whole layout, radians. */
  readonly facing: number;
  /** Ground height the plateau levels to. */
  readonly groundY: number;
  /** Plateau radius, metres — the flat core is 55 % of this. */
  readonly radius: number;
  readonly buildings: readonly Building[];
}

/**
 * WORLD.md §3.1: "the first hour is sacred". Dawnhaven is a harbour village on
 * a low shoulder above the spawn beach — hall at the back, houses down both
 * sides of one street, market and port toward the water, temple off to one side
 * as the respawn anchor. One street, because a new player should never have to
 * ask which way the town goes.
 */
const DAWNHAVEN: Settlement = {
  id: 'dawnhaven',
  name: 'Dawnhaven',
  zoneId: 'dawnshore',
  x: -470,
  z: 470,
  facing: -0.35,
  groundY: 13,
  // 160, not 105: the flat core is 55 % of the radius, so a 105 m shelf left
  // the port (62 m out) and the jetty on a 37° slope. The jetty is SUPPOSED to
  // run down into the water; the harbour building is not.
  radius: 160,
  buildings: [
    { model: 'towncenter_firstage_level2', dx: 0, dz: -44, yaw: 0, blockRadius: 11 },
    { model: 'houses_firstage_1_level2', dx: -26, dz: -16, yaw: Math.PI / 2, blockRadius: 6 },
    { model: 'houses_firstage_2_level1', dx: -27, dz: 6, yaw: Math.PI / 2, blockRadius: 6 },
    { model: 'houses_firstage_3_level1', dx: -25, dz: 28, yaw: Math.PI / 2, blockRadius: 6 },
    { model: 'houses_firstage_1_level2', dx: 26, dz: -12, yaw: -Math.PI / 2, blockRadius: 6 },
    { model: 'houses_firstage_3_level1', dx: 27, dz: 12, yaw: -Math.PI / 2, blockRadius: 6 },
    { model: 'storage_firstage_level1', dx: 28, dz: 36, yaw: -Math.PI / 2, blockRadius: 7 },
    { model: 'market_firstage_level2', dx: -2, dz: 22, yaw: Math.PI, blockRadius: 9 },
    { model: 'temple_firstage_level1', dx: -44, dz: -34, yaw: 0.4, blockRadius: 8 },
    // Toward the water: the port building, then the jetty out past the shore.
    { model: 'port_firstage_level2', dx: 8, dz: 62, yaw: Math.PI, blockRadius: 10 },
    { model: 'dock_firstage', dx: 8, dz: 84, yaw: Math.PI, blockRadius: 0 },
  ],
};

/** §3.2: a small forest village, the tower house visible over the canopy. */
const MOSSHOLLOW: Settlement = {
  id: 'mosshollow',
  name: 'Mosshollow',
  zoneId: 'verdant_weald',
  x: -560,
  z: -60,
  facing: 0.9,
  groundY: 34,
  radius: 72,
  buildings: [
    { model: 'towerhouse_firstage', dx: 0, dz: -20, yaw: 0.2, blockRadius: 7 },
    { model: 'houses_firstage_2_level1', dx: -22, dz: 4, yaw: 1.2, blockRadius: 6 },
    { model: 'houses_firstage_3_level1', dx: 20, dz: 8, yaw: -1.1, blockRadius: 6 },
    { model: 'houses_firstage_1_level2', dx: -6, dz: 26, yaw: Math.PI, blockRadius: 6 },
    { model: 'storage_firstage_level1', dx: 24, dz: -14, yaw: -0.6, blockRadius: 7 },
    { model: 'logs', dx: -26, dz: -22, yaw: 0.5, blockRadius: 3 },
  ],
};

/**
 * §3.3: Cinderfall is a camp in a ruined plaza, not a town. SecondAge stone —
 * the old kingdom built here and left. The wall runs are deliberately broken
 * (gaps between segments) rather than a closed ring: a ruin that still keeps
 * everything out is a fortress.
 */
const CINDERFALL: Settlement = {
  id: 'cinderfall',
  name: 'Cinderfall',
  zoneId: 'emberwood',
  x: -300,
  z: -540,
  facing: 0.38,
  groundY: 40,
  radius: 84,
  buildings: [
    { model: 'houses_secondage_1_level1', dx: -14, dz: -22, yaw: 0.1, blockRadius: 7 },
    { model: 'houses_secondage_1_level1', dx: 18, dz: -16, yaw: -0.3, scale: 0.9, blockRadius: 7 },
    { model: 'walltowers_secondage', dx: -34, dz: 10, yaw: 0.6, blockRadius: 6 },
    { model: 'walltowers_secondage', dx: 36, dz: 18, yaw: -0.8, scale: 0.85, blockRadius: 6 },
    { model: 'wall_secondage', dx: -18, dz: 30, yaw: 0.15, blockRadius: 4 },
    { model: 'wall_secondage', dx: 12, dz: 33, yaw: -0.1, blockRadius: 4 },
    { model: 'storage_secondage_level1', dx: 2, dz: 6, yaw: Math.PI, blockRadius: 8 },
  ],
};

/** §3.4: a palisade outpost on open plains — gate, tower, barracks, farm. */
const SUNWATCH: Settlement = {
  id: 'sunwatch',
  name: 'Sunwatch',
  zoneId: 'sungraze',
  x: 300,
  z: -170,
  facing: -0.12,
  groundY: 22,
  // 140: the windmill and the wheat farm stand 62–66 m out, deliberately
  // outside the palisade, and a 92 m shelf put them on a 44° hillside.
  radius: 140,
  buildings: [
    { model: 'watchtower_firstage_level2', dx: 0, dz: -26, yaw: 0, blockRadius: 6 },
    { model: 'barracks_firstage_level1', dx: -24, dz: 0, yaw: Math.PI / 2, blockRadius: 8 },
    { model: 'storage_firstage_level1', dx: 24, dz: 2, yaw: -Math.PI / 2, blockRadius: 7 },
    { model: 'walltowers_door_firstage', dx: 0, dz: 40, yaw: 0, blockRadius: 6 },
    { model: 'wall_firstage', dx: -22, dz: 40, yaw: 0, blockRadius: 4 },
    { model: 'wall_firstage', dx: 22, dz: 40, yaw: 0, blockRadius: 4 },
    { model: 'wall_firstage', dx: -40, dz: 22, yaw: Math.PI / 2, blockRadius: 4 },
    { model: 'wall_firstage', dx: 40, dz: 22, yaw: Math.PI / 2, blockRadius: 4 },
    // Outside the palisade — the farmsteads §3.4 wants, standing in the open.
    { model: 'windmill_firstage', dx: -66, dz: -34, yaw: 0.4, blockRadius: 7 },
    { model: 'farm_firstage_level2_wheat', dx: 62, dz: -30, yaw: -0.3, blockRadius: 9 },
  ],
};

/** §3.5: a mining camp clinging to a cliff — mine mouth, ore store, timber. */
const RUSTPICK: Settlement = {
  id: 'rustpick',
  name: 'Rustpick Camp',
  zoneId: 'ashcrag',
  x: 520,
  z: -620,
  facing: 0.45,
  groundY: 62,
  radius: 74,
  buildings: [
    { model: 'mine', dx: 0, dz: -24, yaw: 0, blockRadius: 9 },
    { model: 'storage_secondage_level1', dx: -22, dz: 8, yaw: 0.8, blockRadius: 8 },
    { model: 'houses_firstage_2_level1', dx: 22, dz: 4, yaw: -0.9, blockRadius: 6 },
    { model: 'houses_firstage_3_level1', dx: 8, dz: 26, yaw: Math.PI, scale: 0.9, blockRadius: 6 },
    { model: 'logs', dx: -20, dz: -18, yaw: 0.3, blockRadius: 3 },
    { model: 'logs', dx: -14, dz: 30, yaw: -0.5, blockRadius: 3 },
  ],
};

export const SETTLEMENTS: readonly Settlement[] = [
  DAWNHAVEN,
  MOSSHOLLOW,
  CINDERFALL,
  SUNWATCH,
  RUSTPICK,
];

/**
 * Each settlement's plateau, for the terrain pass.
 *
 * The plateau is drawn WIDER than the buildings reach — the widest offset in
 * Dawnhaven is the jetty at 84 m and its radius is 105 — because the flat core
 * is only 55 % of the radius and a house on the easing slope is a house on a
 * slope. `roughness` breaks the outline so a settlement is not a visible disc
 * from a hilltop.
 */
export const SETTLEMENT_PLATEAUS: IslandMask[] = SETTLEMENTS.map((town, i) => ({
  id: `plateau_${town.id}`,
  kind: 'plateau',
  seed: 5100 + i,
  centerX: town.x,
  centerZ: town.z,
  radius: town.radius,
  peak: town.groundY,
  roughness: 0.45,
  stretchX: 1,
  stretchZ: 1,
  rotation: town.facing,
}));

/** A building's world position, with the settlement's facing applied. */
export const buildingWorldPos = (
  town: Settlement,
  building: Building,
): { x: number; z: number; yaw: number } => {
  const cos = Math.cos(town.facing);
  const sin = Math.sin(town.facing);
  return {
    x: town.x + building.dx * cos - building.dz * sin,
    z: town.z + building.dx * sin + building.dz * cos,
    yaw: (building.yaw ?? 0) + town.facing,
  };
};

/**
 * The nine Ancient Shrines (CONTENT_0.1 §1: one per settlement plus one extra
 * per larger zone).
 *
 * A shrine is the respawn anchor and a fast-travel node, so its placement is a
 * gameplay decision rather than dressing: the extras sit where a death is
 * likely and a walk back would be long — the far side of a zone from its
 * settlement. `travelCost` is not authored; the game charges
 * `fastTravelCost(distance)` and the panel's Travel card previews the same
 * number (game `formulas/travel.ts`).
 */
export interface ShrineSpot {
  readonly id: string;
  readonly name: string;
  /** Settlement id when it stands in one, else null. */
  readonly town: string | null;
  readonly x: number;
  readonly z: number;
  readonly rotation: number;
}

export const SHRINES: readonly ShrineSpot[] = [
  // One per settlement. Offsets put them on the square rather than inside a
  // building — checked against each layout's own footprints.
  {
    id: 'shrine_dawnhaven',
    name: 'Dawnhaven Shrine',
    town: 'dawnhaven',
    x: -516,
    z: 440,
    rotation: 0.4,
  },
  {
    id: 'shrine_mosshollow',
    name: 'Mosshollow Shrine',
    town: 'mosshollow',
    x: -531,
    z: -84,
    rotation: 0.9,
  },
  {
    id: 'shrine_cinderfall',
    name: 'Cinderfall Shrine',
    town: 'cinderfall',
    x: -270,
    z: -562,
    rotation: 0.4,
  },
  {
    id: 'shrine_sunwatch',
    name: 'Sunwatch Shrine',
    town: 'sunwatch',
    x: 336,
    z: -186,
    rotation: -0.1,
  },
  {
    id: 'shrine_rustpick',
    name: 'Rustpick Shrine',
    town: 'rustpick',
    x: 548,
    z: -640,
    rotation: 0.5,
  },
  // The four extras, each a long walk from its own settlement.
  {
    id: 'shrine_gullspit',
    name: 'The Gullspit Stone',
    town: null,
    x: -300,
    z: 700,
    rotation: -0.3,
  },
  {
    id: 'shrine_weald_deep',
    name: 'The Deep Weald Stone',
    town: null,
    x: -760,
    z: -230,
    rotation: 0.7,
  },
  // Moved twice. At (−80, −700) it stood in the Emberwood/Sungraze channel
  // (−8 m of ocean floor); at (−140, −690) it was still on the waterline at
  // −0.9 m. It is on Emberwood proper now, ~290 m north of Cinderfall — which
  // is what an EXTRA shrine is for: the far side of a zone from its town.
  {
    id: 'shrine_ember_reach',
    name: 'The Ember Reach Stone',
    town: null,
    x: -330,
    z: -830,
    rotation: 0.2,
  },
  {
    id: 'shrine_sungraze_east',
    name: 'The Sunward Stone',
    town: null,
    x: 640,
    z: -110,
    rotation: -0.5,
  },
];

/**
 * Plank dressing along each causeway.
 *
 * The deck is terrain (Q30) — this is what makes it READ as a bridge rather
 * than as a suspiciously straight isthmus. Dock sections are laid end to end
 * along the crossing, and they are deliberately NOT solid: the walkgrid already
 * gets its answer from the ground, and stamping a plank unwalkable would block
 * the very crossing it decorates.
 */
export interface BridgeDressing {
  readonly bridgeId: string;
  readonly name: string;
  /** How many dock sections to lay, centred on the crossing. */
  readonly sections: number;
  /** Metres between sections along the deck. */
  readonly spacing: number;
}

export const BRIDGE_DRESSING: readonly BridgeDressing[] = [
  { bridgeId: 'bridge_shore_weald', name: 'The Shorecross', sections: 9, spacing: 22 },
  { bridgeId: 'bridge_weald_ember', name: 'The Deepwood Span', sections: 9, spacing: 22 },
  { bridgeId: 'bridge_ember_sungraze', name: 'The Ashen Crossing', sections: 9, spacing: 22 },
  { bridgeId: 'bridge_sungraze_ashcrag', name: 'The Rustpick Span', sections: 8, spacing: 22 },
];
