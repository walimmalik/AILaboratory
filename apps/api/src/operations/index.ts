import { Assistant } from '../assistant/assistant.ts';
import type { Db } from '../db/client.ts';
import { entityOperations } from '../entities/operations.ts';
import { fileOperations } from '../files/operations.ts';
import { type FileStore, MemoryFileStore } from '../files/store.ts';
import { instrumentOperations } from '../instruments/operations.ts';
import { workcellOperations } from '../instruments/workcells.ts';
import { contentsOperations } from '../inventory/contents.ts';
import { inventoryOperations } from '../inventory/operations.ts';
import { labwareOperations } from '../labware/operations.ts';
import type { Converter } from '../library/convert.ts';
import { mentionOperations } from '../library/mentions.ts';
import { libraryOperations } from '../library/operations.ts';
import { liquidOperations } from '../reagents/liquid-operations.ts';
import { reagentOperations } from '../reagents/operations.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { skillOperations } from '../skills/skills.ts';
import { ActivityBus } from './activity.ts';
import { assistantOperations } from './assistant-operations.ts';
import { changeSetOperations } from './change-set.ts';
import { proposalOperations } from './proposal-operations.ts';
import { recordOperations } from './record-operations.ts';
import { OperationRegistry } from './registry.ts';
import { reviewOperations } from './review-operations.ts';

export { ActivityBus } from './activity.ts';

import { conclusionOperations } from '../campaigns/conclusions.ts';
import { campaignOperations } from '../campaigns/operations.ts';
import { runOperations } from '../campaigns/runs.ts';
import { plateMapOperations } from '../platemaps/operations.ts';
import { sopOperations } from '../sops/operations.ts';
import { transferCalculators } from '../transfers/calculators.ts';
import { exportOperations } from '../transfers/export.ts';
import { draftFromPlateMap } from '../transfers/from-plate-map.ts';
import { transferPlanOperations } from '../transfers/plans.ts';
import { reportOperations } from '../transfers/reports.ts';
import { noProtocolWriter, type ProtocolWriter } from '../transfers/simulator.ts';
import { OperationError } from './errors.ts';

export { OperationError } from './errors.ts';
export { OperationRegistry } from './registry.ts';

/** Without a science service, parsing is refused with a message. */
const noConverter: Converter = {
  convert: async () => {
    throw new OperationError('unavailable', 'No science service is set up to convert files');
  },
};

/** The registry with every operation the app offers. */
export function createRegistry(
  db: Db,
  kinds: KindRegistry,
  bus = new ActivityBus(),
  assistant = new Assistant({ reason: 'No model is set up' }),
  {
    files = new MemoryFileStore(),
    converter = noConverter,
    protocols = noProtocolWriter,
  }: { files?: FileStore; converter?: Converter; protocols?: ProtocolWriter } = {},
) {
  return new OperationRegistry({ db, kinds, bus, assistant, files, converter, protocols }).register(
    ...recordOperations,
    ...proposalOperations,
    ...changeSetOperations,
    ...reviewOperations,
    ...skillOperations,
    ...labwareOperations,
    ...instrumentOperations,
    ...workcellOperations,
    ...reagentOperations,
    ...liquidOperations,
    ...entityOperations,
    ...inventoryOperations,
    ...contentsOperations,
    ...fileOperations,
    ...libraryOperations,
    ...mentionOperations,
    ...sopOperations,
    ...campaignOperations,
    ...runOperations,
    ...conclusionOperations,
    ...plateMapOperations,
    ...transferCalculators,
    ...transferPlanOperations,
    draftFromPlateMap,
    ...exportOperations,
    ...reportOperations,
    ...assistantOperations,
  );
}
