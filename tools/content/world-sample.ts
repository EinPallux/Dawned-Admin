/**
 * The Dawnlands, in memory — one synthesis every content script can ask
 * questions of (game P12).
 *
 * `world-preview` grew this first and then `world:settle` needed the same
 * ground under a building, and P12-C needs it under every camp: "is there land
 * at (x, z), how steep is it, which landmass and which zone" are the questions
 * that decide whether a placement is content or litter. Answering them offline
 * is what makes a placement pass checkable BEFORE a row is written — the
 * alternative is publishing and then walking there.
 *
 * It runs the same `synthWorld` + `erodeField` the generate endpoint runs, so
 * what it reports is what the server made, not a model of it.
 */

import {
  type IslandMask,
  WorldHeightField,
  erodeField,
  insidePolygon,
  slopeAt,
  synthWorld,
} from '../../src/shared-ext/terrain-synth.js';
import { SEA_LEVEL, WORLD_GEN_PLAN, ZONES } from './world-data.js';

export const WORLD_CHUNKS = 32;
export const ORIGIN = -1024;
export const OCEAN_FLOOR = -8;

/** Above this a vertex counts as land: the shallows are not somewhere to stand. */
export const LAND_Y = SEA_LEVEL + 0.2;

export interface World {
  field: WorldHeightField;
  /** Land vertices, and per-mask area, from the synthesis itself. */
  synth: { land: number; perIsland: Record<string, number> };
  eroded: number;
  ms: number;
  /** Terrain height at a world position (clamped to the field). */
  groundAt(x: number, z: number): number;
  /** Slope in degrees at a world position. WORLD.md §6: past 55° is unwalkable. */
  slopeAt(x: number, z: number): number;
  /**
   * Which connected landmass a world position belongs to, or -1 for water.
   * A flood fill is the ONLY thing that can answer "are these two isles
   * separate" — a depth probe in a channel is true and beside the point.
   */
  landmassOf(x: number, z: number): number;
  landmassCount: number;
  landmassSize(id: number): number;
  /** The first zone whose ring contains the point, smallest ring first. */
  zoneAt(x: number, z: number): string | null;
}

let cached: World | null = null;

/** Build (once per process) and return the sampled world. */
export const world = (): World => {
  if (cached) return cached;

  const field = new WorldHeightField(WORLD_CHUNKS, ORIGIN);
  const masks: IslandMask[] = WORLD_GEN_PLAN.masks;
  const started = Date.now();
  const synth = synthWorld(field, masks, SEA_LEVEL, OCEAN_FLOOR);
  const eroded = erodeField(field, WORLD_GEN_PLAN.erosion, SEA_LEVEL);
  const ms = Date.now() - started;

  const clamp = (value: number): number =>
    Math.min(field.side - 1, Math.max(0, Math.round(value - ORIGIN)));

  // --- connected components of land ----------------------------------------
  const label = new Int32Array(field.side * field.side).fill(-1);
  const componentSize: number[] = [];
  let components = 0;
  const stack: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || field.heights[start]! <= LAND_Y) continue;
    const id = components++;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const at = stack.pop()!;
      size++;
      const gx = at % field.side;
      const gz = (at / field.side) | 0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= field.side || nz >= field.side) continue;
        const next = nz * field.side + nx;
        if (label[next] !== -1 || field.heights[next]! <= LAND_Y) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    componentSize[id] = size;
  }

  // Smallest ring first, so the specific zone wins over the Dawnsea's
  // world-covering rectangle — the same order `bakeDraft` sorts zones into.
  const area = (points: readonly (readonly [number, number])[]): number => {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const [ax, az] = points[i]!;
      const [bx, bz] = points[(i + 1) % points.length]!;
      sum += ax * bz - bx * az;
    }
    return Math.abs(sum) / 2;
  };
  const rings = ZONES.map((zone) => ({ id: zone.id, points: zone.polygon })).sort(
    (a, b) => area(a.points) - area(b.points) || a.id.localeCompare(b.id),
  );

  cached = {
    field,
    synth,
    eroded,
    ms,
    groundAt: (x, z) => field.get(clamp(x), clamp(z)),
    slopeAt: (x, z) => slopeAt(field, clamp(x), clamp(z)),
    landmassOf: (x, z) => label[clamp(z) * field.side + clamp(x)]!,
    landmassCount: components,
    landmassSize: (id) => (id < 0 ? 0 : (componentSize[id] ?? 0)),
    zoneAt: (x, z) => rings.find((ring) => insidePolygon(ring.points, x, z))?.id ?? null,
  };
  return cached;
};
