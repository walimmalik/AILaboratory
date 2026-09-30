import type { RecordEnvelope } from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * The demo campaigns (plan 013a) from `seed/campaigns.yaml`. Each experiment follows the SOPs of an
 * assay template in `seed/assays.yaml`, pinned to the version the lab has (ADR 0039); subjects and
 * controls are the lab's entities, found by their seed label.
 */

interface SeedExperiment {
  key: string;
  label: string;
  template: string;
  aim?: string;
  follows_up?: string;
  question: string;
  subjects?: string[];
  hypotheses?: unknown[];
  conditions?: unknown[];
  controls?: ({ subject?: string } & Record<string, unknown>)[];
  readouts?: unknown[];
  success?: string[];
}

interface SeedCampaignFile {
  campaigns: {
    key: string;
    label: string;
    goal: string;
    background?: string;
    aims: unknown[];
    about?: string[];
    experiments: SeedExperiment[];
  }[];
}

export interface SeedCampaign {
  key: string;
  label: string;
  attributes: Record<string, unknown>;
  /** Entity labels the campaign is about. */
  about: string[];
  experiments: {
    key: string;
    label: string;
    attributes: Record<string, unknown>;
    followsUp?: string;
    /** SOP labels to pin, by protocol part id. */
    sops: { id: string; label: string }[];
    subjects: string[];
    controls: { index: number; label: string }[];
  }[];
}

const partOf = (sopKey: string) => sopKey.replace(/^sop-/, '').replace(/[^a-z0-9]+/g, '_');

/** Reads the campaigns with SOP and entity keys turned into the labels records are found by. */
export function readSeedCampaigns(
  files: { campaigns: string; assays: string; entityLibrary: string },
  sopLabels: Map<string, string>,
): SeedCampaign[] {
  const file = parse(files.campaigns) as SeedCampaignFile;
  const templates = new Map(
    (parse(files.assays) as { templates: { key: string; sops: string[] }[] }).templates.map((t) => [
      t.key,
      t.sops,
    ]),
  );
  const entities = new Map(
    (parse(files.entityLibrary) as { entities: { key: string; label: string }[] }).entities.map(
      (e) => [e.key, e.label],
    ),
  );
  const entity = (key: string) => {
    const label = entities.get(key);
    if (!label) throw new Error(`seed/campaigns.yaml: no entity ${key} in the entity library`);
    return label;
  };
  return file.campaigns.map((c) => ({
    key: c.key,
    label: c.label,
    attributes: {
      goal: c.goal,
      ...(c.background ? { background: c.background } : {}),
      aims: c.aims,
    },
    about: (c.about ?? []).map(entity),
    experiments: c.experiments.map((e) => {
      const sops = templates.get(e.template);
      if (!sops) throw new Error(`seed/campaigns.yaml: no assay template ${e.template}`);
      return {
        key: e.key,
        label: e.label,
        attributes: {
          ...(e.aim ? { aim: e.aim } : {}),
          question: e.question,
          ...(e.hypotheses ? { hypotheses: e.hypotheses } : {}),
          ...(e.conditions ? { conditions: e.conditions } : {}),
          ...(e.controls
            ? { controls: e.controls.map(({ subject: _subject, ...control }) => control) }
            : {}),
          ...(e.readouts ? { readouts: e.readouts } : {}),
          ...(e.success ? { successCriteria: e.success } : {}),
        },
        ...(e.follows_up ? { followsUp: e.follows_up } : {}),
        sops: sops.map((key) => {
          const label = sopLabels.get(key);
          if (!label) throw new Error(`seed/campaigns.yaml: no seed SOP ${key}`);
          return { id: partOf(key), label };
        }),
        subjects: (e.subjects ?? []).map(entity),
        controls: (e.controls ?? []).flatMap((control, index) =>
          control.subject ? [{ index, label: entity(control.subject) }] : [],
        ),
      };
    }),
  }));
}

export interface CampaignSeedReport {
  created: string[];
  existing: string[];
  /** SOPs and entities the lab doesn't have yet, left out. */
  missing: string[];
}

/** Drafts each campaign the lab doesn't have yet (by title) with its experiments. */
export async function loadSeedCampaigns(
  registry: OperationRegistry,
  ctx: RecordContext,
  campaigns: SeedCampaign[],
  reason: string,
): Promise<CampaignSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const find = async (kind: string, label: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', { kind, search: label, limit: 50 })
    ).records.find((r) => r.label === label && r.status !== 'archived');
  const report: CampaignSeedReport = { created: [], existing: [], missing: [] };
  const ids = async (kind: string, labels: string[], where: string) => {
    const out: string[] = [];
    for (const label of labels) {
      const record = await find(kind, label);
      if (record) out.push(record.id);
      else report.missing.push(`${where}: ${label}`);
    }
    return out;
  };

  for (const c of campaigns) {
    if (await find('campaign', c.label)) {
      report.existing.push(c.label);
      continue;
    }
    const about = await ids('entity', c.about, c.key);
    const campaign = await run<RecordEnvelope>('campaigns.draft', {
      label: c.label,
      ...c.attributes,
      ...(about.length ? { about } : {}),
      reason,
    });
    report.created.push(`${campaign.name} ${c.label}`);
    const experiments = new Map<string, string>();
    for (const e of c.experiments) {
      const protocol = [];
      for (const part of e.sops) {
        const sop = await find('sop', part.label);
        if (sop) protocol.push({ id: part.id, sop: { id: sop.id, version: sop.version } });
        else report.missing.push(`${e.key}: SOP ${part.label}`);
      }
      const subjects = (await ids('entity', e.subjects, e.key)).map((record) => ({ record }));
      const controls = [
        ...((e.attributes.controls as Record<string, unknown>[] | undefined) ?? []),
      ];
      for (const { index, label } of e.controls) {
        const [subject] = await ids('entity', [label], e.key);
        if (subject) controls[index] = { ...controls[index], subject };
      }
      const followsUp = e.followsUp ? experiments.get(e.followsUp) : undefined;
      const experiment = await run<RecordEnvelope>('experiments.draft', {
        label: e.label,
        campaign: campaign.id,
        ...e.attributes,
        ...(controls.length ? { controls } : {}),
        protocol,
        ...(subjects.length ? { subjects } : {}),
        ...(followsUp ? { followsUp: { experiment: followsUp, relation: 'follows_up' } } : {}),
        reason,
      });
      experiments.set(e.key, experiment.id);
      report.created.push(`${experiment.name} ${e.label}`);
    }
  }
  return report;
}
