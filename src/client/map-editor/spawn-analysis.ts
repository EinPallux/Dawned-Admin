/**
 * Spawn analysis (A3-b · MAP_EDITOR.md §2.3).
 *
 * The overlays and the budget meter that make a spawner layout judgeable:
 * how many enemies a zone actually holds, where they cluster, which camps
 * share a tag, and whether the total is anywhere near the CONTENT_0.1 target.
 *
 * All derived from data that ALREADY drives the game — `campTag` is what the
 * server groups social aggro by, `aggroRadius`/`leashRadius` are what the AI
 * pulls and leashes with. Nothing here invents a field the game would ignore.
 *
 * ## What is deliberately NOT here
 *
 * **Patrol splines.** MAP_EDITOR.md §2.3 asks for them, and they need a field
 * on `spawnerDefSchema` plus AI that walks it. The AI does not, so authoring
 * the path would put data in the database that nothing reads — a placeholder
 * by another name (project rule 1). It is tracked as a game-side slice instead.
 */

import { pointInPolygon, type SpawnerDef } from '@dawned/shared';

export interface EnemyFacts {
  id: string;
  name: string;
  rank: string;
  aggroRadius: number;
  leashRadius: number;
}

export interface ZoneFacts {
  id: string;
  name: string;
  polygon: readonly (readonly [number, number])[];
}

export interface ZonePopulation {
  zoneId: string;
  zoneName: string;
  /** Spawners whose origin falls inside the polygon. */
  spawners: number;
  /** Enemies standing at once if every entry is at full count. */
  enemies: number;
  /** Distinct camp tags — how many social-aggro groups the zone holds. */
  camps: number;
  /** Ranks present, for "is this zone all trash?" at a glance. */
  ranks: Record<string, number>;
}

/**
 * Enemies a spawner puts in the world at once: the sum of its entry counts.
 * Not a guess — this is exactly what `populateFromSpawners` loops over.
 */
export const spawnerHeadcount = (spawner: SpawnerDef): number =>
  spawner.entries.reduce((sum, entry) => sum + entry.count, 0);

/** Population per zone, for the budget meter. Spawners in NO zone are reported
 * separately by the caller — that is a real authoring mistake, not a rounding
 * error, and publish already blocks on land outside every polygon. */
export const populationByZone = (
  spawners: readonly SpawnerDef[],
  zones: readonly ZoneFacts[],
  enemiesById: ReadonlyMap<string, EnemyFacts>,
): { zones: ZonePopulation[]; unzoned: number } => {
  const byZone = new Map<string, ZonePopulation>();
  for (const zone of zones) {
    byZone.set(zone.id, {
      zoneId: zone.id,
      zoneName: zone.name,
      spawners: 0,
      enemies: 0,
      camps: 0,
      ranks: {},
    });
  }
  const campsPerZone = new Map<string, Set<string>>();
  let unzoned = 0;

  for (const spawner of spawners) {
    const zone = zones.find((candidate) => pointInPolygon(spawner.x, spawner.z, candidate.polygon));
    if (!zone) {
      unzoned++;
      continue;
    }
    const row = byZone.get(zone.id);
    if (!row) continue;
    row.spawners++;
    row.enemies += spawnerHeadcount(spawner);
    if (spawner.campTag) {
      const camps = campsPerZone.get(zone.id) ?? new Set<string>();
      camps.add(spawner.campTag);
      campsPerZone.set(zone.id, camps);
    }
    for (const entry of spawner.entries) {
      const rank = enemiesById.get(entry.enemyId)?.rank ?? 'unknown';
      row.ranks[rank] = (row.ranks[rank] ?? 0) + entry.count;
    }
  }
  for (const [zoneId, camps] of campsPerZone) {
    const row = byZone.get(zoneId);
    if (row) row.camps = camps.size;
  }
  return { zones: [...byZone.values()], unzoned };
};

/**
 * Spawners sharing a camp tag, with the spread of each group.
 *
 * The spread is the point: a camp tag is what makes one pull bring the whole
 * group, and tagging two spawners 200 m apart means a player aggros something
 * they cannot see. The server's social-aggro radius is what actually decides
 * that, so a wide group is a warning rather than an error — but it is exactly
 * the mistake that is invisible in a list and obvious on a map.
 */
