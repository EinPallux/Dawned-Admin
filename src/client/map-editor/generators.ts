/**
 * Terrain generators (MAP_EDITOR.md §2.1: island synth, erosion, auto-splat).
 *
 * These exist so the owner never starts from a flat plane. They are all
 * confirm-gated in the UI and all go through the undo journal as ONE entry —
 * a generator that cannot be taken back is a generator nobody dares run.
 *
 * Deliberately deterministic: every one takes a seed, so "run it again with a
 * different seed" is a real workflow and "I liked the last one" is recoverable.
 */

import { CHUNK_SIZE_M, CHUNK_VERTS, WORLD_ORIGIN_M, setSplatTexel } from '@dawned/shared';
import type { DraftStore, EditorChunk } from './draft-store.js';
import type { UndoJournal } from './tools.js';
import { probe } from './tools.js';

/** Small deterministic PRNG — same seed, same island, on any machine. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Value noise with a smooth interpolant, tiled over a 256-entry gradient. */
const makeNoise = (seed: number) => {
  const random = mulberry32(seed);
  const table = new Float32Array(256);
  for (let i = 0; i < table.length; i++) table[i] = random();
  const hash = (x: number, z: number): number => table[(x * 73 + z * 151) & 255]!;
  const fade = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, z: number): number => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fz = fade(z - iz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
};

export interface IslandSettings {
  seed: number;
  /** World centre of the island. */
  centerX: number;
  centerZ: number;
  /** Metres from centre to the shoreline. */
  radius: number;
  /** Peak height above sea level. */
  peak: number;
  /** 0 = smooth dome, 1 = ragged ridges. */
  roughness: number;
  /** Below this, the generator writes ocean floor rather than land. */
  seaLevel: number;
}

export const DEFAULT_ISLAND: IslandSettings = {
  seed: 1337,
  centerX: 0,
  centerZ: 0,
  radius: 320,
  peak: 70,
  roughness: 0.55,
  seaLevel: 0,
};

/**
 * Island synthesis: a radial falloff dome plus fractal noise, written into
 * every chunk the disc touches, ENABLING those chunks as it goes.
 *
 * The falloff is `1 - (d/r)^2` shaped so the shore arrives gently — a linear
 * cone gives a cliff at the waterline, which reads as an error rather than a
 * beach and makes the walkgrid a ring of Steep.
 */
export const generateIsland = (
  store: DraftStore,
  journal: UndoJournal,
  settings: IslandSettings,
): number => {
  const noise = makeNoise(settings.seed);
  journal.begin(`Generate island (seed ${settings.seed})`);
  const touched = chunksInDisc(settings.centerX, settings.centerZ, settings.radius * 1.15);
  let written = 0;
  for (const { cx, cy } of touched) {
    const chunk = store.get(cx, cy);
    if (!chunk) continue;
    journal.capture(chunk);
    const baseX = WORLD_ORIGIN_M + cx * CHUNK_SIZE_M;
    const baseZ = WORLD_ORIGIN_M + cy * CHUNK_SIZE_M;
    const spacing = CHUNK_SIZE_M / (CHUNK_VERTS - 1);
    let anyLand = false;
    for (let iz = 0; iz < CHUNK_VERTS; iz++) {
      for (let ix = 0; ix < CHUNK_VERTS; ix++) {
        const x = baseX + ix * spacing;
        const z = baseZ + iz * spacing;
        const d = Math.hypot(x - settings.centerX, z - settings.centerZ) / settings.radius;
        const dome = d >= 1 ? 0 : 1 - d * d;
        // Three octaves is enough for a readable silhouette and cheap enough to
        // regenerate interactively while the owner drags the radius slider.
        const detail =
          noise(x * 0.006, z * 0.006) * 0.6 +
          noise(x * 0.017, z * 0.017) * 0.3 +
          noise(x * 0.041, z * 0.041) * 0.1;
        const height =
          settings.seaLevel +
          dome * settings.peak * (1 - settings.roughness * 0.5 + detail * settings.roughness);
        const value = dome > 0 ? height : settings.seaLevel - 8;
        chunk.heights[iz * CHUNK_VERTS + ix] = value;
        if (value > settings.seaLevel + 0.2) anyLand = true;
      }
    }
    if (anyLand) chunk.enabled = true;
    store.markDirty(chunk);
    written++;
  }
  journal.commit(store);
  return written;
};

export interface ErosionSettings {
  /** How many smoothing passes; each one costs a full chunk sweep. */
  passes: number;
  /** Only erode where it is steeper than this — flats stay flat. */
  minSlopeDeg: number;
  /** 0–1 blend toward the neighbourhood average per pass. */
  strength: number;
}

export const DEFAULT_EROSION: ErosionSettings = { passes: 3, minSlopeDeg: 22, strength: 0.5 };

