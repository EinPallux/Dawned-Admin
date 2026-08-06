/**
 * The P8 launch catalogue: Dawnshore (T1, ilvl 1–6) and Verdant Weald (T2,
 * ilvl 7–12) items, the loot tables that drop them, the Dawnhaven vendors that
 * sell them, and the loot bindings for the live enemy roster.
 *
 * Numbers are DERIVED, not typed: every stat block, damage band and price runs
 * through the shared ITEMS_LOOT §2 formulas (`statBudget`, `weaponDamageFor`,
 * `itemValue`) — the same ones the panel's budget meter and the game's drop
 * roller use. Authoring here means choosing identity (name, slot, ilvl,
 * rarity, which attributes, which icon, the flavour line); the curve does the
 * arithmetic, so a tuning pass changes one formula and not sixty rows.
 *
 * Dropped gear deliberately spends only part of its budget up front and
 * carries a `rollPool`: the rest arrives as the per-copy roll (§2 "rarity
 * decides HOW MANY attributes"). Vendor stock has no pool — a shop item is the
 * same item every time you look at it.
 */

import { itemValue, statBudget, weaponDamageFor } from '@dawned/shared';

/** Split a budget across attributes by weight, integers, remainder to the first. */
const splitStats = (budget, weights) => {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const keys = Object.keys(weights);
  const stats = {};
  let spent = 0;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      stats[key] = Math.max(1, budget - spent);
      return;
    }
    const share = Math.max(1, Math.round((budget * weights[key]) / total));
    stats[key] = share;
    spent += share;
  });
  return stats;
};

/** Fraction of the budget a droppable piece fixes; the rest is rolled per copy. */
const FIXED_SHARE = 0.55;

const gear = ({
  id,
  name,
  category,
  slot,
  ilvl,
  rarity = 'common',
  icon,
  flavor,
  weights,
  rollPool,
  armorClass = null,
  classLock = [],
  modelRef = null,
  weapon = null,
  effect = null,
  requiresLevel = null,
}) => {
  const budget = statBudget(slot, ilvl, rarity);
  const points = Math.max(1, Math.round(budget * (rollPool ? FIXED_SHARE : 1)));
  const def = {
    id,
    name,
    category,
    slot,
    rarity,
    ilvl,
    classLock,
    stack: 1,
    value: itemValue(category, slot, ilvl, rarity),
    icon,
    modelRef,
    flavor,
    stats: splitStats(points, weights),
    armorClass,
    effect,
    requiresLevel: requiresLevel ?? ilvl,
    bound: false,
  };
  if (rollPool) def.rollPool = rollPool;
  if (weapon) {
    const band = weaponDamageFor(ilvl);
    def.weapon = { dmgMin: band.min, dmgMax: band.max, twoHanded: weapon.twoHanded ?? false };
  }
  return def;
};

const consumable = ({ id, name, ilvl, icon, flavor, consumable: block, rarity = 'common' }) => ({
  id,
  name,
  category: 'consumable',
  slot: 'none',
  rarity,
  ilvl,
  classLock: [],
  stack: 20,
  value: itemValue('consumable', 'none', ilvl, rarity),
  icon,
  modelRef: null,
  flavor,
  stats: {},
  weapon: null,
  armorClass: null,
  effect: null,
  consumable: block,
  requiresLevel: 1,
  bound: false,
});

const simple = ({ id, name, category, ilvl, icon, flavor, value, stack = 50 }) => ({
  id,
  name,
  category,
  slot: 'none',
  rarity: 'common',
  ilvl,
  classLock: [],
  stack,
  value,
  icon,
  modelRef: null,
  flavor,
  stats: {},
  weapon: null,
  armorClass: null,
  effect: null,
  consumable: null,
  requiresLevel: 1,
  bound: false,
});

// ---------------------------------------------------------------------------
// Weapons & offhands — the only gear that changes how a character LOOKS (§1)
// ---------------------------------------------------------------------------

