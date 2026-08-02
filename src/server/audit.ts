/**
 * Audit plumbing (docs/ARCHITECTURE.md §3): every mutating panel action writes
 * an `audit_log` row. Writing the trail must never break the action itself —
 * failures are logged and swallowed.
 */

import { auditLog } from '@dawned/shared/schema';
import type { Db } from './db.js';

/** Structural slice of the fastify/pino logger — keeps pino out of our deps. */
interface ErrorLogger {
  error: (obj: unknown, msg?: string) => void;
}

export interface AuditEntry {
  actorAccountId: number;
  action: string;
  args?: unknown;
  target?: string;
  result: 'ok' | 'denied' | 'error';
}

export type AuditWriter = (entry: AuditEntry) => Promise<void>;

export const createAuditWriter = (db: Db, log: ErrorLogger): AuditWriter => {
  return async (entry) => {
    try {
      await db.insert(auditLog).values({
        actorAccountId: entry.actorAccountId,
        surface: 'admin',
        action: entry.action,
        args: entry.args ?? null,
        target: entry.target ?? null,
        result: entry.result,
        pos: null,
      });
    } catch (error) {
      log.error({ err: error, entry }, 'audit write failed');
    }
  };
};
