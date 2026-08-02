/**
 * Read-only game probes for the dashboard: the public health endpoint and the
 * localhost ops metrics (shared-secret header — docs/ARCHITECTURE.md §4).
 * The game being down is data, not an error: cards render the outage.
 */

import { z } from 'zod';
import type { Config } from './config.js';
import type { DashboardData } from '../shared-ext/api-types.js';

const healthSchema = z.object({
  status: z.string(),
  protocolVersion: z.number(),
  players: z.number(),
  uptimeSec: z.number(),
});

const statusSchema = z.object({
  online: z.boolean(),
  players: z.number(),
  maxPlayers: z.number(),
});

const metricsSchema = z.object({
  tickP50Ms: z.number(),
  tickP95Ms: z.number(),
  tickMaxMs: z.number(),
  rssMb: z.number(),
  bytesOutPerSec: z.number(),
  sessions: z.number(),
});

const fetchJson = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
};

export const probeGame = async (config: Config): Promise<DashboardData['game']> => {
  try {
    const [health, status] = await Promise.all([
      fetchJson(`${config.GAME_OPS_URL}/api/health`).then((raw) => healthSchema.parse(raw)),
      fetchJson(`${config.GAME_OPS_URL}/api/status`).then((raw) => statusSchema.parse(raw)),
    ]);
    return {
      online: true,
      players: status.players,
      maxPlayers: status.maxPlayers,
      uptimeSec: health.uptimeSec,
      protocolVersion: health.protocolVersion,
    };
  } catch {
    return { online: false, players: 0, maxPlayers: null, uptimeSec: null, protocolVersion: null };
  }
};

export const probeMetrics = async (config: Config): Promise<DashboardData['metrics']> => {
  try {
    const raw = await fetchJson(`${config.GAME_OPS_URL}/ops/metrics`, {
      'x-ops-secret': config.OPS_SECRET,
    });
    return metricsSchema.parse(raw);
  } catch {
    return null;
  }
};
