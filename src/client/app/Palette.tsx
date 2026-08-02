/**
 * Command palette (ADMIN_DESIGN §1: "everything findable in ≤2 actions").
 * A0 scope: navigation + session actions; entity search joins in A1 when the
 * content editors exist to search over.
 */

import { useEffect, useRef, useState } from 'react';

export interface PaletteEntry {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export const Palette = ({ entries, onClose }: { entries: PaletteEntry[]; onClose: () => void }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = entries.filter((entry) =>
    entry.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const clampedActive = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ws-panel palette">
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command or destination…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              runEntry(matches[clampedActive]);
            }
          }}
        />
        <div className="palette-list">
          {matches.length === 0 && <div className="palette-empty">Nothing matches.</div>}
          {matches.map((entry, index) => (
            <div
              key={entry.id}
              className={`palette-item${index === clampedActive ? ' is-active' : ''}`}
              onMouseEnter={() => {
                setActive(index);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                runEntry(entry);
              }}
            >
              {entry.label}
              <span className="hint">{entry.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
