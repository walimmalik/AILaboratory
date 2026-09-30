import {
  type AssistantMessage,
  type AttachmentInput,
  type Conversation,
  MAX_ATTACHMENT_CHARS,
} from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useAssistant } from '../assistant.tsx';
import { fileOf } from '../lib/files.ts';
import {
  describeToolStep,
  formatWhen,
  operationIntent,
  type ToolLine,
  waitingForYou,
} from '../lib/format.ts';
import { RichText } from '../lib/RichText.tsx';
import {
  assistantSetupQuery,
  conversationQuery,
  conversationsQuery,
  reviewQuery,
} from '../queries.ts';
import { FileCard } from './FileCard.tsx';

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
    <aside className="assistant" aria-label="Assistant">
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
        <Composer />
      )}
    </aside>
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
  const end = useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;
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

  const results = new Map(
    conversation.messages.flatMap((m) => (m.role === 'tool' ? [[m.toolCallId, m] as const] : [])),
  );
  return (
    <ol className="transcript" aria-live="polite">
      {conversation.messages.map((message) =>
        message.role === 'tool' ? null : (
          <Message
            key={message.id}
            message={message}
            agentName={conversation.agentName}
            results={results}
          />
        ),
      )}
      {running && (
        <li className="working agent-ink">
          <span className="lamp busy" aria-hidden="true" />
          working…
        </li>
      )}
      {!running && conversation.status === 'failed' && conversation.error && (
        <li className="stopped crit-ink">Stopped: {conversation.error}</li>
      )}
      {!running && <WaitingLine messages={conversation.messages} />}
      <div ref={end} />
    </ol>
  );
}

type ToolMessage = Extract<AssistantMessage, { role: 'tool' }>;

/**
 * Ends the latest turn with what it left for you (plan 004d, R4): drafts it wrote and changes it
 * proposed that still wait on the Review page, each linked to where you act on it.
 */
function WaitingLine({ messages }: { messages: AssistantMessage[] }) {
  const review = useQuery(reviewQuery).data?.items;
  const lastAsk = messages.findLastIndex((m) => m.role === 'user');
  const steps = messages.slice(lastAsk + 1).filter((m): m is ToolMessage => m.role === 'tool');
  if (!review || steps.length === 0) return null;
  const turn = waitingForYou(steps);
  const waitingIds = new Set(
    review.map((item) => (item.type === 'draft' ? item.record.id : item.proposal.id)),
  );
  const drafts = turn.drafts.filter((d) => waitingIds.has(d.id));
  const changes = turn.changes.filter((id) => waitingIds.has(id)).length;
  if (drafts.length === 0 && changes === 0) return null;
  return (
    <li className="waiting">
      <b>Waiting for you:</b>{' '}
      {drafts.map((d, i) => (
        <span key={d.id}>
          {i > 0 && ', '}
          confirm{' '}
          <Link to="/records/$id" params={{ id: d.id }} className="mono">
            {d.name}
          </Link>
        </span>
      ))}
      {drafts.length > 0 && changes > 0 && '; '}
      {changes > 0 && (
        <Link to="/review">
          {changes === 1 ? 'confirm 1 proposed change' : `confirm ${changes} proposed changes`}
        </Link>
      )}
      .
    </li>
  );
}

function Message({
  message,
  agentName,
  results,
}: {
  message: Exclude<AssistantMessage, ToolMessage>;
  agentName: string;
  results: Map<string, ToolMessage>;
}) {
  if (message.role === 'user') {
    return (
      <li className="msg">
        <div className="who mono muted">you</div>
        {message.text && <p className="text">{message.text}</p>}
        {message.attachments?.map((file) => (
          <p key={file.id} className="attachment muted">
            attached <span className="mono">{file.name}</span>
          </p>
        ))}
      </li>
    );
  }
  return (
    <li className="msg">
      <div className="who mono agent-ink">{agentName}</div>
      {message.text && <RichText className="text rich" text={message.text} />}
      {message.toolCalls.length > 0 && (
        <ul className="steps">
          {message.toolCalls.map((call) => {
            const result = results.get(call.id);
            return <Step key={call.id} call={call} result={result} />;
          })}
        </ul>
      )}
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
  const file =
    result?.outcome === 'done'
      ? fileOf(call.operationId, (result.result as { output?: unknown } | undefined)?.output)
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
      {file && <FileCard file={file} />}
      <details className="tech">
        <summary>technical details</summary>
        <pre className="json">
          {JSON.stringify(
            { operation: call.operationId, input: call.input, result: result?.result },
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

function Composer() {
  const assistant = useAssistant();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AttachmentInput[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const busy = assistant.sending || assistant.running;

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
    if ((!message && files.length === 0) || busy) return;
    if (await assistant.send(message, { attachments: files })) {
      setText('');
      setFiles([]);
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
          disabled={busy || (!text.trim() && files.length === 0)}
        >
          Send
        </button>
      </div>
    </form>
  );
}
