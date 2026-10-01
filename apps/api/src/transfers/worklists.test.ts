import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allWells, tipChanges } from '@ailab/domain';
import type {
  Actor,
  Readiness,
  RecordEnvelope,
  TransferGroup,
  TransferPlanAttributes,
  WorklistFormatAttributes,
} from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { instrumentKinds } from '../instruments/kinds.ts';
import { inventoryKinds } from '../inventory/kinds.ts';
import { labwareKinds } from '../labware/kinds.ts';
import {
  ActivityBus,
  createRegistry,
  type OperationError,
  type OperationRegistry,
} from '../operations/index.ts';
import { plateMapKinds } from '../platemaps/kinds.ts';
import { reagentKinds } from '../reagents/kinds.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { transferKinds } from './kinds.ts';
import { groupTips, tipClashes, tipsOf } from './rules.ts';
import {
  formatProblems,
  namedWell,
  type WorklistPlate,
  type WorklistTransfer,
  writeWorklist,
} from './worklists.ts';

/** The mock worklists in seed/worklists (plan 016 T1): each is a golden file for its format. */
const mock = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../../seed/worklists/${name}`, import.meta.url)),
    'utf8',
  );

const uL = (value: string) => ({ value, unit: 'uL' });
const nL = (value: string) => ({ value, unit: 'nL' });

type Format = Pick<WorklistFormatAttributes, 'layout' | 'volumeUnit' | 'tips'>;

const STAR: Format = {
  volumeUnit: 'uL',
  tips: 'column',
  layout: {
    layout: 'rows',
    columns: [
      { header: 'Step', value: 'row_number' },
      { header: 'SourceLabware', value: 'source_labware' },
      { header: 'SourceBarcode', value: 'source_barcode' },
      { header: 'SourcePosition', value: 'source_well', wells: 'index_by_column' },
      { header: 'TargetLabware', value: 'destination_labware' },
      { header: 'TargetBarcode', value: 'destination_barcode' },
      { header: 'TargetPosition', value: 'destination_well' },
      { header: 'Volume', value: 'volume' },
      { header: 'LiquidClass', value: 'liquid_class' },
      { header: 'TipType', value: 'constant', text: '1000uL_Filter' },
      { header: 'NewTip', value: 'new_tip' },
    ],
  },
};

const plate = (p: Partial<WorklistPlate> & Pick<WorklistPlate, 'rows' | 'columns'>) => ({
  name: 'plate',
  barcode: '',
  labware: '',
  type: '',
  ...p,
});

describe('the generic worklist writer', () => {
  it('writes the Hamilton STAR mock: tube positions counted down columns, a tip per sample', () => {
    const rack = plate({ barcode: 'BOX-000012', labware: 'Rack_Tubes_1.5mL', rows: 4, columns: 6 });
    const elisa = plate({
      barcode: 'PLT-000301',
      labware: 'Plate_Thermo_442404',
      rows: 8,
      columns: 12,
    });
    const moves = ['A', 'B', 'C', 'D'].flatMap((row) =>
      ['3', '4'].map((column) => ({ from: `${row}1`, to: `${row}${column}` })),
    );
    const tips = tipChanges(
      moves.map((m) => ({ source: m.from })),
      'per_source',
    );
    const transfers: WorklistTransfer[] = moves.map((m, i) => ({
      source: rack,
      sourceWell: m.from,
      destination: elisa,
      destinationWell: m.to,
      volume: uL('100'),
      newTip: tips[i] as boolean,
      liquidClass: 'HighVolume_Water_DispenseJet_Empty',
      liquid: 'Sample',
    }));
    expect(formatProblems(STAR)).toEqual([]);
    expect(writeWorklist(STAR, transfers)).toEqual([
      { part: '', text: mock('hamilton-star-worklist.csv'), rows: 8 },
    ]);
  });

  it('writes the Hamilton Vantage mock, converting the volume to its unit', () => {
    const format: Format = {
      volumeUnit: 'uL',
      tips: 'new_each',
      layout: {
        layout: 'rows',
        columns: [
          { header: 'SourceRack', value: 'source_labware' },
          { header: 'SourceBarcode', value: 'source_barcode' },
          { header: 'SourceWell', value: 'source_well', wells: 'index_by_row' },
          { header: 'DestRack', value: 'destination_labware' },
          { header: 'DestBarcode', value: 'destination_barcode' },
          { header: 'DestWell', value: 'destination_well' },
          { header: 'Volume_uL', value: 'volume' },
          { header: 'LiquidClass', value: 'liquid_class' },
        ],
      },
    };
    const reservoir = plate({
      barcode: 'RES-000004',
      labware: 'Reservoir_300mL',
      rows: 1,
      columns: 1,
    });
    const assay = plate({
      barcode: 'PLT-000201',
      labware: 'Plate_Corning_3570',
      rows: 16,
      columns: 24,
    });
    const transfers = ['A1', 'B1', 'C1', 'D1'].map((well) => ({
      source: reservoir,
      sourceWell: 'A1',
      destination: assay,
      destinationWell: well,
      volume: nL('20000'),
      newTip: true,
      liquidClass: 'StandardVolume_Water_DispenseJet_Empty',
      liquid: 'Medium',
    }));
    expect(formatProblems(format)).toEqual([]);
    expect(writeWorklist(format, transfers)).toEqual([
      { part: '', text: mock('hamilton-vantage-worklist.csv'), rows: 4 },
    ]);
  });

  it('writes the Mantis mock: one volume grid per plate and reagent, empty wells as 0', () => {
    const format: Format = {
      volumeUnit: 'uL',
      tips: 'none',
      layout: {
        layout: 'grid',
        preamble: [
          { header: 'Reagent', value: 'liquid' },
          { header: 'Plate type', value: 'destination_type' },
          { header: 'Chip', value: 'constant', text: 'HV' },
          { header: 'Units', value: 'volume_unit' },
        ],
        empty: '0',
      },
    };
    const cells = plate({ name: 'Cells', rows: 1, columns: 1 });
    const assay = plate({ name: 'Assay plate 1', type: 'Corning 3570', rows: 16, columns: 24 });
    const transfers = allWells({ rows: 16, columns: 24 })
      .filter((w) => !w.endsWith('24'))
      .map((well) => ({
        source: cells,
        sourceWell: 'A1',
        destination: assay,
        destinationWell: well,
        volume: uL('25'),
        newTip: false,
        liquidClass: '',
        liquid: 'HEK293 cell suspension (2e5 cells/mL)',
      }));
    expect(formatProblems(format)).toEqual([]);
    expect(writeWorklist(format, transfers)).toEqual([
      { part: 'Assay plate 1 Cells A1', text: mock('mantis-dispense-grid.csv'), rows: 368 },
    ]);
  });

  it('writes the PreciseDrop mock: a well list by plate barcode', () => {
    const format: Format = {
      volumeUnit: 'uL',
      tips: 'none',
      layout: {
        layout: 'rows',
        columns: [
          { header: 'Plate', value: 'destination_barcode' },
          { header: 'Well', value: 'destination_well' },
          { header: 'Reagent', value: 'liquid' },
          { header: 'Volume (uL)', value: 'volume' },
        ],
      },
    };
    const ctg = plate({ name: 'CellTiter-Glo', rows: 1, columns: 1 });
    const assay = plate({ barcode: 'PLT-000401', rows: 8, columns: 12 });
    const transfers = allWells({ rows: 8, columns: 12 }).map((well) => ({
      source: ctg,
      sourceWell: 'A1',
      destination: assay,
      destinationWell: well,
      volume: { value: '0.025', unit: 'mL' },
      newTip: false,
      liquidClass: '',
      liquid: 'CellTiter-Glo 2.0',
    }));
    expect(writeWorklist(format, transfers)).toEqual([
      { part: '', text: mock('precisedrop-dispense-list.csv'), rows: 96 },
    ]);
  });

  it('names wells by position and quotes cells that need it', () => {
    const p = plate({ rows: 8, columns: 12 });
    expect(namedWell('B1', p, 'index_by_column')).toBe('2');
    expect(namedWell('B1', p, 'index_by_row')).toBe('13');
    expect(namedWell('H12', p, 'index_by_column')).toBe('96');
    expect(namedWell('H12', p)).toBe('H12');
    const [file] = writeWorklist(
      {
        volumeUnit: 'uL',
        layout: { layout: 'rows', columns: [{ header: 'Note', value: 'liquid' }] },
      },
      [
        {
          source: p,
          sourceWell: 'A1',
          destination: p,
          destinationWell: 'A2',
          volume: uL('1'),
          newTip: true,
          liquidClass: '',
          liquid: 'Buffer, "B"',
        },
      ],
    );
    expect(file?.text).toBe('Note\n"Buffer, ""B"""\n');
  });

  it('says what makes a format unwritable', () => {
    expect(
      formatProblems({
        tips: 'column',
        layout: {
          layout: 'rows',
          columns: [
            { header: 'A', value: 'constant' },
            { header: 'A', value: 'volume', wells: 'index_by_row' },
          ],
        },
      }),
    ).toEqual([
      'The header A is given twice',
      'A: a constant needs its text',
      'A: well naming is for well columns only',
      'A rows format needs a destination well column',
      'The method takes tips as the file says, but the file has no new tip column',
    ]);
    expect(
      formatProblems({
        tips: 'column',
        layout: { layout: 'grid', preamble: [{ header: 'Well', value: 'source_well' }], empty: '' },
      }),
    ).toEqual([
      "Well: a grid's preamble holds one value per grid, not per well",
      'A grid has no new tip column',
    ]);
  });
});

describe("a method's tip handling (T5)", () => {
  const move = (from: string, to: string) => ({
    from: { plate: 'src', well: from },
    to: { plate: 'dest', well: to },
    volume: { value: '10', unit: 'uL' as const },
  });
  const buffer: TransferGroup = {
    id: 'buffer',
    label: 'Buffer',
    method: 'reagent_addition',
    reason: 'first',
    transfers: [move('A1', 'A1')],
  };
  const samples: TransferGroup = {
    id: 'samples',
    label: 'Samples',
    method: 'reagent_addition',
    reason: 'then',
    tips: 'new_each',
    transfers: [move('B1', 'A1'), move('B1', 'A2'), move('B1', 'A3')],
  };
  const a = { plates: [], groups: [buffer, samples] } as unknown as TransferPlanAttributes;

  it('counts tips as the method takes them, else by the group rule', () => {
    expect(groupTips(a, samples)).toEqual([true, true, true]);
    expect(groupTips(a, samples, 'per_source')).toEqual([true, false, false]);
    expect(groupTips(a, samples, 'none')).toEqual([false, false, false]);
    expect(groupTips(a, samples, 'column')).toEqual([true, true, true]);
    expect(tipsOf(a)).toBe(4);
    expect(tipsOf(a, new Map([['samples', 'none']]))).toBe(1);
  });

  it('warns when a method carries a tip on from liquid, or ignores the group rule', () => {
    expect(tipClashes(a, samples, 'per_source', 'STAR samples')).toEqual([
      "Samples: STAR samples keeps one tip per source, not the group's rule (new each)",
      'Samples: STAR samples keeps one tip per source, and 1 transfer reuses a tip that touched liquid already in a well',
    ]);
    expect(tipClashes(a, samples, 'new_each', 'STAR samples')).toEqual([]);
    expect(tipClashes(a, buffer, 'none', 'Mantis')).toEqual([]);
    expect(tipClashes(a, samples, 'column', 'STAR samples')).toEqual([]);
  });
});

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  const kinds = new KindRegistry();
  for (const kind of [
    ...labwareKinds,
    ...instrumentKinds,
    ...reagentKinds,
    ...inventoryKinds,
    ...transferKinds,
    ...plateMapKinds,
    ...fileKinds,
  ]) {
    kinds.register(kind);
  }
  registry = createRegistry(db, kinds, new ActivityBus());
});
afterEach(() => close());

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status !== 'done') throw new Error(`${id} was ${result.status}`);
  return result.output as T;
}

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  return error as OperationError;
}

const mm = (value: string) => ({ value, unit: 'mm' });
const create = (label: string, kind: string, attributes: unknown) =>
  run<RecordEnvelope>(person, 'records.create', { kind, label, attributes });
const confirm = (r: RecordEnvelope) =>
  run<RecordEnvelope>(person, 'records.confirm', { id: r.id, expectedVersion: r.version });
const pin = (r: RecordEnvelope) => ({ id: r.id, version: r.version });
const sbs = { length: mm('127.76'), width: mm('85.48'), height: mm('14.2'), sbs: true };

/** A Hamilton STAR, a tube rack and a plate with their Hamilton labware names. */
async function lab() {
  const starKind = await confirm(
    await create('Hamilton STAR', 'instrument_kind', {
      model: 'Microlab STAR',
      category: 'liquid_handler',
      performedBy: 'machine',
      capabilities: [
        {
          capability: 'transfer',
          limits: { volume: { min: uL('1'), max: uL('1000') }, channels: [1, 8] },
        },
      ],
    }),
  );
  const echoKind = await confirm(
    await create('Echo 650', 'instrument_kind', {
      model: 'Echo 650',
      category: 'acoustic_dispenser',
      performedBy: 'machine',
      capabilities: [
        {
          capability: 'transfer',
          limits: { volume: { min: nL('2.5'), max: uL('10') }, volumeStep: nL('2.5') },
        },
      ],
    }),
  );
  const star = await confirm(
    await run<RecordEnvelope>(person, 'instruments.register', {
      label: 'STAR 1',
      kind: starKind.id,
    }),
  );
  const rack = await confirm(
    await create('1.5 mL tube rack', 'labware_type', {
      family: 'rack',
      footprint: sbs,
      wells: { layout: 'grid', rows: 4, columns: 6 },
      maxVolume: uL('1500'),
      hamiltonLabware: 'Rack_Tubes_1.5mL',
    }),
  );
  const elisa = await confirm(
    await create('Thermo 442404', 'labware_type', {
      family: 'plate',
      footprint: sbs,
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: uL('400'),
      hamiltonLabware: 'Plate_Thermo_442404',
    }),
  );
  const { containers } = await run<{ containers: RecordEnvelope[] }>(
    person,
    'inventory.register_containers',
    { labwareType: rack.id, containers: [{}] },
  );
  return { starKind, echoKind, star, rack, elisa, tubes: containers[0] as RecordEnvelope };
}

const upload = async (name: string, text: string) =>
  (
    await run<{ file: RecordEnvelope }>(agent, 'files.upload', {
      name,
      mediaType: 'text/csv',
      text,
    })
  ).file;

describe('worklists.draft_format', () => {
  it('drafts a format from an example file, checking its headers', async () => {
    const { starKind, echoKind } = await lab();
    const example = await upload('star example.csv', mock('hamilton-star-worklist.csv'));
    const format = await run<RecordEnvelope>(agent, 'worklists.draft_format', {
      label: 'STAR ELISA samples',
      instrumentKind: starKind.id,
      method: 'Venus ELISA sample transfer',
      example: example.id,
      ...STAR,
    });
    expect(format).toMatchObject({ kind: 'worklist_format', name: 'WLF-0001', status: 'draft' });
    expect(format.attributes).toMatchObject({ example: example.id, tips: 'column' });

    const swapped = await refused(
      run(agent, 'worklists.draft_format', {
        label: 'Wrong',
        instrumentKind: starKind.id,
        method: 'Venus',
        example: example.id,
        ...STAR,
        layout: {
          layout: 'rows',
          columns: [
            { header: 'Step', value: 'row_number' },
            { header: 'SourceBarcode', value: 'source_barcode' },
          ],
        },
      }),
    );
    expect(swapped).toMatchObject({ code: 'invalid_input' });
    expect(swapped.message).toBe(
      `The columns don't match star example.csv: Header 2 is "SourceLabware" in the example, not "SourceBarcode"`,
    );

    const unwritable = await refused(
      run(agent, 'worklists.draft_format', {
        label: 'No tips',
        instrumentKind: starKind.id,
        method: 'Venus',
        ...STAR,
        tips: 'none',
      }),
    );
    expect(unwritable.message).toContain('the method takes tips as the file says (tips: column)');

    const grid = await refused(
      run(agent, 'worklists.draft_format', {
        label: 'Grid',
        instrumentKind: echoKind.id,
        method: 'Mantis',
        example: example.id,
        volumeUnit: 'uL',
        tips: 'none',
        layout: { layout: 'grid', preamble: [{ header: 'Reagent', value: 'liquid' }], empty: '0' },
      }),
    );
    expect(grid.message).toContain('Header 1 is "Step" in the example, not "Reagent"');

    const hidden = await refused(
      run(otherLab, 'worklists.draft_format', {
        label: 'Theirs',
        instrumentKind: starKind.id,
        method: 'Venus',
        ...STAR,
      }),
    );
    expect(hidden.message).toContain('is not an instrument kind in this lab');
  });

  it("writes a STAR group's worklist from the plan, once the format is confirmed", async () => {
    const { starKind, echoKind, star, rack, elisa, tubes } = await lab();
    const format = await run<RecordEnvelope>(agent, 'worklists.draft_format', {
      label: 'STAR ELISA samples',
      instrumentKind: starKind.id,
      method: 'Venus ELISA sample transfer',
      ...STAR,
    });
    const move = (from: string, to: string) => ({
      from: { plate: 'tubes', well: from },
      to: { plate: 'elisa', well: to },
      volume: uL('100'),
    });
    const draft = await run<RecordEnvelope>(agent, 'transfers.draft', {
      label: 'ELISA samples in duplicate',
      plates: [
        { id: 'tubes', role: 'source', labwareType: pin(rack), container: tubes.id },
        { id: 'elisa', label: 'ELISA plate', role: 'destination', labwareType: pin(elisa) },
      ],
      groups: [
        {
          id: 'samples',
          label: 'Samples in duplicate',
          method: 'reagent_addition',
          reason: 'The STAR runs the lab method',
          instrument: { instrument: star.id },
          tips: 'per_source',
          transfers: [move('A1', 'A3'), move('A1', 'A4'), move('B1', 'B3'), move('B1', 'B4')],
        },
      ],
    });
    const pinned = await run<RecordEnvelope>(agent, 'transfers.set_instrument', {
      id: draft.id,
      expectedVersion: draft.version,
      group: 'samples',
      instrument: { instrument: star.id },
      why: 'The STAR runs the lab method',
      tips: 'per_source',
      worklist: pin(format),
    });
    const blocked = await run<Readiness>(person, 'records.readiness', { id: pinned.id });
    expect(blocked.checks.find((c) => c.id === 'inputs_confirmed')?.message).toBe(
      'Samples in duplicate: WLF-0001 v1 was not confirmed',
    );

    // A format for another instrument kind is a blocker too.
    const echoFormat = await confirm(
      await run<RecordEnvelope>(agent, 'worklists.draft_format', {
        label: 'Echo list',
        instrumentKind: echoKind.id,
        method: 'Echo',
        ...STAR,
      }),
    );
    const wrong = await run<RecordEnvelope>(agent, 'transfers.set_instrument', {
      id: pinned.id,
      expectedVersion: pinned.version,
      group: 'samples',
      instrument: { instrument: star.id },
      why: 'The STAR runs the lab method',
      tips: 'per_source',
      worklist: pin(echoFormat),
    });
    const { checks } = await run<Readiness>(person, 'records.readiness', { id: wrong.id });
    const fits = checks.find((c) => c.id === 'worklists_fit');
    expect(fits).toMatchObject({ passed: false });
    expect(fits?.message).toBe('Samples in duplicate: WLF-0002 is read by Echo 650, not by STAR 1');

    const confirmedFormat = await confirm(format);
    const ready = await run<RecordEnvelope>(agent, 'transfers.set_instrument', {
      id: wrong.id,
      expectedVersion: wrong.version,
      group: 'samples',
      instrument: { instrument: star.id },
      why: 'The STAR runs the lab method',
      tips: 'per_source',
      worklist: pin(confirmedFormat),
    });
    const plan = await confirm(ready);
    expect(plan.status).toBe('active');
    const out = await run<{
      files: { format: string; file: RecordEnvelope; filename: string; rows: number }[];
      skipped: unknown[];
    }>(agent, 'transfers.export', { id: plan.id });
    expect(out.skipped).toEqual([]);
    expect(out.files).toMatchObject([
      {
        format: 'worklist',
        filename: `TFP-0001 v${plan.version} samples STAR ELISA samples.csv`,
        rows: 4,
      },
    ]);
    const { text } = await run<{ text: string }>(agent, 'files.get', {
      id: out.files[0]?.file.id,
    });
    expect(text).toBe(
      [
        STAR.layout.layout === 'rows' ? STAR.layout.columns.map((c) => c.header).join(',') : '',
        `1,Rack_Tubes_1.5mL,${tubes.name},1,Plate_Thermo_442404,,A3,100,,1000uL_Filter,1`,
        `2,Rack_Tubes_1.5mL,${tubes.name},1,Plate_Thermo_442404,,A4,100,,1000uL_Filter,0`,
        `3,Rack_Tubes_1.5mL,${tubes.name},2,Plate_Thermo_442404,,B3,100,,1000uL_Filter,1`,
        `4,Rack_Tubes_1.5mL,${tubes.name},2,Plate_Thermo_442404,,B4,100,,1000uL_Filter,0`,
        '',
      ].join('\n'),
    );
  });

  it('skips a group on an instrument with no worklist format, saying how to add one', async () => {
    const { star, rack, elisa, tubes } = await lab();
    const plan = await confirm(
      await run<RecordEnvelope>(agent, 'transfers.draft', {
        label: 'No format',
        plates: [
          { id: 'tubes', role: 'source', labwareType: pin(rack), container: tubes.id },
          { id: 'elisa', role: 'destination', labwareType: pin(elisa) },
        ],
        groups: [
          {
            id: 'samples',
            label: 'Samples',
            method: 'reagent_addition',
            reason: 'STAR',
            instrument: { instrument: star.id },
            transfers: [
              {
                from: { plate: 'tubes', well: 'A1' },
                to: { plate: 'elisa', well: 'A1' },
                volume: uL('100'),
              },
            ],
          },
        ],
      }),
    );
    const out = await run<{ skipped: { why: string }[] }>(agent, 'transfers.export', {
      id: plan.id,
    });
    expect(out.skipped[0]?.why).toContain('No worklist format for STAR 1');
  });
});
