import { convert, LabwareError, tipChanges, toOpentrons } from '@ailab/domain';
import type {
  EquipmentKindAttributes,
  FlexPipetteName,
  FlexProtocolRequest,
  InstrumentAttributes,
  LabwareTypeAttributes,
  PlanPlate,
  RecordEnvelope,
  ResolvedConfiguration,
  TransferGroup,
  TransferPlanAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { run } from './calculators.ts';

/**
 * The Opentrons Flex protocol for one group of a confirmed plan (plan 016b-3): which pipette, where
 * each plate and tip rack goes, and every transfer with whether it takes a new tip. The science
 * service writes the protocol from this data and checks it in Opentrons' simulator.
 *
 * Opentrons names pipettes and deck fixtures itself, so those names are code here (T1), matched on
 * the equipment kind's model or label.
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

/** Deck slots in the order plates and tip racks are placed: front row first, left to right. */
const SLOTS = ['D1', 'D2', 'D3', 'C1', 'C2', 'C3', 'B1', 'B2', 'B3', 'A1', 'A2', 'A3'];

export const isFlex = (kind: { model?: string | undefined }) => kind.model === 'Opentrons Flex';

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

const microlitres = (q: { value: string; unit: string }) => Number(convert(q, 'uL').value);

export interface FlexDeck {
  request: FlexProtocolRequest;
  /** Where everything goes, in plain words, for the export's answer and the loading list. */
  deck: { slot: string; holds: string }[];
  tips: number;
}

export async function flexRequest(
  deps: OperationDeps,
  ctx: RecordContext,
  plan: RecordEnvelope,
  group: TransferGroup,
  instrument: RecordEnvelope,
): Promise<FlexDeck> {
  const records = service(deps);
  const a = plan.attributes as TransferPlanAttributes;
  const refuse = (why: string) => new OperationError('invalid_state', why);
  const configuration = (instrument.attributes as InstrumentAttributes).configuration.equipment;
  const resolved = await run<ResolvedConfiguration>(deps, ctx, 'instruments.resolve', {
    instrument: instrument.id,
  });

  // The pipette: the group's node, or the only one installed.
  const moving = [
    ...new Set(
      resolved.capabilities
        .filter((c) => c.capability === 'transfer' && c.limits?.volume)
        .map((c) => c.node),
    ),
  ];
  const node = group.instrument?.node ?? (moving.length === 1 ? moving[0] : undefined);
  if (!node || !moving.includes(node))
    throw refuse(
      node
        ? `${instrument.label} has no pipette called ${node}`
        : `${instrument.label} has more than one pipette (${moving.join(', ')}); say which as the group's node with transfers.set_instrument`,
    );
  const installed = configuration.find((n) => n.id === node);
  const kindOf = async (id: string) => {
    const kind = await records.get(ctx, id);
    const k = kind.attributes as EquipmentKindAttributes;
    return k.model ?? kind.label;
  };
  const model = installed ? await kindOf(installed.kind) : undefined;
  const loadName = model ? PIPETTES[model] : undefined;
  if (!installed || !loadName || installed.placement.on !== 'slot')
    throw refuse(
      `${model ?? node} is not a Flex 1- or 8-channel pipette on a mount; protocols for other pipettes are not written yet`,
    );
  const mount = installed.placement.slot;
  if (mount !== 'left' && mount !== 'right')
    throw refuse(`${model} is on ${mount}, not the left or right mount`);

  // The trash: a trash bin where one is installed, else the waste chute.
  const fixtures = await Promise.all(
    configuration
      .filter((n) => n.mount === 'deck')
      .map(async (n) => ({ node: n, name: await kindOf(n.kind) })),
  );
  const bin = fixtures.find((f) => f.name === 'Flex Trash Bin');
  const chute = fixtures.find((f) => f.name === 'Flex Waste Chute');
  const trash: FlexProtocolRequest['trash'] | undefined =
    bin?.node.placement.on === 'slot'
      ? { kind: 'trash_bin', slot: bin.node.placement.slot }
      : chute
        ? { kind: 'waste_chute' }
        : undefined;
  if (!trash)
    throw refuse(
      `${instrument.label} has no trash bin or waste chute installed; add one with instruments.change_configuration`,
    );

  // Tips: the group's rule over the plan's order, as transfers.check counts them (T5).
  const rule = group.tips ?? 'lab_default';
  if (rule === 'none')
    throw refuse('A Flex pipette uses tips, but the group says none; set its tip rule');
  const wet = new Set<string>();
  for (const g of a.groups) {
    if (g.id === group.id) break;
    for (const t of g.transfers) wet.add(`${t.to.plate}|${t.to.well}`);
  }
  const moves = group.transfers.map((t) => {
    const to = `${t.to.plate}|${t.to.well}`;
    const intoLiquid = wet.has(to);
    wet.add(to);
    return { source: `${t.from.plate}|${t.from.well}`, intoLiquid };
  });
  const newTips = tipChanges(moves, rule);
  const tips = newTips.filter(Boolean).length;
  const largest = Math.max(...group.transfers.map((t) => microlitres(t.volume)));
  const rack = await tipRack(deps, ctx, PIPETTE_TIPS[loadName], largest);
  if (!rack)
    throw refuse(
      `The labware library has no confirmed Opentrons Flex tip rack for the ${model}; add one with its Opentrons load name`,
    );
  const racks = Math.ceil(tips / 96);

  // Plates in the plan's order, then tip racks, on the slots nothing else takes.
  const taken = new Set(
    resolved.claims.filter((c) => c.mount === 'deck').flatMap((c) => c.slots ?? []),
  );
  if (trash.kind === 'trash_bin') taken.add(trash.slot);
  const free = SLOTS.filter((s) => !taken.has(s));
  const used = new Set(group.transfers.flatMap((t) => [t.from.plate, t.to.plate]));
  const plates = a.plates.filter((p) => used.has(p.id));
  if (plates.length + racks > free.length)
    throw refuse(
      `It needs ${plates.length} plates and ${racks} tip racks on the deck, but ${instrument.label} has ${free.length} free slots (${free.join(', ') || 'none'}); split the group`,
    );
  const labware: FlexProtocolRequest['labware'] = [];
  const deck: FlexDeck['deck'] = [];
  for (const [i, p] of plates.entries()) {
    const slot = free[i] as string;
    const item = await flexLabware(records, ctx, p, refuse);
    labware.push({ ...item, slot });
    deck.push({ slot, holds: item.label });
  }
  const tipRacks = Array.from({ length: racks }, (_, i) => ({
    loadName: rack.loadName,
    slot: free[plates.length + i] as string,
  }));
  for (const r of tipRacks) deck.push({ slot: r.slot, holds: rack.label });
  deck.push(
    trash.kind === 'trash_bin'
      ? { slot: trash.slot, holds: 'Trash bin' }
      : { slot: 'D3', holds: 'Waste chute' },
  );

  return {
    request: {
      name: `${plan.name} v${plan.version} ${group.id}`,
      description: `${group.label}. From transfer plan ${plan.name} version ${plan.version}, group ${group.id}, on ${instrument.label} with the ${model} (${mount} mount).`,
      pipette: {
        loadName,
        mount,
        nozzles: loadName.startsWith('flex_8channel') ? 'single' : 'all',
      },
      trash,
      tipRacks,
      labware,
      transfers: group.transfers.map((t, i) => ({
        from: { labware: t.from.plate, well: t.from.well },
        to: { labware: t.to.plate, well: t.to.well },
        volume: microlitres(t.volume),
        newTip: newTips[i] as boolean,
      })),
    },
    deck: deck.sort((x, y) => SLOTS.indexOf(x.slot) - SLOTS.indexOf(y.slot)),
    tips,
  };
}

/** A plan plate as Opentrons loads it: by its Opentrons name, or a definition written from its type. */
async function flexLabware(
  records: RecordService,
  ctx: RecordContext,
  p: PlanPlate,
  refuse: (why: string) => OperationError,
) {
  const type = await records.getVersion(ctx, p.labwareType.id, p.labwareType.version);
  const attributes = type.snapshot.attributes as LabwareTypeAttributes;
  const barcode = p.container ? (await records.get(ctx, p.container)).name : undefined;
  const label = `${p.label ?? p.id}${barcode ? ` (${barcode})` : ''}`;
  if (attributes.opentronsLoadName)
    return { id: p.id, label, loadName: attributes.opentronsLoadName };
  try {
    const definition = toOpentrons(attributes, { label: type.snapshot.label });
    return {
      id: p.id,
      label,
      loadName: (definition.parameters as { loadName: string }).loadName,
      definition,
    };
  } catch (e) {
    if (e instanceof LabwareError)
      throw refuse(
        `${type.snapshot.label} (plate ${p.id}) has no Opentrons load name and no definition can be written from it: ${e.message}`,
      );
    throw e;
  }
}

/**
 * The lab's Flex tip rack for a pipette: confirmed, with an Opentrons Flex load name, tips the
 * pipette takes; the smallest that holds the largest transfer in one go, else the largest it has.
 */
async function tipRack(deps: OperationDeps, ctx: RecordContext, pipetteMax: number, need: number) {
  const types = await service(deps).list(ctx, {
    kind: 'labware_type',
    status: 'active',
    limit: 200,
  });
  const racks = types
    .map((t) => ({ t, a: t.attributes as LabwareTypeAttributes }))
    .filter(
      ({ a }) =>
        a.family === 'tip_rack' &&
        a.opentronsLoadName?.startsWith('opentrons_flex_96_') &&
        a.maxVolume,
    )
    .map(({ t, a }) => ({
      label: t.label,
      loadName: a.opentronsLoadName as string,
      volume: microlitres(a.maxVolume as { value: string; unit: string }),
    }))
    .filter((r) => r.volume <= pipetteMax)
    .sort((x, y) => x.volume - y.volume || x.loadName.localeCompare(y.loadName));
  return racks.find((r) => r.volume >= need) ?? racks.at(-1);
}
