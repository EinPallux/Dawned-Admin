/**
 * Editor cameras (MAP_EDITOR.md §1: fly, orbit, top-down, 1–9 slots).
 *
 * Two modes because two jobs: **orbit** to study a thing you are shaping (the
 * pivot is what you care about), **fly** to get somewhere (WASD + mouselook, the
 * only sane way to cross a 2 km island). Top-down is orbit locked to straight
 * down, which is how you lay out a coastline.
 *
 * The rig is deliberately not `OrbitControls`: the editor needs the pivot to
 * follow the terrain under the cursor on `F` (frame), needs fly speed to scale
 * with height, and needs to hand its whole state to a camera slot and back.
 */

import * as THREE from 'three';

export type CameraMode = 'orbit' | 'fly' | 'top';

/** Everything needed to restore a view — this is what a 1–9 slot stores. */
export interface CameraState {
  mode: CameraMode;
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
}

const MIN_PITCH = -Math.PI / 2 + 0.02;
const MAX_PITCH = Math.PI / 2 - 0.02;
const MIN_DISTANCE = 4;
const MAX_DISTANCE = 2200;

export class CameraRig {
  mode: CameraMode = 'orbit';
  readonly target = new THREE.Vector3(0, 0, 0);
  distance = 240;
  yaw = Math.PI * 0.25;
  pitch = -0.6;

  /** Held movement keys, fly mode only. */
  private readonly keys = new Set<string>();
  private lastFrameMs = performance.now();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.apply();
  }

  // --- input --------------------------------------------------------------

  orbit(deltaX: number, deltaY: number): void {
    if (this.mode === 'top') return;
    this.yaw -= deltaX * 0.005;
    this.pitch = clamp(this.pitch - deltaY * 0.005, MIN_PITCH, MAX_PITCH);
    this.apply();
  }

  /** Right-drag / middle-drag: slide the pivot in the camera's ground plane. */
  pan(deltaX: number, deltaY: number, viewportHeight: number): void {
    // Scale with distance so panning feels the same zoomed in and zoomed out.
    const scale = (this.distance * 1.2) / Math.max(1, viewportHeight);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.target.addScaledVector(right, -deltaX * scale);
    this.target.addScaledVector(forward, -deltaY * scale);
    this.apply();
  }

  zoom(delta: number): void {
    this.distance = clamp(this.distance * Math.exp(delta * 0.0016), MIN_DISTANCE, MAX_DISTANCE);
    this.apply();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'top') this.pitch = MIN_PITCH;
    this.apply();
  }

  keyDown(code: string): void {
    this.keys.add(code);
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  /** `F`: put the pivot on a world point and pull in to a readable distance. */
  frame(point: THREE.Vector3, distance = 60, pitch?: number): void {
    this.target.copy(point);
    this.distance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    if (pitch !== undefined) this.pitch = clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.apply();
  }

  // --- per-frame ----------------------------------------------------------

  /**
   * Fly movement. Speed scales with height above the pivot — crossing the
   * island at 400 m and nudging a rock at 6 m want speeds two orders of
   * magnitude apart, and a single constant makes one of them miserable.
   */
  update(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;
    if (this.mode !== 'fly' || this.keys.size === 0) return;

    const base = clamp(this.distance * 0.9, 8, 600);
    const speed = base * (this.keys.has('ShiftLeft') ? 3 : 1) * dt;
    const forward = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (this.keys.has('KeyW')) this.target.addScaledVector(forward, -speed);
    if (this.keys.has('KeyS')) this.target.addScaledVector(forward, speed);
    if (this.keys.has('KeyA')) this.target.addScaledVector(right, -speed);
    if (this.keys.has('KeyD')) this.target.addScaledVector(right, speed);
    if (this.keys.has('KeyE')) this.target.y += speed;
    if (this.keys.has('KeyQ')) this.target.y -= speed;
    this.apply();
  }

  // --- slots --------------------------------------------------------------

  save(): CameraState {
    return {
      mode: this.mode,
      target: [this.target.x, this.target.y, this.target.z],
      distance: this.distance,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  restore(state: CameraState): void {
    this.mode = state.mode;
    this.target.set(state.target[0], state.target[1], state.target[2]);
    this.distance = state.distance;
    this.yaw = state.yaw;
    this.pitch = state.pitch;
    this.apply();
  }

  private apply(): void {
    const cosPitch = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x - Math.sin(this.yaw) * cosPitch * this.distance,
      this.target.y - Math.sin(this.pitch) * this.distance,
      this.target.z - Math.cos(this.yaw) * cosPitch * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
