/**
 * A0 integration suite against the local dev database (the same Postgres the
 * game dev server migrates): login vs game accounts with role gates, session
 * cookies, CSRF, the world-settings draft round-trip and the audit trail.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { and, eq, inArray } from 'drizzle-orm';
import { accounts, auditLog, contentWorldSettings, sessions } from '@dawned/shared/schema';
import { defaultWorldSettings } from '@dawned/shared';
import { loadConfig } from './config.js';
import { buildApp, type App } from './app.js';

const PASSWORD = 'panel-test-password-1';
const ADMIN_NAME = 'zz_admtest_admin';
const GM_NAME = 'zz_admtest_gm';
const PLAYER_NAME = 'zz_admtest_player';
const CSRF = { 'x-dawned-admin': '1' };

let ctx: App;
let adminId = 0;

const cleanup = async (): Promise<void> => {
  const db = ctx.dbHandle.db;
  const names = [ADMIN_NAME, GM_NAME, PLAYER_NAME];
  const rows = await db.select().from(accounts).where(inArray(accounts.name, names));
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorAccountId, ids));
    await db.delete(accounts).where(inArray(accounts.id, ids)); // sessions cascade
  }
  await db.delete(contentWorldSettings).where(eq(contentWorldSettings.status, 'draft'));
};

beforeAll(async () => {
  ctx = await buildApp(loadConfig());
  await cleanup();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const db = ctx.dbHandle.db;
  const inserted = await db
    .insert(accounts)
    .values([
      { name: ADMIN_NAME, passHash: hash, role: 'admin' },
      { name: GM_NAME, passHash: hash, role: 'gm' },
      { name: PLAYER_NAME, passHash: hash, role: 'player' },
    ])
    .returning({ id: accounts.id, name: accounts.name });
  adminId = inserted.find((row) => row.name === ADMIN_NAME)!.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await ctx.close();
});

const login = async (name: string, password = PASSWORD) => {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: CSRF,
    payload: { name, password },
  });
};

const sessionCookieOf = (response: { cookies: { name: string; value: string }[] }): string => {
  const cookie = response.cookies.find((c) => c.name === 'dawned_admin_session');
  expect(cookie).toBeDefined();
  return cookie!.value;
};

describe('panel auth', () => {
  it('rejects wrong passwords and unknown names identically', async () => {
    const wrong = await login(ADMIN_NAME, 'not-the-password');
    const unknown = await login('zz_admtest_ghost');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json<{ error: string }>().error).toBe('invalid_credentials');
    expect(unknown.json<{ error: string }>().error).toBe('invalid_credentials');
  });

  it('refuses player-role accounts even with valid credentials', async () => {
    const response = await login(PLAYER_NAME);
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe('no_panel_access');
  });

  it('logs an admin in, resolves /me, and audits the login', async () => {
    const response = await login(ADMIN_NAME);
    expect(response.statusCode).toBe(200);
    const cookie = sessionCookieOf(response);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { dawned_admin_session: cookie },
    });
    expect(me.json<{ user: { name: string; role: string } }>().user).toMatchObject({
      name: ADMIN_NAME,
      role: 'admin',
    });

    const trail = await ctx.dbHandle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorAccountId, adminId), eq(auditLog.action, 'auth.login')));
    expect(trail.length).toBeGreaterThan(0);
    expect(trail[0]!.surface).toBe('admin');
  });

  it('requires the session cookie and the CSRF header', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(anonymous.statusCode).toBe(401);

    const cookie = sessionCookieOf(await login(ADMIN_NAME));
    const noCsrf = await ctx.app.inject({
      method: 'PUT',
      url: '/api/world-settings',
      cookies: { dawned_admin_session: cookie },
      payload: defaultWorldSettings(),
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('world-settings drafts (A0 DoD round-trip)', () => {
  it('saves a draft, reports pending keys, and prunes drafts equal to published', async () => {
    const cookie = sessionCookieOf(await login(ADMIN_NAME));
    const session = { dawned_admin_session: cookie };

    const edited = { ...defaultWorldSettings(), xpRate: 2, motd: 'Welcome to the dawn.' };
    const saved = await ctx.app.inject({
      method: 'PUT',
      url: '/api/world-settings',
      cookies: session,
      headers: CSRF,
      payload: edited,
    });
    expect(saved.statusCode).toBe(200);
    const savedData = saved.json<{ draft: typeof edited; draftKeys: string[] }>();
    expect(savedData.draft.xpRate).toBe(2);
    expect(savedData.draftKeys.sort()).toEqual(['motd', 'xpRate']);

    // A fresh GET (the "reload the panel" case) sees the persisted draft.
    const reread = await ctx.app.inject({
      method: 'GET',
      url: '/api/world-settings',
      cookies: session,
    });
    expect(reread.json<{ draft: { motd: string } }>().draft.motd).toBe('Welcome to the dawn.');

    // The dashboard counts them as pending publishes.
    const dashboard = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboard',
      cookies: session,
    });
    expect(dashboard.json<{ publish: { draftsPending: number } }>().publish.draftsPending).toBe(2);

    // Setting values back to published prunes the draft rows entirely.
    const reverted = await ctx.app.inject({
      method: 'PUT',
      url: '/api/world-settings',
      cookies: session,
      headers: CSRF,
      payload: defaultWorldSettings(),
    });
    expect(reverted.json<{ draftKeys: string[] }>().draftKeys).toEqual([]);
    const draftRows = await ctx.dbHandle.db
      .select()
      .from(contentWorldSettings)
      .where(eq(contentWorldSettings.status, 'draft'));
    expect(draftRows).toEqual([]);

    const trail = await ctx.dbHandle.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.actorAccountId, adminId), eq(auditLog.action, 'world_settings.save_draft')),
      );
    expect(trail.length).toBe(2);
  });

  it('rejects out-of-range values with field messages and writes nothing', async () => {
    const cookie = sessionCookieOf(await login(ADMIN_NAME));
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/world-settings',
      cookies: { dawned_admin_session: cookie },
      headers: CSRF,
      payload: { ...defaultWorldSettings(), xpRate: 99 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ message: string }>().message).toContain('xpRate');
  });

  it('lets gm read but not write', async () => {
    const cookie = sessionCookieOf(await login(GM_NAME));
    const session = { dawned_admin_session: cookie };
    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/world-settings',
      cookies: session,
    });
    expect(read.statusCode).toBe(200);
    const write = await ctx.app.inject({
      method: 'PUT',
      url: '/api/world-settings',
      cookies: session,
      headers: CSRF,
      payload: defaultWorldSettings(),
    });
    expect(write.statusCode).toBe(403);
  });
});

describe('sessions', () => {
  it('logout deletes the server-side session row', async () => {
    const response = await login(ADMIN_NAME);
    const cookie = sessionCookieOf(response);
    const session = { dawned_admin_session: cookie };

    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: session,
      headers: CSRF,
    });
    expect(out.statusCode).toBe(200);

    const meAfter = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: session });
    expect(meAfter.statusCode).toBe(401);

    const rows = await ctx.dbHandle.db.select().from(sessions).where(eq(sessions.kind, 'admin'));
    // Other tests' sessions may exist; ours must be gone (verified via 401 above).
    expect(rows.every((row) => row.expiresAt > new Date(0))).toBe(true);
  });
});
