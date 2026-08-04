/**
 * A1-d: the enemy editor's cross-checks and the TTK simulator. Pure functions
 * over content — no database — so they pin the rules an editor will actually
 * hit while tuning a bestiary.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { enemyAbilitySchema, enemyDefSchema, spawnerDefSchema } from '@dawned/shared';
import type { EnemyAbilityDef, EnemyDef, SpawnerDef } from '@dawned/shared';
import { crossCheck, previewRotation, simulateTtk } from './enemies.js';

/**
 * Overrides are typed against the schema's INPUT, not its output: these
 * fixtures write what an editor would type (`{ atHpPct: 50 }`) and let zod
 * fill the defaults, exactly as a saved draft does.
 */
type AbilityInput = z.input<typeof enemyAbilitySchema>;
type EnemyInput = z.input<typeof enemyDefSchema>;
type SpawnerInput = z.input<typeof spawnerDefSchema>;

// `Bite_Front` is a clip the default fixture model (mushnub, walker family)
// actually owns — the cross-check refuses invented names, as it should.
const ability = (over: Partial<AbilityInput> & { id: string }): EnemyAbilityDef =>
  enemyAbilitySchema.parse({ kind: 'melee_arc', clip: 'Bite_Front', ...over });

const enemy = (over: Partial<EnemyInput> & { id: string }): EnemyDef =>
  enemyDefSchema.parse({
    name: 'Test Thing',
    archetype: 'grunt',
    levelMin: 5,
    levelMax: 5,
    modelRef: 'enemies_mushnub',
    abilities: [ability({ id: 'swipe', coef: 1, windupMs: 500, recoverMs: 600 })],
    ...over,
  });

const spawner = (over: Partial<SpawnerInput> & { id: string }): SpawnerDef =>
  spawnerDefSchema.parse({
    kind: 'area',
    x: 0,
    z: 0,
    radius: 10,
    entries: [{ enemyId: 'enemy_ok', count: 3 }],
    ...over,
  });

const map = <T extends { id: string }>(defs: T[]): Map<string, T> =>
  new Map(defs.map((def) => [def.id, def]));

describe('publish cross-checks', () => {
  it('passes a clean set', () => {
    const result = crossCheck(
      map([enemy({ id: 'enemy_ok' })]),
      map([spawner({ id: 'spawner_a' })]),
      new Set(),
    );
    expect(result.problems).toEqual([]);
  });

  it('refuses a spawner pointing at an enemy that will not exist', () => {
    const result = crossCheck(
      map([enemy({ id: 'enemy_ok' })]),
      map([spawner({ id: 'spawner_ghost', entries: [{ enemyId: 'enemy_deleted', count: 2 }] })]),
      new Set(),
    );
    expect(result.problems.join(' ')).toMatch(/unknown enemy enemy_deleted/);
  });

  it('refuses loot that is not published yet', () => {
    const withLoot = enemy({
      id: 'enemy_dropper',
      loot: { tableId: 'loot_shore', rolls: 1, goldMin: 1, goldMax: 4 },
    });
    expect(crossCheck(map([withLoot]), new Map(), new Set()).problems.join(' ')).toMatch(
      /loot_shore is not published/,
    );
    expect(crossCheck(map([withLoot]), new Map(), new Set(['loot_shore'])).problems).toEqual([]);
  });

  it('forwards the shared row-level rules', () => {
    const badCharge = enemy({
      id: 'enemy_bad_charger',
      archetype: 'charger',
      abilities: [ability({ id: 'pounce', kind: 'charge_rect', rangeMax: 14, chargeDistance: 12 })],
    });
    expect(crossCheck(map([badCharge]), new Map(), new Set()).problems.join(' ')).toMatch(
      /overshoots/,
    );
  });

  it('warns — but does not block — on a boss with no phases or arena', () => {
    const result = crossCheck(
      map([enemy({ id: 'enemy_lazy_boss', rank: 'zone_boss' })]),
      new Map(),
      new Set(),
    );
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/no phases/);
    expect(result.warnings.join(' ')).toMatch(/arenaRadius/);
  });

  it('refuses a clip the model does not own (it would animate nothing)', () => {
    const silent = enemy({
      id: 'enemy_silent',
      modelRef: 'enemies_mushnub',
      // Mushnubs are in the walker rig family: they bite, they do not punch.
      abilities: [ability({ id: 'swat', clip: 'Punch' })],
    });
    expect(crossCheck(map([silent]), new Map(), new Set()).problems.join(' ')).toMatch(
      /no clip named Punch/,
    );
    const fine = enemy({
      id: 'enemy_biter',
      modelRef: 'enemies_mushnub',
      abilities: [ability({ id: 'chomp', clip: 'Bite_Front' })],
    });
    expect(crossCheck(map([fine]), new Map(), new Set()).problems).toEqual([]);
  });

  it('warns when an archetype cannot do what its name promises', () => {
    const meleeRanged = enemy({ id: 'enemy_fake_archer', archetype: 'ranged' });
    expect(crossCheck(map([meleeRanged]), new Map(), new Set()).warnings.join(' ')).toMatch(
      /no ranged ability/,
    );
    const chargerless = enemy({ id: 'enemy_fake_charger', archetype: 'charger' });
    expect(crossCheck(map([chargerless]), new Map(), new Set()).warnings.join(' ')).toMatch(
      /no charge_rect/,
    );
  });
});

