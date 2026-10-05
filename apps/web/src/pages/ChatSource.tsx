import type { ExactSourceReference, PageContext } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { exactInstructionsSearch, exactSourceQuery } from '../lib/exact-source.ts';

/** The message retains identity; edition labels come only from an exact server read. */
export function ChatSourceContext({
  selection,
  historical = false,
}: {
  selection: NonNullable<PageContext['selectedSource']>;
  historical?: boolean;
}) {
  // Display labels and unchecked reasons do not distinguish an immutable source identity.
  const reference: ExactSourceReference = {
    document: selection.source.document,
    version: selection.source.version,
    file: selection.source.file,
    sha256: selection.source.sha256,
    parse:
      selection.source.parse.status === 'parsed'
        ? selection.source.parse
        : { status: 'unavailable', reason: 'No checked text selected' },
    title: 'Selected instructions',
  };
  const resolved = useQuery({
    ...exactSourceQuery(reference),
    staleTime: 60_000,
    retryOnMount: false,
  });
  const source = resolved.data?.source;
  const selector =
    selection.passage !== undefined
      ? { passage: selection.passage }
      : selection.section !== undefined
        ? { section: selection.section }
        : {};
  return (
    <section
      className="chat-question"
      aria-label={historical ? 'Source selected for this message' : 'Selected source for chat'}
    >
      <p>
        {historical ? 'Asked with instructions: ' : 'Instructions for this message: '}
        <Link
          to="/library/instructions"
          search={exactInstructionsSearch(selection.source, selector)}
        >
          {source?.title ?? 'Selected instructions'}
        </Link>
        {source?.printedRevision && <> · {source.printedRevision}</>}
        {selection.passage !== undefined
          ? ' · selected passage'
          : selection.section !== undefined
            ? ` · section ${selection.section + 1}`
            : ' · whole source'}
      </p>
      {selection.source.parse.status === 'unavailable' && (
        <p className="muted">Text remains unchecked.</p>
      )}
      {resolved.error && (
        <p className="muted">
          This exact source could not be checked. Open the source link to review it.
        </p>
      )}
      <details>
        <summary>Source reference</summary>
        {resolved.error && <p>{resolved.error.message}</p>}
        <pre>
          {JSON.stringify(
            {
              document: selection.source.document,
              version: selection.source.version,
              file: selection.source.file,
              sha256: selection.source.sha256,
              parse:
                selection.source.parse.status === 'parsed'
                  ? selection.source.parse
                  : { status: 'unavailable' },
              ...selector,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
