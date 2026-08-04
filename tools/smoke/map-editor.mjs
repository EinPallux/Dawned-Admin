#!/usr/bin/env node
/**
 * A2 map editor smoke — the terrain half of the MAP_EDITOR.md §7 scenario,
 * driven by a real browser because that is the only thing that catches what
 * this phase can get wrong. Every bug this session found in 3D code was found
 * by LOOKING at a screenshot, never by an assertion.
 *
 * The run: sign in → open the Map Editor → import the live world → confirm
 * terrain actually rendered (pixels, not just a canvas element) → sculpt a
 * hill and prove the heights moved → undo it and prove they came back → paint
 * → cycle the overlays → validate.
 *
 * Usage: node tools/smoke/map-editor.mjs [http://localhost:5174] [--screenshots DIR]
 * Requires: the panel dev stack (`pnpm dev`) and local Postgres.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import pg from 'pg';
import sharp from 'sharp';

const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5174';
const shotIndex = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotIndex !== -1 ? process.argv[shotIndex + 1] : null;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';
const ACCOUNT = 'zz_map_smoke';
const PASSWORD = 'map-smoke-pass-1';

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
  await db.query('DELETE FROM map_lock');
};

const cleanup = async () => {
  // Never throw out of here: this runs in a `finally`, and an exception would
  // replace the real failure with a cleanup error — which is exactly what
  // happened the first time this smoke ran.
  try {
    await db.query('DELETE FROM map_lock');
    await db.query(
      `DELETE FROM audit_log WHERE actor_account_id IN (SELECT id FROM accounts WHERE name = $1)`,
      [ACCOUNT],
    );
    // The account is DISABLED rather than deleted: draft chunks carry an
    // `updated_by` FK to it, and the draft this run wrote is legitimate state.
    await db.query(`UPDATE accounts SET status = 'disabled' WHERE name = $1`, [ACCOUNT]);
  } catch (error) {
    console.warn(`⚠️  cleanup: ${error.message.split('\n')[0]}`);
  } finally {
    await db.end().catch(() => undefined);
  }
};

/**
 * How much of the viewport is NOT the clear colour, measured from a real
 * screenshot.
 *
 * NOT `canvas.toDataURL()`: a WebGL canvas without `preserveDrawingBuffer`
 * reads back blank, and the first version of this check "failed" against an
 * editor that was rendering perfectly. Playwright's screenshot captures what
 * the compositor actually put on screen, which is the thing worth asserting —
 * and it does not cost the app a slower renderer to make the test possible.
 */
const canvasCoverage = async (page) => {
  // A PAGE screenshot cropped to the canvas, not `locator.screenshot()`: the
  // viewport renders every frame, so Playwright's "wait for the element to be
  // stable" never settles on a live 3D view and times out.
  const box = await page.locator('canvas.me-canvas').boundingBox();
  if (!box) throw new SmokeFailure('the viewport canvas has no box');
  const png = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    timeout: 30000,
  });
  const { data, info } = await sharp(png)
    .resize(240, 150, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let lit = 0;
  const colours = new Set();
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // The clear colour is #101318 (sum 59); anything meaningfully brighter was
    // drawn by something.
    if (r + g + b > 80) lit++;
    colours.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { lit, total, colours: colours.size };
};

const main = async () => {
  console.log(`Dawned-Admin map editor smoke → ${BASE_URL}\n`);
  await provision();
  ok(`admin account "${ACCOUNT}" provisioned`);
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    await run(browser);
  } finally {
    await browser.close();
    await cleanup();
  }
  console.log('\n🗺️  Map editor smoke passed.\n');
};

