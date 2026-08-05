#!/usr/bin/env node
/**
 * Quest editor smoke (A4, game P11) — the page driven in a real browser.
 *
 * A4's DoD is that a chain can be authored end to end by a non-coder flow and
 * that validation catches seeded errors in a fixture quest. Both halves are
 * here, and both are checked by READING what the page says rather than by
 * asserting a panel appeared: a preview that renders is not a preview that is
 * right, and a publish that returns 422 is only useful if the reason is on
 * screen.
 *
 * The gate that matters most is the one a fixture proves: publish REFUSES a
 * quest whose giver is not published. That failure is otherwise invisible until
 * the game's next boot, where it stops the whole server rather than one quest.
 *
 * Fixtures are `zz_probe` drafts created through the real endpoints and deleted
 * at the end (including on failure), so a run leaves the database as it found
 * it and never publishes anything.
 *
 * Usage: node tools/smoke/quest-editor.mjs [http://localhost:5174] [--screenshots DIR]
 * Requires: the panel dev stack (`pnpm dev`) and local Postgres.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import pg from 'pg';
import { suggestedQuestGold, suggestedQuestXp, xpToNextDefault } from '@dawned/shared';

const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5174';
const shotIndex = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotIndex !== -1 ? process.argv[shotIndex + 1] : null;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`   ${message}`);
class SmokeFailure extends Error {}
const fail = (message) => {
  throw new SmokeFailure(message);
};

const db = new pg.Client({ connectionString: DATABASE_URL });

const shoot = async (page, name) => {
  if (!SHOT_DIR) return;
  try {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 30000 });
  } catch (error) {
    console.warn(`⚠️  screenshot ${name} skipped (${error.message.split('\n')[0]})`);
  }
};

const MARLA = {
  id: 'npc_zz_probe_marla',
  name: 'Probe Marla',
  title: 'gate farmer',
  role: 'quest_giver',
  appearance: {
    body: 'f',
    skin: 1,
    outfit: 'peasant',
    outfitTint: 0,
    hair: 'buns',
    hairColor: 2,
    beard: false,
  },
  idleClip: 'Idle',
  talkClip: '',
  vendorId: null,
  barks: [{ text: 'Mind the bees.', emote: '' }],
  barkCooldownSec: 45,
  scale: 1,
};

/** A two-link chain: the second is gated behind the first being turned in. */
const CHAIN_1 = {
  id: 'quest_zz_probe_silence_1',
  name: 'Probe: The Quiet Camp',
  zoneId: 'zone_dawnshore',
  suggestedLevel: 4,
  giver: { kind: 'npc', npcId: MARLA.id },
  turnInNpcId: MARLA.id,
  prerequisites: { level: 1, questIds: [], discoveryIds: [] },
  repeatable: false,
  chainId: 'chain_zz_probe',
  steps: [
    {
      type: 'explore',
      x: 40,
      z: 12,
      radius: 30,
      clueText: 'Where the gulls stop circling.',
      trackerText: 'Find the logging site',
      hint: null,
      hooks: [],
    },
  ],
  rewards: { xp: 180, gold: 24, items: [], choices: [], title: '' },
  dialogue: {
    offer: [
      {
        id: 'offer',
        npcId: MARLA.id,
        text: 'Nobody has come back from the cut this week.',
        emote: '',
        choices: [
          { text: "I'll look", action: 'accept', goto: '' },
          { text: 'Not now', action: 'decline', goto: '' },
        ],
      },
    ],
    inProgress: [],
    complete: [
      {
        id: 'done',
        npcId: MARLA.id,
        text: 'You found it, then.',
        emote: '',
        choices: [{ text: 'I did', action: 'turn_in', goto: '' }],
      },
    ],
  },
  journalText: 'Marla says the loggers stopped singing three days ago.',
  trackable: true,
};

