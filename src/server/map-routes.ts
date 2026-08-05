/**
 * Map editor API (A2/A3). Registered by `app.ts`; kept separate because the
 * editor's surface is large and mixing it into the content routes would bury
 * both.
 *
 * Two rules shape every route here:
 *   • **Writes need the lock.** One writer at a time (MAP_EDITOR.md §3); a
 *     second GM gets read-only until they take over. Enforced server-side, not
 *     just hidden in the UI — a stale tab must not be able to overwrite work.
 *   • **Nothing here is live.** Every write lands in the draft tables. The game
 *     only changes when `/api/map/publish` runs, and that is gated on
 *     validation and audited.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  contentEnemies,
  contentLootTables,
  contentSpawners,
  mapEditorCollections,
  mapVersions,
} from '@dawned/shared/schema';
import {
  CHUNK_VERTS,
  MAP_VERSION,
  SPLAT_MAP_SIZE,
  WORLD_CHUNKS,
  scatterSetSchema,
  spawnerDefSchema,
  type ScatterSet,
} from '@dawned/shared';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { AuditWriter } from './audit.js';
import type { AdminUser } from '../shared-ext/api-types.js';
import {
  MAP_LAYERS,
  acquireLock,
  clearLayer,
  createCheckpoint,
  deleteObjects,
  emptyChunk,
  getLock,
  listCheckpoints,
  listObjects,
  loadAllChunks,
  loadChunkRegion,
  releaseLock,
  requestTakeover,
  restoreCheckpoint,
  saveChunk,
  saveObject,
  setChunksEnabled,
  type DraftChunk,
  type DraftObject,
  type MapLayer,
} from './map-draft.js';
import { bakeDraft, validateDraft, type BakeProgress, type DraftBundle } from './map-bake.js';
import { importLiveMap } from './map-import.js';
import { reloadGameContent, reloadGameMap } from './publish-support.js';

const HEIGHT_SAMPLES = CHUNK_VERTS * CHUNK_VERTS;
const SPLAT_BYTES = 2 * SPLAT_MAP_SIZE * SPLAT_MAP_SIZE * 4;

/** Chunk bytes ride the wire as base64 — one JSON body per autosave batch. */
const chunkPayloadSchema = z.object({
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
  heights: z.string(),
  splat: z.string(),
  waterLevel: z.number().nullable(),
  enabled: z.boolean(),
});

const decodeChunkPayload = (payload: z.infer<typeof chunkPayloadSchema>): DraftChunk => {
  const heights = Buffer.from(payload.heights, 'base64');
  const splat = Buffer.from(payload.splat, 'base64');
  if (heights.byteLength !== HEIGHT_SAMPLES * 4) {
    throw new Error(
      `chunk ${payload.cx},${payload.cy}: heights must be ${HEIGHT_SAMPLES * 4} bytes`,
    );
  }
  if (splat.byteLength !== SPLAT_BYTES) {
    throw new Error(`chunk ${payload.cx},${payload.cy}: splat must be ${SPLAT_BYTES} bytes`);
  }
  return {
    cx: payload.cx,
    cy: payload.cy,
    heights: new Float32Array(
      heights.buffer.slice(heights.byteOffset, heights.byteOffset + heights.byteLength),
    ),
    splat: new Uint8Array(splat),
    waterLevel: payload.waterLevel,
    enabled: payload.enabled,
  };
};

const encodeChunkPayload = (chunk: DraftChunk): z.infer<typeof chunkPayloadSchema> => ({
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
});

/**
 * Scatter SETS (the weighted asset lists) are map-wide settings rather than
 * placed objects, so they live in one row of world settings rather than in the
 * object table. Kept here because only the map editor authors them.
 */
const SCATTER_SETTINGS_KEY = 'map_scatter_sets';

/**
 * Editor collections (MAP_EDITOR.md §2.2, §3). `data` is checked per kind on
 * the CLIENT (it owns the prefab/selection shapes) and only bounded here — the
 * server's job is to keep a GM from writing a megabyte of junk into a shared
 * table, not to re-derive the editor's own types.
 */
const collectionBodySchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(['selection', 'prefab']),
    name: z.string().min(1).max(120),
    data: z.unknown().refine((value) => JSON.stringify(value ?? null).length <= 400_000, {
      message: 'collection payload too large',
    }),
  })
  .strict();

export interface MapRouteDeps {
  db: Db;
  config: Config;
  audit: AuditWriter;
  requireRole: (
    request: FastifyRequest,
    reply: FastifyReply,
    role: 'gm' | 'admin',
  ) => AdminUser | null;
}

export const registerMapRoutes = (app: FastifyInstance, deps: MapRouteDeps): void => {
  const { db, config, audit, requireRole } = deps;

  /**
   * Every mutating route runs through this. Returning null means the reply is
   * already sent — either "not your role" or "someone else holds the lock".
   */
  const requireWriter = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AdminUser | null> => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return null;
    const lock = await getLock(db, admin.accountId);
    if (!lock.mine) {
      void reply.code(409).send({
        error: 'map is locked',
        heldBy: lock.heldBy,
        detail: lock.heldBy
          ? `${lock.heldBy} is editing the map. Request a takeover to continue.`
          : 'Take the editing lock before making changes.',
      });
      return null;
    }
    return admin;
  };

  const readScatterSets = async (): Promise<ScatterSet[]> => {
    const rows = await db
      .select()
      .from(mapVersions)
      .where(eq(mapVersions.version, SCATTER_SETTINGS_KEY))
      .limit(1);
    const stored = rows[0]?.summary;
    if (!stored || !Array.isArray(stored)) return [];
    const parsed = z.array(scatterSetSchema).safeParse(stored);
    return parsed.success ? parsed.data : [];
  };

  // ------------------------------------------------------------------- lock
  app.get('/api/map/lock', async (request, reply) => {
    const admin = requireRole(request, reply, 'gm');
    if (!admin) return;
    return getLock(db, admin.accountId);
  });

  app.post('/api/map/lock', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const body = z.object({ force: z.boolean().default(false) }).parse(request.body ?? {});
    const state = await acquireLock(db, admin.accountId, admin.name, body.force);
    if (body.force && state.mine) {
      await audit({
        actorAccountId: admin.accountId,
        action: 'map.lock.takeover',
        args: {},
        result: 'ok',
      });
    }
    return state;
  });

  app.delete('/api/map/lock', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    await releaseLock(db, admin.accountId);
    return { ok: true };
  });

  app.post('/api/map/lock/request-takeover', async (request, reply) => {
    const admin = requireRole(request, reply, 'gm');
    if (!admin) return;
    await requestTakeover(db, admin.name);
    return { ok: true };
  });

  // ----------------------------------------------------------------- chunks
  /**
   * Load a rectangle of chunks. The editor asks for the region around the
   * camera and keeps it in memory; chunks with no row come back as empty +
   * disabled so the client always has something to sculpt into.
   */
  app.get('/api/map/chunks', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const query = z
      .object({
        minCx: z.coerce
          .number()
          .int()
          .min(0)
          .max(WORLD_CHUNKS - 1),
        minCy: z.coerce
          .number()
          .int()
          .min(0)
          .max(WORLD_CHUNKS - 1),
        maxCx: z.coerce
          .number()
          .int()
          .min(0)
          .max(WORLD_CHUNKS - 1),
        maxCy: z.coerce
          .number()
          .int()
          .min(0)
          .max(WORLD_CHUNKS - 1),
      })
      .parse(request.query);
    const stored = await loadChunkRegion(db, query.minCx, query.minCy, query.maxCx, query.maxCy);
    const have = new Set(stored.map((chunk) => `${chunk.cx}_${chunk.cy}`));
    const chunks = [...stored];
    for (let cy = query.minCy; cy <= query.maxCy; cy++) {
      for (let cx = query.minCx; cx <= query.maxCx; cx++) {
        if (!have.has(`${cx}_${cy}`)) chunks.push(emptyChunk(cx, cy));
      }
    }
    return { chunks: chunks.map(encodeChunkPayload) };
  });

  /** Autosave: a batch of changed chunks after a stroke settles. */
  app.put('/api/map/chunks', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z
      .object({ chunks: z.array(chunkPayloadSchema).min(1).max(64) })
      .parse(request.body);
    for (const payload of body.chunks) {
      await saveChunk(db, decodeChunkPayload(payload), admin.accountId);
    }
    return { saved: body.chunks.length };
  });

  /** Island/board tool: enable or disable chunks wholesale. */
  app.post('/api/map/chunks/enabled', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z
      .object({
        chunks: z
          .array(z.object({ cx: z.number().int(), cy: z.number().int() }))
          .min(1)
          .max(1024),
        enabled: z.boolean(),
      })
      .parse(request.body);
    const touched = await setChunksEnabled(db, body.chunks, body.enabled, admin.accountId);
    return { touched };
  });

  // ---------------------------------------------------------------- objects
  app.get('/api/map/objects', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const query = z.object({ layers: z.string().optional() }).parse(request.query);
    const layers = query.layers
      ? (query.layers
          .split(',')
          .filter((layer) => (MAP_LAYERS as readonly string[]).includes(layer)) as MapLayer[])
      : undefined;
    return { objects: await listObjects(db, layers) };
  });

  app.put('/api/map/objects', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z
      .object({
        objects: z
          .array(z.object({ layer: z.enum(MAP_LAYERS), def: z.unknown() }))
          .min(1)
          .max(500),
      })
      .parse(request.body);
    const saved = [];
    for (const entry of body.objects) {
      saved.push(await saveObject(db, entry.layer, entry.def, admin.accountId));
    }
    return { saved };
  });

  app.delete('/api/map/objects', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z.object({ ids: z.array(z.string()).min(1).max(2000) }).parse(request.body);
    return { removed: await deleteObjects(db, body.ids) };
  });

  /**
   * "Clear layer…" — the start-fresh requirement. Double-confirmed in the UI,
   * audited here, and auto-checkpointed first so it is always undoable even
   * after a reload.
   */
  app.post('/api/map/objects/clear-layer', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z
      .object({
        layer: z.enum(MAP_LAYERS),
        polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
        zoneName: z.string().max(64).optional(),
      })
      .parse(request.body);
    const backup = await createCheckpoint(
      db,
      `auto: before clearing ${body.layer}${body.zoneName ? ` in ${body.zoneName}` : ''}`,
      admin.accountId,
    );
    const result = await clearLayer(db, body.layer, body.polygon);
    await audit({
      actorAccountId: admin.accountId,
      action: 'map.clear-layer',
      args: { layer: body.layer, scoped: Boolean(body.polygon), removed: result.removed },
      result: 'ok',
    });
    return { ...result, checkpointId: backup.id };
  });

  // ----------------------------------------------------------- scatter sets
  app.get('/api/map/scatter-sets', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { sets: await readScatterSets() };
  });

  const writeScatterSets = async (sets: ScatterSet[], admin: AdminUser): Promise<void> => {
    await db
      .insert(mapVersions)
      .values({
        version: SCATTER_SETTINGS_KEY,
        summary: sets,
        publishedBy: admin.accountId,
      })
      .onConflictDoUpdate({
        target: mapVersions.version,
        set: { summary: sets, publishedBy: admin.accountId },
      });
  };

  app.put('/api/map/scatter-sets', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z.object({ sets: z.array(scatterSetSchema).max(64) }).parse(request.body);
    await writeScatterSets(body.sets, admin);
    return { sets: body.sets };
  });

  // ------------------------------------------------------- editor collections
  //
  // Named selections and stampable prefabs (MAP_EDITOR.md §2.2, §3). These do
  // NOT need the writer lock: saving "the harbour props" changes nothing about
  // the map, and a read-only GM planning an edit is exactly who wants to write
  // one down. They are audited like every other shared write.

  app.get('/api/map/collections', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const rows = await db
      .select({
        id: mapEditorCollections.id,
        kind: mapEditorCollections.kind,
        name: mapEditorCollections.name,
        data: mapEditorCollections.data,
      })
      .from(mapEditorCollections);
    return { collections: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  });

  app.put('/api/map/collections', async (request, reply) => {
    const admin = requireRole(request, reply, 'gm');
    if (!admin) return;
    const body = collectionBodySchema.parse(request.body);
    const now = new Date();
    await db
      .insert(mapEditorCollections)
      .values({
        id: body.id,
        kind: body.kind,
        name: body.name,
        data: body.data,
        createdBy: admin.accountId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mapEditorCollections.id,
        set: { name: body.name, data: body.data, updatedAt: now },
      });
    await audit({
      actorAccountId: admin.accountId,
      action: 'map.collection.save',
      args: { id: body.id, kind: body.kind, name: body.name },
      result: 'ok',
    });
    return { id: body.id };
  });

  app.delete('/api/map/collections', async (request, reply) => {
    const admin = requireRole(request, reply, 'gm');
    if (!admin) return;
    const body = z.object({ id: z.string().min(1).max(80) }).parse(request.body);
    await db.delete(mapEditorCollections).where(eq(mapEditorCollections.id, body.id));
    await audit({
      actorAccountId: admin.accountId,
      action: 'map.collection.delete',
      args: { id: body.id },
      result: 'ok',
    });
    return { ok: true };
  });

  // ------------------------------------------------------------ checkpoints
  app.get('/api/map/checkpoints', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { checkpoints: await listCheckpoints(db) };
  });

  app.post('/api/map/checkpoints', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);
    const result = await createCheckpoint(db, body.name, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'map.checkpoint',
      args: { name: body.name, chunks: result.chunkCount, objects: result.objectCount },
      result: 'ok',
    });
    return result;
  });

  app.post('/api/map/checkpoints/:id/restore', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const params = z.object({ id: z.coerce.number().int() }).parse(request.params);
    // Restoring is destructive to the current draft, so snapshot it first —
    // "I restored the wrong one" must be recoverable too.
    await createCheckpoint(db, `auto: before restoring #${params.id}`, admin.accountId);
    const result = await restoreCheckpoint(db, params.id, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'map.checkpoint.restore',
      args: { id: params.id, ...result },
      result: 'ok',
    });
    return result;
  });

  /**
   * Mirror the map's spawner layer into published `content_spawners` rows.
   *
   * Delete-then-insert inside one transaction: a camp the owner DELETED in the
   * editor has to stop spawning, and an update-only pass would leave it live
   * forever. The rows are validated by `validateDraft` before this runs, so
   * anything reaching here already resolves to published enemies.
   */
  const publishSpawnerLayer = async (objects: readonly DraftObject[]): Promise<number> => {
    const spawners = objects
      .filter((object) => object.layer === 'spawner')
      .map((object) => spawnerDefSchema.parse(object.def));
    await db.transaction(async (tx) => {
      await tx.delete(contentSpawners).where(eq(contentSpawners.status, 'published'));
      for (const def of spawners) {
        await tx
          .insert(contentSpawners)
          .values({ id: def.id, status: 'published', def, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [contentSpawners.id, contentSpawners.status],
            set: { def, updatedAt: new Date() },
          });
      }
    });
    return spawners.length;
  };

  // ----------------------------------------------------- validate / publish
  const gatherBundle = async (): Promise<DraftBundle> => {
    const [chunks, objects, scatterSets, enemies, lootTables, models] = await Promise.all([
      loadAllChunks(db),
      listObjects(db),
      readScatterSets(),
      db
        .select({ id: contentEnemies.id })
        .from(contentEnemies)
        .where(eq(contentEnemies.status, 'published')),
      db
        .select({ id: contentLootTables.id })
        .from(contentLootTables)
        .where(eq(contentLootTables.status, 'published')),
      readAssetManifest(config),
    ]);
    return {
      chunks,
      objects,
      scatterSets,
      seaLevel: 0,
      knownEnemyIds: new Set(enemies.map((row) => row.id)),
      knownLootTableIds: new Set(lootTables.map((row) => row.id)),
      knownModelRefs: models,
    };
  };

  /**
   * Baked model ids, for the props palette and the placement defaults. Read
   * from the SAME asset manifest publish validates against, so a model the
   * editor offers can never be one the bake would reject.
   */
  app.get('/api/map/models', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const models = await readAssetManifest(config);
    return { models: [...models].sort() };
  });

  app.get('/api/map/validate', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return validateDraft(await gatherBundle());
  });

  /**
   * Seed the draft from the LIVE map (MAP_EDITOR.md §3).
   *
   * The draft starts empty, and an empty draft publishes an empty world. This
   * is the bridge: it reads the bake players are currently standing on plus the
   * published spawner rows and writes them into the draft tables, so the first
   * thing the owner sees in the editor is the world they already have.
   *
   * Destructive by nature (it overwrites draft rows with the same ids), so it
   * takes a checkpoint first — the "backups available" half of rule 5.
   */
  app.post('/api/map/import-live', async (request, reply) => {
    const admin = await requireWriter(request, reply);
    if (!admin) return;
    const live = await readCurrentPointer(config.MAP_DIR);
    const existing = await loadAllChunks(db);
    if (existing.length > 0) {
      await createCheckpoint(db, `before importing ${live}`, admin.accountId);
    }
    try {
      const report = await importLiveMap(db, config.MAP_DIR, live, admin.accountId);
      // Scatter SETS ride world settings, not the object table — carry them
      // across too or every imported patch would reference a set that is gone.
      if (report.scatterSets.length > 0) await writeScatterSets(report.scatterSets, admin);
      await audit({
        actorAccountId: admin.accountId,
        action: 'map.import-live',
        args: { version: live, chunks: report.chunks, objects: report.props + report.zones },
        result: 'ok',
      });
      return report;
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    }
  });

  /**
   * Publish with live progress. Server-Sent Events rather than a long POST: a
   * full bake walks 4 M walkgrid cells and renders a 1024² map, and a spinner
   * with no numbers on a 1-core VPS feels broken.
   */
  app.get('/api/map/publish-stream', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const lock = await getLock(db, admin.accountId);
    if (!lock.mine) {
      return reply.code(409).send({ error: 'map is locked', heldBy: lock.heldBy });
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      send('step', { step: 'validate', done: 0, total: 1 });
      const bundle = await gatherBundle();
      const report = validateDraft(bundle);
      send('validation', report);
      if (report.problems.length > 0) {
        send('done', { ok: false, problems: report.problems });
        reply.raw.end();
        return;
      }
      const version = mintVersion();
      const result = await bakeDraft(bundle, config.MAP_DIR, version, (progress: BakeProgress) => {
        send('step', progress);
      });
      // Spawners are the one map layer the GAME reads from the database rather
      // than from the bake (`content_spawners`, loaded at boot and on content
      // reload). Publishing the map is therefore also publishing them, or a
      // camp moved in the editor would keep spawning at its old coordinates.
      send('step', { step: 'spawners', done: 0, total: 1 });
      const spawnersPublished = await publishSpawnerLayer(bundle.objects);
      send('step', { step: 'spawners', done: 1, total: 1 });
      await db.insert(mapVersions).values({
        version,
        summary: {
          ...result,
          spawnersPublished,
          warnings: [...result.warnings, ...report.warnings],
        },
        publishedBy: admin.accountId,
      });
      // Point the game at the new bake. Written last: until this file changes,
      // the previous version is still the live one, so a failed bake cannot
      // take the world down.
      await writeCurrentPointer(config.MAP_DIR, version);
      // Publishing mints a directory; nothing used to remove one. A bake of the
      // shipped world is ~8.6 MB and the owner will publish dozens of times
      // building a zone, which on a 4 GB VPS is a disk-fill with no warning.
      // Keep a rollback window and sweep the rest — reported, never silent.
      const pruned = await pruneOldBakes(config.MAP_DIR, version);
      if (pruned.length > 0) {
        send('step', { step: 'prune', done: pruned.length, total: pruned.length });
      }
      // Two pokes, in this order: the map first (it re-seeds enemies from the
      // spawners against the new ground), then content, so the rows the
      // re-seeded world reads are the published ones.
      send('step', { step: 'reload', done: 0, total: 1 });
      const reload = await reloadGameMap(config);
      await reloadGameContent(config);
      send('step', { step: 'reload', done: 1, total: 1 });
      await audit({
        actorAccountId: admin.accountId,
        action: 'map.publish',
        args: { version, chunks: result.chunksEmitted, ms: result.ms, pruned },
        result: 'ok',
      });
      send('done', {
        ok: true,
        version,
        result,
        warnings: [...result.warnings, ...report.warnings],
        reload,
      });
    } catch (error) {
      // Log it as well as streaming it. A publish that throws used to leave no
      // trace on the server at all — the only way to find out why was to be
      // looking at the browser when it happened.
      request.log.error({ err: error }, 'map publish failed');
      send('done', { ok: false, problems: [(error as Error).message] });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  app.get('/api/map/versions', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const rows = await db.select().from(mapVersions).limit(50);
    return {
      versions: rows
        .filter((row) => row.version !== SCATTER_SETTINGS_KEY)
        .map((row) => ({
          version: row.version,
          summary: row.summary,
          publishedAt: row.publishedAt,
        })),
      live: await readCurrentPointer(config.MAP_DIR),
    };
  });
};

