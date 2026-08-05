/**
 * Scatter sets + the brush's options (A3-d · MAP_EDITOR.md §2.2).
 *
 * A scatter SET is the weighted asset list ("Weald ground cover": three
 * grasses, two ferns, mushroom at 5 %) — map-wide settings rather than a placed
 * object, which is why it is edited here and stored with world settings. The
 * brush then paints density of the selected set into the terrain.
 *
 * The set editor is deliberately plain: this is a list of models with weights,
 * and dressing it up as anything grander would hide the one thing that matters,
 * which is what the mix actually contains.
 */

import { useState } from 'react';
import type { ScatterSet } from '@dawned/shared';

export const ScatterCard = ({
  sets,
  models,
  activeSetId,
  radius,
  strength,
  readOnly,
  busy,
  onSelect,
  onRadius,
  onStrength,
  onSave,
  onDelete,
}: {
  sets: readonly ScatterSet[];
  models: readonly string[];
  activeSetId: string;
  radius: number;
  strength: number;
  readOnly: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRadius: (value: number) => void;
  onStrength: (value: number) => void;
  onSave: (set: ScatterSet) => void;
  onDelete: (id: string) => void;
}): React.JSX.Element => {
  const active = sets.find((set) => set.id === activeSetId) ?? null;
  const [expanded, setExpanded] = useState(false);

  const addSet = (): void => {
    const name = window.prompt('Name the scatter set', 'Ground cover');
    if (!name) return;
    const slug = `scatter_${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)}`;
    if (!slug || slug === 'scatter_') return;
    if (sets.some((set) => set.id === slug)) {
      window.alert('A set with that name already exists.');
      return;
    }
    // Ground cover, not a person: the manifest's first entry is a character
    // body, and a new set that defaults to scattering those across a hillside
    // is a joke the owner has to notice and undo.
    const first =
      models.find((model) => /nature|grass|bush|fern|flower|tree/i.test(model)) ?? models[0];
    if (!first) {
      window.alert('No baked models — run the asset pipeline first.');
      return;
    }
    onSave({
      id: slug,
      name,
      entries: [{ modelRef: first, weight: 1, scaleMin: 0.9, scaleMax: 1.1 }],
      densityPer100m2: 60,
      maxSlopeDeg: 35,
      minHeight: 0.2,
    });
    onSelect(slug);
    setExpanded(true);
  };

  const patch = (change: Partial<ScatterSet>): void => {
    if (active) onSave({ ...active, ...change });
  };

  return (
    <section className="ws-panel me-card">
      <h3>Scatter</h3>
      <div className="me-row">
        <select
          className="ws-input"
          value={activeSetId}
          onChange={(event) => {
            onSelect(event.target.value);
          }}
        >
          <option value="">— pick a set —</option>
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ws-btn me-tiny"
          disabled={readOnly || busy}
          onClick={addSet}
        >
          New set
        </button>
      </div>

      {!active && (
        <p className="me-hint">
          A set is the weighted list of models the brush paints. Make one to scatter a forest.
        </p>
      )}

      {active && (
        <>
          <div className="me-row">
            <label className="me-field">
              <span>radius</span>
              <input
                className="ws-input"
                type="number"
                min={2}
                max={80}
                value={radius}
                onChange={(event) => {
                  onRadius(Number(event.target.value));
                }}
              />
            </label>
            <label className="me-field">
              <span>strength</span>
              <input
                className="ws-input"
                type="number"
                min={0.05}
                max={1}
                step={0.05}
                value={strength}
                onChange={(event) => {
                  onStrength(Number(event.target.value));
                }}
              />
            </label>
          </div>
          <p className="me-hint">
            Paint to add cover, hold <b>Ctrl</b> to clear it. Density is stored per 4 m cell — the
            bake re-scatters from it, so painting is cheap and repeatable.
          </p>

          <details
            open={expanded}
            onToggle={(event) => {
              setExpanded(event.currentTarget.open);
            }}
            className="me-more"
          >
            <summary>
              {active.name} — {active.entries.length} models
            </summary>

            <div className="me-row">
              <label className="me-field">
                <span>per 100 m²</span>
                <input
                  className="ws-input"
                  type="number"
                  min={0.1}
                  max={400}
                  value={active.densityPer100m2}
                  disabled={readOnly}
                  onChange={(event) => {
                    patch({ densityPer100m2: Number(event.target.value) });
                  }}
                />
              </label>
              <label className="me-field">
                <span>max slope°</span>
                <input
                  className="ws-input"
                  type="number"
                  min={0}
                  max={90}
                  value={active.maxSlopeDeg}
                  disabled={readOnly}
                  onChange={(event) => {
                    patch({ maxSlopeDeg: Number(event.target.value) });
                  }}
                />
              </label>
              <label className="me-field">
                <span>min height</span>
                <input
                  className="ws-input"
                  type="number"
                  min={-64}
                  max={256}
                  value={active.minHeight}
                  disabled={readOnly}
                  onChange={(event) => {
                    patch({ minHeight: Number(event.target.value) });
                  }}
                />
              </label>
            </div>

            {active.entries.map((entry, index) => (
              <div key={`${entry.modelRef}:${index}`} className="me-row">
                <select
                  className="ws-input"
                  value={entry.modelRef}
                  disabled={readOnly}
                  onChange={(event) => {
                    patch({
                      entries: active.entries.map((row, at) =>
                        at === index ? { ...row, modelRef: event.target.value } : row,
                      ),
                    });
                  }}
                >
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <label className="me-field">
                  <span>×</span>
                  <input
                    className="ws-input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={entry.weight}
                    disabled={readOnly}
                    onChange={(event) => {
                      patch({
                        entries: active.entries.map((row, at) =>
                          at === index ? { ...row, weight: Number(event.target.value) } : row,
                        ),
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ws-btn me-tiny"
                  disabled={readOnly || active.entries.length <= 1}
                  title="Remove this model from the mix"
                  onClick={() => {
                    patch({ entries: active.entries.filter((_, at) => at !== index) });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}

            <div className="me-row">
              <button
                type="button"
                className="ws-btn me-tiny"
                disabled={readOnly || active.entries.length >= 12 || models.length === 0}
                onClick={() => {
                  const next = models.find(
                    (model) => !active.entries.some((entry) => entry.modelRef === model),
                  );
                  if (!next) return;
                  patch({
                    entries: [
                      ...active.entries,
                      { modelRef: next, weight: 1, scaleMin: 0.9, scaleMax: 1.1 },
                    ],
                  });
                }}
              >
                Add model
              </button>
              <button
                type="button"
                className="ws-btn me-tiny ws-btn--danger"
                disabled={readOnly}
                onClick={() => {
                  if (window.confirm(`Delete the scatter set "${active.name}"?`)) {
                    onDelete(active.id);
                  }
                }}
              >
                Delete set
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
};
