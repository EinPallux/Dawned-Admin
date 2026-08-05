/**
 * The foliage scatter brush (A3-d · MAP_EDITOR.md §2.2).
 *
 * Scatter is stored as a DENSITY MAP, not as instances: one 16×16 grid per
 * (chunk, set), values 0–255. A forest is fifty thousand trees and about two
 * hundred bytes. The bake turns a grid into instances with the shared
 * `resolveScatter`, deterministically from a seed, which is why painting stays
 * cheap and a republish does not shuffle the woods.
 *
 * That storage decides the brush's shape. A dab does not place anything; it
 * raises the value of the cells it covers, and the cells are 4 m across, so the
 * feel is closer to a splat brush than to stamping props. Everything here is a
 * pure function on a density array for the usual reason: the result is data
 * that ships, and "did the brush paint what I think it painted?" should be
 * answerable without a browser.
 */

import { CHUNK_SIZE_M, SCATTER_CELL_M, SCATTER_GRID, WORLD_ORIGIN_M } from '@dawned/shared';

export const DENSITY_CELLS = SCATTER_GRID * SCATTER_GRID;

export interface ScatterBrushSettings {
  setId: string;
  /** Metres. */
  radius: number;
  /** 0..1 of full density added per dab at the centre. */
  strength: number;
}

export const DEFAULT_SCATTER_BRUSH: ScatterBrushSettings = {
  setId: '',
  radius: 14,
  strength: 0.5,
};

/** A fresh, empty grid — the shape the placements file expects. */
export const emptyDensity = (): number[] => new Array<number>(DENSITY_CELLS).fill(0);

/**
 * The row id for one chunk's patch of one set.
 *
 * Deterministic so a second stroke over the same ground edits the SAME row
 * rather than stacking a second patch on top of it — two patches of the same
 * set on one chunk would double the forest and nothing would say why.
 */
export const scatterRowId = (cx: number, cy: number, setId: string): string =>
  `scatter_${cx}_${cy}_${setId}`;

/** Chunk indices a dab of `radius` at (x, z) touches, seams included. */
export const chunksUnderBrush = (
  x: number,
  z: number,
  radius: number,
): { cx: number; cy: number }[] => {
  const out: { cx: number; cy: number }[] = [];
  const minCx = Math.floor((x - radius - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const maxCx = Math.floor((x + radius - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const minCy = Math.floor((z - radius - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const maxCy = Math.floor((z + radius - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) out.push({ cx, cy });
  }
  return out;
};

/** World centre of one density cell. */
export const cellCentre = (
  cx: number,
  cy: number,
  ix: number,
  iz: number,
): { x: number; z: number } => ({
  x: WORLD_ORIGIN_M + cx * CHUNK_SIZE_M + (ix + 0.5) * SCATTER_CELL_M,
  z: WORLD_ORIGIN_M + cy * CHUNK_SIZE_M + (iz + 0.5) * SCATTER_CELL_M,
});

/**
 * One dab into one chunk's grid. Returns a NEW array (or the same one when the
 * dab misses entirely, so a caller can skip a save it does not need).
 *
 * The falloff is the smooth curve the terrain brushes use, for the obvious
 * reason: a hard-edged circle of trees looks like a crop circle. `erase` takes
 * density away with the same shape.
 */
export const dabScatter = (
  density: readonly number[],
  cx: number,
  cy: number,
  x: number,
  z: number,
  radius: number,
  strength: number,
  erase: boolean,
): number[] => {
  const amount = Math.round(Math.max(0, Math.min(1, strength)) * 255);
  if (amount === 0 || radius <= 0) return [...density];
  let touched = false;
  const next = [...density];
  for (let iz = 0; iz < SCATTER_GRID; iz++) {
    for (let ix = 0; ix < SCATTER_GRID; ix++) {
      const centre = cellCentre(cx, cy, ix, iz);
      const distance = Math.hypot(centre.x - x, centre.z - z);
      if (distance > radius) continue;
      const t = 1 - distance / radius;
      // Smoothstep, matching BrushFalloff.Smooth in shared.
      const falloff = t * t * (3 - 2 * t);
      const delta = Math.round(amount * falloff);
      if (delta === 0) continue;
      const at = iz * SCATTER_GRID + ix;
      const before = next[at] ?? 0;
      const after = Math.max(0, Math.min(255, erase ? before - delta : before + delta));
      if (after !== before) {
        next[at] = after;
        touched = true;
      }
    }
  }
  return touched ? next : [...density];
};

/**
 * The grid the NEXT dab of a stroke must build on.
 *
 * A stroke is only written to the store on mouse-up, so a dab that re-reads the
 * store starts from the grid as it was BEFORE the stroke — every dab then
 * overwrites the last and only the final one survives. Painting still looked
 * roughly right that way; erasing barely worked, which is how it was caught.
 * Staged-then-stored-then-empty is the whole rule, and it is here so it can be
 * pinned rather than living inside a pointer handler.
 */
export const strokeBase = (
  staged: readonly number[] | undefined,
  stored: readonly number[] | undefined,
): number[] => {
  if (staged) return [...staged];
  if (stored) return [...stored];
  return emptyDensity();
};

/** Is anything painted? An all-zero patch is deleted rather than saved. */
export const hasDensity = (density: readonly number[]): boolean =>
  density.some((value) => value > 0);

/** Read a stored scatter row's grid, or an empty one if it is malformed. */
export const densityOf = (def: Record<string, unknown>): number[] => {
  const raw = def.density;
  if (!Array.isArray(raw) || raw.length !== DENSITY_CELLS) return emptyDensity();
  return raw.map((value) => (typeof value === 'number' ? Math.max(0, Math.min(255, value)) : 0));
};

/** Total painted density, for "how much forest is this?" readouts. */
export const densitySum = (density: readonly number[]): number =>
  density.reduce((sum, value) => sum + value, 0);
