import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { FileId } from '../files.ts';
import {
  DocumentAttributes,
  DocumentId,
  DocumentParse,
  DocumentType,
  PassageText,
  PublishedDate,
  SectionOutline,
} from '../library.ts';
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

export const libraryParse = defineContract({
  id: 'library.parse',
  summary:
    "Turn a document's original file (or another of its files) into sections and passages for search and citation. Runs again after a new revision. Markdown, HTML, code and text now; PDF and DOCX come with the Docling conversion",
  effect: 'write',
  input: z.strictObject({
    document: DocumentId,
    file: FileId.optional().describe('Defaults to the original'),
  }),
  output: z.object({ document: RecordEnvelope, parse: DocumentParse }),
});

export const librarySearch = defineContract({
  id: 'library.search',
  summary:
    'Search the text of the library: passages that match words or phrases (quote a phrase, -word to exclude, "or" between alternatives), best first, each with its document, heading and page. Filter by document type or assay',
  effect: 'read',
  input: z.strictObject({
    text: z.string().min(1).describe('e.g. "TMB" or "blocking time" or "DY206"'),
    type: DocumentType.optional(),
    assay: z.string().min(1).optional().describe('Only documents tagged with this assay'),
    document: DocumentId.optional().describe('Only this document'),
    limit: z.number().int().min(1).max(50).optional().describe('Default 10'),
  }),
  output: z.object({
    hits: z.array(
      z.object({
        document: z.object({
          id: z.string(),
          name: z.string(),
          label: z.string(),
          type: DocumentType,
        }),
        passage: PassageText,
        snippet: z.string().describe('The passage around the match, matches between [[ and ]]'),
        rank: z.number(),
      }),
    ),
  }),
});

export const libraryRead = defineContract({
  id: 'library.read',
  summary:
    "Read a parsed document: without `section`, its outline (headings, pages, passage counts); with `section`, that section's passages in order; with `pages`, the passages on those pages",
  effect: 'read',
  input: z.strictObject({
    document: DocumentId,
    section: z.number().int().min(0).optional().describe('A section index from the outline'),
    pages: z
      .strictObject({ from: z.number().int().positive(), to: z.number().int().positive() })
      .optional(),
  }),
  output: z.object({
    document: RecordEnvelope,
    parse: DocumentParse.optional().describe('Absent until library.parse has run'),
    outline: z.array(SectionOutline).optional(),
    passages: z.array(PassageText).optional(),
  }),
});
