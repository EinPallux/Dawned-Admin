/**
 * Quest publish cross-checks and the previews (A4).
 *
 * The interesting cases are the ones where a quest is SCHEMA-valid and still
 * broken in the world: a giver who does not exist, a reward item nobody
 * published, a chain link pointing at nothing. Those are what the publish rail
 * is for — the zod parse already caught everything it can.
 */

import { describe, expect, it } from 'vitest';
import { validateNpcDef, validateQuestDef, type NpcDef, type QuestDef } from '@dawned/shared';
import { chainGraph, crossCheckQuests, previewQuest, type QuestHintWorld } from './quests.js';

const MARLA: NpcDef = validateNpcDef({
  id: 'npc_marla',
  name: 'Marla',
  title: 'Dawnhaven gate farmer',
  role: 'quest_giver',
  appearance: {
    body: 'f',
    skin: 1,
    outfit: 'peasant',
    outfitTint: 0,
    hair: 'buns',
    hairColor: 2,
    beard: false,
  },
  barkCooldownSec: 0,
});

const quest = (over: Record<string, unknown> = {}): QuestDef =>
  validateQuestDef({
    id: 'quest_shore_boil_trouble',
    name: 'Boil Trouble',
    zoneId: 'zone_dawnshore',
    suggestedLevel: 3,
    giver: { kind: 'npc', npcId: 'npc_marla' },
    journalText: "Marla's fence posts are dissolving.",
    steps: [{ type: 'kill', enemyId: 'enemy_bog_blob', count: 8, trackerText: 'Bog Blobs slain' }],
    rewards: { xp: 220, gold: 35 },
    ...over,
  });

interface CheckContext {
  npcs: Map<string, NpcDef>;
  items: Set<string>;
  enemies: Set<string>;
}

const defaults = (): CheckContext => ({
  npcs: new Map([[MARLA.id, MARLA]]),
  items: new Set(['item_food_marlas_preserves']),
  enemies: new Set(['enemy_bog_blob']),
});

const check = (quests: QuestDef[], over: Partial<CheckContext> = {}) => {
  const base = defaults();
  const c: CheckContext = {
    npcs: over.npcs ?? base.npcs,
    items: over.items ?? base.items,
    enemies: over.enemies ?? base.enemies,
  };
  return crossCheckQuests(new Map(quests.map((q) => [q.id, q])), c.npcs, c.items, c.enemies);
};

