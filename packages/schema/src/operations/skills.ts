import { z } from 'zod';
import { defineContract } from '../operation.ts';

/** One skill: how a module's operations are used, for agents (plan 004e R7, ADR 0054). */
export const SkillSummary = z.object({
  module: z.string().describe('e.g. "sops"'),
  name: z.string().describe('e.g. "ailab-sops"'),
  description: z.string().describe('When to read it'),
});

export const skillsList = defineContract({
  id: 'skills.list',
  verbs: { done: 'looked at the skills', intent: 'look at the skills' },
  summary:
    "List the lab's skills: one per module, each explaining how to use that module's operations. Read one with skills.get before working in a module you haven't used",
  effect: 'read',
  input: z.strictObject({}),
  output: z.object({ skills: z.array(SkillSummary) }),
});

export const skillsGet = defineContract({
  id: 'skills.get',
  verbs: { done: 'read the skill', intent: 'read the skill' },
  summary: 'Read one skill in full, by its module (e.g. "sops") or its name (e.g. "ailab-sops")',
  effect: 'read',
  input: z.strictObject({ name: z.string().min(1) }),
  output: SkillSummary.extend({ text: z.string().describe('The skill, in Markdown') }),
});
