import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { RecordId } from '../ids.ts';
import { ExactSourceCitation, ExactSourceReference } from '../library.ts';
import { defineContract } from '../operation.ts';
import { DecimalString, Quantity } from '../quantity.ts';
import { RecordEnvelope } from '../record.ts';
import {
  QuestionDraft,
  SopAttributes,
  SopExpectation,
  SopId,
  SopName,
  SopReviewRound,
  SopScore,
  SopStep,
  SopVariable,
} from '../sops.ts';

/** A variable name in a digital SOP formula: letters, digits and _, dotted for values read from records. */
export const VariableName = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/,
    'a name like n_samples or plate.dead_volume',
  );

const Reason = z.string().min(1).optional().describe('Why; kept in history');

const GivenValue = z.union([DecimalString, Quantity, z.array(z.union([DecimalString, Quantity]))]);

const EvaluatedVariable = z.object({
  name: z.string(),
  ok: z.boolean(),
  number: DecimalString.optional(),
  quantity: Quantity.optional(),
  list: z.array(z.union([DecimalString, Quantity])).optional(),
  error: z.string().optional().describe('Why it has no value'),
  waitsOn: z.array(z.string()).optional().describe('The variables it needs first'),
});

export const sopsEvaluate = defineContract({
  id: 'sops.evaluate',
  verbs: { done: "worked out the SOP's formulas", intent: "work out the SOP's formulas" },
  calculator: { title: 'SOP formulas', group: 'protocols' },
  summary:
    'Work out formulas over named values with units and exact decimals, as digital SOP variables do: "n_samples * replicates * well_volume + dead_volume", "roundup(total * 1.1, 0.5 mL)", "final_conc * final_volume / stock_conc". Give each variable a value (a number, a quantity or a list) or a formula; formulas may use each other in any order. Functions: ceil, floor, round, roundup(x, step), rounddown(x, step), min, max, sum, count',
  effect: 'read',
  input: z.strictObject({
    variables: z
      .array(
        z
          .strictObject({
            name: VariableName,
            value: GivenValue.optional().describe(
              'A number as a decimal string, a quantity {value, unit}, or a list of either',
            ),
            expression: z
              .string()
              .min(1)
              .optional()
              .describe('A formula over other variables, e.g. "wells * well_volume"'),
            unit: z
              .string()
              .min(1)
              .optional()
              .describe('The unit to give a formula result in, e.g. "mL"'),
          })
          .refine((v) => v.value === undefined || v.expression === undefined, {
            message: 'Give a variable a value or a formula, not both',
          }),
      )
      .min(1)
      .max(200),
  }),
  output: z.object({ variables: z.array(EvaluatedVariable) }),
});

