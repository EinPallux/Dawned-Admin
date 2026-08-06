/**
 * Where the gathering nodes stand on the Dawnlands (game P12-E).
 *
 * Every P10 cluster was a hand-typed coordinate on the dev island, and the
 * Dawnlands put open water there — so this is not an extension of that list,
 * it is all ~370 placements, authored at once and resolved against the real
 * terrain by the same `placeAll` the camps use.
 *
 * A cluster is a WISH: zone, bearing from that isle's heart, distance, and how
 * many nodes belong to it. The search finds the ground; this file decides the
 * SHAPE — which profession sits where, how the tiers ladder outward, and that a
 * shoal is water within casting distance of a shore rather than open ocean.
 *
 * Two things it deliberately does NOT do. It does not place nodes inside a
 * settlement's keep-out (a copper vein in the market square is not a walk into
 * the world), and it does not place T5 anywhere but the canyons and the Grove:
 * the ladder is the whole point of a tier gate.
 */

import { placeAll } from './placement.js';

/**
 * `[zone, nodeId, bearing°, distance m, count, spread m]`.
 *
 * Counts land on CONTENT_0.1's ~370: about 120 trees, 95 ore, 95 herbs and 48
 * fishing spots. Trees cluster largest because a forest reads as a forest;
 * ore sits in tighter seams; herbs scatter widest per node but in smaller
 * groups, so a herbalist walks between them instead of standing still.
 *
 * The bearings come from the same per-isle land probe the camps used — the arc
 * of each isle that is really its own zone rather than another isle's shoulder
 * or open sea.
 */
const CLUSTERS = [
  // ---------------------------------------------------------------- Dawnshore
  ['dawnshore', 'node_woodcutting_birch', 25, 215, 7, 14],
  ['dawnshore', 'node_woodcutting_birch', 75, 265, 6, 13],
  ['dawnshore', 'node_woodcutting_birch', 125, 235, 6, 13],
  ['dawnshore', 'node_woodcutting_birch', 165, 285, 5, 12],
  ['dawnshore', 'node_mining_copper', 45, 305, 5, 9],
  ['dawnshore', 'node_mining_copper', 95, 330, 5, 9],
  ['dawnshore', 'node_mining_copper', 140, 320, 5, 9],
  ['dawnshore', 'node_mining_copper', 15, 350, 4, 9],
  ['dawnshore', 'node_herbalism_meadowbell', 35, 195, 5, 12],
  ['dawnshore', 'node_herbalism_meadowbell', 90, 215, 5, 12],
  ['dawnshore', 'node_herbalism_meadowbell', 145, 205, 5, 12],
  ['dawnshore', 'node_herbalism_meadowbell', 180, 255, 4, 11],
  ['dawnshore', 'node_fishing_shore_shoal', 90, 485, 4, 10, true],
  ['dawnshore', 'node_fishing_shore_shoal', 120, 495, 4, 10, true],

  // ------------------------------------------------------------ Verdant Weald
  ['verdant_weald', 'node_woodcutting_wealdoak', 150, 235, 7, 14],
  ['verdant_weald', 'node_woodcutting_wealdoak', 185, 270, 6, 13],
  ['verdant_weald', 'node_woodcutting_wealdoak', 215, 240, 6, 13],
  ['verdant_weald', 'node_woodcutting_wealdoak', 165, 310, 5, 12],
  ['verdant_weald', 'node_mining_iron', 30, 230, 5, 9],
  ['verdant_weald', 'node_mining_iron', 200, 330, 5, 9],
  ['verdant_weald', 'node_mining_iron', 235, 300, 5, 9],
  ['verdant_weald', 'node_mining_iron', 145, 355, 4, 9],
  ['verdant_weald', 'node_herbalism_mossbloom', 170, 200, 5, 12],
  ['verdant_weald', 'node_herbalism_mossbloom', 225, 215, 5, 12],
  ['verdant_weald', 'node_herbalism_mossbloom', 195, 350, 5, 12],
  ['verdant_weald', 'node_herbalism_mossbloom', 340, 245, 4, 11],
  ['verdant_weald', 'node_fishing_weald_pool', 90, 255, 4, 10, true],
  ['verdant_weald', 'node_fishing_weald_pool', 120, 305, 4, 10, true],

  // --------------------------------------------------------------- Emberwood
  ['emberwood', 'node_woodcutting_emberbark', 235, 250, 7, 14],
  ['emberwood', 'node_woodcutting_emberbark', 265, 285, 6, 13],
  ['emberwood', 'node_woodcutting_emberbark', 295, 255, 6, 13],
  ['emberwood', 'node_woodcutting_emberbark', 245, 325, 5, 12],
  ['emberwood', 'node_mining_silverline', 70, 220, 5, 9],
  ['emberwood', 'node_mining_silverline', 285, 335, 5, 9],
  ['emberwood', 'node_mining_silverline', 315, 300, 5, 9],
  ['emberwood', 'node_mining_silverline', 40, 260, 4, 9],
  ['emberwood', 'node_herbalism_cinderleaf', 105, 250, 5, 12],
  ['emberwood', 'node_herbalism_cinderleaf', 255, 200, 5, 12],
  ['emberwood', 'node_herbalism_cinderleaf', 305, 225, 5, 12],
  ['emberwood', 'node_herbalism_cinderleaf', 275, 355, 4, 11],
  ['emberwood', 'node_fishing_ember_run', 300, 225, 4, 10, true],
  ['emberwood', 'node_fishing_ember_run', 90, 300, 4, 10, true],

  // ---------------------------------------------------------- Sungraze Savanna
  ['sungraze', 'node_woodcutting_acacia', 35, 240, 7, 15],
  ['sungraze', 'node_woodcutting_acacia', 75, 275, 6, 14],
  ['sungraze', 'node_woodcutting_acacia', 115, 250, 6, 14],
  ['sungraze', 'node_woodcutting_acacia', 55, 330, 5, 13],
  ['sungraze', 'node_mining_gold', 25, 300, 5, 9],
  ['sungraze', 'node_mining_gold', 95, 320, 5, 9],
  ['sungraze', 'node_mining_gold', 125, 290, 5, 9],
  ['sungraze', 'node_mining_gold', 15, 355, 4, 9],
  ['sungraze', 'node_herbalism_sunblossom', 50, 200, 5, 13],
  ['sungraze', 'node_herbalism_sunblossom', 105, 215, 5, 13],
  ['sungraze', 'node_herbalism_sunblossom', 145, 235, 5, 13],
  ['sungraze', 'node_herbalism_sunblossom', 85, 355, 4, 12],
  ['sungraze', 'node_fishing_dune_water', 150, 300, 4, 10, true],
  ['sungraze', 'node_fishing_dune_water', 120, 280, 4, 10, true],

  // ---------------------------------------------------------- Ashcrag Canyons
  ['ashcrag', 'node_woodcutting_ashwood', 30, 215, 7, 14],
  ['ashcrag', 'node_woodcutting_ashwood', 300, 290, 6, 13],
  ['ashcrag', 'node_woodcutting_ashwood', 330, 250, 6, 13],
  ['ashcrag', 'node_woodcutting_ashwood', 265, 320, 5, 12],
  ['ashcrag', 'node_mining_dawnstone', 50, 250, 5, 9],
  ['ashcrag', 'node_mining_dawnstone', 285, 315, 5, 9],
  ['ashcrag', 'node_mining_dawnstone', 315, 340, 5, 9],
  ['ashcrag', 'node_mining_dawnstone', 10, 310, 4, 9],
  ['ashcrag', 'node_herbalism_duskthorn', 175, 245, 5, 12],
  ['ashcrag', 'node_herbalism_duskthorn', 205, 275, 5, 12],
  ['ashcrag', 'node_herbalism_duskthorn', 340, 210, 5, 12],
  ['ashcrag', 'node_herbalism_duskthorn', 240, 350, 4, 11],
  // Deep-sea: §5's eight, out past the canyon's own shelf.
  ['ashcrag', 'node_fishing_deepsea', 120, 235, 4, 12, true],
  ['ashcrag', 'node_fishing_deepsea', 90, 260, 4, 12, true],

  // -------------------------------------------------------------- Elder Grove
  // The T5 rare bloom PROFESSIONS §4 reserves for the Grove, and nothing else:
  // the pocket is meant to be walked for one thing.
  ['elder_grove', 'node_herbalism_dawnpetal', 30, 95, 4, 11],
  ['elder_grove', 'node_herbalism_dawnpetal', 150, 105, 4, 11],
  ['elder_grove', 'node_herbalism_dawnpetal', 270, 100, 4, 11],
];