const WEAPONS = [
  gear({
    id: 'item_weapon_sword_shoreguard',
    name: 'Shoreguard Blade',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 2,
    icon: 'lorc/shard-sword',
    flavor: 'Standard issue for the watch that never quite forms.',
    classLock: ['warrior'],
    modelRef: 'items_weapons_sword_a',
    weapon: {},
    weights: { str: 3, vit: 1 },
    rollPool: ['str', 'vit', 'end'],
  }),
  gear({
    id: 'item_weapon_sword_dawnsteel',
    name: 'Dawnsteel Longsword',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 7,
    rarity: 'uncommon',
    icon: 'lorc/relic-blade',
    flavor: 'Folded at first light, quenched in seawater, sharper for both.',
    classLock: ['warrior'],
    modelRef: 'items_weapons_sword_b',
    weapon: {},
    weights: { str: 3, vit: 1 },
    rollPool: ['str', 'vit', 'agi'],
  }),
  gear({
    id: 'item_weapon_axe_tidesplitter',
    name: 'Tidesplitter',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 4,
    icon: 'lorc/stone-axe',
    flavor: 'Older than the harbour. Younger than the grudge it settles.',
    classLock: ['warrior'],
    modelRef: 'items_weapons_axe_a',
    weapon: {},
    weights: { str: 4, end: 1 },
    rollPool: ['str', 'end', 'vit'],
  }),
  gear({
    id: 'item_weapon_axe_wealdcleaver',
    name: 'Wealdcleaver',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 10,
    rarity: 'rare',
    icon: 'lorc/battle-axe',
    flavor: 'The Weald grows back. Slowly, and with a grudge.',
    classLock: ['warrior'],
    modelRef: 'items_weapons_axe_b',
    weapon: {},
    weights: { str: 4, vit: 2, end: 1 },
    rollPool: ['str', 'vit', 'end'],
  }),
  gear({
    id: 'item_weapon_hammer_shorebreaker',
    name: 'Shorebreaker Maul',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 5,
    rarity: 'uncommon',
    icon: 'lorc/spiked-mace',
    flavor: 'Named for what it does to boats, not what it does to glubs.',
    classLock: ['warrior'],
    modelRef: 'items_weapons_hammer_a',
    weapon: { twoHanded: true },
    weights: { str: 4, end: 1 },
    rollPool: ['str', 'end'],
  }),
  gear({
    id: 'item_weapon_dagger_glubfang',
    name: 'Glubfang',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 2,
    icon: 'lorc/curvy-knife',
    flavor: 'A tooth that outlived its owner and kept the habit of biting.',
    classLock: ['rogue'],
    modelRef: 'items_weapons_dagger_a',
    weapon: {},
    weights: { agi: 3, str: 1 },
    rollPool: ['agi', 'str', 'end'],
  }),
  gear({
    id: 'item_weapon_dagger_mosswhisper',
    name: 'Mosswhisper',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 7,
    rarity: 'uncommon',
    icon: 'lorc/bowie-knife',
    flavor: 'Quiet enough that the Weald keeps talking around you.',
    classLock: ['rogue'],
    modelRef: 'items_weapons_dagger_b',
    weapon: {},
    weights: { agi: 4, str: 1 },
    rollPool: ['agi', 'str', 'vit'],
  }),
  gear({
    id: 'item_weapon_dagger_bonepick',
    name: 'Bonepick',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 10,
    rarity: 'rare',
    icon: 'lorc/bone-knife',
    flavor: 'Whatever it was carved from was not interested in giving it up.',
    classLock: ['rogue'],
    modelRef: 'items_weapons_dagger_a',
    weapon: {},
    weights: { agi: 4, str: 2, end: 1 },
    rollPool: ['agi', 'str', 'end'],
  }),
  gear({
    id: 'item_weapon_staff_driftwood',
    name: 'Driftwood Stave',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 2,
    icon: 'lorc/wizard-staff',
    flavor: 'The sea sanded it smooth; someone else added the sparks.',
    classLock: ['mage'],
    modelRef: 'items_weapons_staff_a',
    weapon: { twoHanded: true },
    weights: { int: 3, vit: 1 },
    rollPool: ['int', 'vit', 'end'],
  }),
  gear({
    id: 'item_weapon_staff_sunspire',
    name: 'Sunspire Rod',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 9,
    rarity: 'rare',
    icon: 'lorc/eclipse-flare',
    flavor: 'Holds a little of every dawn it has stood through.',
    classLock: ['mage'],
    modelRef: 'items_weapons_staff_b',
    weapon: { twoHanded: true },
    weights: { int: 4, vit: 2, end: 1 },
    rollPool: ['int', 'vit', 'end'],
  }),
  gear({
    id: 'item_weapon_wand_tidecaller',
    name: 'Tidecaller Wand',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 5,
    rarity: 'uncommon',
    icon: 'lorc/crystal-wand',
    flavor: 'Points at water. Water, so far, has taken the hint.',
    classLock: ['mage'],
    modelRef: 'items_weapons_wand_a',
    weapon: {},
    weights: { int: 4, end: 1 },
    rollPool: ['int', 'end', 'vit'],
  }),
  gear({
    id: 'item_weapon_mace_dawnlight',
    name: 'Dawnlight Mace',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 3,
    icon: 'delapouite/warhammer',
    flavor: 'Blessed twice: once properly, once by a very tired acolyte.',
    classLock: ['cleric'],
    modelRef: 'items_weapons_hammer_b',
    weapon: {},
    weights: { int: 3, vit: 1 },
    rollPool: ['int', 'vit', 'str'],
  }),
  gear({
    id: 'item_weapon_mace_wealdward',
    name: 'Wealdward Mace',
    category: 'weapon',
    slot: 'mainhand',
    ilvl: 9,
    rarity: 'rare',
    icon: 'lorc/hammer-drop',
    flavor: 'Carried on the long walk in. Rarely needed on the walk out.',
    classLock: ['cleric'],
    modelRef: 'items_weapons_hammer_c',
    weapon: {},
    weights: { int: 4, vit: 2, end: 1 },
    rollPool: ['int', 'vit', 'end'],
  }),
  gear({
    id: 'item_offhand_shield_shoreguard',
    name: 'Shoreguard Buckler',
    category: 'offhand',
    slot: 'offhand',
    ilvl: 3,
    icon: 'lorc/checked-shield',
    flavor: 'Dented in the shape of one specific glub.',
    classLock: ['warrior', 'cleric'],
    modelRef: 'items_weapons_shield_a',
    weights: { vit: 3, end: 1 },
    rollPool: ['vit', 'end', 'str'],
  }),
  gear({
    id: 'item_offhand_shield_wealdwall',
    name: 'Wealdwall Shield',
    category: 'offhand',
    slot: 'offhand',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/edged-shield',
    flavor: 'Bark-faced, iron-hearted — the Weald lends, it does not give.',
    classLock: ['warrior', 'cleric'],
    modelRef: 'items_weapons_shield_b',
    weights: { vit: 3, end: 2 },
    rollPool: ['vit', 'end', 'str'],
  }),
];

