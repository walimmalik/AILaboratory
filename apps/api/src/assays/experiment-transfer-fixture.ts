import type { Readiness, RecordEnvelope } from '@ailab/schema';

/** Operation-only, fictional data for exercising the experiment-to-Echo journey. */
export type FixtureRun = <T = RecordEnvelope>(
  actor: 'person' | 'agent',
  operation: string,
  input: unknown,
) => Promise<T>;

const uL = (value: string) => ({ value, unit: 'uL' });
export const FICTIONAL_TARGET = { value: '10', unit: 'uM' } as const;
export const FICTIONAL_STOCK = { value: '10', unit: 'mM' } as const;
export const FICTIONAL_FINAL_VOLUME = uL('25');

export async function confirmFixtureRecord(run: FixtureRun, record: RecordEnvelope) {
  if (record.status !== 'draft') return record;
  let current = record;
  const state = await run<Readiness>('person', 'records.readiness', { id: current.id });
  for (const section of state.sections) {
    if (section.state === 'confirmed') continue;
    current = await run('person', 'records.confirm_section', {
      id: current.id,
      expectedVersion: current.version,
      section: section.id,
    });
  }
  if (current.status === 'draft')
    current = await run('person', 'records.confirm', {
      id: current.id,
      expectedVersion: current.version,
    });
  return current;
}

export async function createFictionalTransferFixture(run: FixtureRun) {
  const create = (label: string, kind: string, attributes: unknown) =>
    run('person', 'records.create', { label, kind, attributes });
  const footprint = {
    length: { value: '127.76', unit: 'mm' },
    width: { value: '85.48', unit: 'mm' },
    height: { value: '14.4', unit: 'mm' },
    sbs: true,
  };
  const destinationType = await confirmFixtureRecord(
    run,
    await create('FICTIONAL Corning 3570 assay plate 384', 'labware_type', {
      family: 'plate',
      footprint: {
        length: { value: '127.8', unit: 'mm' },
        width: { value: '85.5', unit: 'mm' },
        height: { value: '14.2', unit: 'mm' },
        sbs: true,
      },
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: uL('112'),
      workingVolume: { min: uL('20'), max: uL('80') },
      echoPlateTypes: ['Corning_384_3570'],
    }),
  );
  const sourceType = await confirmFixtureRecord(
    run,
    await create('FICTIONAL Echo source 384PP', 'labware_type', {
      family: 'plate',
      footprint,
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: uL('65'),
      deadVolume: uL('15'),
      echoPlateTypes: ['384PP_DMSO2'],
    }),
  );
  const echoKind = await create('FICTIONAL Echo 650', 'instrument_kind', {
    model: 'Echo 650',
    category: 'acoustic_dispenser',
    performedBy: 'machine',
    capabilities: [
      {
        capability: 'transfer',
        limits: {
          volume: { min: { value: '2.5', unit: 'nL' }, max: uL('10') },
          volumeStep: { value: '2.5', unit: 'nL' },
        },
      },
    ],
  });
  const echo = await run('person', 'instruments.register', {
    label: 'FICTIONAL Echo 1',
    kind: echoKind.id,
  });
  const readerKind = await create('FICTIONAL plate reader', 'instrument_kind', {
    model: 'FICTIONAL endpoint reader',
    category: 'plate_reader',
    performedBy: 'machine',
    capabilities: [{ capability: 'read_absorbance' }],
  });
  const reader = await run('person', 'instruments.register', {
    label: 'FICTIONAL reader 1',
    kind: readerKind.id,
  });
  const kind = await run('agent', 'entities.draft_kind', {
    label: 'FICTIONAL compounds',
    attributes: { base: 'chemical', prefix: 'FCP', fields: [] },
  });
  const compounds = [] as RecordEnvelope[];
  for (const label of [
    'FICTIONAL Compound Alpha',
    'FICTIONAL Compound Beta',
    'FICTIONAL Positive Control',
  ])
    compounds.push(await run('agent', 'entities.draft', { label, entityKind: kind.id }));
  const samples = [] as RecordEnvelope[];
  for (const compound of compounds)
    samples.push(
      await run('person', 'samples.register', {
        label: `${compound.label} stock, FICTIONAL`,
        entity: compound.id,
        method: 'synthesis',
      }),
    );
  const { product: solventProduct } = await run<{ product: RecordEnvelope }>(
    'person',
    'reagents.draft_product',
    {
      label: 'FICTIONAL solvent',
      attributes: { category: 'solvent', origin: 'bought' },
    },
  );
  const solventLot = await run('person', 'reagents.receive_lot', {
    product: solventProduct.id,
    lotNumber: 'FICTIONAL-1',
  });
  const { containers } = await run<{ containers: RecordEnvelope[] }>(
    'person',
    'inventory.register_containers',
    {
      labwareType: sourceType.id,
      containers: [{ label: 'FICTIONAL stock plate' }],
    },
  );
  const source = containers[0] as RecordEnvelope;
  await run('person', 'inventory.fill', {
    container: source.id,
    fills: [
      ...samples.map((sample, i) => ({
        wells: [`A${i + 1}`],
        volume: uL('40'),
        components: [
          { source: sample.id, concentration: FICTIONAL_STOCK },
          { source: solventLot.id, concentration: { value: '100', unit: '%v/v' } },
        ],
      })),
      {
        wells: ['P24'],
        volume: uL('40'),
        components: [{ source: solventLot.id, concentration: { value: '100', unit: '%v/v' } }],
      },
    ],
  });
  const sop = await confirmFixtureRecord(
    run,
    await run('agent', 'sops.draft', {
      label: 'FICTIONAL compound dosing and readout',
      materials: [
        { role: 'plate', label: 'Assay plate', type: 'labware' },
        { role: 'reader', label: 'Plate reader', type: 'instrument' },
      ],
      variables: [
        {
          name: 'target_concentration',
          label: 'Fixed target concentration',
          kind: 'default',
          value: FICTIONAL_TARGET,
        },
      ],
      steps: [
        {
          id: 'read',
          action: 'read',
          text: 'Read the FICTIONAL endpoint.',
          uses: ['plate', 'reader'],
        },
      ],
    }),
  );
  const layout = await confirmFixtureRecord(
    run,
    await run('agent', 'layouts.draft', {
      label: 'FICTIONAL single point compound layout',
      wells: 384,
      subjectRole: 'compound',
      subjectRegion: ['A1:B2'],
      subjectConcentration: FICTIONAL_TARGET,
      replicates: 2,
      fixed: [
        {
          id: 'positive',
          role: 'positive_control',
          label: 'FICTIONAL positive control',
          region: ['H1:H2'],
          subject: compounds[2]?.id,
          concentration: FICTIONAL_TARGET,
        },
        {
          id: 'vehicle',
          role: 'neutral_control',
          label: 'FICTIONAL solvent vehicle',
          region: ['H3:H4'],
        },
      ],
    }),
  );
  const template = await confirmFixtureRecord(
    run,
    await run('agent', 'assays.draft_template', {
      label: 'FICTIONAL single point assay',
      purpose: 'FICTIONAL compound response',
      assays: ['fictional endpoint'],
      parts: [{ id: 'assay', sop: { id: sop.id, version: sop.version } }],
      layout: { id: layout.id, version: layout.version },
      roles: [
        {
          part: 'assay',
          role: 'plate',
          record: destinationType.id,
          version: destinationType.version,
        },
        { part: 'assay', role: 'reader', capability: 'read_absorbance', preferred: [reader.id] },
      ],
      essentials: [
        { input: 'subjects', id: 'compounds', label: 'Which FICTIONAL compounds', max: 2 },
      ],
      factors: [{ id: 'compound', label: 'Compound', from: 'compounds' }],
      controls: [
        {
          id: 'positive',
          label: 'FICTIONAL positive control',
          role: 'positive_control',
          subject: compounds[2]?.id,
          wells: 2,
          per: 'plate',
          reason: 'FICTIONAL control',
        },
        {
          id: 'vehicle',
          label: 'FICTIONAL solvent vehicle',
          role: 'neutral_control',
          wells: 2,
          per: 'plate',
          reason: 'FICTIONAL vehicle control',
        },
      ],
      replicates: { technical: 2, reason: 'FICTIONAL duplicates' },
      readouts: [
        {
          id: 'endpoint',
          label: 'FICTIONAL endpoint',
          capability: 'read_absorbance',
          part: 'assay',
        },
      ],
    }),
  );
  const campaign = await confirmFixtureRecord(
    run,
    await run('agent', 'campaigns.draft', {
      label: 'FICTIONAL compound campaign',
      goal: 'Exercise the accepted transfer workflow',
      aims: [
        {
          id: 'aim_1',
          text: 'Test FICTIONAL compounds',
          success: 'Review generated map and transfer',
        },
      ],
    }),
  );
  return {
    template,
    campaign,
    sop,
    layout,
    destinationType,
    sourceType,
    source,
    echo,
    reader,
    compounds,
    samples,
    solventLot,
    designerInput: {
      template: template.id,
      campaign: campaign.id,
      aim: 'aim_1',
      answers: { compounds: compounds.slice(0, 2).map((c) => c.id) },
    },
  };
}

