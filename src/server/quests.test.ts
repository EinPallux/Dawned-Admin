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
import { chainGraph, crossCheckQuests, previewQuest } from './quests.js';

const MARLA: NpcDef = validateNpcDef({
  id: 'npc_marla',
  name: 'Marla',
  title: 'Dawnhaven gate farmer',
  role: 'quest_giver',
  modelRef: 'characters_villager_f',
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
  models: Set<string>;
}

const defaults = (): CheckContext => ({
  npcs: new Map([[MARLA.id, MARLA]]),
  items: new Set(['item_food_marlas_preserves']),
  enemies: new Set(['enemy_bog_blob']),
  models: new Set(['characters_villager_f']),
});

const check = (quests: QuestDef[], over: Partial<CheckContext> = {}) => {
  const base = defaults();
  const c: CheckContext = {
    npcs: over.npcs ?? base.npcs,
    items: over.items ?? base.items,
    enemies: over.enemies ?? base.enemies,
    models: over.models ?? base.models,
  };
  return crossCheckQuests(
    new Map(quests.map((q) => [q.id, q])),
    c.npcs,
    c.items,
    c.enemies,
    c.models,
  );
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

  it('blocks an NPC model that is not baked', () => {
    expect(check([quest()], { models: new Set(['something_else']) }).problems.join(' ')).toContain(
      'baked asset manifest',
    );
  });

  /**
   * An empty manifest means no game checkout is reachable (a bare dev box).
   * Blocking every publish on that would be worse than the gate is worth.
   */
  it('skips the model gate when no manifest is readable', () => {
    expect(check([quest()], { models: new Set() }).problems).toEqual([]);
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
