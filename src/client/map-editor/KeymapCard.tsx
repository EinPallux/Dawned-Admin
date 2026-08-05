/**
 * The keybind UI (A3-d · MAP_EDITOR.md §6).
 *
 * Click a binding, press a key, done. The listening state is deliberately
 * loud — a row waiting for input says so and swallows the next press, because
 * the alternative is a UI where you cannot tell whether you are rebinding or
 * triggering.
 */

import { useEffect, useState } from 'react';
import {
  ACTION_LABEL,
  DEFAULT_KEYMAP,
  EDITOR_ACTIONS,
  bindKey,
  isReservedKey,
  keyLabel,
  type EditorAction,
  type Keymap,
} from './keymap.js';

export const KeymapCard = ({
  keymap,
  onChange,
}: {
  keymap: Keymap;
  onChange: (next: Keymap) => void;
}): React.JSX.Element => {
  const [listening, setListening] = useState<EditorAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setListening(null);
        return;
      }
      if (isReservedKey(event.code)) return;
      onChange(bindKey(keymap, listening, event.code));
      setListening(null);
    };
    // Capture phase: the editor's own shortcut handler is on window too, and
    // rebinding "top-down camera" must not also move the camera.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [listening, keymap, onChange]);

  return (
    <section className="ws-panel me-card">
      <h3>Keys</h3>
      <table className="me-budget">
        <tbody>
          {EDITOR_ACTIONS.map((action) => (
            <tr key={action}>
              <td>{ACTION_LABEL[action]}</td>
              <td colSpan={2}>
                <button
                  type="button"
                  className={`ws-btn me-tiny${listening === action ? ' me-on' : ''}`}
                  onClick={() => {
                    setListening((current) => (current === action ? null : action));
                  }}
                >
                  {listening === action ? 'press a key…' : keyLabel(keymap[action])}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="me-row">
        <button
          type="button"
          className="ws-btn me-tiny"
          onClick={() => {
            onChange({ ...DEFAULT_KEYMAP });
            setListening(null);
          }}
        >
          Reset to defaults
        </button>
      </div>
      <p className="me-hint">
        Ctrl+Z / Ctrl+Shift+Z undo, Ctrl+S saves, 1–9 recall camera slots (Shift stores). Those are
        fixed.
      </p>
    </section>
  );
};
