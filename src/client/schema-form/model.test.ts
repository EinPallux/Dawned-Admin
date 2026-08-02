/**
 * The generator is the drift barrier between shared schemas and rendered forms
 * — these tests pin its behavior against the real world-settings schema plus
 * synthetic shapes for the kinds world settings doesn't use yet.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { worldSettingsSchema } from '@dawned/shared';
import { buildFormModel, validateField } from './model.js';

describe('buildFormModel', () => {
  it('derives the world-settings form from the shared schema', () => {
    const model = buildFormModel(worldSettingsSchema);
    expect(model).toEqual([
      { key: 'xpRate', kind: 'number', min: 0.25, max: 8 },
      { key: 'dayNightEnabled', kind: 'boolean' },
      { key: 'motd', kind: 'string', maxLength: 300 },
    ]);
  });

  it('handles enums and unbounded numbers', () => {
    const model = buildFormModel(
      z.object({
        rarity: z.enum(['common', 'rare', 'epic']),
        weight: z.number(),
      }),
    );
    expect(model).toEqual([
      { key: 'rarity', kind: 'enum', options: ['common', 'rare', 'epic'] },
      { key: 'weight', kind: 'number' },
    ]);
  });

  it('refuses shapes it cannot render instead of silently degrading', () => {
    expect(() => buildFormModel(z.object({ nested: z.object({ a: z.number() }) }))).toThrow(
      /unsupported field "nested"/,
    );
  });
});

describe('validateField', () => {
  it('surfaces zod messages per field', () => {
    expect(validateField(worldSettingsSchema, 'xpRate', 99)).toMatch(/8/);
    expect(validateField(worldSettingsSchema, 'xpRate', 2)).toBeNull();
    expect(validateField(worldSettingsSchema, 'motd', 'x'.repeat(301))).toMatch(/300/);
  });
});
