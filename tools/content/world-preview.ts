/**
 * Preview the Dawnlands without touching the database (game P12-A).
 *
 * Generating the world is a checkpoint plus 1024 chunk upserts plus a publish;
 * iterating on "is that island the right size" through that loop costs minutes
 * per guess. This runs the SAME synthesis the server endpoint runs, in memory,
 * and prints what the result would be: land coverage against WORLD.md §1's
 * 55–60 %, per-isle area, whether the straits actually severed anything, and an
 * ASCII map to look at.
 *
 *   pnpm world:preview
 */

import {
  ISLANDS,
  ISLETS,
  SEA_LEVEL,
  SPLAT_RULES,
  STRAITS,
  WORLD_GEN_PLAN,
  ZONES,
} from './world-data.js';
import {
  type IslandMask,
  WorldHeightField,
  erodeField,
  insidePolygon,
  slopeAt,
  resolveSplatZones,
  splatLayerAt,
  synthWorld,
} from '../../src/shared-ext/terrain-synth.js';

const WORLD_CHUNKS = 32;
const ORIGIN = -1024;
const OCEAN_FLOOR = -8;

const field = new WorldHeightField(WORLD_CHUNKS, ORIGIN);
const masks: IslandMask[] = WORLD_GEN_PLAN.masks;

const started = Date.now();
const synth = synthWorld(field, masks, SEA_LEVEL, OCEAN_FLOOR);
const eroded = erodeField(field, WORLD_GEN_PLAN.erosion, SEA_LEVEL);
const ms = Date.now() - started;

const total = field.side * field.side;
const coverage = (synth.land / total) * 100;

console.log('');
console.log('The Dawnlands — preview');
console.log('─'.repeat(64));
console.log(
  `${ISLANDS.length} isle(s), ${ISLETS.length} islet(s), ${STRAITS.length} strait(s), ${eroded.toLocaleString()} vertices eroded in ${ms} ms`,
);
console.log(
  `land ${coverage.toFixed(1)} % of the world  ` +
    (coverage >= 55 && coverage <= 60 ? '✅ inside WORLD.md §1’s 55–60 %' : '⚠️  outside 55–60 %'),
);
console.log('');

// --- per isle -------------------------------------------------------------
// `perIsland` attributes a vertex to whichever mask contributed the MOST, which
// is not the same as which zone it stands in: where two isles merge, land can
// belong to one and sit inside the other's ring. So the isle table reports area
// and peak, and zone coverage is measured once, globally, against the thing
// publish actually blocks on — land in NO zone at all.
console.log('isle                    land m²   share   peak');
for (const isle of [...ISLANDS, ...ISLETS]) {
  const area = synth.perIsland[isle.id] ?? 0;
  let peak = 0;
  for (let gz = 0; gz < field.side; gz++) {
    for (let gx = 0; gx < field.side; gx++) {
      const h = field.get(gx, gz);
      if (h <= SEA_LEVEL + 0.2) continue;
      if (
        Math.hypot(field.worldX(gx) - isle.centerX, field.worldZ(gz) - isle.centerZ) >
        isle.radius * 1.4
      ) {
        continue;
      }
      peak = Math.max(peak, h);
    }
  }
  console.log(
    `${isle.id.padEnd(18)} ${String(area).padStart(10)}  ${((area / total) * 100)
      .toFixed(1)
      .padStart(5)} %  ${peak.toFixed(0).padStart(4)} m`,
  );
}
console.log('');

// --- land in no zone (the publish gate) -----------------------------------
const rings = ZONES.map((zone) => ({ id: zone.id, points: zone.polygon }));
let homeless = 0;
let firstHomeless: { x: number; z: number } | null = null;
for (let gz = 0; gz < field.side; gz++) {
  for (let gx = 0; gx < field.side; gx++) {
    if (field.get(gx, gz) <= SEA_LEVEL + 0.2) continue;
    const x = field.worldX(gx);
    const z = field.worldZ(gz);
    if (rings.some((ring) => insidePolygon(ring.points, x, z))) continue;
    homeless++;
    firstHomeless ??= { x, z };
  }
}
console.log(
  homeless === 0
    ? '✅ every land vertex stands in a zone'
    : `❌ ${homeless.toLocaleString()} land vertex(es) in NO zone — publish blocks on this` +
        ` (first at ${firstHomeless!.x}, ${firstHomeless!.z})`,
);
console.log('');

// --- are the isles actually separate landmasses? --------------------------
// A depth probe at a strait's own centre proves nothing: a channel can be open
// water in the middle and the two isles still joined around its ends, and then
// the bridge gates nothing and a level-6 walks into a level-18 zone. The only
// answer is a flood fill — which landmass is each isle's centre part of.
const label = new Int32Array(field.side * field.side).fill(-1);
const componentSize: number[] = [];
let components = 0;
const stack: number[] = [];
for (let start = 0; start < label.length; start++) {
  if (label[start] !== -1 || field.heights[start]! <= SEA_LEVEL + 0.2) continue;
  const id = components++;
  let size = 0;
  stack.push(start);
  label[start] = id;
  while (stack.length > 0) {
    const at = stack.pop()!;
    size++;
    const gx = at % field.side;
    const gz = (at / field.side) | 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= field.side || nz >= field.side) continue;
      const next = nz * field.side + nx;
      if (label[next] !== -1 || field.heights[next]! <= SEA_LEVEL + 0.2) continue;
      label[next] = id;
      stack.push(next);
    }
  }
  componentSize[id] = size;
}

