import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { LabwareFamily, LiquidVolume, Millimetres } from './labware.ts';
import { DecimalString } from './quantity.ts';

/**
 * Instrument library (plan 008, ADR 0025): instrument kinds (a STAR, a Flex, a plate reader model, a
 * person at a bench) and equipment kinds (pipettes, heads, modules, carriers, adapters) that attach to
 * their mounts. Registered machines and their current configuration arrive in 008b.
 *
 * Capabilities are contracts in code (the catalog below); each kind declares which it provides and
 * with what limits, as data.
 */

// Quantities with the one unit each limit uses.
const quantityIn = <U extends string>(unit: U) =>
  z.strictObject({ value: DecimalString, unit: z.literal(unit) });
export const Celsius = quantityIn('degC');
export const Nanometres = quantityIn('nm');
export const Rpm = quantityIn('rpm');
export const TimesG = quantityIn('xg');
export const Kilograms = quantityIn('kg');
export const Duration = z.strictObject({
  value: DecimalString,
  unit: z.enum(['s', 'min', 'h']),
});
export type Duration = z.infer<typeof Duration>;

/** Lowercase keys for mounts, slots, sites and nodes: "deck", "left", "A1" is allowed too. */
export const LocalId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, 'must be a short key like "deck", "left" or "A1"');

// ---------------------------------------------------------------------------------------------
// Capability catalog (I5): what a capability means lives in code, versioned with the app.

export const CapabilityLimits = z.strictObject({
  volume: z
    .strictObject({ min: LiquidVolume.optional(), max: LiquidVolume.optional() })
    .optional()
    .describe('Smallest and largest volume per transfer or dispense'),
  volumeStep: LiquidVolume.optional().describe(
    'Volumes are whole multiples of this, e.g. 2.5 nL droplets on an Echo',
  ),
  channels: z
    .array(z.number().int().positive())
    .optional()
    .describe('Channel counts it can work with at once, e.g. [8] or [1, 96]'),
  temperature: z
    .strictObject({
      min: Celsius.optional(),
      max: Celsius.optional(),
      minAboveAmbient: Celsius.optional().describe(
        'For heaters without cooling: the lowest setpoint above room temperature',
      ),
    })
    .optional(),
  speed: z.strictObject({ min: Rpm.optional(), max: Rpm.optional() }).optional(),
  force: z.strictObject({ max: TimesG }).optional().describe('Centrifuges'),
  wavelengths: z
    .strictObject({
      fixed: z.array(Nanometres).optional().describe('Filters or LEDs it has'),
      min: Nanometres.optional().describe('Low end of a monochromator range'),
      max: Nanometres.optional(),
    })
    .optional(),
  wellCounts: z
    .array(z.number().int().positive())
    .optional()
    .describe('Plate formats it handles, e.g. [96, 384]'),
  capacity: z.number().int().positive().optional().describe('Plates it holds at once'),
  note: z.string().min(1).optional().describe('Anything else in plain words'),
});
export type CapabilityLimits = z.infer<typeof CapabilityLimits>;
export type LimitKey = keyof CapabilityLimits;

interface CapabilityDefinition {
  label: string;
  meaning: string;
  /** Limits a provider should give; missing ones show as a readiness warning. */
  expects: LimitKey[];
}

