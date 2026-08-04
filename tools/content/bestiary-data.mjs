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
];

// ---------------------------------------------------------------------------
// Spawners — where the bestiary actually stands
// ---------------------------------------------------------------------------

const spawner = (id, x, z, entries, over = {}) => ({
  id,
  kind: 'area',
  x,
  z,
  radius: 6,
  entries: entries.map((entry) => ({ level: null, ...entry })),
  respawnMs: 100_000,
  campTag: null,
  nightOnly: false,
  ...over,
});

/**
 * Placement walks inland from the spawn beach (high z) toward the Weald (low
 * z), so the level curve matches the walk — the shore is safe, the deep weald
 * is not. The P4/P5 camps keep their coordinates; new camps fill the gaps.
 */
export const SPAWNER_DEFS = [
  // --- Dawnshore ---------------------------------------------------------
  spawner('spawner_shore_glub_camp', 0, 330, [{ enemyId: 'enemy_shore_glub', count: 5 }], {
    radius: 7,
    campTag: 'shore_glub_camp',
    respawnMs: 120_000,
  }),
  spawner('spawner_shore_glub_west', -14, 312, [{ enemyId: 'enemy_shore_glub', count: 2 }], {
    radius: 5,
    campTag: 'shore_glub_west',
    respawnMs: 90_000,
  }),
  spawner('spawner_blob_hollow', 18, 322, [{ enemyId: 'enemy_meadow_blob', count: 3 }], {
    campTag: 'blob_hollow',
    respawnMs: 100_000,
  }),
  spawner('spawner_pigeon_bluff', -24, 336, [{ enemyId: 'enemy_cliff_pigeon', count: 4 }], {
    radius: 7,
    campTag: 'cliff_pigeon',
    respawnMs: 90_000,
  }),
  spawner('spawner_spore_ridge', 16, 300, [{ enemyId: 'enemy_spore_lobber', count: 3 }], {
    radius: 5,
    campTag: 'spore_ridge',
    respawnMs: 90_000,
  }),
  spawner('spawner_bog_shallows', -20, 290, [{ enemyId: 'enemy_bog_blob', count: 3 }], {
    campTag: 'bog_blob',
    respawnMs: 100_000,
  }),
  spawner('spawner_mushnub_meadow', 0, 270, [{ enemyId: 'enemy_young_mushnub', count: 2 }], {
    radius: 5,
    campTag: 'mushnub_meadow',
    respawnMs: 100_000,
  }),
  // A mixed camp: grunt + ranged together is the "pick your fight" pressure
  // P9's DoD asks for — kill the lobber first or eat volleys the whole fight.
  spawner(
    'spawner_bandit_camp',
    22,
    262,
    [
      { enemyId: 'enemy_bandit_forager', count: 2 },
      { enemyId: 'enemy_young_mushnub', count: 1 },
    ],
    { radius: 7, campTag: 'bandit_camp', respawnMs: 150_000 },
  ),
  spawner('spawner_mushnub_path', -12, 242, [{ enemyId: 'enemy_young_mushnub', count: 2 }], {
    radius: 5,
    campTag: 'mushnub_path',
    respawnMs: 100_000,
  }),
  spawner('spawner_mossback_hollow', 30, 238, [{ enemyId: 'enemy_mossback', count: 1 }], {
    kind: 'point',
    radius: 0,
    respawnMs: 300_000,
  }),

  // --- Verdant Weald -----------------------------------------------------
  spawner('spawner_frog_pond', -6, 214, [{ enemyId: 'enemy_weald_frog', count: 3 }], {
    campTag: 'frog_pond',
    respawnMs: 110_000,
  }),
  spawner('spawner_warband_glade', 20, 200, [{ enemyId: 'enemy_mushnub_warrior', count: 3 }], {
    radius: 7,
    campTag: 'mushnub_warband',
    respawnMs: 130_000,
  }),
  spawner(
    'spawner_armabee_hive',
    -26,
    192,
    [
      { enemyId: 'enemy_armabee_drone', count: 4 },
      { enemyId: 'enemy_armabee_soldier', count: 1 },
    ],
    { radius: 8, campTag: 'armabee_hive', respawnMs: 140_000 },
  ),
  spawner('spawner_gloom_hollow', 8, 176, [{ enemyId: 'enemy_gloom_ghost', count: 2 }], {
    campTag: 'gloom_hollow',
    respawnMs: 130_000,
  }),
  spawner('spawner_stalker_thicket', -18, 164, [{ enemyId: 'enemy_weald_stalker', count: 2 }], {
    campTag: 'stalker_thicket',
    respawnMs: 140_000,
  }),
  // The full "pick your fight" test: a caster to interrupt, a charger to
  // sidestep and a warrior in your face, all at once.
  spawner(
    'spawner_hexer_circle',
    26,
    158,
    [
      { enemyId: 'enemy_outcast_hexer', count: 2 },
      { enemyId: 'enemy_weald_stalker', count: 1 },
      { enemyId: 'enemy_mushnub_warrior', count: 1 },
    ],
    { radius: 9, campTag: 'hexer_circle', respawnMs: 160_000 },
  ),
  spawner('spawner_mushroom_king', 0, 140, [{ enemyId: 'enemy_mushroom_king', count: 1 }], {
    kind: 'point',
    radius: 0,
    respawnMs: 600_000,
  }),
];
