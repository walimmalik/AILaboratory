import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { recordIdOf } from '../ids.ts';
import {
  CalendarDate,
  CapabilityId,
  CapabilityLimits,
  Configuration,
  EquipmentNode,
  InstrumentAttributes,
  InstrumentStatus,
  LocalId,
  Placement,
  ResolvedConfiguration,
} from '../instruments.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';
import { WorkcellAttributes, WorkcellId, WorkcellMember } from '../workcells.ts';

const InstrumentId = recordIdOf('ins');
const ExpectedVersion = z
  .number()
  .int()
  .positive()
  .describe('The version you last read; the change is refused if the record has moved on');
const Reason = z.string().min(1).optional().describe('Why; kept in history');

export const instrumentsCapabilities = defineContract({
  id: 'instruments.capabilities',
  summary:
    'List the capability catalog: every capability an instrument or equipment kind can offer (transfer, read_absorbance, incubate…), what it means and which limits a kind should give for it',
  effect: 'read',
  input: z.strictObject({}),
  output: z.object({
    capabilities: z.array(
      z.object({
        id: CapabilityId,
        label: z.string(),
        meaning: z.string(),
        expects: z.array(CapabilityLimits.keyof()),
      }),
    ),
  }),
});

export const instrumentsResolve = defineContract({
  id: 'instruments.resolve',
  summary:
    "Check a configuration of an instrument kind (which equipment is on which mount, slot or track) and work out its labware sites, what each piece takes up and the capabilities it has with their limits. Returns every problem found (unknown slot, overlap, equipment that doesn't fit the mount); nothing is saved",
  effect: 'read',
  input: z.union([
    z.strictObject({ instrumentKind: recordIdOf('ink'), configuration: Configuration }),
    z
      .strictObject({ instrument: InstrumentId })
      .describe("A registered instrument's current configuration"),
  ]),
  output: ResolvedConfiguration,
});

export const instrumentsRegister = defineContract({
  id: 'instruments.register',
  summary:
    'Register a real instrument of an instrument kind as a draft (name, serial, room, starting configuration). The configuration is checked first and refused if it has errors',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('What the lab calls it, e.g. "Flex 1"'),
    ...InstrumentAttributes.omit({ status: true, configuration: true, lastService: true }).shape,
    configuration: Configuration.optional().describe('What is installed; empty when absent'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const ConfigurationChange = z.discriminatedUnion('change', [
  z
    .strictObject({ change: z.literal('place'), equipment: EquipmentNode })
    .describe('Install a piece of equipment'),
  z
    .strictObject({
      change: z.literal('move'),
      id: LocalId,
      parent: LocalId.optional().describe('The node it moves onto; the instrument when absent'),
      mount: LocalId,
      placement: Placement,
    })
    .describe('Move installed equipment to another mount, slot or track'),
  z
    .strictObject({ change: z.literal('remove'), id: LocalId })
    .describe('Take equipment off; refused while other equipment sits on it'),
  z
    .strictObject({
      change: z.literal('set_item'),
      id: LocalId,
      item: recordIdOf('eqp').optional().describe('Leave out to clear it'),
    })
    .describe('Say which equipment item (serial) this piece is'),
]);
export type ConfigurationChange = z.infer<typeof ConfigurationChange>;

export const instrumentsChangeConfiguration = defineContract({
  id: 'instruments.change_configuration',
  summary:
    "Change what is installed on a registered instrument: place, move or remove equipment, or say which item it is. All changes apply together and the whole configuration is checked; it is refused with every problem if it doesn't resolve",
  effect: 'write',
  input: z.strictObject({
    id: InstrumentId,
    expectedVersion: ExpectedVersion,
    changes: z.array(ConfigurationChange).min(1),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const instrumentsSetStatus = defineContract({
  id: 'instruments.set_status',
  summary: "Set a registered instrument's status: ready, in_use, maintenance or out_of_service",
  effect: 'write',
  input: z.strictObject({
    id: InstrumentId,
    expectedVersion: ExpectedVersion,
    status: InstrumentStatus,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const instrumentsLogService = defineContract({
  id: 'instruments.log_service',
  summary:
    'Record a service, calibration or repair on a registered instrument, and optionally when calibration is next due. Earlier entries stay in its history',
  effect: 'write',
  input: z.strictObject({
    id: InstrumentId,
    expectedVersion: ExpectedVersion,
    date: CalendarDate,
    note: z.string().min(1).describe('What was done, e.g. "Annual PM, channels recalibrated"'),
    calibrationDue: CalendarDate.optional(),
  }),
  output: RecordEnvelope,
});

// ---------------------------------------------------------------------------------------------
// Workcells (008d): member instruments mapped to the digital twin.

export const workcellsDraft = defineContract({
  id: 'workcells.draft',
  summary:
    'Draft a workcell: the registered instruments that work together (e.g. the FlexPod with its Echo, PreciseDrop and sealer), for each the device it maps to in the digital twin and whether people can also use it by hand, and the twin workcell ID. No positions or reach: those live in the twin. A person confirms it with records.confirm_section',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('E.g. "FlexPod workcell"'),
    ...WorkcellAttributes.shape,
    evidence: z.record(z.string(), EvidenceInput).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const workcellsChangeMembers = defineContract({
  id: 'workcells.change_members',
  summary:
    "Add, remove or change members of a workcell (their twin device or hand use). On a confirmed workcell an agent's change is a proposal; the change is a new version",
  effect: 'write',
  input: z
    .strictObject({
      id: WorkcellId,
      expectedVersion: ExpectedVersion,
      set: z
        .array(WorkcellMember)
        .optional()
        .describe('Members to add, or to replace by instrument'),
      remove: z.array(InstrumentId).optional().describe('Instruments to take out'),
      reason: Reason,
    })
    .refine((i) => !!(i.set?.length || i.remove?.length), {
      message: 'Give members to set or remove',
    }),
  output: RecordEnvelope,
});

export const workcellsOfInstrument = defineContract({
  id: 'workcells.of_instrument',
  summary:
    'Which workcell an instrument is in: the confirmed workcell using it (at most one, I9), and draft workcells that plan it. Not in a confirmed workcell means it is used standalone',
  effect: 'read',
  input: z.strictObject({ instrument: InstrumentId }),
  output: z.object({
    active: z
      .object({ id: z.string(), name: z.string(), label: z.string(), member: WorkcellMember })
      .optional(),
    drafts: z.array(z.object({ id: z.string(), name: z.string(), label: z.string() })),
  }),
});
