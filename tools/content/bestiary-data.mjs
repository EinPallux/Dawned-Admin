/**
 * The P9 bestiary: Dawnshore (1–6) and Verdant Weald (6–12) exactly as
 * NPCS_ENEMIES.md §4 casts them, plus the spawners that place them.
 *
 * What is authored here is IDENTITY and BEHAVIOUR — name, archetype, which
 * model, what it does and how often. Stats are not typed: HP, damage, armour
 * and resist all come from the shared §5 curve via `enemyStats(level,
 * archetype, rank)`, so a balance pass changes one formula rather than
 * seventeen rows. `statOverrides` stays empty unless a specific enemy is
 * deliberately off-curve.
 *
 * Clip names are NOT free text. The Quaternius bundle rigs its models in three
 * families with non-interchangeable names, and asking a rig for a clip it does
 * not own is silent — the attack lands, it just animates nothing. Each entry
 * below picks from what its model actually has (shared ENEMY_MODEL_CLIPS), and
 * the publish cross-check refuses the mistake:
 *   walker   (mushnub, blobs, pigeon, cat, wizard): Bite_Front · Idle · Walk · Jump
 *   floater  (glub, armabee, ghost):                Headbutt · Punch · Fast_Flying
 *   humanoid (frog, orc, mushroom king):            Punch · Weapon · Run · Walk
 */

/** Melee swing. Defaults suit a small critter; overrides say what differs. */
const melee = (id, clip, over = {}) => ({
  id,
  kind: 'melee_arc',
  clip,
  weight: 3,
  coef: 1,
  rangeMin: 0,
  rangeMax: 2.2,
  reach: 2.2,
  angleDeg: 100,
  windupMs: 500,
  recoverMs: 650,
  telegraph: false,
  cooldownMs: 0,
  ...over,
});

/** A heavy: slower, harder, and it draws its shape on the ground first. */
const heavy = (id, clip, over = {}) =>
  melee(id, clip, {
    weight: 1,
    coef: 1.8,
    windupMs: 900,
    recoverMs: 900,
    telegraph: true,
    cooldownMs: 6000,
    ...over,
  });

const projectile = (id, clip, over = {}) => ({
  id,
  kind: 'projectile',
  clip,
  weight: 3,
  coef: 0.8,
  rangeMin: 6,
  rangeMax: 16,
  reach: 2.2,
  angleDeg: 90,
  projectileSpeed: 14,
  projectileRadius: 0.35,
  windupMs: 700,
  recoverMs: 700,
  telegraph: false,
  cooldownMs: 2200,
  ...over,
});

/** A caster's signature: a visible, INTERRUPTIBLE bar — the counterplay. */
const cast = (id, clip, over = {}) =>
  projectile(id, clip, {
    cast: true,
    windupMs: 1600,
    recoverMs: 900,
    coef: 1.4,
    cooldownMs: 5000,
    ...over,
  });

const groundCircle = (id, clip, over = {}) => ({
  id,
  kind: 'ground_circle',
  clip,
  weight: 1,
  coef: 1.5,
  rangeMin: 0,
  rangeMax: 12,
  reach: 2.2,
  angleDeg: 90,
  circleRadius: 4,
  windupMs: 1400,
  recoverMs: 1000,
  telegraph: true,
  cooldownMs: 9000,
  ...over,
});

/**
 * A charge. `chargeDistance` must EXCEED `rangeMax` or the lunge never
 * overshoots and the punish window — the archetype's whole counterplay —
 * never opens; the schema refuses it.
 */
const charge = (id, clip, over = {}) => ({
  id,
  kind: 'charge_rect',
  clip,
  weight: 2,
  coef: 1.6,
  rangeMin: 5,
  rangeMax: 11,
  reach: 2.2,
  angleDeg: 90,
  chargeDistance: 14,
  chargeWidth: 2.4,
  chargeSpeed: 14,
  overshootMs: 1300,
  windupMs: 850,
  recoverMs: 700,
  telegraph: true,
  cooldownMs: 7000,
  ...over,
});

