/**
 * Where the bestiary stands on the Dawnlands (game P12-C).
 *
 * Every P4–P9 camp was on the dev island, which the new archipelago put under
 * open water — so this is not an extension of the old spawner list, it is the
 * whole world's camps, authored at once.
 *
 * A camp is a WISH, not a coordinate: a zone, a bearing from that isle's heart
 * and a distance. `placeAll` resolves it against the real height field and
 * spirals outward until it finds ground that is above water, gentle enough to
 * fight on, inside the right zone, clear of every settlement and clear of the
 * other camps. Typing 124 coordinates by hand against noise-generated terrain
 * is how P10 planted zero fishing spots and P12-B put a shrine in 8 m of sea:
 * the failures are all silent, and none of them look wrong in the data.
 *
 * The LAYOUT is still authored. Difficulty climbs with distance from the isle's
 * settlement, mixed camps ("pick your fight") sit deeper than single-type ones,
 * and each zone ends on its boss at the far edge.
 */

import { placeAll } from './placement.js';

/**
 * `[id, bearing°, distance m, entries, options]`.
 *
 * Entries are `enemyId: count`. Options carry what differs from a plain camp:
 * `radius` (default 7 m), `respawnMs` (default 120 s), `point` for a single
 * scripted spawn, and `spread` to widen the placement clearance for a boss
 * arena.
 */
