import { libraryRead, librarySearch, type RecordEnvelope } from '@ailab/schema';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { type DocumentsSearch, validateDocumentsSearch } from '../lib/document-search.ts';
import { DocumentsPage, TextBlock } from './Documents.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  search: { isPending: false, data: { hits: [] }, error: null } as Record<string, unknown>,
  requests: [] as { queryKey: unknown[]; queryFn: () => Promise<unknown> }[],
  documentSearch: {} as DocumentsSearch,
  recordSearch: {} as Record<string, unknown>,
  navigation: [] as { replace?: boolean }[],
  outline: {} as Record<string, unknown>,
  passages: {} as Record<string, unknown>,
  reads: [] as { queryKey: unknown[]; queryFn: () => Promise<unknown>; enabled?: boolean }[],
  hash: '',
  effects: [] as (() => void)[],
}));

// Exercise the actual page event handlers without introducing a DOM test dependency.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void) => fixture.effects.push(effect),
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
    if (request.queryKey[1] === 'read') {
      fixture.reads.push(request);
      return request.queryKey.length === 3 ? fixture.outline : fixture.passages;
    }
    if (request.queryKey[1] === 'search') {
      fixture.requests.push(request);
      return fixture.search;
    }
    return { data: { mentions: [] } };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('../api.ts', () => ({ api: { run: vi.fn().mockResolvedValue({ hits: [] }) } }));
vi.mock('./AreaHead.tsx', () => ({ Head: () => <header>Documents</header>, page: () => ({}) }));
vi.mock('./Records.tsx', () => ({ RecordList: () => <section>Title browse list</section> }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useSearch: () => fixture.documentSearch,
  useLocation: () => fixture.hash,
  useNavigate:
    ({ from }: { from: string }) =>
    (options: {
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    }) => {
      fixture.navigation.push(options);
      if (from === '/documents')
        fixture.documentSearch = validateDocumentsSearch(
          options.search({ ...fixture.documentSearch }),
        );
      else fixture.recordSearch = options.search(fixture.recordSearch);
    },
  Link: ({
    children,
    params,
    search,
    hash,
  }: {
    children: ReactNode;
    params: { id: string };
    search?: { section?: number };
    hash?: string;
  }) => (
    <a
      href={`/records/${params.id}${search?.section === undefined ? '' : `?section=${search.section}`}${hash ? `#${hash}` : ''}`}
    >
      {children}
    </a>
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
  fixture.documentSearch = {};
  fixture.recordSearch = {};
  fixture.navigation = [];
  fixture.outline = {};
  fixture.passages = {};
  fixture.reads = [];
  fixture.hash = '';
  fixture.effects = [];
  vi.mocked(api.run).mockClear();
});

describe('document search modes', () => {
  it('restores both search modes after remount and updates the URL by replacement', () => {
    fixture.documentSearch = {
      mode: 'text',
      q: '450',
      words: '450',
      title: 'ELISA',
      status: 'draft',
    };
    expect(element('input').props.value).toBe('450');
    expect(resultsHtml()).toContain('450');
    const browse = () =>
      pageElements().find(
        (node) => typeof node.type === 'function' && node.type.name === 'RecordList',
      );
    const filters = browse()?.props.filters as {
      search: string;
      status: string;
      onChange: (filters: { search: string; status: string }) => void;
    };
    expect(filters).toMatchObject({ search: 'ELISA', status: 'draft' });
    filters.onChange({ search: 'plate', status: 'archived' });
    (element('button', 'Titles').props.onClick as () => void)();
    fixture.values = []; // leaving and returning remounts local component state
    expect(element('button', 'Titles').props['aria-pressed']).toBe(true);
    expect(browse()?.props.filters).toMatchObject({ search: 'plate', status: 'archived' });
    (element('button', 'Document text').props.onClick as () => void)();
    expect(element('input').props.value).toBe('450');
    expect(resultsHtml()).toContain('450');
    typeWords('new phrase');
    expect(fixture.documentSearch).toMatchObject({
      words: 'new phrase',
      title: 'plate',
      status: 'archived',
    });
    expect(fixture.documentSearch.q).toBeUndefined();
    expect(resultsHtml()).toBe('');
    expect(fixture.navigation.every((request) => request.replace)).toBe(true);
  });
  it('defaults to text, submits trimmed words through the form, and clears both input and results', async () => {
    expect(element('fieldset').props.className).toBe('segmented');
    expect(element('legend').props.children).toBe('Document search mode');
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
    expect(element('button', 'Titles').props['aria-pressed']).toBe(true);
    expect(element('button', 'Document text').props['aria-pressed']).toBe(false);
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

  it('retries a failed unchanged query and reports loading until the retry finishes', () => {
    typeWords('wash');
    submit();
    const refetch = vi.fn(() => {
      fixture.search.isFetching = true;
    });
    fixture.search = {
      error: new Error('Search service unavailable'),
      isPending: false,
      isFetching: false,
      refetch,
    };
    const passages = pageElements().find(
      (node) => typeof node.type === 'function' && node.type.name === 'Passages',
    );
    if (!passages) throw new Error('Missing search results');
    const renderPassages = passages.type as (props: Record<string, unknown>) => ReactNode;
    const retry = () =>
      descendants(renderPassages(passages.props)).find(
        (node) => node.type === 'button' && node.props.children === 'Try again',
      );
    expect(retry()?.props.disabled).toBe(false);
    const button = retry();
    if (!button) throw new Error('Missing retry button');
    (button.props.onClick as () => void)();
    expect(refetch).toHaveBeenCalledOnce();
    expect(retry()?.props.disabled).toBe(true);
    expect(element('input').props.value).toBe('wash');
    expect(resultsHtml()).toContain('Searching for “wash”');
    expect(resultsHtml()).not.toContain('Search failed');
    expect(resultsHtml()).not.toContain('Search service unavailable');
    fixture.search = { isPending: false, isFetching: false, data: { hits: [] }, error: null };
    expect(resultsHtml()).toContain('0 passages with “wash”');
    expect(resultsHtml()).not.toContain('Try again');
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
            passage: { id: 'passage_1', heading: ['Method', 'Washing'], page: 3, section: 2 },
            snippet: 'Use [[wash]] buffer.',
          },
        ],
      },
    };
    const html = resultsHtml();
    expect(html).toContain('1 passage with “wash”');
    expect(html).toContain('href="/records/doc_source?section=2#document-text"');
    expect(html).toContain('Plate wash procedure');
    expect(html).toContain('Method › Washing, page 3');
    expect(html).toContain('Use <mark>wash</mark> buffer.');
  });
});

describe('matched document sections', () => {
  const record = { id: 'doc_source', attributes: {} } as RecordEnvelope;
  function prepare() {
    fixture.outline = {
      isPending: false,
      data: {
        parse: { sections: 2, passages: 2, warnings: [] },
        outline: [
          { index: 0, heading: ['Purpose'] },
          { index: 2, heading: ['Read at 450 nm'] },
        ],
      },
    };
    fixture.passages = {
      isPending: false,
      data: { passages: [{ id: 'passage_2', text: 'Read at 450 nm.' }] },
    };
  }
  it('reveals only an explicit source-hit target after the selected text has loaded', () => {
    prepare();
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn(() => ({ scrollIntoView }));
    vi.stubGlobal('document', { getElementById });
    try {
      expect(
        renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />),
      ).toContain('id="document-text"');
      fixture.effects.at(-1)?.();
      expect(scrollIntoView).not.toHaveBeenCalled();
      fixture.hash = 'document-text';
      fixture.passages = { isPending: true };
      renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />);
      fixture.effects.at(-1)?.();
      expect(scrollIntoView).not.toHaveBeenCalled();
      prepare();
      renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />);
      fixture.effects.at(-1)?.();
      expect(getElementById).toHaveBeenCalledWith('document-text');
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
      renderToStaticMarkup(<TextBlock record={record} mentions={[]} />);
      fixture.effects.at(-1)?.();
      expect(scrollIntoView).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('reads the matching section and reacts to record/section changes', async () => {
    prepare();
    expect(renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />)).toContain(
      'Read at 450 nm.',
    );
    const matched = fixture.reads.at(-1);
    expect(matched).toMatchObject({ queryKey: ['library', 'read', record.id, 2], enabled: true });
    await matched?.queryFn();
    expect(api.run).toHaveBeenLastCalledWith(libraryRead, { document: record.id, section: 2 });
    const changed = { ...record, id: 'doc_other' };
    renderToStaticMarkup(<TextBlock record={changed} mentions={[]} section={0} />);
    expect(fixture.reads.at(-1)).toMatchObject({
      queryKey: ['library', 'read', changed.id, 0],
      enabled: true,
    });
    const picker = descendants(TextBlock({ record, mentions: [], section: 2 })).find(
      (node) => node.type === 'button' && node.props.children === 'Purpose',
    );
    if (!picker) throw new Error('Missing section picker');
    (picker.props.onClick as () => void)();
    expect(fixture.recordSearch.section).toBe(0);
  });

  it('explains unavailable or invalid targets without showing section zero or stale passages', () => {
    prepare();
    for (const section of [9, 'unavailable'] as const) {
      const html = renderToStaticMarkup(
        <TextBlock record={record} mentions={[]} section={section} />,
      );
      expect(html).toContain('The requested section is unavailable');
      expect(html).not.toContain('Read at 450 nm.');
      expect(fixture.reads.at(-1)).toMatchObject({ enabled: false });
    }
    fixture.outline = { isPending: false, data: {} };
    expect(renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />)).toContain(
      'The requested section is unavailable',
    );
  });

  it('shows section loading and read errors accurately', () => {
    prepare();
    fixture.passages = { isPending: true };
    expect(renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />)).toContain(
      'Loading section',
    );
    fixture.passages = { isPending: false, error: new Error('Could not read this section') };
    expect(renderToStaticMarkup(<TextBlock record={record} mentions={[]} section={2} />)).toContain(
      'Could not read this section',
    );
  });
});