const enemy = (id, name, over) => ({
  id,
  name,
  rank: 'normal',
  scale: 1,
  hitRadius: 0.5,
  hitHeight: 1.2,
  moveSpeed: 3.6,
  statOverrides: {},
  aggroRadius: 10,
  leashRadius: 40,
  socialTag: null,
  xpMult: 1,
  loot: null,
  phases: [],
  arenaRadius: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// Dawnshore (1–6)
// ---------------------------------------------------------------------------

export const ENEMY_DEFS = [
  enemy('enemy_shore_glub', 'Shore Glub', {
    archetype: 'swarm',
    levelMin: 1,
    levelMax: 2,
    modelRef: 'enemies_glub',
    hitRadius: 0.45,
    hitHeight: 1,
    moveSpeed: 4.1,
    aggroRadius: 10,
    socialTag: 'shore_glub',
    // Swarms are weak on purpose (§1: "weakness is the telegraph") — they
    // threaten by arriving in fours, so their swing is fast and small.
    abilities: [melee('nibble', 'Headbutt', { coef: 0.9, windupMs: 400, recoverMs: 500 })],
    loot: { tableId: 'loot_dawnshore_trash', rolls: 1, goldMin: 2, goldMax: 6 },
  }),

  enemy('enemy_meadow_blob', 'Meadow Blob', {
    archetype: 'grunt',
    levelMin: 2,
    levelMax: 4,
    modelRef: 'enemies_green_blob',
    hitRadius: 0.55,
    hitHeight: 1.1,
    // Slow and bouncy (§4): it closes badly, which is what makes it fair.
    moveSpeed: 2.8,
    abilities: [
      melee('chomp', 'Bite_Front'),
      heavy('body_slam', 'Jump', { reach: 2.6, angleDeg: 140 }),
    ],
    loot: { tableId: 'loot_dawnshore_trash', rolls: 1, goldMin: 3, goldMax: 7 },
  }),

  enemy('enemy_bog_blob', 'Bog Blob', {
    archetype: 'grunt',
    levelMin: 3,
    levelMax: 5,
    modelRef: 'enemies_pink_blob',
    hitRadius: 0.6,
    hitHeight: 1.2,
    moveSpeed: 2.8,
    socialTag: 'bog_blob',
    abilities: [
      melee('chomp', 'Bite_Front', { coef: 1.1 }),
      heavy('body_slam', 'Jump', { reach: 2.8, angleDeg: 140 }),
    ],
    loot: { tableId: 'loot_dawnshore_spore', rolls: 1, goldMin: 4, goldMax: 9 },
  }),

  enemy('enemy_cliff_pigeon', 'Cliff Pigeon', {
    archetype: 'swarm',
    levelMin: 3,
    levelMax: 4,
    modelRef: 'enemies_pigeon',
    hitRadius: 0.4,
    hitHeight: 0.9,
    moveSpeed: 4.6,
    aggroRadius: 9,
    socialTag: 'cliff_pigeon',
    // The dive: a short, fast lunge rather than a full charger's freight run.
    abilities: [
      melee('peck', 'Bite_Front', { coef: 0.85, windupMs: 380, recoverMs: 450 }),
      charge('dive', 'Jump', {
        weight: 1,
        coef: 1.2,
        rangeMin: 4,
        rangeMax: 8,
        chargeDistance: 10,
        chargeWidth: 1.6,
        chargeSpeed: 16,
        overshootMs: 900,
        windupMs: 700,
        cooldownMs: 8000,
      }),
    ],
    loot: { tableId: 'loot_dawnshore_trash', rolls: 1, goldMin: 3, goldMax: 8 },
  }),

  enemy('enemy_bandit_forager', 'Bandit Forager', {
    archetype: 'ranged',
    levelMin: 4,
    levelMax: 6,
    modelRef: 'enemies_orc',
    hitRadius: 0.55,
    hitHeight: 1.8,
    moveSpeed: 3.9,
    aggroRadius: 13,
    socialTag: 'bandit_camp',
    abilities: [
      projectile('thrown_knife', 'Weapon', { coef: 0.9, rangeMin: 6, rangeMax: 15 }),
      // Panic melee: what it does when someone closes inside its band (§1).
      melee('shiv', 'Punch', { weight: 1, coef: 1.1, rangeMax: 2.4 }),
    ],
    loot: { tableId: 'loot_dawnshore_gear', rolls: 1, goldMin: 8, goldMax: 18 },
  }),

  enemy('enemy_spore_lobber', 'Spore Lobber', {
    archetype: 'ranged',
    levelMin: 3,
    levelMax: 5,
    modelRef: 'enemies_mushnub',
    scale: 1.1,
    hitRadius: 0.5,
    hitHeight: 1.3,
    socialTag: 'spore_ridge',
    abilities: [
      projectile('spore_lob', 'Jump', { coef: 0.8, projectileSpeed: 13, cooldownMs: 2400 }),
      // Was authored at P5 asking a mushnub for `Punch`, a clip its rig does
      // not have — the swing landed and animated nothing. Bite_Front is real.
      melee('panic_swat', 'Bite_Front', { weight: 1, coef: 0.8, windupMs: 450 }),
    ],
    loot: { tableId: 'loot_dawnshore_spore', rolls: 1, goldMin: 4, goldMax: 10 },
  }),

  enemy('enemy_young_mushnub', 'Young Mushnub', {
    archetype: 'grunt',
    levelMin: 3,
    levelMax: 5,
    modelRef: 'enemies_mushnub',
    hitRadius: 0.5,
    hitHeight: 1.3,
    socialTag: 'mushnub',
    abilities: [
      melee('chomp', 'Bite_Front'),
      heavy('cap_slam', 'Jump', { reach: 2.6, angleDeg: 120 }),
    ],
    loot: { tableId: 'loot_dawnshore_spore', rolls: 1, goldMin: 4, goldMax: 9 },
  }),

  enemy('enemy_mossback', 'Mossback', {
    archetype: 'grunt',
    rank: 'elite',
    levelMin: 6,
    levelMax: 6,
    modelRef: 'enemies_glub_evolved',
    // §1: elites read as elites — bigger, named plate, 2.5× HP from the rank.
    scale: 1.6,
    hitRadius: 0.9,
    hitHeight: 1.8,
    moveSpeed: 3.2,
    aggroRadius: 12,
    leashRadius: 45,
    xpMult: 2.5,
    abilities: [
      melee('maul', 'Headbutt', { coef: 1.2, reach: 2.6 }),
      heavy('shell_crash', 'Punch', { reach: 3.4, angleDeg: 150, coef: 2.1, windupMs: 1000 }),
      // The elite's extra trick (§1 "+1 extra ability"): it hardens up once
      // when the fight turns, which is when a player learns to burst it.
      {
        id: 'moss_ward',
        kind: 'self_shield',
        clip: 'Yes',
        weight: 2,
        coef: 0,
        rangeMin: 0,
        rangeMax: 40,
        reach: 2.2,
        angleDeg: 90,
        shieldPct: 25,
        hpThresholdPct: 55,
        oncePerLife: true,
        windupMs: 900,
        recoverMs: 600,
        telegraph: false,
        cooldownMs: 0,
      },
    ],
    loot: { tableId: 'loot_dawnshore_gear', rolls: 2, goldMin: 25, goldMax: 45 },
  }),

  // -------------------------------------------------------------------------
  // Verdant Weald (6–12)
  // -------------------------------------------------------------------------

  enemy('enemy_weald_frog', 'Weald Frog', {
    archetype: 'charger',
    levelMin: 6,
    levelMax: 8,
    modelRef: 'enemies_frog',
    hitRadius: 0.6,
    hitHeight: 1.4,
    moveSpeed: 3.4,
    aggroRadius: 11,
    abilities: [
      melee('hop_bite', 'Punch', { coef: 1 }),
      // "Tongue lash = short charge" (§4): a stubby lunge, not a full run.
      charge('tongue_lash', 'Weapon', {
        rangeMin: 4,
        rangeMax: 8,
        chargeDistance: 10,
        chargeWidth: 1.8,
        chargeSpeed: 15,
        overshootMs: 1100,
        coef: 1.4,
      }),
    ],
    loot: { tableId: 'loot_weald_trash', rolls: 1, goldMin: 10, goldMax: 20 },
  }),

  enemy('enemy_mushnub_warrior', 'Mushnub Warrior', {
    archetype: 'grunt',
    levelMin: 7,
    levelMax: 9,
    modelRef: 'enemies_mushnub_evolved',
    scale: 1.25,
    hitRadius: 0.65,
    hitHeight: 1.7,
    moveSpeed: 3.5,
    socialTag: 'mushnub_warband',
    abilities: [
      melee('cleave', 'Bite_Front', { coef: 1.15, reach: 2.6, angleDeg: 120 }),
      heavy('overhead', 'Jump', { reach: 3, angleDeg: 100, coef: 2 }),
    ],
    loot: { tableId: 'loot_weald_trash', rolls: 1, goldMin: 12, goldMax: 24 },
  }),

  enemy('enemy_armabee_drone', 'Armabee Drone', {
    archetype: 'swarm',
    levelMin: 8,
    levelMax: 10,
    modelRef: 'enemies_armabee',
    hitRadius: 0.45,
    hitHeight: 1,
    moveSpeed: 4.4,
    aggroRadius: 10,
    socialTag: 'armabee_hive',
    abilities: [melee('sting', 'Headbutt', { coef: 0.9, windupMs: 420, recoverMs: 520 })],
    loot: { tableId: 'loot_weald_trash', rolls: 1, goldMin: 8, goldMax: 16 },
  }),

  enemy('enemy_armabee_soldier', 'Armabee Soldier', {
    archetype: 'charger',
    levelMin: 9,
    levelMax: 11,
    modelRef: 'enemies_armabee_evolved',
    scale: 1.2,
    hitRadius: 0.55,
    hitHeight: 1.2,
    moveSpeed: 4.2,
    aggroRadius: 12,
    socialTag: 'armabee_hive',
    abilities: [
      melee('sting', 'Headbutt', { coef: 1 }),
      charge('dive_bomb', 'Punch', { coef: 1.7, chargeSpeed: 17, chargeDistance: 15 }),
    ],
    loot: { tableId: 'loot_weald_trash', rolls: 1, goldMin: 14, goldMax: 28 },
  }),

  enemy('enemy_gloom_ghost', 'Gloom Ghost', {
    archetype: 'caster',
    levelMin: 9,
    levelMax: 11,
    modelRef: 'enemies_ghost',
    hitRadius: 0.55,
    hitHeight: 1.7,
    moveSpeed: 3.3,
    aggroRadius: 14,
    abilities: [
      cast('drain_bolt', 'Punch', { coef: 1.5, rangeMin: 5, rangeMax: 18 }),
      melee('chill_touch', 'Headbutt', { weight: 1, coef: 1, rangeMax: 2.6 }),
    ],
    loot: { tableId: 'loot_weald_gear', rolls: 1, goldMin: 16, goldMax: 30 },
  }),

  enemy('enemy_weald_stalker', 'Weald Stalker', {
    archetype: 'charger',
    levelMin: 10,
    levelMax: 12,
    modelRef: 'enemies_cat',
    scale: 1.3,
    hitRadius: 0.6,
    hitHeight: 1.3,
    moveSpeed: 4.3,
    aggroRadius: 13,
    abilities: [
      melee('claw', 'Bite_Front', { coef: 1.2 }),
      charge('pounce', 'Jump', { coef: 1.9, chargeSpeed: 18, chargeDistance: 16, rangeMax: 12 }),
    ],
    loot: { tableId: 'loot_weald_gear', rolls: 1, goldMin: 18, goldMax: 34 },
  }),

  enemy('enemy_outcast_hexer', 'Outcast Hexer', {
    archetype: 'caster',
    levelMin: 10,
    levelMax: 12,
    modelRef: 'enemies_wizard',
    hitRadius: 0.55,
    hitHeight: 1.8,
    moveSpeed: 3.4,
    aggroRadius: 15,
    socialTag: 'hexer_circle',
    abilities: [
      cast('hex_bolt', 'Bite_Front', { coef: 1.5, rangeMin: 5, rangeMax: 18 }),
      groundCircle('curse_pool', 'Jump', { coef: 1.6, circleRadius: 4.5, rangeMax: 14 }),
      melee('staff_jab', 'Bite_Front', { weight: 1, coef: 0.9, rangeMax: 2.4 }),
    ],
    loot: { tableId: 'loot_weald_gear', rolls: 1, goldMin: 20, goldMax: 38 },
  }),

  enemy('enemy_mushroom_king', 'Mushroom King', {
    archetype: 'grunt',
    rank: 'zone_boss',
    levelMin: 12,
    levelMax: 12,
    modelRef: 'enemies_mushroom_king',
    // OFF-CURVE ON PURPOSE. The §5 curve × the zone-boss ×8 gives him 4552 hp,
    // which the TTK simulator puts at a ~48 s kill for a level-12 warrior —
    // under the 60 s floor COMBAT.md §12 sets for a boss, and P9's DoD gates
    // on. The fight needs the room to show three mechanics; 8200 lands it
    // around 85 s at the same DPS. The browser-p9 smoke measures the REAL
    // number with a real player and is what should settle this.
    statOverrides: { maxHp: 8200 },
    scale: 1.9,
    hitRadius: 1.1,
    hitHeight: 2.6,
    moveSpeed: 3,
    aggroRadius: 18,
    leashRadius: 60,
    // The arena is the promise: pull him where you like inside it, never out.
    arenaRadius: 26,
    xpMult: 6,
    // Three mechanics (COMBAT.md boss target), one arriving with the phase:
    // a telegraphed stomp cone to sidestep, spore rings to leave, and from
    // half health a wide crown slam that punishes standing still.
    abilities: [
      melee('stomp', 'Punch', { coef: 1.2, reach: 3.2, angleDeg: 120, weight: 3 }),
      groundCircle('spore_ring', 'Wave', {
        weight: 2,
        coef: 1.5,
        circleRadius: 5,
        rangeMax: 14,
        cooldownMs: 8000,
      }),
      heavy('crown_slam', 'Weapon', {
        weight: 2,
        coef: 2.2,
        reach: 4.5,
        angleDeg: 360,
        windupMs: 1300,
        recoverMs: 1100,
        cooldownMs: 11000,
        phase: 1,
      }),
    ],
    phases: [
      {
        atHpPct: 50,
        damageMult: 1.2,
        speedMult: 1.1,
        recoverMult: 0.8,
        announce: 'The grove answers me!',
      },
    ],
    loot: { tableId: 'loot_weald_gear', rolls: 3, goldMin: 120, goldMax: 200 },
  }),

  // ===========================================================================
  // P12-C — the rest of the world. NPCS_ENEMIES.md §4 casts every row below;
  // §4.1 records where the models forced a change.
  //
  // Clip families (from ENEMY_MODEL_CLIPS, which is generated from the bakes):
  //   walker    Bite_Front · Idle · Walk · Jump · Death · HitRecieve · No
  //   floater   Headbutt · Punch · Fast_Flying · Flying_Idle · Death · HitReact
  //   humanoid  Punch · Weapon · Run · Walk · Duck · Wave · Death · HitReact
  //   skeleton  Idle_A/B · Walking_A · Running_A · Hit_A · Death_A · Interact · Throw
  //
  // The skeleton family has NO melee swing — the FREE KayKit pack keeps the
  // combat set behind a paid file. So the undead are swarm/charger/caster, and
  // `Interact` (a forward reach) is the only "arm goes out" clip they own.
  // ===========================================================================

  // -------------------------------------------------------------------------
  // Emberwood (12–18)
  // -------------------------------------------------------------------------

  enemy('enemy_skeleton_minion', 'Skeleton Minion', {
    archetype: 'swarm',
    levelMin: 12,
    levelMax: 14,
    modelRef: 'enemies_skeleton_minion',
    hitRadius: 0.45,
    hitHeight: 1.7,
    moveSpeed: 4.3,
    aggroRadius: 11,
    socialTag: 'skeleton_minion',
    abilities: [melee('claw', 'Interact', { coef: 0.9, windupMs: 420, recoverMs: 520 })],
    loot: { tableId: 'loot_emberwood_trash', rolls: 1, goldMin: 20, goldMax: 42 },
  }),

  enemy('enemy_skeleton_rogue', 'Skeleton Rogue', {
    archetype: 'charger',
    levelMin: 13,
    levelMax: 15,
    modelRef: 'enemies_skeleton_rogue',
    hitRadius: 0.45,
    hitHeight: 1.75,
    // Fast: the flanker of §4. Its damage bonus lives in the charge's coef,
    // because a "backstab" the AI cannot aim is a stat nobody would ever see.
    moveSpeed: 4.6,
    aggroRadius: 13,
    socialTag: 'skeleton_rogue',
    abilities: [
      charge('lunge', 'Running_A', {
        weight: 3,
        coef: 1.9,
        chargeDistance: 15,
        chargeWidth: 2,
        chargeSpeed: 17,
        overshootMs: 1100,
        cooldownMs: 6000,
      }),
      melee('shiv', 'Interact', { coef: 1, weight: 2 }),
    ],
    loot: { tableId: 'loot_emberwood_trash', rolls: 1, goldMin: 24, goldMax: 48 },
  }),

  enemy('enemy_skeleton_mage', 'Skeleton Mage', {
    archetype: 'caster',
    levelMin: 14,
    levelMax: 16,
    modelRef: 'enemies_skeleton_mage',
    hitRadius: 0.5,
    hitHeight: 1.8,
    moveSpeed: 3.3,
    aggroRadius: 16,
    socialTag: 'skeleton_mage',
    abilities: [
      cast('bone_bolt', 'Interact', { coef: 1.5, rangeMin: 5, rangeMax: 18 }),
      {
        // The bone wall: a real window to burst through rather than a stat.
        id: 'bone_wall',
        kind: 'self_shield',
        clip: 'Interact',
        weight: 2,
        coef: 0,
        rangeMin: 0,
        rangeMax: 40,
        reach: 2.2,
        angleDeg: 90,
        shieldPct: 22,
        shieldDurationMs: 10_000,
        hpThresholdPct: 65,
        oncePerLife: true,
        windupMs: 900,
        recoverMs: 600,
        telegraph: false,
        cooldownMs: 0,
      },
      melee('staff_jab', 'Interact', { weight: 1, coef: 0.9, rangeMax: 2.4 }),
    ],
    loot: { tableId: 'loot_emberwood_gear', rolls: 1, goldMin: 28, goldMax: 54 },
  }),

  enemy('enemy_skeleton_warrior', 'Skeleton Warrior', {
    archetype: 'charger',
    levelMin: 15,
    levelMax: 17,
    modelRef: 'enemies_skeleton_warrior',
    hitRadius: 0.55,
    hitHeight: 1.85,
    moveSpeed: 3.8,
    aggroRadius: 12,
    socialTag: 'skeleton_warrior',
    // Heavier than the Rogue and slower to recover: a shield bash you step
    // around, not one you trade with.
    abilities: [
      charge('shield_bash', 'Running_A', {
        weight: 3,
        coef: 2.1,
        chargeDistance: 13,
        chargeWidth: 2.8,
        chargeSpeed: 13,
        overshootMs: 1500,
        windupMs: 950,
        cooldownMs: 7000,
      }),
      melee('bone_swipe', 'Interact', { coef: 1.2, weight: 2, reach: 2.5 }),
    ],
    loot: { tableId: 'loot_emberwood_gear', rolls: 1, goldMin: 32, goldMax: 60 },
  }),

  enemy('enemy_ember_cactoro', 'Ember Cactoro', {
    archetype: 'ranged',
    levelMin: 13,
    levelMax: 15,
    modelRef: 'enemies_cactoro',
    hitRadius: 0.55,
    hitHeight: 1.5,
    moveSpeed: 3.2,
    aggroRadius: 14,
    socialTag: 'ember_cactoro',
    abilities: [
      projectile('needle_spray', 'Bite_Front', { coef: 0.9, rangeMin: 6, rangeMax: 17 }),
      melee('thorn_swat', 'Jump', { weight: 1, coef: 1, rangeMax: 2.6 }),
    ],
    loot: { tableId: 'loot_emberwood_trash', rolls: 1, goldMin: 22, goldMax: 45 },
  }),

  enemy('enemy_feral_monkroose', 'Feral Monkroose', {
    archetype: 'charger',
    levelMin: 14,
    levelMax: 16,
    modelRef: 'enemies_monkroose',
    hitRadius: 0.55,
    hitHeight: 1.7,
    moveSpeed: 4.4,
    aggroRadius: 13,
    socialTag: 'monkroose_troop',
    abilities: [
      charge('pounce', 'Run', { coef: 1.7, chargeDistance: 16, chargeSpeed: 16 }),
      melee('rake', 'Punch', { coef: 1.1, weight: 2 }),
    ],
    loot: { tableId: 'loot_emberwood_trash', rolls: 1, goldMin: 25, goldMax: 50 },
  }),

  enemy('enemy_grave_wisp', 'Grave Wisp', {
    archetype: 'caster',
    levelMin: 15,
    levelMax: 17,
    modelRef: 'enemies_ghost_skull',
    hitRadius: 0.45,
    hitHeight: 1.3,
    moveSpeed: 3.5,
    aggroRadius: 15,
    socialTag: 'grave_wisp',
    abilities: [
      cast('haunt', 'Punch', { coef: 1.6, rangeMin: 4, rangeMax: 18 }),
      groundCircle('grave_chill', 'Headbutt', { coef: 1.5, circleRadius: 4.5, rangeMax: 14 }),
    ],
    loot: { tableId: 'loot_emberwood_gear', rolls: 1, goldMin: 30, goldMax: 56 },
  }),

  enemy('enemy_ashen_marauder', 'Ashen Marauder', {
    archetype: 'grunt',
    levelMin: 16,
    levelMax: 18,
    modelRef: 'enemies_ninja',
    tint: '#8a5f4a',
    hitRadius: 0.55,
    hitHeight: 1.8,
    moveSpeed: 4,
    aggroRadius: 13,
    socialTag: 'marauder_camp',
    // The zone's real melee: this rig owns a strike, which the skeletons do not.
    abilities: [
      melee('slash', 'Bite_Front', { coef: 1.2 }),
      heavy('overhead', 'Jump', { coef: 2, reach: 2.8, angleDeg: 120 }),
    ],
    loot: { tableId: 'loot_emberwood_gear', rolls: 1, goldMin: 36, goldMax: 66 },
  }),

  enemy('enemy_bonelord_varkas', 'Bonelord Varkas', {
    archetype: 'charger',
    rank: 'zone_boss',
    levelMin: 18,
    levelMax: 18,
    modelRef: 'enemies_skeleton_warrior',
    // Dark and half again as tall: the boss must not read as the minions
    // standing around him, and he wears the same mesh as four of them.
    tint: '#4a4457',
    scale: 1.5,
    hitRadius: 0.9,
    hitHeight: 2.7,
    moveSpeed: 3.6,
    aggroRadius: 20,
    leashRadius: 60,
    arenaRadius: 28,
    xpMult: 6,
    abilities: [
      // Blade waves: thrown, because this rig cannot swing one.
      projectile('blade_wave', 'Throw', {
        weight: 3,
        coef: 1.5,
        rangeMin: 4,
        rangeMax: 20,
        projectileSpeed: 17,
        projectileRadius: 0.6,
        cooldownMs: 3500,
      }),
      charge('bone_rush', 'Running_A', {
        weight: 2,
        coef: 2,
        chargeDistance: 18,
        chargeWidth: 3.2,
        chargeSpeed: 15,
        overshootMs: 1400,
        cooldownMs: 9000,
      }),
      groundCircle('grave_scream', 'Interact', {
        weight: 2,
        coef: 2.2,
        circleRadius: 7,
        rangeMax: 8,
        windupMs: 1500,
        cooldownMs: 12_000,
        phase: 1,
      }),
    ],
    phases: [
      {
        atHpPct: 50,
        damageMult: 1.2,
        speedMult: 1.15,
        recoverMult: 0.8,
        announce: 'The barrow wakes with me!',
      },
    ],
    loot: { tableId: 'loot_emberwood_gear', rolls: 3, goldMin: 200, goldMax: 320 },
  }),

  // -------------------------------------------------------------------------
  // Sungraze Savanna (18–24)
  // -------------------------------------------------------------------------

  enemy('enemy_alpaking_grazer', 'Alpaking Grazer', {
    archetype: 'grunt',
    levelMin: 18,
    levelMax: 21,
    modelRef: 'enemies_alpaking',
    hitRadius: 0.7,
    hitHeight: 2,
    moveSpeed: 3.4,
    aggroRadius: 11,
    socialTag: 'alpaking_herd',
    abilities: [
      melee('butt', 'Headbutt', { coef: 1.1, reach: 2.6 }),
      heavy('wool_stomp', 'Punch', { coef: 1.9, reach: 3, angleDeg: 140 }),
    ],
    loot: { tableId: 'loot_sungraze_trash', rolls: 1, goldMin: 34, goldMax: 66 },
  }),

  enemy('enemy_alpaking_bull', 'Alpaking Bull', {
    archetype: 'charger',
    levelMin: 19,
    levelMax: 22,
    modelRef: 'enemies_alpaking_evolved',
    hitRadius: 0.8,
    hitHeight: 2.3,
    moveSpeed: 4.2,
    aggroRadius: 14,
    socialTag: 'alpaking_herd',
    abilities: [
      charge('stampede', 'Fast_Flying', {
        coef: 2,
        chargeDistance: 20,
        chargeWidth: 3.4,
        chargeSpeed: 17,
        overshootMs: 1600,
      }),
      melee('gore', 'Headbutt', { coef: 1.3, weight: 2, reach: 2.8 }),
    ],
    loot: { tableId: 'loot_sungraze_gear', rolls: 1, goldMin: 40, goldMax: 76 },
  }),

  enemy('enemy_steppe_raptor', 'Steppe Raptor', {
    archetype: 'swarm',
    levelMin: 19,
    levelMax: 21,
    modelRef: 'enemies_dino',
    hitRadius: 0.5,
    hitHeight: 1.6,
    moveSpeed: 5,
    aggroRadius: 12,
    socialTag: 'raptor_pack',
    abilities: [
      melee('snap', 'Punch', { coef: 0.95, windupMs: 400, recoverMs: 480 }),
      charge('pack_pounce', 'Run', {
        weight: 1,
        coef: 1.3,
        rangeMin: 4,
        rangeMax: 9,
        chargeDistance: 11,
        chargeWidth: 1.8,
        chargeSpeed: 18,
        overshootMs: 900,
        cooldownMs: 9000,
      }),
    ],
    loot: { tableId: 'loot_sungraze_trash', rolls: 1, goldMin: 32, goldMax: 62 },
  }),

  enemy('enemy_orc_raider', 'Orc Raider', {
    archetype: 'grunt',
    levelMin: 20,
    levelMax: 22,
    modelRef: 'enemies_orc',
    hitRadius: 0.6,
    hitHeight: 1.9,
    moveSpeed: 3.9,
    aggroRadius: 13,
    socialTag: 'orc_warband',
    abilities: [
      melee('cleave', 'Punch', { coef: 1.25 }),
      heavy('war_axe', 'Weapon', { coef: 2.1, reach: 3, angleDeg: 120 }),
    ],
    loot: { tableId: 'loot_sungraze_gear', rolls: 1, goldMin: 42, goldMax: 80 },
  }),

  enemy('enemy_orc_headhunter', 'Orc Headhunter', {
    archetype: 'ranged',
    levelMin: 21,
    levelMax: 23,
    modelRef: 'enemies_orc_enemy',
    hitRadius: 0.6,
    hitHeight: 1.9,
    moveSpeed: 3.7,
    aggroRadius: 16,
    socialTag: 'orc_warband',
    abilities: [
      projectile('axe_throw', 'Bite_Front', { coef: 1, rangeMin: 7, rangeMax: 19 }),
      melee('kick', 'Jump', { weight: 1, coef: 1, rangeMax: 2.6 }),
    ],
    loot: { tableId: 'loot_sungraze_gear', rolls: 1, goldMin: 44, goldMax: 84 },
  }),

  enemy('enemy_tribal_windcaller', 'Tribal Windcaller', {
    archetype: 'caster',
    levelMin: 21,
    levelMax: 23,
    modelRef: 'enemies_tribal',
    hitRadius: 0.55,
    hitHeight: 1.85,
    moveSpeed: 3.4,
    aggroRadius: 17,
    socialTag: 'windcaller_ring',
    abilities: [
      cast('gust_bolt', 'Punch', { coef: 1.6, rangeMin: 6, rangeMax: 20 }),
      groundCircle('duststorm', 'Headbutt', {
        coef: 1.7,
        circleRadius: 5.5,
        rangeMax: 16,
        cooldownMs: 10_000,
      }),
    ],
    loot: { tableId: 'loot_sungraze_gear', rolls: 1, goldMin: 46, goldMax: 86 },
  }),

  enemy('enemy_dust_hywirl', 'Dust Hywirl', {
    archetype: 'swarm',
    levelMin: 20,
    levelMax: 22,
    modelRef: 'enemies_hywirl',
    hitRadius: 0.5,
    hitHeight: 1.6,
    moveSpeed: 4.8,
    aggroRadius: 10,
    socialTag: 'hywirl_drift',
    abilities: [melee('whirl', 'Headbutt', { coef: 0.9, windupMs: 380, recoverMs: 460 })],
    loot: { tableId: 'loot_sungraze_trash', rolls: 1, goldMin: 34, goldMax: 64 },
  }),

  enemy('enemy_sun_cactoro', 'Sun Cactoro', {
    archetype: 'ranged',
    levelMin: 22,
    levelMax: 24,
    modelRef: 'enemies_cactoro',
    // §4 asks for a gold recolour: the same plant, baked by a harder sun.
    tint: '#d8b45a',
    hitRadius: 0.6,
    hitHeight: 1.6,
    moveSpeed: 3.2,
    aggroRadius: 15,
    socialTag: 'sun_cactoro',
    abilities: [
      projectile('sun_needles', 'Bite_Front', { coef: 1.05, rangeMin: 7, rangeMax: 19 }),
      melee('thorn_swat', 'Jump', { weight: 1, coef: 1.1, rangeMax: 2.6 }),
    ],
    loot: { tableId: 'loot_sungraze_trash', rolls: 1, goldMin: 44, goldMax: 82 },
  }),

  enemy('enemy_alpaking_prime', 'Alpaking Prime', {
    archetype: 'charger',
    rank: 'zone_boss',
    levelMin: 24,
    levelMax: 24,
    modelRef: 'enemies_alpaking_evolved',
    tint: '#e0c98a',
    scale: 1.7,
    hitRadius: 1.1,
    hitHeight: 3,
    moveSpeed: 4,
    aggroRadius: 20,
    leashRadius: 60,
    arenaRadius: 30,
    xpMult: 6,
    abilities: [
      charge('herd_stampede', 'Fast_Flying', {
        weight: 3,
        coef: 2.1,
        chargeDistance: 24,
        chargeWidth: 4,
        chargeSpeed: 18,
        overshootMs: 1600,
        cooldownMs: 8000,
      }),
      groundCircle('wool_quake', 'Punch', {
        weight: 2,
        coef: 2,
        circleRadius: 8,
        rangeMax: 6,
        windupMs: 1400,
        cooldownMs: 11_000,
      }),
      melee('gore', 'Headbutt', { weight: 3, coef: 1.4, reach: 3.4, angleDeg: 120 }),
    ],
    phases: [
      {
        atHpPct: 30,
        damageMult: 1.35,
        speedMult: 1.2,
        recoverMult: 0.75,
        announce: 'The herd runs with me!',
      },
    ],
    loot: { tableId: 'loot_sungraze_gear', rolls: 3, goldMin: 300, goldMax: 460 },
  }),

  // -------------------------------------------------------------------------
  // Ashcrag Canyons (24–30)
  // -------------------------------------------------------------------------

  enemy('enemy_ash_goleling', 'Ash Goleling', {
    archetype: 'grunt',
    levelMin: 24,
    levelMax: 26,
    modelRef: 'enemies_goleling',
    tint: '#8f8578',
    hitRadius: 0.7,
    hitHeight: 2,
    // Stone: slow, and it does not flinch (stagger resistance is the rank's
    // job in COMBAT.md §6 — this row only makes it feel heavy).
    moveSpeed: 3,
    aggroRadius: 11,
    socialTag: 'goleling_scree',
    abilities: [
      melee('rock_fist', 'Punch', { coef: 1.3, reach: 2.6 }),
      heavy('slam', 'Headbutt', { coef: 2.1, reach: 3.2, angleDeg: 140 }),
    ],
    loot: { tableId: 'loot_ashcrag_trash', rolls: 1, goldMin: 52, goldMax: 96 },
  }),

  enemy('enemy_crag_goleling', 'Crag Goleling', {
    archetype: 'grunt',
    rank: 'elite',
    levelMin: 26,
    levelMax: 28,
    modelRef: 'enemies_goleling_evolved',
    tint: '#7d7466',
    scale: 1.15,
    hitRadius: 0.85,
    hitHeight: 2.4,
    moveSpeed: 3.1,
    aggroRadius: 13,
    leashRadius: 45,
    xpMult: 2.2,
    socialTag: 'goleling_scree',
    abilities: [
      melee('rock_fist', 'Punch', { coef: 1.4, reach: 2.8 }),
      groundCircle('scree_slam', 'Headbutt', {
        coef: 2.2,
        circleRadius: 6,
        rangeMax: 8,
        cooldownMs: 10_000,
      }),
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 2, goldMin: 78, goldMax: 140 },
  }),

  enemy('enemy_canyon_demon', 'Canyon Demon', {
    archetype: 'charger',
    levelMin: 25,
    levelMax: 27,
    modelRef: 'enemies_demon',
    hitRadius: 0.6,
    hitHeight: 2,
    moveSpeed: 4.3,
    aggroRadius: 14,
    socialTag: 'demon_rift',
    abilities: [
      // The "fire trail dash" of §4 is the charge lane itself; the burn is in
      // its coefficient rather than a DoT the schema has no field for.
      charge('fire_dash', 'Fast_Flying', {
        coef: 2,
        chargeDistance: 18,
        chargeWidth: 2.6,
        chargeSpeed: 18,
        overshootMs: 1200,
      }),
      melee('claw', 'Punch', { coef: 1.25, weight: 2 }),
    ],
    loot: { tableId: 'loot_ashcrag_trash', rolls: 1, goldMin: 56, goldMax: 104 },
  }),

  enemy('enemy_void_demon', 'Void-Touched Demon', {
    archetype: 'caster',
    levelMin: 27,
    levelMax: 29,
    modelRef: 'enemies_blue_demon',
    hitRadius: 0.6,
    hitHeight: 2.1,
    moveSpeed: 3.5,
    aggroRadius: 18,
    socialTag: 'demon_rift',
    abilities: [
      cast('void_bolt', 'Punch', { coef: 1.7, rangeMin: 6, rangeMax: 20 }),
      groundCircle('fire_rain', 'Weapon', {
        coef: 2,
        circleRadius: 6,
        rangeMax: 18,
        cooldownMs: 10_000,
      }),
      melee('rend', 'Punch', { weight: 1, coef: 1.1, rangeMax: 2.6 }),
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 1, goldMin: 62, goldMax: 116 },
  }),

  enemy('enemy_ashcrag_yeti', 'Ashcrag Yeti', {
    archetype: 'charger',
    levelMin: 26,
    levelMax: 28,
    modelRef: 'enemies_yeti',
    hitRadius: 0.8,
    hitHeight: 2.4,
    moveSpeed: 4,
    aggroRadius: 14,
    socialTag: 'yeti_shelf',
    abilities: [
      charge('barrel', 'Jump', {
        coef: 1.9,
        chargeDistance: 17,
        chargeWidth: 3,
        chargeSpeed: 15,
        overshootMs: 1500,
      }),
      // The "boulder toss ranged mix" of §4: it does not have to close.
      projectile('boulder_toss', 'Bite_Front', {
        weight: 2,
        coef: 1.4,
        rangeMin: 8,
        rangeMax: 18,
        projectileSpeed: 12,
        projectileRadius: 0.7,
        cooldownMs: 5000,
      }),
      melee('maul', 'Bite_Front', { weight: 2, coef: 1.35, reach: 2.8 }),
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 1, goldMin: 60, goldMax: 112 },
  }),

  enemy('enemy_rift_squidle', 'Rift Squidle', {
    archetype: 'caster',
    levelMin: 25,
    levelMax: 27,
    modelRef: 'enemies_squidle',
    hitRadius: 0.6,
    hitHeight: 1.7,
    moveSpeed: 3.2,
    aggroRadius: 16,
    socialTag: 'squidle_rift',
    abilities: [
      groundCircle('toxic_pool', 'Punch', {
        weight: 3,
        coef: 1.8,
        circleRadius: 5,
        rangeMax: 16,
        cooldownMs: 8000,
      }),
      cast('ink_bolt', 'Headbutt', { coef: 1.5, rangeMin: 5, rangeMax: 18 }),
    ],
    loot: { tableId: 'loot_ashcrag_trash', rolls: 1, goldMin: 54, goldMax: 100 },
  }),

  enemy('enemy_skull_swarm', 'Skull Swarm', {
    archetype: 'swarm',
    levelMin: 27,
    levelMax: 29,
    modelRef: 'enemies_ghost_skull',
    // Ember-lit, so the canyon's skulls are not the Emberwood's wisps.
    tint: '#c9683a',
    hitRadius: 0.45,
    hitHeight: 1.3,
    moveSpeed: 5,
    aggroRadius: 11,
    socialTag: 'skull_swarm',
    abilities: [melee('gnash', 'Headbutt', { coef: 0.95, windupMs: 380, recoverMs: 460 })],
    loot: { tableId: 'loot_ashcrag_trash', rolls: 1, goldMin: 58, goldMax: 108 },
  }),

  enemy('enemy_orc_warlord_guard', 'Orc Warlord Guard', {
    archetype: 'grunt',
    rank: 'elite',
    levelMin: 28,
    levelMax: 30,
    modelRef: 'enemies_orc',
    tint: '#6d5546',
    scale: 1.15,
    hitRadius: 0.7,
    hitHeight: 2.1,
    moveSpeed: 4,
    aggroRadius: 15,
    leashRadius: 48,
    xpMult: 2.4,
    socialTag: 'warlord_guard',
    abilities: [
      melee('greatsword', 'Weapon', { coef: 1.5, reach: 3 }),
      heavy('warlord_cleave', 'Punch', {
        coef: 2.4,
        reach: 3.6,
        angleDeg: 160,
        windupMs: 1000,
      }),
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 2, goldMin: 96, goldMax: 175 },
  }),

  enemy('enemy_ashcrag_dragon', 'Ashcrag Dragon', {
    archetype: 'charger',
    rank: 'elite',
    levelMin: 28,
    levelMax: 28,
    modelRef: 'enemies_dragon',
    scale: 1.3,
    hitRadius: 0.9,
    hitHeight: 2.6,
    // The rare roamer of §4: it wanders far and it does not give up quickly.
    moveSpeed: 5,
    aggroRadius: 18,
    leashRadius: 80,
    xpMult: 3,
    abilities: [
      charge('dive_strafe', 'Fast_Flying', {
        weight: 3,
        coef: 2.2,
        chargeDistance: 26,
        chargeWidth: 3,
        chargeSpeed: 22,
        overshootMs: 1400,
        cooldownMs: 7000,
      }),
      projectile('ember_spit', 'Headbutt', {
        weight: 2,
        coef: 1.5,
        rangeMin: 8,
        rangeMax: 22,
        cooldownMs: 4000,
      }),
      melee('bite', 'Punch', { weight: 2, coef: 1.4, reach: 3 }),
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 2, goldMin: 120, goldMax: 210 },
  }),

  enemy('enemy_ashwing', 'Ashwing', {
    archetype: 'caster',
    rank: 'world_boss',
    levelMin: 30,
    levelMax: 30,
    modelRef: 'enemies_dragon_evolved',
    tint: '#a33f2c',
    scale: 2,
    hitRadius: 1.4,
    hitHeight: 4,
    moveSpeed: 4,
    aggroRadius: 24,
    leashRadius: 90,
    arenaRadius: 40,
    xpMult: 10,
    // Five beats, one of them phase-gated: the §4 rotation, minus a literal
    // "airborne" state the movement model has no room for — the phase raises
    // the volley's rate instead.
    abilities: [
      groundCircle('fire_breath', 'Punch', {
        weight: 3,
        coef: 2.1,
        circleRadius: 8,
        rangeMax: 18,
        windupMs: 1400,
        cooldownMs: 7000,
      }),
      groundCircle('wing_gust', 'Headbutt', {
        weight: 2,
        coef: 1.8,
        circleRadius: 10,
        rangeMax: 6,
        windupMs: 1300,
        cooldownMs: 10_000,
      }),
      charge('dive', 'Fast_Flying', {
        weight: 2,
        coef: 2.3,
        chargeDistance: 28,
        chargeWidth: 3.6,
        chargeSpeed: 20,
        overshootMs: 1500,
        cooldownMs: 11_000,
      }),
      projectile('ember_rain', 'Punch', {
        weight: 3,
        coef: 1.6,
        rangeMin: 6,
        rangeMax: 24,
        projectileRadius: 0.6,
        cooldownMs: 3000,
      }),
      groundCircle('ashfall', 'Headbutt', {
        weight: 3,
        coef: 2.4,
        circleRadius: 9,
        rangeMax: 20,
        windupMs: 1600,
        cooldownMs: 9000,
        phase: 1,
      }),
    ],
    phases: [
      {
        atHpPct: 50,
        damageMult: 1.3,
        speedMult: 1.1,
        recoverMult: 0.7,
        announce: 'ASH AND EMBER — THE SKY IS MINE!',
      },
    ],
    loot: { tableId: 'loot_ashcrag_gear', rolls: 4, goldMin: 600, goldMax: 900 },
  }),

  // -------------------------------------------------------------------------
  // Elder Grove (30, elite pocket)
  // -------------------------------------------------------------------------

  enemy('enemy_elder_sporeling', 'Elder Sporeling', {
    archetype: 'caster',
    rank: 'elite',
    levelMin: 30,
    levelMax: 30,
    modelRef: 'enemies_mushnub_evolved',
    tint: '#9fd68a',
    scale: 1.2,
    hitRadius: 0.65,
    hitHeight: 2,
    moveSpeed: 3.4,
    aggroRadius: 16,
    leashRadius: 50,
    xpMult: 2.6,
    socialTag: 'elder_grove',
    abilities: [
      cast('spore_lance', 'Bite_Front', { coef: 1.8, rangeMin: 5, rangeMax: 18 }),
      groundCircle('bloom', 'Jump', { coef: 2, circleRadius: 5.5, rangeMax: 14 }),
    ],
    loot: { tableId: 'loot_elder_grove', rolls: 2, goldMin: 110, goldMax: 190 },
  }),

  enemy('enemy_grove_sentinel', 'Grove Sentinel', {
    archetype: 'grunt',
    rank: 'elite',
    levelMin: 30,
    levelMax: 30,
    modelRef: 'enemies_goleling',
    tint: '#6f9463',
    scale: 1.25,
    hitRadius: 0.8,
    hitHeight: 2.3,
    moveSpeed: 3.2,
    aggroRadius: 15,
    leashRadius: 50,
    xpMult: 2.6,
    socialTag: 'elder_grove',
    abilities: [
      melee('root_fist', 'Punch', { coef: 1.5, reach: 2.9 }),
      heavy('sentinel_slam', 'Headbutt', { coef: 2.3, reach: 3.4, angleDeg: 150 }),
    ],
    loot: { tableId: 'loot_elder_grove', rolls: 2, goldMin: 115, goldMax: 200 },
  }),

  enemy('enemy_elder_treant', 'Elder Treant', {
    archetype: 'caster',
    rank: 'zone_boss',
    levelMin: 30,
    levelMax: 30,
    modelRef: 'enemies_goleling_evolved',
    tint: '#5c8452',
    scale: 2.2,
    hitRadius: 1.4,
    hitHeight: 4.2,
    moveSpeed: 2.8,
    aggroRadius: 22,
    leashRadius: 70,
    arenaRadius: 32,
    xpMult: 8,
    abilities: [
      // "Root walls" are a ring you have to leave rather than a wall the
      // walkgrid could carry — the grid is baked and nothing writes to it at
      // runtime (Q30). Recorded in NPCS_ENEMIES §4.1.
      groundCircle('root_ring', 'Headbutt', {
        weight: 3,
        coef: 2.2,
        circleRadius: 9,
        rangeMax: 16,
        windupMs: 1500,
        cooldownMs: 9000,
      }),
      groundCircle('sap_pool', 'Punch', {
        weight: 2,
        coef: 1.9,
        circleRadius: 6,
        rangeMax: 18,
        cooldownMs: 8000,
      }),
      melee('branch_sweep', 'Punch', { weight: 3, coef: 1.7, reach: 4, angleDeg: 140 }),
      groundCircle('grove_wrath', 'Headbutt', {
        weight: 3,
        coef: 2.6,
        circleRadius: 11,
        rangeMax: 8,
        windupMs: 1700,
        cooldownMs: 12_000,
        phase: 1,
      }),
    ],
    phases: [
      {
        atHpPct: 45,
        damageMult: 1.3,
        speedMult: 1.1,
        recoverMult: 0.75,
        announce: 'The grove has stood longer than your kind.',
      },
    ],
    loot: { tableId: 'loot_elder_grove', rolls: 4, goldMin: 420, goldMax: 660 },
  }),

  // -------------------------------------------------------------------------
  // Ambient fauna (§4 "non-combat")
  //
  // `dummy` is the archetype that never aggros, pays no XP and drops nothing —
  // exactly right for scenery you can hit, and NOT what §2 promises, which is
  // fauna that FLEES. There is no passive-flee AI state; recorded in §4.1
  // rather than faked with a 2 m aggro radius that would make a chicken
  // attack people.
  // -------------------------------------------------------------------------

  enemy('enemy_meadow_bunny', 'Meadow Bunny', {
    archetype: 'dummy',
    levelMin: 1,
    levelMax: 3,
    modelRef: 'enemies_bunny',
    hitRadius: 0.3,
    hitHeight: 0.7,
    moveSpeed: 4,
    aggroRadius: 2,
    abilities: [],
    loot: null,
  }),

  enemy('enemy_farm_chicken', 'Farm Chicken', {
    archetype: 'dummy',
    levelMin: 1,
    levelMax: 3,
    modelRef: 'enemies_chicken',
    hitRadius: 0.3,
    hitHeight: 0.7,
    moveSpeed: 3.4,
    aggroRadius: 2,
    abilities: [],
    loot: null,
  }),

  enemy('enemy_shore_birb', 'Shore Birb', {
    archetype: 'dummy',
    levelMin: 1,
    levelMax: 3,
    modelRef: 'enemies_birb',
    hitRadius: 0.3,
    hitHeight: 0.7,
    moveSpeed: 4.2,
    aggroRadius: 2,
    abilities: [],
    loot: null,
  }),
];
