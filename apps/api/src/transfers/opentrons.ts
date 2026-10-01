import { FLEX_SLOTS, LabwareError, toOpentrons } from '@ailab/domain';
import type {
  FlexProtocolRequest,
  LabwareTypeAttributes,
  PlanPlate,
  RecordEnvelope,
  TransferGroup,
  TransferPlanAttributes,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { deckChanged, flexSetup, microlitres } from './decks.ts';
import { groupTips } from './rules.ts';

/**
 * The Opentrons Flex protocol for one group of a confirmed plan (plan 016b-3): the pipette as
 * installed, the plan's confirmed deck layout (016b-4), and every transfer with whether it takes a
 * new tip. The science service writes the protocol from this data and checks it in Opentrons'
 * simulator.
 */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

export interface FlexDeck {
  request: FlexProtocolRequest;
  /** Where everything goes, in plain words, for the export's answer. */
  deck: { slot: string; holds: string }[];
  tips: number;
}

export async function flexRequest(
  deps: OperationDeps,
  ctx: RecordContext,
  plan: RecordEnvelope,
  group: TransferGroup,
): Promise<FlexDeck> {
  const records = service(deps);
  const a = plan.attributes as TransferPlanAttributes;
  const refuse = (why: string) => new OperationError('invalid_state', why);
  const setup = await flexSetup(deps, ctx, group);
  if (!setup) throw refuse('It is not on an Opentrons Flex');
  const layout = a.decks?.find((d) => d.group === group.id);
  if (!layout)
    throw refuse('It has no deck layout; lay it out with transfers.set_deck and confirm it');
  const changed = deckChanged(layout, setup);
  if (changed.length)
    throw refuse(
      `The Flex changed since the deck layout was confirmed: ${changed.join('; ')}; lay it out again with transfers.set_deck`,
    );

  const labware: FlexProtocolRequest['labware'] = [];
  const tipRacks: FlexProtocolRequest['tipRacks'] = [];
  const deck: FlexDeck['deck'] = [];
  const plates = new Map(a.plates.map((p) => [p.id, p]));
  for (const site of layout.sites) {
    if ('plate' in site) {
      const item = await flexLabware(records, ctx, plates.get(site.plate) as PlanPlate, refuse);
      labware.push({ ...item, slot: site.slot });
      deck.push({ slot: site.slot, holds: item.label });
      continue;
    }
    const rack = await records.getVersion(ctx, site.tipRack.id, site.tipRack.version);
    const r = rack.snapshot.attributes as LabwareTypeAttributes;
    if (!r.opentronsLoadName?.startsWith('opentrons_flex_96_'))
      throw refuse(`${rack.snapshot.label} (${site.slot}) is not an Opentrons Flex tip rack`);
    if (r.maxVolume && microlitres(r.maxVolume) > setup.maxTip)
      throw refuse(`The ${setup.model} doesn't take ${rack.snapshot.label} (${site.slot})`);
    tipRacks.push({ loadName: r.opentronsLoadName, slot: site.slot });
    deck.push({ slot: site.slot, holds: rack.snapshot.label });
  }
  deck.push({
    slot: layout.trash.slot,
    holds: layout.trash.kind === 'trash_bin' ? 'Trash bin' : 'Waste chute',
  });
  const newTips = groupTips(a, group);
  const order = (slot: string) => FLEX_SLOTS.indexOf(slot as (typeof FLEX_SLOTS)[number]);

  return {
    request: {
      name: `${plan.name} v${plan.version} ${group.id}`,
      description: `${group.label}. From transfer plan ${plan.name} version ${plan.version}, group ${group.id}, on ${setup.instrument.label} with the ${setup.model} (${setup.mount} mount).`,
      pipette: {
        loadName: setup.pipette,
        mount: setup.mount,
        nozzles: setup.pipette.startsWith('flex_8channel') ? 'single' : 'all',
      },
      trash:
        layout.trash.kind === 'trash_bin'
          ? { kind: 'trash_bin', slot: layout.trash.slot }
          : { kind: 'waste_chute' },
      tipRacks,
      labware,
      transfers: group.transfers.map((t, i) => ({
        from: { labware: t.from.plate, well: t.from.well },
        to: { labware: t.to.plate, well: t.to.well },
        volume: microlitres(t.volume),
        newTip: newTips[i] as boolean,
      })),
    },
    deck: deck.sort((x, y) => order(x.slot) - order(y.slot)),
    tips: newTips.filter(Boolean).length,
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
