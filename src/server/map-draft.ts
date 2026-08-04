/**
 * Map editor draft store (A2 · docs/MAP_EDITOR.md §3–§4).
 *
 * The editor holds the region it is looking at in memory and pushes what it
 * changed; this module is the durable half. Three ideas carry the whole design:
 *
 *  1. **Chunk-granular saves.** A brush stroke touches one to four chunks, so an
 *     autosave is a handful of ~25 kB upserts. Saving the world on every stroke
 *     would make the editor unusable on a 1-core VPS.
 *  2. **Row-per-object.** Everything standing on the terrain is its own row, so
 *     moving one rock writes one row and "clear every prop in Emberwood" is a
 *     DELETE with a predicate rather than a read-modify-write of a blob.
 *  3. **Drafts are never live.** Nothing here is served to players. The game
 *     changes only when `map-bake.ts` publishes, which is a separate, gated act.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { mapCheckpoints, mapDraftChunks, mapDraftObjects, mapLock } from '@dawned/shared/schema';
import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  SPLAT_MAP_SIZE,
  WORLD_CHUNKS,
  WORLD_ORIGIN_M,
  baseSplat,
  chunkIndexOf,
  interactableSchema,
  poiSchema,
  propPlacementSchema,
  scatterSetSchema,
  spawnerDefSchema,
  zoneSchema,
} from '@dawned/shared';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { Db } from './db.js';

/** Layers the editor can own things in (mirrors the DB enum). */
export const MAP_LAYERS = [
  'prop',
  'scatter',
  'spawner',
  'node',
  'npc',
  'zone',
  'poi',
  'interactable',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/**
 * A painted scatter patch: one density grid for one (chunk, set). Stored as an
 * object row rather than on the chunk so a set can be added or wiped without
 * rewriting terrain bytes.
 */
export const scatterPatchSchema = z
  .object({
    id: z.string().min(3).max(80),
    setId: z.string().min(3).max(64),
    cx: z
      .number()
      .int()
      .min(0)
      .max(WORLD_CHUNKS - 1),
    cy: z
      .number()
      .int()
      .min(0)
      .max(WORLD_CHUNKS - 1),
    density: z.array(z.number().int().min(0).max(255)).length(256),
  })
  .strict();

/** Resource node placement (P10 gathering; placed here so P12 can author it). */
export const resourceNodeSchema = z
  .object({
    id: z.string().min(3).max(64),
    profession: z.enum(['woodcutting', 'mining', 'herbalism', 'fishing']),
    tier: z.number().int().min(1).max(5),
    modelRef: z.string().min(1).max(64),
    x: z.number(),
    z: z.number(),
    rotation: z.number().default(0),
    respawnMs: z.number().int().min(1000).max(3_600_000).default(120_000),
  })
  .strict();

/** NPC placement with a walk routine (P11 quests consume these). */
export const npcPlacementSchema = z
  .object({
    id: z.string().min(3).max(64),
    name: z.string().min(1).max(64),
    modelRef: z.string().min(1).max(64),
    x: z.number(),
    z: z.number(),
    rotation: z.number().default(0),
    idleClip: z.string().max(64).default('Idle'),
    /** Waypoints with a wait at each; empty = stands still. */
    routine: z
      .array(
        z.object({ x: z.number(), z: z.number(), waitMs: z.number().int().min(0).max(120_000) }),
      )
      .max(32)
      .default([]),
  })
  .strict();

/** Which zod schema validates a given layer's `def`. */
export const layerSchemas = {
  prop: propPlacementSchema,
  scatter: scatterPatchSchema,
  spawner: spawnerDefSchema,
  node: resourceNodeSchema,
  npc: npcPlacementSchema,
  zone: zoneSchema,
  poi: poiSchema,
  interactable: interactableSchema,
} as const;

/** Scatter SETS themselves (the weighted asset lists) live in world settings. */
export const scatterSetsSchema = z.array(scatterSetSchema);

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export interface DraftChunk {
  cx: number;
  cy: number;
  heights: Float32Array;
  splat: Uint8Array;
  waterLevel: number | null;
  enabled: boolean;
}

const HEIGHT_BYTES = CHUNK_VERTS * CHUNK_VERTS * 4;
const SPLAT_BYTES = 2 * SPLAT_MAP_SIZE * SPLAT_MAP_SIZE * 4;

/**
 * A chunk that has never been touched: flat ocean floor, layer 0 everywhere,
 * and DISABLED. Disabled is the important part — the world is 32×32 chunks and
 * most of them are open sea, which the bake skips entirely and the client never
 * downloads (`WORLD.md` §2: ocean chunks cost nothing).
 */
export const emptyChunk = (cx: number, cy: number, floor = -8): DraftChunk => ({
  cx,
  cy,
  heights: new Float32Array(CHUNK_VERTS * CHUNK_VERTS).fill(floor),
  splat: baseSplat(0),
  waterLevel: null,
  enabled: false,
});

const rowToChunk = (row: {
  cx: number;
  cy: number;
  heights: Buffer;
  splat: Buffer;
  waterLevel: number | null;
  enabled: boolean;
}): DraftChunk => ({
  cx: row.cx,
  cy: row.cy,
  // Copy rather than view: node's Buffer pool means the underlying ArrayBuffer
  // is shared, and a Float32Array view over it would alias other rows.
  heights: new Float32Array(
    row.heights.buffer.slice(row.heights.byteOffset, row.heights.byteOffset + HEIGHT_BYTES),
  ),
  splat: new Uint8Array(row.splat),
  waterLevel: row.waterLevel,
  enabled: row.enabled,
});

/** Load every stored chunk inside a chunk-coordinate rectangle (inclusive). */
export const loadChunkRegion = async (
  db: Db,
  minCx: number,
  minCy: number,
  maxCx: number,
  maxCy: number,
): Promise<DraftChunk[]> => {
  const rows = await db
    .select()
    .from(mapDraftChunks)
    .where(
      and(
        gte(mapDraftChunks.cx, minCx),
        lte(mapDraftChunks.cx, maxCx),
        gte(mapDraftChunks.cy, minCy),
        lte(mapDraftChunks.cy, maxCy),
      ),
    );
  return rows.map(rowToChunk);
};

export const loadAllChunks = async (db: Db): Promise<DraftChunk[]> => {
  const rows = await db.select().from(mapDraftChunks);
  return rows.map(rowToChunk);
};

/** Upsert one chunk. The editor calls this per changed chunk after a stroke. */
export const saveChunk = async (db: Db, chunk: DraftChunk, updatedBy: number): Promise<void> => {
  if (chunk.heights.length !== CHUNK_VERTS * CHUNK_VERTS) {
    throw new Error(`chunk heights must have ${CHUNK_VERTS * CHUNK_VERTS} samples`);
  }
  if (chunk.splat.length !== SPLAT_BYTES) {
    throw new Error(`chunk splat must be ${SPLAT_BYTES} bytes`);
  }
  const heights = Buffer.from(
    chunk.heights.buffer,
    chunk.heights.byteOffset,
    chunk.heights.byteLength,
  );
  const splat = Buffer.from(chunk.splat);
  await db
    .insert(mapDraftChunks)
    .values({
      cx: chunk.cx,
      cy: chunk.cy,
      heights,
      splat,
      waterLevel: chunk.waterLevel,
      enabled: chunk.enabled,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [mapDraftChunks.cx, mapDraftChunks.cy],
      set: {
        heights,
        splat,
        waterLevel: chunk.waterLevel,
        enabled: chunk.enabled,
        updatedBy,
        updatedAt: sql`now()`,
      },
    });
};

/** Enable/disable chunks without touching their bytes (the island/board tool). */
export const setChunksEnabled = async (
  db: Db,
  chunks: { cx: number; cy: number }[],
  enabled: boolean,
  updatedBy: number,
): Promise<number> => {
  let touched = 0;
  for (const { cx, cy } of chunks) {
    const existing = await db
      .select({ cx: mapDraftChunks.cx })
      .from(mapDraftChunks)
      .where(and(eq(mapDraftChunks.cx, cx), eq(mapDraftChunks.cy, cy)))
      .limit(1);
    if (existing.length === 0) {
      if (!enabled) continue; // disabling a chunk that was never authored is a no-op
      await saveChunk(db, { ...emptyChunk(cx, cy), enabled: true }, updatedBy);
      touched++;
      continue;
    }
    await db
      .update(mapDraftChunks)
      .set({ enabled, updatedBy, updatedAt: sql`now()` })
      .where(and(eq(mapDraftChunks.cx, cx), eq(mapDraftChunks.cy, cy)));
    touched++;
  }
  return touched;
};

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export interface DraftObject {
  id: string;
  layer: MapLayer;
  def: unknown;
  x: number | null;
  z: number | null;
}

/**
 * Validate a row against its layer's schema and persist it. Returns the PARSED
 * def so the caller stores exactly what the schema produced (defaults filled) —
 * the editor then holds the same object the bake will read.
 */
export const saveObject = async (
  db: Db,
  layer: MapLayer,
  raw: unknown,
  updatedBy: number,
): Promise<DraftObject> => {
  const def = layerSchemas[layer].parse(raw) as { id: string; x?: number; z?: number };
  // Zones are polygons — they have no single position, and a null x/z is how a
  // region query knows to always include them.
  const x = typeof def.x === 'number' ? def.x : null;
  const z = typeof def.z === 'number' ? def.z : null;
  const cx = x === null ? null : chunkIndexOf(x);
  const cy = z === null ? null : chunkIndexOf(z);
  await db
    .insert(mapDraftObjects)
    .values({ id: def.id, layer, def, x, z, cx, cy, updatedBy })
    .onConflictDoUpdate({
      target: mapDraftObjects.id,
      set: { layer, def, x, z, cx, cy, updatedBy, updatedAt: sql`now()` },
    });
  return { id: def.id, layer, def, x, z };
};

export const deleteObjects = async (db: Db, ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(mapDraftObjects)
    .where(inArray(mapDraftObjects.id, ids))
    .returning({ id: mapDraftObjects.id });
  return deleted.length;
};

export const listObjects = async (db: Db, layers?: MapLayer[]): Promise<DraftObject[]> => {
  const rows = layers?.length
    ? await db.select().from(mapDraftObjects).where(inArray(mapDraftObjects.layer, layers))
    : await db.select().from(mapDraftObjects);
  return rows.map((row) => ({
    id: row.id,
    layer: row.layer,
    def: row.def,
    x: row.x,
    z: row.z,
  }));
};

/**
 * "Clear layer…" — the start-fresh requirement (MAP_EDITOR.md §3). Optionally
 * scoped to a polygon so the owner can wipe every prop in Emberwood and keep
 * the terrain and spawns. Returns what it removed so the UI can say so and the
 * audit log can record it.
 */
export const clearLayer = async (
  db: Db,
  layer: MapLayer,
  polygon?: readonly (readonly [number, number])[],
): Promise<{ removed: number; ids: string[] }> => {
  const rows = await db.select().from(mapDraftObjects).where(eq(mapDraftObjects.layer, layer));
  const doomed = rows.filter((row) => {
    if (!polygon || polygon.length < 3) return true;
    if (row.x === null || row.z === null) return false; // zones have no point to test
    return pointInside(row.x, row.z, polygon);
  });
  const ids = doomed.map((row) => row.id);
  await deleteObjects(db, ids);
  return { removed: ids.length, ids };
};

const pointInside = (
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[],
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// ---------------------------------------------------------------------------
// Single-writer lock (MAP_EDITOR.md §3)
// ---------------------------------------------------------------------------

/** How long a lease survives without a heartbeat — a closed tab frees it. */
export const LOCK_LEASE_MS = 45_000;

export interface LockState {
  heldBy: string | null;
  heldByAccountId: number | null;
  expiresAt: string | null;
  takeoverRequestedBy: string | null;
  /** True when the CALLER holds it — the only state in which edits are accepted. */
  mine: boolean;
}

const readLock = async (db: Db): Promise<typeof mapLock.$inferSelect | null> => {
  const rows = await db.select().from(mapLock).where(eq(mapLock.id, 1)).limit(1);
  return rows[0] ?? null;
};

const asState = (
  row: typeof mapLock.$inferSelect | null,
  accountId: number,
  now: Date,
): LockState => {
  if (!row || row.expiresAt.getTime() <= now.getTime()) {
    return {
      heldBy: null,
      heldByAccountId: null,
      expiresAt: null,
      takeoverRequestedBy: null,
      mine: false,
    };
  }
  return {
    heldBy: row.holderName,
    heldByAccountId: row.holderAccountId,
    expiresAt: row.expiresAt.toISOString(),
    takeoverRequestedBy: row.takeoverRequestedBy,
    mine: row.holderAccountId === accountId,
  };
};

export const getLock = async (db: Db, accountId: number): Promise<LockState> =>
  asState(await readLock(db), accountId, new Date());

/**
 * Take or renew the lease. An EXPIRED lease is free for anyone — that is what
 * makes a crashed browser recoverable without an admin having to intervene.
 */
export const acquireLock = async (
  db: Db,
  accountId: number,
  name: string,
  force = false,
): Promise<LockState> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_LEASE_MS);
  const current = await readLock(db);
  const free = !current || current.expiresAt.getTime() <= now.getTime();
  const isMine = current?.holderAccountId === accountId;
  if (!free && !isMine && !force) return asState(current, accountId, now);
  await db
    .insert(mapLock)
    .values({
      id: 1,
      holderAccountId: accountId,
      holderName: name,
      expiresAt,
      takeoverRequestedBy: null,
    })
    .onConflictDoUpdate({
      target: mapLock.id,
      set: {
        holderAccountId: accountId,
        holderName: name,
        expiresAt,
        // Renewing clears a pending request only when the holder changed; a
        // holder who keeps typing should keep SEEING the request.
        // `isMine` can only be true when a row exists, which is why this reads
        // `current` without a guard — TS narrows it from the comparison above.
        takeoverRequestedBy: isMine ? current.takeoverRequestedBy : null,
      },
    });
  return asState(await readLock(db), accountId, now);
};

