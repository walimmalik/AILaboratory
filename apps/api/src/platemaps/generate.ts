import { generatePlateMap, type PlateMapResult } from '@ailab/domain';
import type { LayoutAttributes, PlateMapAttributes, RecordEnvelope } from '@ailab/schema';
import { layoutSpec, subjectOf } from './spec.ts';

/**
 * Works a plate map out from its pinned layout version, subjects, seed and overrides (014 P4, M3).
 * `name` gives the wells' labels: a record's label with its code after it ("Donor 1 (SUA-0001)").
 * Throws PlateMapError when the layout can't place them.
 */
export async function planPlateMap(
  a: PlateMapAttributes,
  layout: LayoutAttributes,
  get: (id: string) => Promise<RecordEnvelope | undefined>,
): Promise<PlateMapResult> {
  const names = new Map<string, string>();
  const name = async (id: string) => {
    if (!names.has(id)) {
      const record = await get(id);
      names.set(id, record ? `${record.label} (${record.name})` : id);
    }
    return names.get(id) as string;
  };
  const controls = new Map((a.controls ?? []).map((c) => [c.region, c.record]));
  const spec = layoutSpec({ ...layout, ...(a.strategy ? { strategy: a.strategy } : {}) }, controls);
  for (const f of spec.fixed ?? []) {
    if (f.subject && (await get(f.subject.subject)))
      f.subject = { ...f.subject, label: f.subject.label ?? (await name(f.subject.subject)) };
  }
  const subjects = [];
  for (const s of a.subjects)
    subjects.push(subjectOf(layout, s.record, s.label ?? (await name(s.record))));
  const overrides = [];
  for (const o of a.overrides ?? [])
    overrides.push({
      plate: o.plate,
      well: o.well,
      role: o.role,
      ...(o.subject ? { subject: o.subject } : {}),
      ...(o.label || o.subject ? { label: o.label ?? (await name(o.subject as string)) } : {}),
    });
  return generatePlateMap(spec, subjects, {
    ...(a.seed !== undefined ? { seed: a.seed } : {}),
    overrides,
  });
}
