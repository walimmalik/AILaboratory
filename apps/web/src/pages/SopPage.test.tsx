import type { CheckResult, Readiness, RecordEnvelope, ScientificQuestion } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { questionDiscussion } from '../lib/sop-questions.ts';
import { sopReadiness, sopReviewOutcome } from '../lib/sop-readiness.ts';
import { SopPage } from './SopPage.tsx';

vi.mock('../assistant.tsx', () => ({
  useAssistant: () => ({ send: vi.fn(), sending: false, running: false }),
}));
vi.mock('./Sops.tsx', () => ({ SopBlocks: () => null }));

const at = '2026-10-05T12:00:00Z';
const person = { type: 'user' as const, userId: `usr_${'0'.repeat(26)}` };
const question = (id: string): ScientificQuestion => ({
  id,
  question: `Which ${id} is supported?`,
  stage: { stage: 'method', reason: 'The source needs checking.' },
  responses: [],
  disposition: { status: 'open' },
});
const questions = ['wash_volume', 'wash_count', 'temperature', 'duration'].map(question);
const record = (items: unknown[] = questions): RecordEnvelope => ({
  id: `sop_${'0'.repeat(26)}`,
  name: 'SOP-0001',
  label: 'Plate assay',
  kind: 'sop',
  status: 'draft',
  version: 7,
  orgId: 'org_1',
  labId: 'lab_1',
  attributes: { materials: [], variables: [], steps: [], questions: items },
  evidence: {},
  reviews: {},
  createdAt: at,
  updatedAt: at,
  createdBy: person,
  updatedBy: person,
});
const blocker = (id: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  id,
  label: id === 'questions_answered' ? 'Method questions are resolved' : 'A required check',
  severity: 'blocker',
  source: 'Science',
  passed: false,
  message:
    id === 'questions_answered'
      ? '4 open: Full checker question bundle'
      : 'Unknown critical setting',
  ...extra,
});
const readiness = (checks = [blocker('questions_answered')]): Readiness => ({
  recordId: record().id,
  version: 7,
  status: 'draft',
  ready: false,
  checks,
  sections: [
    { id: 'overview', title: 'Overview', fields: [], state: 'needs_review' },
    { id: 'procedure', title: 'Steps', fields: [], state: 'needs_review' },
  ],
  missing: [],
  assumed: [],
  unchecked: [],
  notApplicable: [],
});
function html(sop = record(), ready = readiness()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SopPage record={sop} readiness={ready} editing={undefined} onEdit={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('scientist-first SOP readiness', () => {
  it('opens with the saved scientific question and consequence ahead of estimates', () => {
    const review = sopReadiness(record(), readiness());
    expect(review.methodQuestions?.map((q) => q.id)).toEqual(questions.map((q) => q.id));
    expect(review.failing).toHaveLength(1);
    expect(review.visibleChecks).toEqual([]);
    const markup = html();
    expect(markup).toContain('4 questions to clarify');
    expect(markup).toContain('Other questions (3)');
    expect(markup).toContain('Help answer this');
    expect(markup.indexOf(question('wash_volume').question)).toBeLessThan(
      markup.indexOf('Why this matters: The source needs checking.'),
    );
    expect(markup.indexOf('Why this matters: The source needs checking.')).toBeLessThan(
      markup.indexOf('<summary>Other questions (3)</summary>'),
    );
    const withEstimate = html(record(), { ...readiness(), assumed: ['purpose'] });
    expect(withEstimate.indexOf('Why this matters: The source needs checking.')).toBeLessThan(
      withEstimate.indexOf('One value remains unverified'),
    );
    expect(markup).not.toContain('1 to fix');
    const compact = markup.slice(0, markup.indexOf('sop-readiness-checks'));
    expect(compact).not.toContain('Full checker question bundle');
    expect(markup).toContain('All readiness checks');
    expect(markup).toContain('Full checker question bundle');
  });

  it('keeps every saved question selectable with exact current discussion context', () => {
    const markup = html();
    for (const q of questions) {
      expect(markup).toContain(`href="#sop-question-${q.id}"`);
      expect(markup).toContain(q.question);
      if (q.id !== questions[0]?.id)
        expect(markup).toContain(`aria-label="Discuss with assistant: ${q.question}"`);
      expect(questionDiscussion(record(), q.id)?.context).toEqual({
        record: { id: record().id, name: 'SOP-0001', version: 7 },
        activeQuestion: { id: q.id, stage: 'method' },
      });
    }
    expect(markup).toContain('class="btn primary">Help answer this</button>');
    expect(markup).toMatch(
      /<details class="sop-readiness-decisions"><summary>Other questions \(3\)<\/summary>.*wash_count.*temperature.*duration.*<\/details>/,
    );
    expect(questionDiscussion(record(), 'wash_volume')?.message).toBe(
      `Help me clarify this question in Plate assay: ${question('wash_volume').question}`,
    );
    expect(markup).toContain('<summary>Review details</summary>');
    expect(markup).toContain('class="btn">Review ready sections</button>');
    expect(
      questionDiscussion({ ...record(), version: 8 }, 'wash_count')?.context.record.version,
    ).toBe(8);
  });

  it('renders saved question text and reason as text', () => {
    const unsafe = {
      ...question('html'),
      question: 'Does <sample> need 4 °C?',
      stage: { stage: 'method' as const, reason: 'Check source A & source B.' },
    };
    const markup = html(record([unsafe]));
    expect(markup).toContain('Does &lt;sample&gt; need 4 °C?');
    expect(markup).toContain('Why this matters: Check source A &amp; source B.');
    expect(markup).not.toContain('<sample>');
  });

  it('retains unrelated, unbound and unsupported blockers in the visible checks', () => {
    const checks = [
      blocker('questions_answered'),
      blocker('formula_invalid', { section: 'procedure' }),
      blocker('unbound_critical'),
      blocker('unsupported_requirement'),
    ];
    const review = sopReadiness(record(), readiness(checks));
    expect(review.otherBlockers.map((c) => c.id)).toEqual([
      'formula_invalid',
      'unbound_critical',
      'unsupported_requirement',
    ]);
    expect(review.confirmable.map((s) => s.id)).toEqual(['overview']);
    const compact = html(record(), readiness(checks)).split('sop-readiness-checks')[0] ?? '';
    expect(compact).toContain('4 questions to clarify · 3 other blockers');
    expect(compact?.match(/Unknown critical setting/g)).toHaveLength(3);
    expect(compact).toContain('Still blocked: steps.');
    expect(compact.indexOf('Unknown critical setting')).toBeLessThan(
      compact.indexOf('<summary>Review details</summary>'),
    );
  });

  it('does not summarize historical unsupported question data or unmatched versions', () => {
    const old = record([{ id: 'old', question: 'Wash?', answer: 'Unknown' }]);
    const ready = readiness([
      blocker('questions_answered', { message: 'History needs reconciliation' }),
    ]);
    expect(sopReadiness(old, ready).methodQuestions).toBeUndefined();
    expect(sopReadiness(old, ready).visibleChecks).toEqual(ready.checks);
    const compact = html(old, ready).split('sop-readiness-checks')[0];
    expect(compact).toContain('History needs reconciliation');
    expect(compact).not.toContain('Help answer this');
    expect(compact).not.toContain('questions to clarify');
    const stale = sopReadiness(record(), { ...readiness(), version: 6 });
    expect(stale.summarized).toBe(false);
    expect(stale.visibleChecks).toEqual(readiness().checks);
    const staleMarkup = html(record(), { ...readiness(), version: 6 });
    expect(staleMarkup).toContain('Full checker question bundle');
    expect(staleMarkup).not.toContain('Help answer this');
    expect(staleMarkup).not.toContain('Other questions (');
  });

  it('keeps unknown responses open and excludes later-stage questions from the method count', () => {
    const later: ScientificQuestion = {
      ...question('samples'),
      stage: {
        stage: 'experiment',
        reason: 'Choose samples later.',
        binding: { type: 'material_role', role: 'sample' },
      },
    };
    const replied = {
      ...question('wash_volume'),
      responses: [{ text: 'I do not know', by: person, at, version: 7 }],
    };
    expect(
      sopReadiness(record([replied, later]), readiness()).methodQuestions?.map((q) => q.id),
    ).toEqual(['wash_volume']);
    expect(html(record([replied, later]))).toContain('1 question to clarify');
    expect(html(record([replied, later]))).not.toContain('Other questions (');
    expect(
      sopReadiness(record([question('wash_volume'), question('wash_volume')]), readiness())
        .methodQuestions,
    ).toHaveLength(1);
  });

  it('shows partial review scope and the draft result separately from final confirmation', () => {
    const review = sopReadiness(record(), readiness());
    expect(review.actionLabel).toBe('Review ready sections');
    expect(review.before).toContain('Reviews overview, steps as saved.');
    expect(review.before).toContain('The SOP remains a draft');
    expect(html()).not.toContain('>Confirm SOP</button>');
    expect(html()).toMatch(
      /<details><summary>Review details<\/summary>.*Review ready sections<\/button><\/details>/,
    );
    const saved = {
      ...record(),
      version: 8,
      reviews: Object.fromEntries(
        ['overview', 'procedure'].map((id) => [
          id,
          {
            version: 7,
            confirmedBy: person,
            confirmedAt: at,
            values: {},
          },
        ]),
      ),
    };
    expect(sopReviewOutcome(saved, review.confirmable, true)).toBe(
      'Reviewed overview, steps. The SOP remains a draft; unresolved issues still block final confirmation.',
    );
    expect(
      sopReviewOutcome(
        {
          ...saved,
          reviews: Object.fromEntries(
            Object.entries(saved.reviews).filter(([id]) => id === 'overview'),
          ),
        },
        review.confirmable,
        true,
      ),
    ).toContain('Reviewed overview.');
    const final = sopReadiness(record([]), readiness([]));
    expect(final.actionLabel).toBe('Confirm SOP');
    expect(final.activates).toBe(true);
    expect(final.before).toContain(
      'Confirms overview, steps as saved. The SOP becomes confirmed for the lab.',
    );
    expect(html(record([]), readiness([]))).toContain('>Confirm SOP</button>');
    expect(html(record([]), readiness([]))).toContain('class="btn primary">Confirm SOP</button>');
    expect(sopReviewOutcome({ ...saved, status: 'active' }, final.confirmable, false)).toContain(
      'The SOP is confirmed for the lab.',
    );
    const reviewed = {
      ...readiness(),
      sections: readiness().sections.map((s) => ({ ...s, state: 'confirmed' as const })),
    };
    expect(sopReadiness(record(), reviewed).canConfirm).toBe(false);
    expect(html(record(), reviewed)).not.toContain('>Review ready sections</button>');
    expect(html(record(), reviewed)).toContain(
      'Settle the remaining issues before final confirmation.',
    );
  });
});
