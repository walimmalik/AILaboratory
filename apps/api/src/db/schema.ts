import type {
  Actor,
  AssistantMessage,
  Component,
  FieldEvidence,
  InventoryEventType,
  OperationErrorBody,
  Quantity,
  RecordEnvelope,
  RecordOperation,
  RecordStatus,
  SectionReview,
  WellRef,
  WellState,
} from '@ailab/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
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
  /** scrypt hash for web sign-in; null until a password is set. */
  passwordHash: text('password_hash'),
  createdAt: createdAt(),
});

/** Web sign-in sessions, carried in an HttpOnly cookie. Only a SHA-256 hash of the session token is stored. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
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
    /** Where each attribute's value came from (plan 004c, ADR 0021). */
    evidence: jsonb('evidence').$type<Record<string, FieldEvidence>>().notNull().default({}),
    /** Section confirmations by people (plan 004c, ADR 0021). */
    reviews: jsonb('reviews').$type<Record<string, SectionReview>>().notNull().default({}),
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
    recordNames: jsonb('record_names').$type<Record<string, string>>().notNull().default({}),
    proposalId: text('proposal_id'),
    input: jsonb('input').notNull(),
    error: jsonb('error').$type<OperationErrorBody>(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [index('activity_lab_at_idx').on(t.labId, t.at)],
);

/** Conversations with the in-app assistant (plan 004b). Each belongs to the person who started it. */
export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    status: text('status').$type<'idle' | 'running' | 'failed'>().notNull(),
    agentName: text('agent_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('conversations_user_updated_idx').on(t.userId, t.updatedAt),
    check('conversations_status_check', sql`${t.status} in ('idle', 'running', 'failed')`),
  ],
);

/**
 * Messages in a conversation, in order. `body` is the provider-neutral message the API returns;
 * `providerRaw` keeps the model's own reply (e.g. Claude's thinking blocks) so it can be sent back unchanged.
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    role: text('role').$type<'user' | 'assistant' | 'tool'>().notNull(),
    body: jsonb('body').$type<AssistantMessage>().notNull(),
    provider: text('provider'),
    model: text('model'),
    providerRaw: jsonb('provider_raw'),
  },
  (t) => [
    unique('conversation_messages_seq_unique').on(t.conversationId, t.seq),
    check('conversation_messages_role_check', sql`${t.role} in ('user', 'assistant', 'tool')`),
  ],
);

/** What each well of a container holds now (plan 010c, ADR 0031). Empty wells have no row. */
export const wellContents = pgTable(
  'well_contents',
  {
    containerId: text('container_id')
      .notNull()
      .references(() => records.id),
    well: text('well').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    state: jsonb('state').$type<WellState>().notNull(),
    lastEventId: text('last_event_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.containerId, t.well] })],
);

/** The volume ledger (plan 010c, V4): one row per physical event. */
export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    type: text('type').$type<InventoryEventType>().notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    operationId: text('operation_id').notNull(),
    reason: text('reason'),
  },
  (t) => [index('inventory_events_lab_at_idx').on(t.labId, t.at)],
);

/** Each well an event changed, with what it held after (lineage reads `from`). */
export const inventoryLines = pgTable(
  'inventory_lines',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => inventoryEvents.id),
    seq: integer('seq').notNull(),
    containerId: text('container_id')
      .notNull()
      .references(() => records.id),
    well: text('well').notNull(),
    change: text('change').$type<'in' | 'out' | 'set'>().notNull(),
    volume: jsonb('volume').$type<Quantity>(),
    from: jsonb('from').$type<WellRef>(),
    to: jsonb('to').$type<WellRef>(),
    added: jsonb('added').$type<Component[]>(),
    after: jsonb('after').$type<WellState>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.seq] }),
    index('inventory_lines_well_idx').on(t.containerId, t.well),
    check('inventory_lines_change_check', sql`${t.change} in ('in', 'out', 'set')`),
  ],
);

/** Postgres full-text vector, filled by a generated column. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** How each document file was turned into text (plan 011b): one row per document and file. */
export const libraryParses = pgTable(
  'library_parses',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => records.id),
    fileId: text('file_id')
      .notNull()
      .references(() => records.id),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    sha256: text('sha256').notNull(),
    converter: text('converter').notNull(),
    sections: integer('sections').notNull(),
    passages: integer('passages').notNull(),
    warnings: jsonb('warnings').$type<string[]>().notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }).notNull(),
    parsedBy: jsonb('parsed_by').$type<Actor>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.fileId] })],
);

/** Searchable passages of parsed document files (plan 011b), with their heading path and page. */
export const libraryPassages = pgTable(
  'library_passages',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    documentId: text('document_id')
      .notNull()
      .references(() => records.id),
    fileId: text('file_id')
      .notNull()
      .references(() => records.id),
    section: integer('section').notNull(),
    heading: jsonb('heading').$type<string[]>().notNull(),
    sectionPageFrom: integer('section_page_from'),
    sectionPageTo: integer('section_page_to'),
    seq: integer('seq').notNull(),
    page: integer('page'),
    text: text('text').notNull(),
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', coalesce(heading_text, '') || ' ' || text)`),
    headingText: text('heading_text').notNull(),
  },
  (t) => [
    index('library_passages_document_idx').on(t.documentId, t.fileId, t.section, t.seq),
    index('library_passages_search_idx').using('gin', t.search),
  ],
);

/**
 * What library passages mention (plan 011c): a record, an assay type or a stated parameter,
 * proposed by the matcher or an agent and confirmed by a person. Where it was (heading, page,
 * words) is kept here, so a confirmed mention survives parsing the document again.
 */
export const libraryMentions = pgTable(
  'library_mentions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id),
    documentId: text('document_id')
      .notNull()
      .references(() => records.id),
    fileId: text('file_id')
      .notNull()
      .references(() => records.id),
    passageId: text('passage_id').notNull(),
    section: integer('section').notNull(),
    heading: jsonb('heading').$type<string[]>().notNull(),
    page: integer('page'),
    text: text('text').notNull(),
    type: text('type').$type<'record' | 'assay' | 'parameter'>().notNull(),
    recordId: text('record_id').references(() => records.id),
    assay: text('assay'),
    parameter: text('parameter'),
    value: jsonb('value').$type<Quantity>(),
    how: text('how').notNull(),
    status: text('status').$type<'proposed' | 'confirmed' | 'rejected'>().notNull(),
    proposedBy: jsonb('proposed_by').$type<Actor>().notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    reviewedBy: jsonb('reviewed_by').$type<Actor>(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('library_mentions_document_idx').on(t.labId, t.documentId),
    index('library_mentions_record_idx').on(t.recordId),
    check('library_mentions_type_check', sql`${t.type} in ('record', 'assay', 'parameter')`),
    check(
      'library_mentions_status_check',
      sql`${t.status} in ('proposed', 'confirmed', 'rejected')`,
    ),
  ],
);
