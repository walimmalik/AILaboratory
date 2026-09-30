import { z } from 'zod';
import { recordIdOf } from './ids.ts';
import { Celsius } from './instruments.ts';
import { type LabwareFamily, WellName } from './labware.ts';
import { Quantity } from './quantity.ts';

/**
 * Locations and containers (plan 010b, V5 and V6). Locations are a fixed tree (rooms, fridges,
 * freezers, shelves, incubators); containers are the barcoded plates, tubes, reservoirs, racks and
 * boxes, each an instance of a labware type. A container sits in a location, or in a position of a
 * rack or box that is itself a container, so moving a box moves what is in it.
 */

export const LocationId = recordIdOf('loc');
export const ContainerId = recordIdOf('lw');

export const LocationType = z
  .enum([
    'room',
    'fridge',
    'freezer',
    'cryostore',
    'incubator',
    'cold_room',
    'shelf',
    'cabinet',
    'bench',
    'automated_store',
    'other',
  ])
  .describe('What kind of place it is; automated stores (a Cytomat) link to their instrument');
export type LocationType = z.infer<typeof LocationType>;

export const LocationAttributes = z.strictObject({
  type: LocationType,
  parent: LocationId.optional().describe('Where it is: a freezer in a room, a shelf in a freezer'),
  setpoint: Celsius.optional().describe('The temperature it is kept at'),
  co2: Quantity.optional().describe('Incubators: CO2, e.g. 5 %v/v'),
  instrument: recordIdOf('ins')
    .optional()
    .describe('An automated store or incubator that is a registered instrument'),
  notes: z.string().min(1).optional(),
});
export type LocationAttributes = z.infer<typeof LocationAttributes>;

/** Readable name prefixes per labware family (V5): the name is the lab barcode. */
export const CONTAINER_PREFIX: Record<LabwareFamily, string> = {
  plate: 'PLT',
  reservoir: 'RES',
  tube: 'TUB',
  rack: 'BOX',
  tip_rack: 'TIP',
  lid: 'LID',
};

export const ContainerPlace = z.union([
  z.strictObject({ location: LocationId }).describe('On a shelf, in a fridge or an incubator'),
  z
    .strictObject({
      container: ContainerId.describe('A rack or box'),
      position: WellName.describe('Its position in the rack or box, e.g. B3'),
    })
    .describe('In a position of a rack or freezer box'),
]);
export type ContainerPlace = z.infer<typeof ContainerPlace>;

export const ExternalBarcode = z.strictObject({
  code: z
    .string()
    .regex(/^[A-Za-z0-9._\-/+]{3,64}$/, 'letters, digits and . _ - / + only')
    .describe('As printed, e.g. a FluidX tube code'),
  from: z
    .enum(['manufacturer', 'vendor', 'earlier_system'])
    .describe('Who printed it: pre-barcoded labware, a vendor plate, or an earlier inventory'),
});

export const ContainerStatus = z
  .enum(['in_use', 'empty', 'discarded'])
  .describe('Containers are never deleted: empty and discarded keep their history');

export const ContainerAttributes = z.strictObject({
  labwareType: recordIdOf('lwt').describe('What it is, e.g. a Corning 3570 plate'),
  place: ContainerPlace.optional().describe('Where it is now; unknown if left out'),
  barcodes: z
    .array(ExternalBarcode)
    .optional()
    .describe("Codes printed on it besides the lab's own (its readable name)"),
  status: ContainerStatus,
  sealed: z.boolean().optional(),
  lidded: z.boolean().optional(),
  description: z.string().min(1).optional().describe('What it holds, in words, until 010c'),
  notes: z.string().min(1).optional(),
});
export type ContainerAttributes = z.infer<typeof ContainerAttributes>;

/** Where something is, from the room down, e.g. Cold room › Freezer -80 1 › BOX-0012 › B3. */
export const PlacePath = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    label: z.string(),
    position: WellName.optional(),
  }),
);
export type PlacePath = z.infer<typeof PlacePath>;
