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
import { worldSettingsSchema } from '@dawned/shared';
import type { AdminUser, DashboardData } from '../shared-ext/api-types.js';
import type { Config } from './config.js';
import { createDb, assertSchemaPresent, type DbHandle } from './db.js';
import { AdminAuth, SESSION_COOKIE, roleAtLeast } from './auth.js';
import { createAuditWriter, type AuditWriter } from './audit.js';
import { probeGame, probeMetrics } from './game-status.js';
import { readWorldSettings, saveWorldSettingsDraft } from './world-settings.js';

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

  // --- static SPA (production build) ----------------------------------------
  // dist layout: dist/server/app.js (this file) beside dist/client/ (the SPA).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  if (config.NODE_ENV === 'production') {
    await app.register(fastifyStatic, { root: clientDist, index: ['index.html'] });
    // Deep links (/content/world-settings) resolve to the SPA, API 404s stay JSON.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
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