export const capabilityCatalog = {
  transfer: {
    label: 'Transfer liquid',
    meaning: 'Moves a volume from one well or tube to another (pipetting or acoustic droplets)',
    expects: ['volume'],
  },
  dispense: {
    label: 'Dispense liquid',
    meaning: 'Adds a volume of a reagent from a bottle, chip or line into wells',
    expects: ['volume'],
  },
  move_labware: {
    label: 'Move labware',
    meaning: 'Picks up a plate or other labware and puts it on another site',
    expects: [],
  },
  delid: { label: 'Take a lid off', meaning: 'Removes a lid and keeps it', expects: [] },
  relid: { label: 'Put a lid on', meaning: 'Puts a kept lid back on', expects: [] },
  seal: { label: 'Seal', meaning: 'Applies a seal or foil', expects: ['temperature'] },
  peel: { label: 'Peel', meaning: 'Removes a seal', expects: [] },
  rotate: {
    label: 'Rotate a plate',
    meaning:
      'Turns a plate, e.g. 90 or 180 degrees, so the next device gets it the right way round',
    expects: [],
  },
  read_absorbance: {
    label: 'Read absorbance',
    meaning: 'Measures optical density per well at given wavelengths',
    expects: ['wavelengths'],
  },
  read_fluorescence: {
    label: 'Read fluorescence',
    meaning: 'Measures fluorescence intensity per well for excitation and emission wavelengths',
    expects: ['wavelengths'],
  },
  read_luminescence: {
    label: 'Read luminescence',
    meaning: 'Measures light emitted per well, e.g. CellTiter-Glo or Dual-Glo',
    expects: [],
  },
  image: { label: 'Image wells', meaning: 'Takes brightfield or fluorescence images', expects: [] },
  incubate: {
    label: 'Incubate',
    meaning: 'Holds labware at a set temperature (and gas, humidity) for a time',
    expects: ['temperature'],
  },
  store: {
    label: 'Store',
    meaning: 'Keeps labware in addressable positions until it is needed',
    expects: ['capacity'],
  },
  heat: {
    label: 'Heat',
    meaning: 'Holds labware at a set temperature above room temperature',
    expects: ['temperature'],
  },
  cool: {
    label: 'Cool',
    meaning: 'Holds labware at a set temperature below room temperature',
    expects: ['temperature'],
  },
  shake: { label: 'Shake', meaning: 'Shakes labware at a set speed', expects: ['speed'] },
  thermocycle: {
    label: 'Thermocycle',
    meaning: 'Runs a temperature program (PCR) on a plate',
    expects: ['temperature'],
  },
  qpcr: {
    label: 'Run qPCR',
    meaning: 'Thermocycles and reads fluorescence every cycle',
    expects: ['temperature'],
  },
  centrifuge: { label: 'Centrifuge', meaning: 'Spins labware', expects: ['force'] },
  wash: {
    label: 'Wash wells',
    meaning: 'Adds and removes wash buffer, e.g. between ELISA steps',
    expects: [],
  },
  magnetic_separation: {
    label: 'Separate beads',
    meaning: 'Holds magnetic beads to the side or bottom of wells while liquid is removed',
    expects: [],
  },
} satisfies Record<string, CapabilityDefinition>;

export type CapabilityId = keyof typeof capabilityCatalog;
export const CapabilityId = z
  .enum(Object.keys(capabilityCatalog) as [CapabilityId, ...CapabilityId[]])
  .describe('A capability from the catalog (instruments.capabilities)');

/** A capability a kind offers, with its limits on this kind. */
export const CapabilityProvider = z.strictObject({
  capability: CapabilityId,
  limits: CapabilityLimits.optional(),
  sites: z
    .array(LocalId)
    .optional()
    .describe('The sites where it happens, when not every site (e.g. the heater-shaker plate)'),
});
export type CapabilityProvider = z.infer<typeof CapabilityProvider>;

// ---------------------------------------------------------------------------------------------
// Mounts and sites. Mounts take equipment; sites hold labware.

/** Who can change what is on a mount (I3), and so how hard a change is for the scheduler. */
export const ChangedBy = z
  .enum(['factory', 'service', 'operator', 'robot'])
  .describe(
    'factory (built in), service (an engineer visit), operator (a person between runs) or robot (during a run)',
  );
export type ChangedBy = z.infer<typeof ChangedBy>;

export const MountLayout = z.discriminatedUnion('layout', [
  z.strictObject({ layout: z.literal('fixed') }).describe('One place, e.g. a head mount'),
  z
    .strictObject({
      layout: z.literal('slots'),
      slots: z.array(LocalId).min(1).describe('Named places, e.g. A1 to D3, or left and right'),
    })
    .describe('Named places'),
  z
    .strictObject({
      layout: z.literal('rail'),
      tracks: z.number().int().positive().describe('Tracks numbered 1 to this'),
      pitch: Millimetres.optional(),
    })
    .describe('Numbered tracks; equipment takes a run of tracks from its start track'),
]);
export type MountLayout = z.infer<typeof MountLayout>;

export const MountDefinition = z.strictObject({
  id: LocalId,
  label: z.string().min(1),
  layout: MountLayout,
  accepts: z
    .array(LocalId)
    .min(1)
    .describe('Fit tags: equipment kinds with one of these in `fits` can go here'),
  changedBy: ChangedBy,
  changeTime: Duration.optional().describe('Roughly how long one change takes'),
});
export type MountDefinition = z.infer<typeof MountDefinition>;

