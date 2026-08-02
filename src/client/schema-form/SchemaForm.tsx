/**
 * Schema-form renderer: field models (from the shared zod schema) + panel-side
 * enhancements → Workshop controls with inline zod validation. Values are held
 * by the page; this component is a pure projection.
 */

import type { z } from 'zod';
import type { FieldEnhancement, FieldModel } from './model.js';
import { validateField } from './model.js';

export interface SchemaFormProps<Shape extends z.ZodRawShape> {
  schema: z.ZodObject<Shape>;
  model: FieldModel[];
  enhancements: Record<string, FieldEnhancement>;
  value: Record<string, unknown>;
  /** Keys whose draft differs from published — badged per row. */
  draftKeys?: string[];
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}

export const SchemaForm = <Shape extends z.ZodRawShape>({
  schema,
  model,
  enhancements,
  value,
  draftKeys = [],
  disabled = false,
  onChange,
}: SchemaFormProps<Shape>) => {
  return (
    <div className="ws-panel form-rows">
      {model.map((field) => {
        const enhancement = enhancements[field.key] ?? { label: field.key };
        const current = value[field.key];
        const error = validateField(schema, field.key, current);
        const isDraft = draftKeys.includes(field.key);
        return (
          <div className="form-row" key={field.key}>
            <div className="meta">
              <span className="ws-label">
                {enhancement.label}{' '}
                {isDraft && <span className="ws-badge ws-badge--draft">draft</span>}
              </span>
              <span className="ws-help mono">{field.key}</span>
              {enhancement.help && <span className="ws-help">{enhancement.help}</span>}
            </div>
            <div className="control">
              <FieldControl
                field={field}
                enhancement={enhancement}
                value={current}
                disabled={disabled}
                invalid={error !== null}
                onChange={(next) => {
                  onChange(field.key, next);
                }}
              />
              {error && <span className="ws-error">{error}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const FieldControl = ({
  field,
  enhancement,
  value,
  disabled,
  invalid,
  onChange,
}: {
  field: FieldModel;
  enhancement: FieldEnhancement;
  value: unknown;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) => {
  switch (field.kind) {
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number.NaN;
      return (
        <div className="control-line">
          <input
            className="ws-input ws-input--mono"
            type="number"
            value={Number.isNaN(numeric) ? '' : numeric}
            min={field.min}
            max={field.max}
            step={enhancement.step ?? 0.05}
            disabled={disabled}
            aria-invalid={invalid}
            onChange={(event) => {
              onChange(event.target.value === '' ? Number.NaN : Number(event.target.value));
            }}
          />
          {enhancement.unit && <span className="unit">{enhancement.unit}</span>}
          {field.min !== undefined && field.max !== undefined && (
            <span className="ws-help mono">
              {field.min}–{field.max}
            </span>
          )}
        </div>
      );
    }
    case 'boolean': {
      const checked = value === true;
      return (
        <div className="control-line">
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            className="toggle"
            disabled={disabled}
            onClick={() => {
              onChange(!checked);
            }}
          />
          <span className="ws-help">{checked ? 'Enabled' : 'Disabled'}</span>
        </div>
      );
    }
    case 'enum':
      return (
        <select
          className="ws-select"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case 'string': {
      const text = typeof value === 'string' ? value : '';
      const long = enhancement.control === 'textarea' || (field.maxLength ?? 0) > 120;
      if (long) {
        return (
          <textarea
            className="ws-textarea"
            value={text}
            maxLength={field.maxLength}
            disabled={disabled}
            aria-invalid={invalid}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        );
      }
      return (
        <input
          className="ws-input"
          value={text}
          maxLength={field.maxLength}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    }
  }
};
