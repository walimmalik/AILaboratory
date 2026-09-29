import { describe, expect, it } from 'vitest';
import { wikiHref, wikiPage, wikiPages } from './wiki.ts';

describe('wiki', () => {
  it('bundles every page, the index first, titled by its heading', () => {
    expect(wikiPages[0]?.slug).toBe('README');
    expect(wikiPage('roadmap')?.title).toMatch(/Roadmap/);
    expect(wikiPage('roadmap')?.body.startsWith('# ')).toBe(false);
  });

  it('keeps wiki links in the app and sends the rest of the repo to GitHub', () => {
    expect(wikiHref('roadmap.md')).toEqual({ page: 'roadmap' });
    expect(wikiHref('../plans/007-labware-library.md')).toEqual({
      external:
        'https://github.com/walimmalik/AILaboratory/blob/main/docs/plans/007-labware-library.md',
    });
    expect(wikiHref('../../AGENTS.md')).toEqual({
      external: 'https://github.com/walimmalik/AILaboratory/blob/main/AGENTS.md',
    });
    expect(wikiHref('https://example.org')).toEqual({ external: 'https://example.org' });
  });
});
