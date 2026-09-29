import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { connect } from './db/client.ts';
import { KindRegistry } from './records/kinds.ts';
import { widget } from './records/test-kinds.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const connection = await connect(databaseUrl);
await connection.migrate();

// Real kinds register here as their plans land (labware in 007). The widget kind exists only for
// end-to-end tests and demos, and only when asked for.
const kinds = new KindRegistry();
if (process.env.AILAB_TEST_KINDS === '1') kinds.register(widget);

const port = Number(process.env.API_PORT ?? 3001);
serve(
  { fetch: createApp({ db: connection.db, kinds }).fetch, port, hostname: '0.0.0.0' },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
