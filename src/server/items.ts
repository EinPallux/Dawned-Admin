/**
 * Item content editing (A1-c, game P8): items, loot tables and vendors —
 * draft CRUD, diff and publish, following the abilities/progression modules'
 * contract exactly: editors write DRAFTS, publish validates everything through
 * the SHARED schemas (the same ones the game boots with), cross-checks the
 * would-be published set, copies in one transaction and hot-reloads the game.
 *
 * The three tables publish TOGETHER because they only make sense together: a
 * loot table names items, a vendor stocks items, an enemy names a loot table.
 * Publishing them one at a time would mean shipping a shelf full of item ids
 * that do not exist yet.
 *
 * Cross-checks (fatal — publish refuses):
 *  - icon slugs are unique across items (ITEMS_LOOT.md §8: an item is its icon).
 *  - every loot-table item/table ref resolves in the would-be set, with no
 *    cycles (the game's roller is cycle-guarded, but a cycle is an authoring
 *    mistake, not a runtime condition).
 *  - every vendor stock ref resolves.
 *  - every PUBLISHED enemy's loot binding resolves — retiring a table that a
 *    live enemy still rolls would silently stop its drops.
 * Warnings (advisory — publish proceeds and says so):
 *  - stat budgets, weapon bands, armour and value that deviate from the §2
 *    formulas by more than a small tolerance. An item may deviate on purpose;
 *    it should never deviate by accident.
 */

import { and, eq } from 'drizzle-orm';
import {
  contentEnemies,
  contentItems,
  contentLootTables,
  contentVendors,
} from '@dawned/shared/schema';
import {
  ROLLS_BY_RARITY,
  baseArmorFor,
  enemyDefSchema,
  hasCycle,
  itemDefSchema,
  itemValue,
  lootTableDefSchema,
  statBudget,
  vendorDefSchema,
  weaponDamageFor,
  type ItemDef,
  type ItemStats,
  type LootTableDef,
  type VendorDef,
} from '@dawned/shared';
import type { Config } from './config.js';
import type { Db } from './db.js';

type Table = typeof contentItems | typeof contentLootTables | typeof contentVendors;
export type ItemTableName = 'items' | 'loot_tables' | 'vendors';

const tableFor = (name: ItemTableName): Table =>
  name === 'items' ? contentItems : name === 'loot_tables' ? contentLootTables : contentVendors;

interface RowSets<T> {
  drafts: Map<string, T>;
  published: Map<string, T>;
  problems: string[];
}

type Parsed<T> = { ok: true; def: T } | { ok: false; message: string };

