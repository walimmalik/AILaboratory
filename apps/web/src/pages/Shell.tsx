import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { AssistantProvider, useAssistant } from '../assistant.tsx';
import { LiveProvider, useLive } from '../live.tsx';
import { reviewQuery } from '../queries.ts';
import { useMe } from '../session.ts';
import { type ThemeChoice, useTheme } from '../theme.ts';
import { AssistantPanel } from './AssistantPanel.tsx';

const themes: [ThemeChoice, string][] = [
  ['day', 'Day'],
  ['night', 'Night'],
  ['system', 'Auto'],
];

export function Shell() {
  return (
    <LiveProvider>
      <AssistantProvider>
        <ShellLayout />
      </AssistantProvider>
    </LiveProvider>
  );
}

function ShellLayout() {
  const me = useMe();
  const live = useLive();
  const [theme, setTheme] = useTheme();
  const pending = useQuery(reviewQuery).data?.length ?? 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assistant = useAssistant();

  const signOut = async () => {
    await api.signOut();
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };

  return (
    <div className={`shell ${assistant.open ? 'with-assistant' : ''}`}>
      <header className="topbar">
        <Link to="/activity" className="brand">
          ai<span>lab</span>
        </Link>
        <AskBar />
        <button
          type="button"
          className="btn small"
          aria-pressed={assistant.open}
          onClick={() => assistant.setOpen(!assistant.open)}
        >
          Assistant
        </button>
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
              <Link to="/review">
                Review
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

      {assistant.open && <AssistantPanel />}

      <footer className="statusbar">
        <span>
          <span className={`lamp ${live.connected ? 'on' : 'off'}`} aria-hidden="true" />
          {live.connected ? 'live' : 'reconnecting…'}
        </span>
        <span>{me?.lab.name}</span>
        {(assistant.running || assistant.sending) && (
          <button
            type="button"
            className="link-btn agent-ink"
            onClick={() => assistant.setOpen(true)}
          >
            <span className="lamp busy" aria-hidden="true" />
            assistant working…
          </button>
        )}
        {pending > 0 && (
          <Link to="/review" className="agent-ink">
            {pending} waiting for you
          </Link>
        )}
        <span className="push muted">{me?.user.displayName}</span>
      </footer>
    </div>
  );
}

/** The global ask bar: starts a new conversation with the assistant from any page. "/" focuses it. */
function AskBar() {
  const assistant = useAssistant();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    if (await assistant.send(message, { fresh: true })) setText('');
  };

  return (
    <form className="ask-bar" onSubmit={submit}>
      <span className="prompt mono" aria-hidden="true">
        ›
      </span>
      <label htmlFor="ask-bar" className="sr-only">
        Ask the assistant
      </label>
      <input
        id="ask-bar"
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask the assistant, or tell it what to draft"
        autoComplete="off"
      />
      {/* A keyboard hint, not a command: "/" anywhere on the page jumps here. */}
      {!text && (
        <kbd className="key-hint" title="Press / anywhere to jump here">
          /
        </kbd>
      )}
    </form>
  );
}
