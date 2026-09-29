import type { ActivityEntry } from '@ailab/schema';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api.ts';
import { activityQuery } from './queries.ts';

interface Live {
  connected: boolean;
  /** Ledger entries that arrived while this page was open, for a brief highlight. */
  fresh: ReadonlySet<string>;
}

const LiveContext = createContext<Live>({ connected: false, fresh: new Set() });

/**
 * Keeps one activity stream open for the signed-in lab. Each new ledger entry is added to the
 * ledger and refreshes whatever it could have changed (proposals, records), so every open page
 * shows what people and agents just did.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const onEntry = (entry: ActivityEntry) => {
      queryClient.setQueryData(activityQuery.queryKey, (old) =>
        old?.some((e) => e.id === entry.id) ? old : [entry, ...(old ?? [])],
      );
      setFresh((old) => new Set(old).add(entry.id));
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
      if (entry.outcome !== 'failed') {
        void queryClient.invalidateQueries({ queryKey: ['records'] });
        for (const id of entry.recordIds)
          void queryClient.invalidateQueries({ queryKey: ['record', id] });
      }
    };
    return api.subscribeActivity({
      onEntry,
      onConnection: (up) => {
        setConnected(up);
        // Catch up on anything missed while disconnected.
        if (up) void queryClient.invalidateQueries({ queryKey: activityQuery.queryKey });
      },
    });
  }, [queryClient]);

  return <LiveContext value={{ connected, fresh }}>{children}</LiveContext>;
}

export function useLive(): Live {
  return useContext(LiveContext);
}
