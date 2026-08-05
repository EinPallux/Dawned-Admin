/**
 * Publish-side housekeeping (A2/A3-e).
 *
 * Baking is covered in `map-bake.test.ts`; this is what happens to the map
 * DIRECTORY around a publish. A bake of the shipped world is ~8.6 MB and
 * nothing used to remove one, so a VPS filled up in proportion to how much the
 * owner edited — the failure mode with the worst timing possible.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEEP_BAKES, pruneOldBakes } from './map-routes.js';

describe('pruneOldBakes', () => {
  let dir = '';

  /** Lay out a map directory: bakes newest-last, plus the committed fallback. */
  const seed = async (names: string[]) => {
    for (const name of names) {
      await mkdir(path.join(dir, name), { recursive: true });
      await writeFile(path.join(dir, name, 'meta.json'), '{}');
    }
    await mkdir(path.join(dir, 'dev-2'), { recursive: true });
    await writeFile(path.join(dir, 'current.json'), '{"version":"x"}');
  };

  const left = async () => (await readdir(dir)).sort();

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dawned-map-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the rollback window and nothing older', async () => {
    const bakes = Array.from({ length: 9 }, (_, index) => `map-${1_700_000_000 + index}`);
    await seed(bakes);
    const live = bakes[bakes.length - 1] ?? '';

    const removed = await pruneOldBakes(dir, live);

    expect(removed).toHaveLength(9 - KEEP_BAKES);
    const remaining = (await left()).filter((name) => name.startsWith('map-'));
    expect(remaining).toHaveLength(KEEP_BAKES);
    expect(remaining).toContain(live);
    // Oldest go first — the window is the NEWEST five.
    expect(remaining).toEqual(bakes.slice(-KEEP_BAKES).sort());
  });

  it('never removes the live bake, even when it is not the newest', async () => {
    const bakes = Array.from({ length: 8 }, (_, index) => `map-${1_700_000_000 + index}`);
    await seed(bakes);
    const live = bakes[0] ?? '';

    await pruneOldBakes(dir, live);

    expect(await left()).toContain(live);
  });

  it('leaves the committed dev fallback and the pointer alone', async () => {
    await seed(Array.from({ length: 7 }, (_, index) => `map-${1_700_000_000 + index}`));

    await pruneOldBakes(dir, 'map-1700000006');

    const remaining = await left();
    expect(remaining).toContain('dev-2');
    expect(remaining).toContain('current.json');
  });

  /**
   * A bake that dies now cleans up after itself, but a process KILLED mid-bake
   * cannot. Three of those accumulated in one afternoon, each a full copy of
   * the chunk bins, so the sweep takes them too.
   */
  it('sweeps staging directories a killed bake left behind', async () => {
    await seed(['map-1700000001']);
    await mkdir(path.join(dir, 'map-1700000002.tmp'), { recursive: true });

    const removed = await pruneOldBakes(dir, 'map-1700000001');

    expect(removed).toContain('map-1700000002.tmp');
    expect(await left()).not.toContain('map-1700000002.tmp');
  });

  it('does nothing to a directory that does not exist yet', async () => {
    expect(await pruneOldBakes(path.join(dir, 'nope'), 'map-1')).toEqual([]);
  });

  /**
   * `keep = 1` means "the live one and nothing else". A negative slice argument
   * counts from the end, so an unclamped `keep - 1` at keep = 0 would have
   * deleted everything EXCEPT the oldest bake.
   */
  it('keeps only the live bake at a window of one', async () => {
    const bakes = ['map-1700000001', 'map-1700000002', 'map-1700000003'];
    await seed(bakes);

    await pruneOldBakes(dir, 'map-1700000003', 1);

    expect((await left()).filter((name) => name.startsWith('map-'))).toEqual(['map-1700000003']);
  });
});