describe('TTK simulator', () => {
  const base = {
    enemyLevel: 5,
    playerLevel: 5,
    playerClass: 'warrior' as const,
    playerDps: 40,
    distance: 2,
  };

  it('reports both sides of the trade', () => {
    const report = simulateTtk({ ...base, def: enemy({ id: 'enemy_ok' }) });
    expect(report.enemyHp).toBeGreaterThan(0);
    expect(report.playerKillSeconds).toBeCloseTo(report.enemyHp / 40, 5);
    expect(report.enemyDps).toBeGreaterThan(0);
    expect(report.enemyKillSeconds).toBeCloseTo(report.playerHp / report.enemyDps, 5);
  });

  it('weights the rotation by the SAME rule the fight uses', () => {
    const report = simulateTtk({
      ...base,
      def: enemy({
        id: 'enemy_mixed',
        abilities: [
          ability({ id: 'light', weight: 3, coef: 1 }),
          ability({ id: 'heavy', weight: 1, coef: 3 }),
        ],
      }),
    });
    const light = report.rotation.find((row) => row.id === 'light');
    const heavy = report.rotation.find((row) => row.id === 'heavy');
    expect(light?.sharePct).toBeCloseTo(75, 5);
    expect(heavy?.sharePct).toBeCloseTo(25, 5);
    expect(heavy?.damage).toBeCloseTo((light?.damage ?? 0) * 3, 5);
  });

  it('only counts abilities usable at the distance being simulated', () => {
    const archer = enemy({
      id: 'enemy_archer',
      archetype: 'ranged',
      abilities: [
        ability({ id: 'shot', kind: 'projectile', rangeMin: 6, rangeMax: 16, coef: 1 }),
        ability({ id: 'kick', rangeMax: 2.5, coef: 0.5 }),
      ],
    });
    expect(simulateTtk({ ...base, def: archer, distance: 10 }).rotation.map((r) => r.id)).toEqual([
      'shot',
    ]);
    expect(simulateTtk({ ...base, def: archer, distance: 2 }).rotation.map((r) => r.id)).toEqual([
      'kick',
    ]);
  });

  it('says so when the kit does nothing at this range', () => {
    const archer = enemy({
      id: 'enemy_archer2',
      archetype: 'ranged',
      abilities: [ability({ id: 'shot', kind: 'projectile', rangeMin: 6, rangeMax: 16 })],
    });
    const report = simulateTtk({ ...base, def: archer, distance: 4 });
    expect(report.enemyDps).toBe(0);
    expect(report.notes.join(' ')).toMatch(/stare-down/);
  });

  it('counts a self-shield as zero damage rather than free DPS', () => {
    const report = simulateTtk({
      ...base,
      def: enemy({
        id: 'enemy_warded',
        abilities: [ability({ id: 'ward', kind: 'self_shield', weight: 1 })],
      }),
    });
    expect(report.enemyDps).toBe(0);
  });

  it('flags a boss fight that misses the COMBAT.md 60–120 s window', () => {
    const king = enemy({
      id: 'enemy_king',
      rank: 'zone_boss',
      levelMin: 12,
      levelMax: 12,
      phases: [{ atHpPct: 50 }],
      arenaRadius: 25,
    });
    const tooFast = simulateTtk({ ...base, def: king, enemyLevel: 12, playerDps: 100_000 });
    expect(tooFast.notes.join(' ')).toMatch(/60 s boss floor/);
    const tooSlow = simulateTtk({ ...base, def: king, enemyLevel: 12, playerDps: 1 });
    expect(tooSlow.notes.join(' ')).toMatch(/120 s boss ceiling/);
  });

  it('warns when the enemy wins the trade', () => {
    const report = simulateTtk({
      ...base,
      def: enemy({ id: 'enemy_brutal', statOverrides: { swingDamage: 500 } }),
      playerDps: 1,
    });
    expect(report.notes.join(' ')).toMatch(/enemy wins this trade/);
  });

  it('sees the whole kit a boss will ever unlock, not just phase 0', () => {
    const king = enemy({
      id: 'enemy_king2',
      rank: 'zone_boss',
      phases: [{ atHpPct: 50 }],
      abilities: [ability({ id: 'stomp' }), ability({ id: 'enraged', phase: 1 })],
    });
    expect(simulateTtk({ ...base, def: king }).rotation.map((r) => r.id)).toEqual([
      'stomp',
      'enraged',
    ]);
  });
});

describe('rotation preview', () => {
  it('is reproducible, so two tunings can be compared', () => {
    const def = enemy({
      id: 'enemy_rot',
      abilities: [ability({ id: 'jab', weight: 1 }), ability({ id: 'hook', weight: 1 })],
    });
    const first = previewRotation(def, 2, 12);
    expect(first).toHaveLength(12);
    expect(previewRotation(def, 2, 12)).toEqual(first);
    expect(new Set(first).size).toBe(2); // both actually show up
  });

  it('reflects the weights it is shown next to', () => {
    // The preview sits directly under the weight table. If its short sequence
    // is unrepresentative the two contradict each other and the editor cannot
    // tell which is lying — the reason this uses a mixed RNG, not a raw LCG.
    const def = enemy({
      id: 'enemy_weighted',
      abilities: [ability({ id: 'common', weight: 3 }), ability({ id: 'rare', weight: 1 })],
    });
    const picks = previewRotation(def, 2, 40);
    const commonShare = picks.filter((id) => id === 'common').length / picks.length;
    expect(commonShare).toBeGreaterThan(0.6); // true share is 0.75
    expect(commonShare).toBeLessThan(0.9);
  });
});
