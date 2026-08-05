/**
 * Zone authoring (A3-c · MAP_EDITOR.md §2.4).
 *
 * Zones are the one placed thing with no position: a polygon over the world
 * plane. That makes them the odd one out for every tool here — you draw them
 * vertex by vertex rather than stamping them, and the thing you are judging is
 * a SHAPE against the coastline under it.
 *
 * They are also the piece that gates publishing: `validateDraft` blocks on land
 * that belongs to no zone, so sculpting a new islet and publishing it is
 * impossible until one is drawn over it. That is why this is the A3 slice worth
 * having before the prettier ones.
 */

import * as THREE from 'three';
import { zoneAmbienceSchema, type ZoneAmbience } from '@dawned/shared';

/**
 * Ambience for a new zone: the shipped Dawnshore-ish daylight, so a fresh zone
 * looks like the world rather than a black void the owner has to fix before
 * they can judge anything.
 */
export const DEFAULT_AMBIENCE: ZoneAmbience = zoneAmbienceSchema.parse({
  fogColor: '#cfe3ff',
  fogNear: 60,
  fogFar: 420,
  skyTop: '#4a7fd0',
  skyHorizon: '#ffd9a8',
  sunColor: '#fff2d8',
  sunIntensity: 2.2,
  hemiSky: '#dce8ff',
  hemiGround: '#3a4a3a',
  hemiIntensity: 0.9,
});

/** Signed area × 2 on the (x, z) plane; negative means clockwise. */
export const polygonArea2 = (polygon: readonly (readonly [number, number])[]): number => {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j]![0] - polygon[i]![0]) * (polygon[j]![1] + polygon[i]![1]);
  }
  return sum;
};

/**
 * Do two segments of the ring cross? Checked as the owner draws, because a
 * self-intersecting polygon passes the schema (it is still ≥3 points) and then
 * behaves unpredictably in `pointInPolygon` — a bow-tie zone contains half of
 * itself, which is a bug nobody would ever guess from looking at the list.
 */
export const selfIntersects = (polygon: readonly (readonly [number, number])[]): boolean => {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent segments (they share a vertex by construction).
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
};

type Point = readonly [number, number];

const cross = (o: Point, a: Point, b: Point): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const segmentsCross = (a1: Point, a2: Point, b1: Point, b2: Point): boolean => {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

/**
 * The polygon the game expects: counter-clockwise on the (x, z) plane (the
 * `zoneSchema` comment), with duplicate consecutive points dropped. The editor
 * accepts either winding from the owner's hand and normalises here rather than
 * making them care.
 *
 * The sign convention matters and was wrong once: `polygonArea2` is the
 * shoelace variant whose POSITIVE result means counter-clockwise here, which is
 * what all three shipped zones are. Reversing on positive — the first version
 * of this — flipped every zone drawn in the editor away from the convention the
 * live world uses. Nothing at runtime noticed (`pointInPolygon` is an even-odd
 * ray cast, blind to winding), which is exactly why it is pinned by a test
 * against a known-good ring rather than left to "both hands agree".
 */
export const normalisePolygon = (points: readonly Point[]): [number, number][] => {
  const cleaned: [number, number][] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 0.05 && Math.abs(last[1] - point[1]) < 0.05) {
      continue;
    }
    cleaned.push([Number(point[0].toFixed(2)), Number(point[1].toFixed(2))]);
  }
  return polygonArea2(cleaned) < 0 ? cleaned.reverse() : cleaned;
};

/** Problems worth telling the owner about BEFORE they save the zone. */
export const zoneDrawProblems = (points: readonly Point[]): string[] => {
  const problems: string[] = [];
  if (points.length < 3) problems.push('a zone needs at least three corners');
  if (selfIntersects(points)) problems.push('the outline crosses itself');
  if (points.length >= 3 && Math.abs(polygonArea2(points)) < 8) {
    problems.push('the outline encloses almost no ground');
  }
  return problems;
};

// ---------------------------------------------------------------------------
// The in-progress outline, drawn as the owner clicks
// ---------------------------------------------------------------------------

export class ZoneSketch {
  readonly points: [number, number][] = [];
  readonly line: THREE.Line;
  private readonly positions = new Float32Array(3 * 256);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: '#7fd4ff', depthTest: false }),
    );
    this.line.renderOrder = 12;
    this.line.visible = false;
  }

  get length(): number {
    return this.points.length;
  }

  add(x: number, z: number): void {
    if (this.points.length >= 84) return; // the wire limit, with room to close
    this.points.push([x, z]);
  }

  undoPoint(): void {
    this.points.pop();
  }

  clear(): void {
    this.points.length = 0;
    this.line.visible = false;
    this.line.geometry.setDrawRange(0, 0);
  }

  /**
   * Redraw the outline, riding the terrain so it reads as a border on the
   * ground rather than a shape floating over it. `hover` is the cursor, drawn
   * as the segment that would be added next.
   */
  refresh(groundAt: (x: number, z: number) => number | null, hover: THREE.Vector3 | null): void {
    const drawn: [number, number][] = [...this.points];
    if (hover) drawn.push([hover.x, hover.z]);
    if (drawn.length < 2) {
      this.line.visible = false;
      this.line.geometry.setDrawRange(0, 0);
      return;
    }
    // Close the loop visually once there is a shape to close.
    if (drawn.length >= 3) drawn.push(drawn[0]!);
    for (const [index, point] of drawn.entries()) {
      this.positions[index * 3] = point[0];
      this.positions[index * 3 + 1] = (groundAt(point[0], point[1]) ?? 0) + 1.5;
      this.positions[index * 3 + 2] = point[1];
    }
    const attribute = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.line.geometry.setDrawRange(0, drawn.length);
    this.line.geometry.computeBoundingSphere();
    this.line.visible = true;
  }
}

// ---------------------------------------------------------------------------
// Live ambience preview
// ---------------------------------------------------------------------------

/**
 * Apply a zone's ambience to the editor scene, or restore the editor's own
 * lighting when `ambience` is null.
 *
 * MAP_EDITOR.md §2.4 asks for "instant viewport preview" and it earns its keep:
 * fog values read as numbers and land as atmosphere, and the only way to know
 * whether 420 m of fog feels right is to stand in it. The editor's flat working
 * light is restored the moment the preview is off, because sculpting under a
 * zone's moody dusk hides the shape you are working on.
 */
export interface AmbienceTargets {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

export const applyAmbiencePreview = (
  targets: AmbienceTargets,
  ambience: ZoneAmbience | null,
  editorDefault: { sun: number; hemi: number },
): void => {
  if (!ambience) {
    targets.scene.fog = null;
    targets.scene.background = null;
    targets.sun.color.set('#fff3e0');
    targets.sun.intensity = editorDefault.sun;
    targets.hemi.color.set('#dce8ff');
    targets.hemi.groundColor.set('#3a4a3a');
    targets.hemi.intensity = editorDefault.hemi;
    return;
  }
  targets.scene.fog = new THREE.Fog(ambience.fogColor, ambience.fogNear, ambience.fogFar);
  targets.scene.background = new THREE.Color(ambience.skyHorizon);
  targets.sun.color.set(ambience.sunColor);
  targets.sun.intensity = ambience.sunIntensity;
  targets.hemi.color.set(ambience.hemiSky);
  targets.hemi.groundColor.set(ambience.hemiGround);
  targets.hemi.intensity = ambience.hemiIntensity;
};
