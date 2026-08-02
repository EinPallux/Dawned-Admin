/**
 * Root: session gate + router. `/admin` is the public base path (Caddy strips
 * it server-side; the router carries it browser-side so deep links match
 * ADMIN_DESIGN §3 "every module deep-links").
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';
import { LoginScreen } from './LoginScreen.js';
import { Shell } from './Shell.js';
import { DashboardPage } from '../pages/DashboardPage.js';
import { WorldSettingsPage } from '../pages/WorldSettingsPage.js';

export const App = () => {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<AdminUser | null> => {
      try {
        const data = await apiGet<{ user: AdminUser | null }>('/auth/me');
        return data.user;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
  });

  if (me.isLoading) {
    return (
      <div className="loading" style={{ padding: 24 }}>
        Connecting to the panel…
      </div>
    );
  }

  const user = me.data ?? null;
  if (!user) {
    return (
      <LoginScreen
        onLoggedIn={(loggedIn) => {
          queryClient.setQueryData(['me'], loggedIn);
        }}
      />
    );
  }

  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route element={<Shell user={user} />}>
          <Route index element={<DashboardPage />} />
          <Route path="content/world-settings" element={<WorldSettingsPage user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
