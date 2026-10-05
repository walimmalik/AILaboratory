import { sameValue } from '@ailab/domain';
import type { AssayTemplateAttributes, Proposal, RecordEnvelope } from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * The demo lab's assay templates (plan 017a) from `seed/assay-templates.yaml`. SOPs, layouts,
 * instrument kinds and labware are named by their seed keys and found by label; SOPs and the
 * layout are pinned at the version the lab has.
 */

type Raw = Record<string, unknown> & {
  key: string;
  label: string;
  parts: { id: string; sop: string; note?: string }[];
  layout?: string;
  roles?: (Record<string, unknown> & { preferred?: string[]; record?: string })[];
};

export interface SeedAssayTemplate {
  key: string;
  label: string;
  /** Attributes with records still as labels: `{kind, label}`. */
  attributes: Record<string, unknown>;
  sops: { part: string; label: string }[];
  layout?: string;
  preferred: { role: number; labels: string[] }[];
  records: { role: number; kind: string; label: string }[];
}

export function readSeedAssayTemplates(
  text: string,
  keys: {
    sops: Map<string, string>;
    layouts: string;
    labware: string;
    instrumentLibrary: string;
  },
): SeedAssayTemplate[] {
  const byKey = (yaml: string, list: string, field: string) =>
    new Map(
      (parse(yaml) as Record<string, Record<string, string>[]>)[list]?.map((e) => [
        e.key as string,
        e[field] as string,
      ]) ?? [],
    );
  const layouts = byKey(keys.layouts, 'layouts', 'label');
  const labware = byKey(keys.labware, 'kinds', 'name');
  const instruments = byKey(keys.instrumentLibrary, 'instrument_kinds', 'label');
  const need = (map: Map<string, string>, key: string, what: string, where: string) => {
    const label = map.get(key);
    if (!label) throw new Error(`seed/assay-templates.yaml: ${where} names no ${what} ${key}`);
    return label;
  };
  return (parse(text) as { templates: Raw[] }).templates.map((t) => {
    const { key, label, parts, layout, roles, ...rest } = t;
    return {
      key,
      label,
      attributes: { ...rest, roles: roles ?? [] },
      sops: parts.map((p) => ({ part: p.id, label: need(keys.sops, p.sop, 'SOP', key) })),
      ...(layout ? { layout: need(layouts, layout, 'layout', key) } : {}),
      preferred: (roles ?? []).flatMap((r, i) =>
        r.preferred
          ? [{ role: i, labels: r.preferred.map((k) => need(instruments, k, 'instrument', key)) }]
          : [],
      ),
      records: (roles ?? []).flatMap((r, i) =>
        r.record
          ? [{ role: i, kind: 'labware_type', label: need(labware, r.record, 'labware', key) }]
          : [],
      ),
    };
  });
}

export interface AssayTemplateSeedReport {
  created: string[];
  existing: string[];
  /** Drafts it made earlier, brought up to the seed file (and the SOP versions the lab has) since. */
  updated: string[];
  /** Confirmed templates it made earlier whose seed changes wait on a person. */
  proposed: string[];
  /** Templates left out because the lab doesn't have a record they name yet. */
  waiting: string[];
}

/** The note every seed-set template field carries; a field with other evidence was changed since. */
const SEED_NOTE = 'Lab convention in seed/assay-templates.yaml';

/**
 * Drafts each template the lab doesn't have yet (by label), once its SOPs and layout exist. A
 * template it made earlier gets the fields that differ from the seed file, or pin an older SOP or
 * layout version than the lab's, while nobody else has changed them: a draft at once, a confirmed
 * template as a proposal.
 */
export async function loadSeedAssayTemplates(
  registry: OperationRegistry,
  ctx: RecordContext,
  templates: SeedAssayTemplate[],
  reason: string,
): Promise<AssayTemplateSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const find = async (kind: string, label: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', { kind, search: label, limit: 50 })
    ).records.find((r) => r.label === label && r.status !== 'archived');
  const report: AssayTemplateSeedReport = {
    created: [],
    existing: [],
    updated: [],
    proposed: [],
    waiting: [],
  };
  // Templates that already wait on a person for a seed change, so a rerun doesn't ask twice.
  const pending = new Set(
    (await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' })).proposals
      .filter((p) => p.operationId === 'records.update')
      .map((p) => (p.input as { id?: string }).id),
  );
  for (const t of templates) {
    const earlier = await find('assay_template', t.label);
    const lacking: string[] = [];
    const parts = [];
    for (const s of t.sops) {
      const sop = await find('sop', s.label);
      if (sop) parts.push({ id: s.part, sop: { id: sop.id, version: sop.version } });
      else lacking.push(`SOP ${s.label}`);
    }
    const layout = t.layout ? await find('layout', t.layout) : undefined;
    if (t.layout && !layout) lacking.push(`layout ${t.layout}`);
    const roles = structuredClone(t.attributes.roles) as Record<string, unknown>[];
    for (const p of t.preferred) {
      const ids = [];
      for (const label of p.labels) {
        const kind = await find('instrument_kind', label);
        if (kind) ids.push(kind.id);
      }
      if (ids.length) (roles[p.role] as Record<string, unknown>).preferred = ids;
      else delete (roles[p.role] as Record<string, unknown>).preferred;
    }
    for (const r of t.records) {
      const record = await find(r.kind, r.label);
      if (record) (roles[r.role] as Record<string, unknown>).record = record.id;
      else lacking.push(`${r.kind.replace('_', ' ')} ${r.label}`);
    }
    if (lacking.length) {
      if (earlier) report.existing.push(t.label);
      else report.waiting.push(`${t.label}: ${lacking.join(', ')}`);
      continue;
    }
    const attributes = {
      ...t.attributes,
      parts,
      ...(layout ? { layout: { id: layout.id, version: layout.version } } : {}),
      roles: roles.filter((r) => r.capability !== undefined || r.record !== undefined),
    } as AssayTemplateAttributes;
    const evidence = Object.fromEntries(
      Object.keys(attributes).map((name) => [name, { source: 'stated', note: SEED_NOTE }]),
    );
    if (earlier) {
      const was = earlier.attributes as Record<string, unknown>;
      const changed = Object.keys(attributes).filter(
        (key) =>
          earlier.evidence[key]?.note === SEED_NOTE &&
          !sameValue(was[key], (attributes as Record<string, unknown>)[key]),
      );
      if (!changed.length || pending.has(earlier.id)) {
        report.existing.push(t.label);
        continue;
      }
      const result = await registry.execute(ctx, 'records.update', {
        id: earlier.id,
        expectedVersion: earlier.version,
        attributes: {
          ...was,
          ...Object.fromEntries(
            changed.map((k) => [k, (attributes as Record<string, unknown>)[k]]),
          ),
        },
        evidence: Object.fromEntries(changed.map((k) => [k, evidence[k]])),
        reason: `${changed.join(', ')} from the seed file`,
      });
      const line = `${earlier.name} ${t.label} (${changed.join(', ')})`;
      if (result.status === 'proposed') report.proposed.push(line);
      else if (result.status === 'done') report.updated.push(line);
      else throw new Error(`records.update was ${result.status}`);
      continue;
    }
    const record = await run<RecordEnvelope>('assays.draft_template', {
      label: t.label,
      ...attributes,
      evidence,
      reason,
    });
    report.created.push(`${record.name} ${t.label}`);
  }
  return report;
}
