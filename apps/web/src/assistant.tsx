import { ApiError } from '@ailab/client';
import {
  type AssistantMessage,
  type AttachmentInput,
  assistantAsk,
  type Conversation,
  type ConversationSummary,
  type PageContext,
} from '@ailab/schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './api.ts';
import {
  freshQuestionSelection,
  latestQuestionSelection,
  type QuestionSelection,
  selectedQuestion,
} from './lib/chat-question.ts';
import { conversationQuery, conversationsQuery, recordQuery } from './queries.ts';

interface QuestionChoice {
  conversation: string;
  anchor: string;
  selection: QuestionSelection | null;
}

interface SendOptions {
  fresh?: boolean;
  attachments?: AttachmentInput[];
  context?: Pick<PageContext, 'record' | 'activeQuestion' | 'proposal'>;
  replyTo?: { conversation: string; message: string };
}

interface AssistantUi {
  open: boolean;
  setOpen: (open: boolean) => void;
  width: number;
  setWidth: (width: number) => void;
  /** The conversation the panel shows; undefined means a new one starts with the next message. */
  conversationId: string | undefined;
  /** Opens the panel on a conversation, or on a fresh one. */
  show: (conversationId?: string) => void;
  /** Sends a message: to the shown conversation, or to a new one with `fresh`. */
  send: (message: string, options?: SendOptions) => Promise<boolean>;
  sending: boolean;
  sendError: string | undefined;
  /** The shown conversation's latest state, live. */
  running: boolean;
  questionSelection: QuestionSelection | undefined;
  selectQuestion: (selection: QuestionSelection | undefined) => void;
  acknowledgeResponse: (
    previous: QuestionSelection,
    updated: import('@ailab/schema').RecordEnvelope,
  ) => void;
  contextReady: boolean;
  contextError: string | undefined;
  refreshContext: () => Promise<unknown>;
}

const AssistantContext = createContext<AssistantUi | undefined>(undefined);

const STORAGE_KEY = 'ailab.assistant';

function remembered(): {
  open: boolean;
  conversationId?: string;
  width?: number;
  questionChoice?: QuestionChoice;
} {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      open?: unknown;
      conversationId?: unknown;
      width?: unknown;
      questionChoice?: QuestionChoice;
    };
    return {
      open: value.open === true,
      ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
      ...(value.questionChoice?.conversation === value.conversationId &&
      typeof value.questionChoice?.anchor === 'string' &&
      (value.questionChoice.selection === null ||
        (value.questionChoice.selection?.context.record &&
          value.questionChoice.selection.context.activeQuestion))
        ? { questionChoice: value.questionChoice }
        : {}),
      ...(typeof value.width === 'number' && Number.isFinite(value.width)
        ? { width: Math.min(840, Math.max(320, value.width)) }
        : {}),
    };
  } catch {
    return { open: false };
  }
}

