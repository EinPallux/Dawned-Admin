/**
 * Validation and bake rules (A2-b). These are the gates that catch what the
 * viewport cannot show: a zone gap, a chest with no table, a POI behind a
 * cliff. Every one of them exists because the alternative is the owner finding
 * it by walking there in the live game.
 */

import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  WORLD_ORIGIN_M,
  WalkClass,
  Walkgrid,
  baseSplat,
} from '@dawned/shared';
import { validateDraft, isReachable, reachableFrom, type DraftBundle } from './map-bake.js';
import type { DraftChunk, DraftObject } from './map-draft.js';

/** A flat, enabled chunk at `height`. */
const chunk = (cx: number, cy: number, height = 4, enabled = true): DraftChunk => ({
  cx,
  cy,
  heights: new Float32Array(CHUNK_VERTS * CHUNK_VERTS).fill(height),
  splat: baseSplat(0),
  waterLevel: null,
  enabled,
});

/** World-space centre of chunk (cx, cy). */
const centreOf = (cx: number, cy: number) => ({
  x: WORLD_ORIGIN_M + cx * CHUNK_SIZE_M + CHUNK_SIZE_M / 2,
  z: WORLD_ORIGIN_M + cy * CHUNK_SIZE_M + CHUNK_SIZE_M / 2,
});

/** A zone polygon covering exactly chunk (cx, cy). */
const zoneOver = (cx: number, cy: number, id = 'zone_test', over: Record<string, unknown> = {}) => {
  const x0 = WORLD_ORIGIN_M + cx * CHUNK_SIZE_M;
  const z0 = WORLD_ORIGIN_M + cy * CHUNK_SIZE_M;
  return {
    id,
    layer: 'zone' as const,
    x: null,
    z: null,
    def: {
      id,
      name: 'Test Zone',
      levelMin: 1,
      levelMax: 5,
      polygon: [
        [x0 - 4, z0 - 4],
        [x0 + CHUNK_SIZE_M + 4, z0 - 4],
        [x0 + CHUNK_SIZE_M + 4, z0 + CHUNK_SIZE_M + 4],
        [x0 - 4, z0 + CHUNK_SIZE_M + 4],
      ],
      ambience: {
        fogColor: '#ffffff',
        fogNear: 10,
        fogFar: 100,
        skyTop: '#223366',
        skyHorizon: '#ffcc99',
        sunColor: '#ffffff',
        sunIntensity: 2,
        hemiSky: '#ccddff',
        hemiGround: '#334433',
        hemiIntensity: 1,
      },
      safe: false,
      settlement: 'dawnhaven',
      ...over,
    },
  };
};

const bundle = (over: Partial<DraftBundle> = {}): DraftBundle => ({
  chunks: [chunk(4, 4)],
  objects: [zoneOver(4, 4)],
  scatterSets: [],
  seaLevel: 0,
  knownEnemyIds: new Set(['enemy_shore_glub']),
  knownLootTableIds: new Set(['loot_weald_gear']),
  knownModelRefs: new Set(['props_chest_a', 'nature_rock_a']),
  ...over,
});

const object = (layer: DraftObject['layer'], def: Record<string, unknown>): DraftObject => ({
  id: def.id as string,
  layer,
  def,
  x: typeof def.x === 'number' ? def.x : null,
  z: typeof def.z === 'number' ? def.z : null,
});

describe('a world that can be published', () => {
  it('accepts a flat, zoned, empty islet', () => {
    const report = validateDraft(bundle());
    expect(report.problems).toEqual([]);
    expect(report.stats.chunks).toBe(1);
    expect(report.stats.zones).toBe(1);
  });

  it('refuses a draft with nothing enabled', () => {
    const report = validateDraft(bundle({ chunks: [chunk(4, 4, 4, false)] }));
    expect(report.problems.join(' ')).toContain('no chunks are enabled');
  });
});

