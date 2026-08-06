/**
 * Validation and bake rules (A2-b). These are the gates that catch what the
 * viewport cannot show: a zone gap, a chest with no table, a POI behind a
 * cliff. Every one of them exists because the alternative is the owner finding
 * it by walking there in the live game.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  WORLD_ORIGIN_M,
  WalkClass,
  Walkgrid,
  baseSplat,
  placementsFileSchema,
} from '@dawned/shared';
import {
  bakeDraft,
  validateDraft,
  isReachable,
  orderZones,
  reachableFrom,
  type DraftBundle,
} from './map-bake.js';
import { layerSchemas } from './map-draft.js';
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
  knownNodeIds: new Set(['node_woodcutting_birch']),
  knownNpcIds: new Set(['npc_marla']),
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

describe('resource nodes belong to a place', () => {
  // Two chunks side by side, each its own zone: a cluster authored for one and
  // scattered across the border is the shape of the game P12-E bug, where 39 of
  // 322 land nodes stood one zone over — a T5 vein in the T4 savanna, and 4 of
  // the 12 Dawnpetal outside the Grove that exists for them.
  const here = centreOf(4, 4);
  const there = centreOf(5, 4);
  const twoZones = {
    chunks: [chunk(4, 4), chunk(5, 4)],
    objects: [zoneOver(4, 4, 'zone_home'), zoneOver(5, 4, 'zone_next')],
  };
  const birch = (id: string, at: { x: number; z: number }) =>
    object('node', { id, nodeId: 'node_woodcutting_birch', x: at.x, z: at.z });

  it('says nothing when every placement of a node stands in one zone', () => {
    const report = validateDraft(
      bundle({
        ...twoZones,
        objects: [
          ...twoZones.objects,
          birch('node_a', here),
          birch('node_b', { x: here.x + 4, z: here.z }),
        ],
      }),
    );
    expect(report.warnings.join(' ')).not.toContain('stand outside');
  });

  it('warns — without blocking — when some of them stray into another zone', () => {
    const report = validateDraft(
      bundle({
        ...twoZones,
        objects: [
          ...twoZones.objects,
          birch('node_a', here),
          birch('node_b', { x: here.x + 4, z: here.z }),
          birch('node_c', there),
        ],
      }),
    );
    expect(report.problems).toEqual([]);
    const warning = report.warnings.find((line) => line.includes('node_woodcutting_birch'));
    expect(warning).toContain('1 of 3 placements stand outside zone_home');
    expect(warning).toContain('1 in zone_next');
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

/**
 * The draft store and the bake must parse a placement with the SAME schema.
 *
 * A2 shipped its own guess at an NPC row (`name` + `modelRef` + a walk routine)
 * months before P11 defined the real one in `@dawned/shared` (`npcId`, and a
 * composed appearance instead of a mesh). Each half then validated with the
 * schema it had, so the editor refused — with a 500 — exactly the row the bake
 * was written to emit. Nothing typechecked it, because both were real schemas.
 *
 * This asserts the property rather than the shapes: a def the BAKE accepts must
 * survive the DRAFT store, for every layer. It fails the moment either side
 * grows a field the other does not know about.
 */
describe('draft and bake agree on every layer schema', () => {
  const centre = centreOf(4, 4);
  const samples: Record<string, Record<string, unknown>> = {
    npc: { id: 'npc_marla_gate', npcId: 'npc_marla', x: centre.x, z: centre.z, rotation: 0 },
    node: { id: 'node_birch_0', nodeId: 'node_woodcutting_birch', x: centre.x, z: centre.z },
    poi: {
      id: 'poi_gullspit',
      name: 'Gullspit',
      kind: 'vista',
      x: centre.x,
      z: centre.z,
      radius: 12,
    },
    interactable: {
      id: 'shrine_haven',
      kind: 'shrine',
      name: 'Dawnhaven Shrine',
      x: centre.x,
      z: centre.z,
      modelRef: 'props_chest_a',
    },
  };

  for (const [layer, def] of Object.entries(samples)) {
    it(`accepts a baked ${layer} row in the draft store`, () => {
      const parsed = layerSchemas[layer as keyof typeof layerSchemas].safeParse(def);
      expect(parsed.success ? [] : parsed.error.issues.map((i) => i.message)).toEqual([]);
    });
  }
});

