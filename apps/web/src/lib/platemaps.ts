import { allWells, formatQuantity, plateFormat } from '@ailab/domain';
import type { PlatePlan, WellPlan, WellRole } from '@ailab/schema';
import { gridOf, type WellGrid } from './inventory.ts';

/** Well roles in lab words (plan 014), for the legend and the inspector. */
export const roleWords: Record<WellRole, string> = {
  sample: 'Sample',
  compound: 'Compound',
  standard: 'Standard',
  blank: 'Blank',
  neutral_control: 'Neutral control',
  positive_control: 'Positive control',
  negative_control: 'Negative control',
  reference: 'Reference',
  buffer: 'Buffer',
  empty: 'Empty',
  other: 'Other',
};

export const roleText = (role: string) => roleWords[role as WellRole] ?? role.replaceAll('_', ' ');

/**
 * How a role is drawn: subjects in the accent, standards in the warm tone, controls in ink (filled
 * for positive, ringed for neutral and negative), blanks and buffer dashed, empty wells plain. Few
 * hues on purpose; concentration shades within one.
 */
export function roleClass(role: string): string {
  switch (role) {
    case 'sample':
    case 'compound':
    case 'reference':
      return 'role-subject';
    case 'standard':
      return 'role-standard';
    case 'positive_control':
      return 'role-positive';
    case 'neutral_control':
      return 'role-neutral';
    case 'negative_control':
      return 'role-negative';
    case 'blank':
    case 'buffer':
      return 'role-blank';
    case 'empty':
      return 'role-empty';
    default:
      return 'role-other';
  }
}

/** The grid of a plate format by its well count. */
export function plateGrid(wells: number): WellGrid {
  return gridOf(allWells(plateFormat(wells))) as WellGrid;
}

/**
 * Shade of a well within its series (1 lightest to 4 darkest), so a dilution reads as a gradient:
 * the highest point is darkest. Wells outside a series are full tone.
 */
export function shade(well: Pick<WellPlan, 'point'>, points: number): number {
  if (!well.point || points <= 1) return 4;
  return Math.max(1, 4 - Math.floor(((well.point - 1) * 4) / points));
}

/** Series length per subject on a plate, so shading knows how many points there are. */
export function pointsBySubject(plate: PlatePlan): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of plate.wells)
    if (w.subject && w.point) out.set(w.subject, Math.max(out.get(w.subject) ?? 0, w.point));
  return out;
}

/** One line for a well: "C4: Donor 3, replicate 2" or "A1: IL-6 standard, point 1 of 7, 600 pg/mL". */
export function describeWell(well: WellPlan, points?: number): string {
  const parts = [well.label ?? roleText(well.role)];
  if (well.label && !['sample', 'compound'].includes(well.role))
    parts.push(roleText(well.role).toLowerCase());
  if (well.point) parts.push(points ? `point ${well.point} of ${points}` : `point ${well.point}`);
  if (well.concentration) parts.push(formatQuantity(well.concentration));
  if (well.replicate && well.replicate > 1) parts.push(`replicate ${well.replicate}`);
  if (well.override) parts.push('changed by hand');
  return `${well.well}: ${parts.join(', ')}`;
}

/** Wells per role on a plate, most first, for the legend. */
export function roleCounts(plate: PlatePlan): { role: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of plate.wells) counts.set(w.role, (counts.get(w.role) ?? 0) + 1);
  return [...counts]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

/** Distinct subjects on a plate (not counting controls and standards). */
export function subjectCount(plate: PlatePlan): number {
  return new Set(
    plate.wells
      .filter((w) => w.subject && ['sample', 'compound'].includes(w.role))
      .map((w) => w.subject),
  ).size;
}

/** "1 well" or "6 wells". */
export const wellsText = (n: number) => `${n} well${n === 1 ? '' : 's'}`;

/** "3 samples" or "1 compound": what a plate or map places, in the subjects' own word. */
export function subjectsText(n: number, role = 'sample'): string {
  const noun = roleText(role).toLowerCase();
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The subject role of a plate ("sample" or "compound"), from its wells. */
export function subjectRoleOf(plates: readonly PlatePlan[]): string {
  for (const p of plates)
    for (const w of p.wells) if (w.role === 'sample' || w.role === 'compound') return w.role;
  return 'sample';
}

/**
 * Where each subject sits on a plate, in placement order: "Donor 1" in A3 and B3. The legend lists
 * these, so which sample is where shows without pointing at every well (UX review 2026-10-02, #11).
 */
export function subjectWells(
  plate: PlatePlan,
): { subject: string; label: string; wells: string[] }[] {
  const out = new Map<string, { subject: string; label: string; wells: string[] }>();
  for (const w of plate.wells) {
    if (!w.subject || !['sample', 'compound'].includes(w.role)) continue;
    const entry = out.get(w.subject) ?? {
      subject: w.subject,
      label: w.label ?? w.subject,
      wells: [],
    };
    entry.wells.push(w.well);
    out.set(w.subject, entry);
  }
  return [...out.values()];
}
