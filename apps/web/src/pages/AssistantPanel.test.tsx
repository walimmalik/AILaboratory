import type { AssistantMessage, RecordEnvelope, ReviewItem } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AssistantResize, ConversationMessages } from './AssistantPanel.tsx';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: { id: string };
    children: ReactNode;
    className?: string;
  }) => (
    <a href={params ? to.replace('$id', params.id) : to} className={className}>
      {children}
    </a>
  ),
}));

const at = '2026-10-05T12:00:00Z';
const user = (id: string, text: string): AssistantMessage => ({ id, at, role: 'user', text });
const reply = (
  id: string,
  text: string,
  calls: Extract<AssistantMessage, { role: 'assistant' }>['toolCalls'] = [],
): AssistantMessage => ({ id, at, role: 'assistant', text, toolCalls: calls, model: 'gpt-6.1' });
function action(
  id: string,
  operationId = 'records.get',
  output: unknown = { id: `sop_${id}`, name: `SOP-${id}`, status: 'draft' },
  outcome: Extract<AssistantMessage, { role: 'tool' }>['outcome'] = 'done',
): AssistantMessage[] {
  return [
    reply(`assistant-${id}`, '', [{ id, operationId, input: { id: `sop_${id}` } }]),
    {
      id: `tool-${id}`,
      at,
      role: 'tool',
      toolCallId: id,
      operationId,
      outcome,
      result: { output },
      ...(outcome === 'failed'
        ? { error: { code: 'invalid_state', message: 'Choose a confirmed source SOP' } }
        : {}),
    },
  ];
}
function html(messages: AssistantMessage[], review?: ReviewItem[], running = false) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ol>
        <ConversationMessages
          messages={messages}
          agentName="GPT 6.1"
          running={running}
          review={review}
        />
      </ol>
    </QueryClientProvider>,
  );
}

/** Remove only the contents of closed Work details, as the browser does before disclosure. */
function visible(markup: string) {
  return markup
    .replace(/<details class="work-details">/g, '<details data-work="true">')
    .split(/(<\/?details\b[^>]*>)/)
    .reduce<{ depth: number; output: string }>(
      (state, token) => {
        if (token === '<details data-work="true">') state.depth = 1;
        else if (state.depth) {
          if (token.startsWith('<details')) state.depth++;
          if (token === '</details>') state.depth--;
        } else state.output += token;
        return state;
      },
      { depth: 0, output: '' },
    ).output;
}

