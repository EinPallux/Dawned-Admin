/**
 * The P10 gathering catalogue: every material, gem, proc and fish the four
 * professions produce, and the resource-node definitions that produce them.
 *
 * Two rules shape everything here.
 *
 * **Numbers are derived.** A material's vendor value comes from the shared
 * `itemValue` curve, exactly like the P8 gear did, so a tuning pass changes a
 * formula rather than forty rows. Authoring is about identity — what it is
 * called, which tier it belongs to, which icon, what the flavour line says.
 *
 * **Definitions are complete for all five tiers, placements are not.** The
 * definition of an Ashwood tree is cheap and belongs with the rest of the
 * ladder; where Ashwood trees STAND is a question only the Ashcrag Canyons can
 * answer, and that zone arrives with P12. So this file defines T1–T5 and the
 * placement pass (author-nodes.mjs) plants the T1–T2 half that the shipped
 * world has ground for.
 *
 * Icons are unique per item — the publish cross-check refuses duplicates, and
 * this file is where that promise is kept (ITEMS_LOOT.md §8).
 */

import { itemValue } from '@dawned/shared';

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * The ilvl a tier's materials sit at — the middle of the zone band they are
 * gathered in, so `itemValue` prices a T3 log against T3 gear rather than
 * against the whole ladder.
 */
const TIER_ILVL = { 1: 3, 2: 9, 3: 15, 4: 21, 5: 27 };

/**
 * How much more a rarer version of the same raw material fetches.
 *
 * The shared `itemValue` curve prices gear off its STAT BUDGET, and a material
 * has no slot to budget — so at ilvl 3 a rare fish and a common fish come out
 * of the formula within a copper of each other. That is right for gear and
 * wrong for a catch: a Sunscale that sells like a sprat is not a rare, it is a
 * differently-coloured sprat. The kicker lives here rather than in the shared
 * formula because changing that would re-price every weapon P8 shipped.
 */
const RARITY_WEIGHT = { common: 1, uncommon: 1.6, rare: 2.6, epic: 5, legendary: 9 };

/**
 * A stack of raw material. `common` unless a gem or a trophy says otherwise;
 * value from the shared curve with a category weight, because a log is worth
 * less than a ring of the same level and always will be.
 */
const material = ({
  id,
  name,
  tier,
  icon,
  flavor,
  rarity = 'common',
  weight = 0.35,
  stack = 50,
}) => ({
  id,
  name,
  category: 'material',
  slot: 'none',
  rarity,
  ilvl: TIER_ILVL[tier],
  icon,
  stack,
  value: Math.max(
    2,
    Math.round(
      itemValue('material', 'none', TIER_ILVL[tier], rarity) * weight * RARITY_WEIGHT[rarity],
    ),
  ),
  flavor,
});

/** Logs — woodcutting (PROFESSIONS.md §2). */
const LOGS = [
  material({
    id: 'item_material_birchwood_log',
    name: 'Birchwood Log',
    tier: 1,
    icon: 'delapouite/wood-beam',
    flavor: 'Pale, light, and forgiving of a first swing.',
  }),
  material({
    id: 'item_material_wealdoak_log',
    name: 'Wealdoak Log',
    tier: 2,
    icon: 'delapouite/log',
    flavor: 'Older than the path that leads to it.',
  }),
  material({
    id: 'item_material_emberbark_log',
    name: 'Emberbark Log',
    tier: 3,
    icon: 'lorc/burning-tree',
    flavor: 'Warm to the touch an hour after felling.',
  }),
  material({
    id: 'item_material_acacia_log',
    name: 'Sungraze Acacia',
    tier: 4,
    icon: 'lorc/tree-branch',
    flavor: 'Grew wide instead of tall. There was nothing to compete with.',
  }),
  material({
    id: 'item_material_ashwood_log',
    name: 'Ashwood Log',
    tier: 5,
    icon: 'lorc/dead-wood',
    flavor: 'Petrified long enough ago that nobody remembers the fire.',
  }),
];

