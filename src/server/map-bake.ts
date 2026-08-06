/**
 * Map validate → bake → publish (A2 · docs/MAP_EDITOR.md §4).
 *
 * The draft store holds what the owner painted; this turns it into the exact
 * artifacts the game reads — the same formats `tools/worldgen` emits, because
 * the editor REPLACES that generator rather than living beside it.
 *
 * Publishing is gated: `validateDraft` runs first and its problems block. The
 * gates are chosen to catch the mistakes that are invisible in the viewport and
 * expensive in the game — content nobody can walk to, a chest with no table, a
 * spawner pointing at an enemy that was renamed, a zone gap where the ambience
 * silently falls back to open ocean.
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  SPLAT_MAP_SIZE,
  WORLD_ORIGIN_M,
  WORLD_SIZE_M,
  WalkClass,
  Walkgrid,
  encodeChunk,
  interactableSchema,
  placementsFileSchema,
  pointInPolygon,
  nodePlacementSchema,
  npcPlacementSchema,
  poiSchema,
  propPlacementSchema,
  resolveScatter,
  scatterSetSchema,
  spawnerDefSchema,
  validateInteractable,
  zoneSchema,
  zonesFileSchema,
  type ScatterSet,
  type Zone,
} from '@dawned/shared';
import {
  DraftSampler,
  scatterPatchSchema,
  type DraftChunk,
  type DraftObject,
} from './map-draft.js';

/** Slope beyond which the walkgrid refuses to let anyone stand (WORLD.md §2). */
const STEEP_DEG = 50;
/** How far above the ground a placement may sit before it reads as floating. */
const FLOAT_TOLERANCE_M = 0.15;
/** …and how far below before it is buried. */
const BURIED_TOLERANCE_M = 0.5;
/** Chunk triangle budget (TECH_STACK.md) — a chunk over this is a red flag. */
const CHUNK_INSTANCE_BUDGET = 900;

export interface BakeProgress {
  step: string;
  done: number;
  total: number;
}

export interface ValidationReport {
  /** Blocks publish. */
  problems: string[];
  /** Reported, does not block. */
  warnings: string[];
  stats: {
    chunks: number;
    props: number;
    scatterPatches: number;
    spawners: number;
    nodes: number;
    npcs: number;
    zones: number;
    pois: number;
    interactables: number;
    floaters: number;
    buried: number;
    unreachable: number;
  };
}

interface DraftBundle {
  chunks: DraftChunk[];
  objects: DraftObject[];
  scatterSets: ScatterSet[];
  seaLevel: number;
  /** Content ids that already exist, for reference checks. */
  knownEnemyIds: Set<string>;
  knownLootTableIds: Set<string>;
  /** Published resource-node definition ids (P10) — placements must resolve. */
  knownNodeIds: Set<string>;
  /** Published NPC definition ids (P11) — same rule, same failure mode. */
  knownNpcIds: Set<string>;
  knownModelRefs: Set<string>;
}

const byLayer = (objects: readonly DraftObject[], layer: string): unknown[] =>
  objects.filter((object) => object.layer === layer).map((object) => object.def);

/**
 * World metre → walkgrid cell. FLOOR, never round: this must be the same cell
 * `Walkgrid.classAt` picks, or the bake reasons about a different metre than the
 * server enforces — half a cell off, which is exactly enough to flood-fill from
 * outside a one-cell-wide corridor and declare a reachable world unreachable.
 */
const cellOf = (worldMetres: number): number => Math.floor(worldMetres - WORLD_ORIGIN_M);

/**
 * Build the walkgrid from the draft. Same rules the game's terrain enforces:
 * water is wade-or-swim, >50° is Steep, unbaked chunks stay Blocked so the
 * swimmable sea ends exactly where the rendered world does.
 *
 * Solid props stamp their footprint Blocked — that is what makes a placed
 * boulder something you walk around rather than through.
 */
