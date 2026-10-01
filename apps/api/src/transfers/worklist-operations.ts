import { worklistsDraftFormat } from '@ailab/schema';
import { readBytes } from '../files/operations.ts';
import { OperationError } from '../operations/errors.ts';
import { implement, type OperationDeps } from '../operations/registry.ts';
import { RecordService } from '../records/service.ts';
import { parseCsv } from './echo.ts';

/** Worklist format operations (plan 016c, T1): draft one from the lab's example file. */

const service = (deps: Pick<OperationDeps, 'db' | 'kinds'>) =>
  new RecordService(deps.db, deps.kinds);

/** Where the headers a format declares differ from the example file's, in words. */
export function headerMismatch(expected: string[], found: string[]): string | undefined {
  const at = expected.findIndex((h, i) => h !== found[i]);
  if (at < 0 && found.length === expected.length) return undefined;
  if (at < 0)
    return `The example has ${found.length} headers, the format ${expected.length}: ${found.join(', ')}`;
  return `Header ${at + 1} is "${found[at] ?? '(none)'}" in the example, not "${expected[at]}"`;
}

export const worklistOperations = [
  implement(worklistsDraftFormat, {
    agentPolicy: 'direct',
    run: async (ctx, { label, evidence, reason, ...attributes }, deps) => {
      if (attributes.example) {
        const records = service(deps);
        const file = await records.get(ctx, attributes.example).catch(() => undefined);
        if (file?.kind !== 'file')
          throw new OperationError('not_found', `${attributes.example} is not a file in this lab`);
        const rows = parseCsv(new TextDecoder().decode(await readBytes(file, deps.files)));
        const layout = attributes.layout;
        const mismatch =
          layout.layout === 'rows'
            ? headerMismatch(
                layout.columns.map((c) => c.header),
                rows[0] ?? [],
              )
            : headerMismatch(
                layout.preamble.map((c) => c.header),
                rows.slice(0, layout.preamble.length).map((r) => r[0] ?? ''),
              );
        if (mismatch)
          throw new OperationError(
            'invalid_input',
            `The columns don't match ${file.label}: ${mismatch}`,
          );
      }
      return service(deps).create(ctx, {
        kind: 'worklist_format',
        label,
        attributes,
        ...(evidence ? { evidence } : {}),
        reason: reason ?? `Drafted the worklist format ${label}`,
      });
    },
  }),
];
