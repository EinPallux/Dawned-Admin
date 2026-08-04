/**
 * The editor's half of the placed-object layers (A3).
 *
 * Terrain and objects are stored the same way on the server but behave very
 * differently in the editor: terrain is bytes that change constantly under a
 * brush, objects are rows that change one at a time and each have an identity.
 * So they get separate stores — one autosaving byte cache, one row list with
 * per-row save/delete and its own undo.
 *
 * Object edits save IMMEDIATELY rather than on the 2-second timer. Moving a rock
 * is one 300-byte row, and an object that vanishes because the tab closed
 * within the debounce is worse than a save per drag-end.
 */

import { apiDelete, apiGet, apiPut } from '../api.js';
import type { PlacedObject } from './placement.js';

export type { PlacedObject };

export interface ObjectStoreEvents {
  /** Something in the set changed and the viewport should re-sync its views. */
  onChanged: (ids: string[]) => void;
  onError: (message: string) => void;
}

interface ObjectUndoEntry {
  label: string;
  /** State BEFORE; a missing entry for an id means "it did not exist". */
  before: (PlacedObject | null)[];
  after: (PlacedObject | null)[];
}

const MAX_ENTRIES = 220;

export class ObjectStore {
  private readonly byId = new Map<string, PlacedObject>();
  private readonly entries: ObjectUndoEntry[] = [];
  private cursor = 0;

  constructor(private readonly events: ObjectStoreEvents) {}

  all(): PlacedObject[] {
    return [...this.byId.values()];
  }

  inLayer(layer: string): PlacedObject[] {
    return this.all().filter((object) => object.layer === layer);
  }

  get(id: string): PlacedObject | null {
    return this.byId.get(id) ?? null;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  async load(): Promise<void> {
    const data = await apiGet<{ objects: PlacedObject[] }>('/map/objects');
    this.byId.clear();
    for (const object of data.objects) this.byId.set(object.id, object);
    this.events.onChanged(data.objects.map((object) => object.id));
  }

  /**
   * Create or update one object. Saves through to the server; on refusal the
   * local copy is rolled back, because the only thing worse than a rejected
   * edit is an editor that shows it as applied.
   */
  async save(layer: string, def: Record<string, unknown>, label: string): Promise<boolean> {
    const id = typeof def.id === 'string' ? def.id : '';
    if (!id) {
      this.events.onError('an object needs an id');
      return false;
    }
    const before = this.byId.get(id) ?? null;
    const next: PlacedObject = {
      id,
      layer,
      def,
      x: typeof def.x === 'number' ? def.x : null,
      z: typeof def.z === 'number' ? def.z : null,
    };
    this.byId.set(id, next);
    this.events.onChanged([id]);
    try {
      await apiPut('/map/objects', { objects: [{ layer, def }] });
      this.record(label, [before], [next]);
      return true;
    } catch (error) {
      if (before) this.byId.set(id, before);
      else this.byId.delete(id);
      this.events.onChanged([id]);
      this.events.onError(error instanceof Error ? error.message : 'save refused');
      return false;
    }
  }

  async remove(ids: string[], label: string): Promise<boolean> {
    if (ids.length === 0) return true;
    const before = ids.map((id) => this.byId.get(id) ?? null);
    for (const id of ids) this.byId.delete(id);
    this.events.onChanged(ids);
    try {
      await apiDelete('/map/objects', { ids });
      this.record(
        label,
        before,
        ids.map(() => null),
      );
      return true;
    } catch (error) {
      for (const object of before) {
        if (object) this.byId.set(object.id, object);
      }
      this.events.onChanged(ids);
      this.events.onError(error instanceof Error ? error.message : 'delete refused');
      return false;
    }
  }

  async undo(): Promise<void> {
    if (!this.canUndo) return;
    await this.apply(this.entries[--this.cursor]!.before);
  }

  async redo(): Promise<void> {
    if (!this.canRedo) return;
    await this.apply(this.entries[this.cursor++]!.after);
  }

  /** Replay a snapshot list: nulls are deletes, objects are upserts. */
  private async apply(states: (PlacedObject | null)[]): Promise<void> {
    const upserts = states.filter((state): state is PlacedObject => state !== null);
    const deletes = states
      .map((state, index) => (state === null ? this.entries[this.cursor]?.after[index]?.id : null))
      .filter((id): id is string => typeof id === 'string');
    try {
      if (upserts.length > 0) {
        await apiPut('/map/objects', {
          objects: upserts.map((object) => ({ layer: object.layer, def: object.def })),
        });
        for (const object of upserts) this.byId.set(object.id, object);
      }
      if (deletes.length > 0) {
        await apiDelete('/map/objects', { ids: deletes });
        for (const id of deletes) this.byId.delete(id);
      }
      this.events.onChanged([...upserts.map((o) => o.id), ...deletes]);
    } catch (error) {
      this.events.onError(error instanceof Error ? error.message : 'undo failed');
    }
  }

  private record(
    label: string,
    before: (PlacedObject | null)[],
    after: (PlacedObject | null)[],
  ): void {
    this.entries.length = this.cursor;
    this.entries.push({ label, before, after });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.cursor = this.entries.length;
  }
}

/**
 * A fresh slug for a placed thing. `<layer>_<x>_<z>_<n>` reads in a list and
 * survives a re-import: two props at the same metre get different suffixes, and
 * a prop that moves keeps the id it was created with.
 */
export const mintId = (layer: string, x: number, z: number, taken: Set<string>): string => {
  const base = `${layer}_${Math.round(x + 2048)}_${Math.round(z + 2048)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 999; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${taken.size}`;
};
