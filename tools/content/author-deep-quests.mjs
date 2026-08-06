#!/usr/bin/env node
/**
 * Publish the rest of the Dawnlands' quests (game P12-F).
 *
 * The point of this script is the HINT RESOLVER. P11-E's DoD run found four of
 * the pilot's five kill hints pointing 85–170 m from their only spawner, and
 * both gather steps carrying no circle at all — not because anyone was careless,
 * but because a circle is typed on Content → Quests while the spawner is placed
 * in the map editor, and the two pages had never met. `questHintCoverage` warns
 * about it at publish now, which is a backstop, not a fix.
 *
 * So a step here declares WHAT it points at, not where:
 *
 *     target: { enemy: 'enemy_grave_wisp' }   → the spawners that really roll it
 *     target: { node:  'node_mining_dawnstone' } → its placements
 *     target: { object: 'chest_ash_1' }       → that interactable's position
 *     target: { npc:   'npc_lissa' }          → where she stands
 *     target: { poi:   'poi_caldera_rim' }    → the POI's own ring
 *
 * and this resolves it against the LIVE MAP DRAFT — the same rows the bake reads
 * — then computes a circle that provably contains the target. A hint cannot
 * point at nothing, because it is built from the thing it points at.
 *
 * Usage: node tools/content/author-deep-quests.mjs [http://localhost:8082]
 */

import pg from 'pg';
import argon2 from 'argon2';
import { questHintCoverage } from '@dawned/shared';
import { DEEP_QUEST_DEFS } from './quest-data-deep.mjs';

/**
 * P11's pilot quests, re-pointed at the world that exists now.
 *
 * They were authored against the DEV ISLAND. P12 moved every spawner, node and
 * villager onto the Dawnlands, and their hard-typed circles stayed where they
 * were — five of the eight ended up 420–815 m from what they point at, which is
 * the exact failure P11-E found and this resolver exists to prevent. They are
 * repaired with the SAME machinery rather than re-typed, so the fix cannot rot
 * the same way twice.
 *
 * `zoneId` moves too. P11-C set the whole Weald chain to `dawnshore` on purpose
 * — "only one landmass is built, `verdant_weald` is open water until P12, and a
 * journal heading for a place the player has never been is worse than a
 * slightly wrong label" — and left a note saying this is four fields to change
 * when P12 raises the real one. P12 raised it.
 */
const PILOT_REPAIR = {
  quest_shore_glub_tide: { steps: { 0: { enemy: 'enemy_shore_glub' } } },
  quest_shore_boil_trouble: { steps: { 0: { enemy: 'enemy_bog_blob' } } },
  quest_shore_driftwood: {
    steps: { 0: { node: 'node_woodcutting_birch' }, 1: { npc: 'npc_torv' } },
  },
  quest_shore_lost_crate: { steps: { 1: { object: 'chest_shore_lostnet' } } },
  quest_weald_silence_1: { zoneId: 'verdant_weald' },
  quest_weald_silence_2: {
    zoneId: 'verdant_weald',
    steps: { 1: { enemy: 'enemy_weald_stalker' } },
  },
  quest_weald_silence_3: {
    zoneId: 'verdant_weald',
    steps: { 0: { node: 'node_herbalism_mossbloom' }, 1: { npc: 'npc_bran' } },
  },
  quest_weald_silence_4: {
    zoneId: 'verdant_weald',
    steps: { 0: { enemy: 'enemy_mushroom_king' } },
  },
};

