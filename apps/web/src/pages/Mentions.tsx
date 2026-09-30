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

/**
 * Where the library mentions this record (plan 011c): each passage with its document and heading.
 * Proposed mentions are in agent ink until a person confirms or rejects them.
 */
export function MentionedIn({ record }: { record: RecordEnvelope }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const found = useQuery({
    queryKey: ['library', 'mentions', record.id],
    queryFn: () => api.run(libraryMentions, { record: record.id }),
  });
  const review = useMutation({
    mutationFn: (input: { confirm?: string[]; reject?: string[] }) =>
      api.run(libraryReviewMentions, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['library', 'mentions'] }),
  });
  const mentions = found.data?.mentions ?? [];
  if (mentions.length === 0) return null;
  const titles = new Map(found.data?.documents.map((d) => [d.id, d] as const));
  const proposed = mentions.filter((m) => m.status === 'proposed');
  const person = me !== undefined;
  return (
    <section className="block" aria-label="Mentioned in">
      <header>
        <h2>Mentioned in</h2>
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
                <th>Document</th>
                <th>Where</th>
                <th>As written</th>
                <th>Found</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mentions.map((m) => {
                const doc = titles.get(m.document);
                const agent = m.status === 'proposed' && isAgent(m.proposedBy);
                return (
                  <tr key={m.id}>
                    <td>
                      <Link to="/records/$id" params={{ id: m.document }}>
                        {doc?.label ?? m.document}
                      </Link>
                    </td>
                    <td>
                      {m.heading.join(' › ') || 'Start'}
                      {m.page ? `, page ${m.page}` : ''}
                    </td>
                    <td className={agent ? 'agent-ink' : undefined}>{m.text}</td>
                    <td className="muted">
                      {howWords[m.how]}
                      {m.status === 'proposed' ? ', not yet confirmed' : ''}
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