/** `map-<epoch seconds>` — sortable, unique, and readable in a directory listing. */
const mintVersion = (): string => `map-${Math.floor(Date.now() / 1000)}`;

const CURRENT_POINTER = 'current.json';

const writeCurrentPointer = async (mapDir: string, version: string): Promise<void> => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(mapDir, CURRENT_POINTER), JSON.stringify({ version }, null, 2));
};

/**
 * How many published bakes survive a publish, newest first. Five is a rollback
 * window measured in afternoons, not a limit anyone will feel: the DRAFT is the
 * source of truth and lives in Postgres, so an older bake is only ever wanted
 * to undo the last publish or two.
 */
export const KEEP_BAKES = 5;

/**
 * Delete published bakes beyond the rollback window, plus any `.tmp` staging
 * directory a killed process left behind. Never touches the live version, the
 * one just minted, or `dev-2` (the committed `pnpm world:generate` fallback —
 * it is not a `map-*` directory, so the filter alone protects it).
 */
export const pruneOldBakes = async (
  mapDir: string,
  live: string,
  keep = KEEP_BAKES,
): Promise<string[]> => {
  const { readdir, rm } = await import('node:fs/promises');
  let entries;
  try {
    entries = await readdir(mapDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  // `map-<epoch>` sorts chronologically as a string, which is why the version
  // is minted that way; newest first.
  const bakes = names.filter((name) => /^map-\d+$/.test(name)).sort((a, b) => b.localeCompare(a));
  const doomed = [
    // `keep` counts the live bake, so the others get one fewer slot. Clamped at
    // zero: a negative `slice` argument counts from the END and would delete
    // everything BUT the oldest, which is the exact opposite of the intent.
    ...bakes.filter((name) => name !== live).slice(Math.max(0, keep - 1)),
    ...names.filter((name) => name.endsWith('.tmp')),
  ];
  const removed: string[] = [];
  for (const name of doomed) {
    try {
      await rm(path.join(mapDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      // A bake we cannot remove is not a reason to fail a publish that already
      // succeeded — the world is live either way.
    }
  }
  return removed;
};

export const readCurrentPointer = async (mapDir: string): Promise<string> => {
  try {
    const raw = await readFile(path.join(mapDir, CURRENT_POINTER), 'utf8');
    const parsed = z.object({ version: z.string() }).parse(JSON.parse(raw));
    return parsed.version;
  } catch {
    // No pointer yet: the game is still on the compiled-in default.
    return MAP_VERSION;
  }
};

/**
 * Model ids the asset pipeline has actually baked. Publish refuses a placement
 * naming art that does not exist — the same class of gate as P9's enemy clip
 * check, and for the same reason: it is invisible until someone walks there.
 */
const readAssetManifest = async (config: Config): Promise<Set<string>> => {
  try {
    const raw = await readFile(path.join(config.ASSETS_DIR, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as { assets?: Record<string, unknown> };
    return new Set(Object.keys(parsed.assets ?? {}));
  } catch {
    // No manifest reachable (a dev box without the game checkout): fall back to
    // permissive rather than blocking every publish on a missing file.
    return new Set();
  }
};