export const releaseLock = async (db: Db, accountId: number): Promise<void> => {
  await db.delete(mapLock).where(and(eq(mapLock.id, 1), eq(mapLock.holderAccountId, accountId)));
};

export const requestTakeover = async (db: Db, name: string): Promise<void> => {
  await db.update(mapLock).set({ takeoverRequestedBy: name }).where(eq(mapLock.id, 1));
};

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

interface CheckpointPayload {
  chunks: {
    cx: number;
    cy: number;
    heights: string;
    splat: string;
    waterLevel: number | null;
    enabled: boolean;
  }[];
  objects: { id: string; layer: MapLayer; def: unknown }[];
}

/**
 * Named restore point. A full snapshot, gzipped into one row: the map is tens
 * of megabytes at worst, checkpoints are made a handful of times a session, and
 * "restore exactly what I had" is worth more than incremental cleverness.
 */
export const createCheckpoint = async (
  db: Db,
  name: string,
  createdBy: number,
): Promise<{ id: number; chunkCount: number; objectCount: number; bytes: number }> => {
  const chunks = await loadAllChunks(db);
  const objects = await listObjects(db);
  const payload: CheckpointPayload = {
    chunks: chunks.map((chunk) => ({
      cx: chunk.cx,
      cy: chunk.cy,
      heights: Buffer.from(
        chunk.heights.buffer,
        chunk.heights.byteOffset,
        chunk.heights.byteLength,
      ).toString('base64'),
      splat: Buffer.from(chunk.splat).toString('base64'),
      waterLevel: chunk.waterLevel,
      enabled: chunk.enabled,
    })),
    objects: objects.map((object) => ({ id: object.id, layer: object.layer, def: object.def })),
  };
  const blob = gzipSync(Buffer.from(JSON.stringify(payload)));
  const [row] = await db
    .insert(mapCheckpoints)
    .values({
      name,
      payload: blob,
      chunkCount: chunks.length,
      objectCount: objects.length,
      createdBy,
    })
    .returning({ id: mapCheckpoints.id });
  return {
    id: row!.id,
    chunkCount: chunks.length,
    objectCount: objects.length,
    bytes: blob.byteLength,
  };
};

