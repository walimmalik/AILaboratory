import type { CampaignAttributes, ExperimentAttributes, OverviewFact } from '@ailab/schema';
import { day, facts, type OverviewBuilder, parts, words } from '../records/overview.ts';

/** "A, B and C". */
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const experiment: OverviewBuilder = async (record, read) => {
  const a = record.attributes as ExperimentAttributes;
  const [campaign, earlier, sops, subjects] = await Promise.all([
    read.get(a.campaign),
    read.get(a.followsUp?.experiment),
    Promise.all(a.protocol.map((p) => read.get(p.sop.id))),
    Promise.all((a.subjects ?? []).map((s) => read.get(s.record))),
  ]);
  const aim = (campaign?.attributes as CampaignAttributes | undefined)?.aims.find(
    (x) => x.id === a.aim,
  );
  const protocol: OverviewFact =
    a.protocol.length === 1 && sops[0]
      ? {
          label: 'protocol',
          value: sops[0].label,
          record: sops[0].id,
          detail: `${sops[0].name} version ${a.protocol[0]?.sop.version}`,
          field: 'protocol',
        }
      : {
          label: 'protocol',
          value:
            a.protocol.length === 0
              ? 'not chosen yet'
              : list(sops.map((s, i) => s?.label ?? a.protocol[i]?.id ?? '')),
          field: 'protocol',
          ...(a.protocol.length === 0 ? { tone: 'warn' as const } : {}),
        };
  const tested = subjects.flatMap((s) => (s ? [s.label] : []));
  return {
    identity: parts(
      campaign ? { text: `Experiment in ${campaign.label}`, record: campaign.id } : 'Experiment',
      earlier && {
        text: `${a.followsUp?.relation === 'repeats_with_changes' ? 'repeats' : 'follows up'} ${earlier.label}`,
        record: earlier.id,
      },
      words(a.stage),
    ),
    facts: facts(
      { label: 'question', value: a.question, field: 'question' },
      aim && {
        label: 'campaign aim',
        value: aim.text,
        ...(aim.success ? { detail: `met when: ${aim.success}` } : {}),
      },
      {
        label: 'what is tested',
        value: tested.length ? list(tested) : 'not chosen yet',
        field: 'subjects',
        ...(tested.length ? {} : { tone: 'warn' as const }),
      },
      protocol,
      a.controls?.length && {
        label: 'controls',
        value: list(a.controls.map((c) => c.label)),
        field: 'controls',
      },
      a.readouts?.length && {
        label: a.readouts.length === 1 ? 'readout' : 'readouts',
        value: list(a.readouts.map((r) => r.label)),
        field: 'readouts',
      },
      a.successCriteria?.length && {
        label: 'valid when',
        value: a.successCriteria.join('; '),
        field: 'successCriteria',
      },
      a.conclusion && {
        label: 'conclusion',
        value: a.conclusion.summary,
        detail: `concluded ${day(a.conclusion.at)}`,
        field: 'conclusion',
      },
    ),
  };
};

export const campaignOverviews: Record<string, OverviewBuilder> = { experiment };
