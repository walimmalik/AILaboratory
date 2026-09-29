import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { connect } from './db/client.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const connection = await connect(databaseUrl);
await connection.migrate();

const port = Number(process.env.API_PORT ?? 3001);
serve({ fetch: createApp({ db: connection.db }).fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
