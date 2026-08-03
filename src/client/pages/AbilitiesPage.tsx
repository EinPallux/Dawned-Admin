/**
 * Abilities editor (A1): the first FULL content editor and the proving ground
 * of the publish pipeline. Left: every ability grouped by class. Right: the
 * selected def — hot tuning numbers surfaced as fields, the complete def as
 * validated JSON (the SHARED abilityDefSchema is the only validator; the form
 * can never drift from the game). Saves write DRAFTS; Publish validates the
 * whole set, copies drafts live, and hot-reloads the game server.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { abilityDefSchema, type AbilityDef } from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

interface AbilityListEntry {
  id: string;
  classId: string;
  binding: AbilityDef['binding'];
  name: string;
  hasDraft: boolean;
  hasPublished: boolean;
  def: AbilityDef;
}

interface DiffEntry {
  id: string;
  name: string;
  kind: 'added' | 'changed';
  changedPaths: string[];
}

interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  reload: { ok: boolean; note: string };
}

const CLASS_ORDER = ['warrior', 'rogue', 'mage', 'cleric'];

const bindingLabel = (binding: AbilityDef['binding']): string =>
  binding.kind === 'slot'
    ? `slot ${binding.slot}`
    : binding.kind === 'basic'
      ? `basic ${binding.step}`
      : 'RMB';

/** Fresh-def skeleton for "+ new" (valid once the author fills the blanks). */
const skeleton = (classId: string): string =>
  JSON.stringify(
    {
      id: `ability_${classId}_new`,
      classId,
      binding: { kind: 'slot', slot: 1 },
      name: 'New Ability',
      unlockLevel: 1,
      cost: { type: 'none', amount: 0 },
      cooldownMs: 8000,
      targeting: { kind: 'melee_arc', angleDeg: 90, reach: 3 },
      effects: [{ kind: 'damage', coef: 1.0, school: 'physical' }],
      anim: { clip: 'Sword_Attack', clipSeconds: 1.0, durationMs: 600 },
    },
    null,
    2,
  );

/** The tuning numbers an owner touches weekly, lifted out of the JSON. */
const QUICK_PATHS: { path: string[]; label: string }[] = [
  { path: ['cost', 'amount'], label: 'cost' },
  { path: ['cooldownMs'], label: 'cooldown ms' },
  { path: ['castMs'], label: 'cast ms' },
  { path: ['unlockLevel'], label: 'unlock lvl' },
  { path: ['anim', 'durationMs'], label: 'swing ms' },
];

const getPath = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined,
    value,
  );

const setPath = (root: Record<string, unknown>, path: string[], value: unknown): void => {
  let node: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]!];
    if (typeof next !== 'object' || next === null) return;
    node = next as Record<string, unknown>;
  }
  node[path[path.length - 1]!] = value;
};

