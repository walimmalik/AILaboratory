import { z } from 'zod';
import { FileId, FileSource, MediaType } from '../files.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

export const filesUpload = defineContract({
  id: 'files.upload',
  verbs: { done: 'uploaded a file', intent: 'upload a file' },
  summary:
    'Store a file (a PDF, DOCX, Markdown, code, an image, a CSV) and get its file record (FIL-0001). Send the bytes as base64, or plain text as `text`. Up to 50 MB. The same bytes uploaded again return the existing record',
  effect: 'write',
  input: z
    .strictObject({
      name: z.string().min(1).max(255).describe('The file name, e.g. "DY206 ELISA.pdf"'),
      mediaType: MediaType,
      base64: z.string().min(1).optional().describe('The bytes, base64 encoded'),
      text: z.string().optional().describe('Or the content as UTF-8 text'),
      source: FileSource.optional().describe('Defaults to an upload'),
      reason: z.string().min(1).optional(),
    })
    .refine((i) => (i.base64 === undefined) !== (i.text === undefined), {
      message: 'Give the content as either base64 or text',
    }),
  output: z.object({
    file: RecordEnvelope,
    stored: z.boolean().describe('False when these bytes were already in the lab'),
  }),
});

export const filesGet = defineContract({
  id: 'files.get',
  verbs: { done: 'opened a file', intent: 'open a file' },
  summary:
    "Read a file's record and its bytes: as text for text files (Markdown, code, CSV, JSON, HTML), as base64 otherwise. People open it in the app at /api/v1/files/<id>",
  effect: 'read',
  input: z.strictObject({
    id: FileId,
    as: z
      .enum(['text', 'base64', 'none'])
      .optional()
      .describe('Defaults to text for text files and base64 for others; none for the record only'),
  }),
  output: z.object({
    file: RecordEnvelope,
    text: z.string().optional(),
    base64: z.string().optional(),
  }),
});
