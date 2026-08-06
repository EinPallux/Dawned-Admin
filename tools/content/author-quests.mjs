#!/usr/bin/env node
/**
 * Author the P11 pilot quest set THROUGH the panel — the same editor path the
 * owner uses, not a back door into the database.
 *
 * Two passes, in the only order that works:
 *  1. **NPCs + quests.** One publish rail, because they reference each other:
 *     a quest names its giver, an NPC exists to be talked to. This is where an
 *     unpublished item, a missing enemy or an unfinishable flow gets refused.
 *  2. **World placements.** NPCs, interactables and POIs into the map draft's
 *     own layers, seated on real ground, then a map publish so the live world
 *     grows them without a restart.
 *
 * Layer ownership differs between the two, and the difference matters:
 *  - the `npc` layer is entirely this script's, so it is CLEARED first. That is
 *    the lesson `author-nodes.mjs` paid for — overwriting by id leaves the
 *    previous run's rows standing wherever they were, published, invisible in
 *    the diff and findable only by walking there.
 *  - `interactable` and `poi` are SHARED with the map editor: the owner places
 *    shrines and vistas by hand there. Clearing them would be the same bug
 *    pointing the other way, except it deletes their work instead of leaving
 *    stale rows. So those two upsert by id and this script reports exactly
 *    which ids it wrote.
 *
 * Usage: node tools/content/author-quests.mjs [http://localhost:8082] [--no-map]
 * Requires: the panel API (pnpm dev), the game repo's migrated Postgres, and
 * the GAME server on :8081 for the publish hot-reloads.
 */

import { openAdminSession } from './admin-session.mjs';
import { ownerEditGuards } from './owner-edits.mjs';
import { publishRail } from './publish.mjs';
import { CHUNK_SIZE_M, WORLD_ORIGIN_M } from '@dawned/shared';
import { INTERACTABLES, NPC_DEFS, NPC_PLACEMENTS, POIS, QUEST_DEFS } from './quest-data.mjs';