describe('zone coverage', () => {
  it('blocks land that belongs to no zone — it would read as open ocean', () => {
    const report = validateDraft(bundle({ objects: [] }));
    expect(report.problems.join(' ')).toContain('no zones');
  });

  it('blocks a gap even when other zones exist', () => {
    // Two chunks of land, one zone: the second chunk is uncovered.
    const report = validateDraft(
      bundle({ chunks: [chunk(4, 4), chunk(5, 4)], objects: [zoneOver(4, 4)] }),
    );
    expect(report.problems.join(' ')).toMatch(/sampled land points are in no zone/);
  });

  it('warns rather than blocks when zones overlap', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4, 'zone_a'), zoneOver(4, 4, 'zone_b')] }),
    );
    expect(report.problems).toEqual([]);
    expect(report.warnings.join(' ')).toContain('more than one zone');
  });

  it('blocks an inverted level band', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4, 'zone_test', { levelMin: 9, levelMax: 3 })] }),
    );
    expect(report.problems.join(' ')).toContain('levelMax 3 is below levelMin 9');
  });
});

describe('placements', () => {
  const centre = centreOf(4, 4);

  it('blocks a prop standing on a disabled chunk', () => {
    const far = centreOf(9, 9);
    const report = validateDraft(
      bundle({
        objects: [
          zoneOver(4, 4),
          object('prop', { id: 'prop_lost', modelRef: 'nature_rock_a', x: far.x, z: far.z }),
        ],
      }),
    );
    expect(report.problems.join(' ')).toContain('prop_lost stands on a disabled chunk');
  });

  it('blocks a model the asset pipeline never baked', () => {
    const report = validateDraft(
      bundle({
        objects: [
          zoneOver(4, 4),
          object('prop', {
            id: 'prop_ghost',
            modelRef: 'nature_imaginary',
            x: centre.x,
            z: centre.z,
          }),
        ],
      }),
    );
    expect(report.problems.join(' ')).toContain('not in the baked asset manifest');
  });

  it('reports floaters and buried props as warnings, not blockers', () => {
    const report = validateDraft(
      bundle({
        objects: [
          zoneOver(4, 4),
          object('prop', {
            id: 'prop_high',
            modelRef: 'nature_rock_a',
            x: centre.x,
            z: centre.z,
            yOffset: 3,
          }),
          object('prop', {
            id: 'prop_low',
            modelRef: 'nature_rock_a',
            x: centre.x + 2,
            z: centre.z,
            yOffset: -2,
          }),
        ],
      }),
    );
    expect(report.problems).toEqual([]);
    expect(report.stats.floaters).toBe(1);
    expect(report.stats.buried).toBe(1);
  });
});

describe('interactables', () => {
  const centre = centreOf(4, 4);
  const chest = (over: Record<string, unknown> = {}) =>
    object('interactable', {
      id: 'chest_test',
      kind: 'chest',
      name: 'Test Chest',
      x: centre.x,
      z: centre.z,
      modelRef: 'props_chest_a',
      lootTableId: 'loot_weald_gear',
      ...over,
    });

  it('accepts a chest with a published table', () => {
    const report = validateDraft(bundle({ objects: [zoneOver(4, 4), chest()] }));
    expect(report.problems).toEqual([]);
  });

  it('blocks a chest whose table is not published', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4), chest({ lootTableId: 'loot_imaginary' })] }),
    );
    expect(report.problems.join(' ')).toContain('is not published');
  });

  it('blocks a chest with no table at all (the shared rule)', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4), chest({ lootTableId: null })] }),
    );
    expect(report.problems.join(' ')).toContain('needs a lootTableId');
  });
});

