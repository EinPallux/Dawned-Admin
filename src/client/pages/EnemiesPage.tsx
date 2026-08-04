/**
 * Enemy content editor (A1-d, game P9): the bestiary and the spawners that
 * place it, on ONE publish rail — a spawner without its enemy is a camp that
 * silently never populates, so they ship together or the cross-check cannot
 * catch either.
 *
 * Enemies tab — level-banded list (the bestiary reads as a progression, the
 * way NPCS_ENEMIES.md §4 lists it), the shared-schema JSON editor, and the
 * TIME-TO-KILL panel: it runs the same `selectableEnemyAbilities` the live AI
 * picks with, so the rotation shown is the rotation that will be fought. It
 * answers both directions — how long to kill it, and how long it takes to
 * kill you — because a number for only one side is how an enemy ends up
 * unkillable or harmless.
 * Spawners tab — where the bestiary actually stands, with its camp tag and
 * respawn cadence.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enemyDefSchema, spawnerDefSchema, type EnemyDef, type SpawnerDef } from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

type Tab = 'enemies' | 'spawners';

interface EnemyRow {
  id: string;
  name: string;
  archetype: string;
  rank: string;
  levelMin: number;
  levelMax: number;
  abilityCount: number;
  phaseCount: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: EnemyDef;
}

interface SpawnerRow {
  id: string;
  kind: string;
  x: number;
  z: number;
  count: number;
  campTag: string | null;
  hasDraft: boolean;
  hasPublished: boolean;
  def: SpawnerDef;
}

interface EnemiesDiff {
  enemies: { id: string; name: string; isNew: boolean }[];
  spawners: { id: string; isNew: boolean }[];
}

interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  warnings: string[];
  reload: { ok: boolean; note: string };
}

interface TtkReport {
  enemyHp: number;
  playerKillSeconds: number;
  enemyDps: number;
  enemyKillSeconds: number;
  playerHp: number;
  rotation: { id: string; kind: string; sharePct: number; damage: number; cycleMs: number }[];
  notes: string[];
}

/** Level bands the bestiary is authored in (NPCS_ENEMIES.md §4 zone order). */
const bandOf = (levelMin: number): string => {
  if (levelMin <= 6) return 'Dawnshore (1–6)';
  if (levelMin <= 12) return 'Verdant Weald (6–12)';
  if (levelMin <= 18) return 'Emberwood (12–18)';
  if (levelMin <= 24) return 'Sungraze Savanna (18–24)';
  return 'Ashcrag + Elder Grove (24–30)';
};

const RANK_LABEL: Record<string, string> = {
  normal: '',
  elite: 'ELITE',
  zone_boss: 'BOSS',
  world_boss: 'WORLD BOSS',
};

const seconds = (value: number): string =>
  Number.isFinite(value) ? `${value.toFixed(1)} s` : 'never';

