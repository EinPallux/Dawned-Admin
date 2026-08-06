#!/usr/bin/env node
/**
 * Author the P8 launch catalogue THROUGH the panel API — the editor path end
 * to end (A1 DoD: "game P8's first 60 items are authored here start to
 * finish, icons enforced unique"). Provisions the dev admin account, logs into
 * the panel, PUTs every item, loot table and vendor as a DRAFT through the
 * same endpoints the Items page calls, then runs the item publish: validate →
 * cross-check (icons, refs, cycles, live enemy tables) → copy live → hot
 * reload the game.
 *
 * Enemy loot bindings ride along at the end: enemies have no editor yet (they
 * arrive with A1's enemy editor in P9), so their published rows are patched in
 * place — the one write here that does not go through the panel, and it is
 * limited to the `loot` field of rows that have none.
 *
 * Usage: node tools/content/author-items.mjs [http://localhost:8082]
 * Requires: admin API (pnpm dev) + the game repo's migrated Postgres.
 */

import pg from 'pg';
import argon2 from 'argon2';
import { ENEMY_LOOT, ITEM_DEFS, LOOT_TABLE_DEFS, VENDOR_DEFS } from './item-data.mjs';
import { DEEP_ITEM_DEFS, DEEP_LOOT_TABLES, DEEP_VENDOR_DEFS } from './item-data-deep.mjs';

// One script owns the WHOLE catalogue: T1–T2 shipped with P8, T3–T5 with
// P12-D, and the vendors are the same rows in both files' eyes — the P8 shops
// were anchored on the dev island and every one of them had to move.
const ALL_ITEMS = [...ITEM_DEFS, ...DEEP_ITEM_DEFS];
const ALL_TABLES = [...LOOT_TABLE_DEFS, ...DEEP_LOOT_TABLES];
const ALL_VENDORS = [
  ...VENDOR_DEFS.filter((v) => !DEEP_VENDOR_DEFS.some((d) => d.id === v.id)),
  ...DEEP_VENDOR_DEFS,
];

const BASE_URL = process.argv[2] ?? 'http://localhost:8082';
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const provision = async () => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );
  await db.end();
};

/**
 * Bind loot tables to the live enemy rows. Only fills bindings that are
 * missing, so a panel-tuned drop table is never overwritten by a re-run.
 */
const bindEnemyLoot = async () => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  let bound = 0;
  for (const entry of ENEMY_LOOT) {
    const result = await db.query(
      `UPDATE content_enemies
          SET def = jsonb_set(def, '{loot}', $2::jsonb)
        WHERE id = $1 AND status = 'published' AND COALESCE(def->'loot', 'null'::jsonb) = 'null'::jsonb`,
      [entry.enemyId, JSON.stringify(entry.loot)],
    );
    bound += result.rowCount ?? 0;
  }
  await db.end();
  return bound;
};

const main = async () => {
  console.log(`Authoring the P8 catalogue through the panel API → ${BASE_URL}\n`);
  await provision();
  ok(`admin account "${ACCOUNT}" provisioned`);

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dawned-admin': '1' },
    body: JSON.stringify({ name: ACCOUNT, password: PASSWORD }),
  });
  if (!login.ok) fail(`panel login failed (${login.status})`);
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const headers = { 'content-type': 'application/json', 'x-dawned-admin': '1', cookie };
  ok('panel session open');

  const put = async (path, def) => {
    const response = await fetch(`${BASE_URL}/api/${path}/${def.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(def),
    });
    if (!response.ok) fail(`${path} draft ${def.id} rejected: ${await response.text()}`);
  };

  for (const def of ALL_ITEMS) await put('items', def);
  ok(`${ALL_ITEMS.length} items saved as drafts (validated by the shared schema)`);

  for (const def of ALL_TABLES) await put('loot-tables', def);
  ok(`${ALL_TABLES.length} loot tables saved as drafts`);

  for (const def of ALL_VENDORS) await put('vendors', def);
  ok(`${ALL_VENDORS.length} vendors saved as drafts`);

  const diff = await fetch(`${BASE_URL}/api/publish/items/diff`, { headers });
  const pending = await diff.json();
  ok(
    `publish diff: ${pending.items.length} items + ${pending.loot.length} tables + ${pending.vendors.length} vendors pending`,
  );

  const publish = await fetch(`${BASE_URL}/api/publish/items`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const result = await publish.json();
  if (!publish.ok || !result.ok) {
    fail(`publish refused: ${JSON.stringify(result.problems ?? result, null, 2)}`);
  }
  ok(`published ${result.published} content rows`);
  for (const warning of result.warnings ?? []) console.log(`   ⚠️  ${warning}`);
  console.log(
    result.reload.ok
      ? `✅ game hot-reloaded: ${result.reload.note}`
      : `⚠️  game not reloaded (${result.reload.note})`,
  );

  const bound = await bindEnemyLoot();
  ok(`${bound} enemy loot binding(s) applied (already-bound rows left alone)`);
  if (bound > 0) {
    const reload = await fetch(`${BASE_URL}/api/publish/items/diff`, { headers });
    void reload; // the binding needs a content reload to reach the live world
    console.log('   ↻ run /ops/reload-content (or re-publish) so the world picks the bindings up');
  }

  console.log('\n🎒 The Dawnshore catalogue is live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
