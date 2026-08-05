#!/usr/bin/env node
/**
 * The MAP_EDITOR.md §7 acceptance scenario, driven end to end (A2/A3-e).
 *
 * §7 is the A3 Definition of Done, and it is a SENTENCE, not a checklist:
 *
 *   "sculpt a new islet, paint it, scatter a forest, drop a bandit camp with a
 *    patrol, ring it with T2 nodes, zone it with custom fog + music, place a
 *    chest + vista + shrine, validate, publish — and stand on it in the live
 *    game within minutes, then wipe just its props and redecorate."
 *
 * This run does all of it that the game can currently receive, and says out
 * loud which parts it cannot:
 *
 *   • **patrol** — the spawner schema has no patrol field and the AI has no
 *     patrol state (game USER_QUESTIONS Q24).
 *   • **T2 resource nodes** — there is no node schema in `@dawned/shared` yet;
 *     professions are a later game phase (Q25).
 *   • **music / sfx on a zone** — `zoneAmbienceSchema` is light and colour
 *     only; the game has no per-zone audio yet (Q26).
 *
 * Those are recorded rather than faked. Everything else is real: the islet is
 * synthesised, painted, scattered, populated, zoned, furnished, validated and
 * PUBLISHED, and then the run asks the GAME SERVER whether it is standing on
 * the new world — which is the only version of "within minutes" that means
 * anything.
 *
 * It leaves the islet in place on purpose. This is a dev checkout; the point
 * of the scenario is that the world changed, and deleting it afterwards would
 * throw away the evidence.
 *
 * Usage: node tools/smoke/map-scenario.mjs [http://localhost:5174] [--screenshots DIR]
 * Requires: the panel dev stack (`pnpm dev`), local Postgres, and the GAME
 * server on :8081 (`pnpm --filter @dawned/server start` in the game repo).
 */

import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import pg from 'pg';

const BASE_URL = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:5174';
const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:8081';
const shotIndex = process.argv.indexOf('--screenshots');
const SHOT_DIR = shotIndex !== -1 ? process.argv[shotIndex + 1] : null;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';
const MAP_DIR = process.env.MAP_DIR ?? path.resolve('../Dawned/assets_baked/map');
const ACCOUNT = 'zz_scenario_smoke';
const PASSWORD = 'scenario-smoke-pass-1';

const ok = (message) => console.log(`✅ ${message}`);
const note = (message) => console.log(`📎 ${message}`);
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
  // Everything a previous scenario run stamped. Matched on the names the
  // editor gives a freshly placed row (and this run's own zone name), so the
  // owner's authored content is never in scope — and so a run that died half
  // way does not make the next one fail on its leftovers, which is exactly
  // what happened the first time: the zone id is derived from the islet's
  // position, so the "new" zone already existed and the diff found nothing.
  await db.query(
    `DELETE FROM map_draft_objects
      WHERE def->>'name' IN ('New chest', 'New shrine', 'New point', 'New zone', 'Smoke Islet')
         OR (layer = 'scatter' AND def->>'setId' = 'scatter_islet_cover')`,
  );
  // The camp this run drops has no name to match on, so it is identified the
  // only other way that is precise: a spawner that was never published. On a
  // dev box that is this scenario's own leavings, and the live-map import a few
  // lines later puts every published camp back regardless.
  await db.query(
    `DELETE FROM map_draft_objects
      WHERE layer = 'spawner'
        AND id NOT IN (SELECT id FROM content_spawners WHERE status = 'published')`,
  );
};

const cleanup = async () => {
  try {
    await db.query('DELETE FROM map_lock');
    await db.query(
      `DELETE FROM audit_log WHERE actor_account_id IN (SELECT id FROM accounts WHERE name = $1)`,
      [ACCOUNT],
    );
    await db.query(`UPDATE accounts SET status = 'disabled' WHERE name = $1`, [ACCOUNT]);
  } catch (error) {
    console.warn(`⚠️  cleanup: ${error.message.split('\n')[0]}`);
  } finally {
    await db.end().catch(() => undefined);
  }
};

const gameHealth = async () => {
  const response = await fetch(`${GAME_URL}/api/health`);
  if (!response.ok) throw new SmokeFailure(`game server said ${response.status}`);
  return response.json();
};

/** The editor's dev probe — the same one the A2/A3 smoke reads. */
const readObjects = (page) => page.evaluate(() => window.__dawnedMapEditor.objects());
const heightAt = (page, x, z) =>
  page.evaluate(({ x, z }) => window.__dawnedMapEditor.heightAt(x, z), { x, z });
