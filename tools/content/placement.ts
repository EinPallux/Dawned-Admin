/**
 * Turn "somewhere in the north of the Emberwood" into a coordinate that is
 * really there (game P12-C onward).
 *
 * Every content pass since P10 has hit the same wall: a hand-typed position is
 * a guess about noise-generated terrain, and the ways it can be wrong are all
 * silent. P10's first fishing pass put every cluster on dry land and planted
 * zero shoals. P12-B put Dawnhaven's harbour on a 37° slope and a shrine in
 * 8 m of ocean. Nothing about those rows LOOKED wrong.
 *
 * So a placement here is a WISH — a zone, a bearing, a distance from the zone's
 * heart — and the search resolves it against the real height field, spiralling
 * outward until it finds ground that satisfies every constraint. If it cannot,
 * it says so loudly with the wish printed, rather than returning the closest
 * thing to a lie.
 *
 * Deterministic by construction: the spiral is a fixed sequence and the only
 * randomness is a seeded hash of the placement's own id, so re-running a
 * content script produces byte-identical rows and an empty publish diff.
 */

import { SETTLEMENTS } from './settlement-data.js';
import { world, LAND_Y } from './world-sample.js';
import { ISLANDS } from './world-data.js';

/** Deterministic 0–1 from a string: the same id always lands the same way. */
export const hash01 = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};

export interface Wish {
  /** Used for the deterministic jitter and for the failure message. */
  id: string;
  /** Zone id; the search starts at that isle's centre and must land in it. */
  zone: string;
  /** Bearing from the isle centre, in degrees (0 = +x, 90 = +z). */
  bearing: number;
  /** Distance from the isle centre, in metres. */
  distance: number;
  /** Metres of clearance the thing needs — nothing else may stand this close. */
  clearance?: number;
  /** Steepest ground it may stand on. Default 22°: a camp needs a floor. */
  maxSlope?: number;
  /** Minimum height above sea level. Default 1 m — not in the surf. */
  minHeight?: number;
}

export interface Placed {
  id: string;
  x: number;
  z: number;
  y: number;
  slope: number;
  /** How far the search had to walk from the wish to find real ground. */
  movedM: number;
}

const SETTLEMENT_KEEP_OUT = 40; // metres of peace around a town's edge
const MAX_RING = 10; // 10 × 12 m — see the spiral below for why it is capped

/**
 * Resolve a batch of wishes together, so they can be kept apart from each other
 * and from the settlements. Throws with every failure listed rather than one at
 * a time — a placement pass that dies on wish 3 of 140 wastes the run.
 */
export const placeAll = (wishes: readonly Wish[]): Placed[] => {
  const w = world();
  const isleOf = new Map(ISLANDS.map((isle) => [isle.id, isle]));
  const taken: Placed[] = [];
  const failures: string[] = [];

  const clearOfTowns = (x: number, z: number): boolean =>
    SETTLEMENTS.every(
      (town) => Math.hypot(x - town.x, z - town.z) > town.radius + SETTLEMENT_KEEP_OUT,
    );

  for (const wish of wishes) {
    const isle = isleOf.get(wish.zone);
    if (!isle) {
      failures.push(`${wish.id}: no isle called "${wish.zone}"`);
      continue;
    }
    const clearance = wish.clearance ?? 26;
    const maxSlope = wish.maxSlope ?? 22;
    const minHeight = wish.minHeight ?? LAND_Y + 0.8;

    // A little deterministic scatter so a row of camps at the same bearing does
    // not read as a line drawn on the map.
    const angle = ((wish.bearing + (hash01(`${wish.id}:a`) - 0.5) * 12) * Math.PI) / 180;
    const reach = wish.distance + (hash01(`${wish.id}:d`) - 0.5) * 24;
    const wantX = isle.centerX + Math.cos(angle) * reach;
    const wantZ = isle.centerZ + Math.sin(angle) * reach;

    // Spiral out from the wish: rings of candidates at growing radius, so the
    // answer is always the nearest legal ground rather than wherever a scan
    // happened to reach first.
    //
    // Capped at 10 rings (120 m) ON PURPOSE. An unbounded search always
    // succeeds and quietly moves a camp a third of an isle away, which turns an
    // authored difficulty gradient into scatter — and looks like it worked.
    // Past 120 m the wish itself is wrong and should be fixed.
    let found: Placed | null = null;
    // Why each candidate was rejected. A failure that only says "nothing found"
    // sends you guessing; "1 812 of 1 830 were under water" says move it inland.
    const rejected = { water: 0, steep: 0, zone: 0, town: 0, crowded: 0 };
    // No `&& !found` guard: the only assignment to `found` is followed by
    // `break search`, so the labelled break is what ends this.
    search: for (let ring = 0; ring <= MAX_RING; ring++) {
      const radius = ring * 12;
      const steps = ring === 0 ? 1 : Math.max(8, ring * 6);
      for (let step = 0; step < steps; step++) {
        const theta = (step / steps) * Math.PI * 2 + hash01(`${wish.id}:r${ring}`) * Math.PI * 2;
        const x = Math.round(wantX + Math.cos(theta) * radius);
        const z = Math.round(wantZ + Math.sin(theta) * radius);
        const y = w.groundAt(x, z);
        if (y < minHeight) {
          rejected.water++;
          continue;
        }
        if (w.slopeAt(x, z) > maxSlope) {
          rejected.steep++;
          continue;
        }
        if (w.zoneAt(x, z) !== wish.zone) {
          rejected.zone++;
          continue;
        }
        if (!clearOfTowns(x, z)) {
          rejected.town++;
          continue;
        }
        if (taken.some((other) => Math.hypot(x - other.x, z - other.z) < clearance)) {
          rejected.crowded++;
          continue;
        }
        found = {
          id: wish.id,
          x,
          z,
          y: Math.round(y * 10) / 10,
          slope: Math.round(w.slopeAt(x, z)),
          movedM: Math.round(Math.hypot(x - wantX, z - wantZ)),
        };
        break search;
      }
    }

    if (!found) {
      const why = Object.entries(rejected)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${reason} ${count}`)
        .join(', ');
      failures.push(
        `${wish.id}: nothing within ${MAX_RING * 12} m of ${wish.zone} bearing ${wish.bearing}° / ` +
          `${wish.distance} m (rejected: ${why})`,
      );
      continue;
    }
    taken.push(found);
  }

  if (failures.length > 0) {
    throw new Error(`placement failed for ${failures.length}:\n  • ${failures.join('\n  • ')}`);
  }
  return taken;
};
