#!/usr/bin/env tsx
/**
 * Raise the Dawnlands THROUGH the panel (game P12-A).
 *
 * Four passes, in the only order that works:
 *  1. **Take the lock.** Everything below is a write, and the panel enforces one
 *     writer at a time server-side rather than trusting the UI.
 *  2. **Write the six zones plus the Dawnsea** into the map draft's `zone`
 *     layer. First, because each splat rule names the zone it paints and the
 *     generator resolves those against the draft — the palette and the region
 *     then cannot describe different ground, and a rule naming a zone that is
 *     not there is refused instead of quietly painting the world.
 *  3. **Generate the terrain** from `world-data.ts`'s island masks and straits
 *     via `/api/map/generate-stream`. It checkpoints first, so the previous
 *     world is one restore away.
 *  4. **Publish**, then ask the GAME whether it swapped worlds. A publish that
 *     reports success and a server still walking on the old bake is the failure
 *     this last step exists to catch.
 *
 * It is safe to re-run: the generator is deterministic from its seeds, zones
 * upsert by id, and an unchanged draft prunes itself at publish.
 *
 * WARNING: this REPLACES every metre of terrain in the draft and then makes it
 * live. Placed objects are not touched — they re-sit on the new heights — but
 * anything sitting on the old island is now standing on whatever the masks put
 * there. That is the point of P12, and it is why the checkpoint is taken first.
 *
 * Usage: pnpm world:author [http://localhost:8082] [--no-publish]
 * Requires: the panel API (pnpm dev), the game repo's migrated Postgres, and
 * the GAME server on :8081 for the publish's hot reload.
 */

import pg from 'pg';
import argon2 from 'argon2';
import { SEA_LEVEL, WORLD_GEN_PLAN, ZONES } from './world-data.js';

const BASE_URL = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8082';
const SKIP_PUBLISH = process.argv.includes('--no-publish');
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message: string): void => {
  console.log(`✅ ${message}`);
};
const note = (message: string): void => {
  console.log(`   ${message}`);
};
// Annotated on the const rather than the arrow: TypeScript only narrows after a
// never-returning call when the CALLED value carries an explicit type.
const fail: (message: string) => never = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

/** Read an SSE stream to its `done` frame rather than firing and hoping. */
const readStream = async (
  response: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<Record<string, unknown> | null> => {
  if (!response.body) return null;
  let done: Record<string, unknown> | null = null;
  let buffer = '';
  for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += Buffer.from(part).toString('utf8');
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !raw) continue;
      const data: unknown = JSON.parse(raw);
      if (event === 'done') done = data as Record<string, unknown>;
      else onEvent(event, data);
    }
  }
  return done;
};

