import {
  type AssistantMessage,
  type AttachmentInput,
  type Conversation,
  MAX_ATTACHMENT_CHARS,
  operationContracts,
  type Proposal,
  type RecordEnvelope,
  type ReviewItem,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, Fragment, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useAssistant } from '../assistant.tsx';
import {
  CONTINUE_QUESTION_MESSAGE,
  isResponseText,
  type QuestionSelection,
  selectedQuestion,
  selectionForMessage,
} from '../lib/chat-question.ts';
import { filesOf } from '../lib/files.ts';
import {
  describeToolStep,
  formatWhen,
  operationIntent,
  type ToolLine,
  waitingForYou,
} from '../lib/format.ts';
import { RichText } from '../lib/RichText.tsx';
import { workspaceSearch, workspaceToolSelection } from '../lib/workspace.ts';
import {
  assistantSetupQuery,
  conversationQuery,
  conversationsQuery,
  decidedProposalsQuery,
  recordQuery,
  reviewQuery,
} from '../queries.ts';
import { RememberCard, UsedMemories } from './AssistantMemory.tsx';
import { ChatQuestionResponse, SelectedQuestionContext } from './ChatQuestion.tsx';
import { ChatSourceContext } from './ChatSource.tsx';
import { FileCard } from './FileCard.tsx';
import { ProposalDecisionCard, supportedDecision } from './ProposalDecisionCard.tsx';

/** The assistant, docked on the right: one conversation at a time, its steps shown as it works. */
export function AssistantPanel() {
  const assistant = useAssistant();
  const setup = useQuery(assistantSetupQuery).data;
  const conversations = useQuery(conversationsQuery).data ?? [];
  const { data: conversation, error } = useQuery({
    ...conversationQuery(assistant.conversationId ?? ''),
    enabled: Boolean(assistant.conversationId),
  });
  const shown = assistant.conversationId ? conversation : undefined;

  return (
    <aside className="assistant" aria-label="Assistant" id="assistant-panel">
      <AssistantResize width={assistant.width} onResize={assistant.setWidth} />
      <header>
        <h2>Assistant</h2>
        {setup?.configured && (
          <span className="model mono" title={`${setup.provider} · ${setup.model}`}>
            {setup.agentName}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => assistant.show()}>
          New
        </button>
        <button
          type="button"
          className="btn small"
          aria-label="Close the assistant"
          onClick={() => assistant.setOpen(false)}
        >
          ×
        </button>
      </header>

      {conversations.length > 0 && (
        <label className="picker">
          <span className="sr-only">Conversation</span>
          <select
            className="field"
            value={assistant.conversationId ?? ''}
            onChange={(e) => assistant.show(e.target.value || undefined)}
          >
            <option value="">New conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {formatWhen(c.updatedAt)}
              </option>
            ))}
          </select>
        </label>
      )}

      <Transcript
        conversation={shown}
        running={assistant.running || assistant.sending}
        notFound={error?.message}
      />

      {setup && !setup.configured ? (
        <p className="setup warn-ink">
          No model is set up: {setup.reason}. Add the key to <span className="mono">.env</span> in
          the repo folder and restart the app.
        </p>
      ) : (
        <Composer key={assistant.composerKey} />
      )}
    </aside>
  );
}

