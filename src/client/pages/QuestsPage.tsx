/**
 * Quest & dialogue editor (A4, game P11) — the second flagship page.
 *
 * Two tabs on ONE publish rail: quests and the NPCs they talk to. They ship
 * together because they reference each other, and publishing them apart would
 * guarantee a window where a live quest points at an NPC who is not there yet.
 *
 * The panel that matters is the **quest preview**. It renders the quest the way
 * a player meets it — journal prose, tracker lines with their counters, who to
 * see and who to hand it back to — and it runs the GAME's own
 * `validateQuestFlow`, so a quest this page calls fine is a quest the server
 * will load. The alternative (a panel-local copy of the rules) fails at the
 * next server boot instead of at the publish button, which is the worst place
 * for a content mistake to surface.
 *
 * The preview reads the EDITOR BUFFER, not the saved row. A preview of the last
 * save lies for exactly one save, which is how a reward gets doubled — the
 * Professions editor learned that at A1-e and it is the same mistake here.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { npcDefSchema, questDefSchema, type NpcDef, type QuestDef } from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

interface QuestRow {
  id: string;
  name: string;
  zoneId: string;
  suggestedLevel: number;
  chainId: string;
  steps: number;
  giverKind: string;
  hasDraft: boolean;
  hasPublished: boolean;
  problems: string[];
  def: QuestDef;
}

interface NpcRow {
  id: string;
  name: string;
  title: string;
  role: string;
  hasDraft: boolean;
  hasPublished: boolean;
  problems: string[];
  def: NpcDef;
}

interface QuestDiff {
  quests: { added: string[]; changed: string[]; unchanged: string[] };
  npcs: { added: string[]; changed: string[]; unchanged: string[] };
}

interface PublishResult {
  ok: boolean;
  publishedQuests: number;
  publishedNpcs: number;
  problems: string[];
  warnings: string[];
  reload: { ok: boolean; note: string };
}

interface QuestPreview {
  questId: string;
  journal: { name: string; zoneId: string; level: number; prose: string };
  tracker: { text: string; need: number; type: string; hint: boolean; clue: string }[];
  rewards: {
    xp: number;
    gold: number;
    suggestedXp: number;
    suggestedGold: number;
    items: { itemId: string; name: string; qty: number }[];
    choices: { classId: string; itemId: string; name: string }[];
    title: string;
  };
  flow: { giver: string; turnIn: string; gates: string[] };
  problems: string[];
}

interface ChainNode {
  questId: string;
  name: string;
  suggestedLevel: number;
  requires: string[];
  unlocks: string[];
}

type Tab = 'quests' | 'npcs';

/** Step-type labels, in the order QUESTS_POI §2 lists them. */
const STEP_LABEL: Record<string, string> = {
  kill: 'Kill',
  collect: 'Collect',
  deliver: 'Deliver',
  talk: 'Talk',
  explore: 'Explore',
  interact: 'Interact',
  use_at: 'Use at',
};