const buildWalkgrid = (sampler: DraftSampler, seaLevel: number, solids: SolidFootprint[]) => {
  const grid = Walkgrid.empty(WalkClass.Blocked);
  const enabled = new Set(
    sampler.chunks.filter((chunk) => chunk.enabled).map((chunk) => `${chunk.cx}_${chunk.cy}`),
  );
  for (let iz = 0; iz < WORLD_SIZE_M; iz++) {
    for (let ix = 0; ix < WORLD_SIZE_M; ix++) {
      const cx = Math.floor(ix / CHUNK_SIZE_M);
      const cy = Math.floor(iz / CHUNK_SIZE_M);
      if (!enabled.has(`${cx}_${cy}`)) continue;
      const x = WORLD_ORIGIN_M + ix + 0.5;
      const z = WORLD_ORIGIN_M + iz + 0.5;
      const height = sampler.heightAt(x, z);
      if (height === null) continue;
      const water = sampler.waterLevelAt(x, z, seaLevel) ?? seaLevel;
      const depth = water - height;
      let walkClass: WalkClass;
      if (depth > 0.05) walkClass = WalkClass.Water;
      else if ((sampler.slopeAt(x, z) ?? 0) > STEEP_DEG) walkClass = WalkClass.Steep;
      else walkClass = WalkClass.Walkable;
      grid.setClassAtCell(ix, iz, walkClass);
    }
  }
  for (const solid of solids) {
    const cells = Math.ceil(solid.radius);
    const cx0 = cellOf(solid.x);
    const cz0 = cellOf(solid.z);
    for (let dz = -cells; dz <= cells; dz++) {
      for (let dx = -cells; dx <= cells; dx++) {
        if (dx * dx + dz * dz > solid.radius * solid.radius) continue;
        const ix = cx0 + dx;
        const iz = cz0 + dz;
        if (ix < 0 || iz < 0 || ix >= WORLD_SIZE_M || iz >= WORLD_SIZE_M) continue;
        grid.setClassAtCell(ix, iz, WalkClass.Blocked);
      }
    }
  }
  return grid;
};

interface SolidFootprint {
  x: number;
  z: number;
  radius: number;
}

/**
 * Flood-fill from the spawn across walkable + water cells. Anything a player
 * cannot reach is content nobody will ever see, which MAP_EDITOR.md §4 calls an
 * error rather than a warning — and rightly: it is invisible in the viewport.
 */
const reachableFrom = (
  grid: Walkgrid,
  spawnX: number,
  spawnZ: number,
  /**
   * Portals, as directed edges.
   *
   * A portal is a way to GET somewhere — that is the whole of what it is — so a
   * reachability fill that only walks the walkgrid is wrong about everything
   * behind one. WORLD.md §3.6 makes this concrete: the Elder Grove is an islet
   * with no causeway, reachable by a long swim or "a one-way ancient portal in
   * Ashcrag", and without this every POI, chest and NPC on it is unpublishable
   * — the validator refusing exactly the design the world doc specifies.
   *
   * Consumed to a fixpoint so portals can chain: reaching one seeds its
   * destination, which may put a second portal in range.
   */
  portals: readonly { x: number; z: number; destX: number | null; destZ: number | null }[] = [],
): Uint8Array => {
  const seen = new Uint8Array(WORLD_SIZE_M * WORLD_SIZE_M);
  const startX = cellOf(spawnX);
  const startZ = cellOf(spawnZ);
  if (startX < 0 || startZ < 0 || startX >= WORLD_SIZE_M || startZ >= WORLD_SIZE_M) return seen;
  // Int32Array ring rather than an array of pairs: this visits up to 4 M cells
  // and the allocation churn of the naive version dominates the bake.
  const queue = new Int32Array(WORLD_SIZE_M * WORLD_SIZE_M);
  let head = 0;
  let tail = 0;
  const push = (ix: number, iz: number): void => {
    const index = iz * WORLD_SIZE_M + ix;
    if (seen[index]) return;
    const walkClass = grid.classAtCell(ix, iz);
    if (walkClass === WalkClass.Blocked || walkClass === WalkClass.Steep) return;
    seen[index] = 1;
    queue[tail++] = index;
  };
  const drain = (): void => {
    while (head < tail) {
      const index = queue[head++]!;
      const ix = index % WORLD_SIZE_M;
      const iz = (index / WORLD_SIZE_M) | 0;
      if (ix > 0) push(ix - 1, iz);
      if (ix < WORLD_SIZE_M - 1) push(ix + 1, iz);
      if (iz > 0) push(ix, iz - 1);
      if (iz < WORLD_SIZE_M - 1) push(ix, iz + 1);
    }
  };
  push(startX, startZ);
  drain();

  const pending = portals.filter((portal) => portal.destX !== null && portal.destZ !== null);
  const used = new Set<number>();
  for (;;) {
    let opened = false;
    for (const [index, portal] of pending.entries()) {
      if (used.has(index)) continue;
      // The portal's own mouth has to be walkable-to before it is a way in.
      if (!isReachable(seen, portal.x, portal.z)) continue;
      used.add(index);
      opened = true;
      push(cellOf(portal.destX!), cellOf(portal.destZ!));
      drain();
    }
    if (!opened) break;
  }
  return seen;
};

const isReachable = (seen: Uint8Array, x: number, z: number): boolean => {
  const ix = cellOf(x);
  const iz = cellOf(z);
  if (ix < 0 || iz < 0 || ix >= WORLD_SIZE_M || iz >= WORLD_SIZE_M) return false;
  // A point is reachable if any cell within 3 m is — content sits ON things,
  // and a chest against a wall should not fail because its exact metre is solid.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= WORLD_SIZE_M || nz >= WORLD_SIZE_M) continue;
      if (seen[nz * WORLD_SIZE_M + nx]) return true;
    }
  }
  return false;
};