export type FictionalTransferFixture = Awaited<ReturnType<typeof createFictionalTransferFixture>>;

export async function startFictionalExperiment(run: FixtureRun, fixture: FictionalTransferFixture) {
  const result = await run<{ experiment: RecordEnvelope; plateMap?: RecordEnvelope }>(
    'agent',
    'designer.start',
    fixture.designerInput,
  );
  if (!result.plateMap) throw new Error('Fixture expected designer.start to generate a plate map');
  return { experiment: result.experiment, plateMap: result.plateMap };
}

export function fictionalTransferInput(fixture: FictionalTransferFixture, map: RecordEnvelope) {
  return {
    label: 'FICTIONAL compound transfer',
    map: map.id,
    sourcePlates: [
      {
        id: 'src',
        label: 'FICTIONAL stock plate',
        labwareType: { id: fixture.sourceType.id, version: fixture.sourceType.version },
        container: fixture.source.id,
      },
    ],
    sources: fixture.compounds.map((subject, i) => ({
      subject: subject.id,
      plate: 'src',
      well: `A${i + 1}`,
      stock: FICTIONAL_STOCK,
    })),
    solvent: { plate: 'src', well: 'P24' },
    finalVolume: FICTIONAL_FINAL_VOLUME,
    maxSolventPercent: '1',
    instrument: { instrument: fixture.echo.id },
    why: 'FICTIONAL direct Echo dosing and matched solvent',
  };
}
