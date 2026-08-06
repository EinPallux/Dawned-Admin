import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORLD_EROSION,
  type IslandMask,
  WorldHeightField,
  erodeField,
  insidePolygon,
  makeNoise,
  maskHeightAt,
  slopeAt,
  splatLayerAt,
  synthWorld,
} from './terrain-synth.js';

const SEA = 0;
const FLOOR = -8;

const island = (over: Partial<IslandMask> & { id: string }): IslandMask => ({
  seed: 1337,
  centerX: 0,
  centerZ: 0,
  radius: 200,
  peak: 60,
  roughness: 0.4,
  ...over,
});

/** A small world so the tests stay fast; the maths does not know the size. */
const field = (chunks = 4): WorldHeightField => new WorldHeightField(chunks, -(chunks * 64) / 2);

describe('island masks', () => {
  it('reaches its peak near the centre and nothing at the rim', () => {
    const mask = island({ id: 'a', roughness: 0 });
    const noise = makeNoise(mask.seed);
    const centre = maskHeightAt(mask, noise, 0, 0, SEA);
    expect(centre).not.toBeNull();
    expect(centre!).toBeGreaterThan(mask.peak * 0.7);
    // Exactly at the radius the mask stops contributing — that is what lets the
    // caller tell "no island here" from "island, at sea level".
    expect(maskHeightAt(mask, noise, mask.radius, 0, SEA)).toBeNull();
    expect(maskHeightAt(mask, noise, mask.radius * 2, 0, SEA)).toBeNull();
  });

  it('stretches and rotates, so an isle is not a circle', () => {
    const round = island({ id: 'r', roughness: 0 });
    const wide = island({ id: 'w', roughness: 0, stretchX: 2 });
    const noise = makeNoise(round.seed);
    // 300 m east is outside the round mask and inside the doubled one.
    expect(maskHeightAt(round, noise, 300, 0, SEA)).toBeNull();
    expect(maskHeightAt(wide, noise, 300, 0, SEA)).not.toBeNull();
    // Rotating that same ellipse a quarter turn moves the reach to the z axis.
    const turned = island({ id: 't', roughness: 0, stretchX: 2, rotation: Math.PI / 2 });
    expect(maskHeightAt(turned, noise, 300, 0, SEA)).toBeNull();
    expect(maskHeightAt(turned, noise, 0, 300, SEA)).not.toBeNull();
  });

  it('is deterministic: the same seed gives the same metre', () => {
    const mask = island({ id: 'd' });
    const a = maskHeightAt(mask, makeNoise(mask.seed), 40, -70, SEA);
    const b = maskHeightAt(mask, makeNoise(mask.seed), 40, -70, SEA);
    expect(a).toBe(b);
  });
});

