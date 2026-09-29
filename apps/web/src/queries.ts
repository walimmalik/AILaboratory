import {
  type ActivityEntry,
  activityList,
  assistantGetConversation,
  assistantListConversations,
  assistantStatus,
  proposalsList,
  recordsGet,
  recordsHistory,
  recordsLinks,
  recordsList,
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

export const decidedProposalsQuery = queryOptions({
  queryKey: ['proposals', 'decided'],
  queryFn: async () => {
    const all = (await api.run(proposalsList, {})).proposals;
    return all.filter((p) => p.status !== 'pending');
  },
});

export const recordsQuery = (filters: {
  search?: string;
  status?: 'draft' | 'active' | 'archived';
}) =>
  queryOptions({
    queryKey: ['records', filters],
    queryFn: async () =>
      (
        await api.run(recordsList, {
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
