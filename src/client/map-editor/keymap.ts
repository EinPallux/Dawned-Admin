/**
 * The rebindable keymap (A3-d · MAP_EDITOR.md §6).
 *
 * The editor's shortcuts were a `switch` on `event.code`, which is fine until
 * someone's keyboard puts `[` somewhere else, or they simply want `Q` for the
 * thing they do four hundred times an hour. This turns that switch into DATA:
 * one action per row, one key per action, stored per browser.
 *
 * Per browser, not per account, deliberately — a keymap is a property of the
 * hands and the hardware in front of them, not of the login. It is also the one
 * piece of editor state where losing it costs a minute, so localStorage is an
 * honest home rather than a shortcut.
 */

export const EDITOR_ACTIONS = [
  'toolSculpt',
  'toolPaint',
  'toolPlace',
  'toolZone',
  'toolScatter',
  'toolMeasure',
  'brushSmaller',
  'brushBigger',
  'topDown',
  'cycleOverlay',
  'toggleGrid',
  'frameCursor',
  'isolate',
  'deleteSelection',
] as const;
export type EditorAction = (typeof EDITOR_ACTIONS)[number];

export const ACTION_LABEL: Record<EditorAction, string> = {
  toolSculpt: 'Sculpt tool',
  toolPaint: 'Paint tool',
  toolPlace: 'Place tool',
  toolZone: 'Zone tool',
  toolScatter: 'Scatter tool',
  toolMeasure: 'Measure tool',
  brushSmaller: 'Brush smaller',
  brushBigger: 'Brush bigger',
  topDown: 'Top-down camera',
  cycleOverlay: 'Cycle overlay',
  toggleGrid: 'Chunk grid',
  frameCursor: 'Frame cursor',
  isolate: 'Isolate selection',
  deleteSelection: 'Delete selection',
};

/** MAP_EDITOR.md §6's defaults, as far as they apply to the tools that exist. */
export const DEFAULT_KEYMAP: Record<EditorAction, string> = {
  toolSculpt: 'KeyB',
  toolPaint: 'KeyP',
  toolPlace: 'KeyV',
  toolZone: 'KeyZ',
  toolScatter: 'KeyN',
  toolMeasure: 'KeyM',
  brushSmaller: 'BracketLeft',
  brushBigger: 'BracketRight',
  topDown: 'KeyT',
  cycleOverlay: 'KeyO',
  toggleGrid: 'KeyG',
  frameCursor: 'KeyF',
  isolate: 'KeyH',
  deleteSelection: 'Delete',
};

const STORAGE_KEY = 'dawned.map-editor.keymap.v1';

export type Keymap = Record<EditorAction, string>;

/** Read the stored keymap, filling any gaps from the defaults. */
export const loadKeymap = (): Keymap => {
  const map = { ...DEFAULT_KEYMAP };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return map;
    for (const action of EDITOR_ACTIONS) {
      const code = (parsed as Record<string, unknown>)[action];
      // A new action added in a later release must not be left unbound just
      // because an old keymap is in the browser.
      if (typeof code === 'string' && code) map[action] = code;
    }
  } catch {
    // A corrupt keymap is not worth a broken editor.
  }
  return map;
};

export const saveKeymap = (map: Keymap): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private mode, quota, whatever — the map still works this session.
  }
};

/**
 * Which action a key press means, or null.
 *
 * Bindings are unique by construction (`bind` clears the previous holder), so
 * this is a straight lookup rather than a first-match scan.
 */
export const actionFor = (map: Keymap, code: string): EditorAction | null => {
  for (const action of EDITOR_ACTIONS) {
    if (map[action] === code) return action;
  }
  return null;
};

/**
 * Bind `code` to `action`, taking it off whatever held it.
 *
 * Two actions on one key is the classic keybind bug: the second one silently
 * never fires and the owner concludes the feature is broken. The old holder is
 * left UNBOUND (empty string) rather than swapped, because a silent swap moves
 * a key they did not ask to move.
 */
export const bindKey = (map: Keymap, action: EditorAction, code: string): Keymap => {
  const next = { ...map };
  for (const other of EDITOR_ACTIONS) {
    if (other !== action && next[other] === code) next[other] = '';
  }
  next[action] = code;
  return next;
};

/** A key press the editor must never steal. */
export const isReservedKey = (code: string): boolean =>
  code === 'Escape' || code === 'Tab' || code === 'Enter' || code === 'NumpadEnter';

/** `KeyB` → `B`, `BracketLeft` → `[` — what to print on the button. */
export const keyLabel = (code: string): string => {
  if (!code) return '—';
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  const named: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Space: 'Space',
    Delete: 'Del',
    Backspace: '⌫',
  };
  return named[code] ?? code;
};
