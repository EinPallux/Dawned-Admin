/**
 * One admin session for a content-authoring run.
 *
 * Every `author-*` script talks to the panel API, and the panel only answers an
 * authenticated admin. Until this module existed each script did the same three
 * things inline: upsert an account called `zz_admin_smoke` with the password
 * `admin-smoke-pass-1`, log in, and leave the account behind.
 *
 * That is harmless in a throwaway dev container and unacceptable anywhere else —
 * the password is a literal in a public repository, so running a content script
 * against a real deployment installed a permanent admin backdoor whose
 * credentials anybody could read. `deploy/WORLD.sh` (game repo) exists precisely
 * so these scripts DO run against a real deployment, which is what turned a dev
 * shortcut into a live hole.
 *
 * Two modes, and the one a deployment uses mints nothing:
 *
 *  - **Credentials supplied** (`DAWNED_ADMIN_USER` + `DAWNED_ADMIN_PASS`) — log
 *    in as that account and never touch the `accounts` table at all. Every row
 *    the run publishes is then attributed to a real person in `audit_log`, which
 *    is the point of having an audit trail.
 *  - **Nothing supplied** (a dev box) — mint `zz_admin_content` with a password
 *    generated for this run and never printed, then ban it when the run ends.
 *
 * The per-run password is the part that actually holds: the close can be missed
 * (a crash, a `process.exit` from a `fail()`), and what survives is then an
 * account nobody can log into rather than one everybody can. Banning is hygiene
 * on top of that — the panel re-checks `accounts.status` on every request
 * (auth.ts), so it has to happen at the END of a run, never right after login.
 *
 * The account is deliberately NOT `zz_admin_smoke`: the browser smokes sign in
 * as that one with the known password, and a content run that banned it would
 * break every smoke on the box.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';

/** The throwaway account a dev run mints when no credentials are supplied. */
const DEV_ACCOUNT = 'zz_admin_content';

const DEFAULT_DATABASE_URL = 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

/**
 * Open a panel session.
 *
 * `close()` also runs automatically when the process finishes normally, so a
 * script that simply returns from `main()` cleans up without a `finally`.
 *
 * @param {string} baseUrl        panel API root, e.g. `http://127.0.0.1:8082`
 * @param {string} [databaseUrl]  only used by the dev fallback
 * @returns {Promise<{ account: string, minted: boolean, headers: Record<string, string>,
 *                     bare: Record<string, string>, close: () => Promise<void> }>}
 */
export const openAdminSession = async (
  baseUrl,
  databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
) => {
  const suppliedUser = process.env.DAWNED_ADMIN_USER;
  const suppliedPass = process.env.DAWNED_ADMIN_PASS;
  const minted = !(suppliedUser && suppliedPass);

  const account = minted ? DEV_ACCOUNT : suppliedUser;
  const password = minted ? `${randomUUID()}${randomUUID()}` : suppliedPass;

  if (minted) {
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      await db.query(
        `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
         ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
        [account, hash],
      );
    } finally {
      await db.end();
    }
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dawned-admin': '1' },
    body: JSON.stringify({ name: account, password }),
  });
  if (!login.ok) {
    throw new Error(
      minted
        ? `panel login failed (${login.status}) — is DATABASE_URL the same database the panel reads?`
        : `panel login failed (${login.status}) for DAWNED_ADMIN_USER="${account}" — check the password, and that the account has the admin role`,
    );
  }
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');

  const bare = { 'x-dawned-admin': '1', cookie };
  const headers = { 'content-type': 'application/json', ...bare };

  let closed = false;
  /**
   * End the run's access. Bans rather than deletes: content rows carry an
   * `updated_by` foreign key to this account, and the audit trail is worth more
   * than a tidy table.
   */
  const close = async () => {
    if (closed) return;
    closed = true;
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: bare }).catch(() => {});
    if (!minted) return;
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query(`UPDATE accounts SET status = 'banned' WHERE name = $1`, [account]);
    } finally {
      await db.end();
    }
  };

  // A clean finish closes itself: `beforeExit` fires with an empty loop and may
  // schedule more async work, which is exactly what this needs. It does NOT fire
  // on `process.exit()` — that path is covered by the password being disposable.
  process.on('beforeExit', () => {
    void close();
  });

  return { account, minted, headers, bare, close };
};
