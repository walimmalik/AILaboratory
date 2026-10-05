import { isUnit, sameValue } from '@ailab/domain';
import {
  type EvidenceInput,
  type Proposal,
  type Quantity,
  type RecordEnvelope,
  type SopAttributes,
  type SopMaterial,
  type SopStep,
  type SopVariable,
  StepAction,
} from '@ailab/schema';
import { parse } from 'yaml';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Loads the lab's own SOPs (`seed/sops/own/`, plan 006) as draft digital SOPs (plan 012a). The
 * front matter gives the materials (seed keys, found in the lab by their seed labels) and the
 * variables; the numbered list becomes the steps in the SOP's own words, each with the action the
 * front matter's `actions` names for it (`manual` without one). Each SOP links to its library document when the lab has it.
 */

interface FrontMatter {
  key: string;
  title: string;
  uses?: Partial<Record<'labware' | 'reagents' | 'entities' | 'instruments', string[]>>;
  variables?: Record<string, unknown>;
  status_of_values?: Record<string, string>;
  based_on?: string[];
  notes?: string;
  /** Each numbered step's action (`StepAction`), in order. */
  actions?: string[];
}

/** Where each kind of seed key lives, and the record kind it becomes. */
const USES = {
  labware: { type: 'labware', kind: 'labware_type' },
  reagents: { type: 'reagent', kind: 'product' },
  entities: { type: 'entity', kind: 'entity' },
  instruments: { type: 'instrument', kind: 'instrument_kind' },
} as const;

export interface SeedSop {
  key: string;
  file: string;
  label: string;
  attributes: SopAttributes;
  /** Material roles and the record kind and label their default is found by. */
  defaults: { role: string; kind: string; label: string }[];
  evidence: Record<string, EvidenceInput>;
  /** Values the front matter gives that aren't numbers, kept in the notes. */
  skipped: string[];
}

export interface SeedLabels {
  labware: string;
  reagentLibrary: string;
  entityLibrary: string;
  instrumentLibrary: string;
}

/** Seed key to label, per kind of use. */
function labelsFrom(files: SeedLabels): Record<keyof typeof USES, Map<string, string>> {
  const pairs = (items: unknown, label: 'label' | 'name') =>
    new Map(
      ((items ?? []) as Record<string, string>[]).map((i) => [i.key as string, i[label] as string]),
    );
  return {
    labware: pairs((parse(files.labware) as { kinds: unknown[] }).kinds, 'name'),
    reagents: pairs((parse(files.reagentLibrary) as { products: unknown[] }).products, 'label'),
    entities: pairs((parse(files.entityLibrary) as { entities: unknown[] }).entities, 'label'),
    instruments: pairs(
      (parse(files.instrumentLibrary) as { instrument_kinds: unknown[] }).instrument_kinds,
      'label',
    ),
  };
}

const roleOf = (key: string) => key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

/** The numbered steps of the body: "1. **Coat.** Dilute…" becomes a step titled Coat. */
export function stepsOf(body: string, actions: readonly SopStep['action'][] = []): SopStep[] {
  const steps: SopStep[] = [];
  let current: string[] | undefined;
  const flush = () => {
    if (!current) return;
    let text = current.join(' ').replace(/\s+/g, ' ').trim();
    const titled = /^\*\*([^*]+?)\.?\*\*\s*/.exec(text);
    const title = titled?.[1]?.trim();
    if (titled) text = text.slice(titled[0].length);
    steps.push({
      id: `s${steps.length + 1}`,
      action: actions[steps.length] ?? 'manual',
      ...(title ? { title } : {}),
      text: text || (title as string),
    });
    current = undefined;
  };
  for (const line of body.split(/\r?\n/)) {
    const item = /^\d+\.\s+(.*)$/.exec(line);
    if (item) {
      flush();
      current = [item[1] as string];
    } else if (current && /^\s+\S/.test(line)) current.push(line.trim());
    else if (current && (line.trim() === '' || /^\S/.test(line))) flush();
  }
  flush();
  return steps;
}

