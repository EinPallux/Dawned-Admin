/**
 * A0 integration suite against the local dev database (the same Postgres the
 * game dev server migrates): login vs game accounts with role gates, session
 * cookies, CSRF, the world-settings draft round-trip and the audit trail.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { and, eq, inArray } from 'drizzle-orm';
import {
  accounts,
  auditLog,
  contentAbilities,
  contentItems,
  contentLootTables,
  contentVendors,
  contentWorldSettings,
  sessions,
} from '@dawned/shared/schema';
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
    // Content rows saved by fixture admins reference them (updated_by FK) —
    // the A1 suite's published fixture must go before the accounts can.
    // Published copies carry NO updated_by (the pipeline inserts them fresh),
    // so the zz fixture ids are removed explicitly too.
    await db.delete(contentAbilities).where(inArray(contentAbilities.updatedBy, ids));
    await db
      .delete(contentAbilities)
      .where(
        inArray(contentAbilities.id, [
          'ability_mage_zz_test_bolt',
          'ability_mage_zz_test_clash',
          'ability_mage_zz_test_clash2',
        ]),
      );
    await db.delete(contentWorldSettings).where(inArray(contentWorldSettings.updatedBy, ids));
    // Same story for the A1-c fixtures (items/loot/vendors carry updated_by).
    await db.delete(contentItems).where(inArray(contentItems.updatedBy, ids));
    await db.delete(contentLootTables).where(inArray(contentLootTables.updatedBy, ids));
    await db.delete(contentVendors).where(inArray(contentVendors.updatedBy, ids));
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

/**
 * One admin session SHARED by the content suites (abilities + progression):
 * the login limiter allows 10/min per IP and the whole file must fit inside
 * one window — every content test reuses this cookie instead of logging in.
 */
let contentSessionCookie: string | null = null;
const contentSession = async (): Promise<Record<string, string>> => {
  contentSessionCookie ??= sessionCookieOf(await login(ADMIN_NAME));
  return { dawned_admin_session: contentSessionCookie };
};

