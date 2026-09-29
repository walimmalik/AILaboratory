import { labwareExportOpentrons, type RecordEnvelope } from '@ailab/schema';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { fileOf } from '../lib/files.ts';
import { FileCard } from './FileCard.tsx';

/**
 * A labware type as an Opentrons labware definition, ready to save: for the Opentrons simulator or to
 * load as custom labware. When the type can't be exported yet, says what is missing.
 */
export function OpentronsBlock({ record }: { record: RecordEnvelope }) {
  const exported = useQuery({
    queryKey: ['record', record.id, 'opentrons', record.version],
    queryFn: () => api.run(labwareExportOpentrons, { id: record.id }),
    retry: false,
  });
  const file = exported.data ? fileOf(labwareExportOpentrons.id, exported.data) : undefined;
  return (
    <section className="block" aria-label="Opentrons">
      <header>
        <h2>Opentrons</h2>
        <span className="state muted">labware definition</span>
      </header>
      <div className="body">
        {exported.isPending ? (
          <p className="muted">Writing the definition…</p>
        ) : file ? (
          <FileCard file={file} />
        ) : (
          <p className="muted">Can't write it yet: {exported.error?.message}</p>
        )}
      </div>
    </section>
  );
}
