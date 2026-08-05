/**
 * Resource-node content editing (A-side of game P10) — draft CRUD, diff,
 * publish, and the gathering preview.
 *
 * Same contract as every other content module here: editors write DRAFTS,
 * publish validates through the SHARED schema the game boots with, cross-checks
 * the would-be published set, copies in one transaction and hot-reloads the
 * game. Nothing on this surface can touch a published row directly.
 *
 * Cross-checks (fatal — publish refuses):
 *  - every yield and proc item id resolves in the published item catalogue. A
 *    node that drops an item that does not exist is a gather that silently
 *    hands the player nothing.
 *  - a node's model is in the baked asset manifest. Same class of gate as the
 *    P9 enemy-clip check, and for the same reason: invisible until someone
 *    walks there.
 * Warnings (advisory — publish proceeds and says so):
 *  - a fishing node with a depleted model (a ripple has no stump).
 *  - a node whose tier is far from its zone's band is not checkable here — the
 *    placements decide that, and they live in the map draft.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { contentItems, contentResourceNodes } from '@dawned/shared/schema';
import {
  GATHER_XP_PER_TIER,
  fishingDifficulty,
  gatherChannelMs,
  itemDefSchema,
  nodeItemRefs,
  procChance,
  professionGatherXp,
  resourceNodeDefSchema,
  rollGather,
  tierForLevel,
  type ItemDef,
  type ResourceNodeDef,
} from '@dawned/shared';
import type { Config } from './config.js';
import { reloadGameContent } from './publish-support.js';
import type { Db } from './db.js';

interface RowSets<T> {
  drafts: Map<string, T>;
  published: Map<string, T>;
  problems: string[];
}

const loadNodeRows = async (db: Db): Promise<RowSets<ResourceNodeDef>> => {
  const rows = await db.select().from(contentResourceNodes);
  const sets: RowSets<ResourceNodeDef> = { drafts: new Map(), published: new Map(), problems: [] };
  for (const row of rows) {
    const parsed = resourceNodeDefSchema.safeParse(row.def);
    if (!parsed.success) {
      if (row.status === 'draft') {
        const issue = parsed.error.issues[0];
        sets.problems.push(
          `${row.id}: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'}`,
        );
      }
      continue;
    }
    (row.status === 'draft' ? sets.drafts : sets.published).set(row.id, parsed.data);
  }
  return sets;
};

/** Draft overlaid on published — what a publish WOULD make live. */
const overlay = <T>(sets: RowSets<T>): Map<string, T> => {
  const next = new Map(sets.published);
  for (const [id, def] of sets.drafts) next.set(id, def);
  return next;
};

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface NodeListEntry {
  id: string;
  name: string;
  profession: string;
  tier: number;
  /** Profession level this tier needs — the answer to "who can touch this?". */
  gate: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: ResourceNodeDef;
}

/** The profession level at which a tier becomes gatherable. */
const gateOf = (tier: number): number => {
  for (let level = 1; level <= 30; level++) if (tierForLevel(level) >= tier) return level;
  return 30;
};

