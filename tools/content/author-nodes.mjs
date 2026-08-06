#!/usr/bin/env node
/**
 * Author the P10 gathering catalogue THROUGH the panel — the same editor path
 * the owner uses, not a back door into the database.
 *
 * Three passes, in the only order that works:
 *  1. **Items.** Materials, gems, procs and fish as drafts on the Items page's
 *     endpoints, then published. Nodes reference items, so the items have to be
 *     live before a node draft can pass its cross-check.
 *  2. **Resource nodes.** All 21 definitions (5 tiers × 4 professions, plus
 *     Dawnpetal) through the Professions page's endpoints, then published —
 *     which is where an unbaked model or an unpublished yield gets refused.
 *  3. **Placements.** The T1–T2 clusters into the map draft's `node` layer,
 *     seated on real ground, then a map publish so the live world grows them.
 *
 * Pass 3 is the one with judgement in it. §1.4 wants clusters of 3–6 near
 * landmarks rather than an even sprinkle, and a cluster centre chosen on a map
 * is a guess about terrain: some of its members land in the sea, on a cliff, or
 * inside a rock. Every candidate is therefore CHECKED against the live
 * heightfield and walkgrid and dropped if the ground refuses it, rather than
 * planted and left for a player to find floating. Fishing clusters invert the
 * test — they want water, and land is what disqualifies them.
 *
 * Usage: node tools/content/author-nodes.mjs [http://localhost:8082]
 * Requires: the panel API (pnpm dev), the game repo's migrated Postgres, and
 * the GAME server on :8081 for the map publish + hot reload.
 */

import pg from 'pg';
import argon2 from 'argon2';
import { CHUNK_SIZE_M, WORLD_CHUNKS, WORLD_ORIGIN_M, pointInPolygon } from '@dawned/shared';
import { ITEM_DEFS, NODE_DEFS } from './node-data.mjs';
import { buildNodeClusters } from './node-clusters.mjs';

/**
 * Cluster centres are RESOLVED against the real height field (P12-E), not typed:
 * the P10 list was hand-placed on the dev island and the Dawnlands put open
 * water there. The per-node ground check further down still gets the last word
 * on each individual tree, because it reads the DRAFT CHUNKS — the authority on
 * what was actually written — where this reads the synthesis.
 */
const NODE_CLUSTERS = buildNodeClusters();

const BASE_URL = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8082';
const SKIP_MAP = process.argv.includes('--no-map');
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`   ${message}`);
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
 * Deterministic jitter. A cluster has to look scattered and has to land in the
 * same place every run — a re-run that moves every tree would make the diff
 * unreadable and the seed migration a moving target.
 */
const jitter = (seed, salt) => {
  let h = (seed * 2654435761 + salt * 40503) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
};

