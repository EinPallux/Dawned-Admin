/**
 * The editor's in-memory half of the draft (MAP_EDITOR.md §3).
 *
 * The world is 1024 chunks; the editor holds the region around the camera and
 * pushes what changed. Three responsibilities, kept together because they are
 * one idea — "what is loaded, what is dirty, when does it get saved":
 *
 *  1. **Load a region** once and keep it. Re-entering an area must not re-fetch.
 *  2. **Mark dirty per chunk.** A brush stroke touching four chunks marks four.
 *  3. **Autosave 2 s after idle** — during a stroke nothing is sent, because a
 *     save per mousemove would put hundreds of 25 kB bodies on a 1-core VPS.
 *
 * Crash recovery is what the server's draft rows ARE: everything saved is
 * durable, so a closed tab loses at most the last two seconds.
 */

import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  OCEAN_FLOOR_Y,
  WORLD_CHUNKS,
  WORLD_ORIGIN_M,
  baseSplat,
  chunkIndexOf,
} from '@dawned/shared';
import { apiGet, apiPut } from '../api.js';

const AUTOSAVE_IDLE_MS = 2000;

/** The chunk PUT accepts 64 rows a call (`map-routes.ts`). */
const SAVE_BATCH = 64;

export interface EditorChunk {
  cx: number;
  cy: number;
  heights: Float32Array;
  splat: Uint8Array;
  waterLevel: number | null;
  enabled: boolean;
}

interface ChunkWire {
  cx: number;
  cy: number;
  heights: string;
  splat: string;
  waterLevel: number | null;
  enabled: boolean;
}

export interface MapObject {
  id: string;
  layer: string;
  def: Record<string, unknown>;
  x: number | null;
  z: number | null;
}

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) on a 17 kB array blows the argument
  // limit in some browsers, and this runs on every autosave.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};

const toWire = (chunk: EditorChunk): ChunkWire => ({
  cx: chunk.cx,
  cy: chunk.cy,
  heights: encodeBase64(
    new Uint8Array(chunk.heights.buffer, chunk.heights.byteOffset, chunk.heights.byteLength),
  ),
  splat: encodeBase64(chunk.splat),
  waterLevel: chunk.waterLevel,
  enabled: chunk.enabled,
});

const fromWire = (wire: ChunkWire): EditorChunk => {
  const heightBytes = decodeBase64(wire.heights);
  return {
    cx: wire.cx,
    cy: wire.cy,
    heights: new Float32Array(
      heightBytes.buffer.slice(
        heightBytes.byteOffset,
        heightBytes.byteOffset + heightBytes.byteLength,
      ),
    ),
    splat: decodeBase64(wire.splat),
    waterLevel: wire.waterLevel,
    enabled: wire.enabled,
  };
};

export const emptyEditorChunk = (cx: number, cy: number, floor = OCEAN_FLOOR_Y): EditorChunk => ({
  cx,
  cy,
  heights: new Float32Array(CHUNK_VERTS * CHUNK_VERTS).fill(floor),
  splat: baseSplat(0),
  waterLevel: null,
  enabled: false,
});

export interface StoreEvents {
  /** A chunk's bytes changed and the viewport should rebuild it. */
  onChunkChanged: (chunk: EditorChunk) => void;
  /** Save state for the status bar: 'clean' | 'dirty' | 'saving' | 'error'. */
  onSaveState: (state: SaveState, detail?: string) => void;
  onObjectsChanged?: () => void;
}

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error';

export class DraftStore {
  private readonly chunks = new Map<string, EditorChunk>();
  /** Chunk keys already fetched — tracked per chunk, not per rectangle, so a
   * growing view re-fetches only the new ring. */
  private readonly loaded = new Set<string>();
  private readonly dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  /** The region fetch currently in flight, if any. */
  private loading: Promise<void> | null = null;
  objects: MapObject[] = [];

  constructor(private readonly events: StoreEvents) {}

  key(cx: number, cy: number): string {
    return `${cx}_${cy}`;
  }

  get(cx: number, cy: number): EditorChunk | null {
    return this.chunks.get(this.key(cx, cy)) ?? null;
  }

  /** Every loaded chunk — the viewport iterates this on an overlay change. */
  all(): EditorChunk[] {
    return [...this.chunks.values()];
  }

  get dirtyCount(): number {
    return this.dirty.size;
  }

  /**
   * Height under a world position, sampled bilinearly like the game's terrain.
   * Returns null when the chunk is not loaded or not enabled — "no data" and
   * "sea floor" must stay distinguishable (the P8 bug that hid every vendor).
   */
  heightAt(x: number, z: number): number | null {
    const cx = chunkIndexOf(x);
    const cy = chunkIndexOf(z);
    const chunk = this.get(cx, cy);
    if (!chunk?.enabled) return null;
    const localX = x - (WORLD_ORIGIN_M + cx * CHUNK_SIZE_M);
    const localZ = z - (WORLD_ORIGIN_M + cy * CHUNK_SIZE_M);
    const spacing = CHUNK_SIZE_M / (CHUNK_VERTS - 1);
    const fx = Math.min(CHUNK_VERTS - 1.001, Math.max(0, localX / spacing));
    const fz = Math.min(CHUNK_VERTS - 1.001, Math.max(0, localZ / spacing));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (gx: number, gz: number): number => chunk.heights[gz * CHUNK_VERTS + gx]!;
    const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx;
    const bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
    return top + (bottom - top) * tz;
  }

  // --- loading --------------------------------------------------------------