/**
 * Ores — mining (§3). Copper already exists: it shipped with P8 as a loot
 * material, and re-authoring it under a second id would put two Copper Ores in
 * the game. It is bound into the T1 vein's yields instead.
 */
const ORES = [
  material({
    id: 'item_material_iron_ore',
    name: 'Iron Ore',
    tier: 2,
    icon: 'lorc/metal-bar',
    flavor: 'Heavier than it looks, which is the first thing every apprentice learns.',
  }),
  material({
    id: 'item_material_silverline_ore',
    name: 'Silverline Ore',
    tier: 3,
    icon: 'lorc/metal-scales',
    flavor: 'Runs through the ruin stone like a vein through a wrist.',
  }),
  material({
    id: 'item_material_gold_ore',
    name: 'Gold Ore',
    tier: 4,
    icon: 'delapouite/gold-stack',
    flavor: 'The ravine gives it up easily. That should worry you.',
  }),
  material({
    id: 'item_material_dawnstone',
    name: 'Dawnstone',
    tier: 5,
    icon: 'lorc/crystal-growth',
    flavor: 'Holds a little light of its own, and does not say where it got it.',
    rarity: 'uncommon',
  }),
];

/**
 * Herbs — herbalism (§4).
 *
 * Dawnpetal is re-authored rather than reused as-is. It shipped with P8 as an
 * ilvl-4 Dawnshore loot material, before the professions ladder existed; §4
 * makes it the ELDER GROVE's flower, T5 and rare. Left alone, the game would
 * have a legendary-sounding bloom that sells for ten gold and drops off a
 * spore-dweller — and the tier check in the game's gathering-content test
 * catches exactly that, which is how it was found. The Dawnshore spore table
 * gets Meadowbell instead (author-nodes.mjs re-points it), which is the herb
 * that shore actually grows.
 */
const HERBS = [
  material({
    id: 'item_material_meadowbell',
    name: 'Meadowbell',
    tier: 1,
    icon: 'lorc/daisy',
    flavor: 'Rings in wind nobody else can feel.',
  }),
  material({
    id: 'item_material_mossbloom',
    name: 'Mossbloom',
    tier: 2,
    icon: 'delapouite/grass',
    flavor: 'Glows faintly for about an hour after picking. Nobody knows why.',
  }),
  material({
    id: 'item_material_cinderleaf',
    name: 'Cinderleaf',
    tier: 3,
    icon: 'lorc/leaf-skeleton',
    flavor: 'Curls tighter the warmer it gets, like it is bracing.',
  }),
  material({
    id: 'item_material_sunblossom',
    name: 'Sunblossom',
    tier: 4,
    icon: 'delapouite/sunflower',
    flavor: 'Tall enough to see over the grass, which is the whole strategy.',
  }),
  material({
    id: 'item_material_duskthorn',
    name: 'Duskthorn',
    tier: 5,
    icon: 'lorc/thorny-vine',
    flavor: 'Draws blood on the way into the bag and again on the way out.',
  }),
  material({
    id: 'item_material_dawnpetal',
    name: 'Dawnpetal',
    tier: 5,
    icon: 'delapouite/herbs-bundle',
    rarity: 'rare',
    flavor: 'Opens at first light and closes on anyone who is late.',
  }),
];

/**
 * Gems — the mining proc (§3). Uncommon-to-rare, small stacks, and worth real
 * money: they are the reason a mining tour pays for itself.
 */
const gem = ({ id, name, tier, icon, flavor, rarity }) =>
  material({ id, name, tier, icon, flavor, rarity, weight: 1.1, stack: 20 });

