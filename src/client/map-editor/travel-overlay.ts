/**
 * The travel graph drawn on the world (A3-c · MAP_EDITOR.md §2.4).
 *
 * One line per hop, tinted by what it costs: green for a cheap ring the player
 * will use constantly, amber as the price climbs, red at the design's ceiling.
 * The cost matrix in the panel says the same thing in numbers, but the SHAPE is
 * the thing you cannot read from a table — three shrines in a cluster and one
 * across the map is a graph where every real journey costs the cap.
 */

import * as THREE from 'three';
import { FAST_TRAVEL_MAX_GOLD, FAST_TRAVEL_MIN_GOLD, type TravelHop } from '@dawned/shared';
import type { Shrine } from './travel-graph.js';

const OFF_GRAPH_COLOR = 0x7a7a7a;

/** Cheap → dear across the design's own band, so the colour means the price. */
const hopColor = (gold: number): THREE.Color => {
  const span = FAST_TRAVEL_MAX_GOLD - FAST_TRAVEL_MIN_GOLD;
  const t = span > 0 ? Math.min(1, Math.max(0, (gold - FAST_TRAVEL_MIN_GOLD) / span)) : 0;
  return new THREE.Color().setHSL(0.33 * (1 - t), 0.75, 0.55);
};

export interface TravelOverlayOptions {
  shrines: readonly Shrine[];
  hops: readonly TravelHop[];
  groundAt: (x: number, z: number) => number | null;
}

interface Owned {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

const markerGeometry = new THREE.ConeGeometry(1.4, 4, 5);

export const buildTravelOverlay = (options: TravelOverlayOptions): THREE.Group | null => {
  const group = new THREE.Group();
  const owned: Owned = { geometries: [], materials: [] };
  group.userData = { owned };
  let drawn = 0;

  for (const hop of options.hops) {
    const fromGround = options.groundAt(hop.from.x, hop.from.z);
    const toGround = options.groundAt(hop.to.x, hop.to.z);
    // Un-streamed ground: skip the line rather than draw it at sea level, the
    // same rule every other overlay here follows.
    if (fromGround === null || toGround === null) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(hop.from.x, fromGround + 3, hop.from.z),
      new THREE.Vector3(hop.to.x, toGround + 3, hop.to.z),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: hopColor(hop.gold),
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    owned.geometries.push(geometry);
    owned.materials.push(material);
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 9;
    group.add(line);
    drawn++;
  }

  // A spire on every shrine, greyed out when it is respawn-only — the marker
  // the Place tool draws says "interactable", not "this one is on the graph".
  for (const shrine of options.shrines) {
    const ground = options.groundAt(shrine.x, shrine.z);
    if (ground === null) continue;
    const material = new THREE.MeshBasicMaterial({
      color: shrine.onGraph ? 0x9fe8ff : OFF_GRAPH_COLOR,
      transparent: true,
      opacity: shrine.onGraph ? 0.9 : 0.5,
      depthTest: false,
    });
    owned.materials.push(material);
    const spire = new THREE.Mesh(markerGeometry, material);
    spire.position.set(shrine.x, ground + 4.5, shrine.z);
    spire.renderOrder = 9;
    spire.userData = { baseScale: [1, 1, 1] };
    group.add(spire);
    drawn++;
  }

  return drawn > 0 ? group : null;
};

export const disposeTravelOverlay = (group: THREE.Group): void => {
  const owned = (group.userData as { owned?: Owned }).owned;
  if (!owned) return;
  for (const geometry of owned.geometries) geometry.dispose();
  for (const material of owned.materials) material.dispose();
  owned.geometries.length = 0;
  owned.materials.length = 0;
};
