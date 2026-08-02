#!/usr/bin/env node
/**
 * CI-only schema bootstrap: applies the game repo's migrations, which ship
 * inside the installed @dawned/shared package (its `drizzle/` folder). On the
 * VPS the GAME repo's UPDATE.sh owns migrations — this script exists so the
 * panel's CI can test against a real schema without cloning the game repo.
 * (Deliberately NOT named db:migrate: UPDATE.sh greps for that script name to
 * decide who migrates, and the answer must stay "the game".)
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned',
});
await migrate(drizzle(pool), { migrationsFolder: 'node_modules/@dawned/shared/drizzle' });
await pool.end();
console.log('migrations applied (from @dawned/shared/drizzle)');
