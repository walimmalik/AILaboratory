import type { PageContext } from '@ailab/schema';
import { operationSchemas } from '../operations/describe.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { KindRegistry } from '../records/kinds.ts';
import type { ModelTool } from './model.ts';

/**
 * The assistant's tools (plan 004e R6, ADR 0055): a small core it always has, every calculator, the
 * full tools of the modules the person's page belongs to and of the modules this conversation
 * already used, and `run_operation` for anything else, found with `operations_describe`.
 */

/**
 * Always offered: reading records and what waits for people, discovery, drafting records, change sets
 * and the proposals the assistant left.
 */
const CORE = new Set([
  'records.get',
  'records.list',
  'records.readiness',
  'records.history',
  'records.diff',
  'records.kinds',
  'records.links',
  'records.create',
  'records.update',
  'review.list',
  'changes.apply',
  'proposals.list',
  'skills.list',
  'skills.get',
  'operations.describe',
]);

/** The modules each page of the app belongs to, by its path. */
const PAGE_NAMESPACES: [RegExp, string[]][] = [
  [/^\/labware/, ['labware']],
  [/^\/(instruments|instrument-models|equipment)/, ['instruments']],
  [/^\/workcells/, ['workcells', 'instruments']],
  [/^\/(reagents|lots|vendors)/, ['reagents']],
  [/^\/(liquid-classes|liquid-types)/, ['liquids']],
  [/^\/(containers|places|samples|scan)/, ['inventory', 'samples', 'locations']],
  [/^\/(entities|entity-kinds)/, ['entities']],
  [/^\/documents/, ['library', 'files']],
  [/^\/sops/, ['sops']],
  [/^\/(campaigns|experiments|runs|sets)/, ['campaigns', 'experiments', 'runs', 'sets']],
  [/^\/(plate-maps|layouts)/, ['platemaps', 'layouts', 'transfers']],
];

/** The modules a record page belongs to, by the record's kind. */
const KIND_NAMESPACES: Record<string, string[]> = {
  campaign: ['campaigns', 'experiments', 'runs', 'sets'],
  experiment: ['campaigns', 'experiments', 'runs', 'sets'],
  run: ['campaigns', 'experiments', 'runs', 'sets'],
  set: ['campaigns', 'experiments', 'runs', 'sets'],
  entity: ['entities'],
  entity_kind: ['entities'],
  file: ['library', 'files'],
  document: ['library', 'files'],
  instrument_kind: ['instruments'],
  equipment_kind: ['instruments'],
  instrument: ['instruments'],
  equipment_item: ['instruments'],
  workcell: ['workcells', 'instruments'],
  location: ['inventory', 'samples', 'locations'],
  container: ['inventory', 'samples', 'locations'],
  sample: ['inventory', 'samples', 'locations'],
  vendor: ['reagents'],
  product: ['reagents'],
  lot: ['reagents'],
  liquid_type: ['liquids'],
  liquid_class: ['liquids'],
  labware_type: ['labware'],
  layout: ['platemaps', 'layouts', 'transfers'],
  plate_map: ['platemaps', 'layouts', 'transfers'],
  sop: ['sops'],
  transfer_plan: ['transfers', 'worklists'],
  worklist_format: ['worklists', 'transfers', 'files'],
};

/** The namespaces of the page a message was sent from. */
export function pageNamespaces(page: PageContext | undefined, kinds: KindRegistry): string[] {
  if (!page) return [];
  const record = /^\/records\/([a-z]+)_/.exec(page.path);
  if (record) {
    const kind = kinds.list().find((k) => k.idPrefix === record[1]);
    return kind ? (KIND_NAMESPACES[kind.kind] ?? []) : [];
  }
  return PAGE_NAMESPACES.find(([path]) => path.test(page.path))?.[1] ?? [];
}

export const RUN_OPERATION = 'run_operation';

const runOperationTool: ModelTool = {
  name: RUN_OPERATION,
  description:
    'Run any operation that is not one of your other tools, by its ID (find it with operations_describe). Writes may be proposed for a person to confirm instead of applied.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'Operation ID, e.g. "sops.draft"' },
      input: { type: 'object', description: "Input matching the operation's input schema" },
    },
    required: ['operation', 'input'],
  },
};

/** Operations the assistant may never call: people-only ones and its own. */
export function callable(registry: OperationRegistry, id: string): boolean {
  if (id.startsWith('assistant.')) return false;
  try {
    return registry.get(id).actors !== 'people';
  } catch {
    return false;
  }
}

/** "records.delete_draft" → "records_delete_draft": a name every provider accepts. */
export function toolName(operationId: string): string {
  return operationId.replaceAll('.', '_');
}

export interface Toolset {
  list: ModelTool[];
  /** Tool name → operation ID, for the named tools. */
  operationOf: Map<string, string>;
}

/** The tools for one turn: core, calculators, and the given modules' operations, plus run_operation. */
export function toolsFor(registry: OperationRegistry, namespaces: Iterable<string> = []): Toolset {
  const wanted = new Set(namespaces);
  const list: ModelTool[] = [];
  const operationOf = new Map<string, string>();
  for (const contract of registry.list()) {
    if (!callable(registry, contract.id)) continue;
    const named =
      CORE.has(contract.id) || contract.calculator || wanted.has(contract.id.split('.')[0] ?? '');
    if (!named) continue;
    const name = toolName(contract.id);
    const { $schema: _, ...inputSchema } = operationSchemas(contract).input;
    list.push({
      name,
      description:
        contract.effect === 'write'
          ? `${contract.summary}. Changes data; may be proposed for a person to confirm instead of applied.`
          : `${contract.summary}. Read only.`,
      inputSchema,
    });
    operationOf.set(name, contract.id);
  }
  list.push(runOperationTool);
  return { list, operationOf };
}
