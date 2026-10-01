import { add, convert, deckProblems, FLEX_SLOTS, formatQuantity } from '@ailab/domain';
import {
  type DeckLayout,
  type LabwareTypeAttributes,
  type Quantity,
  type TransferPlanAttributes,
  transfersLoadingList,
  transfersSetDeck,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { proposeIfActive } from '../operations/record-operations.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { draftGroupDeck, flexSetup, microlitres } from './decks.ts';
import { groupTips, platesUsed } from './rules.ts';

/** Deck layout operations (plan 016b-4, T6): set a group's layout, and read its loading list. */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

async function planOf(deps: OperationDeps, ctx: RecordContext, id: string) {
  const record = await service(deps)
    .get(ctx, id)
    .catch(() => undefined);
  if (record?.kind !== 'transfer_plan')
    throw new OperationError('not_found', `${id} is not a transfer plan in this lab`);
  return { record, a: record.attributes as TransferPlanAttributes };
}

const order = (slot: string) => FLEX_SLOTS.indexOf(slot as (typeof FLEX_SLOTS)[number]);

/** A few wells in full, then how many more. */
const some = (items: string[], shown = 6) =>
  items.length > shown
    ? `${items.slice(0, shown).join(', ')} and ${items.length - shown} more wells`
    : items.join(', ');

export const deckOperations = [
  implement(transfersSetDeck, {
    agentPolicy: proposeIfActive,
    run: async (ctx, input, deps) => {
      const { record, a } = await planOf(deps, ctx, input.id);
      const group = a.groups.find((g) => g.id === input.group);
      if (!group) throw new OperationError('invalid_input', `The plan has no group ${input.group}`);
      const setup = await flexSetup(deps, ctx, group);
      if (!setup)
        throw new OperationError(
          'invalid_input',
          `${group.label} is not on an Opentrons Flex; deck layouts are for Flex groups`,
        );
      let layout: DeckLayout;
      if (!input.sites) {
        layout = (await draftGroupDeck(deps, ctx, a, group)) as DeckLayout;
      } else {
        const records = service(deps);
        const problems: string[] = [];
        for (const site of input.sites) {
          if ('plate' in site) {
            if (!a.plates.some((p) => p.id === site.plate))
              problems.push(`${site.slot}: the plan has no plate ${site.plate}`);
            continue;
          }
          const rack = await records
            .getVersion(ctx, site.tipRack.id, site.tipRack.version)
            .catch(() => undefined);
          const r = rack?.snapshot.attributes as LabwareTypeAttributes | undefined;
          if (rack?.snapshot.kind !== 'labware_type' || r?.family !== 'tip_rack')
            problems.push(
              `${site.slot}: ${site.tipRack.id} v${site.tipRack.version} is not a tip rack in this lab`,
            );
          else if (!r.opentronsLoadName?.startsWith('opentrons_flex_96_'))
            problems.push(`${site.slot}: ${rack.snapshot.label} is not an Opentrons Flex tip rack`);
          else if (r.maxVolume && microlitres(r.maxVolume) > setup.maxTip)
            problems.push(`${site.slot}: the ${setup.model} doesn't take ${rack.snapshot.label}`);
        }
        const tips = groupTips(a, group).filter(Boolean).length;
        problems.push(...deckProblems(input.sites, setup.free, platesUsed(a, group), tips));
        if (problems.length)
          throw new OperationError(
            'invalid_input',
            `That layout doesn't fit ${setup.instrument.label}: ${problems.join('; ')}`,
          );
        layout = { group: group.id, sites: input.sites, free: setup.free, trash: setup.trash };
      }
      const others = (a.decks ?? []).filter((d) => d.group !== group.id);
      const position = (id: string) => a.groups.findIndex((g) => g.id === id);
      const decks = [...others, layout].sort((x, y) => position(x.group) - position(y.group));
      return service(deps).update(ctx, record.id, {
        expectedVersion: input.expectedVersion,
        attributes: { ...a, decks },
        reason: `${group.label}: deck ${input.sites ? 'set' : 'laid out by code'}. ${input.why}`,
      });
    },
  }),
  implement(transfersLoadingList, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const { record, a } = await planOf(deps, ctx, input.id);
      const records = service(deps);
      const groups = input.group ? a.groups.filter((g) => g.id === input.group) : a.groups;
      if (input.group && !groups.length)
        throw new OperationError('invalid_input', `${record.name} has no group ${input.group}`);
      const out: { group: string; label: string; instrument: string; steps: string[] }[] = [];
      const skipped: { group: string; why: string }[] = [];
      for (const group of groups) {
        const setup = await flexSetup(deps, ctx, group).catch((e: unknown) =>
          e instanceof OperationError ? e.message : Promise.reject(e),
        );
        const layout = a.decks?.find((d) => d.group === group.id);
        if (typeof setup === 'string' || !setup || !layout) {
          skipped.push({
            group: group.id,
            why:
              typeof setup === 'string'
                ? setup
                : !setup
                  ? 'Not on an Opentrons Flex'
                  : 'No deck layout yet; lay it out with transfers.set_deck',
          });
          continue;
        }
        const steps = [
          `On ${setup.instrument.label}, check the ${setup.model} pipette is on the ${setup.mount} mount.`,
          layout.trash.kind === 'trash_bin'
            ? `Empty the trash bin in ${layout.trash.slot}.`
            : `Check the waste chute in ${layout.trash.slot} is clear.`,
        ];
        // What each source well gives in this group, in order.
        const draws = new Map<string, Map<string, Quantity>>();
        for (const t of group.transfers) {
          const wells = draws.get(t.from.plate) ?? new Map<string, Quantity>();
          const had = wells.get(t.from.well);
          wells.set(t.from.well, had ? add(had, convert(t.volume, 'uL')) : convert(t.volume, 'uL'));
          draws.set(t.from.plate, wells);
        }
        const sites = [...layout.sites].sort((x, y) => order(x.slot) - order(y.slot));
        for (const site of sites) {
          if ('tipRack' in site) {
            const rack = await records.getVersion(ctx, site.tipRack.id, site.tipRack.version);
            steps.push(`Put a full rack of ${rack.snapshot.label} in ${site.slot}.`);
            continue;
          }
          const p = a.plates.find((x) => x.id === site.plate);
          if (!p) continue;
          const type = await records.getVersion(ctx, p.labwareType.id, p.labwareType.version);
          const container = p.container ? (await records.get(ctx, p.container)).name : undefined;
          const what = container
            ? `${p.label ?? p.id} (${container}, ${type.snapshot.label})`
            : p.role === 'destination'
              ? `${p.label ?? p.id} (an empty ${type.snapshot.label})`
              : `${p.label ?? p.id} (${type.snapshot.label})`;
          let line = `Put ${what} in ${site.slot}.`;
          const drawn = draws.get(p.id);
          if (drawn) {
            const dead = (type.snapshot.attributes as LabwareTypeAttributes).deadVolume;
            const needs = [...drawn].map(
              ([well, q]) => `${formatQuantity(dead ? add(q, convert(dead, 'uL')) : q)} in ${well}`,
            );
            line += ` It must hold at least ${some(needs)}${dead ? ', with its dead volume' : ''}.`;
          }
          steps.push(line);
        }
        out.push({
          group: group.id,
          label: group.label,
          instrument: setup.instrument.label,
          steps,
        });
      }
      return {
        plan: { id: record.id, name: record.name, version: record.version },
        groups: out,
        skipped,
      };
    },
  }),
];
