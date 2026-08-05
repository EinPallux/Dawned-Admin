/**
 * The scatter brush (A3-d).
 *
 * The last test is the one that matters: painting is only real if the SHARED
 * resolver — the one the bake emits instances with — turns what was painted
 * into more trees. Everything else is arithmetic in service of that.
 */

import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_M,
  SCATTER_GRID,
  WORLD_ORIGIN_M,
  resolveScatter,
  scatterSetSchema,
} from '@dawned/shared';
import {
  DENSITY_CELLS,
  cellCentre,
  chunksUnderBrush,
  dabScatter,
  densityOf,
  densitySum,
  emptyDensity,
  hasDensity,
  scatterRowId,
  strokeBase,
} from './scatter.js';

/** Chunk 16,16 starts at the world origin+1024 — the middle of the map. */
const CX = 16;
const CY = 16;
const originX = WORLD_ORIGIN_M + CX * CHUNK_SIZE_M;
const originZ = WORLD_ORIGIN_M + CY * CHUNK_SIZE_M;

describe('the dab', () => {
  it('raises the cells under the brush and leaves the rest at zero', () => {
    const centre = cellCentre(CX, CY, 8, 8);
    const painted = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 10, 1, false);
    expect(painted[8 * SCATTER_GRID + 8]).toBe(255);
    // 40 m away, well outside a 10 m brush.
    expect(painted[0]).toBe(0);
    expect(painted).toHaveLength(DENSITY_CELLS);
  });

  it('falls off from the centre rather than stamping a hard disc', () => {
    const centre = cellCentre(CX, CY, 8, 8);
    const painted = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 16, 1, false);
    const middle = painted[8 * SCATTER_GRID + 8]!;
    const edge = painted[8 * SCATTER_GRID + 11]!; // ~12 m out of 16
    expect(middle).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
  });

  it('accumulates over repeated dabs and stops at full', () => {
    const centre = cellCentre(CX, CY, 4, 4);
    let density = emptyDensity();
    for (let i = 0; i < 10; i++) {
      density = dabScatter(density, CX, CY, centre.x, centre.z, 8, 0.3, false);
    }
    expect(density[4 * SCATTER_GRID + 4]).toBe(255);
  });

  it('erases with the same shape', () => {
    const centre = cellCentre(CX, CY, 2, 2);
    const painted = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 12, 1, false);
    const erased = dabScatter(painted, CX, CY, centre.x, centre.z, 12, 1, true);
    expect(densitySum(erased)).toBe(0);
  });

  it('never goes below zero or above full', () => {
    const centre = cellCentre(CX, CY, 8, 8);
    const erased = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 20, 1, true);
    expect(Math.min(...erased)).toBe(0);
    const painted = dabScatter(
      new Array<number>(DENSITY_CELLS).fill(250),
      CX,
      CY,
      centre.x,
      centre.z,
      20,
      1,
      false,
    );
    expect(Math.max(...painted)).toBe(255);
  });

  it('changes nothing when the dab misses the chunk', () => {
    const far = dabScatter(emptyDensity(), CX, CY, originX - 500, originZ - 500, 10, 1, false);
    expect(densitySum(far)).toBe(0);
  });
});

describe('a stroke accumulates', () => {
  it('builds each dab on the one before, not on the saved grid', () => {
    const centre = cellCentre(CX, CY, 8, 8);
    const stored = emptyDensity();
    let staged: number[] | undefined;
    for (let i = 0; i < 4; i++) {
      staged = dabScatter(strokeBase(staged, stored), CX, CY, centre.x, centre.z, 12, 0.25, false);
    }
    // Four dabs at a quarter strength reach full; one dab does not. Reading the
    // STORE each time (the bug) would leave a single dab's worth.
    expect(staged![8 * SCATTER_GRID + 8]).toBe(255);
    const single = dabScatter(stored, CX, CY, centre.x, centre.z, 12, 0.25, false);
    expect(single[8 * SCATTER_GRID + 8]).toBeLessThan(255);
  });

  it('falls back to the stored grid, then to an empty one', () => {
    const stored = emptyDensity();
    stored[0] = 7;
    expect(strokeBase(undefined, stored)[0]).toBe(7);
    expect(strokeBase([9, ...stored.slice(1)], stored)[0]).toBe(9);
    expect(strokeBase(undefined, undefined)).toEqual(emptyDensity());
  });

  it('copies rather than aliasing what it was handed', () => {
    const stored = emptyDensity();
    const base = strokeBase(undefined, stored);
    base[3] = 42;
    expect(stored[3]).toBe(0);
  });
});

describe('chunks under the brush', () => {
  it('is one chunk in the middle of one', () => {
    expect(chunksUnderBrush(originX + 32, originZ + 32, 8)).toEqual([{ cx: CX, cy: CY }]);
  });

  it('spans the seam when the brush straddles a border', () => {
    // A stroke on the border must paint BOTH sides or the forest has a
    // 1-cell-wide bald stripe down every chunk edge.
    const touched = chunksUnderBrush(originX, originZ + 32, 10);
    expect(touched).toContainEqual({ cx: CX, cy: CY });
    expect(touched).toContainEqual({ cx: CX - 1, cy: CY });
  });

  it('covers all four when it sits on a corner', () => {
    expect(chunksUnderBrush(originX, originZ, 10)).toHaveLength(4);
  });
});

describe('storage', () => {
  it('names one row per chunk and set, so a second stroke edits the same patch', () => {
    expect(scatterRowId(3, 4, 'scatter_weald_floor')).toBe('scatter_3_4_scatter_weald_floor');
  });

  it('reads a stored grid back, and survives a malformed one', () => {
    const grid = emptyDensity();
    grid[5] = 200;
    expect(densityOf({ density: grid })[5]).toBe(200);
    expect(densityOf({})).toEqual(emptyDensity());
    expect(densityOf({ density: [1, 2, 3] })).toEqual(emptyDensity());
  });

  it('knows an empty patch from a painted one', () => {
    expect(hasDensity(emptyDensity())).toBe(false);
    expect(
      hasDensity(dabScatter(emptyDensity(), CX, CY, originX + 32, originZ + 32, 10, 1, false)),
    ).toBe(true);
  });
});

describe('what the bake will actually emit', () => {
  const set = scatterSetSchema.parse({
    id: 'scatter_test',
    name: 'Test cover',
    entries: [{ modelRef: 'world_nature_grass_1_a_color1', weight: 1 }],
    densityPer100m2: 60,
    maxSlopeDeg: 90,
    minHeight: -64,
  });

  const flatGround = (): { height: number; slopeDeg: number } => ({ height: 4, slopeDeg: 0 });

  it('paints more instances the harder you paint', () => {
    const centre = cellCentre(CX, CY, 8, 8);
    const light = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 24, 0.2, false);
    const heavy = dabScatter(emptyDensity(), CX, CY, centre.x, centre.z, 24, 1, false);
    const count = (density: number[]): number =>
      resolveScatter(set, CX, CY, density, originX, originZ, flatGround).length;
    expect(count(heavy)).toBeGreaterThan(count(light));
    expect(count(light)).toBeGreaterThan(0);
  });

  it('emits nothing at all from an unpainted grid', () => {
    expect(resolveScatter(set, CX, CY, emptyDensity(), originX, originZ, flatGround)).toEqual([]);
  });
});