const CHAIN_2 = {
  ...CHAIN_1,
  id: 'quest_zz_probe_silence_2',
  name: 'Probe: What Took Them',
  suggestedLevel: 6,
  prerequisites: { level: 1, questIds: [CHAIN_1.id], discoveryIds: [] },
  steps: [
    {
      type: 'interact',
      objectId: null,
      objectTag: 'stump',
      count: 4,
      trackerText: 'Stumps inspected',
      hint: { x: 40, z: 12, radius: 40 },
      hooks: [],
    },
  ],
  journalText: 'Four stumps, cut clean and abandoned mid-swing.',
};

/** Deliberately broken: names a giver nobody published. */
const BROKEN = {
  ...CHAIN_1,
  id: 'quest_zz_probe_orphan',
  name: 'Probe: Orphan',
  chainId: '',
  prerequisites: { level: 1, questIds: [], discoveryIds: [] },
  giver: { kind: 'npc', npcId: 'npc_zz_probe_nobody' },
  turnInNpcId: 'npc_zz_probe_nobody',
  dialogue: { offer: [], inProgress: [], complete: [] },
};

const clearProbes = async () => {
  await db.query(`DELETE FROM content_quests WHERE id LIKE '%zz_probe%'`);
  await db.query(`DELETE FROM content_npcs WHERE id LIKE '%zz_probe%'`);
};

const provision = async () => {
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );
  await clearProbes();
};

const flat = async (page, selector) =>
  (await page.textContent(selector))?.replace(/\s+/g, ' ').trim() ?? '';

