import {
  PageContext,
  type RecordEnvelope,
  ReviewFinding,
  type ScientificQuestion,
  type SopAttributes,
} from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { currentQuestions, questionDiscussion, stepQuestions } from '../lib/sop-questions.ts';
import { SopBlocks } from './Sops.tsx';

vi.mock('../assistant.tsx', () => ({
  useAssistant: () => ({ send: vi.fn(), sending: false, running: false }),
}));

const at = '2026-10-05T12:00:00Z';
const user = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
const question = (id = 'wash_volume'): ScientificQuestion => ({
  id,
  about: { step: 'wash' },
  question:
    id === 'wash_volume' ? 'Which wash volume is supported?' : 'Which wash count is supported?',
  stage: { stage: 'method', reason: 'The source settings conflict.' },
  responses: [],
  disposition: { status: 'open' },
});
const attributes = (questions: ScientificQuestion[] = [question()]): SopAttributes => ({
  materials: [],
  variables: [],
  steps: [
    {
      id: 'wash',
      action: 'wash',
      title: 'Wash',
      text: 'Wash the plate with buffer.',
      parameters: [{ name: 'buffer', text: 'PBS' }],
    },
    {
      id: 'read',
      action: 'read',
      title: 'Read',
      text: 'Read the plate.',
      parameters: [{ name: 'wavelength', quantity: { value: '450', unit: 'nm' } }],
    },
  ],
  questions,
});
const record = (data: Record<string, unknown> = attributes()): RecordEnvelope => ({
  id: `sop_${'0'.repeat(26)}`,
  name: 'SOP-0001',
  label: 'Plate assay',
  kind: 'sop',
  status: 'draft',
  version: 7,
  orgId: 'org_1',
  labId: 'lab_1',
  evidence: {},
  reviews: {},
  attributes: data,
  createdAt: at,
  updatedAt: at,
  createdBy: user,
  updatedBy: user,
});
function html(sop = record(), client = new QueryClient()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SopBlocks record={sop} />
    </QueryClientProvider>,
  );
}
const procedure = (markup: string) => markup.slice(0, markup.indexOf('</section>') + 10);

