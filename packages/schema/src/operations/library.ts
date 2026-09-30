import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { FileId } from '../files.ts';
import { DocumentAttributes, DocumentId, PublishedDate } from '../library.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');

export const libraryAdd = defineContract({
  id: 'library.add',
  summary:
    'Add a document to the library as a draft: an SOP, vendor manual, paper, robot protocol code, web page or note, with its stored files (upload them first with files.upload) and what you know of its source and license. A person confirms it',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('Its title as published'),
    ...DocumentAttributes.shape,
    evidence: z
      .record(z.string(), EvidenceInput)
      .optional()
      .describe('Where values came from, by attribute name; unsourced values are marked assumed'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const libraryAddRevision = defineContract({
  id: 'library.add_revision',
  summary:
    'Record a new revision of a library document: its new file becomes the original and the old one stays as an earlier revision. Digital SOPs built from the old revision keep citing it. A proposal when the document is confirmed',
  effect: 'write',
  input: z.strictObject({
    document: DocumentId,
    expectedVersion: z.number().int().positive().describe('The version you last read'),
    file: FileId.describe('The new revision, stored with files.upload'),
    version: z.string().min(1).optional().describe('Its version as printed'),
    published: PublishedDate.optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});
