#!/usr/bin/env node
/**
 * Author the whole bestiary THROUGH the panel API — the editor path end to end.
 *
 * P9-C shipped the Dawnshore and Weald half of this. P12-C adds the other four
 * zones and, more importantly, RE-PLACES every camp: the P4–P9 spawners stood
 * on the dev island, and the Dawnlands put open water there.
 *
 * Order matters and is not arbitrary:
 *   1. loot table stubs, because the enemy publish BLOCKS on a loot ref that is
 *      not published, and the T3–T5 drops themselves are P12-D's slice.
 *   2. enemy + spawner drafts → the enemies publish rail (validate → clip,
 *      loot and spawner cross-checks → copy live → hot reload).
 *   3. the map's `spawner` layer, cleared and rewritten. Camps live on the MAP
 *      (owner decision Q23) and a map publish delete-then-inserts every
 *      published spawner from that layer — so a bestiary that only went through
 *      the Enemies page would be erased by the next world publish.
 *
 * Then it prints the TTK table for every published enemy, so a content change
 * is never merged without someone having looked at what it does to the fights.
 *
 * Usage: pnpm world:bestiary [http://localhost:8082]
 * Requires: admin API (pnpm dev) + the game repo's migrated Postgres.
 */

import { openAdminSession } from './admin-session.mjs';
import { ENEMY_DEFS } from './bestiary-data.mjs';
import { buildSpawners } from './camp-data.mjs';

