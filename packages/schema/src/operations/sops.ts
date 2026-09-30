import { z } from 'zod';
import { EvidenceInput } from '../design.ts';
import { defineContract } from '../operation.ts';
import { DecimalString, Quantity } from '../quantity.ts';
import { RecordEnvelope } from '../record.ts';
import { SopAttributes, SopId, SopName } from '../sops.ts';

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
  calculator: true,
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
  summary:
    'Draft a digital SOP: materials by role (with requirements and a default record), variables (inputs, defaults, values read from records, formulas), typed steps in plain lab language, plate layout needs, timing windows and open questions, each citing the library passage it came from. A person confirms it section by section',
  effect: 'write',
  input: z.strictObject({
    label: z
      .string()
      .min(1)
      .describe('Its title, e.g. "Human IL-6 sandwich ELISA (DuoSet), 96-well"'),
    ...SopAttributes.shape,
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
  calculator: true,
  summary:
    "Work out an SOP's variables for a run: its defaults and typical values, with the run's inputs given here (number of samples, replicates) taking their place. Returns every variable, computed ones included, and what each still waits for",
  effect: 'read',
  input: z.strictObject({
    sop: SopId,
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
    variables: z.array(
      EvaluatedVariable.extend({
        from: z
          .enum(['input', 'default', 'typical', 'computed', 'missing'])
          .describe("input: given here; default or typical: the SOP's value; computed: a formula"),
      }),
    ),
  }),
});