/**
 * Pick the spawn: the STARTER settlement's centre, else the first walkable
 * metre.
 *
 * "Starter" is the settlement zone with the lowest `levelMin`, ties broken on
 * id. It used to be `zones.find(zone => zone.settlement !== null)` — the first
 * one in the list — which was fine while exactly one zone had a settlement and
 * became a coin flip the moment P12 gave all five of them one: `listObjects`
 * returned Postgres's physical row order, so a new character could have opened
 * their eyes in Rustpick Camp, in the level 24–30 zone, and the only symptom
 * would have been a very short first session.
 *
 * The level band is the right answer rather than a name or a flag because it is
 * already the thing that makes Dawnshore the starter zone.
 */
const findSpawn = (
  sampler: DraftSampler,
  zones: Zone[],
  grid: Walkgrid,
): { x: number; y: number; z: number; yaw: number } | null => {
  const settlement =
    [...zones]
      .filter((zone) => zone.settlement !== null)
      .sort((a, b) => a.levelMin - b.levelMin || a.id.localeCompare(b.id))[0] ?? zones[0];
  const candidates: { x: number; z: number }[] = [];
  if (settlement) {
    let sumX = 0;
    let sumZ = 0;
    for (const [x, z] of settlement.polygon) {
      sumX += x;
      sumZ += z;
    }
    candidates.push({
      x: sumX / settlement.polygon.length,
      z: sumZ / settlement.polygon.length,
    });
  }
  // Spiral out from the candidate until a walkable metre turns up.
  for (const candidate of candidates) {
    for (let r = 0; r < 120; r += 2) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = candidate.x + Math.cos(angle) * r;
        const z = candidate.z + Math.sin(angle) * r;
        if (!grid.walkableAt(x, z)) continue;
        const y = sampler.heightAt(x, z);
        if (y === null) continue;
        return { x, y, z, yaw: 0 };
      }
    }
  }
  for (const chunk of sampler.chunks) {
    if (!chunk.enabled) continue;
    for (let iz = 0; iz < CHUNK_VERTS; iz += 8) {
      for (let ix = 0; ix < CHUNK_VERTS; ix += 8) {
        const x = WORLD_ORIGIN_M + chunk.cx * CHUNK_SIZE_M + ix;
        const z = WORLD_ORIGIN_M + chunk.cy * CHUNK_SIZE_M + iz;
        if (!grid.walkableAt(x, z)) continue;
        const y = sampler.heightAt(x, z);
        if (y !== null) return { x, y, z, yaw: 0 };
      }
    }
  }
  return null;
};

/**
 * Validate the draft. Problems block publish; warnings are judgement calls the
 * owner may legitimately want (an unreachable vista on a mountain top might be
 * intentional scenery, so it warns rather than blocks — but a POI you cannot
 * discover is dead content and blocks).
 */
/**
 * Zone priority: the SMALLEST zone containing a point wins.
 *
 * `zoneAt` returns the first polygon that contains the point, so the order this
 * list is emitted in decides which zone a player is standing in — and until
 * P12 that never mattered, because no two zones overlapped. The Dawnsea does:
 * WORLD.md §2 lists it as the ocean, the beaches and the sandbars, so its ring
 * covers the whole map and every land point is inside two zones.
 *
 * Sorting by polygon area ascending makes "the more specific zone wins" a
 * property of the data rather than of the row order Postgres happened to
 * return. A containing zone is always the larger one, so the sea can never
 * shadow an isle; two land zones that clip at their edges get an arbitrary but
 * STABLE answer, which is the part that matters — the alternative was a world
 * that could rename Dawnshore to "The Dawnsea" between two publishes of an
 * unchanged draft.
 *
 * Ties break on id so the order is total.
 */
export const orderZones = <
  T extends { id: string; polygon: readonly (readonly [number, number])[] },
>(
  zones: T[],
): T[] => {
  const area = (polygon: readonly (readonly [number, number])[]): number => {
    let sum = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i]!;
      const [xj, zj] = polygon[j]!;
      sum += xj * zi - xi * zj;
    }
    return Math.abs(sum) / 2;
  };
  return [...zones].sort((a, b) => area(a.polygon) - area(b.polygon) || a.id.localeCompare(b.id));
};