describe('spawners', () => {
  const centre = centreOf(4, 4);
  const spawner = (over: Record<string, unknown> = {}) =>
    object('spawner', {
      id: 'spawner_test',
      kind: 'area',
      x: centre.x,
      z: centre.z,
      radius: 6,
      campTag: null,
      entries: [{ enemyId: 'enemy_shore_glub', count: 3, level: null }],
      respawnMs: 60_000,
      nightOnly: false,
      ...over,
    });

  it('blocks a spawner pointing at an unpublished enemy', () => {
    const report = validateDraft(
      bundle({
        objects: [
          zoneOver(4, 4),
          spawner({ entries: [{ enemyId: 'enemy_renamed', count: 1, level: null }] }),
        ],
      }),
    );
    expect(report.problems.join(' ')).toContain('is not published');
  });

  it('blocks a spawner inside a safe zone', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4, 'zone_town', { safe: true }), spawner()] }),
    );
    expect(report.problems.join(' ')).toContain('inside the safe zone');
  });

  it('accepts a legal spawner', () => {
    const report = validateDraft(bundle({ objects: [zoneOver(4, 4), spawner()] }));
    expect(report.problems).toEqual([]);
    expect(report.stats.spawners).toBe(1);
  });
});

describe('reachability', () => {
  it('flood-fills across walkable and water, never through steep or blocked', () => {
    const grid = Walkgrid.empty(WalkClass.Blocked);
    // A 20 m walkable corridor with a steep wall across the middle.
    for (let i = 0; i < 20; i++) grid.setClassAtCell(100 + i, 100, WalkClass.Walkable);
    grid.setClassAtCell(110, 100, WalkClass.Steep);
    const start = { x: WORLD_ORIGIN_M + 100.5, z: WORLD_ORIGIN_M + 100.5 };
    const seen = reachableFrom(grid, start.x, start.z);
    expect(isReachable(seen, WORLD_ORIGIN_M + 105, WORLD_ORIGIN_M + 100)).toBe(true);
    // Past the wall — and outside the 3 m tolerance the check allows.
    expect(isReachable(seen, WORLD_ORIGIN_M + 118, WORLD_ORIGIN_M + 100)).toBe(false);
  });

  it('blocks a POI nobody can walk to', () => {
    // An island in chunk (4,4) and a POI on a disconnected island in (8,8).
    const centre = centreOf(4, 4);
    const island2 = centreOf(8, 8);
    const report = validateDraft(
      bundle({
        chunks: [chunk(4, 4), chunk(8, 8)],
        objects: [
          zoneOver(4, 4),
          zoneOver(8, 8, 'zone_far'),
          object('poi', {
            id: 'poi_far',
            name: 'Far Vista',
            kind: 'vista',
            x: island2.x,
            z: island2.z,
          }),
          object('poi', {
            id: 'poi_near',
            name: 'Near Vista',
            kind: 'vista',
            x: centre.x,
            z: centre.z,
          }),
        ],
      }),
    );
    expect(report.problems.join(' ')).toContain('poi_far cannot be walked to');
    expect(report.problems.join(' ')).not.toContain('poi_near');
  });
});

describe('scatter', () => {
  it('blocks a patch whose set was deleted', () => {
    const report = validateDraft(
      bundle({
        objects: [
          zoneOver(4, 4),
          {
            id: 'scatter_orphan',
            layer: 'scatter',
            x: null,
            z: null,
            def: {
              id: 'scatter_orphan',
              setId: 'set_gone',
              cx: 4,
              cy: 4,
              density: new Array(256).fill(10),
            },
          },
        ],
      }),
    );
    expect(report.problems.join(' ')).toContain('set "set_gone" no longer exists');
  });

  it('warns when a chunk is over its instance budget', () => {
    const report = validateDraft(
      bundle({
        scatterSets: [
          {
            id: 'scatter_dense',
            name: 'Dense',
            entries: [{ modelRef: 'nature_rock_a', weight: 1, scaleMin: 1, scaleMax: 1 }],
            densityPer100m2: 400,
            maxSlopeDeg: 90,
            minHeight: -100,
          },
        ],
        objects: [
          zoneOver(4, 4),
          {
            id: 'scatter_thick',
            layer: 'scatter',
            x: null,
            z: null,
            def: {
              id: 'scatter_thick',
              setId: 'scatter_dense',
              cx: 4,
              cy: 4,
              density: new Array(256).fill(255),
            },
          },
        ],
      }),
    );
    expect(report.warnings.join(' ')).toMatch(/holds \d+ instances/);
  });
});
