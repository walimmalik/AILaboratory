import { librarySearch } from '@ailab/schema';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { DocumentsPage } from './Documents.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  search: { isPending: false, data: { hits: [] }, error: null } as Record<string, unknown>,
  requests: [] as { queryKey: unknown[]; queryFn: () => Promise<unknown> }[],
}));

// Exercise the actual page event handlers without introducing a DOM test dependency.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (fixture.values[index] === undefined) fixture.values[index] = initial;
    return [
      fixture.values[index],
      (value: unknown) => {
        fixture.values[index] = value;
      },
    ];
  },
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: (request: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
    if (request.queryKey[1] === 'search') {
      fixture.requests.push(request);
      return fixture.search;
    }
    return { data: { mentions: [] } };
  },
}));
vi.mock('../api.ts', () => ({ api: { run: vi.fn().mockResolvedValue({ hits: [] }) } }));
vi.mock('./AreaHead.tsx', () => ({ Head: () => <header>Documents</header>, page: () => ({}) }));
vi.mock('./Records.tsx', () => ({ RecordList: () => <section>Title browse list</section> }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, params }: { children: ReactNode; params: { id: string } }) => (
    <a href={`/records/${params.id}`}>{children}</a>
  ),
}));

type Element = ReactElement<Record<string, unknown>>;
function descendants(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...descendants(child.props.children as ReactNode)]
      : [],
  );
}
function pageElements() {
  fixture.cursor = 0;
  return descendants(DocumentsPage());
}
function element(type: string, label?: string) {
  const found = pageElements().find(
    (node) => node.type === type && (!label || node.props.children === label),
  );
  if (!found) throw new Error(`Missing ${type} ${label ?? ''}`);
  return found;
}
function typeWords(value: string) {
  (element('input').props.onChange as (event: unknown) => void)({ target: { value } });
}
function submit() {
  const preventDefault = vi.fn();
  (element('form').props.onSubmit as (event: unknown) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
}
function resultsHtml() {
  const passages = pageElements().find(
    (node) => typeof node.type === 'function' && node.type.name === 'Passages',
  );
  return passages ? renderToStaticMarkup(passages) : '';
}

beforeEach(() => {
  fixture.values = [];
  fixture.cursor = 0;
  fixture.requests = [];
  fixture.search = { isPending: false, data: { hits: [] }, error: null };
  vi.mocked(api.run).mockClear();
});

describe('document search modes', () => {
  it('defaults to text, submits trimmed words through the form, and clears both input and results', async () => {
    expect(element('button', 'Document text').props['aria-pressed']).toBe(true);
    expect(element('button', 'Search the text').props.disabled).toBe(true);
    typeWords('  wash buffer  ');
    expect(resultsHtml()).toBe('');
    expect(element('button', 'Search the text').props.type).toBe('submit');
    submit();
    expect(resultsHtml()).toContain('wash buffer');
    const request = fixture.requests.at(-1);
    expect(request?.queryKey).toEqual(['library', 'search', 'wash buffer']);
    await request?.queryFn();
    expect(api.run).toHaveBeenCalledWith(librarySearch, { text: 'wash buffer', limit: 20 });
    (element('button', 'Clear').props.onClick as () => void)();
    expect(element('input').props.value).toBe('');
    expect(resultsHtml()).toBe('');
    typeWords('   ');
    expect(element('button', 'Search the text').props.disabled).toBe(true);
  });

  it('removes previous results immediately when edited, including an outstanding search', () => {
    typeWords('wash');
    submit();
    fixture.search = { isPending: true };
    expect(resultsHtml()).toContain('Searching for “wash”');
    typeWords('read');
    expect(resultsHtml()).toBe('');
    fixture.search = { isPending: false, data: { hits: [] } };
    expect(resultsHtml()).toBe('');
    submit();
    expect(resultsHtml()).toContain('0 passages with “read”');
    expect(resultsHtml()).not.toContain('“wash”');
  });

  it('keeps title browsing mounted and separate from the text query', () => {
    typeWords('wash');
    submit();
    const browse = () =>
      pageElements().find(
        (node) => typeof node.type === 'function' && node.type.name === 'RecordList',
      );
    const props = browse()?.props;
    expect(props).toMatchObject({ kind: 'document', placeholder: 'Find by title or name' });
    expect(props).not.toHaveProperty('onSearch');
    expect(props).not.toHaveProperty('searchAction');
    expect(props).not.toHaveProperty('toolbar');
    expect(pageElements().some((node) => node.type === 'div' && node.props.hidden === true)).toBe(
      true,
    );
    (element('button', 'Titles').props.onClick as () => void)();
    expect(pageElements().some((node) => node.type === 'form')).toBe(false);
    expect(browse()?.props).toMatchObject({
      kind: 'document',
      placeholder: 'Find by title or name',
      noMatch: 'No title has those words.',
    });
    expect(pageElements().some((node) => node.type === 'div' && node.props.hidden === false)).toBe(
      true,
    );
    (element('button', 'Document text').props.onClick as () => void)();
    expect(element('input').props.value).toBe('wash');
  });

  it('shows errors without a searching or empty-result claim', () => {
    typeWords('wash');
    submit();
    fixture.search = {
      error: new Error('Search service unavailable'),
      data: { hits: [] },
      isPending: false,
    };
    const html = resultsHtml();
    expect(html).toContain('Search failed for “wash”');
    expect(html).toContain('Search service unavailable');
    expect(html).not.toContain('Searching for');
    expect(html).not.toContain('No passage');
  });

  it('preserves source links, page and highlighted snippets, and explains an empty search', () => {
    typeWords('wash');
    submit();
    expect(resultsHtml()).toContain('No passage has all those words');
    fixture.search = {
      isPending: false,
      data: {
        hits: [
          {
            document: { id: 'doc_source', label: 'Plate wash procedure' },
            passage: { id: 'passage_1', heading: ['Method', 'Washing'], page: 3 },
            snippet: 'Use [[wash]] buffer.',
          },
        ],
      },
    };
    const html = resultsHtml();
    expect(html).toContain('1 passage with “wash”');
    expect(html).toContain('href="/records/doc_source"');
    expect(html).toContain('Plate wash procedure');
    expect(html).toContain('Method › Washing, page 3');
    expect(html).toContain('Use <mark>wash</mark> buffer.');
  });
});
