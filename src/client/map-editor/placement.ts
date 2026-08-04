/**
 * Placement objects in the viewport (A3 · MAP_EDITOR.md §2.2–§2.4).
 *
 * Everything that STANDS on the terrain — props, spawners, resource nodes,
 * NPCs, POIs, interactables, zone polygons — draws through here. The editor
 * does not load the game's GLB models: the point of this layer is to see WHERE
 * things are and WHAT they are, at a glance, over a whole island. A shaded box
 * with the right footprint and a colour that says "spawner" is more useful at
 * 300 m than the real mushroom would be, and it costs nothing to draw a
 * thousand of them.
 *
 * Rings and polygons ARE drawn to true size, because those are the numbers the
 * owner is actually deciding: a spawner's radius, a POI's discovery ring, a
 * zone's border.
 */

import * as THREE from 'three';
import { CHUNK_SIZE_M } from '@dawned/shared';

/** One colour per layer, so a glance says what kind of thing you are looking at. */
export const FALLBACK_COLOR = 0x999999;

export const LAYER_COLOR: Record<string, number> = {
  prop: 0xc9a34e,
  scatter: 0x6ec46e,
  spawner: 0xd8453a,
  node: 0x7fd4ff,
  npc: 0xe8a13e,
  zone: 0x3e8fe8,
  poi: 0xb46ce8,
  interactable: 0x57c77b,
};

const RING_SEGMENTS = 48;

const ringGeometry = new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: RING_SEGMENTS + 1 }, (_, i) => {
    const angle = (i / RING_SEGMENTS) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  }),
);

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
boxGeometry.translate(0, 0.5, 0); // sit on the ground rather than straddle it

const materialCache = new Map<string, THREE.Material>();
const solidMaterial = (layer: string, selected: boolean): THREE.Material => {
  const key = `${layer}:${selected ? 'sel' : 'plain'}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshLambertMaterial({
    color: LAYER_COLOR[layer] ?? FALLBACK_COLOR,
    emissive: selected ? 0x333333 : 0x000000,
    transparent: true,
    opacity: selected ? 1 : 0.9,
  });
  materialCache.set(key, material);
  return material;
};

const lineMaterial = (layer: string, selected: boolean): THREE.Material => {
  const key = `line:${layer}:${selected ? 'sel' : 'plain'}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.LineBasicMaterial({
    color: LAYER_COLOR[layer] ?? FALLBACK_COLOR,
    transparent: true,
    opacity: selected ? 1 : 0.65,
    depthTest: false,
  });
  materialCache.set(key, material);
  return material;
};

export interface PlacedObject {
  id: string;
  layer: string;
  def: Record<string, unknown>;
  x: number | null;
  z: number | null;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Build the viewport representation of one object.
 *
 * `groundAt` answers null for terrain that is not loaded — and the object is
 * then NOT drawn rather than drawn at zero. Seating a marker on ground that has
 * not arrived is the P8 vendor bug (`OCEAN_FLOOR_Y` read as real ground), and
 * it looks exactly like a prop that fell into the sea.
 */
export const buildObjectView = (
  object: PlacedObject,
  groundAt: (x: number, z: number) => number | null,
  selected: boolean,
): THREE.Object3D | null => {
  if (object.layer === 'zone') return buildZoneView(object, groundAt, selected);
  if (object.layer === 'scatter') return buildScatterView(object, groundAt);

  const x = object.x;
  const z = object.z;
  if (x === null || z === null) return null;
  const ground = groundAt(x, z);
  if (ground === null) return null;

  const group = new THREE.Group();
  group.position.set(x, ground, z);
  group.userData = { objectId: object.id, layer: object.layer };

  // The marker. Props get their authored scale; everything else gets a size
  // that reads at map scale, because a spawner has no model to be true to.
  const marker = new THREE.Mesh(boxGeometry, solidMaterial(object.layer, selected));
  const scale = object.layer === 'prop' ? num(object.def.scale, 1) : 1;
  marker.scale.set(1.2 * scale, 2.4 * scale, 1.2 * scale);
  marker.position.y = num(object.def.yOffset, 0);
  marker.rotation.y = num(object.def.rotation, 0);
  group.add(marker);

  // Rings: the numbers the owner is actually choosing.
  const radius = ringRadiusFor(object);
  if (radius > 0) {
    const ring = new THREE.Line(ringGeometry, lineMaterial(object.layer, selected));
    ring.scale.set(radius, 1, radius);
    ring.position.y = 0.25;
    ring.renderOrder = 5;
    group.add(ring);
  }
  return group;
};

/** Which radius, if any, this object wants drawn on the ground. */
const ringRadiusFor = (object: PlacedObject): number => {
  switch (object.layer) {
    case 'spawner':
      return num(object.def.radius, 0);
    case 'poi':
      return num(object.def.radius, 12);
    case 'prop':
      return object.def.solid === true ? num(object.def.radius, 0) : 0;
    default:
      return 0;
  }
};

/**
 * A zone as its polygon, drawn on the terrain it covers. Closed explicitly —
 * an unclosed loop reads as a broken polygon, which is exactly the mistake this
 * view exists to make visible.
 */
const buildZoneView = (
  object: PlacedObject,
  groundAt: (x: number, z: number) => number | null,
  selected: boolean,
): THREE.Object3D | null => {
  const polygon = object.def.polygon;
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const points: THREE.Vector3[] = [];
  for (const vertex of polygon) {
    if (!Array.isArray(vertex) || vertex.length < 2) continue;
    const x = num(vertex[0], 0);
    const z = num(vertex[1], 0);
    points.push(new THREE.Vector3(x, (groundAt(x, z) ?? 0) + 1.2, z));
  }
  if (points.length < 3) return null;
  points.push(points[0]!.clone());
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    lineMaterial('zone', selected),
  );
  line.renderOrder = 6;
  line.userData = { objectId: object.id, layer: 'zone' };
  return line;
};

