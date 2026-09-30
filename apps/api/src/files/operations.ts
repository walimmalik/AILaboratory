import {
  type FileAttributes,
  filesGet,
  filesUpload,
  MAX_FILE_BYTES,
  type RecordEnvelope,
} from '@ailab/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { records } from '../db/schema.ts';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';

const BASE64 = /^[A-Za-z0-9+/\s]*={0,2}\s*$/;

/** Media types read back as text. */
export function isTextType(mediaType: string) {
  return (
    mediaType.startsWith('text/') ||
    /^application\/(json|xml|x-yaml|yaml|javascript|x-python|x-sh|ld\+json)$/.test(mediaType) ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml')
  );
}

export const fileOperations = [
  implement(filesUpload, {
    agentPolicy: 'direct',
    run: async (ctx, input, deps) => {
      let bytes: Uint8Array;
      if (input.text !== undefined) bytes = new TextEncoder().encode(input.text);
      else {
        const base64 = input.base64 as string;
        if (!BASE64.test(base64)) {
          throw new OperationError('invalid_input', 'The content is not valid base64');
        }
        bytes = new Uint8Array(Buffer.from(base64, 'base64'));
      }
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new OperationError(
          'invalid_input',
          `${input.name} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; files can be up to 50 MB`,
        );
      }
      const sha256 = await deps.files.put(bytes);
      const service = new RecordService(deps.db, deps.kinds);
      const [existing] = await deps.db
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.labId, ctx.labId),
            eq(records.kind, 'file'),
            ne(records.status, 'archived'),
            sql`${records.attributes}->>'sha256' = ${sha256}`,
          ),
        )
        .limit(1);
      if (existing) return { file: await service.get(ctx, existing.id), stored: false };
      const attributes: FileAttributes = {
        sha256,
        size: bytes.byteLength,
        mediaType: input.mediaType,
        originalName: input.name,
        source: input.source ?? { from: 'upload' },
      };
      const file = await service.create(ctx, {
        kind: 'file',
        label: input.name,
        attributes,
        status: 'active',
        reason: input.reason ?? `Stored ${input.name}`,
      });
      return { file, stored: true };
    },
  }),
  implement(filesGet, {
    run: async (ctx, input, deps) => {
      const file = await new RecordService(deps.db, deps.kinds).get(ctx, input.id);
      const as = input.as ?? (isTextType(attributesOf(file).mediaType) ? 'text' : 'base64');
      if (as === 'none') return { file };
      const bytes = await readBytes(file, deps.files);
      return as === 'text'
        ? { file, text: new TextDecoder().decode(bytes) }
        : { file, base64: Buffer.from(bytes).toString('base64') };
    },
  }),
];

const attributesOf = (file: RecordEnvelope) => file.attributes as FileAttributes;

/** The bytes of a file record, or an error when the store has lost them. */
export async function readBytes(
  file: RecordEnvelope,
  store: { get(sha256: string): Promise<Uint8Array | undefined> },
): Promise<Uint8Array> {
  if (file.kind !== 'file') throw new OperationError('invalid_input', `${file.name} is not a file`);
  const bytes = await store.get(attributesOf(file).sha256);
  if (!bytes) {
    throw new OperationError(
      'not_found',
      `The bytes of ${file.name} are missing from the file store (FILE_STORE_DIR)`,
    );
  }
  return bytes;
}