/** Resize from the left edge; arrow keys move the divider just as dragging does. */
export function AssistantResize({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const [viewport, setViewport] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  useEffect(() => {
    const resized = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  const min = 320;
  const max = Math.min(840, Math.max(min, viewport - 360));
  const shown = Math.min(max, Math.max(min, width));
  const resize = (next: number) => onResize(Math.round(Math.min(max, Math.max(min, next))));
  return (
    <hr
      className="assistant-resize"
      tabIndex={0}
      aria-label="Resize assistant panel"
      aria-controls="assistant-panel"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={`${shown} pixels wide`}
      title="Drag to resize; Left and Right arrow keys change the width"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: shown };
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 80 : 20;
        const next =
          event.key === 'ArrowLeft'
            ? shown + step
            : event.key === 'ArrowRight'
              ? shown - step
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}

function Transcript({
  conversation,
  running,
  notFound,
}: {
  conversation: Conversation | undefined;
  running: boolean;
  notFound: string | undefined;
}) {
  const assistant = useAssistant();
  const end = useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;
  const review = useQuery({ ...reviewQuery, enabled: Boolean(conversation) }).data?.items;
  const decided = useQuery({ ...decidedProposalsQuery, enabled: Boolean(conversation) }).data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages arrive or work starts.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, running]);

  if (!conversation) {
    return (
      <div className="transcript">
        {notFound ? (
          <p className="crit-ink">{notFound}</p>
        ) : (
          <p className="empty">
            Ask about records, proposals or recent activity, or ask for a draft. The assistant works
            through the same operations you do: everything it changes shows in the ledger, and
            changes to active records wait for you on the Review page.
          </p>
        )}
        <div ref={end} />
      </div>
    );
  }

  return (
    <ol className="transcript" aria-live="polite">
      <ConversationMessages
        key={conversation.id}
        messages={conversation.messages}
        agentName={conversation.agentName}
        running={running}
        review={review}
        decided={decided}
        conversationId={conversation.id}
        onContinue={(selection) =>
          assistant.send(CONTINUE_QUESTION_MESSAGE, {
            context: selection.context,
            ...(selection.replyTo ? { replyTo: selection.replyTo } : {}),
          })
        }
        onRecorded={assistant.acknowledgeResponse}
      />
      {running && (
        <li className="working agent-ink">
          <span className="lamp busy" aria-hidden="true" />
          working…
        </li>
      )}
      {!running && conversation.status === 'failed' && conversation.error && (
        <li className="stopped crit-ink">Stopped: {conversation.error}</li>
      )}
      <div ref={end} />
    </ol>
  );
}

type ToolMessage = Extract<AssistantMessage, { role: 'tool' }>;
type AssistantReply = Extract<AssistantMessage, { role: 'assistant' }>;
type ToolCall = AssistantReply['toolCalls'][number];
type WorkEntry =
  | { type: 'step'; id: string; call: ToolCall; result: ToolMessage | undefined }
  | { type: 'memory'; id: string; memories: NonNullable<AssistantReply['memory']> };
type TranscriptEntry =
  | { type: 'message'; id: string; message: Exclude<AssistantMessage, ToolMessage> }
  | { type: 'activity'; id: string; entries: WorkEntry[] }
  | Extract<WorkEntry, { type: 'step' }>;

/** Fold only known routine reads. Prose is never classified or summarized. */
function transcriptEntries(messages: AssistantMessage[]): TranscriptEntry[] {
  const results = new Map(
    messages.flatMap((m) => (m.role === 'tool' ? [[m.toolCallId, m] as const] : [])),
  );
  const entries: TranscriptEntry[] = [];
  const addWork = (entry: WorkEntry) => {
    const last = entries.at(-1);
    if (last?.type === 'activity') last.entries.push(entry);
    else entries.push({ type: 'activity', id: entry.id, entries: [entry] });
  };
  for (const message of messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'user' || message.text.trim()) {
      entries.push({ type: 'message', id: message.id, message });
    }
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls) {
      const result = results.get(call.id);
      const entry = { type: 'step', id: call.id, call, result } as const;
      const output = (result?.result as { output?: unknown } | undefined)?.output;
      const needsAttention =
        operationContracts.get(call.operationId)?.effect !== 'read' ||
        (result &&
          (result.outcome === 'failed' ||
            result.outcome === 'proposed' ||
            (result.outcome === 'done' &&
              (filesOf(call.operationId, output).length > 0 ||
                (call.operationId === 'experiments.workspace' &&
                  workspaceToolSelection(output))))));
      if (needsAttention) entries.push(entry);
      else addWork(entry);
    }
    if (!message.text.trim() && message.memory?.length) {
      addWork({ type: 'memory', id: `${message.id}-memory`, memories: message.memory });
    }
  }
  return entries;
}

/** Kept separate from live queries so the ordered transcript can also be rendered on its own. */
type ConversationMessagesProps = {
  messages: AssistantMessage[];
  agentName: string;
  running: boolean;
  review: ReviewItem[] | undefined;
  decided?: Proposal[] | undefined;
  conversationId?: string;
  onContinue?: (selection: QuestionSelection) => Promise<boolean>;
  onRecorded?: (previous: QuestionSelection, updated: RecordEnvelope) => void;
  conversationBusy?: boolean;
  latestTurn?: boolean;
};

