/**
 * Database access — drizzle against the SHARED schema (the game repo owns the
 * definition and the migrations; this app refuses to boot against a database
 * that hasn't been migrated by the game's pipeline).
 */

import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@dawned/shared/schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export const createDb = (databaseUrl: string): DbHandle => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
};

/** The tables A0 depends on must exist — their migration ships with the game repo. */
export const assertSchemaPresent = async (handle: DbHandle): Promise<void> => {
  const result = await handle.pool.query<{ accounts: string | null; audit: string | null }>(
    "SELECT to_regclass('public.accounts')::text AS accounts, to_regclass('public.audit_log')::text AS audit",
  );
  const row = result.rows[0];
  if (!row?.accounts || !row.audit) {
    throw new Error(
      'Database schema missing (accounts/audit_log). Run the game repo migrations first: ' +
        'cd ../game && pnpm db:migrate (dev: start the game server once).',
    );
  }
};