describe('archipelago synthesis', () => {
  it('writes ocean floor where no mask reaches', () => {
    const f = field();
    synthWorld(f, [island({ id: 'a', radius: 60 })], SEA, FLOOR);
    // A corner of a 256 m world is well outside a 60 m island.
    expect(f.get(0, 0)).toBe(FLOOR);
    expect(f.get(f.side - 1, f.side - 1)).toBe(FLOOR);
  });

  it('merges overlapping masks into an isthmus instead of erasing one', () => {
    const f = field();
    const left = island({ id: 'left', centerX: -60, radius: 100, peak: 40, roughness: 0 });
    const right = island({ id: 'right', centerX: 60, radius: 100, peak: 40, roughness: 0 });
    const report = synthWorld(f, [left, right], SEA, FLOOR);

    // Both islands survived — the second did not overwrite the first's disc.
    expect(report.perIsland['left']!).toBeGreaterThan(0);
    expect(report.perIsland['right']!).toBeGreaterThan(0);

    // And the ground BETWEEN them is land, not the sea floor the single-island
    // generator would have written when it re-ran over the overlap.
    const mid = Math.floor(f.side / 2);
    expect(f.get(mid, mid)).toBeGreaterThan(SEA);
  });

  it('takes the greatest contribution, not the sum', () => {
    const f = field();
    const twin = [
      island({ id: 'a', radius: 100, peak: 40, roughness: 0 }),
      island({ id: 'b', radius: 100, peak: 40, roughness: 0 }),
    ];
    synthWorld(f, twin, SEA, FLOOR);
    const mid = Math.floor(f.side / 2);
    // Two identical islands stacked must be 40 m tall, not 80.
    expect(f.get(mid, mid)).toBeLessThanOrEqual(40.001);
  });

  it('carves a strait through an isthmus the masks just merged', () => {
    const f = field(6);
    const left = island({ id: 'left', centerX: -60, radius: 120, peak: 40, roughness: 0 });
    const right = island({ id: 'right', centerX: 60, radius: 120, peak: 40, roughness: 0 });
    const mid = Math.floor(f.side / 2);

    synthWorld(f, [left, right], SEA, FLOOR);
    expect(f.get(mid, mid)).toBeGreaterThan(SEA);

    // A narrow, deep carve laid across the join: the middle must go under
    // water, which is what makes a bridge a real gate rather than decoration.
    const strait = island({
      id: 'strait',
      kind: 'carve',
      centerX: 0,
      centerZ: 0,
      radius: 200,
      peak: 90,
      roughness: 0,
      stretchX: 0.14, // thin east-west, long north-south
    });
    const report = synthWorld(f, [left, right, strait], SEA, FLOOR);

    expect(f.get(mid, mid)).toBeLessThan(SEA);
    // Both isles are still there — a carve cuts, it does not delete.
    expect(report.perIsland['left']!).toBeGreaterThan(0);
    expect(report.perIsland['right']!).toBeGreaterThan(0);
    // And it does not appear as a landmass of its own.
    expect(report.perIsland['strait']).toBeUndefined();
  });

  it('fades to nothing at its own rim, so a channel has no cliff at its edge', () => {
    const isle = island({ id: 'a', radius: 220, peak: 40, roughness: 0 });
    const strait = island({
      id: 'cut',
      kind: 'carve',
      radius: 120,
      peak: 80,
      roughness: 0,
      stretchX: 0.2,
    });
    const plain = field(6);
    synthWorld(plain, [isle], SEA, FLOOR);
    const cut = field(6);
    synthWorld(cut, [isle, strait], SEA, FLOOR);

    const mid = Math.floor(cut.side / 2);
    // The carve's narrow half-width is radius × stretchX = 24 m. One metre
    // outside it the two fields must agree exactly: a carve that stopped
    // abruptly would leave a step there, which is what a trench wall is.
    expect(cut.get(mid + 25, mid)).toBe(plain.get(mid + 25, mid));
    // And it is monotone on the way out — no lip, no second dip.
    for (let gx = mid; gx < mid + 24; gx++) {
      expect(cut.get(gx + 1, mid)).toBeGreaterThanOrEqual(cut.get(gx, mid));
    }
  });

  it('bank steepness is depth over half-width — which is the world data’s problem', () => {
    // Not a defect: a carve 24 m wide and 80 m deep IS a cliff, and terrain
    // over 55° is auto-unwalkable (WORLD.md §6). The test exists so the ratio
    // is written down — a strait meant to be swum across, with beaches on both
    // sides, needs its depth well under its half-width.
    const steepBank = (radius: number, stretchX: number, peak: number): number => {
      const f = field(6);
      synthWorld(
        f,
        [
          island({ id: 'a', radius: 220, peak: 40, roughness: 0 }),
          island({ id: 'cut', kind: 'carve', radius, stretchX, peak, roughness: 0 }),
        ],
        SEA,
        FLOOR,
      );
      const mid = Math.floor(f.side / 2);
      let worst = 0;
      for (let gx = mid; gx < mid + Math.ceil(radius * stretchX); gx++) {
        worst = Math.max(worst, Math.abs(f.get(gx + 1, mid) - f.get(gx, mid)));
      }
      return (Math.atan(worst) * 180) / Math.PI;
    };

    expect(steepBank(120, 0.2, 80)).toBeGreaterThan(55); // 24 m half-width, 80 m deep
    expect(steepBank(400, 0.35, 60)).toBeLessThan(55); // 140 m half-width, 60 m deep
  });

  it('never carves below the ocean floor', () => {
    const f = field(4);
    const isle = island({ id: 'a', radius: 100, peak: 10, roughness: 0 });
    const deep = island({ id: 'cut', kind: 'carve', radius: 100, peak: 400, roughness: 0 });
    synthWorld(f, [isle, deep], SEA, FLOOR);
    for (const h of f.heights) expect(h).toBeGreaterThanOrEqual(FLOOR);
  });

  it('counts only land above the waterline', () => {
    const f = field();
    const report = synthWorld(f, [island({ id: 'a', radius: 60, peak: 30 })], SEA, FLOOR);
    let above = 0;
    for (const h of f.heights) if (h > SEA + 0.2) above++;
    expect(report.land).toBe(above);
    expect(report.perIsland['a']).toBe(above);
  });
});