export const EnemiesPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';
  const [tab, setTab] = useState<Tab>('enemies');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [bufferFor, setBufferFor] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  // TTK inputs. The DPS default is a rough level-appropriate melee number; the
  // point is comparing tunings, not predicting one player's gear.
  const [simPlayerLevel, setSimPlayerLevel] = useState(5);
  const [simDps, setSimDps] = useState(40);
  const [simDistance, setSimDistance] = useState(2);

  const enemies = useQuery({
    queryKey: ['enemies'],
    queryFn: () => apiGet<{ enemies: EnemyRow[] }>('/enemies'),
  });
  const spawners = useQuery({
    queryKey: ['spawners'],
    queryFn: () => apiGet<{ spawners: SpawnerRow[] }>('/spawners'),
  });
  const diff = useQuery({
    queryKey: ['enemies-diff'],
    queryFn: () => apiGet<EnemiesDiff>('/publish/enemies/diff'),
  });

  const enemyRows = useMemo(() => enemies.data?.enemies ?? [], [enemies.data]);
  const spawnerRows = useMemo(() => spawners.data?.spawners ?? [], [spawners.data]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return tab === 'enemies'
      ? (enemyRows.find((row) => row.id === selectedId) ?? null)
      : (spawnerRows.find((row) => row.id === selectedId) ?? null);
  }, [tab, selectedId, enemyRows, spawnerRows]);

  const bufferKey = selected ? `${tab}:${selected.id}` : null;
  if (selected && bufferFor !== bufferKey) {
    setBufferFor(bufferKey);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
  }

  const schema = tab === 'enemies' ? enemyDefSchema : spawnerDefSchema;
  const parsed = useMemo(() => {
    try {
      return schema.safeParse(JSON.parse(text) as unknown);
    } catch (error) {
      return {
        success: false as const,
        error: { issues: [{ path: [], message: `not JSON: ${(error as Error).message}` }] },
      };
    }
  }, [text, schema]);
  const dirty = text !== baseline;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['enemies'] });
    void queryClient.invalidateQueries({ queryKey: ['spawners'] });
    void queryClient.invalidateQueries({ queryKey: ['enemies-diff'] });
  };

  const endpoint = tab === 'enemies' ? 'enemies' : 'spawners';

  const save = useMutation({
    mutationFn: async (def: { id: string }) => apiPut(`/${endpoint}/${def.id}`, def),
    onSuccess: () => {
      setBaseline(text);
      invalidate();
    },
  });
  const discard = useMutation({
    mutationFn: async (id: string) => apiDelete(`/enemies/${endpoint}/${id}/draft`),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/enemies'),
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
   * The TTK runs SERVER-side so it uses the same shared build the game does —
   * a browser copy of the rules is a second implementation waiting to drift.
   */
  const ttk = useMutation({
    mutationFn: async (body: unknown) =>
      apiPost<{ report: TtkReport; rotation: string[] }>('/enemies/ttk', body),
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

  const pendingCount = (diff.data?.enemies.length ?? 0) + (diff.data?.spawners.length ?? 0);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelectedId(null);
    setBufferFor(null);
    setText('');
    setBaseline('');
    ttk.reset();
  };

  const runTtk = () => {
    if (!parsed.success || tab !== 'enemies') return;
    const def = parsed.data as EnemyDef;
    ttk.mutate({
      def,
      enemyLevel: def.levelMin,
      playerLevel: simPlayerLevel,
      playerClass: 'warrior',
      playerDps: simDps,
      distance: simDistance,
    });
  };

  // --- TTK panel ------------------------------------------------------------

  const ttkPanel = () => {
    if (tab !== 'enemies' || !parsed.success) return null;
    const report = ttk.data?.report;
    return (
      <div className="items-budget">
        <div className="items-budget-head">
          <strong>Time to kill</strong>
          <span className="ws-help">
            the same selection rules the live AI fights with — this rotation is the rotation
          </span>
        </div>
        <div className="enemies-sim-controls">
          <label>
            player lvl
            <input
              type="number"
              min={1}
              max={30}
              value={simPlayerLevel}
              onChange={(event) => {
                setSimPlayerLevel(Number(event.target.value));
              }}
            />
          </label>
          <label>
            player dps
            <input
              type="number"
              min={1}
              max={5000}
              value={simDps}
              onChange={(event) => {
                setSimDps(Number(event.target.value));
              }}
            />
          </label>
          <label>
            fight at (m)
            <input
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={simDistance}
              onChange={(event) => {
                setSimDistance(Number(event.target.value));
              }}
            />
          </label>
          <button className="ws-btn" onClick={runTtk} disabled={ttk.isPending}>
            {ttk.isPending ? 'simulating…' : 'simulate'}
          </button>
        </div>
        {report ? (
          <>
            <div className="items-budget-facts">
              <span>
                player kills it in <b>{seconds(report.playerKillSeconds)}</b>{' '}
                <span className="ws-help">{report.enemyHp} hp</span>
              </span>
              <span>
                it kills the player in <b>{seconds(report.enemyKillSeconds)}</b>{' '}
                <span className="ws-help">
                  {report.enemyDps.toFixed(1)} dps vs {report.playerHp} hp
                </span>
              </span>
            </div>
            <table className="enemies-rotation">
              <tbody>
                {report.rotation.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td className="ws-help">{row.kind}</td>
                    <td>{row.sharePct.toFixed(0)}%</td>
                    <td>{row.damage.toFixed(0)} dmg</td>
                    <td className="ws-help">{row.cycleMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ttk.data?.rotation.length ? (
              <p className="ws-help enemies-rotation-preview">
                would roll: {ttk.data.rotation.join(' → ')}
              </p>
            ) : null}
            {report.notes.map((note, index) => (
              <p key={index} className="items-icon-warning">
                {note}
              </p>
            ))}
          </>
        ) : (
          <p className="ws-help">
            Simulate to see what this enemy would actually do at that range — and whether the trade
            goes the way you intended.
          </p>
        )}
      </div>
    );
  };

  // --- render ---------------------------------------------------------------

  const matches = (row: { id: string; name?: string }): boolean =>
    filter === '' ||
    row.id.includes(filter.toLowerCase()) ||
    (row.name ?? '').toLowerCase().includes(filter.toLowerCase());

  const filteredEnemies = enemyRows.filter(matches);
  const bands = [...new Set(filteredEnemies.map((row) => bandOf(row.levelMin)))];

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Enemies</h2>
        </header>
        <div className="progression-tabs items-tabs">
          {(['enemies', 'spawners'] as Tab[]).map((entry) => (
            <button
              key={entry}
              className={`ws-btn${tab === entry ? ' ws-btn--primary' : ''}`}
              onClick={() => {
                switchTab(entry);
              }}
            >
              {entry}
            </button>
          ))}
        </div>

        <input
          className="items-filter"
          placeholder="filter…"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />

        {tab === 'enemies' ? (
          <>
            {bands.map((band) => (
              <section key={band} className="abilities-group">
                <h3 className="abilities-group-title">{band}</h3>
                {filteredEnemies
                  .filter((row) => bandOf(row.levelMin) === band)
                  .map((row) => (
                    <button
                      key={row.id}
                      className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(row.id);
                      }}
                    >
                      <span className="abilities-row-binding">
                        {row.levelMin === row.levelMax
                          ? row.levelMin
                          : `${row.levelMin}–${row.levelMax}`}
                      </span>
                      <span className="abilities-row-name">{row.name}</span>
                      {RANK_LABEL[row.rank] ? (
                        <span className="enemies-rank">{RANK_LABEL[row.rank]}</span>
                      ) : null}
                      <span className="ws-help enemies-archetype">{row.archetype}</span>
                      {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                    </button>
                  ))}
              </section>
            ))}
            {filteredEnemies.length === 0 ? (
              <p className="ws-help">No enemies yet — P9-C authors the first bestiary.</p>
            ) : null}
          </>
        ) : (
          <>
            {spawnerRows.filter(matches).map((row) => (
              <button
                key={row.id}
                className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                onClick={() => {
                  setSelectedId(row.id);
                }}
              >
                <span className="abilities-row-binding">{row.count}×</span>
                <span className="abilities-row-name">{row.id}</span>
                <span className="ws-help enemies-archetype">
                  {Math.round(row.x)},{Math.round(row.z)}
                </span>
                {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
              </button>
            ))}
            {spawnerRows.length === 0 ? <p className="ws-help">No spawners yet.</p> : null}
          </>
        )}
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
            {ttkPanel()}
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
            {tab === 'enemies'
              ? 'Pick an enemy. The TTK panel runs the shared selection rules, so what it shows is what the fight will do — including which abilities are unreachable at the range you are testing.'
              : 'Pick a spawner. Spawners publish with the enemies they place, so a camp can never go live pointing at nothing.'}
          </p>
        )}
      </section>

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {(diff.data?.enemies ?? []).slice(0, 30).map((entry) => (
          <div key={entry.id} className="abilities-diff-row">
            <span className={`abilities-diff-kind is-${entry.isNew ? 'added' : 'changed'}`}>
              {entry.isNew ? 'added' : 'changed'}
            </span>
            <span className="abilities-diff-id">{entry.id}</span>
          </div>
        ))}
        {(diff.data?.spawners ?? []).slice(0, 20).map((entry) => (
          <div key={entry.id} className="abilities-diff-row">
            <span className={`abilities-diff-kind is-${entry.isNew ? 'added' : 'changed'}`}>
              {entry.isNew ? 'added' : 'changed'}
            </span>
            <span className="abilities-diff-id">{entry.id}</span>
          </div>
        ))}
        {pendingCount === 0 ? <p className="ws-help">No drafts pending.</p> : null}
        <button
          className="ws-btn ws-btn--gold abilities-publish-button"
          disabled={!canWrite || pendingCount === 0 || publish.isPending}
          onClick={() => {
            if (window.confirm(`Publish ${pendingCount} enemy draft(s) to the live game?`)) {
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
      </aside>
    </div>
  );
};