export const validateDraft = (bundle: DraftBundle): ValidationReport => {
  const problems: string[] = [];
  const warnings: string[] = [];
  const sampler = new DraftSampler(bundle.chunks);
  const enabled = bundle.chunks.filter((chunk) => chunk.enabled);

  const props = byLayer(bundle.objects, 'prop').map((def) => propPlacementSchema.parse(def));
  const zones = orderZones(byLayer(bundle.objects, 'zone').map((def) => zoneSchema.parse(def)));
  const pois = byLayer(bundle.objects, 'poi').map((def) => poiSchema.parse(def));
  const interactables = byLayer(bundle.objects, 'interactable').map((def) =>
    interactableSchema.parse(def),
  );
  const spawners = byLayer(bundle.objects, 'spawner').map((def) => spawnerDefSchema.parse(def));
  const scatterPatches = bundle.objects.filter((object) => object.layer === 'scatter');
  const nodes = bundle.objects.filter((object) => object.layer === 'node');
  const npcs = bundle.objects.filter((object) => object.layer === 'npc');

  if (enabled.length === 0) problems.push('no chunks are enabled — there is no world to publish');

  // --- zones ---------------------------------------------------------------
  if (zones.length === 0) {
    problems.push('no zones: every land point must belong to exactly one zone');
  }
  // Sample the enabled land on a 16 m lattice; a gap means ambience silently
  // falls back to open ocean, which reads as a bug in-game.
  let uncovered = 0;
  let overlapping = 0;
  let sampled = 0;
  for (const chunk of enabled) {
    for (let iz = 0; iz < CHUNK_SIZE_M; iz += 16) {
      for (let ix = 0; ix < CHUNK_SIZE_M; ix += 16) {
        const x = WORLD_ORIGIN_M + chunk.cx * CHUNK_SIZE_M + ix;
        const z = WORLD_ORIGIN_M + chunk.cy * CHUNK_SIZE_M + iz;
        const height = sampler.heightAt(x, z);
        if (height === null || height < bundle.seaLevel) continue; // sea needs no zone
        sampled++;
        const hits = zones.filter((zone) => pointInPolygon(x, z, zone.polygon)).length;
        if (hits === 0) uncovered++;
        else if (hits > 1) overlapping++;
      }
    }
  }
  if (uncovered > 0) {
    problems.push(
      `${uncovered} of ${sampled} sampled land points are in no zone — ` +
        'they would fall back to the open-ocean ambience',
    );
  }
  if (overlapping > 0) {
    warnings.push(
      `${overlapping} sampled land points are inside more than one zone ` +
        '(authoring order decides, which is easy to forget)',
    );
  }
  for (const zone of zones) {
    if (zone.levelMax < zone.levelMin) {
      problems.push(
        `zone ${zone.id}: levelMax ${zone.levelMax} is below levelMin ${zone.levelMin}`,
      );
    }
  }

  // --- placements sit on the ground ---------------------------------------
  let floaters = 0;
  let buried = 0;
  for (const prop of props) {
    const ground = sampler.heightAt(prop.x, prop.z);
    if (ground === null) {
      problems.push(`prop ${prop.id} stands on a disabled chunk (it would fall into the sea)`);
      continue;
    }
    if (prop.yOffset > FLOAT_TOLERANCE_M) floaters++;
    if (prop.yOffset < -BURIED_TOLERANCE_M) buried++;
    if (!bundle.knownModelRefs.has(prop.modelRef)) {
      problems.push(`prop ${prop.id}: model "${prop.modelRef}" is not in the baked asset manifest`);
    }
  }
  if (floaters > 0) warnings.push(`${floaters} prop(s) float above the ground`);
  if (buried > 0) warnings.push(`${buried} prop(s) are buried in it`);

  // --- interactables -------------------------------------------------------
  for (const row of interactables) {
    problems.push(...validateInteractable(row));
    if (row.lootTableId && !bundle.knownLootTableIds.has(row.lootTableId)) {
      problems.push(`${row.id}: loot table "${row.lootTableId}" is not published`);
    }
    if (!bundle.knownModelRefs.has(row.modelRef)) {
      problems.push(`${row.id}: model "${row.modelRef}" is not in the baked asset manifest`);
    }
  }

  // --- resource nodes (P10) ------------------------------------------------
  // A placement is thin: an id, a definition and a spot. Everything worth
  // checking is therefore about the definition RESOLVING — a birch pointing at
  // a node row someone renamed is a tree nobody can chop, and invisible in the
  // viewport because the marker draws either way.
  /** nodeId → zone id → how many of its placements stand there. */
  const nodeZones = new Map<string, Map<string, number>>();
  for (const object of nodes) {
    const row = nodePlacementSchema.safeParse(object.def);
    if (!row.success) {
      problems.push(`node ${object.id}: ${row.error.issues[0]?.message ?? 'invalid'}`);
      continue;
    }
    if (!bundle.knownNodeIds.has(row.data.nodeId)) {
      problems.push(`node ${row.data.id}: "${row.data.nodeId}" is not a published resource node`);
    }
    if (sampler.heightAt(row.data.x, row.data.z) === null) {
      problems.push(`node ${row.data.id} sits on a disabled chunk`);
    }
    const home = zones.find((zone) => pointInPolygon(row.data.x, row.data.z, zone.polygon));
    const seen = nodeZones.get(row.data.nodeId) ?? new Map<string, number>();
    const key = home?.id ?? 'no zone';
    seen.set(key, (seen.get(key) ?? 0) + 1);
    nodeZones.set(row.data.nodeId, seen);
  }
  // A definition belongs to a place: PROFESSIONS §4 gives every zone a tier
  // band, so a vein one zone over is a T5 material standing in the T4 savanna
  // where nobody is gated from it. The definition carries a tier and no zone,
  // so the panel cannot check it against a design mapping without inventing
  // one — but it can check the data against ITSELF: placements of one node id
  // that are mostly in one zone and partly in another are strays, which is
  // exactly what a cluster scattered across a border produces.
  //
  // Found by game P12-E: 39 of 322 land nodes stood outside the zone they were
  // authored for, including 4 of the 12 Dawnpetal — the bloom the Elder Grove
  // exists for — growing in Emberwood. A warning rather than a block, for the
  // same reason `questHintCoverage` warns: a material that genuinely grows in
  // two regions is a design choice, and 5 of 19 across a line is not.
  for (const [nodeId, spread] of nodeZones) {
    if (spread.size < 2) continue;
    const ranked = [...spread].sort((a, b) => b[1] - a[1]);
    const [home, ...strays] = ranked;
    const stray = strays.reduce((sum, [, count]) => sum + count, 0);
    const total = stray + (home?.[1] ?? 0);
    warnings.push(
      `node ${nodeId}: ${stray} of ${total} placements stand outside ${home?.[0]} ` +
        `(${strays.map(([zone, count]) => `${count} in ${zone}`).join(', ')})`,
    );
  }

  // --- NPCs (P11) ----------------------------------------------------------
  // Identical rule to resource nodes, for an identical reason: the placement is
  // thin, the marker draws whatever the definition says, and a villager whose
  // row was renamed is simply not there in-game — silent in the viewport, and
  // silent in the diff.
  for (const object of npcs) {
    const row = npcPlacementSchema.safeParse(object.def);
    if (!row.success) {
      problems.push(`npc ${object.id}: ${row.error.issues[0]?.message ?? 'invalid'}`);
      continue;
    }
    if (!bundle.knownNpcIds.has(row.data.npcId)) {
      problems.push(`npc ${row.data.id}: "${row.data.npcId}" is not a published NPC`);
    }
    if (sampler.heightAt(row.data.x, row.data.z) === null) {
      problems.push(`npc ${row.data.id} sits on a disabled chunk`);
    }
  }

  // --- spawners ------------------------------------------------------------
  for (const spawner of spawners) {
    for (const entry of spawner.entries) {
      if (!bundle.knownEnemyIds.has(entry.enemyId)) {
        problems.push(`spawner ${spawner.id}: enemy "${entry.enemyId}" is not published`);
      }
    }
    if (sampler.heightAt(spawner.x, spawner.z) === null) {
      problems.push(`spawner ${spawner.id} sits on a disabled chunk`);
    }
    const zone = zones.find((z) => pointInPolygon(spawner.x, spawner.z, z.polygon));
    if (zone?.safe) {
      problems.push(`spawner ${spawner.id} is inside the safe zone "${zone.id}"`);
    }
  }

  // --- scatter -------------------------------------------------------------
  const setIds = new Set(bundle.scatterSets.map((set) => set.id));
  for (const patch of scatterPatches) {
    const def = patch.def as { setId: string };
    if (!setIds.has(def.setId)) {
      problems.push(`scatter patch ${patch.id}: set "${def.setId}" no longer exists`);
    }
  }

  // --- reachability + budgets ---------------------------------------------
  const solids: SolidFootprint[] = props
    .filter((prop) => prop.solid && prop.radius > 0)
    .map((prop) => ({ x: prop.x, z: prop.z, radius: prop.radius }));
  const grid = buildWalkgrid(sampler, bundle.seaLevel, solids);
  const spawn = findSpawn(sampler, zones, grid);
  let unreachable = 0;
  if (!spawn) {
    problems.push('no walkable spawn point could be found — the world cannot be entered');
  } else {
    const seen = reachableFrom(
      grid,
      spawn.x,
      spawn.z,
      interactables.filter((row) => row.kind === 'portal'),
    );
    for (const poi of pois) {
      if (!isReachable(seen, poi.x, poi.z)) {
        unreachable++;
        problems.push(`POI ${poi.id} cannot be walked to from the spawn`);
      }
    }
    for (const row of interactables) {
      if (!isReachable(seen, row.x, row.z)) {
        unreachable++;
        problems.push(`${row.kind} ${row.id} cannot be walked to from the spawn`);
      }
    }
    for (const spawner of spawners) {
      if (!isReachable(seen, spawner.x, spawner.z)) {
        unreachable++;
        warnings.push(`spawner ${spawner.id} is in an unreachable pocket`);
      }
    }
  }

  // Per-chunk instance budget: props + resolved scatter.
  const perChunk = new Map<string, number>();
  const bump = (x: number, z: number, n = 1): void => {
    const key = `${Math.floor((x - WORLD_ORIGIN_M) / CHUNK_SIZE_M)}_${Math.floor((z - WORLD_ORIGIN_M) / CHUNK_SIZE_M)}`;
    perChunk.set(key, (perChunk.get(key) ?? 0) + n);
  };
  for (const prop of props) bump(prop.x, prop.z);
  for (const patch of scatterPatches) {
    const def = patch.def as { cx: number; cy: number; setId: string; density: number[] };
    const set = bundle.scatterSets.find((candidate) => candidate.id === def.setId);
    if (!set) continue;
    const originX = WORLD_ORIGIN_M + def.cx * CHUNK_SIZE_M;
    const originZ = WORLD_ORIGIN_M + def.cy * CHUNK_SIZE_M;
    const count = resolveScatter(set, def.cx, def.cy, def.density, originX, originZ, (x, z) =>
      sampler.probe(x, z),
    ).length;
    perChunk.set(`${def.cx}_${def.cy}`, (perChunk.get(`${def.cx}_${def.cy}`) ?? 0) + count);
  }
  for (const [key, count] of perChunk) {
    if (count > CHUNK_INSTANCE_BUDGET) {
      warnings.push(`chunk ${key} holds ${count} instances (budget ${CHUNK_INSTANCE_BUDGET})`);
    }
  }

  return {
    problems,
    warnings,
    stats: {
      chunks: enabled.length,
      props: props.length,
      scatterPatches: scatterPatches.length,
      spawners: spawners.length,
      nodes: nodes.length,
      npcs: npcs.length,
      zones: zones.length,
      pois: pois.length,
      interactables: interactables.length,
      floaters,
      buried,
      unreachable,
    },
  };
};

