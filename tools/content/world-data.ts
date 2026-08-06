/**
 * The Dawnlands — the shape of the world, as data (game WORLD.md §1–§3, P12-A).
 *
 * This file is the archipelago's source of truth for TERRAIN: island masks,
 * the straits between them, zone rings and each zone's splat palette. It does
 * not place a single prop — that is P12-B onward. Keeping it separate means
 * "re-roll the world" and "re-dress the world" are different acts, which is
 * what makes the first one survivable.
 *
 * Coordinates: the world is 2048 m square, x from -1024 (west) to +1024 (east)
 * and z from -1024 (NORTH) to +1024 (south). Lower z is north — that is what
 * the shipped world already does, and re-deciding it now would silently rotate
 * every quest clue that says "north-west".
 *
 * The layout mirrors WORLD.md §1's diagram: progression runs counter-clockwise
 * from the south-western starter isle, each step further from spawn.
 *
 *        NW                    N                        NE
 *   [Elder Grove]      [Emberwood 12–18]        [Ashcrag 24–30]
 *    (hidden, 30+)      crimson forest            red mesas
 *                            |                        |
 *                            |    [Sungraze 18–24]----+
 *   [Verdant Weald 6–12]     +--------- golden plains
 *        deep forest
 *            |
 *   [Dawnshore 1–6] ← spawn, Dawnhaven
 *        SW
 */

import type { IslandMask, SplatRule } from '../../src/shared-ext/terrain-synth.js';
import type { Zone } from '@dawned/shared';

/** Sea level. The water plane sits at y = 0 and everything is measured from it. */
export const SEA_LEVEL = 0;

/**
 * The five isles plus the hidden grove.
 *
 * They are deliberately generous and OVERLAP: WORLD.md wants 55–60 % of the
 * world to be land, and six landmasses far enough apart to leave open water
 * between them cannot cover that much of a 2048 m box. So the isles merge and
 * the `STRAITS` below cut them apart again where a bridge should gate the path.
 */
export const ISLANDS: IslandMask[] = [
  {
    id: 'dawnshore',
    seed: 20250806,
    centerX: -540,
    centerZ: 560,
    radius: 470,
    peak: 34,
    roughness: 0.35,
    stretchX: 1.22,
    stretchZ: 0.98,
    rotation: 0.22,
  },
  {
    id: 'verdant_weald',
    seed: 20250807,
    centerX: -600,
    centerZ: -20,
    radius: 446,
    peak: 62,
    roughness: 0.52,
    stretchX: 1.05,
    stretchZ: 1.18,
    rotation: -0.28,
  },
  {
    id: 'emberwood',
    seed: 20250808,
    centerX: -300,
    centerZ: -570,
    radius: 434,
    peak: 70,
    roughness: 0.55,
    stretchX: 1.24,
    stretchZ: 0.96,
    rotation: 0.38,
  },
  {
    id: 'sungraze',
    seed: 20250809,
    centerX: 330,
    centerZ: -190,
    radius: 470,
    peak: 46,
    roughness: 0.4,
    stretchX: 1.18,
    stretchZ: 1.12,
    rotation: -0.12,
  },
  {
    id: 'ashcrag',
    seed: 20250810,
    centerX: 560,
    centerZ: -660,
    radius: 408,
    peak: 104,
    roughness: 0.74,
    stretchX: 1.0,
    stretchZ: 1.15,
    rotation: 0.45,
  },
  {
    // No bridge and no strait of its own: the Elder Grove is reached by a long
    // swim or the one-way Ashcrag portal (WORLD.md §3.6), so it simply stands
    // alone in open water.
    id: 'elder_grove',
    seed: 20250811,
    centerX: -880,
    centerZ: -800,
    radius: 186,
    peak: 44,
    roughness: 0.42,
    stretchX: 1.1,
    stretchZ: 0.92,
    rotation: 0.6,
  },
];