export const SiteDefinition = z.strictObject({
  id: LocalId,
  label: z.string().min(1).optional(),
  accepts: z
    .strictObject({
      sbs: z.boolean().optional().describe('Takes SBS-footprint labware'),
      families: z.array(LabwareFamily).optional(),
      maxHeight: Millimetres.optional(),
      allow: z.array(recordIdOf('lwt')).optional().describe('Labware types known to fit anyway'),
      deny: z.array(recordIdOf('lwt')).optional().describe('Labware types known not to fit'),
    })
    .optional(),
  capacity: z.number().int().positive().optional().describe('How many it holds; 1 when absent'),
  mount: z
    .strictObject({ mount: LocalId, slot: LocalId.optional() })
    .optional()
    .describe(
      'The mount place this site sits on; equipment placed there covers the site (e.g. a deck slot)',
    ),
});
export type SiteDefinition = z.infer<typeof SiteDefinition>;

// ---------------------------------------------------------------------------------------------
// Kinds

export const InstrumentCategory = z.enum([
  'liquid_handler',
  'acoustic_dispenser',
  'bulk_dispenser',
  'plate_reader',
  'imager',
  'plate_washer',
  'thermocycler',
  'qpcr',
  'centrifuge',
  'incubator',
  'sealer',
  'peeler',
  'lid_handler',
  'plate_handler',
  'transport',
  'manual_station',
  'other',
]);
export type InstrumentCategory = z.infer<typeof InstrumentCategory>;

export const InstrumentKindAttributes = z.strictObject({
  manufacturer: recordIdOf('vnd').optional().describe('The vendor record of the manufacturer'),
  model: z.string().min(1).optional().describe("The manufacturer's model name"),
  variants: z
    .array(z.string().min(1))
    .optional()
    .describe('Sizes or editions sold under the model, e.g. STARlet, STAR, STARplus'),
  category: InstrumentCategory,
  performedBy: z
    .enum(['machine', 'person'])
    .describe('person for manual stations (a bench, a hood): their capabilities are done by hand'),
  footprint: z
    .strictObject({
      width: Millimetres.optional(),
      depth: Millimetres.optional(),
      height: Millimetres.optional(),
    })
    .optional(),
  weight: Kilograms.optional(),
  mounts: z.array(MountDefinition).optional().describe('Where equipment attaches'),
  sites: z.array(SiteDefinition).optional().describe('Built-in places labware can sit'),
  capabilities: z
    .array(CapabilityProvider)
    .optional()
    .describe('What it does by itself, without any equipment installed'),
  controlInterfaces: z
    .array(z.string().min(1))
    .optional()
    .describe('How it is driven, e.g. "VENUS", "Opentrons Python API"'),
  twin: z.string().min(1).optional().describe('The digital twin package that simulates it'),
  notes: z.string().min(1).optional(),
});
export type InstrumentKindAttributes = z.infer<typeof InstrumentKindAttributes>;

export const EquipmentRole = z.enum([
  'pipette',
  'head',
  'gripper',
  'module',
  'carrier',
  'adapter',
  'fixture',
  'chip',
  'other',
]);
export type EquipmentRole = z.infer<typeof EquipmentRole>;

export const EquipmentKindAttributes = z.strictObject({
  manufacturer: recordIdOf('vnd').optional(),
  model: z.string().min(1).optional(),
  role: EquipmentRole,
  fits: z
    .array(LocalId)
    .min(1)
    .describe('Fit tags naming the mounts it goes on, e.g. "flex_pipette", "hamilton_track"'),
  placement: z
    .strictObject({
      slots: z
        .array(LocalId)
        .optional()
        .describe('The only slots it may go in, e.g. the thermocycler in B1'),
      alsoClaims: z
        .record(LocalId, z.array(LocalId).min(1))
        .optional()
        .describe(
          'Other slots it takes when placed in a slot, e.g. {"B1": ["A1"]} or {"left": ["right"]}',
        ),
      tracks: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Tracks it takes on a rail, from its start track'),
    })
    .optional(),
  serialized: z
    .boolean()
    .describe(
      'It has a serial and moves between instruments (a Flex pipette, a module), so each one gets its own record',
    ),
  mounts: z.array(MountDefinition).optional().describe('Where other equipment attaches to it'),
  sites: z.array(SiteDefinition).optional().describe('Places labware can sit on it'),
  capabilities: z.array(CapabilityProvider).optional(),
  notes: z.string().min(1).optional(),
});
export type EquipmentKindAttributes = z.infer<typeof EquipmentKindAttributes>;

// ---------------------------------------------------------------------------------------------
// Configuration: what is installed where. One graph for fixed and swappable instruments.

/** The key of the instrument itself in a configuration. */
export const ROOT_NODE = 'instrument';

