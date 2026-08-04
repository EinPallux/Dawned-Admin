/**
 * Progression editors (A1-b, game P7): the XP curve and the skill trees, with
 * ONE publish rail — the curve and the trees ship as a single system, so a
 * publish validates and copies both together.
 *
 * Skill Trees tab — left: class picker + the 3 branch columns in lattice
 * order (tier gates annotated); right: the selected node as validated JSON
 * with the weekly-tuning numbers lifted out (tier, order, maxRanks). Saves
 * write DRAFTS through the shared skillNodeDefSchema.
 * XP Curve tab — all 29 rows with per-row "XP to next" inputs and a
 * cumulative readout; edits stage drafts row by row.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CLASS_BRANCHES,
  TIER_LEVEL_GATES,
  TIER_POINT_THRESHOLDS,
  skillNodeDefSchema,
  xpToNextDefault,
  type SkillNodeDef,
  type XpCurveEntry,
} from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

interface CurveEntryRow {
  id: string;
  level: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: XpCurveEntry;
}

interface NodeRow {
  id: string;
  classId: string;
  branch: string;
  name: string;
  tier: number;
  order: number;
  capstone: boolean;
  maxRanks: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: SkillNodeDef;
}

interface ProgressionDiff {
  curve: { id: string; kind: 'added' | 'changed' }[];
  nodes: { id: string; name: string; kind: 'added' | 'changed' }[];
}

interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  reload: { ok: boolean; note: string };
}

const CLASS_ORDER = ['warrior', 'rogue', 'mage', 'cleric'] as const;

const gateLabel = (node: NodeRow): string =>
  node.capstone
    ? '8 pts + L25'
    : `${TIER_POINT_THRESHOLDS[node.tier - 1] ?? 0} pts / L${TIER_LEVEL_GATES[node.tier - 1] ?? 2}`;

export const ProgressionPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';
  const [tab, setTab] = useState<'trees' | 'curve'>('trees');
  const [classId, setClassId] = useState<(typeof CLASS_ORDER)[number]>('warrior');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [bufferFor, setBufferFor] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  /** Staged curve edits by row id (committed on blur/save). */
  const [curveEdits, setCurveEdits] = useState<Record<string, number>>({});

  const nodes = useQuery({
    queryKey: ['skill-nodes'],
    queryFn: () => apiGet<{ nodes: NodeRow[] }>('/skill-nodes'),
  });
  const curve = useQuery({
    queryKey: ['xp-curve'],
    queryFn: () => apiGet<{ entries: CurveEntryRow[] }>('/xp-curve'),
  });
  const diff = useQuery({
    queryKey: ['progression-diff'],
    queryFn: () => apiGet<ProgressionDiff>('/publish/progression/diff'),
  });

  const allNodes = useMemo(() => nodes.data?.nodes ?? [], [nodes.data]);
  const selected = allNodes.find((node) => node.id === selectedId) ?? null;

  if (selected && bufferFor !== selected.id) {
    setBufferFor(selected.id);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
  }

  const parsed = useMemo(() => {
    try {
      return skillNodeDefSchema.safeParse(JSON.parse(text) as unknown);
    } catch (error) {
      return {
        success: false as const,
        error: { issues: [{ path: [], message: `not JSON: ${(error as Error).message}` }] },
      };
    }
  }, [text]);
  const dirty = text !== baseline;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['skill-nodes'] });
    void queryClient.invalidateQueries({ queryKey: ['xp-curve'] });
    void queryClient.invalidateQueries({ queryKey: ['progression-diff'] });
  };

  const saveNode = useMutation({
    mutationFn: async (def: SkillNodeDef) => apiPut(`/skill-nodes/${def.id}`, def),
    onSuccess: (_data, def) => {
      setBaseline(text);
      setSelectedId(def.id);
      invalidate();
    },
  });
  const discardNode = useMutation({
    mutationFn: async (id: string) => apiDelete(`/skill-nodes/${id}/draft`),
    onSuccess: invalidate,
  });
  const saveCurveRow = useMutation({
    mutationFn: async (entry: XpCurveEntry) => apiPut(`/xp-curve/${entry.id}`, entry),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/progression'),
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

  const doSaveNode = () => {
    if (parsed.success && canWrite && !saveNode.isPending) saveNode.mutate(parsed.data);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (tab === 'trees' && dirty) doSaveNode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const branches = CLASS_BRANCHES[classId];
  const pendingCount = (diff.data?.curve.length ?? 0) + (diff.data?.nodes.length ?? 0);
  // Cumulative XP per row, precomputed over the STAGED values (edits included).
  // Plain loop, no closure over the accumulator — the compiler lint forbids
  // captured reassignment during render.
  const curveRows = useMemo(() => {
    const entries = curve.data?.entries ?? [];
    const out: ((typeof entries)[number] & { value: number; cumulativeBefore: number })[] = [];
    let running = 0;
    for (const row of entries) {
      const value = curveEdits[row.id] ?? row.def.xpToNext;
      out.push({ ...row, value, cumulativeBefore: running });
      running += value;
    }
    return out;
  }, [curve.data, curveEdits]);

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Progression</h2>
          <div className="progression-tabs">
            <button
              className={`ws-btn${tab === 'trees' ? ' ws-btn--primary' : ''}`}
              onClick={() => {
                setTab('trees');
              }}
            >
              trees
            </button>
            <button
              className={`ws-btn${tab === 'curve' ? ' ws-btn--primary' : ''}`}
              onClick={() => {
                setTab('curve');
              }}
            >
              xp curve
            </button>
          </div>
        </header>
        {tab === 'trees' ? (
          <>
            <div className="progression-classes">
              {CLASS_ORDER.map((entry) => (
                <button
                  key={entry}
                  className={`ws-btn${entry === classId ? ' ws-btn--primary' : ''}`}
                  onClick={() => {
                    setClassId(entry);
                  }}
                >
                  {entry}
                </button>
              ))}
            </div>
            {branches.map((branch) => {
              const column = allNodes.filter(
                (node) => node.classId === classId && node.branch === branch.id,
              );
              return (
                <section key={branch.id} className="abilities-group">
                  <h3 className="abilities-group-title">
                    {branch.name} <span className="ws-help">({branch.theme})</span>
                  </h3>
                  {column.map((node) => (
                    <button
                      key={node.id}
                      className={`abilities-row${node.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(node.id);
                      }}
                    >
                      <span className="abilities-row-binding">
                        {node.capstone ? 'CAP' : `t${node.tier}`}
                      </span>
                      <span className="abilities-row-name">
                        {node.name} {node.maxRanks > 1 ? `×${node.maxRanks}` : ''}
                      </span>
                      {node.hasDraft ? (
                        <span className="abilities-row-draft" title="draft" />
                      ) : null}
                    </button>
                  ))}
                  {column.length === 0 ? <p className="ws-help">no nodes yet</p> : null}
                </section>
              );
            })}
          </>
        ) : (
          <p className="ws-help">
            29 rows, one per level. The formula default is round₁₀(90 × L^1.75); edits stage drafts
            per row and publish with the trees.
          </p>
        )}
      </aside>

      {tab === 'trees' ? (
        <section className="abilities-editor ws-panel">
          <header className="panel-head">
            <h2>{selected ? selected.id : 'Select a node'}</h2>
            <div className="abilities-editor-actions">
              {selected ? <span className="ws-help">unlock: {gateLabel(selected)}</span> : null}
              {selected?.hasDraft && canWrite ? (
                <button
                  className="ws-btn"
                  disabled={discardNode.isPending}
                  onClick={() => {
                    discardNode.mutate(selected.id);
                  }}
                >
                  discard draft
                </button>
              ) : null}
              <button
                className="ws-btn ws-btn--primary"
                disabled={!canWrite || !parsed.success || !dirty || saveNode.isPending}
                onClick={doSaveNode}
              >
                {saveNode.isPending ? 'saving…' : 'save draft (Ctrl+S)'}
              </button>
            </div>
          </header>
          {selected ? (
            <>
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
              {saveNode.error instanceof ApiRequestError ? (
                <p className="abilities-save-error">{saveNode.error.message}</p>
              ) : null}
            </>
          ) : (
            <p className="ws-help">
              Pick a node on the left. Each rank stores its TOTAL effect (cumulative — “+3% per
              rank” reads [3, 6, 9]); the shared schema validates every save.
            </p>
          )}
        </section>
      ) : (
        <section className="abilities-editor ws-panel">
          <header className="panel-head">
            <h2>XP to next level</h2>
          </header>
          <table className="progression-curve">
            <thead>
              <tr>
                <th>level</th>
                <th>xp to next</th>
                <th>cumulative</th>
                <th>formula</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {curveRows.map((row) => {
                const staged = curveEdits[row.id];
                const value = row.value;
                const cumulativeHere = row.cumulativeBefore;
                const formulaValue = xpToNextDefault(row.level);
                return (
                  <tr key={row.id}>
                    <td>{row.level}</td>
                    <td>
                      <input
                        type="number"
                        step={10}
                        min={1}
                        value={value}
                        disabled={!canWrite}
                        onChange={(event) => {
                          setCurveEdits((edits) => ({
                            ...edits,
                            [row.id]: Number(event.target.value),
                          }));
                        }}
                        onBlur={() => {
                          if (staged !== undefined && staged !== row.def.xpToNext && staged >= 1) {
                            saveCurveRow.mutate({ ...row.def, xpToNext: Math.round(staged) });
                          }
                        }}
                      />
                      {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                    </td>
                    <td className="ws-help">{cumulativeHere.toLocaleString()}</td>
                    <td className="ws-help">{formulaValue.toLocaleString()}</td>
                    <td>
                      {canWrite && value !== formulaValue ? (
                        <button
                          className="ws-btn"
                          onClick={() => {
                            setCurveEdits((edits) => ({ ...edits, [row.id]: formulaValue }));
                            saveCurveRow.mutate({ ...row.def, xpToNext: formulaValue });
                          }}
                        >
                          reset
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {curveRows.length === 0 && !curve.isLoading ? (
            <p className="ws-help">
              No curve rows yet — run the P7 authoring script or publish drafts; the game uses the
              formula defaults until then.
            </p>
          ) : null}
        </section>
      )}

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {(diff.data?.nodes ?? []).slice(0, 30).map((entry) => (
          <div key={entry.id} className="abilities-diff-row">
            <span className={`abilities-diff-kind is-${entry.kind}`}>{entry.kind}</span>
            <span className="abilities-diff-id">{entry.id}</span>
          </div>
        ))}
        {(diff.data?.curve ?? []).slice(0, 10).map((entry) => (
          <div key={entry.id} className="abilities-diff-row">
            <span className={`abilities-diff-kind is-${entry.kind}`}>{entry.kind}</span>
            <span className="abilities-diff-id">{entry.id}</span>
          </div>
        ))}
        {pendingCount === 0 ? <p className="ws-help">No drafts pending.</p> : null}
        <button
          className="ws-btn ws-btn--gold abilities-publish-button"
          disabled={!canWrite || pendingCount === 0 || publish.isPending}
          onClick={() => {
            if (window.confirm(`Publish ${pendingCount} progression draft(s) to the live game?`)) {
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
                {publishState.problems.slice(0, 12).map((problem, index) => (
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
