import { z } from 'zod';
import { Component, InventoryEvent, WellRef, WellState } from '../contents.ts';
import { ContainerId } from '../inventory.ts';
import { LiquidVolume, WellName } from '../labware.ts';
import { defineContract } from '../operation.ts';
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
  summary:
    'Record liquid moved from wells to wells, in order: each line takes a volume from one well and mixes it into another. Concentrations follow by the mixing math',
  effect: 'write',
  input: z.strictObject({
    transfers: z
      .array(z.strictObject({ from: WellRef, to: WellRef, volume: LiquidVolume }))
      .min(1)
      .max(6144),
    reason: Reason,
  }),
  output: Changed,
});

export const inventoryConsume = defineContract({
  id: 'inventory.consume',
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
