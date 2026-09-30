import { z } from 'zod';
import { RecordId, recordIdOf } from './ids.ts';

/**
 * Files (plan 011a, ADR 0033): the bytes of an original or derived file live in a content-addressed
 * store, named by their sha256; a `file` record (`fil_`, `FIL-0001`) says what they are and where
 * they came from. Identical bytes are stored once, and one lab holds one record per hash.
 */

export const FileId = recordIdOf('fil');

export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256')
  .describe('The sha256 of the bytes, lowercase hex');

export const MediaType = z
  .string()
  .regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'must be a media type like application/pdf')
  .describe('Media type, e.g. application/pdf, text/markdown, text/x-python');

/** Largest file the store takes: 50 MB. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const FileSource = z
  .discriminatedUnion('from', [
    z.strictObject({ from: z.literal('upload') }),
    z.strictObject({ from: z.literal('url'), url: z.url() }),
    z.strictObject({
      from: z.literal('folder'),
      path: z.string().min(1).describe('Its path inside the imported folder'),
    }),
    z.strictObject({
      from: z.literal('derived'),
      file: FileId.describe('The file it was made from, e.g. the PDF a figure was cut from'),
    }),
    z.strictObject({
      from: z.literal('export'),
      record: RecordId.describe('The record it was written from, e.g. a transfer plan'),
      version: z.number().int().min(1).describe('The version of that record'),
    }),
  ])
  .describe('Where the file came from');
export type FileSource = z.infer<typeof FileSource>;

export const FileAttributes = z.strictObject({
  sha256: Sha256,
  size: z.number().int().min(0).max(MAX_FILE_BYTES).describe('Bytes'),
  mediaType: MediaType,
  originalName: z.string().min(1).max(255).describe('Its file name when it arrived'),
  source: FileSource,
});
export type FileAttributes = z.infer<typeof FileAttributes>;