export interface CampLink {
  tag: string;
  spawnerIds: string[];
  /** Metres between the two furthest members. */
  spreadM: number;
  centre: { x: number; z: number };
}

export const campLinks = (spawners: readonly SpawnerDef[]): CampLink[] => {
  const groups = new Map<string, SpawnerDef[]>();
  for (const spawner of spawners) {
    if (!spawner.campTag) continue;
    const group = groups.get(spawner.campTag) ?? [];
    group.push(spawner);
    groups.set(spawner.campTag, group);
  }
  const links: CampLink[] = [];
  for (const [tag, group] of groups) {
    let spread = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        spread = Math.max(spread, Math.hypot(group[i]!.x - group[j]!.x, group[i]!.z - group[j]!.z));
      }
    }
    links.push({
      tag,
      spawnerIds: group.map((spawner) => spawner.id),
      spreadM: Math.round(spread),
      centre: {
        x: group.reduce((sum, spawner) => sum + spawner.x / group.length, 0),
        z: group.reduce((sum, spawner) => sum + spawner.z / group.length, 0),
      },
    });
  }
  return links.sort((a, b) => b.spreadM - a.spreadM);
};

/**
 * Overlapping aggro: pairs of spawners close enough that walking to one pulls
 * the other. Uses the enemies' OWN `aggroRadius` — the number the AI perceives
 * with — plus the spawn radii, because an area spawner scatters.
 *
 * Reported, never blocked. Two camps that bleed into each other is sometimes
 * exactly what you want (P9-C shipped two deliberately mixed camps); the point
 * is that it should be a decision rather than a surprise.
 */
export interface AggroOverlap {
  a: string;
  b: string;
  /** How far the two pull envelopes overlap, metres. */
  overlapM: number;
}

export const aggroOverlaps = (
  spawners: readonly SpawnerDef[],
  enemiesById: ReadonlyMap<string, EnemyFacts>,
): AggroOverlap[] => {
  const reachOf = (spawner: SpawnerDef): number => {
    let widest = 0;
    for (const entry of spawner.entries) {
      widest = Math.max(widest, enemiesById.get(entry.enemyId)?.aggroRadius ?? 10);
    }
    return spawner.radius + widest;
  };
  const out: AggroOverlap[] = [];
  for (let i = 0; i < spawners.length; i++) {
    for (let j = i + 1; j < spawners.length; j++) {
      const a = spawners[i]!;
      const b = spawners[j]!;
      // Same camp on purpose: they are MEANT to pull together.
      if (a.campTag && a.campTag === b.campTag) continue;
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      const overlap = reachOf(a) + reachOf(b) - distance;
      if (overlap > 0) out.push({ a: a.id, b: b.id, overlapM: Math.round(overlap) });
    }
  }
  return out.sort((first, second) => second.overlapM - first.overlapM);
};

/**
 * "Simulate populate": one resolution of what a spawner would actually put on
 * the ground, using the same uniform-in-disc scatter the server spawns with.
 *
 * Deterministic from a seed so the owner can eyeball a camp composition and
 * then eyeball the same one again after changing a count — a preview that
 * reshuffles every frame tells you nothing about the change you just made.
 */
export interface SimulatedSpawn {
  enemyId: string;
  x: number;
  z: number;
}

export const simulatePopulate = (
  spawner: SpawnerDef,
  seed: number,
  enemiesById: ReadonlyMap<string, EnemyFacts>,
): SimulatedSpawn[] => {
  let state = (seed ^ hashString(spawner.id)) >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: SimulatedSpawn[] = [];
  for (const entry of spawner.entries) {
    if (!enemiesById.has(entry.enemyId)) continue;
    for (let i = 0; i < entry.count; i++) {
      // sqrt() keeps the scatter uniform over AREA; without it everything
      // bunches at the middle and a 20 m camp previews as a 6 m huddle.
      const angle = random() * Math.PI * 2;
      const distance = spawner.kind === 'point' ? 0 : Math.sqrt(random()) * spawner.radius;
      out.push({
        enemyId: entry.enemyId,
        x: spawner.x + Math.cos(angle) * distance,
        z: spawner.z + Math.sin(angle) * distance,
      });
    }
  }
  return out;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
