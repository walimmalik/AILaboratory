import { z } from 'zod';
import {
  Component,
  EffectiveRule,
  EffectiveStorage,
  InventoryEvent,
  SampleAttributes,
  WellRef,
  WellState,
} from '../contents.ts';
import { recordIdOf } from '../ids.ts';
import { ContainerId } from '../inventory.ts';
import { LiquidVolume, WellName } from '../labware.ts';
import { defineContract } from '../operation.ts';
import { Quantity } from '../quantity.ts';
import { RecordEnvelope } from '../record.ts';

/** Physical events on well contents (plan 010c, V4 and V7). An agent's event is a proposal. */

const Wells = z
  .array(
    z
      .string()
      .regex(
        /^[A-Za-z]{1,2}\d{1,2}(:[A-Za-z]{1,2}\d{1,2})?$/,
        'a well like A1 or a block like A3:P22',
      ),
  )
  .min(1)
  .describe('Wells, or blocks corner to corner like "A3:P22"; a tube or trough is "A1"');

const Reason = z.string().min(1).optional().describe('Why; kept in the ledger');

const Changed = z.object({
  event: InventoryEvent,
  warnings: z
    .array(z.string())
    .describe('Things to look at, e.g. a well left below its dead volume'),
});

export const inventoryFill = defineContract({
  id: 'inventory.fill',
  verbs: { done: 'filled', intent: 'fill' },
  summary:
    'Record liquid (or a dried amount) put into wells from outside the inventory: a lot or sample at a concentration, e.g. 40 µL of 10 mM compound in DMSO into A3:P22. It mixes with what is there',
  effect: 'write',
  input: z.strictObject({
    container: ContainerId,
    fills: z
      .array(
        z.strictObject({
          wells: Wells,
          volume: LiquidVolume.describe('Per well; 0 µL for a dried amount'),
          components: z
            .array(Component)
            .min(1)
            .describe(
              'What the liquid is: each sample or lot with its concentration, or an amount when dry',
            ),
          assumed: z
            .boolean()
            .optional()
            .describe('True when this is an estimate, not what was done'),
        }),
      )
      .min(1),
    reason: Reason,
  }),
  output: Changed,
});

export const inventoryTransfer = defineContract({
  id: 'inventory.transfer',
  verbs: { done: 'recorded a transfer from', intent: 'record a transfer from' },
  summary:
    'Record liquid moved from wells to wells, in order: each line takes a volume from one well and mixes it into another. Concentrations follow by the mixing math',
  effect: 'write',
  input: z.strictObject({
    transfers: z
      .array(z.strictObject({ from: WellRef, to: WellRef, volume: LiquidVolume }))
      .min(1)
      .max(6144),
    runLog: recordIdOf('fil')
      .optional()
      .describe(
        'The instrument report (a file) these transfers are read from. A run log is evidence, so an agent records it directly (V7); each report is recorded once',
      ),
    reason: Reason,
  }),
  output: Changed,
});

export const inventoryConsume = defineContract({
  id: 'inventory.consume',
  verbs: { done: 'recorded use of', intent: 'record use of' },
  summary:
    'Record liquid used up or thrown away from wells (taken for an assay outside the inventory, a spill, evaporation)',
  effect: 'write',
  input: z.strictObject({
    container: ContainerId,
    wells: Wells,
    volume: LiquidVolume.describe('Per well'),
    reason: Reason,
  }),
  output: Changed,
});

export const inventoryCorrect = defineContract({
  id: 'inventory.correct',
  verbs: { done: 'corrected the contents of', intent: 'correct the contents of' },
  summary:
    'Replace what wells hold with what was measured or found (a Qubit reading, a volume check, an empty tube). Needs a reason',
  effect: 'write',
  input: z.strictObject({
    container: ContainerId,
    wells: Wells,
    state: WellState.describe('What each of these wells holds now'),
    reason: z.string().min(1).describe('What was measured or found; kept in the ledger'),
  }),
  output: Changed,
});

export const inventoryWells = defineContract({
  id: 'inventory.wells',
  verbs: { done: 'looked at the wells of', intent: 'look at the wells of' },
  summary:
    "What a container's wells hold: volume and each sample or lot with its concentration. Empty wells are left out",
  effect: 'read',
  input: z.strictObject({ container: ContainerId }),
  output: z.object({
    container: RecordEnvelope,
    positions: z.array(WellName).describe('Every well the container has'),
    wells: z.array(z.object({ well: WellName, state: WellState })),
  }),
});

