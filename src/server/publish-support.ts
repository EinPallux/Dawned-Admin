/**
 * Shared publish plumbing.
 *
 * Poking the live game after a publish is rule 3 (everything live goes through
 * the ops API) and every publish path needs it — abilities, items, enemies and
 * now the map. It was copied into each of them; one copy is enough, and one
 * copy is what keeps the failure behaviour identical everywhere.
 *
 * A failure here NEVER fails a publish: the rows (or the bake) are already
 * committed and the game picks them up at its next boot. Saying so plainly
 * beats rolling back good content because the game happened to be restarting.
 */

import type { Config } from './config.js';

export interface ReloadOutcome {
  ok: boolean;
  note: string;
}

/** Ask the game server to re-read published content rows between ticks. */
export const reloadGameContent = (config: Config): Promise<ReloadOutcome> =>
  poke(config, 'reload-content', 'game unreachable — content applies on its next restart');

/**
 * Ask the game server to re-read `current.json` and swap in the map it names.
 *
 * Loading a whole bake takes seconds on the VPS (7 MB of chunks + a 1 MiB
 * walkgrid), so this waits longer than a content reload does. Same failure
 * rule: the bake is already on disk and the pointer already moved, so a game
 * that is down simply picks the new world up when it comes back.
 */
export const reloadGameMap = (config: Config): Promise<ReloadOutcome> =>
  poke(config, 'reload-map', 'game unreachable — the new map loads on its next restart', 30_000);

/**
 * Send a live-ops command with a body (A4's "grant to my GM character").
 *
 * Separate from `poke` because this one CARRIES data and the caller wants the
 * game's answer — a refusal ("player not online") is the useful half. Rule 3
 * still holds: the panel never touches game memory, it asks the game to.
 */
export const gameOps = async (
  config: Config,
  route: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; payload: unknown }> => {
  try {
    const response = await fetch(`${config.GAME_OPS_URL}/ops/${route}`, {
      method: 'POST',
      headers: { 'x-ops-secret': config.OPS_SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 503, payload: { error: 'game unreachable' } };
  }
};

const poke = async (
  config: Config,
  route: string,
  unreachableNote: string,
  timeoutMs = 5000,
): Promise<ReloadOutcome> => {
  try {
    const response = await fetch(`${config.GAME_OPS_URL}/ops/${route}`, {
      method: 'POST',
      headers: { 'x-ops-secret': config.OPS_SECRET },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json()) as { ok?: boolean; note?: string; error?: string };
    return response.ok
      ? { ok: true, note: body.note ?? 'reloaded' }
      : { ok: false, note: body.error ?? `reload refused (${response.status})` };
  } catch {
    return { ok: false, note: unreachableNote };
  }
};
