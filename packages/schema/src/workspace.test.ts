import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PageContext } from './assistant.ts';
import { experimentsWorkspace } from './operations/workspace.ts';
import { WorkspaceView } from './workspace.ts';

const suffix = '0'.repeat(26);
const experiment = `exp_${suffix}`;
const map = `pmp_${suffix}`;
const plan = `tfp_${suffix}`;

describe('workspace presentation contract', () => {
  it('supports bounded existing design, plate and transfer selections without writes', () => {
    expect(experimentsWorkspace.effect).toBe('read');
    for (const view of [
      { panel: 'design' },
      { panel: 'plates', map: { id: map, version: 2, plate: 200, wells: ['A1', 'B2'] } },
      {
        panel: 'transfers',
        plan: { id: plan, version: 3, group: 'dose', rowsPage: { offset: 50, limit: 50 } },
      },
    ]) {
      expect(
        experimentsWorkspace.input.parse({ id: experiment, expectedVersion: 4, view }),
      ).toEqual({ id: experiment, expectedVersion: 4, view });
    }
  });

  it('rejects unsupported promises and mismatched presentation fields', () => {
    for (const view of [
      { panel: 'design', addition: 'dose' },
      { panel: 'plates', metric: 'concentration' },
      { panel: 'design', map: { id: map, version: 2, plate: 1 } },
      { panel: 'plates', map: { id: map, version: 0, plate: 1 } },
      { panel: 'plates', map: { id: map, version: 2, plate: 0 } },
      { panel: 'plates', map: { id: map, version: 2, plate: 1, wells: ['A1', 'A1'] } },
      {
        panel: 'plates',
        map: {
          id: map,
          version: 2,
          plate: 1,
          wells: Array.from({ length: 65 }, (_, i) => `A${i + 1}`),
        },
      },
      { panel: 'transfers', plan: { id: plan, version: 1, rowsPage: { offset: 0, limit: 20 } } },
      { panel: 'design', page: { offset: 0, limit: 51 } },
      { panel: 'design', filter: 'anything' },
    ])
      expect(WorkspaceView.safeParse(view).success).toBe(false);
  });

  it('requires a matching experiment context and excludes source-document selection', () => {
    const workspace = { experiment, version: 4, view: { panel: 'design' } };
    const page = {
      path: `/records/${experiment}`,
      record: { id: experiment, version: 4, name: 'EXP-0001' },
      workspace,
    };
    expect(PageContext.parse(page)).toEqual(page);
    expect(PageContext.safeParse({ ...page, record: undefined }).success).toBe(false);
    expect(PageContext.safeParse({ ...page, record: { ...page.record, version: 3 } }).success).toBe(
      false,
    );
    expect(PageContext.safeParse({ ...page, record: { ...page.record, id: map } }).success).toBe(
      false,
    );
  });

  it('publishes the contract to JSON Schema without executable renderers', () => {
    expect(z.toJSONSchema(experimentsWorkspace.input)).toBeDefined();
    expect(z.toJSONSchema(experimentsWorkspace.output)).toBeDefined();
  });
});
