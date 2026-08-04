/**
 * Enemy content editing (A1-d, game P9): enemy defs + spawners — draft CRUD,
 * diff and publish v1, on the same rail as abilities/progression/items.
 * Editors write DRAFTS; publish validates through the SHARED schemas the game
 * boots with, cross-checks the would-be published set, copies in one
 * transaction and hot-reloads the game.
 *
 * Cross-checks:
 *  - every enemy's own `validateEnemyDef` problems (charges that cannot
 *    overshoot, casts too short to interrupt, phases on a non-boss…),
 *  - loot table refs resolve against the PUBLISHED loot set,
 *  - spawner enemy refs resolve against the would-be published enemy set —
 *    a spawner pointing at a deleted enemy is a camp that silently never
 *    populates, which is the worst kind of content bug: it looks fine,
 *  - advisory: a boss with no phases, since "phase at 50%" is what makes a
 *    boss fight a fight (NPCS_ENEMIES.md §1).
 *
 * The TTK simulator below runs the SAME shared selection rules the live AI
 * fights with, so the number an editor tunes against is the number the fight
 * will produce — the loot simulator's contract, applied to combat.
 */

import { and, eq } from 'drizzle-orm';
import { contentEnemies, contentLootTables, contentSpawners } from '@dawned/shared/schema';
import {
  ARCHETYPE_MOTION,
  enemyDefSchema,
  enemyStats,
  missingClips,
  pickEnemyAbility,
  playerStats,
  selectableEnemyAbilities,
  spawnerDefSchema,
  validateEnemyDef,
  type ClassId,
  type EnemyDef,
  type SpawnerDef,
} from '@dawned/shared';
import type { Config } from './config.js';
import type { Db } from './db.js';

type Table = typeof contentEnemies | typeof contentSpawners;

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

const firstIssue = (error: { issues: { path: PropertyKey[]; message: string }[] }): string => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid';
};

const parseEnemy = (raw: unknown): { ok: true; def: EnemyDef } | { ok: false; message: string } => {
  const parsed = enemyDefSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, def: parsed.data }
    : { ok: false, message: firstIssue(parsed.error) };
};

const parseSpawner = (
  raw: unknown,
): { ok: true; def: SpawnerDef } | { ok: false; message: string } => {
  const parsed = spawnerDefSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, def: parsed.data }
    : { ok: false, message: firstIssue(parsed.error) };
};

// ---------------------------------------------------------------------------
// Listing (draft-over-published view the editor opens)
// ---------------------------------------------------------------------------

export interface EnemyListEntry {
  id: string;
  name: string;
  archetype: string;
  rank: string;
  levelMin: number;
  levelMax: number;
  abilityCount: number;
  phaseCount: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: EnemyDef;
}