export const listCheckpoints = async (db: Db) =>
  db
    .select({
      id: mapCheckpoints.id,
      name: mapCheckpoints.name,
      chunkCount: mapCheckpoints.chunkCount,
      objectCount: mapCheckpoints.objectCount,
      createdAt: mapCheckpoints.createdAt,
    })
    .from(mapCheckpoints)
    .orderBy(sql`${mapCheckpoints.createdAt} desc`)
    .limit(50);

/**
 * Restore a checkpoint over the draft. Deliberately a REPLACE: rows the
 * checkpoint does not contain are deleted, because "restore" that leaves
 * yesterday's mistakes behind is not a restore.
 */
export const restoreCheckpoint = async (
  db: Db,
  id: number,
  updatedBy: number,
): Promise<{ chunks: number; objects: number }> => {
  const rows = await db
    .select({ payload: mapCheckpoints.payload })
    .from(mapCheckpoints)
    .where(eq(mapCheckpoints.id, id))
    .limit(1);
  if (rows.length === 0) throw new Error(`checkpoint ${id} not found`);
  const payload = JSON.parse(gunzipSync(rows[0]!.payload).toString()) as CheckpointPayload;
  await db.delete(mapDraftObjects);
  await db.delete(mapDraftChunks);
  for (const chunk of payload.chunks) {
    const heights = Buffer.from(chunk.heights, 'base64');
    await saveChunk(
      db,
      {
        cx: chunk.cx,
        cy: chunk.cy,
        heights: new Float32Array(
          heights.buffer.slice(heights.byteOffset, heights.byteOffset + HEIGHT_BYTES),
        ),
        splat: new Uint8Array(Buffer.from(chunk.splat, 'base64')),
        waterLevel: chunk.waterLevel,
        enabled: chunk.enabled,
      },
      updatedBy,
    );
  }
  for (const object of payload.objects) {
    await saveObject(db, object.layer, object.def, updatedBy);
  }
  return { chunks: payload.chunks.length, objects: payload.objects.length };
};

