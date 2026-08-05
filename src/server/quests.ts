/**
 * Quest + NPC content editing (A4, alongside game P11) — draft CRUD, diff,
 * publish, flow validation, the chain graph and the journal preview.
 *
 * Same contract as every other content module here: editors write DRAFTS,
 * publish validates through the SHARED schema the game boots with, cross-checks
 * the would-be published set, copies in one transaction and hot-reloads the
 * game. Nothing on this surface can touch a published row directly.
 *
 * Quests and NPCs share ONE publish rail because they reference each other —
 * a quest names its giver, an NPC exists to be talked to — and publishing them
 * separately would guarantee a window where a live quest points at an NPC that
 * is not there yet. Enemies and spawners ship together for the same reason.
 *
 * The validation worth naming is `validateQuestFlow`, which is the GAME's
 * function, not a copy. A quest the panel calls valid and the server refuses to
 * load would be the worst possible split, because the failure would land at the
 * next server boot rather than at the publish button.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { contentEnemies, contentItems, contentNpcs, contentQuests } from '@dawned/shared/schema';
import {
  enemyDefSchema,
  itemDefSchema,
  npcDefSchema,
  questDefSchema,
  questItemRefs,
  questNpcRefs,
  questTurnInNpc,
  stepTarget,
  suggestedQuestGold,
  suggestedQuestXp,
  validateNpc,
  validateQuestFlow,
  xpToNextDefault,
  type NpcDef,
  type QuestDef,
} from '@dawned/shared';
import type { Config } from './config.js';
import { reloadGameContent } from './publish-support.js';
import type { Db } from './db.js';

interface RowSets<T> {
  drafts: Map<string, T>;
  published: Map<string, T>;
  problems: string[];
}

const emptySets = <T>(): RowSets<T> => ({
  drafts: new Map(),
  published: new Map(),
  problems: [],
});

const loadQuestRows = async (db: Db): Promise<RowSets<QuestDef>> => {
  const rows = await db.select().from(contentQuests);
  const sets = emptySets<QuestDef>();
  for (const row of rows) {
    const parsed = questDefSchema.safeParse(row.def);
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

const loadNpcRows = async (db: Db): Promise<RowSets<NpcDef>> => {
  const rows = await db.select().from(contentNpcs);
  const sets = emptySets<NpcDef>();
  for (const row of rows) {
    const parsed = npcDefSchema.safeParse(row.def);
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

export interface QuestListEntry {
  id: string;
  name: string;
  zoneId: string;
  suggestedLevel: number;
  chainId: string;
  steps: number;
  giverKind: string;
  hasDraft: boolean;
  hasPublished: boolean;
  /** Flow problems on THIS row — shown as a red dot in the list. */
  problems: string[];
  def: QuestDef;
}

export const listQuests = async (db: Db): Promise<QuestListEntry[]> => {
  const sets = await loadQuestRows(db);
  // The NPC set too, so the list's problem dot can catch the single most
  // likely authoring mistake — a typo in the giver's id. `validateQuestFlow`
  // alone is ROW-LOCAL and cannot see it, which meant a quest publish would
  // refuse looked perfectly healthy in the list until you pressed the button.
  const npcSets = await loadNpcRows(db);
  const knownNpcs = overlay(npcSets);
  const knownQuests = overlay(sets);
  const out: QuestListEntry[] = [];
  for (const [id, def] of knownQuests) {
    const problems = validateQuestFlow(def);
    for (const npcId of questNpcRefs(def)) {
      if (!knownNpcs.has(npcId)) problems.push(`unknown npc "${npcId}"`);
    }
    for (const questId of def.prerequisites.questIds) {
      if (!knownQuests.has(questId)) problems.push(`unknown prerequisite "${questId}"`);
    }
    out.push({
      id,
      name: def.name,
      zoneId: def.zoneId,
      suggestedLevel: def.suggestedLevel,
      chainId: def.chainId,
      steps: def.steps.length,
      giverKind: def.giver.kind,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      problems,
      def,
    });
  }
  // Zone, then level, then name — the order the owner builds a zone in.
  out.sort(
    (a, b) =>
      a.zoneId.localeCompare(b.zoneId) ||
      a.suggestedLevel - b.suggestedLevel ||
      a.name.localeCompare(b.name),
  );
  return out;
};

