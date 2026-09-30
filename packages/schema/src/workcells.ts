import { z } from 'zod';
import { recordIdOf } from './ids.ts';

/**
 * Workcells (plan 008d, I8 to I15): a design document listing the registered instruments that work
 * together and the device each maps to in the digital twin. Everything physical (positions,
 * robots, reach, move times) lives in the twin, never here.
 */

export const WorkcellId = recordIdOf('wcl');

export const WorkcellMember = z.strictObject({
  instrument: recordIdOf('ins'),
  twinDevice: z
    .string()
    .min(1)
    .optional()
    .describe('The device in the twin workcell it maps to, e.g. "echo"'),
  byHand: z.boolean().describe('Also usable by hand when the workcell is not using it (I15)'),
});
export type WorkcellMember = z.infer<typeof WorkcellMember>;

export const WorkcellAttributes = z.strictObject({
  twin: z
    .string()
    .min(1)
    .optional()
    .describe('The echo650-twin workcell definition it maps to, by ID'),
  members: z.array(WorkcellMember).min(1).max(50),
  notes: z.string().min(1).optional(),
});
export type WorkcellAttributes = z.infer<typeof WorkcellAttributes>;
