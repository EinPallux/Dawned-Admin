/**
 * Panel sign-in — game accounts with gm/admin roles only (ARCHITECTURE.md §3).
 * Deliberately plain: this is a tool's door, not a fantasy screen.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost, ApiRequestError } from '../api.js';
import type { AdminUser } from '../../shared-ext/api-types.js';

export const LoginScreen = ({ onLoggedIn }: { onLoggedIn: (user: AdminUser) => void }) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: async () => {
      const data = await apiPost<{ user: AdminUser }>('/auth/login', { name, password });
      return data.user;
    },
    onSuccess: onLoggedIn,
  });

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!login.isPending) login.mutate();
  };

  const errorText =
    login.error instanceof ApiRequestError
      ? login.error.message
      : login.error
        ? 'The panel API is unreachable.'
        : null;

  return (
    <div className="login-wrap">
      <form className="ws-panel login-card" onSubmit={submit}>
        <h1>
          DAWNED<span style={{ color: 'var(--gold)' }}>-ADMIN</span>
        </h1>
        <div className="ws-help">Sign in with your game account (gm/admin role).</div>
        {errorText && <div className="error-banner">{errorText}</div>}
        <label className="login-field">
          <span className="ws-label">Account name</span>
          <input
            className="ws-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="login-field">
          <span className="ws-label">Password</span>
          <input
            className="ws-input"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
          />
        </label>
        <button
          className="ws-btn ws-btn--primary"
          type="submit"
          disabled={login.isPending || name.length < 3 || password.length === 0}
          style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
