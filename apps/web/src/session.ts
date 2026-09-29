import { ApiError } from '@ailab/client';
import type { Me } from '@ailab/schema';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

/** The signed-in person, or null when nobody is signed in. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api.me();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') return null;
      throw error;
    }
  },
  staleTime: 60_000,
});

export function useMe(): Me | undefined {
  return useQuery(meQuery).data ?? undefined;
}
