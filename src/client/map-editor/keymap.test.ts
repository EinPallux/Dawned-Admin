/**
 * The rebindable keymap (A3-d).
 *
 * The bug this suite exists for: two actions on one key, where the second one
 * silently never fires and the owner concludes the feature is broken.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTION_LABEL,
  DEFAULT_KEYMAP,
  EDITOR_ACTIONS,
  actionFor,
  bindKey,
  isReservedKey,
  keyLabel,
  loadKeymap,
  saveKeymap,
} from './keymap.js';

describe('defaults', () => {
  it('binds every action, once', () => {
    const codes = EDITOR_ACTIONS.map((action) => DEFAULT_KEYMAP[action]);
    expect(codes.every((code) => code.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names every action for the UI', () => {
    for (const action of EDITOR_ACTIONS) expect(ACTION_LABEL[action]).toBeTruthy();
  });
});

describe('binding', () => {
  it('takes the key off whatever held it rather than doubling up', () => {
    const map = bindKey(DEFAULT_KEYMAP, 'toolPlace', DEFAULT_KEYMAP.toolZone);
    expect(map.toolPlace).toBe(DEFAULT_KEYMAP.toolZone);
    expect(map.toolZone).toBe('');
    expect(actionFor(map, DEFAULT_KEYMAP.toolZone)).toBe('toolPlace');
  });

  it('leaves everything else alone', () => {
    const map = bindKey(DEFAULT_KEYMAP, 'toolPlace', 'KeyJ');
    for (const action of EDITOR_ACTIONS) {
      if (action !== 'toolPlace') expect(map[action]).toBe(DEFAULT_KEYMAP[action]);
    }
  });

  it('never mutates the map it was given', () => {
    const before = { ...DEFAULT_KEYMAP };
    bindKey(DEFAULT_KEYMAP, 'toolPlace', 'KeyJ');
    expect(DEFAULT_KEYMAP).toEqual(before);
  });

  it('answers null for an unbound key', () => {
    expect(actionFor(DEFAULT_KEYMAP, 'KeyQ')).toBeNull();
  });
});

describe('reserved keys', () => {
  it('refuses the ones the editor itself needs', () => {
    expect(isReservedKey('Escape')).toBe(true);
    expect(isReservedKey('Enter')).toBe(true);
    expect(isReservedKey('KeyQ')).toBe(false);
  });
});

/**
 * A two-line localStorage. The suite runs in the node environment (there is no
 * DOM to test against here), and pulling in jsdom for one Map would be a
 * dependency bought to make a test look conventional.
 */
const installStorage = (): Map<string, string> => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  };
  return store;
};

describe('storage', () => {
  let store = new Map<string, string>();
  beforeEach(() => {
    store = installStorage();
  });

  it('round-trips', () => {
    const map = bindKey(DEFAULT_KEYMAP, 'toolScatter', 'KeyJ');
    saveKeymap(map);
    expect(loadKeymap().toolScatter).toBe('KeyJ');
  });

  it('fills in an action a stored map has never heard of', () => {
    // Exactly what happens when a release adds a tool: the old keymap is in
    // the browser and must not leave the new action unbound.
    store.set('dawned.map-editor.keymap.v1', JSON.stringify({ toolSculpt: 'KeyB' }));
    expect(loadKeymap().toolScatter).toBe(DEFAULT_KEYMAP.toolScatter);
  });

  it('survives junk in storage', () => {
    store.set('dawned.map-editor.keymap.v1', 'not json {');
    expect(loadKeymap()).toEqual(DEFAULT_KEYMAP);
  });
});

describe('labels', () => {
  it('prints what is on the key', () => {
    expect(keyLabel('KeyB')).toBe('B');
    expect(keyLabel('BracketLeft')).toBe('[');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('')).toBe('—');
    expect(keyLabel('F9')).toBe('F9');
  });
});
