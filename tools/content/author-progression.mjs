#!/usr/bin/env node
/**
 * Author the P7 progression content THROUGH the panel API — the editor path
 * end to end (P7 DoD: `content_xp_curve`/nodes editable via A1 editors).
 * Provisions the dev admin account, logs into the panel, PUTs all 29 XP-curve
 * rows (formula defaults) and all 96 skill nodes as DRAFTS (the same
 * endpoints the Progression page calls), then runs the progression publish —
 * validate + cross-checks → copy live → hot-reload the game server.
 *
 * Usage: node tools/content/author-progression.mjs [http://localhost:8082]
 * Requires: admin API (pnpm dev) + the game repo's migrated Postgres with the
 * ability kits published (node refs cross-check against them).
 */

import { openAdminSession } from './admin-session.mjs';
import { defaultXpCurveEntries } from '@dawned/shared';
import { SKILL_NODE_DEFS } from './progression-data.mjs';

const BASE_URL = process.argv[2] ?? 'http://localhost:8082';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const main = async () => {
  console.log(`Authoring P7 progression through the panel API → ${BASE_URL}\n`);

  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const headers = session.headers;
  ok('panel session open');

  const curveEntries = defaultXpCurveEntries();
  for (const entry of curveEntries) {
    const response = await fetch(`${BASE_URL}/api/xp-curve/${entry.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(entry),
    });
    if (!response.ok) fail(`curve draft ${entry.id} rejected: ${await response.text()}`);
  }
  ok(`${curveEntries.length} xp-curve rows saved as drafts (formula defaults)`);

  let saved = 0;
  for (const def of SKILL_NODE_DEFS) {
    const response = await fetch(`${BASE_URL}/api/skill-nodes/${def.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(def),
    });
    if (!response.ok) fail(`node draft ${def.id} rejected: ${await response.text()}`);
    saved++;
  }
  ok(`${saved} skill nodes saved as drafts (validated by the shared schema)`);

  const diff = await fetch(`${BASE_URL}/api/publish/progression/diff`, { headers });
  const pending = await diff.json();
  ok(`publish diff: ${pending.curve.length} curve rows + ${pending.nodes.length} nodes pending`);

  const publish = await fetch(`${BASE_URL}/api/publish/progression`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const result = await publish.json();
  if (!publish.ok || !result.ok) {
    fail(`publish refused: ${JSON.stringify(result.problems ?? result)}`);
  }
  ok(`published ${result.published} progression rows`);
  console.log(
    result.reload.ok
      ? `✅ game hot-reloaded: ${result.reload.note}`
      : `⚠️  game not reloaded (${result.reload.note})`,
  );
  console.log('\n🌳 The XP curve and all four skill trees are live content.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
