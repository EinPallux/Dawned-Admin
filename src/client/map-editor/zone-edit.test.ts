/**
 * Zone polygon editing (A3-c).
 *
 * The refusals are the point. A move or a delete that quietly produces a
 * self-crossing ring looks correct in the viewport and then makes the game
 * disagree with itself about which zone a point is in — no amount of looking
 * at the editor catches that, so it is pinned here.
 */

import { describe, expect, it } from 'vitest';
import { deleteVertex, finaliseRing, insertVertex, moveVertex, polygonOf } from './zone-edit.js';
import { polygonArea2 } from './zones.js';

/** A counter-clockwise square, the shape the editor stores. */
const square: [number, number][] = [
  [0, 0],
  [0, 100],
  [100, 100],
  [100, 0],
];

const polygon = (result: ReturnType<typeof moveVertex>): [number, number][] => {
  if ('error' in result) throw new Error(`expected an edit, got refusal: ${result.error}`);
  return result.polygon;
};

const refusal = (result: ReturnType<typeof moveVertex>): string => {
  if (!('error' in result)) throw new Error('expected a refusal, got an edit');
  return result.error;
};

describe('move', () => {
  it('moves the corner it was given and leaves the rest alone', () => {
    const moved = polygon(moveVertex(square, 2, 140, 90));
    expect(moved[2]).toEqual([140, 90]);
    expect(moved[0]).toEqual([0, 0]);
    expect(moved).toHaveLength(4);
  });

  it('rounds to the centimetre — a corner is a stored number, not a float smear', () => {
    expect(polygon(moveVertex(square, 0, 12.3456, -0.98765))[0]).toEqual([12.35, -0.99]);
  });

  it('refuses a drag that folds the ring across itself', () => {
    // Dragging the top-left corner out past the right edge: the outline now
    // runs (0,0)→(150,50), straight through the x=100 edge. A bow tie.
    expect(refusal(moveVertex(square, 1, 150, 50))).toMatch(/cross/);
  });

  it('says no such corner rather than inventing one', () => {
    expect(refusal(moveVertex(square, 9, 0, 0))).toMatch(/no such corner/);
  });
});

describe('insert', () => {
  it('splits the edge it was given, in place', () => {
    const grown = polygon(insertVertex(square, 0, 0, 50));
    expect(grown).toHaveLength(5);
    expect(grown[1]).toEqual([0, 50]);
    expect(grown[2]).toEqual([0, 100]); // what used to be index 1
  });

  it('wraps: the last edge is the one that closes the ring', () => {
    const grown = polygon(insertVertex(square, 3, 50, 0));
    expect(grown[4]).toEqual([50, 0]);
  });

  it('stops at the wire limit', () => {
    const big: [number, number][] = Array.from({ length: 84 }, (_, i) => [i, 0]);
    expect(refusal(insertVertex(big, 0, 0.5, 0))).toMatch(/84 corners/);
  });
});

describe('delete', () => {
  it('removes the corner', () => {
    const shrunk = polygon(deleteVertex(square, 1));
    expect(shrunk).toEqual([
      [0, 0],
      [100, 100],
      [100, 0],
    ]);
  });

  it('keeps a triangle a triangle', () => {
    const triangle: [number, number][] = [
      [0, 0],
      [10, 0],
      [0, 10],
    ];
    expect(refusal(deleteVertex(triangle, 0))).toMatch(/at least three/);
  });

  it('refuses a removal that leaves a crossing outline', () => {
    // A simple hexagon whose last corner is the only thing keeping two edges
    // apart: drop it and the ring that closes back to the start cuts through
    // the far side. Legal shape, legal delete, broken result — which is
    // exactly the class of edit a viewport cannot show you.
    const pinched: [number, number][] = [
      [30, 70],
      [40, 90],
      [90, 10],
      [30, 45],
      [35, 30],
      [0, 20],
    ];
    expect(refusal(deleteVertex(pinched, 5))).toMatch(/cross/);
    // …and every other corner on the same shape comes out fine, so the guard
    // is not simply refusing everything.
    for (const index of [0, 1, 2, 3, 4]) {
      expect(polygon(deleteVertex(pinched, index))).toHaveLength(5);
    }
  });
});

describe('finalise', () => {
  it('restores the shipped winding after an edit inverted it', () => {
    // A triangle dragged inside-out: still a valid triangle, wrong winding.
    const flipped: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 10],
    ];
    const before = polygonArea2(flipped);
    const after = polygonArea2(finaliseRing(flipped));
    expect(Math.sign(after)).toBe(1);
    expect(Math.abs(after)).toBeCloseTo(Math.abs(before));
  });

  it('leaves an already-correct ring alone, index for index', () => {
    // The thing the corner handles depend on: committing an edit must not
    // renumber corners that did not move, or the next drag grabs a different
    // one than the one under the cursor.
    const ring: [number, number][] = [
      [-620, -620],
      [0, -620],
      [0, -70],
      [-620, -70],
    ];
    expect(finaliseRing(ring)).toEqual(ring);
  });
});

describe('reading a stored zone', () => {
  it('accepts the shape the schema stores', () => {
    expect(polygonOf({ polygon: square })).toEqual(square);
  });

  it('answers null for anything that is not a ring of pairs', () => {
    expect(polygonOf({})).toBeNull();
    expect(polygonOf({ polygon: [[0, 0]] })).toBeNull();
    expect(
      polygonOf({
        polygon: [
          ['0', 0],
          [0, 1],
          [1, 1],
        ],
      }),
    ).toBeNull();
  });
});
