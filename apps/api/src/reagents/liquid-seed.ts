import {
  DispenseMode,
  type EvidenceInput,
  HamiltonParameters,
  LiquidVolume,
  OpentronsTransferProperties,
  type RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/**
 * Turns `seed/liquid-classes.yaml` into liquid class drafts (plan 009b, R12): Opentrons' own class
 * files for the lab's pipettes and tip racks, Hamilton's defaults for its tips, and the Echo's
 * calibrations. Every class is a vendor default. References are keys in the other seed files.
 */

const Key = z.string().min(1);

const Index = z.strictObject({
  opentrons: z.strictObject({
    instrumentKind: Key,
    liquids: z.array(z.strictObject({ file: Key, liquidType: Key })),
    pipettes: z.record(z.string(), Key),
    tipracks: z.record(z.string(), Key),
  }),
  hamilton: Key,
  echo: z.strictObject({
    instrumentKind: Key,
    droplet: LiquidVolume,
    classes: z.array(
      z.strictObject({
        name: Key,
        calibration: Key,
        sourceLabware: Key,
        liquidType: Key,
        note: z.string().min(1).optional(),
      }),
    ),
  }),
});

const OpentronsFile = z.looseObject({
  liquidClassName: Key,
  displayName: Key,
  byPipette: z.array(
    z.strictObject({
      pipetteModel: Key,
      byTipType: z.array(OpentronsTransferProperties.extend({ tiprack: Key }).strict()),
    }),
  ),
});

const HamiltonFile = z.strictObject({
  classes: z.array(
    z.strictObject({
      key: Key,
      label: Key,
      instrumentKind: Key,
      device: Key,
      tips: z.array(Key),
      mode: DispenseMode,
      volume: z.strictObject({ min: LiquidVolume, max: LiquidVolume }),
      liquidType: Key,
      platformName: Key,
      settings: z.strictObject({
        system: z.enum(['star', 'vantage']),
        tipVolume: LiquidVolume,
        core: z.boolean(),
        needle: z.boolean(),
        filter: z.boolean(),
        parameters: HamiltonParameters,
      }),
    }),
  ),
});

/** A class ready to load; references are seed keys, looked up by `refs` when loading. */
export interface SeedClass {
  label: string;
  refs: {
    instrumentKind: string;
    device?: string;
    tips?: string[];
    sourceLabware?: string;
    liquidType: string;
  };
  attributes: Record<string, unknown>;
  evidence: EvidenceInput;
}

export interface SeedLiquidClasses {
  classes: SeedClass[];
  /** Seed key to the label its record has, per kind. */
  labels: {
    instrument_kind: Map<string, string>;
    equipment_kind: Map<string, string>;
    labware_type: Map<string, string>;
    liquid_type: Map<string, string>;
  };
}

const OPENTRONS_SOURCE =
  'https://github.com/Opentrons/opentrons/tree/edge/shared-data/liquid-class/definitions/1';
const HAMILTON_SOURCE =
  'https://github.com/PyLabRobot/pylabrobot/tree/main/pylabrobot/hamilton (liquid_classes/mapping.py)';

/** Reads the index and the files it names, refusing keys the other seed files don't have. */
export function readSeedLiquidClasses(files: {
  index: string;
  opentrons: Record<string, string>;
  hamilton: string;
  instrumentLibrary: string;
  labware: string;
  reagentLibrary: string;
}): SeedLiquidClasses {
  const index = Index.parse(parse(files.index));
  const keyed = (items: { key: string; label?: string; name?: string }[]) =>
    new Map(items.map((i) => [i.key, (i.label ?? i.name) as string]));
  const library = parse(files.instrumentLibrary) as {
    instrument_kinds: { key: string; label: string }[];
    equipment_kinds: { key: string; label: string }[];
  };
  const labels: SeedLiquidClasses['labels'] = {
    instrument_kind: keyed(library.instrument_kinds),
    equipment_kind: keyed(library.equipment_kinds),
    labware_type: keyed((parse(files.labware) as { kinds: { key: string; name: string }[] }).kinds),
    liquid_type: keyed(
      (parse(files.reagentLibrary) as { liquid_types: { key: string; label: string }[] })
        .liquid_types,
    ),
  };
  const classes: SeedClass[] = [];

  const ot = index.opentrons;
  for (const liquid of ot.liquids) {
    const text = files.opentrons[liquid.file];
    if (!text) throw new Error(`liquid-classes/opentrons/${liquid.file} is missing`);
    const file = OpentronsFile.parse(JSON.parse(text));
    for (const pipette of file.byPipette) {
      const device = ot.pipettes[pipette.pipetteModel];
      if (!device) continue;
      for (const { tiprack, ...properties } of pipette.byTipType) {
        const tip = ot.tipracks[tiprack];
        if (!tip) continue;
        const pipetteLabel = labels.equipment_kind.get(device) ?? device;
        const tipLabel = tiprack.split('/')[1]?.replace('opentrons_flex_96_', '') ?? tiprack;
        classes.push({
          label: `Opentrons ${file.liquidClassName}, ${pipetteLabel}, ${tipLabel}`,
          refs: {
            instrumentKind: ot.instrumentKind,
            device,
            tips: [tip],
            liquidType: liquid.liquidType,
          },
          attributes: {
            labDefault: true,
            platformName: file.liquidClassName,
            origin: 'vendor_default',
            settings: {
              platform: 'opentrons',
              pipetteModel: pipette.pipetteModel,
              tiprack,
              properties,
            },
            notes: `Opentrons' built-in "${file.displayName}" class.`,
          },
          evidence: {
            source: 'imported',
            reference: `${OPENTRONS_SOURCE}/${file.liquidClassName}/1.json`,
          },
        });
      }
    }
  }

  for (const c of HamiltonFile.parse(parse(files.hamilton)).classes) {
    classes.push({
      label: c.label,
      refs: {
        instrumentKind: c.instrumentKind,
        device: c.device,
        tips: c.tips,
        liquidType: c.liquidType,
      },
      attributes: {
        mode: c.mode,
        volume: c.volume,
        labDefault: true,
        platformName: c.platformName,
        origin: 'vendor_default',
        settings: {
          platform: 'hamilton',
          ...c.settings,
          reportedBy: 'hamilton_default',
          changedHere: false,
        },
      },
      evidence: { source: 'imported', reference: HAMILTON_SOURCE },
    });
  }

  for (const e of index.echo.classes) {
    classes.push({
      label: `Echo ${e.name}`,
      refs: {
        instrumentKind: index.echo.instrumentKind,
        sourceLabware: e.sourceLabware,
        liquidType: e.liquidType,
      },
      attributes: {
        volume: { min: index.echo.droplet },
        labDefault: true,
        platformName: e.name,
        origin: 'vendor_default',
        settings: { platform: 'echo', calibration: e.calibration },
        ...(e.note ? { notes: e.note } : {}),
      },
      evidence: { source: 'stated', note: 'Echo class names confirmed by Wali, 2026-09-29' },
    });
  }

  for (const c of classes) {
    const missing = [
      ['instrument_kind', c.refs.instrumentKind],
      ['equipment_kind', c.refs.device],
      ...(c.refs.tips ?? []).map((t) => ['labware_type', t]),
      ['labware_type', c.refs.sourceLabware],
      ['liquid_type', c.refs.liquidType],
    ].filter(([kind, key]) => key && !labels[kind as keyof typeof labels].has(key as string));
    if (missing.length > 0) {
      throw new Error(`${c.label}: no ${missing.map(([k, key]) => `${k} "${key}"`).join(', ')}`);
    }
  }
  return { classes, labels };
}

export interface LiquidClassSeedReport {
  created: string[];
  existing: string[];
  /** Classes whose instrument, device, tips or liquid type the lab doesn't have (yet). */
  skipped: string[];
}

/** Drafts the classes the lab doesn't have yet (matched by label), through records.create. */
export async function loadSeedLiquidClasses(
  registry: OperationRegistry,
  ctx: RecordContext,
  { classes, labels }: SeedLiquidClasses,
): Promise<LiquidClassSeedReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const find = async (kind: string, label: string) =>
    (
      await run<{ records: RecordEnvelope[] }>('records.list', { kind, search: label, limit: 20 })
    ).records.find((r) => r.label === label);
  const ids = new Map<string, string | undefined>();
  const idOf = async (kind: keyof typeof labels, key: string) => {
    const cacheKey = `${kind}/${key}`;
    if (!ids.has(cacheKey)) {
      ids.set(cacheKey, (await find(kind, labels[kind].get(key) as string))?.id);
    }
    return ids.get(cacheKey);
  };
  const report: LiquidClassSeedReport = { created: [], existing: [], skipped: [] };
  for (const c of classes) {
    if (await find('liquid_class', c.label)) {
      report.existing.push(c.label);
      continue;
    }
    const instrumentKind = await idOf('instrument_kind', c.refs.instrumentKind);
    const device = c.refs.device ? await idOf('equipment_kind', c.refs.device) : undefined;
    const tips = await Promise.all((c.refs.tips ?? []).map((t) => idOf('labware_type', t)));
    const sourceLabware = c.refs.sourceLabware
      ? await idOf('labware_type', c.refs.sourceLabware)
      : undefined;
    const liquidType = await idOf('liquid_type', c.refs.liquidType);
    if (
      !instrumentKind ||
      !liquidType ||
      (c.refs.device && !device) ||
      tips.some((t) => !t) ||
      (c.refs.sourceLabware && !sourceLabware)
    ) {
      report.skipped.push(c.label);
      continue;
    }
    const attributes = {
      instrumentKind,
      ...(device ? { device } : {}),
      ...(tips.length > 0 ? { tips } : {}),
      ...(sourceLabware ? { sourceLabware } : {}),
      liquidTypes: [liquidType],
      ...c.attributes,
    };
    const evidence = Object.fromEntries(Object.keys(attributes).map((k) => [k, c.evidence]));
    // Which liquid types a vendor class serves is our mapping, not the vendor's.
    evidence.liquidTypes = { source: 'assumed' } as EvidenceInput;
    const record = await run<RecordEnvelope>('records.create', {
      kind: 'liquid_class',
      label: c.label,
      attributes,
      evidence,
      reason: 'Imported from the seed lab: vendor default liquid classes',
    });
    report.created.push(`${record.name} ${c.label}`);
  }
  return report;
}