// The login rate limiter counts per IP, and the whole suite shares one — so
// the read-only-role checks share ONE gm login instead of each buying their own.
let gmSessionCookie: string | null = null;
const gmSession = async (): Promise<Record<string, string>> => {
  gmSessionCookie ??= sessionCookieOf(await login(GM_NAME));
  return { dawned_admin_session: gmSessionCookie };
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
    const session = await gmSession();
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

describe('ability drafts + publish v1 (A1)', () => {
  // One login for the whole suite — the auth rate limiter caps per-minute
  // attempts, and every earlier suite already spent some of the budget.
  let session: Record<string, string>;
  beforeAll(async () => {
    session = await contentSession();
    // Idempotent reruns: drop BOTH statuses of the fixture ids — a published
    // row from a previous run would make the identical draft prune on save.
    const { inArray } = await import('drizzle-orm');
    const { contentAbilities } = await import('@dawned/shared/schema');
    await ctx.dbHandle.db
      .delete(contentAbilities)
      .where(
        inArray(contentAbilities.id, [
          'ability_mage_zz_test_bolt',
          'ability_mage_zz_test_clash',
          'ability_mage_zz_test_clash2',
        ]),
      );
  });

  // Since P6 the kit seed migrations fill EVERY class×slot pair (all four
  // classes, slots 1–8) with published content, in dev and CI alike — no slot
  // is ever free for a fixture. The happy-path fixture is therefore rmb-bound:
  // rmb rows are outside the slot cross-check and none exist as content
  // (stances are engine-level), so it publishes cleanly without touching live
  // rows. The collision test saves TWO zz drafts on the same slot so they
  // collide with each other no matter what real content owns that slot.
  const TEST_ID = 'ability_mage_zz_test_bolt';
  const def = {
    id: TEST_ID,
    classId: 'mage',
    binding: { kind: 'rmb' },
    name: 'ZZ Test Bolt',
    unlockLevel: 1,
    cost: { type: 'mana', amount: 25 },
    cooldownMs: 9000,
    targeting: { kind: 'projectile', speed: 28, radius: 0.25, maxRange: 30 },
    effects: [{ kind: 'damage', coef: 1.4, school: 'magic' }],
    anim: { clip: 'Spell_Simple_Shoot', clipSeconds: 0.5, durationMs: 600 },
  };

  it('rejects invalid defs with field-level messages', async () => {
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/api/abilities/${TEST_ID}`,
      cookies: session,
      headers: CSRF,
      payload: { ...def, cost: { type: 'energy', amount: 25 } }, // energy on a mage
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ message: string }>().message).toContain('energy costs are Rogue-only');
  });

  it('saves a draft, diffs it, publishes it, and prunes matching drafts', async () => {
    const saved = await ctx.app.inject({
      method: 'PUT',
      url: `/api/abilities/${TEST_ID}`,
      cookies: session,
      headers: CSRF,
      payload: def,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ draft: { id: string } | null }>().draft?.id).toBe(TEST_ID);

    const diff = await ctx.app.inject({
      method: 'GET',
      url: '/api/publish/abilities/diff',
      cookies: session,
    });
    const entries = diff.json<{ entries: { id: string; kind: string }[] }>().entries;
    expect(entries.some((entry) => entry.id === TEST_ID && entry.kind === 'added')).toBe(true);

    // Publish: draft becomes the published row; the game-reload poke may fail
    // in tests (no game server) — the publish itself must still land.
    const published = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/abilities',
      cookies: session,
      headers: CSRF,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json<{ ok: boolean; published: number }>().ok).toBe(true);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/abilities/${TEST_ID}`,
      cookies: session,
    });
    const body = detail.json<{ draft: unknown; published: { id: string } | null }>();
    expect(body.draft).toBeNull();
    expect(body.published?.id).toBe(TEST_ID);

    // Re-saving the identical def prunes rather than creating a no-op draft.
    const resaved = await ctx.app.inject({
      method: 'PUT',
      url: `/api/abilities/${TEST_ID}`,
      cookies: session,
      headers: CSRF,
      payload: def,
    });
    expect(resaved.json<{ draft: unknown }>().draft).toBeNull();
  });

  it('publish refuses slot collisions across the would-be set', async () => {
    // Both drafts claim mage:8, so they collide with each other (and with the
    // seeded kit row that owns the slot) — the refusal never depends on which.
    const clashes = ['ability_mage_zz_test_clash', 'ability_mage_zz_test_clash2'].map(
      (id, index) => ({
        ...def,
        id,
        name: `ZZ Clash ${index + 1}`,
        binding: { kind: 'slot', slot: 8 },
      }),
    );
    for (const clash of clashes) {
      const saved = await ctx.app.inject({
        method: 'PUT',
        url: `/api/abilities/${clash.id}`,
        cookies: session,
        headers: CSRF,
        payload: clash,
      });
      expect(saved.statusCode).toBe(200);
    }
    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/abilities',
      cookies: session,
      headers: CSRF,
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ problems: string[] }>().problems.join(' ')).toContain('slot mage:8');

    // Clean up the clash drafts so reruns stay deterministic.
    for (const clash of clashes) {
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/abilities/${clash.id}/draft`,
        cookies: session,
        headers: CSRF,
      });
    }
  });
});

describe('progression editors + publish (A1-b, game P7)', () => {
  let session: Record<string, string>;
  beforeAll(async () => {
    session = await contentSession();
  });

  it('lists the seeded curve and trees', async () => {
    const curve = await ctx.app.inject({ method: 'GET', url: '/api/xp-curve', cookies: session });
    expect(curve.json<{ entries: { level: number }[] }>().entries.length).toBe(29);
    const nodes = await ctx.app.inject({
      method: 'GET',
      url: '/api/skill-nodes',
      cookies: session,
    });
    expect(nodes.json<{ nodes: { id: string }[] }>().nodes.length).toBeGreaterThanOrEqual(96);
  });

  it('rejects curve rows whose id and level disagree', async () => {
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: '/api/xp-curve/xp_l05',
      cookies: session,
      headers: CSRF,
      payload: { id: 'xp_l05', level: 7, xpToNext: 1500 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ message: string }>().message).toContain('does not match');
  });

  it('saves and discards node drafts without touching the published row', async () => {
    const nodeId = 'node_warrior_bulwark_toughened';
    const detail = await ctx.app.inject({
      method: 'GET',
      url: '/api/skill-nodes',
      cookies: session,
    });
    const live = detail
      .json<{ nodes: { id: string; def: Record<string, unknown> }[] }>()
      .nodes.find((entry) => entry.id === nodeId);
    expect(live).toBeDefined();
    const tweaked = {
      ...live!.def,
      ranks: [
        [{ kind: 'stat', mods: { maxHpPct: 4 } }],
        [{ kind: 'stat', mods: { maxHpPct: 8 } }],
        [{ kind: 'stat', mods: { maxHpPct: 12 } }],
      ],
    };
    const saved = await ctx.app.inject({
      method: 'PUT',
      url: `/api/skill-nodes/${nodeId}`,
      cookies: session,
      headers: CSRF,
      payload: tweaked,
    });
    expect(saved.statusCode).toBe(200);
    const diff = await ctx.app.inject({
      method: 'GET',
      url: '/api/publish/progression/diff',
      cookies: session,
    });
    expect(
      diff
        .json<{ nodes: { id: string; kind: string }[] }>()
        .nodes.some((entry) => entry.id === nodeId && entry.kind === 'changed'),
    ).toBe(true);
    const discarded = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/skill-nodes/${nodeId}/draft`,
      cookies: session,
      headers: CSRF,
    });
    expect(discarded.json<{ removed: boolean }>().removed).toBe(true);
  });

  it('publish refuses unknown ability refs and lattice cell collisions', async () => {
    const nodeId = 'node_warrior_bulwark_toughened';
    const list = await ctx.app.inject({ method: 'GET', url: '/api/skill-nodes', cookies: session });
    const live = list
      .json<{ nodes: { id: string; def: Record<string, unknown> }[] }>()
      .nodes.find((entry) => entry.id === nodeId)!;

    // Unknown ability reference → 422, nothing published, live row untouched.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/skill-nodes/${nodeId}`,
      cookies: session,
      headers: CSRF,
      payload: {
        ...live.def,
        ranks: [
          [
            {
              kind: 'ability_mod',
              abilityId: 'ability_warrior_zz_missing',
              mods: { damagePct: 1 },
            },
          ],
          [
            {
              kind: 'ability_mod',
              abilityId: 'ability_warrior_zz_missing',
              mods: { damagePct: 2 },
            },
          ],
          [
            {
              kind: 'ability_mod',
              abilityId: 'ability_warrior_zz_missing',
              mods: { damagePct: 3 },
            },
          ],
        ],
      },
    });
    const refusedRef = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/progression',
      cookies: session,
      headers: CSRF,
    });
    expect(refusedRef.statusCode).toBe(422);
    expect(refusedRef.json<{ problems: string[] }>().problems.join(' ')).toContain(
      'ability_warrior_zz_missing',
    );

    // Cell collision: moving the node onto Plated's order slot must refuse.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/skill-nodes/${nodeId}`,
      cookies: session,
      headers: CSRF,
      payload: { ...live.def, order: 2 },
    });
    const refusedCell = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/progression',
      cookies: session,
      headers: CSRF,
    });
    expect(refusedCell.statusCode).toBe(422);
    expect(refusedCell.json<{ problems: string[] }>().problems.join(' ')).toContain(
      'warrior/bulwark#2',
    );

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/skill-nodes/${nodeId}/draft`,
      cookies: session,
      headers: CSRF,
    });
  });
});

describe('item editors + publish (A1-c, game P8)', () => {
  let session: Record<string, string>;

  const ITEM_A = 'item_zz_test_shell';
  const ITEM_B = 'item_zz_test_twin';
  const TABLE_A = 'loot_zz_test_trash';
  const VENDOR_A = 'vendor_zz_test_post';

  const itemDraft = (id: string, icon: string) => ({
    id,
    name: 'ZZ Test Shell',
    category: 'junk',
    stack: 50,
    value: 8,
    icon,
  });

  const wipeFixtures = async () => {
    const db = ctx.dbHandle.db;
    await db.delete(contentItems).where(inArray(contentItems.id, [ITEM_A, ITEM_B]));
    await db.delete(contentLootTables).where(eq(contentLootTables.id, TABLE_A));
    await db.delete(contentVendors).where(eq(contentVendors.id, VENDOR_A));
  };

  beforeAll(async () => {
    session = await contentSession();
    await wipeFixtures();
  });

  afterAll(wipeFixtures);

  it('rejects defs the shared schema refuses, with field messages', async () => {
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_A}`,
      cookies: session,
      headers: CSRF,
      // A junk item may not carry an equip slot (§1 taxonomy rule).
      payload: { ...itemDraft(ITEM_A, 'sea-shell'), slot: 'chest' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ message: string }>().message).toContain('not equippable');
  });

  it('saves drafts, reports them in the diff, and prices the budget', async () => {
    const saved = await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_A}`,
      cookies: session,
      headers: CSRF,
      payload: itemDraft(ITEM_A, 'sea-shell'),
    });
    expect(saved.statusCode).toBe(200);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/items', cookies: session });
    const row = list
      .json<{ items: { id: string; hasDraft: boolean; budget: { value: number } }[] }>()
      .items.find((entry) => entry.id === ITEM_A);
    expect(row?.hasDraft).toBe(true);
    // Junk has no slot budget, so the ƒ-suggested value comes off the ilvl floor.
    expect(row?.budget.value).toBeGreaterThan(0);

    const diff = await ctx.app.inject({
      method: 'GET',
      url: '/api/publish/items/diff',
      cookies: session,
    });
    expect(
      diff
        .json<{ items: { id: string; kind: string }[] }>()
        .items.some((entry) => entry.id === ITEM_A && entry.kind === 'added'),
    ).toBe(true);
  });

  it('publish refuses duplicate icons, dangling refs and loot cycles', async () => {
    // Two items, one icon → §8 identity rule.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_B}`,
      cookies: session,
      headers: CSRF,
      payload: itemDraft(ITEM_B, 'sea-shell'),
    });
    const dupeIcon = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/items',
      cookies: session,
      headers: CSRF,
    });
    expect(dupeIcon.statusCode).toBe(422);
    expect(dupeIcon.json<{ problems: string[] }>().problems.join(' ')).toContain('icon');

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_B}`,
      cookies: session,
      headers: CSRF,
      payload: itemDraft(ITEM_B, 'zz-twin-icon'),
    });

    // A table dropping an item that does not exist.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/loot-tables/${TABLE_A}`,
      cookies: session,
      headers: CSRF,
      payload: {
        id: TABLE_A,
        name: 'ZZ Trash',
        entries: [{ kind: 'item', ref: 'item_zz_does_not_exist', weight: 1 }],
      },
    });
    const dangling = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/items',
      cookies: session,
      headers: CSRF,
    });
    expect(dangling.statusCode).toBe(422);
    expect(dangling.json<{ problems: string[] }>().problems.join(' ')).toContain(
      'item_zz_does_not_exist',
    );

    // A table that nests itself.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/loot-tables/${TABLE_A}`,
      cookies: session,
      headers: CSRF,
      payload: {
        id: TABLE_A,
        name: 'ZZ Trash',
        entries: [{ kind: 'table', ref: TABLE_A, weight: 1 }],
      },
    });
    const cyclic = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/items',
      cookies: session,
      headers: CSRF,
    });
    expect(cyclic.statusCode).toBe(422);
    expect(cyclic.json<{ problems: string[] }>().problems.join(' ')).toContain('loops back');

    // A vendor stocking an unknown item.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/loot-tables/${TABLE_A}`,
      cookies: session,
      headers: CSRF,
      payload: {
        id: TABLE_A,
        name: 'ZZ Trash',
        entries: [
          { kind: 'item', ref: ITEM_A, weight: 3, minQty: 1, maxQty: 2 },
          { kind: 'nothing', weight: 7 },
        ],
      },
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/vendors/${VENDOR_A}`,
      cookies: session,
      headers: CSRF,
      payload: {
        id: VENDOR_A,
        name: 'ZZ Post',
        kind: 'general',
        stock: [{ itemId: 'item_zz_also_missing' }],
      },
    });
    const badStock = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/items',
      cookies: session,
      headers: CSRF,
    });
    expect(badStock.statusCode).toBe(422);
    expect(badStock.json<{ problems: string[] }>().problems.join(' ')).toContain(
      'item_zz_also_missing',
    );
  });

  it('publishes all three tables together and prunes the drafts', async () => {
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/vendors/${VENDOR_A}`,
      cookies: session,
      headers: CSRF,
      payload: {
        id: VENDOR_A,
        name: 'ZZ Post',
        kind: 'general',
        stock: [{ itemId: ITEM_A }],
        anchor: { x: 0, z: 0, radius: 3 },
      },
    });
    const result = await ctx.app.inject({
      method: 'POST',
      url: '/api/publish/items',
      cookies: session,
      headers: CSRF,
    });
    expect(result.statusCode).toBe(200);
    const body = result.json<{ published: number; warnings: string[] }>();
    expect(body.published).toBeGreaterThanOrEqual(4);

    const db = ctx.dbHandle.db;
    const rows = await db.select().from(contentItems).where(eq(contentItems.id, ITEM_A));
    expect(rows.map((row) => row.status)).toEqual(['published']);
    const tables = await db
      .select()
      .from(contentLootTables)
      .where(eq(contentLootTables.id, TABLE_A));
    expect(tables.map((row) => row.status)).toEqual(['published']);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/publish/items/diff',
      cookies: session,
    });
    const diff = after.json<{ items: unknown[]; loot: unknown[]; vendors: unknown[] }>();
    expect(diff.items.length + diff.loot.length + diff.vendors.length).toBe(0);
  });

  it('prunes a draft that matches the published row instead of storing it', async () => {
    const identical = await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_A}`,
      cookies: session,
      headers: CSRF,
      payload: itemDraft(ITEM_A, 'sea-shell'),
    });
    expect(identical.json<{ pruned: boolean }>().pruned).toBe(true);
  });

  it('lets gm read the catalogue but not write it', async () => {
    const gm = await gmSession();
    const read = await ctx.app.inject({ method: 'GET', url: '/api/items', cookies: gm });
    expect(read.statusCode).toBe(200);
    const write = await ctx.app.inject({
      method: 'PUT',
      url: `/api/items/${ITEM_A}`,
      cookies: gm,
      headers: CSRF,
      payload: itemDraft(ITEM_A, 'zz-gm-icon'),
    });
    expect(write.statusCode).toBe(403);
  });
});
