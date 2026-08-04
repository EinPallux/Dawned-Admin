/**
 * The panel API. Factored as buildApp() so integration tests can boot the whole
 * thing against the dev database without listening on a port.
 *
 * Route map (Caddy strips the public /admin prefix before requests arrive):
 *   POST /api/auth/login|logout · GET /api/auth/me
 *   GET  /api/dashboard
 *   GET|PUT /api/world-settings        (PUT = save DRAFT — never touches live)
 *   static SPA (production)            (dist/client, deep links fall back)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { contentWorldSettings } from '@dawned/shared/schema';
import {
  abilityDefSchema,
  enemyDefSchema,
  itemDefSchema,
  lootTableDefSchema,
  skillNodeDefSchema,
  spawnerDefSchema,
  validateEnemyDef,
  vendorDefSchema,
  worldSettingsSchema,
  xpCurveEntrySchema,
} from '@dawned/shared';
import type { AdminUser, DashboardData } from '../shared-ext/api-types.js';
import type { Config } from './config.js';
import { createDb, assertSchemaPresent, type DbHandle } from './db.js';
import { AdminAuth, SESSION_COOKIE, roleAtLeast } from './auth.js';
import { createAuditWriter, type AuditWriter } from './audit.js';
import { registerMapRoutes } from './map-routes.js';
import { probeGame, probeMetrics } from './game-status.js';
import { readWorldSettings, saveWorldSettingsDraft } from './world-settings.js';
import {
  diffAbilities,
  discardAbilityDraft,
  listAbilities,
  publishAbilities,
  readAbility,
  saveAbilityDraft,
} from './abilities.js';
import {
  diffProgression,
  discardDraft,
  listSkillNodes,
  listXpCurve,
  publishProgression,
  saveSkillNodeDraft,
  saveXpCurveDraft,
} from './progression.js';
import {
  diffItems,
  discardItemDraft,
  listItems,
  listLootTables,
  listVendors,
  publishItems,
  saveItemDraft,
  saveLootTableDraft,
  saveVendorDraft,
  type ItemTableName,
} from './items.js';
import {
  diffEnemies,
  discardEnemyDraft,
  listEnemies,
  listSpawners,
  previewRotation,
  publishEnemies,
  saveEnemyDraft,
  saveSpawnerDraft,
  simulateTtk,
} from './enemies.js';

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminUser | null;
  }
}

const loginBodySchema = z.object({
  name: z.string().min(3).max(20),
  password: z.string().min(1).max(200),
});

export interface App {
  app: FastifyInstance;
  dbHandle: DbHandle;
  auth: AdminAuth;
  close: () => Promise<void>;
}

export const buildApp = async (config: Config): Promise<App> => {
  const dbHandle = createDb(config.DATABASE_URL);
  await assertSchemaPresent(dbHandle);

  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'warn' : config.LOG_LEVEL },
    trustProxy: true, // behind Caddy on the VPS; harmless in dev
  });

  const auth = new AdminAuth(dbHandle.db);
  const audit: AuditWriter = createAuditWriter(dbHandle.db, app.log);

  await app.register(cookie);

  // Internal errors never leak details (same hygiene as the game server).
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled route error');
      void reply
        .code(500)
        .send({ error: 'internal', message: 'Something went wrong — check the server log.' });
      return;
    }
    void reply.code(status).send({ error: 'bad_request', message: error.message });
  });

  // --- session + CSRF gates --------------------------------------------------
  app.decorateRequest('admin', null);
  /**
   * Panel API answers are never cacheable. They carry draft content and
   * session-scoped data, and a browser is free to invent a freshness lifetime
   * for a 200 with no cache header — which reads as "the editor is showing me
   * yesterday's drafts unless I open a private window".
   */
  app.addHook('onSend', (request: FastifyRequest, reply: FastifyReply, payload, done) => {
    if (request.url.startsWith('/api/')) void reply.header('cache-control', 'no-store');
    done(null, payload);
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/')) return;

    // CSRF: SameSite=Strict keeps the cookie home; the custom header proves the
    // request came from our own fetch wrapper, not a cross-site form.
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (isMutation && request.headers['x-dawned-admin'] !== '1') {
      return reply.code(403).send({ error: 'csrf', message: 'Missing panel header.' });
    }

    if (request.url.startsWith('/api/auth/login')) return; // the one anonymous route
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await auth.verifySession(token) : null;
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Sign in required.' });
    }
    request.admin = user;
  });

  const requireRole = (request: FastifyRequest, reply: FastifyReply, role: 'gm' | 'admin') => {
    if (!request.admin || !roleAtLeast(request.admin.role, role)) {
      void reply.code(403).send({ error: 'forbidden', message: 'Insufficient role.' });
      return null;
    }
    return request.admin;
  };

  // --- auth ------------------------------------------------------------------
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'Name and password required.' });
    }
    const result = await auth.login(body.data.name, body.data.password, request.ip);
    if (!result.ok) {
      const messages = {
        rate_limited: 'Too many attempts — wait a minute.',
        invalid_credentials: 'Wrong account name or password.',
        banned: 'This account is banned.',
        no_panel_access: 'This account has no panel access (gm/admin role required).',
      } as const;
      if (result.code === 'no_panel_access') {
        // A real credential holder without the role — the one failure worth a trail.
        const account = body.data.name;
        request.log.warn({ account }, 'panel login without gm/admin role');
      }
      const status = result.code === 'rate_limited' ? 429 : 401;
      return reply.code(status).send({ error: result.code, message: messages[result.code] });
    }
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 12 * 60 * 60,
    });
    await audit({ actorAccountId: result.user.accountId, action: 'auth.login', result: 'ok' });
    return { user: result.user };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (request.admin) {
      await audit({ actorAccountId: request.admin.accountId, action: 'auth.logout', result: 'ok' });
    }
    return { ok: true };
  });

  app.get('/api/auth/me', (request) => ({ user: request.admin }));

  // --- dashboard -------------------------------------------------------------
  app.get('/api/dashboard', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const [game, metrics, draftRows] = await Promise.all([
      probeGame(config),
      probeMetrics(config),
      dbHandle.db
        .select({ count: sql<number>`count(*)::int` })
        .from(contentWorldSettings)
        .where(eq(contentWorldSettings.status, 'draft')),
    ]);
    const data: DashboardData = {
      game,
      metrics,
      publish: {
        activeVersion: 'dev-2',
        draftsPending: draftRows[0]?.count ?? 0,
      },
    };
    return data;
  });

  // --- world settings (A0 DoD round-trip) ------------------------------------
  app.get('/api/world-settings', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return readWorldSettings(dbHandle.db);
  });

  app.put('/api/world-settings', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const parsed = worldSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
    const { data, changedKeys } = await saveWorldSettingsDraft(
      dbHandle.db,
      parsed.data,
      admin.accountId,
    );
    if (changedKeys.length > 0) {
      await audit({
        actorAccountId: admin.accountId,
        action: 'world_settings.save_draft',
        args: { changedKeys },
        target: 'world_settings',
        result: 'ok',
      });
    }
    return data;
  });

  // --- ability content editor (A1) -------------------------------------------
  app.get('/api/abilities', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { abilities: await listAbilities(dbHandle.db) };
  });

  app.get('/api/abilities/:id', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const { id } = request.params as { id: string };
    return readAbility(dbHandle.db, id);
  });

  /** Save a DRAFT (rule 1 — published rows only move through publish). */
  app.put('/api/abilities/:id', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const parsed = abilityDefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
    }
    if (parsed.data.id !== id) {
      return reply.code(400).send({ error: 'bad_request', message: 'Body id must match the URL.' });
    }
    const { pruned } = await saveAbilityDraft(dbHandle.db, parsed.data, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'abilities.save_draft',
      args: { id, pruned },
      target: id,
      result: 'ok',
    });
    return readAbility(dbHandle.db, id);
  });

  app.delete('/api/abilities/:id/draft', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const removed = await discardAbilityDraft(dbHandle.db, id);
    if (removed) {
      await audit({
        actorAccountId: admin.accountId,
        action: 'abilities.discard_draft',
        target: id,
        result: 'ok',
      });
    }
    return { removed };
  });

  // --- publish pipeline v1 (abilities) ---------------------------------------
  app.get('/api/publish/abilities/diff', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { entries: await diffAbilities(dbHandle.db) };
  });

  app.post('/api/publish/abilities', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const result = await publishAbilities(dbHandle.db, config);
    await audit({
      actorAccountId: admin.accountId,
      action: 'abilities.publish',
      args: { published: result.published, problems: result.problems },
      result: result.ok ? 'ok' : 'denied',
    });
    if (!result.ok) return reply.code(422).send(result);
    return result;
  });

  // --- progression content editors (A1-b, game P7) ---------------------------
  app.get('/api/xp-curve', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { entries: await listXpCurve(dbHandle.db) };
  });

  app.put('/api/xp-curve/:id', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const parsed = xpCurveEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
    }
    if (parsed.data.id !== id) {
      return reply.code(400).send({ error: 'bad_request', message: 'Body id must match the URL.' });
    }
    const { pruned } = await saveXpCurveDraft(dbHandle.db, parsed.data, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'xp_curve.save_draft',
      args: { id, pruned },
      target: id,
      result: 'ok',
    });
    return { ok: true, pruned };
  });

  app.delete('/api/xp-curve/:id/draft', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const removed = await discardDraft(dbHandle.db, 'xp_curve', id);
    if (removed) {
      await audit({
        actorAccountId: admin.accountId,
        action: 'xp_curve.discard_draft',
        target: id,
        result: 'ok',
      });
    }
    return { removed };
  });

  app.get('/api/skill-nodes', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { nodes: await listSkillNodes(dbHandle.db) };
  });

  app.put('/api/skill-nodes/:id', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const parsed = skillNodeDefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
    }
    if (parsed.data.id !== id) {
      return reply.code(400).send({ error: 'bad_request', message: 'Body id must match the URL.' });
    }
    const { pruned } = await saveSkillNodeDraft(dbHandle.db, parsed.data, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'skill_nodes.save_draft',
      args: { id, pruned },
      target: id,
      result: 'ok',
    });
    return { ok: true, pruned };
  });

  app.delete('/api/skill-nodes/:id/draft', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const removed = await discardDraft(dbHandle.db, 'skill_nodes', id);
    if (removed) {
      await audit({
        actorAccountId: admin.accountId,
        action: 'skill_nodes.discard_draft',
        target: id,
        result: 'ok',
      });
    }
    return { removed };
  });

  app.get('/api/publish/progression/diff', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return diffProgression(dbHandle.db);
  });

  app.post('/api/publish/progression', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const result = await publishProgression(dbHandle.db, config);
    await audit({
      actorAccountId: admin.accountId,
      action: 'progression.publish',
      args: { published: result.published, problems: result.problems },
      result: result.ok ? 'ok' : 'denied',
    });
    if (!result.ok) return reply.code(422).send(result);
    return result;
  });

  // --- item content editors (A1-c, game P8) ---------------------------------
  /**
   * Items, loot tables and vendors share one editor surface and one publish
   * rail (they reference each other; shipping them apart ships dangling refs).
   * The three save routes are the same shape, so they are generated from one
   * table rather than copied — a copied route is a route that drifts.
   */
  const itemEditors = [
    { path: 'items', table: 'items' as ItemTableName, schema: itemDefSchema, save: saveItemDraft },
    {
      path: 'loot-tables',
      table: 'loot_tables' as ItemTableName,
      schema: lootTableDefSchema,
      save: saveLootTableDraft,
    },
    {
      path: 'vendors',
      table: 'vendors' as ItemTableName,
      schema: vendorDefSchema,
      save: saveVendorDraft,
    },
  ];

  app.get('/api/items', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { items: await listItems(dbHandle.db) };
  });

  app.get('/api/loot-tables', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { tables: await listLootTables(dbHandle.db) };
  });

  app.get('/api/vendors', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { vendors: await listVendors(dbHandle.db) };
  });

  for (const editor of itemEditors) {
    app.put(`/api/${editor.path}/:id`, async (request, reply) => {
      const admin = requireRole(request, reply, 'admin');
      if (!admin) return;
      const { id } = request.params as { id: string };
      const parsed = editor.schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; '),
        });
      }
      if (parsed.data.id !== id) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'Body id must match the URL.' });
      }
      // The union of the three defs is what the matching saver accepts; the
      // pairing is fixed by the table above, so the cast never widens.
      const { pruned } = await editor.save(dbHandle.db, parsed.data as never, admin.accountId);
      await audit({
        actorAccountId: admin.accountId,
        action: `${editor.table}.save_draft`,
        args: { id, pruned },
        target: id,
        result: 'ok',
      });
      return { ok: true, pruned };
    });

    app.delete(`/api/${editor.path}/:id/draft`, async (request, reply) => {
      const admin = requireRole(request, reply, 'admin');
      if (!admin) return;
      const { id } = request.params as { id: string };
      const removed = await discardItemDraft(dbHandle.db, editor.table, id);
      if (removed) {
        await audit({
          actorAccountId: admin.accountId,
          action: `${editor.table}.discard_draft`,
          target: id,
          result: 'ok',
        });
      }
      return { removed };
    });
  }

  // --- enemy content editors (A1-d, game P9) --------------------------------
  const firstIssueOf = (error: z.ZodError): string => {
    const issue = error.issues[0];
    return issue ? `${issue.path.join('.') || '<root>'}: ${issue.message}` : 'invalid';
  };

  /**
   * Enemies and spawners share one editor surface and one publish rail: a
   * spawner without its enemy is a camp that never populates, and an enemy
   * nothing spawns is invisible. Shipping them together is the only way the
   * cross-check can catch either.
   */
  app.get('/api/enemies', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { enemies: await listEnemies(dbHandle.db) };
  });

  app.get('/api/spawners', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return { spawners: await listSpawners(dbHandle.db) };
  });

  app.put('/api/enemies/:id', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const parsed = enemyDefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
    }
    if (parsed.data.id !== id) {
      return reply.code(400).send({ error: 'validation', message: 'id mismatch' });
    }
    // Row-level problems are refused at SAVE, not held until publish: an
    // editor should learn a charge cannot overshoot while looking at it.
    const problems = validateEnemyDef(parsed.data);
    if (problems.length > 0) {
      return reply.code(400).send({ error: 'validation', message: problems.join('; ') });
    }
    const { pruned } = await saveEnemyDraft(dbHandle.db, parsed.data, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'enemies.save',
      args: { id, pruned },
      result: 'ok',
    });
    return { ok: true, pruned };
  });

  app.put('/api/spawners/:id', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { id } = request.params as { id: string };
    const parsed = spawnerDefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; '),
      });
    }
    if (parsed.data.id !== id) {
      return reply.code(400).send({ error: 'validation', message: 'id mismatch' });
    }
    const { pruned } = await saveSpawnerDraft(dbHandle.db, parsed.data, admin.accountId);
    await audit({
      actorAccountId: admin.accountId,
      action: 'spawners.save',
      args: { id, pruned },
      result: 'ok',
    });
    return { ok: true, pruned };
  });

  app.delete('/api/enemies/:kind/:id/draft', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const { kind, id } = request.params as { kind: string; id: string };
    if (kind !== 'enemies' && kind !== 'spawners') {
      return reply.code(400).send({ error: 'validation', message: 'unknown kind' });
    }
    await discardEnemyDraft(dbHandle.db, kind, id);
    await audit({
      actorAccountId: admin.accountId,
      action: 'enemies.discard',
      args: { kind, id },
      result: 'ok',
    });
    return { ok: true };
  });

  /**
   * Time-to-kill, both ways, through the SAME shared selection rules the live
   * AI fights with — the combat equivalent of the loot simulator.
   */
  app.post('/api/enemies/ttk', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    const body = request.body as Record<string, unknown>;
    const parsed = enemyDefSchema.safeParse(body.def);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', message: firstIssueOf(parsed.error) });
    }
    const def = parsed.data;
    const num = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const playerClass = body.playerClass === 'rogue' ? 'rogue' : 'warrior';
    return {
      report: simulateTtk({
        def,
        enemyLevel: num(body.enemyLevel, def.levelMin),
        playerLevel: num(body.playerLevel, def.levelMin),
        playerClass,
        playerDps: num(body.playerDps, 40),
        distance: num(body.distance, 2),
      }),
      rotation: previewRotation(def, num(body.distance, 2), 12),
    };
  });

  app.get('/api/publish/enemies/diff', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return diffEnemies(dbHandle.db);
  });

  app.post('/api/publish/enemies', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const result = await publishEnemies(dbHandle.db, config);
    await audit({
      actorAccountId: admin.accountId,
      action: 'enemies.publish',
      args: { published: result.published, problems: result.problems },
      result: result.ok ? 'ok' : 'denied',
    });
    if (!result.ok) return reply.code(422).send(result);
    return result;
  });

  app.get('/api/publish/items/diff', async (request, reply) => {
    if (!requireRole(request, reply, 'gm')) return;
    return diffItems(dbHandle.db);
  });

  app.post('/api/publish/items', async (request, reply) => {
    const admin = requireRole(request, reply, 'admin');
    if (!admin) return;
    const result = await publishItems(dbHandle.db, config);
    await audit({
      actorAccountId: admin.accountId,
      action: 'items.publish',
      args: { published: result.published, problems: result.problems },
      result: result.ok ? 'ok' : 'denied',
    });
    if (!result.ok) return reply.code(422).send(result);
    return result;
  });

  // --- map editor (A2/A3) ---------------------------------------------------
  // Its own module: the editor's surface is as large as every content editor
  // put together, and mixing them would bury both.
  registerMapRoutes(app, { db: dbHandle.db, config, audit, requireRole });

  // --- static SPA (production build) ----------------------------------------
  // dist layout: dist/server/app.js (this file) beside dist/client/ (the SPA).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  if (config.NODE_ENV === 'production') {
    await app.register(fastifyStatic, {
      root: clientDist,
      index: ['index.html'],
      // Content-hashed bundles under /assets/ never change; index.html must
      // never be cached or a deploy leaves browsers holding an index that
      // references bundles which no longer exist (same rule as the game's
      // Caddyfile — a stale index is the next unexplained blank page).
      // cacheControl:false keeps the plugin's own max-age=0 default from
      // overwriting what setHeaders decides.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        res.setHeader(
          'cache-control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
    // Deep links (/content/world-settings) resolve to the SPA, API 404s stay
    // JSON. sendFile routes through fastifyStatic, so setHeaders above applies.
    // HEAD gets the same fallback GET does — link checkers and proxies probe
    // deep links with it.
    app.setNotFoundHandler((request, reply) => {
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !request.url.startsWith('/api/')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'No such route.' });
    });
  }

  return {
    app,
    dbHandle,
    auth,
    close: async () => {
      await app.close();
      await dbHandle.close();
    },
  };
};
