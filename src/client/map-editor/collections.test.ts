/**
 * Selection sets and prefabs (A3-d).
 *
 * A prefab that drifts a metre per stamp, or mints an id that overwrites a row
 * someone else placed, would look fine on screen and corrupt the map. Both are
 * arithmetic, so both are pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  clickSelection,
  isMarquee,
  makePrefab,
  prefabSpread,
  rectContains,
  rectFromDrag,
  stampPrefab,
  type PrefabData,
} from './collections.js';
import { mintId } from './object-store.js';
import type { PlacedObject } from './placement.js';

const object = (id: string, x: number, z: number, layer = 'prop'): PlacedObject => ({
  id,
  layer,
  def: { id, x, z, modelRef: 'world_nature_tree_1_a_color1', rotation: 0.5, scale: 1.2 },
  x,
  z,
});

const data = (result: ReturnType<typeof makePrefab>): PrefabData => {
  if ('error' in result) throw new Error(`expected a prefab, got: ${result.error}`);
  return result;
};

describe('clicking', () => {
  it('replaces the selection on a plain click', () => {
    expect([...clickSelection(new Set(['a', 'b']), 'c', false)]).toEqual(['c']);
  });

  it('adds with shift, and shift again removes', () => {
    const added = clickSelection(new Set(['a']), 'b', true);
    expect([...added].sort()).toEqual(['a', 'b']);
    expect([...clickSelection(added, 'b', true)]).toEqual(['a']);
  });

  it('never mutates the set it was given', () => {
    const before = new Set(['a']);
    clickSelection(before, 'b', true);
    expect([...before]).toEqual(['a']);
  });
});

describe('the marquee', () => {
  it('normalises a drag in any direction', () => {
    expect(rectFromDrag(100, 80, 20, 10)).toEqual({ x0: 20, y0: 10, x1: 100, y1: 80 });
  });

  it('contains what it covers', () => {
    const rect = rectFromDrag(10, 10, 50, 40);
    expect(rectContains(rect, 30, 20)).toBe(true);
    expect(rectContains(rect, 60, 20)).toBe(false);
  });

  it('ignores a click that wobbled a few pixels', () => {
    expect(isMarquee(rectFromDrag(100, 100, 103, 102))).toBe(false);
    expect(isMarquee(rectFromDrag(100, 100, 140, 102))).toBe(true);
  });
});

describe('making a prefab', () => {
  it('stores positions relative to the group centre', () => {
    const prefab = data(makePrefab([object('a', 100, 0), object('b', 120, 0)]));
    expect(prefab.items.map((item) => item.dx)).toEqual([-10, 10]);
    expect(prefab.items.every((item) => item.dz === 0)).toBe(true);
  });

  it('keeps the authored fields but drops identity and position', () => {
    const prefab = data(makePrefab([object('a', 40, 40)]));
    expect(prefab.items[0]!.def).toEqual({
      modelRef: 'world_nature_tree_1_a_color1',
      rotation: 0.5,
      scale: 1.2,
    });
  });

  it('refuses a selection with nothing positioned in it', () => {
    const zone: PlacedObject = { id: 'z', layer: 'zone', def: { id: 'z' }, x: null, z: null };
    expect(makePrefab([zone])).toEqual({ error: expect.stringContaining('position') as string });
  });

  it('measures its own spread', () => {
    expect(prefabSpread(data(makePrefab([object('a', 0, 0), object('b', 30, 40)])))).toBe(50);
  });
});

describe('stamping', () => {
  it('lands the group centre where it was asked, keeping the layout', () => {
    const prefab = data(makePrefab([object('a', 100, 0), object('b', 120, 10)]));
    const rows = stampPrefab(prefab, 500, 500, new Set(), mintId);
    expect(rows.map((row) => [row.def.x, row.def.z])).toEqual([
      [490, 495],
      [510, 505],
    ]);
  });

  it('is repeatable: stamping twice does not drift', () => {
    const prefab = data(makePrefab([object('a', 100, 0), object('b', 120, 0)]));
    const once = stampPrefab(prefab, 0, 0, new Set(), mintId);
    const twice = stampPrefab(prefab, 0, 0, new Set(), mintId);
    expect(once.map((row) => row.def.x)).toEqual(twice.map((row) => row.def.x));
  });

  it('mints ids that collide with neither the map nor each other', () => {
    // Two members on the SAME metre: without threading the minted ids through,
    // both would get the same slug and the second would overwrite the first.
    const prefab: PrefabData = {
      items: [
        { layer: 'prop', dx: 0, dz: 0, def: {} },
        { layer: 'prop', dx: 0, dz: 0, def: {} },
      ],
    };
    const rows = stampPrefab(prefab, 10, 10, new Set(['prop_2058_2058']), mintId);
    const ids = rows.map((row) => row.def.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('prop_2058_2058');
  });

  it('carries every member of the prefab', () => {
    const prefab = data(
      makePrefab([object('a', 0, 0), object('b', 5, 5), object('c', 10, 0, 'spawner')]),
    );
    const rows = stampPrefab(prefab, 200, 200, new Set(), mintId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.layer)).toEqual(['prop', 'prop', 'spawner']);
  });
});