// ---------------------------------------------------------------------------
// Armour — stats only, never a visual change (§1)
// ---------------------------------------------------------------------------

/** slot → [T1 light, T1 medium, T2 heavy] icons. */
const ARMOR_PIECES = [
  {
    slot: 'head',
    icons: ['lorc/hood', 'lorc/barbute', 'lorc/visored-helm'],
    names: ['Shorewatch Hood', 'Dawnhaven Helm', 'Wealdward Greathelm'],
  },
  {
    slot: 'chest',
    icons: ['lorc/leather-vest', 'lorc/armor-vest', 'lorc/breastplate'],
    names: ['Shorewatch Jerkin', 'Dawnhaven Hauberk', 'Wealdward Cuirass'],
  },
  {
    slot: 'legs',
    icons: ['lorc/trousers', 'delapouite/leg-armor', 'lorc/scale-mail'],
    names: ['Shorewatch Breeches', 'Dawnhaven Greaves', 'Wealdward Legguards'],
  },
  {
    slot: 'boots',
    icons: ['lorc/leather-boot', 'lorc/boots', 'lorc/steeltoe-boots'],
    names: ['Shorewatch Boots', 'Dawnhaven Striders', 'Wealdward Sabatons'],
  },
  {
    slot: 'gloves',
    icons: ['delapouite/gloves', 'lorc/mailed-fist', 'delapouite/gauntlet'],
    names: ['Shorewatch Wraps', 'Dawnhaven Gloves', 'Wealdward Gauntlets'],
  },
];

const ARMOR_TIERS = [
  { suffix: 'light', ilvl: 3, rarity: 'common', armorClass: 'light', weights: { agi: 2, int: 1 } },
  {
    suffix: 'medium',
    ilvl: 6,
    rarity: 'uncommon',
    armorClass: 'medium',
    weights: { vit: 2, str: 1 },
  },
  {
    suffix: 'heavy',
    ilvl: 11,
    rarity: 'rare',
    armorClass: 'heavy',
    weights: { vit: 3, str: 2, end: 1 },
  },
];