export function ConversationMessages(props: ConversationMessagesProps) {
  const turns: AssistantMessage[][] = [];
  for (const message of props.messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message]);
    else turns.at(-1)?.push(message);
  }
  return (
    <>
      {turns.map((messages, index) => (
        <ConversationTurn
          key={messages[0]?.id}
          {...props}
          messages={messages}
          running={props.running && index === turns.length - 1}
          conversationBusy={props.running}
          latestTurn={index === turns.length - 1}
        />
      ))}
    </>
  );
}

function ConversationTurn({
  messages,
  agentName,
  running,
  review,
  decided,
  conversationId,
  onContinue,
  onRecorded,
  conversationBusy = running,
  latestTurn = true,
}: ConversationMessagesProps) {
  const entries = transcriptEntries(messages);
  const finalReply = messages.findLast((m) => m.role === 'assistant');
  const handoffBefore =
    !running &&
    finalReply?.role === 'assistant' &&
    finalReply.text.trim() &&
    !finalReply.toolCalls.length
      ? finalReply.id
      : undefined;
  return (
    <>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          {entry.id === handoffBefore && (
            <WaitingLine
              messages={messages}
              review={review}
              decided={decided}
              busy={conversationBusy}
              producing={running}
            />
          )}
          {entry.type === 'message' ? (
            <Message
              message={entry.message}
              agentName={agentName}
              running={conversationBusy}
              latestTurn={latestTurn}
              conversationId={conversationId}
              onContinue={onContinue}
              onRecorded={onRecorded}
            />
          ) : entry.type === 'step' ? (
            <li className="action">
              <ul className="steps">
                <Step call={entry.call} result={entry.result} />
              </ul>
            </li>
          ) : (
            <li className="work">
              <details className="work-details">
                <summary className="muted">
                  Work details
                  {entry.entries.some((e) => e.type === 'step') &&
                    ` · ${entry.entries.filter((e) => e.type === 'step').length} ${entry.entries.filter((e) => e.type === 'step').length === 1 ? 'action' : 'actions'}`}
                  {entry.entries.some((e) => e.type === 'step' && !e.result) && ' · in progress'}
                </summary>
                <ul className="steps">
                  {entry.entries.map((work) =>
                    work.type === 'step' ? (
                      <Step key={work.id} call={work.call} result={work.result} />
                    ) : (
                      <li key={work.id}>
                        <UsedMemories memories={work.memories} />
                      </li>
                    ),
                  )}
                </ul>
              </details>
            </li>
          )}
        </Fragment>
      ))}
      {!handoffBefore && (
        <WaitingLine
          messages={messages}
          review={review}
          decided={decided}
          busy={conversationBusy}
          producing={running}
        />
      )}
    </>
  );
}

/**
 * Hands off one completed turn's saved drafts and proposed changes using current Review state.
 * Navigation opens the draft; confirmation stays on its record page.
 */
function WaitingLine({
  messages,
  review,
  decided,
  busy,
  producing,
}: {
  messages: AssistantMessage[];
  review: ReviewItem[] | undefined;
  decided: Proposal[] | undefined;
  busy: boolean;
  producing: boolean;
}) {
  const steps = messages.filter((m): m is ToolMessage => m.role === 'tool');
  if (!review || steps.length === 0) return null;
  const turn = waitingForYou(steps);
  const waitingIds = new Set(
    review.map((item) =>
      item.type === 'draft'
        ? item.record.id
        : item.type === 'change'
          ? item.proposal.id
          : item.type === 'mentions'
            ? item.document.id
            : item.about.id,
    ),
  );
  const drafts = (producing ? [] : turn.drafts).flatMap((d) => {
    const item = review.find((item) => item.type === 'draft' && item.record.id === d.id);
    return item?.type === 'draft' ? [item] : [];
  });
  const changes = turn.changes.filter((id) => waitingIds.has(id)).length;
  const decisions = [
    ...new Map(
      [...review.flatMap((i) => (i.type === 'change' ? [i.proposal] : [])), ...(decided ?? [])].map(
        (p) => [p.id, p],
      ),
    ).values(),
  ].filter((p) => turn.changes.includes(p.id) && supportedDecision(p));
  const ordinaryChanges = producing
    ? 0
    : changes - decisions.filter((p) => waitingIds.has(p.id)).length;
  if (drafts.length === 0 && changes === 0 && decisions.length === 0) return null;
  return (
    <li className="waiting">
      {drafts.map((item) => (
        <div key={item.record.id} className="draft-handoff">
          <Link to="/records/$id" params={{ id: item.record.id }}>
            Open {item.record.kind === 'sop' ? 'SOP draft' : 'draft'}: {item.record.label}{' '}
            <span className="mono">{item.record.name}</span>
          </Link>
          <div className="muted">
            draft ·{' '}
            {item.blockers.length > 0
              ? 'needs attention before confirmation'
              : item.ready
                ? 'ready for review'
                : 'needs review'}
          </div>
        </div>
      ))}
      {decisions.map((p) => (
        <ProposalDecisionCard key={p.id} proposal={p} busy={busy} />
      ))}
      {ordinaryChanges > 0 && (
        <Link to="/review">
          {ordinaryChanges === 1
            ? 'Review 1 proposed change'
            : `Review ${ordinaryChanges} proposed changes`}
        </Link>
      )}
    </li>
  );
}

