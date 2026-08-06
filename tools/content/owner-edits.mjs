/**
 * Never overwrite something the owner changed in the panel.
 *
 * Every `author-*` script rewrites every row it owns on every run. That was
 * harmless while they only ran on a throwaway dev box; `deploy/WORLD.sh` runs
 * them on the LIVE server and `UPDATE.sh` runs them whenever authored content
 * changes, so without this a value retuned in the panel would be silently
 * reverted to whatever the data file says — on every deploy, for ever. Owner's
 * instruction, 2026-08-06: "nothing of my stuff I changed in the Database (via
 * Admin Suite) should be overwritten".
 *
 * The mechanism is one hash per published row in `content_authored`
 * (game migration 0021), written by the script AFTER it publishes:
 *
 *   live hash === recorded hash   nobody touched it since → safe to rewrite
 *   live hash !== recorded hash   a person edited it      → keep theirs, report
 *   nothing recorded              never managed by a script → adopt once,
 *                                 record, so the NEXT run can tell
 *
 * The adopt-once case is the honest cost of adding this after the fact: the
 * first run has no record to compare against and cannot invent one. It is a
 * single window, it is reported on screen, and every run after it protects.
 *
 * `--force-authored` overrides the guard for the run — for when a phase
 * deliberately re-authors something the owner had tuned, and both people agree.
 */

import { createHash } from 'node:crypto';
import pg from 'pg';

const DEFAULT_DATABASE_URL = 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

/**
 * A hash that does not care about key order.
 *
 * Postgres normalises jsonb key order on write, so the object a script sends and
 * the object it reads back are equal in meaning and different in bytes. Hashing
 * `JSON.stringify` of either would report every row as owner-edited on the first
 * comparison — the same trap the draft-pruning bug fell into (A1-c).
 */
export const stableHash = (value) => {
  const canonical = (input) => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, canonical(input[key])]),
      );
    }
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
};

/**
 * @param {string} kind   the publish rail: 'items' | 'enemies' | 'quests' | …
 * @param {string} table  the published table to read live rows from
 * @param {object} [opts]
 * @param {string} [opts.databaseUrl]
 * @param {boolean} [opts.force]  ignore the guard for this run
 */
export const ownerEditGuard = async (kind, table, opts = {}) => {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const force = opts.force ?? process.argv.includes('--force-authored');

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();

  // The table name cannot be a bound parameter, so it is checked against the
  // set this module knows rather than interpolated on trust. Every caller passes
  // a literal today; a typo should fail here, not compose SQL.
  const TABLES = new Set([
    'content_items',
    'content_loot_tables',
    'content_vendors',
    'content_enemies',
    'content_spawners',
    'content_quests',
    'content_npcs',
    'content_resource_nodes',
    'content_abilities',
    'content_skill_nodes',
  ]);
  if (!TABLES.has(table)) throw new Error(`ownerEditGuard: unknown table "${table}"`);

  const live = new Map();
  const authored = new Map();
  try {
    const rows = await db.query(`select id, def from ${table} where status = 'published'`);
    for (const row of rows.rows) {
      live.set(row.id, typeof row.def === 'string' ? JSON.parse(row.def) : row.def);
    }
    const marks = await db.query(`select row_id, hash from content_authored where kind = $1`, [
      kind,
    ]);
    for (const row of marks.rows) authored.set(row.row_id, row.hash);
  } finally {
    await db.end();
  }

  const kept = [];
  const adopted = [];
  const pending = new Map();

  return {
    force,
    /** May the script write this row? Records what it intends to write. */
    mayWrite(id, def) {
      const liveDef = live.get(id);
      if (liveDef === undefined) {
        pending.set(id, stableHash(def));
        return true; // brand-new content — nothing to overwrite
      }
      const recorded = authored.get(id);
      const liveHash = stableHash(liveDef);
      if (recorded === undefined) {
        adopted.push(id);
        pending.set(id, stableHash(def));
        return true;
      }
      if (recorded === liveHash || force) {
        pending.set(id, stableHash(def));
        return true;
      }
      kept.push(id);
      return false;
    },
    /**
     * Record what this run actually published. Call AFTER a successful publish —
     * recording before it would claim ownership of rows a refused publish never
     * wrote, and the next run would then happily overwrite the owner's version.
     */
    async commit() {
      if (pending.size === 0) return 0;
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        for (const [id, hash] of pending) {
          await client.query(
            `insert into content_authored (kind, row_id, hash, authored_at)
             values ($1, $2, $3, now())
             on conflict (kind, row_id) do update set hash = $3, authored_at = now()`,
            [kind, id, hash],
          );
        }
      } finally {
        await client.end();
      }
      return pending.size;
    },
    report() {
      if (adopted.length > 0) {
        console.log(
          `   ℹ️  ${adopted.length} ${kind} row(s) adopted into change-tracking (first run only —` +
            ` edits made from here on are protected)`,
        );
      }
      if (kept.length > 0) {
        console.log(
          `   🛡️  ${kept.length} ${kind} row(s) left alone — edited in the panel since this ` +
            `script last wrote them:`,
        );
        for (const id of kept.slice(0, 12)) console.log(`        ${id}`);
        if (kept.length > 12) console.log(`        …and ${kept.length - 12} more`);
        console.log('        Re-run with --force-authored to overwrite them anyway.');
      }
      return { kept, adopted };
    },
  };
};
