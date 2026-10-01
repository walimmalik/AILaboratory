import { convert, draftDeck, FLEX_SLOTS, racksFor, TransferError } from '@ailab/domain';
import type {
  DeckLayout,
  EquipmentKindAttributes,
  FlexPipetteName,
  InstrumentAttributes,
  InstrumentKindAttributes,
  LabwareTypeAttributes,
  RecordEnvelope,
  ResolvedConfiguration,
  TransferGroup,
  TransferPlanAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { run } from './calculators.ts';
import { groupTips, platesUsed } from './rules.ts';

/**
 * Deck layouts (plan 016b-4, T6): where a group's plates and tip racks go on an Opentrons Flex,
 * drafted from the instrument's configuration and confirmed with the plan. Opentrons names its
 * pipettes and deck fixtures itself, so those names are code here (T1), matched on the equipment
 * kind's model or label.
 */

const PIPETTES: Record<string, FlexPipetteName> = {
  'Flex 1-Channel 50 uL': 'flex_1channel_50',
  'Flex 1-Channel 1000 uL': 'flex_1channel_1000',
  'Flex 8-Channel 50 uL': 'flex_8channel_50',
  'Flex 8-Channel 1000 uL': 'flex_8channel_1000',
};

/** Largest tip each pipette takes, in microlitres. */
const PIPETTE_TIPS: Record<FlexPipetteName, number> = {
  flex_1channel_50: 50,
  flex_1channel_1000: 1000,
  flex_8channel_50: 50,
  flex_8channel_1000: 1000,
};

export const isFlex = (kind: { model?: string | undefined }) => kind.model === 'Opentrons Flex';

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

export const microlitres = (q: { value: string; unit: string }) => Number(convert(q, 'uL').value);

const refuse = (why: string) => new OperationError('invalid_state', why);

export interface FlexSetup {
  instrument: RecordEnvelope;
  /** The pipette's equipment kind model, e.g. "Flex 1-Channel 1000 uL". */
  model: string;
  pipette: FlexPipetteName;
  mount: 'left' | 'right';
  /** Largest tip it takes, in microlitres. */
  maxTip: number;
  free: string[];
  trash: DeckLayout['trash'];
}

/**
 * The Flex a group runs on as it is installed now: its pipette (the group's node, or the only one)
 * and the deck slots nothing claims. Undefined for other instruments; refused with why when the
 * Flex can't run the group as installed.
 */
export async function flexSetup(
  deps: OperationDeps,
  ctx: RecordContext,
  group: Pick<TransferGroup, 'instrument'>,
): Promise<FlexSetup | undefined> {
  if (!group.instrument) return undefined;
  const records = service(deps);
  const instrument = await records.get(ctx, group.instrument.instrument);
  const a = instrument.attributes as InstrumentAttributes;
  const kind = (await records.get(ctx, a.kind)).attributes as InstrumentKindAttributes;
  if (!isFlex(kind)) return undefined;
  const resolved = await run<ResolvedConfiguration>(deps, ctx, 'instruments.resolve', {
    instrument: instrument.id,
  });
  const moving = [
    ...new Set(
      resolved.capabilities
        .filter((c) => c.capability === 'transfer' && c.limits?.volume)
        .map((c) => c.node),
    ),
  ];
  const node = group.instrument.node ?? (moving.length === 1 ? moving[0] : undefined);
  if (!node || !moving.includes(node))
    throw refuse(
      node
        ? `${instrument.label} has no pipette called ${node}`
        : `${instrument.label} has more than one pipette (${moving.join(', ')}); say which as the group's node with transfers.set_instrument`,
    );
  const nameOf = async (id: string) => {
    const k = await records.get(ctx, id);
    return (k.attributes as EquipmentKindAttributes).model ?? k.label;
  };
  const installed = a.configuration.equipment.find((n) => n.id === node);
  const model = installed ? await nameOf(installed.kind) : node;
  const pipette = PIPETTES[model];
  if (!installed || !pipette || installed.placement.on !== 'slot')
    throw refuse(
      `${model} is not a Flex 1- or 8-channel pipette on a mount; protocols for other pipettes are not written yet`,
    );
  const mount = installed.placement.slot;
  if (mount !== 'left' && mount !== 'right')
    throw refuse(`${model} is on ${mount}, not the left or right mount`);

  const fixtures = await Promise.all(
    a.configuration.equipment
      .filter((n) => n.mount === 'deck' && n.placement.on === 'slot')
      .map(async (n) => ({
        name: await nameOf(n.kind),
        slot: (n.placement as { slot: string }).slot,
      })),
  );
  const bin = fixtures.find((f) => f.name === 'Flex Trash Bin');
  const chute = fixtures.find((f) => f.name === 'Flex Waste Chute');
  const trash: DeckLayout['trash'] | undefined = bin
    ? { kind: 'trash_bin', slot: bin.slot }
    : chute
      ? { kind: 'waste_chute', slot: chute.slot }
      : undefined;
  if (!trash)
    throw refuse(
      `${instrument.label} has no trash bin or waste chute installed; add one with instruments.change_configuration`,
    );
  const taken = new Set(
    resolved.claims.filter((c) => c.mount === 'deck').flatMap((c) => c.slots ?? []),
  );
  taken.add(trash.slot);
  return {
    instrument,
    model,
    pipette,
    mount,
    maxTip: PIPETTE_TIPS[pipette],
    free: FLEX_SLOTS.filter((s) => !taken.has(s)),
    trash,
  };
}

/**
 * The lab's Flex tip rack for a pipette: confirmed, with an Opentrons Flex load name, tips the
 * pipette takes; the smallest that holds the largest transfer in one go, else the largest it has.
 */
export async function tipRackFor(
  deps: OperationDeps,
  ctx: RecordContext,
  maxTip: number,
  need: number,
) {
  const types = await service(deps).list(ctx, {
    kind: 'labware_type',
    status: 'active',
    limit: 200,
  });
  const racks = types
    .filter((t) => {
      const a = t.attributes as LabwareTypeAttributes;
      return (
        a.family === 'tip_rack' &&
        a.opentronsLoadName?.startsWith('opentrons_flex_96_') &&
        a.maxVolume
      );
    })
    .map((t) => ({
      record: t,
      volume: microlitres((t.attributes as LabwareTypeAttributes).maxVolume as never),
    }))
    .filter((r) => r.volume <= maxTip)
    .sort((x, y) => x.volume - y.volume || x.record.label.localeCompare(y.record.label));
  return (racks.find((r) => r.volume >= need) ?? racks.at(-1))?.record;
}

/**
 * Lays out a Flex group's deck: its plates in plan order, then enough full tip racks, on the free
 * slots front row first. Undefined for groups not on a Flex.
 */
export async function draftGroupDeck(
  deps: OperationDeps,
  ctx: RecordContext,
  a: TransferPlanAttributes,
  group: TransferGroup,
): Promise<DeckLayout | undefined> {
  const setup = await flexSetup(deps, ctx, group);
  if (!setup) return undefined;
  if ((group.tips ?? 'lab_default') === 'none')
    throw refuse('A Flex pipette uses tips, but the group says none; set its tip rule');
  const largest = Math.max(...group.transfers.map((t) => microlitres(t.volume)));
  const rack = await tipRackFor(deps, ctx, setup.maxTip, largest);
  if (!rack)
    throw refuse(
      `The labware library has no confirmed Opentrons Flex tip rack for the ${setup.model}; add one with its Opentrons load name`,
    );
  const tips = groupTips(a, group).filter(Boolean).length;
  let placed: ReturnType<typeof draftDeck>;
  try {
    placed = draftDeck(setup.free, platesUsed(a, group), racksFor(tips));
  } catch (e) {
    if (e instanceof TransferError) throw refuse(e.message);
    throw e;
  }
  return {
    group: group.id,
    sites: placed.map((s) =>
      s.plate
        ? { slot: s.slot, plate: s.plate }
        : { slot: s.slot, tipRack: { id: rack.id, version: rack.version } },
    ),
    free: setup.free,
    trash: setup.trash,
  };
}

/**
 * The plan's deck layouts with the groups named (all when none are) laid out again: a Flex group
 * gets a fresh layout, or none when the Flex can't run it as installed (readiness then says why).
 * Other groups keep theirs; layouts of groups no longer in the plan go.
 */
export async function draftDecks(
  deps: OperationDeps,
  ctx: RecordContext,
  a: TransferPlanAttributes,
  only?: readonly string[],
): Promise<DeckLayout[]> {
  const decks: DeckLayout[] = [];
  for (const g of a.groups) {
    const had = a.decks?.find((d) => d.group === g.id);
    if (only && !only.includes(g.id)) {
      if (had) decks.push(had);
      continue;
    }
    const deck = await draftGroupDeck(deps, ctx, a, g).catch((e: unknown) => {
      if (e instanceof OperationError && e.code === 'invalid_state') return undefined;
      throw e;
    });
    if (deck) decks.push(deck);
  }
  return decks;
}

/** How a layout differs from the Flex now: slots it uses that something else took since. */
export function deckChanged(deck: DeckLayout, now: FlexSetup): string[] {
  const problems = deck.sites
    .filter((s) => !now.free.includes(s.slot))
    .map((s) => `${s.slot} is not free on ${now.instrument.label} now`);
  if (deck.trash.kind !== now.trash.kind || deck.trash.slot !== now.trash.slot)
    problems.push(`${now.instrument.label}'s trash moved since the deck was set`);
  return problems;
}
