/**
 * The Dawnlands' places and furniture (game P12-F).
 *
 * Three lists, all of them WISHES rather than coordinates — the same contract
 * the camps (P12-C) and the gathering clusters (P12-E) use, resolved against the
 * real height field by `placeAll`:
 *
 *  1. `POI_WISHES` — the ≥45 discovery points of CONTENT_0.1 §1.
 *  2. `INTERACTABLE_WISHES` — chests, campfires, signposts and the Grove portal.
 *     The nine Ancient Shrines already stand (P12-B) and are not re-placed here.
 *  3. `TOWN_DRESSING` — props positioned relative to a SETTLEMENT rather than to
 *     an isle, because a barrel belongs beside a specific door. These use the
 *     same offset+facing maths the buildings do, so rotating a town rotates its
 *     clutter with it.
 *
 * Why the towns needed this at all: P12-B built five settlements as forty
 * building shells and nothing else. Buildings on a plateau with no barrels, no
 * stalls, no carts and no benches read as a diorama of a town rather than a
 * town, and that gap is much bigger than any single missing prop.
 */

/** `[zone, kind, id, name, bearing°, distance m, radius m]`. */
const POIS = [
  // ------------------------------------------------------------- Dawnshore (1–8)
  ['dawnshore', 'vista', 'poi_gullspit_head', 'Gullspit Head', 60, 470, 20],
  ['dawnshore', 'vista', 'poi_harbour_light', 'The Harbour Light', 120, 430, 16],
  ['dawnshore', 'landmark', 'poi_wreck_of_the_meridian', 'Wreck of the Meridian', 95, 520, 18],
  ['dawnshore', 'landmark', 'poi_standing_stones', 'The Salt Stones', 20, 330, 16],
  ['dawnshore', 'landmark', 'poi_old_lighthouse', 'The Broken Lantern', 150, 380, 16],
  ['dawnshore', 'cache', 'poi_smugglers_hollow', "Smuggler's Hollow", 40, 285, 12],
  ['dawnshore', 'camp', 'poi_glub_shallows', 'The Glub Shallows', 110, 300, 20],
  ['dawnshore', 'camp', 'poi_driftwood_camp', 'Driftwood Camp', 165, 350, 18],
  ['dawnshore', 'curiosity', 'poi_singing_shell', 'The Singing Shell', 75, 240, 10],

  // -------------------------------------------------------- Verdant Weald (9–17)
  ['verdant_weald', 'vista', 'poi_canopy_walk', 'The Canopy Walk', 190, 330, 18],
  ['verdant_weald', 'landmark', 'poi_mother_oak', 'The Mother Oak', 165, 260, 20],
  ['verdant_weald', 'landmark', 'poi_stone_circle', 'The Green Ring', 215, 300, 18],
  ['verdant_weald', 'landmark', 'poi_sunken_barrow', 'The Sunken Barrow', 240, 340, 16],
  ['verdant_weald', 'cache', 'poi_hollow_trunk', 'The Hollow Trunk', 175, 215, 12],
  ['verdant_weald', 'cache', 'poi_poachers_stash', "The Poacher's Stash", 205, 380, 12],
  ['verdant_weald', 'camp', 'poi_stalker_thicket', 'Stalker Thicket', 155, 290, 20],
  ['verdant_weald', 'camp', 'poi_mushroom_court', 'The Mushroom Court', 230, 250, 22],
  ['verdant_weald', 'curiosity', 'poi_upside_tree', 'The Upside-Down Tree', 195, 195, 10],

  // ----------------------------------------------------------- Emberwood (18–24)
  ['emberwood', 'vista', 'poi_ash_ridge', 'Ash Ridge', 260, 330, 18],
  ['emberwood', 'landmark', 'poi_burnt_cathedral', 'The Burnt Cathedral', 285, 290, 20],
  ['emberwood', 'landmark', 'poi_barrow_field', 'The Barrow Field', 310, 320, 20],
  ['emberwood', 'cache', 'poi_charcoal_pit', 'The Charcoal Pit', 245, 250, 12],
  ['emberwood', 'camp', 'poi_marauder_stakes', 'The Marauder Stakes', 270, 360, 20],
  ['emberwood', 'camp', 'poi_bonelord_watch', "Bonelord's Watch", 300, 245, 22],
  ['emberwood', 'curiosity', 'poi_ever_ember', 'The Ever-Ember', 325, 265, 10],

  // ------------------------------------------------------ Sungraze Savanna (25–33)
  ['sungraze', 'vista', 'poi_high_mesa', 'The High Mesa', 45, 340, 20],
  ['sungraze', 'vista', 'poi_watchers_rock', "Watcher's Rock", 100, 300, 18],
  ['sungraze', 'landmark', 'poi_bleached_arch', 'The Bleached Arch', 70, 380, 18],
  ['sungraze', 'landmark', 'poi_herd_road', 'The Herd Road', 125, 265, 20],
  ['sungraze', 'cache', 'poi_dry_cistern', 'The Dry Cistern', 30, 285, 12],
  ['sungraze', 'cache', 'poi_buried_caravan', 'The Buried Caravan', 140, 350, 12],
  ['sungraze', 'camp', 'poi_orc_warcamp', 'The Warband Fires', 85, 400, 22],
  ['sungraze', 'camp', 'poi_cactoro_flats', 'Cactoro Flats', 15, 245, 20],
  ['sungraze', 'curiosity', 'poi_thundering_gourd', 'The Thundering Gourd', 110, 215, 10],

  // ------------------------------------------------------- Ashcrag Canyons (34–41)
  ['ashcrag', 'vista', 'poi_caldera_rim', 'The Caldera Rim', 20, 300, 22],
  ['ashcrag', 'vista', 'poi_last_ledge', 'The Last Ledge', 315, 330, 18],
  ['ashcrag', 'landmark', 'poi_dawnstone_face', 'The Dawnstone Face', 45, 265, 20],
  ['ashcrag', 'landmark', 'poi_iron_gallows', 'The Iron Gallows', 290, 285, 16],
  ['ashcrag', 'landmark', 'poi_dragons_stair', "The Dragon's Stair", 335, 260, 20],
  ['ashcrag', 'cache', 'poi_collapsed_adit', 'The Collapsed Adit', 60, 225, 12],
  ['ashcrag', 'camp', 'poi_golem_yard', 'The Golem Yard', 265, 315, 22],
  ['ashcrag', 'curiosity', 'poi_whistling_flue', 'The Whistling Flue', 180, 240, 10],

  // ---------------------------------------------------------- Elder Grove (42–45)
  // Three, not eight: §3.6 makes the Grove a small pocket you walk for one
  // thing. Padding it to match the other zones would make it a normal place.
  ['elder_grove', 'landmark', 'poi_elder_treant_glade', "The Elder's Glade", 90, 80, 22],
  ['elder_grove', 'cache', 'poi_root_vault', 'The Root Vault', 210, 90, 12],
  ['elder_grove', 'camp', 'poi_sporeling_ring', 'The Sporeling Ring', 330, 85, 18],
];

