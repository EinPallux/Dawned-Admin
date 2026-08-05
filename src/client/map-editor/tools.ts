/**
 * Terrain tools (A2-d · MAP_EDITOR.md §2.1) and the undo journal (§3).
 *
 * The MATH is not here — it is in `@dawned/shared` (`applyBrushToChunk`,
 * `applySplatToChunk`), which the bake and the game also read. This module is
 * the editor-side half: turn a drag into dabs, work out which chunks a dab
 * touches (including both sides of a seam), snapshot for undo, and mark dirty.
 *
 * ## Undo
 *
 * Command-pattern with byte snapshots rather than inverse operations. A brush
 * dab is not invertible in general (Smooth and Flatten both destroy the
 * information you would need), and a 65×65 Float32Array is 17 kB — 200 steps of
 * a 4-chunk stroke is ~13 MB worst case, which is a fine price for an undo that
 * cannot be subtly wrong. Strokes GROUP: everything between mousedown and
 * mouseup is one entry, because undoing a coastline one dab at a time is not
 * undo, it is punishment.
 */

import {
  BrushFalloff,
  BrushKind,
  applyBrushToChunk,
  applySplatToChunk,
  chunksTouchedBy,
  type BrushStroke,
  type SplatStroke,
} from '@dawned/shared';
import type { DraftStore, EditorChunk } from './draft-store.js';

export interface BrushSettings {
  kind: BrushKind;
  radius: number;
  strength: number;
  falloff: BrushFalloff;
  /** Flatten/SetHeight target, Terrace step. */
  target: number;
}

export interface PaintSettings {
  layer: number;
  radius: number;
  strength: number;
  falloff: BrushFalloff;
  slopeMin: number;
  slopeMax: number;
  heightMin: number;
  heightMax: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  kind: BrushKind.Raise,
  radius: 12,
  strength: 6,
  falloff: BrushFalloff.Smooth,
  target: 0,
};

export const DEFAULT_PAINT: PaintSettings = {
  layer: 1,
  radius: 10,
  strength: 1,
  falloff: BrushFalloff.Smooth,
  slopeMin: 0,
  slopeMax: 90,
  heightMin: -200,
  heightMax: 400,
};

/**
 * Wall-clock between dabs, so a stroke covers the same ground on a 30 Hz laptop
 * and a 144 Hz desktop — every brush is expressed in units per SECOND, not per
 * event. Lives here rather than in the component because reading a clock is a
 * side effect, and the editor's React layer must stay pure.
 */
export class StrokeClock {
  private lastMs = 0;

  start(): void {
    this.lastMs = performance.now();
  }

  /** Seconds since the previous dab, clamped so a stall cannot gouge a crater. */
  tick(): number {
    const now = performance.now();
    const dt = this.lastMs === 0 ? 0.016 : (now - this.lastMs) / 1000;
    this.lastMs = now;
    return Math.min(0.1, Math.max(0.008, dt));
  }
}

// ---------------------------------------------------------------------------
// Undo journal
// ---------------------------------------------------------------------------

interface ChunkSnapshot {
  cx: number;
  cy: number;
  heights: Float32Array;
  splat: Uint8Array;
  waterLevel: number | null;
  enabled: boolean;
}

export interface JournalEntry {
  label: string;
  before: ChunkSnapshot[];
  after: ChunkSnapshot[];
}

const snapshot = (chunk: EditorChunk): ChunkSnapshot => ({
  cx: chunk.cx,
  cy: chunk.cy,
  heights: chunk.heights.slice(),
  splat: chunk.splat.slice(),
  waterLevel: chunk.waterLevel,
  enabled: chunk.enabled,
});

/** MAP_EDITOR.md §3 asks for ≥200 steps. */
const MAX_ENTRIES = 220;

export class UndoJournal {
  private readonly entries: JournalEntry[] = [];
  /** Index of the next undo; everything at or above `cursor` is redoable. */
  private cursor = 0;
  private pending: Map<string, ChunkSnapshot> | null = null;
  private pendingLabel = '';

  constructor(private readonly onChanged: () => void) {}

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  get depth(): number {
    return this.entries.length;
  }

  /** Label of the step Ctrl+Z would undo — the history panel reads this. */
  get undoLabel(): string | null {
    return this.cursor > 0 ? this.entries[this.cursor - 1]!.label : null;
  }

  /** Open a group. Everything captured until `commit` is one undo step. */
  begin(label: string): void {
    this.pending = new Map();
    this.pendingLabel = label;
  }

  /**
   * Record a chunk's PRE-EDIT bytes. Called before each dab; only the first
   * call per chunk in a group sticks, which is what makes a 200-dab stroke cost
   * one snapshot per touched chunk rather than 200.
   */
  capture(chunk: EditorChunk): void {
    if (!this.pending) return;
    const key = `${chunk.cx}_${chunk.cy}`;
    if (!this.pending.has(key)) this.pending.set(key, snapshot(chunk));
  }

  /** Close the group, snapshotting the result. No-op when nothing changed. */
  commit(store: DraftStore): void {
    if (!this.pending || this.pending.size === 0) {
      this.pending = null;
      return;
    }
    const before = [...this.pending.values()];
    const after = before
      .map((snap) => store.get(snap.cx, snap.cy))
      .filter((chunk): chunk is EditorChunk => chunk !== null)
      .map(snapshot);
    this.pending = null;
    // A new action after undos drops the redo tail — the standard contract.
    this.entries.length = this.cursor;
    this.entries.push({ label: this.pendingLabel, before, after });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.cursor = this.entries.length;
    this.onChanged();
  }

