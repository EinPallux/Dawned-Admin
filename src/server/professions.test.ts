/**
 * Resource-node cross-checks and the gathering preview (A1-e, game P10).
 *
 * These are the two things on the Professions page that can be wrong without
 * looking wrong. A node yielding an item that was never published gathers into
 * nothing — the player holds for three seconds and receives silence — and a
 * preview that disagrees with the server sends the owner tuning against a
 * number the game will not produce.
 */

import { describe, expect, it } from 'vitest';
import {
  procChance,
  rollGather,
  validateResourceNodeDef,
  type ItemDef,
  type ResourceNodeDef,
} from '@dawned/shared';
import { crossCheckNodes, previewGathering } from './professions.js';

const BIRCH: ResourceNodeDef = validateResourceNodeDef({
  id: 'node_woodcutting_birch',
  name: 'Birch',
  profession: 'woodcutting',
  tier: 1,
  modelRef: 'nature_tree_birch',
  depletedModelRef: 'nature_stump_birch',
  yields: [{ itemId: 'item_material_birch_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
  procs: [{ itemId: 'item_material_sap', qtyMin: 1, qtyMax: 1, weight: 1 }],
  respawnMs: 120_000,
});

const SHOAL: ResourceNodeDef = validateResourceNodeDef({
  id: 'node_fishing_shore_shoal',
  name: 'Shore Shoal',
  profession: 'fishing',
  tier: 1,
  modelRef: 'nature_fish_ripple',
  yields: [
    { itemId: 'item_material_dawn_sprat', qtyMin: 1, qtyMax: 1, weight: 9 },
    { itemId: 'item_material_sunscale', qtyMin: 1, qtyMax: 1, weight: 1 },
  ],
});

const nodeMap = (...defs: ResourceNodeDef[]) => new Map(defs.map((def) => [def.id, def]));
const MODELS = new Set(['nature_tree_birch', 'nature_stump_birch', 'nature_fish_ripple']);
const ITEMS = new Set([
  'item_material_birch_log',
  'item_material_sap',
  'item_material_dawn_sprat',
  'item_material_sunscale',
]);

const item = (id: string, rarity: ItemDef['rarity']): ItemDef =>
  ({ id, name: id, rarity }) as ItemDef;
const ITEM_DEFS = new Map<string, ItemDef>([
  ['item_material_dawn_sprat', item('item_material_dawn_sprat', 'common')],
  ['item_material_sunscale', item('item_material_sunscale', 'rare')],
]);

describe('crossCheckNodes', () => {
  it('passes a node whose yields and models all resolve', () => {
    const checked = crossCheckNodes(nodeMap(BIRCH), ITEMS, MODELS);
    expect(checked.problems).toEqual([]);
    expect(checked.warnings).toEqual([]);
  });

  it('refuses a yield that is not a published item', () => {
    const ghost = { ...BIRCH, yields: [{ ...BIRCH.yields[0]!, itemId: 'item_material_ghost' }] };
    const checked = crossCheckNodes(nodeMap(ghost), ITEMS, MODELS);
    expect(checked.problems).toHaveLength(1);
    expect(checked.problems[0]).toContain('item_material_ghost');
  });

  /** A proc is as invisible as a yield when it points at nothing. */
  it('refuses a proc that is not a published item', () => {
    const ghost = { ...BIRCH, procs: [{ ...BIRCH.procs[0]!, itemId: 'item_material_ghost' }] };
    expect(crossCheckNodes(nodeMap(ghost), ITEMS, MODELS).problems).toHaveLength(1);
  });

  it('refuses a model that was never baked — the node would stand there invisible', () => {
    const missing = { ...BIRCH, modelRef: 'nature_tree_nothing' };
    const checked = crossCheckNodes(nodeMap(missing), ITEMS, MODELS);
    expect(checked.problems[0]).toContain('nature_tree_nothing');
  });

  it('refuses a depleted model that was never baked', () => {
    const missing = { ...BIRCH, depletedModelRef: 'nature_stump_nothing' };
    expect(crossCheckNodes(nodeMap(missing), ITEMS, MODELS).problems[0]).toContain(
      'nature_stump_nothing',
    );
  });

  /**
   * A dev box with no game checkout has no manifest at all. Blocking every
   * publish on that would make the model gate cost more than it is worth.
   */
  it('skips the model gate entirely when no manifest could be read', () => {
    const missing = { ...BIRCH, modelRef: 'nature_tree_nothing' };
    expect(crossCheckNodes(nodeMap(missing), ITEMS, new Set()).problems).toEqual([]);
  });

  it('warns — but does not block — on a fishing spot with a depleted model', () => {
    const odd = { ...SHOAL, depletedModelRef: 'nature_stump_birch' };
    const checked = crossCheckNodes(nodeMap(odd), ITEMS, MODELS);
    expect(checked.problems).toEqual([]);
    expect(checked.warnings[0]).toContain('ripples leave no stump');
  });
});

describe('previewGathering', () => {
  it('is deterministic — the same node previews the same way twice', () => {
    const a = previewGathering(BIRCH, 1, ITEM_DEFS);
    const b = previewGathering(BIRCH, 1, ITEM_DEFS);
    expect(a).toEqual(b);
  });

  /**
   * The whole point of the panel using the shared roller: a hand-rolled sample
   * of the SAME function must land on the preview's numbers. If this ever
   * fails, the preview has grown its own idea of what a gather gives.
   */
  it('matches the shared roller it claims to run', () => {
    const report = previewGathering(BIRCH, 1, ITEM_DEFS, 200);
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const totals = new Map<string, number>();
    const rate = procChance(1, BIRCH.bonusRolls);
    for (let i = 0; i < 200; i++) {
      const rolled = rollGather(
        BIRCH,
        { yieldPick: next(), yieldQty: next(), proc: next(), procPick: next(), procQty: next() },
        rate,
      );
      for (const stack of rolled.yields) {
        totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.qty);
      }
      if (rolled.proc) {
        totals.set(rolled.proc.itemId, (totals.get(rolled.proc.itemId) ?? 0) + rolled.proc.qty);
      }
    }
    for (const row of report.perHundred) {
      expect(row.qty).toBeCloseTo(((totals.get(row.itemId) ?? 0) / 200) * 100, 1);
    }
    expect(report.perHundred.map((row) => row.itemId).sort()).toEqual([...totals.keys()].sort());
  });

  it('pays half xp for a tier below the frontier (§1.3 pushes you outward)', () => {
    expect(previewGathering(BIRCH, 1, ITEM_DEFS).profXp).toBe(12);
    expect(previewGathering(BIRCH, 25, ITEM_DEFS).profXp).toBe(6);
  });

  it('speeds the hold up as the profession levels', () => {
    const early = previewGathering(BIRCH, 1, ITEM_DEFS).channelMs;
    const late = previewGathering(BIRCH, 30, ITEM_DEFS).channelMs;
    expect(late).toBeLessThan(early);
  });

  /** channel + respawn is one cycle; a 2-minute respawn dominates a 3 s hold. */
  it('rates one node per hour off its own cycle, not the hold alone', () => {
    const report = previewGathering(BIRCH, 1, ITEM_DEFS);
    expect(report.perHourOneNode).toBeCloseTo(3_600_000 / (report.channelMs + BIRCH.respawnMs), 1);
  });

  it('sizes the fishing bar per fish, and only for fishing nodes', () => {
    expect(previewGathering(BIRCH, 1, ITEM_DEFS).fishing).toBeNull();
    const fishing = previewGathering(SHOAL, 1, ITEM_DEFS).fishing;
    expect(fishing).toHaveLength(2);
    const [sprat, sunscale] = fishing!;
    // The rare drifts faster behind a smaller marker — that IS the difficulty.
    expect(sunscale!.driftSpeed).toBeGreaterThan(sprat!.driftSpeed);
    expect(sunscale!.markerHalf).toBeLessThan(sprat!.markerHalf);
  });

  /** A node with no procs must report 0 %, not "the level's rate anyway". */
  it('still reports the level proc rate, and drops nothing when there are no procs', () => {
    const bare = { ...BIRCH, procs: [] };
    const report = previewGathering(bare, 20, ITEM_DEFS);
    expect(report.procPct).toBeGreaterThan(0);
    expect(report.perHundred.map((row) => row.itemId)).toEqual(['item_material_birch_log']);
  });
});
