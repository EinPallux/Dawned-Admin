#!/usr/bin/env node
/**
 * P5 DoD proof: "ability numbers live-tunable from admin panel without
 * restart." Bumps Crushing Blow's damage coefficient through the panel API
 * (draft → publish v1 → ops hot-reload), verifies the GAME serves the new
 * number, then reverts the same way. The game server must be running.
 *
 * Usage: node tools/content/live-tune-proof.mjs [http://localhost:8082]
 */

import { openAdminSession } from './admin-session.mjs';

const BASE_URL = process.argv[2] ?? 'http://localhost:8082';
const GAME_URL = 'http://127.0.0.1:8081';
const TARGET = 'ability_warrior_crushing_blow';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message) => console.log(`✅ ${message}`);
const fail = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

const gameCoef = async () => {
  const response = await fetch(`${GAME_URL}/api/content/abilities`);
  const { abilities } = await response.json();
  const def = abilities.find((a) => a.id === TARGET);
  if (!def) fail(`game does not serve ${TARGET}`);
  return def.effects.find((e) => e.kind === 'damage').coef;
};

const main = async () => {
  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const headers = session.headers;

  const detail = await (await fetch(`${BASE_URL}/api/abilities/${TARGET}`, { headers })).json();
  const original = detail.published;
  if (!original) fail(`${TARGET} has no published row`);
  const originalCoef = original.effects.find((e) => e.kind === 'damage').coef;
  const liveBefore = await gameCoef();
  if (liveBefore !== originalCoef)
    fail(`game (${liveBefore}) and panel (${originalCoef}) disagree`);
  ok(`baseline: ${TARGET} coef ${originalCoef} (panel and game agree)`);

  const tuned = structuredClone(original);
  tuned.effects.find((e) => e.kind === 'damage').coef =
    Math.round((originalCoef + 0.15) * 100) / 100;

  const publishRound = async (def, label) => {
    const put = await fetch(`${BASE_URL}/api/abilities/${def.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(def),
    });
    if (!put.ok) fail(`${label}: draft rejected (${put.status}) ${await put.text()}`);
    const publish = await fetch(`${BASE_URL}/api/publish/abilities`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const result = await publish.json();
    if (!publish.ok || !result.ok) fail(`${label}: publish refused ${JSON.stringify(result)}`);
    if (!result.reload.ok) fail(`${label}: game did not hot-reload (${result.reload.note})`);
    return result;
  };

  const tuneCoef = tuned.effects.find((e) => e.kind === 'damage').coef;
  await publishRound(tuned, 'tune');
  const liveTuned = await gameCoef();
  if (liveTuned !== tuneCoef) fail(`game still serves ${liveTuned}, wanted ${tuneCoef}`);
  ok(
    `tuned live WITHOUT restart: coef ${originalCoef} → ${liveTuned} (publish → /ops/reload-content)`,
  );

  await publishRound(original, 'revert');
  const liveReverted = await gameCoef();
  if (liveReverted !== originalCoef) fail(`revert failed — game serves ${liveReverted}`);
  ok(`reverted to ${originalCoef} the same way — content is canonical again`);

  console.log('\n🔧 Live-tune DoD proven: panel edit → publish → hot reload, no restart.\n');
};

main().catch((error) => {
  fail(error.stack ?? String(error));
});