const landmassOf = (x: number, z: number): number => {
  const gx = Math.round(x - ORIGIN);
  const gz = Math.round(z - ORIGIN);
  return label[
    Math.min(field.side - 1, Math.max(0, gz)) * field.side +
      Math.min(field.side - 1, Math.max(0, gx))
  ]!;
};

console.log(`${components} separate landmass(es) above water`);
console.log('isle / islet         landmass   size m²   shares it with');
const homeMass = new Map<string, number>();
for (const isle of [...ISLANDS, ...ISLETS]) {
  homeMass.set(isle.id, landmassOf(isle.centerX, isle.centerZ));
}
for (const isle of [...ISLANDS, ...ISLETS]) {
  const mass = homeMass.get(isle.id)!;
  const others = [...homeMass.entries()]
    .filter(([id, m]) => m === mass && id !== isle.id)
    .map(([id]) => id);
  console.log(
    `${isle.id.padEnd(18)} ${(mass < 0 ? 'under water' : `#${mass}`).padStart(10)} ` +
      `${(mass < 0 ? 0 : componentSize[mass]!).toLocaleString().padStart(9)}   ` +
      (mass < 0
        ? '⚠️  its centre is below sea level'
        : others.length === 0
          ? '— alone'
          : others.join(', ')),
  );
}
console.log('');

console.log('strait                          deepest point   severs');
for (const strait of STRAITS) {
  let deepest = Number.POSITIVE_INFINITY;
  const gx = Math.round(strait.centerX - ORIGIN);
  const gz = Math.round(strait.centerZ - ORIGIN);
  for (let dz = -6; dz <= 6; dz++) {
    for (let dx = -6; dx <= 6; dx++) {
      const x = Math.min(field.side - 1, Math.max(0, gx + dx));
      const z = Math.min(field.side - 1, Math.max(0, gz + dz));
      deepest = Math.min(deepest, field.get(x, z));
    }
  }
  console.log(
    `${strait.id.padEnd(28)} ${deepest.toFixed(1).padStart(8)} m   ` +
      (deepest < SEA_LEVEL ? 'open water' : '❌ still walkable at its centre'),
  );
}
console.log('');

// --- unpainted texels -----------------------------------------------------
// The same resolution the server does: a palette names its zone, and the ring
// comes from the zone itself rather than from a copy inside the rule.
const resolvedRules = resolveSplatZones(
  SPLAT_RULES,
  new Map(ZONES.map((zone) => [zone.id, zone.polygon])),
);
let unpainted = 0;
let painted = 0;
for (let gz = 0; gz < field.side; gz += 2) {
  for (let gx = 0; gx < field.side; gx += 2) {
    const h = field.get(gx, gz);
    if (h <= SEA_LEVEL + 0.2) continue;
    const layer = splatLayerAt(
      resolvedRules,
      h,
      slopeAt(field, gx, gz),
      field.worldX(gx),
      field.worldZ(gz),
    );
    if (layer < 0) unpainted++;
    else painted++;
  }
}
console.log(
  `splat: ${painted.toLocaleString()} land sample(s) painted, ${unpainted.toLocaleString()} unclaimed ` +
    (unpainted === 0 ? '✅' : '⚠️  an unpainted patch is invisible in the editor'),
);
console.log('');

// --- the map --------------------------------------------------------------
// One character per 32 m. Height bands, not zones: the point is to SEE the
// silhouette and the channels, which is the thing numbers cannot show.
const COLS = 64;
const step = Math.floor((field.side - 1) / COLS);
const glyph = (h: number): string => {
  if (h <= SEA_LEVEL - 4) return ' ';
  if (h <= SEA_LEVEL) return '.';
  if (h < 6) return ':';
  if (h < 18) return '-';
  if (h < 34) return '+';
  if (h < 60) return '#';
  return '@';
};
console.log('        west' + ' '.repeat(COLS - 16) + 'east');
console.log('      ┌' + '─'.repeat(COLS) + '┐');
for (let gz = 0; gz < field.side - 1; gz += step) {
  let row = '';
  for (let gx = 0; gx < field.side - 1; gx += step) row += glyph(field.get(gx, gz));
  const label = gz === 0 ? 'north ' : gz + step >= field.side - 1 ? 'south ' : '      ';
  console.log(`${label}│${row.slice(0, COLS)}│`);
}
console.log('      └' + '─'.repeat(COLS) + '┘');
console.log('      sea  .shallow  :beach  -low  +hill  #high  @peak');
console.log('');
