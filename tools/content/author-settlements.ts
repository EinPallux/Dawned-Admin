#!/usr/bin/env tsx
/**
 * Put the settlements, shrines and bridge dressing on the new world
 * (game P12-B), through the panel's own endpoints.
 *
 * Order matters:
 *  1. **Prune what drowned.** P12-A replaced every metre of terrain, so the
 *     P8–P11 placements stand on chunks that are now open sea. Rather than
 *     clearing layers — `prop`, `interactable` and `poi` are SHARED with the
 *     owner's own hand placement, and clearing them would delete their work —
 *     this asks `validateDraft` which rows are on a disabled chunk and removes
 *     exactly those. The validator is already the authority on that; a second
 *     opinion here could only disagree with it.
 *  2. **Buildings**, upserted by id. Each settlement's rows are
 *     `bld_<town>_<n>`, so a re-run replaces its own and touches nothing else.
 *  3. **Shrines**, upserted by id — `shrine_dawnhaven` is the SAME id P11
 *     placed, so the Dawnhaven stone moves to the new town rather than being
 *     duplicated beside it.
 *  4. **Bridge dressing** — plank sections along each causeway, `span_<id>_<n>`.
 *
 * Everything is safe to re-run: ids are deterministic, upserts replace, and an
 * unchanged draft prunes itself at publish.
 *
 * Usage: pnpm world:settle [http://localhost:8082] [--keep-drowned]
 */

import { CHUNK_SIZE_M, WORLD_CHUNKS, WORLD_ORIGIN_M } from '@dawned/shared';
import { openAdminSession } from './admin-session.mjs';
import { BRIDGES } from './world-data.js';
import { BRIDGE_DRESSING, SETTLEMENTS, SHRINES, buildingWorldPos } from './settlement-data.js';

const BASE_URL = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8082';
const KEEP_DROWNED = process.argv.includes('--keep-drowned');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dawned:dawned@127.0.0.1:5432/dawned';

const ok = (message: string): void => {
  console.log(`✅ ${message}`);
};
const note = (message: string): void => {
  console.log(`   ${message}`);
};
const fail: (message: string) => never = (message) => {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
};

interface MapObjectPut {
  layer: string;
  def: Record<string, unknown>;
}

/** Ids this script owns — never pruned, always replaced. */
const ours = (id: string): boolean =>
  id.startsWith('bld_') || id.startsWith('span_') || id.startsWith('shrine_');

