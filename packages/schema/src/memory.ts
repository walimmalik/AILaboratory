import { z } from 'zod';
import { UserId } from './actor.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { CapabilityId, Celsius } from './instruments.ts';
import { LiquidVolume } from './labware.ts';
import { DispenseMode } from './liquids.ts';
import { WellRole } from './platemaps.ts';
import { Quantity } from './quantity.ts';

/**
 * Lab memory (plan 005a): what a good lab manager knows but no registry has a field for, as
 * records a person confirms (rule 8). Conventions, preferences, quirks, lessons and facts; each
 * says what it is about, when it applies, how strongly it binds and where it came from.
 */

export const MemoryId = recordIdOf('mem');

export const MemoryKind = z
  .enum(['convention', 'preference', 'quirk', 'lesson', 'fact'])
  .describe(
    'convention: how the lab does something ("we block with 2% BSA"); preference: a choice a person or the lab favours ("Flex for under 96 samples"); quirk: how an instrument or material misbehaves ("STAR channel 3 drips below 5 uL"); lesson: something learned from results ("edge wells evaporate after 48 h at 37 C"); fact: anything else with no home ("Priya owns the FlexPod")',
  );
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemoryStrength = z
  .enum(['rule', 'default', 'note'])
  .describe(
    'rule: followed, or a design that breaks it shows a readiness warning accepted with a reason; default: fills a value no confirmed record decides; note: only informs, never fills a value',
  );
export type MemoryStrength = z.infer<typeof MemoryStrength>;

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;

const Range = <T extends z.ZodType>(of: T) =>
  z
    .strictObject({ min: of.optional(), max: of.optional() })
    .refine((r) => r.min !== undefined || r.max !== undefined, 'give a minimum, a maximum or both');

/**
 * When a memory applies, as keys the consumers evaluate themselves (change 4): the liquid class
 * resolver's instrument kind, device, tip, labware, dispense mode, volume and liquid type; the
 * designer's SOP, layout, sample count and well roles; the scheduler's instrument and weekdays.
 * A consumer that can't evaluate a key doesn't match the memory; the agent still sees it.
 */
export const MemoryConditions = z
  .strictObject({
    capability: CapabilityId.optional().describe('The action, e.g. transfer or dispense'),
    instrumentKind: recordIdOf('ink').optional(),
    instrument: recordIdOf('ins').optional(),
    device: recordIdOf('eqk').optional().describe('The pipette, head, channel type or chip'),
    tip: recordIdOf('lwt').optional().describe('The tip rack type'),
    labware: recordIdOf('lwt').optional().describe('A labware type the work uses'),
    mode: DispenseMode.optional(),
    volume: Range(LiquidVolume).optional().describe('Transfer volumes in this range'),
    liquidType: recordIdOf('lqt').optional(),
    temperature: Range(Celsius)
      .optional()
      .describe('e.g. {"min": {"value": "37", "unit": "degC"}}'),
    sop: recordIdOf('sop').optional(),
    layout: recordIdOf('lyt').optional(),
    samples: Range(z.number().int().min(0)).optional().describe('How many samples the work has'),
    roles: z.array(WellRole).min(1).optional().describe('Wells with these roles'),
    weekdays: z.array(Weekday).min(1).optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'give at least one condition, or leave it out');
export type MemoryConditions = z.infer<typeof MemoryConditions>;

/**
 * What a consumer knows about the work it is doing (plan 005b), keyed like the conditions: one
 * value for each range. A condition whose key is left out here can't be evaluated, so the memory
 * is shown but its effect is not applied.
 */
export const MemoryFacts = z.strictObject({
  capability: CapabilityId.optional(),
  instrumentKind: recordIdOf('ink').optional(),
  instrument: recordIdOf('ins').optional(),
  device: recordIdOf('eqk').optional(),
  tip: recordIdOf('lwt').optional(),
  labware: z
    .array(recordIdOf('lwt'))
    .max(50)
    .optional()
    .describe('Every labware type the work uses'),
  mode: DispenseMode.optional(),
  volume: LiquidVolume.optional(),
  liquidType: recordIdOf('lqt').optional(),
  temperature: Celsius.optional(),
  sop: recordIdOf('sop').optional(),
  layout: recordIdOf('lyt').optional(),
  samples: z.number().int().min(0).optional(),
  roles: z.array(WellRole).min(1).optional().describe('The well roles the work fills'),
  weekday: Weekday.optional(),
});
export type MemoryFacts = z.infer<typeof MemoryFacts>;

/** The one thing code may do with a memory (change 1); without it, the memory only informs. */
export const MemoryEffect = z.discriminatedUnion('effect', [
  z
    .strictObject({ effect: z.literal('prefer'), record: RecordId })
    .describe('Rank this record first among the options when the conditions match'),
  z
    .strictObject({ effect: z.literal('avoid'), record: RecordId })
    .describe('Rank it last; as a rule, a design that uses it shows a readiness warning'),
  z
    .strictObject({
      effect: z.literal('set'),
      slot: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/, 'a slot name in snake_case, e.g. replicates')
        .describe('A slot a consumer declares, e.g. replicates or blocking_buffer'),
      value: z.union([z.string().min(1), z.number(), Quantity, RecordId]),
    })
    .describe('Fill a slot the consumer declares'),
]);
export type MemoryEffect = z.infer<typeof MemoryEffect>;