const main = async () => {
  console.log(`Authoring the P10 gathering catalogue through the panel → ${BASE_URL}\n`);
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
  };
  const post = async (path, body) => {
    const response = await fetch(`${BASE_URL}/api/${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, payload: await response.json().catch(() => null) };
  };

  // --- 1. items -----------------------------------------------------------

  for (const def of ITEM_DEFS) await put('items', def);
  ok(`${ITEM_DEFS.length} materials, gems, procs and fish saved as drafts`);

  /**
   * Publishing an unchanged set refuses with "nothing to publish", because a
   * draft identical to what is live prunes itself on save. That is SUCCESS for
   * a re-run, not failure — this script has to be safe to run twice, or fixing
   * one placement would mean re-authoring the catalogue.
   */
  const publishOrAlreadyLive = async (path, label) => {
    const result = await post(path, {});
    const problems = result.payload?.problems ?? [];
    const nothingPending =
      problems.length > 0 && problems.every((problem) => /nothing to publish/i.test(problem));
    if (nothingPending) {
      ok(`${label}: already live, nothing to publish`);
      return null;
    }
    if (!result.response.ok || !result.payload?.ok) {
      fail(
        `${label} publish refused:\n${(problems.length ? problems : [JSON.stringify(result.payload)]).join('\n')}`,
      );
    }
    ok(`published ${result.payload.published} ${label}`);
    for (const warning of result.payload.warnings ?? []) note(`⚠️  ${warning}`);
    return result.payload;
  };

  /**
   * Dawnpetal's old home.
   *
   * P8 put Dawnpetal in the Dawnshore spore table as an ilvl-4 material; §4
   * makes it the Elder Grove's T5 rare, and this run re-tiers the item. A
   * level-3 spore-dweller dropping a T5 bloom would be the same mistake
   * pointing the other way, so the table gets Meadowbell — the herb that shore
   * actually grows — at the same weight. Only rewritten while it still points
   * at Dawnpetal, so a later panel retune is never undone by a re-run.
   */
  const retargetDawnpetal = async () => {
    const response = await fetch(`${BASE_URL}/api/loot-tables`, { headers });
    if (!response.ok) fail(`could not read loot tables (${response.status})`);
    const { tables } = await response.json();
    let changed = 0;
    for (const row of tables ?? []) {
      const def = row.def;
      if (!def.entries?.some((entry) => entry.ref === 'item_material_dawnpetal')) continue;
      await put('loot-tables', {
        ...def,
        entries: def.entries.map((entry) =>
          entry.ref === 'item_material_dawnpetal'
            ? { ...entry, ref: 'item_material_meadowbell' }
            : entry,
        ),
      });
      note(`re-pointed ${def.id}: dawnpetal → meadowbell (it is a T5 bloom now)`);
      changed++;
    }
    return changed;
  };
  // Nothing to re-point is the steady state after the first run; nothing to
  // re-point on the FIRST run would mean the fetch shape is wrong, which is
  // exactly what happened once and passed silently.
  const retargeted = await retargetDawnpetal();
  if (retargeted === 0) note('no loot table still points at Dawnpetal');

  await publishOrAlreadyLive('publish/items', 'item rows');

  // --- 2. resource-node definitions ---------------------------------------

  for (const def of NODE_DEFS) await put('resource-nodes', def);
  ok(`${NODE_DEFS.length} resource-node definitions saved as drafts`);

  const nodePublish = await publishOrAlreadyLive(
    'publish/resource-nodes',
    'resource-node definitions',
  );
  if (nodePublish) {
    note(
      nodePublish.reload.ok
        ? `game hot-reloaded: ${nodePublish.reload.note}`
        : `game NOT reloaded: ${nodePublish.reload.note}`,
    );
  }

  if (SKIP_MAP) {
    console.log('\n🌿 Definitions are live. Placements skipped (--no-map).\n');
    return;
  }

  // --- 3. placements ------------------------------------------------------
  //
  // The map draft is the panel's, so this asks the panel for the ground rather
  // than reading the bake itself: whatever the editor is standing on is what a
  // publish will bake, and a script that consulted a different source could
  // plant a forest the editor does not agree exists.

  // The P10 clusters all sat on one island and a single wide pull covered them.
  // P12's do not — they span the whole 32×32 world — so this walks the region
  // in bands: the endpoint clamps its bounds to the world (a `maxCy` of 32 is a
  // 500, which is exactly how this was found) and 1024 chunks of Float32 heights
  // in one response is ~23 MB of base64 nobody needs at once.
  const chunkOf = (metres) => Math.floor((metres - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const clamp = (value) => Math.min(WORLD_CHUNKS - 1, Math.max(0, value));
  const cxs = NODE_CLUSTERS.map((c) => chunkOf(c.x));
  const cys = NODE_CLUSTERS.map((c) => chunkOf(c.z));
  const minCx = clamp(Math.min(...cxs) - 1);
  const maxCx = clamp(Math.max(...cxs) + 1);
  const minCy = clamp(Math.min(...cys) - 1);
  const maxCy = clamp(Math.max(...cys) + 1);
  const chunks = new Map();
  for (let bandStart = minCy; bandStart <= maxCy; bandStart += 4) {
    const bandEnd = Math.min(maxCy, bandStart + 3);
    const query = new URLSearchParams({
      minCx: String(minCx),
      maxCx: String(maxCx),
      minCy: String(bandStart),
      maxCy: String(bandEnd),
    });
    const regionResponse = await fetch(`${BASE_URL}/api/map/chunks?${query}`, { headers });
    if (!regionResponse.ok) {
      fail(`map chunk fetch failed (${regionResponse.status}) for rows ${bandStart}–${bandEnd}`);
    }
    const region = await regionResponse.json();
    for (const chunk of region.chunks) {
      chunks.set(`${chunk.cx},${chunk.cy}`, {
        ...chunk,
        // The wire carries heights as base64 Float32 — the same bytes the
        // editor decodes, so this reads exactly what the viewport draws.
        heights: new Float32Array(Buffer.from(chunk.heights, 'base64').buffer.slice(0)),
      });
    }
  }
  ok(`pulled ${chunks.size} draft chunks around the clusters`);

  // The DRAFT's zones, not the synthesis's — same argument as the chunks above.
  // `world:author` writes these rings from `world-data.ts`, but the owner can
  // drag a corner afterwards, and then the offline copy is stale while this is
  // what the bake will read.
  const zoneResponse = await fetch(`${BASE_URL}/api/map/objects?layers=zone`, { headers });
  if (!zoneResponse.ok) fail(`zone fetch failed (${zoneResponse.status})`);
  const zoneRings = (await zoneResponse.json()).objects.map((row) => row.def);
  if (zoneRings.length === 0)
    fail('the map draft carries no zones — run `pnpm world:author` first');
  // Smallest ring first, ties on id: `bakeDraft`'s `orderZones` rule, so "which
  // zone is this tree in?" gets ONE answer across the script and the bake. The
  // Dawnsea's ring covers the whole map, so without this every land node would
  // resolve to the ocean.
  const ringArea = (polygon) => {
    let sum = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    }
    return Math.abs(sum) / 2;
  };
  zoneRings.sort(
    (a, b) => ringArea(a.polygon) - ringArea(b.polygon) || String(a.id).localeCompare(String(b.id)),
  );
  const zoneAt = (x, z) => zoneRings.find((ring) => pointInPolygon(x, z, ring.polygon))?.id ?? null;
  ok(`pulled ${zoneRings.length} draft zones (smallest ring first, as the bake orders them)`);

  /** Sample the DRAFT's ground: height + this chunk's water level, or null. */
  const groundAt = (x, z) => {
    const cx = chunkOf(x);
    const cy = chunkOf(z);
    const chunk = chunks.get(`${cx},${cy}`);
    if (!chunk || !chunk.enabled) return null;
    const verts = Math.round(Math.sqrt(chunk.heights.length));
    const localX = (x - (WORLD_ORIGIN_M + cx * CHUNK_SIZE_M)) / CHUNK_SIZE_M;
    const localZ = (z - (WORLD_ORIGIN_M + cy * CHUNK_SIZE_M)) / CHUNK_SIZE_M;
    const ix = Math.min(verts - 1, Math.max(0, Math.round(localX * (verts - 1))));
    const iz = Math.min(verts - 1, Math.max(0, Math.round(localZ * (verts - 1))));
    return { height: chunk.heights[iz * verts + ix], water: chunk.waterLevel };
  };

  /**
   * Does this spot suit the cluster? Wet for a shoal, dry and gentle else —
   * and, for anything on land, INSIDE the zone the cluster was wished into.
   *
   * The zone is not decoration: PROFESSIONS §4 gives each zone a tier band, so
   * a node standing one zone over is a T5 vein a level-19 player can walk up to
   * in the T4 savanna. Water clusters are exempt because open water is the
   * Dawnsea by definition — a shoal off Dawnshore's beach legitimately falls
   * inside Dawnshore's ring, which reaches out over the sea.
   */
  const suits = (cluster, x, z) => {
    const ground = groundAt(x, z);
    if (!ground) return false;
    const submerged = ground.water !== null && ground.height < ground.water;
    if (cluster.water) return submerged;
    if (submerged) return false;
    if (zoneAt(x, z) !== cluster.zone) return false;
    const around = [
      groundAt(x + 2, z),
      groundAt(x - 2, z),
      groundAt(x, z + 2),
      groundAt(x, z - 2),
    ].filter(Boolean);
    // A tree on a 45° face reads as stuck through the hill.
    return Math.max(...around.map((g) => Math.abs(g.height - ground.height)), 0) <= 3.5;
  };

  /**
   * Move a hint onto ground that suits it.
   *
   * A spiral rather than a random walk so the result is the same every run,
   * and capped at 90 m so a hint can be nudged but never silently relocated to
   * a different part of the island — a shoal that wandered two zones away
   * would be worse than one that failed loudly.
   */
  const settle = (cluster) => {
    if (suits(cluster, cluster.x, cluster.z)) return { x: cluster.x, z: cluster.z, moved: 0 };
    for (let radius = 6; radius <= 90; radius += 6) {
      for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * Math.PI * 2;
        const x = Math.round(cluster.x + Math.cos(angle) * radius);
        const z = Math.round(cluster.z + Math.sin(angle) * radius);
        if (suits(cluster, x, z)) return { x, z, moved: radius };
      }
    }
    return null;
  };

  const placements = [];
  const rejected = { offMap: 0, wetLand: 0, dryWater: 0, steep: 0, zone: 0 };
  const homeless = [];
  let nudged = 0;
  NODE_CLUSTERS.forEach((hint, clusterIndex) => {
    const settled = settle(hint);
    if (!settled) {
      homeless.push(hint.nodeId);
      return;
    }
    if (settled.moved > 0) nudged++;
    const cluster = { ...hint, x: settled.x, z: settled.z };
    for (let member = 0; member < cluster.count; member++) {
      // Try the member's own spot, then a few re-jitters pulling steadily
      // closer to the cluster centre — which the resolver already verified.
      // Without this a shoal loses half its spots to the shoreline it sits
      // next to, and the count silently comes out at 3 of 8.
      let chosen = null;
      let why = null;
      for (let attempt = 0; attempt < 6 && !chosen; attempt++) {
        const salt = member * 3 + attempt * 97;
        const angle = jitter(clusterIndex + 1, salt + 1) * Math.PI * 2;
        const shrink = 1 - attempt * 0.15;
        const distance = Math.sqrt(jitter(clusterIndex + 1, salt + 2)) * cluster.spread * shrink;
        const x = Math.round((cluster.x + Math.cos(angle) * distance) * 100) / 100;
        const z = Math.round((cluster.z + Math.sin(angle) * distance) * 100) / 100;
        const ground = groundAt(x, z);
        if (!ground) {
          why = 'offMap';
          continue;
        }
        const submerged = ground.water !== null && ground.height < ground.water;
        if (cluster.water && !submerged) {
          why = 'dryWater';
          continue;
        }
        if (!cluster.water && submerged) {
          why = 'wetLand';
          continue;
        }
        // Slope check: a tree on a 45° face reads as stuck through the hill.
        const around = [
          groundAt(x + 2, z),
          groundAt(x - 2, z),
          groundAt(x, z + 2),
          groundAt(x, z - 2),
        ].filter(Boolean);
        const drop = Math.max(...around.map((g) => Math.abs(g.height - ground.height)), 0);
        if (!cluster.water && drop > 3.5) {
          why = 'steep';
          continue;
        }
        // The centre is in the right zone; a member scattered `spread` metres
        // off it need not be. This was 39 of 322 land nodes across the world —
        // whole handfuls of Ashcrag's T5 veins standing in Sungraze, and 4 of
        // the 12 Dawnpetal, the bloom the Elder Grove exists for, growing in
        // Emberwood. The shrinking retry above is the fix: it pulls a stray
        // back toward a centre already known to be inside the ring.
        if (!cluster.water && zoneAt(x, z) !== cluster.zone) {
          why = 'zone';
          continue;
        }
        chosen = { x, z, salt };
      }
      if (!chosen) {
        rejected[why ?? 'offMap']++;
        continue;
      }
      const { x, z, salt } = chosen;
      placements.push({
        id: `node_${clusterIndex}_${member}`,
        nodeId: cluster.nodeId,
        x,
        z,
        rotation: Math.round(jitter(clusterIndex + 1, salt + 3) * 628) / 100,
        scale: Math.round((0.85 + jitter(clusterIndex + 1, salt + 5) * 0.4) * 100) / 100,
      });
    }
  });
  ok(
    `${placements.length} placements survived the ground check ` +
      `(${nudged} cluster(s) nudged onto suitable ground; dropped: ${rejected.offMap} off-map, ` +
      `${rejected.wetLand} in water, ${rejected.dryWater} on land, ${rejected.steep} too steep, ` +
      `${rejected.zone} outside their zone)`,
  );
  if (homeless.length > 0) {
    fail(
      `no suitable ground within 90 m of the hint for: ${[...new Set(homeless)].join(', ')} — ` +
        'the hint is in the wrong part of the world, not slightly off',
    );
  }
  if (placements.length === 0) fail('every candidate was rejected — the cluster hints are wrong');

  // The editor is single-writer. Take the lock by force: a script run is a
  // deliberate act by the same person who would be holding it.
  const lock = await post('map/lock', { force: true });
  if (!lock.response.ok || !lock.payload?.mine) {
    fail(`could not take the map lock: ${JSON.stringify(lock.payload)}`);
  }

  /**
   * Clear the layer first.
   *
   * Placements are minted as `node_<cluster>_<member>`, so a re-run overwrites
   * the ids it produces again — and leaves behind any id the PREVIOUS run
   * produced and this one did not. Moving a cluster hint by fifty metres left
   * two trees standing at the old spot, published, invisible in the diff and
   * findable only by walking there. The layer is this script's to own, and the
   * endpoint checkpoints before it clears.
   */
  const cleared = await post('map/objects/clear-layer', { layer: 'node' });
  if (!cleared.response.ok)
    fail(`could not clear the node layer: ${JSON.stringify(cleared.payload)}`);
  if (cleared.payload.removed > 0) {
    note(`cleared ${cleared.payload.removed} existing node placement(s) (checkpointed first)`);
  }

  // The endpoint caps a batch at 500 objects; clusters are far smaller, but
  // batching is what keeps this honest if the cluster list grows.
  for (let start = 0; start < placements.length; start += 200) {
    const batch = placements.slice(start, start + 200);
    const save = await fetch(`${BASE_URL}/api/map/objects`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ objects: batch.map((def) => ({ layer: 'node', def })) }),
    });
    if (!save.ok) fail(`saving node placements failed: ${await save.text()}`);
  }
  ok(`${placements.length} node placements written into the map draft`);

  // Publish streams its progress as SSE; the last `done` event carries the
  // verdict. Read it to the end rather than firing and hoping — a bake that
  // fails mid-way is exactly the thing that used to pass silently.
  const stream = await fetch(`${BASE_URL}/api/map/publish-stream`, { headers });
  if (!stream.ok) fail(`publish stream refused (${stream.status}): ${await stream.text()}`);
  let done = null;
  let buffer = '';
  for await (const part of stream.body) {
    buffer += Buffer.from(part).toString('utf8');
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      if (event === 'validation') {
        for (const warning of JSON.parse(data).warnings ?? []) note(`⚠️  ${warning}`);
      }
      if (event === 'done') done = JSON.parse(data);
    }
  }
  if (!done?.ok) fail(`map publish refused:\n${(done?.problems ?? ['no done event']).join('\n')}`);
  ok(`map published as ${done.version} (${done.result?.chunksEmitted ?? '?'} chunks)`);
  note(
    done.reload?.ok
      ? `game swapped onto it: ${done.reload.note}`
      : `game NOT reloaded: ${done.reload?.note}`,
  );

  const counts = new Map();
  for (const placement of placements) {
    counts.set(placement.nodeId, (counts.get(placement.nodeId) ?? 0) + 1);
  }
  console.log('\nPlanted:');
  for (const [nodeId, count] of [...counts].sort())
    console.log(`   ${String(count).padStart(3)} × ${nodeId}`);

  // Where they actually STAND, resolved the way the bake resolves it. A count
  // per definition says the catalogue is complete; this says the tier ladder is
  // where the design put it, which is the part geometry can quietly break.
  const perZone = new Map();
  for (const placement of placements) {
    const zone = zoneAt(placement.x, placement.z) ?? 'NO ZONE';
    perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
  }
  console.log('\nStanding in:');
  for (const [zone, count] of [...perZone].sort((a, b) => b[1] - a[1]))
    console.log(`   ${String(count).padStart(3)} in ${zone}`);
  console.log('\n🌿 The gathering catalogue is live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
