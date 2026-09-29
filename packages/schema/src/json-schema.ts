import { z } from 'zod';
import { Actor } from './actor.ts';
import { ActivityEntry, OperationErrorBody, Proposal } from './operation.ts';
import { Quantity } from './quantity.ts';
import { RecordEnvelope, RecordLink, RecordVersion } from './record.ts';

/** Schemas published as JSON Schema for MCP tools, agents and the Python service. */
export const publishedSchemas = {
  ActivityEntry,
  Actor,
  OperationErrorBody,
  Proposal,
  Quantity,
  RecordEnvelope,
  RecordLink,
  RecordVersion,
} as const;

export function toJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(publishedSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    ]),
  );
}
