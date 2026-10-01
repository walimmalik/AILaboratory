import { defineKind, Quantity, recordIdOf } from '@ailab/schema';
import { z } from 'zod';

/** A test-only kind: a colored widget with a volume, optionally part of another widget. */
export const widget = defineKind({
  kind: 'widget',
  idPrefix: 'wdg',
  namePrefix: 'WDG',
  nameWidth: 4,
  attributes: z.object({
    color: z.string(),
    volume: Quantity,
    partOf: recordIdOf('wdg').optional(),
  }),
  links: (a) => (a.partOf ? [{ toId: a.partOf, relation: 'part_of' }] : []),
  sections: [
    { id: 'appearance', title: 'Appearance', fields: ['color'] },
    { id: 'volume', title: 'Volume', fields: ['volume', 'partOf'] },
  ],
  checks: [
    {
      id: 'volume_positive',
      label: 'Volume is more than zero',
      severity: 'blocker',
      source: 'Widget test spec',
      section: 'volume',
      fix: 'Set the volume the widget holds',
      test: (a) => Number(a.volume.value) > 0 || `Volume is ${a.volume.value} ${a.volume.unit}`,
    },
    {
      id: 'color_known',
      label: 'Color is known',
      severity: 'warning',
      source: 'Widget test spec',
      section: 'appearance',
      fix: 'Check the widget and name its color',
      test: (a) => a.color.trim().toLowerCase() !== 'unknown' || 'Color is unknown',
    },
  ],
});

/**
 * A test-only kind with no sections: records of it are confirmed as a whole. A draft is due by
 * `due`; a confirmed one past `checkBy` raises a notice in Review.
 */
export const gadget = defineKind({
  kind: 'gadget',
  idPrefix: 'gdg',
  namePrefix: 'GDG',
  nameWidth: 4,
  attributes: z.object({
    color: z.string(),
    due: z.iso.date().optional(),
    checkBy: z.iso.date().optional(),
  }),
  review: {
    due: (a) => a.due,
    notice: (a, today) =>
      a.checkBy && a.checkBy <= today ? { message: 'Check the color', due: a.checkBy } : undefined,
  },
});

/** A test-only kind with a keyed list: a protocol whose steps keep their own evidence (ADR 0049). */
export const protocol = defineKind({
  kind: 'protocol',
  idPrefix: 'prt',
  namePrefix: 'PRT',
  nameWidth: 4,
  attributes: z.object({
    steps: z.array(z.object({ id: z.string(), text: z.string(), volume: Quantity.optional() })),
  }),
  items: { steps: 'id' },
  sections: [{ id: 'steps', title: 'Steps', fields: ['steps'] }],
});

/**
 * A test-only kind with a composite key and a keyed list inside a keyed list (ADR 0065): hand
 * edits keyed by plate and well, and groups keyed by id whose transfers are keyed by source and
 * destination well.
 */
export const layoutPlan = defineKind({
  kind: 'layout_plan',
  idPrefix: 'lpl',
  namePrefix: 'LPL',
  nameWidth: 4,
  attributes: z.object({
    overrides: z.array(z.object({ plate: z.string(), well: z.string(), content: z.string() })),
    groups: z.array(
      z.object({
        id: z.string(),
        head: z.string(),
        transfers: z.array(z.object({ from: z.string(), to: z.string(), volume: Quantity })),
      }),
    ),
  }),
  items: { overrides: 'plate+well', groups: 'id', 'groups/transfers': 'from+to' },
  sections: [{ id: 'plan', title: 'Plan', fields: ['overrides', 'groups'] }],
});
