/**
 * Spawns-mode overlays (A3-b · MAP_EDITOR.md §2.3): aggro and leash rings,
 * camp links, and the ghosts of a simulated populate.
 *
 * These are the things you cannot judge from a list. A camp's numbers read
 * fine in a table and then two of them turn out to pull each other across a
 * ridge; a leash radius of 40 m sounds generous until you see it reaching into
 * the safe zone. Drawn to TRUE size for that reason — a ring that lies about
 * its metres is worse than no ring.
 *
 * Built as one detachable group so the mode can be switched off wholesale
 * rather than leaving rings over a terrain-sculpting session.
 */

import * as THREE from 'three';
import type { SpawnerDef } from '@dawned/shared';
import type { CampLink, EnemyFacts, SimulatedSpawn } from './spawn-analysis.js';

const RING_SEGMENTS = 48;

const ringGeometry = new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: RING_SEGMENTS + 1 }, (_, i) => {
    const angle = (i / RING_SEGMENTS) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  }),
);

const AGGRO_COLOR = 0xd8453a;
const LEASH_COLOR = 0xe8a13e;
const CAMP_COLOR = 0xffd479;
const GHOST_COLOR = 0xff9c8a;

const material = (color: number, opacity: number): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });

const ghostGeometry = new THREE.SphereGeometry(0.6, 8, 6);

/** What one overlay allocated, so teardown frees exactly that and no more. */
interface Disposables {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export interface SpawnOverlayOptions {
  spawners: readonly SpawnerDef[];
  enemiesById: ReadonlyMap<string, EnemyFacts>;
  links: readonly CampLink[];
  /** Simulated spawns to ghost in, if the owner asked for a preview. */
  ghosts: readonly SimulatedSpawn[];
  groundAt: (x: number, z: number) => number | null;
  show: { aggro: boolean; leash: boolean; camps: boolean };
}

/**
 * Build the whole overlay. Returns null when there is nothing to draw, so the
 * caller can skip adding an empty group to the scene.
 */
export const buildSpawnOverlay = (options: SpawnOverlayOptions): THREE.Group | null => {
  const group = new THREE.Group();
  const owned: Disposables = { geometries: [], materials: [] };
  group.userData = { owned };
  let drawn = 0;

  const aggroMaterial = material(AGGRO_COLOR, 0.55);
  const leashMaterial = material(LEASH_COLOR, 0.35);
  owned.materials.push(aggroMaterial, leashMaterial);

  for (const spawner of options.spawners) {
    const ground = options.groundAt(spawner.x, spawner.z);
    // Un-streamed terrain: skip rather than draw at zero. A ring floating at
    // sea level under a hill is a lie about where the camp is.
    if (ground === null) continue;

    // The widest reach among the enemies this spawner actually rolls — that is
    // what a player walking past will feel, not the average.
    let aggro = 0;
    let leash = 0;
    for (const entry of spawner.entries) {
      const facts = options.enemiesById.get(entry.enemyId);
      if (!facts) continue;
      aggro = Math.max(aggro, facts.aggroRadius);
      leash = Math.max(leash, facts.leashRadius);
    }

    if (options.show.aggro && aggro > 0) {
      group.add(ringAt(spawner.x, ground + 0.4, spawner.z, spawner.radius + aggro, aggroMaterial));
      drawn++;
    }
    if (options.show.leash && leash > 0) {
      group.add(ringAt(spawner.x, ground + 0.3, spawner.z, spawner.radius + leash, leashMaterial));
      drawn++;
    }
  }

  // Camp links: a line from the group's centre to each member, so a tag that
  // spans a ridge reads instantly as one shape rather than two camps.
  if (options.show.camps) {
    const campMaterial = material(CAMP_COLOR, 0.8);
    owned.materials.push(campMaterial);
    const byId = new Map(options.spawners.map((spawner) => [spawner.id, spawner]));
    for (const link of options.links) {
      const centreGround = options.groundAt(link.centre.x, link.centre.z);
      if (centreGround === null) continue;
      const points: THREE.Vector3[] = [];
      for (const id of link.spawnerIds) {
        const spawner = byId.get(id);
        if (!spawner) continue;
        const ground = options.groundAt(spawner.x, spawner.z);
        if (ground === null) continue;
        points.push(new THREE.Vector3(link.centre.x, centreGround + 2, link.centre.z));
        points.push(new THREE.Vector3(spawner.x, ground + 2, spawner.z));
      }
      if (points.length < 2) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      owned.geometries.push(geometry);
      const line = new THREE.LineSegments(geometry, campMaterial);
      line.renderOrder = 8;
      group.add(line);
      drawn++;
    }
  }

  // Simulated spawns: where the bodies would actually stand.
  if (options.ghosts.length > 0) {
    const ghostMaterial = new THREE.MeshBasicMaterial({
      color: GHOST_COLOR,
      transparent: true,
      opacity: 0.75,
    });
    owned.materials.push(ghostMaterial);
    for (const ghost of options.ghosts) {
      const ground = options.groundAt(ghost.x, ghost.z);
      if (ground === null) continue;
      const mesh = new THREE.Mesh(ghostGeometry, ghostMaterial);
      mesh.position.set(ghost.x, ground + 0.9, ghost.z);
      group.add(mesh);
      drawn++;
    }
  }

  return drawn > 0 ? group : null;
};

const ringAt = (
  x: number,
  y: number,
  z: number,
  radius: number,
  lineMaterial: THREE.Material,
): THREE.Line => {
  const ring = new THREE.Line(ringGeometry, lineMaterial);
  ring.position.set(x, y, z);
  ring.scale.set(radius, 1, radius);
  ring.renderOrder = 7;
  return ring;
};

/**
 * Free everything the overlay allocated.
 *
 * Reads the list the BUILDER recorded rather than walking the scene graph and
 * guessing what is disposable: the builder knows exactly which geometries and
 * materials are its own, and the shared ring/ghost geometries must survive.
 */
export const disposeSpawnOverlay = (group: THREE.Group): void => {
  const owned = (group.userData as { owned?: Disposables }).owned;
  if (!owned) return;
  for (const geometry of owned.geometries) geometry.dispose();
  for (const item of owned.materials) item.dispose();
  owned.geometries.length = 0;
  owned.materials.length = 0;
};
