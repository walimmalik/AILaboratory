import { type LayoutSpec, type Placed, plateFormat } from '@ailab/domain';
import type { FixedRegion, LayoutAttributes } from '@ailab/schema';

/** A layout record as the placement rules read it (`packages/domain/src/platemap.ts`). */
export function layoutSpec(
  a: LayoutAttributes,
  controls: Map<string, string> = new Map(),
): LayoutSpec {
  return {
    format: plateFormat(a.wells),
    subjectRole: a.subjectRole,
    ...(a.subjectRegion ? { subjectRegion: a.subjectRegion } : {}),
    fixed: (a.fixed ?? []).map((f) => {
      const subject = fixedSubject(f, controls.get(f.id));
      return {
        role: f.role,
        region: f.region,
        ...(f.label ? { label: f.label } : {}),
        ...(f.replicates ? { replicates: f.replicates } : {}),
        ...(subject ? { subject } : {}),
      };
    }),
    ...(a.replicates ? { replicates: a.replicates } : {}),
    ...(a.arrangement ? { arrangement: a.arrangement } : {}),
    ...(a.fillOrder ? { fillOrder: a.fillOrder } : {}),
    ...(a.strategy ? { strategy: a.strategy } : {}),
    ...(a.edge ? { edge: a.edge } : {}),
    ...(a.leftover ? { leftover: a.leftover } : {}),
  };
}

/** What fills a fixed region: its standing control or series, or the record a plate map gives. */
function fixedSubject(f: FixedRegion, record: string | undefined): Placed | undefined {
  const subject = record ?? f.subject;
  if (!subject && !f.series && !f.concentration) return undefined;
  return {
    subject: subject ?? f.id,
    ...(f.label ? { label: f.label } : {}),
    ...(f.series ? { series: f.series } : {}),
    ...(f.concentration ? { concentration: f.concentration } : {}),
  };
}

/** A subject as the layout places it: its single-point concentration or its series. */
export function subjectOf(a: LayoutAttributes, subject: string, label?: string): Placed {
  return {
    subject,
    ...(label ? { label } : {}),
    ...(a.subjectSeries ? { series: a.subjectSeries } : {}),
    ...(a.subjectConcentration && !a.subjectSeries
      ? { concentration: a.subjectConcentration }
      : {}),
  };
}
