/**
 * Panel API DTOs — shared between src/server (producers) and src/client
 * (consumers) so the two sides cannot drift. Content VALUE types come from
 * `@dawned/shared` (WorldSettings); these are only the panel's envelopes.
 */

import type { WorldSettings } from '@dawned/shared';

export type AdminRole = 'gm' | 'admin';

export interface AdminUser {
  accountId: number;
  name: string;
  role: AdminRole;
}

/** GET /api/dashboard */
export interface DashboardData {
  game: {
    online: boolean;
    players: number;
    maxPlayers: number | null;
    uptimeSec: number | null;
    protocolVersion: number | null;
  };
  metrics: {
    tickP50Ms: number;
    tickP95Ms: number;
    tickMaxMs: number;
    rssMb: number;
    bytesOutPerSec: number;
    sessions: number;
  } | null;
  publish: {
    /** Content publishes arrive in A1 — until then the active version is fixed. */
    activeVersion: string;
    draftsPending: number;
  };
}

/** GET/PUT /api/world-settings */
export interface WorldSettingsData {
  /** Effective published values (defaults overlaid with published rows). */
  published: WorldSettings;
  /** Effective draft view (published overlaid with draft rows). */
  draft: WorldSettings;
  /** Keys whose draft differs from published — the "n drafts pending" source. */
  draftKeys: string[];
}

export interface ApiError {
  error: string;
  message: string;
}
