import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { RecordId } from '../ids.ts';
import { MemoryAppliesTo, MemoryFields, MemoryId, MemoryKind, MemoryStrength } from '../memory.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

/** Lab memory operations (plan 005a). */

const Reason = z.string().min(1).optional().describe('Why; kept in history');

/** What a person or agent gives for a new memory; code fills the check-again date when left out. */
export const MemoryInput = MemoryFields.omit({ retired: true }).extend({
  strength: MemoryStrength.optional().describe("Left out: note. A rule is a person's choice"),
  appliesTo: MemoryAppliesTo.optional().describe('Left out: the whole lab'),
});

export const memoryPropose = defineContract({
  id: 'memory.propose',
  verbs: { done: 'proposed a lab memory', intent: 'propose a lab memory' },
  summary:
    'Propose a lab memory: a convention, preference, quirk, lesson or fact no registry has a field for, in one plain sentence, with what it is about, when it applies and where it came from. It is a draft until a person confirms it (rule 8); an agent never makes one active. Propose a rule only when the person said it must always hold. Check memory.search first so the lab does not keep the same thing twice',
  effect: 'write',
  input: MemoryInput.extend({
    evidence: z.record(z.string(), EvidenceInput).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const memoryRemember = defineContract({
  id: 'memory.remember',
  verbs: { done: 'remembered', intent: 'remember' },
  summary:
    'A person\'s own "remember that…": the memory is active at once, as their statement. People only; an agent asked to remember something calls memory.propose and the person confirms it',
  effect: 'write',
  input: MemoryInput.extend({ reason: Reason }),
  output: RecordEnvelope,
});

export const memoryUpdate = defineContract({
  id: 'memory.update',
  verbs: { done: 'updated the lab memory', intent: 'update the lab memory' },
  summary:
    'Change a memory: its statement, strength, what it is about, when it applies, its effect or check-again date. Give only what changes. Direct on drafts; proposed on an active memory, which a person approves',
  effect: 'write',
  input: MemoryInput.partial().extend({
    id: MemoryId,
    expectedVersion: z.number().int().positive(),
    evidence: z.record(z.string(), EvidenceInput).optional(),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const memoryRetire = defineContract({
  id: 'memory.retire',
  verbs: { done: 'retired the lab memory', intent: 'retire the lab memory' },
  summary:
    'Retire a memory that no longer holds (the instrument was serviced, the SOP changed), with why. It stays in history and stops applying. Proposed when an agent asks; a person retires directly',
  effect: 'write',
  input: z.strictObject({
    id: MemoryId,
    expectedVersion: z.number().int().positive(),
    why: z.string().min(1),
  }),
  output: RecordEnvelope,
});

export const memoryReplace = defineContract({
  id: 'memory.replace',
  verbs: { done: 'replaced the lab memory', intent: 'replace the lab memory' },
  summary:
    'Replace an active memory with a new one, keeping the link between them: the old one is retired as replaced. Proposed when an agent asks; when a person approves, the new memory is active',
  effect: 'write',
  input: z.strictObject({
    id: MemoryId,
    expectedVersion: z.number().int().positive(),
    with: MemoryInput,
    why: z.string().min(1),
  }),
  output: z.object({ retired: RecordEnvelope, memory: RecordEnvelope }),
});

export const memorySearch = defineContract({
  id: 'memory.search',
  verbs: { done: 'searched lab memory', intent: 'search lab memory' },
  summary:
    'Find lab memories by words in the statement or "when" line, by what they are about, kind, strength, person or status. Active ones by default; retired ones only when asked',
  effect: 'read',
  input: z.strictObject({
    text: z.string().min(1).optional(),
    about: RecordId.optional().describe('Memories about this record'),
    kind: MemoryKind.optional(),
    strength: MemoryStrength.optional(),
    person: z.string().min(1).optional().describe("A person's id: their own memories"),
    status: z
      .enum(['draft', 'active', 'retired'])
      .optional()
      .describe('Left out: draft and active'),
    limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
  }),
  output: z.object({
    memories: z.array(
      RecordEnvelope.extend({
        due: z.boolean().describe('Past its check-again date: still used, due for a check'),
      }),
    ),
    total: z.number().int(),
  }),
});
