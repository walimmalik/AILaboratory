import { formatQuantity } from '@ailab/domain';
import {
  libraryMentions,
  libraryReviewMentions,
  type Mention,
  type RecordEnvelope,
} from '@ailab/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { isAgent } from '../lib/format.ts';
import { useMe } from '../session.ts';

const howWords: Record<Mention['how'], string> = {
  catalog_number: 'by catalog number',
  name: 'by name',
  synonym: 'by another name',
  model: 'by model',
  agent: 'found by an agent',
};

/** What a mention is about, in words: a record, "Assay: ELISA", "blocking time: 1 h". */
function MentionWhat({ mention }: { mention: Mention }) {
  const what = mention.what;
  if (what.type === 'record') {
    return (
      <Link to="/records/$id" params={{ id: what.record }}>
        {what.label}
      </Link>
    );
  }
  if (what.type === 'assay') return <>Assay: {what.assay}</>;
  return (
    <>
      {what.parameter}: <span className="num">{formatQuantity(what.value)}</span>
    </>
  );
}

/**
 * Mentions in a table with Confirm and Reject for proposed ones (plan 011c). On a record page each
 * row names its document; on a document page it names what is mentioned.
 */
function MentionsBlock({
  title,
  mentions,
  documents,
  show,
}: {
  title: string;
  mentions: Mention[];
  documents: ReadonlyMap<string, { label: string }>;
  show: 'document' | 'what';
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: (input: { confirm?: string[]; reject?: string[] }) =>
      api.run(libraryReviewMentions, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['library'] }),
  });
  const proposed = mentions.filter((m) => m.status === 'proposed');
  const person = me !== undefined;
  return (
    <section className="block" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span className="state muted num">
          {mentions.length}
          {proposed.length > 0 && ` · ${proposed.length} to review`}
        </span>
      </header>
      <div className="body">
        {person && proposed.length > 1 && (
          <div className="toolbar">
            <button
              type="button"
              className="btn small"
              disabled={review.isPending}
              onClick={() => review.mutate({ confirm: proposed.map((m) => m.id) })}
            >
              Confirm all {proposed.length}
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{show === 'document' ? 'Document' : 'Mentions'}</th>
                <th>Where</th>
                <th>As written</th>
                <th>Found</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mentions.map((m) => {
                const agent = m.status === 'proposed' && isAgent(m.proposedBy);
                return (
                  <tr key={m.id}>
                    <td>
                      {show === 'document' ? (
                        <Link to="/records/$id" params={{ id: m.document }}>
                          {documents.get(m.document)?.label ?? m.document}
                        </Link>
                      ) : (
                        <MentionWhat mention={m} />
                      )}
                    </td>
                    <td>
                      {m.heading.join(' › ') || 'Start'}
                      {m.page ? `, page ${m.page}` : ''}
                    </td>
                    <td className={agent ? 'agent-ink' : undefined}>{m.text}</td>
                    <td className="muted">
                      {howWords[m.how]}
                      {m.status === 'proposed' ? ', not yet confirmed' : ''}
                      {m.status === 'rejected' ? ', rejected' : ''}
                    </td>
                    <td>
                      {person && m.status === 'proposed' && (
                        <span className="toolbar">
                          <button
                            type="button"
                            className="btn small"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ confirm: [m.id] })}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ reject: [m.id] })}
                          >
                            Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {review.error && <p className="error-text">{review.error.message}</p>}
      </div>
    </section>
  );
}

export const mentionsQuery = (input: { document?: string; record?: string }) => ({
  queryKey: ['library', 'mentions', input],
  queryFn: () => api.run(libraryMentions, input),
});

/** Where the library mentions this record: each document and passage heading. */
export function MentionedIn({ record }: { record: RecordEnvelope }) {
  const found = useQuery(mentionsQuery({ record: record.id }));
  const mentions = found.data?.mentions ?? [];
  if (mentions.length === 0) return null;
  return (
    <MentionsBlock
      title="Mentioned in"
      show="document"
      mentions={mentions}
      documents={new Map(found.data?.documents.map((d) => [d.id, d] as const))}
    />
  );
}

/** What a document mentions: records, its assay and the parameters it states. */
export function DocumentMentions({ mentions }: { mentions: Mention[] }) {
  if (mentions.length === 0) return null;
  return (
    <MentionsBlock title="What it mentions" show="what" mentions={mentions} documents={new Map()} />
  );
}
