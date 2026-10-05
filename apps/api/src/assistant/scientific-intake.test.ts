import { readFileSync } from 'node:fs';
import { operationContracts } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { findSkill } from '../skills/skills.ts';
import { SCIENTIFIC_INTAKE_PROMPT } from './scientific-intake.ts';

const modules = ['sops', 'assays', 'labware', 'reagents', 'inventory', 'campaigns', 'entities'];

describe('scientific intake content contract (004g SG-04)', () => {
  it('serves the current source skills without stale generated content or fictional operations', () => {
    for (const module of modules) {
      const source = readFileSync(
        new URL(`../../../../skills/${module}/SKILL.md`, import.meta.url),
        'utf8',
      ).replace(/\r\n/g, '\n');
      const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
      expect(findSkill(module)?.text, module).toBe(body);
      // Attribute paths and the named memory detector are not callable operations.
      const names = [...body.matchAll(/`([a-z_]+\.[a-z_]+)`/g)]
        .flatMap((m) => (m[1] ? [m[1]] : []))
        .filter(
          (name) =>
            !name.startsWith('attributes.') &&
            !name.startsWith('about.') &&
            name !== 'runs.recurring_deviation',
        );
      expect(
        names.filter((name) => !operationContracts.has(name)),
        module,
      ).toEqual([]);
    }
  });

  it('uses the actual manifest, single-skill and batch operation discovery contracts', () => {
    expect(operationContracts.get('skills.list')?.input.safeParse({}).success).toBe(true);
    expect(operationContracts.get('skills.get')?.input.safeParse({ name: 'sops' }).success).toBe(
      true,
    );
    expect(
      operationContracts.get('skills.get')?.input.safeParse({ names: ['sops', 'assays'] }).success,
    ).toBe(false);
    expect(
      operationContracts.get('operations.describe')?.input.safeParse({
        ids: ['sops.draft', 'sops.calculate'],
      }).success,
    ).toBe(true);
    for (const tool of ['skills_list', 'skills_get', 'operations_describe']) {
      expect(SCIENTIFIC_INTAKE_PROMPT).toContain(tool);
    }
    expect(SCIENTIFIC_INTAKE_PROMPT).toContain('one module/name per call');
  });

  it('preserves stage, uncertainty, authority and useful terminal outcomes in served instructions', () => {
    for (const module of ['sops', 'assays']) {
      const text = findSkill(module)?.text ?? '';
      for (const requirement of [
        'hypothetical planning',
        'physical run preparation',
        'Unknown is not assent',
        'people-only',
        'Procedure',
        'uncertainty',
        'evidence',
      ]) {
        expect(text.toLowerCase(), `${module}: ${requirement}`).toContain(
          requirement.toLowerCase(),
        );
      }
    }
    expect(SCIENTIFIC_INTAKE_PROMPT).toContain('never model arithmetic');
    expect(SCIENTIFIC_INTAKE_PROMPT).toContain('never invent specimens, lots, stock');
    expect(SCIENTIFIC_INTAKE_PROMPT).toContain('A promise to investigate is not a terminal result');
    expect(SCIENTIFIC_INTAKE_PROMPT).toContain(
      'Do not claim an Apply decision card or operation exists',
    );
    expect(findSkill('sops')?.text).toContain('do not emulate it by editing questions');
    // These are instruction/contract checks, not proof that a live model follows the instructions.
  });
});
