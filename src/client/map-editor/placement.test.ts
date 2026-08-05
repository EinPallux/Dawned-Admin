/**
 * Marker ring sizes (A3-a, extended for resource nodes in A1-e).
 *
 * MAP_EDITOR.md §2.2 promises rings are drawn to TRUE size, because they are
 * the numbers the owner places against — "does this vein sit clear of that
 * rock", "do these two camps overlap". A ring at the wrong size is worse than
 * no ring at all: it invites a decision made against a lie. This is the only
 * part of building a marker that is a judgement rather than geometry, so it is
 * the part that is pinned.
 */

import { describe, expect, it } from 'vitest';
import { ringRadiusFor, type PlacedObject } from './placement.js';

const object = (layer: string, def: Record<string, unknown>): PlacedObject => ({
  id: 'x',
  layer,
  def,
  x: 0,
  z: 0,
});

const NODE_RADII = new Map([
  ['node_woodcutting_birch', 1.2],
  ['node_mining_copper', 0.8],
]);

describe('rings the placement can size itself', () => {
  it('a spawner draws its own radius', () => {
    expect(ringRadiusFor(object('spawner', { radius: 8 }))).toBe(8);
  });

  it('a POI falls back to the discovery default rather than vanishing', () => {
    expect(ringRadiusFor(object('poi', {}))).toBe(12);
  });

  it('a prop only rings when it is solid — a bush is not a collision', () => {
    expect(ringRadiusFor(object('prop', { radius: 2, solid: true }))).toBe(2);
    expect(ringRadiusFor(object('prop', { radius: 2, solid: false }))).toBe(0);
  });
});

describe('resource nodes, whose size lives on the definition', () => {
  it('reads the radius off the definition the placement points at', () => {
    const ring = ringRadiusFor(object('node', { nodeId: 'node_woodcutting_birch', scale: 1 }), {
      nodeRadii: NODE_RADII,
    });
    expect(ring).toBe(1.2);
  });

  /** One definition, a sapling and an old oak — the scale is the difference. */
  it('multiplies the definition radius by the placement scale', () => {
    const ring = ringRadiusFor(object('node', { nodeId: 'node_mining_copper', scale: 2.5 }), {
      nodeRadii: NODE_RADII,
    });
    expect(ring).toBeCloseTo(2);
  });

  /**
   * Drawing SOMETHING for an unknown definition would be the worst outcome: a
   * ring at a made-up size reads as a fact. No ring is a visible absence.
   */
  it('draws no ring for a node whose definition is not loaded', () => {
    expect(
      ringRadiusFor(object('node', { nodeId: 'node_fishing_ghost', scale: 1 }), {
        nodeRadii: NODE_RADII,
      }),
    ).toBe(0);
    expect(ringRadiusFor(object('node', { nodeId: 'node_woodcutting_birch', scale: 1 }))).toBe(0);
  });

  it('survives a placement with no scale at all', () => {
    expect(
      ringRadiusFor(object('node', { nodeId: 'node_woodcutting_birch' }), {
        nodeRadii: NODE_RADII,
      }),
    ).toBe(1.2);
  });
});