// ---------------------------------------------------------------------------
// Sampling the draft (shared by generators, validation and the bake)
// ---------------------------------------------------------------------------

/**
 * A height/slope sampler over a set of draft chunks. Everything that needs to
 * ask "what is the ground doing at (x, z)?" — scatter masks, floater reports,
 * walkgrid bake, reachability — goes through this one implementation so they
 * cannot disagree about where the ground is.
 */
export class DraftSampler {
  private readonly byKey = new Map<number, DraftChunk>();

  constructor(chunks: readonly DraftChunk[]) {
    for (const chunk of chunks) this.byKey.set(chunk.cy * WORLD_CHUNKS + chunk.cx, chunk);
  }

  chunkAt(cx: number, cy: number): DraftChunk | null {
    return this.byKey.get(cy * WORLD_CHUNKS + cx) ?? null;
  }

  get chunks(): DraftChunk[] {
    return [...this.byKey.values()];
  }

  /** Bilinear height, or null where no ENABLED chunk covers the point. */
  heightAt(x: number, z: number): number | null {
    const cx = chunkIndexOf(x);
    const cy = chunkIndexOf(z);
    const chunk = this.chunkAt(cx, cy);
    if (!chunk || !chunk.enabled) return null;
    const step = CHUNK_SIZE_M / (CHUNK_VERTS - 1);
    const lx = (x - (WORLD_ORIGIN_M + cx * CHUNK_SIZE_M)) / step;
    const lz = (z - (WORLD_ORIGIN_M + cy * CHUNK_SIZE_M)) / step;
    const ix = Math.max(0, Math.min(CHUNK_VERTS - 2, Math.floor(lx)));
    const iz = Math.max(0, Math.min(CHUNK_VERTS - 2, Math.floor(lz)));
    const fx = Math.max(0, Math.min(1, lx - ix));
    const fz = Math.max(0, Math.min(1, lz - iz));
    const h = chunk.heights;
    const h00 = h[iz * CHUNK_VERTS + ix]!;
    const h10 = h[iz * CHUNK_VERTS + ix + 1]!;
    const h01 = h[(iz + 1) * CHUNK_VERTS + ix]!;
    const h11 = h[(iz + 1) * CHUNK_VERTS + ix + 1]!;
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** Slope in degrees from 1 m finite differences — the walkgrid's definition. */
  slopeAt(x: number, z: number): number | null {
    const here = this.heightAt(x, z);
    if (here === null) return null;
    const east = this.heightAt(x + 1, z) ?? here;
    const north = this.heightAt(x, z + 1) ?? here;
    return (Math.atan(Math.hypot(east - here, north - here)) * 180) / Math.PI;
  }

  /** Height + slope in one call — what scatter masks and reports want. */
  probe(x: number, z: number): { height: number; slopeDeg: number } | null {
    const height = this.heightAt(x, z);
    if (height === null) return null;
    return { height, slopeDeg: this.slopeAt(x, z) ?? 0 };
  }

  /** Water surface at a point: the chunk override, else the global sea level. */
  waterLevelAt(x: number, z: number, seaLevel: number): number | null {
    const chunk = this.chunkAt(chunkIndexOf(x), chunkIndexOf(z));
    if (!chunk || !chunk.enabled) return seaLevel;
    return chunk.waterLevel ?? seaLevel;
  }
}
