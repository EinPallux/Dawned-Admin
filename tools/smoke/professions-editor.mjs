#!/usr/bin/env node
/**
 * Professions editor smoke (A1-e, game P10) — the page driven in a real
 * browser, because the numbers on it are the whole product.
 *
 * A preview that renders is not a preview that is RIGHT: the panel's job here
 * is to answer "what does this node give, how long does it take and how far
 * does it move the profession", and every one of those is a number the owner
 * will tune content against. So this run checks the arithmetic on screen
 * against the shared formulas rather than only asserting that a table appeared.
 *
 * It also proves the gate that matters most: publish REFUSES a node whose yield
 * is not a published item. That failure is otherwise invisible — the node
 * stands in the world, the player holds for three seconds, and nothing arrives.
 *
 * The fixtures are `zz_probe` drafts created through the real endpoint and
 * deleted at the end (including on failure), so a run leaves the database as it
 * found it and never publishes anything.
 *
 * Usage: node tools/smoke/professions-editor.mjs [http://localhost:5174] [--screenshots DIR]
 * Requires: the panel dev stack (`pnpm dev`) and local Postgres with the game's
 * published T1–T2 item catalogue (seed migration 0012).
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import pg from 'pg';
import { GATHER_XP_PER_TIER, gatherChannelMs, procChance } from '@dawned/shared';

const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5174';
const shotIndex = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotIndex !== -1 ? process.argv[shotIndex + 1] : null;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';
const ACCOUNT = 'zz_admin_smoke';
const PASSWORD = 'admin-smoke-pass-1';

const ok = (message) => console.log(`✅ ${message}`);
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

/**
 * Yields chosen from the P8 catalogue so the preview can resolve real names —
 * an unresolved id is a distinct failure mode and gets its own assertion.
 */
const BIRCH = {
  id: 'node_woodcutting_zz_probe_birch',
  name: 'Probe Birch',
  profession: 'woodcutting',
  tier: 1,
  modelRef: 'world_nature_tree_1_a_color1',
  depletedModelRef: 'world_nature_tree_bare_1_a_color1',
  yields: [{ itemId: 'item_material_driftwood', qtyMin: 1, qtyMax: 3, weight: 1 }],
  procs: [{ itemId: 'item_material_shore_crystal', qtyMin: 1, qtyMax: 1, weight: 1 }],
  channelMs: 3000,
  respawnMs: 120000,
  radius: 1.2,
  bonusRolls: 0,
};
const SHOAL = {
  id: 'node_fishing_zz_probe_shoal',
  name: 'Probe Shoal',
  profession: 'fishing',
  tier: 2,
  modelRef: 'world_nature_rock_1_a_color1',
  depletedModelRef: null,
  yields: [
    { itemId: 'item_material_silver_trout', qtyMin: 1, qtyMax: 1, weight: 9 },
    { itemId: 'item_material_mushcap', qtyMin: 1, qtyMax: 1, weight: 1 },
  ],
  procs: [],
  channelMs: 3000,
  respawnMs: 90000,
  radius: 1,
  bonusRolls: 0,
};

const clearProbes = () => db.query(`DELETE FROM content_resource_nodes WHERE id LIKE '%zz_probe%'`);

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

/** Text of a facts/whatever node, whitespace-collapsed for matching. */
const flat = async (page, selector) =>
  (await page.textContent(selector))?.replace(/\s+/g, ' ').trim() ?? '';