/**
 * The handful of islets WORLD.md §1 promises, and §2's "tiny sandbars with
 * chests" in the Dawnsea.
 *
 * They are low and small on purpose: a sandbar you can see the whole of from
 * the water is a destination, and one with a hill on it reads as a sixth zone
 * nobody wrote.
 *
 * Placing them is fiddlier than it looks and the preview is what makes it
 * tractable. An islet has two ways to stop being one, and both are silent in
 * the data: sitting inside a big isle's mask, where it is absorbed and becomes
 * a headland; and sitting inside a strait's carve, where a 7 m bar meets a 70 m
 * cut and simply is not there. The preview reports both — "under water" and
 * "shares it with" — so every one of these coordinates was checked rather than
 * reasoned about. They ALL moved at least once.
 */
export const ISLETS: IslandMask[] = [
  {
    // Out in the bay east of Dawnshore — the first thing a level-2 swims to.
    // It started tucked against the south beaches, where the shore's own mask
    // swallowed it whole.
    id: 'islet_gullspit',
    seed: 20250812,
    centerX: 430,
    centerZ: 640,
    radius: 118,
    peak: 9,
    roughness: 0.28,
    stretchX: 1.35,
    stretchZ: 0.8,
    rotation: -0.4,
  },
  {
    // The wreck sandbar in the open sea off Dawnshore's north-east cape.
    //
    // It was meant to be a rest stop mid-channel on the Dawnshore↔Weald swim
    // and it cannot be: carves apply after every land mask, so a bar in a
    // 76 m strait would have to be a 76 m mountain to break the surface. Two
    // attempts inside that channel both came back with zero land. It is out of
    // the channel now, which costs the "halfway house" beat and keeps the bar.
    id: 'islet_wreckbar',
    seed: 20250813,
    centerX: 610,
    centerZ: 650,
    radius: 92,
    peak: 7,
    roughness: 0.22,
    stretchX: 0.85,
    stretchZ: 1.3,
    rotation: 0.25,
  },
  {
    // East of Sungraze, in open water — the deep-sea fishing anchor.
    id: 'islet_saltrock',
    seed: 20250814,
    centerX: 850,
    centerZ: 400,
    radius: 132,
    peak: 22,
    roughness: 0.5,
    stretchX: 0.9,
    stretchZ: 1.25,
    rotation: 0.55,
  },
  {
    // §1's diagram puts a small islet in the NORTH. There is no north sea to
    // put it in: at 57 % land coverage Emberwood, Sungraze and Ashcrag fill
    // that third of the map between them, and three attempts up there came
    // back either absorbed into Ashcrag or cut in half by the Emberwood
    // channel. It sits in the southern Dawnsea instead — real open water, and
    // the deviation is recorded in WORLD.md rather than quietly dropped.
    id: 'islet_gullrest',
    seed: 20250815,
    centerX: 150,
    centerZ: 930,
    radius: 96,
    peak: 14,
    roughness: 0.34,
    stretchX: 1.2,
    stretchZ: 0.86,
    rotation: -0.2,
  },
];

