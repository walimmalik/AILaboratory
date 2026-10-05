import type { Readiness, RecordEnvelope } from '@ailab/schema';
import { currentQuestions } from './sop-questions.ts';

/** Presentation only: the server's checks still govern every confirmation. */
export function sopReadiness(record: RecordEnvelope, readiness: Readiness) {
  const questions = currentQuestions(record);
  const methodQuestions = questions
    ? [
        ...new Map(
          questions
            .filter((q) => q.stage.stage === 'method' && q.disposition.status === 'open')
            .map((q) => [q.id, q]),
        ).values(),
      ]
    : undefined;
  // Only this known aggregate check represents the current structured method questions.
  // Unsupported historical data, other checks and unmatched versions stay visible in full.
  const summarized =
    record.version === readiness.version &&
    !!methodQuestions?.length &&
    readiness.checks.some(
      (c) => c.id === 'questions_answered' && !c.passed && c.severity === 'blocker',
    );
  const visibleChecks = readiness.checks.filter(
    (c) => !(summarized && c.id === 'questions_answered'),
  );
  const failing = readiness.checks.filter((c) => !c.passed && c.severity === 'blocker');
  const otherBlockers = visibleChecks.filter((c) => !c.passed && c.severity === 'blocker');
  const held = new Set(failing.flatMap((c) => (c.section ? [c.section] : [])));
  const toReview = readiness.sections.filter((s) => s.state === 'needs_review');
  const confirmable = toReview.filter((s) => !held.has(s.id));
  const waiting = toReview.filter((s) => held.has(s.id));
  const draft = record.status === 'draft';
  const activates = draft && failing.length === 0;
  const canConfirm = confirmable.length > 0 || (activates && toReview.length === 0);
  const scope = confirmable.map((s) => s.title.toLowerCase());
  const scopeText = scope.length ? scope.join(', ') : 'the reviewed SOP';
  const actionLabel = failing.length
    ? 'Review ready sections'
    : draft
      ? 'Confirm SOP'
      : 'Confirm the changes';
  const before = canConfirm
    ? `${failing.length ? 'Reviews' : 'Confirms'} ${scopeText} as saved. ${
        activates
          ? 'The SOP becomes confirmed for the lab.'
          : draft
            ? 'The SOP remains a draft; unresolved issues still block final confirmation.'
            : failing.length
              ? 'Unresolved issues still block final confirmation.'
              : 'The reviewed changes are confirmed.'
      }${waiting.length ? ` Still blocked: ${waiting.map((s) => s.title.toLowerCase()).join(', ')}.` : ''}`
    : failing.length
      ? `${draft ? 'The SOP remains a draft. ' : ''}Settle the remaining issues before final confirmation.`
      : '';
  return {
    methodQuestions,
    summarized,
    visibleChecks,
    failing,
    otherBlockers,
    toReview,
    confirmable,
    activates,
    canConfirm,
    actionLabel,
    scopeText,
    before,
  };
}

/** The persisted result, rather than the requested action, determines the outcome wording. */
export function sopReviewOutcome(
  result: RecordEnvelope,
  sections: { id: string; title: string }[],
  partial: boolean,
) {
  // records.confirm stores the reviewed input version, then appends the resulting record version.
  const reviewed = sections
    .filter((s) => result.reviews?.[s.id]?.version === result.version - 1)
    .map((s) => s.title.toLowerCase());
  const scope = reviewed.length ? reviewed.join(', ') : 'the reviewed SOP';
  return result.status === 'draft'
    ? `Reviewed ${scope}. The SOP remains a draft; unresolved issues still block final confirmation.`
    : partial
      ? `Reviewed ${scope}. Unresolved issues still block final confirmation.`
      : `Confirmed ${scope}. The SOP is confirmed for the lab.`;
}