const run = async () => {
  await provision();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  /** Console noise that is NOT expected: the pre-login 401 and the deliberate
   *  publish 422 below both surface here and are filtered by their status. */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
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

  // Seed through the real draft endpoint — the same call the editor's save makes.
  const put = async (def) =>
    page.evaluate(async (body) => {
      const response = await fetch(`/admin/api/resource-nodes/${body.id}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-dawned-admin': '1' },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    }, def);
  for (const def of [BIRCH, SHOAL]) {
    const result = await put(def);
    if (result.status !== 200) fail(`seeding ${def.id}: ${result.status} ${result.text}`);
  }
  ok('two node drafts written through PUT /api/resource-nodes/:id');

  await page.click('.shell-rail a[href="/admin/content/professions"]');
  await page.waitForSelector('.abilities-list h2', { timeout: 15000 });
  if ((await page.textContent('.abilities-list h2'))?.trim() !== 'Professions') {
    fail('the rail link did not open the Professions page');
  }
  // Wait for the row rather than reading straight away: the list query was in
  // flight while the drafts were being written.
  await page.waitForSelector('.abilities-row:has-text("Probe Birch")', { timeout: 15000 });
  await page.waitForSelector('.abilities-row:has-text("Probe Shoal")', { timeout: 15000 });
  const groups = await page.$$eval('.abilities-group-title', (els) =>
    els.map((el) => el.textContent?.replace(/\s+/g, ' ').trim()),
  );
  if (!groups.some((title) => title?.startsWith('Woodcutting'))) {
    fail(`nodes are not grouped by profession (saw ${JSON.stringify(groups)})`);
  }
  ok(`listed and grouped by profession: ${groups.join(' · ')}`);

  // --- the gathering preview, checked against the shared formulas -----------

  await page.click('.abilities-row:has-text("Probe Birch")');
  await page.waitForSelector('.items-budget');
  // Selecting a node defaults the level to its own gate — T1 opens at 1.
  const level = await page.inputValue('.enemies-sim-controls input');
  if (level !== '1') fail(`T1 node should preview at its gate (level 1), opened at ${level}`);

  await page.click('.enemies-sim-controls button');
  await page.waitForSelector('.items-budget-facts', { timeout: 15000 });
  const facts = await flat(page, '.items-budget-facts');
  const expectHold = (gatherChannelMs(1, 1, BIRCH.channelMs) / 1000).toFixed(1);
  if (!facts.includes(`hold ${expectHold} s`)) {
    fail(`hold time should be ${expectHold} s from the shared formula — read "${facts}"`);
  }
  if (!facts.includes(`${GATHER_XP_PER_TIER * 1} prof xp`)) {
    fail(`a T1 gather at the frontier is ${GATHER_XP_PER_TIER} xp — read "${facts}"`);
  }
  const expectProc = Number((procChance(1, 0) * 100).toFixed(2));
  if (!facts.includes(`proc ${expectProc}%`)) {
    fail(`proc chance should be ${expectProc}% — read "${facts}"`);
  }
  const perHour = Math.round(
    3_600_000 / (gatherChannelMs(1, 1, BIRCH.channelMs) + BIRCH.respawnMs),
  );
  if (!facts.includes(`${perHour}`)) fail(`per-hour should be ~${perHour} — read "${facts}"`);
  ok(`preview matches the shared formulas: ${facts}`);

  const yields = await page.$$eval('.professions-table tr', (els) =>
    els.map((el) => [...el.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')),
  );
  const driftRow = yields.find((cells) => cells[0]?.startsWith('Driftwood Log'));
  if (!driftRow) fail(`the preview should name published items, saw ${JSON.stringify(yields)}`);
  if (yields.some((cells) => cells[0]?.includes('not published'))) {
    fail('a published item read as unknown in the preview');
  }
  // 1–3 per gather at even weight is ~200 per 100 gathers; a roller that lost
  // the qty range would report 100 and nobody would notice.
  const drift = Number(driftRow[1]);
  if (!(drift > 170 && drift < 230)) fail(`driftwood per 100 gathers looks wrong: ${driftRow[1]}`);
  ok(`yields resolve to item names and roll their qty range (${drift} logs / 100 gathers)`);
  await shoot(page, 'professions-preview.png');

  // The back-country halving is a design rule (§1.3) and easy to lose.
  await page.fill('.enemies-sim-controls input', '25');
  await page.click('.enemies-sim-controls button');
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.items-budget-facts')?.textContent ?? '';
      return text.includes('at prof 25');
    },
    { timeout: 15000 },
  );
  const late = await flat(page, '.items-budget-facts');
  if (!late.includes(`${GATHER_XP_PER_TIER / 2} prof xp`)) {
    fail(`a T1 node at prof 25 is back country and pays half — read "${late}"`);
  }
  ok('T1 at profession 25 previews half xp (the frontier push is live)');

  // --- fishing gets its bar ------------------------------------------------

  await page.click('.abilities-row:has-text("Probe Shoal")');
  await page.waitForSelector('.items-budget');
  if ((await page.inputValue('.enemies-sim-controls input')) !== '7') {
    fail('a T2 node should open its preview at the T2 gate (level 7)');
  }
  await page.click('.enemies-sim-controls button');
  await page.waitForSelector('.professions-fishing-head', { timeout: 15000 });
  const bar = await page.$$eval('.professions-fishing-head + table tr', (els) =>
    els.map((el) => el.textContent?.replace(/\s+/g, ' ').trim()),
  );
  if (bar.length !== SHOAL.yields.length) {
    fail(`every catch needs a bar difficulty, saw ${bar.length} of ${SHOAL.yields.length}`);
  }
  ok(`fishing node shows a per-catch bar difficulty: ${bar.join(' · ')}`);
  await shoot(page, 'professions-fishing.png');

  // A woodcutting node must NOT grow a fishing block.
  await page.click('.abilities-row:has-text("Probe Birch")');
  await page.click('.enemies-sim-controls button');
  await page.waitForTimeout(500);
  if (await page.$('.professions-fishing-head')) {
    fail('a woodcutting node is showing a fishing bar');
  }
  ok('the bar block belongs to fishing nodes only');

  // --- the publish rail refuses what the game cannot use --------------------

  const pending = await page.textContent('.abilities-pending');
  if (!pending?.startsWith('2')) fail(`publish rail should show 2 pending, read "${pending}"`);

  await put({ ...SHOAL, yields: [{ ...SHOAL.yields[0], itemId: 'item_material_zz_ghost' }] });
  const refusal = await page.evaluate(async () => {
    const response = await fetch('/admin/api/publish/resource-nodes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-dawned-admin': '1' },
    });
    return { status: response.status, body: await response.json() };
  });
  if (refusal.status !== 422) {
    fail(`publish must refuse an unpublished yield, got ${refusal.status}`);
  }
  if (!refusal.body.problems?.some((problem) => problem.includes('item_material_zz_ghost'))) {
    fail(`the refusal should name the missing item: ${JSON.stringify(refusal.body.problems)}`);
  }
  const published = await db.query(
    `SELECT count(*)::int AS n FROM content_resource_nodes
     WHERE id LIKE '%zz_probe%' AND status = 'published'`,
  );
  if (published.rows[0].n !== 0) fail('a refused publish still wrote published rows');
  ok('publish refuses a yield that is not a published item, and ships nothing');
  await shoot(page, 'professions-publish.png');

  // --- the map editor's node layer can reach these definitions --------------
  //
  // Deliberately read-only: it opens the Place tool and checks the picker,
  // without stamping anything. The map draft is shared state under a lease, and
  // a content smoke has no business mutating the world — `newObjectDef` covers
  // what a stamp writes, and `map-editor.mjs` covers stamping itself.

  await page.click('.shell-rail a[href="/admin/world/map"]');
  await page.waitForSelector('.me-toolbar', { timeout: 60000 });
  await page.click('.me-toolbar button:has-text("Place")');
  const layerSelect = page.locator('.me-toolbar select').first();
  await layerSelect.selectOption('node');
  const kinds = await page.locator('.me-toolbar select').nth(1).locator('option').allInnerTexts();
  if (!kinds.some((option) => option.includes('Probe Birch'))) {
    await shoot(page, 'professions-map-picker.png');
    fail(`the Place tool's node picker does not list the definitions: ${JSON.stringify(kinds)}`);
  }
  if (!kinds.some((option) => /T1 woodcutting/.test(option))) {
    fail(`the picker should read tier and profession, saw ${JSON.stringify(kinds)}`);
  }
  ok(`the map editor's node layer offers what Professions publishes: ${kinds.join(' | ')}`);
  await shoot(page, 'professions-map-picker.png');
  await page.goBack();
  await page.waitForSelector('.abilities-list h2', { timeout: 20000 });

  // --- and the drafts can be taken back ------------------------------------
  //
  // Re-select first: coming back mounts a fresh page with nothing selected, so
  // there is no editor to discard from until a row is picked again.
  await page.click('.abilities-row:has-text("Probe Birch")');
  await page.waitForSelector('.abilities-editor-actions', { timeout: 15000 });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.click('.abilities-editor-actions button:has-text("discard draft")');
  await page.waitForFunction(() => !document.body.textContent?.includes('Probe Birch'), {
    timeout: 15000,
  });
  ok('discarding a draft removes it from the list');

  if (errors.length > 0) fail(`unexpected console errors: ${errors.slice(0, 5).join(' | ')}`);
  ok('no unexpected console errors');

  await browser.close();
};

run()
  .then(async () => {
    await clearProbes();
    await db.end();
    console.log('\n🎉 professions editor smoke passed');
  })
  .catch(async (error) => {
    console.error(error instanceof SmokeFailure ? `\n❌ ${error.message}` : error);
    process.exitCode = 1;
    try {
      await clearProbes();
      await db.end();
    } catch {
      /* the failure above is the interesting one */
    }
  });
