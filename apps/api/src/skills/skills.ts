import { skillsGet, skillsList } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { implement } from '../operations/registry.ts';
import bundled from './skills.generated.json' with { type: 'json' };

/** A module's skill, bundled from `skills/<module>/SKILL.md` by `pnpm generate` (ADR 0054). */
export interface Skill {
  module: string;
  name: string;
  description: string;
  text: string;
}

export const skills: readonly Skill[] = bundled;

/** A skill by module ("sops") or name ("ailab-sops"). */
export function findSkill(name: string): Skill | undefined {
  return skills.find((s) => s.module === name || s.name === name);
}

export const skillOperations = [
  implement(skillsList, {
    run: async () => ({
      skills: skills.map(({ module, name, description }) => ({ module, name, description })),
    }),
  }),
  implement(skillsGet, {
    run: async (_ctx, input) => {
      const skill = findSkill(input.name);
      if (!skill) {
        throw new OperationError(
          'not_found',
          `No skill "${input.name}". Skills: ${skills.map((s) => s.module).join(', ')}`,
        );
      }
      return skill;
    },
  }),
];
