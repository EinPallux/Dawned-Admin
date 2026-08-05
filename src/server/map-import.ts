/**
 * Import the LIVE map into the draft (A2 · MAP_EDITOR.md §3).
 *
 * Without this the map editor opens on an empty 32×32 grid of ocean, and the
 * owner's first publish would delete Dawnhaven, every camp and every zone. The
 * draft has to start as a faithful copy of what players are standing on right
 * now — including the `dev-2` world that worldgen produced, which is exactly
 * the world that needs to become editable.
 *
 * It is a one-way door on purpose: importing OVERWRITES the draft, and the
 * route that calls it is confirm-gated and audited. Everything it writes is
 * still a draft — the live game does not change until a publish runs.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { contentSpawners } from '@dawned/shared/schema';
import {
  decodeChunk,
  placementsFileSchema,
  spawnerDefSchema,
  zonesFileSchema,
  type ScatterSet,
} from '@dawned/shared';
import type { Db } from './db.js';
import { saveChunk, saveObject, type DraftChunk } from './map-draft.js';

export interface ImportReport {
  version: string;
  chunks: number;
  props: number;
  scatterPatches: number;
  scatterSets: ScatterSet[];
  zones: number;
  pois: number;
  interactables: number;
  spawners: number;
  /** Things the live map carries that the draft cannot represent yet. */
  notes: string[];
}

/**
 * Read a baked map directory + the published spawner rows into the draft
 * tables. Returns what it wrote so the panel can show the owner a receipt
 * rather than a spinner that ends in silence.
 */
export const importLiveMap = async (
  db: Db,
  mapRoot: string,
  version: string,
  updatedBy: number,
): Promise<ImportReport> => {
  const mapDir = path.join(mapRoot, version);
  const notes: string[] = [];

  // --- terrain --------------------------------------------------------------
  const files = await readdir(mapDir);
  const chunkFiles = files.filter((file) => file.startsWith('chunk_') && file.endsWith('.bin'));
  let chunks = 0;
  for (const file of chunkFiles) {
    const decoded = decodeChunk(new Uint8Array(await readFile(path.join(mapDir, file))));
    const chunk: DraftChunk = {
      cx: decoded.cx,
      cy: decoded.cy,
      heights: decoded.heights,
      splat: decoded.splat,
      waterLevel: decoded.waterLevel,
      // A chunk that was BAKED is a chunk that exists. Everything the bake
      // skipped stays absent, which is what keeps open ocean free.
      enabled: true,
    };
    await saveChunk(db, chunk, updatedBy);
    chunks++;
  }

  // --- zones ----------------------------------------------------------------
  let zones = 0;
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(mapDir, 'zones.json'), 'utf8'));
    for (const zone of zonesFileSchema.parse(raw).zones) {
      await saveObject(db, 'zone', zone, updatedBy);
      zones++;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    notes.push('the live map ships no zones.json — draft has no zones');
  }

  // --- placements -----------------------------------------------------------
  let props = 0;
  let scatterPatches = 0;
  let pois = 0;
  let interactables = 0;
  let scatterSets: ScatterSet[] = [];
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(mapDir, 'placements.json'), 'utf8'));
    const placements = placementsFileSchema.parse(raw);
    scatterSets = placements.scatterSets;
    for (const prop of placements.props) {
      await saveObject(db, 'prop', prop, updatedBy);
      props++;
    }
    for (const patch of placements.scatter) {
      // Scatter patches have no id in the baked file — one patch per
      // (chunk, set) is the identity, so that is what the draft id encodes.
      const id = `scatter_${patch.cx}_${patch.cy}_${patch.setId}`;
      await saveObject(db, 'scatter', { id, ...patch }, updatedBy);
      scatterPatches++;
    }
    for (const poi of placements.pois) {
      await saveObject(db, 'poi', poi, updatedBy);
      pois++;
    }
    for (const row of placements.interactables) {
      await saveObject(db, 'interactable', row, updatedBy);
      interactables++;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    notes.push('the live map ships no placements.json — draft has no props or POIs');
  }

  // --- spawners -------------------------------------------------------------
  // These live in `content_spawners`, not in the map bake: the Enemies editor
  // authored them and the game loads them from the database. The map editor
  // gets a COPY to place spatially; publishing the map writes it back.
  const spawnerRows = await db
    .select()
    .from(contentSpawners)
    .where(eq(contentSpawners.status, 'published'));
  let spawners = 0;
  for (const row of spawnerRows) {
    await saveObject(db, 'spawner', spawnerDefSchema.parse(row.def), updatedBy);
    spawners++;
  }

  return {
    version,
    chunks,
    props,
    scatterPatches,
    scatterSets,
    zones,
    pois,
    interactables,
    spawners,
    notes,
  };
};
