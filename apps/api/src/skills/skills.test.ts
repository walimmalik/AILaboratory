import { operationContracts } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import { findSkill, skills } from './skills.ts';

describe('skills (ADR 0054)', () => {
  it('explain every operation and calculator', () => {
    const text = skills.map((s) => s.text).join('\n');
    // An ID counts only as itself in backticks, so `sops.calculate` isn't found in `sops.calculate_x`.
    const named = new Set([...text.matchAll(/`([a-z_]+\.[a-z_]+)[`\s{(]/g)].map((m) => m[1]));
    const missing = [...operationContracts.keys()].filter((id) => !named.has(id));
    expect(missing, 'operations no skill mentions; add them to skills/<module>/SKILL.md').toEqual(
      [],
    );
    // The calculators skill sits in the assistant's prompt, so it names every calculator.
    const calculators = findSkill('calculators')?.text ?? '';
    const inCalculators = new Set(
      [...calculators.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]),
    );
    const unlisted = [...operationContracts.values()]
      .filter((c) => c.calculator && !inCalculators.has(c.id))
      .map((c) => c.id);
    expect(unlisted, 'calculators missing from skills/calculators/SKILL.md').toEqual([]);
  });

  it('are served by skills.list and skills.get, by module or name', async () => {
    const { db, close } = await createTestDb();
    try {
      const registry = createRegistry(db, new KindRegistry(), new ActivityBus());
      const ctx = {
        actor: { type: 'agent' as const, agentName: 'Claude', onBehalfOf: 'usr_x' },
        orgId: 'org_x',
        labId: 'lab_x',
      };
      const listed = await registry.execute(ctx, 'skills.list', {});
      expect(
        ((listed as { output: unknown }).output as { skills: { module: string }[] }).skills.map(
          (s) => s.module,
        ),
      ).toEqual(skills.map((s) => s.module));
      const byName = await registry.execute(ctx, 'skills.get', { name: 'ailab-sops' });
      expect(((byName as { output: unknown }).output as { text: string }).text).toBe(
        findSkill('sops')?.text,
      );
      // A namespace without its schemas, short enough to scan; then the schemas by ID.
      const brief = (await registry.execute(ctx, 'operations.describe', {
        namespace: 'records',
        schema: false,
      })) as { output: { operations: Record<string, unknown>[] } };
      expect(brief.output.operations.length).toBeGreaterThan(5);
      expect(brief.output.operations.every((o) => !('input' in o) && 'summary' in o)).toBe(true);
      const one = (await registry.execute(ctx, 'operations.describe', {
        ids: ['records.get'],
      })) as { output: { operations: Record<string, unknown>[] } };
      expect(one.output.operations[0]).toHaveProperty('input');
      await expect(registry.execute(ctx, 'skills.get', { name: 'nope' })).rejects.toMatchObject({
        code: 'not_found',
      });
    } finally {
      await close();
    }
  });
});
