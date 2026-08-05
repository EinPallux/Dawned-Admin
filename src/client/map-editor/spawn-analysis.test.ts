/**
 * Spawn analysis (A3-b).
 *
 * These are the numbers the owner will make balance decisions from — "this zone
 * holds 47 enemies", "these two camps pull each other" — so being quietly wrong
 * here is worse than not showing them at all.
 */

import { describe, expect, it } from 'vitest';
import { spawnerDefSchema, type SpawnerDef } from '@dawned/shared';
import {
  aggroOverlaps,
  campLinks,
  populationByZone,
  simulatePopulate,
  spawnerHeadcount,
  type EnemyFacts,
  type ZoneFacts,
} from './spawn-analysis.js';

const spawner = (over: Record<string, unknown>): SpawnerDef =>
  spawnerDefSchema.parse({
    id: 'spawner_test',
    kind: 'area',
    x: 0,
    z: 0,
    radius: 8,
    entries: [{ enemyId: 'enemy_glub', count: 3 }],
    ...over,
  });

const enemies = new Map<string, EnemyFacts>([
  [
    'enemy_glub',
    { id: 'enemy_glub', name: 'Glub', rank: 'normal', aggroRadius: 10, leashRadius: 40 },
  ],
  [
    'enemy_king',
    { id: 'enemy_king', name: 'King', rank: 'boss', aggroRadius: 14, leashRadius: 60 },
  ],
]);

const shoreZone: ZoneFacts = {
  id: 'zone_shore',
  name: 'Dawnshore',
  polygon: [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ],
};

describe('headcount', () => {
  it('is the sum of the entry counts, the same loop the server spawns with', () => {
    expect(
      spawnerHeadcount(
        spawner({
          entries: [
            { enemyId: 'enemy_glub', count: 3 },
            { enemyId: 'enemy_king', count: 1 },
          ],
        }),
      ),
    ).toBe(4);
  });
});

describe('population by zone', () => {
  it('counts spawners, enemies, camps and ranks inside the polygon', () => {
    const result = populationByZone(
      [
        spawner({ id: 'spawner_a', x: 10, z: 10, campTag: 'shore_camp' }),
        spawner({ id: 'spawner_b', x: -20, z: 30, campTag: 'shore_camp' }),
        spawner({
          id: 'spawner_boss',
          x: 40,
          z: 40,
          entries: [{ enemyId: 'enemy_king', count: 1 }],
        }),
      ],
      [shoreZone],
      enemies,
    );
    const shore = result.zones[0]!;
    expect(shore.spawners).toBe(3);
    expect(shore.enemies).toBe(7); // 3 + 3 + 1
    expect(shore.camps).toBe(1); // both tagged the same camp
    expect(shore.ranks).toEqual({ normal: 6, boss: 1 });
    expect(result.unzoned).toBe(0);
  });

  it('reports a spawner that sits in no zone rather than hiding it in a total', () => {
    const result = populationByZone([spawner({ x: 500, z: 500 })], [shoreZone], enemies);
    expect(result.unzoned).toBe(1);
    expect(result.zones[0]!.enemies).toBe(0);
  });
});

describe('camp links', () => {
  it('groups by tag and measures how far apart the members are', () => {
    const links = campLinks([
      spawner({ id: 'spawner_a', x: 0, z: 0, campTag: 'bandits' }),
      spawner({ id: 'spawner_b', x: 30, z: 40, campTag: 'bandits' }),
      spawner({ id: 'spawner_lonely', x: 200, z: 0, campTag: null }),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]!.tag).toBe('bandits');
    expect(links[0]!.spawnerIds).toEqual(['spawner_a', 'spawner_b']);
    expect(links[0]!.spreadM).toBe(50); // 3-4-5
    expect(links[0]!.centre.x).toBeCloseTo(15);
  });
});

describe('aggro overlap', () => {
  it('flags two camps whose pull envelopes touch', () => {
    // radius 8 + aggro 10 = 18 m reach each; 30 m apart leaves 6 m of overlap.
    const overlaps = aggroOverlaps(
      [spawner({ id: 'spawner_a', x: 0, z: 0 }), spawner({ id: 'spawner_b', x: 30, z: 0 })],
      enemies,
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.overlapM).toBe(6);
  });

  it('says nothing about two spawners far apart', () => {
    expect(
      aggroOverlaps(
        [spawner({ id: 'spawner_a', x: 0, z: 0 }), spawner({ id: 'spawner_b', x: 300, z: 0 })],
        enemies,
      ),
    ).toEqual([]);
  });

  it('ignores members of the same camp — they are MEANT to pull together', () => {
    expect(
      aggroOverlaps(
        [
          spawner({ id: 'spawner_a', x: 0, z: 0, campTag: 'bandits' }),
          spawner({ id: 'spawner_b', x: 12, z: 0, campTag: 'bandits' }),
        ],
        enemies,
      ),
    ).toEqual([]);
  });
});

describe('simulate populate', () => {
  it('places one enemy per counted entry, inside the spawn radius', () => {
    const rolled = simulatePopulate(
      spawner({
        x: 100,
        z: -50,
        radius: 12,
        entries: [
          { enemyId: 'enemy_glub', count: 4 },
          { enemyId: 'enemy_king', count: 1 },
        ],
      }),
      7,
      enemies,
    );
    expect(rolled).toHaveLength(5);
    for (const spawn of rolled) {
      expect(Math.hypot(spawn.x - 100, spawn.z + 50)).toBeLessThanOrEqual(12.0001);
    }
  });

  it('is deterministic — the same seed previews the same camp twice', () => {
    const once = simulatePopulate(spawner({}), 42, enemies);
    const twice = simulatePopulate(spawner({}), 42, enemies);
    expect(once).toEqual(twice);
  });

  it('drops an entry whose enemy is not published rather than inventing one', () => {
    const rolled = simulatePopulate(
      spawner({ entries: [{ enemyId: 'enemy_deleted', count: 5 }] }),
      1,
      enemies,
    );
    expect(rolled).toEqual([]);
  });

  it('puts a point spawner exactly on its origin', () => {
    const rolled = simulatePopulate(spawner({ kind: 'point', x: 5, z: 5, radius: 0 }), 3, enemies);
    for (const spawn of rolled) {
      expect(spawn.x).toBe(5);
      expect(spawn.z).toBe(5);
    }
  });
});