const run = async () => {
  await provision();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The pre-login 401 and the deliberate publish 422 both surface here.
    if (/status of (401|422)/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="username"]', ACCOUNT, { timeout: 30000 });
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.shell', { timeout: 30000 });
  ok('signed in');

  // Seed through the real draft endpoints — the same calls the editor's save
  // makes, so a schema the page cannot write is a schema this cannot seed.
  const put = async (kind, body) =>
    page.evaluate(
      async ({ kind, body }) => {
        const response = await fetch(`/admin/api/${kind}/${body.id}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dawned-admin': '1' },
          body: JSON.stringify(body),
        });
        return { status: response.status, text: await response.text() };
      },
      { kind, body },
    );

  for (const [kind, body] of [
    ['npcs', MARLA],
    ['quests', CHAIN_1],
    ['quests', CHAIN_2],
  ]) {
    const result = await put(kind, body);
    if (result.status !== 200) fail(`seeding ${body.id} failed: ${result.status} ${result.text}`);
  }
  ok('seeded an NPC and a two-link chain through the real draft endpoints');

  await page.goto(`${BASE_URL}/admin/content/quests`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.abilities-row', { timeout: 30000 });

  // --- the list -------------------------------------------------------------
  const rows = await page.$$eval('.abilities-row .abilities-row-name', (nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? ''),
  );
  if (!rows.includes(CHAIN_1.name) || !rows.includes(CHAIN_2.name)) {
    fail(`the chain is not in the list — saw ${rows.join(', ')}`);
  }
  ok(`both chain links are listed (${rows.length} quests visible)`);

  // --- the preview ----------------------------------------------------------
  await page.click(`.abilities-row:has-text("${CHAIN_1.name}")`);
  await page.waitForSelector('.abilities-json', { timeout: 15000 });
  await page.click('.enemies-sim-controls button:has-text("preview")');
  await page.waitForSelector('.quests-journal', { timeout: 15000 });

  const journal = await flat(page, '.quests-journal');
  if (!journal.includes('loggers stopped singing')) {
    fail(`the journal prose is not on screen — saw "${journal.slice(0, 120)}"`);
  }
  if (!journal.includes('Find the logging site')) {
    fail('the tracker line is missing from the preview');
  }
  // An EXPLORE step must show its CLUE and no map hint — QUESTS_POI §1.4 says
  // explore quests never mark anything, and a preview that showed a marker
  // would be advertising a feature the game deliberately does not have.
  if (!journal.includes('Where the gulls stop circling')) {
    fail('the explore clue is not shown — the player has nothing else to go on');
  }
  if (journal.includes('map hint')) {
    fail('the preview offers a map hint on an explore step (QUESTS_POI §1.4)');
  }
  ok('the preview renders the journal, the tracker and the explore clue with no marker');

  const facts = await flat(page, '.items-budget-facts');
  if (!facts.includes('Probe Marla')) fail(`the giver is not resolved — saw "${facts}"`);
  // The ƒ-suggest must be the SHARED formula's answer, not a number the page
  // invented. Checking the arithmetic is the difference between "a panel
  // appeared" and "the panel agrees with the game".
  const expectXp = suggestedQuestXp(CHAIN_1.suggestedLevel, CHAIN_1.steps.length, xpToNextDefault);
  const expectGold = suggestedQuestGold(CHAIN_1.suggestedLevel, CHAIN_1.steps.length);
  if (!facts.includes(`ƒ ${expectXp}`)) {
    fail(
      `the ƒ-suggested xp on screen disagrees with the shared formula (${expectXp}): "${facts}"`,
    );
  }
  if (!facts.includes(`ƒ ${expectGold}`)) {
    fail(`the ƒ-suggested gold disagrees with the shared formula (${expectGold}): "${facts}"`);
  }
  ok(`the ƒ-suggests match the shared formulas (xp ${expectXp}, gold ${expectGold})`);
  await shoot(page, 'a4-preview.png');

  // --- the chain graph ------------------------------------------------------
  await page.waitForSelector('.quests-chain', { timeout: 15000 });
  const chain = await flat(page, '.quests-chain');
  if (!chain.includes(CHAIN_1.name) || !chain.includes(CHAIN_2.name)) {
    fail(`the chain graph is missing a link — saw "${chain}"`);
  }
  if (!chain.includes('1 unlocked')) {
    fail(`the graph does not show link 1 unlocking link 2 — saw "${chain}"`);
  }
  ok('the chain graph draws the link the game actually gates on');

  // --- validation catches a seeded error ------------------------------------
  const seeded = await put('quests', BROKEN);
  if (seeded.status !== 200) fail(`seeding the broken quest failed: ${seeded.status}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.abilities-publish-button', { timeout: 30000 });

  // Publish is confirm-gated; accept it, because the point is that it REFUSES.
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.click('.abilities-publish-button');
  await page.waitForSelector('.abilities-publish-result.is-error', { timeout: 30000 });
  const refusal = await flat(page, '.abilities-publish-result');
  if (!refusal.includes('npc_zz_probe_nobody')) {
    fail(`publish refused but did not say why — saw "${refusal.slice(0, 200)}"`);
  }
  ok('publish REFUSES a quest whose giver is not published, and names the giver');

  // The LIST has to warn too. A quest that only fails at publish looks healthy
  // in the sidebar, and an author scanning twenty rows for the broken one has
  // no way to find it — the dot is the affordance that makes it findable.
  const flagged = await page.$$eval('.abilities-row', (nodes) =>
    nodes
      .filter((node) => node.querySelector('.quests-row-problem'))
      .map((node) => node.querySelector('.abilities-row-name')?.textContent?.trim() ?? ''),
  );
  if (!flagged.includes(BROKEN.name)) {
    fail(
      `the broken quest has no problem dot in the list — flagged: ${flagged.join(', ') || 'none'}`,
    );
  }
  ok('the list flags the broken quest with a problem dot, before publish is pressed');
  note(refusal.slice(0, 140));
  await shoot(page, 'a4-refused.png');

  // Nothing may have gone live on a refused publish.
  const live = await db.query(
    `SELECT count(*)::int AS n FROM content_quests WHERE status = 'published' AND id LIKE '%zz_probe%'`,
  );
  if (live.rows[0].n !== 0)
    fail(`a refused publish still wrote ${live.rows[0].n} published row(s)`);
  ok('a refused publish wrote nothing — the drafts are still drafts');

  if (errors.length > 0) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`);
  ok('no console errors');

  await browser.close();
  console.log('\n📜 quest editor smoke passed\n');
};

run()
  .catch((error) => {
    console.error(`\n❌ ${error instanceof SmokeFailure ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Clean up even on failure — a run must leave the database as it found it,
    // or the next run inherits this one's fixtures and measures them instead.
    await clearProbes().catch(() => {});
    await db.end().catch(() => {});
  });
