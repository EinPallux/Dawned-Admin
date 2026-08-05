/**
 * The P11 pilot quest set (QUESTS_POI.md §6, CONTENT_0.1.md §5) — data only.
 *
 * Eight quests: four Dawnshore one-offs that teach the verbs, and the Verdant
 * Weald's four-part "The Loggers' Silence" chain that tells the zone's story.
 * Between them they exercise every one of the seven step types, all four giver
 * kinds, both gate kinds, a scripted spawn hook and a per-class reward choice —
 * which is the point of a PILOT set: it is the shape of the remaining twenty,
 * proven once.
 *
 * Split out of the authoring script for the same reason `node-data.mjs` was:
 * the script is a pipeline, this is content, and mixing them means every typo
 * fix re-reads three hundred lines of fetch calls.
 *
 * Every id, item and enemy here resolves against what is actually published —
 * the shore's own bestiary, the P8 catalogue and the P10 gathering materials.
 * Nothing invents a row it hopes exists.
 *
 * **Why every quest says `zoneId: 'dawnshore'`, including the Weald chain.**
 * The zone id is what the JOURNAL groups by, so it has to name the zone the
 * player is standing in — and the built world only has one landmass. The
 * `verdant_weald` and `ashen_reach` polygons exist over open water until P12
 * sculpts them, which is also why the Weald BESTIARY (stalkers, the Mushroom
 * King) already stands inside the Dawnshore polygon at z ≈ 140–210. Filing the
 * chain under "The Verdant Weald" would print a heading for a place the player
 * has never been. The prose still calls the north woods the Weald, because it
 * is; when P12 raises the real one, this is four `zoneId` fields in the panel
 * and a placement move, which is what content-as-data is for.
 */

/** Dawnhaven sits at the map's spawn; the shore quests orbit it. */
const HAVEN = { x: 0, z: 275 };

/** Villagers reuse the PLAYER appearance — body + outfit + hair, one skeleton. */
const look = (over = {}) => ({
  body: 'f',
  skin: 1,
  outfit: 'peasant',
  outfitTint: 0,
  hair: 'buns',
  hairColor: 2,
  beard: false,
  ...over,
});

export const NPC_DEFS = [
  {
    id: 'npc_marla',
    name: 'Marla',
    title: 'Dawnhaven gate farmer',
    role: 'quest_giver',
    appearance: look(),
    idleClip: 'Idle',
    talkClip: '',
    vendorId: null,
    barks: [
      { text: 'The bog took two fence posts this week.', emote: '' },
      { text: "Don't drink from the pools out there.", emote: '' },
    ],
    barkCooldownSec: 45,
    scale: 1,
  },
  {
    id: 'npc_torv',
    name: 'Torv',
    title: 'harbourmaster',
    role: 'quest_giver',
    appearance: look({ body: 'm', skin: 3, outfit: 'ranger', hair: 'buzzed', beard: true }),
    idleClip: 'Idle',
    talkClip: '',
    vendorId: null,
    barks: [
      { text: 'Tide comes in fast on the flats. Mind yourself.', emote: '' },
      { text: 'Every board on that jetty I laid myself.', emote: '' },
    ],
    barkCooldownSec: 50,
    scale: 1,
  },
  {
    id: 'npc_hesta',
    name: 'Hesta',
    title: 'warden of the Weald',
    role: 'quest_giver',
    appearance: look({ skin: 2, outfit: 'ranger', outfitTint: 1, hair: 'long', hairColor: 0 }),
    idleClip: 'Idle',
    talkClip: '',
    vendorId: null,
    barks: [
      { text: 'The cut has been quiet three days now.', emote: '' },
      { text: 'Whatever is in there, it is not a bear.', emote: '' },
    ],
    barkCooldownSec: 40,
    scale: 1,
  },
  {
    id: 'npc_bran',
    name: 'Bran',
    title: 'logger',
    role: 'villager',
    appearance: look({ body: 'm', skin: 0, outfit: 'peasant', outfitTint: 1, hair: 'parted' }),
    idleClip: 'Idle',
    talkClip: '',
    vendorId: null,
    barks: [{ text: '…quiet. Please.', emote: '' }],
    barkCooldownSec: 90,
    scale: 1,
  },
];

