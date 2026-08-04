/**
 * Item content editors (A1-c, game P8): items, loot tables and vendors on one
 * surface with ONE publish rail — they reference each other, so they ship
 * together or they ship dangling.
 *
 * Items tab — category-grouped list; the editor pairs the validated JSON with
 * a BUDGET METER (ITEMS_LOOT.md §2, computed by the shared formulas the game
 * and the drop roller use) and ƒ-suggest buttons that write the suggested
 * numbers straight into the draft.
 * Loot tab — the same JSON editor plus a 1 000-roll SIMULATOR running the
 * shared roller over the draft-overlaid tables: the preview cannot lie about
 * drop rates because it is the same code the server rolls with.
 * Vendors tab — stock priced by the shared value/sell formulas, so what the
 * panel shows is what the server will charge.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RARITY_COLORS,
  ROLLS_BY_RARITY,
  itemDefSchema,
  lootTableDefSchema,
  rollLootTable,
  sellPriceFor,
  vendorDefSchema,
  type ItemDef,
  type LootTableDef,
  type VendorDef,
} from '@dawned/shared';
import { apiDelete, apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

type Tab = 'items' | 'loot' | 'vendors';

interface BudgetReport {
  fixed: number;
  rolled: number;
  budget: number;
  freeArmor: number;
  weapon: { min: number; max: number } | null;
  value: number;
}

interface ItemRow {
  id: string;
  name: string;
  category: string;
  slot: string;
  rarity: string;
  ilvl: number;
  icon: string;
  hasDraft: boolean;
  hasPublished: boolean;
  def: ItemDef;
  budget: BudgetReport;
}

interface LootRow {
  id: string;
  name: string;
  entries: number;
  hasDraft: boolean;
  hasPublished: boolean;
  def: LootTableDef;
}

interface VendorRow {
  id: string;
  name: string;
  kind: string;
  stock: number;
  hasAnchor: boolean;
  hasDraft: boolean;
  hasPublished: boolean;
  def: VendorDef;
}

interface ItemsDiff {
  items: { id: string; name: string; kind: 'added' | 'changed' }[];
  loot: { id: string; name: string; kind: 'added' | 'changed' }[];
  vendors: { id: string; name: string; kind: 'added' | 'changed' }[];
}

interface PublishResult {
  ok: boolean;
  published: number;
  problems: string[];
  warnings: string[];
  reload: { ok: boolean; note: string };
}

/** Seeded RNG so a simulator run is reproducible while the owner tunes. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SIM_ROLLS = 1000;

export const ItemsPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const canWrite = user.role === 'admin';
  const [tab, setTab] = useState<Tab>('items');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [bufferFor, setBufferFor] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishResult | null>(null);
  const [simLevel, setSimLevel] = useState(5);
  const [simRollsPerKill, setSimRollsPerKill] = useState(1);

  const items = useQuery({
    queryKey: ['items'],
    queryFn: () => apiGet<{ items: ItemRow[] }>('/items'),
  });
  const loot = useQuery({
    queryKey: ['loot-tables'],
    queryFn: () => apiGet<{ tables: LootRow[] }>('/loot-tables'),
  });
  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiGet<{ vendors: VendorRow[] }>('/vendors'),
  });
  const diff = useQuery({
    queryKey: ['items-diff'],
    queryFn: () => apiGet<ItemsDiff>('/publish/items/diff'),
  });

  const itemRows = useMemo(() => items.data?.items ?? [], [items.data]);
  const lootRows = useMemo(() => loot.data?.tables ?? [], [loot.data]);
  const vendorRows = useMemo(() => vendors.data?.vendors ?? [], [vendors.data]);

  const itemsById = useMemo(() => new Map(itemRows.map((row) => [row.id, row.def])), [itemRows]);
  const tablesById = useMemo(() => new Map(lootRows.map((row) => [row.id, row.def])), [lootRows]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    if (tab === 'items') return itemRows.find((row) => row.id === selectedId) ?? null;
    if (tab === 'loot') return lootRows.find((row) => row.id === selectedId) ?? null;
    return vendorRows.find((row) => row.id === selectedId) ?? null;
  }, [tab, selectedId, itemRows, lootRows, vendorRows]);

  const bufferKey = selected ? `${tab}:${selected.id}` : null;
  if (selected && bufferFor !== bufferKey) {
    setBufferFor(bufferKey);
    const pretty = JSON.stringify(selected.def, null, 2);
    setText(pretty);
    setBaseline(pretty);
  }

  const schema =
    tab === 'items' ? itemDefSchema : tab === 'loot' ? lootTableDefSchema : vendorDefSchema;
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
    void queryClient.invalidateQueries({ queryKey: ['items'] });
    void queryClient.invalidateQueries({ queryKey: ['loot-tables'] });
    void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    void queryClient.invalidateQueries({ queryKey: ['items-diff'] });
  };

  const endpoint = tab === 'items' ? 'items' : tab === 'loot' ? 'loot-tables' : 'vendors';

  const save = useMutation({
    mutationFn: async (def: { id: string }) => apiPut(`/${endpoint}/${def.id}`, def),
    onSuccess: () => {
      setBaseline(text);
      invalidate();
    },
  });
  const discard = useMutation({
    mutationFn: async (id: string) => apiDelete(`/${endpoint}/${id}/draft`),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: async () => apiPost<PublishResult>('/publish/items'),
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

  /** Patch the buffer without leaving the editor (ƒ-suggest buttons). */
  const patchDraft = (patch: (def: ItemDef) => ItemDef) => {
    if (!parsed.success || tab !== 'items') return;
    const next = patch(parsed.data as ItemDef);
    setText(JSON.stringify(next, null, 2));
  };

  const pendingCount =
    (diff.data?.items.length ?? 0) +
    (diff.data?.loot.length ?? 0) +
    (diff.data?.vendors.length ?? 0);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelectedId(null);
    setBufferFor(null);
    setText('');
    setBaseline('');
  };

  // --- per-tab side panels -------------------------------------------------

  const budgetPanel = () => {
    if (tab !== 'items' || !parsed.success) return null;
    const def = parsed.data as ItemDef;
    const row = itemRows.find((entry) => entry.id === def.id);
    const budget = row?.budget;
    if (!budget) return null;
    const spent = Object.entries(def.stats).reduce(
      (sum, [key, value]) => (key === 'armor' || key === 'critPct' ? sum : sum + (value ?? 0)),
      0,
    );
    const pct = budget.budget > 0 ? Math.min(150, Math.round((spent / budget.budget) * 100)) : 0;
    const rollCount = Math.min(ROLLS_BY_RARITY[def.rarity], def.rollPool?.length ?? 0);
    const iconTwin = itemRows.find((entry) => entry.icon === def.icon && entry.id !== def.id);
    return (
      <div className="items-budget">
        <div className="items-budget-head">
          <span>stat budget</span>
          <b>
            {spent} / {budget.budget}
          </b>
          <span className="ws-help">
            {rollCount > 0
              ? `${rollCount} rolled attribute${rollCount === 1 ? '' : 's'} on drop`
              : 'no roll pool — every copy identical'}
          </span>
        </div>
        <div className="items-budget-bar">
          <div
            className={`items-budget-fill${pct > 115 ? ' is-over' : pct < 85 ? ' is-under' : ''}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="items-budget-facts">
          <span>
            value <b>{def.value}</b> <span className="ws-help">ƒ {budget.value}</span>
          </span>
          {budget.weapon ? (
            <span>
              damage{' '}
              <b>
                {def.weapon?.dmgMin ?? 0}–{def.weapon?.dmgMax ?? 0}
              </b>{' '}
              <span className="ws-help">
                ƒ {budget.weapon.min}–{budget.weapon.max}
              </span>
            </span>
          ) : null}
          {def.armorClass ? (
            <span>
              free armour <b>{budget.freeArmor}</b>{' '}
              <span className="ws-help">on top of the budget</span>
            </span>
          ) : null}
        </div>
        {iconTwin ? (
          <p className="items-icon-warning">
            icon “{def.icon}” already belongs to {iconTwin.id} — publish will refuse it (§8)
          </p>
        ) : null}
        {canWrite ? (
          <div className="items-suggest">
            <button
              className="ws-btn"
              onClick={() => {
                patchDraft((current) => ({ ...current, value: budget.value }));
              }}
            >
              ƒ value
            </button>
            {budget.weapon ? (
              <button
                className="ws-btn"
                onClick={() => {
                  patchDraft((current) =>
                    current.weapon
                      ? {
                          ...current,
                          weapon: {
                            ...current.weapon,
                            dmgMin: budget.weapon?.min ?? current.weapon.dmgMin,
                            dmgMax: budget.weapon?.max ?? current.weapon.dmgMax,
                          },
                        }
                      : current,
                  );
                }}
              >
                ƒ damage band
              </button>
            ) : null}
            {spent > 0 ? (
              <button
                className="ws-btn"
                onClick={() => {
                  patchDraft((current) => scaleStatsToBudget(current, budget.budget));
                }}
              >
                ƒ scale stats to budget
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const simulation = useMemo(() => {
    if (tab !== 'loot' || !parsed.success) return null;
    const table = parsed.data as LootTableDef;
    // Simulate against the DRAFT: the edited table overrides the stored one.
    const tables = new Map(tablesById);
    tables.set(table.id, table);
    const rng = mulberry32(1337);
    const counts = new Map<string, { rolls: number; qty: number }>();
    let gold = 0;
    let goldRolls = 0;
    let empty = 0;
    for (let run = 0; run < SIM_ROLLS; run++) {
      const drops = rollLootTable(
        tables,
        table.id,
        simRollsPerKill,
        { killerLevel: simLevel },
        rng,
      );
      if (drops.length === 0) empty++;
      for (const drop of drops) {
        if (drop.kind === 'gold') {
          gold += drop.qty;
          goldRolls++;
          continue;
        }
        const entry = counts.get(drop.itemId) ?? { rolls: 0, qty: 0 };
        entry.rolls++;
        entry.qty += drop.qty;
        counts.set(drop.itemId, entry);
      }
    }
    return {
      empty,
      gold,
      goldRolls,
      rows: [...counts.entries()]
        .map(([itemId, entry]) => ({
          itemId,
          name: itemsById.get(itemId)?.name ?? itemId,
          rarity: itemsById.get(itemId)?.rarity ?? 'common',
          known: itemsById.has(itemId),
          pct: (entry.rolls / SIM_ROLLS) * 100,
          avgQty: entry.qty / entry.rolls,
        }))
        .sort((a, b) => b.pct - a.pct),
    };
  }, [tab, parsed, tablesById, itemsById, simLevel, simRollsPerKill]);

  const vendorPreview = useMemo(() => {
    if (tab !== 'vendors' || !parsed.success) return null;
    const vendor = parsed.data as VendorDef;
    return vendor.stock.map((entry) => {
      const def = itemsById.get(entry.itemId);
      const value = def?.value ?? 0;
      return {
        itemId: entry.itemId,
        name: def?.name ?? entry.itemId,
        known: def !== undefined,
        value,
        buy: entry.priceOverride ?? Math.max(1, Math.round(value * vendor.buyMult)),
        sell: sellPriceFor(value, vendor.sellMult),
      };
    });
  }, [tab, parsed, itemsById]);

  // --- render ---------------------------------------------------------------

  const filtered = itemRows.filter(
    (row) =>
      filter === '' ||
      row.id.includes(filter.toLowerCase()) ||
      row.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const categories = [...new Set(filtered.map((row) => row.category))].sort();

  return (
    <div className="abilities-page">
      <aside className="abilities-list ws-panel">
        <header className="panel-head">
          <h2>Items</h2>
        </header>
        {/* Three tabs do not fit beside the title in a 230 px rail — they get
            their own row rather than spilling over the editor panel. */}
        <div className="progression-tabs items-tabs">
          {(['items', 'loot', 'vendors'] as Tab[]).map((entry) => (
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

        {tab === 'items' ? (
          <>
            <input
              className="items-filter"
              placeholder="filter…"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
            {categories.map((category) => (
              <section key={category} className="abilities-group">
                <h3 className="abilities-group-title">{category}</h3>
                {filtered
                  .filter((row) => row.category === category)
                  .map((row) => (
                    <button
                      key={row.id}
                      className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedId(row.id);
                      }}
                    >
                      <span
                        className="items-rarity-dot"
                        style={{
                          background: RARITY_COLORS[row.rarity as keyof typeof RARITY_COLORS],
                        }}
                        title={row.rarity}
                      />
                      <span className="abilities-row-binding">i{row.ilvl}</span>
                      <span className="abilities-row-name">{row.name}</span>
                      {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
                    </button>
                  ))}
              </section>
            ))}
            {itemRows.length === 0 && !items.isLoading ? (
              <p className="ws-help">No items yet — P8-C authors the first catalogue.</p>
            ) : null}
          </>
        ) : null}

        {tab === 'loot' ? (
          <>
            {lootRows.map((row) => (
              <button
                key={row.id}
                className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                onClick={() => {
                  setSelectedId(row.id);
                }}
              >
                <span className="abilities-row-binding">{row.entries}×</span>
                <span className="abilities-row-name">{row.name}</span>
                {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
              </button>
            ))}
            {lootRows.length === 0 && !loot.isLoading ? (
              <p className="ws-help">No loot tables yet.</p>
            ) : null}
          </>
        ) : null}

        {tab === 'vendors' ? (
          <>
            {vendorRows.map((row) => (
              <button
                key={row.id}
                className={`abilities-row${row.id === selectedId ? ' is-active' : ''}`}
                onClick={() => {
                  setSelectedId(row.id);
                }}
              >
                <span className="abilities-row-binding">{row.kind}</span>
                <span className="abilities-row-name">
                  {row.name} <span className="ws-help">{row.stock} lines</span>
                </span>
                {row.hasDraft ? <span className="abilities-row-draft" title="draft" /> : null}
              </button>
            ))}
            {vendorRows.length === 0 && !vendors.isLoading ? (
              <p className="ws-help">No vendors yet.</p>
            ) : null}
          </>
        ) : null}
      </aside>

      <section className="abilities-editor ws-panel">
        <header className="panel-head">
          <h2>
            {selected ? selected.id : `Select a ${tab === 'loot' ? 'table' : tab.slice(0, -1)}`}
          </h2>
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

        {selected ? (
          <>
            {budgetPanel()}

            {tab === 'loot' ? (
              <div className="items-sim">
                <div className="items-sim-head">
                  <label>
                    killer level
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={simLevel}
                      onChange={(event) => {
                        setSimLevel(Number(event.target.value));
                      }}
                    />
                  </label>
                  <label>
                    rolls per kill
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={simRollsPerKill}
                      onChange={(event) => {
                        setSimRollsPerKill(Number(event.target.value));
                      }}
                    />
                  </label>
                  <span className="ws-help">
                    {SIM_ROLLS} seeded kills through the SAME roller the server uses
                  </span>
                </div>
                {simulation ? (
                  <table className="progression-curve">
                    <thead>
                      <tr>
                        <th>drop</th>
                        <th>per kill</th>
                        <th>avg qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulation.rows.map((row) => (
                        <tr key={row.itemId}>
                          <td className={row.known ? '' : 'items-unknown'}>
                            {row.name}
                            {row.known ? '' : ' (unknown item!)'}
                          </td>
                          <td>{row.pct.toFixed(1)}%</td>
                          <td className="ws-help">{row.avgQty.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="ws-help">gold</td>
                        <td className="ws-help">
                          {simulation.goldRolls > 0
                            ? `${((simulation.goldRolls / SIM_ROLLS) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="ws-help">
                          {simulation.goldRolls > 0
                            ? (simulation.gold / simulation.goldRolls).toFixed(1)
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="ws-help">nothing at all</td>
                        <td className="ws-help">
                          {((simulation.empty / SIM_ROLLS) * 100).toFixed(1)}%
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                ) : null}
              </div>
            ) : null}

            {vendorPreview ? (
              <table className="progression-curve items-vendor-preview">
                <thead>
                  <tr>
                    <th>stock</th>
                    <th>value</th>
                    <th>player pays</th>
                    <th>vendor pays</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorPreview.map((row) => (
                    <tr key={row.itemId}>
                      <td className={row.known ? '' : 'items-unknown'}>
                        {row.name}
                        {row.known ? '' : ' (unknown item!)'}
                      </td>
                      <td className="ws-help">{row.value}</td>
                      <td>{row.buy}</td>
                      <td className="ws-help">{row.sell}</td>
                    </tr>
                  ))}
                  {vendorPreview.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="ws-help">
                        No stock lines — a Collector buys but sells nothing (§6).
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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
          </>
        ) : (
          <p className="ws-help">
            {tab === 'items'
              ? 'Pick an item. The meter prices it against the §2 budget for its slot, ilvl and rarity — deviating is allowed, deviating by accident is what the meter prevents.'
              : tab === 'loot'
                ? 'Pick a table. `nothing` is a real weighted entry: most trash rolls pay no gear, and the simulator shows that honestly.'
                : 'Pick a vendor. Prices are computed by the shared formulas — the server charges exactly what this preview shows.'}
          </p>
        )}
      </section>

      <aside className="abilities-publish ws-panel">
        <header className="panel-head">
          <h2>Publish</h2>
          <span className="abilities-pending">{pendingCount} pending</span>
        </header>
        {[...(diff.data?.items ?? []), ...(diff.data?.loot ?? []), ...(diff.data?.vendors ?? [])]
          .slice(0, 40)
          .map((entry) => (
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
            if (window.confirm(`Publish ${pendingCount} item draft(s) to the live game?`)) {
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

/**
 * Rescale an item's attribute block to hit its budget exactly, keeping the
 * author's proportions (a 2:1 STR/VIT item stays 2:1). Armour and crit are
 * priced separately, so they ride along untouched.
 */
const scaleStatsToBudget = (def: ItemDef, budget: number): ItemDef => {
  const keys = (Object.keys(def.stats) as (keyof ItemDef['stats'])[]).filter(
    (key) => key !== 'armor' && key !== 'critPct',
  );
  const total = keys.reduce((sum, key) => sum + (def.stats[key] ?? 0), 0);
  if (total <= 0 || keys.length === 0) return def;
  const stats = { ...def.stats };
  let spent = 0;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      stats[key] = Math.max(1, budget - spent);
      return;
    }
    const share = Math.max(1, Math.round((budget * (def.stats[key] ?? 0)) / total));
    stats[key] = share;
    spent += share;
  });
  return { ...def, stats };
};
