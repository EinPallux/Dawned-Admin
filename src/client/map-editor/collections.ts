/**
 * Selection sets, isolation and prefab collections (A3-d · MAP_EDITOR.md
 * §2.2, §3).
 *
 * Three related ideas, all editor-side — the game never learns any of them
 * exist:
 *
 *   selection set  a named list of object ids, so "the Dawnhaven harbour
 *                  props" survives closing the tab
 *   isolation      dim everything that is not selected, so you can work inside
 *                  a camp without a hundred markers in the way
 *   prefab         a named group of rows with RELATIVE offsets, stampable
 *                  anywhere; stamping produces plain placements, which is why
 *                  the bake never has to know about it
 *
 * The maths is small but every part of it is a thing that can be quietly wrong
 * — a prefab that drifts a metre each time it is stamped, an id collision that
 * overwrites a row someone else placed — so it lives here as pure functions
 * rather than inside a click handler.
 */

import { z } from 'zod';
import type { PlacedObject } from './placement.js';

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

/** One row inside a prefab, positioned relative to the prefab's own origin. */
export const prefabItemSchema = z
  .object({
    layer: z.string().min(1).max(32),
    dx: z.number(),
    dz: z.number(),
    /** The row as authored, minus its id and position — those are minted on stamp. */
    def: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PrefabItem = z.infer<typeof prefabItemSchema>;

export const prefabDataSchema = z.object({ items: z.array(prefabItemSchema).min(1).max(500) });
export type PrefabData = z.infer<typeof prefabDataSchema>;

export const selectionDataSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(2000) });
export type SelectionData = z.infer<typeof selectionDataSchema>;

export interface Collection {
  id: string;
  kind: 'selection' | 'prefab';
  name: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Multi-select
// ---------------------------------------------------------------------------

/**
 * Click semantics: a plain click replaces the selection, `Shift` toggles.
 * Returns a NEW set — the caller keeps selection in React state.
 */
export const clickSelection = (
  current: ReadonlySet<string>,
  id: string,
  additive: boolean,
): Set<string> => {
  if (!additive) return new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalise a drag into a rect with x0 ≤ x1, y0 ≤ y1. */
export const rectFromDrag = (ax: number, ay: number, bx: number, by: number): ScreenRect => ({
  x0: Math.min(ax, bx),
  y0: Math.min(ay, by),
  x1: Math.max(ax, bx),
  y1: Math.max(ay, by),
});

export const rectContains = (rect: ScreenRect, x: number, y: number): boolean =>
  x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;

/** A marquee smaller than this is a click that wobbled, not a drag. */
export const MARQUEE_MIN_PX = 6;

export const isMarquee = (rect: ScreenRect): boolean =>
  rect.x1 - rect.x0 >= MARQUEE_MIN_PX || rect.y1 - rect.y0 >= MARQUEE_MIN_PX;

// ---------------------------------------------------------------------------
// Prefabs
// ---------------------------------------------------------------------------

/**
 * Turn selected objects into a prefab.
 *
 * The origin is the AVERAGE of the members' positions, not the first one's:
 * stamping should put the group's middle under the cursor, which is where the
 * owner is looking. Objects with no position (zone polygons) cannot be part of
 * a prefab — a zone is a place, not a thing you have several of.
 */
export const makePrefab = (objects: readonly PlacedObject[]): PrefabData | { error: string } => {
  const placed = objects.filter(
    (object): object is PlacedObject & { x: number; z: number } =>
      object.x !== null && object.z !== null && object.layer !== 'zone',
  );
  if (placed.length === 0) return { error: 'a prefab needs objects that have a position' };
  let originX = 0;
  let originZ = 0;
  for (const object of placed) {
    originX += object.x / placed.length;
    originZ += object.z / placed.length;
  }
  const items = placed.map((object) => {
    const def = { ...object.def };
    delete def.id;
    delete def.x;
    delete def.z;
    return {
      layer: object.layer,
      dx: Number((object.x - originX).toFixed(2)),
      dz: Number((object.z - originZ).toFixed(2)),
      def,
    };
  });
  return { items };
};

/**
 * Stamp a prefab at (x, z). Returns rows ready for the object store.
 *
 * Ids are minted against the ids ALREADY taken, and each minted id joins that
 * set as it is created — two members landing on the same metre must not collide
 * with each other, which they would if `taken` were only read once.
 */
export const stampPrefab = (
  prefab: PrefabData,
  x: number,
  z: number,
  taken: ReadonlySet<string>,
  mint: (layer: string, x: number, z: number, taken: Set<string>) => string,
): { layer: string; def: Record<string, unknown> }[] => {
  const used = new Set(taken);
  return prefab.items.map((item) => {
    const at = { x: Number((x + item.dx).toFixed(2)), z: Number((z + item.dz).toFixed(2)) };
    const id = mint(item.layer, at.x, at.z, used);
    used.add(id);
    return { layer: item.layer, def: { ...item.def, id, ...at } };
  });
};

/** How wide a prefab is, for the "market stall set · 4 rows · 18 m" line. */
export const prefabSpread = (prefab: PrefabData): number => {
  let widest = 0;
  for (const a of prefab.items) {
    for (const b of prefab.items) {
      widest = Math.max(widest, Math.hypot(a.dx - b.dx, a.dz - b.dz));
    }
  }
  return Math.round(widest);
};