const main = async (): Promise<void> => {
  console.log(`\nRaising the Dawnlands through the panel → ${BASE_URL}\n`);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );
  await db.end();

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
  // Two header sets on purpose. Fastify rejects a body-less request that still
  // announces `content-type: application/json` — the same trap the panel's own
  // `api.ts` fixed for the publish button, and the lock is a body-less POST.
  const bare = { 'x-dawned-admin': '1', cookie };
  const headers = { ...bare, 'content-type': 'application/json' };
  ok('panel session open');

  // --- 1 · the lock -------------------------------------------------------
  const lock = await fetch(`${BASE_URL}/api/map/lock`, { method: 'POST', headers: bare });
  if (!lock.ok) {
    const body: unknown = await lock.json().catch(() => null);
    fail(`could not take the map lock: ${JSON.stringify(body)}`);
  }
  ok('map lock held');

  try {
    // --- 2 · the zones ----------------------------------------------------
    // Written BEFORE the terrain, because the generator resolves each splat
    // rule's `zoneId` against the draft's own zone layer — a palette that
    // names a zone the draft has never heard of is refused rather than
    // silently painting the whole world.
    console.log('');
    // CLEAR first. Writing by id leaves every zone the draft already had, and
    // the draft was seeded from the dev island by `import-live` — so the old
    // `ashen_reach` ring survived the whole world regeneration, sat inside the
    // savanna and the canyons, and (being a smaller ring, which is the order
    // `zoneAt` resolves in) WON there: 9 camps and 36 enemies reported
    // themselves as standing in a zone WORLD.md does not have. Found by the
    // game's own `/ops/camps`, not by anything in this repo.
    const cleared = await fetch(`${BASE_URL}/api/map/objects/clear-layer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ layer: 'zone' }),
    });
    if (!cleared.ok) fail(`clearing the zone layer failed: ${await cleared.text()}`);
    note(`cleared ${((await cleared.json()) as { removed?: number }).removed ?? 0} old zone(s)`);
    const zoneSave = await fetch(`${BASE_URL}/api/map/objects`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ objects: ZONES.map((zone) => ({ layer: 'zone', def: zone })) }),
    });
    if (!zoneSave.ok) fail(`saving zones failed: ${await zoneSave.text()}`);
    ok(`${ZONES.length} zones written into the map draft`);
    for (const zone of ZONES) {
      note(
        `  ${zone.name.padEnd(20)} lvl ${String(zone.levelMin).padStart(2)}–${String(zone.levelMax).padEnd(2)} ` +
          `· ${zone.polygon.length} corners · ${zone.settlement ?? '—'}`,
      );
    }

    // --- 3 · the terrain --------------------------------------------------
    const plan = encodeURIComponent(JSON.stringify(WORLD_GEN_PLAN));
    console.log('');
    note(
      `generating ${WORLD_GEN_PLAN.masks.filter((m) => m.kind !== 'carve').length} landmass(es) ` +
        `and ${WORLD_GEN_PLAN.masks.filter((m) => m.kind === 'carve').length} strait(s)…`,
    );
    const gen = await fetch(`${BASE_URL}/api/map/generate-stream?plan=${plan}`, {
      headers: bare,
    });
    if (!gen.ok) fail(`world generation refused (${gen.status}): ${await gen.text()}`);
    let lastFraction = -1;
    const genDone = await readStream(gen, (event, data) => {
      if (event !== 'progress') return;
      const progress = data as { message: string; fraction: number };
      // One line per tenth: a 1024-chunk save emits a frame per batch and the
      // point of a progress bar is to show life, not to fill the terminal.
      const tenth = Math.floor(progress.fraction * 10);
      if (tenth === lastFraction) return;
      lastFraction = tenth;
      note(`${String(Math.round(progress.fraction * 100)).padStart(3)}%  ${progress.message}`);
    });
    if (!genDone?.['ok']) {
      fail(
        `world generation failed:\n${((genDone?.['problems'] as string[] | undefined) ?? ['no done event']).join('\n')}`,
      );
    }
    const report = genDone['report'] as {
      chunksWritten: number;
      chunksEnabled: number;
      landVertices: number;
      perIsland: Record<string, number>;
      erodedVertices: number;
      splatTexels: number;
      unpaintedTexels: number;
    };
    ok(
      `${report.chunksWritten} chunks written, ${report.chunksEnabled} carry land ` +
        `(checkpoint #${String(genDone['checkpoint'])} taken first)`,
    );
    const coverage = (report.landVertices / (2049 * 2049)) * 100;
    note(
      `land ${coverage.toFixed(1)} % of the world · ${report.erodedVertices.toLocaleString()} vertices eroded · ` +
        `${report.splatTexels.toLocaleString()} texels painted, ${report.unpaintedTexels} unclaimed`,
    );
    for (const [id, area] of Object.entries(report.perIsland).sort((a, b) => b[1] - a[1])) {
      if (area > 0) note(`  ${id.padEnd(18)} ${area.toLocaleString().padStart(9)} m²`);
    }
    if (report.unpaintedTexels > 0) {
      note(`⚠️  ${report.unpaintedTexels} texel(s) no splat rule claimed — they render unblended`);
    }

    if (SKIP_PUBLISH) {
      console.log('\n--no-publish: the draft holds the new world; nothing is live.\n');
      return;
    }

    // --- 4 · publish, and ask the GAME ------------------------------------
    console.log('');
    const stream = await fetch(`${BASE_URL}/api/map/publish-stream`, { headers: bare });
    if (!stream.ok) fail(`publish stream refused (${stream.status}): ${await stream.text()}`);
    const done = await readStream(stream, (event, data) => {
      if (event !== 'validation') return;
      for (const warning of (data as { warnings?: string[] }).warnings ?? [])
        note(`⚠️  ${warning}`);
    });
    if (!done?.['ok']) {
      fail(
        `map publish refused:\n${((done?.['problems'] as string[] | undefined) ?? ['no done event']).join('\n')}`,
      );
    }
    const result = done['result'] as { chunksEmitted?: number } | undefined;
    ok(`map published as ${String(done['version'])} (${result?.chunksEmitted ?? '?'} chunks)`);
    const reload = done['reload'] as { ok?: boolean; note?: string } | undefined;
    note(
      reload?.ok
        ? `game swapped onto it: ${reload.note ?? ''}`
        : `⚠️  game NOT reloaded: ${reload?.note ?? 'no response'}`,
    );

    // The publish's own reload note is the panel talking about itself. Ask the
    // game what map it is actually serving — that is the only answer that says
    // the world crossed the repo boundary.
    const health = await fetch('http://127.0.0.1:8081/api/health').catch(() => null);
    if (health?.ok) {
      const body = (await health.json()) as { mapVersion?: string };
      note(
        body.mapVersion === done['version']
          ? `the game is serving ${String(body.mapVersion)} — the Dawnlands are live`
          : `⚠️  the game still serves ${String(body.mapVersion)}, not ${String(done['version'])}`,
      );
    } else {
      note('the game server is not answering on :8081 — could not confirm the swap');
    }
  } finally {
    await fetch(`${BASE_URL}/api/map/lock`, { method: 'DELETE', headers: bare }).catch(() => null);
  }

  console.log(`\n🌅 The Dawnlands stand. Sea level ${SEA_LEVEL} m.\n`);
};

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