describe('unfinished SOP steps', () => {
  it('labels a reviewer append as a new step while retaining numbered existing-step parameters', () => {
    const sop = record(attributes([]));
    const client = new QueryClient();
    client.setQueryData(['record', sop.id, 'sop', 'reviews'], {
      rounds: [
        {
          id: 'round-one',
          round: 1,
          findings: [
            ReviewFinding.parse({
              type: 'fix',
              path: '/steps/-',
              after: { id: 'wait', action: 'wait', text: 'Wait 2 min.' },
              reason: 'Retain the source wait instruction',
            }),
            ReviewFinding.parse({
              type: 'fix',
              path: '/steps/1/parameters/0/quantity',
              before: { value: '400', unit: 'nm' },
              after: { value: '450', unit: 'nm' },
              reason: 'Use the stated wavelength',
            }),
          ],
        },
      ],
    });
    const markup = html(sop, client);
    expect(markup).toContain('A new step:');
    expect(markup).toContain('Retain the source wait instruction');
    expect(markup).toContain('Step 2 (Read), wavelength:');
    expect(markup).toContain('Use the stated wavelength');
    expect(markup).not.toContain('Step NaN');
  });

  it('retains the ordered action, known settings and printable clarification', () => {
    const markup = html();
    const bench = procedure(markup);
    expect(bench).toContain('Draft procedure — not confirmed for use.');
    expect(bench).toContain('open method questions');
    expect(bench.indexOf('Wash the plate')).toBeLessThan(bench.indexOf('Read the plate'));
    expect(bench.match(/Needs clarification/g)).toHaveLength(1);
    expect(bench).toContain('buffer PBS');
    expect(bench).toContain('wavelength 450 nm');
    expect(bench).not.toContain('volume 0');
    expect(bench).not.toContain('Repeat');
    expect(bench).toContain('href="#sop-question-wash_volume"');
    expect(markup).toContain('id="sop-question-wash_volume"');
    expect(bench).toContain('aria-label="Discuss with assistant: Which wash volume is supported?"');
    expect(bench).toContain('<summary class="cite-toggle">1 question to clarify</summary>');
    // The interactive disclosure is hidden in print; the badge and procedure notice remain.
    const printed = bench.replace(
      /<details class="sop-clarifications no-print"[\s\S]*?<\/details>/g,
      '',
    );
    expect(printed).toContain('Needs clarification');
    expect(printed).toContain('Settle open method questions before final confirmation.');
    expect(printed).not.toContain('Discuss with assistant');
    expect(bench.match(/<p class="warn-ink">/g)).toHaveLength(1);
  });

  it('offers each linked question explicitly with one badge', () => {
    const markup = procedure(html(record(attributes([question(), question('wash_count')]))));
    expect(markup.match(/Needs clarification/g)).toHaveLength(1);
    for (const id of ['wash_volume', 'wash_count']) {
      expect(markup).toContain(`href="#sop-question-${id}"`);
    }
    expect(markup).toContain('<summary class="cite-toggle">2 questions to clarify</summary>');
    expect(markup).toContain(
      'aria-label="Review question: Which wash volume is supported?">Which wash volume is supported?</a>',
    );
    expect(markup).toContain(
      'aria-label="Review question: Which wash count is supported?">Which wash count is supported?</a>',
    );
    expect(markup).not.toContain('Method details remain unsettled');
    expect(markup).not.toContain('Review question 1');
    expect(markup).toContain('Discuss with assistant: Which wash count is supported?');
  });

  it('keeps a response pending and derives only linked open method questions', () => {
    const replied = {
      ...question(),
      responses: [{ text: 'I do not know.', by: user, at, version: 7 }],
    };
    const run: ScientificQuestion = {
      ...question('run_check'),
      stage: {
        stage: 'run',
        reason: 'Check at preparation.',
        binding: { type: 'run_check', check: 'plate' },
      },
    };
    const parsed = currentQuestions(record(attributes([replied, run])));
    expect(stepQuestions(parsed, 'wash')?.map((q) => q.id)).toEqual(['wash_volume']);
    expect(stepQuestions(parsed, 'read')).toEqual([]);
    const markup = html(record(attributes([replied])));
    expect(procedure(markup)).toContain('Needs clarification');
    expect(markup).toContain('Response received; the scientific issue remains open.');
  });

  it('shows reconciliation uncertainty for historical questions instead of a settled procedure', () => {
    const historical = record({
      ...attributes(),
      questions: [{ id: 'old', question: 'Wash settings?', answer: 'Unknown' }],
    });
    expect(currentQuestions(historical)).toBeUndefined();
    expect(stepQuestions(currentQuestions(historical), 'wash')).toBeUndefined();
    expect(procedure(html(historical))).toContain(
      'cannot determine whether this procedure is complete',
    );
    expect(questionDiscussion(historical, 'old')).toBeUndefined();
  });

  it('clears the derived marker only for an accepted disposition', () => {
    const sop = record();
    const settled: ScientificQuestion = {
      ...question(),
      disposition: {
        status: 'resolved',
        proposal: `prp_${'0'.repeat(26)}`,
        proposedBy: user,
        acceptedBy: user,
        at,
        action: {
          type: 'resolve',
          sop: sop.id,
          expectedVersion: 6,
          question: 'wash_volume',
          reason: 'Accepted a supported method variation.',
          basis: {
            type: 'scientific_rationale',
            rationale: 'A documented method variation is accepted.',
            validation: 'unvalidated_method_variation',
            sources: [],
          },
          affected: [{ id: sop.id, version: 6, paths: ['/steps'] }],
        },
        recheck: { version: 7, checks: [{ id: 'method', passed: true }], at },
      },
    };
    const data = record(attributes([settled]));
    expect(currentQuestions(data)).toHaveLength(1);
    expect(stepQuestions(currentQuestions(data), 'wash')).toEqual([]);
    expect(procedure(html(data))).not.toContain('Needs clarification');
  });

  it('does not infer missing details when no question is declared, and uses singular step grammar', () => {
    const data = attributes([]);
    data.steps = data.steps.slice(0, 1);
    const markup = procedure(html(record(data)));
    expect(markup).toContain('1 step');
    expect(markup).not.toContain('1 steps');
    expect(markup).not.toContain('Needs clarification');
  });

  it('builds valid discussion context for the selected current question and displayed version', () => {
    const sop = record(attributes([question(), question('wash_count')]));
    const discussion = questionDiscussion(sop, 'wash_count');
    expect(discussion?.context).toEqual({
      record: { id: sop.id, name: sop.name, version: 7 },
      activeQuestion: { id: 'wash_count', stage: 'method' },
    });
    expect(discussion?.message).toContain('Which wash count is supported?');
    expect(
      PageContext.safeParse({ path: `/records/${sop.id}`, ...discussion?.context }).success,
    ).toBe(true);
    expect(questionDiscussion({ ...sop, version: 8 }, 'wash_count')?.context.record.version).toBe(
      8,
    );
    expect(questionDiscussion(sop, 'missing')).toBeUndefined();
  });
});
