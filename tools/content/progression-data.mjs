/**
 * The P7 skill trees as data: all 96 CLASSES.md nodes (4 classes × 3 branches
 * × 8), transcribed into the shared skill-node schema. Values are the doc's
 * "per rank" numbers written CUMULATIVELY per rank (the schema stores each
 * rank's TOTAL effect — "+3% per rank" reads [3, 6, 9]).
 *
 * Authoring decisions folded here (USER_QUESTIONS "P7 tree defaults"):
 *  - Tier layout by listed order: nodes 1-2 → tier 1, 3-4 → tier 2,
 *    5-6 → tier 3, 7 → tier 4, node 8 = capstone (8 pts in-branch + L25).
 *  - Multi-rank "special" nodes ramp linearly to the doc value at max rank
 *    (Scorched Ground rank 1 burns at half rate, Overflow rank 1 converts
 *    15%, Searing Smite rank 1 ticks half the DoT…).
 * Every number is one panel edit away — these are the shipped defaults.
 */

/** Node builder — keeps 96 declarations honest and identical in shape. */
const node = (classId, branch, order, name, maxRanks, ranks, extra = {}) => ({
  id: `node_${classId}_${branch}_${name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`,
  classId,
  branch,
  name,
  icon: extra.icon ?? '',
  description: extra.description ?? '',
  tier: extra.capstone ? 5 : order <= 2 ? 1 : order <= 4 ? 2 : order <= 6 ? 3 : 4,
  capstone: extra.capstone ?? false,
  order,
  maxRanks,
  ranks,
});

const stat = (mods) => ({ kind: 'stat', mods });
const abilityMod = (abilityId, mods) => ({ kind: 'ability_mod', abilityId, mods });
const effectMod = (category, rest) => ({ kind: 'effect_mod', category, ...rest });
const conditional = (rest) => ({ kind: 'conditional_damage', ...rest });
const stance = (rest) => ({ kind: 'stance_mod', ...rest });
const passive = (rest) => ({ kind: 'passive_mod', ...rest });
const proc = (kind, rest) => ({ kind: 'proc', proc: kind, ...rest });

/** Self-buff appended on use of an ability (Momentum, Battle Roar…). */
const afterUseBuff = (effectId, durationMs, mods) => ({
  kind: 'apply_effect',
  target: 'self',
  effectId,
  durationMs,
  stacksMax: 1,
  category: 'buff',
  mods,
});