function Message({
  message,
  agentName,
  running,
  conversationId,
  onContinue,
  onRecorded,
  latestTurn,
}: {
  message: Exclude<AssistantMessage, ToolMessage>;
  agentName: string;
  running: boolean;
  conversationId: string | undefined;
  onContinue: ((selection: QuestionSelection) => Promise<boolean>) | undefined;
  onRecorded: ((previous: QuestionSelection, updated: RecordEnvelope) => void) | undefined;
  latestTurn: boolean;
}) {
  if (message.role === 'user') {
    const selection =
      conversationId && isResponseText(message)
        ? selectionForMessage(message, conversationId)
        : undefined;
    return (
      <li className="msg">
        <div className="who mono muted">you</div>
        {message.text && <p className="text">{message.text}</p>}
        {message.page?.selectedSource && (
          <ChatSourceContext selection={message.page.selectedSource} historical />
        )}
        {message.attachments?.map((file) => (
          <p key={file.id} className="attachment muted">
            attached <span className="mono">{file.name}</span>
          </p>
        ))}
        {selection && onContinue && (
          <ChatQuestionResponse
            selection={selection}
            text={message.text}
            busy={running}
            historical={!latestTurn}
            onContinue={onContinue}
            onRecorded={onRecorded}
          />
        )}
      </li>
    );
  }
  return (
    <li className="msg">
      <div className="who mono agent-ink">{agentName}</div>
      {message.text && <RichText className="text rich" text={message.text} />}
      {message.memory && message.memory.length > 0 && <UsedMemories memories={message.memory} />}
    </li>
  );
}

