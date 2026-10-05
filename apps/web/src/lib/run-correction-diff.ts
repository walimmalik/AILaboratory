import { diffValues, type ValueChange } from '@ailab/domain';
import { RunStep } from '@ailab/schema';
import { fieldLabel, formatValue } from './format.ts';

const equal = (before: unknown, after: unknown) => diffValues(before, after).length === 0;
const pointer = (name: string) => name.replaceAll('~', '~0').replaceAll('/', '~1');

/** A display projection only: the complete supplied diff remains available in details. */
export function runCorrectionDiff(changes: ValueChange[]) {
  const raw = changes.find((change) => change.path === '/steps' && change.change === 'changed');
  if (!raw) return undefined;
  const before = RunStep.array().safeParse(raw.before);
  const after = RunStep.array().safeParse(raw.after);
  if (!before.success || !after.success || before.data.length !== after.data.length)
    return undefined;
  const keys = (steps: RunStep[]) =>
    new Set(steps.map((step) => JSON.stringify([step.part, step.step])));
  if (keys(before.data).size !== before.data.length || keys(after.data).size !== after.data.length)
    return undefined;

  const rows: ValueChange[] = [];
  const labels: Record<string, string> = {};
  const planned: Record<string, unknown> = {};
  let unchanged = 0;
  for (const [index, was] of before.data.entries()) {
    const now = after.data[index];
    if (!now) return undefined;
    if (equal(was, now)) {
      unchanged++;
      continue;
    }
    // Only the established finished-step correction shape is compacted. Other changes remain generic.
    if (
      was.status !== 'done' ||
      now.status !== 'done' ||
      ['part', 'step', 'title', 'text', 'planned', 'at', 'by'].some(
        (field) => !equal(was[field as keyof RunStep], now[field as keyof RunStep]),
      )
    )
      return undefined;
    const earlier = was.corrections ?? [];
    const corrections = now.corrections ?? [];
    const correction = corrections.at(-1);
    if (
      !correction ||
      corrections.length !== earlier.length + 1 ||
      !equal(earlier, corrections.slice(0, -1))
    )
      return undefined;
    const values = (step: RunStep) => new Map((step.actuals ?? []).map((v) => [v.name, v.value]));
    const oldActual = values(was);
    const newActual = values(now);
    const plan = new Map(was.planned.map((v) => [v.name, v.value]));
    if (
      oldActual.size !== (was.actuals ?? []).length ||
      newActual.size !== (now.actuals ?? []).length ||
      plan.size !== was.planned.length
    )
      return undefined;
    const base = `/steps/${index}`;
    const title = now.title;
    for (const name of new Set([...oldActual.keys(), ...newActual.keys()])) {
      const oldValue = oldActual.get(name) ?? plan.get(name);
      const newValue = newActual.get(name) ?? plan.get(name);
      if (equal(oldActual.get(name), newActual.get(name))) continue;
      const text = (value: unknown, actual: boolean) =>
        value === undefined
          ? 'Not recorded'
          : `${formatValue(value)} (${actual ? 'actual' : 'recorded as planned'})`;
      const path = `${base}/actuals/${pointer(name)}`;
      rows.push({
        path,
        change: 'changed',
        before: text(oldValue, oldActual.has(name)),
        after: text(newValue, newActual.has(name)),
      });
      labels[path] = `${title} · ${fieldLabel(name)} actual`;
      if (plan.has(name)) planned[path] = plan.get(name);
    }
    for (const change of diffValues(was.deviation ?? {}, now.deviation ?? {})) {
      const path = `${base}/deviation${change.path}`;
      rows.push({ ...change, path });
      labels[path] = `${title} · ${
        change.path === '/why'
          ? 'reason'
          : change.path === '/what'
            ? 'recorded difference'
            : 'impact'
      }`;
    }
    if (
      !rows.some(
        (change) => change.path === `${base}/deviation/why` && change.after === correction.why,
      )
    ) {
      const path = `${base}/correction/why`;
      rows.push({ path, change: 'added', after: correction.why });
      labels[path] = `${title} · correction reason`;
    }
    if (correction.source) {
      const path = `${base}/correction/source`;
      rows.push({ path, change: 'added', after: correction.source });
      labels[path] = `${title} · correction source`;
    }
  }
  if (!rows.length) return undefined;
  return {
    changes: changes.flatMap((change) => (change === raw ? rows : [change])),
    labels,
    planned,
    unchanged,
    raw,
  };
}
