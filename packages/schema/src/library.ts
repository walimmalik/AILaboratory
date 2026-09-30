import { z } from 'zod';
import { FileId } from './files.ts';
import { recordIdOf } from './ids.ts';

/**
 * Library documents (plan 011a, S1): the source as published (an SOP, a vendor manual, a paper,
 * robot protocol code, a web page, a note), with its files and metadata. One record per source; a
 * revision is a new version of the same record. Digital SOPs (012) are built from these.
 */

export const DocumentId = recordIdOf('doc');

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