export const listEnemies = async (db: Db): Promise<EnemyListEntry[]> => {
  const sets = await loadRows(db, contentEnemies, parseEnemy);
  const ids = new Set([...sets.drafts.keys(), ...sets.published.keys()]);
  const out: EnemyListEntry[] = [];
  for (const id of ids) {
    const def = sets.drafts.get(id) ?? sets.published.get(id);
    if (!def) continue;
    out.push({
      id,
      name: def.name,
      archetype: def.archetype,
      rank: def.rank,
      levelMin: def.levelMin,
      levelMax: def.levelMax,
      abilityCount: def.abilities.length,
      phaseCount: def.phases.length,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  // Level first, then name: the bestiary reads as a progression, which is how
  // NPCS_ENEMIES.md §4 lists it and how an editor thinks about a zone.
  return out.sort((a, b) => a.levelMin - b.levelMin || a.name.localeCompare(b.name));
};

export interface SpawnerListEntry {
  id: string;
  kind: string;
  x: number;
  z: number;
  count: number;
  campTag: string | null;
  hasDraft: boolean;
  hasPublished: boolean;
  def: SpawnerDef;
}

export const listSpawners = async (db: Db): Promise<SpawnerListEntry[]> => {
  const sets = await loadRows(db, contentSpawners, parseSpawner);
  const ids = new Set([...sets.drafts.keys(), ...sets.published.keys()]);
  const out: SpawnerListEntry[] = [];
  for (const id of ids) {
    const def = sets.drafts.get(id) ?? sets.published.get(id);
    if (!def) continue;
    out.push({
      id,
      kind: def.kind,
      x: def.x,
      z: def.z,
      count: def.entries.reduce((sum, entry) => sum + entry.count, 0),
      campTag: def.campTag,
      hasDraft: sets.drafts.has(id),
      hasPublished: sets.published.has(id),
      def,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

// ---------------------------------------------------------------------------
// Draft CRUD
// ---------------------------------------------------------------------------

const saveDraft = async (
  db: Db,
  table: Table,
  id: string,
  def: unknown,
  updatedBy: number,
): Promise<{ pruned: boolean }> => {
  // Prune-on-match: a draft identical to what is already live is not a change,
  // and leaving it there would show a permanent "unpublished" dot. Compare the
  // PARSED defs, never the raw jsonb — Postgres normalises key order, so the
  // raw rows differ even when the content is identical (the A1-c bug).
  const rows = await db.select().from(table).where(eq(table.id, id));
  const live = rows.find((row) => row.status === 'published');
  if (live && JSON.stringify(live.def) === JSON.stringify(def)) {
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

export const saveEnemyDraft = (db: Db, def: EnemyDef, updatedBy: number) =>
  saveDraft(db, contentEnemies, def.id, def, updatedBy);

export const saveSpawnerDraft = (db: Db, def: SpawnerDef, updatedBy: number) =>
  saveDraft(db, contentSpawners, def.id, def, updatedBy);

export const discardEnemyDraft = async (db: Db, kind: 'enemies' | 'spawners', id: string) => {
  const table = kind === 'enemies' ? contentEnemies : contentSpawners;
  await db.delete(table).where(and(eq(table.id, id), eq(table.status, 'draft')));
};

// ---------------------------------------------------------------------------
// Diff + publish
// ---------------------------------------------------------------------------

export interface EnemiesDiff {
  enemies: { id: string; name: string; isNew: boolean }[];
  spawners: { id: string; isNew: boolean }[];
}

export const diffEnemies = async (db: Db): Promise<EnemiesDiff> => {
  const enemySets = await loadRows(db, contentEnemies, parseEnemy);
  const spawnerSets = await loadRows(db, contentSpawners, parseSpawner);
  return {
    enemies: [...enemySets.drafts.entries()].map(([id, def]) => ({
      id,
      name: def.name,
      isNew: !enemySets.published.has(id),
    })),
    spawners: [...spawnerSets.drafts.keys()].map((id) => ({
      id,
      isNew: !spawnerSets.published.has(id),
    })),
  };
};

export interface EnemiesPublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  /** Non-blocking notes ("this boss has no phases") — publish still proceeds. */
  warnings: string[];
  reload: { ok: boolean; note: string };
}

/**
 * Everything that must hold across the whole would-be published set. Exported
 * so the tests (and the editor's pre-flight) run the identical checks.
 */
export const crossCheck = (
  nextEnemies: Map<string, EnemyDef>,
  nextSpawners: Map<string, SpawnerDef>,
  publishedLootTables: Set<string>,
): { problems: string[]; warnings: string[] } => {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const def of nextEnemies.values()) {
    for (const problem of validateEnemyDef(def)) problems.push(`${def.id}: ${problem}`);
    if (def.loot && !publishedLootTables.has(def.loot.tableId)) {
      problems.push(`${def.id}: loot table ${def.loot.tableId} is not published`);
    }
    const isBoss = def.rank === 'zone_boss' || def.rank === 'world_boss';
    if (isBoss && def.phases.length === 0) {
      warnings.push(`${def.id}: a boss with no phases fights like a big grunt (§1)`);
    }
    if (isBoss && def.arenaRadius === 0) {
      warnings.push(`${def.id}: no arenaRadius — this boss can be pulled out of its arena`);
    }
    // A stand-off archetype with nothing to throw walks into melee and flails.
    const motion = ARCHETYPE_MOTION[def.archetype];
    if (motion.band !== null) {
      const hasRanged = def.abilities.some(
        (ability) => ability.kind === 'projectile' || ability.kind === 'ground_circle',
      );
      if (!hasRanged) {
        warnings.push(
          `${def.id}: ${def.archetype} carries no ranged ability, so it will close to melee`,
        );
      }
    }
    if (def.archetype === 'charger' && !def.abilities.some((a) => a.kind === 'charge_rect')) {
      warnings.push(`${def.id}: charger with no charge_rect ability behaves like a grunt`);
    }
    // A clip the rig does not own is SILENT: the swing still lands, it just
    // animates nothing. That shipped once (the P5 Spore Lobber asked a mushnub
    // for `Punch`), and only a screenshot would ever have caught it.
    const absent = missingClips(
      def.modelRef,
      def.abilities.map((ability) => ability.clip),
    );
    if (absent.length > 0) {
      problems.push(
        `${def.id}: ${def.modelRef} has no clip named ${absent.join(', ')} — ` +
          `that attack would animate nothing`,
      );
    }
  }

  for (const spawner of nextSpawners.values()) {
    for (const entry of spawner.entries) {
      if (!nextEnemies.has(entry.enemyId)) {
        problems.push(`${spawner.id}: spawns unknown enemy ${entry.enemyId}`);
      }
    }
  }

  return { problems, warnings };
};

export const publishEnemies = async (db: Db, config: Config): Promise<EnemiesPublishResult> => {
  const enemySets = await loadRows(db, contentEnemies, parseEnemy);
  const spawnerSets = await loadRows(db, contentSpawners, parseSpawner);
  const parseProblems = [...enemySets.problems, ...spawnerSets.problems];
  if (parseProblems.length > 0) {
    return {
      ok: false,
      published: 0,
      problems: parseProblems,
      warnings: [],
      reload: { ok: false, note: '' },
    };
  }

  const draftCount = enemySets.drafts.size + spawnerSets.drafts.size;
  if (draftCount === 0) {
    return {
      ok: false,
      published: 0,
      problems: ['nothing to publish'],
      warnings: [],
      reload: { ok: false, note: '' },
    };
  }

  const nextEnemies = new Map([...enemySets.published, ...enemySets.drafts]);
  const nextSpawners = new Map([...spawnerSets.published, ...spawnerSets.drafts]);
  const lootRows = await db.select().from(contentLootTables);
  const publishedLoot = new Set(
    lootRows.filter((row) => row.status === 'published').map((row) => row.id),
  );

  const { problems, warnings } = crossCheck(nextEnemies, nextSpawners, publishedLoot);
  if (problems.length > 0) {
    return { ok: false, published: 0, problems, warnings, reload: { ok: false, note: '' } };
  }

  await db.transaction(async (tx) => {
    for (const [id, def] of enemySets.drafts) {
      await tx
        .insert(contentEnemies)
        .values({ id, status: 'published', def, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentEnemies.id, contentEnemies.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentEnemies)
        .where(and(eq(contentEnemies.id, id), eq(contentEnemies.status, 'draft')));
    }
    for (const [id, def] of spawnerSets.drafts) {
      await tx
        .insert(contentSpawners)
        .values({ id, status: 'published', def, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentSpawners.id, contentSpawners.status],
          set: { def, updatedAt: new Date() },
        });
      await tx
        .delete(contentSpawners)
        .where(and(eq(contentSpawners.id, id), eq(contentSpawners.status, 'draft')));
    }
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
  return { ok: true, published: draftCount, problems: [], warnings, reload };
};

// ---------------------------------------------------------------------------
// TTK simulator (the A1-d signature tool)
// ---------------------------------------------------------------------------

export interface TtkRequest {
  def: EnemyDef;
  /** The enemy's level within its own band. */
  enemyLevel: number;
  /** The player doing the killing. */
  playerLevel: number;
  /** Their class — decides the attribute spread the HP pool derives from. */
  playerClass: ClassId;
  /** Sustained player DPS against this enemy (the editor's own estimate). */
  playerDps: number;
  /** Distance the fight is held at — decides which abilities are selectable. */
  distance: number;
}

export interface TtkReport {
  enemyHp: number;
  /** Seconds for the player to kill it at `playerDps`. */
  playerKillSeconds: number;
  /** The enemy's own damage per second across the rotation it can actually use. */
  enemyDps: number;
  /** Seconds for the enemy to kill the player. */
  enemyKillSeconds: number;
  /** Player HP the sim assumed (level-derived, no gear). */
  playerHp: number;
  /** What it would actually cast, in weight order, with each one's share. */
  rotation: { id: string; kind: string; sharePct: number; damage: number; cycleMs: number }[];
  notes: string[];
}

/**
 * How long this fight takes, both ways.
 *
 * It walks the SHARED selection gate at each phase the enemy has, weighting by
 * how much of the fight is spent there, so a boss's phase-2 damage spike shows
 * up in the number instead of being averaged away by a phase-1-only estimate.
 * Every input is a content value; nothing here re-implements a formula.
 */
export const simulateTtk = (request: TtkRequest): TtkReport => {
  const { def, enemyLevel, playerLevel, playerDps, distance } = request;
  const notes: string[] = [];
  const stats = enemyStats(enemyLevel, def.archetype, def.rank);
  const enemyHp = def.statOverrides.maxHp ?? stats.maxHp;
  const swing = def.statOverrides.swingDamage ?? stats.swingDamage;

  // The player side: level-derived only. Gear would make this a guess about
  // what the killer is wearing, and the editor's own DPS input already covers
  // offence — this is purely "how long can they stand there".
  const player = playerStats(request.playerClass, playerLevel);
  const playerHp = player.maxHp;

  const rotation: TtkReport['rotation'] = [];
  const ready = selectableEnemyAbilities(def.abilities, {
    distance,
    hpFraction: 1,
    phase: def.phases.length, // the full kit it will EVER have
    onCooldown: () => false,
    spent: () => false,
  });

  if (ready.length === 0) {
    notes.push(
      `nothing in the kit is usable at ${distance} m — the fight would be a stare-down here`,
    );
    return {
      enemyHp,
      playerKillSeconds: playerDps > 0 ? enemyHp / playerDps : Infinity,
      enemyDps: 0,
      enemyKillSeconds: Infinity,
      playerHp,
      rotation,
      notes,
    };
  }

  const totalWeight = ready.reduce((sum, ability) => sum + ability.weight, 0);
  let damagePerCycle = 0;
  let msPerCycle = 0;
  for (const ability of ready) {
    const share = totalWeight > 0 ? ability.weight / totalWeight : 1 / ready.length;
    // One "use" costs its wind-up plus its recovery — that is the real cadence
    // an enemy attacks at, not the cooldown, which only gates re-selection.
    const cycleMs = ability.windupMs + ability.recoverMs;
    const damage = ability.kind === 'self_shield' ? 0 : swing * ability.coef;
    rotation.push({
      id: ability.id,
      kind: ability.kind,
      sharePct: share * 100,
      damage,
      cycleMs,
    });
    damagePerCycle += damage * share;
    msPerCycle += cycleMs * share;
  }

  const enemyDps = msPerCycle > 0 ? damagePerCycle / (msPerCycle / 1000) : 0;
  const playerKillSeconds = playerDps > 0 ? enemyHp / playerDps : Infinity;
  const enemyKillSeconds = enemyDps > 0 ? playerHp / enemyDps : Infinity;

  if (def.rank === 'zone_boss' || def.rank === 'world_boss') {
    // COMBAT.md's boss target is a 60–120 s fight; say so plainly rather than
    // leaving the editor to remember the number.
    if (playerKillSeconds < 60) notes.push(`under the 60 s boss floor (COMBAT.md §12)`);
    if (playerKillSeconds > 120) notes.push(`over the 120 s boss ceiling (COMBAT.md §12)`);
  }
  if (enemyKillSeconds < playerKillSeconds) {
    notes.push('the enemy wins this trade — the player dies first at these numbers');
  }
  // A weighted pick is only meaningful with more than one option.
  if (ready.length === 1) notes.push('single-ability kit: every attack is the same one');

  return {
    enemyHp,
    playerKillSeconds,
    enemyDps,
    enemyKillSeconds,
    playerHp,
    rotation,
    notes,
  };
};

/**
 * Seeded RNG for the preview — the same mixer the loot simulator uses.
 *
 * NOT a plain LCG: `seed = seed * 1103515245 + 12345` has a fine long-run
 * distribution but a badly unrepresentative HEAD from a small seed (from
 * 12345 its first twelve values land 3/12 below 0.6 where 7 are expected).
 * A twelve-pick preview reads exactly that head, so an LCG would show a
 * rotation that contradicts the weight table printed right above it — and an
 * editor would rightly distrust one of the two. mulberry32 mixes the seed
 * before its first output, so a short sequence is representative.
 */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A concrete rotation the enemy WOULD roll, for the editor's "show me" button.
 * Uses the shared weighted pick with a seeded sequence so the preview is
 * reproducible — an editor comparing two tunings needs the same rolls.
 */
export const previewRotation = (def: EnemyDef, distance: number, picks: number): string[] => {
  const ready = selectableEnemyAbilities(def.abilities, {
    distance,
    hpFraction: 1,
    phase: def.phases.length,
    onCooldown: () => false,
    spent: () => false,
  });
  const roll = mulberry32(12345);
  const out: string[] = [];
  for (let i = 0; i < picks; i++) {
    const ability = pickEnemyAbility(ready, roll());
    out.push(ability?.id ?? '—');
  }
  return out;
};
