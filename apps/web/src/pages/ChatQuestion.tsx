import { type RecordEnvelope, sopsAnswerQuestion } from '@ailab/schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { api } from '../api.ts';
import {
  freshQuestionSelection,
  type QuestionSelection,
  selectedQuestion,
} from '../lib/chat-question.ts';
import { formatWhen } from '../lib/format.ts';
import { currentQuestions } from '../lib/sop-questions.ts';
import { recordQuery } from '../queries.ts';

export function SelectedQuestionContext({
  selection,
  record,
  onSelect,
}: {
  selection: QuestionSelection;
  record: RecordEnvelope | undefined;
  onSelect: (next: QuestionSelection | undefined) => void;
}) {
  const question = selectedQuestion(record, selection);
  const stale = record?.version !== selection.context.record.version;
  const longQuestion = Boolean(question && question.question.length > 160);
  return (
    <section className="chat-question" aria-label="Selected SOP question">
      <p className={longQuestion ? 'chat-question-preview' : undefined}>
        <b>{question?.question ?? 'Selected question unavailable'}</b>
      </p>
      <p className="muted">
        <Link to="/records/$id" params={{ id: selection.context.record.id }}>
          {record?.label ?? selection.context.record.name}
        </Link>{' '}
        · {question?.disposition.status ?? 'unavailable'}
      </p>
      {Boolean(question?.responses.length) && (
        <details>
          <summary>Recorded responses ({question?.responses.length})</summary>
          {question?.responses.map((response) => (
            <p key={response.version}>{response.text}</p>
          ))}
        </details>
      )}
      {stale && (
        <p className="warn-ink">This SOP changed. Review the current question before continuing.</p>
      )}
      <div className="actions chat-question-actions">
        {stale && question?.disposition.status === 'open' && record && (
          <button
            type="button"
            className="btn small"
            onClick={() => onSelect(freshQuestionSelection(record, question, selection))}
          >
            Use current question
          </button>
        )}
      </div>
      {longQuestion && question && (
        <details key={`${selection.context.record.id}:${question.id}:${question.question}`}>
          <summary>Full question</summary>
          <p className="chat-question-full">{question.question}</p>
        </details>
      )}
      <details>
        <summary>Change question</summary>
        {record && (
          <label className="chat-question-choice">
            Choose question{' '}
            <select
              className="field chat-question-select"
              value={question?.id ?? ''}
              onChange={(event) => {
                const next = currentQuestions(record)?.find(
                  (item) => item.id === event.target.value,
                );
                if (next?.disposition.status === 'open')
                  onSelect(freshQuestionSelection(record, next));
              }}
            >
              {!question && <option value="">Choose a question</option>}
              {(currentQuestions(record) ?? [])
                .filter((item) => item.disposition.status === 'open')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.question}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button type="button" className="link-btn" onClick={() => onSelect(undefined)}>
          Clear question
        </button>
      </details>
      <details className="tech">
        <summary>Context details</summary>
        <p>
          {selection.context.record.name}, version {selection.context.record.version} ·{' '}
          {selection.context.activeQuestion.stage} · question {selection.context.activeQuestion.id}
        </p>
      </details>
    </section>
  );
}

/** A human opts in to recording exactly their saved message text, against its captured version. */
export function ChatQuestionResponse({
  selection,
  text,
  busy,
  onContinue,
  onRecorded,
  historical = false,
}: {
  selection: QuestionSelection;
  text: string;
  busy: boolean;
  onContinue: (selection: QuestionSelection) => Promise<boolean>;
  onRecorded?: ((previous: QuestionSelection, updated: RecordEnvelope) => void) | undefined;
  historical?: boolean;
}) {
  const queryClient = useQueryClient();
  const record = useQuery(recordQuery(selection.context.record.id));
  const [baseline, setBaseline] = useState(selection.context.record.version);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  const question = selectedQuestion(record.data, selection);
  const matching = question?.responses.find((response) => response.text === text.trim());
  const stale = needsReview || record.data?.version !== baseline;
  const open = question?.disposition.status === 'open';
  const disabled = busy || working || record.isFetching;
  const review = async () => {
    if (lock.current || disabled || record.error || !record.data || !open) return;
    // Acknowledge precisely the version rendered above, never an unseen refetch result.
    setBaseline(record.data.version);
    setNeedsReview(false);
    setError(undefined);
  };
  const save = async () => {
    if (lock.current || disabled || stale || !open || saved || matching) return;
    lock.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const updated = await api.run(sopsAnswerQuestion, {
        sop: selection.context.record.id,
        question: selection.context.activeQuestion.id,
        expectedVersion: baseline,
        action: { type: 'response', text: text.trim() },
      });
      setSaved(true);
      setBaseline(updated.version);
      queryClient.setQueryData(recordQuery(updated.id).queryKey, updated);
      onRecorded?.(selection, updated);
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['record', updated.id] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not record the response.');
      setNeedsReview(true);
      try {
        await record.refetch();
      } catch {
        setError(
          'Could not refresh the question after the failed save. Review it before retrying.',
        );
      }
    } finally {
      lock.current = false;
      setWorking(false);
    }
  };
  const continueChat = async () => {
    if (
      lock.current ||
      disabled ||
      stale ||
      !open ||
      !record.data ||
      !question ||
      (!saved && !matching)
    )
      return;
    lock.current = true;
    setWorking(true);
    setError(undefined);
    try {
      if (!(await onContinue(freshQuestionSelection(record.data, question, selection))))
        setError('The response stays recorded. Continue with assistant can be tried again.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The response stays recorded. Could not continue with the assistant.',
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  };
  const controls = (
    <>
      {stale && (
        <p className="warn-ink">Review the current question before recording or continuing.</p>
      )}
      {(error ?? record.error?.message) && (
        <p className="error-text">{error ?? record.error?.message}</p>
      )}
      <div className="actions chat-question-actions">
        {stale ? (
          <button
            type="button"
            className="btn small"
            disabled={disabled || Boolean(record.error) || !open}
            onClick={() => void review()}
          >
            Review current question
          </button>
        ) : (
          !saved &&
          !matching && (
            <button
              type="button"
              className="btn small"
              disabled={disabled || !open || !text.trim()}
              onClick={() => void save()}
            >
              Record response
            </button>
          )
        )}
        {(saved || matching) && (
          <button
            type="button"
            className="btn small"
            disabled={disabled || stale || !open}
            onClick={() => void continueChat()}
          >
            Continue with assistant
          </button>
        )}
        {record.error && (
          <button
            type="button"
            className="btn small"
            disabled={disabled}
            onClick={() => void record.refetch()}
          >
            Refresh question
          </button>
        )}
      </div>
      <details className="tech">
        <summary>Response context</summary>
        <p>
          {selection.context.record.name}, captured version {selection.context.record.version} ·
          question {selection.context.activeQuestion.id}
        </p>
        <p>
          Only this human message's text is recorded. Recording a response does not apply a decision
          or confirm the SOP.
        </p>
      </details>
    </>
  );
  return (
    <section className="chat-question" aria-label="Record a response to the SOP question">
      <p>
        <b>{question?.question ?? 'Selected question unavailable'}</b>
      </p>
      <p className="muted">
        <Link to="/records/$id" params={{ id: selection.context.record.id }}>
          {record.data?.label ?? selection.context.record.name}
        </Link>{' '}
        ·{' '}
        {open
          ? 'The scientific issue remains open.'
          : question
            ? `This question is ${question.disposition.status}.`
            : 'This question is unavailable.'}
      </p>
      {saved ? <p>Response recorded.</p> : matching && <p>This answer is already recorded.</p>}
      {matching && (
        <details className="tech">
          <summary>Recorded response details</summary>
          <p>
            {matching.text} · {formatWhen(matching.at)} · version {matching.version} · by{' '}
            {matching.by.userId}
          </p>
          <p>This saved answer does not identify which chat message recorded it.</p>
        </details>
      )}
      {historical && (saved || matching) ? (
        <details>
          <summary>Revisit response</summary>
          {controls}
        </details>
      ) : (
        controls
      )}
    </section>
  );
}
