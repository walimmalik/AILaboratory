import { formatQuantity } from '@ailab/domain';
import type { Actor, FieldEvidence, Quantity } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import type { WriteListener } from '../operations/registry.ts';
import { stable } from '../records/pins.ts';
import { RecordService } from '../records/service.ts';

/**
 * The repeated-override detector (plan 005c-1b, round 3's M13 note): when a person changes a value
 * an agent, a template or a lab memory filled in, the change is reported to `memory.observe` under
 * the kind, the field and the new value. The same change in 3 records becomes a proposed convention.
 */

export const OVERRIDE_DETECTOR = 'records.repeated_override';

/** Sources that fill a value for a person: an agent's assumption, a template, a lab memory. */
const FILLED = new Set<FieldEvidence['source']>(['assumed', 'template', 'memory']);

const isQuantity = (v: unknown): v is Quantity =>
  !!v && typeof v === 'object' && 'value' in v && 'unit' in v && Object.keys(v).length === 2;

/** A value a convention can name in words: text, a number, yes or no, or a quantity. */
function shown(value: unknown): string | undefined {
  if (isQuantity(value)) return formatQuantity(value);
  if (typeof value === 'string' && value.length <= 80) return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

const words = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();

export const observeOverrides: WriteListener = async (ctx, recordIds, deps) => {
  if (ctx.actor.type !== 'user') return;
  const records = new RecordService(deps.db, deps.kinds);
  const detector: Actor = {
    type: 'agent',
    agentName: 'Lab memory detector',
    onBehalfOf: ctx.actor.userId,
  };
  for (const id of recordIds) {
    const record = await records.get(ctx, id).catch(() => undefined);
    if (!record || record.version < 2 || record.kind === 'memory') continue;
    const before = await records.getVersion(ctx, id, record.version - 1).catch(() => undefined);
    if (!before) continue;
    const was = before.snapshot.evidence ?? {};
    for (const [field, now] of Object.entries(record.evidence ?? {})) {
      if (field.startsWith('/') || now.source !== 'person') continue;
      if (now.by.type !== 'user' || now.by.userId !== ctx.actor.userId) continue;
      const previous = was[field];
      if (!previous || !FILLED.has(previous.source)) continue;
      const value = (record.attributes as Record<string, unknown>)[field];
      const old = (before.snapshot.attributes as Record<string, unknown>)[field];
      const text = shown(value);
      if (!text || stable(value) === stable(old)) continue;
      const noun = words(record.kind);
      await deps.registry
        .execute(
          { ...ctx, actor: detector },
          'memory.observe',
          {
            detector: OVERRIDE_DETECTOR,
            key: [record.kind, field, stable(value)].join('|'),
            source: 'edits',
            evidence: record.id,
            note: `${words(field)} ${shown(old) ?? 'the filled-in value'} changed to ${text}`,
            bar: { records: 3, days: 1 },
            draft: {
              statement: `People set ${words(field)} to ${text} on a ${noun} when another value was filled in`,
              kind: 'convention',
            },
          },
          {},
          deps.db,
        )
        .catch((error: unknown) => {
          if (error instanceof OperationError) return undefined;
          throw error;
        });
    }
  }
};
