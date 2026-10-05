import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAssistant } from '../assistant.tsx';
import { assistantSetupQuery } from '../queries.ts';
import { AreaTabs } from './AreaHead.tsx';

const methodIntake =
  'I want to draft a reusable lab method. First ask what I want it to achieve and whether I have a protocol or source document to work from. Wait for my answers before choosing scientific settings or creating a method draft. Keep unknowns explicit and use the existing sources and lab definitions when we continue.';

/** A new task has its own conversation; retry preserves the same intake. */
export function startMethodDraft(send: ReturnType<typeof useAssistant>['send']) {
  return send(methodIntake, { fresh: true });
}

/** Library task entry (004g / SG-07); specialist lists retain their own operations and paths. */
export function LibraryHome() {
  const assistant = useAssistant();
  const setup = useQuery(assistantSetupQuery);
  const [failed, setFailed] = useState(false);
  const busy = assistant.sending || assistant.running;
  const unavailable = setup.data?.configured === false;
  const start = async () => {
    setFailed(false);
    setFailed(!(await startMethodDraft(assistant.send)));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / <b>library</b>
          </div>
          <h1>Library</h1>
          <p className="lede">Methods, source instructions and the lab’s own knowledge.</p>
        </div>
      </div>
      <section className="block library-start" aria-label="Library tasks">
        <header>
          <h2>What would you like to do?</h2>
        </header>
        <div className="body">
          <ul className="library-tasks">
            <li>
              <button
                type="button"
                className="btn primary"
                disabled={busy || unavailable || setup.isPending || setup.isError}
                onClick={() => void start()}
              >
                Draft a method
              </button>
              <p>
                Start with the assistant: what the method should achieve and any protocol you have.
              </p>
            </li>
            <li>
              <Link to="/documents" className="btn">
                Find instructions
              </Link>
              <p>Search source protocols, manuals and papers for the instructions you need.</p>
            </li>
            <li>
              <Link to="/memory" className="btn">
                Find a lab convention
              </Link>
              <p>Look up the lab’s reviewed practices, preferences and lessons.</p>
            </li>
          </ul>
          {busy && (
            <p className="muted">The assistant is working. Start a method when it has finished.</p>
          )}
          {setup.isPending && <p className="muted">Checking assistant availability…</p>}
          {setup.isError && (
            <p className="error-text" role="alert">
              Could not check assistant availability: {setup.error.message}{' '}
              <button type="button" className="link-btn" onClick={() => void setup.refetch()}>
                Check again
              </button>
            </p>
          )}
          {unavailable && !setup.isError && (
            <p className="warn-ink">
              The assistant is unavailable.{' '}
              <button type="button" className="link-btn" onClick={() => assistant.show()}>
                Open the assistant
              </button>{' '}
              for details.
            </p>
          )}
          {failed && (
            <p className="error-text" role="alert">
              {assistant.sendError ?? 'The conversation could not be started.'} Try Draft a method
              again.
            </p>
          )}
        </div>
      </section>
      <details className="library-browse">
        <summary>Browse the library</summary>
        <p className="muted">Open a collection to browse its records and review waiting drafts.</p>
        <AreaTabs area="Library" />
      </details>
    </>
  );
}
