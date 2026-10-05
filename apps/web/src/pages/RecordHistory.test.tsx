import type { ScientificQuestion } from '@ailab/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ItemDiff } from './ItemDiff.tsx';
import { QuestionSnapshot } from './RecordHistory.tsx';

vi.mock('../session.ts', () => ({ useMe: () => ({ user: { id: 'usr_scientist' } }) }));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({ data: [] }),
}));

describe('scientific question history', () => {
  it('keeps before and after values adjacent once, while preserving proposal diff presentation', () => {
    const before = { attributes: { workingVolume: { max: { value: '300', unit: 'uL' } } } };
    const after = { attributes: { workingVolume: { max: { value: '320', unit: 'uL' } } } };
    const html = renderToStaticMarkup(
      <ItemDiff
        kind="labware_type"
        before={before}
        after={after}
        adjacent
        caption="What changed"
        labels={{ '/workingVolume/max': 'Maximum working volume' }}
      />,
    );
    expect(html).toContain('Maximum working volume');
    expect(html).toContain('Before → After');
    expect(html.match(/300 µL/g)).toHaveLength(1);
    expect(html.match(/320 µL/g)).toHaveLength(1);
    expect(html.match(/<td>/g)).toHaveLength(1);
    expect(html).not.toContain('title="/workingVolume/max"');
    const proposal = renderToStaticMarkup(
      <ItemDiff kind="labware_type" before={before} after={after} />,
    );
    expect(proposal).toContain('What would change');
    expect(proposal).toContain('class="was"');
    expect(proposal).toContain('class="now"');
    expect(proposal.match(/<td>/g)).toHaveLength(2);
  });
  it('shows an open question and its response with readable attribution, without exposing actor or question IDs', () => {
    const question: ScientificQuestion = {
      id: 'wash_volume_conflict',
      question: 'Which wash volume should we use?',
      stage: { stage: 'method', reason: 'The two sources disagree' },
      disposition: { status: 'open' },
      responses: [
        {
          text: 'I do not know yet',
          by: { type: 'user', userId: 'usr_scientist' },
          at: '2026-10-05T09:00:00Z',
          version: 2,
        },
      ],
    };
    const html = renderToStaticMarkup(<QuestionSnapshot question={question} />);
    expect(html).toContain(question.question);
    expect(html).toContain('I do not know yet');
    expect(html).toContain('you');
    expect(html).toContain('v2');
    expect(html).toContain('open');
    expect(html).toContain('The two sources disagree');
    expect(html).not.toContain('usr_scientist');
    expect(html).not.toContain('wash_volume_conflict');
    expect(html).not.toContain('<a');
    expect(
      renderToStaticMarkup(<QuestionSnapshot question={{ ...question, responses: [] }} />),
    ).toContain('No responses recorded.');
  });
});
