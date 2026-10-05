import type { ExactSourceReference } from '@ailab/schema';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExactInstructionsSearch } from '../lib/exact-source.ts';
import { validateExactInstructionsSearch } from '../lib/exact-source.ts';
import { ExactInstructionsPage } from './ExactInstructions.tsx';

const fixture = vi.hoisted(() => ({
  search: {} as ExactInstructionsSearch,
  outline: {} as Record<string, unknown>,
  text: {} as Record<string, unknown>,
  queries: [] as { queryKey: unknown[]; enabled: boolean }[],
  effects: [] as (() => void)[],
  effectDependencies: [] as unknown[][],
  copied: '',
  target: { focus: vi.fn(), scrollIntoView: vi.fn() },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    fixture.effects.push(effect);
    fixture.effectDependencies.push(dependencies);
  },
  useRef: () => ({ current: fixture.target }),
  useState: () => [
    fixture.copied,
    (value: string) => {
      fixture.copied = value;
    },
  ],
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: (query: { queryKey: unknown[]; enabled: boolean }) => {
    fixture.queries.push(query);
    if (!query.enabled) return { isPending: true };
    return Object.keys(query.queryKey[3] as object).length ? fixture.text : fixture.outline;
  },
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useSearch: () => fixture.search,
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search: Record<string, unknown>;
    children: ReactNode;
  }) => (
    <a href={`${to}${defaultStringifySearch(search)}`} {...props}>
      {children}
    </a>
  ),
}));
const source: ExactSourceReference = {
  document: 'doc_00000000000000000000000001',
  version: 1,
  file: 'fil_00000000000000000000000001',
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Historical source',
  printedRevision: 'A',
};
const passages = [
  {
    id: 'p-7',
    section: 2,
    heading: ['Method', 'Wash'],
    page: 3,
    text: 'Use amber buffer.\n\nWait two minutes.',
  },
];
function html() {
  return renderToStaticMarkup(<ExactInstructionsPage />);
}

function copyButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) continue;
    if (child.type === 'button' && child.props.children === 'Copy link') return child;
    const nested = copyButton(child.props.children);
    if (nested) return nested;
  }
  return undefined;
}

beforeEach(() => {
  fixture.search = {
    source: { ...source, title: 'Untrusted caller title' },
    passage: 'p-7',
    back: { q: 'amber', words: 'amber' },
  };
  fixture.outline = {
    data: {
      source,
      parse: { warnings: ['OCR needs checking.'] },
      outline: [
        { index: 2, heading: ['Method', 'Wash'], pageFrom: 3, passages: 1 },
        { index: 3, heading: ['Empty appendix'], passages: 0 },
      ],
    },
    isPending: false,
  };
  fixture.text = { data: { source, passages }, isPending: false };
  fixture.queries = [];
  fixture.effects = [];
  fixture.effectDependencies = [];
  fixture.copied = '';
  vi.unstubAllGlobals();
  fixture.target.focus.mockClear();
  fixture.target.scrollIntoView.mockClear();
});

