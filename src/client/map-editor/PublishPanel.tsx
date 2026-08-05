/**
 * Validate ▸ Publish (MAP_EDITOR.md §4).
 *
 * Validation runs first and on its own, because most of the time the answer is
 * "fix this before you bake" and a bake the owner has to sit through only to be
 * told about a zone gap is a bake wasted. Problems BLOCK; warnings are shown
 * with equal prominence but do not stop anything — the difference between "this
 * will be broken in the game" and "this might not be what you meant".
 *
 * The bake itself streams (Server-Sent Events): a full-map bake walks 4 M
 * walkgrid cells and renders a 1024² map, and on a 1-core VPS a spinner with no
 * numbers is indistinguishable from a hang.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError, apiGet } from '../api.js';

interface ValidationReport {
  problems: string[];
  warnings: string[];
  stats: Record<string, number>;
}

interface BakeStep {
  step: string;
  done: number;
  total: number;
}

const STEP_LABELS: Record<string, string> = {
  validate: 'Validating the draft',
  chunks: 'Writing chunk bins',
  walkgrid: 'Baking the walkgrid',
  zones: 'Writing zones',
  placements: 'Resolving placements',
  renders: 'Rendering world map',
  spawners: 'Publishing spawners',
  prune: 'Sweeping old bakes',
  reload: 'Asking the game to load it',
};

export const PublishPanel = ({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: (version: string) => void;
}): React.JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [steps, setSteps] = useState<BakeStep[]>([]);
  const [result, setResult] = useState<{ version: string; warnings: string[] } | null>(null);
  /** Validation the bake streams back, which supersedes the query's answer. */
  const [streamed, setStreamed] = useState<ValidationReport | null>(null);

  // Validation is a fetch, so it is a query — never an effect that setStates.
  // `staleTime: 0` because the draft changes under it constantly; the point of
  // opening this panel is to ask again.
  const validation = useQuery({
    queryKey: ['map-validate'],
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: (): Promise<ValidationReport> => apiGet<ValidationReport>('/map/validate'),
  });
  const report = streamed ?? validation.data ?? null;
  const checking = validation.isFetching;
  const validationError =
    validation.error instanceof ApiRequestError
      ? validation.error.message
      : validation.error
        ? 'Validation failed.'
        : null;

  const publish = (): void => {
    setPublishing(true);
    setSteps([]);
    setError(null);
    setStreamed(null);
    // EventSource rather than fetch+ReadableStream: it reconnects on its own and
    // the panel is behind the same cookie the rest of the API uses.
    const source = new EventSource('/admin/api/map/publish-stream', { withCredentials: true });
    source.addEventListener('step', (event) => {
      const step = JSON.parse((event as MessageEvent<string>).data) as BakeStep;
      setSteps((current) => {
        const next = current.filter((entry) => entry.step !== step.step);
        return [...next, step];
      });
    });
    source.addEventListener('validation', (event) => {
      setStreamed(JSON.parse((event as MessageEvent<string>).data) as ValidationReport);
    });
    source.addEventListener('done', (event) => {
      const done = JSON.parse((event as MessageEvent<string>).data) as {
        ok: boolean;
        version?: string;
        problems?: string[];
        warnings?: string[];
      };
      source.close();
      setPublishing(false);
      if (done.ok && done.version) {
        setResult({ version: done.version, warnings: done.warnings ?? [] });
        onPublished(done.version);
      } else {
        setError((done.problems ?? ['Publish failed.']).join(' · '));
      }
    });
    source.onerror = () => {
      source.close();
      setPublishing(false);
      setError('The publish stream dropped. Check the server log before retrying.');
    };
  };

  const blocked = (report?.problems.length ?? 0) > 0;

  return (
    <div className="palette-backdrop me-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ws-panel me-publish">
        <header className="me-publish-head">
          <h2>Publish the map</h2>
          <button type="button" className="ws-btn" onClick={onClose}>
            Close
          </button>
        </header>

        {checking && <p className="me-hint">Validating…</p>}

        {report && !result && (
          <>
            <div className="me-stats">
              {Object.entries(report.stats).map(([key, value]) => (
                <span key={key}>
                  <b>{value.toLocaleString()}</b> {key}
                </span>
              ))}
            </div>

            {report.problems.length > 0 && (
              <section className="me-problems">
                <h3>Must be fixed ({report.problems.length})</h3>
                <ul>
                  {report.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </section>
            )}

            {report.warnings.length > 0 && (
              <section className="me-warnings">
                <h3>Worth a look ({report.warnings.length})</h3>
                <ul>
                  {report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}

            {report.problems.length === 0 && report.warnings.length === 0 && (
              <p className="me-ok">Nothing to report — the draft is publishable.</p>
            )}
          </>
        )}

        {publishing && (
          <section className="me-steps">
            {steps.map((step) => (
              <div key={step.step} className="me-step">
                <span>{STEP_LABELS[step.step] ?? step.step}</span>
                <progress value={step.done} max={Math.max(1, step.total)} />
                <span>
                  {step.done}/{step.total}
                </span>
              </div>
            ))}
          </section>
        )}

        {result && (
          <section className="me-ok">
            <h3>Published {result.version}</h3>
            <p>
              The game has been asked to load it. Anyone already in the world is offered a reload;
              new arrivals get the new map straight away.
            </p>
            {result.warnings.length > 0 && (
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {(error ?? validationError) && <p className="me-warn">{error ?? validationError}</p>}

        <footer className="me-publish-foot">
          <button
            type="button"
            className="ws-btn"
            disabled={publishing}
            onClick={() => {
              setStreamed(null);
              void validation.refetch();
            }}
          >
            Re-validate
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            disabled={publishing || blocked || checking || result !== null}
            onClick={publish}
            title={blocked ? 'Fix the problems above first' : 'Bake and publish'}
          >
            {publishing ? 'Publishing…' : 'Bake ▸ Publish'}
          </button>
        </footer>
      </div>
    </div>
  );
};
