import type {
  AssayTemplateAttributes,
  RecordEnvelope,
  TransferPlanAttributes,
  WorklistFormatAttributes,
} from '@ailab/schema';
import { Head, page } from './AreaHead.tsx';
import { useLabels } from './Instruments.tsx';
import { RecordList } from './Records.tsx';

/**
 * Homes for the kinds agents draft from (UX review 2026-10-02, item 15): assay templates and
 * transfer plans under Experiments, worklist formats under Instruments. Each is a plain list; the
 * record page holds the rest.
 */
export function AssayTemplatesPage() {
  const of = (r: RecordEnvelope) => r.attributes as Partial<AssayTemplateAttributes>;
  return (
    <>
      <Head
        page={page('assay_template')}
        lede="The assays the lab runs, each with its SOPs, layout, controls and readouts. An experiment is designed from a confirmed template."
      />
      <RecordList
        title="Assay templates"
        kind="assay_template"
        placeholder="Find by name, e.g. ELISA or ASY-0001"
        empty="No assay templates yet. Ask the assistant to draft one from an SOP, or load the seed lab."
        columns={[
          {
            header: 'Assay',
            cell: (r) => of(r).assays?.join(', ') || '—',
            filled: (r) => !!of(r).assays?.length,
          },
          {
            header: 'What it measures',
            cell: (r) => <span className="one-line">{of(r).purpose ?? '—'}</span>,
            className: 'muted',
            filled: (r) => !!of(r).purpose,
          },
        ]}
      />
    </>
  );
}

export function TransferPlansPage() {
  const experiments = useLabels('experiment');
  const of = (r: RecordEnvelope) => r.attributes as Partial<TransferPlanAttributes>;
  return (
    <>
      <Head
        page={page('transfer_plan')}
        lede="Which liquid goes from which plate to which, on which instrument, for an experiment. Worklists and Opentrons protocols are written from confirmed plans."
      />
      <RecordList
        title="Transfer plans"
        kind="transfer_plan"
        placeholder="Find by name, e.g. TFP-0001"
        empty="No transfer plans yet. They are drafted from an experiment's confirmed plate maps."
        columns={[
          {
            header: 'For',
            cell: (r) => experiments.get(of(r).experiment ?? '') ?? '—',
            filled: (r) => !!of(r).experiment,
          },
          {
            header: 'Plates',
            cell: (r) => of(r).plates?.length ?? 0,
            className: 'num',
          },
          {
            header: 'Reruns',
            cell: (r) => (of(r).rerunOf ? 'failed transfers' : ''),
            className: 'muted',
            filled: (r) => !!of(r).rerunOf,
          },
        ]}
      />
    </>
  );
}

export function WorklistFormatsPage() {
  const models = useLabels('instrument_kind');
  const of = (r: RecordEnvelope) => r.attributes as Partial<WorklistFormatAttributes>;
  return (
    <>
      <Head
        page={page('worklist_format')}
        lede="The files each instrument's method reads: which columns, in which order, and the volume unit. Worklists are written in these formats from confirmed transfer plans."
      />
      <RecordList
        title="Worklist formats"
        kind="worklist_format"
        placeholder="Find by name, e.g. Echo or WLF-0001"
        empty="No worklist formats yet. Ask the assistant to draft one from an example file."
        columns={[
          {
            header: 'Instrument model',
            cell: (r) => models.get(of(r).instrumentKind ?? '') ?? '…',
          },
          { header: 'Method', cell: (r) => of(r).method ?? '—', className: 'muted' },
        ]}
      />
    </>
  );
}
