import { z } from 'zod';
import { Component, SampleId, WellState } from '../contents.ts';
import { recordIdOf } from '../ids.ts';
import {
  ContainerAttributes,
  ContainerId,
  ContainerPlace,
  LocationAttributes,
  LocationId,
  PlacePath,
} from '../inventory.ts';
import { LiquidVolume } from '../labware.ts';
import { defineContract } from '../operation.ts';
import { LotId, ProductId } from '../reagents.ts';
import { RecordEnvelope } from '../record.ts';

const Reason = z.string().min(1).optional().describe('Why; kept in history');
const ExpectedVersion = z
  .number()
  .int()
  .positive()
  .describe('The version you last read; the change is refused if the record has moved on');

export const locationsCreate = defineContract({
  id: 'locations.create',
  verbs: { done: 'added a storage location', intent: 'add a storage location' },
  summary:
    'Add a place that does not move: a room, a fridge or freezer in it, a shelf in a freezer, an incubator or an automated store. Boxes and racks are containers, not locations',
  effect: 'write',
  input: z.strictObject({
    label: z.string().min(1).describe('Its name on the door, e.g. "Freezer -80 1"'),
    ...LocationAttributes.shape,
    reason: Reason,
  }),
  output: RecordEnvelope,
});

export const inventoryRegisterContainers = defineContract({
  id: 'inventory.register_containers',
  verbs: { done: 'registered containers', intent: 'register containers' },
  summary:
    'Register physical plates, tubes, reservoirs, racks or boxes of one labware type, each with where it is. Each gets its lab barcode as its name (PLT-000001, TUB-000001, BOX-000001); codes already printed on it (FluidX, vendor) are kept and also scan. What they hold comes with 010c; say it in `description` for now',
  effect: 'write',
  input: z.strictObject({
    labwareType: recordIdOf('lwt'),
    containers: z
      .array(
        ContainerAttributes.pick({
          place: true,
          barcodes: true,
          sealed: true,
          lidded: true,
          description: true,
          notes: true,
        }).extend({
          label: z
            .string()
            .min(1)
            .optional()
            .describe('A short name people use, e.g. "IL-6 coated plate"; defaults to the type'),
        }),
      )
      .min(1)
      .max(96)
      .describe('One entry per physical item'),
    reason: Reason,
  }),
  output: z.object({ containers: z.array(RecordEnvelope) }),
});

export const inventoryMove = defineContract({
  id: 'inventory.move',
  verbs: { done: 'moved', intent: 'move' },
  summary:
    'Move a container to a location, or into a position of a rack or box. Moving a box moves everything in it',
  effect: 'write',
  input: z.strictObject({
    container: ContainerId,
    expectedVersion: ExpectedVersion,
    to: ContainerPlace,
    reason: Reason,
  }),
  output: z.object({ container: RecordEnvelope, path: PlacePath }),
});

export const inventoryScan = defineContract({
  id: 'inventory.scan',
  verbs: { done: 'scanned', intent: 'scan' },
  summary:
    'Resolve a scanned or typed code to its record: a readable name of any record (PLT-000345, LOT-0003; with or without the dash, any case) or a code printed on a container. Containers and locations come with where they are',
  effect: 'read',
  input: z.strictObject({ code: z.string().min(1).max(128) }),
  output: z.object({
    record: RecordEnvelope,
    matched: z.enum(['name', 'barcode']),
    path: PlacePath.optional().describe('Where it is, from the room down'),
  }),
});

export const inventoryListPlace = defineContract({
  id: 'inventory.list_place',
  verbs: { done: 'listed what is in', intent: 'list what is in' },
  summary:
    'What is in a location or a rack or box: the containers there (with their positions), and for a location the locations inside it. `deep` includes everything further in',
  effect: 'read',
  input: z.strictObject({
    place: z.union([LocationId, ContainerId]),
    deep: z.boolean().optional(),
  }),
  output: z.object({
    path: PlacePath,
    locations: z.array(RecordEnvelope),
    containers: z.array(
      z.object({ container: RecordEnvelope, position: z.string().optional(), path: PlacePath }),
    ),
  }),
});

export const inventoryCalculateTransfer = defineContract({
  id: 'inventory.calculate_transfer',
  verbs: { done: 'calculated a transfer', intent: 'calculate a transfer' },
  calculator: { title: 'Transfer between containers', group: 'dilutions' },
  summary:
    'Work out what two wells hold after moving a volume from one to the other: the volumes left and the concentration of every component after mixing (e.g. 25 nL of a 10 mM stock into 25 µL of medium). Use this rather than your own arithmetic; it changes nothing',
  effect: 'read',
  input: z.strictObject({
    source: WellState.describe('What the source well holds'),
    destination: WellState.optional().describe(
      'What the destination well holds; empty if left out',
    ),
    volume: LiquidVolume.describe('How much to move'),
  }),
  output: z.object({
    source: WellState,
    destination: WellState,
    explanation: z.string(),
  }),
});

export const inventoryWhereIs = defineContract({
  id: 'inventory.where_is',
  verbs: { done: 'looked up where it is', intent: 'look up where it is' },
  summary:
    'Where a lot, a sample or a product is: every container holding it (a product: any of its lots), where each container is, and the wells with their volume and concentration. Discarded containers are left out',
  effect: 'read',
  input: z.strictObject({
    of: z
      .union([LotId, SampleId, ProductId])
      .describe('A lot (lot_), sample (smp_) or product (prd_)'),
  }),
  output: z.object({
    containers: z.array(
      z.object({
        container: RecordEnvelope,
        path: PlacePath.describe('Where the container is, from the room down to the container'),
        wells: z.array(
          z.object({
            well: z.string(),
            volume: WellState.shape.volume,
            component: Component.describe('The lot or sample asked about, as it is in this well'),
          }),
        ),
      }),
    ),
  }),
});
