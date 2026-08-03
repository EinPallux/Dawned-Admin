#!/usr/bin/env node
/**
 * Production-serving smoke: proves the panel works the way the VPS actually
 * serves it, which the dev stack structurally cannot (Vite serves assets
 * itself, applies no CSP, and its proxy hides prefix bugs).
 *
 * It boots the BUILT panel (dist/) in NODE_ENV=production behind an
 * in-process replica of the game repo's Caddy /admin block — prefix strip +
 * the real Content-Security-Policy parsed from deploy/Caddyfile — then drives
 * a real Chromium through load + login. Catches the two bugs the first
 * production deploy shipped: `handle` vs `handle_path` (SPA fallback answers
 * asset requests with index.html → blank page) and data:-inlined fonts the
 * CSP refuses (system-font fallback + console violations).
 *
 * Usage: node tools/smoke/admin-prod-serve.mjs
 * Requires: `pnpm build` first, local Postgres (DATABASE_URL overrides the
 * dev default), the sibling ../Dawned checkout. The game server may be down —
 * the dashboard renders that as a state.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import argon2 from 'argon2';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const caddyfilePath = path.resolve(repoRoot, '../Dawned/deploy/Caddyfile');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@localhost:5432/dawned';
const SERVER_PORT = 18082;
const PROXY_PORT = 18099;
const BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;
const ACCOUNT = 'zz_admin_prodsmoke';
const PASSWORD = 'prod-smoke-pass-1';

const ok = (message) => console.log(`✅ ${message}`);
class SmokeFailure extends Error {}
const fail = (message) => {
  throw new SmokeFailure(message);
};

// --- the serving contract, read from the game repo's real Caddyfile ----------
const readCaddyContract = () => {
  if (!existsSync(caddyfilePath)) {
    fail(`sibling game checkout not found (${caddyfilePath}) — the panel deploys beside it`);
  }
  const active = readFileSync(caddyfilePath, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const adminBlock = active.match(/handle_path \/admin\* \{[^}]*reverse_proxy 127\.0\.0\.1:8082/s);
  if (!adminBlock) {
    fail(
      'deploy/Caddyfile must proxy the panel via `handle_path /admin*` (prefix STRIPPED) — ' +
        'the panel is built against stripped paths; plain `handle` blanks the page in production',
    );
  }
  const csp = active.match(/^\s*Content-Security-Policy\s+"([^"]+)"/m);
  if (!csp) fail('deploy/Caddyfile has no active Content-Security-Policy header');
  ok('Caddyfile contract: handle_path strip + CSP found');
  return { csp: csp[1] };
};

// --- caddy-mimic: handle_path /admin* + site headers, nothing else ----------
const startProxy = (csp) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, BASE_URL);
      if (!url.pathname.startsWith('/admin')) {
        res.writeHead(404);
        res.end('only /admin* is proxied, like production');
        return;
      }
      let stripped = url.pathname.slice('/admin'.length);
      if (stripped === '' || !stripped.startsWith('/')) stripped = `/${stripped}`;
      const proxied = http.request(
        {
          host: '127.0.0.1',
          port: SERVER_PORT,
          method: req.method,
          path: stripped + url.search,
          headers: { ...req.headers, host: `127.0.0.1:${SERVER_PORT}` },
        },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, {
            ...upstream.headers,
            'content-security-policy': csp,
            'x-content-type-options': 'nosniff',
          });
          upstream.pipe(res);
        },
      );
      proxied.on('error', (error) => {
        res.writeHead(502);
        res.end(`upstream error: ${error.message}`);
      });
      req.pipe(proxied);
    });
    server.listen(PROXY_PORT, '127.0.0.1', () => resolve(server));
  });

// --- built panel in real production mode -------------------------------------
const startProdServer = async () => {
  for (const artifact of ['dist/server/index.js', 'dist/client/index.html']) {
    if (!existsSync(path.join(repoRoot, artifact))) {
      fail(`missing ${artifact} — run \`pnpm build\` before this smoke`);
    }
  }
  const child = spawn('node', ['--enable-source-maps', 'dist/server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(SERVER_PORT),
      // localhost spelling keeps the same dev database while satisfying the
      // production guard against running on the literal dev default URL.
      DATABASE_URL,
      OPS_SECRET: 'prod-smoke-ops-secret-1',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode !== null) fail('production server exited during startup');
    try {
      const status = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${SERVER_PORT}/api/auth/me`, (res) => {
            res.resume();
            resolve(res.statusCode);
          })
          .on('error', reject);
      });
      if (status === 401) return child;
    } catch {
      // not up yet
    }
  }
  fail('production server never answered on /api/auth/me');
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
};
const cleanup = async () => {
  await db.query(
    `DELETE FROM audit_log WHERE actor_account_id IN (SELECT id FROM accounts WHERE name = $1)`,
    [ACCOUNT],
  );
  await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCOUNT]);
  await db.end();
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
  const assets = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/admin/assets/')) {
      assets.push({
        path: url.pathname,
        status: response.status(),
        type: response.headers()['content-type'] ?? '',
        cache: response.headers()['cache-control'] ?? '',
      });
    }
  });

  // --- load: every asset must arrive with a real MIME type, not the SPA -----
  const document_ = await page.goto(`${BASE_URL}/admin`, { waitUntil: 'load' });
  if ((document_?.headers()['cache-control'] ?? '') !== 'no-cache') {
    fail('document must be Cache-Control: no-cache (stale index = broken deploys)');
  }
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  ok('SPA mounted at /admin through the prefix-stripping proxy');

  if (assets.length === 0) fail('no /admin/assets/* requests observed');
  for (const asset of assets) {
    if (asset.status !== 200) fail(`${asset.path} → ${asset.status}`);
    if (asset.type.includes('text/html')) {
      fail(`${asset.path} served as HTML — the SPA fallback is eating asset requests`);
    }
    if (asset.cache !== 'public, max-age=31536000, immutable') {
      fail(`${asset.path} not immutable-cached (got "${asset.cache}")`);
    }
  }
  ok(`${assets.length} hashed assets served with real MIME types + immutable caching`);

  const fontAssets = assets.filter((asset) => asset.path.endsWith('.woff2'));
  if (fontAssets.length === 0) {
    fail('no .woff2 requests — fonts are being inlined as data: URIs again (CSP refuses those)');
  }
  const interLoaded = await page.evaluate(() => document.fonts.check('16px Inter'));
  if (!interLoaded) fail('Inter did not load — the Workshop typeface fell back to system fonts');
  ok('Inter loads as same-origin files under the production CSP');

  // --- login round-trip through the public prefix ---------------------------
  await page.fill('input[autocomplete="username"]', ACCOUNT);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.shell', { timeout: 30000 });
  ok('logged in through /admin/api/* (cookie + CSRF header survive the proxy)');

  // The pre-login /auth/me probe 401s by design; anything else is real.
  const realErrors = errors.filter((line) => !/status of 401/.test(line));
  if (realErrors.length > 0) {
    fail(`console errors (CSP violations show up here):\n  ${realErrors.slice(0, 5).join('\n  ')}`);
  }
  ok('zero console errors under the production CSP');
};

const main = async () => {
  console.log(`Dawned-Admin production-serving smoke → ${BASE_URL}/admin\n`);
  const { csp } = readCaddyContract();
  const proxy = await startProxy(csp);
  const server = await startProdServer();
  await provision();
  const browser = await chromium.launch();
  try {
    await run(browser);
    console.log('\n🔧 Production-serving smoke passed — strip contract, MIME, CSP, login.\n');
  } finally {
    await browser.close();
    await cleanup();
    server.kill('SIGTERM');
    proxy.close();
  }
};

main().catch((error) => {
  console.error(
    `\n❌ ${error instanceof SmokeFailure ? error.message : `unexpected error: ${error.stack ?? error.message}`}\n`,
  );
  process.exit(1);
});