/**
 * A scatter patch as a translucent tile per painted density cell — the 16×16
 * grid the format actually stores, at the opacity the density says. Drawing
 * resolved instances would be prettier and a lie: the owner is painting a
 * density map, and this is what a density map looks like.
 */
const buildScatterView = (
  object: PlacedObject,
  groundAt: (x: number, z: number) => number | null,
): THREE.Object3D | null => {
  const density = object.def.density;
  const cx = num(object.def.cx, -1);
  const cy = num(object.def.cy, -1);
  if (!Array.isArray(density) || cx < 0 || cy < 0) return null;
  const cell = CHUNK_SIZE_M / 16;
  const baseX = -1024 + cx * CHUNK_SIZE_M;
  const baseZ = -1024 + cy * CHUNK_SIZE_M;
  const group = new THREE.Group();
  group.userData = { objectId: object.id, layer: 'scatter' };
  const geometry = new THREE.PlaneGeometry(cell * 0.9, cell * 0.9);
  geometry.rotateX(-Math.PI / 2);
  let drawn = 0;
  for (let iz = 0; iz < 16; iz++) {
    for (let ix = 0; ix < 16; ix++) {
      const value = num(density[iz * 16 + ix], 0);
      if (value <= 0) continue;
      const x = baseX + (ix + 0.5) * cell;
      const z = baseZ + (iz + 0.5) * cell;
      const ground = groundAt(x, z);
      if (ground === null) continue;
      const tile = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: LAYER_COLOR.scatter ?? FALLBACK_COLOR,
          transparent: true,
          opacity: 0.12 + (value / 255) * 0.5,
          depthWrite: false,
        }),
      );
      tile.position.set(x, ground + 0.3, z);
      group.add(tile);
      drawn++;
    }
  }
  return drawn > 0 ? group : null;
};

/** Free the geometries a view owns (materials are cached and shared). */
export const disposeObjectView = (view: THREE.Object3D): void => {
  view.traverse((child) => {
    // The two module-level geometries are reused by every marker in the scene;
    // disposing one would blank every other object at once. Only the geometries
    // built per object (zone outlines, scatter tiles) are ours to free.
    const geometry = geometryOf(child);
    if (!geometry || geometry === boxGeometry || geometry === ringGeometry) return;
    geometry.dispose();
  });
};

/** `Object3D` has no geometry; three's Line/Mesh generics widen it to `any`. */
const geometryOf = (child: THREE.Object3D): THREE.BufferGeometry | null => {
  const candidate: unknown = (child as { geometry?: unknown }).geometry;
  return candidate instanceof THREE.BufferGeometry ? candidate : null;
};