export const QuestsPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';
  const [tab, setTab] = useState<Tab>('quests');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [bufferFor, setBufferFor] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  const [grantTo, setGrantTo] = useState('');
  const [grantStep, setGrantStep] = useState(0);

  const quests = useQuery({
    queryKey: ['quests'],
    queryFn: () => apiGet<{ quests: QuestRow[] }>('/quests'),
  });
  const npcs = useQuery({
    queryKey: ['npcs'],
    queryFn: () => apiGet<{ npcs: NpcRow[] }>('/npcs'),
  });
  const diff = useQuery({
    queryKey: ['quests-diff'],
    queryFn: () => apiGet<QuestDiff>('/publish/quests/diff'),
  });

  const questRows = useMemo(() => quests.data?.quests ?? [], [quests.data]);
  const npcRows = useMemo(() => npcs.data?.npcs ?? [], [npcs.data]);

  const selectedQuest = useMemo(
    () => (tab === 'quests' ? (questRows.find((row) => row.id === selectedId) ?? null) : null),
    [tab, questRows, selectedId],
  );
  const selectedNpc = useMemo(
    () => (tab === 'npcs' ? (npcRows.find((row) => row.id === selectedId) ?? null) : null),
    [tab, npcRows, selectedId],
  );
  const selected = selectedQuest ?? selectedNpc;

  if (selected && bufferFor !== `${tab}:${selected.id}`) {
    setBufferFor(`${tab}:${selected.id}`);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
  }

  const schema = tab === 'quests' ? questDefSchema : npcDefSchema;
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
    void queryClient.invalidateQueries({ queryKey: ['quests'] });
    void queryClient.invalidateQueries({ queryKey: ['npcs'] });
    void queryClient.invalidateQueries({ queryKey: ['quests-diff'] });
  };

  const save = useMutation({
    mutationFn: async (def: QuestDef | NpcDef) =>
      apiPut(`/${tab === 'quests' ? 'quests' : 'npcs'}/${def.id}`, def),
    onSuccess: () => {
      setBaseline(text);
      invalidate();
    },
  });
  const discard = useMutation({
    mutationFn: async (id: string) =>
      apiDelete(`/${tab === 'quests' ? 'quests' : 'npcs'}/${id}/draft`),
    onSuccess: () => {
      setBufferFor(null);
      invalidate();
    },
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/quests'),
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

  /** Runs SERVER-side against the buffer, through the game's own validator. */
  const preview = useMutation({
    mutationFn: async (def: QuestDef) => apiPost<QuestPreview>('/quests/preview', { def }),
  });

  const chain = useQuery({
    queryKey: ['quest-chain', selectedQuest?.chainId ?? ''],
    queryFn: () =>
      apiGet<{ chain: ChainNode[] }>(
        `/quests/chain/${selectedQuest?.chainId ? encodeURIComponent(selectedQuest.chainId) : '_all'}`,
      ),
    enabled: Boolean(selectedQuest?.chainId),
  });

  /**
   * "Grant to my GM character at step n" — the test hook (CONTENT_EDITORS §6).
   * Author → test in seconds, which is the difference between a quest chain
   * being iterated on and being written once and hoped over.
   */
  const grant = useMutation({
    mutationFn: async (body: { player: string; quest: string; step: number }) =>
      apiPost<{ ok: boolean }>('/ops/quest', body),
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

  const pendingCount =
    (diff.data?.quests.added.length ?? 0) +
    (diff.data?.quests.changed.length ?? 0) +
    (diff.data?.npcs.added.length ?? 0) +
    (diff.data?.npcs.changed.length ?? 0);

  // --- preview panel --------------------------------------------------------

  const previewPanel = () => {
    if (tab !== 'quests' || !parsed.success) return null;
    const def = parsed.data as QuestDef;
    const report = preview.data;
    return (
      <div className="items-budget">
        <div className="items-budget-head">
          <strong>Quest preview</strong>
          <span className="ws-help">
            the journal, the tracker and the game&apos;s own flow validator
          </span>
        </div>
        <div className="enemies-sim-controls">
          <button
            className="ws-btn"
            onClick={() => {
              preview.mutate(def);
            }}
            disabled={preview.isPending}
          >
            {preview.isPending ? 'rendering…' : 'preview'}
          </button>
          {canWrite ? (
            <>
              <label>
                grant to
                <input
                  value={grantTo}
                  placeholder="character"
                  onChange={(event) => {
                    setGrantTo(event.target.value);
                  }}
                />
              </label>
              <label>
                at step
                <input
                  type="number"
                  min={0}
                  max={def.steps.length}
                  value={grantStep}
                  onChange={(event) => {
                    setGrantStep(Number(event.target.value));
                  }}
                />
              </label>
              <button
                className="ws-btn"
                disabled={grantTo.trim() === '' || grant.isPending}
                onClick={() => {
                  grant.mutate({ player: grantTo.trim(), quest: def.id, step: grantStep });
                }}
              >
                {grant.isPending ? 'granting…' : 'grant'}
              </button>
            </>
          ) : null}
        </div>
        {grant.error instanceof ApiRequestError ? (
          <p className="items-icon-warning">{grant.error.message}</p>
        ) : null}
        {grant.isSuccess ? (
          <p className="ws-help">
            Granted — the character&apos;s journal updates live; walk to the step and test it.
          </p>
        ) : null}
        {report ? (
          <>
            <div className="items-budget-facts">
              <span>
                giver <b>{report.flow.giver}</b>
              </span>
              <span>
                turn in <b>{report.flow.turnIn}</b>
              </span>
              <span>
                <b>{report.rewards.xp}</b> xp{' '}
                <span className="ws-help">ƒ {report.rewards.suggestedXp}</span>
              </span>
              <span>
                <b>{report.rewards.gold}</b> g{' '}
                <span className="ws-help">ƒ {report.rewards.suggestedGold}</span>
              </span>
            </div>
            {report.flow.gates.length > 0 ? (
              <p className="ws-help">Gated behind: {report.flow.gates.join(' · ')}</p>
            ) : null}

            <div className="quests-journal">
              <h4>
                {report.journal.name}{' '}
                <span className="ws-help">
                  {report.journal.zoneId} · lvl {report.journal.level}
                </span>
              </h4>
              <p className="quests-journal-prose">{report.journal.prose}</p>
              <ol className="quests-tracker">
                {report.tracker.map((line, index) => (
                  <li key={index}>
                    <span className="quests-step-kind">{STEP_LABEL[line.type] ?? line.type}</span>
                    <span className="quests-step-text">{line.text}</span>
                    {line.need > 1 ? (
                      <span className="quests-step-count">0/{line.need}</span>
                    ) : null}
                    {line.hint ? <span className="ws-help">map hint</span> : null}
                    {line.clue ? <span className="quests-step-clue">“{line.clue}”</span> : null}
                  </li>
                ))}
              </ol>
              {report.rewards.items.length > 0 || report.rewards.choices.length > 0 ? (
                <p className="ws-help">
                  Rewards:{' '}
                  {report.rewards.items.map((entry) => `${entry.name} ×${entry.qty}`).join(', ')}
                  {report.rewards.choices.length > 0
                    ? ` · choose one: ${report.rewards.choices
                        .map((choice) => `${choice.classId} → ${choice.name}`)
                        .join(', ')}`
                    : ''}
                </p>
              ) : null}
              {report.rewards.title ? (
                <p className="ws-help">Title: “{report.rewards.title}”</p>
              ) : null}
            </div>

            {report.problems.length > 0 ? (
              <ul className="abilities-issues">
                {report.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            ) : (
              <p className="ws-help">
                No flow problems — this quest can be found, worked and handed in.
              </p>
            )}
          </>
        ) : (
          <p className="ws-help">
            Preview to read the quest the way a player meets it, and to run the game&apos;s own flow
            validator over it before publish does.
          </p>
        )}
        {preview.error instanceof ApiRequestError ? (
          <p className="items-icon-warning">{preview.error.message}</p>
        ) : null}
      </div>
    );
  };

  /** The chain graph, drawn from prerequisites — what the game actually gates on. */
  const chainPanel = () => {
    if (tab !== 'quests' || !selectedQuest?.chainId) return null;
    const nodes = chain.data?.chain ?? [];
    if (nodes.length === 0) return null;
    const ordered = [...nodes].sort((a, b) => a.requires.length - b.requires.length);
    return (
      <div className="items-budget">
        <div className="items-budget-head">
          <strong>Chain: {selectedQuest.chainId}</strong>
          <span className="ws-help">links come from prerequisites, not the chain id</span>
        </div>
        <ol className="quests-chain">
          {ordered.map((node) => (
            <li key={node.questId} className={node.questId === selectedQuest.id ? 'is-active' : ''}>
              <span className="quests-chain-level">lvl {node.suggestedLevel}</span>
              <span className="quests-chain-name">{node.name}</span>
              {node.unlocks.length > 0 ? (
                <span className="ws-help">→ {node.unlocks.length} unlocked</span>
              ) : (
                <span className="ws-help">end of chain</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  // --- render ---------------------------------------------------------------

  const matches = (haystack: string) => haystack.toLowerCase().includes(filter.toLowerCase());
  const filteredQuests = questRows.filter(
    (row) => filter === '' || matches(row.id) || matches(row.name),
  );
  const filteredNpcs = npcRows.filter(
    (row) => filter === '' || matches(row.id) || matches(row.name),
  );
  const zones = [...new Set(filteredQuests.map((row) => row.zoneId))].sort();
  const roles = [...new Set(filteredNpcs.map((row) => row.role))].sort();

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Quests</h2>
        </header>

        <div className="items-tabs">
          {(['quests', 'npcs'] as Tab[]).map((entry) => (
            <button
              key={entry}
              className={`ws-btn${tab === entry ? ' is-active' : ''}`}
              onClick={() => {
                setTab(entry);
                setSelectedId(null);
                setBufferFor(null);
              }}
            >
              {entry === 'quests' ? 'quests' : 'NPCs'}
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

        {tab === 'quests'
          ? zones.map((zoneId) => (
              <section key={zoneId} className="abilities-group">
                <h3 className="abilities-group-title">
                  {zoneId}
                  <span className="professions-group-count">
                    ({filteredQuests.filter((row) => row.zoneId === zoneId).length})
                  </span>
                </h3>
                {filteredQuests
                  .filter((row) => row.zoneId === zoneId)
                  .map((row) => (
                    <button
                      key={row.id}
                      className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(row.id);
                      }}
                    >
                      <span className="abilities-row-binding">L{row.suggestedLevel}</span>
                      <span className="abilities-row-name">{row.name}</span>
                      <span className="ws-help enemies-archetype">
                        {row.steps} step{row.steps === 1 ? '' : 's'}
                      </span>
                      {row.problems.length > 0 ? (
                        <span className="quests-row-problem" title={row.problems.join('; ')} />
                      ) : null}
                      {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                    </button>
                  ))}
              </section>
            ))
          : roles.map((role) => (
              <section key={role} className="abilities-group">
                <h3 className="abilities-group-title">
                  {role}
                  <span className="professions-group-count">
                    ({filteredNpcs.filter((row) => row.role === role).length})
                  </span>
                </h3>
                {filteredNpcs
                  .filter((row) => row.role === role)
                  .map((row) => (
                    <button
                      key={row.id}
                      className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(row.id);
                      }}
                    >
                      <span className="abilities-row-name">{row.name}</span>
                      <span className="ws-help enemies-archetype">{row.title}</span>
                      {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                    </button>
                  ))}
              </section>
            ))}

        {questRows.length === 0 && npcRows.length === 0 ? (
          <p className="ws-help">
            No quests yet — P11-C authors the first set. A quest needs its NPCs published in the
            same breath, which is why both live on one rail here.
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
            {chainPanel()}
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
            Pick a quest or an NPC. Quests own their steps, dialogue and rewards; where the giver
            STANDS is the map editor&apos;s NPC layer, and publish resolves one against the other.
          </p>
        )}
      </section>

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {(['quests', 'npcs'] as const).flatMap((kind) =>
          (['added', 'changed'] as const).flatMap((change) =>
            (diff.data?.[kind][change] ?? []).map((id) => (
              <div key={`${kind}-${change}-${id}`} className="abilities-diff-row">
                <span className={`abilities-diff-kind is-${change}`}>{change}</span>
                <span className="abilities-diff-id">{id}</span>
              </div>
            )),
          ),
        )}
        {pendingCount === 0 ? <p className="ws-help">No drafts pending.</p> : null}
        <button
          className="ws-btn ws-btn--gold abilities-publish-button"
          disabled={!canWrite || pendingCount === 0 || publish.isPending}
          onClick={() => {
            if (window.confirm(`Publish ${pendingCount} quest/NPC draft(s) to the live game?`)) {
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
                <p>
                  Published {publishState.publishedQuests} quest(s) and {publishState.publishedNpcs}{' '}
                  NPC(s) — live.
                </p>
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
          NPCs publish BEFORE quests inside the transaction: a quest that landed first would be live
          and unopenable for the width of it.
        </p>
      </aside>
    </div>
  );
};