const BASE_URL = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8082';
const SKIP_MAP = process.argv.includes('--no-map');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`   ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const main = async () => {
  console.log(`Authoring the P11 pilot quest set through the panel → ${BASE_URL}\n`);

  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const headers = session.headers;
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

  // --- 1. NPCs + quests ----------------------------------------------------

  // Never revert something the owner retuned in the panel (owner-edits.mjs).
  const guard = await ownerEditGuards([
    ['npcs', 'content_npcs'],
    ['quests', 'content_quests'],
  ]);

  for (const def of NPC_DEFS) if (guard.mayWrite('npcs', def.id, def)) await put('npcs', def);
  ok(`${NPC_DEFS.length} NPCs saved as drafts`);
  for (const def of QUEST_DEFS) if (guard.mayWrite('quests', def.id, def)) await put('quests', def);
  guard.report();
  ok(`${QUEST_DEFS.length} quests saved as drafts`);

  // The shared rule (publish.mjs), not a third copy of it.
  await publishRail(BASE_URL, headers, 'quests', 'quest/NPC rows');

  // AFTER the publish: recording before it would claim ownership of rows a
  // refused publish never wrote, and the next run would then overwrite the
  // owner's version believing it had written that value itself.
  await guard.commit();

  if (SKIP_MAP) {
    console.log('\n📜 Quests are live content. Placements skipped (--no-map).\n');
    return;
  }

  // --- 2. placements -------------------------------------------------------
  //
  // Ask the PANEL for the ground rather than reading the bake: whatever the
  // editor is standing on is what a publish will bake, and a script consulting
  // a different source could stand Marla in a spot the editor says is sea.

  const everything = [
    ...NPC_PLACEMENTS.map((row) => ({ layer: 'npc', def: row })),
    ...INTERACTABLES.map((row) => ({ layer: 'interactable', def: row })),
    ...POIS.map((row) => ({ layer: 'poi', def: row })),
  ];
  const chunkOf = (metres) => Math.floor((metres - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
  const cxs = everything.map((row) => chunkOf(row.def.x));
  const cys = everything.map((row) => chunkOf(row.def.z));
  const query = new URLSearchParams({
    minCx: String(Math.max(0, Math.min(...cxs) - 1)),
    minCy: String(Math.max(0, Math.min(...cys) - 1)),
    maxCx: String(Math.max(...cxs) + 1),
    maxCy: String(Math.max(...cys) + 1),
  });
  const regionResponse = await fetch(`${BASE_URL}/api/map/chunks?${query}`, { headers });
  if (!regionResponse.ok) fail(`map chunk fetch failed (${regionResponse.status})`);
  const region = await regionResponse.json();
  const chunks = new Map(
    region.chunks.map((chunk) => [
      `${chunk.cx},${chunk.cy}`,
      {
        ...chunk,
        // The wire carries heights as base64 Float32 — the same bytes the
        // editor decodes, so this reads exactly what the viewport draws.
        heights: new Float32Array(Buffer.from(chunk.heights, 'base64').buffer.slice(0)),
      },
    ]),
  );
  ok(`pulled ${chunks.size} draft chunks around the placements`);

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
   * Every one of these is a thing a player WALKS UP TO. A villager standing in
   * the surf or a chest halfway up a cliff is not a smaller version of the same
   * content — it is content nobody reaches. Checked, never assumed.
   */
  const dryAndGentle = (x, z) => {
    const ground = groundAt(x, z);
    if (!ground) return false;
    if (ground.water !== null && ground.height < ground.water) return false;
    const around = [
      groundAt(x + 2, z),
      groundAt(x - 2, z),
      groundAt(x, z + 2),
      groundAt(x, z - 2),
    ].filter(Boolean);
    return Math.max(...around.map((g) => Math.abs(g.height - ground.height)), 0) <= 3.0;
  };
  const homeless = everything.filter((row) => !dryAndGentle(row.def.x, row.def.z));
  if (homeless.length > 0) {
    // Deliberately fatal and deliberately NOT auto-nudged: unlike a scattered
    // forest, each of these positions is a deliberate authored spot tied to
    // prose ("past the last mooring post"). Moving one silently would break the
    // clue that points at it, so a bad coordinate is the author's to fix.
    fail(
      `these placements are in water, off the map or on a cliff face:\n` +
        homeless
          .map((row) => `   ${row.layer} ${row.def.id} @ ${row.def.x},${row.def.z}`)
          .join('\n'),
    );
  }
  ok(`${everything.length} placements sit on walkable, dry ground`);

  // The editor is single-writer. Take the lock by force: a script run is a
  // deliberate act by the same person who would be holding it.
  const lock = await post('map/lock', { force: true });
  if (!lock.response.ok || !lock.payload?.mine) {
    fail(`could not take the map lock: ${JSON.stringify(lock.payload)}`);
  }

  const cleared = await post('map/objects/clear-layer', { layer: 'npc' });
  if (!cleared.response.ok)
    fail(`could not clear the npc layer: ${JSON.stringify(cleared.payload)}`);
  if (cleared.payload.removed > 0) {
    note(`cleared ${cleared.payload.removed} existing NPC placement(s) (checkpointed first)`);
  }

  for (let start = 0; start < everything.length; start += 200) {
    const batch = everything.slice(start, start + 200);
    const save = await fetch(`${BASE_URL}/api/map/objects`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ objects: batch }),
    });
    if (!save.ok) fail(`saving placements failed: ${await save.text()}`);
  }
  ok(
    `${NPC_PLACEMENTS.length} NPC, ${INTERACTABLES.length} interactable and ` +
      `${POIS.length} POI placements written into the map draft`,
  );
  note(
    `interactable/poi ids owned by this script: ` +
      [...INTERACTABLES, ...POIS].map((row) => row.id).join(', '),
  );

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

  /**
   * Ask the GAME what it ended up with. The publish saying "ok" is the panel's
   * account of its own work; this is the only line that proves the content
   * crossed the repo boundary, which is the whole point of authoring through
   * the panel rather than seeding the database.
   */
  const gameUrl = process.env.GAME_URL ?? 'http://localhost:8081';
  try {
    const [quests, npcs] = await Promise.all([
      fetch(`${gameUrl}/api/content/quests`).then((r) => r.json()),
      fetch(`${gameUrl}/api/content/npcs`).then((r) => r.json()),
    ]);
    ok(
      `the GAME serves ${quests.quests?.length ?? 0} quest(s) and ${npcs.npcs?.length ?? 0} NPC(s)`,
    );
  } catch (error) {
    note(`could not read the game's content API: ${error.message}`);
  }

  console.log('\n📜 The pilot quest set is live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
