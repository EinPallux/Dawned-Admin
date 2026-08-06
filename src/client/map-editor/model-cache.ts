/**
 * Real models in the editor viewport.
 *
 * Until 2026-08-06 every placed object was drawn as a **coloured box** —
 * a building, a tree, a chest and a villager were all the same cube in a
 * different colour. That is the whole of the owner's "I was not able to see the
 * real map": the editor was a diagram of the world, not the world. (The game
 * had the mirror-image bug — it drew NPCs and interactables and skipped props
 * and scatter entirely — so the two surfaces genuinely never showed the same
 * thing.)
 *
 * This loads the SAME baked glTF files the game client loads, out of the same
 * manifest, so a house in the editor is the house that will stand there.
 *
 * Loading is lazy and asynchronous, and a placement is drawn as its box until
 * its model arrives — a viewport that waited would open blank on a slow box.
 * `onLoaded` lets the page redraw exactly the placements a newly-arrived model
 * affects rather than rebuilding the world on every file.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ManifestEntry {
  category?: string;
  file?: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}
interface Manifest {
  assets: Record<string, ManifestEntry>;
}

/** Categories a map placement can legitimately point at. */
const PLACEABLE = new Set(['world/props', 'world/nature', 'world/buildings']);

export interface AssetEntry {
  id: string;
  category: string;
  /** Rough metre height, for the picker's size hint. */
  height: number;
}

export class ModelCache {
  private manifest: Manifest | null = null;
  private readonly loaded = new Map<string, THREE.Object3D>();
  private readonly inFlight = new Set<string>();
  private readonly missing = new Set<string>();
  private readonly listeners = new Set<(ref: string) => void>();
  private readonly loader = new GLTFLoader();

  /** Fired when a model finishes loading, so its placements can be redrawn. */
  onLoaded(fn: (ref: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async init(): Promise<void> {
    if (this.manifest) return;
    try {
      const response = await fetch('/assets/manifest.json');
      this.manifest = (await response.json()) as Manifest;
    } catch {
      // The editor still works without models — it just draws boxes, which is
      // what it did for its whole life until now.
      this.manifest = { assets: {} };
      console.warn('[map-editor] no asset manifest — placements draw as markers');
    }
  }

  /** Everything a Place tool may stamp, for the asset picker. */
  placeable(): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const [id, entry] of Object.entries(this.manifest?.assets ?? {})) {
      if (!entry.category || !PLACEABLE.has(entry.category) || !entry.file) continue;
      const bounds = entry.bounds;
      const height = bounds ? Math.max(0.1, bounds.max[1] - bounds.min[1]) : 1;
      out.push({ id, category: entry.category, height });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * A clone of `ref` if it is loaded, else null — and start loading it.
   *
   * Returning null rather than a promise is deliberate: the caller builds a
   * marker synchronously and the model swaps in on the next redraw, so a
   * viewport pan never waits on a network fetch.
   */
  instance(ref: string): THREE.Object3D | null {
    const model = this.loaded.get(ref);
    if (model) return model.clone(true);
    void this.request(ref);
    return null;
  }

  /** True once we know this ref names nothing we can draw. */
  isMissing(ref: string): boolean {
    return this.missing.has(ref);
  }

  private async request(ref: string): Promise<void> {
    if (this.loaded.has(ref) || this.inFlight.has(ref) || this.missing.has(ref)) return;
    await this.init();
    const entry = this.manifest?.assets[ref];
    if (!entry?.file) {
      this.missing.add(ref);
      return;
    }
    this.inFlight.add(ref);
    try {
      const gltf = await this.loader.loadAsync(`/${entry.file}`);
      const scene = gltf.scene;
      // Shadows off: the editor is a workbench, and a hundred shadow-casting
      // buildings on a one-core box costs frames that aiming a brush needs.
      scene.traverse((child) => {
        child.castShadow = false;
        child.receiveShadow = false;
      });
      this.loaded.set(ref, scene);
      for (const fn of this.listeners) fn(ref);
    } catch (error) {
      this.missing.add(ref);
      console.warn(`[map-editor] failed to load ${ref}:`, error);
    } finally {
      this.inFlight.delete(ref);
    }
  }
}
