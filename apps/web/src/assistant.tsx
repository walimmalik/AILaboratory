import { ApiError } from '@ailab/client';
import {
  type AssistantMessage,
  type AttachmentInput,
  assistantAsk,
  type Conversation,
  type ConversationSummary,
} from '@ailab/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './api.ts';
import { conversationQuery, conversationsQuery, recordQuery } from './queries.ts';

interface AssistantUi {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The conversation the panel shows; undefined means a new one starts with the next message. */
  conversationId: string | undefined;
  /** Opens the panel on a conversation, or on a fresh one. */
  show: (conversationId?: string) => void;
  /** Sends a message: to the shown conversation, or to a new one with `fresh`. */
  send: (
    message: string,
    options?: { fresh?: boolean; attachments?: AttachmentInput[] },
  ) => Promise<boolean>;
  sending: boolean;
  sendError: string | undefined;
  /** The shown conversation's latest state, live. */
  running: boolean;
}

const AssistantContext = createContext<AssistantUi | undefined>(undefined);

const STORAGE_KEY = 'ailab.assistant';

function remembered(): { open: boolean; conversationId?: string } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      open?: unknown;
      conversationId?: unknown;
    };
    return {
      open: value.open === true,
      ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
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
  const [conversationId, setConversationId] = useState(initial.conversationId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [running, setRunning] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, conversationId }));
    } catch {
      // Remembering the panel is a convenience; private windows may refuse storage.
    }
  }, [open, conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setRunning(false);
      return;
    }
    const key = conversationQuery(conversationId).queryKey;
    const onMessage = (message: AssistantMessage) =>
      queryClient.setQueryData(key, (old: Conversation | undefined) =>
        !old || old.messages.some((m) => m.id === message.id)
          ? old
          : { ...old, messages: [...old.messages, message] },
      );
    const onStatus = (summary: ConversationSummary) => {
      setRunning(summary.status === 'running');
      queryClient.setQueryData(key, (old: Conversation | undefined) =>
        old ? { ...old, ...summary, ...(summary.error ? {} : { error: undefined }) } : old,
      );
      // Catch up on anything sent before the stream connected, and refresh the list's order.
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
    };
    return api.subscribeConversation(conversationId, { onMessage, onStatus });
  }, [conversationId, queryClient]);

  const show = useCallback((id?: string) => {
    setConversationId(id);
    setSendError(undefined);
    setOpen(true);
  }, []);

  const send = useCallback(
    async (message: string, options: { fresh?: boolean; attachments?: AttachmentInput[] } = {}) => {
      const target = options.fresh ? undefined : conversationId;
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
          page: {
            path,
            ...(heading ? { title: heading.slice(0, 200) } : {}),
            ...(shown
              ? { record: { id: shown.id, name: shown.name, version: shown.version } }
              : {}),
          },
        });
        setRunning(true);
        setConversationId(summary.id);
        await queryClient.invalidateQueries({ queryKey: conversationQuery(summary.id).queryKey });
        void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
        return true;
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : 'Could not reach the API');
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId, path, queryClient],
  );

  const value = useMemo(
    () => ({ open, setOpen, conversationId, show, send, sending, sendError, running }),
    [open, conversationId, show, send, sending, sendError, running],
  );
  return <AssistantContext value={value}>{children}</AssistantContext>;
}

export function useAssistant(): AssistantUi {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant needs an AssistantProvider');
  return value;
}
