/**
 * Editing an existing zone polygon (A3-c · MAP_EDITOR.md §2.4).
 *
 * Drawing a zone is the easy half. The half the owner actually spends time in
 * is the one after: a coastline traced at 400 m turns out to cut a headland
 * off, and the fix is moving ONE corner — not re-tracing the whole ring and
 * losing the ambience they already tuned.
 *
 * Every operation here is a pure function on the ring, for two reasons. The
 * obvious one is testing. The real one is that a polygon edit can produce a
 * shape that LOOKS fine and is broken — drag a corner across the far edge and
 * the ring self-intersects, which makes `pointInPolygon` report that the zone
 * contains half of itself. That is a silent content bug (wrong fog, wrong
 * level band, discovery XP for the wrong ground), so every edit is checked
 * before it is allowed rather than after it ships.
 */

import * as THREE from 'three';
import { normalisePolygon, selfIntersects } from './zones.js';

export type Ring = readonly (readonly [number, number])[];
export type Edited = { polygon: [number, number][] } | { error: string };

const at = (point: readonly [number, number]): [number, number] => [
  Number(point[0].toFixed(2)),
  Number(point[1].toFixed(2)),
];

/** Move one corner. Refused when the result crosses itself. */
export const moveVertex = (polygon: Ring, index: number, x: number, z: number): Edited => {
  if (index < 0 || index >= polygon.length) return { error: 'no such corner' };
  const next = polygon.map((point, i) => (i === index ? at([x, z]) : at(point)));
  if (selfIntersects(next)) return { error: 'that corner would cross another edge' };
  return { polygon: next };
};

/**
 * Add a corner on the edge that starts at `edgeIndex` (its midpoint handle).
 * Splitting an edge cannot create a crossing, but it is checked anyway — the
 * click lands wherever the cursor is, not exactly on the midpoint.
 */
export const insertVertex = (polygon: Ring, edgeIndex: number, x: number, z: number): Edited => {
  if (edgeIndex < 0 || edgeIndex >= polygon.length) return { error: 'no such edge' };
  if (polygon.length >= 84) return { error: 'a zone tops out at 84 corners' };
  const next = polygon.map(at);
  next.splice(edgeIndex + 1, 0, at([x, z]));
  if (selfIntersects(next)) return { error: 'that corner would cross another edge' };
  return { polygon: next };
};

/** Remove a corner. A ring needs three; removing one can also cross the shape. */
export const deleteVertex = (polygon: Ring, index: number): Edited => {
  if (index < 0 || index >= polygon.length) return { error: 'no such corner' };
  if (polygon.length <= 3) return { error: 'a zone needs at least three corners' };
  const next = polygon.filter((_, i) => i !== index).map(at);
  if (selfIntersects(next)) return { error: 'removing that corner would cross the outline' };
  return { polygon: next };
};

/**
 * The ring as the game stores it, applied once when an edit is committed.
 *
 * Winding matters (`pointInPolygon` expects counter-clockwise) and dragging a
 * corner across the shape can flip it without ever self-intersecting — a
 * triangle turned inside out is still a valid triangle. Re-normalising can
 * reverse the array, which renumbers the handles; that is why it happens on
 * commit and not per pointer-move.
 */
export const finaliseRing = (polygon: Ring): [number, number][] => normalisePolygon(polygon);

/** Read a polygon off a stored zone def, or null when it is not one. */
export const polygonOf = (def: Record<string, unknown>): [number, number][] | null => {
  const raw = def.polygon;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: [number, number][] = [];
  for (const vertex of raw) {
    if (!Array.isArray(vertex) || vertex.length < 2) return null;
    const [x, z] = vertex as unknown[];
    if (typeof x !== 'number' || typeof z !== 'number') return null;
    out.push([x, z]);
  }
  return out;
};

// ---------------------------------------------------------------------------
// The handles in the viewport
// ---------------------------------------------------------------------------

export interface ZoneHandleHit {
  kind: 'vertex' | 'edge';
  index: number;
}

const CORNER_COLOR = 0x7fd4ff;
const EDGE_COLOR = 0x4a7fa8;

const cornerGeometry = new THREE.OctahedronGeometry(0.9);
const edgeGeometry = new THREE.OctahedronGeometry(0.55);

const cornerMaterial = new THREE.MeshBasicMaterial({ color: CORNER_COLOR, depthTest: false });
const edgeMaterial = new THREE.MeshBasicMaterial({
  color: EDGE_COLOR,
  depthTest: false,
  transparent: true,
  opacity: 0.75,
});

/**
 * A diamond on every corner and a smaller one on every edge midpoint.
 *
 * Rebuilt wholesale on every change rather than diffed: a zone is at most 84
 * corners, and a handle set that is a frame behind the polygon it edits is a
 * far worse bug than the one allocation it saves.
 */
export class ZoneHandles {
  readonly group = new THREE.Group();

  constructor() {
    this.group.renderOrder = 14;
    // Same `baseScale` contract the placement markers use, so the viewport's
    // per-frame rescale keeps handles clickable from map height.
    this.group.userData = { handles: true };
  }

  build(polygon: Ring, groundAt: (x: number, z: number) => number | null): void {
    this.clear();
    for (const [index, point] of polygon.entries()) {
      const next = polygon[(index + 1) % polygon.length]!;
      this.group.add(
        handle(cornerGeometry, cornerMaterial, point[0], point[1], groundAt, {
          kind: 'vertex',
          index,
        }),
      );
      this.group.add(
        handle(
          edgeGeometry,
          edgeMaterial,
          (point[0] + next[0]) / 2,
          (point[1] + next[1]) / 2,
          groundAt,
          { kind: 'edge', index },
        ),
      );
    }
  }

  clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * `?? 0` — unlike every placement marker here, a handle over unknown ground is
 * drawn at sea level rather than skipped. A zone corner is a position on the
 * world PLANE, not a thing standing on terrain: zones legitimately reach out
 * over open water, and a corner you can see but not grab is worse than one
 * floating at y=0. The same reasoning is why the zone tool's pointer pick falls
 * back to the plane.
 */
const handle = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  z: number,
  groundAt: (x: number, z: number) => number | null,
  hit: ZoneHandleHit,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, (groundAt(x, z) ?? 0) + 1.6, z);
  mesh.renderOrder = 14;
  mesh.userData = { handle: hit, baseScale: [1, 1, 1] };
  return mesh;
};
