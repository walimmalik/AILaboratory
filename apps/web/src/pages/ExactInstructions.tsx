import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { exactInstructionsSearch, exactSourceQuery } from '../lib/exact-source.ts';

/** Read a selected historical source. No current-record controls belong in this reader. */
export function ExactInstructionsPage() {
  const search = useSearch({ from: '/app/library/instructions' });
  const outline = useQuery({
    ...exactSourceQuery(search.source),
    enabled: !!search.source && !search.error,
  });
  const selected = search.passage !== undefined || search.section !== undefined;
  const text = useQuery({
    ...exactSourceQuery(
      search.source,
      search.passage !== undefined
        ? { passages: [search.passage] }
        : search.section !== undefined
          ? { section: search.section }
          : {},
    ),
    enabled:
      !!search.source &&
      !search.error &&
      selected &&
      outline.data?.source?.parse.status === 'parsed' &&
      !outline.error,
  });
  const target = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: copy feedback belongs to this source and text selection.
  useEffect(() => {
    setCopied('');
  }, [search.source, search.passage, search.section]);
  useEffect(() => {
    if (selected && text.data && !text.error) {
      target.current?.focus({ preventScroll: true });
      target.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected, text.data, text.error]);
  const source = outline.data?.source;
  const selectedSection = search.section ?? text.data?.passages?.[0]?.section;
  const error = search.error ?? outline.error?.message;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">lab / library / source instructions</div>
          <h1>{source?.title ?? 'Source instructions'}</h1>
          {source?.printedRevision && (
            <p className="lede">Printed revision {source.printedRevision}</p>
          )}
        </div>
      </div>
      <p>
        <Link to="/documents" search={search.back ?? {}}>
          Back to document search
        </Link>
      </p>
      {error ? (
        <p className="error-text" role="alert">
          This exact source could not be opened. {error} Return to search for another source, or
          check the link.
        </p>
      ) : outline.isPending ? (
        <p className="muted">Opening the selected source…</p>
      ) : (
        source && (
          <section className="block" aria-label="Selected source instructions">
            <header>
              <h2>Source instructions</h2>
              <div className="toolbar">
                <a href={`/api/v1/files/${source.file}`} target="_blank" rel="noreferrer">
                  Open source file
                </a>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(window.location.href).then(
                      () => setCopied('Link copied.'),
                      () =>
                        setCopied('The link could not be copied. Copy it from the address bar.'),
                    );
                  }}
                >
                  Copy link
                </button>
                <span className="muted" role="status">
                  {copied}
                </span>
              </div>
            </header>
            <div className="body">
              {source.parse.status === 'unavailable' ? (
                <>
                  <p>Text could not be checked.</p>
                  <p className="muted">{source.parse.reason}</p>
                </>
              ) : (
                <>
                  {!!outline.data?.parse?.warnings.length && (
                    <p className="muted">{outline.data.parse.warnings.join(' ')}</p>
                  )}
                  <div className="places">
                    <nav aria-label="Source sections">
                      <ul className="tree">
                        {outline.data?.outline?.map((section) => (
                          <li key={section.index}>
                            <Link
                              to="/library/instructions"
                              search={exactInstructionsSearch(
                                source,
                                { section: section.index },
                                search.back,
                              )}
                              aria-current={
                                selectedSection === section.index ? 'location' : undefined
                              }
                            >
                              {section.heading.join(' › ') || `Section ${section.index + 1}`}
                              {section.pageFrom ? `, page ${section.pageFrom}` : ''}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </nav>
                    <section
                      className="passages"
                      ref={target}
                      tabIndex={-1}
                      aria-label="Selected source text"
                    >
                      {!selected ? (
                        <p className="muted">
                          {outline.data?.outline?.length
                            ? 'Choose a section to read its text.'
                            : 'This snapshot has no sections.'}
                        </p>
                      ) : text.error ? (
                        <p className="error-text" role="alert">
                          The selected text could not be opened. {text.error.message}
                        </p>
                      ) : text.isPending ? (
                        <p className="muted">Opening the selected text…</p>
                      ) : !text.data?.passages?.length ? (
                        <p className="muted">This section has no text.</p>
                      ) : (
                        text.data.passages.map((passage) => (
                          <div key={passage.id}>
                            <h3>{passage.heading.join(' › ') || 'Source text'}</h3>
                            {passage.page && <p className="muted">Page {passage.page}</p>}
                            <p className="passage">{passage.text}</p>
                          </div>
                        ))
                      )}
                    </section>
                  </div>
                </>
              )}
              <details>
                <summary>Source reference details</summary>
                <dl className="kv">
                  <dt>Document</dt>
                  <dd>{source.document}</dd>
                  <dt>Record version</dt>
                  <dd>{source.version}</dd>
                  <dt>File</dt>
                  <dd>{source.file}</dd>
                  <dt>File digest</dt>
                  <dd>{source.sha256}</dd>
                  {source.parse.status === 'parsed' && (
                    <>
                      <dt>Text snapshot</dt>
                      <dd>{source.parse.snapshot}</dd>
                    </>
                  )}
                </dl>
              </details>
            </div>
          </section>
        )
      )}
    </>
  );
}