/** Where each of them stands. Thin rows; the definition holds everything else. */
export const NPC_PLACEMENTS = [
  {
    id: 'npc_marla_gate',
    npcId: 'npc_marla',
    x: HAVEN.x - 9,
    z: HAVEN.z + 6,
    yOffset: 0,
    rotation: 2.4,
  },
  {
    id: 'npc_torv_jetty',
    npcId: 'npc_torv',
    x: HAVEN.x + 11,
    z: HAVEN.z + 2,
    yOffset: 0,
    rotation: 3.9,
  },
  {
    id: 'npc_hesta_road',
    npcId: 'npc_hesta',
    x: HAVEN.x - 4,
    z: HAVEN.z - 22,
    yOffset: 0,
    rotation: 0.2,
  },
  { id: 'npc_bran_hollow', npcId: 'npc_bran', x: -118, z: 92, yOffset: 0, rotation: 1.1 },
];

/**
 * The Weald's logging site. Four stumps sharing a TAG, which is what lets one
 * INTERACT step count all of them without naming four ids — and what lets the
 * owner add a fifth stump later without touching the quest.
 */
const CUT = { x: -104, z: 104 };
const stump = (index, dx, dz) => ({
  id: `prop_weald_stump_${index}`,
  kind: 'quest_prop',
  name: 'Marked Stump',
  x: CUT.x + dx,
  z: CUT.z + dz,
  yOffset: 0,
  rotation: index * 1.3,
  modelRef: 'world_nature_wood_log_b',
  lootTableId: null,
  respawnMs: 0,
  text: 'Cut clean, mid-swing. The axe is still in it.',
  destX: null,
  destZ: null,
  travelNode: false,
});

export const INTERACTABLES = [
  stump(1, 0, 0),
  stump(2, 7, -4),
  stump(3, -5, 6),
  stump(4, 3, 9),
  {
    id: 'board_dawnhaven',
    kind: 'quest_prop',
    name: 'Dawnhaven Notice Board',
    x: HAVEN.x + 3,
    z: HAVEN.z + 8,
    yOffset: 0,
    rotation: 3.1,
    modelRef: 'world_props_banner_2',
    lootTableId: null,
    respawnMs: 0,
    text: '',
    destX: null,
    destZ: null,
    travelNode: false,
  },
  {
    id: 'chest_shore_lostnet',
    kind: 'chest',
    name: "Torv's Lost Crate",
    x: 62,
    z: 232,
    yOffset: 0,
    rotation: 0.7,
    modelRef: 'world_props_crate_wooden',
    lootTableId: 'loot_dawnshore_gear',
    respawnMs: 0,
    text: '',
    destX: null,
    destZ: null,
    travelNode: false,
  },
  {
    id: 'shrine_dawnhaven',
    kind: 'shrine',
    name: 'Dawnhaven Shrine',
    x: HAVEN.x - 2,
    z: HAVEN.z + 14,
    yOffset: 0,
    rotation: 0,
    modelRef: 'world_props_pillar_decorated',
    lootTableId: null,
    respawnMs: 0,
    text: '',
    destX: null,
    destZ: null,
    travelNode: true,
  },
];

/**
 * Discovery points. One of each kind the design defines that the built world
 * can actually carry — the DoD wants the loop firing for every POI type, and a
 * kind with nowhere to stand would be a claim rather than a check.
 */
export const POIS = [
  {
    id: 'poi_gullspit',
    name: 'Gullspit',
    kind: 'vista',
    x: 74,
    z: 214,
    radius: 14,
    xpBasis: 1200,
    icon: '',
  },
  {
    id: 'poi_dawnhaven',
    name: 'Dawnhaven',
    kind: 'landmark',
    x: HAVEN.x,
    z: HAVEN.z,
    radius: 22,
    xpBasis: 800,
    icon: '',
  },
  {
    id: 'poi_lost_crate',
    name: 'The Lost Crate',
    kind: 'cache',
    x: 62,
    z: 232,
    radius: 10,
    xpBasis: 1000,
    icon: '',
  },
  {
    id: 'poi_logging_cut',
    name: 'The Silent Cut',
    kind: 'camp',
    x: CUT.x,
    z: CUT.z,
    radius: 18,
    xpBasis: 1000,
    icon: '',
  },
  {
    id: 'poi_haven_shrine',
    name: 'Dawnhaven Shrine',
    kind: 'shrine',
    x: HAVEN.x - 2,
    z: HAVEN.z + 14,
    radius: 8,
    xpBasis: 900,
    icon: '',
  },
  {
    id: 'poi_wishing_pool',
    name: 'The Wishing Pool',
    kind: 'curiosity',
    x: -38,
    z: 244,
    radius: 9,
    xpBasis: 400,
    icon: '',
  },
];

