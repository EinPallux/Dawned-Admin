/**
 * World-settings drafts and their publish rail.
 *
 * Storage is one row per key per status in `content_world_settings`
 * (DATABASE.md §3): editors upsert DRAFT rows, and `publishWorldSettings` is the
 * only path to `published`. A draft equal to the published value is deleted
 * rather than kept — "n drafts pending" then means real differences.
 *
 * **The publish half did not exist until 2026-08-06.** A0 shipped the editor and
 * closed on its DoD, which was the DRAFT round-trip; the comment here said
 * published rows change "exclusively via the A1 publish pipeline" and A1 never
 * wired this surface into it. The game reads `content_world_settings` WHERE
 * `status = 'published'` (server `content/loader.ts`), so for eleven phases every
 * World Settings edit the owner made was unreachable by the game — including
 * `xpRate`, which several docs describe as a live lever. There were zero
 * published rows in existence, so the world has been running on
 * `defaultWorldSettings()` throughout.
 */

import { and, eq } from 'drizzle-orm';
import { contentWorldSettings } from '@dawned/shared/schema';
import { defaultWorldSettings, worldSettingsSchema, type WorldSettings } from '@dawned/shared';
import type { WorldSettingsData } from '../shared-ext/api-types.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { reloadGameContent, type ReloadOutcome } from './publish-support.js';

type SettingsKey = keyof WorldSettings;

const KEYS = Object.keys(worldSettingsSchema.shape) as SettingsKey[];

const effective = (base: WorldSettings, rows: Map<string, unknown>): WorldSettings => {
  const merged: Record<string, unknown> = { ...base };
  for (const key of KEYS) {
    if (rows.has(key)) merged[key] = rows.get(key);
  }
  // Rows are validated on write, but the database is shared — never trust blindly.
  const parsed = worldSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
};

export const readWorldSettings = async (db: Db): Promise<WorldSettingsData> => {
  const rows = await db.select().from(contentWorldSettings);
  const published = new Map<string, unknown>();
  const drafts = new Map<string, unknown>();
  for (const row of rows) {
    (row.status === 'published' ? published : drafts).set(row.key, row.value);
  }
  const effectivePublished = effective(defaultWorldSettings(), published);
  const effectiveDraft = effective(effectivePublished, drafts);
  const draftKeys = KEYS.filter(
    (key) => JSON.stringify(effectiveDraft[key]) !== JSON.stringify(effectivePublished[key]),
  );
  return { published: effectivePublished, draft: effectiveDraft, draftKeys };
};

/** Upsert/prune draft rows so the draft view equals `next`. Returns changed keys. */
export const saveWorldSettingsDraft = async (
  db: Db,
  next: WorldSettings,
  updatedBy: number,
): Promise<{ data: WorldSettingsData; changedKeys: string[] }> => {
  const before = await readWorldSettings(db);
  const changedKeys: string[] = [];
  for (const key of KEYS) {
    const value = next[key];
    if (JSON.stringify(value) === JSON.stringify(before.draft[key])) continue;
    changedKeys.push(key);
    const matchesPublished = JSON.stringify(value) === JSON.stringify(before.published[key]);
    if (matchesPublished) {
      await db
        .delete(contentWorldSettings)
        .where(and(eq(contentWorldSettings.key, key), eq(contentWorldSettings.status, 'draft')));
    } else {
      await db
        .insert(contentWorldSettings)
        .values({ key, status: 'draft', value, updatedBy, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentWorldSettings.key, contentWorldSettings.status],
          set: { value, updatedBy, updatedAt: new Date() },
        });
    }
  }
  return { data: await readWorldSettings(db), changedKeys };
};

export interface WorldSettingsPublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  reload: ReloadOutcome;
}

/**
 * Copy every draft key onto its published row and poke the game.
 *
 * All-or-nothing in one transaction, like every other rail: a half-applied
 * settings change is a world running on a mixture of two intents.
 *
 * The validation that matters is of the RESULT, not of each key: the game
 * re-parses the merged object through `worldSettingsSchema` and falls back to
 * defaults on failure (`effective()` above does the same), so a set of
 * individually-legal values that is illegal together would silently revert the
 * whole world to defaults rather than fail loudly here.
 */
export const publishWorldSettings = async (
  db: Db,
  config: Config,
  publishedBy: number,
): Promise<WorldSettingsPublishResult> => {
  const before = await readWorldSettings(db);
  if (before.draftKeys.length === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish'],
      reload: { ok: false, note: 'no changes' },
    };
  }

  const parsed = worldSettingsSchema.safeParse(before.draft);
  if (!parsed.success) {
    return {
      ok: false,
      published: 0,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      reload: { ok: false, note: 'not published' },
    };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const key of before.draftKeys) {
      const value = parsed.data[key as SettingsKey];
      await tx
        .insert(contentWorldSettings)
        .values({ key, status: 'published', value, updatedBy: publishedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: [contentWorldSettings.key, contentWorldSettings.status],
          set: { value, updatedBy: publishedBy, updatedAt: now },
        });
      await tx
        .delete(contentWorldSettings)
        .where(and(eq(contentWorldSettings.key, key), eq(contentWorldSettings.status, 'draft')));
    }
  });

  return {
    ok: true,
    published: before.draftKeys.length,
    problems: [],
    reload: await reloadGameContent(config),
  };
};
