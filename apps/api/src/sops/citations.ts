import type { Citation, CitationCheck, SopAttributes } from '@ailab/schema';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';

/** Checking an SOP's quotes against its library documents (plan 012c), shared by the check and the reviewer. */

export interface Passage {
  id: string;
  text: string;
  page?: number | null;
}

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

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

/** A document's passages through library.read, section by section; undefined until it is parsed. */
export async function passagesOf(
  deps: { registry: OperationRegistry; db: Db },
  ctx: RecordContext,
  document: string,
): Promise<Passage[] | undefined> {
  type Read = { outline?: { index: number }[]; passages?: Passage[] };
  const read = async (input: object) => {
    const result = await deps.registry.execute(
      ctx,
      'library.read',
      { document, ...input },
      {},
      deps.db,
    );
    return (result.status === 'done' ? result.output : {}) as Read;
  };
  const { outline } = await read({});
  if (!outline) return undefined;
  const out: Passage[] = [];
  for (const s of outline) out.push(...((await read({ section: s.index })).passages ?? []));
  return out;
}

/** Each citation checked against its document's text; also returns the texts it read. */
export async function checkCitations(
  deps: { registry: OperationRegistry; db: Db },
  ctx: RecordContext,
  a: SopAttributes,
  texts = new Map<string, Passage[] | undefined>(),
): Promise<{
  citations: z.infer<typeof CitationCheck>[];
  texts: Map<string, Passage[] | undefined>;
}> {
  const cited = citationsOf(a);
  for (const document of new Set(cited.map((c) => c.cite.document))) {
    if (!texts.has(document)) texts.set(document, await passagesOf(deps, ctx, document));
  }
  const citations = cited.map(({ where, cite }): z.infer<typeof CitationCheck> => {
    const base = {
      where,
      document: cite.document,
      ...(cite.passage ? { passage: cite.passage } : {}),
      quote: cite.quote,
    };
    const passages = texts.get(cite.document);
    if (!passages) return { ...base, result: 'unparsed' };
    const quote = normalized(cite.quote);
    const own = passages.find((p) => p.id === cite.passage);
    if (own && normalized(own.text).includes(quote)) return { ...base, result: 'matches' };
    const elsewhere = passages.find((p) => normalized(p.text).includes(quote));
    if (!elsewhere) return { ...base, result: 'not_found' };
    return cite.passage
      ? { ...base, result: 'found_elsewhere', foundIn: elsewhere.id }
      : { ...base, result: 'matches', foundIn: elsewhere.id };
  });
  return { citations, texts };
}