const parseWith =
  <T>(schema: { safeParse: (raw: unknown) => { success: boolean; data?: T; error?: unknown } }) =>
  (raw: unknown): Parsed<T> => {
    const parsed = schema.safeParse(raw);
    if (parsed.success && parsed.data !== undefined) return { ok: true, def: parsed.data };
    const error = parsed.error as { issues?: { path: (string | number)[]; message: string }[] };
    const issue = error.issues?.[0];
    return { ok: false, message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid' };
  };

const parseItem = parseWith<ItemDef>(itemDefSchema);
const parseLootTable = parseWith<LootTableDef>(lootTableDefSchema);
const parseVendor = parseWith<VendorDef>(vendorDefSchema);

const loadRows = async <T>(
  db: Db,
  table: Table,
  parse: (raw: unknown) => Parsed<T>,
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

/** Draft overlaid on published — what a publish WOULD make live. */
const overlay = <T>(sets: RowSets<T>): Map<string, T> => {
  const next = new Map(sets.published);
  for (const [id, def] of sets.drafts) next.set(id, def);
  return next;
};

// ---------------------------------------------------------------------------
// Budget accounting (the meter the editor draws, shared formulas only)
// ---------------------------------------------------------------------------

/** Attribute points an item hands out (armour/crit are priced separately). */
export const spentAttributePoints = (stats: ItemStats): number =>
  (Object.keys(stats) as (keyof ItemStats)[]).reduce(
    (sum, key) => (key === 'armor' || key === 'critPct' ? sum : sum + (stats[key] ?? 0)),
    0,
  );

export interface BudgetReport {
  /** Fixed attribute points on the def. */
  fixed: number;
  /** Points a dropped copy rolls on top (rarity × pool). */
  rolled: number;
  /** The §2 budget for this slot/ilvl/rarity. */
  budget: number;
  /** Free armour the armour class grants (not charged to the budget). */
  freeArmor: number;
  /** Suggested weapon band for the ilvl (weapons only). */
  weapon: { min: number; max: number } | null;
  /** Suggested vendor value. */
  value: number;
}

export const budgetReport = (def: ItemDef): BudgetReport => {
  const fixed = spentAttributePoints(def.stats);
  const budget = statBudget(def.slot, def.ilvl, def.rarity);
  const rollCount = Math.min(ROLLS_BY_RARITY[def.rarity], def.rollPool?.length ?? 0);
  return {
    fixed,
    rolled: rollCount > 0 ? Math.max(0, Math.round(budget) - fixed) : 0,
    budget: Math.round(budget),
    freeArmor: def.armorClass ? baseArmorFor(def.armorClass, def.slot, def.ilvl) : 0,
    weapon: def.category === 'weapon' ? weaponDamageFor(def.ilvl) : null,
    value: itemValue(def.category, def.slot, def.ilvl, def.rarity),
  };
};

/** Advisory deviations — 15% either way is deliberate-looking, beyond is noise. */
const budgetWarnings = (def: ItemDef): string[] => {
  const report = budgetReport(def);
  const out: string[] = [];
  const off = (actual: number, want: number): boolean =>
    want > 0 && Math.abs(actual - want) / want > 0.15;
  if (
    report.budget > 0 &&
    report.fixed > 0 &&
    def.rollPool === undefined &&
    off(report.fixed, report.budget)
  ) {
    out.push(
      `${def.id}: ${report.fixed} stat points vs a ${report.budget}-point budget (§2 ƒ-suggest)`,
    );
  }
  if (def.weapon && report.weapon) {
    const avg = (def.weapon.dmgMin + def.weapon.dmgMax) / 2;
    const want = (report.weapon.min + report.weapon.max) / 2;
    if (off(avg, want)) {
      out.push(
        `${def.id}: average weapon damage ${avg.toFixed(1)} vs the ilvl ${def.ilvl} band ~${want.toFixed(1)}`,
      );
    }
  }
  if (def.value > 0 && off(def.value, report.value)) {
    out.push(`${def.id}: value ${def.value} vs the ƒ-suggested ${report.value}`);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Listing (draft-over-published view the editors open)
// ---------------------------------------------------------------------------

export interface ItemListEntry {
  id: string;
  name: string;
  category: string;
  slot: string;
  rarity: string;
  ilvl: number;
  icon: string;
  hasDraft: boolean;
  hasPublished: boolean;
  def: ItemDef;
  budget: BudgetReport;
}

export const listItems = async (db: Db): Promise<ItemListEntry[]> => {
  const sets = await loadRows(db, contentItems, parseItem);
  const out: ItemListEntry[] = [];
  for (const [id, def] of overlay(sets)) {
    out.push({
      id,
      name: def.name,
      category: def.category,
      slot: def.slot,
      rarity: def.rarity,
      ilvl: def.ilvl,
      icon: def.icon,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
      budget: budgetReport(def),
    });
  }
  return out.sort(
    (a, b) => a.category.localeCompare(b.category) || a.ilvl - b.ilvl || a.id.localeCompare(b.id),
  );
};

export interface LootListEntry {
  id: string;
  name: string;
  entries: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: LootTableDef;
}

export const listLootTables = async (db: Db): Promise<LootListEntry[]> => {
  const sets = await loadRows(db, contentLootTables, parseLootTable);
  const out: LootListEntry[] = [];
  for (const [id, def] of overlay(sets)) {
    out.push({
      id,
      name: def.name,
      entries: def.entries.length,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

export interface VendorListEntry {
  id: string;
  name: string;
  kind: string;
  stock: number;
  hasAnchor: boolean;
  hasDraft: boolean;
  hasPublished: boolean;
  def: VendorDef;
}

export const listVendors = async (db: Db): Promise<VendorListEntry[]> => {
  const sets = await loadRows(db, contentVendors, parseVendor);
  const out: VendorListEntry[] = [];
  for (const [id, def] of overlay(sets)) {
    out.push({
      id,
      name: def.name,
      kind: def.kind,
      stock: def.stock.length,
      hasAnchor: def.anchor !== null,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

// ---------------------------------------------------------------------------
// Draft CRUD (prune-on-match like every editor)
// ---------------------------------------------------------------------------

const saveDraft = async <T>(
  db: Db,
  table: Table,
  parse: (raw: unknown) => Parsed<T>,
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

export const saveItemDraft = (db: Db, def: ItemDef, updatedBy: number) =>
  saveDraft(db, contentItems, parseItem, def.id, def, updatedBy);

export const saveLootTableDraft = (db: Db, def: LootTableDef, updatedBy: number) =>
  saveDraft(db, contentLootTables, parseLootTable, def.id, def, updatedBy);

export const saveVendorDraft = (db: Db, def: VendorDef, updatedBy: number) =>
  saveDraft(db, contentVendors, parseVendor, def.id, def, updatedBy);

export const discardItemDraft = async (db: Db, table: ItemTableName, id: string) => {
  const target = tableFor(table);
  const result = await db
    .delete(target)
    .where(and(eq(target.id, id), eq(target.status, 'draft')))
    .returning({ id: target.id });
  return result.length > 0;
};

// ---------------------------------------------------------------------------
// Diff + publish
// ---------------------------------------------------------------------------

export interface ItemsDiff {
  items: { id: string; name: string; kind: 'added' | 'changed' }[];
  loot: { id: string; name: string; kind: 'added' | 'changed' }[];
  vendors: { id: string; name: string; kind: 'added' | 'changed' }[];
}

const diffOf = <T extends { name: string }>(
  sets: RowSets<T>,
): { id: string; name: string; kind: 'added' | 'changed' }[] =>
  [...sets.drafts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, def]) => ({
      id,
      name: def.name,
      kind: sets.published.has(id) ? 'changed' : 'added',
    }));

export const diffItems = async (db: Db): Promise<ItemsDiff> => ({
  items: diffOf(await loadRows(db, contentItems, parseItem)),
  loot: diffOf(await loadRows(db, contentLootTables, parseLootTable)),
  vendors: diffOf(await loadRows(db, contentVendors, parseVendor)),
});

export interface ItemsPublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  /** Advisory budget deviations — they never block a publish. */
  warnings: string[];
  reload: { ok: boolean; note: string };
}

/** The cross-checks, factored out so tests can drive them without a database. */
export const crossCheck = (
  items: Map<string, ItemDef>,
  tables: Map<string, LootTableDef>,
  vendors: Map<string, VendorDef>,
  enemyLootRefs: { enemyId: string; tableId: string }[],
): { problems: string[]; warnings: string[] } => {
  const problems: string[] = [];
  const warnings: string[] = [];

  const iconOwners = new Map<string, string>();
  for (const def of items.values()) {
    const owner = iconOwners.get(def.icon);
    if (owner) problems.push(`${def.id}: icon "${def.icon}" already belongs to ${owner}`);
    else iconOwners.set(def.icon, def.id);
    warnings.push(...budgetWarnings(def));
  }

  for (const table of tables.values()) {
    for (const entry of table.entries) {
      if (entry.kind === 'item' && !items.has(entry.ref)) {
        problems.push(`${table.id}: drops unknown item ${entry.ref}`);
      }
      if (entry.kind === 'table' && !tables.has(entry.ref)) {
        problems.push(`${table.id}: nests unknown table ${entry.ref}`);
      }
    }
    if (hasCycle(tables, table.id)) {
      problems.push(`${table.id}: nesting loops back on itself`);
    }
  }

  for (const vendor of vendors.values()) {
    for (const entry of vendor.stock) {
      if (!items.has(entry.itemId)) {
        problems.push(`${vendor.id}: stocks unknown item ${entry.itemId}`);
      }
    }
    if (vendor.kind !== 'collector' && vendor.stock.length === 0) {
      warnings.push(`${vendor.id}: no stock — the shop tab opens empty`);
    }
  }

  for (const ref of enemyLootRefs) {
    if (!tables.has(ref.tableId)) {
      problems.push(`${ref.enemyId} (live enemy): rolls unknown loot table ${ref.tableId}`);
    }
  }

  return { problems, warnings };
};

/** Publish all three item tables in one confirm. All-or-nothing. */
export const publishItems = async (db: Db, config: Config): Promise<ItemsPublishResult> => {
  const itemSets = await loadRows(db, contentItems, parseItem);
  const lootSets = await loadRows(db, contentLootTables, parseLootTable);
  const vendorSets = await loadRows(db, contentVendors, parseVendor);
  const parseProblems = [...itemSets.problems, ...lootSets.problems, ...vendorSets.problems];
  const draftCount = itemSets.drafts.size + lootSets.drafts.size + vendorSets.drafts.size;
  if (draftCount === 0 && parseProblems.length === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish'],
      warnings: [],
      reload: { ok: false, note: '' },
    };
  }

  // Live enemies keep rolling their tables through a publish — check them.
  const enemyRows = await db
    .select()
    .from(contentEnemies)
    .where(eq(contentEnemies.status, 'published'));
  const enemyLootRefs: { enemyId: string; tableId: string }[] = [];
  for (const row of enemyRows) {
    const parsed = enemyDefSchema.safeParse(row.def);
    if (parsed.success && parsed.data.loot) {
      enemyLootRefs.push({ enemyId: parsed.data.id, tableId: parsed.data.loot.tableId });
    }
  }

  const checked = crossCheck(
    overlay(itemSets),
    overlay(lootSets),
    overlay(vendorSets),
    enemyLootRefs,
  );
  const problems = [...parseProblems, ...checked.problems];
  if (problems.length > 0) {
    return {
      ok: false,
      published: 0,
      problems,
      warnings: checked.warnings,
      reload: { ok: false, note: '' },
    };
  }

  await db.transaction(async (tx) => {
    const copy = async (table: Table, drafts: Map<string, unknown>) => {
      for (const [id, def] of drafts) {
        await tx
          .insert(table)
          .values({ id, status: 'published', def, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [table.id, table.status],
            set: { def, updatedAt: new Date() },
          });
        await tx.delete(table).where(and(eq(table.id, id), eq(table.status, 'draft')));
      }
    };
    await copy(contentItems, itemSets.drafts);
    await copy(contentLootTables, lootSets.drafts);
    await copy(contentVendors, vendorSets.drafts);
  });

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

  return { ok: true, published: draftCount, problems: [], warnings: checked.warnings, reload };
};