/**
 * Render the world map (WORLD.md §5): a top-down colour pass over the baked
 * heights. Drawn from the SAME heights the chunks carry, so the map and the
 * ground can never show different coastlines.
 */
const renderWorldmap = (sampler: DraftSampler, seaLevel: number, size = 1024) => {
  const pixels = Buffer.alloc(size * size * 3);
  const metresPerPixel = WORLD_SIZE_M / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = WORLD_ORIGIN_M + (px + 0.5) * metresPerPixel;
      const z = WORLD_ORIGIN_M + (py + 0.5) * metresPerPixel;
      const height = sampler.heightAt(x, z);
      const offset = (py * size + px) * 3;
      if (height === null) {
        // Open ocean.
        pixels[offset] = 26;
        pixels[offset + 1] = 58;
        pixels[offset + 2] = 92;
        continue;
      }
      const water = sampler.waterLevelAt(x, z, seaLevel) ?? seaLevel;
      if (height < water) {
        const depth = Math.min(1, (water - height) / 8);
        pixels[offset] = Math.round(60 - depth * 34);
        pixels[offset + 1] = Math.round(120 - depth * 62);
        pixels[offset + 2] = Math.round(170 - depth * 78);
        continue;
      }
      const slope = sampler.slopeAt(x, z) ?? 0;
      const alpine = Math.min(1, Math.max(0, (height - 22) / 26));
      const rock = Math.min(1, Math.max(0, (slope - 34) / 24));
      const shore = Math.min(1, Math.max(0, 1 - (height - water) / 1.6));
      let r = 96 + alpine * 110 + rock * 60;
      let g = 132 + alpine * 100 - rock * 20;
      let b = 78 + alpine * 96 + rock * 40;
      r = r * (1 - shore) + 214 * shore;
      g = g * (1 - shore) + 196 * shore;
      b = b * (1 - shore) + 148 * shore;
      pixels[offset] = Math.max(0, Math.min(255, Math.round(r)));
      pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } });
};

