/**
 * The inspector for a selected placed object (A3 · MAP_EDITOR.md §2.2–§2.4).
 *
 * Same two-tier shape the Abilities and Items editors use, and for the same
 * reason: **quick fields** for the handful of values the owner touches
 * constantly (a spawner's radius, a chest's loot table), and the full row as
 * schema-validated JSON underneath for everything else.
 *
 * Not the generated schema-form: these rows carry arrays of objects (a
 * spawner's entries, a zone's polygon) that the generator deliberately refuses
 * rather than flattening into something lossy. The JSON editor validates
 * against the SHARED schema on every keystroke, so it cannot save a row the
 * bake would reject — which is the property that actually matters.
 */

import { useMemo, useState } from 'react';
import {
  interactableSchema,
  poiSchema,
  propPlacementSchema,
  spawnerDefSchema,
  zoneSchema,
} from '@dawned/shared';
import type { z } from 'zod';
import type { PlacedObject } from './placement.js';

/** Which shared schema validates which layer. */
const SCHEMAS: Record<string, z.ZodType | undefined> = {
  prop: propPlacementSchema,
  spawner: spawnerDefSchema,
  poi: poiSchema,
  interactable: interactableSchema,
  zone: zoneSchema,
};

/** Fields promoted above the JSON, per layer. */
const QUICK: Record<string, string[]> = {
  prop: ['modelRef', 'scale', 'rotation', 'yOffset', 'solid', 'radius'],
  spawner: ['radius', 'respawnMs', 'campTag', 'nightOnly'],
  poi: ['name', 'kind', 'radius', 'xpBasis'],
  interactable: ['name', 'kind', 'modelRef', 'lootTableId', 'text'],
  zone: ['name', 'levelMin', 'levelMax', 'safe', 'settlement'],
  node: ['profession', 'tier', 'modelRef', 'respawnMs'],
  npc: ['name', 'modelRef', 'idleClip'],
};

export const ObjectInspector = ({
  object,
  readOnly,
  onApply,
  onDelete,
  onFrame,
}: {
  object: PlacedObject;
  readOnly: boolean;
  onApply: (def: Record<string, unknown>) => void;
  onDelete: () => void;
  onFrame: () => void;
}): React.JSX.Element => {
  // Seeded once per mount. The caller keys this component by object id, so
  // selecting a different thing remounts with fresh text — which beats an
  // effect that setStates on every selection change.
  const [text, setText] = useState(() => JSON.stringify(object.def, null, 2));
  const schema = SCHEMAS[object.layer];
  const quick = QUICK[object.layer] ?? [];

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      if (!schema) return { ok: true as const, value, issues: [] as string[] };
      const result = schema.safeParse(value);
      return result.success
        ? {
            ok: true as const,
            value: result.data as Record<string, unknown>,
            issues: [] as string[],
          }
        : {
            ok: false as const,
            value,
            issues: result.error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
          };
    } catch (error) {
      return {
        ok: false as const,
        value: {},
        issues: [(error as Error).message],
      };
    }
  }, [text, schema]);

  const dirty = text !== JSON.stringify(object.def, null, 2);

  const setField = (key: string, value: unknown): void => {
    try {
      const current = JSON.parse(text) as Record<string, unknown>;
      setText(JSON.stringify({ ...current, [key]: value }, null, 2));
    } catch {
      // Mid-edit invalid JSON: the quick fields simply do not apply until the
      // text parses again, which is less surprising than silently rewriting it.
    }
  };

  return (
    <section className="ws-panel me-card me-inspector">
      <h3>
        {object.layer} · {object.id}
      </h3>

      {quick.length > 0 && (
        <div className="me-quick">
          {quick.map((field) => (
            <QuickField
              key={field}
              name={field}
              value={parsed.value[field]}
              readOnly={readOnly}
              onChange={(value) => {
                setField(field, value);
              }}
            />
          ))}
        </div>
      )}

      <details className="me-more">
        <summary>Full row (JSON)</summary>
        <textarea
          className={`ws-textarea mono me-json${parsed.ok ? '' : ' is-invalid'}`}
          spellCheck={false}
          value={text}
          readOnly={readOnly}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </details>

      {!parsed.ok && (
        <ul className="abilities-errors">
          {parsed.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <div className="me-row">
        <button
          type="button"
          className="ws-btn ws-btn--primary"
          disabled={readOnly || !dirty || !parsed.ok}
          onClick={() => {
            onApply(parsed.value);
          }}
        >
          Apply
        </button>
        <button type="button" className="ws-btn" onClick={onFrame}>
          Frame <span className="ws-kbd">F</span>
        </button>
        <button
          type="button"
          className="ws-btn ws-btn--danger"
          disabled={readOnly}
          onClick={() => {
            // Zones are the one placed thing whose loss is expensive: the
            // ambience is hand-tuned, and publish BLOCKS on land that belongs
            // to no zone, so a stray delete turns into "why can I not publish?"
            // twenty minutes later. It is also the easiest to hit by accident —
            // a zone is selected by clicking its border, which runs across the
            // whole map. Undo covers it; a question covers it sooner.
            if (object.layer === 'zone') {
              const name = typeof object.def.name === 'string' ? object.def.name : object.id;
              if (!window.confirm(`Delete the zone "${name}"? Its ambience goes with it.`)) return;
            }
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </section>
  );
};

/** Scalars render as themselves; anything else is not a quick field. */
const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

/** One promoted field, typed from the value it currently holds. */
const QuickField = ({
  name,
  value,
  readOnly,
  onChange,
}: {
  name: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}): React.JSX.Element | null => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') {
    return (
      <label className="me-check">
        <input
          type="checkbox"
          checked={value}
          disabled={readOnly}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        {name}
      </label>
    );
  }
  const isNumber = typeof value === 'number';
  return (
    <label className="me-num">
      <span>{name}</span>
      <input
        className="ws-input"
        type={isNumber ? 'number' : 'text'}
        value={displayValue(value)}
        disabled={readOnly}
        {...(isNumber ? { step: 0.1 } : {})}
        onChange={(event) => {
          const raw = event.target.value;
          if (isNumber) {
            const next = Number(raw);
            if (Number.isFinite(next)) onChange(next);
            return;
          }
          // An emptied text field means null for the nullable refs (a chest
          // whose table was cleared), not the empty string the schema rejects.
          onChange(raw === '' ? null : raw);
        }}
      />
    </label>
  );
};
