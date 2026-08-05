/**
 * Selection sets, isolation and prefabs (A3-d · MAP_EDITOR.md §2.2, §3).
 *
 * All three are about working on PART of a map that has thousands of things in
 * it: name a group so you can come back to it, hide everything else so you can
 * see what you are doing, and keep a group you will place again.
 */

import type { Collection, PrefabData } from './collections.js';
import { prefabDataSchema, prefabSpread, selectionDataSchema } from './collections.js';

export const CollectionsCard = ({
  collections,
  selectedCount,
  isolated,
  armedPrefabId,
  readOnly,
  onSaveSelection,
  onLoadSelection,
  onMakePrefab,
  onArmPrefab,
  onDelete,
  onToggleIsolate,
  onClearSelection,
}: {
  collections: readonly Collection[];
  selectedCount: number;
  isolated: boolean;
  armedPrefabId: string | null;
  readOnly: boolean;
  onSaveSelection: (name: string) => void;
  onLoadSelection: (ids: string[]) => void;
  onMakePrefab: (name: string) => void;
  onArmPrefab: (id: string | null) => void;
  onDelete: (id: string) => void;
  onToggleIsolate: () => void;
  onClearSelection: () => void;
}): React.JSX.Element => {
  const selections = collections.filter((entry) => entry.kind === 'selection');
  const prefabs = collections.filter((entry) => entry.kind === 'prefab');

  const ask = (what: string, then: (name: string) => void): void => {
    const name = window.prompt(`Name this ${what}`, '');
    if (name?.trim()) then(name.trim());
  };

  return (
    <section className="ws-panel me-card">
      <h3>Selection</h3>
      <div className="me-row">
        <span className="me-hint">
          {selectedCount === 0
            ? 'Click a marker; Shift+click adds, Shift+drag boxes.'
            : `${selectedCount} selected`}
        </span>
        {selectedCount > 0 && (
          <button type="button" className="ws-btn me-tiny" onClick={onClearSelection}>
            clear
          </button>
        )}
        <button
          type="button"
          className={`ws-btn me-tiny${isolated ? ' me-on' : ''}`}
          disabled={selectedCount === 0 && !isolated}
          title="Hide everything that is not selected"
          onClick={onToggleIsolate}
        >
          isolate
        </button>
      </div>

      <div className="me-row">
        <button
          type="button"
          className="ws-btn me-tiny"
          disabled={readOnly || selectedCount === 0}
          onClick={() => {
            ask('selection set', onSaveSelection);
          }}
        >
          Save set
        </button>
        <button
          type="button"
          className="ws-btn me-tiny"
          disabled={readOnly || selectedCount === 0}
          title="Keep this group's layout to stamp elsewhere"
          onClick={() => {
            ask('prefab', onMakePrefab);
          }}
        >
          Make prefab
        </button>
      </div>

      {selections.length > 0 && (
        <table className="me-budget">
          <tbody>
            {selections.map((entry) => {
              const parsed = selectionDataSchema.safeParse(entry.data);
              const count = parsed.success ? parsed.data.ids.length : 0;
              return (
                <tr key={entry.id}>
                  <td>
                    <button
                      type="button"
                      className="me-link"
                      onClick={() => {
                        if (parsed.success) onLoadSelection(parsed.data.ids);
                      }}
                    >
                      {entry.name}
                    </button>
                  </td>
                  <td>{count}</td>
                  <td>
                    <button
                      type="button"
                      className="ws-btn me-tiny"
                      disabled={readOnly}
                      onClick={() => {
                        onDelete(entry.id);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {prefabs.length > 0 && (
        <>
          <h3 className="me-subhead">Prefabs</h3>
          <table className="me-budget">
            <tbody>
              {prefabs.map((entry) => {
                const parsed = prefabDataSchema.safeParse(entry.data);
                const prefab: PrefabData | null = parsed.success ? parsed.data : null;
                const armed = armedPrefabId === entry.id;
                return (
                  <tr key={entry.id}>
                    <td>
                      <button
                        type="button"
                        className={`me-link${armed ? ' is-on' : ''}`}
                        disabled={readOnly || !prefab}
                        title={armed ? 'Click the ground to stamp' : 'Arm for stamping'}
                        onClick={() => {
                          onArmPrefab(armed ? null : entry.id);
                        }}
                      >
                        {armed ? '▸ ' : ''}
                        {entry.name}
                      </button>
                    </td>
                    <td>
                      {prefab ? `${prefab.items.length} · ${prefabSpread(prefab)} m` : 'broken'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ws-btn me-tiny"
                        disabled={readOnly}
                        onClick={() => {
                          onDelete(entry.id);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {armedPrefabId && (
            <p className="me-hint">Click the ground to stamp it. Esc puts it down.</p>
          )}
        </>
      )}
    </section>
  );
};
