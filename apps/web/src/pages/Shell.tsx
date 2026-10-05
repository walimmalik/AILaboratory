import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { AssistantProvider, useAssistant } from '../assistant.tsx';
import { areas, kindPage, libraryPages } from '../lib/kinds.ts';
import { LiveProvider, useLive } from '../live.tsx';
import { recordQuery, reviewQuery } from '../queries.ts';
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
  const counts = useQuery(reviewQuery).data?.counts;
  // Only what blocks something counts in the nav (plan 004e R1); drafts show on their own pages.
  const pending = counts?.needsYou ?? 0;
  const draftsOf = (kind: string) => counts?.drafts[kind] ?? 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assistant = useAssistant();
  // At laptop width, or with the assistant open below a wide screen, the module list folds behind
  // a Menu button so tables keep their columns. On a phone it does too, with the theme and sign
  // out inside it, so the header is one line and every entry is in the menu (review 2026-10-02).
  const wide = useMedia('(min-width: 1600px)');
  const roomy = useMedia('(min-width: 1200px)');
  const phone = !useMedia('(min-width: 721px)');
  const compact = phone || !roomy || (assistant.open && !wide);
  const [menu, setMenu] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // The area the page belongs to: a tab's own path, or a record's (or new record's) kind.
  const recordId = path.match(/^\/records\/([^/]+)$/)?.[1];
  const recordKind = useQuery({ ...recordQuery(recordId ?? ''), enabled: !!recordId }).data?.kind;
  const newKind = path.match(/^\/new\/([^/]+)$/)?.[1];
  const areaHere =
    libraryPages.find((p) => p.path === path)?.area ?? kindPage(recordKind ?? newKind ?? '')?.area;
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu whenever the page changes
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const signOut = async () => {
    await api.signOut();
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };

  const settings = (
    <>
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
    </>
  );

  return (
    <div
      className={`shell${assistant.open ? ' with-assistant' : ''}${compact ? ' compact' : ''}${compact && menu ? ' nav-open' : ''}`}
      style={{ '--assistant-width': `${assistant.width}px` } as CSSProperties}
    >
      <header className="topbar">
        {compact && (
          <button
            type="button"
            className="btn small"
            aria-expanded={menu}
            aria-controls="modules"
            onClick={() => setMenu(!menu)}
          >
            Menu
            {pending > 0 && <span className="count num agent-ink"> {pending}</span>}
          </button>
        )}
        <Link to="/" className="brand">
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
        {!phone && settings}
      </header>

      <nav className="nav" id="modules" aria-label="Modules">
        {/* Eight entries (plan 004f N1): the lab's day, then four areas, each one page with tabs. */}
        <section>
          <ul>
            <li>
              <Link to="/" activeOptions={{ exact: true }}>
                Today
              </Link>
            </li>
            <li>
              <Link to="/review">
                Review
                {pending > 0 && (
                  <span className="count num pending" title={`${pending} need you`}>
                    {pending}
                  </span>
                )}
              </Link>
            </li>
            <li>
              <Link to="/activity">
                <span className={`lamp ${live.connected ? 'on' : 'off'}`} aria-hidden="true" />
                Activity
              </Link>
            </li>
            <li>
              <Link to="/scan">Scan</Link>
            </li>
          </ul>
        </section>
        <section>
          <ul>
            {areas.map(({ area, tabs, kinds }) => {
              const drafts = kinds.reduce((n, kind) => n + draftsOf(kind), 0);
              const here = area === areaHere;
              const first = tabs[0];
              if (!first) return null;
              return (
                <li key={area}>
                  <Link
                    to={first.path}
                    className={here ? 'on' : undefined}
                    aria-current={here ? 'page' : undefined}
                  >
                    {area}
                    {drafts > 0 && (
                      <span className="count num pending" title={`${drafts} drafts to review`}>
                        {drafts}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="nav-foot">
          <ul>
            <li>
              <Link to="/calculators">Calculators</Link>
            </li>
            <li>
              <Link to="/wiki">Wiki</Link>
            </li>
            <li>
              <Link to="/records" activeOptions={{ exact: true }}>
                All records
              </Link>
            </li>
          </ul>
        </section>
        {phone && <section className="nav-settings">{settings}</section>}
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
            {pending} {pending === 1 ? 'needs' : 'need'} you
          </Link>
        )}
        <span className="push muted">{me?.user.displayName}</span>
      </footer>
    </div>
  );
}

/** Whether the window matches a media query, kept current as it resizes. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
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
