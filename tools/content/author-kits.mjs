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

import { openAdminSession } from './admin-session.mjs';
import { ownerEditGuards } from './owner-edits.mjs';
import { publishRail } from './publish.mjs';
import { KIT_DEFS } from './kits-data.mjs';

const BASE_URL = process.argv[2] ?? 'http://localhost:8082';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const main = async () => {
  console.log(`Authoring P5 kits through the panel API → ${BASE_URL}\n`);

  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const headers = session.headers;
  ok('panel session open');

  let saved = 0;
  // Never revert an ability the owner retuned in the panel (owner-edits.mjs).
  const guard = await ownerEditGuards([['abilities', 'content_abilities']]);
  for (const def of KIT_DEFS) {
    if (!guard.mayWrite('abilities', def.id, def)) continue;
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
  guard.report();
  ok(`${saved} kit defs saved as drafts (validated by the shared schema)`);

  const diff = await fetch(`${BASE_URL}/api/publish/abilities/diff`, { headers });
  const entries = (await diff.json()).entries;
  ok(`publish diff: ${entries.length} pending`);

  await publishRail(BASE_URL, headers, 'abilities', 'abilities');
  await guard.commit();
  console.log('\n⚔️  Kits are live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
