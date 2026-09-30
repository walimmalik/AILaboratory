import type { z } from 'zod';
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
  links?: (attributes: z.infer<A>) => Omit<RecordLink, 'fromId'>[];
  /**
   * Draft and confirm (plan 004c): groups of attributes a person confirms one by one. Kinds with
   * sections can only be activated once every section is confirmed and no blocker check fails.
   */
  sections?: KindSection[];
  checks?: KindCheck<z.infer<A>>[];
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
  /** Every non-archived record of a kind in this lab. */
  list: (kind: string) => Promise<RecordEnvelope[]>;
  /** The record being written, when it exists already. */
  current?: RecordEnvelope | undefined;
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
