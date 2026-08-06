/**
 * Whole-world generation (MAP_EDITOR.md §2.1 "used to seed the base world",
 * game P12).
 *
 * The editor already has an island button. It cannot build the Dawnlands,
 * because it generates into the RESIDENT region — capped at 13×13 chunks after
 * 17×17 was measured at 7.5 M triangles a frame — and the world is 32×32. A
 * tool that can only see a fifth of the map cannot compose an archipelago out
 * of it, so the whole-world pass lives here, next to the draft rows.
 *
 * What it does, in one transaction's worth of work:
 *
 *  1. Assemble every chunk into ONE 2049² height field. Adjacent chunks share
 *     their border row, and the only way to be certain the two copies never
 *     disagree is to not have two while the maths runs.
 *  2. Synthesise the islands from their masks (greatest contribution wins, so
 *     overlaps become isthmuses).
 *  3. Erode the whole field — the per-chunk pass has to skip border vertices,
 *     which leaves an un-eroded lattice every 64 m.
 *  4. Split back into chunks, paint each one's splat from its own zone's rules,
 *     and ENABLE only the chunks that ended up with land. Ocean chunks cost
 *     nothing (WORLD.md §2) and the bake skips them.
 *
 * It is destructive by design — it rewrites terrain, and only terrain. Every
 * placed object survives untouched and re-sits on the new heights, which is
 * what §2.1's "always non-destructive to placed props" means. The caller takes
 * a checkpoint first (rule 5).
 *
 * Memory: the field is 2049² floats ≈ 16.8 MB, plus the chunk rows. That is a
 * lot for one request on a 1-core VPS and the reason this is admin-only,
 * confirm-gated, and not something the editor pokes while you drag a slider.
 */

import {
  CHUNK_VERTS,
  OCEAN_FLOOR_Y,
  WORLD_CHUNKS,
  WORLD_ORIGIN_M,
  baseSplat,
  setSplatTexel,
  zoneSchema,
} from '@dawned/shared';
import {
  DEFAULT_WORLD_EROSION,
  type ErosionSettings,
  type IslandMask,
  type SplatRule,
  WorldHeightField,
  erodeField,
  resolveSplatZones,
  slopeAt,
  splatLayerAt,
  synthWorld,
} from '../shared-ext/terrain-synth.js';
import { type DraftChunk, emptyChunk, listObjects, loadAllChunks, saveChunk } from './map-draft.js';
import type { Db } from './db.js';

/** Chunk upserts per batch — the same 64 the editor's own save endpoint takes. */
const SAVE_BATCH = 64;

export interface WorldGenRequest {
  readonly masks: readonly IslandMask[];
  readonly splatRules: readonly SplatRule[];
  readonly seaLevel: number;
  readonly erosion?: ErosionSettings;
  /**
   * Water surface for chunks that carry any. `null` leaves every chunk's own
   * override alone — the global sea plane is a world setting, not a chunk one.
   */
  readonly waterLevel?: number | null;
}

export interface WorldGenReport {
  chunksWritten: number;
  chunksEnabled: number;
  landVertices: number;
  perIsland: Record<string, number>;
  erodedVertices: number;
  splatTexels: number;
  /** Texels no rule claimed — a palette with a hole in it is silent in-game. */
  unpaintedTexels: number;
}

export type GenProgress = (message: string, fraction: number) => void;

/**
 * Rewrite every chunk of the draft from island masks.
 *
 * `onProgress` is called often enough for an SSE stream to look alive; the run
 * is a few seconds of arithmetic and then a minute of upserts, so most of the
 * reported time is the database.
 */
