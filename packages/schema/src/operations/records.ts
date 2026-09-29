import { z } from 'zod';
import { RecordId } from '../ids.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope, RecordLink, RecordVersion } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why the change was made; kept in history');
const ExpectedVersion = z
  .number()
  .int()
  .positive()
  .describe('The version you last read; the change is refused if the record has moved on');
const Target = { id: RecordId, expectedVersion: ExpectedVersion, reason: Reason };

export const recordsCreate = defineContract({
  id: 'records.create',
  summary: 'Create a record of a registered kind, as a draft unless status is "active"',
  effect: 'write',
  input: z.object({
    kind: z.string().min(1),
    label: z.string(),
    attributes: z.record(z.string(), z.unknown()),
    status: z.enum(['draft', 'active']).optional(),
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

export const recordsUpdate = defineContract({
  id: 'records.update',
  summary: "Change a record's label or attributes",
  effect: 'write',
  input: z.object({
    ...Target,
    label: z.string().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }),
  output: RecordEnvelope,
});

export const recordsActivate = defineContract({
  id: 'records.activate',
  summary: 'Make a draft record active',
  effect: 'write',
  input: z.object(Target),
  output: RecordEnvelope,
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
