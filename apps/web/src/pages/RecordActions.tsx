import {
  type RecordEnvelope,
  recordsArchive,
  recordsDeleteDraft,
  recordsRestore,
  recordsUnarchive,
} from '@ailab/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ChangeMemory } from './Memory.tsx';

/**
 * What a person can do to a record as a whole (plan 004e R11): archive or unarchive it, or discard
 * a draft. Each asks once more before it acts.
 */
export function RecordActions({ record }: { record: RecordEnvelope }) {
  // A lab memory is corrected, replaced or retired with why, the same as on the Lab memory page
  // (UX review 2026-10-02, #9); a retired one stays retired.
  if (record.kind === 'memory' && record.status !== 'draft')
    return <MemoryActions record={record} />;
  return <GeneralActions record={record} />;
}

function MemoryActions({ record }: { record: RecordEnvelope }) {
  const [changing, setChanging] = useState(false);
  if (record.status !== 'active') return null;
  return changing ? (
    <ChangeMemory
      key={`${record.id}:${record.version}`}
      memory={record}
      onClose={() => setChanging(false)}
    />
  ) : (
    <div className="actions record-actions">
      <button type="button" className="link-btn" onClick={() => setChanging(true)}>
        Change or retire
      </button>
    </div>
  );
}

function GeneralActions({ record }: { record: RecordEnvelope }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<'archive' | 'unarchive' | 'discard'>();
  const target = { id: record.id, expectedVersion: record.version };
  const act = useMutation({
    mutationFn: async (what: 'archive' | 'unarchive' | 'discard') => {
      if (what === 'archive') await api.run(recordsArchive, target);
      else if (what === 'unarchive') await api.run(recordsUnarchive, target);
      else await api.run(recordsDeleteDraft, target);
      return what;
    },
    onSuccess: async (what) => {
      setAsking(undefined);
      if (what === 'discard') {
        queryClient.removeQueries({ queryKey: ['record', record.id] });
        await navigate({ to: '/review' });
      } else {
        await queryClient.invalidateQueries({ queryKey: ['record', record.id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
    },
  });
  const what =
    record.status === 'draft' ? 'discard' : record.status === 'archived' ? 'unarchive' : 'archive';
  const words = {
    archive: {
      button: 'Archive',
      ask: `Archive ${record.name}? It stays in history and can be unarchived.`,
    },
    unarchive: { button: 'Unarchive', ask: `Bring ${record.name} back into use?` },
    discard: {
      button: 'Discard draft',
      ask: `Discard ${record.name}? The draft and its history are deleted.`,
    },
  }[what];

  return (
    <div className="actions record-actions">
      {asking ? (
        <>
          <span>{words.ask}</span>
          <button
            type="button"
            className="btn small"
            disabled={act.isPending}
            onClick={() => act.mutate(asking)}
          >
            {words.button} {record.name}
          </button>
          <button type="button" className="link-btn" onClick={() => setAsking(undefined)}>
            keep it
          </button>
        </>
      ) : (
        <button type="button" className="link-btn" onClick={() => setAsking(what)}>
          {words.button}
        </button>
      )}
      {act.error && <span className="error-text">{act.error.message}</span>}
    </div>
  );
}

/** "Restore" on an earlier version in the history table: writes that version again as a new one. */
export function RestoreVersion({ record, version }: { record: RecordEnvelope; version: number }) {
  const queryClient = useQueryClient();
  const [sure, setSure] = useState(false);
  const restore = useMutation({
    mutationFn: () =>
      api.run(recordsRestore, { id: record.id, expectedVersion: record.version, version }),
    onSuccess: async () => {
      setSure(false);
      await queryClient.invalidateQueries({ queryKey: ['record', record.id] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
    },
  });
  if (record.status === 'archived' || version >= record.version) return null;
  return (
    <span className="row-actions">
      {sure ? (
        <>
          <button
            type="button"
            className="btn small"
            disabled={restore.isPending}
            onClick={() => restore.mutate()}
          >
            Restore v{version}
          </button>
          <button type="button" className="link-btn" onClick={() => setSure(false)}>
            keep
          </button>
        </>
      ) : (
        <button
          type="button"
          className="link-btn"
          aria-label={`Restore version ${version}`}
          onClick={() => setSure(true)}
        >
          Restore
        </button>
      )}
      {restore.error && <span className="error-text">{restore.error.message}</span>}
    </span>
  );
}
