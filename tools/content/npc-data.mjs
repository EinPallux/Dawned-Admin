/**
 * The people of the Dawnlands (game P12-F).
 *
 * CONTENT_0.1 §2 wants ~40 friendly NPCs: 12 vendors, ~18 quest givers, ~10
 * flavour villagers. P11 authored four of them (Marla, Torv, Hesta, Bran) as
 * the pilot set; this is the rest, plus a body for each of the sixteen vendor
 * rows P12-D published — a shop with no shopkeeper is a vendor panel that opens
 * out of thin air.
 *
 * An NPC is a COMPOSED rig (body + outfit + hair), not a baked mesh, which is
 * what gives every villager the whole UAL clip library for free. Two things the
 * schema will not save you from and that cost P11-D a screenshot each:
 *
 *  - **`idleClip` must name a clip the rig owns.** The UAL library's
 *    standing-still clip is `Idle_Loop`, NOT `Idle`; a rig plays NOTHING for a
 *    name it does not have, so all four pilot villagers stood in a bind-pose T
 *    until somebody looked. Every row here leaves it at the schema default.
 *  - **`vendorId` must resolve** to a published vendor, or the `F` opens
 *    nothing. Publish cross-checks it; the ids below come from P12-D's set.
 */

/** Compact appearance builder — `[body, skin, outfit, tint, hair, hairColor, beard]`. */
const look = (body, skin, outfit, outfitTint, hair, hairColor, beard = false) => ({
  body,
  skin,
  outfit,
  outfitTint,
  hair,
  hairColor,
  beard,
});

/**
 * `[id, name, title, role, town, appearance, vendorId, barks[]]`.
 *
 * Barks are the cheapest life in the game (§3: "cheap life") — one line each,
 * on a cooldown, no UI. They are also where a settlement gets its character:
 * Rustpick complains about the company store, Sunwatch talks about water.
 */