/**
 * XP basis by kind (PROGRESSION §4 scales it by the finder's level).
 *
 * A vista pays most because it is the one kind with no other reward — a cache
 * has a chest in it, a camp has things to kill, a landmark is usually a quest
 * target. Standing somewhere high and looking has to pay for itself.
 */
const POI_XP = { vista: 320, landmark: 250, cache: 270, camp: 230, curiosity: 210, shrine: 300 };

export const POI_WISHES = POIS.map(([zone, kind, id, name, bearing, distance, radius]) => ({
  id,
  zone,
  kind,
  name,
  bearing,
  distance,
  radius,
  xpBasis: POI_XP[kind],
  // A discovery ring may sit on a slope — you are walking past it, not fighting
  // in it — but not on a cliff face you can never enter.
  maxSlope: 32,
  clearance: radius + 30,
  allowNearTown: false,
}));

/**
 * Chests, campfires, signposts, and the one portal.
 *
 * `[zone, kind, id, name, bearing°, distance m]`, with per-kind extras filled in
 * below. Counts follow CONTENT_0.1 §1: ~25 chests, 8 campfires, ~12 signposts.
 */
const CHESTS = [
  ['dawnshore', 'chest_shore_1', 'Weathered Chest', 55, 300, 'loot_dawnshore_gear'],
  ['dawnshore', 'chest_shore_2', 'Sand-Buried Chest', 105, 355, 'loot_dawnshore_trash'],
  ['dawnshore', 'chest_shore_3', "Smuggler's Chest", 40, 285, 'loot_dawnshore_gear'],
  ['dawnshore', 'chest_shore_4', 'Wreck Strongbox', 95, 520, 'loot_dawnshore_gear'],
  ['dawnshore', 'chest_shore_5', 'Tidewrack Crate', 150, 395, 'loot_dawnshore_trash'],
  ['verdant_weald', 'chest_weald_1', 'Mossy Chest', 175, 215, 'loot_weald_gear'],
  ['verdant_weald', 'chest_weald_2', "Poacher's Chest", 205, 380, 'loot_weald_gear'],
  ['verdant_weald', 'chest_weald_3', 'Barrow Chest', 240, 340, 'loot_weald_gear'],
  ['verdant_weald', 'chest_weald_4', 'Root-Wrapped Chest', 220, 265, 'loot_weald_trash'],
  ['verdant_weald', 'chest_weald_5', 'Forgotten Cache', 160, 330, 'loot_weald_trash'],
  ['emberwood', 'chest_ember_1', 'Scorched Chest', 245, 250, 'loot_emberwood_gear'],
  ['emberwood', 'chest_ember_2', 'Reliquary Box', 285, 290, 'loot_emberwood_gear'],
  ['emberwood', 'chest_ember_3', 'Grave Goods', 310, 320, 'loot_emberwood_gear'],
  ['emberwood', 'chest_ember_4', 'Marauder Spoils', 270, 360, 'loot_emberwood_trash'],
  ['emberwood', 'chest_ember_5', 'Ash-Filled Coffer', 330, 275, 'loot_emberwood_trash'],
  ['sungraze', 'chest_sun_1', 'Cistern Chest', 30, 285, 'loot_sungraze_gear'],
  ['sungraze', 'chest_sun_2', 'Caravan Strongbox', 140, 350, 'loot_sungraze_gear'],
  ['sungraze', 'chest_sun_3', 'Warband Chest', 85, 400, 'loot_sungraze_gear'],
  ['sungraze', 'chest_sun_4', 'Sun-Bleached Crate', 55, 320, 'loot_sungraze_trash'],
  ['sungraze', 'chest_sun_5', 'Drover’s Box', 120, 240, 'loot_sungraze_trash'],
  ['ashcrag', 'chest_ash_1', 'Adit Strongbox', 60, 225, 'loot_ashcrag_gear'],
  ['ashcrag', 'chest_ash_2', 'Gallows Coffer', 290, 285, 'loot_ashcrag_gear'],
  ['ashcrag', 'chest_ash_3', 'Golem-Yard Chest', 265, 315, 'loot_ashcrag_gear'],
  ['ashcrag', 'chest_ash_4', 'Slag-Buried Chest', 340, 295, 'loot_ashcrag_trash'],
  ['ashcrag', 'chest_ash_5', "Prospector's Cache", 25, 350, 'loot_ashcrag_trash'],
  ['elder_grove', 'chest_grove_1', 'The Root Vault', 210, 90, 'loot_elder_grove'],
];

