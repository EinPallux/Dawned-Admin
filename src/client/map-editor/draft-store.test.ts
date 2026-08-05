/**
 * Autosave rules (A2-d).
 *
 * Both cases here are real bugs the editor shipped with for a few hours, and
 * both are the shape that matters most in an autosaving tool: work that looks
 * saved (or looks like it will be) and is not.
 *
 * Neither showed up on a fast machine. The first only appeared when a slow
 * software-rendered test run made a stroke overlap a save in flight; the second
 * needs a generator, which dirties hundreds of chunks at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_VERTS, baseSplat } from '@dawned/shared';
import { DraftStore, type EditorChunk, type SaveState } from './draft-store.js';

const put = vi.hoisted(() => vi.fn());

vi.mock('../api.js', () => ({
  apiGet: vi.fn(),
  apiPut: put,
}));

const chunk = (cx: number, cy: number): EditorChunk => ({
  cx,
  cy,
  heights: new Float32Array(CHUNK_VERTS * CHUNK_VERTS).fill(4),
  splat: baseSplat(0),
  waterLevel: null,
  enabled: true,
});

const makeStore = () => {
  const states: SaveState[] = [];
  const store = new DraftStore({
    onChunkChanged: () => undefined,
    onSaveState: (state) => states.push(state),
  });
  return { store, states };
};

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ saved: 1 });
  vi.useFakeTimers();
});

describe('a save that overlaps another save', () => {
  it('does not drop the second one on the floor', async () => {
    const { store, states } = makeStore();
    // A save that hangs until we let it finish, so the second flush lands
    // squarely inside the first one's flight.
    let release = (): void => undefined;
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ saved: 1 });
          };
        }),
    );

    store.markDirty(chunk(4, 4));
    await vi.advanceTimersByTimeAsync(2100);
    expect(put).toHaveBeenCalledTimes(1); // in flight, not finished

    // The owner keeps working while that request is out.
    store.markDirty(chunk(5, 4));
    await vi.advanceTimersByTimeAsync(2100);

    release();
    await vi.advanceTimersByTimeAsync(2100);

    expect(put).toHaveBeenCalledTimes(2);
    expect(store.dirtyCount).toBe(0);
    expect(states.at(-1)).toBe('clean');
  });
});

describe('a generator-sized save', () => {
  it('splits into batches the endpoint accepts', async () => {
    const { store } = makeStore();
    // 150 chunks — the endpoint takes 64 a call, and sending them in one body
    // is a 400 the editor would report as a permanent save failure.
    for (let i = 0; i < 150; i++) store.markDirty(chunk(i % 32, Math.floor(i / 32)));
    await vi.advanceTimersByTimeAsync(2100);

    expect(put).toHaveBeenCalledTimes(3);
    for (const call of put.mock.calls) {
      const body = call[1] as { chunks: unknown[] };
      expect(body.chunks.length).toBeLessThanOrEqual(64);
    }
    const sent = put.mock.calls.reduce(
      (total, call) => total + (call[1] as { chunks: unknown[] }).chunks.length,
      0,
    );
    expect(sent).toBe(150);
  });
});

describe('a save the server refuses', () => {
  it('keeps the work and retries rather than losing it', async () => {
    const { store, states } = makeStore();
    put.mockRejectedValueOnce(new Error('map is locked'));

    store.markDirty(chunk(4, 4));
    await vi.advanceTimersByTimeAsync(2100);
    expect(states).toContain('error');
    expect(store.dirtyCount).toBe(1); // NOT forgotten

    await vi.advanceTimersByTimeAsync(2100);
    expect(put).toHaveBeenCalledTimes(2);
    expect(store.dirtyCount).toBe(0);
  });
});