const BASE_URL = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8082';
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`   ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const round = (value) => Math.round(value * 10) / 10;

/**
 * Group targets that are near each other (single-link, `reach` metres).
 *
 * This is the difference between a hint and a shrug. Encircling EVERY spawner
 * that rolls an enemy sounds right and produces a 327 m circle when the two
 * camps are on opposite sides of an isle — a ring you can stand in the middle
 * of and see nothing, which is what §1 rule 4's "roughly where" is not. Six
 * bandits are findable at one camp; the player does not need to be told about
 * the other one 600 m away.
 */
const cluster = (targets, reach = 160) => {
  const groups = [];
  for (const target of targets) {
    const near = groups.filter((group) =>
      group.some((member) => Math.hypot(member.x - target.x, member.z - target.z) <= reach),
    );
    if (near.length === 0) {
      groups.push([target]);
      continue;
    }
    // Merge every group this target links, then add it — single-link clustering.
    const merged = near.flat();
    merged.push(target);
    for (const group of near) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.sort((a, b) => b.length - a.length);
};

/**
 * A circle over the DENSEST cluster of targets.
 *
 * Centre is that cluster's centroid, radius reaches its furthest member plus a
 * margin, clamped to the schema's 8–400 m. Targets outside it are reported
 * rather than absorbed: pointing at the biggest concentration is a decision,
 * and a run that silently drops two thirds of an enemy's spawners should say so.
 */
const circleAround = (targets, margin = 24) => {
  const groups = cluster(targets);
  const chosen = groups[0];
  const x = chosen.reduce((sum, t) => sum + t.x, 0) / chosen.length;
  const z = chosen.reduce((sum, t) => sum + t.z, 0) / chosen.length;
  const furthest = Math.max(...chosen.map((t) => Math.hypot(t.x - x, t.z - z)));
  return {
    x: round(x),
    z: round(z),
    radius: Math.round(Math.min(400, Math.max(8, furthest + margin))),
    clustered: chosen.length,
    elsewhere: targets.length - chosen.length,
  };
};

const main = async () => {
  console.log(`Authoring the deep quest set → ${BASE_URL}\n`);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );

  // --- the world, as the bake will read it ---------------------------------
  const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
  const layer = async (name) =>
    (await db.query(`select def, x, z from map_draft_objects where layer = $1`, [name])).rows.map(
      (row) => ({ ...parse(row.def), _x: row.x, _z: row.z }),
    );
  const spawners = await layer('spawner');
  const nodes = await layer('node');
  const interactables = await layer('interactable');
  const npcs = await layer('npc');
  const pois = await layer('poi');
  const livePilots = new Map(
    (await db.query(`select def from content_quests where status = 'published'`)).rows
      .map((row) => parse(row.def))
      .map((questDef) => [questDef.id, questDef]),
  );
  await db.end();
  ok(
    `world read: ${spawners.length} spawners, ${nodes.length} nodes, ` +
      `${interactables.length} interactables, ${npcs.length} NPCs, ${pois.length} POIs`,
  );

  /** Every placed thing that satisfies a target spec. */
  const targetsFor = (spec) => {
    if (spec.enemy) {
      return spawners
        .filter((s) => (s.entries ?? []).some((e) => e.enemyId === spec.enemy))
        .map((s) => ({ x: s.x, z: s.z }));
    }
    if (spec.node)
      return nodes.filter((n) => n.nodeId === spec.node).map((n) => ({ x: n.x, z: n.z }));
    if (spec.object) {
      return interactables.filter((i) => i.id === spec.object).map((i) => ({ x: i.x, z: i.z }));
    }
    if (spec.npc) return npcs.filter((n) => n.npcId === spec.npc).map((n) => ({ x: n.x, z: n.z }));
    if (spec.poi) return pois.filter((p) => p.id === spec.poi).map((p) => ({ x: p.x, z: p.z }));
    return [];
  };

  // --- resolve every step's hint from the world ----------------------------
  const unresolved = [];
  const report = [];
  const quests = DEEP_QUEST_DEFS.map((questDef) => ({
    ...questDef,
    steps: questDef.steps.map((step) => {
      const { target, ...rest } = step;
      const found = targetsFor(target ?? {});
      const label = `${questDef.id}/${step.type}`;
      if (found.length === 0) {
        unresolved.push(`${label}: nothing in the world matches ${JSON.stringify(target)}`);
        return rest;
      }
      // An explore step never gets a circle (§1 rule 4 — finding the place IS
      // the objective), but its x/z still come from the real POI so the clue
      // and the destination cannot drift apart.
      if (step.type === 'explore') {
        const at = circleAround(found, 0);
        return { ...rest, x: at.x, z: at.z };
      }
      // A cluster of gathering nodes wants a wider circle than one spawner:
      // "the birch grows around here" rather than "stand on this tree".
      const { clustered, elsewhere, ...hint } = circleAround(found, target.node ? 40 : 24);
      const coverage = questHintCoverage(hint, found);
      report.push(
        `${label.padEnd(38)} ${String(found.length).padStart(3)} placed  ` +
          `r=${String(hint.radius).padStart(3)}m  in-circle=${coverage.inside}` +
          (elsewhere > 0 ? `  (+${elsewhere} elsewhere in the world)` : ''),
      );
      if (!coverage.covered) {
        unresolved.push(
          `${label}: derived circle still covers nothing — impossible, check circleAround`,
        );
      }
      // A circle bigger than this is not a hint, it is a landmass. Loud, because
      // the whole point of deriving it was to stop shipping useless circles.
      if (hint.radius > 260) {
        unresolved.push(
          `${label}: derived radius ${hint.radius} m is too big to be a hint — ` +
            `${clustered} targets are that spread out, so the step needs a tighter target`,
        );
      }
      return { ...rest, hint };
    }),
  }));
  // --- repair P11's pilot hints with the same machinery --------------------
  const repaired = [];
  for (const [questId, repair] of Object.entries(PILOT_REPAIR)) {
    const live = livePilots.get(questId);
    if (!live) {
      unresolved.push(`${questId}: pilot quest not found to repair`);
      continue;
    }
    const steps = live.steps.map((step, index) => {
      const spec = repair.steps?.[index];
      if (!spec) return step;
      const found = targetsFor(spec);
      if (found.length === 0) {
        unresolved.push(`${questId} step ${index}: nothing matches ${JSON.stringify(spec)}`);
        return step;
      }
      if (step.type === 'explore') {
        const at = circleAround(found, 0);
        return { ...step, x: at.x, z: at.z };
      }
      const { clustered: _c, elsewhere, ...hint } = circleAround(found, spec.node ? 40 : 24);
      const before = step.hint
        ? Math.round(Math.hypot(step.hint.x - hint.x, step.hint.z - hint.z))
        : null;
      repaired.push(
        `${questId}/${step.type}`.padEnd(38) +
          (before === null ? 'had no circle' : `moved ${before} m`) +
          `  → r=${hint.radius}m` +
          (elsewhere > 0 ? `  (+${elsewhere} elsewhere)` : ''),
      );
      return { ...step, hint };
    });
    repaired.push(
      ...(repair.zoneId && repair.zoneId !== live.zoneId
        ? [`${questId}`.padEnd(38) + `zone ${live.zoneId} → ${repair.zoneId}`]
        : []),
    );
    quests.push({ ...live, ...(repair.zoneId ? { zoneId: repair.zoneId } : {}), steps });
  }

  if (unresolved.length > 0) fail(`hints could not be resolved:\n${unresolved.join('\n')}`);
  ok(`${quests.length} quests, every hint derived from the live world`);
  if (repaired.length > 0) {
    console.log('\nP11 pilot repairs (they were authored against the dev island):');
    for (const row of repaired) console.log(`   ${row}`);
  }
  console.log('\nHints (derived, never typed):');
  for (const row of report) console.log(`   ${row}`);

  // --- publish -------------------------------------------------------------
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

  for (const questDef of quests) {
    const response = await fetch(`${BASE_URL}/api/quests/${questDef.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(questDef),
    });
    if (!response.ok) fail(`quest draft ${questDef.id} rejected: ${await response.text()}`);
  }
  ok(`${quests.length} quest drafts saved`);

  const publish = await fetch(`${BASE_URL}/api/publish/quests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const published = await publish.json().catch(() => null);
  const problems = published?.problems ?? [];
  const nothingPending =
    problems.length > 0 && problems.every((problem) => /nothing to publish/i.test(problem));
  if (nothingPending) {
    ok('quests: already live, nothing to publish');
  } else if (!publish.ok || !published?.ok) {
    fail(
      `quest publish refused:\n${(problems.length ? problems : [JSON.stringify(published)]).join('\n')}`,
    );
  } else {
    ok(`published ${published.published} quest/NPC row(s)`);
    for (const warning of published.warnings ?? []) note(`⚠️  ${warning}`);
  }

  // --- ask the GAME what it ended up with ----------------------------------
  const gameUrl = process.env.GAME_URL ?? 'http://localhost:8081';
  try {
    const live = await fetch(`${gameUrl}/api/content/quests`).then((r) => r.json());
    const byZone = new Map();
    for (const questDef of live.quests ?? []) {
      byZone.set(questDef.zoneId, (byZone.get(questDef.zoneId) ?? 0) + 1);
    }
    const chains = new Set((live.quests ?? []).map((q) => q.chainId).filter(Boolean));
    ok(`the GAME serves ${live.quests?.length ?? 0} quests in ${chains.size} chain(s)`);
    console.log('\nQuests by zone, from the game:');
    for (const [zone, count] of [...byZone].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(count).padStart(3)} in ${zone}`);
    }
  } catch (error) {
    note(`could not read the game's content API: ${error.message}`);
  }

  console.log('\n📜 The Dawnlands have work to offer.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
