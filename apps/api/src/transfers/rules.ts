import {
  add,
  allWells,
  compare,
  convert,
  type DeviceLimits,
  deckProblems,
  fitVolume,
  formatQuantity,
  TransferError,
  tipChanges,
} from '@ailab/domain';
import type {
  CheckResult,
  LabwareTypeAttributes,
  Quantity,
  RecordEnvelope,
  RelatedContext,
  TransferGroup,
  TransferPlanAttributes,
  WorklistFormatAttributes,
} from '@ailab/schema';
import { checkPin } from '../records/pins.ts';

/**
 * The rules on a transfer plan (plan 016, T1) that need only its records: what `related` refuses
 * or reports as readiness, and what `transfers.check` adds live checks to.
 */

export const PLAN = '(plan 016, transfer plans)';

export interface Rule {
  id: string;
  label: string;
  severity: 'blocker' | 'warning';
  section: 'plates' | 'transfers' | 'decks';
  problems: string[];
  fix: string;
}

export const toCheck = (r: Rule): CheckResult => ({
  id: r.id,
  label: r.label,
  severity: r.severity,
  source: PLAN,
  section: r.section,
  passed: r.problems.length === 0,
  ...(r.problems.length ? { message: listed(r.problems) } : {}),
  fix: r.fix,
});

/** A few problems in full, then how many more. */
export function listed(problems: string[], shown = 5): string {
  const head = problems.slice(0, shown).join('; ');
  return problems.length > shown ? `${head}; and ${problems.length - shown} more` : head;
}

const duplicates = (names: readonly string[]) => [
  ...new Set(names.filter((n, i) => names.indexOf(n) !== i)),
];

const UL = 'uL';
const sum = (a: Quantity | undefined, b: Quantity) => (a ? add(a, convert(b, UL)) : convert(b, UL));

/** The wells of a labware type: its grid, its named wells, or A1 for a tube or trough of one. */
export function wellsOfType(a: LabwareTypeAttributes): Set<string> {
  const w = a.wells;
  if (w?.layout === 'grid') return new Set(allWells({ rows: w.rows, columns: w.columns }));
  if (w?.layout === 'explicit') return new Set(w.wells.map((x) => x.name));
  return new Set(['A1']);
}

/** What a group's device can move, as the domain reads it. */
export const limitsOf = (g: TransferGroup): DeviceLimits | undefined =>
  g.device
    ? {
        ...(g.device.min ? { min: g.device.min } : {}),
        ...(g.device.max ? { max: g.device.max } : {}),
        ...(g.device.step ? { step: g.device.step } : {}),
      }
    : undefined;

/**
 * Why the device can't move this volume as written, if it can't: out of its range, or not a whole
 * number of its steps. A plan's volume is what moves, so the totals, reservations and pick list
 * stay honest only when the device moves exactly that.
 */
