/**
 * Zone outline rules (A3-c).
 *
 * These exist because a bad polygon does not LOOK bad. A bow-tie zone passes
 * the schema (three or more points), draws as a plausible shape, and then
 * contains half of itself when `pointInPolygon` runs — so a player standing in
 * the visible middle of Emberwood gets Dawnshore's fog and no discovery XP.
 * Nobody would ever guess that from the zone list.
 */

import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@dawned/shared';
import { normalisePolygon, polygonArea2, selfIntersects, zoneDrawProblems } from './zones.js';

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('winding', () => {
  it('normalises either hand to counter-clockwise', () => {
    const clockwise = normalisePolygon(square);
    const counter = normalisePolygon([...square].reverse());
    expect(Math.sign(polygonArea2(clockwise))).toBe(Math.sign(polygonArea2(counter)));
  });

  it('agrees with the winding the LIVE world ships', () => {
    // The Verdant Weald, verbatim from the published map bake. An editor whose
    // idea of "normalised" is the opposite of the shipped data rewrites every
    // zone it touches — invisible at runtime (`pointInPolygon` is even-odd) and
    // wrong against `zoneSchema`'s stated contract. "Both hands agree" cannot
    // catch that; a known-good ring can.
    const weald: [number, number][] = [
      [-620, -620],
      [0, -620],
      [0, -70],
      [-620, -70],
    ];
    expect(normalisePolygon(weald)).toEqual(weald);
    expect(normalisePolygon([...weald].reverse())).toEqual(weald);
  });

  it('keeps the shape the owner drew, whichever way they went round', () => {
    for (const ring of [square, [...square].reverse()]) {
      const normalised = normalisePolygon(ring);
      expect(pointInPolygon(5, 5, normalised)).toBe(true);
      expect(pointInPolygon(15, 5, normalised)).toBe(false);
    }
  });

  it('drops a repeated corner (a double-click at the same spot)', () => {
    const withDuplicate: [number, number][] = [
      [0, 0],
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(normalisePolygon(withDuplicate)).toHaveLength(3);
  });
});

describe('self-intersection', () => {
  it('accepts a plain square', () => {
    expect(selfIntersects(square)).toBe(false);
  });

  it('catches the bow tie', () => {
    const bowTie: [number, number][] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    expect(selfIntersects(bowTie)).toBe(true);
  });

  it('accepts a concave but legal outline (a bay in the coastline)', () => {
    const bay: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 4],
      [0, 10],
    ];
    expect(selfIntersects(bay)).toBe(false);
  });
});

describe('what the editor refuses to save', () => {
  it('needs three corners', () => {
    expect(
      zoneDrawProblems([
        [0, 0],
        [1, 1],
      ]),
    ).toContain('a zone needs at least three corners');
  });

  it('refuses a crossed outline', () => {
    const bowTie: [number, number][] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    expect(zoneDrawProblems(bowTie)).toContain('the outline crosses itself');
  });

  it('refuses a sliver that encloses no ground', () => {
    const sliver: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 0.01],
    ];
    expect(zoneDrawProblems(sliver)).toContain('the outline encloses almost no ground');
  });

  it('passes a real zone', () => {
    expect(zoneDrawProblems(square)).toEqual([]);
  });
});
