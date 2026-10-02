import type { MemoryAttributes, MemoryEvidence, RecordEnvelope } from '@ailab/schema';

/**
 * The Lab memory page's groups (plan 005, M19 note): worked out from each memory's links, never
 * tagged by hand. A memory shows once, under its most specific link; the others are tags.
 */

export interface AboutRecord {
  id: string;
  name: string;
  label: string;
  kind: string;
}

export type ShownMemory = RecordEnvelope & {
  due: boolean;
  seen?: MemoryEvidence | undefined;
  aboutRecords: AboutRecord[];
};

export const memoryOf = (m: RecordEnvelope) => m.attributes as MemoryAttributes;

/** Group titles in page order. */
export const GROUPS = [
  'Lab-wide',
  'Assays and SOPs',
  'Instruments',
  'Labware',
  'Reagents and liquids',
  'Cells and samples',
  'Places',
  'People',
  'Other records',
] as const;
export type Group = (typeof GROUPS)[number];

/** Record kinds by group, most specific first: a physical thing before its kind. */
const KINDS: [string, Group][] = [
  ['instrument', 'Instruments'],
  ['workcell', 'Instruments'],
  ['instrument_kind', 'Instruments'],
  ['equipment_kind', 'Instruments'],
  ['container', 'Labware'],
  ['labware_type', 'Labware'],
  ['lot', 'Reagents and liquids'],
  ['product', 'Reagents and liquids'],
  ['liquid_class', 'Reagents and liquids'],
  ['liquid_type', 'Reagents and liquids'],
  ['vendor', 'Reagents and liquids'],
  ['sample', 'Cells and samples'],
  ['entity', 'Cells and samples'],
  ['entity_kind', 'Cells and samples'],
  ['location', 'Places'],
  ['experiment', 'Assays and SOPs'],
  ['assay_template', 'Assays and SOPs'],
  ['sop', 'Assays and SOPs'],
  ['layout', 'Assays and SOPs'],
  ['campaign', 'Assays and SOPs'],
  ['document', 'Assays and SOPs'],
];
const rank = (kind: string) => {
  const i = KINDS.findIndex(([k]) => k === kind);
  return i === -1 ? KINDS.length : i;
};

/** The record a memory is filed under, and its group. */
export function placeOf(m: ShownMemory): { group: Group; under?: AboutRecord } {
  if (memoryOf(m).appliesTo.to === 'person') return { group: 'People' };
  const [under] = [...m.aboutRecords].sort((x, y) => rank(x.kind) - rank(y.kind));
  if (!under) return { group: 'Lab-wide' };
  return { group: KINDS.find(([k]) => k === under.kind)?.[1] ?? 'Other records', under };
}

export interface MemoryGroup {
  group: Group;
  /** Memories under one record (or none, for lab-wide and personal ones), rules first. */
  records: { under?: AboutRecord; memories: ShownMemory[] }[];
}

const STRENGTH = { rule: 0, default: 1, note: 2 } as const;

export function groupMemories(memories: readonly ShownMemory[]): MemoryGroup[] {
  const groups = new Map<Group, Map<string, { under?: AboutRecord; memories: ShownMemory[] }>>();
  for (const m of memories) {
    const { group, under } = placeOf(m);
    const records = groups.get(group) ?? new Map();
    groups.set(group, records);
    const key = under?.id ?? '';
    const entry = records.get(key) ?? { ...(under ? { under } : {}), memories: [] };
    entry.memories.push(m);
    records.set(key, entry);
  }
  return GROUPS.flatMap((group) => {
    const records = groups.get(group);
    if (!records) return [];
    return [
      {
        group,
        records: [...records.values()]
          .map((r) => ({
            ...r,
            memories: [...r.memories].sort(
              (x, y) => STRENGTH[memoryOf(x).strength] - STRENGTH[memoryOf(y).strength],
            ),
          }))
          .sort((x, y) => (x.under?.label ?? '').localeCompare(y.under?.label ?? '')),
      },
    ];
  });
}

export const strengthWords = { rule: 'Rule', default: 'Default', note: 'Note' } as const;

/** The grey line under a statement: "Rule · quirk · seen in 7 runs, last 2026-10-12, 1 against". */
export function memoryLine(m: ShownMemory): string {
  const a = memoryOf(m);
  return [
    strengthWords[a.strength],
    a.kind,
    m.seen?.line,
    a.when ? `when ${a.when}` : undefined,
    m.due ? 'due for a check' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The assistant's line for the memories it had (M21): "Using 4 lab notes, 1 rule". */
export function usingLine(memories: readonly { strength: string }[]): string {
  const rules = memories.filter((m) => m.strength === 'rule').length;
  const notes = memories.length === 1 ? '1 lab note' : `${memories.length} lab notes`;
  return `Using ${notes}${rules ? `, ${rules === 1 ? '1 rule' : `${rules} rules`}` : ''}`;
}