export interface BakeResult {
  version: string;
  chunksEmitted: number;
  props: number;
  scatterInstances: number;
  bytes: number;
  ms: number;
  warnings: string[];
}

/**
 * Bake the draft into `<mapDir>/<version>/`. Writes to a `.tmp` sibling and
 * renames at the end: a bake that dies halfway must never leave the game
 * reading a half-written map version.
 */
export const bakeDraft = async (
  bundle: DraftBundle,
  mapDir: string,
  version: string,
  onProgress: (progress: BakeProgress) => void = () => undefined,
): Promise<BakeResult> => {
  const startedAt = Date.now();
  const sampler = new DraftSampler(bundle.chunks);
  const enabled = bundle.chunks.filter((chunk) => chunk.enabled);
  const warnings: string[] = [];
  const bytes = 0;

  const finalDir = path.join(mapDir, version);
  const stageDir = `${finalDir}.tmp`;
  // Not being able to prepare the staging directory is a DEPLOYMENT fault, not
  // a content one, and the raw errno is actively misleading about it: on the VPS
  // the panel runs under `ProtectSystem=strict`, which makes everything outside
  // `ReadWritePaths` read-only, and a recursive mkdir into a read-only tree
  // reports ENOENT naming a path whose parents plainly exist. That cost an hour
  // the first time a world was deployed (P12-H). Say what it actually means.
  try {
    await rm(stageDir, { recursive: true, force: true });
    await mkdir(path.join(stageDir, 'minimap_tiles'), { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(
      `cannot create the bake staging directory in MAP_DIR (${mapDir}): ${code}. ` +
        `The directory must exist and be writable by the panel's user. On a systemd box ` +
        `that also means MAP_DIR has to be listed in dawned-admin.service's ReadWritePaths — ` +
        `ProtectSystem=strict makes everything else read-only, and reports it as ENOENT. ` +
        `See the game repo's docs/tech/DEPLOYMENT.md §5.1.`,
      { cause: error },
    );
  }

  try {
    return await bakeInto(stageDir, finalDir, {
      bundle,
      version,
      onProgress,
      sampler,
      enabled,
      warnings,
      bytes,
      startedAt,
    });
  } catch (error) {
    // A failed bake used to leave its staging directory behind for ever —
    // three of them accumulated in one afternoon, each a full copy of the map's
    // chunk bins. The half-written stage is worthless the moment the bake
    // throws; the LIVE bake is untouched either way, because `current.json`
    // only moves after the rename.
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

interface BakeState {
  bundle: DraftBundle;
  version: string;
  onProgress: (progress: BakeProgress) => void;
  sampler: DraftSampler;
  enabled: DraftChunk[];
  warnings: string[];
  bytes: number;
  startedAt: number;
}

const bakeInto = async (
  stageDir: string,
  finalDir: string,
  state: BakeState,
): Promise<BakeResult> => {
  const { bundle, version, onProgress, sampler, enabled, warnings, startedAt } = state;
  let { bytes } = state;

  // --- chunks --------------------------------------------------------------
  onProgress({ step: 'chunks', done: 0, total: enabled.length });
  const ids: string[] = [];
  for (const [index, chunk] of enabled.entries()) {
    const encoded = encodeChunk({
      cx: chunk.cx,
      cy: chunk.cy,
      waterLevel: chunk.waterLevel,
      heights: chunk.heights,
      splat: chunk.splat,
    });
    const name = `chunk_${chunk.cx}_${chunk.cy}.bin`;
    await writeFile(path.join(stageDir, name), encoded);
    bytes += encoded.byteLength;
    ids.push(`${chunk.cx}_${chunk.cy}`);
    if (index % 8 === 0 || index === enabled.length - 1) {
      onProgress({ step: 'chunks', done: index + 1, total: enabled.length });
    }
  }

  // --- walkgrid ------------------------------------------------------------
  onProgress({ step: 'walkgrid', done: 0, total: 1 });
  const props = byLayer(bundle.objects, 'prop').map((def) => propPlacementSchema.parse(def));
  const solids: SolidFootprint[] = props
    .filter((prop) => prop.solid && prop.radius > 0)
    .map((prop) => ({ x: prop.x, z: prop.z, radius: prop.radius }));
  const grid = buildWalkgrid(sampler, bundle.seaLevel, solids);
  const walkgrid = grid.encode();
  await writeFile(path.join(stageDir, 'walkgrid.bin'), walkgrid);
  bytes += walkgrid.byteLength;
  onProgress({ step: 'walkgrid', done: 1, total: 1 });

  // --- zones ---------------------------------------------------------------
  onProgress({ step: 'zones', done: 0, total: 1 });
  const zones = orderZones(byLayer(bundle.objects, 'zone').map((def) => zoneSchema.parse(def)));
  const zonesFile = zonesFileSchema.parse({
    defaultAmbience: DEFAULT_OCEAN_AMBIENCE,
    zones,
  });
  const zonesJson = JSON.stringify(zonesFile);
  await writeFile(path.join(stageDir, 'zones.json'), zonesJson);
  bytes += Buffer.byteLength(zonesJson);
  onProgress({ step: 'zones', done: 1, total: 1 });

  // --- placements ----------------------------------------------------------
  const scatterPatches = bundle.objects.filter((object) => object.layer === 'scatter');
  onProgress({ step: 'placements', done: 0, total: scatterPatches.length + 1 });
  let scatterInstances = 0;
  const scatter: { cx: number; cy: number; setId: string; density: number[] }[] = [];
  for (const [index, patch] of scatterPatches.entries()) {
    // The DRAFT row carries an `id` (it is a row key); the baked format is keyed
    // by (cx, cy, setId) and is strict, so the row has to be projected, not
    // handed over. This used to be a cast, which type-checked and then threw
    // inside `placementsFileSchema.parse` at bake time — every publish with a
    // painted forest in it died between `zones` and `placements`.
    const row = scatterPatchSchema.parse(patch.def);
    const def = { cx: row.cx, cy: row.cy, setId: row.setId, density: row.density };
    scatter.push(def);
    const set = bundle.scatterSets.find((candidate) => candidate.id === def.setId);
    if (set) {
      scatterInstances += resolveScatter(
        set,
        def.cx,
        def.cy,
        def.density,
        WORLD_ORIGIN_M + def.cx * CHUNK_SIZE_M,
        WORLD_ORIGIN_M + def.cy * CHUNK_SIZE_M,
        (x, z) => sampler.probe(x, z),
      ).length;
    }
    onProgress({ step: 'placements', done: index + 1, total: scatterPatches.length + 1 });
  }
  // Re-sit every ground placement on the CURRENT terrain: a prop authored
  // before a sculpt must not ship hanging in the air.
  const placements = placementsFileSchema.parse({
    props: props.map((prop) => ({ ...prop })),
    scatterSets: bundle.scatterSets,
    scatter,
    pois: byLayer(bundle.objects, 'poi').map((def) => poiSchema.parse(def)),
    interactables: byLayer(bundle.objects, 'interactable').map((def) =>
      interactableSchema.parse(def),
    ),
    // Nodes are PARSED into the baked shape, never cast. The scatter layer
    // taught this lesson the expensive way (A2/A3-e): a draft row that merely
    // looks right type-checks and then throws inside a `.strict()` schema half
    // way through a publish, with nothing on screen to say why.
    nodes: byLayer(bundle.objects, 'node').map((def) => nodePlacementSchema.parse(def)),
    npcs: byLayer(bundle.objects, 'npc').map((def) => npcPlacementSchema.parse(def)),
  });
  const placementsJson = JSON.stringify(placements);
  await writeFile(path.join(stageDir, 'placements.json'), placementsJson);
  bytes += Buffer.byteLength(placementsJson);

  // --- meta ----------------------------------------------------------------
  const spawn = findSpawn(sampler, zones, grid) ?? { x: 0, y: 0, z: 0, yaw: 0 };
  const meta = {
    mapVersion: version,
    spawn,
    seaLevel: bundle.seaLevel,
    chunks: { emitted: enabled.length, ids },
  };
  const metaJson = JSON.stringify(meta);
  await writeFile(path.join(stageDir, 'meta.json'), metaJson);
  bytes += Buffer.byteLength(metaJson);

  // --- renders -------------------------------------------------------------
  onProgress({ step: 'renders', done: 0, total: 2 });
  const worldmap = renderWorldmap(sampler, bundle.seaLevel);
  await worldmap.clone().png({ compressionLevel: 9 }).toFile(path.join(stageDir, 'worldmap.png'));
  onProgress({ step: 'renders', done: 1, total: 2 });
  await worldmap
    .clone()
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(path.join(stageDir, 'minimap_tiles', '0_0.png'));
  onProgress({ step: 'renders', done: 2, total: 2 });

  // --- swap in -------------------------------------------------------------
  await rm(finalDir, { recursive: true, force: true });
  await rename(stageDir, finalDir);

  if (enabled.length === 0) warnings.push('no chunks were emitted — the world is empty');
  return {
    version,
    chunksEmitted: enabled.length,
    props: props.length,
    scatterInstances,
    bytes,
    ms: Date.now() - startedAt,
    warnings,
  };
};

/**
 * Ambience outside every polygon. Open ocean is not a zone anyone authors, so
 * it lives here rather than as a row the owner could delete by accident.
 */
const DEFAULT_OCEAN_AMBIENCE = {
  fogColor: '#f4b98d',
  fogNear: 90,
  fogFar: 520,
  skyTop: '#5a6fc0',
  skyHorizon: '#ffb37a',
  sunColor: '#ffe3bb',
  sunIntensity: 2.2,
  hemiSky: '#dce8ff',
  hemiGround: '#3a4a3a',
  hemiIntensity: 0.8,
};

export type { DraftBundle };
export { buildWalkgrid, findSpawn, reachableFrom, isReachable, renderWorldmap };
export { CHUNK_INSTANCE_BUDGET, FLOAT_TOLERANCE_M, BURIED_TOLERANCE_M, STEEP_DEG };
export { SPLAT_MAP_SIZE };
export { scatterSetSchema };
