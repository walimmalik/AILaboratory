import { z } from 'zod';
import { UserId } from '../actor.ts';
import { EvidenceInput } from '../design.ts';
import { RecordId } from '../ids.ts';
import {
  MemoryAppliesTo,
  MemoryBar,
  MemoryCandidate,
  MemoryConditions,
  MemoryDraft,
  MemoryEffect,
  MemoryEvidence,
  MemoryFacts,
  MemoryFields,
  MemoryFinding,
  MemoryId,
  MemoryKind,
  MemorySource,
  MemoryStrength,
} from '../memory.ts';
import { defineContract } from '../operation.ts';
import { RecordEnvelope } from '../record.ts';

/** Lab memory operations (plans 005a, 005b and 005c-1). */

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
        due: z
          .boolean()
          .describe(
            'Due for a check: past its check-again date, more evidence against than for, or quiet for too many matching runs; still used',
          ),
        seen: MemoryEvidence.optional().describe(
          'What detectors and agents reported about it; left out when nothing was reported',
        ),
        aboutRecords: z
          .array(
            z.object({ id: z.string(), name: z.string(), label: z.string(), kind: z.string() }),
          )
          .describe('The records it is about, named; ones no longer in the lab are left out'),
      }),
    ),
    total: z.number().int(),
  }),
});

const Applied = z.object({
  id: MemoryId,
  name: z.string(),
  statement: z.string(),
  kind: MemoryKind,
  strength: MemoryStrength,
  effect: MemoryEffect.optional(),
  applies: z
    .boolean()
    .describe('Every condition held, so code applies its effect; false: shown, not applied'),
  unknown: z
    .array(MemoryConditions.keyof())
    .describe('Conditions the facts left out; give them to know whether it applies'),
  due: z
    .boolean()
    .describe(
      'Due for a check: past its check-again date, more evidence against than for, or quiet for too many matching runs; still used',
    ),
  evidence: MemoryEvidence.optional().describe(
    'What detectors and agents reported about it; left out when nothing was reported',
  ),
});

export const memoryFor = defineContract({
  id: 'memory.for',
  verbs: { done: 'looked up the lab memory for', intent: 'look up the lab memory for' },
  summary:
    "The lab memories that apply to a piece of work, most specific first: rules, then defaults, then notes; a person's own before the lab's; more matching conditions and records first, then more evidence for than against. Give the records the work is about or uses and what you know about it (instrument, volume, liquid type, sample count…). A memory whose conditions you didn't give is listed but not applied. Conflicts list memories whose effects clash; code applies neither. `lines` is the same list as one line each, capped, as the in-app assistant gets it for a page",
  effect: 'read',
  input: z.strictObject({
    records: z
      .array(RecordId)
      .max(50)
      .optional()
      .describe('The records the work is about or uses, e.g. the instrument kind and the SOP'),
    facts: MemoryFacts.optional().describe('What you know about the work, to check conditions'),
    nearby: z
      .boolean()
      .optional()
      .describe('Also memories about the records these link to, one step out (a page bundle)'),
    person: UserId.optional().describe(
      'Whose personal memories apply; left out, the person you act for',
    ),
    limit: z.number().int().min(1).max(100).optional().describe('Default 15'),
  }),
  output: z.object({
    memories: z.array(Applied),
    more: z
      .number()
      .int()
      .describe('How many more matched past the limit; memory.search finds them'),
    conflicts: z.array(z.object({ memories: z.array(z.string()), why: z.string() })),
    lines: z.array(z.string()),
  }),
});

export const memoryUsedIn = defineContract({
  id: 'memory.used_in',
  verbs: { done: 'listed where a lab memory was used', intent: 'list where a lab memory was used' },
  summary:
    'The records with a value copied from this lab memory (memory evidence), at their current version, each with the fields it filled',
  effect: 'read',
  input: z.strictObject({ id: MemoryId }),
  output: z.object({
    records: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        label: z.string(),
        kind: z.string(),
        status: z.string(),
        version: z.number().int(),
        fields: z.array(z.string()),
      }),
    ),
  }),
});

export const memoryObserve = defineContract({
  id: 'memory.observe',
  verbs: {
    done: 'reported an observation for lab memory',
    intent: 'report an observation for lab memory',
  },
  summary:
    "Report one record and what it showed about a pattern worth remembering (a run, an analysis, a plate): a detector's or an agent's observation under a key that names the pattern. Records that show it (finding for) collect on a hidden candidate until they pass its bar (default: 3 different records on 2 different days); then code proposes one draft memory with the evidence for a person to confirm. A rejected candidate comes back only when the records seen since its proposal are twice those it was proposed with. Records that show the opposite (against) and records where it could have shown and didn't (quiet) count as evidence on the memory: a memory with more against than for, or quiet for its limit of matching runs in a row (default 10), is due for a check. Give `memory` to report on a memory that already exists, such as one a person stated. Reporting the same record again replaces its observation",
  effect: 'write',
  input: z
    .strictObject({
      detector: z
        .string()
        .regex(/^[a-z][a-z0-9_.]*$/, 'a detector name like runs.recurring_deviation')
        .describe('Who noticed it: a detector, or "agent" for an agent reading results'),
      key: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          'What the pattern is, the same for every observation of it, e.g. sop|step|field|higher; left out with `memory`, the memory itself',
        ),
      draft: MemoryDraft.optional().describe(
        'The memory to propose once the bar is passed; not needed with `memory`',
      ),
      memory: MemoryId.optional().describe('An existing memory this record is evidence about'),
      finding: MemoryFinding.optional().describe('Left out: for'),
      source: MemorySource.shape.from.exclude(['stated', 'conversation']),
      evidence: RecordId.describe('The record that shows it'),
      day: z.iso.date().optional().describe('When it happened; left out, today'),
      note: z.string().min(1).max(300).optional().describe('What this record showed'),
      bar: MemoryBar.optional(),
      quietLimit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Quiet opportunities in a row before the memory is due for a check; default 10'),
    })
    .refine((i) => i.memory !== undefined || (i.key !== undefined && i.draft !== undefined), {
      message: 'give a key and a draft for a new pattern, or the memory it is about',
    }),
  output: z.object({
    candidate: MemoryCandidate,
    proposed: RecordEnvelope.optional().describe(
      'The draft memory, when this observation passed the bar',
    ),
  }),
});

export const memoryCandidates = defineContract({
  id: 'memory.candidates',
  verbs: { done: 'listed memory candidates', intent: 'list memory candidates' },
  summary:
    "The patterns detectors are collecting before they are proposed, with their counts against the bar, and the ones proposed, confirmed or rejected. Read-only; candidates aren't records",
  effect: 'read',
  input: z.strictObject({
    detector: z.string().min(1).optional(),
    status: MemoryCandidate.shape.status.optional(),
    limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
  }),
  output: z.object({ candidates: z.array(MemoryCandidate) }),
});