  /**
   * Fetch a chunk rectangle, skipping whatever is already resident.
   *
   * Resident chunks are kept as they are rather than overwritten: they may
   * carry edits that have not autosaved yet, and clobbering them with the
   * server's copy would silently eat the owner's last two seconds of work.
   */
  async loadRegion(minCx: number, minCy: number, maxCx: number, maxCy: number): Promise<void> {
    // One region request at a time. The camera-follow poll fires every 700 ms,
    // and a 17×17 region is megabytes — without this, panning while a load is
    // in flight stacks identical requests until the tab stops responding.
    if (this.loading) return this.loading;
    const clampCx = (v: number) => Math.min(WORLD_CHUNKS - 1, Math.max(0, v));
    const region = {
      minCx: clampCx(minCx),
      minCy: clampCx(minCy),
      maxCx: clampCx(maxCx),
      maxCy: clampCx(maxCy),
    };
    // Anything missing? A pan inside an already-loaded area must not re-fetch.
    let missing = false;
    for (let cy = region.minCy; cy <= region.maxCy && !missing; cy++) {
      for (let cx = region.minCx; cx <= region.maxCx; cx++) {
        if (!this.loaded.has(this.key(cx, cy))) {
          missing = true;
          break;
        }
      }
    }
    if (!missing) return;
    this.loading = this.fetchRegion(region).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async fetchRegion(region: {
    minCx: number;
    minCy: number;
    maxCx: number;
    maxCy: number;
  }): Promise<void> {
    const query = new URLSearchParams(
      Object.entries(region).map(([k, v]) => [k, String(v)]),
    ).toString();
    const data = await apiGet<{ chunks: ChunkWire[] }>(`/map/chunks?${query}`);
    for (const wire of data.chunks) {
      if (this.loaded.has(this.key(wire.cx, wire.cy))) continue;
      const chunk = fromWire(wire);
      this.chunks.set(this.key(chunk.cx, chunk.cy), chunk);
      this.loaded.add(this.key(chunk.cx, chunk.cy));
      this.events.onChunkChanged(chunk);
    }
    // Chunks with no row are legitimate: unbaked ocean the owner can enable.
    for (let cy = region.minCy; cy <= region.maxCy; cy++) {
      for (let cx = region.minCx; cx <= region.maxCx; cx++) {
        if (this.loaded.has(this.key(cx, cy))) continue;
        const chunk = emptyEditorChunk(cx, cy);
        this.chunks.set(this.key(cx, cy), chunk);
        this.loaded.add(this.key(cx, cy));
        this.events.onChunkChanged(chunk);
      }
    }
  }

  async loadObjects(): Promise<void> {
    const data = await apiGet<{ objects: MapObject[] }>('/map/objects');
    this.objects = data.objects;
    this.events.onObjectsChanged?.();
  }

  /** Drop everything (used after an import — the draft is a different world). */
  reset(): void {
    this.chunks.clear();
    this.loaded.clear();
    this.dirty.clear();
  }

  // --- mutation -------------------------------------------------------------

  /**
   * Mark a chunk changed. The viewport rebuild happens here so no tool can
   * forget it, and the autosave timer restarts so a continuous stroke saves
   * once at the end rather than 200 times during.
   */
  markDirty(chunk: EditorChunk): void {
    this.chunks.set(this.key(chunk.cx, chunk.cy), chunk);
    this.dirty.add(this.key(chunk.cx, chunk.cy));
    this.events.onChunkChanged(chunk);
    this.events.onSaveState('dirty');
    this.scheduleSave();
  }

  /** Bare `setTimeout`, not `window.setTimeout`: identical in the browser, and
   * it lets the autosave rules be tested outside a DOM. */
  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, AUTOSAVE_IDLE_MS);
  }

  /** Push every dirty chunk. Safe to call directly (Ctrl+S) or on the timer. */
  async flush(): Promise<void> {
    // A save already in flight: re-arm rather than drop this one. Returning
    // here without rescheduling loses every chunk dirtied during the previous
    // save — the editor keeps saying "Unsaved changes" and the work is only
    // written if the owner happens to edit again. Found by a slow test run,
    // which is the only place the two ever overlapped.
    if (this.saving) {
      this.scheduleSave();
      return;
    }
    if (this.dirty.size === 0) return;
    this.saving = true;
    const batch = [...this.dirty];
    this.dirty.clear();
    this.events.onSaveState('saving');
    try {
      const chunks = batch
        .map((key) => this.chunks.get(key))
        .filter((chunk): chunk is EditorChunk => chunk !== undefined)
        .map(toWire);
      // The endpoint takes 64 chunks a call, and a generator dirties hundreds
      // at once — sending them in one body is a 400 the editor would then
      // report as a permanent save failure.
      for (let at = 0; at < chunks.length; at += SAVE_BATCH) {
        await apiPut('/map/chunks', { chunks: chunks.slice(at, at + SAVE_BATCH) });
      }
      if (this.dirty.size > 0) {
        // Dirtied while we were saving — settle it rather than sit on it.
        this.events.onSaveState('dirty');
        this.scheduleSave();
      } else {
        this.events.onSaveState('clean');
      }
    } catch (error) {
      // Put them back: an unsaved change must not be silently forgotten, and
      // the retry is scheduled rather than waiting on the owner's next stroke.
      for (const key of batch) this.dirty.add(key);
      this.events.onSaveState('error', error instanceof Error ? error.message : 'save failed');
      this.scheduleSave();
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
  }
}