/** The front matter's step actions, refusing a word that isn't one. */
function actionsOf(name: string, actions: string[] | undefined): SopStep['action'][] {
  return (actions ?? []).map((action, i) => {
    const parsed = StepAction.safeParse(action);
    if (!parsed.success) {
      throw new Error(
        `${name}: step ${i + 1} has action "${action}"; use one of ${StepAction.options.join(', ')}`,
      );
    }
    return parsed.data;
  });
}

/** The body's "## Heading" sections by lowercased heading. */
function sectionsOf(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let heading: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (heading !== undefined) out.set(heading, lines.join('\n').trim());
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = (h[1] as string).trim().toLowerCase();
      lines = [];
    } else lines.push(line);
  }
  flush();
  return out;
}

function variableOf(name: string, raw: unknown): SopVariable | string {
  const label = name.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
  const base = { name, label, kind: 'default' as const };
  if (typeof raw === 'number') return { ...base, value: String(raw) };
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const { value, unit, note } = raw as { value: unknown; unit?: string; note?: string };
    const text = String(value);
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return `${name}: ${text}${unit ? ` ${unit}` : ''}`;
    if (unit !== undefined && !isUnit(unit)) return `${name}: ${text} ${unit} (unknown unit)`;
    const v: string | Quantity = unit === undefined ? text : { value: text, unit };
    return { ...base, value: v, ...(note ? { note } : {}) };
  }
  return `${name}: ${String(raw)}`;
}

/** Reads the SOP files into draft SOPs, refusing a file without key and title. */
export function readSeedSops(
  files: { name: string; text: string }[],
  seedLabels: SeedLabels,
): SeedSop[] {
  const labels = labelsFrom(seedLabels);
  return files.map(({ name, text }) => {
    const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    const meta = head ? (parse(head[1] as string) as FrontMatter) : undefined;
    if (!meta?.key || !meta.title) throw new Error(`${name}: no front matter with key and title`);
    const body = head?.[2] ?? '';
    const materials: SopMaterial[] = [];
    const defaults: SeedSop['defaults'] = [];
    for (const [use, { type, kind }] of Object.entries(USES) as [
      keyof typeof USES,
      (typeof USES)[keyof typeof USES],
    ][]) {
      for (const key of meta.uses?.[use] ?? []) {
        const label = labels[use].get(key);
        const role = roleOf(key);
        materials.push({ role, label: label ?? key, type });
        if (label) defaults.push({ role, kind, label });
      }
    }
    const variables: SopVariable[] = [];
    const skipped: string[] = [];
    for (const [variable, raw] of Object.entries(meta.variables ?? {})) {
      const v = variableOf(variable, raw);
      if (typeof v === 'string') skipped.push(v);
      else variables.push(v);
    }
    const steps = stepsOf(body, actionsOf(name, meta.actions));
    if (meta.actions && meta.actions.length !== steps.length) {
      throw new Error(
        `${name}: ${meta.actions.length} actions for ${steps.length} numbered steps; name one per step`,
      );
    }
    const sections = sectionsOf(body);
    const estimated = Object.entries(meta.status_of_values ?? {})
      .filter(([, s]) => s === 'estimated')
      .map(([v]) => v);
    const notes = [
      meta.notes,
      ...['before you start', 'handling rules', 'timing rules (for the scheduler)', 'timing rules']
        .filter((h) => sections.get(h))
        .map((h) => `${h[0]?.toUpperCase()}${h.slice(1)}:\n${sections.get(h)}`),
      skipped.length ? `Values that aren't numbers: ${skipped.join('; ')}` : undefined,
      meta.based_on?.length ? `Based on ${meta.based_on.join(', ')}` : undefined,
    ].filter((n): n is string => Boolean(n));
    const analysis = sections.get('analysis');
    const reference = `seed/sops/own/${name}`;
    return {
      key: meta.key,
      file: name,
      label: meta.title,
      attributes: {
        materials,
        variables,
        steps,
        ...(analysis ? { analysis } : {}),
        ...(notes.length ? { notes: notes.join('\n\n') } : {}),
      },
      defaults,
      evidence: {
        materials: {
          source: 'imported',
          reference,
          note: 'From the front matter; defaults found by their seed labels',
        },
        variables: {
          source: estimated.length ? 'assumed' : 'imported',
          reference,
          ...(estimated.length ? { note: `Unverified in the seed: ${estimated.join(', ')}` } : {}),
        },
        steps: {
          source: 'imported',
          reference,
          note: meta.actions
            ? 'The numbered steps as written, each with the action the seed file names'
            : 'The numbered steps as written, as manual steps until digitized',
        },
      },
      skipped,
    };
  });
}

