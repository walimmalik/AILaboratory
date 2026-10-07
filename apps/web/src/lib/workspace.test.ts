import {
  parseWorkspaceSelection,
  type WorkspaceProjection,
  type WorkspaceSelection,
} from '@ailab/schema';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  parseWorkspace,
  workspaceContext,
  workspaceHref,
  workspaceReturn,
  workspaceSearch,
  workspaceToolSelection,
} from './workspace.ts';

const experiment = 'exp_00000000000000000000000000';
const selection: WorkspaceSelection = {
  experiment,
  version: 4,
  view: {
    panel: 'plates',
    page: { offset: 50, limit: 20 },
    map: { id: 'pmp_00000000000000000000000000', version: 2, plate: 29, wells: ['A1', 'AF48'] },
    detail: { id: 'lwt_00000000000000000000000000', version: 1 },
  },
};
const summary = {
  id: experiment,
  version: 4,
  name: 'EXP-0001',
  kind: 'experiment',
  label: 'A saved experiment',
  status: 'draft' as const,
};
export const projection: WorkspaceProjection = {
  panel: 'plates',
  experiment: { ...summary, question: 'What changes?', stage: 'designing', subjectCount: 5000 },
  campaign: {
    ...summary,
    id: 'cmp_00000000000000000000000000',
    name: 'CMP-0001',
    kind: 'campaign',
  },
  selection,
  href: workspaceHref(selection),
  maps: { items: [], offset: 50, limit: 20, total: 50, hasMore: false },
};
describe('saved workspace navigation', () => {
  it('restores secondary full-record return links with canonical numbers and the exact detail/map/group', () => {
    const transfers: WorkspaceSelection = {
      experiment,
      version: 6,
      view: {
        panel: 'transfers',
        detail: { id: 'ins_00000000000000000000000000', version: 2 },
        plan: {
          id: 'tfp_00000000000000000000000000',
          version: 3,
          group: 'dose',
          rowsPage: { offset: 50, limit: 20 },
        },
      },
    };
    for (const selected of [selection, transfers]) {
      const returnView = workspaceReturn(workspaceHref(selected));
      expect(returnView?.id).toBe(experiment);
      const encoded = defaultStringifySearch(returnView?.search ?? {});
      expect(encoded).not.toContain('%22');
      expect(new URLSearchParams(encoded).toString()).toBe(workspaceHref(selected).split('?')[1]);
      expect(parseWorkspaceSelection(experiment, new URLSearchParams(encoded))).toEqual(selected);
    }
    expect(
      workspaceReturn('/records/exp_00000000000000000000000000?workspace=plates'),
    ).toBeUndefined();
    expect(workspaceReturn(`https://example.org${workspaceHref(selection)}`)).toBeUndefined();
    expect(workspaceReturn(`${workspaceHref(selection)}&workspaceVersion=5`)).toBeUndefined();
  });
  it('serializes actual TanStack links as canonical codec integers and reopens the exact selection', () => {
    const transfer: WorkspaceSelection = {
      experiment,
      version: 6,
      view: {
        panel: 'transfers',
        page: { offset: 20, limit: 20 },
        plan: {
          id: 'tfp_00000000000000000000000000',
          version: 3,
          group: 'dose',
          groupsPage: { offset: 0, limit: 20 },
          relatedPage: { offset: 20, limit: 20 },
          rowsPage: { offset: 50, limit: 20 },
        },
      },
    };
    for (const selected of [
      selection,
      transfer,
      { experiment, version: 6, view: { panel: 'design' as const } },
    ]) {
      const encoded = defaultStringifySearch(workspaceSearch(selected));
      expect(encoded).not.toContain('%22');
      expect(new URLSearchParams(encoded).toString()).toBe(workspaceHref(selected).split('?')[1]);
      expect(parseWorkspaceSelection(experiment, new URLSearchParams(encoded))).toEqual(selected);
      expect(parseWorkspace(defaultParseSearch(encoded), experiment)).toEqual({
        view: selected.view,
        version: selected.version,
      });
    }
  });
  it('round trips a deep selection without using the document section key', () => {
    const search = workspaceSearch(selection);
    expect(parseWorkspace({ ...search, section: 3 }, experiment)).toEqual({
      view: selection.view,
      version: 4,
    });
    expect(workspaceHref(selection)).toContain('workspacePlate=29');
    expect(search).not.toHaveProperty('section');
  });
  it('retains an actionable error for malformed and unsupported route state', () => {
    for (const search of [
      { workspace: 'plates' },
      { ...workspaceSearch(selection), workspaceRowsOffset: 0, workspaceRowsLimit: 20 },
      { ...workspaceSearch(selection), workspaceWells: ['A1'] },
      { ...workspaceSearch(selection), workspaceLimit: 100 },
    ])
      expect(parseWorkspace(search).error).toBeTruthy();
    expect(parseWorkspace({ tab: 'fields' })).toEqual({});
  });
  it('never carries a previous validated view into another selection, record, version or specialist tab', () => {
    const shown = { id: experiment, version: 4 };
    expect(workspaceContext(selection, shown, workspaceSearch(selection))).toEqual(selection);
    expect(
      workspaceContext(selection, { ...shown, version: 5 }, workspaceSearch(selection)),
    ).toBeUndefined();
    expect(
      workspaceContext(selection, { ...shown, id: 'another' }, workspaceSearch(selection)),
    ).toBeUndefined();
    expect(
      workspaceContext(selection, shown, { ...workspaceSearch(selection), workspacePlate: 28 }),
    ).toBeUndefined();
    const design: WorkspaceSelection = { ...selection, view: { panel: 'design' } };
    expect(workspaceContext(design, shown, { tab: 'fields' })).toBeUndefined();
    expect(workspaceContext(design, shown, {})).toEqual(design);
  });
  it('requires complete valid operation output and reconstructs a link from selection', () => {
    expect(workspaceToolSelection(projection)).toEqual(selection);
    expect(workspaceToolSelection({ selection, href: '/records/evil' })).toBeUndefined();
    expect(workspaceToolSelection({ ...projection, panel: 'design' })).toBeUndefined();
    expect(
      workspaceToolSelection({
        ...projection,
        experiment: { ...projection.experiment, version: 5 },
      }),
    ).toBeUndefined();
    expect(
      workspaceHref(workspaceToolSelection({ ...projection, href: '/records/evil' }) ?? selection),
    ).not.toContain('evil');
  });
});
