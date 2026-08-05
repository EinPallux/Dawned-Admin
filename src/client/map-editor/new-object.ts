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

/**
 * The `F`-prompt furniture, in the order the owner reaches for it. Mirrors
 * `interactableSchema`'s enum — the kinds differ in which optional fields they
 * require, so each gets its own set of defaults below rather than one row
 * shape the owner has to repair per kind.
 */
export const INTERACTABLE_KINDS = [
  'chest',
  'shrine',
  'campfire',
  'signpost',
  'portal',
  'quest_prop',
] as const;
export type InteractableKind = (typeof INTERACTABLE_KINDS)[number];

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
  /** Every baked model id, so a kind can pick the closest match to itself. */
  models: readonly string[];
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
  kind: InteractableKind = 'chest',
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
      return newInteractable(kind, id, at, defaults);
    default:
      return { error: `cannot place a ${String(layer)} yet` };
  }
};

/**
 * Kind-specific defaults for a new interactable.
 *
 * `validateInteractable` (shared) rejects a chest with no table, a portal with
 * no destination and a signpost with nothing written on it, so each of those
 * ships with a legal starting value. A portal points at ITSELF on creation:
 * that is valid, obviously wrong at a glance, and the inspector is already open
 * — better than silently choosing somewhere for the owner.
 */
const newInteractable = (
  kind: InteractableKind,
  id: string,
  at: { x: number; z: number },
  defaults: PlacementDefaults,
): { def: Record<string, unknown> } | { error: string } => {
  if (!defaults.modelRef) return { error: 'no baked models — run the asset pipeline first' };
  const base = { id, kind, ...at, modelRef: modelFor(kind, defaults), yOffset: 0, rotation: 0 };
  switch (kind) {
    case 'chest':
      if (!defaults.lootTableId) return { error: 'no published loot tables for a chest' };
      return { def: { ...base, name: 'New chest', lootTableId: defaults.lootTableId } };
    case 'shrine':
      // On the graph by default: a shrine that is only a respawn point is the
      // rarer intent, and the panel warns about the ones left off it.
      return { def: { ...base, name: 'New shrine', travelNode: true } };
    case 'campfire':
      return { def: { ...base, name: 'Campfire' } };
    case 'signpost':
      return { def: { ...base, name: 'Signpost', text: 'This way.' } };
    case 'portal':
      return { def: { ...base, name: 'Portal', destX: at.x, destZ: at.z } };
    case 'quest_prop':
      return { def: { ...base, name: 'Quest prop', text: '' } };
  }
};

/**
 * The closest baked model to what this kind wants.
 *
 * The world pack is nature props today — there is no shrine mesh until the
 * interactable phase bakes one — so this matches on the id and otherwise takes
 * the first model. The row stays valid either way and the reference is one
 * dropdown away in the inspector; a placement that REFUSED because the art is
 * not baked yet would block the map work that has to happen first.
 */
const MODEL_HINTS: Record<InteractableKind, RegExp> = {
  chest: /chest|crate|barrel/i,
  shrine: /shrine|monument|obelisk|statue|stone|rock/i,
  campfire: /campfire|fire|log/i,
  signpost: /sign|post|pole/i,
  portal: /portal|arch|gate/i,
  quest_prop: /prop|crate|barrel/i,
};

const modelFor = (kind: InteractableKind, defaults: PlacementDefaults): string =>
  defaults.models.find((model) => MODEL_HINTS[kind].test(model)) ?? defaults.modelRef;