const cameraPivot = (page) => page.evaluate(() => window.__dawnedMapEditor.pivot());

const main = async () => {
  console.log(`\nMAP_EDITOR.md §7 acceptance scenario → ${BASE_URL}\n`);
  const before = await gameHealth();
  ok(`game server up, standing on map "${before.mapVersion}"`);
  await provision();
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    await run(browser, before.mapVersion);
  } finally {
    await browser.close();
    await cleanup();
  }
  console.log('\n🏝  §7 scenario passed — the islet is live.\n');
};

const run = async (browser, mapBefore) => {
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // --- sign in and take the map ---------------------------------------------
  await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="username"]', ACCOUNT, { timeout: 30000 });
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.shell', { timeout: 30000 });
  errors.length = 0;
  await page.click('a:has-text("Map Editor")');
  await page.waitForSelector('canvas.me-canvas', { timeout: 30000 });
  await page.waitForSelector('button:has-text("Take lock"), button:has-text("Force takeover")', {
    timeout: 30000,
  });
  await page
    .locator('button', { hasText: /Take lock|Force takeover/ })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelector('.me-status')?.textContent?.includes('editing') === true,
    undefined,
    { timeout: 15000 },
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.click('button:has-text("Import live map")');
  await page.waitForFunction(
    () => /Imported \d+ chunks/.test(document.querySelector('.me-last')?.textContent ?? ''),
    undefined,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(2500);
  ok('signed in, holding the lock, draft seeded from the live world');

  const box = await page.locator('canvas.me-canvas').boundingBox();

  // --- 1. sculpt a new islet ------------------------------------------------
  //
  // Find real OCEAN inside the streamed region rather than hard-coding a spot:
  // the coastline is generated, and a scenario that assumes where the sea is
  // would break the first time the world is regenerated.
  // Fly out until the CAMERA ITSELF is over open water, then build there. The
  // generator centres on the camera pivot ("Centre here"), so the islet lands
  // in the middle of the viewport by construction — no hunting for a spot that
  // then turns out to be off-screen.
  const seaSpot = await flyToOpenWater(page, box);
  if (!seaSpot) {
    await shoot(page, 's7-no-water.png');
    fail('flew out to sea and never got over water deep enough for an islet');
  }
  ok(`open water at (${seaSpot.x}, ${seaSpot.z}), ${seaSpot.height.toFixed(1)} m below sea level`);

  await page.click('button:has-text("Generate")');
  await page.waitForTimeout(400);
  const numberField = (label) =>
    page.locator('.me-num', { hasText: label }).locator('input').first();
  await page.click('button:has-text("Centre here")');
  await page.waitForTimeout(400);
  await numberField('radius m').fill('70');
  await numberField('peak m').fill('26');
  await numberField('seed').fill('808');
  await page.click('button:has-text("Island")');
  await page.waitForTimeout(2500);
  const isletHeight = await heightAt(page, seaSpot.x, seaSpot.z);
  if (isletHeight === null || isletHeight < 5) {
    await shoot(page, 's7-no-islet.png');
    fail(`the islet did not rise: ${String(isletHeight)} m where the sea was`);
  }
  ok(`islet sculpted — ${isletHeight.toFixed(1)} m of land where there was open water`);

  // Fly to it. Everything after this clicks on the ISLET, not on the middle of
  // the old island — the camera opens over the world origin and the islet is
  // two hundred metres out.
  // The generator centred on the pivot, so the islet is under the middle of the
  // viewport — which is where every click below aims.
  const islet = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  ok(`the islet is under the camera at (${seaSpot.x.toFixed(0)}, ${seaSpot.z.toFixed(0)})`);
  await shoot(page, 's7-1-islet.png');

  // --- 2. paint it ----------------------------------------------------------
  await page.click('button:has-text("Paint")');
  await page.waitForTimeout(300);
  await paintStroke(page, islet);
  ok('painted the islet');

  // --- 3. scatter a forest --------------------------------------------------
  const scatterCard = page.locator('.me-card', { hasText: 'Scatter' });
  const existingSet = await scatterCard.locator('option', { hasText: 'Islet cover' }).count();
  if (existingSet === 0) {
    page.once('dialog', (dialog) => void dialog.accept('Islet cover'));
    await scatterCard.locator('button:has-text("New set")').click();
    await scatterCard
      .locator('option', { hasText: 'Islet cover' })
      .waitFor({ state: 'attached', timeout: 20_000 });
  }
  await scatterCard.locator('select').first().selectOption('scatter_islet_cover');
  await page.waitForTimeout(600);
  await paintStroke(page, islet);
  const patches = (await readObjects(page))
    .filter((object) => object.layer === 'scatter')
    .reduce((sum, object) => sum + object.def.density.reduce((a, b) => a + b, 0), 0);
  if (patches === 0) {
    await shoot(page, 's7-no-scatter.png');
    fail('the scatter stroke painted nothing');
  }
  ok(`scattered a forest — ${patches} density painted`);

  // --- 4. drop a bandit camp ------------------------------------------------
  await page.click('button:has-text("Place")');
  await page.waitForTimeout(300);
  const layerPicker = page.locator('.me-options select').first();
  await layerPicker.selectOption('spawner');
  await page.mouse.click(islet.x + 30, islet.y + 20);
  await page.waitForTimeout(1000);
  note('a patrol route is NOT authored: the spawner schema has no patrol field (game Q24)');

  // --- 5. "ring it with T2 nodes" -------------------------------------------
  // The layer EXISTS in the panel and reads zero — the editor is ready for the
  // day the game grows a node schema, and says so rather than pretending.
  const nodeCount = await layerCount(page, 'Resource node');
  note(
    'resource nodes cannot be placed yet — no node schema in shared (game Q25); ' +
      `the panel's Resource node layer stands at ${nodeCount}`,
  );

  // --- 6. chest, vista, shrine ---------------------------------------------
  await layerPicker.selectOption('interactable');
  await page.locator('.me-options select').nth(1).selectOption('chest');
  await page.mouse.click(islet.x - 30, islet.y + 30);
  await page.waitForTimeout(900);
  await page.locator('.me-options select').nth(1).selectOption('shrine');
  await page.mouse.click(islet.x + 40, islet.y - 30);
  await page.waitForTimeout(900);
  await layerPicker.selectOption('poi');
  await page.mouse.click(islet.x - 45, islet.y - 25);
  await page.waitForTimeout(900);
  const furniture = ((rows) => {
    return {
      spawners: rows.filter((row) => row.layer === 'spawner').length,
      chests: rows.filter((row) => row.layer === 'interactable' && row.def.kind === 'chest').length,
      shrines: rows.filter((row) => row.layer === 'interactable' && row.def.kind === 'shrine')
        .length,
      pois: rows.filter((row) => row.layer === 'poi').length,
    };
  })(await readObjects(page));
  if (furniture.chests === 0 || furniture.shrines === 0 || furniture.pois === 0) {
    await shoot(page, 's7-no-furniture.png');
    fail(`the islet is missing furniture: ${JSON.stringify(furniture)}`);
  }
  ok(
    `camp + furniture placed (${furniture.spawners} spawners, ${furniture.chests} chests, ` +
      `${furniture.shrines} shrines, ${furniture.pois} POIs)`,
  );
  await shoot(page, 's7-2-furnished.png');

  // --- 7. zone it -----------------------------------------------------------
  const zonesBefore = new Set(
    (await readObjects(page)).filter((row) => row.layer === 'zone').map((row) => row.id),
  );
  await page.click('button:has-text("Zone")');
  await page.waitForTimeout(400);
  for (const [dx, dy] of [
    [-150, -110],
    [150, -110],
    [150, 120],
    [-150, 120],
  ]) {
    await page.mouse.click(islet.x + dx, islet.y + dy);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  const zoneId =
    (await readObjects(page))
      .filter((row) => row.layer === 'zone' && !zonesBefore.has(row.id))
      .map((row) => row.id)[0] ?? null;
  if (!zoneId) {
    await shoot(page, 's7-no-zone.png');
    fail('closing the outline produced no new zone');
  }

  // Select it through the zone picker rather than trusting what the inspector
  // happens to be showing — the previous version edited whatever was selected,
  // which after placing a POI is a POI, and "cannot set fogColor of undefined"
  // is a poor way to learn that.
  await page.locator('.me-options select').first().selectOption(zoneId);
  await page.waitForTimeout(800);
  // The full-row JSON lives under a collapsed <details> in the inspector —
  // quick fields first, the whole row when you ask for it. Open it before
  // typing into it.
  const jsonDetails = page.locator('.me-inspector details').first();
  if (!(await jsonDetails.evaluate((element) => element.open))) {
    await page.locator('.me-inspector summary').first().click();
    await page.waitForTimeout(300);
  }
  const jsonBox = page.locator('.me-inspector .me-json');
  const zoneDef = JSON.parse(await jsonBox.inputValue());
  if (!zoneDef.ambience) {
    await shoot(page, 's7-wrong-inspector.png');
    fail(`the inspector is not showing the new zone (id ${String(zoneDef.id)})`);
  }
  zoneDef.name = 'Smoke Islet';
  zoneDef.levelMin = 8;
  zoneDef.levelMax = 12;
  zoneDef.ambience.fogColor = '#c9a34e';
  zoneDef.ambience.fogFar = 260;
  await jsonBox.fill(JSON.stringify(zoneDef, null, 2));
  await page.locator('.me-inspector button:has-text("Apply")').click();
  await page.waitForTimeout(1500);
  const zoneName = (await readObjects(page)).find((row) => row.id === zoneId)?.def.name ?? null;
  if (zoneName !== 'Smoke Islet') fail(`the zone edit did not stick (name is ${String(zoneName)})`);
  ok(`zoned it as "${zoneName}" with custom fog`);
  note('music / sfx are NOT set: zoneAmbienceSchema has no audio fields yet (game Q26)');
  await shoot(page, 's7-3-zoned.png');

  // --- 8. validate and publish ---------------------------------------------
  // Close the inspector's JSON drawer first: it is a tall panel and the
  // toolbar button can end up scrolled out from under the click.
  await page.keyboard.press('Escape');
  await page.locator('button:has-text("Validate ▸ Publish")').scrollIntoViewIfNeeded();
  await page.locator('button:has-text("Validate ▸ Publish")').click();
  try {
    await page.waitForSelector('.me-publish', { timeout: 60_000 });
  } catch {
    await shoot(page, 's7-no-publish-panel.png');
    fail('the publish panel never opened');
  }
  await page.waitForFunction(() => !document.body.textContent?.includes('Validating…'), {
    timeout: 120_000,
  });
  const publishButton = page.locator('.me-publish button:has-text("Bake ▸ Publish")');
  if (await publishButton.isDisabled()) {
    await shoot(page, 's7-blocked.png');
    fail(`publish is blocked: ${(await page.locator('.me-publish').innerText()).slice(0, 400)}`);
  }
  await publishButton.click();
  // Settle on EITHER outcome. Waiting only for success turns a publish that
  // failed for a stated reason into a five-minute timeout with no reason.
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('.me-publish');
      if (!panel) return false;
      return /Published map-\d+/.test(panel.textContent ?? '') || panel.querySelector('.me-warn');
    },
    undefined,
    { timeout: 600_000 },
  );
  const publishText = await page.locator('.me-publish').innerText();
  if (!/Published map-\d+/.test(publishText)) {
    await shoot(page, 's7-publish-failed.png');
    fail(`the publish failed: ${publishText.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  const published = await page.locator('.me-publish h3').innerText();
  ok(`published: ${published}`);
  await shoot(page, 's7-4-published.png');

  // --- 9. is the GAME standing on it? --------------------------------------
  const after = await gameHealth();
  if (after.mapVersion === mapBefore) {
    fail(`the game is still on "${mapBefore}" — publishing did not reach it`);
  }
  ok(`the live game swapped maps without a restart: ${mapBefore} → ${after.mapVersion}`);

  // The bake itself, on disk: `/assets/*` is Caddy's job in production, so the
  // artifact is what to check here. The pointer and the server agreeing is the
  // contract NETWORKING.md §3.4 exists for.
  const pointer = JSON.parse(await readFile(path.join(MAP_DIR, 'current.json'), 'utf8'));
  if (pointer.version !== after.mapVersion) {
    fail(`current.json says "${pointer.version}" but the server reports "${after.mapVersion}"`);
  }
  const chunkX = Math.floor((seaSpot.x + 1024) / 64);
  const chunkY = Math.floor((seaSpot.z + 1024) / 64);
  const chunkFile = path.join(MAP_DIR, after.mapVersion, `chunk_${chunkX}_${chunkY}.bin`);
  const chunkStat = await stat(chunkFile).catch(() => null);
  if (!chunkStat) fail(`the bake has no chunk for the islet (${chunkFile})`);
  ok(`the bake carries the islet's own chunk ${chunkX},${chunkY} (${chunkStat.size} bytes)`);

  const zonesFile = JSON.parse(
    await readFile(path.join(MAP_DIR, after.mapVersion, 'zones.json'), 'utf8'),
  );
  if (!zonesFile.zones.some((zone) => zone.name === 'Smoke Islet')) {
    fail('the published zones.json has no "Smoke Islet"');
  }
  ok('the published zones.json carries the islet zone with its own fog');

  // --- 10. wipe just its props and redecorate ------------------------------
  await page.locator('.me-publish button:has-text("Close")').click();
  await page.waitForTimeout(500);
  await page.click('button:has-text("Place")');
  await page.waitForTimeout(300);
  await layerPicker.selectOption('prop');
  for (const [dx, dy] of [
    [-20, 60],
    [20, 60],
    [0, 80],
  ]) {
    await page.mouse.click(islet.x + dx, islet.y + dy);
    await page.waitForTimeout(800);
  }
  const propsBefore = await layerCount(page, 'Prop');
  if (propsBefore < 3) fail(`expected at least 3 props on the islet, counted ${propsBefore}`);

  // Select the zone, then clear ONLY inside it.
  await page.click('button:has-text("Zone")');
  await page.waitForTimeout(300);
  await page.locator('.me-options select').first().selectOption(zoneId);
  await page.waitForTimeout(600);
  page.on('dialog', (dialog) => void dialog.accept());
  await page
    .locator('.me-layer-row', { hasText: 'Prop' })
    .locator('button:has-text("Clear")')
    .click();
  const propsAfter = await layerCountBelow(page, 'Prop', propsBefore);
  if (propsAfter >= propsBefore) {
    await shoot(page, 's7-clear-failed.png');
    fail(`the scoped clear removed nothing (${propsBefore} → ${propsAfter} props)`);
  }
  ok(`wiped just the islet's props (${propsBefore} → ${propsAfter}) and can redecorate`);
  await shoot(page, 's7-5-wiped.png');

  const fatal = errors.filter(
    (message) => !/favicon|ResizeObserver loop|Download the React DevTools/i.test(message),
  );
  if (fatal.length > 0) fail(`console errors during the run:\n  ${fatal.join('\n  ')}`);
  ok('no console errors');
};

/**
 * Fly out until there is open water in the streamed region, and answer the
 * deepest point in it.
 *
 * The island fills the resident 13×13-chunk window around the world origin —
 * the editor deliberately caps that at 384 m and the coast is further out than
 * that — so a scenario that searched from where the camera opens finds nothing
 * but land. Panning is what the owner would do, so it is what this does:
 * Shift + right-drag, wait for the region to stream, look again.
 */
const flyToOpenWater = async (page, box) => {
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const overWater = async () => {
    const pivot = await cameraPivot(page);
    return { ...pivot, height: await heightAt(page, pivot.x, pivot.z) };
  };

  let where = await overWater();
  const deep = (spot) => spot.height !== null && spot.height < -3;
  let direction = 1;
  for (let attempt = 0; attempt < 10 && !deep(where); attempt++) {
    // Reverse once if a few pans one way are not finding water — the
    // drag-to-world sign is a camera detail this run should not have to know.
    if (attempt === 5) direction = -1;
    await page.keyboard.down('Shift');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(at.x - direction * 260, at.y - 120, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    await page.waitForTimeout(2600);
    where = await overWater();
  }
  return deep(where) ? where : null;
};

/** A short drag across the islet with whatever brush tool is active. */
const paintStroke = async (page, at) => {
  await page.mouse.move(at.x - 30, at.y - 20);
  await page.mouse.down();
  for (let step = 0; step < 8; step++) {
    await page.mouse.move(at.x - 30 + step * 8, at.y - 20 + (step % 3) * 6);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
};

const layerCount = async (page, label) => {
  const row = page.locator('.me-layer-row', { hasText: label }).first();
  return Number(await row.locator('b').innerText());
};

/**
 * Wait for a layer's count to settle on something new. A scoped clear reloads
 * the whole object list from the server; on a 1-core box that lands well after
 * a fixed two-second wait, which reads as "the clear removed nothing" while the
 * panel behind the assertion already says it removed everything.
 */
const layerCountBelow = async (page, label, ceiling, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let count = await layerCount(page, label);
  while (count >= ceiling && Date.now() < deadline) {
    await page.waitForTimeout(500);
    count = await layerCount(page, label);
  }
  return count;
};

main().catch(async (error) => {
  if (error instanceof SmokeFailure) console.error(`\n❌ ${error.message}\n`);
  else console.error(error);
  process.exitCode = 1;
});
