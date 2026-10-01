import { z } from 'zod';
import { RecordId } from './ids.ts';

/**
 * A record as a person reads it first (plan 004f N4, ADR 0058): what it is and where in one line, then
 * the handful of facts chosen for its kind. Worked out on read, so agents and the record page say the
 * same thing.
 */
export const OverviewPart = z.object({
  text: z.string(),
  record: RecordId.optional().describe('The record this part names, for a link'),
});
export type OverviewPart = z.infer<typeof OverviewPart>;

export const OverviewFact = z.object({
  label: z.string().describe('What the fact is, in lab words: "holds", "where", "expires"'),
  value: z.string().describe('The value in words, with its unit'),
  detail: z
    .string()
    .optional()
    .describe('A second line: where a storage rule comes from, the room a freezer is in'),
  record: RecordId.optional().describe('The record the value names, for a link'),
  field: z
    .string()
    .optional()
    .describe('The attribute the value comes from, so a screen can mark a value nobody sourced'),
  tone: z
    .enum(['warn', 'crit'])
    .optional()
    .describe('warn: needs attention soon (expires within 30 days); crit: expired or quarantined'),
});
export type OverviewFact = z.infer<typeof OverviewFact>;

export const RecordOverview = z.object({
  identity: z
    .array(OverviewPart)
    .describe('What it is and where, as a few parts a screen joins with " · "'),
  facts: z.array(OverviewFact).describe('The facts a person reads first, chosen per kind'),
});
export type RecordOverview = z.infer<typeof RecordOverview>;
