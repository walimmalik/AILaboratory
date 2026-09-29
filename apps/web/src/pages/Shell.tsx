import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { api } from '../api.ts';
import { LiveProvider, useLive } from '../live.tsx';
import { pendingProposalsQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { type ThemeChoice, useTheme } from '../theme.ts';

const themes: [ThemeChoice, string][] = [
  ['day', 'Day'],
  ['night', 'Night'],
  ['system', 'Auto'],
];

export function Shell() {
  return (
    <LiveProvider>
      <ShellLayout />
    </LiveProvider>
  );
}

function ShellLayout() {
  const me = useMe();
  const live = useLive();
  const [theme, setTheme] = useTheme();
  const pending = useQuery(pendingProposalsQuery).data?.length ?? 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await api.signOut();
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/activity" className="brand">
          ai<span>lab</span>
        </Link>
        <span className="spacer" />
        <fieldset className="segmented">
          <legend className="sr-only">Theme</legend>
          {themes.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <button type="button" className="btn small" onClick={signOut}>
          Sign out
        </button>
      </header>

      <nav className="nav" aria-label="Modules">
        <section>
          <h2>Lab</h2>
          <ul>
            <li>
              <Link to="/activity">
                <span className={`lamp ${live.connected ? 'on' : 'off'}`} aria-hidden="true" />
                Activity
              </Link>
            </li>
            <li>
              <Link to="/proposals">
                Proposals
                <span className={`count num ${pending ? 'pending' : ''}`}>{pending}</span>
              </Link>
            </li>
            <li>
              <Link to="/records">Records</Link>
            </li>
          </ul>
        </section>
      </nav>

      <main className="page">
        <Outlet />
      </main>

      <footer className="statusbar">
        <span>
          <span className={`lamp ${live.connected ? 'on' : 'off'}`} aria-hidden="true" />
          {live.connected ? 'live' : 'reconnecting…'}
        </span>
        <span>{me?.lab.name}</span>
        {pending > 0 && (
          <Link to="/proposals" className="agent-ink">
            {pending} {pending === 1 ? 'change waits' : 'changes wait'} for review
          </Link>
        )}
        <span className="push muted">{me?.user.displayName}</span>
      </footer>
    </div>
  );
}
