import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { assayKinds } from './assays/kinds.ts';
import { Assistant } from './assistant/assistant.ts';
import { modelFromEnv } from './assistant/config.ts';
import { markInterrupted } from './assistant/store.ts';
import { campaignKinds } from './campaigns/kinds.ts';
import { connect } from './db/client.ts';
import { entityKinds } from './entities/kinds.ts';
import { fileKinds } from './files/kinds.ts';
import { fileStoreFromEnv } from './files/store.ts';
import { instrumentKinds } from './instruments/kinds.ts';
import { inventoryKinds } from './inventory/kinds.ts';
import { labwareKinds } from './labware/kinds.ts';
import { converterFromEnv } from './library/convert.ts';
import { libraryKinds } from './library/kinds.ts';
import { memoryKinds } from './memory/kinds.ts';
import { plateMapKinds } from './platemaps/kinds.ts';
import { reagentKinds } from './reagents/kinds.ts';
import { KindRegistry } from './records/kinds.ts';
import { widget } from './records/test-kinds.ts';
import { sopKinds } from './sops/kinds.ts';
import { transferKinds } from './transfers/kinds.ts';
import { protocolWriterFromEnv } from './transfers/simulator.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const connection = await connect(databaseUrl);
await connection.migrate();

// Each registry registers its kinds here as its plan lands. The widget kind exists only for
// end-to-end tests and demos, and only when asked for.
const kinds = new KindRegistry();
for (const kind of [
  ...labwareKinds,
  ...instrumentKinds,
  ...reagentKinds,
  ...entityKinds,
  ...inventoryKinds,
  ...fileKinds,
  ...libraryKinds,
  ...sopKinds,
  ...campaignKinds,
  ...plateMapKinds,
  ...transferKinds,
  ...memoryKinds,
  ...assayKinds,
])
  kinds.register(kind);
if (process.env.AILAB_TEST_KINDS === '1') kinds.register(widget);

// The in-app assistant's model comes from .env (AGENT_PROVIDER, its key, AGENT_MODEL).
const setup = modelFromEnv(process.env);
const assistant = new Assistant(setup);
await markInterrupted(connection.db);
console.log(
  'model' in setup
    ? `assistant: ${setup.model.provider} ${setup.model.model}`
    : `assistant: not set up (${setup.reason})`,
);

const port = Number(process.env.API_PORT ?? 3001);
serve(
  {
    fetch: createApp({
      db: connection.db,
      kinds,
      assistant,
      files: fileStoreFromEnv(process.env),
      converter: converterFromEnv(process.env),
      protocols: protocolWriterFromEnv(process.env),
    }).fetch,
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
