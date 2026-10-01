import type { z } from 'zod';
import type { Actor } from './actor.ts';
import type { CheckResult, KindCheck, KindSection } from './design.ts';
import type { RecordEnvelope, RecordLink } from './record.ts';

/**
 * Declares a record kind. Every registry (labware type, plate, plasmid, SOP…) is one kind.
 * `links` reads the references out of the attributes so the record service can keep the links table in sync.
 */
export interface KindDefinition<A extends z.ZodType = z.ZodType> {
  kind: string;
  /** Internal ID prefix, e.g. "lw". */
  idPrefix: string;
  /** Readable name prefix, e.g. "PLT". */
  namePrefix: string;
  /** Zero-padding width of the readable name counter. */
  nameWidth: number;
  /**
   * Other readable name prefixes this kind gives its records through `related` (containers are
   * PLT, TUB, BOX… by labware family). They are reserved like `namePrefix`.
   */
  otherNamePrefixes?: string[];
  attributes: A;
  /**
   * The operation that creates records of this kind, when a generic `records.create` must not: a
   * file record is only made by `files.upload`, which proves the caller holds the bytes.
   */
  createdBy?: string;
  links?: (attributes: z.infer<A>) => Omit<RecordLink, 'fromId'>[];
  /**
   * Draft and confirm (plan 004c): groups of attributes a person confirms one by one. Kinds with
   * sections can only be activated once every section is confirmed and no blocker check fails.
   */
  sections?: KindSection[];
  /**
   * Lists whose items carry their own evidence and confirmation (R4, ADR 0049), by the field that
   * keys each item: `{ steps: 'id', variables: 'name' }`. Evidence for an item is keyed
   * `/steps/<id>`; reordering keeps each item's confirmation.
   */
  items?: Record<string, string>;
  checks?: KindCheck<z.infer<A>>[];
  /**
   * The record in one line of lab words ("96-well PCR plate, 200 uL, skirted"), stored with the record
   * at every write and shown in lists, Review and links (ADR 0050).
   */
  summarize?: (attributes: z.infer<A>) => string | undefined;
  /**
   * Attributes that don't apply given the others (e.g. an A1 offset on a tube), as dotted paths. The
   * review screen leaves them out of forms, so people are asked only what is relevant.
   */
  notApplicable?: (attributes: z.infer<A>) => string[];
  /**
   * Rules that need other records (plan 010a, ADR 0029): an entity checked against its entity kind.
   * Runs inside every write and readiness read, with the attributes as they will be and as they were.
   */
  related?: (attributes: z.infer<A>, context: RelatedContext) => Promise<RelatedResult>;
}

/** What `related` can read: records in the same lab, and the name prefixes code kinds hold. */
export interface RelatedContext {
  /** A record in this lab by ID, or undefined. */
  get: (id: string) => Promise<RecordEnvelope | undefined>;
  /** A record in this lab as it was at a version (ADR 0039), or undefined. */
  getVersion: (id: string, version: number) => Promise<RecordEnvelope | undefined>;
  /** Every non-archived record of a kind in this lab. */
  list: (kind: string) => Promise<RecordEnvelope[]>;
  /** The record being written, when it exists already. */
  current?: RecordEnvelope | undefined;
  /**
   * Who is writing, for rules only some actors may cross (a person answers an SOP's questions).
   * Absent when the rules run outside a write, e.g. checking a draft in memory.
   */
  actor?: Actor | undefined;
  /** Name prefixes registered by kinds in code (PRD, LOT…). */
  reservedPrefixes: string[];
}

export interface RelatedResult {
  /** Refuses the write, each problem in words. */
  invalid?: string[];
  /** Readiness checks: a failing blocker stops the final confirm; warnings only show. */
  checks?: CheckResult[];
  /** The readable name prefix for a new record, instead of the kind's own. */
  namePrefix?: string;
}

export function defineKind<A extends z.ZodType>(definition: KindDefinition<A>): KindDefinition<A> {
  return definition;
}
