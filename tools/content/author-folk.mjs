#!/usr/bin/env node
/**
 * Give the Dawnlands its people (game P12-F).
 *
 * NPC definitions on the Quests page's publish rail (quests and NPCs ship
 * together — they reference each other, and shipping them apart guarantees a
 * window where a live quest points at somebody who is not there), then their
 * placements into the map's `npc` layer, then a map publish.
 *
 * **Where a vendor NPC stands is not a free choice.** A vendor row carries an
 * `anchor` whose radius is the proximity lease the server checks before it will
 * open a trade — and the schema's own comment says the anchor exists "until P12
 * places the real NPC". So each vendor's body is placed ON its anchor. Put them
 * anywhere else and `F` offers a trade the server then refuses, which is the
 * worst kind of wrong: it looks like it works.
 *
 * Usage: node tools/content/author-folk.mjs [http://localhost:8082] [--no-map]
 */

import pg from 'pg';
import argon2 from 'argon2';
import { placeAll } from './placement.js';
import { SETTLEMENTS, buildingWorldPos } from './settlement-data.js';
import { NPC_DEFS, NPC_TOWN, PILOT_NPCS } from './npc-data.mjs';

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

const round = (value) => Math.round(value * 100) / 100;

const main = async () => {
  console.log(`Peopling the Dawnlands → ${BASE_URL}\n`);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );
  // Vendor anchors decide where their shopkeeper stands (see the header).
  const vendorRows = await db.query(`select def from content_vendors where status = 'published'`);
  const anchors = new Map();
  for (const row of vendorRows.rows) {
    const def = typeof row.def === 'string' ? JSON.parse(row.def) : row.def;
    if (def.anchor) anchors.set(def.id, def.anchor);
  }
  await db.end();
  ok(`${anchors.size} vendor anchors read`);

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

  // --- 1. definitions -------------------------------------------------------
  for (const def of NPC_DEFS) {
    const response = await fetch(`${BASE_URL}/api/npcs/${def.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(def),
    });
    if (!response.ok) fail(`npc draft ${def.id} rejected: ${await response.text()}`);
  }
  ok(`${NPC_DEFS.length} NPC definitions saved as drafts`);

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
    ok('NPCs: already live, nothing to publish');
  } else if (!publish.ok || !published?.ok) {
    fail(
      `NPC publish refused:\n${(problems.length ? problems : [JSON.stringify(published)]).join('\n')}`,
    );
  } else {
    ok(`published ${published.published} NPC/quest rows`);
    for (const warning of published.warnings ?? []) note(`⚠️  ${warning}`);
  }

  if (SKIP_MAP) {
    console.log('\n👥 Definitions are live. Placements skipped (--no-map).\n');
    return;
  }

  // --- 2. placements --------------------------------------------------------
  //
  // Three kinds of position, in priority order:
  //  1. A vendor stands ON its anchor (the proximity lease decides, not taste).
  //  2. Everyone else in a town takes a slot on a ring around its centre,
  //     spread evenly and rotated with the town's facing so nobody is inside a
  //     wall — the same `buildingWorldPos` the buildings and dressing use.
  //  3. The Grove's Warden has no town, so it is a wish like everything else.
  const placements = [];
  const perTown = new Map();
  for (const def of NPC_DEFS) {
    const town = NPC_TOWN[def.id];
    if (town) perTown.set(town, [...(perTown.get(town) ?? []), def]);
  }
  // The four P11 villagers belong to Dawnhaven's arrangement too, so the town
  // is laid out once rather than as two passes that never met.
  perTown.set('dawnhaven', [
    ...(perTown.get('dawnhaven') ?? []),
    ...PILOT_NPCS.map((id) => ({ id, vendorId: null })),
  ]);

  for (const town of SETTLEMENTS) {
    const folk = perTown.get(town.id) ?? [];
    // Non-vendors ring the centre; vendors are pinned and take no ring slot.
    const ringed = folk.filter((def) => !def.vendorId || !anchors.has(def.vendorId));
    ringed.forEach((def, index) => {
      const angle = (index / Math.max(1, ringed.length)) * Math.PI * 2;
      // 0.62 of the radius: outside the buildings' cluster, inside the plateau's
      // flat core (the plateau is only ~55 % flat — P12-B measured that).
      const reach = town.radius * 0.62;
      const at = buildingWorldPos(town, {
        dx: Math.cos(angle) * reach,
        dz: Math.sin(angle) * reach,
        // Face the middle of town, which is where a player walks in from.
        yaw: angle + Math.PI,
      });
      placements.push({
        id: `stand_${def.id}`,
        npcId: def.id,
        x: round(at.x),
        z: round(at.z),
        yOffset: 0,
        rotation: round(at.yaw),
      });
    });
    for (const def of folk) {
      const anchor = def.vendorId ? anchors.get(def.vendorId) : null;
      if (!anchor) continue;
      placements.push({
        id: `stand_${def.id}`,
        npcId: def.id,
        x: round(anchor.x),
        z: round(anchor.z),
        yOffset: 0,
        rotation: 0,
      });
    }
  }

  // The Warden of the Elder Grove: no settlement, so a wish like any other.
  const [warden] = placeAll([
    {
      id: 'npc_hermit',
      zone: 'elder_grove',
      bearing: 120,
      distance: 60,
      maxSlope: 16,
      clearance: 20,
      allowNearTown: true,
    },
  ]);
  placements.push({
    id: 'stand_npc_hermit',
    npcId: 'npc_hermit',
    x: round(warden.x),
    z: round(warden.z),
    yOffset: 0,
    rotation: 2.4,
  });
  ok(`${placements.length} NPC placements resolved`);

  const lock = await fetch(`${BASE_URL}/api/map/lock`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ force: true }),
  });
  const lockBody = await lock.json().catch(() => null);
  if (!lock.ok || !lockBody?.mine) fail(`could not take the map lock: ${JSON.stringify(lockBody)}`);

  // The `npc` layer is THIS script's alone (P11-C's rule), so it may clear —
  // unlike `poi`, `interactable` and `prop`, which are shared with the editor.
  const cleared = await fetch(`${BASE_URL}/api/map/objects/clear-layer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ layer: 'npc' }),
  });
  if (!cleared.ok) fail(`could not clear the npc layer: ${await cleared.text()}`);
  const clearedBody = await cleared.json();
  if (clearedBody.removed > 0) note(`cleared ${clearedBody.removed} existing placement(s)`);

  for (let start = 0; start < placements.length; start += 200) {
    const batch = placements.slice(start, start + 200);
    const save = await fetch(`${BASE_URL}/api/map/objects`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ objects: batch.map((def) => ({ layer: 'npc', def })) }),
    });
    if (!save.ok) fail(`saving npc placements failed: ${await save.text()}`);
  }
  ok(`${placements.length} NPC placements written into the map draft`);

  // --- 3. publish -----------------------------------------------------------
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

  const roles = new Map();
  for (const def of NPC_DEFS) roles.set(def.role, (roles.get(def.role) ?? 0) + 1);
  console.log('\nAuthored by role (plus the 4 P11 pilots, all quest givers):');
  for (const [role, count] of [...roles].sort()) {
    console.log(`   ${String(count).padStart(3)} × ${role}`);
  }
  const towns = new Map();
  for (const placement of placements) {
    const town = NPC_TOWN[placement.npcId] ?? 'elder_grove / pilot';
    towns.set(town ?? 'unplaced', (towns.get(town ?? 'unplaced') ?? 0) + 1);
  }
  console.log('\nStanding in:');
  for (const [town, count] of [...towns].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(3)} in ${town}`);
  }

  console.log('\n👥 The Dawnlands are inhabited.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
