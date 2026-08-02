/**
 * World-settings drafts — the panel's first content surface and the A0 DoD
 * round-trip. Storage is one row per key per status in `content_world_settings`
 * (DATABASE.md §3): editors upsert DRAFT rows only; published rows change
 * exclusively via the A1 publish pipeline. A draft equal to the published value
 * is deleted rather than kept — "n drafts pending" then means real differences.
 */

import { and, eq } from 'drizzle-orm';
import { contentWorldSettings } from '@dawned/shared/schema';
import { defaultWorldSettings, worldSettingsSchema, type WorldSettings } from '@dawned/shared';
import type { WorldSettingsData } from '../shared-ext/api-types.js';
import type { Db } from './db.js';

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