describe('npc placements', () => {
  const centre = centreOf(4, 4);
  const villager = (over: Record<string, unknown> = {}) =>
    object('npc', {
      id: 'npc_marla_gate',
      npcId: 'npc_marla',
      x: centre.x,
      z: centre.z,
      yOffset: 0,
      rotation: 0,
      ...over,
    });

  it('accepts a placement whose definition is published', () => {
    const report = validateDraft(bundle({ objects: [zoneOver(4, 4), villager()] }));
    expect(report.problems).toEqual([]);
  });

  it('blocks a placement pointing at an NPC nobody published', () => {
    const report = validateDraft(
      bundle({ objects: [zoneOver(4, 4), villager({ npcId: 'npc_imaginary' })] }),
    );
    expect(report.problems.join(' ')).toContain('is not a published NPC');
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
          // The spawn goes to the STARTER settlement — the lowest level band —
          // so this names which island that is instead of leaving it to the
          // order the two zones happen to arrive in.
          zoneOver(4, 4, 'zone_near', { levelMin: 1, levelMax: 5 }),
          zoneOver(8, 8, 'zone_far', { levelMin: 20, levelMax: 25 }),
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

/**
 * The bake itself, on the smallest legal world. `validateDraft` passing is NOT
 * proof a draft bakes: validation reads the draft's own schemas, while the bake
 * has to hand every layer to the GAME's strict artifact schemas. A painted
 * forest used to pass validation and then throw inside `placements.json`.
 */
describe('bakeDraft', () => {
  const scatterSet = {
    id: 'scatter_cover',
    name: 'Cover',
    entries: [{ modelRef: 'nature_rock_a', weight: 1, scaleMin: 1, scaleMax: 1 }],
    densityPer100m2: 20,
    maxSlopeDeg: 90,
    minHeight: -64,
  };

  const bakeInto = async (over: Partial<DraftBundle> = {}) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dawned-bake-'));
    try {
      const result = await bakeDraft(bundle(over), dir, 'test-bake');
      const placements = placementsFileSchema.parse(
        JSON.parse(await readFile(path.join(dir, 'test-bake', 'placements.json'), 'utf8')),
      );
      const meta = JSON.parse(await readFile(path.join(dir, 'test-bake', 'meta.json'), 'utf8')) as {
        spawn: { x: number; z: number };
      };
      return { result, placements, meta };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('spawns new players in the STARTER settlement, not whichever came first', async () => {
    // Five zones carry a settlement now. The spawn used to be
    // `zones.find(z => z.settlement !== null)` over a list in Postgres's
    // physical row order, so a new character could have woken up in the
    // level 24–30 mining camp. The rule is the lowest level band.
    const starter = centreOf(4, 4);
    const endgame = centreOf(8, 8);
    const { meta } = await bakeInto({
      chunks: [chunk(4, 4), chunk(8, 8)],
      objects: [
        zoneOver(8, 8, 'zone_ashcrag', { levelMin: 24, levelMax: 30, settlement: 'Rustpick' }),
        zoneOver(4, 4, 'zone_dawnshore', { levelMin: 1, levelMax: 6, settlement: 'Dawnhaven' }),
      ],
    });
    expect(Math.hypot(meta.spawn.x - starter.x, meta.spawn.z - starter.z)).toBeLessThan(
      Math.hypot(meta.spawn.x - endgame.x, meta.spawn.z - endgame.z),
    );
  });

  it('writes a placements file the game can read', async () => {
    const { result, placements } = await bakeInto();
    expect(result.chunksEmitted).toBe(1);
    expect(placements.props).toEqual([]);
    expect(placements.scatter).toEqual([]);
  });

  /**
   * The regression: a draft scatter row carries an `id` (it is a row key), the
   * baked format is keyed by (cx, cy, setId) and is `.strict()`. Handing the
   * row straight over threw `unrecognized_keys` — and because the bake stages
   * into `.tmp` and only renames at the end, the failure looked like a publish
   * that silently stopped after "zones".
   */
  it('projects a draft scatter patch into the baked format (drops the row id)', async () => {
    const { result, placements } = await bakeInto({
      scatterSets: [scatterSet],
      objects: [
        zoneOver(4, 4),
        {
          id: 'scatter_cover_4_4',
          layer: 'scatter',
          x: null,
          z: null,
          def: {
            id: 'scatter_cover_4_4',
            setId: 'scatter_cover',
            cx: 4,
            cy: 4,
            density: new Array(256).fill(255),
          },
        },
      ],
    });
    expect(placements.scatter).toHaveLength(1);
    expect(placements.scatter[0]).not.toHaveProperty('id');
    expect(placements.scatter[0]?.setId).toBe('scatter_cover');
    expect(result.scatterInstances).toBeGreaterThan(0);
  });

  /**
   * The same class of bug the scatter layer taught, found the same way: the
   * report COUNTED npcs and the placements file never carried them, so every
   * villager the editor placed vanished at publish with nothing on screen to
   * say so. A count is not evidence that a row was written.
   */
  it('carries npc placements into the baked placements file', async () => {
    const centre = centreOf(4, 4);
    const { placements } = await bakeInto({
      objects: [
        zoneOver(4, 4),
        object('npc', {
          id: 'npc_marla_gate',
          npcId: 'npc_marla',
          x: centre.x,
          z: centre.z,
          yOffset: 0,
          rotation: 2.4,
        }),
      ],
    });
    expect(placements.npcs).toHaveLength(1);
    expect(placements.npcs[0]?.npcId).toBe('npc_marla');
  });

  it('leaves no staging directory behind when the bake throws', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dawned-bake-'));
    try {
      await expect(
        bakeDraft(
          bundle({
            // A zone whose polygon the GAME's schema refuses: the bake reaches
            // `zoneSchema.parse` after the chunk bins are already staged.
            objects: [zoneOver(4, 4, 'zone_test', { polygon: [[0, 0]] })],
          }),
          dir,
          'test-bake',
        ),
      ).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('zone priority', () => {
  const ring = (half: number, id: string) => ({
    id,
    polygon: [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ] as [number, number][],
  });

  it('puts the smallest zone first, so a containing zone cannot shadow it', () => {
    // The Dawnsea covers the whole map and every land zone sits inside it.
    // `zoneAt` takes the FIRST match, so if the sea came first the whole world
    // would report as ocean.
    const sea = ring(1100, 'dawnsea');
    const isle = ring(400, 'dawnshore');
    const islet = ring(120, 'elder_grove');
    expect(orderZones([sea, isle, islet]).map((z) => z.id)).toEqual([
      'elder_grove',
      'dawnshore',
      'dawnsea',
    ]);
    // And it does not depend on the order they arrive in — which is exactly
    // the bug: `listObjects` returns Postgres's physical row order.
    expect(orderZones([islet, sea, isle]).map((z) => z.id)).toEqual([
      'elder_grove',
      'dawnshore',
      'dawnsea',
    ]);
  });

  it('is total — equal areas still get a stable order', () => {
    const a = { ...ring(400, 'b_zone') };
    const b = { ...ring(400, 'a_zone') };
    expect(orderZones([a, b]).map((z) => z.id)).toEqual(['a_zone', 'b_zone']);
    expect(orderZones([b, a]).map((z) => z.id)).toEqual(['a_zone', 'b_zone']);
  });

  it('measures area regardless of winding', () => {
    const cw = ring(100, 'cw');
    const ccw = { id: 'ccw', polygon: [...cw.polygon].reverse() };
    // A reversed ring is the same region; a signed area would call one of them
    // negative and sort it first.
    expect(orderZones([cw, ccw]).map((z) => z.id)).toEqual(['ccw', 'cw']);
  });
});
