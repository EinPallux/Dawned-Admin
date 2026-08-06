#!/usr/bin/env node
/**
 * Put the Dawnlands' places and furniture on the map (game P12-F).
 *
 * POIs, chests, campfires, signposts, the Grove portal and the five towns'
 * dressing props — all resolved against the real height field by the same
 * `placeAll` the camps and gathering clusters use, then written into the map
 * draft and published.
 *
 * **Layer ownership decides whether you may clear.** `poi`, `interactable` and
 * `prop` are all SHARED with hand placement in the editor — the nine Ancient
 * Shrines, the forty buildings and the four marked stumps live in them — so
 * this script UPSERTS by id and never clears. It prints exactly which ids it
 * owns, so anything else in those layers is demonstrably the owner's.
 *
 * Usage: node tools/content/author-places.mjs [http://localhost:8082] [--no-map]
 * Requires: the panel API (pnpm dev), the game repo's migrated Postgres, and the
 * GAME server on :8081 for the map publish + hot reload.
 */

import pg from 'pg';
import argon2 from 'argon2';
import { pointInPolygon } from '@dawned/shared';
import { placeAll } from './placement.js';
import { SETTLEMENTS, buildingWorldPos } from './settlement-data.js';
import { POI_WISHES, INTERACTABLE_WISHES, TOWN_DRESSING } from './places-data.mjs';

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

/** Deterministic 0–1 so a re-run rotates every barrel the same way. */
const jitter = (seed, salt) => {
  let h = (seed * 2654435761 + salt * 40503) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 0x1_0000_0000;
};

const round = (value) => Math.round(value * 100) / 100;

const main = async () => {
  console.log(`Placing the Dawnlands' places and furniture → ${BASE_URL}\n`);
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

  // --- 1. resolve every wish against the real ground ------------------------
  const poiPlaced = placeAll(POI_WISHES);
  ok(`${poiPlaced.length} POIs resolved (moved ${poiPlaced.filter((p) => p.movedM > 0).length})`);
  const interactablePlaced = placeAll(INTERACTABLE_WISHES);
  ok(
    `${interactablePlaced.length} interactables resolved ` +
      `(moved ${interactablePlaced.filter((p) => p.movedM > 0).length})`,
  );

  const pois = POI_WISHES.map((wish, index) => ({
    id: wish.id,
    name: wish.name,
    kind: wish.kind,
    x: round(poiPlaced[index].x),
    z: round(poiPlaced[index].z),
    radius: wish.radius,
    xpBasis: wish.xpBasis,
    icon: '',
  }));

  const interactables = INTERACTABLE_WISHES.map((wish, index) => ({
    id: wish.id,
    kind: wish.kind,
    name: wish.name,
    x: round(interactablePlaced[index].x),
    z: round(interactablePlaced[index].z),
    yOffset: 0,
    rotation: round(jitter(index + 1, 7) * 6.28),
    modelRef: wish.modelRef,
    lootTableId: wish.lootTableId ?? null,
    respawnMs: wish.respawnMs ?? 600_000,
    text: wish.text ?? '',
    destX: wish.destX ?? null,
    destZ: wish.destZ ?? null,
    travelNode: false,
  }));

  // --- 2. town dressing, positioned like the buildings ----------------------
  const dressing = [];
  for (const town of SETTLEMENTS) {
    const list = TOWN_DRESSING[town.id] ?? [];
    list.forEach(([model, dx, dz, yaw, solidRadius], index) => {
      const at = buildingWorldPos(town, { dx, dz, yaw });
      dressing.push({
        id: `dress_${town.id}_${index}`,
        modelRef: `world_props_${model}`,
        x: round(at.x),
        z: round(at.z),
        yOffset: 0,
        rotation: round(at.yaw),
        // A little scale variance so a row of barrels is not one mesh repeated.
        scale: round(0.92 + jitter(index + 1, town.id.length * 13) * 0.16),
        tiltX: 0,
        tiltZ: 0,
        collection: `dressing_${town.id}`,
        solid: solidRadius > 0,
        radius: solidRadius,
      });
    });
  }
  ok(`${dressing.length} dressing props across ${SETTLEMENTS.length} settlements`);

  if (SKIP_MAP) {
    console.log('\n🏘  Resolved only (--no-map). Nothing was written.\n');
    return;
  }

  // --- 3. write them into the map draft ------------------------------------
  const lock = await fetch(`${BASE_URL}/api/map/lock`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ force: true }),
  });
  const lockBody = await lock.json().catch(() => null);
  if (!lock.ok || !lockBody?.mine) fail(`could not take the map lock: ${JSON.stringify(lockBody)}`);

  const write = async (layer, defs) => {
    for (let start = 0; start < defs.length; start += 200) {
      const batch = defs.slice(start, start + 200);
      const response = await fetch(`${BASE_URL}/api/map/objects`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ objects: batch.map((def) => ({ layer, def })) }),
      });
      if (!response.ok) fail(`saving ${layer} rows failed: ${await response.text()}`);
    }
    ok(`${defs.length} ${layer} rows written (upserted by id — this layer is shared)`);
  };

  await write('poi', pois);
  await write('interactable', interactables);
  await write('prop', dressing);
  note(`ids owned by this script: poi_* (${pois.length}), the interactables listed above, dress_*`);

  // --- 4. publish -----------------------------------------------------------
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

  // --- 5. report WHERE it stands, not only how much of it there is ----------
  //
  // P12-E's lesson: a per-kind count was perfect through every run in which 39
  // nodes stood in the wrong zone, because a count cannot see a border. So this
  // resolves each row's zone the way `bakeDraft` resolves it and prints that.
  const zoneResponse = await fetch(`${BASE_URL}/api/map/objects?layers=zone`, { headers });
  const zoneRings = (await zoneResponse.json()).objects.map((row) => row.def);
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

  const tally = (rows, label) => {
    const byZone = new Map();
    for (const row of rows) {
      const zone = zoneAt(row.x, row.z) ?? 'NO ZONE';
      byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    }
    console.log(`\n${label} standing in:`);
    for (const [zone, count] of [...byZone].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(count).padStart(3)} in ${zone}`);
    }
  };

  const byKind = new Map();
  for (const poi of pois) byKind.set(poi.kind, (byKind.get(poi.kind) ?? 0) + 1);
  console.log('\nPOIs by kind:');
  for (const [kind, count] of [...byKind].sort()) {
    console.log(`   ${String(count).padStart(3)} × ${kind}`);
  }
  tally(pois, 'POIs');

  const kinds = new Map();
  for (const row of interactables) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
  console.log('\nInteractables by kind (the 9 shrines were placed in P12-B):');
  for (const [kind, count] of [...kinds].sort()) {
    console.log(`   ${String(count).padStart(3)} × ${kind}`);
  }
  tally(interactables, 'Interactables');

  console.log('\n🏘  The world has places to find and things to press F on.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
