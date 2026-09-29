import { z } from 'zod';
import { recordIdOf } from '../ids.ts';
import {
  CapabilityId,
  CapabilityLimits,
  Configuration,
  ResolvedConfiguration,
} from '../instruments.ts';
import { defineContract } from '../operation.ts';

export const instrumentsCapabilities = defineContract({
  id: 'instruments.capabilities',
  summary:
    'List the capability catalog: every capability an instrument or equipment kind can offer (transfer, read_absorbance, incubate…), what it means and which limits a kind should give for it',
  effect: 'read',
  input: z.strictObject({}),
  output: z.object({
    capabilities: z.array(
      z.object({
        id: CapabilityId,
        label: z.string(),
        meaning: z.string(),
        expects: z.array(CapabilityLimits.keyof()),
      }),
    ),
  }),
});

export const instrumentsResolve = defineContract({
  id: 'instruments.resolve',
  summary:
    "Check a configuration of an instrument kind (which equipment is on which mount, slot or track) and work out its labware sites, what each piece takes up and the capabilities it has with their limits. Returns every problem found (unknown slot, overlap, equipment that doesn't fit the mount); nothing is saved",
  effect: 'read',
  input: z.strictObject({
    instrumentKind: recordIdOf('ink'),
    configuration: Configuration,
  }),
  output: ResolvedConfiguration,
});