const CAMPFIRES = [
  ['dawnshore', 'campfire_shore', 'Driftwood Fire', 165, 350],
  ['dawnshore', 'campfire_gullspit', 'Gullspit Fire', 60, 455],
  ['verdant_weald', 'campfire_weald', "Woodcutters' Fire", 170, 245],
  ['verdant_weald', 'campfire_weald_deep', 'Deep Weald Fire', 225, 355],
  ['emberwood', 'campfire_ember', 'Pilgrim Fire', 255, 300],
  ['sungraze', 'campfire_sun', 'Drover Fire', 95, 285],
  ['sungraze', 'campfire_sun_east', 'Eastern Watchfire', 20, 360],
  ['ashcrag', 'campfire_ash', "Prospectors' Fire", 40, 290],
];

const SIGNPOSTS = [
  [
    'dawnshore',
    'sign_dawnhaven_gate',
    'Dawnhaven — this way',
    75,
    380,
    'Dawnhaven ↑   The Weald ↓   mind the glubs',
  ],
  ['dawnshore', 'sign_shore_fork', 'Shore Fork', 130, 300, 'Gullspit Head ←   the harbour →'],
  [
    'dawnshore',
    'sign_weald_road',
    'The Weald Road',
    180,
    420,
    'Mosshollow, two days on foot. Do not sleep under the oaks.',
  ],
  [
    'verdant_weald',
    'sign_mosshollow',
    'Mosshollow',
    200,
    230,
    'Mosshollow ↑   Cinderfall, north and up   turn back at dusk',
  ],
  [
    'verdant_weald',
    'sign_weald_deep',
    'Deep Weald Warning',
    215,
    340,
    'Past this stone the stalkers hunt in threes. Bring a friend.',
  ],
  [
    'emberwood',
    'sign_cinderfall',
    'Cinderfall',
    275,
    250,
    'Cinderfall ↑   the barrows ←   nothing east but ash',
  ],
  [
    'emberwood',
    'sign_barrow_warning',
    'Barrow Warning',
    305,
    300,
    'The dead here do not stay lying down. Torches will not help.',
  ],
  [
    'sungraze',
    'sign_sunwatch',
    'Sunwatch',
    100,
    255,
    'Sunwatch ↑   water at the cistern ←   the herds move at dawn',
  ],
  [
    'sungraze',
    'sign_savanna_fork',
    'Savanna Fork',
    60,
    330,
    'Rustpick, east and up ↗   the arch ↖',
  ],
  [
    'ashcrag',
    'sign_rustpick',
    'Rustpick Camp',
    35,
    265,
    'Rustpick Camp ↑   the caldera ↗   the Stair is not a road',
  ],
  [
    'ashcrag',
    'sign_caldera',
    'Caldera Warning',
    25,
    315,
    'Ashwing hunts the rim. Look up before you cross open stone.',
  ],
  [
    'ashcrag',
    'sign_last_ledge',
    'The Last Ledge',
    310,
    320,
    'There is nothing past this but the drop and the wind.',
  ],
];

