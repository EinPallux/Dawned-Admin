/**
 * Shrine / fast-travel graph (A3-c).
 *
 * The numbers here are gold the game will charge, so the panel quoting a
 * different one than the server would is the failure this suite guards.
 */

import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_M, fastTravelCost } from '@dawned/shared';
import { graphHops, graphNodes, shrinesFrom, travelProblems, type Shrine } from './travel-graph.js';
import type { PlacedObject } from './placement.js';

const object = (id: string, def: Record<string, unknown>): PlacedObject => ({
  id,
  layer: 'interactable',
  def: { id, ...def },
  x: typeof def.x === 'number' ? def.x : null,
  z: typeof def.z === 'number' ? def.z : null,
});

const shrine = (id: string, x: number, z: number, onGraph = true): Shrine => ({
  id,
  name: id,
  x,
  z,
  onGraph,
});

describe('reading shrines out of the draft', () => {
  it('picks shrines and ignores every other interactable', () => {
    const found = shrinesFrom([
      object('a', { kind: 'shrine', name: 'Shore Shrine', x: 10, z: 20, travelNode: true }),
      object('b', { kind: 'chest', name: 'Chest', x: 0, z: 0 }),
      object('c', { kind: 'shrine', name: 'Deep Shrine', x: -300, z: 40, travelNode: false }),
      { id: 'd', layer: 'prop', def: { id: 'd', kind: 'shrine' }, x: 1, z: 1 },
    ]);
    expect(found.map((s) => s.id)).toEqual(['a', 'c']);
    expect(found[0]!.onGraph).toBe(true);
    expect(found[1]!.onGraph).toBe(false);
    expect(found[0]!.name).toBe('Shore Shrine');
  });

  it('falls back to the id when a shrine has no name yet', () => {
    expect(shrinesFrom([object('a', { kind: 'shrine', x: 0, z: 0 })])[0]!.name).toBe('a');
  });

  it('skips a shrine with no position rather than drawing it at the origin', () => {
    expect(shrinesFrom([object('a', { kind: 'shrine', name: 'Nowhere' })])).toEqual([]);
  });
});

describe('the graph', () => {
  it('only contains shrines that opted in', () => {
    const nodes = graphNodes([shrine('a', 0, 0), shrine('b', 500, 0, false)]);
    expect(nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('prices hops with the shared formula, not a copy', () => {
    const hops = graphHops([shrine('a', 0, 0), shrine('b', CHUNK_SIZE_M * 8, 0)]);
    expect(hops).toHaveLength(1);
    expect(hops[0]!.gold).toBe(fastTravelCost(0, 0, CHUNK_SIZE_M * 8, 0));
  });
});

describe('problems worth saying out loud', () => {
  it('says nothing blocking — these are advice, never a publish gate', () => {
    const problems = travelProblems([shrine('a', 0, 0), shrine('b', 900, 0)]);
    expect(problems.every((p) => p.level === 'warn')).toBe(true);
  });

  it('warns when the world has no shrine at all', () => {
    expect(travelProblems([])[0]!.text).toMatch(/no shrines/);
  });

  it('warns when one lone shrine is on the graph', () => {
    const problems = travelProblems([shrine('a', 0, 0), shrine('b', 900, 0, false)]);
    expect(problems.some((p) => /nowhere to travel to/.test(p.text))).toBe(true);
    expect(problems.some((p) => /respawn point only/.test(p.text))).toBe(true);
  });

  it('warns about a hop too short to be worth paying for', () => {
    const problems = travelProblems([shrine('near_a', 0, 0), shrine('near_b', 60, 0)]);
    expect(problems.some((p) => /60 m apart/.test(p.text))).toBe(true);
  });

  it('is quiet about a healthy pair', () => {
    expect(travelProblems([shrine('a', 0, 0), shrine('b', 800, 200)])).toEqual([]);
  });
});
