import type { Citation, CitationCheck, SopAttributes } from '@ailab/schema';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { readSopExactSource, SopExactSourceCache } from './exact-source.ts';

/** Checking an SOP's quotes against its library documents (plan 012c), shared by the check and the reviewer. */

export interface Passage {
  id: string;
  text: string;
  page?: number | null | undefined;
}

/** Every citation in an SOP, with what cites it. */
export function citationsOf(a: SopAttributes): { where: string; cite: Citation }[] {
  const out: { where: string; cite: Citation }[] = [];
  const add = (where: string, cites: Citation[] | undefined) => {
    for (const cite of cites ?? []) out.push({ where, cite });
  };
  for (const m of a.materials) add(`material ${m.role}`, m.cite);
  for (const s of a.solutions ?? []) add(`solution ${s.role}`, s.cite);
  for (const v of a.variables) add(`variable ${v.name}`, v.cite);
  for (const s of a.steps) add(`step ${s.id}`, s.cite);
  for (const l of a.layout ?? []) add(`layout ${l.label}`, l.cite);
  for (const t of a.timing ?? []) add(`timing of step ${t.step}`, t.cite);
  for (const q of a.questions ?? []) add(`question ${q.id}`, q.passages);
  return out;
}

/** The one current checker: exact retained text or an explicit unchecked result, never discovery. */
export async function checkCitations(
  deps: { registry: OperationRegistry; db: Db },
  ctx: RecordContext,
  a: SopAttributes,
  cache = new SopExactSourceCache(),
) {
  const source = await readSopExactSource(deps, ctx, a, cache);
  const citations: z.infer<typeof CitationCheck>[] =
    source.status === 'checked'
      ? source.citations.map(({ where, cite, exact }) => ({
          where,
          ...cite,
          result: 'matches',
          exact,
        }))
      : source.citations.map(({ where, cite }) => ({
          where,
          ...cite,
          result: 'unchecked',
          uncheckedReason:
            source.status === 'unbound' ? 'edition_not_established' : 'text_unavailable',
        }));
  return { citations, source };
}