export const INTERACTABLE_WISHES = [
  ...CHESTS.map(([zone, id, name, bearing, distance, lootTableId]) => ({
    id,
    zone,
    kind: 'chest',
    name,
    bearing,
    distance,
    lootTableId,
    modelRef: 'world_props_chest',
    // Nothing a quest step needs may be one-shot (Q29). These are ordinary
    // world chests rather than quest props, but the same reasoning applies to a
    // second player arriving ten minutes later.
    respawnMs: 600_000,
    maxSlope: 24,
    clearance: 24,
  })),
  ...CAMPFIRES.map(([zone, id, name, bearing, distance]) => ({
    id,
    zone,
    kind: 'campfire',
    name,
    bearing,
    distance,
    modelRef: 'world_props_bonfire_lit',
    // A rest point wants flat ground and room to stand around it.
    maxSlope: 14,
    clearance: 36,
  })),
  ...SIGNPOSTS.map(([zone, id, name, bearing, distance, text]) => ({
    id,
    zone,
    kind: 'signpost',
    name,
    bearing,
    distance,
    text,
    modelRef: 'world_props_pointer_001',
    maxSlope: 20,
    clearance: 20,
  })),
  {
    /**
     * The way INTO the Elder Grove, and it stands in ASHCRAG.
     *
     * WORLD.md §3.6 is precise: the Grove is "reachable only by a long swim from
     * Verdant Weald's north cape (stamina check) or a one-way ancient portal POI
     * in Ashcrag". Authored the other way round first — an arch in the Grove
     * leading out — this made every POI, chest and camp on the islet
     * unreachable, and publish refused the lot. Which was correct: the Grove has
     * no causeway (Q30), the open ocean between it and the mainland is disabled
     * chunks the walkgrid marks Blocked, and a portal pointing OUT is not a way
     * in. It is one-way on purpose; the way home is the Grove's own shrine.
     */
    id: 'portal_elder_arch',
    zone: 'ashcrag',
    kind: 'portal',
    name: 'The Elder Arch',
    bearing: 300,
    distance: 300,
    modelRef: 'world_props_arch_gate',
    // Just inside the Grove's south-east shore, on the flat the glade sits on.
    destX: -840,
    destZ: -760,
    maxSlope: 12,
    clearance: 30,
  },
];

