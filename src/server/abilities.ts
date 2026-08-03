/**
 * Ability content editing (A1): draft CRUD + the publish pipeline v1.
 *
 * Rule 1 of this repo: editors write DRAFT rows only. Publishing validates
 * every draft through the SHARED schema (the same one the game server boots
 * with), copies drafts over the published rows in one transaction, audits,
 * and pokes the game's /ops/reload-content so numbers go live without a
 * restart. A failed validation publishes nothing.
 */

import { and, eq } from 'drizzle-orm';
import { contentAbilities } from '@dawned/shared/schema';
import { abilityDefSchema, type AbilityDef } from '@dawned/shared';
import type { Config } from './config.js';
import type { Db } from './db.js';

export interface AbilityListEntry {
  id: string;
  classId: string;
  binding: AbilityDef['binding'];
  name: string;
  hasDraft: boolean;
  hasPublished: boolean;
  /** Draft def when present, else the published one (what the editor opens). */
  def: AbilityDef;
}

export interface AbilityDetail {
  id: string;
  draft: AbilityDef | null;
  published: AbilityDef | null;
}

const parseRow = (raw: unknown): AbilityDef | null => {
  const parsed = abilityDefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const listAbilities = async (db: Db): Promise<AbilityListEntry[]> => {
  const rows = await db.select().from(contentAbilities);
  const byId = new Map<string, { draft: AbilityDef | null; published: AbilityDef | null }>();
  for (const row of rows) {
    const def = parseRow(row.def);
    if (!def) continue; // unparseable rows surface via the publish validator
    const entry = byId.get(row.id) ?? { draft: null, published: null };
    if (row.status === 'draft') entry.draft = def;
    else entry.published = def;
    byId.set(row.id, entry);
  }
  const list: AbilityListEntry[] = [];
  for (const [id, entry] of byId) {
    const def = entry.draft ?? entry.published;
    if (!def) continue;
    list.push({
      id,
      classId: def.classId,
      binding: def.binding,
      name: def.name,
      hasDraft: entry.draft !== null,
      hasPublished: entry.published !== null,
      def,
    });
  }
  // Stable editor order: class, then binding kind, then slot/step.
  const bindingOrder = (binding: AbilityDef['binding']): number =>
    binding.kind === 'slot' ? 100 + binding.slot : binding.kind === 'basic' ? binding.step : 50;
  list.sort(
    (a, b) =>
      a.classId.localeCompare(b.classId) || bindingOrder(a.binding) - bindingOrder(b.binding),
  );
  return list;
};

export const readAbility = async (db: Db, id: string): Promise<AbilityDetail> => {
  const rows = await db.select().from(contentAbilities).where(eq(contentAbilities.id, id));
  const detail: AbilityDetail = { id, draft: null, published: null };
  for (const row of rows) {
    const def = parseRow(row.def);
    if (!def) continue;
    if (row.status === 'draft') detail.draft = def;
    else detail.published = def;
  }
  return detail;
};

/**
 * Save a DRAFT. A draft identical to the published row is pruned instead —
 * "n drafts pending" always means real differences (same rule as
 * world-settings, A0).
 */
export const saveAbilityDraft = async (
  db: Db,
  def: AbilityDef,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  const existing = await readAbility(db, def.id);
  const matchesPublished =
    existing.published !== null && JSON.stringify(def) === JSON.stringify(existing.published);
  if (matchesPublished) {
    await db
      .delete(contentAbilities)
      .where(and(eq(contentAbilities.id, def.id), eq(contentAbilities.status, 'draft')));
    return { pruned: true };
  }
  await db
    .insert(contentAbilities)
    .values({ id: def.id, status: 'draft', def, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [contentAbilities.id, contentAbilities.status],
      set: { def, updatedBy, updatedAt: new Date() },
    });
  return { pruned: false };
};

/** Delete a draft (published rows are untouchable outside publish). */
export const discardAbilityDraft = async (db: Db, id: string): Promise<boolean> => {
  const result = await db
    .delete(contentAbilities)
    .where(and(eq(contentAbilities.id, id), eq(contentAbilities.status, 'draft')))
    .returning({ id: contentAbilities.id });
  return result.length > 0;
};

export interface AbilityDiffEntry {
  id: string;
  name: string;
  kind: 'added' | 'changed';
  /** Dot paths whose values differ draft vs published. */
  changedPaths: string[];
}

const diffPaths = (a: unknown, b: unknown, prefix = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: string[] = [];
    for (const key of keys) {
      out.push(...diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  return [prefix || '<root>'];
};

/** Pending changes: every draft vs its published counterpart. */
export const diffAbilities = async (db: Db): Promise<AbilityDiffEntry[]> => {
  const rows = await db.select().from(contentAbilities);
  const drafts = new Map<string, AbilityDef>();
  const published = new Map<string, AbilityDef>();
  for (const row of rows) {
    const def = parseRow(row.def);
    if (!def) continue;
    (row.status === 'draft' ? drafts : published).set(row.id, def);
  }
  const out: AbilityDiffEntry[] = [];
  for (const [id, draft] of drafts) {
    const base = published.get(id);
    out.push({
      id,
      name: draft.name,
      kind: base ? 'changed' : 'added',
      changedPaths: base ? diffPaths(draft, base) : ['<new>'],
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

export interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  reload: { ok: boolean; note: string };
}

/**
 * Publish v1: validate EVERY draft + cross-checks (slot collisions across the
 * would-be published set), then copy draft → published and drop the drafts.
 * All-or-nothing; a single invalid draft publishes none.
 */
export const publishAbilities = async (db: Db, config: Config): Promise<PublishResult> => {
  const rows = await db.select().from(contentAbilities);
  const drafts = new Map<string, AbilityDef>();
  const published = new Map<string, AbilityDef>();
  const problems: string[] = [];
  for (const row of rows) {
    const parsed = abilityDefSchema.safeParse(row.def);
    if (!parsed.success) {
      if (row.status === 'draft') {
        const issue = parsed.error.issues[0];
        problems.push(
          `${row.id}: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'}`,
        );
      }
      continue;
    }
    (row.status === 'draft' ? drafts : published).set(row.id, parsed.data);
  }
  if (drafts.size === 0 && problems.length === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish'],
      reload: { ok: false, note: '' },
    };
  }

  // Cross-checks on the WOULD-BE published set (published overlaid by drafts).
  const next = new Map(published);
  for (const [id, def] of drafts) next.set(id, def);
  const slotOwners = new Map<string, string>();
  for (const def of next.values()) {
    if (def.binding.kind !== 'slot') continue;
    const key = `${def.classId}:${def.binding.slot}`;
    const owner = slotOwners.get(key);
    if (owner) problems.push(`${def.id}: slot ${key} already bound to ${owner}`);
    else slotOwners.set(key, def.id);
  }
  if (problems.length > 0) {
    return { ok: false, published: 0, problems, reload: { ok: false, note: '' } };
  }

  await db.transaction(async (tx) => {
    for (const [id, def] of drafts) {
      await tx
        .insert(contentAbilities)
        .values({ id, status: 'published', def, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentAbilities.id, contentAbilities.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentAbilities)
        .where(and(eq(contentAbilities.id, id), eq(contentAbilities.status, 'draft')));
    }
  });

  // Poke the live game (rule 3: everything live goes through the ops API).
  let reload = { ok: false, note: 'game unreachable — content applies on its next restart' };
  try {
    const response = await fetch(`${config.GAME_OPS_URL}/ops/reload-content`, {
      method: 'POST',
      headers: { 'x-ops-secret': config.OPS_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as { ok?: boolean; note?: string; error?: string };
    reload = response.ok
      ? { ok: true, note: body.note ?? 'reloaded' }
      : { ok: false, note: body.error ?? `reload refused (${response.status})` };
  } catch {
    // Keep the publish — the game picks the rows up at next boot.
  }

  return { ok: true, published: drafts.size, problems: [], reload };
};