export const SKILL_NODE_DEFS = [
  // =========================================================================
  // WARRIOR — Bulwark (survive)
  // =========================================================================
  node('warrior', 'bulwark', 1, 'Toughened', 3, [
    [stat({ maxHpPct: 3 })],
    [stat({ maxHpPct: 6 })],
    [stat({ maxHpPct: 9 })],
  ]),
  node('warrior', 'bulwark', 2, 'Plated', 3, [
    [stat({ armorPct: 5 })],
    [stat({ armorPct: 10 })],
    [stat({ armorPct: 15 })],
  ]),
  node('warrior', 'bulwark', 3, 'Stalwart Block', 2, [
    [stance({ blockStaminaCostPct: -8 })],
    [stance({ blockStaminaCostPct: -16 })],
  ]),
  node('warrior', 'bulwark', 4, 'Thick Skull', 1, [[stat({ ccOnYouDurationPct: -20 })]]),
  node('warrior', 'bulwark', 5, 'Retribution', 2, [
    [proc('block_thorns', { coef: 0.2 })],
    [proc('block_thorns', { coef: 0.4 })],
  ]),
  node('warrior', 'bulwark', 6, 'Unbreakable', 2, [
    [
      abilityMod('ability_warrior_shield_wall', {
        buffDurationDeltaMs: 1000,
        cooldownDeltaMs: -5000,
      }),
    ],
    [
      abilityMod('ability_warrior_shield_wall', {
        buffDurationDeltaMs: 2000,
        cooldownDeltaMs: -10000,
      }),
    ],
  ]),
  node('warrior', 'bulwark', 7, 'Second Wind', 1, [
    [proc('low_hp_heal', { thresholdPct: 25, healPct: 20, icdMs: 90000 })],
  ]),
  node(
    'warrior',
    'bulwark',
    8,
    'Immovable',
    1,
    [
      [
        abilityMod('ability_warrior_shield_wall', {
          addEffects: [
            {
              kind: 'apply_effect',
              target: 'self',
              effectId: 'immovable_mending',
              durationMs: 6000,
              stacksMax: 1,
              category: 'buff',
              mods: {
                periodic: {
                  kind: 'heal',
                  coefTotal: 0,
                  school: 'magic',
                  tickEveryMs: 1000,
                  pctMaxHpTotal: 30,
                },
              },
            },
          ],
        }),
        stance({ perfectBlockStaminaRefund: 10 }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // WARRIOR — Warlord (damage)
  // =========================================================================
  node('warrior', 'warlord', 1, 'Sharpened', 3, [
    [stat({ physicalDamagePct: 2 })],
    [stat({ physicalDamagePct: 4 })],
    [stat({ physicalDamagePct: 6 })],
  ]),
  node('warrior', 'warlord', 2, 'Brutality', 2, [
    [abilityMod('ability_warrior_crushing_blow', { damagePct: 10 })],
    [abilityMod('ability_warrior_crushing_blow', { damagePct: 20 })],
  ]),
  node('warrior', 'warlord', 3, 'Deep Wounds', 2, [
    [abilityMod('ability_warrior_rending_slash', { dotDamagePct: 15, dotDurationDeltaMs: 2000 })],
    [abilityMod('ability_warrior_rending_slash', { dotDamagePct: 30, dotDurationDeltaMs: 4000 })],
  ]),
  node('warrior', 'warlord', 4, 'Momentum', 2, [
    [
      abilityMod('ability_warrior_charge', {
        addEffects: [afterUseBuff('momentum', 5000, { damageDealtPct: 10 })],
      }),
    ],
    [
      abilityMod('ability_warrior_charge', {
        addEffects: [afterUseBuff('momentum', 5000, { damageDealtPct: 20 })],
      }),
    ],
  ]),
  node('warrior', 'warlord', 5, 'Cleaving Blows', 2, [
    [abilityMod('ability_warrior_basic_3', { arcDeltaDeg: 15, maxTargetsDelta: 1 })],
    [abilityMod('ability_warrior_basic_3', { arcDeltaDeg: 30, maxTargetsDelta: 2 })],
  ]),
  node('warrior', 'warlord', 6, 'Executioner', 2, [
    [conditional({ vsHpBelowPct: 30, pct: 5 })],
    [conditional({ vsHpBelowPct: 30, pct: 10 })],
  ]),
  node('warrior', 'warlord', 7, 'Rampage', 1, [
    [abilityMod('ability_warrior_whirlwind', { ticksDelta: 1 })],
  ]),
  node(
    'warrior',
    'warlord',
    8,
    'Warbringer',
    1,
    [[abilityMod('ability_warrior_earthshatter', { cooldownDeltaMs: -15000, coefDelta: 0.5 })]],
    { capstone: true },
  ),

  // =========================================================================
  // WARRIOR — Juggernaut (rage & utility)
  // =========================================================================
  node('warrior', 'juggernaut', 1, 'Boiling Blood', 3, [
    [stat({ rageOnBasicHitDelta: 1 })],
    [stat({ rageOnBasicHitDelta: 2 })],
    [stat({ rageOnBasicHitDelta: 3 })],
  ]),
  node('warrior', 'juggernaut', 2, 'Enraging Defense', 2, [
    [stat({ rageWhenHitDelta: 2 })],
    [stat({ rageWhenHitDelta: 4 })],
  ]),
  node('warrior', 'juggernaut', 3, 'Fleet', 2, [
    [stat({ moveSpeedPct: 3 })],
    [stat({ moveSpeedPct: 6 })],
  ]),
  node('warrior', 'juggernaut', 4, 'Battle Roar', 1, [
    [
      abilityMod('ability_warrior_taunting_shout', {
        addEffects: [afterUseBuff('battle_roar', 6000, { damageDealtPct: 10 })],
      }),
    ],
  ]),
  node('warrior', 'juggernaut', 5, 'Steadfast Charge', 1, [
    [abilityMod('ability_warrior_charge', { breakMovementOnUse: true })],
  ]),
  node('warrior', 'juggernaut', 6, 'Relentless', 2, [
    [stat({ ccDealtDurationDeltaMs: 250 })],
    [stat({ ccDealtDurationDeltaMs: 500 })],
  ]),
  node('warrior', 'juggernaut', 7, 'Marathon', 2, [
    [stat({ sprintStaminaPerSDelta: -1 })],
    [stat({ sprintStaminaPerSDelta: -2 })],
  ]),
  node(
    'warrior',
    'juggernaut',
    8,
    'Colossus',
    1,
    [
      [
        proc('resource_spent_stacks', {
          resource: 'rage',
          perSpent: 30,
          effectId: 'colossus',
          durationMs: 10000,
          stacksMax: 3,
          mods: { damageDealtPct: 3, armorPct: 3 },
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // MAGE — Pyromancy (burst)
  // =========================================================================
  node('mage', 'pyromancy', 1, 'Kindling', 3, [
    [
      abilityMod('ability_mage_fireball', { damagePct: 2 }),
      abilityMod('ability_mage_ember_wave', { damagePct: 2 }),
      abilityMod('ability_mage_meteor', { damagePct: 2 }),
      effectMod('burn', { dotDamagePct: 2 }),
    ],
    [
      abilityMod('ability_mage_fireball', { damagePct: 4 }),
      abilityMod('ability_mage_ember_wave', { damagePct: 4 }),
      abilityMod('ability_mage_meteor', { damagePct: 4 }),
      effectMod('burn', { dotDamagePct: 4 }),
    ],
    [
      abilityMod('ability_mage_fireball', { damagePct: 6 }),
      abilityMod('ability_mage_ember_wave', { damagePct: 6 }),
      abilityMod('ability_mage_meteor', { damagePct: 6 }),
      effectMod('burn', { dotDamagePct: 6 }),
    ],
  ]),
  node('mage', 'pyromancy', 2, 'Ignition', 2, [
    [effectMod('burn', { dotDamagePct: 15 })],
    [effectMod('burn', { dotDamagePct: 30 })],
  ]),
  node('mage', 'pyromancy', 3, 'Fireball Mastery', 2, [
    [abilityMod('ability_mage_fireball', { castDeltaMs: -100 })],
    [abilityMod('ability_mage_fireball', { castDeltaMs: -200 })],
  ]),
  node('mage', 'pyromancy', 4, 'Combustion', 1, [
    [
      abilityMod('ability_mage_ember_wave', {
        consumeBonus: { category: 'burn', per: 'target', coef: 0.3, max: 3 },
      }),
    ],
  ]),
  node('mage', 'pyromancy', 5, 'Scorched Ground', 2, [
    [
      abilityMod('ability_mage_meteor', {
        addEffects: [
          {
            kind: 'zone',
            radius: 5,
            durationMs: 4000,
            tickEveryMs: 1000,
            team: 'enemies',
            tick: { kind: 'damage', coef: 0.15, school: 'magic' },
          },
        ],
      }),
    ],
    [
      abilityMod('ability_mage_meteor', {
        addEffects: [
          {
            kind: 'zone',
            radius: 5,
            durationMs: 4000,
            tickEveryMs: 1000,
            team: 'enemies',
            tick: { kind: 'damage', coef: 0.3, school: 'magic' },
          },
        ],
      }),
    ],
  ]),
  node('mage', 'pyromancy', 6, 'Critical Mass', 2, [
    [stat({ spellCritPct: 2 })],
    [stat({ spellCritPct: 4 })],
  ]),
  node('mage', 'pyromancy', 7, 'Backdraft', 1, [
    [abilityMod('ability_mage_blink', { resetCooldownOf: 'ability_mage_ember_wave' })],
  ]),
  node(
    'mage',
    'pyromancy',
    8,
    'Supernova',
    1,
    [
      [
        abilityMod('ability_mage_meteor', {
          radiusDelta: 1.5,
          epicenterStun: { radius: 2, durationMs: 1000 },
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // MAGE — Cryomancy (control)
  // =========================================================================
  node('mage', 'cryomancy', 1, 'Frostbite', 3, [
    [conditional({ vsCategories: ['chill'], pct: 2 })],
    [conditional({ vsCategories: ['chill'], pct: 4 })],
    [conditional({ vsCategories: ['chill'], pct: 6 })],
  ]),
  node('mage', 'cryomancy', 2, 'Deep Chill', 2, [
    [effectMod('chill', { moveSpeedDeltaPct: -7 })],
    [effectMod('chill', { moveSpeedDeltaPct: -14 })],
  ]),
  node('mage', 'cryomancy', 3, 'Wide Nova', 2, [
    [abilityMod('ability_mage_frost_nova', { radiusDelta: 0.75 })],
    [abilityMod('ability_mage_frost_nova', { radiusDelta: 1.5 })],
  ]),
  node('mage', 'cryomancy', 4, 'Shatter', 2, [
    [abilityMod('ability_mage_ice_lance', { critVs: { categories: ['root'], pct: 15 } })],
    [abilityMod('ability_mage_ice_lance', { critVs: { categories: ['root'], pct: 30 } })],
  ]),
  node('mage', 'cryomancy', 5, 'Permafrost', 1, [
    [abilityMod('ability_mage_frost_nova', { ccDurationDeltaMs: 500 })],
  ]),
  node('mage', 'cryomancy', 6, 'Glacial Armor', 2, [
    [
      stat({ damageTakenPct: -3 }),
      proc('melee_attacker_apply', {
        effectId: 'glacial_chill',
        category: 'chill',
        durationMs: 4000,
        mods: { moveSpeedPct: -20 },
      }),
    ],
    [
      stat({ damageTakenPct: -6 }),
      proc('melee_attacker_apply', {
        effectId: 'glacial_chill',
        category: 'chill',
        durationMs: 4000,
        mods: { moveSpeedPct: -20 },
      }),
    ],
  ]),
  node('mage', 'cryomancy', 7, 'Cold Snap', 1, [
    [abilityMod('ability_mage_frost_nova', { cooldownDeltaMs: -4000 })],
  ]),
  node(
    'mage',
    'cryomancy',
    8,
    "Winter's Grasp",
    1,
    [
      [
        abilityMod('ability_mage_ice_lance', {
          addEffects: [
            {
              kind: 'apply_effect',
              target: 'hit',
              effectId: 'winters_grasp',
              durationMs: 8000,
              stacksMax: 3,
              category: 'chill',
              mods: { damageDealtPct: -5 },
            },
          ],
          addEffectsRequireCategories: ['chill'],
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // MAGE — Arcana (resource & mobility)
  // =========================================================================
  node('mage', 'arcana', 1, 'Clarity', 3, [
    [stat({ maxManaPct: 5 })],
    [stat({ maxManaPct: 10 })],
    [stat({ maxManaPct: 15 })],
  ]),
  node('mage', 'arcana', 2, 'Flow', 2, [
    [stat({ manaRegenPct: 10 })],
    [stat({ manaRegenPct: 20 })],
  ]),
  node('mage', 'arcana', 3, 'Swift Recovery', 2, [
    [passive({ attunementManaDelta: 2 })],
    [passive({ attunementManaDelta: 4 })],
  ]),
  node('mage', 'arcana', 4, 'Elastic Blink', 2, [
    [abilityMod('ability_mage_blink', { rangeDelta: 1.5 })],
    [abilityMod('ability_mage_blink', { rangeDelta: 3 })],
  ]),
  node('mage', 'arcana', 5, 'Barrier Tuning', 2, [
    [abilityMod('ability_mage_mana_shield', { manaShieldPerPoint: 1.875 })],
    [abilityMod('ability_mage_mana_shield', { manaShieldPerPoint: 1.75 })],
  ]),
  node('mage', 'arcana', 6, 'Quickened Barrage', 1, [
    [abilityMod('ability_mage_arcane_barrage', { channelDeltaMs: -600 })],
  ]),
  node('mage', 'arcana', 7, 'Traveler', 2, [
    [stat({ moveSpeedPct: 3 })],
    [stat({ moveSpeedPct: 6 })],
  ]),
  node(
    'mage',
    'arcana',
    8,
    'Archmage',
    1,
    [
      [
        abilityMod('ability_mage_meteor', { costDelta: -20 }),
        abilityMod('ability_mage_blink', {
          onUseGrant: { mana: 10, nextCastInstant: { icdMs: 10000 } },
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // ROGUE — Assassination (crit & single-target)
  // =========================================================================
  node('rogue', 'assassination', 1, 'Honed Edges', 3, [
    [stat({ physicalDamagePct: 2 })],
    [stat({ physicalDamagePct: 4 })],
    [stat({ physicalDamagePct: 6 })],
  ]),
  node('rogue', 'assassination', 2, 'Lethality', 3, [
    [stat({ critPct: 1.5 })],
    [stat({ critPct: 3 })],
    [stat({ critPct: 4.5 })],
  ]),
  node('rogue', 'assassination', 3, 'Opportunist', 2, [
    [passive({ ambusherRearCritDelta: 5 })],
    [passive({ ambusherRearCritDelta: 10 })],
  ]),
  node('rogue', 'assassination', 4, 'Deep Cuts', 2, [
    [abilityMod('ability_rogue_eviscerate', { coefPerComboPointDelta: 0.1 })],
    [abilityMod('ability_rogue_eviscerate', { coefPerComboPointDelta: 0.2 })],
  ]),
  node('rogue', 'assassination', 5, 'Ruthless', 1, [
    [abilityMod('ability_rogue_death_mark', { markDamagePctDelta: 5 })],
  ]),
  node('rogue', 'assassination', 6, 'Flensing', 2, [
    [conditional({ vsCategories: ['poison', 'bleed'], pct: 4 })],
    [conditional({ vsCategories: ['poison', 'bleed'], pct: 8 })],
  ]),
  node('rogue', 'assassination', 7, "Killer's Rhythm", 1, [
    [
      proc('on_kill_buff', {
        effectId: 'killers_rhythm',
        durationMs: 6000,
        mods: { attackSpeedPct: 20 },
      }),
    ],
  ]),
  node(
    'rogue',
    'assassination',
    8,
    'Perfect Kill',
    1,
    [[abilityMod('ability_rogue_eviscerate', { guaranteedCritAtCp: { cp: 5, icdMs: 12000 } })]],
    { capstone: true },
  ),

  // =========================================================================
  // ROGUE — Swiftblade (energy & mobility)
  // =========================================================================
  node('rogue', 'swiftblade', 1, 'Conditioning', 3, [
    [stat({ maxEnergyDelta: 5 })],
    [stat({ maxEnergyDelta: 10 })],
    [stat({ maxEnergyDelta: 15 })],
  ]),
  node('rogue', 'swiftblade', 2, 'Vigor', 2, [
    [stat({ energyRegenDelta: 1 })],
    [stat({ energyRegenDelta: 2 })],
  ]),
  node('rogue', 'swiftblade', 3, 'Fleetfoot', 2, [
    [stat({ moveSpeedPct: 3 })],
    [stat({ moveSpeedPct: 6 })],
  ]),
  node('rogue', 'swiftblade', 4, 'Momentum Step', 1, [
    [abilityMod('ability_rogue_shadowstep', { cooldownDeltaMs: -3000 })],
  ]),
  node('rogue', 'swiftblade', 5, 'Endless Knives', 2, [
    [abilityMod('ability_rogue_fan_of_knives', { costDelta: -5 })],
    [abilityMod('ability_rogue_fan_of_knives', { costDelta: -10 })],
  ]),
  node('rogue', 'swiftblade', 6, 'Combo Flow', 2, [
    [passive({ finisherRefund: { minCp: 3, energyPerCp: 2.5 } })],
    [passive({ finisherRefund: { minCp: 3, energyPerCp: 5 } })],
  ]),
  node('rogue', 'swiftblade', 7, 'Acrobat', 2, [
    [stat({ dodgeStaminaCostDelta: -5 })],
    [stat({ dodgeStaminaCostDelta: -10 })],
  ]),
  node(
    'rogue',
    'swiftblade',
    8,
    'Flurry',
    1,
    [
      [
        abilityMod('ability_rogue_shadowstep', {
          empowerBasics: { count: 3, attackSpeedPct: 40, comboPointsPer: 1 },
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // ROGUE — Toxicologist (poison & AoE)
  // =========================================================================
  node('rogue', 'toxicologist', 1, 'Virulence', 3, [
    [effectMod('poison', { dotDamagePct: 8 })],
    [effectMod('poison', { dotDamagePct: 16 })],
    [effectMod('poison', { dotDamagePct: 24 })],
  ]),
  node('rogue', 'toxicologist', 2, 'Numbing Toxin', 2, [
    [effectMod('poison', { addTargetMods: { damageDealtPct: -4 } })],
    [effectMod('poison', { addTargetMods: { damageDealtPct: -8 } })],
  ]),
  node('rogue', 'toxicologist', 3, 'Spreading Blades', 1, [
    [
      abilityMod('ability_rogue_fan_of_knives', {
        addEffects: [
          {
            kind: 'apply_effect',
            target: 'hit',
            effectId: 'poison_blades',
            durationMs: 6000,
            stacksMax: 3,
            category: 'poison',
            mods: {
              periodic: { kind: 'damage', coefTotal: 0.25, school: 'physical', tickEveryMs: 1500 },
            },
          },
        ],
      }),
    ],
  ]),
  node('rogue', 'toxicologist', 4, 'Lingering', 2, [
    [effectMod('poison', { durationDeltaMs: 1500 })],
    [effectMod('poison', { durationDeltaMs: 3000 })],
  ]),
  node('rogue', 'toxicologist', 5, 'Cripple Mastery', 2, [
    [abilityMod('ability_rogue_crippling_strike', { appliedMoveSpeedDeltaPct: -8 })],
    [abilityMod('ability_rogue_crippling_strike', { appliedMoveSpeedDeltaPct: -16 })],
  ]),
  node('rogue', 'toxicologist', 6, 'Smoke Trickery', 1, [
    [abilityMod('ability_rogue_smoke_veil', { buffDurationDeltaMs: 1000 })],
  ]),
  node('rogue', 'toxicologist', 7, 'Caustic Burst', 2, [
    [
      abilityMod('ability_rogue_eviscerate', {
        consumeBonus: { category: 'poison', per: 'stack', coef: 0.15, max: 3 },
      }),
    ],
    [
      abilityMod('ability_rogue_eviscerate', {
        consumeBonus: { category: 'poison', per: 'stack', coef: 0.3, max: 3 },
      }),
    ],
  ]),
  node(
    'rogue',
    'toxicologist',
    8,
    'Plaguebearer',
    1,
    [[passive({ poisonsCanCrit: true, poisonJumpOnDeath: true })]],
    { capstone: true },
  ),

  // =========================================================================
  // CLERIC — Light (healing)
  // =========================================================================
  node('cleric', 'light', 1, 'Devotion', 3, [
    [stat({ healingDonePct: 3 })],
    [stat({ healingDonePct: 6 })],
    [stat({ healingDonePct: 9 })],
  ]),
  node('cleric', 'light', 2, 'Swift Mending', 2, [
    [abilityMod('ability_cleric_mend', { castDeltaMs: -100 })],
    [abilityMod('ability_cleric_mend', { castDeltaMs: -200 })],
  ]),
  node('cleric', 'light', 3, 'Blessed Ground', 2, [
    [abilityMod('ability_cleric_sanctuary', { zoneDurationDeltaMs: 1000, zoneRadiusDelta: 0.5 })],
    [abilityMod('ability_cleric_sanctuary', { zoneDurationDeltaMs: 2000, zoneRadiusDelta: 1 })],
  ]),
  node('cleric', 'light', 4, 'Cleansing Light', 1, [
    [abilityMod('ability_cleric_purify', { healCoefDelta: 0.4 })],
  ]),
  node('cleric', 'light', 5, 'Guardian Aegis', 2, [
    [abilityMod('ability_cleric_aegis', { shieldPct: 10 })],
    [abilityMod('ability_cleric_aegis', { shieldPct: 20 })],
  ]),
  node('cleric', 'light', 6, 'Overflow', 2, [
    [abilityMod('ability_cleric_mend', { overhealToHot: { pct: 15, durationMs: 4000 } })],
    [abilityMod('ability_cleric_mend', { overhealToHot: { pct: 30, durationMs: 4000 } })],
  ]),
  node('cleric', 'light', 7, 'Faithful', 2, [
    [stat({ maxManaPct: 5 })],
    [stat({ maxManaPct: 10 })],
  ]),
  node(
    'cleric',
    'light',
    8,
    "Dawn's Embrace",
    1,
    [[abilityMod('ability_cleric_dawnlight', { alsoCastFree: 'ability_cleric_sanctuary' })]],
    { capstone: true },
  ),

  // =========================================================================
  // CLERIC — Wrath (damage)
  // =========================================================================
  node('cleric', 'wrath', 1, 'Zeal', 3, [
    [stat({ magicDamagePct: 2 })],
    [stat({ magicDamagePct: 4 })],
    [stat({ magicDamagePct: 6 })],
  ]),
  node('cleric', 'wrath', 2, 'Heavy Hand', 2, [
    [abilityMod('ability_cleric_hammer_of_wrath', { damagePct: 10 })],
    [abilityMod('ability_cleric_hammer_of_wrath', { damagePct: 20 })],
  ]),
  node('cleric', 'wrath', 3, 'Searing Smite', 2, [
    [
      abilityMod('ability_cleric_holy_smite', {
        addEffects: [
          {
            kind: 'apply_effect',
            target: 'hit',
            effectId: 'searing_smite',
            durationMs: 4000,
            stacksMax: 1,
            category: 'burn',
            mods: {
              periodic: { kind: 'damage', coefTotal: 0.1, school: 'magic', tickEveryMs: 1000 },
            },
          },
        ],
      }),
    ],
    [
      abilityMod('ability_cleric_holy_smite', {
        addEffects: [
          {
            kind: 'apply_effect',
            target: 'hit',
            effectId: 'searing_smite',
            durationMs: 4000,
            stacksMax: 1,
            category: 'burn',
            mods: {
              periodic: { kind: 'damage', coefTotal: 0.2, school: 'magic', tickEveryMs: 1000 },
            },
          },
        ],
      }),
    ],
  ]),
  node('cleric', 'wrath', 4, 'Righteous Echo', 1, [
    [abilityMod('ability_cleric_holy_smite', { everyNBonusBolt: { n: 3, coef: 0.5 } })],
  ]),
  node('cleric', 'wrath', 5, 'Retribution Aura', 2, [
    [proc('melee_thorns', { coef: 0.15 })],
    [proc('melee_thorns', { coef: 0.3 })],
  ]),
  node('cleric', 'wrath', 6, 'Judgement', 2, [
    [conditional({ vsStunned: true, vsStaggered: true, pct: 4 })],
    [conditional({ vsStunned: true, vsStaggered: true, pct: 8 })],
  ]),
  node('cleric', 'wrath', 7, 'Warpriest', 1, [
    [abilityMod('ability_cleric_radiant_burst', { damagePct: 30 })],
  ]),
  node(
    'cleric',
    'wrath',
    8,
    'Avenging Dawn',
    1,
    [
      [
        abilityMod('ability_cleric_dawnlight', {
          coefDelta: 1.0,
          addEffects: [afterUseBuff('avenging_dawn', 10000, { damageDealtPct: 15 })],
        }),
      ],
    ],
    { capstone: true },
  ),

  // =========================================================================
  // CLERIC — Warden (defense & utility)
  // =========================================================================
  node('cleric', 'warden', 1, 'Sturdy Faith', 3, [
    [stat({ maxHpPct: 3 })],
    [stat({ maxHpPct: 6 })],
    [stat({ maxHpPct: 9 })],
  ]),
  node('cleric', 'warden', 2, 'Shield Training', 2, [
    [stance({ blockMitigationDelta: 5 })],
    [stance({ blockMitigationDelta: 10 })],
  ]),
  node('cleric', 'warden', 3, 'Pilgrim', 2, [
    [stat({ moveSpeedPct: 3 })],
    [stat({ moveSpeedPct: 6 })],
  ]),
  node('cleric', 'warden', 4, 'Serenity', 2, [
    [stat({ manaRegenPct: 10 })],
    [stat({ manaRegenPct: 20 })],
  ]),
  node('cleric', 'warden', 5, 'Unshakeable', 1, [[stat({ ccOnYouDurationPct: -20 })]]),
  node('cleric', 'warden', 6, "Martyr's Pace", 2, [
    [
      proc('on_self_heal_buff', {
        effectId: 'martyrs_pace',
        durationMs: 3000,
        inCombatOnly: true,
        mods: { moveSpeedPct: 5 },
      }),
    ],
    [
      proc('on_self_heal_buff', {
        effectId: 'martyrs_pace',
        durationMs: 3000,
        inCombatOnly: true,
        mods: { moveSpeedPct: 10 },
      }),
    ],
  ]),
  node('cleric', 'warden', 7, 'Beacon', 1, [
    [abilityMod('ability_cleric_sanctuary', { zoneAllyMods: { armorPct: 10 } })],
  ]),
  node(
    'cleric',
    'warden',
    8,
    'Guardian of Dawn',
    1,
    [
      [
        proc('low_hp_free_cast', {
          thresholdPct: 30,
          abilityId: 'ability_cleric_aegis',
          icdMs: 60000,
        }),
      ],
    ],
    { capstone: true },
  ),
];