export interface NpcListEntry {
  id: string;
  name: string;
  title: string;
  role: string;
  hasDraft: boolean;
  hasPublished: boolean;
  problems: string[];
  def: NpcDef;
}

export const listNpcs = async (db: Db): Promise<NpcListEntry[]> => {
  const sets = await loadNpcRows(db);
  const out: NpcListEntry[] = [];
  for (const [id, def] of overlay(sets)) {
    out.push({
      id,
      name: def.name,
      title: def.title,
      role: def.role,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      problems: validateNpc(def),
      def,
    });
  }
  out.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
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
export const saveQuestDraft = async (
  db: Db,
  def: QuestDef,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  const published = await db
    .select()
    .from(contentQuests)
    .where(and(eq(contentQuests.id, def.id), eq(contentQuests.status, 'published')))
    .limit(1);
  const live = published[0] ? questDefSchema.safeParse(published[0].def) : null;
  if (live?.success && JSON.stringify(live.data) === JSON.stringify(def)) {
    await db
      .delete(contentQuests)
      .where(and(eq(contentQuests.id, def.id), eq(contentQuests.status, 'draft')));
    return { pruned: true };
  }
  await db
    .insert(contentQuests)
    .values({ id: def.id, status: 'draft', def, updatedBy })
    .onConflictDoUpdate({
      target: [contentQuests.id, contentQuests.status],
      set: { def, updatedBy, updatedAt: new Date() },
    });
  return { pruned: false };
};

export const saveNpcDraft = async (
  db: Db,
  def: NpcDef,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  const published = await db
    .select()
    .from(contentNpcs)
    .where(and(eq(contentNpcs.id, def.id), eq(contentNpcs.status, 'published')))
    .limit(1);
  const live = published[0] ? npcDefSchema.safeParse(published[0].def) : null;
  if (live?.success && JSON.stringify(live.data) === JSON.stringify(def)) {
    await db
      .delete(contentNpcs)
      .where(and(eq(contentNpcs.id, def.id), eq(contentNpcs.status, 'draft')));
    return { pruned: true };
  }
  await db
    .insert(contentNpcs)
    .values({ id: def.id, status: 'draft', def, updatedBy })
    .onConflictDoUpdate({
      target: [contentNpcs.id, contentNpcs.status],
      set: { def, updatedBy, updatedAt: new Date() },
    });
  return { pruned: false };
};

export const discardQuestDraft = async (db: Db, id: string): Promise<boolean> => {
  const result = await db
    .delete(contentQuests)
    .where(and(eq(contentQuests.id, id), eq(contentQuests.status, 'draft')))
    .returning({ id: contentQuests.id });
  return result.length > 0;
};

export const discardNpcDraft = async (db: Db, id: string): Promise<boolean> => {
  const result = await db
    .delete(contentNpcs)
    .where(and(eq(contentNpcs.id, id), eq(contentNpcs.status, 'draft')))
    .returning({ id: contentNpcs.id });
  return result.length > 0;
};

// ---------------------------------------------------------------------------
// Diff + publish
// ---------------------------------------------------------------------------

export interface QuestDiff {
  quests: { added: string[]; changed: string[]; unchanged: string[] };
  npcs: { added: string[]; changed: string[]; unchanged: string[] };
}

const diffSet = <T>(
  sets: RowSets<T>,
): { added: string[]; changed: string[]; unchanged: string[] } => {
  const diff = { added: [] as string[], changed: [] as string[], unchanged: [] as string[] };
  for (const [id, def] of sets.drafts) {
    const live = sets.published.get(id);
    if (!live) diff.added.push(id);
    else if (JSON.stringify(live) !== JSON.stringify(def)) diff.changed.push(id);
    else diff.unchanged.push(id);
  }
  return diff;
};

export const diffQuests = async (db: Db): Promise<QuestDiff> => ({
  quests: diffSet(await loadQuestRows(db)),
  npcs: diffSet(await loadNpcRows(db)),
});

/**
 * The cross-checks, factored out so tests can drive them without a database.
 *
 * Fatal (publish refuses):
 *  - the game's own `validateQuestFlow` — an unfinishable quest is worse than a
 *    missing one, because a player carries it in their journal forever.
 *  - every NPC a quest names is in the would-be-published NPC set.
 *  - every item a quest collects, delivers or rewards is a published item.
 *  - every enemy a KILL step names exists.
 *  - a chain prerequisite points at a quest that will be live.
 *  - an NPC's model is in the baked manifest (invisible until someone walks
 *    there — the same gate resource nodes get).
 *
 * Advisory (publish proceeds and says so):
 *  - a quest with no rewards at all (QUESTS_POI §1.5 wants gold + XP always).
 *  - a chain link nothing unlocks — usually a `prerequisites` typo.
 *  - an NPC nobody talks to.
 */
export const crossCheckQuests = (
  quests: ReadonlyMap<string, QuestDef>,
  npcs: ReadonlyMap<string, NpcDef>,
  itemIds: ReadonlySet<string>,
  enemyIds: ReadonlySet<string>,
  bakedModels: ReadonlySet<string>,
): { problems: string[]; warnings: string[] } => {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const def of quests.values()) {
    problems.push(...validateQuestFlow(def));
    for (const npcId of questNpcRefs(def)) {
      if (!npcs.has(npcId)) {
        problems.push(`${def.id}: names npc "${npcId}", which is not published`);
      }
    }
    for (const itemId of questItemRefs(def)) {
      if (itemIds.size > 0 && !itemIds.has(itemId)) {
        problems.push(`${def.id}: references item "${itemId}", which is not a published item`);
      }
    }
    for (const step of def.steps) {
      if (step.type !== 'kill' || !step.enemyId) continue;
      if (enemyIds.size > 0 && !enemyIds.has(step.enemyId)) {
        problems.push(`${def.id}: kills "${step.enemyId}", which is not a published enemy`);
      }
    }
    for (const questId of def.prerequisites.questIds) {
      if (!quests.has(questId)) {
        problems.push(`${def.id}: requires "${questId}", which is not published`);
      }
    }
    if (def.rewards.xp === 0 && def.rewards.gold === 0 && def.rewards.items.length === 0) {
      warnings.push(`${def.id}: pays nothing — QUESTS_POI §1.5 wants gold + XP on every quest`);
    }
    if (def.chainId && def.prerequisites.questIds.length === 0) {
      const isFirst = [...quests.values()].some((other) =>
        other.prerequisites.questIds.includes(def.id),
      );
      if (!isFirst) {
        warnings.push(
          `${def.id}: has a chainId but nothing links to or from it — check prerequisites`,
        );
      }
    }
  }

  for (const npc of npcs.values()) {
    problems.push(...validateNpc(npc).filter((line) => !line.includes('will never speak')));
    warnings.push(...validateNpc(npc).filter((line) => line.includes('will never speak')));
    // An empty manifest means no game checkout is reachable (a bare dev box);
    // blocking every publish on that would be worse than the gate is worth.
    if (bakedModels.size > 0 && !bakedModels.has(npc.modelRef)) {
      problems.push(`${npc.id}: model "${npc.modelRef}" is not in the baked asset manifest`);
    }
    const talkedTo = [...quests.values()].some((quest) => questNpcRefs(quest).includes(npc.id));
    if (!talkedTo && npc.role === 'quest_giver') {
      warnings.push(`${npc.id}: a quest giver no quest names`);
    }
  }

  return { problems, warnings };
};

