import { ApiError } from '@ailab/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { api } from '../api.ts';
import { meQuery } from '../session.ts';

export function SignInPage() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await api.signIn(String(form.get('email')), String(form.get('password')));
      // Refetch now: the route guard reads this cache and would still see "signed out".
      await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      await navigate({ to: '/' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the API');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <form onSubmit={submit}>
        <h1>
          ai<span>lab</span>
        </h1>
        <label>
          Email
          <input className="field" name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            className="field"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="hint">
          First time? Run <span className="mono">pnpm --filter @ailab/api bootstrap</span>; forgot
          it? Run <span className="mono">pnpm --filter @ailab/api password</span>.
        </p>
      </form>
    </main>
  );
}