/** Deterministic 0–1 from two integers — the same cluster scatters the same way. */
const jitter = (a, b) => {
  let h = Math.imul(a * 73856093, 1) ^ Math.imul(b * 19349663, 1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Resolve every cluster centre against the terrain and hand back hints in the
 * shape `author-nodes.mjs` already consumes — the per-node ground check there
 * reads the DRAFT CHUNKS, which is the authority on what was actually written,
 * and it still gets the last word on each individual tree.
 */
export const buildNodeClusters = () => {
  const placed = placeAll(
    CLUSTERS.map(([zone, nodeId, bearing, distance, count, spread, water], index) => ({
      id: `cluster_${index}_${nodeId}`,
      zone,
      bearing,
      distance,
      // Clusters may crowd more than camps: two seams 40 m apart is a mining
      // area, two camps 40 m apart is one fight.
      clearance: spread * 2 + 12,
      water: water === true,
      // A tree line can climb; only a boss arena needs a floor.
      maxSlope: 30,
      allowNearTown: false,
      // Deep-sea sits further out than a shore shoal.
      maxDepth: nodeId === 'node_fishing_deepsea' ? 10 : 6,
      nearLand: nodeId === 'node_fishing_deepsea' ? 60 : 30,
      count,
      spread,
      nodeId,
      zoneId: zone,
    })),
  );
  return placed.map((at, index) => {
    const [zone, nodeId, , , count, spread, water] = CLUSTERS[index];
    return {
      nodeId,
      zone,
      x: at.x,
      z: at.z,
      count,
      spread,
      water: water === true,
      movedM: at.movedM,
      // Rotation/scale jitter lives with the cluster so a re-run is identical.
      seed: index + 1,
      jitter,
    };
  });
};
