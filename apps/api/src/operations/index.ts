import type { Db } from '../db/client.ts';
import type { KindRegistry } from '../records/kinds.ts';
import { ActivityBus } from './activity.ts';
import { proposalOperations } from './proposal-operations.ts';
import { recordOperations } from './record-operations.ts';
import { OperationRegistry } from './registry.ts';

export { ActivityBus } from './activity.ts';
export { OperationError } from './errors.ts';
export { OperationRegistry } from './registry.ts';

/** The registry with every operation the app offers. */
export function createRegistry(db: Db, kinds: KindRegistry, bus = new ActivityBus()) {
  return new OperationRegistry({ db, kinds, bus }).register(
    ...recordOperations,
    ...proposalOperations,
  );
}