const line = (id, npcId, text, choices, emote = '') => ({ id, npcId, text, emote, choices });
const accept = (text) => ({ text, action: 'accept', goto: '' });
const decline = { text: 'Not just now.', action: 'decline', goto: '' };
const turnIn = (text) => ({ text, action: 'turn_in', goto: '' });

/** Common shape: an NPC-given quest with an offer and a completion. */
const npcQuest = (over) => ({
  repeatable: false,
  chainId: '',
  turnInNpcId: over.giver?.npcId ?? null,
  prerequisites: { level: 1, questIds: [], discoveryIds: [] },
  rewards: { xp: 0, gold: 0, items: [], choices: [], title: '' },
  dialogue: { offer: [], inProgress: [], complete: [] },
  trackable: true,
  ...over,
});

export const QUEST_DEFS = [
  // --- Dawnshore: four one-offs that teach the verbs ------------------------
  npcQuest({
    id: 'quest_shore_glub_tide',
    name: 'Glubs on the Tideline',
    zoneId: 'dawnshore',
    suggestedLevel: 1,
    giver: { kind: 'npc', npcId: 'npc_torv' },
    steps: [
      {
        type: 'kill',
        enemyId: 'enemy_shore_glub',
        enemyTag: null,
        count: 5,
        trackerText: 'Shore Glubs cleared',
        hint: { x: 40, z: 250, radius: 70 },
        hooks: [],
      },
    ],
    rewards: { xp: 90, gold: 14, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_torv',
          'Glubs are up on the tideline again, chewing my mooring ropes. Thin them out and I will square you.',
          [accept('I can do that.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_torv', 'Still a few out there by the sound of it.', [
          { text: 'On it.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line('done', 'npc_torv', 'Ropes intact. That is a good morning.', [
          turnIn('Glad to help.'),
        ]),
      ],
    },
    journalText: 'Torv says the glubs have been at his mooring ropes. He would like fewer glubs.',
  }),

  npcQuest({
    id: 'quest_shore_boil_trouble',
    name: 'Boil Trouble',
    zoneId: 'dawnshore',
    suggestedLevel: 3,
    giver: { kind: 'npc', npcId: 'npc_marla' },
    prerequisites: { level: 2, questIds: [], discoveryIds: [] },
    steps: [
      {
        type: 'kill',
        enemyId: 'enemy_bog_blob',
        enemyTag: null,
        count: 8,
        trackerText: 'Bog Blobs slain',
        hint: { x: -70, z: 210, radius: 80 },
        hooks: [],
      },
    ],
    rewards: {
      xp: 220,
      gold: 35,
      items: [{ itemId: 'item_consumable_rations_travelers', qty: 3 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_marla',
          'My fence posts are dissolving. I would like the bog to stop doing that.',
          [
            accept("I'll see to it."),
            { text: 'What is out there?', action: 'goto', goto: 'lore' },
            decline,
          ],
        ),
        line('lore', 'npc_marla', 'Blobs. Wet ones. They were not this bold last spring.', [
          accept("I'll see to it."),
          decline,
        ]),
      ],
      inProgress: [
        line('wait', 'npc_marla', 'Another post went yesterday.', [
          { text: 'Working on it.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_marla',
          'The fence is still standing. Take these, you have earned them.',
          [turnIn('Thank you.')],
        ),
      ],
    },
    journalText: "Marla's fence posts are dissolving. She'd like the bog to stop doing that.",
  }),

  npcQuest({
    id: 'quest_shore_driftwood',
    name: 'Driftwood for the Jetty',
    zoneId: 'dawnshore',
    suggestedLevel: 2,
    // A BOARD quest — §1.2 wants ~30% of quests to start from something other
    // than an NPC with a glyph over their head.
    giver: { kind: 'board', boardId: 'board_dawnhaven' },
    turnInNpcId: 'npc_torv',
    steps: [
      {
        type: 'collect',
        itemId: 'item_material_birchwood_log',
        count: 6,
        // `gather` and nothing else: this is the profession cross-sell, and
        // buying six logs at a vendor would make it a gold check instead.
        source: 'gather',
        trackerText: 'Birchwood cut',
        hint: null,
        hooks: [],
      },
      {
        type: 'deliver',
        itemId: 'item_material_birchwood_log',
        count: 6,
        npcId: 'npc_torv',
        trackerText: 'Deliver the wood to Torv',
        hint: null,
        hooks: [],
      },
    ],
    rewards: { xp: 140, gold: 26, items: [], choices: [], title: '' },
    dialogue: {
      complete: [
        line('done', 'npc_torv', 'Good straight lengths. The jetty thanks you.', [
          turnIn('Take them.'),
        ]),
      ],
      offer: [],
      inProgress: [],
    },
    journalText:
      'A notice on the Dawnhaven board: six good lengths of birch wanted, jetty repairs, see Torv.',
  }),

  npcQuest({
    id: 'quest_shore_lost_crate',
    name: 'The Lost Crate',
    zoneId: 'dawnshore',
    suggestedLevel: 2,
    giver: { kind: 'npc', npcId: 'npc_torv' },
    steps: [
      {
        type: 'explore',
        x: 62,
        z: 232,
        radius: 18,
        clueText: 'Past the last mooring post, where the gulls will not settle.',
        trackerText: 'Find where the crate washed up',
        hint: null,
        hooks: [],
      },
      {
        type: 'interact',
        objectId: 'chest_shore_lostnet',
        objectTag: null,
        count: 1,
        trackerText: 'Open the crate',
        hint: null,
        hooks: [{ hook: 'toast', text: 'Torv will want to know what was in this.' }],
      },
    ],
    rewards: { xp: 160, gold: 30, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_torv',
          'A crate went over in the swell three nights back. If it beached, it beached east.',
          [accept("I'll look for it."), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_torv', 'East. Past the last post.', [
          { text: 'Right.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line('done', 'npc_torv', 'Salt-ruined, but mine. Here — for the walk.', [
          turnIn('It was no trouble.'),
        ]),
      ],
    },
    journalText:
      'Torv lost a crate to the swell. He is fairly sure the sea gave it back somewhere east.',
  }),

  // --- Verdant Weald: "The Loggers' Silence" (4) ----------------------------
  npcQuest({
    id: 'quest_weald_silence_1',
    name: "The Loggers' Silence",
    zoneId: 'dawnshore',
    suggestedLevel: 8,
    chainId: 'chain_loggers_silence',
    giver: { kind: 'npc', npcId: 'npc_hesta' },
    prerequisites: { level: 6, questIds: [], discoveryIds: [] },
    steps: [
      {
        type: 'explore',
        x: -104,
        z: 104,
        radius: 26,
        clueText: 'North-west, where the road gives out and the saw-cuts start.',
        trackerText: 'Find the logging site',
        hint: null,
        hooks: [],
      },
    ],
    rewards: { xp: 420, gold: 48, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hesta',
          'The cut has been silent three days. No axes, no singing, and nobody walked back out.',
          [
            accept('I will go and look.'),
            { text: 'How many were up there?', action: 'goto', goto: 'lore' },
            decline,
          ],
        ),
        line(
          'lore',
          'npc_hesta',
          'Six. Bran among them, and Bran could talk the bark off a tree.',
          [accept('I will go and look.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hesta', 'North-west. Follow the road until it stops being one.', [
          { text: 'Going.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line('done', 'npc_hesta', 'Empty. And the tools still there. That is worse, not better.', [
          turnIn('It is.'),
        ]),
      ],
    },
    journalText:
      'Hesta says the loggers stopped singing three days ago. Nobody has walked back down the road.',
  }),

  npcQuest({
    id: 'quest_weald_silence_2',
    name: 'What Took Them',
    zoneId: 'dawnshore',
    suggestedLevel: 9,
    chainId: 'chain_loggers_silence',
    giver: { kind: 'npc', npcId: 'npc_hesta' },
    prerequisites: { level: 6, questIds: ['quest_weald_silence_1'], discoveryIds: [] },
    steps: [
      {
        type: 'interact',
        objectId: null,
        // The four stumps share a tag, so one step counts all of them and a
        // fifth stump later needs no quest edit.
        objectTag: 'Marked Stump',
        count: 4,
        trackerText: 'Marked stumps inspected',
        hint: { x: -104, z: 104, radius: 40 },
        hooks: [{ hook: 'toast', text: 'Something moves in the treeline.' }],
      },
      {
        type: 'kill',
        enemyId: 'enemy_weald_stalker',
        enemyTag: null,
        count: 3,
        trackerText: 'Stalkers driven off',
        hint: { x: -104, z: 104, radius: 40 },
        hooks: [],
      },
    ],
    rewards: { xp: 520, gold: 60, items: [], choices: [], title: '' },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hesta',
          'Look at the cuts themselves. A tree remembers what interrupted it.',
          [accept('I will read the stumps.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hesta', 'Four of them were marked for felling. Start there.', [
          { text: 'Right.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_hesta',
          'Stalkers. They do not take six grown loggers. Something drove them down.',
          [turnIn('Something did.')],
        ),
      ],
    },
    journalText: 'Four stumps, cut clean and abandoned mid-swing. Whatever came, it came fast.',
  }),

  npcQuest({
    id: 'quest_weald_silence_3',
    name: 'The Hollow Trunk',
    zoneId: 'dawnshore',
    suggestedLevel: 10,
    chainId: 'chain_loggers_silence',
    giver: { kind: 'npc', npcId: 'npc_hesta' },
    prerequisites: { level: 6, questIds: ['quest_weald_silence_2'], discoveryIds: [] },
    steps: [
      {
        type: 'collect',
        itemId: 'item_material_mossbloom',
        count: 5,
        source: 'gather',
        trackerText: 'Mossbloom gathered',
        hint: null,
        hooks: [],
      },
      {
        type: 'deliver',
        itemId: 'item_material_mossbloom',
        count: 5,
        npcId: 'npc_bran',
        trackerText: 'Take the mossbloom to Bran',
        hint: { x: -118, z: 92, radius: 30 },
        hooks: [
          { hook: 'toast', text: 'Bran will live. He would rather you kept your voice down.' },
        ],
      },
    ],
    rewards: {
      xp: 620,
      gold: 70,
      items: [{ itemId: 'item_consumable_potion_lesser', qty: 3 }],
      choices: [],
      title: '',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hesta',
          'One of them is alive. Bran, in a hollow trunk, and in no state to walk. Mossbloom, five heads, and be quick.',
          [accept('Where does mossbloom grow?'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hesta', 'Mossbloom. The Weald is full of it if you look down.', [
          { text: 'Going.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line('done', 'npc_hesta', 'He talked, then. Thank the roots for that.', [
          turnIn('He did.'),
        ]),
      ],
    },
    journalText:
      'Bran is alive in a hollow trunk and cannot walk. Mossbloom grows all over the Weald, if you look down.',
  }),

  npcQuest({
    id: 'quest_weald_silence_4',
    name: 'The Crown Beneath',
    zoneId: 'dawnshore',
    suggestedLevel: 11,
    chainId: 'chain_loggers_silence',
    giver: { kind: 'npc', npcId: 'npc_hesta' },
    prerequisites: { level: 8, questIds: ['quest_weald_silence_3'], discoveryIds: [] },
    steps: [
      {
        type: 'kill',
        enemyId: 'enemy_mushroom_king',
        enemyTag: null,
        count: 1,
        trackerText: 'The Mushroom King',
        hint: { x: -150, z: 60, radius: 60 },
        hooks: [{ hook: 'toast', text: 'The Weald is quiet again. Properly, this time.' }],
      },
    ],
    // The chain end: a Rare weapon, one per class, plus the title (§1.5 wants
    // at least one Rare per zone chain).
    rewards: {
      xp: 900,
      gold: 120,
      items: [],
      choices: [
        { classId: 'warrior', itemId: 'item_weapon_axe_wealdcleaver', qty: 1 },
        { classId: 'rogue', itemId: 'item_weapon_dagger_mosswhisper', qty: 1 },
        { classId: 'mage', itemId: 'item_weapon_staff_sunspire', qty: 1 },
        { classId: 'cleric', itemId: 'item_weapon_mace_wealdward', qty: 1 },
      ],
      title: 'Friend of the Weald',
    },
    dialogue: {
      offer: [
        line(
          'offer',
          'npc_hesta',
          'Bran says it wore a crown. Everything under those trees answers to it, and it is still down there.',
          [accept('Then it should not be.'), decline],
        ),
      ],
      inProgress: [
        line('wait', 'npc_hesta', 'South-west of the cut. You will know it.', [
          { text: 'I will.', action: 'close', goto: '' },
        ]),
      ],
      complete: [
        line(
          'done',
          'npc_hesta',
          'The Weald breathes again. Take your pick — the loggers would want you armed.',
          [turnIn('Thank you.')],
        ),
      ],
    },
    journalText:
      'Bran says the thing under the trees wore a crown, and everything in the Weald answered to it.',
  }),
];