/** Light T2 pieces so casters have a Weald-tier option that isn't plate. */
const WEALD_LIGHT = [
  gear({
    id: 'item_armor_head_weald_cowl',
    name: 'Weald Cowl',
    category: 'armor',
    slot: 'head',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/cowled',
    flavor: 'Dyed the exact green of not being noticed.',
    armorClass: 'light',
    weights: { int: 2, agi: 1 },
    rollPool: ['int', 'agi', 'end', 'vit'],
  }),
  gear({
    id: 'item_armor_chest_weald_robe',
    name: 'Weald Robe',
    category: 'armor',
    slot: 'chest',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/robe',
    flavor: 'Heavier than it looks. Most of that is moss.',
    armorClass: 'light',
    weights: { int: 3, vit: 1 },
    rollPool: ['int', 'agi', 'end', 'vit'],
  }),
];

const ARMOR = ARMOR_PIECES.flatMap((piece) =>
  ARMOR_TIERS.map((tier, index) =>
    gear({
      id: `item_armor_${piece.slot}_${tier.suffix}`,
      name: piece.names[index],
      category: 'armor',
      slot: piece.slot,
      ilvl: tier.ilvl,
      rarity: tier.rarity,
      icon: piece.icons[index],
      flavor:
        index === 0
          ? 'Cut for a shore watch that mostly watches the weather.'
          : index === 1
            ? 'Dawnhaven pattern: practical, repairable, faintly smug.'
            : 'Weald-tested. The dents are testimonials.',
      armorClass: tier.armorClass,
      weights: tier.weights,
      rollPool: ['vit', 'end', 'str', 'agi', 'int'],
    }),
  ),
);

// ---------------------------------------------------------------------------
// Jewelry — pure stat sticks (§1)
// ---------------------------------------------------------------------------

