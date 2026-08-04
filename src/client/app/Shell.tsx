/**
 * App shell (ADMIN_DESIGN §3): top bar with the corner-cut logo + environment
 * badge, left rail with the full module map (future phases visibly parked, not
 * hidden), Ctrl+K command palette, main outlet.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api.js';
import type { AdminUser, DashboardData } from '../../shared-ext/api-types.js';
import { Palette, type PaletteEntry } from './Palette.js';

const railLink = ({ isActive }: { isActive: boolean }) =>
  `rail-item${isActive ? ' is-active' : ''}`;

export const Shell = ({ user }: { user: AdminUser }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The pending-drafts badge rides the same dashboard query the home page uses.
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardData>('/dashboard'),
    refetchInterval: 5000,
  });
  const draftsPending = dashboard.data?.publish.draftsPending ?? 0;

  const logout = useCallback(async () => {
    await apiPost('/auth/logout');
    queryClient.setQueryData(['me'], null);
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const paletteEntries = useMemo<PaletteEntry[]>(
    () => [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        hint: 'nav',
        run: () => {
          void navigate('/');
        },
      },
      {
        id: 'nav-world-settings',
        label: 'Go to World Settings',
        hint: 'nav',
        run: () => {
          void navigate('/content/world-settings');
        },
      },
      {
        id: 'nav-abilities',
        label: 'Go to Abilities',
        hint: 'nav',
        run: () => {
          void navigate('/content/abilities');
        },
      },
      {
        id: 'nav-progression',
        label: 'Go to Progression (XP curve + skill trees)',
        hint: 'nav',
        run: () => {
          void navigate('/content/progression');
        },
      },
      {
        id: 'nav-enemies',
        label: 'Go to Enemies (bestiary, spawners, TTK)',
        hint: 'nav',
        run: () => {
          void navigate('/content/enemies');
        },
      },
      {
        id: 'nav-items',
        label: 'Go to Items (items, loot tables, vendors)',
        hint: 'nav',
        run: () => {
          void navigate('/content/items');
        },
      },
      {
        id: 'open-game',
        label: 'Open the game',
        hint: 'link',
        run: () => {
          window.open('https://play.pathlands.cc', '_blank', 'noopener');
        },
      },
      {
        id: 'logout',
        label: 'Sign out',
        hint: 'session',
        run: () => {
          void logout();
        },
      },
    ],
    [navigate, logout],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="shell">
      <header className="shell-top">
        <div className="shell-logo">
          DAWNED<span>-ADMIN</span>
        </div>
        <span className="ws-badge ws-badge--env">
          {import.meta.env.PROD ? 'production' : 'development'}
        </span>
        {draftsPending > 0 && (
          <span className="ws-badge ws-badge--draft">
            {draftsPending} draft{draftsPending === 1 ? '' : 's'} pending
          </span>
        )}
        <div className="shell-top-spacer" />
        <button
          className="ws-btn"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          Search… <span className="ws-kbd">Ctrl K</span>
        </button>
        <div className="shell-user">
          <b>{user.name}</b>
          <span className="ws-badge">{user.role}</span>
          <button
            className="ws-btn"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="shell-rail">
        <NavLink to="/" end className={railLink}>
          Dashboard
        </NavLink>
        <div className="rail-group">World</div>
        <div className="rail-item is-disabled" title="Arrives with phase A2">
          Map Editor <span className="phase">A2</span>
        </div>
        <div className="rail-group">Content</div>
        <NavLink to="/content/world-settings" className={railLink}>
          World Settings
        </NavLink>
        <NavLink to="/content/abilities" className={railLink}>
          Abilities
        </NavLink>
        <NavLink to="/content/progression" className={railLink}>
          Progression
        </NavLink>
        <NavLink to="/content/enemies" className={railLink}>
          Enemies
        </NavLink>
        <NavLink to="/content/items" className={railLink}>
          Items
        </NavLink>
        <div className="rail-item is-disabled" title="Arrives with phase A3">
          Quests <span className="phase">A3</span>
        </div>
        <div className="rail-group">Operations</div>
        <div className="rail-item is-disabled" title="Arrives with phase A4">
          Live Ops <span className="phase">A4</span>
        </div>
        <div className="rail-item is-disabled" title="Arrives with phase A4">
          Audit Log <span className="phase">A4</span>
        </div>
      </nav>

      <main className="shell-main">
        <Outlet />
      </main>

      {paletteOpen && (
        <Palette
          entries={paletteEntries}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
};