describe('assistant transcript presentation', () => {
  it('keeps a long tool-only exchange in one closed disclosure with its full ordered trace', () => {
    const markup = html([
      user('ask', 'Compare source protocols'),
      ...Array.from({ length: 25 }, (_, i) => action(String(i))).flat(),
      reply('final', 'Which incubation temperature should we use?'),
    ]);
    expect(markup.match(/class="work-details"/g)).toHaveLength(1);
    expect(markup).toContain('Work details · 25 actions');
    expect(markup).not.toContain('<details class="work-details" open');
    expect(markup.match(/class="who mono agent-ink"/g)).toHaveLength(1);
    expect(visible(markup)).toContain('Which incubation temperature should we use?');
    expect(visible(markup)).not.toContain('SOP-0');
    expect(markup.indexOf('SOP-0')).toBeLessThan(markup.indexOf('SOP-24'));
    expect(markup.match(/technical details/g)).toHaveLength(25);
    expect(markup).toContain('&quot;operation&quot;: &quot;records.get&quot;');
  });

  it('breaks groups at scientific text and user requests, retaining attachments and pending calls', () => {
    const nextAsk = {
      ...user('next', 'Use 37 °C'),
      attachments: [
        {
          id: 'file_1',
          name: 'observations.tsv',
          mediaType: 'text/tab-separated-values',
          text: 'temperature\t37',
        },
      ],
    } as AssistantMessage;
    const markup = html(
      [
        user('ask', 'Check the sources'),
        ...action('one'),
        reply('question', 'Is the cell line sensitive to this buffer?'),
        ...action('two'),
        nextAsk,
        reply('pending', '', [{ id: 'pending-call', operationId: 'records.get', input: {} }]),
      ],
      undefined,
      true,
    );
    expect(markup.match(/class="work-details"/g)).toHaveLength(3);
    expect(visible(markup)).toContain('Is the cell line sensitive to this buffer?');
    expect(visible(markup)).toContain('Use 37 °C');
    expect(visible(markup)).toContain('observations.tsv');
    expect(markup).toContain('Work details · 1 action · in progress');
  });

  it('keeps files, memory acceptance, proposals, failures and saved drafts outside collapsed work', () => {
    const memory: RecordEnvelope = {
      id: 'mem_1',
      name: 'MEM-0001',
      status: 'draft',
      kind: 'memory',
      label: 'Freeze-thaw handling',
      orgId: 'org_1',
      labId: 'lab_1',
      version: 1,
      evidence: {},
      reviews: {},
      createdAt: at,
      updatedAt: at,
      createdBy: { type: 'user', userId: 'usr_1' },
      updatedBy: { type: 'user', userId: 'usr_1' },
      attributes: {
        statement: 'Avoid repeated freeze-thaw cycles',
        strength: 'note',
        kind: 'lesson',
      },
    };
    const markup = html([
      user('ask', 'Prepare the draft'),
      ...action('read'),
      ...action('file', 'platemaps.export', { filename: 'plate.csv', csv: 'well,role\nA1,blank' }),
      ...action('memory', 'memory.propose', memory),
      ...action('proposal', 'records.update', undefined, 'proposed'),
      ...action('failure', 'records.get', undefined, 'failed'),
      ...action('saved', 'records.create', { id: 'sop_saved', name: 'SOP-0001', status: 'draft' }),
    ]);
    const shown = visible(markup);
    expect(shown).toContain('plate.csv');
    expect(shown).toContain('Download');
    expect(shown).toContain('Copy');
    expect(shown).toContain('Remember this for the lab?');
    expect(shown).toContain('Avoid repeated freeze-thaw cycles');
    expect(shown).toContain('Confirm');
    expect(shown).toContain('href="/review"');
    expect(shown).toContain('waits for your review');
    expect(shown).toContain('Choose a confirmed source SOP');
    expect(shown).toContain('SOP-0001');
  });

  it('keeps writes without record outputs and unrecognized operations visible', () => {
    const markup = visible(
      html(
        [
          user('ask', 'Apply the changes'),
          ...action('read'),
          ...action('seen', 'records.mark_seen', {}),
          ...action('unknown', 'unknown.operation', {}),
          reply('pending-write', '', [
            { id: 'pending-write-call', operationId: 'records.update', input: {} },
          ]),
        ],
        undefined,
        true,
      ),
    );
    expect(markup).toContain('looked at');
    expect(markup).toContain('did something');
    expect(markup).toContain('edit…');
    expect(markup).not.toContain('SOP-read');
  });

  it('opens a blocked SOP draft before the final reply without asking to confirm it', () => {
    const draft: Extract<ReviewItem, { type: 'draft' }> = {
      type: 'draft',
      tier: 'to_confirm',
      at,
      record: {
        id: 'sop_saved',
        kind: 'sop',
        name: 'SOP-0001',
        label: 'Cell preparation',
        status: 'draft',
        version: 1,
        updatedBy: { type: 'user', userId: 'usr_1' },
      },
      byAgent: true,
      batchable: false,
      warnings: 0,
      sectionsToConfirm: ['Steps'],
      missing: ['Select the source protocol'],
      blockers: [
        'Before confirming, choose the source protocol, identify the cell line, and specify the incubation conditions. These three scientific questions must be resolved before the protocol can be confirmed.',
      ],
      ready: false,
      assumed: 0,
      unchecked: 0,
    };
    const messages = [
      user('ask', 'Draft the protocol'),
      ...action('read', 'records.get', { id: 'sop_other', name: 'SOP-0099', status: 'draft' }),
      ...action('saved', 'records.create', { id: 'sop_saved', name: 'SOP-0001', status: 'draft' }),
      reply('final', 'Next decision: which cell line will you use?'),
    ];
    const changeSet = visible(
      html(
        [
          user('set-ask', 'Save the protocol with its calculated volumes'),
          ...action('set', 'changes.apply', {
            results: [
              {
                operation: 'records.get',
                input: { id: 'sop_other' },
                output: { id: 'sop_other', name: 'SOP-0099', status: 'draft' },
              },
              {
                operation: 'calc.dilution',
                input: {},
                output: { dilution: { value: '2', unit: '1' } },
                calculation: 'calc_1',
              },
              {
                operation: 'records.create',
                input: { kind: 'sop', label: draft.record.label },
                output: {
                  ...draft.record,
                  orgId: 'org_1',
                  labId: 'lab_1',
                  attributes: {},
                  evidence: {},
                  reviews: {},
                  createdAt: at,
                  updatedAt: at,
                  createdBy: draft.record.updatedBy,
                },
              },
            ],
          }),
          reply('set-final', 'Which cell line should we use?'),
        ],
        [draft],
      ),
    );
    expect(changeSet).toContain('made a set of changes');
    expect(changeSet).toContain('href="/records/sop_saved">Open SOP draft: Cell preparation');
    expect(changeSet.indexOf('Open SOP draft')).toBeLessThan(changeSet.indexOf('Which cell line'));
    expect(changeSet).not.toContain('href="/records/sop_other"');
    expect(changeSet).not.toContain('class="work-details"');
    const markup = visible(html(messages, [draft]));
    expect(markup).toContain('href="/records/sop_saved">Open SOP draft: Cell preparation');
    expect(markup).toContain('draft · needs attention before confirmation');
    expect(markup).not.toContain(draft.blockers[0]);
    expect(markup.indexOf('Open SOP draft')).toBeLessThan(markup.indexOf('Next decision:'));
    expect(markup).not.toContain('confirm SOP');
    expect(markup).not.toContain('ready for review');
    expect(markup).not.toContain('SOP-0099');
    expect(html(messages, undefined)).not.toContain('ready for review');
    const followup = [
      ...messages,
      user('new-ask', 'A separate request'),
      ...action('followup-read'),
      reply('followup-pending', '', [{ id: 'next-call', operationId: 'records.get', input: {} }]),
    ];
    const runningMarkup = visible(html(followup, [draft], true));
    expect(runningMarkup).toContain('Open SOP draft: Cell preparation');
    expect(runningMarkup.indexOf('Open SOP draft')).toBeLessThan(
      runningMarkup.indexOf('Next decision:'),
    );
    expect(runningMarkup.indexOf('Next decision:')).toBeLessThan(
      runningMarkup.indexOf('A separate request'),
    );
    expect(runningMarkup.match(/Open SOP draft/g)).toHaveLength(1);
    const settled = visible(
      html([...followup, reply('followup-final', 'I checked the source protocol.')], [draft]),
    );
    expect(settled).toContain('Open SOP draft: Cell preparation');
    expect(settled.match(/Open SOP draft/g)).toHaveLength(1);
    expect(visible(html(followup, [{ ...draft, blockers: [], ready: true }], true))).toContain(
      'draft · ready for review',
    );
    expect(visible(html(followup, [], true))).not.toContain('Open SOP draft');
    const secondDraft = {
      ...draft,
      record: { ...draft.record, id: 'sop_second', name: 'SOP-0002', label: 'Buffer preparation' },
    };
    const twoDrafts = visible(
      html(
        [
          ...messages,
          user('buffer-ask', 'Draft the buffer protocol'),
          ...action('second-saved', 'records.create', {
            id: 'sop_second',
            name: 'SOP-0002',
            status: 'draft',
          }),
          reply('buffer-final', 'Which buffer concentration should we use?'),
          user('third-ask', 'Check the references'),
        ],
        [draft, secondDraft],
        true,
      ),
    );
    expect(twoDrafts.match(/Open SOP draft/g)).toHaveLength(2);
    expect(twoDrafts.indexOf('Open SOP draft: Cell preparation')).toBeLessThan(
      twoDrafts.indexOf('Next decision:'),
    );
    expect(twoDrafts.indexOf('Open SOP draft: Buffer preparation')).toBeLessThan(
      twoDrafts.indexOf('Which buffer concentration'),
    );
  });
});

it('exposes an accessible vertical resize separator with viewport limits', () => {
  const markup = renderToStaticMarkup(<AssistantResize width={700} onResize={() => {}} />);
  expect(markup).toContain('<hr class="assistant-resize"');
  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain('aria-label="Resize assistant panel"');
  expect(markup).toContain('aria-orientation="vertical"');
  expect(markup).toContain('aria-valuemin="320"');
  expect(markup).toContain('aria-valuemax="840"');
  expect(markup).toContain('aria-valuenow="700"');
});
