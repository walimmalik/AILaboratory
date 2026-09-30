import {
  type DocumentAttributes,
  type DocumentFile,
  libraryAdd,
  libraryAddRevision,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';

export const libraryOperations = [
  implement(libraryAdd, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) =>
      new RecordService(deps.db, deps.kinds).create(ctx, {
        kind: 'document',
        label,
        attributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Added ${label} to the library`,
      }),
  }),
  implement(libraryAddRevision, {
    agentPolicy: async (ctx, input, deps) =>
      (await new RecordService(deps.db, deps.kinds).get(ctx, input.document)).status === 'active'
        ? 'propose'
        : 'direct',
    run: async (ctx, input, deps) => {
      const service = new RecordService(deps.db, deps.kinds);
      const document = await service.get(ctx, input.document);
      if (document.kind !== 'document') {
        throw new OperationError('invalid_input', `${document.name} is not a library document`);
      }
      const a = document.attributes as DocumentAttributes;
      if (a.files.some((f) => f.file === input.file)) {
        throw new OperationError('invalid_input', `${input.file} is already one of its files`);
      }
      const files: DocumentFile[] = [
        { file: input.file, role: 'original' },
        ...a.files.map((f) =>
          f.role === 'original'
            ? {
                file: f.file,
                role: 'earlier_revision' as const,
                ...(a.version ? { revision: a.version } : {}),
              }
            : f,
        ),
      ];
      const { version: _v, published: _p, ...rest } = a;
      return service.update(ctx, document.id, {
        expectedVersion: input.expectedVersion,
        attributes: {
          ...rest,
          files,
          ...(input.version ? { version: input.version } : {}),
          ...(input.published ? { published: input.published } : {}),
        },
        reason: input.reason ?? `New revision${input.version ? ` ${input.version}` : ''}`,
      });
    },
  }),
];
