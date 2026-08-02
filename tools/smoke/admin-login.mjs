#!/usr/bin/env node
/**
 * A0 login smoke (the phase DoD in browser form): a real Chromium signs in with
 * an admin game account, sees the live server card, opens World Settings, edits
 * a value, saves the draft, and finds it persisted after a reload.
 *
 * The fixture admin account is provisioned directly in the shared dev database
 * (role changes stay a DB/CLI concern until A4's role management UI).
 *
 * Usage: node tools/smoke/admin-login.mjs [http://localhost:5174] [--screenshots DIR]
 * Requires: panel dev stack (`pnpm dev`), the game server for the live card,
 * local Postgres. DATABASE_URL env overrides the dev default.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import pg from 'pg';

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

const shoot = async (page, name) => {
  if (!SHOT_DIR) return;
  try {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 30000 });
  } catch (error) {
    console.warn(`⚠️  screenshot ${name} skipped (${error.message.split('\n')[0]})`);
  }
};

const db = new pg.Client({ connectionString: DATABASE_URL });

const provision = async () => {
  await db.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await db.query(
    `INSERT INTO accounts (name, pass_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (name) DO UPDATE SET pass_hash = $2, role = 'admin', status = 'active'`,
    [ACCOUNT, hash],
  );
  // A clean draft slate makes the assertions deterministic.
  await db.query(`DELETE FROM content_world_settings WHERE status = 'draft'`);
};

const cleanup = async () => {
  await db.query(`DELETE FROM content_world_settings WHERE status = 'draft'`);
  await db.query(
    `DELETE FROM audit_log WHERE actor_account_id IN (SELECT id FROM accounts WHERE name = $1)`,
    [ACCOUNT],
  );
  await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCOUNT]);
  await db.end();
};

const main = async () => {
  console.log(`Dawned-Admin login smoke → ${BASE_URL}\n`);
  await provision();
  ok(`admin account "${ACCOUNT}" provisioned`);

  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
    await cleanup();
  }
  console.log('\n🔧 Admin smoke passed — login, live dashboard, draft round-trip.\n');
};

const run = async (browser) => {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // --- login -----------------------------------------------------------------
  await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="username"]', ACCOUNT, { timeout: 30000 });
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await shoot(page, 'a0-login.png');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.shell', { timeout: 30000 });
  ok('signed in with a game account (admin role)');

  // --- dashboard: live server card ------------------------------------------
  await page.waitForFunction(
    () => {
      const badge = document.querySelector('.card .ws-badge--ok, .card .ws-badge--down');
      return badge !== null;
    },
    { timeout: 20000 },
  );
  const serverCard = await page.locator('.card', { hasText: 'Game server' }).innerText();
  if (!/online|down/i.test(serverCard)) fail(`server card has no status: ${serverCard}`);
  const liveGame = serverCard.toLowerCase().includes('online');
  ok(
    `dashboard shows the game server ${liveGame ? 'ONLINE with live stats' : 'down (card renders the outage)'}`,
  );
  if (liveGame && !/Players online/.test(serverCard)) fail('online card missing player count');
  await shoot(page, 'a0-dashboard.png');

  // --- world settings: draft round-trip --------------------------------------
  await page.click('a:has-text("World Settings")');
  await page.waitForSelector('.form-rows', { timeout: 20000 });
  const xpInput = page.locator('.form-row', { hasText: 'XP rate' }).locator('input[type="number"]');
  await xpInput.fill('1.5');
  const saveButton = page.locator('button', { hasText: 'Save draft' });
  await saveButton.click();
  await page.waitForSelector('.form-row .ws-badge--draft', { timeout: 20000 });
  ok('edited XP rate saved as a draft (field badged, never live)');

  const badge = await page.locator('.shell-top .ws-badge--draft').innerText();
  // CSS uppercases badges — compare case-insensitively.
  if (!/1 draft/i.test(badge)) fail(`top-bar draft badge wrong: "${badge}"`);
  ok('top bar counts 1 draft pending');
  await shoot(page, 'a0-world-settings.png');

  // Reload — the draft must come back from the database, not component state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.form-rows', { timeout: 30000 });
  const persisted = await page
    .locator('.form-row', { hasText: 'XP rate' })
    .locator('input[type="number"]')
    .inputValue();
  if (persisted !== '1.5') fail(`draft did not persist across reload (got "${persisted}")`);
  ok('draft survives a full reload (A0 DoD round-trip)');

  // Discard back to published values — draft rows prune, badge clears.
  await page.click('button:has-text("Discard draft")');
  await page.waitForFunction(() => document.querySelector('.shell-top .ws-badge--draft') === null, {
    timeout: 20000,
  });
  ok('discard restored published values and cleared the pending badge');

  // The logged-out /auth/me probe answers 401 by design; the browser logs the
  // failed resource load. Anything else is a real error.
  const realErrors = errors.filter((line) => !/status of 401/.test(line));
  if (realErrors.length > 0) fail(`console errors:\n  ${realErrors.slice(0, 5).join('\n  ')}`);
  ok('no unexpected console errors');
};

main().catch((error) => {
  console.error(
    `\n❌ ${error instanceof SmokeFailure ? error.message : `unexpected error: ${error.stack ?? error.message}`}\n`,
  );
  process.exitCode = 1;
});
