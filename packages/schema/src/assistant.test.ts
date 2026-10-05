import { describe, expect, it } from 'vitest';
import { PageContext } from './assistant.ts';

const id = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';
const selectedSource = {
  source: {
    document: `doc_${id}`,
    version: 1,
    file: `fil_${id}`,
    sha256: 'a'.repeat(64),
    parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
    title: 'Instructions',
  },
};
describe('exact source page context', () => {
  it('retains the complete identity and one optional read selector', () => {
    for (const selector of [{}, { passage: 'passage-one' }, { section: 0 }]) {
      const page = {
        path: '/library/instructions',
        selectedSource: { ...selectedSource, ...selector },
      };
      expect(PageContext.parse(page)).toEqual(page);
    }
    for (const selector of [{ passage: '' }, { section: -1 }, { section: 0, passage: 'one' }])
      expect(
        PageContext.safeParse({
          path: '/library/instructions',
          selectedSource: { ...selectedSource, ...selector },
        }).success,
      ).toBe(false);
    expect(
      PageContext.safeParse({
        path: '/library/instructions',
        selectedSource: { source: { ...selectedSource.source, sha256: 'latest' } },
      }).success,
    ).toBe(false);
  });
  it('cannot combine exact instructions with record or scientific decision context', () => {
    for (const context of [
      { record: { id: `sop_${id}`, name: 'SOP-0001', version: 1 } },
      {
        record: { id: `sop_${id}`, name: 'SOP-0001', version: 1 },
        activeQuestion: { id: 'wash', stage: 'method' },
      },
      { proposal: { id: `prp_${id}` } },
    ]) {
      expect(PageContext.safeParse({ path: '/sops', ...context }).success).toBe(true);
      expect(
        PageContext.safeParse({ path: '/library/instructions', selectedSource, ...context })
          .success,
      ).toBe(false);
    }
  });
});
