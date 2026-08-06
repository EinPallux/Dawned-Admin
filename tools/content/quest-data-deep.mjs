/**
 * The rest of the Dawnlands' quests (game P12-F) — data only.
 *
 * Twenty quests across five regions, completing CONTENT_0.1 §5's 28 with P11's
 * eight. Every one of the eleven quest givers P12-F placed gets work to offer;
 * four new chains join the Weald's, one per main zone.
 *
 * **A hint circle is DERIVED here, never typed.** P11-E's DoD run found four of
 * the pilot's five kill hints pointing 85–170 m from their only spawner, because
 * the circle is authored on one page and the spawner is placed on another and
 * nothing had ever compared them. `questHintCoverage` catches that at publish,
 * which is a good backstop and still the wrong place to find out. So a step
 * declares WHAT it points at — `target: { enemy: 'enemy_grave_wisp' }` — and
 * `author-deep-quests.mjs` resolves that against the live map draft and computes
 * a circle that provably contains it. A hint cannot point at nothing, because it
 * is built from the thing it points at.
 *
 * Two rules from earlier phases that this set obeys:
 *  - **`count` on a deliver step is the STACK SIZE, not the number of
 *    conversations** (P11-C). The target is always 1.
 *  - **Nothing a quest step needs may be one-shot** (Q29). Every interactable
 *    named below is one of P12-F's respawning chests.
 */

const line = (id, npcId, text, choices, emote = '') => ({ id, npcId, text, emote, choices });
const accept = (text) => ({ text, action: 'accept', goto: '' });
const decline = { text: 'Not just now.', action: 'decline', goto: '' };
const turnIn = (text) => ({ text, action: 'turn_in', goto: '' });
const close = (text) => ({ text, action: 'close', goto: '' });

/**
 * One giver, one offer, one completion — the shape most of these take.
 * `steps` carry a `target` spec instead of a `hint`; the script fills the hint.
 */
const quest = (over) => ({
  repeatable: false,
  chainId: '',
  turnInNpcId: over.giver?.npcId ?? null,
  prerequisites: { level: 1, questIds: [], discoveryIds: [] },
  rewards: { xp: 0, gold: 0, items: [], choices: [], title: '' },
  trackable: true,
  ...over,
});

/** `kill`, with the hint derived from the spawners that really roll it. */
const kill = (enemyId, count, trackerText) => ({
  type: 'kill',
  enemyId,
  enemyTag: null,
  count,
  trackerText,
  target: { enemy: enemyId },
  hooks: [],
});

/** `collect`, hinted at the resource node whose yield it is. */
const collect = (itemId, count, trackerText, nodeId) => ({
  type: 'collect',
  itemId,
  count,
  source: 'any',
  trackerText,
  target: { node: nodeId },
  hooks: [],
});

const talkTo = (npcId, trackerText) => ({
  type: 'talk',
  npcId,
  trackerText,
  target: { npc: npcId },
  hooks: [],
});

/** `interact` with a specific placed object — always a respawning one (Q29). */
const useObject = (objectId, trackerText) => ({
  type: 'interact',
  objectId,
  objectTag: null,
  count: 1,
  trackerText,
  target: { object: objectId },
  hooks: [],
});

/**
 * `explore` — the ONE step type that never gets a circle (QUESTS_POI §1 rule 4:
 * finding the place IS the objective). Its x/z are still derived from the real
 * POI, so the clue and the destination cannot drift apart.
 */
const explore = (poiId, radius, clueText, trackerText) => ({
  type: 'explore',
  x: 0,
  z: 0,
  radius,
  clueText,
  trackerText,
  target: { poi: poiId },
  hooks: [],
});