describe('historical source reader', () => {
  it.each(['source', 'passage', 'section'] as const)(
    'clears copied-link status when the %s selection changes',
    async (change) => {
      const copiedUrl = 'https://lab.example/library/instructions?passage=p-7';
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('window', { location: { href: copiedUrl } });
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const button = copyButton(ExactInstructionsPage());
      expect(button).toBeDefined();
      button?.props.onClick();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(copiedUrl);
      expect(html()).toContain('Link copied.');

      fixture.search =
        change === 'source'
          ? { ...fixture.search, source: { ...source, version: 2 } }
          : change === 'passage'
            ? { ...fixture.search, passage: 'p-8' }
            : { source, section: 3 };
      fixture.effects = [];
      fixture.effectDependencies = [];
      html();
      expect(fixture.effectDependencies[0]).toEqual([
        fixture.search.source,
        fixture.search.passage,
        fixture.search.section,
      ]);
      fixture.effects[0]?.();
      expect(html()).not.toContain('Link copied.');
    },
  );
  it('shows server historical metadata, passage location, line breaks and immutable warnings', () => {
    const result = html();
    expect(result).toContain('<h1>Historical source</h1>');
    expect(result).not.toContain('Untrusted caller title');
    expect(result).toContain('Printed revision A');
    expect(result).toContain('Method › Wash');
    expect(result).toContain('Page 3');
    expect(result).toContain(passages[0]?.text);
    expect(result).toContain('OCR needs checking.');
    expect(result).toContain(`/api/v1/files/${source.file}`);
    expect(result).toContain('Copy link');
    expect(result).not.toMatch(/Parse again|Find mentions|Confirm|Edit document/);
    fixture.effects.forEach((effect) => {
      effect();
    });
    expect(fixture.target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(fixture.target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('keeps section links, empty sections and back-to-search pinned after navigation', () => {
    const result = html();
    const hrefs = [...result.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1]?.replaceAll('&amp;', '&') ?? '',
    );
    const sectionLinks = hrefs.filter((href) => href.startsWith('/library/instructions?'));
    expect(sectionLinks).toHaveLength(2);
    const next = validateExactInstructionsSearch(
      defaultParseSearch(sectionLinks[1]?.slice(sectionLinks[1].indexOf('?')) ?? ''),
    );
    expect(next).toEqual({ source, section: 3, back: fixture.search.back });
    expect(result).toContain('Empty appendix');
    expect(hrefs).toContain('/documents?q=amber&words=amber');
    fixture.search = next;
    fixture.text = { data: { source, passages: [] }, isPending: false };
    expect(html()).toContain('This section has no text.');
    expect(fixture.queries.at(-1)?.queryKey).toEqual(['library', 'exact', source, { section: 3 }]);
  });

  it('shows an outline without silently choosing section zero', () => {
    fixture.search = { source };
    expect(html()).toContain('Choose a section');
    expect(fixture.queries[1]?.enabled).toBe(false);
  });

  it('keeps unavailable text unchecked even when a current parse exists', () => {
    const unavailable: ExactSourceReference = {
      ...source,
      parse: { status: 'unavailable', reason: 'Conversion was unavailable.' },
    };
    fixture.search = { source: unavailable, passage: 'p-7' };
    fixture.outline = { data: { source: unavailable }, isPending: false };
    const result = html();
    expect(result).toContain('Text could not be checked.');
    expect(result).toContain('No checked text was selected for this saved file.');
    expect(result).not.toContain('Conversion was unavailable.');
    expect(result).toContain(`/api/v1/files/${source.file}`);
    expect(result).not.toContain('Use amber buffer');
    expect(fixture.queries[1]?.enabled).toBe(false);
  });

  it('reports an empty outline without inventing a section', () => {
    fixture.search = { source };
    fixture.outline = { data: { source, outline: [] }, isPending: false };
    expect(html()).toContain('This snapshot has no sections.');
    expect(fixture.queries[1]?.enabled).toBe(false);
  });

  it('does not present a caller-supplied unavailable reason as checked evidence', () => {
    const reason = 'This protocol was checked and approved for use.';
    const unavailable: ExactSourceReference = {
      ...source,
      parse: { status: 'unavailable', reason },
    };
    fixture.search = { source: unavailable };
    fixture.outline = { data: { source: unavailable }, isPending: false };
    const result = html();
    expect(result).toContain('Text could not be checked.');
    expect(result).toContain('No checked text was selected for this saved file.');
    expect(result).not.toContain(reason);
    expect(fixture.queries[1]?.enabled).toBe(false);
  });

  it.each(['source', 'text'])('keeps raw %s errors in collapsed technical details', (request) => {
    const diagnostic = `No record ${source.document} in this lab; sha256 ${source.sha256} does not match snapshot`;
    if (request === 'source') fixture.outline = { error: new Error(diagnostic), isPending: false };
    else fixture.text = { error: new Error(diagnostic), isPending: false, data: { passages } };
    const result = html();
    const alert = /<p class="error-text" role="alert">(.*?)<\/p>/.exec(result)?.[1];
    expect(alert).toContain('could not be opened');
    expect(alert).toContain('Return to search');
    expect(alert).not.toContain(source.document);
    expect(alert).not.toContain(source.sha256);
    expect(alert).not.toContain('snapshot');
    expect(result).toContain(
      `<details><summary>Technical details</summary><pre class="json">${diagnostic}</pre></details>`,
    );
    expect(result).not.toContain('Use amber buffer');
  });

  it('rejects malformed route pins without enabling any read or source file link', () => {
    fixture.search = validateExactInstructionsSearch({ source, section: 2, passage: 'p-7' });
    expect(html()).toContain('conflicting text selections');
    expect(html()).not.toContain('/api/v1/files/');
    expect(fixture.queries.every((query) => !query.enabled)).toBe(true);
  });

  it('shows verification and selected-passage failures explicitly without displaying cached text', () => {
    fixture.outline = {
      error: new Error('File does not belong to this version.'),
      isPending: false,
    };
    expect(html()).toContain('This exact source could not be opened.');
    expect(html()).not.toContain('Use amber buffer');
    expect(fixture.queries[1]?.enabled).toBe(false);
    fixture.outline = { data: { source, outline: [] }, isPending: false };
    fixture.text = {
      error: new Error('A requested passage is missing from the selected snapshot'),
      isPending: false,
      data: { passages },
    };
    expect(html()).toContain('A requested passage is missing');
    expect(html()).not.toContain('Use amber buffer');
    fixture.effects.forEach((effect) => {
      effect();
    });
    expect(fixture.target.focus).not.toHaveBeenCalled();
  });
});