  undo(store: DraftStore): boolean {
    if (!this.canUndo) return false;
    const entry = this.entries[--this.cursor]!;
    restore(store, entry.before);
    this.onChanged();
    return true;
  }

  redo(store: DraftStore): boolean {
    if (!this.canRedo) return false;
    const entry = this.entries[this.cursor++]!;
    restore(store, entry.after);
    this.onChanged();
    return true;
  }

  /** Jump to a point in history (the §3 history panel's "jump"). */
  jumpTo(index: number, store: DraftStore): void {
    while (this.cursor > index && this.undo(store));
    while (this.cursor < index && this.redo(store));
  }

  list(): { label: string; index: number; current: boolean }[] {
    return this.entries.map((entry, index) => ({
      label: entry.label,
      index: index + 1,
      current: index + 1 === this.cursor,
    }));
  }
}

const restore = (store: DraftStore, snapshots: ChunkSnapshot[]): void => {
  for (const snap of snapshots) {
    const chunk = store.get(snap.cx, snap.cy);
    if (!chunk) continue;
    chunk.heights.set(snap.heights);
    chunk.splat.set(snap.splat);
    chunk.waterLevel = snap.waterLevel;
    chunk.enabled = snap.enabled;
    store.markDirty(chunk);
  }
};

// ---------------------------------------------------------------------------
// Applying strokes
// ---------------------------------------------------------------------------

/**
 * Apply one sculpt dab.
 *
 * `chunksTouchedBy` is what makes a seam correct: a stroke landing on a shared
 * vertex row must edit BOTH chunks, or the next bake shows a crack exactly
 * where the owner was working. Only ENABLED chunks are edited — sculpting the
 * void would silently create land the bake then skips.
 */
export const applyBrush = (
  store: DraftStore,
  journal: UndoJournal,
  settings: BrushSettings,
  x: number,
  z: number,
  dt: number,
  invert: boolean,
): number => {
  const stroke: BrushStroke = {
    kind: settings.kind,
    x,
    z,
    radius: settings.radius,
    strength: settings.strength,
    falloff: settings.falloff,
    dt,
    invert,
    target: settings.target,
  };
  let changed = 0;
  for (const { cx, cy } of chunksTouchedBy(x, z, settings.radius)) {
    const chunk = store.get(cx, cy);
    if (!chunk?.enabled) continue;
    journal.capture(chunk);
    const touched = applyBrushToChunk(chunk.heights, cx, cy, stroke, (nx, nz) =>
      store.heightAt(nx, nz),
    );
    if (touched > 0) {
      changed += touched;
      store.markDirty(chunk);
    }
  }
  return changed;
};

/** Apply one splat dab, with the same seam and enabled-only rules. */
export const applyPaint = (
  store: DraftStore,
  journal: UndoJournal,
  settings: PaintSettings,
  x: number,
  z: number,
  dt: number,
): number => {
  const stroke: SplatStroke = {
    x,
    z,
    radius: settings.radius,
    strength: settings.strength,
    falloff: settings.falloff,
    layer: settings.layer,
    dt,
    slopeMin: settings.slopeMin,
    slopeMax: settings.slopeMax,
    heightMin: settings.heightMin,
    heightMax: settings.heightMax,
  };
  let changed = 0;
  for (const { cx, cy } of chunksTouchedBy(x, z, settings.radius)) {
    const chunk = store.get(cx, cy);
    if (!chunk?.enabled) continue;
    journal.capture(chunk);
    const touched = applySplatToChunk(chunk.splat, cx, cy, stroke, (nx, nz) =>
      probe(store, nx, nz),
    );
    if (touched > 0) {
      changed += touched;
      store.markDirty(chunk);
    }
  }
  return changed;
};

/** Height + slope at a world point, for the paint masks. */
export const probe = (
  store: DraftStore,
  x: number,
  z: number,
): { height: number; slopeDeg: number } | null => {
  const height = store.heightAt(x, z);
  if (height === null) return null;
  const step = 1;
  const east = store.heightAt(x + step, z) ?? height;
  const west = store.heightAt(x - step, z) ?? height;
  const north = store.heightAt(x, z - step) ?? height;
  const south = store.heightAt(x, z + step) ?? height;
  const dx = (east - west) / (2 * step);
  const dz = (south - north) / (2 * step);
  return { height, slopeDeg: (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI };
};

/**
 * Water tool: set (or clear) a chunk's water level. Per chunk rather than per
 * brush because that is how the format stores it — one level per chunk is what
 * makes a lake cheap, and pretending otherwise in the UI would be a lie.
 */
export const setWaterLevel = (
  store: DraftStore,
  journal: UndoJournal,
  cx: number,
  cy: number,
  level: number | null,
): void => {
  const chunk = store.get(cx, cy);
  if (!chunk) return;
  journal.begin(level === null ? 'Clear water' : `Water level ${level.toFixed(1)} m`);
  journal.capture(chunk);
  chunk.waterLevel = level;
  store.markDirty(chunk);
  journal.commit(store);
};

/** Enable/disable a chunk — the island/board tool that decides what is world. */
export const setChunkEnabled = (
  store: DraftStore,
  journal: UndoJournal,
  cx: number,
  cy: number,
  enabled: boolean,
): void => {
  const chunk = store.get(cx, cy);
  if (!chunk || chunk.enabled === enabled) return;
  journal.begin(enabled ? `Enable chunk ${cx},${cy}` : `Disable chunk ${cx},${cy}`);
  journal.capture(chunk);
  chunk.enabled = enabled;
  store.markDirty(chunk);
  journal.commit(store);
};