/** A cone of `radius` vertices standing on flat ground — a real terrain shape. */
const cone = (f: WorldHeightField, cx: number, cz: number, radius: number, peak: number): void => {
  for (let gz = 0; gz < f.side; gz++) {
    for (let gx = 0; gx < f.side; gx++) {
      const d = Math.hypot(gx - cx, gz - cz);
      if (d < radius) f.set(gx, gz, Math.max(f.get(gx, gz), peak * (1 - d / radius)));
    }
  }
};

describe('erosion across the whole field', () => {
  it('slumps a steep cone and leaves the flat ground alone', () => {
    const f = field();
    f.heights.fill(10);
    const mid = Math.floor(f.side / 2);
    cone(f, mid, mid, 8, 120); // ~86° flanks, far past the talus angle
    const flankBefore = f.get(mid + 4, mid);
    const flatBefore = f.get(2, 2);

    erodeField(f, DEFAULT_WORLD_EROSION, SEA);

    expect(f.get(mid + 4, mid)).toBeLessThan(flankBefore);
    expect(f.get(2, 2)).toBe(flatBefore);
  });

  it('cannot see a spike one vertex wide — and that is fine here', () => {
    // The talus test is a CENTRAL-DIFFERENCE slope, so at a lone spike the two
    // neighbours are symmetric and the gradient reads zero: the spike stands
    // while the ground around it slumps. Pinned rather than fixed because the
    // only heights this runs on come from three octaves of value noise whose
    // finest wavelength is ~24 m — a 1 m feature cannot occur. Anything that
    // ever feeds hand-drawn or imported heights through here needs a
    // steepest-neighbour talus instead.
    const f = field();
    f.heights.fill(10);
    const mid = Math.floor(f.side / 2);
    f.set(mid, mid, 200);
    erodeField(f, DEFAULT_WORLD_EROSION, SEA);
    expect(f.get(mid, mid)).toBe(200);
    // Its neighbours, which DO see a gradient, moved.
    expect(f.get(mid + 1, mid)).toBeGreaterThan(10);
  });

  it('leaves the ocean floor where it is', () => {
    const f = field();
    f.heights.fill(FLOOR);
    // A cliff standing in the sea: only the land side may move.
    const mid = Math.floor(f.side / 2);
    f.set(mid, mid, 60);
    erodeField(f, DEFAULT_WORLD_EROSION, SEA);
    expect(f.get(2, 2)).toBe(FLOOR);
    expect(f.get(mid + 1, mid)).toBe(FLOOR);
  });

  it('erodes the vertices a per-chunk pass would have skipped', () => {
    // The per-chunk generator skips border rows because adjacent chunks SHARE
    // them and a one-sided edit tears the world. Here a chunk seam is an
    // ordinary interior vertex, so a slope sitting on one slumps like any
    // other — which is why the whole-world pass does not leave an un-eroded
    // lattice every 64 m.
    const f = field();
    f.heights.fill(10);
    const seam = 64; // the first shared row of a 64-cell chunk
    cone(f, seam, seam, 8, 120);
    const onSeam = f.get(seam + 4, seam);
    erodeField(f, DEFAULT_WORLD_EROSION, SEA);
    expect(f.get(seam + 4, seam)).toBeLessThan(onSeam);
  });
});