export const Placement = z.discriminatedUnion('on', [
  z.strictObject({ on: z.literal('fixed') }),
  z.strictObject({ on: z.literal('slot'), slot: LocalId }),
  z.strictObject({
    on: z.literal('rail'),
    track: z.number().int().positive().describe('The first track it takes'),
  }),
]);
export type Placement = z.infer<typeof Placement>;

export const EquipmentNode = z.strictObject({
  id: LocalId.describe('Unique in this configuration, e.g. "left-pipette" or "carrier-2"'),
  kind: recordIdOf('eqk'),
  label: z.string().min(1).optional(),
  parent: LocalId.optional().describe(`The node it attaches to; the instrument when absent`),
  mount: LocalId,
  placement: Placement,
  item: recordIdOf('eqp')
    .optional()
    .describe('The equipment item (its own record, with a serial) when the kind is serialized'),
});
export type EquipmentNode = z.infer<typeof EquipmentNode>;

export const Configuration = z.strictObject({
  equipment: z.array(EquipmentNode),
});
export type Configuration = z.infer<typeof Configuration>;

// Registered instruments (008b): the real machine, what is installed on it now, and its state.

export const InstrumentStatus = z
  .enum(['ready', 'in_use', 'maintenance', 'out_of_service'])
  .describe('ready, in_use, maintenance or out_of_service');
export type InstrumentStatus = z.infer<typeof InstrumentStatus>;

export const CalendarDate = z.iso.date().describe('A date like 2026-09-29');

export const InstrumentAttributes = z.strictObject({
  kind: recordIdOf('ink').describe('The instrument kind: the model'),
  variant: z.string().min(1).optional().describe("One of the kind's variants, e.g. STARlet"),
  shortName: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, 'must be a short name like FLX-01')
    .optional()
    .describe('What people call it at the bench, e.g. FLX-01'),
  serial: z.string().min(1).optional(),
  room: z.string().min(1).optional().describe('Where it stands'),
  configuration: Configuration.describe(
    'What is installed on it now; change it with instruments.change_configuration',
  ),
  status: InstrumentStatus,
  lastService: z
    .strictObject({ date: CalendarDate, note: z.string().min(1) })
    .optional()
    .describe('The latest service, calibration or repair; earlier ones are in history'),
  calibrationDue: CalendarDate.optional(),
  notes: z.string().min(1).optional(),
});
export type InstrumentAttributes = z.infer<typeof InstrumentAttributes>;

/** A serial-bearing part that moves between instruments (I4): a Flex pipette, a module. */
export const EquipmentItemAttributes = z.strictObject({
  kind: recordIdOf('eqk'),
  serial: z.string().min(1).optional(),
  calibrationDue: CalendarDate.optional(),
  notes: z.string().min(1).optional(),
});
export type EquipmentItemAttributes = z.infer<typeof EquipmentItemAttributes>;

// What a resolved configuration gives: derived, never edited.

export const ResolvedSite = z.object({
  node: LocalId,
  site: LocalId,
  label: z.string(),
  accepts: SiteDefinition.shape.accepts,
  capacity: z.number().int().positive(),
});

export const ResolvedClaim = z.object({
  node: LocalId,
  parent: LocalId,
  mount: LocalId,
  slots: z.array(LocalId).optional(),
  tracks: z.strictObject({ from: z.number().int(), to: z.number().int() }).optional(),
});

export const ResolvedCapability = z.object({
  node: LocalId,
  capability: CapabilityId,
  limits: CapabilityLimits.optional(),
  sites: z.array(LocalId).optional(),
  performedBy: z.enum(['machine', 'person']),
});

export const ConfigurationIssue = z.object({
  rule: z.enum([
    'duplicate_node',
    'unknown_kind',
    'unknown_parent',
    'cycle',
    'unknown_mount',
    'wrong_placement',
    'unknown_slot',
    'not_accepted',
    'slot_not_allowed',
    'off_rail',
    'conflict',
    'kind_not_confirmed',
    'wrong_item',
  ]),
  severity: z.enum(['error', 'warning']),
  node: LocalId.optional(),
  message: z.string(),
});
export type ConfigurationIssue = z.infer<typeof ConfigurationIssue>;

export const ResolvedConfiguration = z.object({
  valid: z.boolean().describe('No errors; warnings may remain'),
  sites: z.array(ResolvedSite),
  claims: z.array(ResolvedClaim),
  capabilities: z.array(ResolvedCapability),
  issues: z.array(ConfigurationIssue),
});
export type ResolvedConfiguration = z.infer<typeof ResolvedConfiguration>;
