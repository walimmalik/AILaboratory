import {
  type Citation,
  ExactSourceCitation,
  type ExactSourceReference,
  libraryRead,
  type PassageText,
  SopAttributes,
} from '@ailab/schema';
import type { Db } from '../db/client.ts';
import { OperationError } from '../operations/errors.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import { stable } from '../records/pins.ts';
import type { RecordContext } from '../records/service.ts';
import { citationsOf } from './citations.ts';

type Deps = { registry: OperationRegistry; db: Db };

/** A textual occurrence is evidence of these words, never scientific support or approval. */
export type SopExactSourceRead =
  | { status: 'unbound'; citations: { where: string; cite: Citation; result: 'unchecked' }[] }
  | {
      status: 'unavailable';
      source: ExactSourceReference;
      citations: { where: string; cite: Citation; result: 'unchecked' }[];
      warnings: string[];
    }
  | {
      status: 'checked';
      source: ExactSourceReference & { parse: { status: 'parsed'; snapshot: string } };
      passages: PassageText[];
      warnings: string[];
      citations: { where: string; cite: Citation; exact: ExactSourceCitation }[];
    };

/** Optional, caller-owned immutable text cache. Access/bytes/snapshot are rechecked on every use. */
export class SopExactSourceCache {
  constructor() {
    cachedPassages.set(this, new Map());
  }
}
// No public setter or mutable cache view can provide fabricated text to the checker.
const cachedPassages = new WeakMap<SopExactSourceCache, Map<string, PassageText[]>>();
export const whitespace = (text: string) => text.replace(/\s+/gu, ' ').trim();

export function exactSopSourceKey(ctx: RecordContext, source: ExactSourceReference) {
  return stable({ org: ctx.orgId, lab: ctx.labId, source });
}

async function read(deps: Deps, ctx: RecordContext, input: object) {
  const result = await deps.registry.execute(ctx, 'library.read', input, {}, deps.db);
  if (result.status !== 'done')
    throw new OperationError('invalid_state', 'Exact text was not read');
  return libraryRead.output.parse(result.output);
}

/** The private SOP reader never discovers current text, including for old unbound records. */
export async function readSopExactSource(
  deps: Deps,
  ctx: RecordContext,
  attributes: SopAttributes,
  cache: SopExactSourceCache = new SopExactSourceCache(),
): Promise<SopExactSourceRead> {
  const citations = citationsOf(attributes);
  const unchecked = citations.map(({ where, cite }) => ({
    where,
    cite,
    result: 'unchecked' as const,
  }));
  const selected = attributes.source?.exact;
  if (!selected) return { status: 'unbound', citations: unchecked };
  if (attributes.source?.document !== selected.document)
    throw new OperationError('invalid_input', 'The SOP source and exact document must agree');
  const outline = await read(deps, ctx, { source: selected });
  const canonical = outline.source;
  if (!canonical)
    throw new OperationError('invalid_state', 'The selected instructions have no file');
  if (canonical.parse.status === 'unavailable') {
    if (citations.length)
      throw new OperationError(
        'invalid_input',
        'Unchecked instructions cannot supply checked citations',
      );
    // Library preserves the caller's unavailable reason. It is not conversion evidence.
    return {
      status: 'unavailable',
      source: {
        ...canonical,
        parse: {
          status: 'unavailable',
          reason: 'No checked text was selected for this saved file',
        },
      },
      citations: unchecked,
      warnings: [],
    };
  }
  if (!outline.parse || !outline.outline)
    throw new OperationError('invalid_state', 'The selected parsed instructions are unavailable');
  const source = { ...canonical, parse: canonical.parse };
  const key = exactSopSourceKey(ctx, source);
  const retained = cachedPassages.get(cache);
  let passages = retained?.get(key);
  if (!passages) {
    passages = [];
    for (const section of outline.outline) {
      const text = await read(deps, ctx, { source, section: section.index });
      passages.push(...(text.passages ?? []));
    }
    retained?.set(key, structuredClone(passages));
  }
  const checked = citations.map(({ where, cite }) => {
    if (cite.document !== source.document)
      throw new OperationError(
        'invalid_input',
        `${where}: citations must use the selected source document`,
      );
    const quote = whitespace(cite.quote);
    if (!cite.passage || !quote)
      throw new OperationError('invalid_input', `${where}: name a passage and nonempty quotation`);
    const passage = passages.find((p) => p.id === cite.passage);
    if (!passage)
      throw new OperationError('invalid_input', `${where}: the selected passage is unavailable`);
    if (cite.page !== undefined && cite.page !== passage.page)
      throw new OperationError(
        'invalid_input',
        `${where}: the page contradicts the selected passage`,
      );
    if (!whitespace(passage.text).includes(quote))
      throw new OperationError(
        'invalid_input',
        `${where}: the quotation is absent from its selected passage`,
      );
    const verified: Citation = {
      document: source.document,
      passage: passage.id,
      ...(passage.page ? { page: passage.page } : {}),
      quote,
    };
    return {
      where,
      cite: verified,
      exact: ExactSourceCitation.parse({
        source,
        passage: verified.passage,
        page: verified.page,
        quote: verified.quote,
      }),
    };
  });
  return {
    status: 'checked',
    source,
    passages: structuredClone(passages),
    warnings: outline.parse.warnings,
    citations: checked,
  };
}

/** Canonical root metadata and every citation come only from the authenticated exact reader. */
export async function canonicalizeSopExactSource(
  deps: Deps,
  ctx: RecordContext,
  input: SopAttributes,
) {
  const attributes = SopAttributes.parse(structuredClone(input));
  const result = await readSopExactSource(deps, ctx, attributes);
  if (result.status === 'unbound') return { attributes, result };
  attributes.source = {
    document: result.source.document,
    ...(result.source.printedRevision ? { revision: result.source.printedRevision } : {}),
    exact: result.source,
  };
  if (result.status === 'checked') {
    citationsOf(attributes).forEach(({ cite }, index) => {
      const canonical = result.citations[index]?.cite;
      if (!canonical) throw new OperationError('invalid_state', 'Citation mapping is incomplete');
      delete cite.page;
      Object.assign(cite, canonical);
    });
  }
  return { attributes, result };
}