const JEWELRY = [
  gear({
    id: 'item_jewelry_ring_tidewrought',
    name: 'Tidewrought Band',
    category: 'jewelry',
    slot: 'ring',
    ilvl: 4,
    icon: 'delapouite/ring',
    flavor: 'Salt-pitted silver, still stubbornly round.',
    weights: { agi: 2, vit: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_ring_mossgold',
    name: 'Mossgold Ring',
    category: 'jewelry',
    slot: 'ring',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/emerald',
    flavor: 'The Weald keeps gold the way it keeps everything: overgrown.',
    weights: { int: 2, vit: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_ring_ashenloop',
    name: 'Ashen Loop',
    category: 'jewelry',
    slot: 'ring',
    ilvl: 11,
    rarity: 'rare',
    icon: 'lorc/gems',
    flavor: 'Warm to the touch on cold mornings. Nobody asks why.',
    weights: { str: 2, end: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_amulet_shorelight',
    name: 'Shorelight Pendant',
    category: 'jewelry',
    slot: 'amulet',
    ilvl: 5,
    icon: 'lorc/gem-pendant',
    flavor: 'Catches the first light and holds it a moment too long.',
    weights: { vit: 2, int: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_amulet_pearlrow',
    name: 'Pearlrow Necklace',
    category: 'jewelry',
    slot: 'amulet',
    ilvl: 10,
    rarity: 'uncommon',
    icon: 'delapouite/pearl-necklace',
    flavor: 'Nine pearls, eight of them honest.',
    weights: { int: 2, vit: 2 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_trinket_glubcharm',
    name: 'Glubtooth Charm',
    category: 'jewelry',
    slot: 'trinket',
    ilvl: 4,
    icon: 'delapouite/tusks-flag',
    flavor: 'Wards off glubs, allegedly, by being made of one.',
    weights: { end: 2, agi: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_trinket_sporeward',
    name: 'Sporeward Talisman',
    category: 'jewelry',
    slot: 'trinket',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/rune-stone',
    flavor: 'Hum it and the spores drift the other way. Mostly.',
    weights: { vit: 2, end: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_trinket_harbour_satchel',
    name: 'Harbour Satchel',
    category: 'jewelry',
    slot: 'trinket',
    ilvl: 6,
    rarity: 'uncommon',
    icon: 'delapouite/backpack',
    flavor: 'Smells of rope and yesterday. Carries more than it should.',
    weights: { end: 2, vit: 1 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
  }),
  gear({
    id: 'item_jewelry_trinket_wanderers_knot',
    name: "Wanderer's Knot",
    category: 'jewelry',
    slot: 'trinket',
    ilvl: 12,
    rarity: 'epic',
    icon: 'lorc/belt-buckles',
    flavor: 'Tied by someone who meant to come back for it.',
    weights: { end: 2, agi: 2 },
    rollPool: ['agi', 'str', 'int', 'vit', 'end'],
    effect: { kind: 'stat_pct', stat: 'sprintSpeed', pct: 4 },
  }),
];

// ---------------------------------------------------------------------------
// Consumables (§7) — potions share one 15 s lane
// ---------------------------------------------------------------------------

const CONSUMABLES = [
  consumable({
    id: 'item_consumable_potion_minor',
    name: 'Minor Healing Draught',
    ilvl: 1,
    icon: 'delapouite/health-potion',
    flavor: 'Tastes of kelp. Works anyway.',
    consumable: { lane: 'potion', cooldownMs: 15000, healPctMaxHp: 30 },
  }),
  consumable({
    id: 'item_consumable_potion_lesser',
    name: 'Lesser Healing Draught',
    ilvl: 8,
    rarity: 'uncommon',
    icon: 'lorc/heart-bottle',
    flavor: 'The Weald recipe: more moss, less kelp, fewer complaints.',
    consumable: { lane: 'potion', cooldownMs: 15000, healPctMaxHp: 35 },
  }),
  consumable({
    id: 'item_consumable_tonic_minor',
    name: 'Minor Tonic',
    ilvl: 1,
    icon: 'lorc/potion-ball',
    flavor: 'Mana for those who have it, breath for those who do not.',
    consumable: {
      lane: 'potion',
      cooldownMs: 15000,
      restorePctResource: 35,
      restoreStamina: 25,
    },
  }),
  consumable({
    id: 'item_consumable_tonic_lesser',
    name: 'Lesser Tonic',
    ilvl: 8,
    rarity: 'uncommon',
    icon: 'lorc/bubbling-flask',
    flavor: 'Fizzes. Should not fizz. Nobody has died of it yet.',
    consumable: {
      lane: 'potion',
      cooldownMs: 15000,
      restorePctResource: 45,
      restoreStamina: 40,
    },
  }),
  consumable({
    id: 'item_consumable_rations_travelers',
    name: "Traveler's Rations",
    ilvl: 2,
    icon: 'delapouite/meal',
    flavor: 'Bread, hard cheese, and the optimism of the person who packed it.',
    consumable: {
      lane: 'food',
      cooldownMs: 60000,
      channelMs: 3000,
      buff: {
        effectId: 'effect_well_fed',
        durationMs: 600000,
        stats: { vit: 2 },
        hpPctPerSecond: 6,
        breaksOnDamage: true,
      },
    },
  }),
  consumable({
    id: 'item_consumable_rations_weald',
    name: 'Weald Provisions',
    ilvl: 9,
    rarity: 'uncommon',
    icon: 'lorc/sliced-bread',
    flavor: 'Whatever the Weald was willing to part with, salted.',
    consumable: {
      lane: 'food',
      cooldownMs: 60000,
      channelMs: 3000,
      buff: {
        effectId: 'effect_well_fed_greater',
        durationMs: 600000,
        stats: { vit: 4, end: 2 },
        hpPctPerSecond: 6,
        breaksOnDamage: true,
      },
    },
  }),
  consumable({
    id: 'item_consumable_elixir_shore',
    name: 'Shorewind Elixir',
    ilvl: 6,
    rarity: 'uncommon',
    icon: 'lorc/standing-potion',
    flavor: "Dawnhaven's alchemist swears it is mostly sea air.",
    consumable: {
      lane: 'food',
      cooldownMs: 60000,
      buff: {
        effectId: 'effect_elixir_shorewind',
        durationMs: 600000,
        stats: { agi: 3 },
        breaksOnDamage: false,
      },
    },
  }),
  consumable({
    id: 'item_consumable_antidote',
    name: 'Antidote',
    ilvl: 3,
    icon: 'lorc/spiral-bottle',
    flavor: 'For spores, mostly. Works on regret at a much lower rate.',
    consumable: {
      lane: 'antidote',
      cooldownMs: 8000,
      cleanses: ['poison', 'bleed'],
    },
  }),
];

// ---------------------------------------------------------------------------
// Junk & materials — the vendoring loop (§1, §5)
// ---------------------------------------------------------------------------

const JUNK = [
  simple({
    id: 'item_junk_cracked_shell',
    name: 'Cracked Glub Shell',
    category: 'junk',
    ilvl: 1,
    icon: 'lorc/spiral-shell',
    flavor: 'Held together by habit.',
    value: 6,
  }),
  simple({
    id: 'item_junk_torn_netting',
    name: 'Torn Netting',
    category: 'junk',
    ilvl: 1,
    icon: 'lorc/fishing-hook',
    flavor: 'Someone gave up on this before you found it.',
    value: 5,
  }),
  simple({
    id: 'item_junk_spore_sac',
    name: 'Burst Spore Sac',
    category: 'junk',
    ilvl: 3,
    icon: 'lorc/spotted-mushroom',
    flavor: 'Still faintly damp. Sells better than it smells.',
    value: 9,
  }),
  simple({
    id: 'item_junk_chipped_tusk',
    name: 'Chipped Tusk',
    category: 'junk',
    ilvl: 5,
    icon: 'lorc/skull-crack',
    flavor: 'The rest of the mushnub declined to comment.',
    value: 14,
  }),
  simple({
    id: 'item_junk_broken_flask',
    name: 'Broken Flask',
    category: 'junk',
    ilvl: 4,
    icon: 'lorc/broken-bottle',
    flavor: "Alchemy's least successful afternoon, bottled.",
    value: 11,
  }),
  simple({
    id: 'item_junk_glub_pearl',
    name: 'Glub Pearl',
    category: 'junk',
    ilvl: 6,
    icon: 'delapouite/pearl-earring',
    flavor: '§5 treasure junk: worth real coin, useful for absolutely nothing.',
    value: 46,
    stack: 20,
  }),
  simple({
    id: 'item_junk_soggy_ledger',
    name: 'Soggy Ledger',
    category: 'junk',
    ilvl: 7,
    icon: 'lorc/tied-scroll',
    flavor: 'Three names, two sums, one very wet apology.',
    value: 22,
  }),
];

const MATERIALS = [
  simple({
    id: 'item_material_driftwood',
    name: 'Driftwood Log',
    category: 'material',
    ilvl: 1,
    icon: 'lorc/leaf-swirl',
    flavor: 'The sea returns what it borrows, eventually, in worse condition.',
    value: 4,
  }),
  simple({
    id: 'item_material_copper_ore',
    name: 'Copper Ore',
    category: 'material',
    ilvl: 3,
    icon: 'delapouite/gold-nuggets',
    flavor: 'Green where it should be bright — Dawnshore does that.',
    value: 8,
  }),
  simple({
    id: 'item_material_silver_trout',
    name: 'Silver Trout',
    category: 'material',
    ilvl: 5,
    icon: 'lorc/fish-corpse',
    flavor: 'Fast, silver, and now yours.',
    value: 12,
  }),
  simple({
    id: 'item_material_shore_crystal',
    name: 'Shore Crystal',
    category: 'material',
    ilvl: 7,
    icon: 'lorc/crystal-cluster',
    flavor: 'Grows where the tide gives up. Alchemists pay for the honesty.',
    value: 20,
  }),
  simple({
    id: 'item_material_mushcap',
    name: 'Weald Mushcap',
    category: 'material',
    ilvl: 8,
    icon: 'lorc/mushroom',
    flavor: 'Harvested from something that was recently walking around.',
    value: 18,
  }),
];

export const ITEM_DEFS = [
  ...WEAPONS,
  ...ARMOR,
  ...WEALD_LIGHT,
  ...JEWELRY,
  ...CONSUMABLES,
  ...JUNK,
  ...MATERIALS,
];

// ---------------------------------------------------------------------------
// Loot tables (§4) — nesting keeps a tier's gear pool authored once
// ---------------------------------------------------------------------------

const gearEntries = (ids, weight) => ids.map((ref) => ({ kind: 'item', ref, weight }));

export const LOOT_TABLE_DEFS = [
  {
    id: 'loot_dawnshore_gear',
    name: 'Dawnshore Gear (T1)',
    entries: gearEntries(
      [
        'item_weapon_sword_shoreguard',
        'item_weapon_dagger_glubfang',
        'item_weapon_staff_driftwood',
        'item_weapon_mace_dawnlight',
        'item_weapon_axe_tidesplitter',
        'item_offhand_shield_shoreguard',
        'item_armor_head_light',
        'item_armor_chest_light',
        'item_armor_legs_light',
        'item_armor_boots_light',
        'item_armor_gloves_light',
        'item_jewelry_ring_tidewrought',
        'item_jewelry_amulet_shorelight',
        'item_jewelry_trinket_glubcharm',
      ],
      10,
    ).concat(
      gearEntries(
        [
          'item_weapon_hammer_shorebreaker',
          'item_weapon_wand_tidecaller',
          'item_armor_head_medium',
          'item_armor_chest_medium',
          'item_armor_legs_medium',
          'item_armor_boots_medium',
          'item_armor_gloves_medium',
        ],
        3,
      ),
    ),
  },
  {
    id: 'loot_weald_gear',
    name: 'Verdant Weald Gear (T2)',
    entries: gearEntries(
      [
        'item_weapon_sword_dawnsteel',
        'item_weapon_dagger_mosswhisper',
        'item_weapon_mace_wealdward',
        'item_weapon_staff_sunspire',
        'item_offhand_shield_wealdwall',
        'item_armor_head_medium',
        'item_armor_chest_medium',
        'item_armor_legs_medium',
        'item_armor_boots_medium',
        'item_armor_gloves_medium',
        'item_jewelry_ring_mossgold',
        'item_jewelry_amulet_pearlrow',
        'item_jewelry_trinket_sporeward',
        'item_armor_head_weald_cowl',
        'item_armor_chest_weald_robe',
      ],
      10,
    ).concat(
      gearEntries(
        [
          'item_weapon_axe_wealdcleaver',
          'item_weapon_dagger_bonepick',
          'item_armor_head_heavy',
          'item_armor_chest_heavy',
          'item_armor_legs_heavy',
          'item_armor_boots_heavy',
          'item_armor_gloves_heavy',
          'item_jewelry_ring_ashenloop',
        ],
        3,
      ),
    ),
  },
  {
    id: 'loot_dawnshore_trash',
    name: 'Dawnshore Trash',
    entries: [
      // §4's target: an at-level Dawnshore kill pays gear about once in ten.
      { kind: 'nothing', weight: 46 },
      { kind: 'item', ref: 'item_junk_cracked_shell', weight: 14, minQty: 1, maxQty: 2 },
      { kind: 'item', ref: 'item_junk_torn_netting', weight: 10 },
      { kind: 'item', ref: 'item_junk_broken_flask', weight: 6 },
      { kind: 'item', ref: 'item_material_driftwood', weight: 8, minQty: 1, maxQty: 2 },
      { kind: 'item', ref: 'item_consumable_potion_minor', weight: 5 },
      { kind: 'gold', weight: 8, minQty: 2, maxQty: 7 },
      { kind: 'table', ref: 'loot_dawnshore_gear', weight: 10 },
    ],
  },
  {
    id: 'loot_dawnshore_spore',
    name: 'Dawnshore Spore-dwellers',
    entries: [
      { kind: 'nothing', weight: 42 },
      { kind: 'item', ref: 'item_junk_spore_sac', weight: 16, minQty: 1, maxQty: 2 },
      { kind: 'item', ref: 'item_junk_chipped_tusk', weight: 8 },
      { kind: 'item', ref: 'item_material_meadowbell', weight: 8 },
      { kind: 'item', ref: 'item_consumable_tonic_minor', weight: 6 },
      { kind: 'item', ref: 'item_consumable_antidote', weight: 4 },
      { kind: 'gold', weight: 8, minQty: 3, maxQty: 9 },
      { kind: 'table', ref: 'loot_dawnshore_gear', weight: 12 },
      // Higher-level killers start seeing Weald pieces here.
      { kind: 'table', ref: 'loot_weald_gear', weight: 4, minKillerLevel: 7 },
    ],
  },
  {
    id: 'loot_weald_trash',
    name: 'Verdant Weald Trash',
    entries: [
      { kind: 'nothing', weight: 40 },
      { kind: 'item', ref: 'item_junk_soggy_ledger', weight: 10 },
      { kind: 'item', ref: 'item_junk_chipped_tusk', weight: 10, minQty: 1, maxQty: 2 },
      { kind: 'item', ref: 'item_junk_glub_pearl', weight: 2 },
      { kind: 'item', ref: 'item_material_shore_crystal', weight: 6 },
      { kind: 'item', ref: 'item_material_mushcap', weight: 10, minQty: 1, maxQty: 3 },
      { kind: 'item', ref: 'item_consumable_potion_lesser', weight: 6 },
      { kind: 'gold', weight: 10, minQty: 6, maxQty: 16 },
      { kind: 'table', ref: 'loot_weald_gear', weight: 14 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Vendors (§6) — market posts on the Dawnhaven shore until P12 places NPCs
// ---------------------------------------------------------------------------

export const VENDOR_DEFS = [
  {
    id: 'vendor_general_dawnhaven',
    name: 'Dawnhaven General Goods',
    kind: 'general',
    greeting: 'Dawn finds you well. Potions, food, and whatever else you forgot.',
    buyMult: 1,
    sellMult: 0.25,
    anchor: { x: -6, z: 394, radius: 3.5 },
    stock: [
      { itemId: 'item_consumable_potion_minor' },
      { itemId: 'item_consumable_tonic_minor' },
      { itemId: 'item_consumable_rations_travelers' },
      { itemId: 'item_consumable_antidote' },
    ],
  },
  {
    id: 'vendor_weaponsmith_dawnhaven',
    name: 'Dawnhaven Weaponsmith',
    kind: 'weaponsmith',
    greeting: 'Everything on this rack has been dropped at least once. Sold anyway.',
    buyMult: 1,
    sellMult: 0.25,
    anchor: { x: 6, z: 394, radius: 3.5 },
    stock: [
      { itemId: 'item_weapon_sword_shoreguard' },
      { itemId: 'item_weapon_axe_tidesplitter' },
      { itemId: 'item_weapon_dagger_glubfang' },
      { itemId: 'item_weapon_staff_driftwood' },
      { itemId: 'item_weapon_mace_dawnlight' },
      { itemId: 'item_weapon_hammer_shorebreaker' },
      { itemId: 'item_weapon_wand_tidecaller' },
      { itemId: 'item_offhand_shield_shoreguard' },
    ],
  },
  {
    id: 'vendor_armorer_dawnhaven',
    name: 'Dawnhaven Armorer',
    kind: 'armorer',
    greeting: 'Fill the gaps. The Weald does not care which slot is empty.',
    buyMult: 1,
    sellMult: 0.25,
    anchor: { x: -6, z: 388, radius: 3.5 },
    stock: [
      { itemId: 'item_armor_head_light' },
      { itemId: 'item_armor_chest_light' },
      { itemId: 'item_armor_legs_light' },
      { itemId: 'item_armor_boots_light' },
      { itemId: 'item_armor_gloves_light' },
      { itemId: 'item_armor_chest_medium' },
      { itemId: 'item_armor_boots_medium' },
      { itemId: 'item_jewelry_ring_tidewrought' },
      { itemId: 'item_jewelry_amulet_shorelight' },
    ],
  },
  {
    id: 'vendor_alchemist_dawnhaven',
    name: 'Dawnhaven Alchemist',
    kind: 'alchemist',
    greeting: 'Drink it, do not ask, come back tomorrow.',
    buyMult: 1.1,
    sellMult: 0.25,
    anchor: { x: 6, z: 388, radius: 3.5 },
    stock: [
      { itemId: 'item_consumable_potion_lesser' },
      { itemId: 'item_consumable_tonic_lesser' },
      { itemId: 'item_consumable_elixir_shore' },
      { itemId: 'item_consumable_rations_weald' },
      { itemId: 'item_consumable_antidote', priceOverride: 12 },
    ],
  },
  {
    id: 'vendor_collector_dawnhaven',
    name: 'The Harbour Collector',
    kind: 'collector',
    greeting: 'Shells, netting, ledgers — bring me the parts nobody wants.',
    buyMult: 1,
    // §6: the Collector pays over the odds for junk and sells nothing.
    sellMult: 0.35,
    anchor: { x: 0, z: 396, radius: 3.5 },
    stock: [],
  },
];

/**
 * What each live enemy pays out (§4). Rolls stay at 1 for normal ranks; the
 * gold band is the enemy's own, on top of anything the table rolls.
 */
export const ENEMY_LOOT = [
  {
    enemyId: 'enemy_shore_glub',
    loot: { tableId: 'loot_dawnshore_trash', rolls: 1, goldMin: 1, goldMax: 4 },
  },
  {
    enemyId: 'enemy_young_mushnub',
    loot: { tableId: 'loot_dawnshore_spore', rolls: 1, goldMin: 3, goldMax: 8 },
  },
  {
    enemyId: 'enemy_spore_lobber',
    loot: { tableId: 'loot_dawnshore_spore', rolls: 1, goldMin: 4, goldMax: 10 },
  },
];
