import type { OperationContract } from '../operation.ts';
import * as assays from './assays.ts';
import * as assistant from './assistant.ts';
import * as campaigns from './campaigns.ts';
import * as contents from './contents.ts';
import * as entities from './entities.ts';
import * as files from './files.ts';
import * as instruments from './instruments.ts';
import * as inventory from './inventory.ts';
import * as labware from './labware.ts';
import * as library from './library.ts';
import * as liquids from './liquids.ts';
import * as memory from './memory.ts';
import * as platemaps from './platemaps.ts';
import * as proposals from './proposals.ts';
import * as reagents from './reagents.ts';
import * as records from './records.ts';
import * as review from './review.ts';
import * as skills from './skills.ts';
import * as sops from './sops.ts';
import * as transfers from './transfers.ts';
import * as workspace from './workspace.ts';

const isContract = (value: unknown): value is OperationContract =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'verbs' in value &&
  'effect' in value &&
  'input' in value;

/**
 * Every operation contract, by ID. Screens read an operation's plain words from here (UI rule 9),
 * and the API checks it registers exactly these.
 */
export const operationContracts: ReadonlyMap<string, OperationContract> = new Map(
  [
    assays,
    assistant,
    campaigns,
    contents,
    entities,
    files,
    instruments,
    inventory,
    labware,
    library,
    liquids,
    memory,
    platemaps,
    proposals,
    reagents,
    records,
    review,
    skills,
    sops,
    transfers,
    workspace,
  ]
    .flatMap((module) => Object.values(module).filter(isContract))
    .map((contract) => [contract.id, contract]),
);