export interface SopSeedReport {
  created: string[];
  existing: string[];
  /** Drafts it made earlier whose variables or steps it has brought up to the seed file since. */
  updated: string[];
  /** Confirmed SOPs it made earlier whose newer seed variables or steps wait on a person. */
  proposed: string[];
  /** Materials whose default record the lab doesn't have yet. */
  unbound: string[];
}

/** The fields a rerun brings up to the seed file, while their evidence still cites it. */
const SEED_OWNED = ['variables', 'steps'] as const;

/**
 * Drafts each SOP the lab doesn't have yet (by title), binding defaults the lab has. An SOP it made
 * earlier gets the seed file's newer variables and steps while nobody else has changed them (their
 * evidence still cites the file): a draft at once, a confirmed SOP as a proposal, as labware does.
 */
export async function loadSeedSops(
  registry: OperationRegistry,
  ctx: RecordContext,
  sops: SeedSop[],
  reason: string,
): Promise<SopSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const find = async (kind: string, label: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', { kind, search: label, limit: 50 })
    ).records.find((r) => r.label === label && r.status !== 'archived');
  const report: SopSeedReport = {
    created: [],
    existing: [],
    updated: [],
    proposed: [],
    unbound: [],
  };
  // SOPs that already wait on a person for a seed change, so a rerun doesn't ask twice.
  const pending = new Set(
    (await run<{ proposals: Proposal[] }>('proposals.list', { status: 'pending' })).proposals
      .filter((p) => p.operationId === 'records.update')
      .map((p) => (p.input as { id?: string }).id),
  );
  for (const s of sops) {
    const earlier = await find('sop', s.label);
    if (earlier) {
      const changed = SEED_OWNED.filter(
        (field) =>
          earlier.evidence[field]?.reference === s.evidence[field]?.reference &&
          !sameValue(earlier.attributes[field], s.attributes[field]),
      );
      if (!changed.length || pending.has(earlier.id)) {
        report.existing.push(s.label);
        continue;
      }
      const result = await registry.execute(ctx, 'records.update', {
        id: earlier.id,
        expectedVersion: earlier.version,
        attributes: {
          ...earlier.attributes,
          ...Object.fromEntries(changed.map((f) => [f, s.attributes[f]])),
        },
        evidence: Object.fromEntries(changed.map((f) => [f, s.evidence[f]])),
        reason: `${changed.join(' and ')} from the seed file ${s.file}`,
      });
      const line = `${earlier.name} ${s.label} (${changed.join(', ')})`;
      if (result.status === 'proposed') report.proposed.push(line);
      else if (result.status === 'done') report.updated.push(line);
      else throw new Error(`records.update was ${result.status}`);
      continue;
    }
    const materials = [...s.attributes.materials];
    for (const d of s.defaults) {
      const record = await find(d.kind, d.label);
      const i = materials.findIndex((m) => m.role === d.role);
      if (record && i >= 0) materials[i] = { ...(materials[i] as SopMaterial), default: record.id };
    }
    for (const m of materials) if (!m.default) report.unbound.push(`${s.key}: ${m.label}`);
    const document = await find('document', s.label);
    const created = await run<RecordEnvelope>('sops.draft', {
      label: s.label,
      ...s.attributes,
      materials,
      ...(document ? { source: { document: document.id } } : {}),
      evidence: s.evidence,
      reason,
    });
    report.created.push(`${created.name} ${s.label}`);
  }
  return report;
}
