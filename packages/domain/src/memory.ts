/**
 * Lab memory (plan 005a): the dates and groupings code works out for memories, without I/O.
 */

export type MemoryKind = 'convention' | 'preference' | 'quirk' | 'lesson' | 'fact';

/** Months until a person should check a memory of this kind again (M6); preferences never. */
export const CHECK_AGAIN_MONTHS: Record<MemoryKind, number | undefined> = {
  quirk: 6,
  lesson: 6,
  convention: 12,
  fact: 12,
  preference: undefined,
};

/** The calendar date `months` after `date` (both like 2026-09-30), on the month's last day if shorter. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** When a memory of this kind made today is next due for a check, or undefined for never. */
export function checkAgainFor(kind: MemoryKind, today: string): string | undefined {
  const months = CHECK_AGAIN_MONTHS[kind];
  return months === undefined ? undefined : addMonths(today, months);
}

/** Whether a memory is past its check-again date: still used, shown as due for a check. */
export const isDue = (checkAgain: string | undefined, today: string) =>
  checkAgain !== undefined && checkAgain <= today;
