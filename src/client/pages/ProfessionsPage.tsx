/**
 * Resource-node editor (A1-e, game P10): what a birch, a copper vein, a
 * silverleaf patch and a shoal ARE.
 *
 * The definition/placement split is the same one enemies use — this page owns
 * the definitions, the map editor's `node` layer owns where they stand — so a
 * retune of birchwood is one row here rather than two hundred placements.
 *
 * The panel that matters is the **gathering preview**: it drives the game's own
 * `rollGather` at a chosen profession level, so the items it lists are the
 * items the server will hand over. It also answers the two questions a node's
 * numbers are really about — how long a gather takes at that level, and what a
 * single node yields per hour if nobody else touches it — because a respawn
 * time only means something next to a channel time.
 *
 * Fishing nodes get one more block: every fish on the node with the bar
 * difficulty its rarity buys. A legendary on a T1 shoal is a fish nobody lands,
 * and that is invisible in the JSON.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_PROFESSION_LEVEL,
  gateForTier,
  profXpToNext,
  resourceNodeDefSchema,
  totalProfXpForLevel,
  type ItemDef,
  type ResourceNodeDef,
} from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

interface NodeRow {
  id: string;
  name: string;
  profession: string;
  tier: number;
  gate: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: ResourceNodeDef;
}

interface ItemRow {
  id: string;
  name: string;
  rarity: string;
  def: ItemDef;
}

interface NodeDiff {
  added: string[];
  changed: string[];
  unchanged: string[];
}

interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  warnings: string[];
  reload: { ok: boolean; note: string };
}

interface GatherPreview {
  profLevel: number;
  channelMs: number;
  profXp: number;
  procPct: number;
  perHundred: { itemId: string; qty: number }[];
  perHourOneNode: number;
  fishing: { itemId: string; driftSpeed: number; markerHalf: number }[] | null;
}

const PROFESSION_LABEL: Record<string, string> = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  herbalism: 'Herbalism',
  fishing: 'Fishing',
};

/** Order the owner thinks in (PROFESSIONS.md §2–5 lists them this way). */
const PROFESSION_ORDER = ['woodcutting', 'mining', 'herbalism', 'fishing'];

const secondsOf = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * How many gathers it takes to walk a profession from its tier gate to the
 * next one, at this node's XP rate. The number the owner actually wants when
 * asking "is this enough content for T2?".
 */
const gathersToNextGate = (tier: number, profXp: number): number | null => {
  const from = gateForTier(tier);
  const to = gateForTier(Math.min(5, tier + 1));
  if (to <= from || profXp <= 0) return null;
  return Math.ceil((totalProfXpForLevel(to) - totalProfXpForLevel(from)) / profXp);
};