const GEMS = [
  gem({
    id: 'item_material_gem_amethyst',
    name: 'Rough Amethyst',
    tier: 1,
    icon: 'delapouite/rupee',
    rarity: 'uncommon',
    flavor: 'Purple all the way through, which is rarer than the colour.',
  }),
  gem({
    id: 'item_material_gem_sapphire',
    name: 'Rough Sapphire',
    tier: 2,
    icon: 'lorc/saphir',
    rarity: 'uncommon',
    flavor: 'Cold in the palm long after you stop holding it up to the light.',
  }),
  gem({
    id: 'item_material_gem_emerald',
    name: 'Rough Emerald',
    tier: 3,
    icon: 'lorc/gem-chain',
    rarity: 'rare',
    flavor: 'The Weald grows one of these about as often as it grows an oak.',
  }),
  gem({
    id: 'item_material_gem_obsidian',
    name: 'Obsidian Shard',
    tier: 4,
    icon: 'lorc/stone-block',
    rarity: 'uncommon',
    flavor: 'An edge that was never sharpened and never needed to be.',
  }),
  gem({
    id: 'item_material_gem_diamond',
    name: 'Rough Diamond',
    tier: 5,
    icon: 'lorc/diamond-hard',
    rarity: 'rare',
    flavor: 'Survived whatever made the canyon. It will survive you.',
  }),
  gem({
    id: 'item_material_gem_sunstone',
    name: 'Sunstone',
    tier: 5,
    icon: 'lorc/sun-radiations',
    rarity: 'rare',
    flavor: 'Warm at dawn, warmer at noon, and warm all night.',
  }),
];

/** The other procs (§2–§4): sap, heartwood, geodes, stone, seeds. */
const PROCS = [
  material({
    id: 'item_material_resin',
    name: 'Tree Resin',
    tier: 1,
    icon: 'lorc/dripping-honey',
    flavor: 'Sticks to the bag, the hand, and eventually the memory.',
  }),
  material({
    id: 'item_material_golden_sap',
    name: 'Golden Sap',
    tier: 4,
    icon: 'delapouite/honey-jar',
    rarity: 'uncommon',
    weight: 0.8,
    flavor: 'Runs slowly enough that you can watch a full jar fill.',
  }),
  material({
    id: 'item_material_heartwood',
    name: 'Heartwood',
    tier: 3,
    icon: 'delapouite/tree-growth',
    rarity: 'rare',
    weight: 1.4,
    stack: 20,
    flavor: 'One tree in a hundred has a core worth the axe. This was one.',
  }),
  material({
    id: 'item_material_geode',
    name: 'Sealed Geode',
    tier: 2,
    icon: 'lorc/rock',
    rarity: 'uncommon',
    weight: 1,
    stack: 20,
    flavor: 'Heavy, hollow, and refusing to say which.',
  }),
  material({
    id: 'item_material_rough_stone',
    name: 'Rough Stone',
    tier: 1,
    icon: 'delapouite/stone-pile',
    weight: 0.18,
    flavor: 'Every vein gives some. Every vendor takes some.',
  }),
  material({
    id: 'item_material_seeds',
    name: 'Wild Seeds',
    tier: 2,
    icon: 'delapouite/seedling',
    weight: 0.5,
    flavor: 'Whatever these grow into, it is not growing in a backpack.',
  }),
];

/**
 * Fish (§5). Two signature catches per tier plus the tier's rare, and the
 * Old One at the bottom of the Dawnsea. Silver Trout already exists from P8
 * and rides along as a Weald catch rather than being authored twice.
 *
 * Rarity is not decoration here: it is the DIFFICULTY of the reel bar. A
 * `legendary` on a T1 shoal would be a fish nobody lands, which is why the
 * rares sit where their tier's players are.
 */
const fish = ({ id, name, tier, icon, flavor, rarity = 'common', weight = 0.55 }) =>
  material({ id, name, tier, icon, flavor, rarity, weight, stack: 20 });