const BASE_URL = process.argv[2] ?? 'http://localhost:8082';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`   ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

/**
 * Readable names for the tables this pass may have to stub. Presentation only —
 * `author-items.mjs` owns what a table is CALLED once it owns its contents.
 */
const LOOT_STUB_NAMES = {
  loot_emberwood_trash: 'Emberwood — trash',
  loot_emberwood_gear: 'Emberwood — gear',
  loot_sungraze_trash: 'Sungraze — trash',
  loot_sungraze_gear: 'Sungraze — gear',
  loot_ashcrag_trash: 'Ashcrag — trash',
  loot_ashcrag_gear: 'Ashcrag — gear',
  loot_elder_grove: 'Elder Grove',
};

/**
 * Every loot table the bestiary names — DERIVED from the enemies, never typed.
 *
 * A stub ships with ONE `nothing` entry: a table has to exist and be published
 * before an enemy may name it, and what actually falls out of an Ashcrag demon
 * is the item catalogue `author-items.mjs` authors in the next step. A stub is
 * honest — the panel's loot simulator shows a flat "nothing 100 %" until it is
 * filled — where pointing a level-28 demon at the Dawnshore trash table would be
 * wrong content nobody would notice was wrong.
 *
 * This list used to be typed out, and it covered the seven ZONE tables only.
 * That held for as long as every other table an enemy named already existed —
 * which was true in a checkout that had grown through P8 → P9 → P12-D in order,
 * and false on a freshly-deployed box, where `deploy/WORLD.sh` runs the whole
 * chain against a database holding only the seed migrations. The six
 * `loot_boss_*` tables are P12-D's, so the bestiary refused to publish and the
 * deploy stopped at step 3. Reading the refs off the enemies cannot drift: a new
 * enemy pointing at a new table is stubbed by the same code that publishes it.
 */
const referencedLootTables = () => {
  const ids = new Set();
  for (const def of ENEMY_DEFS) {
    if (def.loot?.tableId) ids.add(def.loot.tableId);
  }
  return [...ids].sort();
};

/** `loot_boss_mushroom_king` → `Boss Mushroom King` — a placeholder, not a name. */
const stubName = (id) =>
  LOOT_STUB_NAMES[id] ??
  id
    .replace(/^loot_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const main = async () => {
  console.log(`\nDawned bestiary authoring → ${BASE_URL}\n`);

  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const bare = session.bare;
  const headers = session.headers;
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

  // --- 1 · the loot tables the bestiary needs to exist ---------------------
  console.log('');
  const liveTables = await (await fetch(`${BASE_URL}/api/loot-tables`, { headers })).json();
  const known = new Set(liveTables.tables.map((row) => row.id));
  const needed = referencedLootTables();
  let stubbed = 0;
  for (const id of needed) {
    // Never overwrite a table that already carries drops: re-running this after
    // the item pass fills them in must not empty them again.
    if (known.has(id)) continue;
    await put('loot-tables', {
      id,
      name: stubName(id),
      entries: [{ kind: 'nothing', weight: 1 }],
    });
    stubbed++;
  }
  if (stubbed > 0) {
    const publish = await fetch(`${BASE_URL}/api/publish/items`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const result = await publish.json();
    if (!publish.ok || !result.ok) {
      fail(
        `loot stub publish refused:\n${(result.problems ?? []).map((p) => `   • ${p}`).join('\n')}`,
      );
    }
    ok(
      `${stubbed} of ${needed.length} loot table(s) published as stubs — the item pass fills the drops`,
    );
  } else {
    ok(`all ${needed.length} loot table(s) the bestiary names already exist`);
  }

  // --- 2 · the bestiary and its camps -------------------------------------
  console.log('');
  const spawners = buildSpawners();
  let pruned = 0;
  for (const def of ENEMY_DEFS) {
    const result = await put('enemies', def);
    if (result.pruned) pruned++;
  }
  ok(`${ENEMY_DEFS.length} enemies saved as drafts (${pruned} already matched live and pruned)`);

  for (const row of spawners) {
    // `$zone`/`$ground` are the placement report's, not the schema's.
    const { $zone, $ground, $slope, $movedM, ...def } = row;
    void $zone;
    void $ground;
    void $slope;
    void $movedM;
    await put('spawners', def);
  }
  ok(`${spawners.length} camps saved as drafts`);

  const diff = await (await fetch(`${BASE_URL}/api/publish/enemies/diff`, { headers })).json();
  const pending = diff.enemies.length + diff.spawners.length;
  ok(`publish diff: ${diff.enemies.length} enemies + ${diff.spawners.length} camps pending`);
  if (pending > 0) {
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
    for (const warning of (result.warnings ?? []).slice(0, 10)) note(`⚠️  ${warning}`);
    console.log(
      result.reload.ok
        ? `✅ game hot-reloaded: ${result.reload.note}`
        : `⚠️  game not reloaded (${result.reload.note})`,
    );
  } else {
    note('nothing to publish — the live bestiary already matches this file');
  }

  // --- 3 · the same camps onto the MAP ------------------------------------
  // Q23: the map owns where a camp stands, and its publish delete-then-inserts
  // the whole published spawner set. Skipping this would mean the next world
  // publish silently emptied the world.
  console.log('');
  const lock = await fetch(`${BASE_URL}/api/map/lock`, { method: 'POST', headers: bare });
  if (!lock.ok) fail(`could not take the map lock: ${await lock.text()}`);
  ok('map lock held');
  try {
    // The `spawner` layer is this script's alone — every camp in the world is
    // in this file — so it clears first. Overwriting by id would leave the
    // previous run's rows standing wherever they used to be (the P10-E lesson).
    const cleared = await fetch(`${BASE_URL}/api/map/objects/clear-layer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ layer: 'spawner' }),
    });
    if (!cleared.ok) fail(`clearing the spawner layer failed: ${await cleared.text()}`);
    const clearedCount = (await cleared.json()).removed ?? 0;
    note(`cleared ${clearedCount} old camp placement(s)`);

    const objects = spawners.map((row) => {
      const { $zone, $ground, $slope, $movedM, ...def } = row;
      void $zone;
      void $ground;
      void $slope;
      void $movedM;
      return { layer: 'spawner', def };
    });
    for (let start = 0; start < objects.length; start += 200) {
      const response = await fetch(`${BASE_URL}/api/map/objects`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ objects: objects.slice(start, start + 200) }),
      });
      if (!response.ok) fail(`placing camps failed: ${await response.text()}`);
    }
    ok(`${objects.length} camps placed on the map`);

    const after = await fetch(`${BASE_URL}/api/map/validate`, { headers: bare });
    if (after.ok) {
      const report = await after.json();
      const problems = report.problems ?? [];
      if (problems.length === 0) ok('the draft validates — it is ready to publish');
      else {
        note(`${problems.length} problem(s) still block a publish:`);
        for (const line of problems.slice(0, 12)) note(`  • ${line}`);
        if (problems.length > 12) note(`  … and ${problems.length - 12} more`);
      }
      for (const line of (report.warnings ?? []).slice(0, 8)) note(`⚠️  ${line}`);
    }
  } finally {
    await fetch(`${BASE_URL}/api/map/lock`, { method: 'DELETE', headers: bare }).catch(() => null);
  }

  // --- 4 · what does the world look like now? ------------------------------
  console.log('\n  zone             camps  enemies  levels   ground');
  console.log('  ' + '-'.repeat(56));
  const byZone = new Map();
  for (const row of spawners) {
    const zone = byZone.get(row.$zone) ?? { camps: 0, enemies: 0, lo: 999, hi: 0, moved: 0 };
    zone.camps++;
    for (const entry of row.entries) zone.enemies += entry.count;
    for (const entry of row.entries) {
      const def = ENEMY_DEFS.find((candidate) => candidate.id === entry.enemyId);
      if (!def) fail(`camp ${row.id} names ${entry.enemyId}, which no enemy row defines`);
      zone.lo = Math.min(zone.lo, def.levelMin);
      zone.hi = Math.max(zone.hi, def.levelMax);
    }
    zone.moved = Math.max(zone.moved, row.$movedM);
    byZone.set(row.$zone, zone);
  }
  let totalEnemies = 0;
  for (const [zone, stats] of byZone) {
    totalEnemies += stats.enemies;
    console.log(
      `  ${zone.padEnd(16)} ${String(stats.camps).padStart(5)}  ${String(stats.enemies).padStart(7)}` +
        `  ${`${stats.lo}–${stats.hi}`.padStart(6)}   worst move ${stats.moved} m`,
    );
  }
  console.log(
    `  ${'total'.padEnd(16)} ${String(spawners.length).padStart(5)}  ${String(totalEnemies).padStart(7)}`,
  );

  // --- 5 · the fights ------------------------------------------------------
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
    for (const line of report.notes) console.log(`      ⚠️  ${line}`);
  }

  console.log('\n🐛 The Dawnlands have a bestiary.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
