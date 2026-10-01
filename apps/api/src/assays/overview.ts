import type { AssayTemplateAttributes } from '@ailab/schema';
import { count, facts, type OverviewBuilder, parts, words } from '../records/overview.ts';

/** "duplicates", "3 wells each". */
const replicateWords = (n: number) =>
  n === 1 ? 'single wells' : n === 2 ? 'duplicates' : n === 3 ? 'triplicates' : `${n} wells each`;

const assayTemplate: OverviewBuilder = async (record, read) => {
  const a = record.attributes as AssayTemplateAttributes;
  const sops = await Promise.all(a.parts.map((p) => read.get(p.sop.id)));
  const layout = await read.get(a.layout?.id);
  const controls = (a.controls ?? []).map(
    (c) => `${c.label} (${count(c.wells, 'well')} per ${c.per})`,
  );
  return {
    identity: parts('Assay template', a.assays?.length && `for ${a.assays.join(', ')}`),
    facts: facts(
      { label: 'measures', value: a.purpose, field: 'purpose' },
      {
        label: 'follows',
        value: sops.map((s, i) => s?.label ?? `missing SOP (${a.parts[i]?.id})`).join(', '),
        detail: a.parts.map((p) => `version ${p.sop.version}`).join(', '),
        ...(sops.length === 1 && sops[0] ? { record: sops[0].id } : {}),
        field: 'parts',
      },
      layout && {
        label: 'layout',
        value: layout.label,
        record: layout.id,
        detail: `version ${a.layout?.version}`,
        field: 'layout',
      },
      {
        label: 'asks for',
        value: a.essentials.map((e) => e.label).join(', '),
        field: 'essentials',
      },
      a.factors?.length && {
        label: 'varies',
        value: a.factors.map((f) => f.label).join(' × '),
        detail: a.design === 'one_factor_at_a_time' ? 'one factor at a time' : 'every combination',
        field: 'factors',
      },
      {
        label: 'replicates',
        value: replicateWords(a.replicates.technical),
        ...(a.replicates.biological && a.replicates.biological > 1
          ? { detail: `${count(a.replicates.biological, 'run')}` }
          : {}),
        field: 'replicates',
      },
      controls.length > 0 && { label: 'controls', value: controls.join(', '), field: 'controls' },
      {
        label: 'reads',
        value: a.readouts.map((r) => r.label).join(', '),
        detail: [...new Set(a.readouts.map((r) => words(r.capability)))].join(', '),
        field: 'readouts',
      },
    ),
  };
};

export const assayOverviews = { assay_template: assayTemplate };
