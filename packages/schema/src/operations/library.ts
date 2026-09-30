import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { FileId } from '../files.ts';
import { RecordId } from '../ids.ts';
import {
  DocumentAttributes,
  DocumentId,
  DocumentParse,
  DocumentType,
  Mention,
  MentionStatus,
  PassageText,
  PublishedDate,
  SectionOutline,
} from '../library.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
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

const Mentions = z.object({ mentions: z.array(Mention) });

export const libraryMine = defineContract({
  id: 'library.mine',
  summary:
    'Find the registry records a parsed document names (catalog numbers, product and labware names, instrument models, entity names and synonyms) and propose them as mentions for a person to confirm. Deterministic; then read the passages and add what it missed with library.propose_mentions',
  effect: 'write',
  input: z.strictObject({ document: DocumentId }),
  output: Mentions.extend({ added: z.number().int().min(0) }),
});

export const libraryProposeMentions = defineContract({
  id: 'library.propose_mentions',
  summary:
    'Propose what passages of a parsed document mention: a registry record, the assay type, or a stated parameter as a quantity with its unit (a volume, concentration, time, temperature, speed). Each cites the passage and the words as written. A person confirms them',
  effect: 'write',
  input: z.strictObject({
    document: DocumentId,
    mentions: z
      .array(
        z.strictObject({
          passage: z.string().describe('A passage id from library.read or library.search'),
          text: z.string().min(1).describe('The words as written in the passage'),
          record: RecordId.optional().describe('The registry record it names'),
          assay: z.string().min(1).optional().describe('The assay type, e.g. "ELISA"'),
          parameter: z
            .strictObject({
              name: z
                .string()
                .min(1)
                .describe('What it is, e.g. "blocking time", "coating volume"'),
              value: Quantity,
            })
            .optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  output: Mentions.extend({ added: z.number().int().min(0) }),
});

export const libraryMentions = defineContract({
  id: 'library.mentions',
  summary:
    'List mentions: of one document, or of one record across the library ("which SOPs use DY206?"), or a parameter by name across documents ("what blocking times do our ELISAs use?"), filtered by status',
  effect: 'read',
  input: z.strictObject({
    document: DocumentId.optional(),
    record: RecordId.optional(),
    parameter: z.string().min(1).optional().describe('Words in the parameter name'),
    status: MentionStatus.optional().describe('Default: proposed and confirmed'),
    limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
  }),
  output: Mentions.extend({
    documents: z.array(z.object({ id: z.string(), name: z.string(), label: z.string() })),
  }),
});

export const libraryReviewMentions = defineContract({
  id: 'library.review_mentions',
  summary: 'Confirm or reject proposed mentions, in bulk. People only',
  effect: 'write',
  input: z.strictObject({
    confirm: z.array(z.string()).optional(),
    reject: z.array(z.string()).optional(),
  }),
  output: z.object({ confirmed: z.number().int(), rejected: z.number().int() }),
});
