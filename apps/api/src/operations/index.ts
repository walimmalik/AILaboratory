import { Assistant } from '../assistant/assistant.ts';
import type { Db } from '../db/client.ts';
import { entityOperations } from '../entities/operations.ts';
import { instrumentOperations } from '../instruments/operations.ts';
import { labwareOperations } from '../labware/operations.ts';
import { liquidOperations } from '../reagents/liquid-operations.ts';
import { reagentOperations } from '../reagents/operations.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { ActivityBus } from './activity.ts';
import { assistantOperations } from './assistant-operations.ts';
import { proposalOperations } from './proposal-operations.ts';
import { recordOperations } from './record-operations.ts';
import { OperationRegistry } from './registry.ts';
import { reviewOperations } from './review-operations.ts';

export { ActivityBus } from './activity.ts';
export { OperationError } from './errors.ts';
export { OperationRegistry } from './registry.ts';

/** The registry with every operation the app offers. */
export function createRegistry(
  db: Db,
  kinds: KindRegistry,
  bus = new ActivityBus(),
  assistant = new Assistant({ reason: 'No model is set up' }),
) {
  return new OperationRegistry({ db, kinds, bus, assistant }).register(
    ...recordOperations,
    ...proposalOperations,
    ...reviewOperations,
    ...labwareOperations,
    ...instrumentOperations,
    ...reagentOperations,
    ...liquidOperations,
    ...entityOperations,
    ...assistantOperations,
  );
}