describe('publish cross-checks', () => {
  it('passes a well-formed quest', () => {
    expect(check([quest()]).problems).toEqual([]);
  });

  /**
   * A giver who does not exist is a conversation that never opens. The game's
   * loader refuses to boot on it, so publish has to refuse first — otherwise
   * the failure lands at the next server restart instead of at the button.
   */
  it('blocks a quest whose giver is not published', () => {
    const orphan = quest({ giver: { kind: 'npc', npcId: 'npc_nobody' }, turnInNpcId: 'npc_marla' });
    expect(check([orphan]).problems.join(' ')).toContain('npc_nobody');
  });

  it('blocks a reward item nobody published', () => {
    const broken = quest({
      rewards: { xp: 100, gold: 10, items: [{ itemId: 'item_ghost', qty: 1 }] },
    });
    expect(check([broken]).problems.join(' ')).toContain('item_ghost');
  });

  it('blocks a kill step naming an enemy that does not exist', () => {
    const broken = quest({
      steps: [{ type: 'kill', enemyId: 'enemy_nope', count: 1, trackerText: 'Kill it' }],
    });
    expect(check([broken]).problems.join(' ')).toContain('enemy_nope');
  });

  it('blocks a chain link whose prerequisite is not published', () => {
    const link = quest({ prerequisites: { questIds: ['quest_missing'] } });
    expect(check([link]).problems.join(' ')).toContain('quest_missing');
  });

  /** The game's own flow validator runs here — not a copy of it. */
  it('blocks a quest the game itself would refuse to load', () => {
    const broken = quest({
      steps: [{ type: 'kill', count: 3, trackerText: 'Kill things' }],
    });
    expect(check([broken]).problems.join(' ')).toContain('enemyId or an enemyTag');
  });

  it('warns — never blocks — on a quest that pays nothing', () => {
    const stingy = quest({ rewards: { xp: 0, gold: 0 } });
    const result = check([stingy]);
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toContain('pays nothing');
  });

  it('warns about a chain member nothing links to', () => {
    const orphanLink = quest({ chainId: 'chain_silence' });
    expect(check([orphanLink]).warnings.join(' ')).toContain('nothing links to or from it');
  });

  it('warns about a quest giver no quest names', () => {
    const spare = validateNpcDef({ ...MARLA, id: 'npc_spare', name: 'Spare' });
    const result = check([quest()], {
      npcs: new Map([
        [MARLA.id, MARLA],
        [spare.id, spare],
      ]),
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toContain('npc_spare');
  });
});

/**
 * The check that most needed writing. A hint circle is typed on THIS page while
 * the thing it points at is placed on the enemies page or on the map, so the
 * two were never compared — and the P11 pilot set shipped with four kill
 * circles 85–170 m from their only spawner. Every fixture below is one of those
 * real numbers, so a regression reads as the bug that actually happened.
 */
describe('hint circles vs. where things really stand', () => {
  const world = (over: Partial<QuestHintWorld> = {}): QuestHintWorld => ({
    spawns: new Map(),
    objects: [],
    nodes: [],
    npcs: new Map(),
    ...over,
  });

  const withHint = (hint: { x: number; z: number; radius: number } | null) =>
    quest({
      steps: [
        { type: 'kill', enemyId: 'enemy_bog_blob', count: 8, trackerText: 'Bog Blobs slain', hint },
      ],
    });

  const checkWorld = (def: QuestDef, w: QuestHintWorld) => {
    const base = defaults();
    return crossCheckQuests(
      new Map([[def.id, def]]),
      base.npcs,
      base.items,
      base.enemies,
      new Set(),
      w,
    );
  };

  it('warns, with metres, when the circle contains no spawner', () => {
    // The shipped `quest_shore_boil_trouble`: circle at (-70, 210) r80, and the
    // only bog-blob spawner at (-20, 290) — 94 m out, 14 m past the rim.
    const result = checkWorld(
      withHint({ x: -70, z: 210, radius: 80 }),
      world({ spawns: new Map([['enemy_bog_blob', [{ x: -20, z: 290 }]]]) }),
    );
    expect(result.problems).toEqual([]);
    const warning = result.warnings.find((line) => line.includes('hint circle'));
    expect(warning).toContain('94 m away');
    expect(warning).toContain('14 m outside');
  });

  it('says nothing when the spawner is inside the ring', () => {
    const result = checkWorld(
      withHint({ x: -20, z: 290, radius: 30 }),
      world({ spawns: new Map([['enemy_bog_blob', [{ x: -20, z: 290 }]]]) }),
    );
    expect(result.warnings.filter((line) => line.includes('hint circle'))).toEqual([]);
  });

  /**
   * "Not placed yet" and "placed somewhere else" are different states, and only
   * the second is a mistake. Warning on the first would fire for everyone the
   * first time they author a quest ahead of the map.
   */
  it('stays quiet when nothing is placed to compare against', () => {
    const result = checkWorld(withHint({ x: 0, z: 0, radius: 10 }), world());
    expect(result.warnings.filter((line) => line.includes('hint circle'))).toEqual([]);
  });

  it('resolves a gather step to the patches that grow the item, not to every node', () => {
    const def = quest({
      steps: [
        {
          type: 'collect',
          itemId: 'item_material_mossbloom',
          count: 5,
          source: 'gather',
          trackerText: 'Mossbloom gathered',
          hint: { x: -104, z: 104, radius: 30 },
        },
      ],
    });
    const result = checkWorld(
      def,
      world({
        nodes: [
          // Birch stands right under the circle and is the wrong plant.
          { itemIds: ['item_material_birchwood_log'], x: -104, z: 104 },
          { itemIds: ['item_material_mossbloom'], x: -143, z: -257 },
        ],
      }),
    );
    expect(result.warnings.find((line) => line.includes('hint circle'))).toContain('363 m away');
  });

  it('matches an interact step by objectTag, which is the object NAME', () => {
    const def = quest({
      steps: [
        {
          type: 'interact',
          objectTag: 'Marked Stump',
          count: 4,
          trackerText: 'Marked stumps inspected',
          hint: { x: -104, z: 104, radius: 40 },
        },
      ],
    });
    const result = checkWorld(
      def,
      world({
        objects: [
          { id: 'prop_weald_stump_1', name: 'Marked Stump', x: -104, z: 104 },
          { id: 'chest_shore_lostnet', name: "Torv's Lost Crate", x: 62, z: 232 },
        ],
      }),
    );
    expect(result.warnings.filter((line) => line.includes('hint circle'))).toEqual([]);
  });

  it('leaves a tagged kill step alone — a spawner row cannot answer for a tag', () => {
    const def = quest({
      steps: [
        {
          type: 'kill',
          enemyTag: 'weald',
          count: 3,
          trackerText: 'Weald things',
          hint: { x: 0, z: 0, radius: 12 },
        },
      ],
    });
    const result = checkWorld(
      def,
      world({ spawns: new Map([['enemy_bog_blob', [{ x: 900, z: 900 }]]]) }),
    );
    expect(result.warnings.filter((line) => line.includes('hint circle'))).toEqual([]);
  });
});

describe('the chain graph', () => {
  /**
   * Built from PREREQUISITES, not from chainId. The chain id is a label for
   * the journal's grouping; the order is what the game gates on, and a graph
   * drawn from the label would disagree with the gate.
   */
  it('draws the links the game actually enforces', () => {
    const first = quest({ id: 'quest_weald_silence_1', chainId: 'chain_silence' });
    const second = quest({
      id: 'quest_weald_silence_2',
      chainId: 'chain_silence',
      prerequisites: { questIds: ['quest_weald_silence_1'] },
    });
    const graph = chainGraph(
      new Map([
        [first.id, first],
        [second.id, second],
      ]),
      'chain_silence',
    );
    expect(graph.find((node) => node.questId === first.id)?.unlocks).toEqual([second.id]);
    expect(graph.find((node) => node.questId === second.id)?.requires).toEqual([first.id]);
  });
});

describe('the quest preview', () => {
  const items = new Map([['item_food_marlas_preserves', { name: "Marla's Preserves" }]]);

  it('renders the journal, the tracker and who to see', () => {
    const preview = previewQuest(quest(), new Map([[MARLA.id, MARLA]]), items);
    expect(preview.journal.prose).toContain('fence posts');
    expect(preview.tracker[0]).toMatchObject({ text: 'Bog Blobs slain', need: 8, type: 'kill' });
    expect(preview.flow.giver).toBe('Marla');
    expect(preview.flow.turnIn).toBe('Marla');
  });

  /** A missing NPC has to be VISIBLE in the preview, not silently blank. */
  it('says so when the giver is missing rather than rendering an empty name', () => {
    const preview = previewQuest(quest(), new Map(), items);
    expect(preview.flow.giver).toContain('missing');
  });

  it('puts the ƒ-suggested reward beside what is authored', () => {
    const preview = previewQuest(quest(), new Map([[MARLA.id, MARLA]]), items);
    expect(preview.rewards.xp).toBe(220);
    expect(preview.rewards.suggestedXp).toBeGreaterThan(0);
    expect(preview.rewards.suggestedGold).toBeGreaterThan(0);
  });

  it('shows an explore step as a clue with no marker', () => {
    const explorer = quest({
      steps: [
        {
          type: 'explore',
          x: 10,
          z: 10,
          radius: 30,
          clueText: 'Where the gulls circle.',
          trackerText: 'Find the point',
        },
      ],
    });
    const preview = previewQuest(explorer, new Map([[MARLA.id, MARLA]]), items);
    expect(preview.tracker[0]?.hint).toBe(false);
    expect(preview.tracker[0]?.clue).toBe('Where the gulls circle.');
  });

  it('lists the gates a player has to clear first', () => {
    const gated = quest({
      prerequisites: { level: 8, questIds: ['quest_a'], discoveryIds: ['poi_grove'] },
    });
    const preview = previewQuest(gated, new Map([[MARLA.id, MARLA]]), items);
    expect(preview.flow.gates).toEqual(['level 8', 'after quest_a', 'found poi_grove']);
  });

  it("surfaces the game's own flow problems on the page", () => {
    const broken = quest({
      steps: [{ type: 'kill', count: 3, trackerText: 'Kill things' }],
    });
    const preview = previewQuest(broken, new Map([[MARLA.id, MARLA]]), items);
    expect(preview.problems.length).toBeGreaterThan(0);
  });
});