const FISH = [
  fish({
    id: 'item_material_dawn_sprat',
    name: 'Dawn Sprat',
    tier: 1,
    icon: 'delapouite/circling-fish',
    flavor: 'Travels in numbers because it has nothing else going for it.',
  }),
  fish({
    id: 'item_material_tidenibbler',
    name: 'Tidenibbler',
    tier: 1,
    icon: 'delapouite/piranha',
    flavor: 'Takes the bait, the hook, and a little of the finger.',
  }),
  fish({
    id: 'item_material_sunscale',
    name: 'Sunscale',
    tier: 1,
    icon: 'delapouite/clownfish',
    rarity: 'rare',
    flavor: 'Comes up gold and stays gold for about four seconds.',
  }),
  fish({
    id: 'item_material_mossgill_perch',
    name: 'Mossgill Perch',
    tier: 2,
    icon: 'delapouite/fish-scales',
    flavor: 'Green enough to lose in the shallows it lives in.',
  }),
  fish({
    id: 'item_material_weald_trout',
    name: 'Weald Trout',
    tier: 2,
    icon: 'lorc/fishbone',
    flavor: 'Fights the whole way in and sulks afterwards.',
  }),
  fish({
    id: 'item_material_ghostfin',
    name: 'Ghostfin',
    tier: 2,
    icon: 'lorc/ghost',
    rarity: 'rare',
    flavor: 'Only ever caught after dark, and never twice in one night.',
  }),
  fish({
    id: 'item_material_emberkoi',
    name: 'Emberkoi',
    tier: 3,
    icon: 'delapouite/fish-monster',
    flavor: 'Orange in the water, red on the line, black in the pan.',
  }),
  fish({
    id: 'item_material_ashback_carp',
    name: 'Ashback Carp',
    tier: 3,
    icon: 'delapouite/whale-tail',
    flavor: 'Grey on top and worth it underneath.',
  }),
  fish({
    id: 'item_material_cinder_eel',
    name: 'Cinder Eel',
    tier: 3,
    icon: 'delapouite/eel',
    rarity: 'rare',
    flavor: 'Warm all the way along, which is not how eels work.',
  }),
  fish({
    id: 'item_material_goldjaw_bass',
    name: 'Goldjaw Bass',
    tier: 4,
    icon: 'delapouite/dolphin',
    flavor: 'Eats anything that fits and tries the rest anyway.',
  }),
  fish({
    id: 'item_material_steppe_pike',
    name: 'Steppe Pike',
    tier: 4,
    icon: 'lorc/sea-dragon',
    flavor: 'Long, patient, and out of patience the moment it sees the lure.',
  }),
  fish({
    id: 'item_material_duneswimmer',
    name: 'Duneswimmer',
    tier: 4,
    icon: 'delapouite/manta-ray',
    rarity: 'rare',
    flavor: 'Glides where the water is thinnest, as if the sand were the point.',
  }),
  fish({
    id: 'item_material_crag_fang',
    name: 'Crag Fang',
    tier: 5,
    icon: 'delapouite/shark-fin',
    flavor: 'The canyon pools are cold, deep, and occupied.',
  }),
  fish({
    id: 'item_material_deepsea_drum',
    name: 'Deepsea Drum',
    tier: 5,
    icon: 'delapouite/sperm-whale',
    flavor: 'You hear it before the line moves. Everyone says that. It is true.',
  }),
  fish({
    id: 'item_material_the_old_one',
    name: 'The Old One',
    tier: 5,
    icon: 'lorc/tentacle-strike',
    rarity: 'epic',
    // The one fish worth mounting on a wall. Priced as a trophy rather than as
    // a portion, because that is the whole reason to row out to the sandbar.
    weight: 3,
    flavor: 'It let go. That is the part nobody mentions afterwards.',
  }),
];

export const ITEM_DEFS = [...LOGS, ...ORES, ...HERBS, ...GEMS, ...PROCS, ...FISH];

// ---------------------------------------------------------------------------
// Resource nodes
// ---------------------------------------------------------------------------