const main = async (): Promise<void> => {
  console.log(`\nSettling the Dawnlands → ${BASE_URL}\n`);

  const session = await openAdminSession(BASE_URL, DATABASE_URL);
  const bare = session.bare;
  const headers = session.headers;
  ok('panel session open');

  const lock = await fetch(`${BASE_URL}/api/map/lock`, { method: 'POST', headers: bare });
  if (!lock.ok) fail(`could not take the map lock: ${await lock.text()}`);
  ok('map lock held');

  const putObjects = async (objects: MapObjectPut[], what: string): Promise<void> => {
    for (let start = 0; start < objects.length; start += 200) {
      const response = await fetch(`${BASE_URL}/api/map/objects`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ objects: objects.slice(start, start + 200) }),
      });
      if (!response.ok) fail(`saving ${what} failed: ${await response.text()}`);
    }
  };

  try {
    // --- 1 · prune what the new sea drowned --------------------------------
    // Computed, not parsed. The first version read `validateDraft`'s prose for
    // "sits on a disabled chunk" and pruned nothing, because props use a
    // DIFFERENT sentence ("stands on a disabled chunk (it would fall into the
    // sea)") — two wordings for one condition, and a regex that matched one of
    // them. Asking the chunks whether they are enabled cannot go quietly wrong
    // the same way.
    if (!KEEP_DROWNED) {
      console.log('');
      const chunkRows = await fetch(
        `${BASE_URL}/api/map/chunks?minCx=0&minCy=0&maxCx=${WORLD_CHUNKS - 1}&maxCy=${WORLD_CHUNKS - 1}`,
        { headers: bare },
      );
      if (!chunkRows.ok) fail(`reading chunks refused (${chunkRows.status})`);
      const chunks = (await chunkRows.json()) as {
        chunks: { cx: number; cy: number; enabled: boolean }[];
      };
      const live = new Set(
        chunks.chunks.filter((chunk) => chunk.enabled).map((chunk) => `${chunk.cx},${chunk.cy}`),
      );

      const objectRows = await fetch(`${BASE_URL}/api/map/objects`, { headers: bare });
      if (!objectRows.ok) fail(`reading objects refused (${objectRows.status})`);
      const objects = (await objectRows.json()) as {
        objects: { id: string; layer: string; x: number | null; z: number | null }[];
      };

      const drowned: string[] = [];
      const byLayer = new Map<string, number>();
      for (const row of objects.objects) {
        // Zones and scatter carry no single point — a zone is a ring and a
        // scatter row is a whole chunk's density grid, so neither can be "on"
        // a chunk in this sense.
        if (row.x === null || row.z === null) continue;
        // Anything this run is about to write is skipped: it is placed against
        // the NEW terrain and judging it against the draft before regeneration
        // would delete it for standing where it is supposed to stand.
        if (ours(row.id)) continue;
        const cx = Math.floor((row.x - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
        const cy = Math.floor((row.z - WORLD_ORIGIN_M) / CHUNK_SIZE_M);
        if (live.has(`${cx},${cy}`)) continue;
        drowned.push(row.id);
        byLayer.set(row.layer, (byLayer.get(row.layer) ?? 0) + 1);
      }

      if (drowned.length === 0) {
        note(`nothing is standing on a drowned chunk (${live.size} chunks carry land)`);
      } else {
        for (let start = 0; start < drowned.length; start += 500) {
          const response = await fetch(`${BASE_URL}/api/map/objects`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ ids: drowned.slice(start, start + 500) }),
          });
          if (!response.ok) fail(`pruning drowned rows failed: ${await response.text()}`);
        }
        ok(`${drowned.length} placement(s) removed — they stood where the sea is now`);
        for (const [layer, count] of [...byLayer].sort()) note(`  ${layer.padEnd(14)} ${count}`);
      }
    }

    // --- 2 · the settlements ----------------------------------------------
    console.log('');
    const buildings: MapObjectPut[] = [];
    for (const town of SETTLEMENTS) {
      town.buildings.forEach((building, i) => {
        const at = buildingWorldPos(town, building);
        buildings.push({
          layer: 'prop',
          def: {
            id: `bld_${town.id}_${i}`,
            modelRef: `world_buildings_${building.model}`,
            x: Math.round(at.x * 10) / 10,
            z: Math.round(at.z * 10) / 10,
            yOffset: 0,
            rotation: Math.round(at.yaw * 1000) / 1000,
            scale: building.scale ?? 1,
            tiltX: 0,
            tiltZ: 0,
            collection: `settlement_${town.id}`,
            // A building you can walk through is a building nobody believes in.
            solid: building.blockRadius > 0,
            radius: building.blockRadius,
          },
        });
      });
    }
    await putObjects(buildings, 'settlement buildings');
    ok(`${buildings.length} buildings across ${SETTLEMENTS.length} settlements`);
    for (const town of SETTLEMENTS) {
      note(
        `  ${town.name.padEnd(16)} ${String(town.buildings.length).padStart(2)} building(s) · ` +
          `${town.zoneId} · ground ${town.groundY} m`,
      );
    }

    // --- 3 · the shrines ---------------------------------------------------
    console.log('');
    await putObjects(
      SHRINES.map((shrine) => ({
        layer: 'interactable',
        def: {
          id: shrine.id,
          kind: 'shrine',
          name: shrine.name,
          x: shrine.x,
          z: shrine.z,
          yOffset: 0,
          rotation: shrine.rotation,
          modelRef: 'world_props_pillar_decorated',
          lootTableId: null,
          respawnMs: 600_000,
          text: '',
          destX: null,
          destZ: null,
          // The fast-travel graph IS the set of shrines with this flag; the
          // game prices each hop with `fastTravelCost` rather than storing one.
          travelNode: true,
        },
      })),
      'shrines',
    );
    ok(`${SHRINES.length} Ancient Shrines, all on the travel graph`);
    note(
      `  ${SHRINES.filter((s) => s.town !== null).length} in settlements, ` +
        `${SHRINES.filter((s) => s.town === null).length} out in the zones`,
    );

    // --- 4 · the bridge dressing -------------------------------------------
    console.log('');
    const planks: MapObjectPut[] = [];
    for (const span of BRIDGE_DRESSING) {
      const deck = BRIDGES.find((entry) => entry.id === span.bridgeId);
      if (!deck) fail(`no bridge named ${span.bridgeId}`);
      const axis = deck.rotation ?? 0;
      for (let i = 0; i < span.sections; i++) {
        const along = (i - (span.sections - 1) / 2) * span.spacing;
        planks.push({
          layer: 'prop',
          def: {
            id: `span_${span.bridgeId}_${i}`,
            modelRef: 'world_buildings_dock_firstage',
            x: Math.round((deck.centerX + Math.cos(axis) * along) * 10) / 10,
            z: Math.round((deck.centerZ + Math.sin(axis) * along) * 10) / 10,
            yOffset: 0,
            rotation: Math.round((axis + Math.PI / 2) * 1000) / 1000,
            scale: 1,
            tiltX: 0,
            tiltZ: 0,
            collection: `bridge_${span.bridgeId}`,
            // NOT solid. The deck is terrain (Q30) and the walkgrid already has
            // its answer from the ground; stamping a plank unwalkable would
            // block the very crossing it is decorating.
            solid: false,
            radius: 0,
          },
        });
      }
    }
    await putObjects(planks, 'bridge dressing');
    ok(`${planks.length} plank sections across ${BRIDGE_DRESSING.length} crossings`);
    for (const span of BRIDGE_DRESSING) {
      note(`  ${span.name.padEnd(22)} ${span.sections} section(s) @ ${span.spacing} m`);
    }

    // --- what does validate say now? ---------------------------------------
    console.log('');
    const after = await fetch(`${BASE_URL}/api/map/validate`, { headers: bare });
    if (after.ok) {
      const report = (await after.json()) as { problems?: string[]; warnings?: string[] };
      const problems = report.problems ?? [];
      if (problems.length === 0) {
        ok('the draft validates — it is ready to publish');
      } else {
        note(`${problems.length} problem(s) still block a publish:`);
        for (const line of problems.slice(0, 12)) note(`  • ${line}`);
        if (problems.length > 12) note(`  … and ${problems.length - 12} more`);
      }
      for (const line of (report.warnings ?? []).slice(0, 6)) note(`⚠️  ${line}`);
    }
  } finally {
    await fetch(`${BASE_URL}/api/map/lock`, { method: 'DELETE', headers: bare }).catch(() => null);
  }

  console.log('\n🏘  The Dawnlands are settled.\n');
};

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