describe('chunk windows', () => {
  it('round-trips a chunk through the field', () => {
    const f = field();
    const verts = 65;
    const written = new Float32Array(verts * verts);
    for (let i = 0; i < written.length; i++) written[i] = i % 37;
    f.writeChunk(1, 2, written, verts);
    const read = new Float32Array(verts * verts);
    f.readChunk(1, 2, read, verts);
    expect(Array.from(read)).toEqual(Array.from(written));
  });

  it('gives neighbouring chunks the SAME border vertex', () => {
    // This is the property the whole class exists for: chunk (0,0)'s last
    // column and chunk (1,0)'s first column are one row of vertices, and a
    // world where they disagree is torn open along every seam.
    const f = field();
    synthWorld(f, [island({ id: 'a', radius: 100, peak: 40 })], SEA, FLOOR);
    const verts = 65;
    const left = new Float32Array(verts * verts);
    const right = new Float32Array(verts * verts);
    f.readChunk(0, 0, left, verts);
    f.readChunk(1, 0, right, verts);
    for (let iz = 0; iz < verts; iz++) {
      expect(right[iz * verts]).toBe(left[iz * verts + (verts - 1)]);
    }
  });
});

describe('splat rules', () => {
  const rules = [
    { layer: 0, minSlopeDeg: 0, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
    { layer: 1, minSlopeDeg: 0, maxSlopeDeg: 24, minHeight: 2.5, maxHeight: 999 },
    { layer: 3, minSlopeDeg: 32, maxSlopeDeg: 90, minHeight: -999, maxHeight: 999 },
  ];

  it('applies rules in order, last match wins', () => {
    expect(splatLayerAt(rules, 0, 0, 0, 0)).toBe(0);
    expect(splatLayerAt(rules, 10, 5, 0, 0)).toBe(1);
    // Steep AND high: rule 3 comes later, so rock beats grass.
    expect(splatLayerAt(rules, 10, 50, 0, 0)).toBe(3);
  });

  it('scopes a rule to its zone polygon', () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const zoned = [...rules, { ...rules[1]!, layer: 6, polygon: square }];
    // Inside the ring the zone's own layer wins; one metre outside it does not,
    // which is what lets six palettes share one pass.
    expect(splatLayerAt(zoned, 10, 5, 50, 50)).toBe(6);
    expect(splatLayerAt(zoned, 10, 5, -1, 50)).toBe(1);
  });

  it('reports -1 when nothing claims a texel', () => {
    expect(splatLayerAt([rules[1]!], 0, 0, 0, 0)).toBe(-1);
  });
});

describe('slope', () => {
  it('reads 0 on a flat field and climbs with the gradient', () => {
    const f = field();
    f.heights.fill(5);
    expect(slopeAt(f, 10, 10)).toBe(0);
    // A 1 m rise per 1 m run is 45°.
    for (let gz = 0; gz < f.side; gz++) {
      for (let gx = 0; gx < f.side; gx++) f.set(gx, gz, gx);
    }
    expect(slopeAt(f, 10, 10)).toBeCloseTo(45, 5);
  });

  it('does not fall off the edge of the field', () => {
    const f = field();
    f.heights.fill(5);
    expect(Number.isFinite(slopeAt(f, 0, 0))).toBe(true);
    expect(Number.isFinite(slopeAt(f, f.side - 1, f.side - 1))).toBe(true);
  });
});

describe('point in polygon', () => {
  it('matches the game even-odd rule for a ring either way round', () => {
    const cw: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const ccw = [...cw].reverse();
    expect(insidePolygon(cw, 5, 5)).toBe(true);
    expect(insidePolygon(ccw, 5, 5)).toBe(true);
    expect(insidePolygon(cw, 15, 5)).toBe(false);
  });
});