/**
 * Thermal erosion, the cheap kind: slump anything steeper than the talus angle
 * toward its neighbours. Not hydraulic — no channels, no deposition — but it
 * turns noise-generated spikes into shapes that read as rock, and it is the
 * difference between an island you can walk on and a wall of Steep cells.
 */
export const erode = (
  store: DraftStore,
  journal: UndoJournal,
  chunks: EditorChunk[],
  settings: ErosionSettings,
): number => {
  journal.begin(`Erode ×${settings.passes}`);
  let moved = 0;
  for (const chunk of chunks) {
    if (!chunk.enabled) continue;
    journal.capture(chunk);
  }
  for (let pass = 0; pass < settings.passes; pass++) {
    for (const chunk of chunks) {
      if (!chunk.enabled) continue;
      const next = chunk.heights.slice();
      for (let iz = 1; iz < CHUNK_VERTS - 1; iz++) {
        for (let ix = 1; ix < CHUNK_VERTS - 1; ix++) {
          const i = iz * CHUNK_VERTS + ix;
          const here = chunk.heights[i]!;
          const n = chunk.heights[i - CHUNK_VERTS]!;
          const s = chunk.heights[i + CHUNK_VERTS]!;
          const w = chunk.heights[i - 1]!;
          const e = chunk.heights[i + 1]!;
          const spacing = CHUNK_SIZE_M / (CHUNK_VERTS - 1);
          const slope =
            (Math.atan(Math.hypot((e - w) / (2 * spacing), (s - n) / (2 * spacing))) * 180) /
            Math.PI;
          if (slope < settings.minSlopeDeg) continue;
          const average = (n + s + w + e) / 4;
          next[i] = here + (average - here) * settings.strength;
          moved++;
        }
      }
      chunk.heights.set(next);
    }
  }
  for (const chunk of chunks) {
    if (chunk.enabled) store.markDirty(chunk);
  }
  journal.commit(store);
  return moved;
};

export interface AutoSplatRule {
  layer: number;
  minSlopeDeg: number;
  maxSlopeDeg: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * Default rules, read off the shipped palette: sand at the waterline, grass on
 * the gentle middle, rock on anything steep, snow up high. They are editable in
 * the UI — this is a starting point, not a policy.
 */
export const defaultAutoSplatRules = (seaLevel: number): AutoSplatRule[] => [
  { layer: 0, minSlopeDeg: 0, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
  { layer: 1, minSlopeDeg: 0, maxSlopeDeg: 24, minHeight: seaLevel + 2.5, maxHeight: 999 },
  { layer: 2, minSlopeDeg: 0, maxSlopeDeg: 18, minHeight: seaLevel - 1, maxHeight: seaLevel + 2.5 },
  { layer: 3, minSlopeDeg: 32, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
];

/**
 * Paint every texel from slope + height. Rules are applied IN ORDER and the
 * last match wins, which is why rule 0 is a full-coverage base: every texel
 * ends up with exactly one layer at full weight, so nothing is left at the
 * unblended default.
 */
export const autoSplat = (
  store: DraftStore,
  journal: UndoJournal,
  chunks: EditorChunk[],
  rules: AutoSplatRule[],
): number => {
  journal.begin('Auto-splat');
  let painted = 0;
  for (const chunk of chunks) {
    if (!chunk.enabled) continue;
    journal.capture(chunk);
    const texelSize = CHUNK_SIZE_M / 32;
    for (let iz = 0; iz < 32; iz++) {
      for (let ix = 0; ix < 32; ix++) {
        const x = WORLD_ORIGIN_M + chunk.cx * CHUNK_SIZE_M + (ix + 0.5) * texelSize;
        const z = WORLD_ORIGIN_M + chunk.cy * CHUNK_SIZE_M + (iz + 0.5) * texelSize;
        const ground = probe(store, x, z);
        if (!ground) continue;
        let chosen = -1;
        for (const rule of rules) {
          if (ground.slopeDeg < rule.minSlopeDeg || ground.slopeDeg > rule.maxSlopeDeg) continue;
          if (ground.height < rule.minHeight || ground.height > rule.maxHeight) continue;
          chosen = rule.layer;
        }
        if (chosen < 0) continue;
        setSplatTexel(chunk.splat, iz * 32 + ix, chosen);
        painted++;
      }
    }
    store.markDirty(chunk);
  }
  journal.commit(store);
  return painted;
};

/** Chunk coordinates whose square overlaps a world-space disc. */
const chunksInDisc = (x: number, z: number, radius: number): { cx: number; cy: number }[] => {
  const out: { cx: number; cy: number }[] = [];
  const toChunk = (world: number): number => Math.floor((world - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const minCx = Math.max(0, toChunk(x - radius));
  const maxCx = Math.min(31, toChunk(x + radius));
  const minCy = Math.max(0, toChunk(z - radius));
  const maxCy = Math.min(31, toChunk(z + radius));
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) out.push({ cx, cy });
  }
  return out;
};
