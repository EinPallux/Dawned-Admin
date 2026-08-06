/**
 * Progression content editing (A1-b, game P7): XP-curve rows + skill-tree
 * nodes — draft CRUD, diff and publish v1 for both tables, following the
 * abilities module's contract exactly: editors write DRAFTS, publish
 * validates everything through the SHARED schemas (the same ones the game
 * boots with), runs cross-checks on the would-be published set, copies in
 * one transaction and hot-reloads the game.
 *
 * Cross-checks:
 *  - xp curve: levels 1..29 exactly once (shared xpCurveProblems — the game
 *    refuses to boot on gaps, so publish must refuse first).
 *  - skill nodes: every ability_mod/proc ability ref exists in the published
 *    abilities set, and no two nodes share a class+branch+order cell (the
 *    lattice UI draws one node per cell).
 */

import { and, eq } from 'drizzle-orm';
import { contentAbilities, contentSkillNodes, contentXpCurve } from '@dawned/shared/schema';
import {
  abilityDefSchema,
  skillNodeDefSchema,
  xpCurveEntrySchema,
  xpCurveProblems,
  type SkillNodeDef,
  type XpCurveEntry,
} from '@dawned/shared';
import type { Config } from './config.js';
import { reloadGameContent } from './publish-support.js';
import type { Db } from './db.js';

type Table = typeof contentXpCurve | typeof contentSkillNodes;

interface RowSets<T> {
  drafts: Map<string, T>;
  published: Map<string, T>;
  problems: string[];
}

const loadRows = async <T>(
  db: Db,
  table: Table,
  parse: (raw: unknown) => { ok: true; def: T } | { ok: false; message: string },
): Promise<RowSets<T>> => {
  const rows = await db.select().from(table);
  const sets: RowSets<T> = { drafts: new Map(), published: new Map(), problems: [] };
  for (const row of rows) {
    const parsed = parse(row.def);
    if (!parsed.ok) {
      if (row.status === 'draft') sets.problems.push(`${row.id}: ${parsed.message}`);
      continue;
    }
    (row.status === 'draft' ? sets.drafts : sets.published).set(row.id, parsed.def);
  }
  return sets;
};

const parseCurve = (
  raw: unknown,
): { ok: true; def: XpCurveEntry } | { ok: false; message: string } => {
  const parsed = xpCurveEntrySchema.safeParse(raw);
  if (parsed.success) return { ok: true, def: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid' };
};

const parseNode = (
  raw: unknown,
): { ok: true; def: SkillNodeDef } | { ok: false; message: string } => {
  const parsed = skillNodeDefSchema.safeParse(raw);
  if (parsed.success) return { ok: true, def: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid' };
};

// ---------------------------------------------------------------------------
// Listing (draft-over-published view the editors open)
// ---------------------------------------------------------------------------

export interface CurveListEntry {
  id: string;
  level: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: XpCurveEntry;
}

export const listXpCurve = async (db: Db): Promise<CurveListEntry[]> => {
  const sets = await loadRows(db, contentXpCurve, parseCurve);
  const ids = new Set([...sets.drafts.keys(), ...sets.published.keys()]);
  const out: CurveListEntry[] = [];
  for (const id of ids) {
    const def = sets.drafts.get(id) ?? sets.published.get(id);
    if (!def) continue;
    out.push({
      id,
      level: def.level,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  return out.sort((a, b) => a.level - b.level);
};

export interface NodeListEntry {
  id: string;
  classId: string;
  branch: string;
  name: string;
  tier: number;
  order: number;
  capstone: boolean;
  maxRanks: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: SkillNodeDef;
}

export const listSkillNodes = async (db: Db): Promise<NodeListEntry[]> => {
  const sets = await loadRows(db, contentSkillNodes, parseNode);
  const ids = new Set([...sets.drafts.keys(), ...sets.published.keys()]);
  const out: NodeListEntry[] = [];
  for (const id of ids) {
    const def = sets.drafts.get(id) ?? sets.published.get(id);
    if (!def) continue;
    out.push({
      id,
      classId: def.classId,
      branch: def.branch,
      name: def.name,
      tier: def.tier,
      order: def.order,
      capstone: def.capstone,
      maxRanks: def.maxRanks,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  return out.sort(
    (a, b) =>
      a.classId.localeCompare(b.classId) || a.branch.localeCompare(b.branch) || a.order - b.order,
  );
};

// ---------------------------------------------------------------------------
// Draft CRUD (prune-on-match like every editor)
// ---------------------------------------------------------------------------

const saveDraft = async <T>(
  db: Db,
  table: Table,
  parse: (raw: unknown) => { ok: true; def: T } | { ok: false; message: string },
  id: string,
  def: T,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  const rows = await db.select().from(table).where(eq(table.id, id));
  const publishedRow = rows.find((row) => row.status === 'published');
  // Compare PARSED against PARSED: jsonb normalises key order on the way in,
  // so stringifying the raw column would report every identical draft as a
  // difference and the "n pending" badge would never reach zero.
  const published = publishedRow ? parse(publishedRow.def) : null;
  if (published?.ok && JSON.stringify(def) === JSON.stringify(published.def)) {
    await db.delete(table).where(and(eq(table.id, id), eq(table.status, 'draft')));
    return { pruned: true };
  }
  await db
    .insert(table)
    .values({ id, status: 'draft', def, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [table.id, table.status],
      set: { def, updatedBy, updatedAt: new Date() },
    });
  return { pruned: false };
};

export const saveXpCurveDraft = (db: Db, def: XpCurveEntry, updatedBy: number) =>
  saveDraft(db, contentXpCurve, parseCurve, def.id, def, updatedBy);

export const saveSkillNodeDraft = (db: Db, def: SkillNodeDef, updatedBy: number) =>
  saveDraft(db, contentSkillNodes, parseNode, def.id, def, updatedBy);

export const discardDraft = async (db: Db, table: 'xp_curve' | 'skill_nodes', id: string) => {
  const target = table === 'xp_curve' ? contentXpCurve : contentSkillNodes;
  const result = await db
    .delete(target)
    .where(and(eq(target.id, id), eq(target.status, 'draft')))
    .returning({ id: target.id });
  return result.length > 0;
};

// ---------------------------------------------------------------------------
// Diff + publish
// ---------------------------------------------------------------------------

export interface ProgressionDiff {
  curve: { id: string; kind: 'added' | 'changed' }[];
  nodes: { id: string; name: string; kind: 'added' | 'changed' }[];
}

export const diffProgression = async (db: Db): Promise<ProgressionDiff> => {
  const curveSets = await loadRows(db, contentXpCurve, parseCurve);
  const nodeSets = await loadRows(db, contentSkillNodes, parseNode);
  return {
    curve: [...curveSets.drafts.keys()]
      .sort()
      .map((id) => ({ id, kind: curveSets.published.has(id) ? 'changed' : 'added' })),
    nodes: [...nodeSets.drafts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, def]) => ({
        id,
        name: def.name,
        kind: nodeSets.published.has(id) ? 'changed' : 'added',
      })),
  };
};

export interface ProgressionPublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  reload: { ok: boolean; note: string };
}

/**
 * Publish BOTH progression tables in one confirm (they gate each other's
 * sanity: the curve length and the trees ship as one system). All-or-nothing.
 */
export const publishProgression = async (
  db: Db,
  config: Config,
): Promise<ProgressionPublishResult> => {
  const curveSets = await loadRows(db, contentXpCurve, parseCurve);
  const nodeSets = await loadRows(db, contentSkillNodes, parseNode);
  const problems = [...curveSets.problems, ...nodeSets.problems];
  const draftCount = curveSets.drafts.size + nodeSets.drafts.size;
  if (draftCount === 0 && problems.length === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish'],
      reload: { ok: false, note: '' },
    };
  }

  // Would-be published sets (published overlaid by drafts).
  const nextCurve = new Map(curveSets.published);
  for (const [id, def] of curveSets.drafts) nextCurve.set(id, def);
  const nextNodes = new Map(nodeSets.published);
  for (const [id, def] of nodeSets.drafts) nextNodes.set(id, def);

  // Curve completeness — only enforced once ANY curve rows exist (publishing
  // nodes alone against an empty curve stays legal; the game then runs the
  // formula defaults and says so at boot).
  if (nextCurve.size > 0) {
    problems.push(...xpCurveProblems([...nextCurve.values()]));
  }

  // Node cross-checks: ability refs exist in published abilities; one node
  // per class+branch+order cell; one capstone per branch.
  const abilityRows = await db
    .select()
    .from(contentAbilities)
    .where(eq(contentAbilities.status, 'published'));
  const knownAbilities = new Set<string>();
  for (const row of abilityRows) {
    const parsed = abilityDefSchema.safeParse(row.def);
    if (parsed.success) knownAbilities.add(parsed.data.id);
  }
  const cells = new Map<string, string>();
  const capstones = new Map<string, string>();
  for (const def of nextNodes.values()) {
    const cell = `${def.classId}/${def.branch}#${def.order}`;
    const owner = cells.get(cell);
    if (owner) problems.push(`${def.id}: cell ${cell} already holds ${owner}`);
    else cells.set(cell, def.id);
    if (def.capstone) {
      const key = `${def.classId}/${def.branch}`;
      const existing = capstones.get(key);
      if (existing) problems.push(`${def.id}: branch ${key} already has capstone ${existing}`);
      else capstones.set(key, def.id);
    }
    for (const rank of def.ranks) {
      for (const effect of rank) {
        const refs: string[] = [];
        if (effect.kind === 'ability_mod') {
          refs.push(effect.abilityId);
          if (effect.mods.resetCooldownOf) refs.push(effect.mods.resetCooldownOf);
          if (effect.mods.alsoCastFree) refs.push(effect.mods.alsoCastFree);
        }
        if (effect.kind === 'proc' && effect.proc === 'low_hp_free_cast') {
          refs.push(effect.abilityId);
        }
        for (const ref of refs) {
          if (!knownAbilities.has(ref)) {
            problems.push(`${def.id}: references unpublished ability ${ref}`);
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    return { ok: false, published: 0, problems, reload: { ok: false, note: '' } };
  }

  await db.transaction(async (tx) => {
    for (const [id, def] of curveSets.drafts) {
      await tx
        .insert(contentXpCurve)
        .values({ id, status: 'published', def, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentXpCurve.id, contentXpCurve.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentXpCurve)
        .where(and(eq(contentXpCurve.id, id), eq(contentXpCurve.status, 'draft')));
    }
    for (const [id, def] of nodeSets.drafts) {
      await tx
        .insert(contentSkillNodes)
        .values({ id, status: 'published', def, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentSkillNodes.id, contentSkillNodes.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentSkillNodes)
        .where(and(eq(contentSkillNodes.id, id), eq(contentSkillNodes.status, 'draft')));
    }
  });

  // The shared helper, not a second copy: this one had its own 5 s timeout and
  // its own error shapes, which is exactly the drift publish-support.ts exists
  // to prevent.
  const reload = await reloadGameContent(config);

  return { ok: true, published: draftCount, problems: [], reload };
};
