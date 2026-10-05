import type { OverviewFact } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatWhen } from '../lib/format.ts';
import { reviewQuery } from '../queries.ts';
import { KeyFacts } from './Record.tsx';
import { StatusChip } from './StatusChip.tsx';

const started = '2026-10-05T12:00:00Z';
const finished = '2026-10-05T14:30:00Z';
const timestamps: OverviewFact[] = [
  { label: 'started at', value: started, field: 'startedAt' },
  { label: 'finished at', value: finished, field: 'finishedAt' },
];
function html(kind: string, facts = timestamps, marked = new Set<string>()) {
  return renderToStaticMarkup(<KeyFacts kind={kind} facts={facts} marked={marked} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T18:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('run key facts', () => {
  it('formats start and finish in the reader’s time zone like checklist timestamps', () => {
    const markup = html('run');
    expect(markup).toContain(`<time dateTime="${started}">${formatWhen(started)}</time>`);
    expect(markup).toContain(`<time dateTime="${finished}">${formatWhen(finished)}</time>`);
    expect(markup).not.toContain(`<dd>${started}</dd>`);
    expect(markup).not.toContain(`<dd>${finished}</dd>`);
  });

  it('keeps execution status distinct from the record’s confirmation', () => {
    const client = new QueryClient();
    client.setQueryData(reviewQuery.queryKey, {
      items: [],
      counts: { total: 0, changes: 0, mentions: 0, notices: 0, needsYou: 0, drafts: {} },
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StatusChip record={{ id: 'run_1', status: 'active' }} />
        <KeyFacts
          kind="run"
          facts={[{ label: 'run status', value: 'done', field: 'status' }]}
          marked={new Set()}
        />
      </QueryClientProvider>,
    );
    expect(markup).toContain('<span class="chip active">confirmed</span>');
    expect(markup).toContain('<dt>run status</dt><dd>done</dd>');
    expect(markup).not.toContain('<dt>status</dt>');
    expect(markup).not.toContain('<time');
  });

  it('leaves other kinds and unrelated run values unchanged', () => {
    expect(html('experiment')).toContain(`<dd>${started}</dd>`);
    expect(html('run', [{ label: 'note', value: started, field: 'notes' }])).toContain(
      `<dd>${started}</dd>`,
    );
  });

  it('retains fact tone, detail and unsourced markers when formatting a timestamp', () => {
    const markup = html(
      'run',
      [{ ...timestamps[0], label: 'started at', value: started, tone: 'warn', detail: 'Entered' }],
      new Set(['startedAt']),
    );
    expect(markup).toContain('<dd class="warn-ink">');
    expect(markup).toContain('class="unsourced"');
    expect(markup).toContain('<small>Entered</small>');
    expect(markup).toContain(formatWhen(started));
  });
});