export const DEEP_QUEST_DEFS = [
  // ================================================================ Dawnshore
  // Lissa's two-part road chain, plus Odo's timber run. P11 already gave the
  // shore four one-offs, so this is what it was missing: a chain of its own.
  quest({
    id: 'quest_shore_road_1',
    name: 'The Weald Road',
    zoneId: 'dawnshore',
    chainId: 'chain_shore_road',
    suggestedLevel: 4,
    giver: { kind: 'npc', npcId: 'npc_lissa' },
    prerequisites: { level: 3, questIds: [], discoveryIds: [] },
    steps: [kill('enemy_bandit_forager', 6, 'Foragers driven off')],
    rewards: { xp: 260, gold: 40, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_lissa',
          'Foragers have been working the Weald road since the thaw. They take a toll nobody agreed to pay.',
          [
            accept('I will clear the road.'),
            { text: 'Foragers?', action: 'goto', goto: 'lore' },
            decline,
          ],
        ),
        line(
          'lore',
          'npc_lissa',
          'Bandits with a nicer word for it. Six of them, near the treeline.',
          [accept('I will clear the road.'), decline],
        ),
      ],
      inProgress: [line('wait', 'npc_lissa', 'Road still theirs?', [close('Working on it.')])],
      complete: [
        line(
          'done',
          'npc_lissa',
          'That is the first honest week the road has had. There is more.',
          [turnIn('Tell me.')],
        ),
      ],
    },
    journalText:
      'Lissa keeps the Weald road open on her own. Bandits have been taking a toll on it; she would like them not to.',
  }),

  quest({
    id: 'quest_shore_road_2',
    name: 'What the Road Owes',
    zoneId: 'dawnshore',
    chainId: 'chain_shore_road',
    suggestedLevel: 6,
    giver: { kind: 'npc', npcId: 'npc_lissa' },
    prerequisites: { level: 4, questIds: ['quest_shore_road_1'], discoveryIds: [] },
    steps: [
      useObject('chest_shore_3', "Smuggler's Chest opened"),
      talkTo('npc_lissa', 'Report back to Lissa'),
    ],
    rewards: {
      xp: 420,
      gold: 70,
      items: [{ itemId: 'item_consumable_potion_minor', qty: 3 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_lissa',
          'They kept a chest in the hollow above the road. Whatever is in it was taken off travellers. Bring it back to the road.',
          [accept('I will find it.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_lissa', 'The hollow is off the north side. Look for the dug ground.', [
          close('On my way.'),
        ]),
      ],
      complete: [
        line('done', 'npc_lissa', 'Good. Some of this goes back to people who will recognise it.', [
          turnIn('Then it is where it belongs.'),
        ]),
      ],
    },
    journalText:
      'The foragers kept a chest above the road. Lissa wants what is in it returned to the people it came from.',
  }),

  quest({
    id: 'quest_shore_green_timber',
    name: 'Green Timber',
    zoneId: 'dawnshore',
    suggestedLevel: 3,
    giver: { kind: 'npc', npcId: 'npc_odo' },
    steps: [
      collect('item_material_birchwood_log', 8, 'Birchwood gathered', 'node_woodcutting_birch'),
    ],
    rewards: { xp: 200, gold: 55, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_odo',
          'I need birch, and I need it cut this week, not last. Eight good lengths and I will pay over the shore price.',
          [accept('I can cut that.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_odo', 'Green wood warps. Cut it fresh.', [close('Understood.')]),
      ],
      complete: [
        line('done', 'npc_odo', 'That will hold a hull. My thanks.', [turnIn('Good sailing.')]),
      ],
    },
    journalText: 'Odo the shipwright needs eight lengths of freshly cut birch.',
  }),

  // ============================================================ Verdant Weald
  quest({
    id: 'quest_weald_the_ring_hums',
    name: 'The Ring Hums',
    zoneId: 'verdant_weald',
    suggestedLevel: 9,
    giver: { kind: 'npc', npcId: 'npc_niamh' },
    prerequisites: { level: 8, questIds: [], discoveryIds: [] },
    steps: [
      explore(
        'poi_stone_circle',
        40,
        'Niamh says the old ring stands where the oaks thin, north and west of Mosshollow. You will hear it before you see it.',
        'Find the Green Ring',
      ),
      kill('enemy_gloom_ghost', 5, 'Gloom Ghosts dispersed'),
    ],
    rewards: {
      xp: 640,
      gold: 90,
      items: [{ itemId: 'item_consumable_potion_lesser', qty: 2 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_niamh',
          'The ring has been humming three nights running. That means something is standing in it that should not be.',
          [
            accept('I will go and look.'),
            { text: 'What stands in it?', action: 'goto', goto: 'lore' },
            decline,
          ],
        ),
        line(
          'lore',
          'npc_niamh',
          'Gloom. The Weald keeps its dead badly. Disperse them and the humming stops.',
          [accept('I will go and look.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_niamh', 'You will hear it before you see it. Follow the sound.', [
          close('I will.'),
        ]),
      ],
      complete: [
        line('done', 'npc_niamh', 'Quiet again. It will not stay quiet, but it is quiet now.', [
          turnIn('Until next time.'),
        ]),
      ],
    },
    journalText:
      'Niamh the hedge witch says the old stone ring has been humming for three nights. Something is standing in it.',
  }),

  // =============================================================== Emberwood
  // Brann's three-part chain: the dead are walking, and somebody dug them up.
  quest({
    id: 'quest_ember_restless_1',
    name: 'They Do Not Stay',
    zoneId: 'emberwood',
    chainId: 'chain_ember_restless',
    suggestedLevel: 13,
    giver: { kind: 'npc', npcId: 'npc_brann' },
    prerequisites: { level: 12, questIds: [], discoveryIds: [] },
    steps: [kill('enemy_skeleton_minion', 8, 'Walking dead put down')],
    rewards: { xp: 900, gold: 120, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_brann',
          'I bury them deep. Third one this month walked home. Put down eight of them for me and I will start believing it is not my digging.',
          [accept('I will put them down.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_brann', 'They come up where the ground is loosest. The barrow field.', [
          close('I know it.'),
        ]),
      ],
      complete: [
        line('done', 'npc_brann', 'Eight. And still they come. It is not my digging.', [
          turnIn('No. It is not.'),
        ]),
      ],
    },
    journalText:
      'Brann the gravedigger buries them deep and they walk home anyway. He wants eight of them put down.',
  }),

  quest({
    id: 'quest_ember_restless_2',
    name: 'What the Ash Keeps',
    zoneId: 'emberwood',
    chainId: 'chain_ember_restless',
    suggestedLevel: 15,
    giver: { kind: 'npc', npcId: 'npc_brann' },
    prerequisites: { level: 13, questIds: ['quest_ember_restless_1'], discoveryIds: [] },
    steps: [
      collect('item_material_cinderleaf', 6, 'Cinderleaf gathered', 'node_herbalism_cinderleaf'),
      useObject('chest_ember_3', 'Grave Goods opened'),
    ],
    rewards: {
      xp: 1250,
      gold: 170,
      items: [{ itemId: 'item_consumable_potion_lesser', qty: 3 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_brann',
          'Cinderleaf burns on a grave and keeps what is under it under it. Six should do. And somebody left goods in the ground that were never buried with anyone — look in the barrows.',
          [accept('Cinderleaf and the barrows.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_brann', 'Six leaves. And whatever is in that barrow.', [
          close('Still looking.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_brann',
          'Marauder tools. In a grave. They have been digging my dead up on purpose.',
          [turnIn('Then somebody is paying them.')],
        ),
      ],
    },
    journalText:
      'Brann wants cinderleaf to settle the graves — and something was left in the barrows that was never buried with anyone.',
  }),

  quest({
    id: 'quest_ember_restless_3',
    name: 'The Bonelord',
    zoneId: 'emberwood',
    chainId: 'chain_ember_restless',
    suggestedLevel: 17,
    giver: { kind: 'npc', npcId: 'npc_brann' },
    prerequisites: { level: 15, questIds: ['quest_ember_restless_2'], discoveryIds: [] },
    steps: [kill('enemy_bonelord_varkas', 1, 'Bonelord Varkas destroyed')],
    rewards: {
      xp: 2400,
      gold: 380,
      items: [],
      choices: [
        { classId: 'warrior', itemId: 'item_weapon_hammer_barrow', qty: 1 },
        { classId: 'mage', itemId: 'item_weapon_wand_ashenfocus', qty: 1 },
        { classId: 'rogue', itemId: 'item_weapon_sword_barrowsteel', qty: 1 },
        { classId: 'cleric', itemId: 'item_weapon_mace_pyre', qty: 1 },
      ],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_brann',
          'There is a thing at the top of the barrow field wearing my dead like a coat. Varkas. End him and they lie still.',
          [accept('Then he ends.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_brann', 'He does not hide. He is waiting for you to be stupid.', [
          close('Noted.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_brann',
          'Quiet ground. First time in a year. Take your pick of what he had.',
          [turnIn('I will.')],
        ),
      ],
    },
    journalText:
      "The marauders were digging for Varkas, and Varkas has been wearing Brann's dead. He is at the top of the barrow field.",
  }),

  quest({
    id: 'quest_ember_barrow_diggers',
    name: 'The Barrow Diggers',
    zoneId: 'emberwood',
    suggestedLevel: 14,
    giver: { kind: 'npc', npcId: 'npc_orin' },
    prerequisites: { level: 12, questIds: [], discoveryIds: [] },
    steps: [kill('enemy_ashen_marauder', 10, 'Marauders driven from the barrows')],
    rewards: { xp: 1050, gold: 160, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_orin',
          'The marauders dig where they should not, and they are paid to. Ten of them off the barrows and they may reconsider the wage.',
          [accept('Ten it is.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_orin', 'They work the stakes east of the field. Loudly.', [
          close('Good.'),
        ]),
      ],
      complete: [
        line('done', 'npc_orin', 'They will send more. But not this week.', [
          turnIn('This week will do.'),
        ]),
      ],
    },
    journalText:
      'Orin the barrow warden says the marauders dig where they should not, and are paid to.',
  }),

  quest({
    id: 'quest_ember_wisplight',
    name: 'Wisplight',
    zoneId: 'emberwood',
    suggestedLevel: 15,
    giver: { kind: 'npc', npcId: 'npc_orin' },
    prerequisites: { level: 14, questIds: ['quest_ember_barrow_diggers'], discoveryIds: [] },
    steps: [kill('enemy_grave_wisp', 6, 'Grave Wisps snuffed')],
    rewards: {
      xp: 1200,
      gold: 175,
      items: [{ itemId: 'item_consumable_elixir_ember', qty: 1 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_orin',
          'The lights over the field are not lamps. They follow the diggers and they do not follow me, which tells you something.',
          [accept('I will snuff them.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_orin', 'Six of them. Do not follow one.', [close('I will not.')]),
      ],
      complete: [
        line('done', 'npc_orin', 'Dark field. That is how it should look.', [turnIn('Agreed.')]),
      ],
    },
    journalText:
      'The lights over the barrow field follow the marauders and not the warden. Orin wants six of them out.',
  }),

  // ================================================================ Sungraze
  quest({
    id: 'quest_sun_herd_1',
    name: 'The Herds Move Wrong',
    zoneId: 'sungraze',
    chainId: 'chain_sun_herd',
    suggestedLevel: 17,
    giver: { kind: 'npc', npcId: 'npc_kesh' },
    prerequisites: { level: 16, questIds: [], discoveryIds: [] },
    steps: [kill('enemy_steppe_raptor', 8, 'Raptors culled')],
    rewards: { xp: 1350, gold: 190, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_kesh',
          'The alpakings are moving north when they should be moving east. Something is pushing them. Start with the raptors.',
          [accept('Raptors first.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_kesh', 'They hunt the herd road. You will find them.', [
          close('I will.'),
        ]),
      ],
      complete: [
        line('done', 'npc_kesh', 'Herd steadied. But they were not the ones pushing.', [
          turnIn('What was?'),
        ]),
      ],
    },
    journalText:
      'Kesh the herd master says the alpakings are moving the wrong way. Something is pushing them.',
  }),

  quest({
    id: 'quest_sun_herd_2',
    name: 'Who Pushes the Herd',
    zoneId: 'sungraze',
    chainId: 'chain_sun_herd',
    suggestedLevel: 19,
    giver: { kind: 'npc', npcId: 'npc_kesh' },
    prerequisites: { level: 17, questIds: ['quest_sun_herd_1'], discoveryIds: [] },
    steps: [kill('enemy_orc_raider', 6, 'Raiders broken')],
    rewards: {
      xp: 1700,
      gold: 250,
      items: [{ itemId: 'item_consumable_potion_greater', qty: 2 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_kesh',
          'Orcs. Driving them north to thin them out before a hunt. Break the raiding party and the herd goes back to its road.',
          [accept('Consider it broken.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_kesh', 'The warband fires are east. You will see the smoke.', [
          close('Good.'),
        ]),
      ],
      complete: [
        line('done', 'npc_kesh', 'Herd is turning back east already. There is still the bull.', [
          turnIn('The bull?'),
        ]),
      ],
    },
    journalText:
      'Orcs have been driving the herds north before a hunt. Kesh wants the raiding party broken.',
  }),

  quest({
    id: 'quest_sun_herd_3',
    name: 'Alpaking Prime',
    zoneId: 'sungraze',
    chainId: 'chain_sun_herd',
    suggestedLevel: 22,
    giver: { kind: 'npc', npcId: 'npc_kesh' },
    prerequisites: { level: 20, questIds: ['quest_sun_herd_2'], discoveryIds: [] },
    steps: [kill('enemy_alpaking_prime', 1, 'Alpaking Prime brought down')],
    rewards: {
      xp: 3200,
      gold: 480,
      items: [],
      choices: [
        { classId: 'warrior', itemId: 'item_weapon_hammer_dustfall', qty: 1 },
        { classId: 'mage', itemId: 'item_weapon_wand_mirage', qty: 1 },
        { classId: 'rogue', itemId: 'item_weapon_dagger_sunstalker', qty: 1 },
        { classId: 'cleric', itemId: 'item_weapon_hammer_herdward', qty: 1 },
      ],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_kesh',
          'The herd will not settle while Prime is maddened. He has killed four of my drovers. I am past sentiment about it.',
          [accept('I will bring him down.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_kesh', 'He charges. Do not be where he is going.', [close('Right.')]),
      ],
      complete: [
        line(
          'done',
          'npc_kesh',
          'Forty years I have run this herd. Take what he wore. You earned it.',
          [turnIn('For the drovers.')],
        ),
      ],
    },
    journalText:
      'Alpaking Prime has gone mad and killed four drovers. Kesh is past sentiment about it.',
  }),

  quest({
    id: 'quest_sun_dry_cistern',
    name: 'The Dry Cistern',
    zoneId: 'sungraze',
    suggestedLevel: 18,
    giver: { kind: 'npc', npcId: 'npc_dara' },
    prerequisites: { level: 16, questIds: [], discoveryIds: [] },
    steps: [
      explore(
        'poi_dry_cistern',
        36,
        'Dara says the cistern is north-east of Sunwatch, sunk below the flats. Look for the stone lip, not the water.',
        'Find the cistern',
      ),
      useObject('chest_sun_1', 'Cistern Chest opened'),
    ],
    rewards: {
      xp: 1500,
      gold: 210,
      items: [{ itemId: 'item_consumable_elixir_sun', qty: 1 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_dara',
          'The cistern is dry and it should not be. Water does not just leave. Go and tell me what is down there instead of it.',
          [accept('I will look.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_dara', 'Stone lip, not water. That is what you are looking for.', [
          close('Understood.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_dara',
          'Somebody sealed it. Deliberately. That is worse than a drought.',
          [turnIn('Considerably worse.')],
        ),
      ],
    },
    journalText: "Sunwatch's cistern is dry and Dara says water does not just leave.",
  }),

  quest({
    id: 'quest_sun_windcallers',
    name: 'The Windcallers',
    zoneId: 'sungraze',
    suggestedLevel: 20,
    giver: { kind: 'npc', npcId: 'npc_dara' },
    prerequisites: { level: 18, questIds: ['quest_sun_dry_cistern'], discoveryIds: [] },
    steps: [kill('enemy_tribal_windcaller', 5, 'Windcallers silenced')],
    rewards: { xp: 1900, gold: 290, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_dara',
          'Their windcallers sealed my cistern. Five of them. I would like the wind to stop taking instructions.',
          [accept('Five.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_dara', 'They stand behind the raiders. They always do.', [
          close('Then I go through.'),
        ]),
      ],
      complete: [
        line('done', 'npc_dara', 'It filled overnight. Overnight. Drink your fill, it is yours.', [
          turnIn('Gladly.'),
        ]),
      ],
    },
    journalText:
      'The orc windcallers sealed the Sunwatch cistern. Dara wants five of them silenced.',
  }),

  // ================================================================= Ashcrag
  quest({
    id: 'quest_ash_adit_1',
    name: 'Adit Four',
    zoneId: 'ashcrag',
    chainId: 'chain_ash_adit',
    suggestedLevel: 23,
    giver: { kind: 'npc', npcId: 'npc_holt' },
    prerequisites: { level: 22, questIds: [], discoveryIds: [] },
    steps: [kill('enemy_crag_goleling', 8, 'Golelings cleared from the adit')],
    rewards: { xp: 2100, gold: 320, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_holt',
          'Adit four is collapsed and I want to know why. The honest version is we dug through something. Clear the stone-things first.',
          [
            accept('Clearing it.'),
            { text: 'Dug through what?', action: 'goto', goto: 'lore' },
            decline,
          ],
        ),
        line(
          'lore',
          'npc_holt',
          'That is the part I want to know. Clear it and we both find out.',
          [accept('Clearing it.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_holt', 'Eight of them at least. They come out of the wall.', [
          close('Right.'),
        ]),
      ],
      complete: [
        line('done', 'npc_holt', 'Passage is open. And it does not end where the chart says.', [
          turnIn('Then the chart is wrong.'),
        ]),
      ],
    },
    journalText: 'Rustpick lost adit four to a collapse. Holt says they dug through something.',
  }),

  quest({
    id: 'quest_ash_adit_2',
    name: 'What the Chart Missed',
    zoneId: 'ashcrag',
    chainId: 'chain_ash_adit',
    suggestedLevel: 25,
    giver: { kind: 'npc', npcId: 'npc_holt' },
    prerequisites: { level: 23, questIds: ['quest_ash_adit_1'], discoveryIds: [] },
    steps: [
      collect('item_material_dawnstone', 6, 'Dawnstone recovered', 'node_mining_dawnstone'),
      useObject('chest_ash_1', 'Adit Strongbox opened'),
    ],
    rewards: {
      xp: 2600,
      gold: 400,
      items: [{ itemId: 'item_consumable_potion_greater', qty: 3 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_holt',
          'Six of dawnstone out of the new face, and the strongbox the last shift left behind. I want to know what they were looking at.',
          [accept('Six and the box.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_holt', 'The face past the collapse. It reads clean.', [close('On it.')]),
      ],
      complete: [
        line(
          'done',
          'npc_holt',
          'Their notes stop mid-sentence. And there are claw marks on the box.',
          [turnIn('Claws.')],
        ),
      ],
    },
    journalText:
      'Holt wants dawnstone from the new face past the collapse, and the strongbox the last shift left behind.',
  }),

  quest({
    id: 'quest_ash_adit_3',
    name: 'What They Dug Through',
    zoneId: 'ashcrag',
    chainId: 'chain_ash_adit',
    suggestedLevel: 27,
    giver: { kind: 'npc', npcId: 'npc_holt' },
    prerequisites: { level: 25, questIds: ['quest_ash_adit_2'], discoveryIds: [] },
    steps: [kill('enemy_canyon_demon', 5, 'Canyon demons driven back')],
    rewards: {
      xp: 3400,
      gold: 520,
      items: [],
      choices: [
        { classId: 'warrior', itemId: 'item_weapon_halberd_obsidian', qty: 1 },
        { classId: 'mage', itemId: 'item_weapon_staff_caldera', qty: 1 },
        { classId: 'rogue', itemId: 'item_weapon_dagger_riftfang', qty: 1 },
        { classId: 'cleric', itemId: 'item_weapon_hammer_stonewarden', qty: 1 },
      ],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_holt',
          'Demons. We dug into a seam of them. Five back through the hole and I will brick it myself.',
          [accept('Five, then brick it.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_holt', 'Nobody goes below four until this is done.', [
          close('Understood.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_holt',
          'Bricked. Company can call it exhausted. Take your pick from the vault.',
          [turnIn('Fair.')],
        ),
      ],
    },
    journalText:
      'Rustpick dug into a seam of demons. Holt wants five of them driven back so he can brick it up.',
  }),

  quest({
    id: 'quest_ash_the_survey',
    name: 'The Survey',
    zoneId: 'ashcrag',
    suggestedLevel: 24,
    giver: { kind: 'npc', npcId: 'npc_ilse' },
    prerequisites: { level: 22, questIds: [], discoveryIds: [] },
    steps: [
      explore(
        'poi_caldera_rim',
        44,
        'Ilse wants the caldera rim measured. It is the high ground north-east of Rustpick — the one thing on every chart that is drawn differently on each.',
        'Reach the caldera rim',
      ),
      kill('enemy_ashcrag_yeti', 4, 'Yeti cleared from the rim'),
    ],
    rewards: {
      xp: 2300,
      gold: 350,
      items: [{ itemId: 'item_consumable_elixir_crag', qty: 1 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_ilse',
          'The canyon reads wrong on every chart I have, and they disagree with each other. I need the rim measured by somebody who will come back.',
          [accept('I will come back.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_ilse', 'Mind the yeti. They are not on any chart either.', [
          close('Noted.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_ilse',
          'Now I know why they disagree. The rim is moving. Slowly, but moving.',
          [turnIn('That is not reassuring.')],
        ),
      ],
    },
    journalText:
      'Ilse the surveyor says the canyon reads wrong on every chart, and the charts disagree with each other.',
  }),

  // ============================================================ Elder Grove
  quest({
    id: 'quest_grove_dawnpetal',
    name: 'What Grows Only Here',
    zoneId: 'elder_grove',
    suggestedLevel: 28,
    giver: { kind: 'npc', npcId: 'npc_hermit' },
    prerequisites: { level: 26, questIds: [], discoveryIds: [] },
    steps: [
      collect('item_material_dawnpetal', 5, 'Dawnpetal gathered', 'node_herbalism_dawnpetal'),
    ],
    rewards: {
      xp: 3600,
      gold: 300,
      items: [{ itemId: 'item_consumable_elixir_grove', qty: 2 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hermit',
          'You came through the arch. Few do. Then you may as well be useful: five dawnpetal, and take them gently.',
          [accept('Gently.'), { text: 'Why gently?', action: 'goto', goto: 'lore' }, decline],
        ),
        line(
          'lore',
          'npc_hermit',
          'Because it grows nowhere else in the world, and I have watched it for longer than your harbour has stood.',
          [accept('Gently, then.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hermit', 'They open at the roots of the old ones. Look down.', [
          close('I will.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_hermit',
          'You took five and left the rest standing. Good. There is one more thing.',
          [turnIn('Tell me.')],
        ),
      ],
    },
    journalText:
      'The Warden of the Elder Grove wants five dawnpetal, taken gently. It grows nowhere else in the world.',
  }),

  quest({
    id: 'quest_grove_the_elder',
    name: 'The Elder',
    zoneId: 'elder_grove',
    suggestedLevel: 30,
    giver: { kind: 'npc', npcId: 'npc_hermit' },
    prerequisites: { level: 28, questIds: ['quest_grove_dawnpetal'], discoveryIds: [] },
    steps: [kill('enemy_elder_treant', 1, 'The Elder Treant laid to rest')],
    rewards: {
      xp: 5200,
      gold: 700,
      items: [],
      choices: [
        { classId: 'warrior', itemId: 'item_weapon_spear_riftlance', qty: 1 },
        { classId: 'mage', itemId: 'item_weapon_wand_riftglass', qty: 1 },
        { classId: 'rogue', itemId: 'item_weapon_fist_voidtouched', qty: 1 },
        { classId: 'cleric', itemId: 'item_weapon_mace_groveheart', qty: 1 },
      ],
      title: 'Friend of the Grove',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hermit',
          'The Treant remembers longer than either of us will live, and it has begun to remember wrongly. It will take the Grove with it. I cannot do this.',
          [accept('I will.'), { text: 'Remember wrongly?', action: 'goto', goto: 'lore' }, decline],
        ),
        line(
          'lore',
          'npc_hermit',
          'It thinks the isle is still burning. It has started pulling the roots up to save them.',
          [accept('Then I will end it.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hermit', 'It is at the glade. It has always been at the glade.', [
          close('I know the way.'),
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_hermit',
          'The roots have gone back down. It is quiet, and it is the right kind of quiet. Take something of it with you.',
          [turnIn('I am sorry it came to that.')],
        ),
      ],
    },
    journalText:
      'The Elder Treant has begun to remember wrongly, and it will take the Grove with it. The Warden cannot do this himself.',
  }),
];