/**
 * The assistant panel's state, shared by the ask bar, the panel and the ledger's "open conversation"
 * links. Keeps the shown conversation live over its event stream.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const initial = useMemo(remembered, []);
  const [open, setOpen] = useState(initial.open);
  const [width, setWidth] = useState(initial.width ?? 400);
  const [conversationId, setConversationId] = useState(initial.conversationId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [questionChoice, setQuestionChoice] = useState(initial.questionChoice);
  const contextQuery = useQuery({
    ...conversationQuery(conversationId ?? ''),
    enabled: Boolean(conversationId),
  });
  const conversation = contextQuery.data;
  const contextReady =
    !conversationId || (conversation?.id === conversationId && !contextQuery.error);
  const contextError = conversationId ? contextQuery.error?.message : undefined;
  const anchor = conversation?.messages.findLast((message) => message.role === 'user')?.id;
  const questionSelection =
    conversationId && conversation?.id === conversationId
      ? questionChoice?.conversation === conversationId && questionChoice.anchor === anchor
        ? (questionChoice.selection ?? undefined)
        : latestQuestionSelection(conversation.messages, conversationId)
      : undefined;
  const selectQuestion = useCallback(
    (selection: QuestionSelection | undefined) => {
      if (conversationId && anchor)
        setQuestionChoice({ conversation: conversationId, anchor, selection: selection ?? null });
    },
    [conversationId, anchor],
  );
  const displayedConversation = useRef(conversationId);
  displayedConversation.current = conversationId;
  const selectedRef = useRef(questionSelection);
  selectedRef.current = questionSelection;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const acknowledgeResponse = useCallback(
    (previous: QuestionSelection, updated: import('@ailab/schema').RecordEnvelope) => {
      const current = selectedRef.current;
      if (
        !current ||
        !conversationId ||
        displayedConversation.current !== conversationId ||
        !anchorRef.current ||
        current.context.record.id !== previous.context.record.id ||
        current.context.record.version !== previous.context.record.version ||
        current.context.activeQuestion.id !== previous.context.activeQuestion.id ||
        current.context.activeQuestion.stage !== previous.context.activeQuestion.stage
      )
        return;
      const question = selectedQuestion(updated, current);
      if (question?.disposition.status === 'open')
        setQuestionChoice({
          conversation: conversationId,
          anchor: anchorRef.current,
          selection: freshQuestionSelection(updated, question, current),
        });
    },
    [conversationId],
  );
  const sendLock = useRef(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ open, conversationId, width, questionChoice }),
      );
    } catch {
      // Remembering the panel is a convenience; private windows may refuse storage.
    }
  }, [open, conversationId, width, questionChoice]);

  useEffect(() => {
    if (!conversationId) {
      setRunning(false);
      return;
    }
    const key = conversationQuery(conversationId).queryKey;
    // A refetch that drops any fetch still in flight: a first load has no data to add events to,
    // and joining it would keep a conversation read before the turn's last messages.
    const reload = () =>
      void queryClient
        .cancelQueries({ queryKey: key })
        .then(() => queryClient.invalidateQueries({ queryKey: key }));
    const onMessage = (message: AssistantMessage) => {
      if (!queryClient.getQueryData<Conversation>(key)) return reload();
      queryClient.setQueryData(key, (old: Conversation | undefined) =>
        !old || old.messages.some((m) => m.id === message.id)
          ? old
          : { ...old, messages: [...old.messages, message] },
      );
    };
    const onStatus = (summary: ConversationSummary) => {
      setRunning(summary.status === 'running');
      queryClient.setQueryData(key, (old: Conversation | undefined) =>
        old ? { ...old, ...summary, ...(summary.error ? {} : { error: undefined }) } : old,
      );
      // Catch up on anything sent before the stream connected, and refresh the list's order.
      reload();
      void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
    };
    return api.subscribeConversation(conversationId, { onMessage, onStatus });
  }, [conversationId, queryClient]);

  const show = useCallback((id?: string) => {
    displayedConversation.current = id;
    setConversationId(id);
    setSendError(undefined);
    setOpen(true);
  }, []);

  const send = useCallback(
    async (message: string, options: SendOptions = {}) => {
      if (!options.fresh && !contextReady) {
        setSendError(contextError ?? 'Wait for this conversation to load before replying.');
        return false;
      }
      if (sendLock.current) return false;
      sendLock.current = true;
      const displayedAtStart = displayedConversation.current;
      const target = options.fresh ? undefined : conversationId;
      const selected = !options.fresh && !options.context ? questionSelection : undefined;
      const heading = document.querySelector('.page h1')?.textContent?.trim();
      // On a record's page, say which record and version the person is looking at.
      const recordId = /^\/records\/([a-z]+_[0-9A-Z]+)/.exec(path)?.[1];
      const shown = recordId ? queryClient.getQueryData(recordQuery(recordId).queryKey) : undefined;
      setOpen(true);
      setSending(true);
      setSendError(undefined);
      try {
        const summary = await api.run(assistantAsk, {
          message,
          ...(target ? { conversationId: target } : {}),
          ...(options.attachments?.length ? { attachments: options.attachments } : {}),
          ...((options.replyTo ?? selected?.replyTo)
            ? { replyTo: options.replyTo ?? selected?.replyTo }
            : {}),
          page: {
            path,
            ...(heading ? { title: heading.slice(0, 200) } : {}),
            ...(shown
              ? { record: { id: shown.id, name: shown.name, version: shown.version } }
              : {}),
            ...options.context,
            ...selected?.context,
          },
        });
        if (displayedConversation.current === displayedAtStart) {
          setRunning(true);
          setConversationId(summary.id);
        }
        await queryClient.invalidateQueries({ queryKey: conversationQuery(summary.id).queryKey });
        void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
        return true;
      } catch (error) {
        if (displayedConversation.current === displayedAtStart)
          setSendError(error instanceof ApiError ? error.message : 'Could not reach the API');
        return false;
      } finally {
        sendLock.current = false;
        setSending(false);
      }
    },
    [conversationId, path, queryClient, questionSelection, contextReady, contextError],
  );

  const value = useMemo(
    () => ({
      open,
      setOpen,
      width,
      setWidth,
      conversationId,
      show,
      send,
      sending,
      sendError,
      running,
      questionSelection,
      selectQuestion,
      acknowledgeResponse,
      contextReady,
      contextError,
      refreshContext: contextQuery.refetch,
    }),
    [
      open,
      width,
      conversationId,
      show,
      send,
      sending,
      sendError,
      running,
      questionSelection,
      selectQuestion,
      acknowledgeResponse,
      contextReady,
      contextError,
      contextQuery.refetch,
    ],
  );
  return <AssistantContext value={value}>{children}</AssistantContext>;
}

export function useAssistant(): AssistantUi {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant needs an AssistantProvider');
  return value;
}