export const generateWorld = async (
  db: Db,
  request: WorldGenRequest,
  updatedBy: number,
  onProgress: GenProgress = () => {},
): Promise<WorldGenReport> => {
  if (request.masks.length === 0) throw new Error('a world needs at least one island mask');

  onProgress('Reading the draft…', 0.02);
  const stored = await loadAllChunks(db);
  const byKey = new Map<string, DraftChunk>();
  for (const chunk of stored) byKey.set(`${chunk.cx},${chunk.cy}`, chunk);

  // Every chunk of the world takes part, including ones that have never been
  // written: an archipelago that only reaches chunks somebody already touched
  // would be shaped by the editing history rather than by the masks.
  const chunks: DraftChunk[] = [];
  for (let cy = 0; cy < WORLD_CHUNKS; cy++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      chunks.push(byKey.get(`${cx},${cy}`) ?? emptyChunk(cx, cy, OCEAN_FLOOR_Y));
    }
  }

  // A palette names its zone; the zone's real polygon comes from the draft's
  // own `zone` layer, so the paint and the region cannot describe different
  // ground. Resolved BEFORE anything is written — an unknown zone id is an
  // error, and it should be one before 1024 chunks have been rewritten.
  const zoneRows = await listObjects(db, ['zone']);
  const zonePolygons = new Map<string, readonly (readonly [number, number])[]>();
  for (const row of zoneRows) {
    const parsed = zoneSchema.safeParse(row.def);
    if (parsed.success) zonePolygons.set(parsed.data.id, parsed.data.polygon);
  }
  const splatRules = resolveSplatZones(request.splatRules, zonePolygons);

  onProgress('Synthesising islands…', 0.08);
  const field = new WorldHeightField(WORLD_CHUNKS, WORLD_ORIGIN_M);
  const synth = synthWorld(field, request.masks, request.seaLevel, OCEAN_FLOOR_Y);

  onProgress(`Eroding ${synth.land.toLocaleString()} land vertices…`, 0.2);
  const erosion = request.erosion ?? DEFAULT_WORLD_EROSION;
  const eroded = erodeField(field, erosion, request.seaLevel);

  onProgress('Painting and cutting into chunks…', 0.35);
  let enabled = 0;
  let painted = 0;
  let unpainted = 0;
  const texelSize = (CHUNK_VERTS - 1) / 32;
  for (const chunk of chunks) {
    field.readChunk(chunk.cx, chunk.cy, chunk.heights, CHUNK_VERTS);

    let anyLand = false;
    for (const h of chunk.heights) {
      if (h > request.seaLevel + 0.2) {
        anyLand = true;
        break;
      }
    }
    chunk.enabled = anyLand;
    if (anyLand) enabled++;
    if (request.waterLevel !== undefined) chunk.waterLevel = request.waterLevel;

    // An ocean chunk is never drawn, so painting it is work nobody sees. Reset
    // it to the base layer instead, or a chunk that used to be an island keeps
    // its grass in the bake's eyes if it is ever re-enabled by hand.
    if (!anyLand) {
      chunk.splat = baseSplat(0);
      continue;
    }
    chunk.splat = baseSplat(0);
    const baseGx = chunk.cx * (CHUNK_VERTS - 1);
    const baseGz = chunk.cy * (CHUNK_VERTS - 1);
    for (let iz = 0; iz < 32; iz++) {
      for (let ix = 0; ix < 32; ix++) {
        // Sample at the texel's centre, in the field's own vertex coordinates.
        const gx = Math.min(field.side - 1, Math.round(baseGx + (ix + 0.5) * texelSize));
        const gz = Math.min(field.side - 1, Math.round(baseGz + (iz + 0.5) * texelSize));
        const height = field.get(gx, gz);
        const layer = splatLayerAt(
          splatRules,
          height,
          slopeAt(field, gx, gz),
          field.worldX(gx),
          field.worldZ(gz),
        );
        if (layer < 0) {
          unpainted++;
          continue;
        }
        setSplatTexel(chunk.splat, iz * 32 + ix, layer);
        painted++;
      }
    }
  }

  onProgress(`Saving ${chunks.length} chunks…`, 0.45);
  let written = 0;
  for (let i = 0; i < chunks.length; i += SAVE_BATCH) {
    const batch = chunks.slice(i, i + SAVE_BATCH);
    // Sequential inside a batch: a 1-core VPS gains nothing from parallel
    // upserts and loses the ability to say how far it got.
    for (const chunk of batch) {
      await saveChunk(db, chunk, updatedBy);
      written++;
    }
    onProgress(
      `Saved ${written}/${chunks.length} chunks…`,
      0.45 + 0.55 * (written / chunks.length),
    );
  }

  return {
    chunksWritten: written,
    chunksEnabled: enabled,
    landVertices: synth.land,
    perIsland: synth.perIsland,
    erodedVertices: eroded,
    splatTexels: painted,
    unpaintedTexels: unpainted,
  };
};
