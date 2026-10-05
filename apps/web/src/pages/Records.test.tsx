import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordList, type RecordListFilters } from './Records.tsx';

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  queries: [] as unknown[][],
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
    return { data: queryKey[0] === 'records' ? [] : { items: [] } };
  },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
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
