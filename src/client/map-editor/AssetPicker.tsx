/**
 * Pick a model by LOOKING at it.
 *
 * Owner pain point: "No preview of Placeable Assets." Every model choice in
 * this editor was a `<select>` of slugs — `world_buildings_houses_firstage_2_
 * level1` — so choosing a house meant stamping one, looking, deleting it and
 * trying the next.
 *
 * Tiles render the real model (thumbnailer.ts) and carry its real height in
 * metres, because two models that fill their tiles identically can be a
 * doorstep and a cathedral.
 *
 * The same component serves the Place tool, the inspector's model field and the
 * scatter brush — one picker, so "which house?" is answered the same way
 * wherever it is asked.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetEntry, ModelCache } from './model-cache.js';
import { thumbnailFor } from './thumbnailer.js';

const CATEGORY_LABEL: Record<string, string> = {
  'world/buildings': 'Buildings',
  'world/props': 'Props',
  'world/nature': 'Nature',
};

/** Slug → something a person reads: `world_buildings_houses_firstage_1` → "Houses Firstage 1". */
const prettyName = (id: string): string =>
  id
    .replace(/^world_(buildings|props|nature)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const Tile = ({
  entry,
  cache,
  selected,
  onPick,
}: {
  entry: AssetEntry;
  cache: ModelCache;
  selected: boolean;
  onPick: (id: string) => void;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const timer = useRef<number>(0);

  // Poll until the model has loaded, then draw once. A tile that never resolves
  // simply stays a name — the picker must not depend on every model loading.
  useEffect(() => {
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      const gltf = cache.gltfFor(entry.id);
      if (gltf) {
        setUrl(thumbnailFor(entry.id, gltf));
        return;
      }
      if (cache.isMissing(entry.id)) return;
      timer.current = window.setTimeout(attempt, 400);
    };
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, [entry.id, cache]);

  return (
    <button
      type="button"
      className={`ap-tile${selected ? ' ap-tile--on' : ''}`}
      onClick={() => {
        onPick(entry.id);
      }}
      title={`${entry.id}\n${entry.height.toFixed(1)} m tall`}
    >
      <span className="ap-thumb">
        {url ? <img src={url} alt="" /> : <span className="ap-thumb__wait" />}
      </span>
      <span className="ap-name">{prettyName(entry.id)}</span>
      <span className="ap-size">{entry.height.toFixed(1)} m</span>
    </button>
  );
};

export const AssetPicker = ({
  cache,
  value,
  onPick,
  onClose,
  title = 'Choose a model',
}: {
  cache: ModelCache;
  value: string | null;
  onPick: (id: string) => void;
  onClose?: () => void;
  title?: string;
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void cache.init().then(() => {
      setReady(true);
    });
  }, [cache]);

  const all = useMemo(() => (ready ? cache.placeable() : []), [cache, ready]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (entry) =>
        (category === 'all' || entry.category === category) &&
        (q === '' || entry.id.toLowerCase().includes(q)),
    );
  }, [all, query, category]);

  const categories = useMemo(() => [...new Set(all.map((e) => e.category))].sort(), [all]);

  return (
    <div className="ap">
      <div className="ap-head">
        <strong>{title}</strong>
        {onClose && (
          <button type="button" className="ws-btn ws-btn--sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <div className="ap-filters">
        <input
          className="ap-search"
          placeholder="Search…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
          }}
        >
          <option value="all">All ({all.length})</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c] ?? c} ({all.filter((e) => e.category === c).length})
            </option>
          ))}
        </select>
      </div>
      {!ready && <p className="ap-empty">Loading the model list…</p>}
      {ready && shown.length === 0 && <p className="ap-empty">Nothing matches “{query}”.</p>}
      <div className="ap-grid">
        {shown.map((entry) => (
          <Tile
            key={entry.id}
            entry={entry}
            cache={cache}
            selected={entry.id === value}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
};
