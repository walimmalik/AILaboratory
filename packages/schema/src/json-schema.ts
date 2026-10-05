import { z } from 'zod';
import { Actor } from './actor.ts';
import { ExactSourceCitation, ExactSourceReference } from './library.ts';
import { ActivityEntry, OperationErrorBody, Proposal, ProposalReceipt } from './operation.ts';
import { Quantity } from './quantity.ts';
import { RecordEnvelope, RecordLink, RecordVersion } from './record.ts';
import { ScientificDecisionMetadata } from './scientific-decisions.ts';
import { ScientificQuestion } from './sops.ts';

/** Schemas published as JSON Schema for MCP tools, agents and the Python service. */
export const publishedSchemas = {
  ActivityEntry,
  Actor,
  ExactSourceCitation,
  ExactSourceReference,
  OperationErrorBody,
  Proposal,
  ProposalReceipt,
  Quantity,
  RecordEnvelope,
  RecordLink,
  RecordVersion,
  ScientificDecisionMetadata,
  ScientificQuestion,
} as const;

export function toJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(publishedSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    ]),
  );
}
