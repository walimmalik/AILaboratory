import { convert } from '@ailab/domain';
import {
  type InstrumentAttributes,
  type InstrumentKindAttributes,
  type LabwareTypeAttributes,
  type LiquidClassAttributes,
  type PlanPlate,
  type ProtocolCheck,
  type RecordEnvelope,
  type TransferGroup,
  type TransferPlanAttributes,
  transfersExport,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { run } from './calculators.ts';
import { isFlex } from './decks.ts';
import { type EchoPlate, echoPickList } from './echo.ts';
import { flexRequest } from './opentrons.ts';

/**
 * Instrument files from confirmed transfer plans (plan 016b): Echo pick lists, and Opentrons Flex
 * protocols checked in Opentrons' simulator. The lab's own CSV formats follow (016c).
 */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

/** Trailing zeros off a decimal string: "25.000" reads "25". */
const plain = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

export async function instrumentKindOf(deps: OperationDeps, ctx: RecordContext, id: string) {
  const records = service(deps);
  const instrument = await records.get(ctx, id);
  const kind = await records.get(ctx, (instrument.attributes as InstrumentAttributes).kind);
  return { instrument, kind: kind.attributes as InstrumentKindAttributes };
}

/** The Echo names of the plan's plates for one group, refused with what to fix. */
async function echoPlates(
  deps: OperationDeps,
  ctx: RecordContext,
  a: TransferPlanAttributes,
  group: TransferGroup,
): Promise<{ source: Map<string, EchoPlate>; destination: Map<string, EchoPlate> }> {
  const records = service(deps);
  const plates = new Map(a.plates.map((p) => [p.id, p]));
  const classType = group.liquidClass
    ? ((await records.get(ctx, group.liquidClass)).attributes as LiquidClassAttributes).platformName
    : undefined;
  const named = async (p: PlanPlate) => {
    const type = await records.getVersion(ctx, p.labwareType.id, p.labwareType.version);
    const barcode = p.container ? (await records.get(ctx, p.container)).name : '';
    return {
      name: p.label ?? p.id,
      barcode,
      typeName: type.snapshot.name,
      echo: (type.snapshot.attributes as LabwareTypeAttributes).echoPlateTypes ?? [],
    };
  };
  const source = new Map<string, EchoPlate>();
  const destination = new Map<string, EchoPlate>();
  for (const id of new Set(group.transfers.map((t) => t.from.plate))) {
    const p = await named(plates.get(id) as PlanPlate);
    let type: string;
    if (classType) {
      if (p.echo.length && !p.echo.includes(classType))
        throw new OperationError(
          'invalid_state',
          `${group.label}: the liquid class is ${classType}, which ${p.typeName} (plate ${id}) does not list among its Echo types (${p.echo.join(', ')})`,
        );
      type = classType;
    } else if (p.echo.length === 1) {
      type = p.echo[0] as string;
    } else {
      throw new OperationError(
        'invalid_state',
        p.echo.length
          ? `${group.label}: ${p.typeName} (plate ${id}) has more than one Echo type (${p.echo.join(', ')}); set the group's liquid class with transfers.set_instrument`
          : `${group.label}: ${p.typeName} (plate ${id}) has no Echo plate type; add it to the labware type's echoPlateTypes or set the group's liquid class`,
      );
    }
    source.set(id, { name: p.name, barcode: p.barcode, type });
  }
  for (const id of new Set(group.transfers.map((t) => t.to.plate))) {
    const p = await named(plates.get(id) as PlanPlate);
    if (!p.echo.length)
      throw new OperationError(
        'invalid_state',
        `${group.label}: ${p.typeName} (plate ${id}) has no Echo plate type; add it to the labware type's echoPlateTypes`,
      );
    destination.set(id, { name: p.name, barcode: p.barcode, type: p.echo[0] as string });
  }
  return { source, destination };
}

export const exportOperations = [
  implement(transfersExport, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      const plan = await service(deps)
        .get(ctx, input.id)
        .catch(() => undefined);
      if (plan?.kind !== 'transfer_plan')
        throw new OperationError('not_found', `${input.id} is not a transfer plan in this lab`);
      if (plan.status !== 'active')
        throw new OperationError(
          'invalid_state',
          `${plan.name} is not confirmed; instrument files are written from confirmed plans only`,
        );
      const a = plan.attributes as TransferPlanAttributes;
      const groups = input.group ? a.groups.filter((g) => g.id === input.group) : a.groups;
      if (input.group && !groups.length)
        throw new OperationError('invalid_input', `${plan.name} has no group ${input.group}`);

      const files: {
        group: string;
        format: 'echo_pick_list' | 'opentrons_protocol';
        file: RecordEnvelope;
        filename: string;
        rows: number;
        check?: ProtocolCheck;
        deck?: { slot: string; holds: string }[];
      }[] = [];
      const skipped: { group: string; why: string }[] = [];
      const upload = (name: string, mediaType: string, text: string, what: string) =>
        run<{ file: RecordEnvelope }>(deps, ctx, 'files.upload', {
          name,
          mediaType,
          text,
          source: { from: 'export', record: plan.id, version: plan.version },
          reason: `${what}, from ${plan.name} version ${plan.version}`,
        });
      for (const group of groups) {
        if (!group.instrument) {
          skipped.push({ group: group.id, why: 'Done by hand; no instrument file' });
          continue;
        }
        const { instrument, kind } = await instrumentKindOf(deps, ctx, group.instrument.instrument);
        if (isFlex(kind)) {
          // A group that can't be written is skipped with why, or refused when asked for alone.
          const cannot = (why: string) => {
            if (input.group) throw new OperationError('invalid_state', `${group.label}: ${why}`);
            skipped.push({ group: group.id, why });
          };
          let flex: Awaited<ReturnType<typeof flexRequest>>;
          try {
            flex = await flexRequest(deps, ctx, plan, group);
          } catch (e) {
            if (!(e instanceof OperationError) || e.code !== 'invalid_state') throw e;
            cannot(e.message);
            continue;
          }
          const { protocol, check } = await deps.protocols.flex(flex.request);
          if (!check.ok) {
            cannot(
              `The Opentrons simulator stopped the protocol: ${check.problem ?? 'no reason given'}`,
            );
            continue;
          }
          const filename = `${plan.name} v${plan.version} ${group.id} Opentrons protocol.py`;
          const { file } = await upload(
            filename,
            'text/x-python',
            protocol,
            `Opentrons protocol for ${group.label}`,
          );
          files.push({
            group: group.id,
            format: 'opentrons_protocol',
            file,
            filename,
            rows: group.transfers.length,
            check,
            deck: flex.deck,
          });
          continue;
        }
        if (kind.category !== 'acoustic_dispenser') {
          skipped.push({
            group: group.id,
            why: `No file writer for ${instrument.label} yet`,
          });
          continue;
        }
        const plates = await echoPlates(deps, ctx, a, group);
        const csv = echoPickList(
          group.transfers.map((t) => ({
            source: plates.source.get(t.from.plate) as EchoPlate,
            sourceWell: t.from.well,
            volume: plain(convert(t.volume, 'nL').value),
            destination: plates.destination.get(t.to.plate) as EchoPlate,
            destinationWell: t.to.well,
          })),
        );
        const filename = `${plan.name} v${plan.version} ${group.id} Echo pick list.csv`;
        const { file } = await upload(
          filename,
          'text/csv',
          csv,
          `Echo pick list for ${group.label}`,
        );
        files.push({
          group: group.id,
          format: 'echo_pick_list',
          file,
          filename,
          rows: group.transfers.length,
        });
      }
      if (input.group && !files.length)
        throw new OperationError('invalid_input', skipped[0]?.why ?? 'Nothing to write');
      return {
        plan: { id: plan.id, name: plan.name, version: plan.version },
        files,
        skipped,
      };
    },
  }),
];
