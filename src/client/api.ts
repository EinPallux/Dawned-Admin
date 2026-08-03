/**
 * Fetch wrapper for the panel API. Every call rides the public `/admin` prefix
 * (Caddy/Vite strip it before the service), carries credentials, and stamps the
 * CSRF header the server demands on mutations.
 */

import type { ApiError } from '../shared-ext/api-types.js';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Raw error body — structured failures (publish problems) ride here. */
    readonly payload: unknown = null,
  ) {
    super(message);
  }
}

export const api = async <T>(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<T> => {
  const response = await fetch(`/admin/api${path}`, {
    credentials: 'same-origin',
    method: options.method ?? 'GET',
    ...(options.body !== undefined ? { body: options.body } : {}),
    headers: {
      // content-type only WITH a body: Fastify rejects an empty JSON body
      // outright, which broke body-less POSTs (publish).
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-dawned-admin': '1',
    },
  });
  if (!response.ok) {
    let error: ApiError = { error: 'unknown', message: `Request failed (${response.status}).` };
    let raw: unknown = null;
    try {
      raw = await response.json();
      error = raw as ApiError;
    } catch {
      // non-JSON error body — keep the fallback
    }
    throw new ApiRequestError(response.status, error.error, error.message, raw);
  }
  return response.json() as Promise<T>;
};

export const apiGet = <T>(path: string): Promise<T> => api<T>(path);
export const apiPost = <T>(path: string, payload?: unknown): Promise<T> =>
  api<T>(path, {
    method: 'POST',
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
export const apiPut = <T>(path: string, payload: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(payload) });
export const apiDelete = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });
