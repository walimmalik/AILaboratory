import type { RecordEnvelope } from '@ailab/schema';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordList, type RecordListFilters } from './Records.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  queries: [] as unknown[][],
  records: [] as RecordEnvelope[],
  navigate: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useDeferredValue: (value: unknown) => value,
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
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    fixture.queries.push(queryKey);
    return { data: queryKey[0] === 'records' ? fixture.records : { items: [] } };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => fixture.navigate,
  Link: ({ to, params, children }: { to: string; params: { id: string }; children: ReactNode }) => (
    <a href={to.replace('$id', params.id)}>{children}</a>
  ),
}));
vi.mock('../session.ts', () => ({ useMe: () => ({ user: { id: 'usr_person' } }) }));

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
      : [],
  );
}
function list(filters?: RecordListFilters & { onChange: (next: RecordListFilters) => void }) {
  fixture.cursor = 0;
  return nodes(
    RecordList({ title: 'Documents', kind: 'document', ...(filters ? { filters } : {}) }),
  );
}
function input(tree: Element[]) {
  const node = tree.find((element) => element.type === 'input');
  if (!node) throw new Error('Missing title input');
  return node;
}
function status(tree: Element[], label: string) {
  const node = tree.find(
    (element) => element.type === 'button' && element.props.children === label,
  );
  if (!node) throw new Error('Missing status button');
  return node;
}
beforeEach(() => {
  fixture.values = [];
  fixture.cursor = 0;
  fixture.queries = [];
  fixture.records = [];
  fixture.navigate.mockClear();
});

describe('optional record list route filters', () => {
  it('uses restored title/status values and reports edits without losing the other filter', () => {
    const onChange = vi.fn();
    const filters = { search: '  ELISA  ', status: 'archived' as const, onChange };
    const tree = list(filters);
    expect(input(tree).props.value).toBe('  ELISA  ');
    expect(status(tree, 'Archived').props['aria-pressed']).toBe(true);
    expect(fixture.queries).toContainEqual([
      'records',
      { kind: 'document', search: 'ELISA', status: 'archived' },
    ]);
    (input(tree).props.onChange as (event: unknown) => void)({ target: { value: 'plate' } });
    expect(onChange).toHaveBeenLastCalledWith({ search: 'plate', status: 'archived' });
    (status(tree, 'Drafts').props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith({ search: '  ELISA  ', status: 'draft' });
    list({ ...filters, status: 'current' });
    expect(fixture.queries).toContainEqual(['records', { kind: 'document', search: 'ELISA' }]);
  });

  it('keeps uncontrolled lists working with their existing local filters', () => {
    const tree = list();
    (input(tree).props.onChange as (event: unknown) => void)({ target: { value: 'plate' } });
    const changed = list();
    expect(input(changed).props.value).toBe('plate');
    (status(changed, 'Confirmed').props.onClick as () => void)();
    expect(status(list(), 'Confirmed').props['aria-pressed']).toBe(true);
    expect(fixture.queries).toContainEqual([
      'records',
      { kind: 'document', search: 'plate', status: 'active' },
    ]);
  });
});

const record = (id: string, label: string, name: string): RecordEnvelope => ({
  id,
  label,
  name,
  kind: 'run',
  status: 'active',
  version: 1,
  orgId: 'org_1',
  labId: 'lab_1',
  attributes: {},
  evidence: {},
  reviews: {},
  createdAt: '2026-10-05T12:00:00Z',
  updatedAt: '2026-10-05T12:00:00Z',
  createdBy: { type: 'user', userId: 'usr_person' },
  updatedBy: { type: 'user', userId: 'usr_person' },
});
function rows() {
  return list().filter((element) => element.type === 'tr' && element.props.onClick);
}
function rowAt(index: number) {
  const row = rows()[index];
  if (!row) throw new Error(`Missing record row ${index}`);
  return row;
}
function click(row: Element, overrides: Record<string, unknown> = {}) {
  (row.props.onClick as (event: unknown) => void)({
    button: 0,
    target: { closest: () => null },
    currentTarget: { ownerDocument: { getSelection: () => ({ toString: () => '' }) } },
    ...overrides,
  });
}

describe('record list navigation', () => {
  beforeEach(() => {
    fixture.records = [
      record('run_first', 'Plate assay', 'RUN-0001'),
      record('run_second', 'Control plate', 'RUN-0002'),
    ];
  });

  it('names each record link with its label and code, without a second row focus stop', () => {
    fixture.cursor = 0;
    const markup = renderToStaticMarkup(<RecordList title="Runs" kind="run" />);
    expect(markup).toContain(
      '<a href="/records/run_first"><span class="one-line" title="Plate assay">Plate assay</span> <span class="code">RUN-0001</span></a>',
    );
    expect(markup).toContain(
      '<a href="/records/run_second"><span class="one-line" title="Control plate">Control plate</span> <span class="code">RUN-0002</span></a>',
    );
    expect(markup.match(/<a href=/g)).toHaveLength(2);
    for (const row of rows()) {
      expect(row.props.tabIndex).toBeUndefined();
      expect(row.props.onKeyDown).toBeUndefined();
      expect(row.props.role).toBeUndefined();
    }
  });

  it('keeps ordinary row pointer navigation directed to the clicked record', () => {
    click(rowAt(1));
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/records/$id',
      params: { id: 'run_second' },
    });
  });

  it('lets nested links and controls handle their own activation', () => {
    const row = rowAt(0);
    for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary']) {
      click(row, {
        target: { closest: (selector: string) => (selector.split(', ').includes(tag) ? {} : null) },
      });
    }
    expect(fixture.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate over selection, canceled clicks, modified clicks or other mouse buttons', () => {
    const row = rowAt(0);
    for (const overrides of [
      { defaultPrevented: true },
      { button: 1 },
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { currentTarget: { ownerDocument: { getSelection: () => ({ toString: () => 'Plate' }) } } },
    ]) {
      click(row, overrides);
    }
    expect(fixture.navigate).not.toHaveBeenCalled();
  });
});
