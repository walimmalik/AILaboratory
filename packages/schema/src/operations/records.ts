import { z } from 'zod';
import { CheckSeverity, EvidenceInput, KindSection, Readiness } from '../design.ts';
import { RecordId } from '../ids.ts';
import { defineContract } from '../operation.ts';
import { RecordOverview } from '../overview.ts';
import { Connection, RecordEnvelope, RecordStatus, RecordVersion } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why the change was made; kept in history');
const ExpectedVersion = z
  .number()
  .int()
  .positive()
  .describe('The version you last read; the change is refused if the record has moved on');
const Target = { id: RecordId, expectedVersion: ExpectedVersion, reason: Reason };
const Evidence = z
  .record(z.string(), EvidenceInput)
  .optional()
  .describe(
    'Where values came from, by attribute name, e.g. {"volume": {"source": "datasheet", "reference": "https://…"}}. Use "stated" for values the person you work for told you. Values an agent sets without naming a source are marked assumed until a person confirms them.',
  );

export const recordsCreate = defineContract({
  id: 'records.create',
  verbs: { done: 'created', intent: 'create' },
  summary:
    'Create a record of a registered kind, as a draft unless status is "active" (kinds with sections always start as drafts)',
  effect: 'write',
  input: z.object({
    kind: z.string().min(1),
    label: z.string(),
    attributes: z.record(z.string(), z.unknown()),
    status: z.enum(['draft', 'active']).optional(),
    evidence: Evidence,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const recordsGet = defineContract({
  id: 'records.get',
  verbs: { done: 'looked at', intent: 'look at' },
  summary: 'Read a record by ID',
  effect: 'read',
  input: z.object({
    id: RecordId,
    brief: z
      .boolean()
      .optional()
      .describe(
        'Leave out the section confirmations and the evidence of each list item (an SOP step, a value), which a long record repeats per item; attributes, field evidence and readiness stay',
      ),
  }),
  output: RecordEnvelope.extend({
    reviews: RecordEnvelope.shape.reviews.optional().describe('Left out when brief'),
  }),
});

export const recordsOverview = defineContract({
  id: 'records.overview',
  verbs: { done: 'summarised', intent: 'summarise' },
  summary:
    "A record in a few lines, as its page shows it first: what it is and where, and the facts a person reads first (what a plate holds and where it is, when a lot expires, an experiment's question and protocol). Cheaper than records.get when you need the gist",
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: RecordOverview.extend({ id: RecordId }),
});

export const recordsList = defineContract({
  id: 'records.list',
  verbs: { done: 'looked up records', intent: 'look up records' },
  summary:
    'Find records, most recently changed first; archived records only when status is "archived"',
  effect: 'read',
  input: z.object({
    kind: z.string().min(1).optional(),
    status: RecordStatus.optional(),
    search: z
      .string()
      .optional()
      .describe('Matches label or readable name, e.g. "PLT-0003" or "tip box"'),
    ids: z
      .array(RecordId)
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Only these records, in any status unless status is given (names for a plate of samples)',
      ),
    limit: z.number().int().min(1).max(200).optional(),
    before: z.iso
      .datetime()
      .optional()
      .describe('Only records changed before this time, for paging'),
  }),
  output: z.object({ records: z.array(RecordEnvelope) }),
});

export const recordsUpdate = defineContract({
  id: 'records.update',
  verbs: { done: 'edited', intent: 'edit' },
  summary: "Change a record's label or attributes",
  effect: 'write',
  input: z.object({
    ...Target,
    label: z.string().optional(),
    attributes: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'The complete new attributes, not just the ones that change: read the record, change what you need and send all of them back',
      ),
    evidence: Evidence,
  }),
  output: RecordEnvelope,
});

export const recordsActivate = defineContract({
  id: 'records.activate',
  verbs: { done: 'activated', intent: 'activate' },
  summary:
    'Confirm a draft and make it active; for kinds with sections, every section must be confirmed and no blocker check may fail',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsConfirmMany = defineContract({
  id: 'records.confirm_many',
  verbs: { done: 'confirmed a batch of records', intent: 'confirm a batch of records' },
  summary:
    'A person confirms many records in one step (plan 004e R3): only when none holds an assumed value, a failing check or a value changed since it was confirmed; otherwise nothing is confirmed and the refusal names which records to open. Each record still gets its own confirmation',
  effect: 'write',
  input: z.object({
    records: z
      .array(z.object({ id: RecordId, expectedVersion: z.number().int().positive() }))
      .min(1)
      .max(500),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({
    confirmed: z.array(
      z.object({ id: RecordId, name: z.string(), status: RecordStatus, version: z.number() }),
    ),
  }),
});

export const recordsConfirmSection = defineContract({
  id: 'records.confirm_section',
  verbs: { done: 'confirmed a section of', intent: 'confirm a section of' },
  summary:
    'A person confirms one section of a draft as it stands; any later change sends it back to review',
  effect: 'write',
  input: z.object({ ...Target, section: z.string().min(1) }),
  output: RecordEnvelope,
});

export const recordsConfirm = defineContract({
  id: 'records.confirm',
  verbs: { done: 'confirmed', intent: 'confirm' },
  summary:
    'A person confirms, in one step, every section of a record that waits for review, as it stands, except sections with a failing blocker check of their own; each section still gets its own confirmation. A draft becomes active when that leaves nothing to do',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsReadiness = defineContract({
  id: 'records.readiness',
  verbs: { done: 'checked what still needs review on', intent: 'check what still needs review on' },
  summary:
    'What is confirmed, what changed since it was confirmed, what was assumed, and which readiness checks pass',
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: Readiness,
});

export const recordsArchive = defineContract({
  id: 'records.archive',
  verbs: { done: 'archived', intent: 'archive' },
  summary: 'Archive a record: hidden from pickers, links keep working',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsUnarchive = defineContract({
  id: 'records.unarchive',
  verbs: { done: 'unarchived', intent: 'unarchive' },
  summary: 'Return an archived record to its earlier status',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsRestore = defineContract({
  id: 'records.restore',
  verbs: { done: 'restored an earlier version of', intent: 'restore an earlier version of' },
  summary: 'Write a new version with the label and attributes of an earlier version',
  effect: 'write',
  input: z.object({ ...Target, version: z.number().int().positive() }),
  output: RecordEnvelope,
});

export const recordsDeleteDraft = defineContract({
  id: 'records.delete_draft',
  verbs: { done: 'deleted the draft', intent: 'delete the draft' },
  summary: 'Delete a draft that nothing links to (everything else can only be archived)',
  effect: 'write',
  input: z.object({ id: RecordId, expectedVersion: ExpectedVersion }),
  output: z.object({ deleted: z.literal(true), id: RecordId }),
});

export const recordsHistory = defineContract({
  id: 'records.history',
  verbs: { done: 'read the history of', intent: 'read the history of' },
  summary: 'List every version of a record with who changed it and why',
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: z.object({ versions: z.array(RecordVersion) }),
});

export const recordsLinks = defineContract({
  id: 'records.links',
  verbs: { done: 'looked at the links of', intent: 'look at the links of' },
  summary:
    'List what a record is based on ("from": what it links to) or where it is used ("to": what links to it), each link with its relation in words and the record at the other end',
  effect: 'read',
  input: z.object({ id: RecordId, direction: z.enum(['from', 'to']) }),
  output: z.object({ links: z.array(Connection) }),
});

export const recordsKinds = defineContract({
  id: 'records.kinds',
  verbs: { done: 'checked which record kinds exist', intent: 'check which record kinds exist' },
  summary:
    "List the record kinds this lab can hold, with the JSON Schema of each kind's attributes (read this before records.create). Pass summary: true for names and sections only, then kinds: [...] for the schemas you need",
  effect: 'read',
  input: z.strictObject({
    kinds: z
      .array(z.string())
      .optional()
      .describe('Only these kinds, e.g. ["sop"]; unknown names are refused'),
    summary: z
      .boolean()
      .optional()
      .describe('Leave out attribute schemas and checks: kind names, prefixes and sections only'),
  }),
  output: z.object({
    kinds: z.array(
      z.object({
        kind: z.string(),
        idPrefix: z.string(),
        namePrefix: z.string(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        sections: z.array(KindSection),
        /** Lists whose items are keyed (ADR 0049), by the field that keys them. */
        items: z.record(z.string(), z.string()).optional(),
        checks: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              severity: CheckSeverity,
              source: z.string(),
              section: z.string().optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});

/** One value that differs between two versions, by JSON pointer; keyed list items by their key. */
export const RecordChange = z.object({
  path: z
    .string()
    .describe(
      "An attribute, e.g. /volume or /steps/coat/duration; /label and /status are the record's own",
    ),
  change: z.enum(['changed', 'added', 'removed']),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type RecordChange = z.infer<typeof RecordChange>;

export const recordsDiff = defineContract({
  id: 'records.diff',
  verbs: { done: 'compared versions of', intent: 'compare versions of' },
  summary:
    'What changed in a record between two versions, value by value (ADR 0053). By default, since the person (or the person you work for) last looked; if they never have, since it was first drafted',
  effect: 'read',
  input: z.strictObject({
    id: RecordId,
    from: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Default: the version last seen, or 1 if never seen'),
    to: z.number().int().positive().optional().describe('Default: the current version'),
  }),
  output: z.object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    /** Why `from` is what it is. */
    since: z.enum(['seen', 'first_drafted', 'given']),
    changes: z.array(RecordChange),
    /** The versions after `from` up to `to`: who changed it, through which operation, and why. */
    versions: z.array(
      z.object({
        version: z.number().int().positive(),
        actor: RecordVersion.shape.actor,
        via: z.string().optional(),
        reason: z.string().optional(),
        at: z.iso.datetime(),
      }),
    ),
  }),
});

export const recordsMarkSeen = defineContract({
  id: 'records.mark_seen',
  verbs: { done: 'looked at', intent: 'mark as seen' },
  summary:
    'Remember that you have seen a record at a version, so records.diff can say what changed since (people only; the record page does it when it opens)',
  effect: 'write',
  input: z.strictObject({ id: RecordId, version: z.number().int().positive() }),
  output: z.object({ id: RecordId, version: z.number().int().positive(), at: z.iso.datetime() }),
});
