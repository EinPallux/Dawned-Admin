#!/usr/bin/env node
/**
 * Author the P9 bestiary THROUGH the panel API — the editor path end to end.
 * Provisions the dev admin account, logs into the panel, PUTs every enemy and
 * spawner as a DRAFT through the same endpoints the Enemies page calls, then
 * runs the enemy publish: validate → cross-check (clips, loot refs, spawner
 * refs, archetype sanity) → copy live → hot-reload the game.
 *
 * It also runs the TTK simulator over every published enemy afterwards and
 * prints the table, so a content change is never merged without someone
 * having looked at what it does to the fights.
 *
 * Usage: node tools/content/author-bestiary.mjs [http://localhost:8082]
 * Requires: admin API (pnpm dev) + the game repo's migrated Postgres.
 */

import pg from 'pg';
import argon2 from 'argon2';
import { ENEMY_DEFS, SPAWNER_DEFS } from './bestiary-data.mjs';

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
  console.log(`Dawned bestiary authoring → ${BASE_URL}\n`);
  await provision();

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
    return response.json();
  };

  let pruned = 0;
  for (const def of ENEMY_DEFS) {
    const result = await put('enemies', def);
    if (result.pruned) pruned++;
  }
  ok(`${ENEMY_DEFS.length} enemies saved as drafts (${pruned} already matched live and pruned)`);

  for (const def of SPAWNER_DEFS) await put('spawners', def);
  ok(`${SPAWNER_DEFS.length} spawners saved as drafts`);

  const diff = await (await fetch(`${BASE_URL}/api/publish/enemies/diff`, { headers })).json();
  const pending = diff.enemies.length + diff.spawners.length;
  ok(`publish diff: ${diff.enemies.length} enemies + ${diff.spawners.length} spawners pending`);
  if (pending === 0) {
    console.log('\nNothing to publish — the live bestiary already matches this file.\n');
    return;
  }

  const publish = await fetch(`${BASE_URL}/api/publish/enemies`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const result = await publish.json();
  if (!publish.ok || !result.ok) {
    fail(`publish refused:\n${(result.problems ?? []).map((p) => `   • ${p}`).join('\n')}`);
  }
  ok(`published ${result.published} content rows`);
  for (const warning of result.warnings ?? []) console.log(`   ⚠️  ${warning}`);
  console.log(
    result.reload.ok
      ? `✅ game hot-reloaded: ${result.reload.note}`
      : `⚠️  game not reloaded (${result.reload.note})`,
  );

  // --- what did we just make the fights into? ------------------------------
  const live = await (await fetch(`${BASE_URL}/api/enemies`, { headers })).json();
  console.log('\n  enemy                     lvl  archetype  hp     kill    dies   rotation');
  console.log('  ' + '-'.repeat(78));
  for (const row of live.enemies) {
    if (row.def.archetype === 'dummy') continue;
    const distance = row.def.archetype === 'ranged' || row.def.archetype === 'caster' ? 10 : 2;
    const body = {
      def: row.def,
      enemyLevel: row.levelMin,
      playerLevel: row.levelMin,
      playerClass: 'warrior',
      // Melee damage a BUILT character of that level actually puts out. The
      // game's browser-p9 run measured 78 dps for a level-12 warrior with every
      // attribute point spent and published T2 gear, which this line is anchored
      // to. The anchor matters more than it looks: the same warrior with its 33
      // points UNSPENT does 30, and a table built on a guessed number can be 3×
      // off and send someone re-balancing a boss that was fine.
      playerDps: Math.round(6.5 * row.levelMin),
      distance,
    };
    const { report } = await (
      await fetch(`${BASE_URL}/api/enemies/ttk`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json();
    const kill = Number.isFinite(report.playerKillSeconds)
      ? `${report.playerKillSeconds.toFixed(0)}s`
      : '—';
    const dies = Number.isFinite(report.enemyKillSeconds)
      ? `${report.enemyKillSeconds.toFixed(0)}s`
      : '—';
    console.log(
      `  ${row.name.padEnd(24)} ${String(row.levelMin).padStart(3)}  ` +
        `${row.archetype.padEnd(9)} ${String(report.enemyHp).padStart(5)}  ` +
        `${kill.padStart(5)}  ${dies.padStart(5)}  ` +
        report.rotation.map((r) => `${r.id} ${r.sharePct.toFixed(0)}%`).join(', '),
    );
    for (const note of report.notes) console.log(`      ⚠️  ${note}`);
  }

  console.log('\n🐛 The Dawnshore and Weald bestiary is live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
