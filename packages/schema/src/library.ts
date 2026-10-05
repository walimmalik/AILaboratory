import { z } from 'zod';
import { Actor } from './actor.ts';
import { FileId, Sha256 } from './files.ts';
import { RecordId, recordIdOf } from './ids.ts';
import { Quantity } from './quantity.ts';

/**
 * Library documents (plan 011a, S1): the source as published (an SOP, a vendor manual, a paper,
 * robot protocol code, a web page, a note), with its files and metadata. One record per source; a
 * revision is a new version of the same record. Digital SOPs (012) are built from these.
 */

export const DocumentId = recordIdOf('doc');

/** Plan 004g/SG-18 foundation: immutable converted text, not the document's current parse. */
export const SourceParseIdentity = z.strictObject({
  status: z.literal('parsed'),
  snapshot: Sha256.describe('Content digest identifying the immutable converted-text snapshot'),
});

/** Exact instructions selected for a method; printed edition metadata never selects the bytes. */
export const ExactSourceReference = z.strictObject({
  document: DocumentId,
  version: z.number().int().positive(),
  file: FileId,
  sha256: Sha256,
  parse: z.discriminatedUnion('status', [
    SourceParseIdentity,
    z.strictObject({ status: z.literal('unavailable'), reason: z.string().min(1) }),
  ]),
  title: z.string().min(1),
  printedRevision: z.string().min(1).optional(),
});
export type ExactSourceReference = z.infer<typeof ExactSourceReference>;

/** A checked quotation must name the immutable parse snapshot that supplied its passage. */
export const ExactSourceCitation = z.strictObject({
  source: ExactSourceReference.extend({ parse: SourceParseIdentity }),
  passage: z.string().min(1),
  page: z.number().int().positive().optional(),
  quote: z.string().min(1),
});
export type ExactSourceCitation = z.infer<typeof ExactSourceCitation>;

export const DocumentType = z
  .enum(['sop', 'vendor_manual', 'paper', 'protocol_code', 'web_page', 'note'])
  .describe(
    'sop, vendor_manual, paper, protocol_code (Opentrons, LabOP, PyLabRobot), web_page or note',
  );
export type DocumentType = z.infer<typeof DocumentType>;

export const SharePolicy = z
  .enum(['shareable', 'lab_private'])
  .describe(
    'lab_private for All Rights Reserved and non-commercial items: searchable in the lab, never written to seed/ or any export',
  );

export const DocumentLicense = z.strictObject({
  name: z
    .string()
    .min(1)
    .describe('As the source states it, e.g. "CC BY 4.0", "All Rights Reserved"'),
  url: z.url().optional(),
  sharePolicy: SharePolicy,
});
export type DocumentLicense = z.infer<typeof DocumentLicense>;

export const DocumentFileRole = z
  .enum(['original', 'alternate', 'supplement', 'earlier_revision'])
  .describe(
    'original: the source itself; alternate: the same content in another form (the DOCX of a PDF); supplement: a figure, plate map or data file that goes with it; earlier_revision: the file a newer revision replaced',
  );

export const DocumentFile = z.strictObject({
  file: FileId,
  role: DocumentFileRole,
  revision: z
    .string()
    .min(1)
    .optional()
    .describe('The revision this file is, for earlier revisions'),
});
export type DocumentFile = z.infer<typeof DocumentFile>;

/** A year, a year and month, or a date: "2018", "2018-05", "2018-05-14". */
export const PublishedDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'a year, year-month or date, e.g. 2018 or 2018-05-14');

export const Doi = z
  .string()
  .regex(
    /^10\.\d{4,9}\/\S+$/,
    'a DOI like 10.17504/protocols.io.mf2c3qe, without https://doi.org/',
  );

