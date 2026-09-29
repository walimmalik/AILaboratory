import {
  type ActivityEntry,
  activityList,
  assistantGetConversation,
  assistantListConversations,
  assistantStatus,
  proposalsList,
  recordsGet,
  recordsHistory,
  recordsKinds,
  recordsLinks,
  recordsList,
  recordsReadiness,
  reviewList,
} from '@ailab/schema';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.ts';

export const activityQuery = queryOptions({
  queryKey: ['activity'],
  queryFn: async (): Promise<ActivityEntry[]> =>
    (await api.run(activityList, { limit: 100 })).entries,
});

export const pendingProposalsQuery = queryOptions({
  queryKey: ['proposals', 'pending'],
  queryFn: async () => (await api.run(proposalsList, { status: 'pending' })).proposals,
});

/** Everything waiting for a person: drafts to confirm and proposed changes (plan 004d). */
export const reviewQuery = queryOptions({
  queryKey: ['review'],
  queryFn: async () => (await api.run(reviewList, {})).items,
});

export const decidedProposalsQuery = queryOptions({
  queryKey: ['proposals', 'decided'],
  queryFn: async () => {
    const all = (await api.run(proposalsList, {})).proposals;
    return all.filter((p) => p.status !== 'pending');
  },
});

export const recordsQuery = (filters: {
  kind?: string;
  search?: string;
  status?: 'draft' | 'active' | 'archived';
}) =>
  queryOptions({
    queryKey: ['records', filters],
    queryFn: async () =>
      (
        await api.run(recordsList, {
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          limit: 200,
        })
      ).records,
  });

export const recordQuery = (id: string) =>
  queryOptions({ queryKey: ['record', id], queryFn: () => api.run(recordsGet, { id }) });

export const historyQuery = (id: string) =>
  queryOptions({
    queryKey: ['record', id, 'history'],
    queryFn: async () => (await api.run(recordsHistory, { id })).versions,
  });

export const readinessQuery = (id: string) =>
  queryOptions({
    queryKey: ['record', id, 'readiness'],
    queryFn: () => api.run(recordsReadiness, { id }),
  });

export const linksQuery = (id: string, direction: 'from' | 'to') =>
  queryOptions({
    queryKey: ['record', id, 'links', direction],
    queryFn: async () => (await api.run(recordsLinks, { id, direction })).links,
  });

export const assistantSetupQuery = queryOptions({
  queryKey: ['assistant', 'setup'],
  queryFn: () => api.run(assistantStatus, {}),
  staleTime: 60_000,
});

export const conversationsQuery = queryOptions({
  queryKey: ['assistant', 'conversations'],
  queryFn: async () => (await api.run(assistantListConversations, { limit: 30 })).conversations,
});

export const conversationQuery = (id: string) =>
  queryOptions({
    queryKey: ['assistant', 'conversation', id],
    queryFn: () => api.run(assistantGetConversation, { id }),
  });

/** The kinds this lab holds, with the JSON Schema of their attributes (drives the edit forms). */
export const kindsQuery = queryOptions({
  queryKey: ['kinds'],
  queryFn: async () => (await api.run(recordsKinds, {})).kinds,
  staleTime: Number.POSITIVE_INFINITY,
});
