import { operationContracts } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import { findSkill, skills } from './skills.ts';

describe('skills (ADR 0054)', () => {
  it('explain every operation and calculator', () => {
    const text = skills.map((s) => s.text).join('\n');
    const missing = [...operationContracts.keys()].filter((id) => !text.includes(`\`${id}`));
    expect(missing, 'operations no skill mentions; add them to skills/<module>/SKILL.md').toEqual(
      [],
    );
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
      await expect(registry.execute(ctx, 'skills.get', { name: 'nope' })).rejects.toMatchObject({
        code: 'not_found',
      });
    } finally {
      await close();
    }
  });
});
