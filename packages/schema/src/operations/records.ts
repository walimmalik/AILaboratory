import { z } from 'zod';
import { CheckSeverity, EvidenceInput, KindSection, Readiness } from '../design.ts';
import { RecordId } from '../ids.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope, RecordLink, RecordStatus, RecordVersion } from '../record.ts';

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
    'Where values came from, by attribute name, e.g. {"volume": {"source": "datasheet", "reference": "https://…"}}. Values an agent sets without naming a source are marked assumed until a person confirms them.',
  );

export const recordsCreate = defineContract({
  id: 'records.create',
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
  summary: 'Read a record by ID',
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: RecordEnvelope,
});

export const recordsList = defineContract({
  id: 'records.list',
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
  summary: "Change a record's label or attributes",
  effect: 'write',
  input: z.object({
    ...Target,
    label: z.string().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    evidence: Evidence,
  }),
  output: RecordEnvelope,
});

export const recordsActivate = defineContract({
  id: 'records.activate',
  summary:
    'Confirm a draft and make it active; for kinds with sections, every section must be confirmed and no blocker check may fail',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsConfirmSection = defineContract({
  id: 'records.confirm_section',
  summary:
    'A person confirms one section of a draft as it stands; any later change sends it back to review',
  effect: 'write',
  input: z.object({ ...Target, section: z.string().min(1) }),
  output: RecordEnvelope,
});

export const recordsReadiness = defineContract({
  id: 'records.readiness',
  summary:
    'What is confirmed, what changed since it was confirmed, what was assumed, and which readiness checks pass',
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: Readiness,
});

export const recordsArchive = defineContract({
  id: 'records.archive',
  summary: 'Archive a record: hidden from pickers, links keep working',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsUnarchive = defineContract({
  id: 'records.unarchive',
  summary: 'Return an archived record to its earlier status',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
});

export const recordsRestore = defineContract({
  id: 'records.restore',
  summary: 'Write a new version with the label and attributes of an earlier version',
  effect: 'write',
  input: z.object({ ...Target, version: z.number().int().positive() }),
  output: RecordEnvelope,
});

export const recordsDeleteDraft = defineContract({
  id: 'records.delete_draft',
  summary: 'Delete a draft that nothing links to (everything else can only be archived)',
  effect: 'write',
  input: z.object({ id: RecordId, expectedVersion: ExpectedVersion }),
  output: z.object({ deleted: z.literal(true), id: RecordId }),
});

export const recordsHistory = defineContract({
  id: 'records.history',
  summary: 'List every version of a record with who changed it and why',
  effect: 'read',
  input: z.object({ id: RecordId }),
  output: z.object({ versions: z.array(RecordVersion) }),
});

export const recordsLinks = defineContract({
  id: 'records.links',
  summary: 'List what a record links to ("from") or where it is used ("to")',
  effect: 'read',
  input: z.object({ id: RecordId, direction: z.enum(['from', 'to']) }),
  output: z.object({ links: z.array(RecordLink) }),
});

export const recordsKinds = defineContract({
  id: 'records.kinds',
  summary:
    "List the record kinds this lab can hold, with the JSON Schema of each kind's attributes (read this before records.create)",
  effect: 'read',
  input: z.object({}),
  output: z.object({
    kinds: z.array(
      z.object({
        kind: z.string(),
        idPrefix: z.string(),
        namePrefix: z.string(),
        attributes: z.record(z.string(), z.unknown()),
        sections: z.array(KindSection),
        checks: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            severity: CheckSeverity,
            source: z.string(),
            section: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
});
