/**
 * Defaults for a freshly stamped object (A3).
 *
 * Every layer needs a row that is VALID the moment it is created — the editor
 * saves on placement, and a row that fails its schema would either be refused
 * (a click that does nothing) or, worse, saved half-formed for the bake to
 * reject later. So each default here parses cleanly against the shared schema
 * and is immediately useful: a chest points at a real table, a spawner has a
 * radius you can see.
 *
 * The one thing that cannot be defaulted honestly is a REFERENCE the owner has
 * to choose — an enemy id, a loot table, a model. Those get the first legal
 * value the panel knows about, and the inspector opens on the new object so
 * the choice is the next thing in front of them.
 */

export const PLACEABLE_LAYERS = ['prop', 'spawner', 'poi', 'interactable'] as const;
export type PlaceableLayer = (typeof PLACEABLE_LAYERS)[number];

export const LAYER_LABEL: Record<string, string> = {
  prop: 'Prop',
  scatter: 'Foliage',
  spawner: 'Spawner',
  node: 'Resource node',
  npc: 'NPC',
  zone: 'Zone',
  poi: 'POI',
  interactable: 'Interactable',
};

export interface PlacementDefaults {
  /** First baked model id, for props and interactables. */
  modelRef: string;
  /** First published enemy id, for a new spawner's single entry. */
  enemyId: string;
  /** First published loot table, for a new chest. */
  lootTableId: string;
}

/**
 * Build a new row for `layer` at a world position. Returns null when the panel
 * has no legal value for a required reference — better a refusal that says why
 * than a row nobody can publish.
 */
export const newObjectDef = (
  layer: PlaceableLayer,
  id: string,
  x: number,
  z: number,
  defaults: PlacementDefaults,
): { def: Record<string, unknown> } | { error: string } => {
  const at = { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
  switch (layer) {
    case 'prop':
      if (!defaults.modelRef) return { error: 'no baked models — run the asset pipeline first' };
      return {
        def: { id, modelRef: defaults.modelRef, ...at, yOffset: 0, rotation: 0, scale: 1 },
      };
    case 'spawner':
      if (!defaults.enemyId) return { error: 'no published enemies to spawn' };
      return {
        def: {
          id,
          kind: 'area',
          ...at,
          radius: 8,
          entries: [{ enemyId: defaults.enemyId, count: 3 }],
          respawnMs: 60_000,
        },
      };
    case 'poi':
      return { def: { id, name: 'New point', kind: 'landmark', ...at, radius: 12, xpBasis: 250 } };
    case 'interactable':
      if (!defaults.modelRef) return { error: 'no baked models — run the asset pipeline first' };
      if (!defaults.lootTableId) return { error: 'no published loot tables for a chest' };
      return {
        def: {
          id,
          kind: 'chest',
          name: 'New chest',
          ...at,
          modelRef: defaults.modelRef,
          lootTableId: defaults.lootTableId,
        },
      };
    default:
      return { error: `cannot place a ${String(layer)} yet` };
  }
};
