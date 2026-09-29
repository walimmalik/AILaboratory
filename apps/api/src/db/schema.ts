import type {
  Actor,
  OperationErrorBody,
  RecordEnvelope,
  RecordOperation,
  RecordStatus,
} from '@ailab/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const labs = pgTable('labs', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),
  createdAt: createdAt(),
});

/** Bearer tokens. Only a SHA-256 hash is stored. A token with an agent name acts as that agent on behalf of the user. */
export const apiTokens = pgTable('api_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  agentName: text('agent_name'),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Current state of every record (ADR 0009). */
export const records = pgTable(
  'records',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    name: text('name').notNull(),
    label: text('label').notNull(),
    status: text('status').$type<RecordStatus>().notNull(),
    version: integer('version').notNull(),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    createdBy: jsonb('created_by').$type<Actor>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: jsonb('updated_by').$type<Actor>().notNull(),
  },
  (t) => [
    unique('records_lab_name_unique').on(t.labId, t.name),
    index('records_lab_kind_idx').on(t.labId, t.kind),
    check('records_status_check', sql`${t.status} in ('draft', 'active', 'archived')`),
    check('records_version_check', sql`${t.version} > 0`),
  ],
);

/** Append-only history: the full record after each change (ADR 0009). */
export const recordVersions = pgTable(
  'record_versions',
  {
    recordId: text('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    operation: text('operation').$type<RecordOperation>().notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull(),
    snapshot: jsonb('snapshot').$type<RecordEnvelope>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.version] })],
);

/** Typed references between records, kept in sync by the record service (ADR 0014). */
export const recordLinks = pgTable(
  'record_links',
  {
    fromId: text('from_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    toId: text('to_id')
      .notNull()
      .references(() => records.id),
    relation: text('relation').notNull(),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
  },
  (t) => [
    primaryKey({ columns: [t.fromId, t.toId, t.relation] }),
    index('record_links_to_idx').on(t.toId),
  ],
);

/** Readable-name counters per lab and prefix. Values are never reused (ADR 0013). */
export const nameCounters = pgTable(
  'name_counters',
  {
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    prefix: text('prefix').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.labId, t.prefix] })],
);

/** Changes an agent proposed, waiting for a person (plan 003). */
export const proposals = pgTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    operationId: text('operation_id').notNull(),
    input: jsonb('input').notNull(),
    preview: jsonb('preview'),
    status: text('status').$type<'pending' | 'approved' | 'rejected' | 'failed'>().notNull(),
    proposedBy: jsonb('proposed_by').$type<Actor>().notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    decidedBy: jsonb('decided_by').$type<Actor>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    error: jsonb('error').$type<OperationErrorBody>(),
  },
  (t) => [
    index('proposals_lab_status_idx').on(t.labId, t.status, t.proposedAt),
    check(
      'proposals_status_check',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'failed')`,
    ),
  ],
);

/** The lab's activity ledger: every change, proposal and decision (plan 003). Reads are not logged. */
export const activity = pgTable(
  'activity',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    at: timestamp('at', { withTimezone: true }).notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    operationId: text('operation_id').notNull(),
    outcome: text('outcome')
      .$type<'succeeded' | 'failed' | 'proposed' | 'approved' | 'rejected'>()
      .notNull(),
    recordIds: jsonb('record_ids').$type<string[]>().notNull(),
    proposalId: text('proposal_id'),
    input: jsonb('input').notNull(),
    error: jsonb('error').$type<OperationErrorBody>(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [index('activity_lab_at_idx').on(t.labId, t.at)],
);