const isle = (id: string): IslandMask => {
  const found = ISLANDS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no island named ${id}`);
  return found;
};

/**
 * A strait between two isles, with its geometry DERIVED rather than typed.
 *
 * The first version of this file typed each carve's centre, angle and length by
 * hand, and the world-preview's flood fill found the result: three of the five
 * channels severed nothing. One was rotated nearly perpendicular to where it
 * belonged, and every one of them was too short, so the isles simply joined
 * around the ends of the cut. A depth probe at each carve's own centre reported
 * "open water" for all five, which is true and completely beside the point.
 *
 * So a strait now computes what it must be from the two isles it separates:
 *
 *  • centred on the midpoint of their line of centres, offset by `bias` toward
 *    one of them when the join is not symmetric;
 *  • rotated PERPENDICULAR to that line, so its long axis lies along the join;
 *  • long enough to reach open water at both ends — the ends of a carve fade
 *    with the same `1 - d²` the domes rise with, so "as long as the join is
 *    wide" is not enough and it is scaled past both isles' radii;
 *  • deeper than the ground it crosses is tall, or it cuts a valley rather
 *    than a channel.
 *
 * Width stays generous: `terrain-synth.test.ts` pins bank steepness as depth
 * over half-width, and past 55° the banks are auto-unwalkable cliffs instead of
 * the beaches a swimmable strait needs.
 */
function strait(
  id: string,
  seed: number,
  fromId: string,
  toId: string,
  { width = 0.1, lengthScale = 1.0, bias = 0 } = {},
): IslandMask {
  const a = isle(fromId);
  const b = isle(toId);
  const mx = a.centerX + (b.centerX - a.centerX) * (0.5 + bias);
  const mz = a.centerZ + (b.centerZ - a.centerZ) * (0.5 + bias);
  const along = Math.atan2(b.centerZ - a.centerZ, b.centerX - a.centerX);
  const length = (a.radius + b.radius) * 0.95 * lengthScale;
  return {
    id,
    kind: 'carve',
    seed,
    centerX: Math.round(mx),
    centerZ: Math.round(mz),
    radius: Math.round(length),
    // Deep enough to cut the ground on the join and then some — a carve that
    // only just reaches sea level leaves a shoal you can walk across. Scaled
    // off the taller isle's PEAK, which is generous: where two domes overlap
    // each is already well down its own falloff, so the ground on a join is
    // roughly half either summit. Generous is right, but not unbounded: the
    // first version used ×1.5 + 24 and the five channels together ate fifteen
    // points of the world's land area.
    peak: Math.round(Math.max(a.peak, b.peak) * 0.9 + 20),
    roughness: 0.16,
    stretchX: 1.0,
    stretchZ: width,
    rotation: along + Math.PI / 2,
  };
}

/**
 * The four bridge crossings, plus the channel that keeps the Elder Grove an
 * island. WORLD.md §1: bridges gate the natural path, so each of these has to
 * actually sever — which the preview's flood fill is what proves.
 */
export const STRAITS: IslandMask[] = [
  strait('strait_shore_weald', 4101, 'dawnshore', 'verdant_weald', { lengthScale: 1.15 }),
  strait('strait_weald_ember', 4102, 'verdant_weald', 'emberwood', { lengthScale: 1.2 }),
  strait('strait_ember_sungraze', 4103, 'emberwood', 'sungraze', { lengthScale: 1.2 }),
  strait('strait_sungraze_ashcrag', 4104, 'sungraze', 'ashcrag', { lengthScale: 1.2 }),
  // The Grove needs TWO cuts, not one. It sits in the crook between the Weald
  // and Emberwood and touches both; severing it from the Weald alone left it
  // sharing a landmass with Emberwood, which the flood fill caught and a
  // "did the channel open?" check never would have. §3.6 says no bridge and no
  // map label — reachable only by a long swim or the one-way Ashcrag portal —
  // so it has to be an island from every direction.
  //
  // Both are biased toward the Grove: it is a small isle hanging off big
  // coastlines, so the midpoint of a centre line sits inland on the mainland
  // rather than in the water between them.
  strait('strait_grove_weald', 4105, 'elder_grove', 'verdant_weald', {
    lengthScale: 1.05,
    bias: -0.19,
    width: 0.14,
  }),
  strait('strait_grove_ember', 4106, 'elder_grove', 'emberwood', {
    lengthScale: 1.05,
    bias: -0.16,
    width: 0.14,
  }),
];

/**
 * Splat layers, fixed across the world because a chunk carries one 8-layer
 * weight map and the client binds one texture array (WORLD.md §6). Zones differ
 * by WHICH of the eight they use and where, not by having their own set.
 */
export const SPLAT = {
  SAND: 0,
  GRASS: 1,
  LUSH: 2,
  ROCK: 3,
  DIRT: 4,
  PATH: 5,
  REDLEAF: 6,
  ASH: 7,
};

/**
 * Zone rings, in the order the game tests them (first match wins).
 *
 * Every ring is its island's ellipse grown by `ZONE_MARGIN`. Land can never
 * reach past its own mask — the synthesis returns nothing at `d >= 1` — so a
 * ring drawn on the same ellipse already contains every metre of it, and the
 * margin is there to swallow the corner-cutting of a 24-gon and to reach out
 * over the water so a beach is never a hand's width outside its own zone.
 *
 * The islets are absorbed by whichever main ring is nearest rather than getting
 * rings of their own: they are places IN Dawnshore and the Dawnsea, not zones,
 * and a zone banner reading "Gullspit" every time you swim past would make the
 * §4.4 crossing beat meaningless.
 */
const ZONE_MARGIN = 1.09;

/**
 * A zone ring traced from its island's own mask.
 *
 * Typed separately, these drifted twice while the isles were being tuned — and
 * the failure is a publish that blocks on land in no zone, an hour after you
 * stopped thinking about terrain. Deriving them means an isle can be resized
 * and its zone follows.
 */
const ringOf = (id: string, steps = 28): [number, number][] => {
  const mask = isle(id);
  return ring(
    mask.centerX,
    mask.centerZ,
    mask.radius * ZONE_MARGIN,
    mask.stretchX ?? 1,
    mask.stretchZ ?? 1,
    mask.rotation ?? 0,
    steps,
  );
};

export const ZONE_RINGS = {
  dawnshore: ringOf('dawnshore'),
  verdant_weald: ringOf('verdant_weald'),
  emberwood: ringOf('emberwood'),
  sungraze: ringOf('sungraze'),
  ashcrag: ringOf('ashcrag'),
  elder_grove: ringOf('elder_grove', 20),
  // The Dawnsea is WORLD.md §2's own last table row: ocean, beaches, shallows
  // and the tiny sandbars with chests. It is a real zone rather than "outside
  // every polygon" for one hard reason — publish BLOCKS on land in no zone, and
  // the islets stand in open water that no isle's ring reaches. Listed last so
  // the six land zones win the first-match test; what is left over is sea.
  //
  // A RECTANGLE past the world bounds, not an ellipse: a circle big enough to
  // hold the map's corners does not fit in it, and the first attempt — r 1030 —
  // left a north-west islet 20 cm outside the ring and failed the publish gate.
  // The sea is "everywhere else", and everywhere else is a box.
  dawnsea: [
    [-1100, -1100],
    [1100, -1100],
    [1100, 1100],
    [-1100, 1100],
  ] as [number, number][],
};

/**
 * A closed ring of `steps` points around an ellipse.
 *
 * Zone polygons are drawn a little WIDER than their island's mask so the ring
 * reaches out over the water: publish blocks on land in no zone, and a shore
 * vertex sitting a metre outside its own zone is exactly the kind of thing that
 * fails a publish an hour after you stopped thinking about terrain.
 */
function ring(
  cx: number,
  cz: number,
  radius: number,
  stretchX: number,
  stretchZ: number,
  rotation: number,
  steps = 24,
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ex = Math.cos(a) * radius * stretchX;
    const ez = Math.sin(a) * radius * stretchZ;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    points.push([Math.round(cx + ex * cos - ez * sin), Math.round(cz + ex * sin + ez * cos)]);
  }
  return points;
}

/**
 * Each zone's palette, as splat rules scoped to its ring.
 *
 * The rules are read in order and the LAST match wins, so every list starts
 * with a full-coverage base and narrows: beach at the waterline, the zone's own
 * ground cover on the gentle middle, rock on anything steep, a highland accent
 * up top. A texel no rule claims is reported by the generator rather than left
 * at the unblended default, because an unpainted patch is invisible in the
 * editor and obvious in the game.
 */
const palette = (
  zoneId: string,
  ground: number,
  highland: number,
  steepLayer: number = SPLAT.ROCK,
): SplatRule[] => [
  { layer: SPLAT.SAND, minSlopeDeg: 0, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999, zoneId },
  { layer: ground, minSlopeDeg: 0, maxSlopeDeg: 30, minHeight: 2.5, maxHeight: 999, zoneId },
  { layer: SPLAT.DIRT, minSlopeDeg: 22, maxSlopeDeg: 34, minHeight: 2.5, maxHeight: 999, zoneId },
  { layer: steepLayer, minSlopeDeg: 34, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999, zoneId },
  { layer: highland, minSlopeDeg: 0, maxSlopeDeg: 26, minHeight: 34, maxHeight: 999, zoneId },
];

export const SPLAT_RULES: SplatRule[] = [
  // A world-wide base first, so a metre of coast that falls outside every ring
  // still gets sand rather than being reported unpainted.
  { layer: SPLAT.SAND, minSlopeDeg: 0, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
  { layer: SPLAT.GRASS, minSlopeDeg: 0, maxSlopeDeg: 30, minHeight: 2.5, maxHeight: 999 },
  { layer: SPLAT.ROCK, minSlopeDeg: 34, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
  // Then each zone paints its own.
  ...palette('dawnshore', SPLAT.GRASS, SPLAT.LUSH),
  ...palette('verdant_weald', SPLAT.LUSH, SPLAT.LUSH),
  ...palette('emberwood', SPLAT.REDLEAF, SPLAT.REDLEAF),
  ...palette('sungraze', SPLAT.DIRT, SPLAT.SAND),
  ...palette('ashcrag', SPLAT.ASH, SPLAT.ASH, SPLAT.ASH),
  ...palette('elder_grove', SPLAT.LUSH, SPLAT.LUSH),
  // The Dawnsea gets no palette of its own. Its ring exists so the sandbars
  // have a zone to stand in, and the world-wide base rules above — sand at the
  // waterline, grass on a gentle crown, rock where it is steep — are already
  // exactly what a sandbar looks like. A zoned rule here would be a rule that
  // repaints whichever isle the sea ring overlaps, since the last match wins.
];

/**
 * The six zones as published rows.
 *
 * Ambience is the whole reason a zone is felt rather than read: the client
 * blends fog, sky and light over 5 s on crossing (WORLD.md §4.4), so these
 * colours ARE the palettes of §2's table. Music and sfx are not here because
 * `zoneAmbienceSchema` has no field for them — that is the game repo's open
 * question Q26, whose recommended default is to add both with the audio phase.
 */
export const ZONES: Zone[] = [
  {
    id: 'dawnshore',
    name: 'Dawnshore',
    levelMin: 1,
    levelMax: 6,
    polygon: ZONE_RINGS.dawnshore,
    safe: false,
    settlement: 'Dawnhaven',
    ambience: {
      fogColor: '#cfe6f2',
      fogNear: 90,
      fogFar: 620,
      skyTop: '#4ea7e0',
      skyHorizon: '#ffe6bd',
      sunColor: '#fff2d4',
      sunIntensity: 2.1,
      hemiSky: '#bfe4ff',
      hemiGround: '#9ac479',
      hemiIntensity: 0.85,
    },
  },
  {
    id: 'verdant_weald',
    name: 'Verdant Weald',
    levelMin: 6,
    levelMax: 12,
    polygon: ZONE_RINGS.verdant_weald,
    safe: false,
    settlement: 'Mosshollow',
    ambience: {
      fogColor: '#2f5a44',
      fogNear: 40,
      fogFar: 340,
      skyTop: '#1f4d3e',
      skyHorizon: '#7fb08a',
      sunColor: '#d8f0c4',
      sunIntensity: 1.5,
      hemiSky: '#5f9d7c',
      hemiGround: '#2c4a2f',
      hemiIntensity: 0.7,
    },
  },
  {
    id: 'emberwood',
    name: 'Emberwood',
    levelMin: 12,
    levelMax: 18,
    polygon: ZONE_RINGS.emberwood,
    safe: false,
    settlement: 'Cinderfall',
    ambience: {
      fogColor: '#77402c',
      fogNear: 55,
      fogFar: 420,
      skyTop: '#8c3f22',
      skyHorizon: '#f0a75a',
      sunColor: '#ffd0a0',
      sunIntensity: 1.8,
      hemiSky: '#c96f3c',
      hemiGround: '#5a2c1c',
      hemiIntensity: 0.75,
    },
  },
  {
    id: 'sungraze',
    name: 'Sungraze Savanna',
    levelMin: 18,
    levelMax: 24,
    polygon: ZONE_RINGS.sungraze,
    safe: false,
    settlement: 'Sunwatch',
    ambience: {
      fogColor: '#e8d69a',
      fogNear: 140,
      fogFar: 900,
      skyTop: '#5fa8d8',
      skyHorizon: '#f7e2a8',
      sunColor: '#fff4c8',
      sunIntensity: 2.6,
      hemiSky: '#ffe9b0',
      hemiGround: '#b99a52',
      hemiIntensity: 0.95,
    },
  },
  {
    id: 'ashcrag',
    name: 'Ashcrag Canyons',
    levelMin: 24,
    levelMax: 30,
    polygon: ZONE_RINGS.ashcrag,
    safe: false,
    settlement: 'Rustpick Camp',
    ambience: {
      fogColor: '#5b2f38',
      fogNear: 60,
      fogFar: 480,
      skyTop: '#40243a',
      skyHorizon: '#c2543f',
      sunColor: '#ffb894',
      sunIntensity: 1.7,
      hemiSky: '#8a4a52',
      hemiGround: '#3a1f22',
      hemiIntensity: 0.6,
    },
  },
  {
    id: 'elder_grove',
    name: 'The Elder Grove',
    levelMin: 30,
    levelMax: 30,
    polygon: ZONE_RINGS.elder_grove,
    safe: false,
    settlement: null,
    ambience: {
      fogColor: '#1d5f4c',
      fogNear: 25,
      fogFar: 260,
      skyTop: '#0f3b33',
      skyHorizon: '#4fd6a0',
      sunColor: '#b6ffdd',
      sunIntensity: 1.2,
      hemiSky: '#3fe0a8',
      hemiGround: '#12352c',
      hemiIntensity: 1.1,
    },
  },
  {
    // LAST on purpose: `zoneAt` returns the first ring that contains the point,
    // so every land zone above wins and the Dawnsea is what is left. Its level
    // band spans the whole game because the sea touches every isle — a shore
    // you can reach at 1 and a deep-water shoal you should not visit until 25
    // are the same body of water.
    id: 'dawnsea',
    name: 'The Dawnsea',
    levelMin: 1,
    levelMax: 30,
    polygon: ZONE_RINGS.dawnsea,
    safe: false,
    settlement: null,
    ambience: {
      fogColor: '#9fd4e8',
      fogNear: 160,
      fogFar: 1100,
      skyTop: '#3f9ad6',
      skyHorizon: '#e8f4ff',
      sunColor: '#ffffff',
      sunIntensity: 2.3,
      hemiSky: '#cdeeff',
      hemiGround: '#3f7fa0',
      hemiIntensity: 0.9,
    },
  },
];

/** Everything the generator needs, in one object. */
export const WORLD_GEN_PLAN = {
  // Order matters only for the carves, which are applied after every land mask
  // whatever their position in this list — see `synthWorld`.
  masks: [...ISLANDS, ...ISLETS, ...STRAITS],
  splatRules: SPLAT_RULES,
  seaLevel: SEA_LEVEL,
  erosion: { passes: 4, minSlopeDeg: 24, strength: 0.5 },
  waterLevel: null,
};
