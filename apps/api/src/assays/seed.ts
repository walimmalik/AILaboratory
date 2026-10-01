import type { AssayTemplateAttributes, RecordEnvelope } from '@ailab/schema';
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
  /** Templates left out because the lab doesn't have a record they name yet. */
  waiting: string[];
}

/** Drafts each template the lab doesn't have yet (by label), once its SOPs and layout exist. */
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
  const report: AssayTemplateSeedReport = { created: [], existing: [], waiting: [] };
  for (const t of templates) {
    if (await find('assay_template', t.label)) {
      report.existing.push(t.label);
      continue;
    }
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
      report.waiting.push(`${t.label}: ${lacking.join(', ')}`);
      continue;
    }
    const attributes = {
      ...t.attributes,
      parts,
      ...(layout ? { layout: { id: layout.id, version: layout.version } } : {}),
      roles: roles.filter((r) => r.capability !== undefined || r.record !== undefined),
    } as AssayTemplateAttributes;
    const evidence = Object.fromEntries(
      Object.keys(attributes).map((name) => [
        name,
        { source: 'stated', note: 'Lab convention in seed/assay-templates.yaml' },
      ]),
    );
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
