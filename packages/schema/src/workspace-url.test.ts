import { describe, expect, it } from 'vitest';
import type { WorkspaceSelection, WorkspaceView } from './workspace.ts';
import { parseWorkspaceSelection, workspaceHref } from './workspace-url.ts';

const suffix = '0'.repeat(26);
const experiment = `exp_${suffix}`;
const map = `pmp_${suffix}`;
const plan = `tfp_${suffix}`;
const detail = { id: `sop_${suffix}`, version: 2 };
const page = { offset: 20, limit: 20 };
const prefix = 'workspace=design&workspaceVersion=4';
const parse = (query: string) => parseWorkspaceSelection(experiment, new URLSearchParams(query));

describe('shared workspace URL codec', () => {
  it('round-trips every supported selector through a usable experiment href', () => {
    const views: WorkspaceView[] = [
      { panel: 'design' },
      { panel: 'design', page, detail },
      { panel: 'plates', page },
      {
        panel: 'plates',
        page,
        detail,
        map: { id: map, version: 2, plate: 200, wells: ['A1', 'AF48'], relatedPage: page },
      },
      { panel: 'transfers' },
      { panel: 'transfers', plan: { id: plan, version: 3 } },
      {
        panel: 'transfers',
        page,
        detail,
        plan: {
          id: plan,
          version: 3,
          group: 'dose',
          groupsPage: page,
          rowsPage: { offset: 0, limit: 50 },
          relatedPage: page,
        },
      },
    ];
    for (const view of views) {
      const selection: WorkspaceSelection = { experiment, version: 4, view };
      const url = new URL(workspaceHref(selection), 'https://lab.example');
      expect(url.pathname).toBe(`/records/${experiment}`);
      expect(parseWorkspaceSelection(experiment, url.searchParams)).toEqual(selection);
    }
  });

  it('distinguishes absent state and preserves unrelated query parameters', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('section=2&returnTo=%2Fcampaigns')).toBeUndefined();
    const params = new URLSearchParams(`${prefix}&section=2&returnTo=%2Fcampaigns&section=3`);
    const before = params.toString();
    expect(parseWorkspaceSelection(experiment, params)?.view.panel).toBe('design');
    expect(params.toString()).toBe(before);
  });

  it('refuses unknown, duplicate, missing, unsupported and wrong-panel selectors', () => {
    for (const query of [
      'workspace=design',
      'workspaceVersion=4',
      'workspaceUnknown=true',
      'workspace=other&workspaceVersion=4',
      `${prefix}&workspace=design`,
      `${prefix}&workspaceVersion=4`,
      `${prefix}&workspaceFilter=all`,
      `${prefix}&workspaceOffset=0`,
      `${prefix}&workspaceLimit=20`,
      `${prefix}&workspaceDetail=${detail.id}`,
      `${prefix}&workspaceDetailVersion=2`,
      `${prefix}&workspaceMap=${map}&workspaceMapVersion=2&workspacePlate=1`,
      `workspace=plates&workspaceVersion=4&workspaceMap=${map}&workspaceMapVersion=2`,
      `workspace=plates&workspaceVersion=4&workspacePlate=1`,
      `workspace=plates&workspaceVersion=4&workspaceWells=A1`,
      `workspace=plates&workspaceVersion=4&workspacePlan=${plan}&workspacePlanVersion=3`,
      `workspace=plates&workspaceVersion=4&workspaceMapVersion=2&workspacePlate=1`,
      `workspace=transfers&workspaceVersion=4&workspaceGroup=dose`,
      `workspace=transfers&workspaceVersion=4&workspaceRelatedOffset=0&workspaceRelatedLimit=20`,
      `workspace=transfers&workspaceVersion=4&workspacePlan=${plan}&workspacePlanVersion=3&workspaceRowsOffset=0&workspaceRowsLimit=20`,
      `workspace=transfers&workspaceVersion=4&workspacePlan=${plan}&workspacePlanVersion=3&workspaceGroupsOffset=0`,
      `workspace=plates&workspaceVersion=4&workspaceMap=${map}&workspaceMapVersion=2&workspacePlate=1&workspaceWells=A1,A1`,
      `workspace=plates&workspaceVersion=4&workspaceMap=${map}&workspaceMapVersion=2&workspacePlate=1&workspaceWells=`,
    ])
      expect(() => parse(query), query).toThrow();
  });

  it('does not coerce malformed numeric syntax or accept values outside schema bounds', () => {
    for (const value of [
      '',
      '-1',
      '1.0',
      '1e2',
      '01',
      '+1',
      ' 1',
      'NaN',
      'Infinity',
      '0x10',
      '9007199254740992',
      '0',
    ]) {
      expect(
        () => parse(`workspace=design&workspaceVersion=${encodeURIComponent(value)}`),
        value,
      ).toThrow();
    }
    for (const value of ['-1', '1.5', '01', '9007199254740992']) {
      expect(() => parse(`${prefix}&workspaceOffset=${value}&workspaceLimit=20`)).toThrow();
    }
    expect(() => parse(`${prefix}&workspaceOffset=0&workspaceLimit=51`)).toThrow();
    expect(() => parseWorkspaceSelection('cam_wrong', new URLSearchParams(prefix))).toThrow();
  });

  it('validates encoder input rather than silently dropping unsupported fields', () => {
    expect(() =>
      workspaceHref({
        experiment,
        version: 4,
        view: { panel: 'design', filter: 'all' },
      } as unknown as WorkspaceSelection),
    ).toThrow();
  });
});