const run = async (browser) => {
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // --- login ----------------------------------------------------------------
  await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="username"]', ACCOUNT, { timeout: 30000 });
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.shell', { timeout: 30000 });
  ok('signed in');

  // --- open the editor ------------------------------------------------------
  await page.click('a:has-text("Map Editor")');
  await page.waitForSelector('canvas.me-canvas', { timeout: 30000 });
  await page.waitForTimeout(1200);
  ok('map editor mounted with a live canvas');

  // --- take the lock --------------------------------------------------------
  // Wait for the lock card to settle before clicking: the button is rendered
  // from a query, and clicking while it is still loading is a race the owner
  // would never lose but a script always does.
  await page.waitForSelector('button:has-text("Take lock"), button:has-text("Force takeover")', {
    timeout: 30000,
  });
  await page
    .locator('button', { hasText: /Take lock|Force takeover/ })
    .first()
    .click();
  try {
    await page.waitForFunction(
      () => document.querySelector('.me-status')?.textContent?.includes('editing') === true,
      { timeout: 15000 },
    );
  } catch {
    await shoot(page, 'a2-lock-failed.png');
    fail(`status bar still read-only: ${await page.locator('.me-status').innerText()}`);
  }
  ok('editing lock held (status bar says "editing")');

  // --- import the live world ------------------------------------------------
  page.once('dialog', (dialog) => void dialog.accept());
  await page.click('button:has-text("Import live map")');
  // Read the STATUS BAR, not the toast: the toast fades after a few seconds and
  // a script that races it is measuring its own timing, not the app.
  await page.waitForFunction(
    () => /Imported \d+ chunks/.test(document.querySelector('.me-last')?.textContent ?? ''),
    { timeout: 180_000 },
  );
  const importToast = await page.locator('.me-last').innerText();
  ok(`import: ${importToast}`);
  await page.waitForTimeout(2500);
  await shoot(page, 'a2-imported.png');

  // --- did anything actually RENDER? ---------------------------------------
  const coverage = await canvasCoverage(page);
  const litFraction = coverage.lit / coverage.total;
  if (litFraction < 0.25) {
    fail(
      `the viewport is essentially empty — only ${(litFraction * 100).toFixed(1)}% of pixels are lit`,
    );
  }
  if (coverage.colours < 8) {
    fail(`the viewport drew ${coverage.colours} distinct colours — terrain would have many more`);
  }
  ok(
    `terrain rendered: ${(litFraction * 100).toFixed(0)}% of the viewport lit, ${coverage.colours} distinct colours`,
  );

  // --- sculpt ---------------------------------------------------------------
  const canvas = page.locator('canvas.me-canvas');
  const box = await canvas.boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const heightsBefore = await sampleHeights(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(centre.x + i, centre.y + (i % 3));
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const heightsAfter = await sampleHeights(page);
  const raised = heightsAfter.sum - heightsBefore.sum;
  if (raised <= 1) {
    fail(
      `a 12-dab raise stroke displaced ${raised.toFixed(3)} m of ground in total — the brush did nothing`,
    );
  }
  ok(`sculpt raised the ground (${raised.toFixed(0)} m of total displacement)`);
  await shoot(page, 'a2-sculpted.png');

  // --- undo -----------------------------------------------------------------
  await page.click('button:has-text("Undo")');
  await page.waitForTimeout(300);
  const heightsUndone = await sampleHeights(page);
  if (Math.abs(heightsUndone.sum - heightsBefore.sum) > 0.05) {
    fail(
      `undo left ${(heightsUndone.sum - heightsBefore.sum).toFixed(3)} m of displacement behind`,
    );
  }
  ok('undo restored the terrain exactly');

  await page.click('button:has-text("Redo")');
  await page.waitForTimeout(300);
  const heightsRedone = await sampleHeights(page);
  if (Math.abs(heightsRedone.sum - heightsAfter.sum) > 0.05)
    fail('redo did not restore the stroke');
  ok('redo restored the stroke exactly');

  // --- paint ----------------------------------------------------------------
  await page.click('button:has-text("Paint")');
  await page.waitForTimeout(200);
  await page.locator('.me-swatch').nth(3).click();
  const paintedBefore = await canvasCoverage(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(centre.x - i * 2, centre.y - i);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const paintedAfter = await canvasCoverage(page);
  if (paintedAfter.colours === paintedBefore.colours && paintedAfter.lit === paintedBefore.lit) {
    fail('painting a different splat layer changed nothing on screen');
  }
  ok('paint changed the surface colours');
  await shoot(page, 'a2-painted.png');

  // --- overlays -------------------------------------------------------------
  for (const overlay of ['slope', 'walkable', 'height']) {
    await page.selectOption('.me-field select', overlay);
    await page.waitForTimeout(500);
    const shot = await canvasCoverage(page);
    if (shot.lit / shot.total < 0.25) fail(`the ${overlay} overlay blanked the viewport`);
    await shoot(page, `a2-overlay-${overlay}.png`);
  }
  ok('slope, walkability and height overlays all render');
  await page.selectOption('.me-field select', 'none');

  // --- autosave -------------------------------------------------------------
  await page.waitForFunction(
    () => document.querySelector('.me-save')?.textContent?.trim() === 'Saved',
    { timeout: 30_000 },
  );
  ok('autosave settled — the status bar reads "Saved"');

  // --- place an object (A3) -------------------------------------------------
  await page.click('button:has-text("Place")');
  await page.waitForTimeout(300);
  const propsBefore = await layerCount(page, 'Prop');
  await page.mouse.click(centre.x + 120, centre.y - 60);
  await page.waitForTimeout(900);
  const propsAfter = await layerCount(page, 'Prop');
  if (propsAfter !== propsBefore + 1) {
    await shoot(page, 'a3-place-failed.png');
    fail(`placing a prop left the layer count at ${propsAfter} (was ${propsBefore})`);
  }
  ok(`placed a prop — the layers panel counts ${propsAfter}`);

  // The inspector must open on what was just placed, or the owner has no way
  // to pick the model they actually wanted.
  const inspector = page.locator('.me-card', { hasText: 'prop ·' });
  if ((await inspector.count()) === 0) {
    await shoot(page, 'a3-no-inspector.png');
    fail('no inspector appeared for the newly placed prop');
  }
  ok('the inspector opened on the new prop');
  await shoot(page, 'a3-placed.png');

  // Delete it again, so the run leaves the draft as it found it.
  await page.locator('.me-card button:has-text("Delete")').click();
  await page.waitForTimeout(800);
  const propsFinal = await layerCount(page, 'Prop');
  if (propsFinal !== propsBefore) fail(`delete left ${propsFinal} props, expected ${propsBefore}`);
  ok('deleted it again — the draft is back where it started');

  // --- validate -------------------------------------------------------------
  await page.click('button:has-text("Validate")');
  await page.waitForSelector('.me-publish', { timeout: 30000 });
  await page.waitForFunction(() => !document.body.textContent?.includes('Validating…'), {
    timeout: 60_000,
  });
  const publishText = await page.locator('.me-publish').innerText();
  if (!/chunks/.test(publishText)) fail(`validation reported no stats: ${publishText}`);
  ok(`validation ran: ${publishText.split('\n').slice(0, 3).join(' · ')}`);
  await shoot(page, 'a2-validate.png');

  const fatal = errors.filter(
    (message) => !/favicon|ResizeObserver loop|Download the React DevTools/i.test(message),
  );
  if (fatal.length > 0) fail(`console errors during the run:\n  ${fatal.join('\n  ')}`);
  ok('no console errors');
};

/** How many rows the layers panel counts for a layer. */
const layerCount = async (page, label) => {
  const row = page.locator('.me-layer-row', { hasText: label }).first();
  const text = await row.locator('b').innerText();
  return Number(text);
};

/** Total ground displacement across every enabled chunk, from the live store. */
const sampleHeights = (page) =>
  page.evaluate(() => {
    const probe = window.__dawnedMapEditor;
    if (!probe) throw new Error('editor probe missing (window.__dawnedMapEditor)');
    return probe.heightSum();
  });

main().catch((error) => {
  if (error instanceof SmokeFailure) console.error(`\n❌ ${error.message}\n`);
  else console.error(error);
  process.exitCode = 1;
});