/** Baked models, by the id the manifest gives them. */
const MODEL = {
  birch: 'world_nature_birchtree_2',
  oak: 'world_nature_commontree_3',
  maple: 'world_nature_mapletree_2',
  acacia: 'world_nature_twistedtree_2',
  deadTree: 'world_nature_deadtree_4',
  felledLog: 'world_nature_wood_log_b',
  copperVein: 'world_nature_rock_2_a_color1',
  ironVein: 'world_nature_rock_2_c_color1',
  silverVein: 'world_nature_rock_3_d_color1',
  goldVein: 'world_nature_rock_2_e_color1',
  dawnstoneVein: 'world_nature_rock_3_h_color1',
  spentRock: 'world_nature_rock_1_c_color1',
  meadowbell: 'world_nature_flower_1_clump',
  mossbloom: 'world_nature_flower_2_clump',
  cinderleaf: 'world_nature_fern_1',
  sunblossom: 'world_nature_flower_4_clump',
  duskthorn: 'world_nature_bush_small_flowers',
  dawnpetal: 'world_nature_flower_5_clump',
  shoal: 'world_nature_goldfish',
  koiPool: 'world_nature_koi',
  emberPool: 'world_nature_red_snapper',
  dunePool: 'world_nature_yellow_tang',
  deepwater: 'world_nature_swordfish',
};

/**
 * Respawn cadence, ms. §1.1 puts nodes at 90–180 s; higher tiers sit toward
 * the slow end so a T5 vein is worth walking to rather than camping.
 */
const RESPAWN = { 1: 90_000, 2: 105_000, 3: 120_000, 4: 150_000, 5: 180_000 };

const node = ({
  id,
  name,
  profession,
  tier,
  modelRef,
  depletedModelRef = null,
  yields,
  procs = [],
  radius = 1.2,
  respawnMs,
  bonusRolls = 0,
}) => ({
  id,
  name,
  profession,
  tier,
  modelRef,
  depletedModelRef,
  yields,
  procs,
  channelMs: 3000,
  respawnMs: respawnMs ?? RESPAWN[tier],
  radius,
  bonusRolls,
});

/** A common proc plus its tier gem — the two things a vein can hide. */
const oreProcs = (gemId) => [
  { itemId: 'item_material_geode', qtyMin: 1, qtyMax: 1, weight: 2 },
  { itemId: gemId, qtyMin: 1, qtyMax: 1, weight: 1 },
];

