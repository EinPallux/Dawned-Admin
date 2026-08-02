/**
 * Schema-form generator, step 1: introspect a shared zod object into a flat
 * field model (docs/ADMIN_DESIGN.md §2 "schema-form"). The RULE this encodes:
 * forms are derived from `@dawned/shared` schemas — a hand-rolled form that
 * shadows the schema is forbidden, so validation can never drift from the game.
 *
 * Rendering hints that zod cannot express (labels, help, units, control
 * overrides) come from per-type enhancement maps — the panel-side half of the
 * contract.
 */

import { z } from 'zod';

export type FieldKind = 'number' | 'boolean' | 'string' | 'enum';

export interface FieldModel {
  key: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
}

export interface FieldEnhancement {
  label: string;
  help?: string;
  /** Suffix shown after the control, e.g. '×' for multipliers. */
  unit?: string;
  /** Override the default control for the kind ('slider' needs min+max). */
  control?: 'slider' | 'textarea';
  step?: number;
}

export type Enhancements<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape & string]: FieldEnhancement;
};

/** Strip Default/Optional/Nullable wrappers down to the value schema. */
const unwrap = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodDefault ||
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable
    ) {
      // zod v4 wrapper defs expose the core-typed inner schema; at runtime it
      // is always a classic ZodType (we only ever pass classic schemas in).
      current = (current.def as unknown as { innerType: z.ZodType }).innerType;
      continue;
    }
    return current;
  }
};

export const buildFormModel = <Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): FieldModel[] => {
  const fields: FieldModel[] = [];
  for (const [key, raw] of Object.entries(schema.shape)) {
    const inner = unwrap(raw as z.ZodType);
    if (inner instanceof z.ZodNumber) {
      const field: FieldModel = { key, kind: 'number' };
      // zod v4 reports unbounded ranges as ±Infinity rather than null.
      if (inner.minValue !== null && Number.isFinite(inner.minValue)) field.min = inner.minValue;
      if (inner.maxValue !== null && Number.isFinite(inner.maxValue)) field.max = inner.maxValue;
      fields.push(field);
    } else if (inner instanceof z.ZodBoolean) {
      fields.push({ key, kind: 'boolean' });
    } else if (inner instanceof z.ZodEnum) {
      fields.push({ key, kind: 'enum', options: inner.options as string[] });
    } else if (inner instanceof z.ZodString) {
      const field: FieldModel = { key, kind: 'string' };
      if (inner.maxLength !== null) field.maxLength = inner.maxLength;
      fields.push(field);
    } else {
      // A shared schema grew a shape this generator can't render yet — that is
      // a build-this-feature signal, not something to hide behind a JSON blob.
      throw new Error(`schema-form: unsupported field "${key}" (${inner.constructor.name})`);
    }
  }
  return fields;
};

/** Per-field validation for inline errors: parse just this key's slice. */
export const validateField = <Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  key: string,
  value: unknown,
): string | null => {
  const fieldSchema = (schema.shape as unknown as Record<string, z.ZodType>)[key];
  if (!fieldSchema) return null;
  const result = fieldSchema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Invalid value.';
};
