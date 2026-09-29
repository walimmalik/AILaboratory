import type { z } from 'zod';
import type { KindCheck, KindSection } from './design.ts';
import type { RecordLink } from './record.ts';

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
}

export function defineKind<A extends z.ZodType>(definition: KindDefinition<A>): KindDefinition<A> {
  return definition;
}