/**
 * Village dressing, as offsets from a settlement centre.
 *
 * `[model, dx, dz, yaw, solidRadius]` — the same shape a building uses, run
 * through the same `buildingWorldPos`, so a town's facing rotates its clutter
 * with it. Most of it is NOT solid: walking into a barrel should not stop you,
 * and every solid prop is a hole punched in the walkgrid of a small plateau.
 * Only the well and the gazebo block, because both are large enough that
 * walking through one reads as a bug.
 */
const commonYard = [
  ['barrel', 9, 6, 0.3, 0],
  ['barrel', 11, 8, 1.1, 0],
  ['crate', -8, 9, 0.6, 0],
  ['crate', -10, 11, 2.2, 0],
  ['hay', 14, -9, 0.9, 0],
  ['bench_1', 4, 12, 1.57, 0],
  ['cart', -14, -6, 0.4, 0],
  ['fence', 18, 3, 0, 0],
  ['fence', 18, 9, 0, 0],
];

export const TOWN_DRESSING = {
  dawnhaven: [
    ['well', 0, 8, 0, 2.2],
    ['marketstand_1', -12, 4, 0.2, 0],
    ['marketstand_2', -12, -6, 0.2, 0],
    ['marketstand_1', 12, -2, -1.4, 0],
    ['gazebo', 16, 14, 0.5, 2.6],
    ['cauldron', -4, -12, 0, 0],
    ...commonYard,
  ],
  mosshollow: [
    ['well', 2, 6, 0, 2.2],
    ['marketstand_2', -9, 5, 0.4, 0],
    ['cauldron', 6, -8, 0, 0],
    ...commonYard,
  ],
  cinderfall: [
    ['well', -2, 7, 0, 2.2],
    ['marketstand_1', 10, 6, -0.5, 0],
    ['cauldron', -7, -9, 0, 0],
    ['gazebo', -16, 12, 0.2, 2.6],
    ...commonYard,
  ],
  sunwatch: [
    ['well', 0, 10, 0, 2.2],
    ['marketstand_1', -14, 6, 0.3, 0],
    ['marketstand_2', -14, -4, 0.3, 0],
    ['hay', 22, 12, 0.2, 0],
    ['hay', 26, 8, 1.3, 0],
    ['cart', 20, -12, 0.8, 0],
    ...commonYard,
  ],
  rustpick: [
    ['marketstand_2', -8, 8, 0.5, 0],
    ['cauldron', 5, -7, 0, 0],
    ['crate', 12, 4, 0.2, 0],
    ['crate', 14, 7, 1.4, 0],
    ...commonYard,
  ],
};