export function moveProblem(volume: Quantity, limits: DeviceLimits): string | undefined {
  const fit = fitVolume(volume, limits);
  if (!fit.fits) return fit.problem;
  if (limits.step && compare(fit.achieved, volume) !== 0)
    return `${formatQuantity(volume)} is not a whole number of ${formatQuantity(limits.step)} steps (it would move ${formatQuantity(fit.achieved)})`;
  return undefined;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export interface PlanRules {
  invalid: string[];
  rules: Rule[];
  labware: Map<string, RecordEnvelope>;
  /** How each group's method handles tips, for the groups with a worklist format. */
  methods: Map<string, MethodTips>;
}

export async function planRules(
  a: TransferPlanAttributes,
  context: Pick<RelatedContext, 'get' | 'getVersion'>,
): Promise<PlanRules> {
  const invalid: string[] = [];
  const labware = new Map<string, RecordEnvelope>();
  for (const d of duplicates(a.plates.map((p) => p.id)))
    invalid.push(`The plate ${d} is named twice`);
  for (const d of duplicates(a.groups.map((g) => g.id)))
    invalid.push(`The group ${d} is named twice`);
  for (const d of duplicates(a.plates.flatMap((p) => (p.container ? [p.container] : []))))
    invalid.push(`${d} is given for two plates`);
  if (a.experiment && (await context.get(a.experiment))?.kind !== 'experiment')
    invalid.push(`${a.experiment} is not an experiment in this lab`);

  const unconfirmed: string[] = [];
  const newer: string[] = [];
  const wells = new Map<string, Set<string>>();
  for (const p of a.plates) {
    const pin = await checkPin(context, p.labwareType, 'labware_type', 'a labware type');
    if (pin.invalid || !pin.pinned) {
      invalid.push(`${p.id}: ${pin.invalid}`);
      continue;
    }
    labware.set(p.id, pin.pinned);
    wells.set(p.id, wellsOfType(pin.pinned.attributes as LabwareTypeAttributes));
    if (pin.unconfirmed) unconfirmed.push(`${p.id}: ${pin.unconfirmed}`);
    if (pin.newer) newer.push(`${p.id}: ${pin.record?.name} v${pin.newer} is newer`);
    if (p.container) {
      const c = await context.get(p.container);
      if (c?.kind !== 'container') invalid.push(`${p.container} is not a container in this lab`);
      else if ((c.attributes as { labwareType: string }).labwareType !== p.labwareType.id)
        invalid.push(`${c.name} is not a ${pin.pinned.label}, so it can't be ${p.id}`);
    }
    if (p.plateMap) {
      const map = await checkPin(context, p.plateMap.map, 'plate_map', 'a plate map');
      if (map.invalid) invalid.push(`${p.id}: ${map.invalid}`);
      if (map.unconfirmed) unconfirmed.push(`${p.id}: ${map.unconfirmed}`);
      if (map.newer) newer.push(`${p.id}: ${map.record?.name} v${map.newer} is newer`);
    }
  }

  const roles = new Map(a.plates.map((p) => [p.id, p.role]));
  const fits: string[] = [];
  for (const g of a.groups) {
    if (g.instrument) {
      if ((await context.get(g.instrument.instrument))?.kind !== 'instrument')
        invalid.push(`${g.label}: ${g.instrument.instrument} is not an instrument in this lab`);
      if (!g.device)
        invalid.push(
          `${g.label}: its device limits are missing; set the instrument with transfers.set_instrument`,
        );
    }
    if (g.liquid && (await context.get(g.liquid))?.kind !== 'liquid_type')
      invalid.push(`${g.label}: ${g.liquid} is not a liquid type in this lab`);
    if (g.liquidClass && (await context.get(g.liquidClass))?.kind !== 'liquid_class')
      invalid.push(`${g.label}: ${g.liquidClass} is not a liquid class in this lab`);
    const bad = new Set<string>();
    for (const t of g.transfers) {
      for (const [end, allowed] of [
        [t.from, ['source', 'intermediate']],
        [t.to, ['destination', 'intermediate']],
      ] as const) {
        const role = roles.get(end.plate);
        if (!role) bad.add(`${g.label}: no plate called ${end.plate}`);
        else if (!(allowed as readonly string[]).includes(role))
          bad.add(
            `${g.label}: ${end.plate} is a ${role} plate, so it can't be ${end === t.from ? 'drawn from' : 'filled'}`,
          );
        else if (wells.get(end.plate) && !wells.get(end.plate)?.has(end.well))
          bad.add(`${g.label}: ${end.plate} has no well ${end.well}`);
      }
    }
    invalid.push(...bad);
    const limits = limitsOf(g);
    if (!limits) continue;
    const problems = new Map<string, number>();
    for (const t of g.transfers) {
      try {
        const problem = moveProblem(t.volume, limits);
        if (problem) problems.set(problem, (problems.get(problem) ?? 0) + 1);
      } catch (error) {
        if (!(error instanceof TransferError)) throw error;
        problems.set(error.message, (problems.get(error.message) ?? 0) + 1);
      }
    }
    for (const [problem, n] of problems)
      fits.push(`${g.label}: ${n > 1 ? `${plural(n, 'transfer')}: ` : ''}${problem}`);
  }

  // What each well receives, and whether an intermediate is drawn from before it is filled.
  const into = new Map<string, Quantity>();
  const early: string[] = [];
  for (const g of a.groups) {
    const filledBefore = new Set(into.keys());
    for (const t of g.transfers) {
      const from = `${t.from.plate}|${t.from.well}`;
      if (roles.get(t.from.plate) === 'intermediate' && !filledBefore.has(from))
        early.push(
          `${g.label} draws from ${t.from.plate} ${t.from.well} before anything is put in it`,
        );
    }
    for (const t of g.transfers) {
      const key = `${t.to.plate}|${t.to.well}`;
      try {
        into.set(key, sum(into.get(key), t.volume));
      } catch {
        // A unit that isn't a volume is refused by the schema; nothing to add.
      }
    }
  }
  const overfull: string[] = [];
  for (const [key, volume] of into) {
    const [plate, well] = key.split('|') as [string, string];
    const type = labware.get(plate)?.attributes as LabwareTypeAttributes | undefined;
    const max = type?.workingVolume?.max ?? type?.maxVolume;
    if (max && compare(volume, max) > 0)
      overfull.push(
        `${plate} ${well} gets ${formatQuantity(volume)}; it holds ${formatQuantity(max)}`,
      );
  }

  const unpicked = a.plates
    .filter((p) => p.role === 'source' && !p.container)
    .map((p) => p.label ?? p.id);
  const decks = await deckRules(a, context, invalid, unconfirmed);
  const methods = new Map<string, MethodTips>();
  const worklists = await worklistRules(a, context, invalid, unconfirmed, newer, methods);
  const rules: Rule[] = [
    {
      id: 'has_transfers',
      label: 'It moves something',
      severity: 'blocker',
      section: 'transfers',
      problems: a.groups.length ? [] : ['No transfers yet'],
      fix: 'Add groups of transfers, worked out with the transfer calculators',
    },
    {
      id: 'volumes_fit',
      label: 'Every volume fits its instrument',
      severity: 'blocker',
      section: 'transfers',
      problems: fits,
      fix: 'Switch the group to an instrument that moves these volumes, or go through an intermediate dilution',
    },
    {
      id: 'wells_hold',
      label: 'Every well holds what goes in',
      severity: 'blocker',
      section: 'transfers',
      problems: overfull,
      fix: 'Move less into those wells, or use a plate type that holds more',
    },
    {
      id: 'intermediates_first',
      label: 'Intermediate wells are made before they are used',
      severity: 'blocker',
      section: 'transfers',
      problems: [...new Set(early)],
      fix: 'Put the group that makes the intermediate plate before the groups that draw from it',
    },
    {
      id: 'sources_picked',
      label: 'Every source is a container in inventory',
      severity: 'blocker',
      section: 'plates',
      problems: unpicked.length ? [`Not picked: ${unpicked.join(', ')}`] : [],
      fix: 'Pick the containers with transfers.pick_sources, after checking transfers.source_volumes',
    },
    {
      id: 'inputs_confirmed',
      label: 'Labware, plate maps and worklist formats are confirmed',
      severity: 'blocker',
      section: 'plates',
      problems: unconfirmed,
      fix: 'Confirm them first, then pin the versions a person confirmed',
    },
    {
      id: 'inputs_current',
      label: 'It uses the latest labware, plate maps and worklist formats',
      severity: 'warning',
      section: 'plates',
      problems: newer,
      fix: 'Look at what changed, then adopt the newer version or keep this one',
    },
    decks,
    ...worklists,
  ];
  return { invalid, rules, labware, methods };
}

/** A group's transfers in order: each one's source, and whether it goes into liquid already there. */
function groupMoves(a: TransferPlanAttributes, group: TransferGroup) {
  const wet = new Set<string>();
  for (const g of a.groups) {
    if (g.id === group.id) break;
    for (const t of g.transfers) wet.add(`${t.to.plate}|${t.to.well}`);
  }
  return group.transfers.map((t) => {
    const to = `${t.to.plate}|${t.to.well}`;
    const intoLiquid = wet.has(to);
    wet.add(to);
    return { source: `${t.from.plate}|${t.from.well}`, intoLiquid };
  });
}

/** How a group's method handles tips, from its worklist format (T5); absent, the group's own rule. */
export type MethodTips = WorklistFormatAttributes['tips'];

/**
 * Whether each transfer of a group takes a new tip, over the plan's order (T5). A worklist format
 * that fixes the tips (none, new each, per source) decides; one with a new tip column, or none,
 * leaves it to the group's rule.
 */
export function groupTips(
  a: TransferPlanAttributes,
  group: TransferGroup,
  method?: MethodTips,
): boolean[] {
  const rule = method && method !== 'column' ? method : (group.tips ?? 'lab_default');
  return tipChanges(groupMoves(a, group), rule);
}

/** How many tips the plan uses, from each group's method or tip rule. */
export function tipsOf(
  a: TransferPlanAttributes,
  methods: ReadonlyMap<string, MethodTips> = new Map(),
): number {
  return a.groups.reduce(
    (n, g) => n + groupTips(a, g, methods.get(g.id)).filter(Boolean).length,
    0,
  );
}

/** The plates a group uses, in the plan's order. */
export const platesUsed = (a: TransferPlanAttributes, group: TransferGroup) => {
  const used = new Set(group.transfers.flatMap((t) => [t.from.plate, t.to.plate]));
  return a.plates.filter((p) => used.has(p.id)).map((p) => p.id);
};

/**
 * The deck layout rules (016b-4, T6): every group on an Opentrons Flex has one, it places what the
 * group uses on slots that were free with enough tip racks, the tip racks are confirmed tip rack
 * types, and the instrument is confirmed.
 */
async function deckRules(
  a: TransferPlanAttributes,
  context: Pick<RelatedContext, 'get' | 'getVersion'>,
  invalid: string[],
  unconfirmed: string[],
): Promise<Rule> {
  const problems: string[] = [];
  const groups = new Map(a.groups.map((g) => [g.id, g]));
  for (const d of duplicates((a.decks ?? []).map((d) => d.group)))
    invalid.push(`The group ${d} has two deck layouts`);
  for (const deck of a.decks ?? [])
    if (!groups.has(deck.group))
      invalid.push(`A deck layout is for ${deck.group}, which the plan doesn't have`);
  for (const g of a.groups) {
    if (!g.instrument) continue;
    const instrument = await context.get(g.instrument.instrument);
    if (instrument?.kind !== 'instrument') continue;
    const kind = await context.get((instrument.attributes as { kind: string }).kind);
    if ((kind?.attributes as { model?: string } | undefined)?.model !== 'Opentrons Flex') continue;
    const deck = a.decks?.find((d) => d.group === g.id);
    if (!deck) {
      problems.push(`${g.label}: no deck layout yet`);
      continue;
    }
    if (instrument.status !== 'active')
      problems.push(`${g.label}: ${instrument.label} is not confirmed`);
    for (const site of deck.sites) {
      if (!('tipRack' in site)) continue;
      const pin = await checkPin(context, site.tipRack, 'labware_type', 'a labware type');
      if (pin.invalid || !pin.pinned) invalid.push(`${g.label}, ${site.slot}: ${pin.invalid}`);
      else if ((pin.pinned.attributes as LabwareTypeAttributes).family !== 'tip_rack')
        problems.push(`${g.label}, ${site.slot}: ${pin.pinned.label} is not a tip rack`);
      if (pin.unconfirmed) unconfirmed.push(`${g.label}, ${site.slot}: ${pin.unconfirmed}`);
    }
    const tips = groupTips(a, g).filter(Boolean).length;
    for (const problem of deckProblems(deck.sites, deck.free, platesUsed(a, g), tips))
      problems.push(`${g.label}: ${problem}`);
  }
  return {
    id: 'decks_fit',
    label: 'Every Flex group has a deck layout that fits',
    severity: 'blocker',
    section: 'decks',
    problems,
    fix: 'Lay the deck out again with transfers.set_deck (left out, code lays it out), then confirm it',
  };
}

/**
 * Each group's worklist format (016c): a format record, for the kind of instrument the group runs
 * on. Its confirmation counts with the other inputs.
 */
async function worklistRules(
  a: TransferPlanAttributes,
  context: Pick<RelatedContext, 'get' | 'getVersion'>,
  invalid: string[],
  unconfirmed: string[],
  newer: string[],
  methods: Map<string, MethodTips>,
): Promise<Rule[]> {
  const problems: string[] = [];
  const clashes: string[] = [];
  for (const g of a.groups) {
    if (!g.worklist) continue;
    const pin = await checkPin(context, g.worklist, 'worklist_format', 'a worklist format');
    if (pin.invalid || !pin.pinned) {
      invalid.push(`${g.label}: ${pin.invalid}`);
      continue;
    }
    if (pin.unconfirmed) unconfirmed.push(`${g.label}: ${pin.unconfirmed}`);
    if (pin.newer && pin.record)
      newer.push(`${g.label}: ${pin.record.name} v${pin.newer} is newer`);
    const format = pin.pinned.attributes as WorklistFormatAttributes;
    methods.set(g.id, format.tips);
    if (!g.instrument) {
      problems.push(`${g.label} is done by hand, but names the worklist format ${pin.pinned.name}`);
      continue;
    }
    const instrument = await context.get(g.instrument.instrument);
    const kind = (instrument?.attributes as { kind?: string } | undefined)?.kind;
    if (kind && kind !== format.instrumentKind) {
      const k = await context.get(format.instrumentKind);
      problems.push(
        `${g.label}: ${pin.pinned.name} is read by ${k?.label ?? format.instrumentKind}, not by ${instrument?.label}`,
      );
    }
    clashes.push(...tipClashes(a, g, format.tips, pin.pinned.label));
  }
  return [
    {
      id: 'worklists_fit',
      label: "Every worklist format is for its group's instrument",
      severity: 'blocker',
      section: 'transfers',
      problems,
      fix: "Set the group's worklist format with transfers.set_instrument, or draft one for that instrument with worklists.draft_format",
    },
    {
      id: 'worklist_tips',
      label: "The methods' tip handling suits what they move",
      severity: 'warning',
      section: 'transfers',
      problems: clashes,
      fix: "Use a method that takes a new tip where the tip touches liquid, or set the group's tip rule to match the method",
    },
  ];
}

/**
 * Where a method's fixed tip handling (T5) clashes with a group: a tip carried on after touching
 * liquid in a well, or a tip rule on the group that the method doesn't follow.
 */
export function tipClashes(
  a: TransferPlanAttributes,
  group: TransferGroup,
  method: MethodTips,
  name: string,
): string[] {
  if (method === 'column') return [];
  const out: string[] = [];
  const rule = group.tips ?? 'lab_default';
  const said =
    method === 'none'
      ? 'uses no tips'
      : method === 'new_each'
        ? 'takes a new tip every row'
        : 'keeps one tip per source';
  if (group.tips && group.tips !== 'lab_default' && rule !== method)
    out.push(`${group.label}: ${name} ${said}, not the group's rule (${rule.replace('_', ' ')})`);
  if (method === 'per_source') {
    const moves = groupMoves(a, group);
    const tips = tipChanges(moves, 'per_source');
    const carried = moves.filter((m, i) => !tips[i] && (m.intoLiquid || moves[i - 1]?.intoLiquid));
    if (carried.length)
      out.push(
        `${group.label}: ${name} keeps one tip per source, and ${carried.length} ${carried.length === 1 ? 'transfer reuses a tip' : 'transfers reuse a tip'} that touched liquid already in a well`,
      );
  }
  return out;
}
