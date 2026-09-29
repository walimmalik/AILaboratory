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
});