export const MemoryAppliesTo = z
  .union([
    z.strictObject({ to: z.literal('lab') }),
    z.strictObject({
      to: z.literal('person'),
      user: UserId.describe('Applies when this person asked, owns the experiment or operates'),
    }),
  ])
  .describe('The whole lab, or one person (their own preference)');
export type MemoryAppliesTo = z.infer<typeof MemoryAppliesTo>;

export const MemorySource = z
  .strictObject({
    from: z
      .enum(['stated', 'conversation', 'experiment', 'run', 'analysis', 'edits'])
      .describe(
        'stated: a person said it; conversation: from a chat with the assistant; experiment, run, analysis: learned from results; edits: people changing the same filled-in value the same way',
      ),
    evidence: z
      .array(RecordId)
      .max(50)
      .optional()
      .describe('The records it was learned from (runs, experiments, analyses, documents)'),
    note: z.string().min(1).optional().describe('Who said it, or where'),
  })
  .describe('Where it came from');
export type MemorySource = z.infer<typeof MemorySource>;

/** A memory's fields; MemoryAttributes adds the checks between them. */
export const MemoryFields = z.strictObject({
  statement: z.string().min(1).max(500).describe('The memory in plain words, one sentence'),
  kind: MemoryKind,
  strength: MemoryStrength,
  about: z
    .array(RecordId)
    .max(20)
    .optional()
    .describe('The records it is about (an instrument, product, SOP…); none for lab-wide'),
  when: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe('When it applies, in words, for what the conditions cannot say'),
  conditions: MemoryConditions.optional(),
  effect: MemoryEffect.optional(),
  appliesTo: MemoryAppliesTo,
  source: MemorySource,
  checkAgain: z.iso
    .date()
    .optional()
    .describe(
      'When a person should check it is still true; set by code from the kind when left out (quirks and lessons 6 months, conventions and facts 12, preferences never)',
    ),
  retired: z
    .strictObject({
      why: z.string().min(1),
      replacedBy: MemoryId.optional(),
    })
    .optional()
    .describe('Why it stopped applying, and the memory that replaced it'),
});

export const MemoryAttributes = MemoryFields.superRefine((a, ctx) => {
  if (a.effect && a.strength === 'note')
    ctx.addIssue({
      code: 'custom',
      path: ['effect'],
      message: 'a note only informs; make it a default or a rule to give it an effect',
    });
  if (a.effect?.effect === 'prefer' && a.strength === 'rule')
    ctx.addIssue({
      code: 'custom',
      path: ['effect'],
      message: 'a rule may avoid a record or set a value; a preference is a default',
    });
});
export type MemoryAttributes = z.infer<typeof MemoryAttributes>;

/**
 * What a memory proposed by a detector would say (plan 005c-1): the fields of memory.propose that
 * describe it. Strength is a note or a default, never a rule (change 3).
 */
export const MemoryDraft = MemoryFields.pick({
  statement: true,
  kind: true,
  about: true,
  when: true,
  conditions: true,
}).extend({
  strength: z.enum(['note', 'default']).optional().describe('Left out: note'),
});
export type MemoryDraft = z.infer<typeof MemoryDraft>;

/** When a candidate is proposed (M14): seen in enough records, on enough different days. */
export const MemoryBar = z
  .strictObject({
    records: z.number().int().min(1).max(100).describe('Different records it was seen in'),
    days: z.number().int().min(1).max(100).describe('Different days'),
  })
  .describe('Left out: 3 records on 2 days');
export type MemoryBar = z.infer<typeof MemoryBar>;

/** One observation a detector or agent reports (M13): one record that shows the pattern. */
export const MemoryObservationEntry = z.object({
  evidence: RecordId,
  day: z.iso.date(),
  at: z.iso.datetime(),
  note: z.string().optional(),
});
export type MemoryObservationEntry = z.infer<typeof MemoryObservationEntry>;

/**
 * A memory candidate (plan 005c-1, M14): observations a detector collects under one key until they
 * pass its bar, then one proposed memory. A rejected candidate is proposed again only once the
 * observations since its proposal double the count it was proposed with.
 */
export const MemoryCandidate = z.object({
  id: z.string(),
  detector: z.string(),
  key: z.string(),
  draft: MemoryDraft,
  source: MemorySource.shape.from.exclude(['stated', 'conversation']),
  bar: MemoryBar,
  observations: z.array(MemoryObservationEntry),
  status: z
    .enum(['collecting', 'proposed', 'confirmed', 'rejected'])
    .describe(
      'collecting: below its bar; proposed: a draft memory waits for a person; confirmed: a person made it active; rejected: the draft was discarded',
    ),
  memory: MemoryId.optional().describe('The memory it proposed'),
  proposedWith: z.number().int().optional().describe('How many records it was proposed with'),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidate>;