const CAMPS = [
  // ---------------------------------------------------------------- Dawnshore
  // The first hour. Dawnhaven sits at bearing -52° / 114 m, so the shallows
  // ring it close and the Mossback hollow is the far edge of the beginner band.
  ['dawnshore', 'glub_shallows', 10, 250, { enemy_shore_glub: 5 }, { respawnMs: 100_000 }],
  ['dawnshore', 'glub_west', 175, 240, { enemy_shore_glub: 3 }, { respawnMs: 90_000 }],
  ['dawnshore', 'glub_north', 40, 260, { enemy_shore_glub: 4 }, { respawnMs: 90_000 }],
  ['dawnshore', 'glub_tidepool', 160, 300, { enemy_shore_glub: 4 }, { respawnMs: 100_000 }],
  ['dawnshore', 'blob_hollow', 60, 210, { enemy_meadow_blob: 3 }, {}],
  ['dawnshore', 'blob_meadow', 130, 220, { enemy_meadow_blob: 3 }, {}],
  ['dawnshore', 'pigeon_bluff', 20, 330, { enemy_cliff_pigeon: 4 }, { respawnMs: 90_000 }],
  ['dawnshore', 'pigeon_cliffs', 100, 340, { enemy_cliff_pigeon: 4 }, { respawnMs: 90_000 }],
  ['dawnshore', 'pigeon_roost', 150, 350, { enemy_cliff_pigeon: 3 }, { respawnMs: 90_000 }],
  ['dawnshore', 'bog_shallows', 80, 250, { enemy_bog_blob: 3 }, {}],
  ['dawnshore', 'bog_deep', 90, 300, { enemy_bog_blob: 3 }, {}],
  ['dawnshore', 'mushnub_meadow', 110, 200, { enemy_young_mushnub: 3 }, {}],
  ['dawnshore', 'mushnub_path', 30, 200, { enemy_young_mushnub: 3 }, {}],
  ['dawnshore', 'mushnub_north', 70, 290, { enemy_young_mushnub: 3 }, {}],
  ['dawnshore', 'spore_ridge', 120, 270, { enemy_spore_lobber: 3 }, { respawnMs: 100_000 }],
  // Mixed from here: a lobber behind a wall of blobs is the first time the
  // shore asks "which one first?" (§4 / P9's DoD).
  [
    'dawnshore',
    'mushnub_grove',
    140,
    250,
    { enemy_young_mushnub: 2, enemy_meadow_blob: 1 },
    { radius: 8 },
  ],
  [
    'dawnshore',
    'spore_hollow',
    50,
    320,
    { enemy_spore_lobber: 2, enemy_bog_blob: 2 },
    { radius: 8, respawnMs: 130_000 },
  ],
  ['dawnshore', 'blob_bank', 170, 270, { enemy_meadow_blob: 2, enemy_bog_blob: 2 }, { radius: 8 }],
  [
    'dawnshore',
    'bandit_camp',
    0,
    300,
    { enemy_bandit_forager: 2, enemy_young_mushnub: 1 },
    { radius: 8, respawnMs: 150_000 },
  ],
  ['dawnshore', 'bandit_lookout', 185, 320, { enemy_bandit_forager: 3 }, { respawnMs: 150_000 }],
  [
    'dawnshore',
    'mossback_hollow',
    190,
    360,
    { enemy_mossback: 1 },
    { point: true, respawnMs: 300_000 },
  ],
  ['dawnshore', 'shore_birbs', 45, 190, { enemy_shore_birb: 4 }, { radius: 9 }],
  ['dawnshore', 'haven_chickens', 350, 220, { enemy_farm_chicken: 5 }, { radius: 9 }],
  ['dawnshore', 'meadow_bunnies', 90, 190, { enemy_meadow_bunny: 4 }, { radius: 9 }],

  // ------------------------------------------------------------ Verdant Weald
  ['verdant_weald', 'frog_pond', 20, 190, { enemy_weald_frog: 4 }, { respawnMs: 110_000 }],
  ['verdant_weald', 'frog_marsh', 200, 200, { enemy_weald_frog: 3 }, { respawnMs: 110_000 }],
  ['verdant_weald', 'frog_bank', 240, 190, { enemy_weald_frog: 3 }, { respawnMs: 110_000 }],
  ['verdant_weald', 'frog_deep', 160, 210, { enemy_weald_frog: 3 }, { respawnMs: 110_000 }],
  ['verdant_weald', 'warband_glade', 140, 230, { enemy_mushnub_warrior: 3 }, { radius: 8 }],
  ['verdant_weald', 'warband_ridge', 180, 250, { enemy_mushnub_warrior: 3 }, { radius: 8 }],
  ['verdant_weald', 'mushnub_thicket', 220, 240, { enemy_mushnub_warrior: 3 }, { radius: 8 }],
  [
    'verdant_weald',
    'warband_deep',
    160,
    280,
    { enemy_mushnub_warrior: 2, enemy_weald_frog: 2 },
    { radius: 9, respawnMs: 130_000 },
  ],
  [
    'verdant_weald',
    'armabee_hive',
    30,
    250,
    { enemy_armabee_drone: 4, enemy_armabee_soldier: 1 },
    { radius: 9, respawnMs: 140_000 },
  ],
  ['verdant_weald', 'armabee_glade', 340, 230, { enemy_armabee_drone: 4 }, { radius: 8 }],
  ['verdant_weald', 'armabee_swarm', 200, 300, { enemy_armabee_drone: 5 }, { radius: 9 }],
  ['verdant_weald', 'armabee_ridge', 240, 260, { enemy_armabee_soldier: 2 }, { radius: 8 }],
  ['verdant_weald', 'gloom_hollow', 150, 300, { enemy_gloom_ghost: 3 }, { respawnMs: 130_000 }],
  ['verdant_weald', 'gloom_barrow', 170, 330, { enemy_gloom_ghost: 3 }, { respawnMs: 130_000 }],
  ['verdant_weald', 'stalker_thicket', 210, 290, { enemy_weald_stalker: 2 }, {}],
  ['verdant_weald', 'stalker_run', 230, 310, { enemy_weald_stalker: 3 }, {}],
  [
    'verdant_weald',
    'gloom_edge',
    190,
    320,
    { enemy_gloom_ghost: 2, enemy_armabee_drone: 2 },
    { radius: 9, respawnMs: 140_000 },
  ],
  [
    'verdant_weald',
    'stalker_grove',
    145,
    330,
    { enemy_weald_stalker: 2, enemy_gloom_ghost: 1 },
    { radius: 9, respawnMs: 150_000 },
  ],
  // The full "pick your fight": a caster to interrupt, a charger to sidestep
  // and a warrior in your face, at once.
  [
    'verdant_weald',
    'hexer_circle',
    175,
    340,
    { enemy_outcast_hexer: 2, enemy_weald_stalker: 1, enemy_mushnub_warrior: 1 },
    { radius: 10, respawnMs: 160_000 },
  ],
  [
    'verdant_weald',
    'hexer_ridge',
    205,
    340,
    { enemy_outcast_hexer: 1, enemy_weald_stalker: 2 },
    { radius: 9, respawnMs: 150_000 },
  ],
  ['verdant_weald', 'hexer_camp', 220, 330, { enemy_outcast_hexer: 2 }, { respawnMs: 150_000 }],
  [
    'verdant_weald',
    'mushroom_king',
    190,
    360,
    { enemy_mushroom_king: 1 },
    { point: true, respawnMs: 600_000, spread: 60 },
  ],
  ['verdant_weald', 'weald_bunnies', 60, 200, { enemy_meadow_bunny: 4 }, { radius: 9 }],
  ['verdant_weald', 'weald_birbs', 320, 210, { enemy_shore_birb: 3 }, { radius: 9 }],

  // --------------------------------------------------------------- Emberwood
  ['emberwood', 'minion_barrow', 60, 200, { enemy_skeleton_minion: 5 }, { radius: 8 }],
  ['emberwood', 'minion_graves', 30, 230, { enemy_skeleton_minion: 5 }, { radius: 8 }],
  ['emberwood', 'minion_hollow', 90, 210, { enemy_skeleton_minion: 4 }, { radius: 8 }],
  ['emberwood', 'cactoro_flats', 160, 200, { enemy_ember_cactoro: 3 }, {}],
  ['emberwood', 'cactoro_ridge', 230, 240, { enemy_ember_cactoro: 3 }, {}],
  [
    'emberwood',
    'cactoro_hollow',
    250,
    210,
    { enemy_ember_cactoro: 2, enemy_feral_monkroose: 1 },
    { radius: 8 },
  ],
  ['emberwood', 'rogue_thicket', 220, 260, { enemy_skeleton_rogue: 3 }, {}],
  ['emberwood', 'rogue_watch', 240, 300, { enemy_skeleton_rogue: 3 }, {}],
  [
    'emberwood',
    'rogue_run',
    260,
    270,
    { enemy_skeleton_rogue: 2, enemy_skeleton_minion: 2 },
    { radius: 9, respawnMs: 140_000 },
  ],
  ['emberwood', 'monkroose_troop', 270, 240, { enemy_feral_monkroose: 3 }, { radius: 8 }],
  ['emberwood', 'monkroose_canopy', 280, 280, { enemy_feral_monkroose: 3 }, { radius: 8 }],
  [
    'emberwood',
    'mage_circle',
    230,
    310,
    { enemy_skeleton_mage: 2, enemy_skeleton_minion: 2 },
    { radius: 9, respawnMs: 150_000 },
  ],
  ['emberwood', 'mage_crypt', 250, 330, { enemy_skeleton_mage: 2 }, { respawnMs: 150_000 }],
  ['emberwood', 'wisp_barrow', 290, 260, { enemy_grave_wisp: 3 }, { respawnMs: 140_000 }],
  ['emberwood', 'wisp_field', 300, 300, { enemy_grave_wisp: 3 }, { respawnMs: 140_000 }],
  [
    'emberwood',
    'wisp_hollow',
    310,
    270,
    { enemy_grave_wisp: 2, enemy_skeleton_rogue: 1 },
    { radius: 9, respawnMs: 150_000 },
  ],
  [
    'emberwood',
    'warrior_gate',
    260,
    320,
    { enemy_skeleton_warrior: 2, enemy_skeleton_minion: 3 },
    { radius: 10, respawnMs: 160_000 },
  ],
  ['emberwood', 'warrior_march', 280, 340, { enemy_skeleton_warrior: 3 }, { radius: 8 }],
  ['emberwood', 'marauder_camp', 300, 340, { enemy_ashen_marauder: 3 }, { radius: 8 }],
  [
    'emberwood',
    'marauder_watch',
    320,
    300,
    { enemy_ashen_marauder: 2, enemy_ember_cactoro: 1 },
    { radius: 9, respawnMs: 150_000 },
  ],
  [
    'emberwood',
    'marauder_road',
    310,
    330,
    { enemy_ashen_marauder: 2, enemy_skeleton_rogue: 2 },
    { radius: 9, respawnMs: 160_000 },
  ],
  // Varkas keeps a guard rather than summoning one: the ability schema has no
  // summon kind, so his "call the barrow" beat is a camp standing with him.
  [
    'emberwood',
    'varkas_guard',
    270,
    350,
    { enemy_skeleton_warrior: 2, enemy_skeleton_minion: 2 },
    { radius: 9, respawnMs: 180_000 },
  ],
  [
    'emberwood',
    'varkas_barrow',
    285,
    365,
    { enemy_bonelord_varkas: 1 },
    { point: true, respawnMs: 600_000, spread: 60 },
  ],
  ['emberwood', 'ember_birbs', 40, 190, { enemy_shore_birb: 3 }, { radius: 9 }],

  // --------------------------------------------------------- Sungraze Savanna
  ['sungraze', 'grazer_hollow', 20, 200, { enemy_alpaking_grazer: 4 }, { radius: 8 }],
  ['sungraze', 'alpaking_herd', 50, 210, { enemy_alpaking_grazer: 4 }, { radius: 8 }],
  [
    'sungraze',
    'alpaking_pasture',
    90,
    230,
    { enemy_alpaking_grazer: 3, enemy_alpaking_bull: 1 },
    { radius: 9, respawnMs: 140_000 },
  ],
  ['sungraze', 'alpaking_bulls', 120, 240, { enemy_alpaking_bull: 2 }, { respawnMs: 140_000 }],
  ['sungraze', 'raptor_pack', 150, 200, { enemy_steppe_raptor: 5 }, { radius: 9 }],
  ['sungraze', 'raptor_nest', 160, 250, { enemy_steppe_raptor: 5 }, { radius: 9 }],
  ['sungraze', 'raptor_run', 170, 260, { enemy_steppe_raptor: 4 }, { radius: 9 }],
  ['sungraze', 'orc_warband', 30, 260, { enemy_orc_raider: 3 }, { radius: 8 }],
  ['sungraze', 'orc_road', 60, 280, { enemy_orc_raider: 3 }, { radius: 8 }],
  [
    'sungraze',
    'orc_camp',
    80,
    290,
    { enemy_orc_raider: 2, enemy_orc_headhunter: 2 },
    { radius: 9, respawnMs: 150_000 },
  ],
  ['sungraze', 'orc_lookout', 100, 300, { enemy_orc_headhunter: 3 }, { radius: 8 }],
  [
    'sungraze',
    'windcaller_ring',
    40,
    320,
    { enemy_tribal_windcaller: 2, enemy_dust_hywirl: 2 },
    { radius: 10, respawnMs: 160_000 },
  ],
  ['sungraze', 'windcaller_mesa', 20, 340, { enemy_tribal_windcaller: 2 }, { respawnMs: 150_000 }],
  [
    'sungraze',
    'windcaller_camp',
    110,
    260,
    { enemy_tribal_windcaller: 1, enemy_orc_raider: 2 },
    { radius: 9, respawnMs: 150_000 },
  ],
  ['sungraze', 'hywirl_drift', 70, 230, { enemy_dust_hywirl: 5 }, { radius: 9 }],
  ['sungraze', 'hywirl_flats', 100, 200, { enemy_dust_hywirl: 4 }, { radius: 9 }],
  ['sungraze', 'hywirl_gulch', 130, 220, { enemy_dust_hywirl: 4 }, { radius: 9 }],
  ['sungraze', 'sun_cactoro_field', 60, 350, { enemy_sun_cactoro: 3 }, {}],
  ['sungraze', 'cactoro_stand', 90, 330, { enemy_sun_cactoro: 3 }, {}],
  [
    'sungraze',
    'sun_cactoro_ridge',
    110,
    340,
    { enemy_sun_cactoro: 2, enemy_orc_headhunter: 1 },
    { radius: 9, respawnMs: 150_000 },
  ],
  ['sungraze', 'prime_herd', 30, 350, { enemy_alpaking_grazer: 3 }, { radius: 8 }],
  [
    'sungraze',
    'alpaking_prime',
    15,
    370,
    { enemy_alpaking_prime: 1 },
    { point: true, respawnMs: 600_000, spread: 64 },
  ],
  ['sungraze', 'savanna_chickens', 165, 190, { enemy_farm_chicken: 5 }, { radius: 9 }],
  ['sungraze', 'savanna_bunnies', 175, 225, { enemy_meadow_bunny: 4 }, { radius: 9 }],

  // ---------------------------------------------------------- Ashcrag Canyons
  ['ashcrag', 'goleling_scree', 40, 200, { enemy_ash_goleling: 3 }, { radius: 8 }],
  ['ashcrag', 'goleling_slope', 20, 240, { enemy_ash_goleling: 3 }, { radius: 8 }],
  ['ashcrag', 'goleling_deep', 300, 330, { enemy_ash_goleling: 4 }, { radius: 8 }],
  ['ashcrag', 'crag_ledge', 180, 260, { enemy_crag_goleling: 2 }, { respawnMs: 160_000 }],
  [
    'ashcrag',
    'crag_shelf',
    60,
    200,
    { enemy_crag_goleling: 2, enemy_ash_goleling: 2 },
    { radius: 9, respawnMs: 160_000 },
  ],
  ['ashcrag', 'demon_rift', 200, 260, { enemy_canyon_demon: 3 }, { radius: 8 }],
  ['ashcrag', 'demon_road', 260, 320, { enemy_canyon_demon: 3 }, { radius: 8 }],
  [
    'ashcrag',
    'demon_pit',
    220,
    270,
    { enemy_canyon_demon: 2, enemy_void_demon: 1 },
    { radius: 9, respawnMs: 160_000 },
  ],
  ['ashcrag', 'void_altar', 280, 300, { enemy_void_demon: 2 }, { respawnMs: 160_000 }],
  [
    'ashcrag',
    'void_ridge',
    300,
    300,
    { enemy_void_demon: 2, enemy_skull_swarm: 2 },
    { radius: 9, respawnMs: 170_000 },
  ],
  ['ashcrag', 'yeti_shelf', 320, 260, { enemy_ashcrag_yeti: 2 }, { respawnMs: 150_000 }],
  ['ashcrag', 'yeti_hollow', 340, 320, { enemy_ashcrag_yeti: 2 }, { respawnMs: 150_000 }],
  [
    'ashcrag',
    'yeti_ridge',
    250,
    290,
    { enemy_ashcrag_yeti: 2, enemy_ash_goleling: 1 },
    { radius: 9, respawnMs: 160_000 },
  ],
  ['ashcrag', 'squidle_rift', 170, 270, { enemy_rift_squidle: 3 }, { radius: 8 }],
  ['ashcrag', 'squidle_pools', 190, 250, { enemy_rift_squidle: 2 }, { radius: 8 }],
  ['ashcrag', 'skull_swarm_ledge', 30, 300, { enemy_skull_swarm: 5 }, { radius: 9 }],
  ['ashcrag', 'skull_field', 10, 330, { enemy_skull_swarm: 5 }, { radius: 9 }],
  ['ashcrag', 'warlord_guard', 270, 340, { enemy_orc_warlord_guard: 2 }, { respawnMs: 180_000 }],
  [
    'ashcrag',
    'warlord_gate',
    290,
    350,
    { enemy_orc_warlord_guard: 2, enemy_canyon_demon: 2 },
    { radius: 10, respawnMs: 180_000 },
  ],
  // The rare roamer: one dragon, a long walk between sightings.
  [
    'ashcrag',
    'dragon_roost',
    250,
    312,
    { enemy_ashcrag_dragon: 1 },
    { point: true, respawnMs: 600_000, spread: 60 },
  ],
  [
    'ashcrag',
    'ashwing_caldera',
    275,
    315,
    { enemy_ashwing: 1 },
    { point: true, respawnMs: 600_000, spread: 80 },
  ],
  ['ashcrag', 'ash_birbs', 90, 200, { enemy_shore_birb: 3 }, { radius: 9 }],

  // -------------------------------------------------------------- Elder Grove
  // A small isle and an elite pocket: six camps, and everything in it is 30.
  ['elder_grove', 'grove_sporelings', 0, 90, { enemy_elder_sporeling: 2 }, { respawnMs: 180_000 }],
  ['elder_grove', 'grove_edge', 60, 110, { enemy_elder_sporeling: 2 }, { respawnMs: 180_000 }],
  ['elder_grove', 'grove_sentinels', 120, 100, { enemy_grove_sentinel: 2 }, { respawnMs: 180_000 }],
  [
    'elder_grove',
    'grove_watch',
    240,
    95,
    { enemy_grove_sentinel: 1, enemy_elder_sporeling: 1 },
    { radius: 9, respawnMs: 180_000 },
  ],
  [
    'elder_grove',
    'elder_treant',
    180,
    120,
    { enemy_elder_treant: 1 },
    { point: true, respawnMs: 600_000, spread: 60 },
  ],
  ['elder_grove', 'grove_bunnies', 300, 80, { enemy_meadow_bunny: 3 }, { radius: 9 }],
];