export const DocumentAttributes = z.strictObject({
  type: DocumentType,
  authors: z.array(z.string().min(1)).optional().describe('People or groups, as credited'),
  vendor: recordIdOf('vnd').optional().describe('For vendor manuals: the vendor record'),
  version: z
    .string()
    .min(1)
    .optional()
    .describe('Its version or revision as printed, e.g. "TB288 rev. 3/23"'),
  published: PublishedDate.optional(),
  doi: Doi.optional(),
  url: z.url().optional().describe('Where it is published'),
  journal: z.string().min(1).optional().describe('Papers: the journal or book'),
  partNumbers: z
    .array(z.string().min(1))
    .optional()
    .describe('Vendor manuals: the catalog numbers it covers'),
  language: z
    .string()
    .min(1)
    .optional()
    .describe('Protocol code: the language and API, e.g. "Python, Opentrons API 2.19"'),
  license: DocumentLicense,
  assays: z
    .array(z.string().min(1))
    .optional()
    .describe('Assay types it is about, e.g. ["ELISA"], ["Golden Gate assembly"]'),
  tags: z.array(z.string().min(1)).optional(),
  files: z.array(DocumentFile).describe('Its stored files; exactly one is the original'),
  notes: z.string().min(1).optional(),
});
export type DocumentAttributes = z.infer<typeof DocumentAttributes>;

/** A passage: a stretch of text short enough to search and cite, with its page when known. */
export const ConvertedPassage = z.object({
  text: z.string(),
  page: z.number().int().positive().nullish(),
});

/** Text under one heading path, e.g. ["Protocol", "Coating"], as the science service returns it. */
export const ConvertedSection = z.object({
  heading: z.array(z.string()),
  pageFrom: z.number().int().positive().nullish(),
  pageTo: z.number().int().positive().nullish(),
  passages: z.array(ConvertedPassage),
});

/** What the science service's `/convert` returns (plan 011b). */
export const Converted = z.object({
  converter: z.string().min(1),
  sections: z.array(ConvertedSection),
  warnings: z.array(z.string()),
});
export type Converted = z.infer<typeof Converted>;

/** How a document's file was turned into text. */
export const DocumentParse = z.object({
  file: FileId,
  sha256: z.string(),
  converter: z.string(),
  sections: z.number().int().min(0),
  passages: z.number().int().min(0),
  warnings: z.array(z.string()),
  parsedAt: z.iso.datetime(),
});
export type DocumentParse = z.infer<typeof DocumentParse>;

export const SectionOutline = z.object({
  index: z.number().int().min(0),
  heading: z.array(z.string()),
  pageFrom: z.number().int().positive().nullish(),
  pageTo: z.number().int().positive().nullish(),
  passages: z.number().int().min(0),
});

export const PassageText = z.object({
  id: z.string(),
  section: z.number().int().min(0),
  heading: z.array(z.string()),
  page: z.number().int().positive().nullish(),
  text: z.string(),
});
export type PassageText = z.infer<typeof PassageText>;

/** How a mention was found: the deterministic matcher, or an agent reading the passage. */
export const MentionHow = z.enum(['catalog_number', 'name', 'synonym', 'model', 'agent']);

export const MentionStatus = z.enum(['proposed', 'confirmed', 'rejected']);

/**
 * What a passage mentions (plan 011c, S6): a registry record, an assay type, or a stated
 * parameter with its quantity. Proposed by the matcher or an agent, confirmed by a person.
 */
export const Mention = z.object({
  id: z.string(),
  document: DocumentId,
  passage: z.string().describe('The passage it is in'),
  section: z.number().int().min(0),
  heading: z.array(z.string()),
  page: z.number().int().positive().nullish(),
  text: z.string().describe('As written in the passage'),
  what: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('record'),
      record: RecordId,
      kind: z.string(),
      name: z.string(),
      label: z.string(),
    }),
    z.object({ type: z.literal('assay'), assay: z.string() }),
    z.object({ type: z.literal('parameter'), parameter: z.string(), value: Quantity }),
  ]),
  how: MentionHow,
  status: MentionStatus,
  proposedBy: Actor,
  proposedAt: z.iso.datetime(),
  reviewedBy: Actor.optional(),
  reviewedAt: z.iso.datetime().optional(),
});
export type Mention = z.infer<typeof Mention>;
