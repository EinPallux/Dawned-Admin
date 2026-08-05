/**
 * Environment configuration, zod-validated at boot (same discipline as the game
 * server). The panel shares the game's database and talks to its localhost ops
 * API — production must configure both explicitly (docs/ARCHITECTURE.md §2–§3).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The sibling game checkout — `file:../Dawned/packages/shared` already assumes it. */
const GAME_REPO = path.resolve(HERE, '../../../Dawned');
const DEV_MAP_DIR = path.join(GAME_REPO, 'assets_baked/map');
const DEV_ASSETS_DIR = path.join(GAME_REPO, 'assets_baked');

const DEV_DATABASE_URL = 'postgres://dawned:dawned@127.0.0.1:5432/dawned';
const DEV_OPS_SECRET = 'dev-only-ops-secret-change-me';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8082),

  /** The game's PostgreSQL — the panel never runs its own migrations. */
  DATABASE_URL: z.url().default(DEV_DATABASE_URL),

  /** Game server base URL for public health probes and the ops API. */
  GAME_OPS_URL: z.url().default('http://127.0.0.1:8081'),
  /** Shared secret for /ops/* (mirrors the game server's OPS_SECRET). */
  OPS_SECRET: z.string().min(8).default(DEV_OPS_SECRET),

  /**
   * Where baked map artifacts live (A2 publish writes here; the game server
   * reads the same directory as its MAP_DIR). Defaults to the sibling game
   * checkout's assets_baked/map, which is what a dev box has.
   */
  MAP_DIR: z.string().default(DEV_MAP_DIR),
  /** Baked asset root — publish checks placement modelRefs against its manifest. */
  ASSETS_DIR: z.string().default(DEV_ASSETS_DIR),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (): Config => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    // Silently running against dev defaults in production would "work" against
    // the wrong database or a rejected ops secret — fail loudly instead.
    if (config.DATABASE_URL === DEV_DATABASE_URL) {
      throw new Error('DATABASE_URL must be set explicitly in production (/etc/dawned/admin.env).');
    }
    if (config.OPS_SECRET === DEV_OPS_SECRET) {
      throw new Error('OPS_SECRET must be set explicitly in production (/etc/dawned/admin.env).');
    }
  }
  return config;
};