export interface QuestPublishResult {
  ok: boolean;
  publishedQuests: number;
  publishedNpcs: number;
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

const publishedIds = async (
  db: Db,
  table: typeof contentItems | typeof contentEnemies,
  parse: (raw: unknown) => { success: boolean; data?: { id: string } },
): Promise<Set<string>> => {
  const rows = await db.select().from(table).where(eq(table.status, 'published'));
  const ids = new Set<string>();
  for (const row of rows) {
    const parsed = parse(row.def);
    if (parsed.success && parsed.data) ids.add(parsed.data.id);
  }
  return ids;
};

export const publishQuests = async (db: Db, config: Config): Promise<QuestPublishResult> => {
  const questSets = await loadQuestRows(db);
  const npcSets = await loadNpcRows(db);
  const parseProblems = [...questSets.problems, ...npcSets.problems];
  if (parseProblems.length > 0) {
    return {
      ok: false,
      publishedQuests: 0,
      publishedNpcs: 0,
      problems: parseProblems,
      warnings: [],
      reload: { ok: false, note: 'not attempted' },
    };
  }
  if (questSets.drafts.size === 0 && npcSets.drafts.size === 0) {
    return {
      ok: false,
      publishedQuests: 0,
      publishedNpcs: 0,
      problems: ['nothing to publish — no quest or NPC drafts'],
      warnings: [],
      reload: { ok: false, note: 'not attempted' },
    };
  }

  const itemIds = await publishedIds(db, contentItems, (raw) => itemDefSchema.safeParse(raw));
  const enemyIds = await publishedIds(db, contentEnemies, (raw) => enemyDefSchema.safeParse(raw));
  const checked = crossCheckQuests(
    overlay(questSets),
    overlay(npcSets),
    itemIds,
    enemyIds,
    await bakedModelIds(config),
  );
  if (checked.problems.length > 0) {
    return {
      ok: false,
      publishedQuests: 0,
      publishedNpcs: 0,
      problems: checked.problems,
      warnings: checked.warnings,
      reload: { ok: false, note: 'not attempted' },
    };
  }

  await db.transaction(async (tx) => {
    // NPCs first: a quest that lands before its giver would be live and
    // unopenable for the width of the transaction. Same order spawners take
    // behind the bestiary.
    for (const [id, def] of npcSets.drafts) {
      await tx
        .insert(contentNpcs)
        .values({ id, status: 'published', def })
        .onConflictDoUpdate({
          target: [contentNpcs.id, contentNpcs.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentNpcs)
        .where(and(eq(contentNpcs.id, id), eq(contentNpcs.status, 'draft')));
    }
    for (const [id, def] of questSets.drafts) {
      await tx
        .insert(contentQuests)
        .values({ id, status: 'published', def })
        .onConflictDoUpdate({
          target: [contentQuests.id, contentQuests.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentQuests)
        .where(and(eq(contentQuests.id, id), eq(contentQuests.status, 'draft')));
    }
  });

  const reload = await reloadGameContent(config);
  return {
    ok: true,
    publishedQuests: questSets.drafts.size,
    publishedNpcs: npcSets.drafts.size,
    problems: [],
    warnings: checked.warnings,
    reload,
  };
};

// ---------------------------------------------------------------------------
// Previews (the page's point)
// ---------------------------------------------------------------------------

/** One node of the chain graph the editor draws. */
export interface ChainNode {
  questId: string;
  name: string;
  suggestedLevel: number;
  /** Quests that must be turned in first. */
  requires: string[];
  /** Quests this one unlocks. */
  unlocks: string[];
}

/**
 * The chain graph: what unlocks what.
 *
 * Built from `prerequisites`, NOT from `chainId` — the chain id is a label for
 * the journal's grouping, and the ORDER is the prerequisites. Reading the label
 * instead would draw a graph that disagrees with the gate the game enforces.
 */
export const chainGraph = (quests: ReadonlyMap<string, QuestDef>, chainId: string): ChainNode[] => {
  const members = [...quests.values()].filter(
    (quest) => quest.chainId === chainId || chainId === '',
  );
  return members.map((quest) => ({
    questId: quest.id,
    name: quest.name,
    suggestedLevel: quest.suggestedLevel,
    requires: quest.prerequisites.questIds,
    unlocks: members
      .filter((other) => other.prerequisites.questIds.includes(quest.id))
      .map((other) => other.id),
  }));
};

export interface QuestPreview {
  questId: string;
  /** The journal entry as the player will read it. */
  journal: { name: string; zoneId: string; level: number; prose: string };
  /** Tracker lines with their counters, as the HUD renders them. */
  tracker: { text: string; need: number; type: string; hint: boolean; clue: string }[];
  /** Rewards, with the ƒ-suggested values beside what is authored. */
  rewards: {
    xp: number;
    gold: number;
    suggestedXp: number;
    suggestedGold: number;
    items: { itemId: string; name: string; qty: number }[];
    choices: { classId: string; itemId: string; name: string }[];
    title: string;
  };
  /** Who gives it and who closes it, resolved to display names. */
  flow: { giver: string; turnIn: string; gates: string[] };
  /** Everything wrong with it, from the GAME's own validator. */
  problems: string[];
}

/**
 * Render one quest the way the player will meet it.
 *
 * The preview runs against the EDITOR BUFFER the caller passes in, not the
 * saved row — a preview of the last save lies for exactly one save, which is
 * how a reward gets doubled (the Professions editor learned this at A1-e).
 */
export const previewQuest = (
  def: QuestDef,
  npcs: ReadonlyMap<string, NpcDef>,
  items: ReadonlyMap<string, { name: string }>,
): QuestPreview => {
  const nameOf = (npcId: string | null): string =>
    npcId ? (npcs.get(npcId)?.name ?? `${npcId} (missing)`) : '—';
  const giver =
    def.giver.kind === 'npc'
      ? nameOf(def.giver.npcId)
      : def.giver.kind === 'board'
        ? `Board: ${def.giver.boardId}`
        : def.giver.kind === 'item'
          ? `Item: ${items.get(def.giver.itemId)?.name ?? def.giver.itemId}`
          : `Object: ${def.giver.objectId}`;
  const gates: string[] = [];
  if (def.prerequisites.level > 1) gates.push(`level ${def.prerequisites.level}`);
  for (const questId of def.prerequisites.questIds) gates.push(`after ${questId}`);
  for (const discoveryId of def.prerequisites.discoveryIds) gates.push(`found ${discoveryId}`);

  return {
    questId: def.id,
    journal: {
      name: def.name,
      zoneId: def.zoneId,
      level: def.suggestedLevel,
      prose: def.journalText,
    },
    tracker: def.steps.map((step) => ({
      text: step.trackerText,
      need: stepTarget(step),
      type: step.type,
      hint: step.hint !== null,
      clue: step.type === 'explore' ? step.clueText : '',
    })),
    rewards: {
      xp: def.rewards.xp,
      gold: def.rewards.gold,
      suggestedXp: suggestedQuestXp(def.suggestedLevel, def.steps.length, xpToNextDefault),
      suggestedGold: suggestedQuestGold(def.suggestedLevel, def.steps.length),
      items: def.rewards.items.map((entry) => ({
        itemId: entry.itemId,
        name: items.get(entry.itemId)?.name ?? entry.itemId,
        qty: entry.qty,
      })),
      choices: def.rewards.choices.map((choice) => ({
        classId: choice.classId,
        itemId: choice.itemId,
        name: items.get(choice.itemId)?.name ?? choice.itemId,
      })),
      title: def.rewards.title,
    },
    flow: { giver, turnIn: nameOf(questTurnInNpc(def)), gates },
    problems: validateQuestFlow(def),
  };
};

/** Everything the preview endpoint needs, loaded once. */
export const previewContext = async (
  db: Db,
): Promise<{
  npcs: Map<string, NpcDef>;
  items: Map<string, { name: string }>;
  quests: Map<string, QuestDef>;
}> => {
  const npcSets = await loadNpcRows(db);
  const questSets = await loadQuestRows(db);
  const itemRows = await db.select().from(contentItems).where(eq(contentItems.status, 'published'));
  const items = new Map<string, { name: string }>();
  for (const row of itemRows) {
    const parsed = itemDefSchema.safeParse(row.def);
    if (parsed.success) items.set(parsed.data.id, { name: parsed.data.name });
  }
  return { npcs: overlay(npcSets), items, quests: overlay(questSets) };
};
