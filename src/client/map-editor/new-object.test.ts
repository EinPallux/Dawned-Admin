/**
 * Placement defaults (A3-a/A3-c).
 *
 * The claim this file makes is "a freshly stamped row is VALID" — if it is
 * not, the click either does nothing or writes a row the bake rejects hours
 * later. So every layer and every interactable kind is parsed through the
 * shared schema here, which is the same gate publish runs.
 */

import { describe, expect, it } from 'vitest';
import {
  interactableSchema,
  nodePlacementSchema,
  poiSchema,
  propPlacementSchema,
  spawnerDefSchema,
  validateInteractable,
} from '@dawned/shared';
import { INTERACTABLE_KINDS, newObjectDef, type PlacementDefaults } from './new-object.js';

const defaults: PlacementDefaults = {
  modelRef: 'world_nature_tree_1_a_color1',
  models: ['world_nature_rock_1_a_color1', 'world_nature_tree_1_a_color1'],
  enemyId: 'enemy_glub',
  nodeIds: ['node_woodcutting_birch'],
  lootTableId: 'loot_shore_common',
};

const def = (result: ReturnType<typeof newObjectDef>): Record<string, unknown> => {
  if ('error' in result) throw new Error(`expected a row, got refusal: ${result.error}`);
  return result.def;
};

describe('a new row is valid the moment it is stamped', () => {
  it('prop', () => {
    expect(() =>
      propPlacementSchema.parse(def(newObjectDef('prop', 'prop_1', 10, -20, defaults))),
    ).not.toThrow();
  });

  it('spawner', () => {
    expect(() =>
      spawnerDefSchema.parse(def(newObjectDef('spawner', 'spawner_1', 10, -20, defaults))),
    ).not.toThrow();
  });

  it('poi', () => {
    expect(() =>
      poiSchema.parse(def(newObjectDef('poi', 'poi_1', 10, -20, defaults))),
    ).not.toThrow();
  });

  /**
   * A resource node's placement is thin on purpose — the tool bar's picker has
   * already made the only decision, and it must reach the row. A stamp that
   * dropped `nodeId` would parse fine as a shape and place nothing in the game.
   */
  it('resource node, carrying the kind the picker chose', () => {
    const row = def(
      newObjectDef('node', 'node_1', 10, -20, defaults, undefined, 'node_mining_copper'),
    );
    expect(() => nodePlacementSchema.parse(row)).not.toThrow();
    expect(row.nodeId).toBe('node_mining_copper');
  });

  it('resource node, defaulting to the first published definition', () => {
    const row = def(newObjectDef('node', 'node_1', 10, -20, defaults));
    expect(row.nodeId).toBe(defaults.nodeIds[0]);
  });

  it('every interactable kind — schema AND the per-kind rules', () => {
    for (const kind of INTERACTABLE_KINDS) {
      const row = interactableSchema.parse(
        def(newObjectDef('interactable', `int_${kind}`, 12, 34, defaults, kind)),
      );
      expect(row.kind).toBe(kind);
      // The rules the flat schema cannot express: a chest needs a table, a
      // portal a destination, a signpost words.
      expect(validateInteractable(row)).toEqual([]);
    }
  });
});

describe('kind-specific intent', () => {
  it('a new shrine joins the travel graph', () => {
    const row = interactableSchema.parse(
      def(newObjectDef('interactable', 'int_shrine', 0, 0, defaults, 'shrine')),
    );
    expect(row.travelNode).toBe(true);
  });

  it('a new portal points at itself, visibly, rather than somewhere invented', () => {
    const row = interactableSchema.parse(
      def(newObjectDef('interactable', 'int_portal', 40, -8, defaults, 'portal')),
    );
    expect([row.destX, row.destZ]).toEqual([40, -8]);
  });

  it('picks the closest baked model to the kind when one exists', () => {
    // The shrine hint matches "rock" — the nearest stone-ish thing baked.
    const row = def(newObjectDef('interactable', 'int_shrine', 0, 0, defaults, 'shrine'));
    expect(row.modelRef).toBe('world_nature_rock_1_a_color1');
  });

  it('falls back to the first model rather than refusing when nothing matches', () => {
    const row = def(newObjectDef('interactable', 'int_fire', 0, 0, defaults, 'campfire'));
    expect(row.modelRef).toBe(defaults.modelRef);
  });
});

const refusal = (result: ReturnType<typeof newObjectDef>): string => {
  if (!('error' in result)) throw new Error('expected a refusal, got a row');
  return result.error;
};

describe('refusals say what is missing', () => {
  it('a chest with no published loot table', () => {
    expect(
      refusal(newObjectDef('interactable', 'int_chest', 0, 0, { ...defaults, lootTableId: '' })),
    ).toMatch(/loot table/);
  });

  it('anything modelled, with no baked models', () => {
    expect(
      refusal(newObjectDef('prop', 'prop_1', 0, 0, { ...defaults, modelRef: '', models: [] })),
    ).toMatch(/baked models/);
  });

  it('a spawner with no published enemies', () => {
    expect(
      refusal(newObjectDef('spawner', 'spawner_1', 0, 0, { ...defaults, enemyId: '' })),
    ).toMatch(/enemies/);
  });

  it('a resource node with nothing published to place', () => {
    expect(refusal(newObjectDef('node', 'node_1', 0, 0, { ...defaults, nodeIds: [] }))).toMatch(
      /resource nodes/,
    );
  });
});