export const ProfessionsPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [bufferFor, setBufferFor] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  // Preview level. Defaults to the node's own gate — "can the first player who
  // is allowed to touch this thing make progress on it?" is the question a new
  // node has to answer, and the answer changes with level.
  const [profLevel, setProfLevel] = useState(1);

  const nodes = useQuery({
    queryKey: ['resource-nodes'],
    queryFn: () => apiGet<{ nodes: NodeRow[] }>('/resource-nodes'),
  });
  const items = useQuery({
    queryKey: ['items'],
    queryFn: () => apiGet<{ items: ItemRow[] }>('/items'),
  });
  const diff = useQuery({
    queryKey: ['resource-nodes-diff'],
    queryFn: () => apiGet<NodeDiff>('/publish/resource-nodes/diff'),
  });

  const nodeRows = useMemo(() => nodes.data?.nodes ?? [], [nodes.data]);
  const itemsById = useMemo(
    () => new Map((items.data?.items ?? []).map((row) => [row.id, row])),
    [items.data],
  );

  const selected = useMemo(
    () => nodeRows.find((row) => row.id === selectedId) ?? null,
    [nodeRows, selectedId],
  );

  if (selected && bufferFor !== selected.id) {
    setBufferFor(selected.id);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
    setProfLevel(gateForTier(selected.tier));
  }

  const parsed = useMemo(() => {
    try {
      return resourceNodeDefSchema.safeParse(JSON.parse(text) as unknown);
    } catch (error) {
      return {
        success: false as const,
        error: { issues: [{ path: [], message: `not JSON: ${(error as Error).message}` }] },
      };
    }
  }, [text]);
  const dirty = text !== baseline;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['resource-nodes'] });
    void queryClient.invalidateQueries({ queryKey: ['resource-nodes-diff'] });
  };

  const save = useMutation({
    mutationFn: async (def: ResourceNodeDef) => apiPut(`/resource-nodes/${def.id}`, def),
    onSuccess: () => {
      setBaseline(text);
      invalidate();
    },
  });
  const discard = useMutation({
    mutationFn: async (id: string) => apiDelete(`/resource-nodes/${id}/draft`),
    onSuccess: () => {
      setBufferFor(null);
      invalidate();
    },
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/resource-nodes'),
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

  /**
   * The preview runs SERVER-side against the def in the editor buffer: same
   * shared build the game boots with, and the numbers move as you type-and-run
   * rather than as you save.
   */
  const preview = useMutation({
    mutationFn: async (body: { def: ResourceNodeDef; profLevel: number }) =>
      apiPost<GatherPreview>('/resource-nodes/preview', body),
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

  const pendingCount = (diff.data?.added.length ?? 0) + (diff.data?.changed.length ?? 0);

  const runPreview = () => {
    if (!parsed.success) return;
    preview.mutate({ def: parsed.data, profLevel });
  };

  const itemLabel = (itemId: string) => {
    const row = itemsById.get(itemId);
    if (!row) return <span className="items-unknown">{itemId} (not published)</span>;
    return (
      <>
        {row.name} <span className="ws-help">{row.rarity}</span>
      </>
    );
  };

  // --- preview panel --------------------------------------------------------

  const previewPanel = () => {
    if (!parsed.success) return null;
    const def = parsed.data;
    const report = preview.data;
    const gate = gateForTier(def.tier);
    const belowFrontier = report ? report.profLevel > gate && report.profXp < 12 * def.tier : false;
    return (
      <div className="items-budget">
        <div className="items-budget-head">
          <strong>Gathering preview</strong>
          <span className="ws-help">
            1 000 rolls through the game&apos;s own roller — these are the drops
          </span>
        </div>
        <div className="enemies-sim-controls">
          <label>
            prof lvl
            <input
              type="number"
              min={1}
              max={MAX_PROFESSION_LEVEL}
              value={profLevel}
              onChange={(event) => {
                setProfLevel(Number(event.target.value));
              }}
            />
          </label>
          <span className="ws-help professions-gate-note">
            T{def.tier} needs level {gate}
            {profLevel < gate ? ' — this level cannot gather it at all' : ''}
          </span>
          <button className="ws-btn" onClick={runPreview} disabled={preview.isPending}>
            {preview.isPending ? 'rolling…' : 'preview'}
          </button>
        </div>
        {report ? (
          <>
            <div className="items-budget-facts">
              <span>
                hold <b>{secondsOf(report.channelMs)}</b>{' '}
                <span className="ws-help">at prof {report.profLevel}</span>
              </span>
              <span>
                <b>{report.profXp}</b> prof xp{' '}
                <span className="ws-help">
                  {report.profXp > 0
                    ? `${Math.ceil(profXpToNext(report.profLevel) / report.profXp)} to next level`
                    : 'capped'}
                </span>
              </span>
              <span>
                proc <b>{report.procPct}%</b>
                {def.procs.length === 0 ? <span className="ws-help"> (no rare set)</span> : null}
              </span>
              <span>
                <b>{report.perHourOneNode}</b>/h{' '}
                <span className="ws-help">one node, hold + {secondsOf(def.respawnMs)} respawn</span>
              </span>
            </div>
            {belowFrontier ? (
              <p className="ws-help">
                Half xp — this tier is back country at level {report.profLevel} (§1.3 pushes toward
                the frontier).
              </p>
            ) : null}
            <table className="professions-table">
              <tbody>
                {report.perHundred.map((row) => (
                  <tr key={row.itemId}>
                    <td>{itemLabel(row.itemId)}</td>
                    <td>{row.qty}</td>
                    <td className="ws-help">per 100 gathers</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const gathers = gathersToNextGate(def.tier, report.profXp);
              return gathers === null ? null : (
                <p className="ws-help professions-gate-note">
                  ≈ {gathers.toLocaleString()} gathers of this node to walk level{' '}
                  {gateForTier(def.tier)} → {gateForTier(Math.min(5, def.tier + 1))}
                </p>
              );
            })()}
            {report.fishing ? (
              <>
                <div className="items-budget-head professions-fishing-head">
                  <strong>The bar</strong>
                  <span className="ws-help">drift speed / marker half-width per fish</span>
                </div>
                <table className="professions-table">
                  <tbody>
                    {report.fishing.map((row) => (
                      <tr key={row.itemId}>
                        <td>{itemLabel(row.itemId)}</td>
                        <td>{row.driftSpeed.toFixed(3)}</td>
                        <td>±{(row.markerHalf * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </>
        ) : (
          <p className="ws-help">
            Preview to see what this node actually gives, how long a gather takes at that level and
            how far it moves the profession — the respawn time only means something next to them.
          </p>
        )}
        {preview.error instanceof ApiRequestError ? (
          <p className="items-icon-warning">{preview.error.message}</p>
        ) : null}
      </div>
    );
  };

  // --- render ---------------------------------------------------------------

  const filtered = nodeRows.filter(
    (row) =>
      filter === '' ||
      row.id.includes(filter.toLowerCase()) ||
      row.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const professions = PROFESSION_ORDER.filter((profession) =>
    filtered.some((row) => row.profession === profession),
  ).concat(
    // Anything the shared list does not know about still has to be reachable —
    // a page that silently hides a row is worse than one that shows it oddly.
    [...new Set(filtered.map((row) => row.profession))].filter(
      (profession) => !PROFESSION_ORDER.includes(profession),
    ),
  );

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Professions</h2>
        </header>

        <input
          className="items-filter"
          placeholder="filter…"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />

        {professions.map((profession) => (
          <section key={profession} className="abilities-group">
            <h3 className="abilities-group-title">
              {PROFESSION_LABEL[profession] ?? profession}
              <span className="professions-group-count">
                ({filtered.filter((row) => row.profession === profession).length})
              </span>
            </h3>
            {filtered
              .filter((row) => row.profession === profession)
              .map((row) => (
                <button
                  key={row.id}
                  className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedId(row.id);
                  }}
                >
                  <span className="abilities-row-binding">T{row.tier}</span>
                  <span className="abilities-row-name">{row.name}</span>
                  <span className="ws-help enemies-archetype">lvl {row.gate}+</span>
                  {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                </button>
              ))}
          </section>
        ))}
        {nodeRows.length === 0 ? (
          <p className="ws-help">
            No resource nodes yet — P10-E authors the first set. The map editor&apos;s node layer
            stays empty until one is published.
          </p>
        ) : null}
      </aside>

      <section className="abilities-editor ws-panel">
        <header className="panel-head">
          <h2>{selected ? selected.id : 'Nothing selected'}</h2>
          {selected ? (
            <div className="abilities-editor-actions">
              <button
                className="ws-btn ws-btn--primary"
                disabled={!canWrite || !dirty || !parsed.success || save.isPending}
                onClick={doSave}
              >
                {save.isPending ? 'saving…' : 'save draft'}
              </button>
              <button
                className="ws-btn"
                disabled={!canWrite || !selected.hasDraft || discard.isPending}
                onClick={() => {
                  if (window.confirm(`Discard the draft for ${selected.id}?`)) {
                    discard.mutate(selected.id);
                  }
                }}
              >
                discard draft
              </button>
            </div>
          ) : null}
        </header>

        {selected ? (
          <>
            {previewPanel()}
            <textarea
              className="abilities-json"
              spellCheck={false}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
            {!parsed.success ? (
              <ul className="abilities-issues">
                {parsed.error.issues.slice(0, 6).map((issue, index) => (
                  <li key={index}>
                    {issue.path.join('.') || '<root>'}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {save.error instanceof ApiRequestError ? (
              <p className="abilities-save-error">{save.error.message}</p>
            ) : null}
          </>
        ) : (
          <p className="ws-help">
            Pick a node. Definitions live here; where they stand is the map editor&apos;s node
            layer, and publish resolves one against the other — a placement pointing at a node that
            was never published is refused rather than silently missing from the world.
          </p>
        )}
      </section>

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {(diff.data?.added ?? []).map((id) => (
          <div key={id} className="abilities-diff-row">
            <span className="abilities-diff-kind is-added">added</span>
            <span className="abilities-diff-id">{id}</span>
          </div>
        ))}
        {(diff.data?.changed ?? []).map((id) => (
          <div key={id} className="abilities-diff-row">
            <span className="abilities-diff-kind is-changed">changed</span>
            <span className="abilities-diff-id">{id}</span>
          </div>
        ))}
        {pendingCount === 0 ? <p className="ws-help">No drafts pending.</p> : null}
        <button
          className="ws-btn ws-btn--gold abilities-publish-button"
          disabled={!canWrite || pendingCount === 0 || publish.isPending}
          onClick={() => {
            if (
              window.confirm(`Publish ${pendingCount} resource-node draft(s) to the live game?`)
            ) {
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
            {publishState.warnings.length > 0 ? (
              <ul className="items-warnings">
                {publishState.warnings.slice(0, 8).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <p className="ws-help professions-publish-note">
          Node PLACEMENTS publish with the map, not here. A definition has to be live before the map
          bake will accept a placement of it.
        </p>
      </aside>
    </div>
  );
};
