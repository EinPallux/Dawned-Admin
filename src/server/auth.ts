/**
 * Panel authentication against GAME accounts (docs/ARCHITECTURE.md §3):
 * argon2id verification of the same `accounts.pass_hash` the game wrote,
 * restricted to `gm`/`admin` roles, with server-side admin sessions
 * (`sessions.kind='admin'`, 12 h sliding) carried by an httpOnly
 * SameSite=Strict cookie. GMs and admins are a handful of trusted people —
 * the limiter mirrors the game's login window all the same.
 */

import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { accounts, sessions } from '@dawned/shared/schema';
import type { AdminRole, AdminUser } from '../shared-ext/api-types.js';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'dawned_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Sliding expiry writes are throttled to one per this interval per session. */
const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_LIMIT = 10;

/**
 * Burned when the account name is unknown so response timing doesn't reveal
 * which of name/password was wrong (same trick as the game's auth service).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$eSttbUJRemFtNXNXVWhCRQ$W2ZQjyH8ffHY6BkTYA1mDGH1FPGO1z6a3XGGxCFI2v0';

export type LoginResult =
  | { ok: true; token: string; user: AdminUser }
  | { ok: false; code: 'rate_limited' | 'invalid_credentials' | 'no_panel_access' | 'banned' };

interface WindowCounter {
  windowStart: number;
  count: number;
}

export class AdminAuth {
  private readonly loginByIp = new Map<string, WindowCounter>();

  constructor(private readonly db: Db) {}

  async login(name: string, password: string, ip: string): Promise<LoginResult> {
    if (!this.allowAttempt(ip)) return { ok: false, code: 'rate_limited' };

    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.name, name) });
    const valid = account
      ? await verifyHash(account.passHash, password)
      : await verifyHash(DUMMY_HASH, password).then(() => false);
    if (!account || !valid) return { ok: false, code: 'invalid_credentials' };
    if (account.status !== 'active') return { ok: false, code: 'banned' };
    // Role gate AFTER the password check: an authenticated player hearing
    // "no panel access" is honest UX; an attacker learns nothing new.
    if (account.role !== 'gm' && account.role !== 'admin') {
      return { ok: false, code: 'no_panel_access' };
    }

    const token = randomBytes(24).toString('hex');
    await this.db.insert(sessions).values({
      accountId: account.id,
      tokenHash: sha256Hex(token),
      kind: 'admin',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdIp: ip,
    });
    return {
      ok: true,
      token,
      user: { accountId: account.id, name: account.name, role: account.role },
    };
  }

  /** Resolve a cookie token to a live admin user; slides the expiry. */
  async verifySession(token: string): Promise<AdminUser | null> {
    if (token.length < 32) return null;
    const now = new Date();
    const row = await this.db.query.sessions.findFirst({
      where: and(
        eq(sessions.tokenHash, sha256Hex(token)),
        eq(sessions.kind, 'admin'),
        gt(sessions.expiresAt, now),
      ),
    });
    if (!row) return null;
    const account = await this.db.query.accounts.findFirst({
      where: eq(accounts.id, row.accountId),
    });
    if (!account || account.status !== 'active') return null;
    if (account.role !== 'gm' && account.role !== 'admin') return null;

    if (now.getTime() - row.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
        .where(eq(sessions.id, row.id));
    }
    return { accountId: account.id, name: account.name, role: account.role };
  }

  async logout(token: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), eq(sessions.kind, 'admin')));
  }

  /** Housekeeping: expired admin sessions (the game purges its own kind). */
  async purgeExpired(): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.kind, 'admin'), lt(sessions.expiresAt, sql`now()`)));
  }

  private allowAttempt(ip: string, now = Date.now()): boolean {
    const entry = this.loginByIp.get(ip);
    if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
      this.loginByIp.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= LOGIN_WINDOW_LIMIT) return false;
    entry.count++;
    return true;
  }
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

const verifyHash = async (storedHash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    // Malformed/unusable hashes (e.g. bot accounts) fail closed.
    return false;
  }
};

export const roleAtLeast = (role: AdminRole, required: AdminRole): boolean =>
  required === 'gm' ? true : role === 'admin';
