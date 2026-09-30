/**
 * Finding registry records a library passage names (plan 011c): catalog numbers, product and
 * labware names, instrument models, entity names and synonyms. Deterministic, so what an agent
 * proposes on top starts from the same matches every time.
 */

export type MatchHow = 'catalog_number' | 'name' | 'synonym' | 'model';

export interface MatchTerm {
  text: string;
  how: MatchHow;
}

export interface MatchCandidate {
  recordId: string;
  terms: readonly MatchTerm[];
}

export interface MatchedMention {
  passageId: string;
  recordId: string;
  /** As written in the passage. */
  text: string;
  how: MatchHow;
  /** Where in the passage text it starts. */
  start: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names shorter than this are too likely to match by chance ("PBS" is fine as a catalog number). */
const MIN_NAME = 4;
const MIN_CODE = 3;

/**
 * A term as a pattern bounded by non-word characters on both sides. Spaces and dashes inside a
 * term match any run of spaces or a dash, so "Corning 3570" finds "Corning  3570" and "DY206" finds
 * "DY206" but not "DY2060".
 */
function patternOf(term: string): RegExp {
  const body = term
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join('[\\s-]+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Every mention of a candidate in the passages, once per passage and record (the first place). */
export function matchMentions(
  passages: readonly { id: string; text: string }[],
  candidates: readonly MatchCandidate[],
): MatchedMention[] {
  const compiled = candidates.flatMap((c) =>
    c.terms
      .filter((t) => t.text.trim().length >= (t.how === 'catalog_number' ? MIN_CODE : MIN_NAME))
      .map((t) => ({ recordId: c.recordId, how: t.how, pattern: patternOf(t.text) })),
  );
  const found = new Map<string, MatchedMention>();
  for (const passage of passages) {
    for (const { recordId, how, pattern } of compiled) {
      pattern.lastIndex = 0;
      const match = pattern.exec(passage.text);
      if (!match) continue;
      const key = `${passage.id}\u0000${recordId}`;
      const earlier = found.get(key);
      // A catalog number is the surest evidence; otherwise keep the first place it appears.
      if (
        !earlier ||
        (how === 'catalog_number' && earlier.how !== 'catalog_number') ||
        (how === earlier.how && match.index < earlier.start)
      ) {
        found.set(key, {
          passageId: passage.id,
          recordId,
          text: match[0],
          how,
          start: match.index,
        });
      }
    }
  }
  return [...found.values()];
}