export const sopsDraft = defineContract({
  id: 'sops.draft',
  verbs: { done: 'drafted an SOP', intent: 'draft an SOP' },
  summary:
    'Draft a digital SOP: materials, variables, typed steps, layout, timing and open questions. A source-linked draft requires one explicitly selected source.exact from library.read/search; every citation names that same document, an exact passage and its literal quote. The server canonicalizes source metadata/pages and validates quotations with whitespace-only matching. Unavailable exact text may attach source-only without citations. Source-free authored drafts remain valid. A person confirms it separately',
  effect: 'write',
  input: z.strictObject({
    label: z
      .string()
      .min(1)
      .describe('Its title, e.g. "Human IL-6 sandwich ELISA (DuoSet), 96-well"'),
    ...SopAttributes.shape,
    source: SopAttributes.shape.source.unwrap().extend({ exact: ExactSourceReference }).optional(),
    questions: z.array(QuestionDraft).optional(),
    evidence: z
      .record(z.string(), EvidenceInput)
      .optional()
      .describe('Where values came from, by field: stated in the source, assumed, calculated'),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const sopsCalculate = defineContract({
  id: 'sops.calculate',
  verbs: { done: 'calculated the values of', intent: 'calculate the values of' },
  calculator: { title: 'SOP values', group: 'protocols' },
  summary:
    "Work out an SOP's variables for a run: bind its material roles to records (each role's default unless one is given here), read record variables from them (a lot's certificate value, a plate type's dead volume), take the run's inputs (number of samples, replicates), and compute the formulas. Says where every value came from and what is still missing",
  effect: 'read',
  input: z.strictObject({
    sop: SopId,
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Work out this version of the SOP, as an experiment that pins it does'),
    bindings: z
      .array(
        z.strictObject({
          role: SopName,
          record: RecordId,
          version: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Read the record as it was at this version (a design's pin)"),
        }),
      )
      .optional()
      .describe('Records for material roles, e.g. the lot picked for capture_ab'),
    inputs: z
      .array(
        z.strictObject({
          name: SopName,
          value: z.union([DecimalString, Quantity, z.array(z.union([DecimalString, Quantity]))]),
        }),
      )
      .optional(),
  }),
  output: z.object({
    obligations: z.array(
      z.strictObject({
        question: z.string(),
        stage: z.enum(['experiment', 'run']),
        passed: z.boolean(),
        problem: z.string().optional(),
      }),
    ),
    bindings: z.array(
      z.object({
        role: z.string(),
        record: z.string().optional(),
        name: z.string().optional(),
        label: z.string().optional(),
        by: z.enum(['given', 'default']).optional(),
        problem: z.string().optional().describe('Why the record does not fit the role'),
      }),
    ),
    variables: z.array(
      EvaluatedVariable.extend({
        from: z
          .enum(['input', 'record', 'default', 'typical', 'computed', 'missing'])
          .describe(
            "input: given here; record: read from a bound record; default or typical: the SOP's value; computed: a formula",
          ),
        source: z
          .object({ record: z.string(), name: z.string(), field: z.string() })
          .optional()
          .describe('The record and field a value was read from'),
        problem: z.string().optional().describe('Why a record value could not be read'),
      }),
    ),
  }),
});

export const sopsAnswerQuestion = defineContract({
  id: 'sops.answer_question',
  verbs: { done: 'answered a question on', intent: 'answer a question on' },
  summary:
    'Record a response or correct the wording of an SOP question. People only. A response never resolves the scientific issue; corrections preserve its identity, stage and history',
  effect: 'write',
  input: z.strictObject({
    sop: SopId,
    expectedVersion: z.number().int().positive(),
    question: z.string().min(1).describe('The question id'),
    action: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('response'), text: z.string().trim().min(1) }),
      z.strictObject({
        type: z.literal('correct'),
        text: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      }),
    ]),
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const sopsAskQuestion = defineContract({
  id: 'sops.ask_question',
  verbs: { done: 'asked a question on', intent: 'ask a question on' },
  summary:
    'Append an open, typed scientific question to a draft SOP. The server verifies its stage binding and retains all earlier questions and responses',
  effect: 'write',
  input: z.strictObject({
    sop: SopId,
    expectedVersion: z.number().int().positive(),
    question: QuestionDraft,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const CitationCheck = z.object({
  where: z.string().describe('What cites it, e.g. "step coat" or "variable well_volume"'),
  document: z.string(),
  passage: z.string().optional(),
  quote: z.string(),
  result: z
    .enum(['matches', 'unchecked'])
    .describe(
      'matches: literal quotation occurs in its exact retained passage, allowing whitespace normalization only; unchecked: no established edition or no checked text was selected. This is not scientific support or approval',
    ),
  exact: ExactSourceCitation.optional().describe('The actual root and verified passage/page/quote'),
  uncheckedReason: z.enum(['edition_not_established', 'text_unavailable']).optional(),
});

export const sopsCheckCitations = defineContract({
  id: 'sops.check_citations',
  verbs: { done: 'checked the citations of', intent: 'check the citations of' },
  summary:
    'Check saved SOP quotations against their exact retained passages. Whitespace alone is normalized; no case folding, elsewhere matching or current-text fallback. Old unbound editions and unavailable selections stay unchecked. Missing/corrupt/inaccessible pinned evidence refuses the check; matched text is not scientific validity or confirmation',
  effect: 'read',
  input: z.strictObject({ sop: SopId }),
  output: z.object({
    citations: z.array(CitationCheck),
    matches: z.number().int(),
    problems: z.number().int().describe('Citations whose text could not be checked'),
    sourceStatus: z
      .enum(['checked', 'unavailable', 'unbound'])
      .describe('Applies even when no citations are present'),
  }),
});

export const sopsReview = defineContract({
  id: 'sops.review',
  verbs: { done: 'reviewed the SOP', intent: 'review the SOP' },
  summary:
    'Run the AI review cycle on a draft SOP against its saved exact instructions and readiness checks. Every resulting citation is validated against that retained edition; missing evidence refuses, with no current-text fallback. Older unbound instructions stay unchecked. Fixes are tracked with reasons/passages and unclear issues stay open questions. Never replaces the source, resolves questions or confirms a section; matching text is not scientific validity. Stops when a round finds nothing or after rounds',
  effect: 'write',
  input: z.strictObject({
    sop: SopId,
    expectedVersion: z.number().int().positive(),
    rounds: z
      .number()
      .int()
      .min(1)
      .max(3)
      .optional()
      .describe('At most this many rounds; default 2'),
    reason: Reason,
  }),
  output: z.object({
    sop: RecordEnvelope,
    rounds: z.array(SopReviewRound),
    stopped: z
      .enum(['clean', 'rounds', 'failed'])
      .describe(
        'clean: the last round found nothing; rounds: the limit was reached; failed: the model call failed',
      ),
    problem: z.string().optional().describe('Why it failed, in words'),
  }),
});

export const sopsSuggest = defineContract({
  id: 'sops.suggest',
  verbs: { done: 'asked for a suggestion on', intent: 'ask for a suggestion on' },
  summary:
    'Ask the assistant to fill in one value, step, new step from a sentence, or all steps from the saved exact instructions. Give exactly one of value, step, newStep or steps. Unsaved source substitution is refused. Formulas, references and every resulting citation are checked; unavailable/unbound text is never current-text proof. Suggestions remain assumed and write nothing. Saving through records.update revalidates exact citations with the unchanged source; no scientific confirmation or question resolution',
  effect: 'read',
  input: z
    .strictObject({
      sop: SopId,
      attributes: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('The SOP as edited so far, when it differs from the stored version'),
      value: SopName.optional().describe('Fill in this value, by its technical name'),
      step: z.string().min(1).optional().describe("Fill in this step's settings and uses, by id"),
      newStep: z.string().min(1).optional().describe('Write a new step from this sentence'),
      steps: z.literal(true).optional().describe('Draft every step from the source document'),
    })
    .refine(
      (i) => [i.value, i.step, i.newStep, i.steps].filter((x) => x !== undefined).length === 1,
      'Give exactly one of value, step, newStep or steps',
    ),
  output: z.object({
    variable: SopVariable.optional().describe('The value as suggested, when one was asked for'),
    steps: z
      .array(SopStep)
      .optional()
      .describe('The step or steps as suggested, when steps were asked for'),
    reason: z.string().describe('In a line, what the suggestion rests on'),
    model: z.string(),
  }),
});

export const sopsReviews = defineContract({
  id: 'sops.reviews',
  verbs: { done: 'read the review rounds of', intent: 'read the review rounds of' },
  summary: "The AI review rounds kept with an SOP: each round's fixes and questions, oldest first",
  effect: 'read',
  input: z.strictObject({ sop: SopId }),
  output: z.object({ rounds: z.array(SopReviewRound) }),
});

export const sopsScore = defineContract({
  id: 'sops.score',
  verbs: { done: 'scored the SOP', intent: 'score the SOP' },
  calculator: { title: 'SOP score', group: 'protocols' },
  summary:
    'Score a digitized SOP against what its source must contain (the digitizing benchmark): the share of expected materials, steps (by action and stated values), values and unclear spots raised as questions the draft has, what is missing, and whether the steps keep their order',
  effect: 'read',
  input: z.strictObject({ sop: SopId, expected: SopExpectation }),
  output: SopScore,
});