function Step({
  call,
  result,
}: {
  call: { id: string; operationId: string; input: unknown };
  result: ToolMessage | undefined;
}) {
  const line: ToolLine = result
    ? describeToolStep(result)
    : { text: `${operationIntent(call.operationId)}…`, tone: 'muted' };
  // A done step's result is the operation's {status, output}.
  const files =
    result?.outcome === 'done'
      ? filesOf(call.operationId, (result.result as { output?: unknown } | undefined)?.output)
      : [];
  const proposedMemory =
    call.operationId === 'memory.propose' && result?.outcome === 'done'
      ? (result.result as { output?: RecordEnvelope } | undefined)?.output
      : undefined;
  const workspace =
    call.operationId === 'experiments.workspace' && result?.outcome === 'done'
      ? workspaceToolSelection((result.result as { output?: unknown } | undefined)?.output)
      : undefined;
  return (
    <li className={`step ${line.tone}`}>
      <span aria-hidden="true">{result ? '›' : '·'}</span> <span>{line.text}</span>
      {line.record && !line.proposed && (
        <>
          {' '}
          <Link to="/records/$id" params={{ id: line.record.id }} className="mono">
            {line.record.name}
          </Link>
        </>
      )}
      {line.proposed && (
        <>
          {' '}
          <Link to="/review">review</Link>
        </>
      )}
      {files.map((file) => (
        <FileCard key={'id' in file ? `${file.id}-${file.group}` : file.name} file={file} />
      ))}
      {proposedMemory && <RememberCard proposed={proposedMemory} />}
      {workspace && (
        <p>
          <Link
            to="/records/$id"
            params={{ id: workspace.experiment }}
            search={workspaceSearch(workspace)}
          >
            Open view
          </Link>
        </p>
      )}
      <details className="tech">
        <summary>technical details</summary>
        <pre className="json">
          {JSON.stringify(
            {
              operation: call.operationId,
              input: call.input,
              result: result?.result,
              ...(result?.error ? { error: result.error } : {}),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </li>
  );
}

/** Text files the assistant can take: definitions, tables, notes. */
const ATTACHABLE = /\.(json|csv|tsv|txt|md|xml|yaml|yml)$/i;

export function Composer() {
  const assistant = useAssistant();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AttachmentInput[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const busy = assistant.sending || assistant.running || !assistant.contextReady;
  const selection = assistant.questionSelection;
  const selectedRecord = useQuery({
    ...recordQuery(selection?.context.record.id ?? ''),
    enabled: Boolean(selection),
  });
  const question = selection ? selectedQuestion(selectedRecord.data, selection) : undefined;
  const contextBlocked =
    Boolean(assistant.sourceContextError) ||
    Boolean(
      selection &&
        (selectedRecord.isFetching ||
          selectedRecord.error ||
          question?.disposition.status !== 'open' ||
          selectedRecord.data?.version !== selection.context.record.version),
    );

  const attach = async (list: FileList | null) => {
    setFileError(undefined);
    const added: AttachmentInput[] = [];
    for (const file of Array.from(list ?? [])) {
      if (!ATTACHABLE.test(file.name)) {
        setFileError(
          `${file.name}: attach text files (JSON, CSV, TXT); PDFs and spreadsheets come later`,
        );
        continue;
      }
      const content = await file.text();
      if (content.length > MAX_ATTACHMENT_CHARS) {
        setFileError(`${file.name} is too large to attach`);
        continue;
      }
      added.push({ name: file.name, mediaType: file.type || 'text/plain', text: content });
    }
    // A file attached again under the same name replaces the earlier one.
    setFiles((current) =>
      [...current.filter((f) => !added.some((a) => a.name === f.name)), ...added].slice(0, 5),
    );
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if ((!message && files.length === 0) || busy || contextBlocked) return;
    const submittedText = text;
    const submittedFiles = files;
    if (await assistant.send(message, { attachments: files })) {
      setText((current) => (current === submittedText ? '' : current));
      setFiles((current) => (current === submittedFiles ? [] : current));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className={dragging ? 'composer dropping' : 'composer'}
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void attach(e.dataTransfer.files);
      }}
    >
      {!assistant.contextReady && (
        <p className="muted">{assistant.contextError ?? 'Loading conversation context…'}</p>
      )}
      {assistant.contextError && (
        <button type="button" className="btn small" onClick={() => void assistant.refreshContext()}>
          Retry conversation context
        </button>
      )}
      {selection && (
        <SelectedQuestionContext
          selection={selection}
          record={selectedRecord.data}
          onSelect={assistant.selectQuestion}
        />
      )}
      {assistant.sourceSelection && <ChatSourceContext selection={assistant.sourceSelection} />}
      {assistant.sourceContextError && (
        <p className="error-text" role="alert">
          {assistant.sourceContextError} Open a valid source before sending.
        </p>
      )}
      {selection && selectedRecord.error && (
        <p className="error-text">{selectedRecord.error.message}</p>
      )}
      {assistant.sendError && <p className="error-text">{assistant.sendError}</p>}
      {fileError && <p className="error-text">{fileError}</p>}
      <label className="sr-only" htmlFor="assistant-input">
        Message the assistant
      </label>
      <textarea
        id="assistant-input"
        className="field"
        rows={3}
        value={text}
        placeholder={
          assistant.conversationId ? 'Reply… (Enter sends, Shift+Enter for a new line)' : 'Ask…'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {files.length > 0 && (
        <ul className="attached">
          {files.map((file) => (
            <li key={file.name}>
              <span className="mono">{file.name}</span>{' '}
              <button
                type="button"
                className="link-btn"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((f) => f.name !== file.name))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          Attach file
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept=".json,.csv,.tsv,.txt,.md,.xml,.yaml,.yml"
          className="sr-only"
          aria-label="Attach a file to your message"
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="muted hint">
          {busy ? 'Working; you can reply when it finishes.' : 'Changes land in the ledger.'}
        </span>
        <button
          type="submit"
          className="btn primary small"
          disabled={busy || contextBlocked || (!text.trim() && files.length === 0)}
        >
          Send
        </button>
      </div>
    </form>
  );
}