/**
 * Resolve every camp against the terrain and emit spawner rows.
 *
 * Throws if any camp cannot find ground — a pass that silently drops a boss is
 * worse than one that stops.
 */
export const buildSpawners = () => {
  const placed = placeAll(
    CAMPS.map(([zone, name, bearing, distance, , options]) => ({
      id: `spawner_${name}`,
      zone,
      bearing,
      distance,
      // Bosses need their arena clear of the next camp over; everything else
      // just needs not to overlap.
      clearance: options.spread ?? 30,
      // A boss arena is 28–40 m of ground the fight moves across, so it needs
      // to be FLAT — the first pass put Ashwing's caldera on 22°, which is
      // inside the general camp limit and still a hillside to fight a dragon on.
      maxSlope: options.spread ? 14 : 22,
    })),
  );
  const byId = new Map(placed.map((entry) => [entry.id, entry]));

  return CAMPS.map(([zone, name, , , entries, options]) => {
    const id = `spawner_${name}`;
    const at = byId.get(id);
    return {
      id,
      kind: options.point ? 'point' : 'area',
      x: at.x,
      z: at.z,
      radius: options.point ? 0 : (options.radius ?? 7),
      entries: Object.entries(entries).map(([enemyId, count]) => ({
        enemyId,
        count,
        level: null,
      })),
      respawnMs: options.respawnMs ?? 120_000,
      // The camp tag drives social aggro: everything in one camp comes at once.
      campTag: name,
      nightOnly: false,
      // Not part of the spawner schema — the report reads it and drops it.
      $zone: zone,
      $ground: at.y,
      $slope: at.slope,
      $movedM: at.movedM,
    };
  });
};
