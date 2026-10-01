import type { EvidenceInput } from '@ailab/schema';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Evidence for the list items that still hold what the assistant suggested: assumed, with its
 * reason, so a suggestion saved without a change stays unverified until the one Confirm. An item the
 * person changed after the suggestion is theirs.
 */
export function untouchedSuggestions(
  suggested: Record<string, { item: unknown; note: string }>,
  attributes: Record<string, unknown>,
): Record<string, EvidenceInput> {
  return Object.fromEntries(
    Object.entries(suggested).flatMap(([path, { item, note }]) => {
      const [list = '', key] = path.split('/').slice(1);
      const now = (Array.isArray(attributes[list]) ? attributes[list] : []) as Record<
        string,
        unknown
      >[];
      const held = now.find((i) => [i.id, i.name, i.role].includes(key));
      return held && same(held, item) ? [[path, { source: 'assumed' as const, note }]] : [];
    }),
  );
}