export const inventoryHistory = defineContract({
  id: 'inventory.history',
  verbs: { done: 'read the contents history of', intent: 'read the contents history of' },
  summary:
    'The ledger of a container, or one of its wells: every fill, transfer, consume and correction, newest first, with who did it and what the wells held after',
  effect: 'read',
  input: z.strictObject({
    container: ContainerId,
    well: WellName.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  output: z.object({ events: z.array(InventoryEvent) }),
});

export const samplesRegister = defineContract({
  id: 'samples.register',
  verbs: { done: 'registered samples', intent: 'register samples' },
  summary:
    'Register a batch the lab made of an entity: a miniprep, PCR product, purified protein, culture or cell bank, with its QC (concentration, A260/280, sequence verified, passage). Its tubes are containers filled with it',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('e.g. "pIL6p-luc2 miniprep, colony 1"'),
    ...SampleAttributes.shape,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const inventoryDiscard = defineContract({
  id: 'inventory.discard',
  verbs: { done: 'discarded', intent: 'discard' },
  summary:
    'Record a container thrown away: its wells are emptied in the ledger and it is marked discarded. It stays readable with its history. A rack or box must be emptied first',
  effect: 'write',
  input: z.strictObject({
    container: ContainerId,
    expectedVersion: z.number().int().positive().describe('The version you last read'),
    reason: Reason,
  }),
  output: z.object({ container: RecordEnvelope, event: InventoryEvent.optional() }),
});

export const PlateMapping = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('one_to_one') }),
    z.strictObject({
      type: z.literal('quadrant'),
      quadrant: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    }),
    z.strictObject({
      type: z.literal('offset'),
      rows: z.number().int().min(-47).max(47),
      columns: z.number().int().min(-47).max(47),
    }),
  ])
  .describe(
    'one_to_one (same grid); quadrant 1 to 4 (96 into 384 or 384 into 1536: 1 starts at A1, 2 at A2, 3 at B1, 4 at B2); offset by rows and columns',
  );

const Grid = z.strictObject({
  rows: z.number().int().min(1).max(32),
  columns: z.number().int().min(1).max(48),
});

export const inventoryMapPlates = defineContract({
  id: 'inventory.map_plates',
  verbs: { done: 'mapped plates', intent: 'map plates' },
  calculator: true,
  summary:
    'Work out which source well lands on which destination well when a plate is stamped onto another: one to one, by quadrant (96 into 384) or by an offset. Give containers or grids. Changes nothing',
  effect: 'read',
  input: z.strictObject({
    from: z.union([ContainerId, Grid]).describe('The source plate, or its rows and columns'),
    to: z.union([ContainerId, Grid]).describe('The destination plate, or its rows and columns'),
    mapping: PlateMapping,
    wells: Wells.optional().describe('Only these source wells; every well if left out'),
  }),
  output: z.object({
    pairs: z.array(z.object({ from: WellName, to: WellName })),
    explanation: z.string(),
  }),
});

export const inventoryStamp = defineContract({
  id: 'inventory.stamp',
  verbs: { done: 'stamped', intent: 'stamp' },
  summary:
    'Record a plate stamped onto another: the same volume from each source well into its mapped destination well (one to one, a quadrant, or an offset), e.g. 25 nL from an Echo source plate into an assay-ready plate. Only wells that hold something are stamped unless you list them',
  effect: 'write',
  input: z.strictObject({
    from: ContainerId,
    to: ContainerId,
    mapping: PlateMapping,
    volume: LiquidVolume.describe('Per well'),
    wells: Wells.optional().describe('Only these source wells'),
    reason: Reason,
  }),
  output: Changed,
});

export const inventoryLineage = defineContract({
  id: 'inventory.lineage',
  verbs: {
    done: 'traced where the liquid came from in',
    intent: 'trace where the liquid came from in',
  },
  summary:
    'Where the liquid in a well came from: each fill and each transfer or stamp into it, then back through the source wells, newest first',
  effect: 'read',
  input: z.strictObject({
    container: ContainerId,
    well: WellName,
    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('How many steps back; 5 if left out'),
  }),
  output: z.object({
    steps: z.array(
      z.object({
        to: WellRef,
        from: WellRef.optional().describe('Left out for a fill from outside the inventory'),
        volume: Quantity.optional(),
        components: z.array(Component).optional().describe('A fill: what went in'),
        eventId: z.string(),
        type: z.string(),
        at: z.string(),
        depth: z.number().int(),
      }),
    ),
  }),
});

export const inventoryEffectiveRules = defineContract({
  id: 'inventory.effective_rules',
  verbs: { done: 'checked the handling rules of', intent: 'check the handling rules of' },
  summary:
    'The handling rules a container inherits from what its wells hold (time out of the incubator, light, temperature, freeze-thaws), the strictest winning, each with every rule it came from and its source; plus the narrowest storage temperature. What the scheduler keeps to',
  effect: 'read',
  input: z.strictObject({
    container: ContainerId,
    wells: Wells.optional().describe('Only these wells; every filled well if left out'),
  }),
  output: z.object({
    container: RecordEnvelope,
    rules: z.array(EffectiveRule).describe('Enforced rules first'),
    storage: EffectiveStorage.optional().describe(
      'Left out when nothing in it names a storage temperature',
    ),
  }),
});