export const AbilitiesPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';

  const list = useQuery({
    queryKey: ['abilities'],
    queryFn: () => apiGet<{ abilities: AbilityListEntry[] }>('/abilities'),
  });
  const diff = useQuery({
    queryKey: ['abilities-diff'],
    queryFn: () => apiGet<{ entries: DiffEntry[] }>('/publish/abilities/diff'),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState<string>('');
  const [baseline, setBaseline] = useState<string>('');
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  /** Which ability the buffer holds — reset during render on selection change. */
  const [bufferFor, setBufferFor] = useState<string | null>(null);

  const entries = useMemo(() => list.data?.abilities ?? [], [list.data]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  // Selection changed: load the def (draft first, else published) into the
  // buffer — the React adjust-state-during-render pattern, no effect needed.
  if (selected && bufferFor !== selected.id) {
    setBufferFor(selected.id);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
  }

  const parsed = useMemo(() => {
    try {
      return abilityDefSchema.safeParse(JSON.parse(text) as unknown);
    } catch (error) {
      return {
        success: false as const,
        error: { issues: [{ path: [], message: `not JSON: ${(error as Error).message}` }] },
      };
    }
  }, [text]);

  const dirty = text !== baseline;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['abilities'] });
    void queryClient.invalidateQueries({ queryKey: ['abilities-diff'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = useMutation({
    mutationFn: async (def: AbilityDef) => apiPut(`/abilities/${def.id}`, def),
    onSuccess: (_data, def) => {
      setBaseline(text);
      setSelectedId(def.id);
      invalidate();
    },
  });
  const discard = useMutation({
    mutationFn: async (id: string) => apiDelete(`/abilities/${id}/draft`),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/abilities'),
    onSuccess: (result) => {
      setPublishState(result);
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.payload) {
        setPublishState(error.payload as PublishResult);
      }
    },
  });

  const doSave = () => {
    if (parsed.success && canWrite && !save.isPending) save.mutate(parsed.data);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty) doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const quickEdit = (path: string[], raw: string) => {
    try {
      const object = JSON.parse(text) as Record<string, unknown>;
      setPath(object, path, raw === '' ? 0 : Number(raw));
      setText(JSON.stringify(object, null, 2));
    } catch {
      // Buffer isn't JSON right now — quick fields stay inert until it is.
    }
  };

  const pendingCount = diff.data?.entries.length ?? 0;

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Abilities</h2>
          {canWrite ? (
            <button
              className="ws-btn"
              onClick={() => {
                setSelectedId(null);
                setBufferFor(null);
                setText(skeleton('warrior'));
                setBaseline('');
              }}
            >
              + new
            </button>
          ) : null}
        </header>
        {CLASS_ORDER.map((classId) => {
          const group = entries.filter((entry) => entry.classId === classId);
          if (group.length === 0) return null;
          return (
            <section key={classId} className="abilities-group">
              <h3 className="abilities-group-title">{classId}</h3>
              {group.map((entry) => (
                <button
                  key={entry.id}
                  className={`abilities-row${entry.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(entry.id);
                  }}
                >
                  <span className="abilities-row-binding">{bindingLabel(entry.binding)}</span>
                  <span className="abilities-row-name">{entry.name}</span>
                  {entry.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                </button>
              ))}
            </section>
          );
        })}
        {entries.length === 0 && !list.isLoading ? (
          <p className="ws-help">No abilities yet — “+ new” starts the first one.</p>
        ) : null}
      </aside>

      <section className="abilities-editor ws-panel">
        <header className="panel-head">
          <h2>{selected ? selected.id : 'New draft'}</h2>
          <div className="abilities-editor-actions">
            {selected?.hasDraft && canWrite ? (
              <button
                className="ws-btn"
                disabled={discard.isPending}
                onClick={() => {
                  discard.mutate(selected.id);
                }}
              >
                discard draft
              </button>
            ) : null}
            <button
              className="ws-btn ws-btn--primary"
              disabled={!canWrite || !parsed.success || !dirty || save.isPending}
              onClick={doSave}
            >
              {save.isPending ? 'saving…' : 'save draft (Ctrl+S)'}
            </button>
          </div>
        </header>

        {parsed.success ? (
          <div className="abilities-quick">
            {QUICK_PATHS.map(({ path, label }) => {
              const value = getPath(parsed.data, path);
              if (typeof value !== 'number') return null;
              return (
                <label key={path.join('.')} className="abilities-quick-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    value={value}
                    disabled={!canWrite}
                    onChange={(event) => {
                      quickEdit(path, event.target.value);
                    }}
                  />
                </label>
              );
            })}
          </div>
        ) : null}

        <textarea
          className={`ws-textarea mono abilities-json${parsed.success ? '' : ' is-invalid'}`}
          spellCheck={false}
          value={text}
          readOnly={!canWrite}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        {!parsed.success ? (
          <ul className="abilities-errors">
            {parsed.error.issues.slice(0, 6).map((issue, index) => (
              <li key={index}>
                <code>{issue.path.join('.') || '<root>'}</code> {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        {save.error instanceof ApiRequestError ? (
          <p className="abilities-save-error">{save.error.message}</p>
        ) : null}
      </section>

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {(diff.data?.entries ?? []).map((entry) => (
          <div key={entry.id} className="abilities-diff-row">
            <span className={`abilities-diff-kind is-${entry.kind}`}>{entry.kind}</span>
            <span className="abilities-diff-id">{entry.id}</span>
            <span className="abilities-diff-paths">
              {entry.changedPaths.slice(0, 4).join(', ')}
            </span>
          </div>
        ))}
        {pendingCount === 0 ? <p className="ws-help">No drafts pending.</p> : null}
        <button
          className="ws-btn ws-btn--gold abilities-publish-button"
          disabled={!canWrite || pendingCount === 0 || publish.isPending}
          onClick={() => {
            if (window.confirm(`Publish ${pendingCount} draft(s) to the live game?`)) {
              publish.mutate();
            }
          }}
        >
          {publish.isPending ? 'publishing…' : 'validate + publish'}
        </button>
        {publishState ? (
          <div className={`abilities-publish-result${publishState.ok ? '' : ' is-error'}`}>
            {publishState.ok ? (
              <>
                <p>Published {publishState.published} — live.</p>
                <p className="abilities-reload-note">
                  {publishState.reload.ok
                    ? `Game reloaded: ${publishState.reload.note}`
                    : `Game not reloaded: ${publishState.reload.note}`}
                </p>
              </>
            ) : (
              <ul>
                {publishState.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
};
