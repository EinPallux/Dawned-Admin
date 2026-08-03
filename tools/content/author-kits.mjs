#!/usr/bin/env node
/**
 * Author the P5 class kits THROUGH the panel API — the editor path end to
 * end (P5 DoD: "ability content rows authored via admin editor"). Provisions
 * the dev admin account, logs into the panel, PUTs every kit def as a DRAFT
 * (the same endpoint the Abilities page calls), then runs publish v1 —
 * validate → copy live → hot-reload the game server.
 *
 * Usage: node tools/content/author-kits.mjs [http://localhost:8082]
 * Requires: admin API (pnpm dev) + the game repo's migrated Postgres; the
 * game server may be up (reload reported) or down (rows apply at next boot).
 */

import pg from 'pg';
import argon2 from 'argon2';
import { KIT_DEFS } from './kits-data.mjs';

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

const main = async () => {
  console.log(`Authoring P5 kits through the panel API → ${BASE_URL}\n`);
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

  let saved = 0;
  for (const def of KIT_DEFS) {
    const response = await fetch(`${BASE_URL}/api/abilities/${def.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(def),
    });
    if (!response.ok) {
      const body = await response.text();
      fail(`draft ${def.id} rejected: ${body}`);
    }
    saved++;
  }
  ok(`${saved} kit defs saved as drafts (validated by the shared schema)`);

  const diff = await fetch(`${BASE_URL}/api/publish/abilities/diff`, { headers });
  const entries = (await diff.json()).entries;
  ok(`publish diff: ${entries.length} pending`);

  const publish = await fetch(`${BASE_URL}/api/publish/abilities`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const result = await publish.json();
  if (!publish.ok || !result.ok) {
    fail(`publish refused: ${JSON.stringify(result.problems ?? result)}`);
  }
  ok(`published ${result.published} abilities`);
  console.log(
    result.reload.ok
      ? `✅ game hot-reloaded: ${result.reload.note}`
      : `⚠️  game not reloaded (${result.reload.note})`,
  );
  console.log('\n⚔️  Kits are live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
