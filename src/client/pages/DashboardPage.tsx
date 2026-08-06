/**
 * Dashboard v1 (ADMIN_DESIGN §3): live server card fed by the game's health +
 * ops metrics, a publish card (stub until the A1 pipeline), quick actions.
 * Every number shown is actionable — no vanity charts.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api.js';
import type { DashboardData } from '../../shared-ext/api-types.js';

/**
 * Rolling tick-p95 samples, one per poll (~5 s → ~5 min of history). Module
 * scope on purpose: it feeds from the query function, needs no re-render of
 * its own (each poll already re-renders via fresh query data), and surviving
 * remounts/logins is a feature for an ops graph.
 */
const tickHistory: number[] = [];

const formatUptime = (seconds: number | null): string => {
  if (seconds === null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
};

/** Tick-p95 sparkline over the poll history — the one graph that must stay flat. */
const TickSparkline = ({ samples }: { samples: number[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const budget = 15; // ms — the phase-gate ceiling
    const max = Math.max(budget, ...samples);
    ctx.strokeStyle = '#333a47';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const budgetY = height - (budget / max) * (height - 6) - 3;
    ctx.moveTo(0, budgetY);
    ctx.lineTo(width, budgetY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#57c77b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach((value, index) => {
      const x = (index / Math.max(59, samples.length - 1)) * width;
      const y = height - (value / max) * (height - 6) - 3;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#8b93a3';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`tick p95 · budget ${budget} ms`, 4, 11);
  }, [samples]);
  return <canvas ref={canvasRef} className="spark" width={300} height={42} />;
};

export const DashboardPage = () => {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const data = await apiGet<DashboardData>('/dashboard');
      if (data.metrics) {
        tickHistory.push(data.metrics.tickP95Ms);
        if (tickHistory.length > 60) tickHistory.shift();
      }
      return data;
    },
    refetchInterval: 5000,
  });
  const data = dashboard.data;

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">The Dawnlands at a glance.</p>
      {dashboard.isError && (
        <div className="error-banner">The panel API is unreachable — retrying…</div>
      )}
      <div className="card-grid">
        <section className="ws-panel card">
          <h2>
            Game server
            {data && (
              <span className={`ws-badge ${data.game.online ? 'ws-badge--ok' : 'ws-badge--down'}`}>
                {data.game.online ? 'online' : 'down'}
              </span>
            )}
          </h2>
          {!data ? (
            <div className="loading">Loading…</div>
          ) : (
            <>
              <div className="stat-rows">
                <div className="stat-row">
                  <span className="k">Players online</span>
                  <span className="v">
                    {data.game.players}
                    {data.game.maxPlayers !== null ? ` / ${data.game.maxPlayers}` : ''}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="k">Uptime</span>
                  <span className="v">{formatUptime(data.game.uptimeSec)}</span>
                </div>
                <div className="stat-row">
                  <span className="k">Protocol</span>
                  <span className="v">
                    {data.game.protocolVersion !== null ? `v${data.game.protocolVersion}` : '—'}
                  </span>
                </div>
                {data.metrics && (
                  <>
                    <div className="stat-row">
                      <span className="k">Tick p95 / max</span>
                      <span className="v">
                        {data.metrics.tickP95Ms.toFixed(1)} / {data.metrics.tickMaxMs.toFixed(1)} ms
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="k">Memory (RSS)</span>
                      <span className="v">{data.metrics.rssMb} MB</span>
                    </div>
                    <div className="stat-row">
                      <span className="k">Net out</span>
                      <span className="v">
                        {(data.metrics.bytesOutPerSec / 1000).toFixed(1)} kB/s
                      </span>
                    </div>
                  </>
                )}
                {!data.metrics && data.game.online && (
                  <div className="ws-help">Ops metrics unavailable (secret or route).</div>
                )}
              </div>
              {tickHistory.length > 1 && <TickSparkline samples={[...tickHistory]} />}
            </>
          )}
        </section>

        <section className="ws-panel card">
          <h2>Publish</h2>
          {!data ? (
            <div className="loading">Loading…</div>
          ) : (
            <div className="stat-rows">
              <div className="stat-row">
                <span className="k">Active content</span>
                <span className="v">{data.publish.activeVersion}</span>
              </div>
              <div className="stat-row">
                <span className="k">Drafts pending</span>
                <span className="v">{data.publish.draftsPending}</span>
              </div>
              {/*
                This said "the publish pipeline arrives with A1" until
                2026-08-06 — A1 shipped months ago and every editor has
                published through it since. A dashboard that describes a
                future that already happened teaches you to stop reading it.
              */}
              <div className="ws-help" style={{ marginTop: 6 }}>
                {data.publish.draftsPending > 0 ? (
                  <>
                    You have unpublished changes in{' '}
                    <Link to="/content/world-settings">World Settings</Link>. Publish them there to
                    put them in the running game.
                  </>
                ) : (
                  'Everything you have edited is live in the game.'
                )}
              </div>
            </div>
          )}
        </section>

        <section className="ws-panel card">
          <h2>Quick actions</h2>
          <div className="stat-rows">
            <Link to="/content/world-settings">Edit world settings</Link>
            <a href="https://play.pathlands.cc" target="_blank" rel="noopener noreferrer">
              Open the game
            </a>
            <span className="ws-help">Announce & content reload join with A4 (Live Ops).</span>
          </div>
        </section>
      </div>
    </>
  );
};