export const listResourceNodes = async (db: Db): Promise<NodeListEntry[]> => {
  const sets = await loadNodeRows(db);
  const out: NodeListEntry[] = [];
  for (const [id, def] of overlay(sets)) {
    out.push({
      id,
      name: def.name,
      profession: def.profession,
      tier: def.tier,
      gate: gateOf(def.tier),
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  // Profession, then tier, then name: the order the owner thinks in.
  out.sort(
    (a, b) =>
      a.profession.localeCompare(b.profession) || a.tier - b.tier || a.name.localeCompare(b.name),
  );
  return out;
};

// ---------------------------------------------------------------------------
// Draft writes
// ---------------------------------------------------------------------------

/**
 * Save a draft, pruning it when it matches what is already published.
 *
 * The prune compares PARSED defs rather than the raw jsonb column: Postgres
 * normalises key order, so a byte comparison can never prune an identical
 * draft (A1-c found that the hard way).
 */
export const saveResourceNodeDraft = async (
  db: Db,
  def: ResourceNodeDef,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  const published = await db
    .select()
    .from(contentResourceNodes)
    .where(and(eq(contentResourceNodes.id, def.id), eq(contentResourceNodes.status, 'published')))
    .limit(1);
  const live = published[0] ? resourceNodeDefSchema.safeParse(published[0].def) : null;
  if (live?.success && JSON.stringify(live.data) === JSON.stringify(def)) {
    await db
      .delete(contentResourceNodes)
      .where(and(eq(contentResourceNodes.id, def.id), eq(contentResourceNodes.status, 'draft')));
    return { pruned: true };
  }
  await db
    .insert(contentResourceNodes)
    .values({ id: def.id, status: 'draft', def, updatedBy })
    .onConflictDoUpdate({
      target: [contentResourceNodes.id, contentResourceNodes.status],
      set: { def, updatedBy, updatedAt: new Date() },
    });
  return { pruned: false };
};

export const discardResourceNodeDraft = async (db: Db, id: string): Promise<boolean> => {
  const result = await db
    .delete(contentResourceNodes)
    .where(and(eq(contentResourceNodes.id, id), eq(contentResourceNodes.status, 'draft')))
    .returning({ id: contentResourceNodes.id });
  return result.length > 0;
};

// ---------------------------------------------------------------------------
// Diff + publish
// ---------------------------------------------------------------------------

export interface NodeDiff {
  added: string[];
  changed: string[];
  unchanged: string[];
}

export const diffResourceNodes = async (db: Db): Promise<NodeDiff> => {
  const sets = await loadNodeRows(db);
  const diff: NodeDiff = { added: [], changed: [], unchanged: [] };
  for (const [id, def] of sets.drafts) {
    const live = sets.published.get(id);
    if (!live) diff.added.push(id);
    else if (JSON.stringify(live) !== JSON.stringify(def)) diff.changed.push(id);
    else diff.unchanged.push(id);
  }
  return diff;
};

/** The cross-checks, factored out so tests can drive them without a database. */
export const crossCheckNodes = (
  nodes: ReadonlyMap<string, ResourceNodeDef>,
  itemIds: ReadonlySet<string>,
  bakedModels: ReadonlySet<string>,
): { problems: string[]; warnings: string[] } => {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const def of nodes.values()) {
    for (const itemId of nodeItemRefs(def)) {
      if (!itemIds.has(itemId)) {
        problems.push(`${def.id}: yields "${itemId}", which is not a published item`);
      }
    }
    // An empty manifest means no game checkout is reachable (a bare dev box);
    // blocking every publish on that would be worse than the gate is worth.
    if (bakedModels.size > 0 && !bakedModels.has(def.modelRef)) {
      problems.push(`${def.id}: model "${def.modelRef}" is not in the baked asset manifest`);
    }
    if (bakedModels.size > 0 && def.depletedModelRef && !bakedModels.has(def.depletedModelRef)) {
      problems.push(
        `${def.id}: depleted model "${def.depletedModelRef}" is not in the baked asset manifest`,
      );
    }
    if (def.profession === 'fishing' && def.depletedModelRef) {
      warnings.push(`${def.id}: a fishing spot with a depleted model — ripples leave no stump`);
    }
  }
  return { problems, warnings };
};

export interface NodePublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  warnings: string[];
  reload: { ok: boolean; note: string };
}

const bakedModelIds = async (config: Config): Promise<Set<string>> => {
  try {
    const raw = await readFile(path.join(config.ASSETS_DIR, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as { assets?: Record<string, unknown> };
    return new Set(Object.keys(parsed.assets ?? {}));
  } catch {
    return new Set();
  }
};

export const publishResourceNodes = async (db: Db, config: Config): Promise<NodePublishResult> => {
  const sets = await loadNodeRows(db);
  if (sets.problems.length > 0) {
    return {
      ok: false,
      published: 0,
      problems: sets.problems,
      warnings: [],
      reload: { ok: false, note: 'not attempted' },
    };
  }
  if (sets.drafts.size === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish — no resource-node drafts'],
      warnings: [],
      reload: { ok: false, note: 'not attempted' },
    };
  }

  const itemRows = await db.select().from(contentItems).where(eq(contentItems.status, 'published'));
  const itemIds = new Set<string>();
  for (const row of itemRows) {
    const parsed = itemDefSchema.safeParse(row.def);
    if (parsed.success) itemIds.add(parsed.data.id);
  }

  const wouldBe = overlay(sets);
  const checked = crossCheckNodes(wouldBe, itemIds, await bakedModelIds(config));
  if (checked.problems.length > 0) {
    return {
      ok: false,
      published: 0,
      problems: checked.problems,
      warnings: checked.warnings,
      reload: { ok: false, note: 'not attempted' },
    };
  }

  await db.transaction(async (tx) => {
    for (const [id, def] of sets.drafts) {
      await tx
        .insert(contentResourceNodes)
        .values({ id, status: 'published', def })
        .onConflictDoUpdate({
          target: [contentResourceNodes.id, contentResourceNodes.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentResourceNodes)
        .where(and(eq(contentResourceNodes.id, id), eq(contentResourceNodes.status, 'draft')));
    }
  });

  const reload = await reloadGameContent(config);
  return {
    ok: true,
    published: sets.drafts.size,
    problems: [],
    warnings: checked.warnings,
    reload,
  };
};

// ---------------------------------------------------------------------------
// The gathering preview (the Loot simulator's cousin)
// ---------------------------------------------------------------------------

export interface GatherPreview {
  /** Profession level the preview was run at. */
  profLevel: number;
  /** Hold time per gather at that level, ms. */
  channelMs: number;
  /** Profession XP per gather (halved when the tier is back country). */
  profXp: number;
  /** Proc chance at that level, as a percentage. */
  procPct: number;
  /** Expected items per 100 gathers, highest first. */
  perHundred: { itemId: string; qty: number }[];
  /** Gathers per hour if you never stopped: channel + respawn, one node. */
  perHourOneNode: number;
  /** Fishing only: how hard the bar is for this node's best and worst fish. */
  fishing: { itemId: string; driftSpeed: number; markerHalf: number }[] | null;
}

/**
 * Roll `samples` gathers through the game's OWN `rollGather`.
 *
 * The same argument the loot simulator makes: a preview that reimplements the
 * roll is a preview that eventually disagrees with the drop. This drives the
 * shared function with a seeded sequence so the same node previews the same
 * way twice — a changed number should show the change, not a fresh shuffle.
 */
export const previewGathering = (
  def: ResourceNodeDef,
  profLevel: number,
  items: ReadonlyMap<string, ItemDef>,
  samples = 1000,
): GatherPreview => {
  let seed = 0x2f6e2b1;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const totals = new Map<string, number>();
  const rate = procChance(profLevel, def.bonusRolls);
  for (let i = 0; i < samples; i++) {
    const rolled = rollGather(
      def,
      { yieldPick: next(), yieldQty: next(), proc: next(), procPick: next(), procQty: next() },
      rate,
    );
    for (const stack of rolled.yields) {
      totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.qty);
    }
    if (rolled.proc) {
      totals.set(rolled.proc.itemId, (totals.get(rolled.proc.itemId) ?? 0) + rolled.proc.qty);
    }
  }
  const channelMs = gatherChannelMs(def.tier, profLevel, def.channelMs);
  return {
    profLevel,
    channelMs,
    profXp: professionGatherXp(def.tier, profLevel),
    procPct: Number((rate * 100).toFixed(2)),
    perHundred: [...totals]
      .map(([itemId, qty]) => ({ itemId, qty: Number(((qty / samples) * 100).toFixed(1)) }))
      .sort((a, b) => b.qty - a.qty),
    // One node, gathered the instant it regrows: channel + respawn per cycle.
    perHourOneNode: Number((3_600_000 / (channelMs + def.respawnMs)).toFixed(1)),
    fishing:
      def.profession === 'fishing'
        ? def.yields.map((entry) => {
            const difficulty = fishingDifficulty(
              def.tier,
              items.get(entry.itemId)?.rarity ?? 'common',
            );
            return { itemId: entry.itemId, ...difficulty };
          })
        : null,
  };
};

/** XP per gather at the frontier, for the list's "worth it?" column. */
export const frontierXp = (tier: number): number => GATHER_XP_PER_TIER * tier;