export const NODE_DEFS = [
  // --- woodcutting --------------------------------------------------------
  node({
    id: 'node_woodcutting_birch',
    name: 'Birch',
    profession: 'woodcutting',
    tier: 1,
    modelRef: MODEL.birch,
    depletedModelRef: MODEL.felledLog,
    radius: 1.4,
    yields: [{ itemId: 'item_material_birchwood_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
    procs: [{ itemId: 'item_material_resin', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  node({
    id: 'node_woodcutting_wealdoak',
    name: 'Wealdoak',
    profession: 'woodcutting',
    tier: 2,
    modelRef: MODEL.oak,
    depletedModelRef: MODEL.felledLog,
    radius: 1.8,
    yields: [{ itemId: 'item_material_wealdoak_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
    procs: [
      { itemId: 'item_material_resin', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_heartwood', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_woodcutting_emberbark',
    name: 'Emberbark',
    profession: 'woodcutting',
    tier: 3,
    modelRef: MODEL.maple,
    depletedModelRef: MODEL.felledLog,
    radius: 1.8,
    yields: [{ itemId: 'item_material_emberbark_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
    procs: [
      { itemId: 'item_material_resin', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_heartwood', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_woodcutting_acacia',
    name: 'Sungraze Acacia',
    profession: 'woodcutting',
    tier: 4,
    modelRef: MODEL.acacia,
    depletedModelRef: MODEL.felledLog,
    radius: 2,
    yields: [{ itemId: 'item_material_acacia_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
    procs: [
      { itemId: 'item_material_golden_sap', qtyMin: 1, qtyMax: 1, weight: 3 },
      { itemId: 'item_material_heartwood', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_woodcutting_ashwood',
    name: 'Ashwood',
    profession: 'woodcutting',
    tier: 5,
    modelRef: MODEL.deadTree,
    depletedModelRef: MODEL.felledLog,
    radius: 2,
    yields: [{ itemId: 'item_material_ashwood_log', qtyMin: 1, qtyMax: 3, weight: 1 }],
    procs: [
      { itemId: 'item_material_golden_sap', qtyMin: 1, qtyMax: 1, weight: 2 },
      { itemId: 'item_material_heartwood', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),

  // --- mining -------------------------------------------------------------
  // Stone comes off every vein (§3) as a weighted second entry rather than a
  // proc: it is not a surprise, it is what mining mostly gives you.
  node({
    id: 'node_mining_copper',
    name: 'Copper Vein',
    profession: 'mining',
    tier: 1,
    modelRef: MODEL.copperVein,
    depletedModelRef: MODEL.spentRock,
    yields: [
      { itemId: 'item_material_copper_ore', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_rough_stone', qtyMin: 1, qtyMax: 3, weight: 2 },
    ],
    procs: oreProcs('item_material_gem_amethyst'),
  }),
  node({
    id: 'node_mining_iron',
    name: 'Iron Vein',
    profession: 'mining',
    tier: 2,
    modelRef: MODEL.ironVein,
    depletedModelRef: MODEL.spentRock,
    yields: [
      { itemId: 'item_material_iron_ore', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_rough_stone', qtyMin: 1, qtyMax: 3, weight: 2 },
    ],
    procs: oreProcs('item_material_gem_sapphire'),
  }),
  node({
    id: 'node_mining_silverline',
    name: 'Silverline Vein',
    profession: 'mining',
    tier: 3,
    modelRef: MODEL.silverVein,
    depletedModelRef: MODEL.spentRock,
    yields: [
      { itemId: 'item_material_silverline_ore', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_rough_stone', qtyMin: 1, qtyMax: 3, weight: 2 },
    ],
    procs: oreProcs('item_material_gem_emerald'),
  }),
  node({
    id: 'node_mining_gold',
    name: 'Gold Vein',
    profession: 'mining',
    tier: 4,
    modelRef: MODEL.goldVein,
    depletedModelRef: MODEL.spentRock,
    yields: [
      { itemId: 'item_material_gold_ore', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_rough_stone', qtyMin: 1, qtyMax: 3, weight: 2 },
    ],
    procs: oreProcs('item_material_gem_obsidian'),
  }),
  node({
    id: 'node_mining_dawnstone',
    name: 'Dawnstone Vein',
    profession: 'mining',
    tier: 5,
    modelRef: MODEL.dawnstoneVein,
    depletedModelRef: MODEL.spentRock,
    yields: [
      { itemId: 'item_material_dawnstone', qtyMin: 1, qtyMax: 2, weight: 3 },
      { itemId: 'item_material_rough_stone', qtyMin: 1, qtyMax: 3, weight: 2 },
    ],
    procs: [
      { itemId: 'item_material_gem_diamond', qtyMin: 1, qtyMax: 1, weight: 1 },
      { itemId: 'item_material_gem_sunstone', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),

  // --- herbalism ----------------------------------------------------------
  // No depleted model anywhere: a picked herb leaves bare ground (§1.1).
  node({
    id: 'node_herbalism_meadowbell',
    name: 'Meadowbell',
    profession: 'herbalism',
    tier: 1,
    modelRef: MODEL.meadowbell,
    radius: 0.9,
    yields: [{ itemId: 'item_material_meadowbell', qtyMin: 1, qtyMax: 2, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  node({
    id: 'node_herbalism_mossbloom',
    name: 'Mossbloom',
    profession: 'herbalism',
    tier: 2,
    modelRef: MODEL.mossbloom,
    radius: 0.9,
    yields: [{ itemId: 'item_material_mossbloom', qtyMin: 1, qtyMax: 2, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  node({
    id: 'node_herbalism_cinderleaf',
    name: 'Cinderleaf',
    profession: 'herbalism',
    tier: 3,
    modelRef: MODEL.cinderleaf,
    radius: 1,
    yields: [{ itemId: 'item_material_cinderleaf', qtyMin: 1, qtyMax: 2, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  node({
    id: 'node_herbalism_sunblossom',
    name: 'Sunblossom',
    profession: 'herbalism',
    tier: 4,
    modelRef: MODEL.sunblossom,
    radius: 1,
    yields: [{ itemId: 'item_material_sunblossom', qtyMin: 1, qtyMax: 2, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  node({
    id: 'node_herbalism_duskthorn',
    name: 'Duskthorn',
    profession: 'herbalism',
    tier: 5,
    modelRef: MODEL.duskthorn,
    radius: 1.1,
    yields: [{ itemId: 'item_material_duskthorn', qtyMin: 1, qtyMax: 2, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),
  /**
   * The Elder Grove's one flower (§4). Ten-minute respawn and a bonus proc
   * roll, because it is the only node in the game you go somewhere FOR.
   */
  node({
    id: 'node_herbalism_dawnpetal',
    name: 'Dawnpetal',
    profession: 'herbalism',
    tier: 5,
    modelRef: MODEL.dawnpetal,
    radius: 1.1,
    respawnMs: 600_000,
    bonusRolls: 1,
    yields: [{ itemId: 'item_material_dawnpetal', qtyMin: 1, qtyMax: 1, weight: 1 }],
    procs: [{ itemId: 'item_material_seeds', qtyMin: 1, qtyMax: 2, weight: 1 }],
  }),

  // --- fishing ------------------------------------------------------------
  // The node IS the fish under the surface; a fished-out spot shows nothing,
  // so none of these carry a depleted model.
  node({
    id: 'node_fishing_shore_shoal',
    name: 'Shore Shoal',
    profession: 'fishing',
    tier: 1,
    modelRef: MODEL.shoal,
    radius: 1.6,
    yields: [
      { itemId: 'item_material_dawn_sprat', qtyMin: 1, qtyMax: 2, weight: 5 },
      { itemId: 'item_material_tidenibbler', qtyMin: 1, qtyMax: 1, weight: 4 },
      { itemId: 'item_material_sunscale', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_fishing_weald_pool',
    name: 'Weald Pool',
    profession: 'fishing',
    tier: 2,
    modelRef: MODEL.koiPool,
    radius: 1.6,
    yields: [
      { itemId: 'item_material_mossgill_perch', qtyMin: 1, qtyMax: 2, weight: 5 },
      { itemId: 'item_material_weald_trout', qtyMin: 1, qtyMax: 1, weight: 3 },
      { itemId: 'item_material_silver_trout', qtyMin: 1, qtyMax: 1, weight: 2 },
      { itemId: 'item_material_ghostfin', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_fishing_ember_run',
    name: 'Ember Run',
    profession: 'fishing',
    tier: 3,
    modelRef: MODEL.emberPool,
    radius: 1.6,
    yields: [
      { itemId: 'item_material_emberkoi', qtyMin: 1, qtyMax: 2, weight: 5 },
      { itemId: 'item_material_ashback_carp', qtyMin: 1, qtyMax: 1, weight: 4 },
      { itemId: 'item_material_cinder_eel', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  node({
    id: 'node_fishing_dune_water',
    name: 'Steppe Water',
    profession: 'fishing',
    tier: 4,
    modelRef: MODEL.dunePool,
    radius: 1.6,
    yields: [
      { itemId: 'item_material_goldjaw_bass', qtyMin: 1, qtyMax: 2, weight: 5 },
      { itemId: 'item_material_steppe_pike', qtyMin: 1, qtyMax: 1, weight: 4 },
      { itemId: 'item_material_duneswimmer', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
  /**
   * The sandbar spot — the only place the Old One is in the tables at all, and
   * at a weight that means most trips out there end with a Drum instead.
   */
  node({
    id: 'node_fishing_deepsea',
    name: 'Deepsea Sandbar',
    profession: 'fishing',
    tier: 5,
    modelRef: MODEL.deepwater,
    radius: 2,
    yields: [
      { itemId: 'item_material_crag_fang', qtyMin: 1, qtyMax: 2, weight: 6 },
      { itemId: 'item_material_deepsea_drum', qtyMin: 1, qtyMax: 1, weight: 4 },
      { itemId: 'item_material_the_old_one', qtyMin: 1, qtyMax: 1, weight: 1 },
    ],
  }),
];

// ---------------------------------------------------------------------------
// Placements on the shipped world
// ---------------------------------------------------------------------------

/**
 * Where the T1–T2 nodes stand on the live island.
 *
 * §1.4 asks for CLUSTERS of 3–6 near landmarks rather than an even sprinkle,
 * so gathering tours double as sightseeing. Each entry here is a **hint**, not
 * a coordinate: `author-nodes.mjs` searches outward from it for ground that
 * suits the cluster (dry for a tree, wet for a shoal), scatters the members
 * deterministically around whatever it finds, and drops any member the terrain
 * still refuses.
 *
 * Hints rather than coordinates because a number typed against a mental image
 * of the island is a guess — the first pass of this list put every fishing
 * cluster on dry land and planted exactly zero shoals, which is the kind of
 * mistake that ships as "fishing is in, we just could not find any".
 *
 * T3–T5 nodes have definitions and no placements: their zones do not exist
 * until P12, and inventing coordinates for ground nobody has sculpted would be
 * content that has to be deleted later.
 */
export const NODE_CLUSTERS = [
  // Dawnshore — the southern two thirds of the island, T1 everything.
  { nodeId: 'node_woodcutting_birch', x: -150, z: 120, count: 5, spread: 11 },
  { nodeId: 'node_woodcutting_birch', x: 60, z: 200, count: 4, spread: 10 },
  { nodeId: 'node_woodcutting_birch', x: 180, z: 60, count: 4, spread: 10 },
  { nodeId: 'node_mining_copper', x: -60, z: 300, count: 4, spread: 8 },
  { nodeId: 'node_mining_copper', x: 140, z: 260, count: 4, spread: 8 },
  { nodeId: 'node_herbalism_meadowbell', x: -200, z: 180, count: 5, spread: 9 },
  { nodeId: 'node_herbalism_meadowbell', x: 20, z: 90, count: 4, spread: 9 },
  // The inland lake's southern shore and the south coast.
  { nodeId: 'node_fishing_shore_shoal', x: -170, z: -20, count: 3, spread: 9, water: true },
  { nodeId: 'node_fishing_shore_shoal', x: -40, z: 450, count: 3, spread: 9, water: true },

  // Verdant Weald — the north-west quarter, T2.
  { nodeId: 'node_woodcutting_wealdoak', x: -120, z: -200, count: 5, spread: 12 },
  { nodeId: 'node_woodcutting_wealdoak', x: -220, z: -300, count: 4, spread: 11 },
  { nodeId: 'node_woodcutting_wealdoak', x: -60, z: -320, count: 4, spread: 11 },
  { nodeId: 'node_mining_iron', x: -180, z: -140, count: 4, spread: 8 },
  { nodeId: 'node_mining_iron', x: -100, z: -380, count: 3, spread: 8 },
  { nodeId: 'node_herbalism_mossbloom', x: -240, z: -180, count: 5, spread: 10 },
  { nodeId: 'node_herbalism_mossbloom', x: -140, z: -260, count: 4, spread: 9 },
  // The lake's north-west arm, inside the Weald.
  { nodeId: 'node_fishing_weald_pool', x: -215, z: -85, count: 3, spread: 9, water: true },
];