const PEOPLE = [
  // ------------------------------------------------------------- Dawnhaven (10 new)
  [
    'npc_alba',
    'Alba',
    'general goods',
    'vendor',
    'dawnhaven',
    look('f', 2, 'peasant', 1, 'buns', 4),
    'vendor_general_dawnhaven',
    [
      'Rope, salt, lamp oil. If I have it, it is on the counter.',
      'Everything comes in on the tide and goes out on credit.',
    ],
  ],
  [
    'npc_dunn',
    'Dunn',
    'weaponsmith',
    'vendor',
    'dawnhaven',
    look('m', 3, 'ranger', 2, 'buzzed', 0, true),
    'vendor_weaponsmith_dawnhaven',
    ['A blade you cannot draw is a stick.', 'I sharpen for free. Once.'],
  ],
  [
    'npc_petra',
    'Petra',
    'armorer',
    'vendor',
    'dawnhaven',
    look('f', 1, 'ranger', 3, 'parted', 1),
    'vendor_armorer_dawnhaven',
    ['Padding first, plate second. That is the order.', 'Come back when something has dented you.'],
  ],
  [
    'npc_ysolde',
    'Ysolde',
    'alchemist',
    'vendor',
    'dawnhaven',
    look('f', 4, 'peasant', 2, 'long', 5),
    'vendor_alchemist_dawnhaven',
    ['Drink it, do not smell it.', 'Two coppers says you come back for the antidote.'],
  ],
  [
    'npc_cobb',
    'Cobb',
    'the harbour collector',
    'vendor',
    'dawnhaven',
    look('m', 2, 'peasant', 3, 'none', 0, true),
    'vendor_collector_dawnhaven',
    ['I buy what the sea gives up. No questions.', 'Odd is worth more than pretty, out here.'],
  ],
  [
    'npc_wen',
    'Wen',
    'dockhand',
    'villager',
    'dawnhaven',
    look('m', 4, 'peasant', 0, 'buzzed_short', 1),
    null,
    ['Three ships this month. Three.', 'Mind the ropes.'],
  ],
  [
    'npc_isbet',
    'Isbet',
    'net-mender',
    'villager',
    'dawnhaven',
    look('f', 3, 'peasant', 1, 'buns', 3),
    null,
    [
      'A hole you cannot see is the one that costs you the catch.',
      'My mother mended these same nets.',
    ],
  ],
  [
    'npc_garrow',
    'Garrow',
    'harbour guard',
    'guard',
    'dawnhaven',
    look('m', 1, 'ranger', 0, 'buzzed', 0, true),
    null,
    ['Move along. Nothing to see but water.', 'Trouble stays outside the gate. Usually.'],
  ],
  [
    'npc_lissa',
    'Lissa',
    'the road warden',
    'quest_giver',
    'dawnhaven',
    look('f', 2, 'ranger', 1, 'parted', 2),
    null,
    ['Somebody has to keep the Weald road open.', 'I have walked it since I was nine.'],
  ],
  [
    'npc_odo',
    'Odo',
    'shipwright',
    'quest_giver',
    'dawnhaven',
    look('m', 4, 'ranger', 3, 'long', 6, true),
    null,
    ['Green wood warps. Every time.', 'She was a fine hull before the reef had her.'],
  ],

  // ------------------------------------------------------------ Mosshollow (6)
  [
    'npc_pell',
    'Pell',
    'stores',
    'vendor',
    'mosshollow',
    look('m', 3, 'peasant', 2, 'parted', 3),
    'vendor_general_mosshollow',
    ['Damp gets into everything up here.', 'I stock what the Weald does not provide. Short list.'],
  ],
  [
    'npc_rowan',
    'Rowan',
    'herbalist',
    'vendor',
    'mosshollow',
    look('f', 4, 'peasant', 3, 'long', 4),
    'vendor_alchemist_mosshollow',
    [
      'Mossbloom, if you have any. I pay above the shore price.',
      'The deep Weald grows better and kills faster.',
    ],
  ],
  [
    'npc_teague',
    'Teague',
    'the forester',
    'quest_giver',
    'mosshollow',
    look('m', 2, 'ranger', 1, 'buzzed', 1, true),
    null,
    ['Something is taking the marked trees.', 'I count them every week. I am not wrong.'],
  ],
  [
    'npc_niamh',
    'Niamh',
    'the hedge witch',
    'quest_giver',
    'mosshollow',
    look('f', 1, 'peasant', 0, 'buns', 7),
    null,
    ['The old ring still hums on wet mornings.', 'Do not take anything out of the barrow.'],
  ],
  [
    'npc_bryn',
    'Bryn',
    'charcoal burner',
    'villager',
    'mosshollow',
    look('m', 4, 'peasant', 1, 'none', 0),
    null,
    ['Eight days a burn. Eight.', 'Smoke in the lungs is honest work.'],
  ],
  [
    'npc_maeve',
    'Maeve',
    'trail cook',
    'villager',
    'mosshollow',
    look('f', 4, 'peasant', 2, 'buzzed_short', 2),
    null,
    ['Sit. Eat. The fire is free.', 'Nobody walks the deep Weald hungry on my watch.'],
  ],

  // ------------------------------------------------------------- Cinderfall (7)
  [
    'npc_hald',
    'Hald',
    'the forge',
    'vendor',
    'cinderfall',
    look('m', 2, 'ranger', 0, 'buzzed', 0, true),
    'vendor_weaponsmith_cinderfall',
    ['Ember-steel holds an edge through bone.', 'Hot work. Short talk.'],
  ],
  [
    'npc_saskia',
    'Saskia',
    'stores',
    'vendor',
    'cinderfall',
    look('f', 3, 'peasant', 1, 'parted', 1),
    'vendor_general_cinderfall',
    ['Everything here tastes faintly of ash. You get used to it.', 'Buy a lamp. Trust me.'],
  ],
  [
    'npc_verity',
    'Verity',
    'the ash apothecary',
    'vendor',
    'cinderfall',
    look('f', 1, 'peasant', 3, 'long', 0),
    'vendor_alchemist_cinderfall',
    ['Cinderleaf burns going down and keeps burning.', 'I do not ask what you need it for.'],
  ],
  [
    'npc_brann',
    'Brann',
    'the gravedigger',
    'quest_giver',
    'cinderfall',
    look('m', 4, 'peasant', 2, 'none', 0, true),
    null,
    ['I bury them deep. They do not always stay.', 'Third one this month walked home.'],
  ],
  [
    'npc_orin',
    'Orin',
    'the barrow warden',
    'quest_giver',
    'cinderfall',
    look('m', 1, 'ranger', 2, 'parted', 0, true),
    null,
    ['The marauders dig where they should not.', 'Someone is paying them to.'],
  ],
  [
    'npc_sela',
    'Sela',
    'watch captain',
    'guard',
    'cinderfall',
    look('f', 2, 'ranger', 3, 'buns', 1),
    null,
    ['Gate closes at dusk. No exceptions.', 'You look like you can hold a line. Good.'],
  ],
  [
    'npc_edda',
    'Edda',
    'bell-ringer',
    'villager',
    'cinderfall',
    look('f', 4, 'peasant', 0, 'buzzed_short', 3),
    null,
    ['Three rings means run.', 'It has been quiet. That worries me more.'],
  ],

  // --------------------------------------------------------------- Sunwatch (7)
  [
    'npc_tamsin',
    'Tamsin',
    'provisioner',
    'vendor',
    'sunwatch',
    look('f', 4, 'peasant', 1, 'buns', 2),
    'vendor_general_sunwatch',
    [
      'Water first. Everything else is optional out there.',
      'Two skins minimum if you are crossing the flats.',
    ],
  ],
  [
    'npc_joss',
    'Joss',
    'armorer',
    'vendor',
    'sunwatch',
    look('m', 4, 'ranger', 1, 'buzzed', 1),
    'vendor_armorer_sunwatch',
    ['Light plate. You will thank me at noon.', 'Heat kills more than orcs do.'],
  ],
  [
    'npc_amara',
    'Amara',
    'the windcaller stall',
    'vendor',
    'sunwatch',
    look('f', 4, 'peasant', 3, 'long', 1),
    'vendor_alchemist_sunwatch',
    ['Sunblossom keeps the head clear.', 'The wind tells me when the herds move. Mostly.'],
  ],
  [
    'npc_kesh',
    'Kesh',
    'the herd master',
    'quest_giver',
    'sunwatch',
    look('m', 4, 'ranger', 2, 'parted', 2, true),
    null,
    ['The alpakings are moving wrong this season.', 'Something up the ridge is pushing them.'],
  ],
  [
    'npc_dara',
    'Dara',
    'the well-keeper',
    'quest_giver',
    'sunwatch',
    look('f', 3, 'peasant', 2, 'parted', 4),
    null,
    ['The cistern is dry and it should not be.', 'Water does not just leave.'],
  ],
  [
    'npc_tobin',
    'Tobin',
    'farmhand',
    'villager',
    'sunwatch',
    look('m', 2, 'peasant', 0, 'buzzed_short', 0),
    null,
    ['Wheat this high by harvest. Watch.', 'The windmill has a squeak nobody will fix.'],
  ],
  [
    'npc_nesta',
    'Nesta',
    'drover',
    'villager',
    'sunwatch',
    look('f', 1, 'ranger', 0, 'buns', 5),
    null,
    ['Forty head and I know every one by face.', 'Never stand downwind of a cactoro.'],
  ],

  // ---------------------------------------------------------------- Rustpick (6)
  [
    'npc_grell',
    'Grell',
    'company store',
    'vendor',
    'rustpick',
    look('m', 3, 'peasant', 2, 'none', 0, true),
    'vendor_general_rustpick',
    ['Company prices. Take it up with the company.', 'Credit is available. It always is.'],
  ],
  [
    'npc_marek',
    'Marek',
    'toolworks',
    'vendor',
    'rustpick',
    look('m', 1, 'ranger', 0, 'buzzed', 0, true),
    'vendor_weaponsmith_rustpick',
    [
      'Dawnstone will not chip. Costs like it too.',
      'Bring me the pick and I will tell you how you swing.',
    ],
  ],
  [
    'npc_vas',
    'Vas',
    'the deep draught',
    'vendor',
    'rustpick',
    look('f', 2, 'peasant', 3, 'buzzed_short', 6),
    'vendor_alchemist_rustpick',
    ['It is grit and honey. I call it a tonic.', 'Nobody has died of it yet.'],
  ],
  [
    'npc_holt',
    'Holt',
    'the pit boss',
    'quest_giver',
    'rustpick',
    look('m', 4, 'ranger', 3, 'parted', 0, true),
    null,
    [
      'Adit four is collapsed and I want to know why.',
      'We dug through something. That is the honest version.',
    ],
  ],
  [
    'npc_ilse',
    'Ilse',
    'the surveyor',
    'quest_giver',
    'rustpick',
    look('f', 4, 'ranger', 1, 'long', 2),
    null,
    [
      'The canyon reads wrong on every chart I have.',
      'Something up there is worth mapping properly.',
    ],
  ],
  [
    'npc_dov',
    'Dov',
    'lift operator',
    'villager',
    'rustpick',
    look('m', 2, 'peasant', 1, 'buzzed', 3),
    null,
    ['Down is easy. Up is the job.', 'Do not lean on the rail.'],
  ],

  // ------------------------------------------------------------- Elder Grove (1)
  [
    'npc_hermit',
    'The Warden',
    'of the Elder Grove',
    'quest_giver',
    null,
    look('m', 0, 'ranger', 1, 'long', 7, true),
    null,
    [
      'You came through the arch. Few do.',
      'The Treant remembers longer than either of us will live.',
    ],
  ],
];

export const NPC_DEFS = PEOPLE.map(([id, name, title, role, , appearance, vendorId, barks]) => ({
  id,
  name,
  title,
  role,
  appearance,
  // Left at the schema default on purpose — see the header. `Idle_Loop`.
  idleClip: 'Idle_Loop',
  talkClip: '',
  vendorId: vendorId ?? null,
  barks: barks.map((text) => ({ text, emote: '' })),
  barkCooldownSec: 45,
  scale: 1,
}));

/** Which settlement each NPC stands in (null = placed by wish, not by town). */
export const NPC_TOWN = Object.fromEntries(PEOPLE.map(([id, , , , town]) => [id, town]));

/**
 * The four P11 pilot villagers stand in Dawnhaven too, and their placements
 * survived the new sea. They are re-placed with everyone else so a town's people
 * are laid out as one arrangement rather than two that never met.
 */
export const PILOT_NPCS = ['npc_marla', 'npc_torv', 'npc_hesta', 'npc_bran'];
